import dotenv from "dotenv";
import test from "node:test";
import assert from "node:assert/strict";
import { checkRequest } from "../src/runner/safety.js";
dotenv.config();
test("localhost is allowed", () => {
  assert.doesNotThrow(() =>
    checkRequest(new URL("http://localhost:3000/x"), "POST"),
  );
});

test("other hosts are blocked by default", () => {
  assert.throws(
    () => checkRequest(new URL("https://api.example.com/x"), "GET"),
    /not allowed/,
  );
});

test("production-looking hosts stay blocked even when allowed", () => {
  process.env.API_TESTER_ALLOWED_HOSTS = "api.prod.example.com";
  assert.throws(
    () => checkRequest(new URL("https://api.prod.example.com/x"), "GET"),
    /production/,
  );
  delete process.env.API_TESTER_ALLOWED_HOSTS;
});

test("writes to allowed remote hosts need a second switch", () => {
  process.env.API_TESTER_ALLOWED_HOSTS = "staging.example.com";
  assert.throws(
    () => checkRequest(new URL("https://staging.example.com/x"), "POST"),
    /blocked/,
  );
  assert.doesNotThrow(() =>
    checkRequest(new URL("https://staging.example.com/x"), "GET"),
  );
  delete process.env.API_TESTER_ALLOWED_HOSTS;
});
