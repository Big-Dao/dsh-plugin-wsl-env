/**
 * Fail unless the git tag being built is exactly `v<package.json version>`,
 * and print the npm dist-tag that version publishes under.
 *
 *   node scripts/check-release-tag.mjs v0.1.2
 *   node scripts/check-release-tag.mjs --dist-tag
 *
 * The workflow calls the first form with `$GITHUB_REF_NAME`; the manual release path in
 * docs/RELEASING.md calls it with the tag about to be pushed. Tagging one version
 * and publishing another is the mistake this exists to make impossible. The same
 * form also refuses a version that is not `MAJOR.MINOR.PATCH` with an optional
 * `-prerelease`: a tag can match such a version exactly and still be something
 * no release step knows how to handle.
 *
 * The second form prints `next` for a prerelease and `latest` otherwise. The
 * dist-tag policy lives here rather than in a list of "known" prerelease
 * identifiers in the workflow: `0.30.0-preview.1` is a valid prerelease, and
 * under such a list it moved `latest`.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));

/**
 * A release version: `MAJOR.MINOR.PATCH` without leading zeros, an optional
 * prerelease of dot-separated alphanumeric identifiers, and no build metadata
 * (the registry does not accept it in a published version).
 */
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/u;

/**
 * Whether a string is a version a release can be built from.
 * @param {string} version - the candidate, as `package.json` spells it.
 * @returns {boolean} true for `1.2.3`, `0.30.0-rc.1`, `1.0.0-preview.1`.
 */
export function isReleaseVersion(version) {
  return RELEASE_VERSION.test(version);
}

/**
 * Whether a release version carries a prerelease segment.
 * @param {string} version - a version {@link isReleaseVersion} accepts.
 * @returns {boolean} true for anything with a `-prerelease`.
 */
export function isPrerelease(version) {
  return isReleaseVersion(version) && version.includes("-");
}

/**
 * The npm dist-tag a version publishes under. A prerelease must never move
 * `latest`, and "prerelease" is the semver definition — any `-segment` — not
 * a list of identifiers somebody remembered.
 * @param {string} version - a version {@link isReleaseVersion} accepts.
 * @returns {"latest" | "next"} the dist-tag.
 * @throws {Error} when the version is not a release version.
 */
export function distTagFor(version) {
  if (!isReleaseVersion(version)) throw new Error(`${JSON.stringify(version)} is not a release version (MAJOR.MINOR.PATCH with an optional -prerelease)`);
  return isPrerelease(version) ? "next" : "latest";
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] ?? "";
  if (tag === "--dist-tag") {
    try {
      console.log(distTagFor(String(pkg.version)));
    } catch (error) {
      console.error(`FAIL  package.json version ${/** @type {Error} */ (error).message}`);
      process.exitCode = 1;
    }
  } else if (tag === "") {
    console.error("usage: node scripts/check-release-tag.mjs <tag> | --dist-tag");
    process.exitCode = 2;
  } else if (tag !== `v${pkg.version}`) {
    console.error(`FAIL  tag ${tag} does not match package.json version ${pkg.version}`);
    process.exitCode = 1;
  } else if (!isReleaseVersion(String(pkg.version))) {
    console.error(`FAIL  package.json version ${pkg.version} is not a release version (MAJOR.MINOR.PATCH with an optional -prerelease)`);
    process.exitCode = 1;
  } else {
    console.log(`PASS  tag ${tag} matches ${pkg.name}@${pkg.version}`);
  }
}
