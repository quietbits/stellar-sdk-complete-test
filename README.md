# Stellar JS SDK Multi-Runtime / Multi-Package-Manager Test Harness

A test-only project that validates `@stellar/stellar-sdk` along two independent axes:

1. **Runtime axis** — does the SDK *run* correctly? The same test suite executes natively on **Node**, **Deno**, and **Bun**.
2. **Package-manager axis** — does the SDK *install and resolve* correctly under **npm**, **pnpm**, **Yarn classic**, and **Yarn Berry (PnP)**?

These are orthogonal: the runtime axis catches execution differences (Buffer, crypto, `fetch`, XDR), the package-manager axis catches dependency-resolution differences (hoisted `node_modules`, symlinked store, Plug'n'Play).

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
│   ├── sdk-umd-bundle.test.ts   #   UMD dist/ bundle artifact (Node-only)
│   ├── sdk-live-http.test.ts    #   HTTP parse/error paths via loopback server
│   └── sdk-live-network.test.ts #   genuinely live testnet calls
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
│   └── <version>.md             #   e.g. 16.2.0.md
│
├── .claude/skills/
│   └── test-latest-sdk/         # /test-latest-sdk — the full release-test run
│       ├── SKILL.md
│       └── scripts/
│           └── coverage-audit.mjs   # new-symbol coverage gaps
│
├── scripts/
│   └── test-pms.sh              # installs + runs each package-manager sandbox
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

Install dependencies for the runtime axis once: `pnpm install` (or `npm install`).

## Running

### Testing a new SDK release (recommended)

This repo ships a skill that runs the whole thing end to end:

```text
/test-latest-sdk
```

It resolves the latest published version and **stops for your confirmation**, reviews the changelog for the versions being crossed, pins the target version, installs clean, runs both axes unmodified, diffs the outcome against `reports/baseline.json`, audits whether every newly added SDK API has a behavior test, writes `reports/<version>.md`, and **stops to ask** how to address anything new. It never modifies an existing test to make a run pass.

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
npm run test:all     # all three in sequence
```

Live network tests (`sdk-live-network.test.ts`) hit Stellar **testnet**. Skip them in an offline environment:

```bash
STELLAR_LIVE=0 npm run test:node
```

### Package-manager axis

```bash
npm run test:pm      # installs the SDK under each manager and runs the smoke test
```

## Design notes

- **One shared suite, three runtimes.** `tests/` is the single source of truth; the runtime axis is expressed only through the per-runtime run commands and `deno.json`, never by duplicating test files.
- **`expect()` shim** (`tests/helpers/assert.ts`) lets the suite keep Vitest-style assertions while running on `node:test` everywhere. It uses only erasable TypeScript so Node's type-stripping accepts it.
- **`--no-check` on Deno.** Deno type-checks by default; Node and Bun do not. The SDK's runtime API exceeds its published `.d.ts` types, so type-checking is disabled to keep all three runtimes testing *runtime behavior*. The type gaps are tracked separately in [ISSUES.md](ISSUES.md); run `npx tsc --noEmit` to see the current set.
- **Surface locks.** `sdk-api-surface` and `sdk-method-surface` assert the exact set of exported symbols and methods. They are deliberately held at an older SDK surface between majors so additive drift is visible rather than silent — see [`reports/baseline.json`](reports/baseline.json).
- **Loopback HTTP, not mocks.** Fixture-based HTTP tests run against a real `127.0.0.1` server (`tests/helpers/server.ts`), exercising each runtime's actual HTTP client rather than intercepting the transport (as `nock` did).
- **Live vs. loopback split.** Error paths, malformed payloads, and exact-value assertions use the loopback server (a live endpoint can't reproduce them); happy-path behavior is verified live against testnet.

## Expected test status

**A clean run is not all-green**, by design: the golden surface locks are held at an older SDK surface on purpose, so additive API drift stays visible until the next major re-baselines them in one pass.

Which failures are expected — and the exact counts, tested version, and toolchain they were verified with — live in **[`reports/baseline.json`](reports/baseline.json)**, not here, so this file cannot go stale. `/test-latest-sdk` diffs every run against it. **Any failure not listed there is a genuine finding.**

## Known findings

All findings, evidence, and proposed fixes live in **[ISSUES.md](ISSUES.md)**. Per-version results live in **[`reports/`](reports/)**.

## Refactor-validation workflow

To test a local SDK build against this harness, replace the package files in `node_modules` (with pnpm, under `node_modules/.pnpm/@stellar+stellar-sdk@<ver>/`) and re-run `npm run test:all`. Any new failure is a candidate regression.
