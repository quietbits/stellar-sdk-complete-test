# Stellar JS SDK Multi-Runtime / Multi-Package-Manager Test Harness

## Purpose

**This repo exists to fully test the end-user experience of `@stellar/stellar-sdk`.**

The subject under test is the **published npm package**, consumed the way a real application consumes it: installed from the registry, reached only through its public API, on the runtimes and package managers users actually have. Everything here follows from that.

It is **not** a replacement for the SDK's own test suite. [`js-stellar-sdk`](https://github.com/stellar/js-stellar-sdk) has roughly 125 unit and e2e test files covering `src/` for implementation correctness. That is a different subject, and duplicating it adds little:

| | `js-stellar-sdk/test/` | this repo |
|--|------------------------|-----------|
| Subject | `src/` TypeScript source | the published npm artifact |
| Reach | internal APIs, can construct any input | public API only, as a consumer |
| Runtimes | one | Node, Deno, Bun |
| Install layouts | one | npm, pnpm, Yarn classic, Yarn Berry (PnP) |

Where this harness earns its keep is precisely where a consumer is exposed and upstream is not looking: malformed or hostile input through public decoders, packaging and module-format behavior, cross-runtime differences, and API surface upstream has no test for. Every SDK defect found here so far came from one of those categories — see [ISSUES.md](ISSUES.md).

## Test axes

1. **Runtime axis** — does the SDK *run* correctly? The same test suite executes natively on **Node**, **Deno**, and **Bun**.
2. **Package-manager axis** — does the SDK *install and resolve* correctly under **npm**, **pnpm**, **Yarn classic**, and **Yarn Berry (PnP)**?
3. **Browser axis** — do all four published UMD artifacts attach their global and perform crypto, XDR, and HTTP in real Chrome?
4. **CLI/artifact coverage** — does the installed `stellar-js` binary generate usable bindings, and do every declared export, bin target, and browser artifact ship?

These are orthogonal: the runtime axis catches execution differences (Buffer, crypto, `fetch`, XDR), the package-manager axis catches dependency-resolution differences (hoisted `node_modules`, symlinked store, Plug'n'Play).

## Adding tests

Before writing a test, check whether [`js-stellar-sdk/test/`](https://github.com/stellar/js-stellar-sdk/tree/main/test) already covers it. If it does, and the behavior is a pure function with no packaging or runtime dimension, the marginal value here is low — `StrKey.encodeContract` cannot behave differently on Bun than on Node.

The audit does this cross-reference for you:

```bash
node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs --vs-upstream
# defaults to ../js-stellar-sdk; override with --upstream=<path> or STELLAR_SDK_REPO
```

It splits the backlog into *already covered upstream* and *no upstream test*, and skips cleanly if you have no upstream checkout. At 16.2.0 that split is 132 / 28 — most of the remaining backlog is already tested upstream.

Prioritize, highest value first:

1. **Public API with no upstream test at all.** `contract.Err`/`Ok`, `Config`, and `Utils` were in this category, and one of them yielded a finding.
2. **Malformed or hostile input** through public decoders and parsers. Upstream is structurally weak here because its tests construct valid inputs through internal APIs first.
3. **Packaging and module format** — no upstream equivalent, and the highest-severity finding so far lived here.
4. **Cross-runtime divergence** in anything touching `Buffer`, crypto, `fetch`, or XDR.

The coverage backlog count reported by the audit is a **progress signal, not a target**; a nonzero backlog is not a defect. See [ISSUES.md](ISSUES.md) issue 7 for the full reasoning.

## Layout

```
.
├── tests/                       # RUNTIME AXIS — one suite, three runtimes
│   ├── helpers/
│   │   ├── assert.ts            #   Vitest-style expect() shim over node:assert
│   │   └── server.ts            #   real loopback HTTP server (not interception)
│   ├── sdk-api-surface.test.ts  #   exported public API surface
│   ├── sdk-method-surface.test.ts
│   ├── sdk-core-behavior.test.ts
│   ├── sdk-xdr.test.ts          #   XDR encode/decode coverage
│   ├── sdk-snapshots.test.ts    #   deterministic golden values
│   ├── sdk-domain-services.test.ts  # WebAuth / Federation / StellarToml
│   ├── sdk-sep53.test.ts        #   SEP-53 signMessage/verifyMessage, spec vectors
│   ├── sdk-new-api-behavior.test.ts # signer, submit error, auth inspection
│   ├── sdk-dynamic-imports.test.ts  # getContractInstance / SAC lazy import
│   ├── sdk-strkey.test.ts       #   SEP-23 vectors, incl. hostile input
│   ├── sdk-numbers.test.ts      #   XdrLargeInt / ScInt / Int128…Uint256
│   ├── sdk-claimant.test.ts     #   claim predicates
│   ├── sdk-contract-result.test.ts  # contract.Ok / contract.Err
│   ├── sdk-config-helpers.test.ts   # Config, Utils, scvSortedMap
│   ├── sdk-signature-base.test.ts   # TransactionBase + signatureBase
│   ├── sdk-contract-spec.test.ts    # contract.Spec type conversion
│   ├── sdk-contract-assembly.test.ts # AssembledTransaction / SentTransaction / Watcher
│   ├── sdk-rpc-errors.test.ts   #   NetworkError, sleep strategies, rpc.Server
│   ├── sdk-package-entrypoints.test.ts # exports-map subpaths, ESM + CJS
│   ├── sdk-package-artifacts.test.ts # exports, bin and dist artifact inventory
│   ├── sdk-cli.test.ts          # installed CLI + generated bindings workflow
│   ├── sdk-umd-bundle.test.ts   #   UMD dist/ bundle artifact (Node-only)
│   ├── sdk-live-http.test.ts    #   HTTP parse/error paths via loopback server
│   └── sdk-live-network.test.ts #   genuinely live testnet calls
│
├── browser-tests/               # BROWSER AXIS — real Chrome, published UMD globals
│   └── sdk-browser-bundles.test.mjs
│
├── package-managers/            # PACKAGE-MANAGER AXIS — install sandboxes
│   ├── npm/         package.json + smoke.test.mjs
│   ├── pnpm/        package.json + smoke.test.mjs
│   ├── yarn-classic/ package.json + smoke.test.mjs
│   └── yarn-berry/  package.json + .yarnrc.yml (PnP) + smoke.test.mjs
│
├── reports/                     # one committed report per tested SDK version
│   ├── TEMPLATE.md              #   the required report format
│   ├── baseline.json            #   expected results + known-failing tests
│   ├── surface-inventory.json   #   known public API surface (generated)
│   ├── coverage-exclusions.json #   symbols deliberately not covered, with reasons
│   └── <version>.md             #   e.g. 16.2.0.md
│
├── .claude/skills/
│   └── test-latest-sdk/         # /test-latest-sdk — the full release-test run
│       ├── SKILL.md
│       └── scripts/
│           └── coverage-audit.mjs   # new-symbol coverage gaps
│
├── scripts/
│   ├── test-runtimes.sh         # runs all three runtimes, reports each (test:all)
│   └── test-pms.sh              # installs + runs each package-manager sandbox
├── CLAUDE.md                    # repo purpose + rules for adding tests
├── deno.json                    # Deno test task / node_modules resolution
├── tsconfig.json
└── package.json
```

## Prerequisites

| Tool | Used for | Install |
|------|----------|---------|
| Node ≥ 22.18 | `test:node` (needs native TS type-stripping) | system |
| Deno ≥ 2.x | `test:deno` | `curl -fsSL https://deno.land/install.sh \| sh` |
| Bun ≥ 1.x | `test:bun` | `curl -fsSL https://bun.sh/install \| bash` |
| npm / pnpm / yarn / corepack | package-manager axis | system / `corepack enable` |
| Google Chrome / Chromium | browser axis | system or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` |

Install dependencies for the runtime axis once: `pnpm install` (or `npm install`).

## Running

### Testing a new SDK release (recommended)

This repo ships a skill that runs the whole thing end to end:

```text
/test-latest-sdk
```

It resolves the latest published version and **stops for your confirmation**, reviews the changelog for the versions being crossed, pins the target version, installs clean, runs every consumer axis unmodified, diffs the outcome against `reports/baseline.json`, audits whether every newly added SDK API has a behavior test, writes `reports/<version>.md`, and **stops to ask** how to address anything new. It never modifies an existing test to make a run pass.

The coverage audit works from the code rather than the changelog: it enumerates the live public surface, diffs it against `reports/surface-inventory.json` to find what is genuinely new, and checks each new symbol for a behavior test — surface locks don't count, since they only assert a symbol exists. Run it on its own with:

```bash
node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs   # add --list-backlog for pre-existing gaps
```

Requires Claude Code in this directory; the skill lives in `.claude/skills/test-latest-sdk/` and is committed, so it behaves the same for everyone. The sections below are the same steps run by hand.

### Runtime axis

```bash
npm run test:node    # node --test
npm run test:deno    # deno test --no-check
npm run test:bun     # bun test
npm run test:all     # all three, each reported even if an earlier one fails
```

`test:all` deliberately does **not** chain the three with `&&`. The surface locks are red until v17 by design ([ISSUES.md](ISSUES.md) issue 4), so Node always exits non-zero; a `&&` chain would stop there and silently never run Deno or Bun. It runs all three, prints a per-runtime summary, and exits non-zero if any failed — the same shape as `test:pm`.

Live network tests (`sdk-live-network.test.ts`) hit Stellar **testnet**. Skip them in an offline environment:

```bash
STELLAR_LIVE=0 npm run test:node
```

### Package-manager axis

```bash
npm run test:pm      # installs the SDK under each manager and runs the smoke test
```

Each sandbox checks ESM/CJS resolution and invokes its own installed `stellar-js` binary. The two checks run independently, so a module failure cannot hide a CLI failure.

### Browser axis

```bash
npm run test:browser # all standard/axios, minified/unminified UMD bundles in Chrome
```

The browser test loads each artifact through a real `<script>` element and exercises the `globalThis.StellarSdk` API with signing, XDR conversion, and a same-origin Horizon request. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when Chrome is not installed at a standard Linux path.

### Type check

```bash
npm run typecheck    # tsc --noEmit
```

Not part of either axis — it measures the *published types*, not runtime behavior, and it is expected to report errors. The count is pinned in [`reports/baseline.json`](reports/baseline.json) and tracked as [ISSUES.md](ISSUES.md) issue 2; new tests must not raise it. To get just the number:

```bash
npm run --silent typecheck 2>&1 | grep -cE "error TS"
```

## Design notes

- **One shared suite, three runtimes.** `tests/` is the single source of truth; the runtime axis is expressed only through the per-runtime run commands and `deno.json`, never by duplicating test files.
- **`expect()` shim** (`tests/helpers/assert.ts`) lets the suite keep Vitest-style assertions while running on `node:test` everywhere. It uses only erasable TypeScript so Node's type-stripping accepts it.
- **`--no-check` on Deno.** Deno type-checks by default; Node and Bun do not. The SDK's runtime API exceeds its published `.d.ts` types, so type-checking is disabled to keep all three runtimes testing *runtime behavior*. The type gaps are tracked separately in [ISSUES.md](ISSUES.md); run `npm run typecheck` to see the current set.
- **Surface locks.** `sdk-api-surface` and `sdk-method-surface` assert the exact set of exported symbols and methods. They are deliberately held at an older SDK surface between majors so additive drift is visible rather than silent — see [`reports/baseline.json`](reports/baseline.json).
- **Loopback HTTP, not mocks.** Fixture-based HTTP tests run against a real `127.0.0.1` server (`tests/helpers/server.ts`), exercising each runtime's actual HTTP client rather than intercepting the transport (as `nock` did).
- **Live vs. loopback split.** Error paths, malformed payloads, and exact-value assertions use the loopback server (a live endpoint can't reproduce them); happy-path behavior is verified live against testnet.
- **Local versus combined coverage.** The audit's local backlog is public surface without a direct behavior test in this repository. `--vs-upstream` separately reports names found in upstream tests. That cross-reference is heuristic word-boundary matching, so "covered upstream" is triage rather than proof; known collisions are recorded in `reports/baseline.json`.

## Expected test status

**A clean run is not all-green**, by design: the golden surface locks are held at an older SDK surface on purpose, so additive API drift stays visible until the next major re-baselines them in one pass.

Which failures are expected — and the exact counts, tested version, and toolchain they were verified with — live in **[`reports/baseline.json`](reports/baseline.json)**, not here, so this file cannot go stale. `/test-latest-sdk` diffs every run against it. **Any failure not listed there is a genuine finding.**

## Known findings

All findings, evidence, and proposed fixes live in **[ISSUES.md](ISSUES.md)**. Per-version results live in **[`reports/`](reports/)**.

## Refactor-validation workflow

To test a local SDK build against this harness, replace the package files in `node_modules` (with pnpm, under `node_modules/.pnpm/@stellar+stellar-sdk@<ver>/`) and run `npm run test:all`, `npm run test:browser`, and `npm run test:pm`. Any new failure is a candidate regression.
