import test from "node:test";
import assert from "node:assert";
import { diagnose } from "../src/runner/diagnose.js";
import { CallResult } from "../src/types/callResults.js";
const result = (
  status: number | null,
  body: unknown = null,
  error?: CallResult["error"],
): CallResult => ({
  request: "GET /x",
  ok: status !== null && status < 400,
  status,
  durationMs: 1,
  body,
  error,
});

test("500 on invalid input is an app bug", () => {
  assert.equal(
    diagnose("invalid_input", result(500), false).category,
    "app_bug",
  );
});

test("400 on invalid input passes", () => {
  assert.equal(diagnose("invalid_input", result(400), false).category, "pass");
});

test("400 on a valid body is a test input problem", () => {
  assert.equal(diagnose("success", result(400), true).category, "test_input");
});

test("401 without a token is an auth problem", () => {
  assert.equal(diagnose("success", result(401), false).category, "auth");
});

test("200 without a token on a protected route is an app bug", () => {
  assert.equal(diagnose("needs_auth", result(200), false).category, "app_bug");
});

test("connection refused is a network problem", () => {
  const error = {
    kind: "network" as const,
    code: "ECONNREFUSED",
    message: "fetch failed",
  };
  assert.equal(
    diagnose("success", result(null, undefined, error), false).category,
    "network",
  );
});
