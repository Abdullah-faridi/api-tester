import { randomUUID } from "node:crypto";
import { describeRoute } from "../analyzer/describe.js";
import { DescribeOptions } from "../types/describeOptions.js";
import { InvalidCase } from "../types/invalidCase.js";
type Schema = Record<string, any>;

function firstOption(s: Schema): Schema {
  const options = s.anyOf ?? s.oneOf;
  return options
    ? (options.find((o: Schema) => o.type !== "null") ?? options[0])
    : s;
}

function typeOf(s: Schema): string | undefined {
  return Array.isArray(s.type)
    ? s.type.find((t: string) => t !== "null")
    : s.type;
}

function sampleString(field: string, s: Schema): string {
  const name = field.toLowerCase();
  let v = "sample text";
  if (s.format === "email" || name.includes("email"))
    v = `user_${Math.random().toString(36).slice(2, 8)}@example.com`;
  else if (s.format === "uuid") v = randomUUID();
  else if (s.format === "uri" || s.format === "url") v = "https://example.com";
  else if (s.format === "date-time") v = new Date().toISOString();
  else if (name.includes("password")) v = "Passw0rd!123";
  else if (name.includes("name")) v = "Test User";
  else if (name.includes("title")) v = "Sample title";
  if (s.minLength && v.length < s.minLength) v = v.padEnd(s.minLength, "x");
  if (s.maxLength && v.length > s.maxLength) v = v.slice(0, s.maxLength);
  return v;
}

export function generateValue(schema: Schema, field = "value"): unknown {
  const s = firstOption(schema);
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];

  switch (typeOf(s)) {
    case "string":
      return sampleString(field, s);
    case "integer":
    case "number": {
      let n =
        s.minimum ??
        (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 1);
      if (s.maximum !== undefined && n > s.maximum) n = s.maximum;
      return n;
    }
    case "boolean":
      return true;
    case "array":
      return Array.from({ length: Math.max(1, s.minItems ?? 1) }, () =>
        generateValue(s.items ?? {}, field),
      );
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, prop] of Object.entries(s.properties ?? {}))
        out[key] = generateValue(prop as Schema, key);
      return out;
    }
    default:
      return "sample";
  }
}

const BAD_FORMAT: Record<string, string> = {
  email: "not-an-email",
  uuid: "not-a-uuid",
  uri: "not a url",
  url: "not a url",
  "date-time": "not-a-date",
};

export function generateInvalidCases(schema: Schema, max = 20): InvalidCase[] {
  const s = firstOption(schema);
  if (typeOf(s) !== "object") return [];

  const valid = generateValue(s) as Record<string, unknown>;
  const props = (s.properties ?? {}) as Record<string, Schema>;
  const required: string[] = s.required ?? [];
  const cases: InvalidCase[] = [];

  const broken = (
    name: string,
    why: string,
    field: string,
    value?: unknown,
    remove = false,
  ) => {
    const body = { ...valid, [field]: value };
    if (remove) delete body[field];
    cases.push({ name, body, why });
  };

  if (required.length > 0)
    cases.push({ name: "empty_body", body: {}, why: "no fields at all" });

  for (const field of required) {
    broken(
      `missing_${field}`,
      `required field "${field}" is absent`,
      field,
      undefined,
      true,
    );
  }

  for (const [field, raw] of Object.entries(props)) {
    const p = firstOption(raw);
    const type = typeOf(p);

    if (type) {
      const wrong =
        type === "string"
          ? 12345
          : type === "boolean"
            ? "yes"
            : type === "array"
              ? "not-an-array"
              : type === "object"
                ? "not-an-object"
                : "not-a-number";
      broken(
        `wrong_type_${field}`,
        `"${field}" should be ${type}`,
        field,
        wrong,
      );
    }
    if (type === "string") {
      if (p.minLength !== undefined && p.minLength >= 1) {
        broken(
          `too_short_${field}`,
          `"${field}" shorter than minLength ${p.minLength}`,
          field,
          "x".repeat(p.minLength - 1),
        );
      }
      if (p.maxLength !== undefined && p.maxLength <= 20000) {
        broken(
          `too_long_${field}`,
          `"${field}" longer than maxLength ${p.maxLength}`,
          field,
          "x".repeat(p.maxLength + 1),
        );
      }
      if (p.format && BAD_FORMAT[p.format]) {
        broken(
          `bad_format_${field}`,
          `"${field}" is not a valid ${p.format}`,
          field,
          BAD_FORMAT[p.format],
        );
      }
    }
    if (type === "number" || type === "integer") {
      if (p.minimum !== undefined)
        broken(
          `below_min_${field}`,
          `"${field}" below minimum ${p.minimum}`,
          field,
          p.minimum - 1,
        );
      if (p.maximum !== undefined)
        broken(
          `above_max_${field}`,
          `"${field}" above maximum ${p.maximum}`,
          field,
          p.maximum + 1,
        );
    }
    if (p.enum)
      broken(
        `not_in_enum_${field}`,
        `"${field}" is not one of ${JSON.stringify(p.enum)}`,
        field,
        "__not_allowed__",
      );
  }

  return cases.slice(0, max);
}

export async function generateTestInputs(opts: DescribeOptions) {
  const d = await describeRoute(opts);
  const base = {
    route: `${d.method} ${d.path}`,
    pathParams: d.pathParams,
    requiresAuth: d.requiresAuth,
  };

  if (!d.bodyJsonSchema) {
    return {
      ...base,
      valid: null,
      invalid: [],
      note:
        d.bodySchemaError ??
        "No body schema found for this route: send no body.",
    };
  }
  const schema = d.bodyJsonSchema as Schema;
  return {
    ...base,
    valid: generateValue(schema),
    invalid: generateInvalidCases(schema),
    note: "Valid should succeed. Invalid cases should get a 4xx. A 5xx on bad input means the server crashed: that is a bug.",
  };
}
