#!/usr/bin/env node
// Coverage audit for the public @stellar/stellar-sdk surface.
//
// Answers one question: does every symbol that is NEW in the installed version
// have a behavior test? New symbols are found by diffing the live runtime
// surface against reports/surface-inventory.json -- the changelog is a hint, not
// the source of truth, so nothing here reads it.
//
// Surface-lock files are excluded from reference counting on purpose: a symbol
// listed in sdk-api-surface or sdk-method-surface is only asserted to *exist*.
// Existence is not behavior.
//
// Usage, from the repo root:
//   node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs
//   node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs --update-inventory
//
// Exit codes: 0 = no blocking gaps, 1 = new symbols lack behavior tests,
// 2 = the audit could not run (bad cwd, missing SDK).
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO = process.cwd();
const INVENTORY = resolve(REPO, "reports/surface-inventory.json");
const EXCLUSIONS = resolve(REPO, "reports/coverage-exclusions.json");
const TESTS_DIR = resolve(REPO, "tests");
const SDK = resolve(REPO, "node_modules/@stellar/stellar-sdk");

// Files that assert a symbol exists rather than exercising it.
const LOCK_FILES = new Set(["sdk-api-surface.test.ts", "sdk-method-surface.test.ts"]);

// Entry points whose symbols are inventoried. Keep this aligned with the
// package's `exports` map -- see EXPECTED_SUBPATHS below, which fails the audit
// if the SDK adds a subpath nobody has classified. A subpath belongs here only
// if it contributes symbols the other entry points do not already expose;
// mirrors are listed as MIRRORED_SUBPATHS instead so the count is not doubled.
const ENTRY_POINTS = [
  ["", "lib/esm/index.js"],
  ["contract.", "lib/esm/contract/index.js"],
  ["rpc.", "lib/esm/rpc/index.js"],
  ["httpClient.", "lib/esm/http-client/axios.js"],
];

// Declared subpaths that expose no symbol the ENTRY_POINTS above do not already
// cover, with the reason each is redundant. Resolution of all of them is tested
// separately in tests/sdk-package-entrypoints.test.ts -- being redundant for
// symbol counting is not the same as being untested.
const MIRRORED_SUBPATHS = {
  "./base": "subset of the root export (protocol layer without network clients)",
  "./axios": "same surface as the root, wired to the axios HTTP client",
  "./axios/contract": "same surface as ./contract",
  "./axios/rpc": "same surface as ./rpc",
};

// Every subpath the package is expected to declare. The audit fails if the SDK
// adds or removes one, because an unclassified subpath is surface nobody is
// measuring -- which is exactly how ./http-client/axios went unnoticed until it
// was found by hand. Classify a new entry as an ENTRY_POINT or a MIRROR.
const EXPECTED_SUBPATHS = [
  ".",
  "./base",
  "./contract",
  "./rpc",
  "./axios",
  "./axios/contract",
  "./axios/rpc",
  "./http-client/axios",
];

function die(message) {
  console.error(`coverage-audit: ${message}`);
  process.exit(2);
}

if (!existsSync(resolve(REPO, "package.json")) || !existsSync(TESTS_DIR)) {
  die("run this from the repo root (package.json and tests/ not found)");
}
if (!existsSync(SDK)) die("@stellar/stellar-sdk is not installed -- run pnpm install first");

const sdkPackageJson = JSON.parse(readFileSync(resolve(SDK, "package.json"), "utf8"));
const sdkVersion = sdkPackageJson.version;

/**
 * Guards against surface that nobody is measuring. The symbol inventory only
 * walks ENTRY_POINTS; if the package declares a subpath that is neither an entry
 * point nor a recorded mirror, its symbols are invisible to every number this
 * script prints. Blocking is the right response -- a silent undercount reads as
 * "fully covered" when it is not.
 */
function auditExportsMap() {
  const declared = Object.keys(sdkPackageJson.exports ?? {}).sort();
  const expected = [...EXPECTED_SUBPATHS].sort();

  const added = declared.filter((s) => !expected.includes(s));
  const removed = expected.filter((s) => !declared.includes(s));

  if (added.length === 0 && removed.length === 0) {
    return { ok: true, declared };
  }

  console.log(`\n!! EXPORTS MAP DRIFT — ${declared.length} subpaths declared, ${expected.length} classified`);
  for (const s of added) {
    console.log(`     NEW  ${s}  <-- unclassified: its symbols are NOT being counted`);
  }
  for (const s of removed) {
    console.log(`     GONE ${s}  <-- breaking change for anyone importing it`);
  }
  console.log("   Classify each new subpath in coverage-audit.mjs as an ENTRY_POINT");
  console.log("   (it exposes symbols nothing else does) or a MIRRORED_SUBPATH (it does not),");
  console.log("   and add it to tests/sdk-package-entrypoints.test.ts.");
  return { ok: false, declared };
}

/** Enumerate the live public surface as sorted qualified paths. */
async function liveSurface() {
  const found = new Map(); // qualified path -> bare name

  const add = (qualified, bare) => {
    // Underscore-prefixed members are private by convention; not coverage targets.
    if (bare.startsWith("_")) return;
    if (!/^[A-Za-z$][\w$]*$/.test(bare)) return;
    found.set(qualified, bare);
  };

  for (const [prefix, rel] of ENTRY_POINTS) {
    const path = resolve(SDK, rel);
    if (!existsSync(path)) die(`entry point missing: ${rel}`);
    const mod = await import(path);

    for (const key of Object.keys(mod)) {
      if (key === "__esModule" || key === "default") continue;
      add(prefix + key, key);

      const value = mod[key];
      if (typeof value !== "function") continue;

      for (const s of Object.getOwnPropertyNames(value)) {
        if (["length", "name", "prototype"].includes(s)) continue;
        if (typeof value[s] === "function" || value[s] !== undefined) add(`${prefix}${key}.${s}`, s);
      }
      const proto = value.prototype;
      if (proto === undefined || proto === null) continue;
      for (const m of Object.getOwnPropertyNames(proto)) {
        if (m === "constructor") continue;
        add(`${prefix}${key}#${m}`, m);
      }
    }
  }
  return found;
}

/** Test corpus split by whether the file is a surface lock. */
function testCorpus() {
  let behavior = "";
  let locks = "";
  for (const f of readdirSync(TESTS_DIR)) {
    if (!f.endsWith(".test.ts")) continue;
    const body = readFileSync(resolve(TESTS_DIR, f), "utf8");
    if (LOCK_FILES.has(f)) locks += `\n${body}`;
    else behavior += `\n${body}`;
  }
  return { behavior, locks };
}

const surface = await liveSurface();
const { behavior, locks } = testCorpus();

// Word-boundary match. This is triage, not proof: short names can collide, and a
// symbol can be exercised indirectly without ever being named. Treat a reported
// gap as "needs a human look", not "definitely untested".
const mentions = (name, text) => new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(text);

if (process.argv.includes("--update-inventory")) {
  const payload = {
    _comment:
      "Mechanically generated by coverage-audit.mjs --update-inventory. Never hand-edit. Diffing the live surface against this is how new symbols are found.",
    sdkVersion,
    generated: new Date().toISOString().slice(0, 10),
    symbols: [...surface.keys()].sort(),
  };
  writeFileSync(INVENTORY, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${INVENTORY}`);
  console.log(`  ${payload.symbols.length} symbols at SDK ${sdkVersion}`);
  process.exit(0);
}

let previous = null;
if (existsSync(INVENTORY)) {
  previous = JSON.parse(readFileSync(INVENTORY, "utf8"));
}

// Deliberate non-coverage, each with a recorded reason. Subtracted from both the
// blocking and backlog counts so the gap can legitimately reach zero.
const excluded = new Map(); // qualified path -> reason
if (existsSync(EXCLUSIONS)) {
  const parsed = JSON.parse(readFileSync(EXCLUSIONS, "utf8"));
  for (const entry of parsed.exclusions ?? []) {
    if (!entry.reason) die(`every exclusion needs a reason: ${JSON.stringify(entry.symbols)}`);
    for (const symbol of entry.symbols ?? []) excluded.set(symbol, entry.reason);
  }
}

const stale = [...excluded.keys()].filter((q) => !surface.has(q));

const classify = (qualified) => {
  const bare = surface.get(qualified);
  if (mentions(bare, behavior)) return "covered";
  return mentions(bare, locks) ? "existence-only" : "unreferenced";
};

console.log(`SDK ${sdkVersion} — ${surface.size} public symbols`);

const exportsMap = auditExportsMap();
console.log(
  `Entry points inventoried: ${ENTRY_POINTS.length} of ${exportsMap.declared.length} declared subpaths ` +
    `(${Object.keys(MIRRORED_SUBPATHS).length} mirrored, resolution tested in tests/sdk-package-entrypoints.test.ts)`,
);

if (previous === null) {
  console.log("\nNo reports/surface-inventory.json yet, so nothing can be called new.");
  console.log("Run with --update-inventory to snapshot the current surface first.");
} else {
  console.log(`Inventory baseline: SDK ${previous.sdkVersion} (${previous.symbols.length} symbols)`);
}

const known = new Set(previous?.symbols ?? [...surface.keys()]);
const added = [...surface.keys()].filter((q) => !known.has(q)).sort();
const removed = [...known].filter((q) => !surface.has(q)).sort();

// --- Removals: breaking, and never a coverage question. ---
if (removed.length > 0) {
  console.log(`\n!! REMOVED FROM PUBLIC SURFACE (${removed.length}) — breaking change:`);
  for (const q of removed) console.log(`     ${q}`);
}

// --- New symbols: the blocking bucket. Exclusions do not block. ---
const newUncovered = added.filter((q) => !excluded.has(q) && classify(q) !== "covered");
const newCovered = added.filter((q) => classify(q) === "covered");

console.log(`\nNew since inventory: ${added.length}`);
if (added.length > 0) {
  for (const q of added) {
    if (excluded.has(q)) {
      console.log(`  skip ${q}  (excluded: ${excluded.get(q)})`);
      continue;
    }
    const state = classify(q);
    const mark = state === "covered" ? "ok  " : "GAP ";
    console.log(`  ${mark} ${q}${state === "existence-only" ? "  (surface lock only)" : ""}`);
  }
}

// --- Pre-existing backlog: informational only. ---
const backlog = [...surface.keys()].filter(
  (q) => known.has(q) && !excluded.has(q) && classify(q) !== "covered",
);
const unreferenced = backlog.filter((q) => classify(q) === "unreferenced").length;
console.log(
  `\nPre-existing backlog (not blocking): ${backlog.length} symbols without behavior tests ` +
    `(${unreferenced} unreferenced, ${backlog.length - unreferenced} surface-lock only)`,
);
if (process.argv.includes("--list-backlog")) {
  for (const q of backlog.sort()) console.log(`     ${q}`);
}

// --- Upstream cross-reference: which backlog symbols js-stellar-sdk already tests. ---
// Duplicating upstream unit tests adds little: it tests src/ for implementation
// correctness, this repo tests the published artifact for end-user exposure. The
// symbols with NO upstream test are the ones worth writing here. See README
// "Adding tests" and ISSUES.md issue 7.
if (process.argv.includes("--vs-upstream")) {
  const flag = process.argv.find((a) => a.startsWith("--upstream="));
  const candidate =
    (flag === undefined ? undefined : flag.slice("--upstream=".length)) ??
    process.env.STELLAR_SDK_REPO ??
    resolve(REPO, "../js-stellar-sdk");
  const upstreamTests = resolve(candidate, "test");

  if (!existsSync(upstreamTests)) {
    // Never fail the audit for this: the checkout is optional and machine-specific.
    console.log(`\nUpstream cross-reference: SKIPPED — no test/ directory at ${upstreamTests}`);
    console.log("  Pass --upstream=<path to js-stellar-sdk> or set STELLAR_SDK_REPO.");
  } else {
    let corpus = "";
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        // Skip vendored deps and agent worktrees, which would double-count.
        if (entry === "node_modules" || entry === "worktrees") continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|js|mjs|cjs)$/.test(entry)) corpus += `\n${readFileSync(path, "utf8")}`;
      }
    };
    walk(upstreamTests);

    const bare = (q) => q.split(/[#.]/).pop();
    const noUpstream = backlog.filter((q) => !mentions(bare(q), corpus)).sort();

    console.log(`\nUpstream cross-reference against ${upstreamTests}`);
    console.log(`  backlog                  : ${backlog.length}`);
    console.log(`  has some upstream test   : ${backlog.length - noUpstream.length}  (deprioritized)`);
    console.log(`  NO upstream test         : ${noUpstream.length}  <-- write these first`);
    for (const q of noUpstream) console.log(`       ${q}`);
    console.log("  Same name-matching caveat applies in both directions; confirm by opening the test.");
  }
}

// --- Exclusions: deliberate non-coverage, each with a recorded reason. ---
console.log(`\nDeliberately excluded: ${excluded.size} (see reports/coverage-exclusions.json)`);
if (stale.length > 0) {
  // An exclusion for a symbol that no longer exists is dead config that quietly widens over time.
  console.log(`  !! ${stale.length} exclusion(s) name symbols not in the current surface — prune them:`);
  for (const q of stale) console.log(`       ${q}`);
}

console.log("\nHeuristic: word-boundary name matching, surface-lock files excluded.");
console.log("Short names can collide and indirect use is invisible — verify each gap by reading the test.");

if (!exportsMap.ok) {
  console.log("\nRESULT: the package declares a subpath this audit does not classify.");
  process.exit(1);
}
if (newUncovered.length > 0) {
  console.log(`\nRESULT: ${newUncovered.length} new symbol(s) without a behavior test.`);
  process.exit(1);
}
console.log(`\nRESULT: no new symbols lack behavior tests (${newCovered.length} new, all covered).`);
process.exit(0);
