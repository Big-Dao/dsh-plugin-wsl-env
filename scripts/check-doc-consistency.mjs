/**
 * Check that repeated facts agree across the user-facing docs (`lint:docs`).
 *
 * A cross-document audit found drift no other gate can see: the same remedy
 * missing a config value on some surfaces, flag synopses trailing the
 * doctor's real `--help` line, zh mirrors missing sections the other side
 * had grown, env vars documented far from their authority. Every sentence
 * reads fine on its own — only a side-by-side comparison catches the
 * disagreement. This script encodes the mechanical half of the docs map's
 * fact-authority table; the semantic half stays a review duty.
 *
 * Scope: the five bilingual user-doc pairs, CONTRIBUTING.md, and the shipped
 * `cordis.patch.yml` for value literals. `docs/archive/`, `docs/upstream/`
 * and the dated run records are historical material by the docs map's own
 * rule and stay out of scope.
 *
 * Rules:
 * - R1 config value sets — `key: value` literals for the plugin's own keys
 *   fall inside the sets CONFIGURATION.zh.md owns (authority: the 「会话
 *   沙箱」 and provider tables). `substrate: "share"` stays allowed as a
 *   literal because every doc that names it does so as the refused value.
 * - R2 doctor surface — every flag the doctor advertises in its `--help`
 *   line must appear verbatim in `scripts/doctor.mjs`, in both DIAGNOSTICS
 *   synopses, and in both CONFIGURATION doctor paragraphs.
 * - R3 env truth — every `DSH_*` name in scope must appear as a literal in
 *   `src/` or `scripts/`; a renamed variable must take its docs with it.
 * - R4 references — `pnpm run <name>` targets exist in `package.json`, and
 *   `scripts/<path>` references exist on disk.
 * - R5 pair integrity — both sides of each pair carry the same `## ` heading
 *   count (fence-aware), the same documentation-table rows (README pair) and
 *   the same first-cell config-key rows (CONFIGURATION pair). The docs map's
 *   authority rule says the zh side wins on content; this rule only asks the
 *   sides to stay complete.
 *
 *   node scripts/check-doc-consistency.mjs
 *
 * Runs from the package root (the npm script's cwd).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** zh side first: the docs map's authority rule orders the pairs this way. */
const PAIRS = [
  ["README.md", "docs/README.zh.md"],
  ["docs/QUICKSTART.md", "docs/QUICKSTART.zh.md"],
  ["docs/CONFIGURATION.md", "docs/CONFIGURATION.zh.md"],
  ["docs/LIMITATIONS.md", "docs/LIMITATIONS.zh.md"],
  ["docs/DIAGNOSTICS.md", "docs/DIAGNOSTICS.zh.md"],
  ["docs/COMPATIBILITY.md", "docs/COMPATIBILITY.zh.md"],
  ["docs/PERFORMANCE.md", "docs/PERFORMANCE.zh.md"],
  ["docs/MIGRATION.md", "docs/MIGRATION.zh.md"],
  ["docs/API.md", "docs/API.zh.md"],
  ["docs/ARCHITECTURE.md", "docs/ARCHITECTURE.zh.md"],
  ["docs/VALUE.md", "docs/VALUE.zh.md"],
  ["CONTRIBUTING.md", "CONTRIBUTING.zh.md"],
  ["SECURITY.md", "SECURITY.zh.md"],
  ["SUPPORT.md", "SUPPORT.zh.md"],
  ["CODE_OF_CONDUCT.md", "CODE_OF_CONDUCT.zh.md"],
];
const SCOPE_FILES = [...PAIRS.flat(), "CONTRIBUTING.md"];

/**
 * The value sets CONFIGURATION.zh.md owns, one entry per checked key. Values
 * are the names a doc may claim after `key:`; anything else is drift.
 * @type {Record<string, string[]>}
 */
const CONFIG_VALUE_SETS = {
  sessionSandbox: ["true", "false", "auto"],
  agentBackend: ["auto", "native", "shell"],
  // "share" appears only as the value the boot refuses; see R1's header.
  substrate: ["agent", "share"],
  interopVisibility: ["visible", "masked", "disabled"],
  loginShell: ["true", "false"],
  restrictToDistro: ["true", "false"],
  sandbox: ["true", "false"],
  maskWindowsDrive: ["true", "false"],
  startup: ["true", "false"],
  enabled: ["true", "false"],
};

/**
 * Fence-aware text: fenced blocks hold command examples, not claims, so
 * heading counts and key scans skip them.
 * @param {string} text - the whole file.
 * @returns {string} the text with fenced blocks removed.
 */
function stripFences(text) {
  return text
    .split("\n")
    .filter((_, index, lines) => {
      let inside = false;
      for (let i = 0; i <= index; i += 1) {
        if (/^\s*(```|~~~)/.test(lines[i])) inside = !inside;
      }
      return !inside;
    })
    .join("\n");
}

/** @type {string[]} */
const drifts = [];
const rel = (path) => path.slice(ROOT.length + 1);
const read = (path) => readFileSync(path, "utf8");
const report = (rule, detail) => drifts.push(`${rule}  ${detail}`);

// R1 — value literals stay inside the authority's sets. The docs wrap a
// literal in backticks and patch.yml writes it as a YAML line; only those
// two forms count. Bare prose ("session sandbox: set", "设为 `auto`") is
// not a literal and must not match — the first audit run proved why: both
// phrases exist in the docs and neither claims a value.
const mdLiteral = new RegExp(
  `\\\`\\b(${Object.keys(CONFIG_VALUE_SETS).join("|")}):\\s*["']?([A-Za-z]+)["']?\\\``,
  "g",
);
const yamlLiteral = new RegExp(
  `^\\s*(${Object.keys(CONFIG_VALUE_SETS).join("|")}):\\s*["']?([A-Za-z]+)["']?\\s*$`,
  "gm",
);
for (const name of SCOPE_FILES) {
  const text = read(join(ROOT, name));
  for (const match of text.matchAll(mdLiteral)) {
    const [key, value] = [match[1], match[2]];
    // `sandbox:policy` is the runtime-context entry name, not a config value.
    if (key === "sandbox" && value === "policy") continue;
    if (!CONFIG_VALUE_SETS[key].includes(value)) {
      report("R1", `${name}: \`${key}: ${value}\` is not a value CONFIGURATION.zh.md defines`);
    }
  }
}
{
  const text = read(join(ROOT, "cordis.patch.yml"));
  for (const match of text.matchAll(yamlLiteral)) {
    const [key, value] = [match[1], match[2]];
    if (!CONFIG_VALUE_SETS[key].includes(value)) {
      report("R1", `cordis.patch.yml: \`${key}: ${value}\` is not a value CONFIGURATION.zh.md defines`);
    }
  }
}

// R2 — the advertised surface is one line, and the docs that own it repeat
// it in full. A flag added to the doctor without taking its docs along,
// or a synopsis listing a flag the help no longer prints, both fail here.
const doctor = read(join(ROOT, "scripts", "doctor.mjs"));
// The header comment carries a shorter usage sketch; the `--help` one-liner
// is the console.log line, and that is the advertised surface.
const helpMatch = doctor.match(/console\.log\("node scripts\/doctor\.mjs \[distro\]([^"]+)"/);
if (helpMatch === null) {
  report("R2", "scripts/doctor.mjs: the `--help` one-liner was not found");
} else {
  const flags = [...helpMatch[1].matchAll(/--([a-z-]+)/g)].map((m) => `--${m[1]}`);
  const SURFACES = [
    "scripts/doctor.mjs",
    "docs/CONFIGURATION.md",
    "docs/CONFIGURATION.zh.md",
  ];
  for (const flag of flags) {
    for (const name of SURFACES) {
      if (!read(join(ROOT, name)).includes(flag)) {
        report("R2", `${name}: the advertised \`${flag}\` is missing`);
      }
    }
  }
  // The DIAGNOSTICS synopses are checked line-scoped, not with a whole-file
  // includes: the audit's finding was a synopsis that trailed the help line
  // while the body still described the same flags, which includes() cannot
  // see. Only the synopsis line counts — the docs body legitimately names
  // other tools' flags (`--profile`, `--include-fs`).
  for (const name of ["docs/DIAGNOSTICS.md", "docs/DIAGNOSTICS.zh.md"]) {
    const line = read(join(ROOT, name))
      .split("\n")
      .find((l) => l.includes("scripts/doctor.mjs [distro]"));
    if (line === undefined) {
      report("R2", `${name}: the CLI synopsis line was not found`);
      continue;
    }
    for (const flag of flags) {
      if (!line.includes(flag)) {
        report("R2", `${name}: the synopsis is missing the advertised \`${flag}\``);
      }
    }
    for (const m of line.matchAll(/--([a-z-]+)/g)) {
      if (!flags.includes(`--${m[1]}`)) {
        report("R2", `${name}: the synopsis advertises \`--${m[1]}\`, which the doctor does not print`);
      }
    }
  }
}

// R3 — every DSH_* name the docs use must exist in code. Scanning the whole
// src/ and scripts/ trees keeps the truth set derivation-free: a variable
// renamed in code fails here until its doc mentions follow.
const truthVars = new Set();
for (const dir of ["src", "scripts"]) {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (!/\.(ts|mjs|sh)$/.test(entry.name)) continue;
    const text = read(join(ROOT, dir, entry.name));
    for (const m of text.matchAll(/DSH_[A-Z_]+/g)) truthVars.add(m[0]);
  }
}
for (const name of SCOPE_FILES) {
  const text = read(join(ROOT, name));
  for (const m of text.matchAll(/DSH_[A-Z_]+/g)) {
    if (!truthVars.has(m[0])) {
      report("R3", `${name}: \`${m[0]}\` appears nowhere in src/ or scripts/`);
    }
  }
}

// R4 — runnable references stay runnable.
const pkgScripts = Object.keys(JSON.parse(read(join(ROOT, "package.json"))).scripts);
for (const name of SCOPE_FILES) {
  const text = read(join(ROOT, name)).replace(/`/g, "");
  for (const m of text.matchAll(/(?:pnpm|npm) run ([a-z0-9:._-]+)/g)) {
    // Sentence punctuation can follow a command; a package script never ends in a dot.
    const target = m[1].replace(/\.+$/, "");
    if (!pkgScripts.includes(target)) {
      report("R4", `${name}: \`pnpm run ${target}\` is not a package.json script`);
    }
  }
  for (const m of text.matchAll(/scripts\/[A-Za-z0-9._/-]+\.(?:mjs|sh|ps1)/g)) {
    if (!existsSync(join(ROOT, m[0]))) {
      report("R4", `${name}: \`${m[0]}\` does not exist`);
    }
  }
}

// R5 — the pairs stay complete against each other.
const headingCount = (text) => stripFences(text).match(/^## /gm)?.length ?? 0;
for (const [en, zh] of PAIRS) {
  const enText = read(join(ROOT, en));
  const zhText = read(join(ROOT, zh));
  const [enHeadings, zhHeadings] = [headingCount(enText), headingCount(zhText)];
  if (enHeadings !== zhHeadings) {
    report("R5", `${en} / ${zh}: ${enHeadings} vs ${zhHeadings} \`##\` headings`);
  }
}

// The README pair's documentation table: the link basenames must match, so
// adding a row on one side without the other fails.
const sectionRows = (text, header) => {
  const start = text.indexOf(header);
  if (start === -1) return null;
  const section = text.slice(start).split("\n## ", 1)[0];
  // A bilingual pair names the same document in the reader's language; compare
  // the logical target so `X.zh.md` and `X.md` count as the same row.
  return [...section.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1].split("/").pop().replace(/\.zh\.md$/, ".md"));
};
const readmeDocRows = (file) => {
  const text = stripFences(read(join(ROOT, file)));
  return sectionRows(text, "## Documentation") ?? sectionRows(text, "## 文档");
};
const [enRows, zhRows] = [readmeDocRows(PAIRS[0][0]), readmeDocRows(PAIRS[0][1])];
if (enRows === null || zhRows === null) {
  report("R5", "README pair: the documentation table section was not found");
} else {
  const sorted = (rows) => [...rows].sort().join(",");
  if (sorted(enRows) !== sorted(zhRows)) {
    report("R5", "README pair: documentation-table rows differ");
  }
}

// The CONFIGURATION pair's first-cell keys: every table row whose first cell
// is a backticked name. A key documented on one side only fails here.
const configKeys = (file) =>
  [...stripFences(read(join(ROOT, file))).matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map(
    (m) => m[1],
  );
const [enKeys, zhKeys] = PAIRS[2].map(configKeys);
if ([...enKeys].sort().join(",") !== [...zhKeys].sort().join(",")) {
  const onlyEn = enKeys.filter((k) => !zhKeys.includes(k));
  const onlyZh = zhKeys.filter((k) => !enKeys.includes(k));
  const detail = [
    onlyEn.length > 0 && `EN only: ${[...new Set(onlyEn)].join(", ")}`,
    onlyZh.length > 0 && `zh only: ${[...new Set(onlyZh)].join(", ")}`,
  ]
    .filter(Boolean)
    .join("; ");
  report("R5", `CONFIGURATION pair: first-cell keys differ (${detail})`);
}

for (const line of drifts) console.log(`DRIFT  ${line}`);
console.log(
  `doc consistency: ${SCOPE_FILES.length + 1} files, ${PAIRS.length} pairs, ` +
    `${drifts.length} drift(s)`,
);
process.exit(drifts.length === 0 ? 0 : 1);
