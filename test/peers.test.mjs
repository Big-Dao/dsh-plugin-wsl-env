/**
 * Peer-declaration check for the linked-plugin loader.
 *
 * `dsh-app-boot`'s runtime interception only routes a linked plugin's bare
 * import to the installation package when the plugin's OWN manifest lists that
 * name under `peerDependencies` (`readPeerNames` / `routeLinked`). A missing
 * entry therefore does not degrade to "not installed": the import fails with
 * `ERR_MODULE_NOT_FOUND`, the entry does not activate, and the Desktop host
 * can take the process down with it. Assert every bare specifier the built
 * `lib/` imports is declared, so a new runtime import cannot ship undeclared.
 *
 *   node test/peers.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const LIB = join(ROOT, "lib");

/** @type {{ dependencies?: Record<string, string>, peerDependencies?: Record<string, string> }} */
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const declared = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);

/**
 * The package a bare specifier belongs to: `@scope/name/deep` -> `@scope/name`,
 * `name/deep` -> `name`.
 * @param {string} specifier - a bare import specifier.
 * @returns {string} its package name.
 */
const packageName = (specifier) => {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) return parts.slice(0, 2).join("/");
  return parts[0] ?? specifier;
};

/** @type {Array<{ file: string, specifier: string }>} */
const missing = [];
for (const file of readdirSync(LIB).filter((name) => name.endsWith(".js"))) {
  const source = readFileSync(join(LIB, file), "utf8");
  const patterns = [
    /^import\b.*\bfrom\s+"([^"]+)"/u,
    /^export\b.*\bfrom\s+"([^"]+)"/u,
    /^\}\s*from\s+"([^"]+)"/u,
    /^import\s+"([^"]+)"/u,
    /\bimport\s*\(\s*"([^"]+)"/u,
  ];
  for (const line of source.split("\n")) {
    const code = line.trimStart();
    if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) continue;
    for (const pattern of patterns) {
      const match = pattern.exec(code);
      const specifier = match?.[1];
      if (specifier === undefined) continue;
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      if (!declared.has(packageName(specifier))) missing.push({ file, specifier });
    }
  }
}

assert.deepEqual(
  missing,
  [],
  `lib/ imports packages missing from package.json dependencies/peerDependencies: ${missing
    .map(({ file, specifier }) => `${specifier} (${file})`)
    .join(", ")}. A linked plugin only gets these routed when its own manifest declares them.`,
);

console.log(`PASS  ${readdirSync(LIB).filter((name) => name.endsWith(".js")).length} lib modules import only declared packages`);
