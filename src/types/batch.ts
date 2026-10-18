import { Expectation, Category } from "../runner/diagnose.js";
export type Vars = Record<string, unknown>;

export interface BatchRequest {
  name?: string;
  method: string;
  path: string;
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
  expect?: Expectation;
  expectStatus?: number | number[];
  save?: Record<string, string>;
  auth?: "user" | "none";
}

export interface BatchOptions {
  baseUrl?: string;
  requests: BatchRequest[];
  stopOnFail?: boolean;
  vars?: Vars;
  includeBodies?: boolean;
}

export interface BatchStep {
  name: string;
  request: string;
  status: number | null;
  durationMs: number;
  outcome: "pass" | "fail" | "skipped";
  category: Category;
  reason: string;
  saved: string[];
  body?: string;
}
