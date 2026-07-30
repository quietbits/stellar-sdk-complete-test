# Issues found in `@stellar/stellar-sdk`

Found while building the multi-runtime / multi-package-manager harness in this repo. Each issue is reproducible with the commands in [README.md](README.md).

The pinned SDK version, the toolchain it was verified against, and the current expected pass/fail status all live in [`reports/baseline.json`](reports/baseline.json) — the single source of truth. Per-version run records are in [`reports/`](reports/). This file covers only the findings themselves, so it does not need updating when counts change.

| # | Issue | Severity | Surface | Status |
|---|-------|----------|---------|--------|
| 1 | SDK fails to load under Yarn Berry (PnP) | **High** | install/resolution | ✅ **Fixed** |
| 2 | Published types lag the runtime API | Medium | TypeScript DX | ⏳ **Open**, improved: 30 → 27 errors, 3 fixed, 0 new |
| 3 | Hand-rolled ledger XDR fixtures don't decode | Low | test data only | ✔️ Mitigated (covered live); no SDK fix needed |
| 4 | Surface locks intentionally red pending v17 | None (harness) | test expectations | 📌 **Deferred to v17** — additive-only |

---

## Issue 1 — SDK fails to load under Yarn Berry Plug'n'Play

> **✅ Fixed as of `16.2.0`.** The `yarn-berry` (PnP) sandbox now **PASSES**, alongside npm, pnpm, and Yarn classic, with no regression on the Node/Deno/Bun runtime axes. Originally reported against `16.0.0` and tracked in [PR #1484](https://github.com/stellar/js-stellar-sdk/pull/1484).

### The fix is not the one this document originally proposed

Worth recording, because the obvious diagnostic check still looks "broken": the brittle named import is **still present verbatim** in `16.2.0`.

```js
// lib/esm/base/generated/curr_generated.js:7 — unchanged in 16.2.0
import { config } from '../../node_modules/.pnpm/@stellar_js-xdr@4.0.0/node_modules/@stellar/js-xdr/src/config.js';
```

What changed is the **vendored** copy of `js-xdr` that path points at. It now ships its own `package.json` declaring `{"type": "module"}`, and its source uses real ESM named exports:

```js
// lib/esm/.../js-xdr/src/config.js:258
export { Reference, config };
```

So the import is now statically analyzable ESM and never goes through Node's CJS-interop path at all — which is where PnP diverged from the `node_modules` loaders. That is effectively **proposed fix #2** ("real ESM named exports"), applied at the vendoring layer rather than by rewriting the import (#1) or de-vendoring (#3).

Note this conversion to ESM happened **only inside the SDK's vendored copy**. The published `@stellar/js-xdr@4.0.0` package is unchanged — still CommonJS, still untyped — which is why issue 2 below is unaffected.

### Original defect (v16.0.0), for the record

`16.0.0` emitted a **named** import from a **CommonJS** `@stellar/js-xdr@4.0.0`. Node's ESM loader can only synthesize named exports from CJS when they are statically detectable via `cjs-module-lexer`; under PnP's loader the CJS-interop path differs, so detection failed:

```
SyntaxError: Named export 'config' not found. The requested module
'.../@stellar/js-xdr/src/config.js' is a CommonJS module, which may not
support all module.exports as named exports.
```

This was a **v16 regression**: `15.1.0` shipped CommonJS only, so PnP loaded the whole package through standard CJS interop and never reached the problem.

| | v15.1.0 | v16.0.0 | v16.2.0 |
|--|---------|---------|---------|
| Package `type` | (none) → CommonJS | `module` (dual build) | `module` (dual build) |
| Primary entry | `lib/index.js` (CJS) | `lib/esm/index.js` (ESM) | `lib/esm/index.js` (ESM) |
| Vendored js-xdr | normal dep | CJS, named import ✗ | **ESM, named import ✓** |
| Yarn Berry PnP | works | **fails** | **works** |

---

## Issue 2 — Published TypeScript types lag the runtime API

**Severity: Medium** — runtime works, but TypeScript consumers get false errors. Surfaced because Deno type-checks by default; see the `--no-check` note in [README.md](README.md). `--no-check` is **still required**.

### Measured at 16.2.0: 27 errors, down from 30

Measured by installing `16.0.0` and `16.2.0` against the same suite and diffing error signatures:

- **3 fixed:** `rpc.Server.getContractInstance` is now typed (was 3 errors in `sdk-dynamic-imports.test.ts`).
- **0 new.** No type regressions introduced by `16.1.0` or `16.2.0`.

Reproduce with `npx tsc --noEmit` (or `deno check tests/`).

### The v17 wait still applies

The original plan was to wait for the TypeScript/ESM rewrite of `@stellar/js-xdr` rather than hand-write the XDR-primitive types. **That release has not landed:** `@stellar/js-xdr` is still **`4.0.0`, still CommonJS, and still ships no `.d.ts` at all**. The SDK's `Int256 extends LargeInt` therefore still inherits an untyped base. Issue 1's fix converted only the SDK's *vendored* copy to ESM, which does not help typing.

**Do not hand-write these now** — they would be superseded. Re-measure once the new `js-xdr` ships with v17.

### Breakdown of the 27

#### Blocked on the js-xdr TS/ESM release — 12 errors

| Gap | Count |
|-----|-------|
| `bigint` not assignable to `Int64` (constructing XDR numeric fields) | 2 |
| `Int256.prototype.slice` missing | 3 |
| `Int256.fromString` missing (static) | 3 |
| `Memo.arm()` missing (js-xdr union accessor) | 4 |

#### Residual SDK-owned RPC-layer work — 9 errors

| Gap | Count |
|-----|-------|
| `GetTransactionResponse` union hides `envelopeXdr` / `resultXdr` / `resultMetaXdr` on the success branch | 6 |
| `parseRawEvents` rejects `transactionEventsXdr` | 1 |
| `parseRawSimulation` rejects `cost`; result hides `minResourceFee` | 2 |

#### Further SDK gaps, not in the original report — 3 errors

- `Memo.text()` is typed `(text: string)` but accepts a byte array at runtime.
- `xdr.ContractEvent`'s `contractId` is typed `Hash | null` but rejects the `Buffer` that `StrKey.decodeContract()` returns, and is required even though the runtime accepts its omission.

#### Harness-owned, not SDK — 3 errors

Left as-is deliberately (see issue 4): an unused `SorobanDataBuilder` import in `sdk-method-surface.test.ts`, and two places where the suite's own typing is loose — the `it.each` shim types its cases as `unknown[]`, and a `["u32","string","i32"][i]` lookup widens to `string` where a narrower union is wanted (an `as const` would fix it).

### Proposed fix (SDK side)

Unchanged for the two main groups: widen the `GetTransactionResponse` union and correct the `parseRawEvents` / `parseRawSimulation` shapes (SDK-owned, do now); add `fromString`/`slice`/`arm()` and `bigint`-accepting numeric fields once `js-xdr` ships types (do at v17). A type-level regression guard — like `sdk-api-surface.test.ts` but type-checked — would catch future drift.

---

## Issue 3 — Hand-rolled ledger XDR fixtures don't decode

**Severity: Low** — test-data limitation, not an SDK defect. Unchanged at 16.2.0.

### Evidence

The static `headerXdr` / `metadataXdr` fixtures in the original `getLatestLedger` test fail to decode:

```
XDR Read Error: invalid XDR contract typecast - source buffer not entirely consumed
  at parseRawLatestLedger (.../rpc/parsers.js)
```

### Root cause

`getLatestLedger` XDR-decodes `LedgerHeader` and `LedgerCloseMeta` and requires the buffer to be fully consumed. The hand-authored base64 fixtures are not valid serializations of those types, so decoding throws.

### Resolution

Covered by a **live** call in `tests/sdk-live-network.test.ts`, where the RPC returns genuinely valid XDR. This passes at 16.2.0. If a deterministic fixture is ever required, generate it programmatically from the SDK's own `xdr.LedgerHeader` / `xdr.LedgerCloseMeta` constructors rather than hand-typing it, so it stays valid for the pinned version.

---

## Issue 4 — Surface locks intentionally red pending v17

**Severity: None** — harness expectations, not an SDK defect. **Deliberately left failing**; do not "fix" by regenerating the locks in isolation.

`16.2.0` added five public symbols. The golden surface locks are still pinned to the `16.0.0` surface, so the surface-lock tests fail identically on all three runtimes — see `knownFailures` in [`reports/baseline.json`](reports/baseline.json) for exactly which. This is held until the v17 major (with its js-xdr overhaul) so the locks are re-baselined once rather than twice.

### The additions are purely additive

Verified by set-difference rather than by reading the truncated assertion diff — **zero removals**, so no breaking change:

| Lock | Before → after | Added |
|------|----------------|-------|
| root exports | 77 → 80 | `TransactionFailedError`, `checkAuthEntryReadiness`, `inspectAuthEntry` |
| `contract` exports | 10 → 11 | `KeypairSigner` |
| `Keypair` instance | 13 → 16 | `signMessage`, `verifyMessage`, `_hashMessage` |

Failing tests: `matches expected root exports`, `matches expected contract exports`, `matches expected nested rpc and contract namespace exports`, and `keeps Keypair static and instance methods stable`.

`_hashMessage` is declared `private` in the SDK's `.d.ts`; it appears on the prototype only because TypeScript's `private` is compile-time only. It is not a new public API, but a prototype-based lock does see it.

### Behavior of the new APIs *is* covered

Rather than leave the additions untested while their locks are deferred, two new suites cover them (41 tests, green on Node, Deno, and Bun):

- **`tests/sdk-sep53.test.ts`** — `Keypair.signMessage` / `verifyMessage` against the three official [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md) test vectors (ASCII, UTF-8, binary), asserted in both base64 and hex. The `SHA256("Stellar Signed Message:\n" + message)` construction is independently re-derived with `node:crypto` and checked through `verify` rather than `verifyMessage`, so sign and verify cannot drift from the spec together. Plus negatives: tampered message, foreign key, truncated/empty signature, caller-prefixed message, and public-key-only signing.
- **`tests/sdk-new-api-behavior.test.ts`** — `contract.KeypairSigner`, `TransactionFailedError` (via the loopback server, covering the documented empty-`operations` normalization, `result_xdr` decode, the `null` case, and the fallback to plain `BadResponseError`), and `inspectAuthEntry` / `checkAuthEntryReadiness` (source-account vs. address credentials, signed vs. unsigned, the exclusive expiration boundary, and uint32 range validation).

**The SDK matches all three SEP-53 vectors byte-for-byte.** Note that the published SEP-53 document's base64 for vector 2 disagrees with its own hex for the same vector by one bit; the hex is correct and matches the SDK, so these tests assert the hex-derived value.

### Non-issue, checked and dismissed

`TransactionFailedError.name` is `"Error"` rather than the class name — but every SDK error class behaves that way (`NetworkError`, `BadRequestError`, `BadResponseError`, `NotFoundError`, `AccountRequiresMemoError`), so this is a long-standing SDK-wide convention, not a 16.2.0 regression.

`KeypairSigner` assigns `signTransaction` / `signAuthEntry` as instance properties, leaving its prototype empty. A `protoMethods`-style lock would not see them, so the new suite asserts that shape directly.
