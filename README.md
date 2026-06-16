# Stellar JS SDK Multi-Runtime / Multi-Package-Manager Test Harness

A test-only project that validates `@stellar/stellar-sdk` along two independent
axes:

1. **Runtime axis** — does the SDK *run* correctly? The same test suite executes
   natively on **Node**, **Deno**, and **Bun**.
2. **Package-manager axis** — does the SDK *install and resolve* correctly under
   **npm**, **pnpm**, **Yarn classic**, and **Yarn Berry (PnP)**?

These are orthogonal: the runtime axis catches execution differences (Buffer,
crypto, `fetch`, XDR), the package-manager axis catches dependency-resolution
differences (hoisted `node_modules`, symlinked store, Plug'n'Play).

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
│   ├── sdk-live-http.test.ts    #   HTTP parse/error paths via loopback server
│   └── sdk-live-network.test.ts #   genuinely live testnet calls
│
├── package-managers/            # PACKAGE-MANAGER AXIS — install sandboxes
│   ├── npm/         package.json + smoke.test.mjs
│   ├── pnpm/        package.json + smoke.test.mjs
│   ├── yarn-classic/ package.json + smoke.test.mjs
│   └── yarn-berry/  package.json + .yarnrc.yml (PnP) + smoke.test.mjs
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

### Runtime axis

```bash
npm run test:node    # node --test
npm run test:deno    # deno test --no-check
npm run test:bun     # bun test
npm run test:all     # all three in sequence
```

Live network tests (`sdk-live-network.test.ts`) hit Stellar **testnet**. Skip
them in an offline environment:

```bash
STELLAR_LIVE=0 npm run test:node
```

### Package-manager axis

```bash
npm run test:pm      # installs the SDK under each manager and runs the smoke test
```

## Design notes

- **One shared suite, three runtimes.** `tests/` is the single source of truth;
  the runtime axis is expressed only through the per-runtime run commands and
  `deno.json`, never by duplicating test files.
- **`expect()` shim** (`tests/helpers/assert.ts`) lets the suite keep
  Vitest-style assertions while running on `node:test` everywhere. It uses only
  erasable TypeScript so Node's type-stripping accepts it.
- **`--no-check` on Deno.** Deno type-checks by default; Node and Bun do not.
  The SDK's runtime API currently exceeds its published `.d.ts` types (e.g.
  `Int256.fromString`, `Memo.arm()`), so type-checking is disabled to keep all
  three runtimes testing *runtime behavior*.
- **Loopback HTTP, not mocks.** Fixture-based HTTP tests run against a real
  `127.0.0.1` server (`tests/helpers/server.ts`), exercising each runtime's
  actual HTTP client rather than intercepting the transport (as `nock` did).
- **Live vs. loopback split.** Error paths, malformed payloads, and exact-value
  assertions use the loopback server (a live endpoint can't reproduce them);
  happy-path behavior is verified live against testnet.

## Known findings

See [ISSUES.md](ISSUES.md) for full detail, evidence, and proposed fixes.

- **Yarn Berry (PnP) — SDK fails to load.** `@stellar/stellar-sdk@16.0.0` ships
  an ESM build that uses a *named* import (`import { config }`) from a vendored
  *CommonJS* `@stellar/js-xdr`. Node's ESM loader (used by Yarn PnP) rejects
  this with `SyntaxError: Named export 'config' not found`. It works under npm,
  pnpm, and Yarn classic because their `node_modules` layouts use Node's
  standard CJS-interop (`cjs-module-lexer`). The `yarn-berry` sandbox therefore
  reports **FAIL** by design — it is a real SDK ↔ PnP incompatibility.
- **SDK types lag runtime.** Several runtime APIs are missing from the published
  type definitions (see `--no-check` note above).
- **Hand-rolled ledger XDR fixtures don't decode under 16.0.0.** `getLatestLedger`
  is therefore covered live rather than with a static fixture.

## Refactor-validation workflow

To test a local SDK build against this harness, replace the package files in
`node_modules` (with pnpm, under `node_modules/.pnpm/@stellar+stellar-sdk@<ver>/`)
and re-run `npm run test:all`. Any new failure is a candidate regression.
