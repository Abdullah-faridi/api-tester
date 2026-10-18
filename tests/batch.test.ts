import test from "node:test";
import assert from "node:assert";
import {
  findId,
  findToken,
  fillTemplate,
  pickPath,
} from "../src/runner/batch.js";

test("findId finds a top-level or nested id", () => {
  assert.equal(findId({ id: 5 }), 5);
  assert.equal(findId({ post: { id: "abc" } }), "abc");
  assert.equal(findId({ nothing: true }), undefined);
});

test("findToken finds common token fields", () => {
  assert.equal(findToken({ token: "t1" }), "t1");
  assert.equal(findToken({ data: { accessToken: "t2" } }), "t2");
  assert.equal(findToken({ refreshToken: "r" }), undefined);
});

test("fillTemplate replaces placeholders and reports missing ones", () => {
  const missing = new Set<string>();
  const out = fillTemplate(
    { url: "/posts/{{id}}", n: "{{count}}", x: "{{nope}}" },
    { id: 7, count: 3 },
    missing,
  );
  assert.deepEqual(out, { url: "/posts/7", n: 3, x: "{{nope}}" });
  assert.deepEqual([...missing], ["nope"]);
});

test("pickPath reads nested values", () => {
  assert.equal(pickPath({ body: { data: { id: 9 } } }, "body.data.id"), 9);
});
