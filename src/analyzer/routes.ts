import fs from "node:fs";
import path from "node:path";
import { Project, Node, SyntaxKind, ts } from "ts-morph";
import type { VariableDeclaration, Identifier } from "ts-morph";
import { DiscoverOptions } from "../types/discoveredOptions.js";
import { DiscoveredRoute } from "../types/discoveredRoutes.js";
import { DiscoveryResult } from "../types/discoveryResult.js";

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "all",
  "head",
  "options",
]);

function factoryKind(init: Node | undefined): "app" | "router" | undefined {
  if (!init || !Node.isCallExpression(init)) return undefined;
  const callee = init.getExpression();
  if (Node.isIdentifier(callee)) {
    if (callee.getText() === "express") return "app";
    if (callee.getText() === "Router") return "router";
  }
  if (Node.isPropertyAccessExpression(callee) && callee.getName() === "Router")
    return "router";
  return undefined;
}

function joinPaths(prefix: string, p: string): string {
  const joined = ("/" + [prefix, p].join("/")).replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

const short = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? t.slice(0, 77) + "..." : t;
};
function loadProject(root: string): Project {
  const tsconfig = path.join(root, "tsconfig.json");
  if (fs.existsSync(tsconfig))
    return new Project({ tsConfigFilePath: tsconfig });
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
  });
  project.addSourceFilesAtPaths([
    path.join(root, "**/*.ts").replace(/\\/g, "/"),
    "!**/node_modules/**",
    "!**/*.d.ts",
  ]);
  return project;
}

class Walker {
  routes: DiscoveredRoute[] = [];
  warnings = new Set<string>();
  private seen = new Set<string>();

  constructor(private root: string) {}

  private rel(file: string) {
    return path.relative(this.root, file).replace(/\\/g, "/");
  }

  walk(decl: VariableDeclaration, prefix: string) {
    const sf = decl.getSourceFile();
    const key = `${sf.getFilePath()}:${decl.getPos()}:${prefix}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) continue;
      const target = callee.getExpression();
      if (
        !Node.isIdentifier(target) ||
        target.getSymbol()?.getValueDeclaration() !== decl
      )
        continue;

      const name = callee.getName();
      const args = call.getArguments();

      if (HTTP_METHODS.has(name)) {
        if (args.length < 2) continue;
        this.addRoute(
          name,
          call,
          this.pathsFrom(args[0]),
          args.slice(1),
          prefix,
        );
      } else if (name === "route") {
        this.walkRouteChain(call, prefix);
      } else if (name === "use") {
        this.handleUse(args, prefix);
      }
    }
  }

  private handleUse(args: Node[], prefix: string) {
    let usePath = "";
    let rest = args;
    const first = args[0];
    if (
      first &&
      (Node.isStringLiteral(first) ||
        Node.isNoSubstitutionTemplateLiteral(first))
    ) {
      usePath = first.getLiteralText();
      rest = args.slice(1);
    }
    for (const arg of rest) {
      if (!Node.isIdentifier(arg)) continue;
      const routerDecl = this.resolveRouter(arg);
      if (routerDecl) {
        this.walk(routerDecl, joinPaths(prefix, usePath));
      } else if (usePath) {
        this.warnings.add(
          `Skipped use("${usePath}", ${arg.getText()}): not recognised as an Express router`,
        );
      }
    }
  }

  private walkRouteChain(call: Node, prefix: string) {
    if (!Node.isCallExpression(call)) return;
    const pathArg = call.getArguments()[0];
    if (!pathArg) return;
    const paths = this.pathsFrom(pathArg);
    let node: Node = call;
    for (;;) {
      const pae = node.getParent();
      if (!Node.isPropertyAccessExpression(pae) || pae.getExpression() !== node)
        break;
      const outer = pae.getParent();
      if (!Node.isCallExpression(outer) || outer.getExpression() !== pae) break;
      if (HTTP_METHODS.has(pae.getName())) {
        this.addRoute(
          pae.getName(),
          outer,
          paths,
          outer.getArguments(),
          prefix,
        );
      }
      node = outer;
    }
  }

  private resolveRouter(id: Identifier): VariableDeclaration | undefined {
    let sym = id.getSymbol();
    if (sym?.isAlias()) sym = sym.getAliasedSymbol() ?? sym;
    const decl = sym?.getValueDeclaration() ?? sym?.getDeclarations()[0];
    if (!decl) return undefined;
    if (
      Node.isVariableDeclaration(decl) &&
      factoryKind(decl.getInitializer()) === "router"
    )
      return decl;
    if (Node.isExportAssignment(decl)) {
      const e = decl.getExpression();
      if (Node.isIdentifier(e)) return this.resolveRouter(e);
    }
    return undefined;
  }

  private pathsFrom(node: Node): string[] {
    if (
      Node.isStringLiteral(node) ||
      Node.isNoSubstitutionTemplateLiteral(node)
    )
      return [node.getLiteralText()];
    if (Node.isArrayLiteralExpression(node))
      return node.getElements().flatMap((e) => this.pathsFrom(e));
    this.warnings.add(
      `Dynamic route path \`${short(node.getText())}\` at ${this.rel(node.getSourceFile().getFilePath())}:${node.getStartLineNumber()}`,
    );
    return [`<dynamic:${short(node.getText())}>`];
  }

  private addRoute(
    method: string,
    call: Node,
    paths: string[],
    handlerArgs: Node[],
    prefix: string,
  ) {
    const middleware = handlerArgs.slice(0, -1).map((a) => short(a.getText()));
    for (const p of paths) {
      this.routes.push({
        method: method.toUpperCase(),
        path: joinPaths(prefix, p),
        file: this.rel(call.getSourceFile().getFilePath()),
        line: call.getStartLineNumber(),
        middleware,
        likelyRequiresAuth: middleware.some((m) =>
          /auth|jwt|protect|session|guard/i.test(m),
        ),
      });
    }
  }
}

export function discoverRoutes({
  projectDir,
  entryFile,
}: DiscoverOptions): DiscoveryResult {
  const root = path.resolve(projectDir);
  if (!fs.existsSync(root))
    throw new Error(`Project folder not found: ${root}`);

  const project = loadProject(root);
  const walker = new Walker(root);
  const entryAbs = entryFile ? path.resolve(root, entryFile) : undefined;
  const appFiles: string[] = [];

  for (const sf of project.getSourceFiles()) {
    if (sf.isInNodeModules() || sf.isDeclarationFile()) continue;
    if (entryAbs && path.resolve(sf.getFilePath()) !== entryAbs) continue;
    for (const decl of sf.getDescendantsOfKind(
      SyntaxKind.VariableDeclaration,
    )) {
      if (factoryKind(decl.getInitializer()) === "app") {
        appFiles.push(
          path.relative(root, sf.getFilePath()).replace(/\\/g, "/"),
        );
        walker.walk(decl, "");
      }
    }
  }

  if (appFiles.length === 0) {
    throw new Error(
      `No Express app found in ${root}. Looked for \`const x = express()\`` +
        (entryFile ? ` in ${entryFile}.` : " in every .ts file."),
    );
  }

  const unique = new Map(
    walker.routes.map((r) => [`${r.method} ${r.path} ${r.file}:${r.line}`, r]),
  );
  return {
    projectDir: root,
    appFiles,
    routes: [...unique.values()],
    warnings: [...walker.warnings],
  };
}
