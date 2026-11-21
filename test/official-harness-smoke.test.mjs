import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
assert.equal(
  packageJson.scripts["smoke:official-harness"],
  "node scripts/official-harness-smoke.mjs",
);

const script = readFileSync(
  new URL("../scripts/official-harness-smoke.mjs", import.meta.url),
  "utf8",
);
assert.match(script, /DSH_OFFICIAL_HARNESS_VERSION/);
assert.match(script, /DSH_PLUGIN_PACKAGE_TARBALL/);
assert.match(script, /dsh-plugin-wsl-env@/);
assert.doesNotMatch(script, /npm install dsh-plugin-wsl-env$/m);
