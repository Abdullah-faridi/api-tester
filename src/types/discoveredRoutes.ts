export interface DiscoveredRoute {
  method: string;
  path: string;
  file: string;
  line: number;
  middleware: string[];
  likelyRequiresAuth: boolean;
}
