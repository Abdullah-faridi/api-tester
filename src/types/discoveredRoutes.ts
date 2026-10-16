export interface DiscoveredRoute {
  method: string;
  path: string;
  file: string;
  line: number;
  middleware: string[];
  likelyRequiresAuth: boolean;
  bodySchema?: { name: string; file: string; exported: boolean };
}
