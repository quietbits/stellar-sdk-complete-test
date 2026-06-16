# Issues found in `@stellar/stellar-sdk@16.0.0`

Found while building the multi-runtime / multi-package-manager harness in this
repo. Each issue is reproducible with the commands in [README.md](README.md).

| # | Issue | Severity | Surface | Regression? |
|---|-------|----------|---------|-------------|
| 1 | SDK fails to load under Yarn Berry (PnP) | **High** | install/resolution | **Yes — new in v16** (v15.1.0 works) |
| 2 | Published types lag the runtime API | Medium | TypeScript DX | Not assessed (API differs across majors) |
| 3 | Hand-rolled ledger XDR fixtures don't decode | Low | test data only | N/A (harness data) |

---

## Issue 1 — SDK fails to load under Yarn Berry Plug'n'Play

**Severity: High** — the package is completely unusable under Yarn Berry PnP
(the default Yarn ≥ 2 install mode). Reproduce with `npm run test:pm`
(`yarn-berry` sandbox).

### Evidence

```
file://.../@stellar/stellar-sdk/lib/esm/base/generated/curr_generated.js:7
import { config } from '../../node_modules/.pnpm/@stellar_js-xdr@4.0.0/node_modules/@stellar/js-xdr/src/config.js';
         ^^^^^^
SyntaxError: Named export 'config' not found. The requested module
'.../@stellar/js-xdr/src/config.js' is a CommonJS module, which may not
support all module.exports as named exports.
```

Passes under **npm**, **pnpm**, and **Yarn classic**; fails only under
**Yarn Berry (PnP)**.

### Regression status: NEW IN v16

`@stellar/stellar-sdk@15.1.0` **loads cleanly under Yarn Berry PnP** (verified
with the same smoke test in an isolated sandbox); `16.0.0` does not. The cause
is a packaging change between the majors:

| | v15.1.0 | v16.0.0 |
|--|---------|---------|
| Package `type` | (none) → CommonJS | `module` (dual build, `lib/esm/`) |
| Primary entry | `lib/index.js` (CJS) | `lib/esm/index.js` (ESM) |
| js-xdr edge | normal `node_modules` dep | **named import from a vendored CJS *file*** |

v15 ships CommonJS only, so PnP loads the whole package through standard CJS
interop and never hits the named-export problem. v16's new ESM build introduces
the `import { config } from '.../js-xdr/src/config.js'` edge that Node's ESM
loader rejects under PnP. **This is a v16 regression, not a long-standing
limitation.**

### Root cause

The SDK's ESM build emits a **named** import (`import { config }`) from a
**CommonJS** module (`@stellar/js-xdr@4.0.0`). Node's ESM loader can only
provide named exports from a CJS module when its exports are statically
detectable via `cjs-module-lexer`. Two things make this fail under PnP:

1. Yarn PnP resolves modules through Node's experimental ESM loader API, where
   the CJS-interop path differs from the standard `node_modules` loader that
   npm/pnpm/yarn-classic use — so the named export isn't detected.
2. The emitted import is a brittle deep relative path into a vendored
   `lib/esm/node_modules/.pnpm/...` copy of `js-xdr`, which looks like a
   build-time artifact rather than an intentional dependency edge.

### Proposed fix (SDK side, in order of preference)

1. **Don't emit named imports from CJS in the ESM build.** Change the generated
   code to a default import + destructure, which Node accepts from CJS:
   ```js
   import jsXdr from '@stellar/js-xdr';
   const { config } = jsXdr;
   ```
   This is the exact workaround Node suggests in the error message and is the
   smallest, lowest-risk change.
2. **Publish `@stellar/js-xdr` as a dual CJS/ESM package** with real ESM named
   exports, so `import { config }` is statically analyzable everywhere. Cleanest
   long-term fix but requires a release of the `js-xdr` dependency.
3. **Stop vendoring with `.pnpm`-specific relative paths.** Have the bundler
   either fully inline `js-xdr` or reference it as a normal bare-specifier
   dependency (`@stellar/js-xdr`) resolved through `package.json`, instead of a
   hardcoded path into a vendored store.

### Workaround (consumer side, until fixed)

Yarn Berry users can fall back to a `node_modules` install by setting
`nodeLinker: node-modules` in `.yarnrc.yml` — but that abandons PnP, so it is a
mitigation, not a fix.

---

## Issue 2 — Published TypeScript types lag the runtime API

**Severity: Medium** — runtime works, but TypeScript consumers get false errors.
Surfaced because Deno type-checks by default (Node/Bun and the old Vitest setup
did not); see the `--no-check` note in [README.md](README.md).

### Evidence (type errors on code that runs correctly)

- `Int256.fromString(...)` / `new Int256(...).slice(n)` — methods exist at
  runtime, missing from the type.
- `Memo.arm()` — `Property 'arm' does not exist on type 'Memo'`.
- `GetTransactionResponse` success branch — `envelopeXdr` / `resultXdr` /
  `resultMetaXdr` not present on the union type.
- `rpc.parseRawEvents({ transactionEventsXdr, contractEventsXdr })` and
  `rpc.parseRawSimulation({ cost, minResourceFee, ... })` — input/result shapes
  reject valid fields.
- `new xdr.TransactionResult({ feeCharged: 100n, ... })` — `bigint` not
  assignable to `Int64`.

### Root cause

The `.d.ts` definitions are out of sync with the implemented runtime surface
(missing methods, over-narrow discriminated unions, and numeric field types that
don't accept `bigint`).

### Proposed fix (SDK side)

Update the type definitions to match runtime:
- Add `fromString` / `slice` (and any sibling `XdrLargeInt` methods) to the
  large-int types.
- Add `arm()` to `Memo`.
- Widen the `GetTransactionResponse` union so the `SUCCESS`/`FAILED` branches
  expose `envelopeXdr` / `resultXdr` / `resultMetaXdr`.
- Correct `parseRawEvents` / `parseRawSimulation` input and result types.
- Allow `bigint` where XDR `Int64`/`Uint64` fields are constructed.

A type-level regression guard (like `tests/sdk-api-surface.test.ts`, but
type-checked) would catch future drift.

---

## Issue 3 — Hand-rolled ledger XDR fixtures don't decode under 16.0.0

**Severity: Low** — test-data limitation, not an SDK defect.

### Evidence

The static `headerXdr` / `metadataXdr` fixtures in the original
`getLatestLedger` test fail to decode:

```
XDR Read Error: invalid XDR contract typecast - source buffer not entirely consumed
  at parseRawLatestLedger (.../rpc/parsers.js)
```

### Root cause

`getLatestLedger` XDR-decodes `LedgerHeader` and `LedgerCloseMeta` and requires
the buffer to be fully consumed. The hand-authored base64 fixtures are not valid
serializations of those types for SDK 16.0.0, so decoding throws.

### Proposed fix (harness side)

- **Preferred:** cover `getLatestLedger` with a **live** call
  (`tests/sdk-live-network.test.ts`), where the RPC returns genuinely valid XDR.
  This is the current approach.
- **If a deterministic fixture is required:** generate it programmatically from
  the SDK's own `xdr.LedgerHeader` / `xdr.LedgerCloseMeta` constructors and
  serialize, so the fixture is always valid for the pinned SDK version rather
  than hand-typed.
