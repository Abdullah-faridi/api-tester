import { DiscoveredRoute } from "./discoveredRoutes.js";
export interface DiscoveryResult {
  projectDir: string;
  appFiles: string[];
  routes: DiscoveredRoute[];
  warnings: string[];
}
