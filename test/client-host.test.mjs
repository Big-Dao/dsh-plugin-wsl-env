// client-host.test.mjs — the root host half is a deliberate no-op.
//
// `lib/client-host.js` exists to anchor the bare-name Loader row whose
// manifest the web client roster reads to serve `./client`. It must stay a
// no-op: mounted at the composition root it must not register services,
// preload anything, or shadow the shipped host shell. These checks pin that
// contract — they also keep the module inside the coverage gate.

import assert from "node:assert/strict";
import test from "node:test";

import { apply } from "../lib/client-host.js";

test("apply is a no-op: it returns nothing and stays silent", () => {
  const result = apply();
  assert.equal(result, undefined);
});

test("the module surface is exactly the apply function", async () => {
  const exported = Object.keys(await import("../lib/client-host.js"));
  assert.deepEqual(exported.sort(), ["apply"]);
});
