# Issues found in `@stellar/stellar-sdk`

Found while building the multi-runtime / multi-package-manager harness in this repo. Each issue is reproducible with the commands in [README.md](README.md).

The pinned SDK version, the toolchain it was verified against, and the current expected pass/fail status all live in [`reports/baseline.json`](reports/baseline.json) — the single source of truth. Per-version run records are in [`reports/`](reports/). This file covers only the findings themselves, so it does not need updating when counts change.

| # | Issue | Severity | Surface | Blocks? | Status |
|---|-------|----------|---------|---------|--------|
| 1 | SDK fails to load under Yarn Berry (PnP) — **ESM entry** | **High** | install/resolution | no | ✅ **Fixed** — but see issue 12 for the CJS entry |
| 2 | Published types lag the runtime API | Medium | TypeScript DX | no | ⏳ **Open**, improved: 30 → 27 errors, 3 fixed, 0 new |
| 3 | Hand-rolled ledger XDR fixtures don't decode | Low | test data only | no | ✔️ Mitigated (covered live); no SDK fix needed |
| 4 | Surface locks intentionally red pending v17 | None (harness) | test expectations | no | 📌 **Deferred to v17** — additive-only |
| 5 | StrKey accepts 4 of 15 SEP-23 invalid vectors | **Medium** | input validation | no | 🔴 **Open** — 3 new, 1 known upstream |
| 6 | `TimeoutInfinite` transactions fail `Utils.validateTimebounds` | Low | API consistency | no | 🔴 **Open** — two SDK APIs disagree |
| 7 | Coverage retargeted to end-user-distinct surface | None (harness) | test coverage | no | ✅ **Work list closed** — all 28 no-upstream-test symbols covered |
| 8 | StrKey encoders emit strkeys the SDK itself rejects | Low | input validation | no | 🔴 **Open** — no length validation on encode |
| 9 | Harness housekeeping | None (harness) | tooling | no | 🟡 **Open** — deliberately deferred |
| 10 | Reproducibility options considered and declined | None (harness) | tooling | no | 📋 **Decided** — revisit only on the stated triggers |
| 11 | `contract.Spec` decodes struct fields by position, not by key | **Medium** | data decoding | no | 🔴 **Open** — two SDK decoders disagree on the same bytes |
| 12 | CJS build `require()`s ESM-only dependencies | **High** | install/resolution | **yes** | 🔴 **Open** — `require()` fails under Yarn Berry PnP and without `require(esm)` |
| 13 | Coverage audit was blind to 5 of 8 exported subpaths | None (harness) | test coverage | no | ✅ **Closed** — guard added, blind spot cannot reopen silently |

**Blocks?** means: would this stop `/test-latest-sdk` calling a run clean. Only two things do — a test failure with no `knownFailures` entry in [`reports/baseline.json`](reports/baseline.json), and a symbol new in the version under test with no behavior test. **Issue 12 blocks today:** the `yarn-berry` package-manager sandbox fails, and it is a genuine SDK defect rather than a harness artifact, so it is recorded as a failing axis rather than silenced with a `knownFailures` entry. Everything else open is real work that does not gate a release.

---

## Issue 1 — SDK fails to load under Yarn Berry Plug'n'Play

> **✅ Fixed as of `16.2.0`** — for the **ESM** entry point, which is what this issue was about. Originally reported against `16.0.0` and tracked in [PR #1484](https://github.com/stellar/js-stellar-sdk/pull/1484).
>
> **Read with issue 12.** When this was written the `yarn-berry` sandbox passed, and the sandbox only imported the SDK as ESM. Extending it to `require()` the package showed that the **CJS** entry still fails under PnP, for an unrelated cause (ESM-only dependencies). So "PnP works at 16.2.0" is true of `import` and false of `require`. The fix recorded below is real and unaffected; the sandbox is red again for the other half of the dual build.

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

**Not counted in the 27, but real:** `Uint128.MIN_VALUE` and `Uint256.MIN_VALUE` exist at runtime yet are absent from the types, because both inherit from the untyped `js-xdr` base (`UnsignedHyper.MIN_VALUE` is fine). It does not appear in the error count only because `tests/sdk-numbers.test.ts` reaches them through a typed table rather than directly. So 27 is a floor, not a complete tally — the count reflects what the suite happens to touch, not the whole type surface.

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

---

## Issue 5 — StrKey accepts 4 of the 15 SEP-23 invalid test vectors

**Severity: Medium** — malformed strkeys are accepted as valid. [SEP-23](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md) states implementations "must accept the following valid test cases and **reject** the invalid test cases", and warns that accepting them "could in turn cause security problems". Found at 16.2.0 while writing `tests/sdk-strkey.test.ts`; not assessed against earlier versions. `src/base/strkey.ts` is unchanged between the v16.2.0 tag and upstream `main`, so this applies to both.

**One of the four is already known upstream, three appear new.** Vector #15 has an explicit test in `js-stellar-sdk` named `"current limitation: claimable balance discriminant is not validated"` (added in "Modernization", [#1444](https://github.com/stellar/js-stellar-sdk/pull/1444)) which asserts the current non-compliant behavior. It is an acknowledged limitation, not a discovery. The three signed-payload cases are not tested upstream at all.

Why upstream misses them is structural, not an oversight: its signed-payload tests build an `xdr.SignerKeyEd25519SignedPayload` and *then* encode it, so the XDR writer always emits a correct length prefix and correct padding. That path cannot construct a prefix/payload mismatch. Reaching these cases requires **decoding a hostile string**, which is the direction an end-user consuming untrusted input is exposed to and which this harness is positioned to test.

All 9 valid SEP-23 vectors pass, and 11 of 15 invalid vectors are correctly rejected. These 4 are accepted:

| SEP-23 case | Strkey prefix | `isValid…` | `decode…` |
|-------------|---------------|------------|-----------|
| Length prefix shorter than payload | `P` (signed payload) | returns `true` | returns 72 bytes |
| Length prefix longer than payload | `P` (signed payload) | returns `true` | returns 64 bytes |
| No zero padding in signed payload | `P` (signed payload) | returns `true` | returns 65 bytes |
| Claimable balance type byte is not 0 | `B` | returns `true` | returns 33 bytes, first byte `0x1` |

The three signed-payload cases mean `isValidSignedPayload` does not cross-check the 4-byte length prefix against the actual payload length, nor require the zero padding to a 4-byte boundary. The claimable-balance case means the leading type byte is not validated against the only defined value (`v0` = 0).

### Reproduce

The vectors are in `tests/sdk-strkey.test.ts` as `INVALID_BUT_ACCEPTED`. They are deliberately **not** asserted there: a test pinning the current behavior would codify the defect. The test file asserts only that the count of known deviations is 4, so fixing one upstream shows up as a failure in that guard.

### Proposed fix (SDK side)

In `decodeSignedPayload`/`isValidSignedPayload`, after decoding: read the 4-byte big-endian length prefix, require `36 + length <= total` and that the payload occupies exactly `ceil(length / 4) * 4` bytes, and require the padding bytes to be zero. In the claimable-balance path, require the leading type byte to be `0`.

---

## Issue 6 — `TimeoutInfinite` transactions are reported outside their timebounds

**Severity: Low** — two SDK APIs disagree about the same transaction. `TransactionBuilder.setTimeout(TimeoutInfinite)` is the documented way to build a transaction with no expiry, and it produces `timeBounds = { minTime: "0", maxTime: "0" }`. `Utils.validateTimebounds` then compares literally:

```js
return now >= Number.parseInt(minTime, 10) - gracePeriod && now <= Number.parseInt(maxTime, 10) + gracePeriod;
```

With `maxTime = 0` that reads as "expired in 1970", so `validateTimebounds` returns `false` for a transaction the builder was asked to make non-expiring.

`Utils.validateTimebounds` has **no upstream test** — `js-stellar-sdk/test/unit/utils.test.ts` covers `WebAuth` helpers, not this function, and no other upstream test references it. That is almost certainly why the inconsistency has survived.

### Proposed fix (SDK side)

Treat `maxTime === 0` as unbounded in `validateTimebounds`, matching the meaning `TimeoutInfinite` already has in `setTimeout`. Pinned as observed behavior in `tests/sdk-config-helpers.test.ts` so a fix surfaces as a failure there.

---

## Issue 7 — Public surface is not fully behavior-tested

**Severity: None** — harness coverage, not an SDK defect. Tracked because "new APIs are covered" is enforced per release (see the coverage audit in `/test-latest-sdk`) while the pre-existing surface is not yet.

Measured by `coverage-audit.mjs`, which counts a symbol as covered only if a non-surface-lock test references it — appearing in a surface lock proves existence, not behavior.

| | Symbols |
|--|---------|
| Public surface | 472 |
| Behavior-tested | ~301 |
| Deliberately excluded | 7 (`BindingGenerator`, see `reports/coverage-exclusions.json`) |
| Remaining backlog | **164** |

Tier 1 — pure functions with no I/O — is **done**: 75 symbols closed by `sdk-strkey`, `sdk-numbers`, `sdk-claimant`, `sdk-contract-result`, and `sdk-config-helpers` (101 tests, green on all three runtimes, no new type errors).

### Scope revised: chase end-user-distinct surface, not all 472

The original goal — behavior-test every public symbol here — was set before cross-referencing `js-stellar-sdk`, which has **125 unit test files**. Most of tier 1 turned out to duplicate them: `claimant`, `int128`/`uint128`/`int256`/`uint256`, `xdr_large_int`, and `scval` are all covered upstream, in some cases more thoroughly. Continuing to 472 would mean re-deriving upstream's unit suite in a repo whose purpose is end-user validation.

The two suites have different subjects and that is the useful division:

- **Upstream** tests `src/` — implementation correctness, one runtime, and it can construct inputs through internal APIs.
- **This repo** tests the **published artifact** — across three runtimes and four package-manager layouts, reachable only through the public API, including hostile input a consumer might be handed.

The evidence that this is where the value is: **all three SDK findings from the tier-1 pass came from code upstream does not test.** Issue 5's three novel vectors are unreachable by upstream's construct-then-encode approach; issue 8's encoder length cases have no upstream test; issue 6 sits in `Utils.validateTimebounds`, which upstream never tests at all. Nothing was found in the areas upstream covers well.

Revised priority for remaining work, highest value first:

1. **Symbols with no upstream test.** `contract.Err`/`Ok` (done), `Config` behavior (done — upstream only uses it as incidental setup), `Utils` (done). Audit the rest of the backlog against `js-stellar-sdk/test/` before writing.
2. **Hostile and malformed input** through public decoders and parsers. This is the class both remaining StrKey findings fall into, and upstream is structurally weak here because its tests build valid inputs first.
3. **Packaging and module-format behavior** — the axis upstream has no equivalent for, and where the highest-severity finding so far lived (issue 1, Yarn Berry PnP).
4. **Cross-runtime divergence** in anything touching `Buffer`, crypto, `fetch`, or XDR.

Explicitly **deprioritized**: pure functions already covered upstream. Tiers 2–4 as originally framed (~150 symbols of builders, `rpc.Server`, and `contract.Spec`) should be filtered against upstream coverage first rather than worked through in order. `rpc.Server` and `contract.Spec` are still worth attention where loopback can feed them malformed responses, which is category 2 rather than symbol-counting.

The backlog count stays useful as a rough progress signal, but **it is no longer the target**. Do not treat a nonzero backlog as a defect.

### The actual work list: 28 symbols with no upstream test — closed

**Status: done.** All 28 now have behavior tests, in four new files (135 tests, green on Node, Deno, and Bun, `tsc --noEmit` unchanged at 27). The cross-reference now reports `NO upstream test: 0`, and the overall backlog fell from 160 to 121 — the 28 targeted symbols plus 11 more picked up along the way. The one finding that came out of it is issue 11 below, again from a decoder handed bytes it did not produce itself.

| File | Tests | Covers |
|------|-------|--------|
| `tests/sdk-signature-base.test.ts` | 29 | `TransactionBase`, and `signatureBase` on `TransactionBase` / `Transaction` / `FeeBumpTransaction` |
| `tests/sdk-contract-spec.test.ts` | 46 | the 11 `contract.Spec` symbols |
| `tests/sdk-contract-assembly.test.ts` | 36 | `AssembledTransaction.buildWithOp` / `validateInvokeContractOp` / `parseError` / `handleWalletError`, `SentTransaction`, `Watcher`, `Client.fromWasmHash` |
| `tests/sdk-rpc-errors.test.ts` | 24 | `NetworkError#getResponse`, `BadRequestError`, `Friendbot`, `rpc.BasicSleepStrategy`, `rpc.LinearSleepStrategy`, `rpc.Server#prepareTransaction` |

Two things worth recording about the list itself, both of which mean 28 overstated the amount of *public* surface involved:

- **11 of the 28 are declared `private` in the published `.d.ts`** — the eight `contract.Spec` converters (`nativeToUdt`, `nativeToUnion`, `nativeToStruct`, `nativeToEnum`, `scValUdtToNative`, `unionToNative`, `structToNative`, `enumToNative`) plus `AssembledTransaction`'s `parseError`, `handleWalletError`, and `validateInvokeContractOp`. They appear in the inventory because it enumerates prototype own-property names, and TypeScript's `private` is compile-time only — the same reason `_hashMessage` shows up in issue 4. They are covered here through the public entry points that route into them (`nativeToScVal` / `scValToNative`, `result`, `sign`, `fromXDR` / `fromJSON`), which is the only way an end user reaches them at all.
- **`Friendbot` is a types-only namespace.** It exists at runtime solely as `{}`, because `export * as Friendbot` emits a binding even when the namespace declares nothing but interfaces. Pinned in `sdk-rpc-errors.test.ts` so a release that gives it runtime members shows up.

One new false positive was found and removed rather than recorded: `MuxedAccount` was briefly credited because the string appeared in a prose comment. The audit's name matching cuts both ways, and a comment is not a test.

### The original list, for reference

Of the 160 remaining backlog symbols, **132 already have upstream coverage** and 28 do not. Regenerate this at any time — the cross-reference is reproducible, not a one-off:

```bash
node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs --vs-upstream
# defaults to ../js-stellar-sdk; override with --upstream=<path> or STELLAR_SDK_REPO
# skips cleanly (exit 0) when no upstream checkout is present
```

Measured against 16.2.0, grouped by the fixture work each group needs:

| Group | Symbols | Needs |
|-------|---------|-------|
| `contract.Spec` — `nativeToUdt`, `structToNative`, `unionToNative`, `enumToNative`, `nativeToStruct`, `nativeToUnion`, `nativeToEnum`, `scValStrToNative`, `scValUdtToNative`, `getFunc`, `errorCases` | 11 | a real contract spec fixture; the embedded SAC spec is reachable offline |
| `contract.AssembledTransaction` — `parseError`, `handleWalletError`, `buildWithOp`, `validateInvokeContractOp`; plus `SentTransaction`, `Watcher`, `Client.fromWasmHash` | 7 | loopback simulation responses |
| `signatureBase` on `Transaction`, `FeeBumpTransaction`, `TransactionBase`; plus `TransactionBase` itself | 4 | nothing — one test can cover all three |
| `NetworkError#getResponse`, `BadRequestError`, `Friendbot`, `rpc.BasicSleepStrategy`, `rpc.LinearSleepStrategy`, `rpc.Server#prepareTransaction` | 6 | loopback for `Friendbot` and `prepareTransaction`; the rest are direct |

Rough size, extrapolating from the tier-1 pass (75 symbols → 101 tests, ~1.35 tests/symbol) and allowing for harder setup and more failure paths: **~55–70 tests in about 3 files**. Chasing all 160 instead would be 200+ tests, 132 symbols of which upstream already covers.

The name-matching caveat cuts both ways here: a symbol may be credited to upstream because its name appears incidentally. Confirm by opening the upstream test before skipping something.

### The reported number is optimistic

The audit matches symbol names by word boundary, so a name that appears for an unrelated reason counts as coverage. Three such false positives are known and recorded in `reports/baseline.json` under `coverage.falsePositives`: `Address.claimableBalance` and `Address.liquidityPool` (the strings `"claimableBalance"`/`"liquidityPool"` appear in `sdk-strkey.test.ts` as version-byte *names*), and `contract.AssembledTransaction#toJSON` (collides with `XdrLargeInt#toJSON`). The script reports 161; the true figure is 164. Verify any gap by reading the test before trusting either number.

---

## Issue 8 — StrKey encoders emit strkeys the SDK itself rejects

**Severity: Low** — the encoders perform no length validation, so they will produce a strkey that the matching `isValid…` then reports as invalid. The mirror image of issue 5: that one is `decode`/`isValid` being too permissive, this one is `encode`.

Found at 16.2.0 while writing `tests/sdk-strkey.test.ts`; not assessed against earlier versions. **No upstream test covers encoder length validation** — `js-stellar-sdk/test/unit/base/strkey.test.ts` has no wrong-length encode cases, so this is untested there rather than a known limitation.

### Evidence

`encodeEd25519PublicKey(Buffer.alloc(5))` returns `GAAAAAAAACGC6` — byte-for-byte the **first invalid test vector in SEP-23**, the one the spec uses to illustrate why length must be checked. The SDK can therefore generate the exact value the spec requires implementations to reject, and its own `isValidEd25519PublicKey` does reject it.

| Encoder | 5 bytes | 31 bytes | 33 bytes |
|---------|---------|----------|----------|
| `encodeEd25519PublicKey` | encodes, then invalid | encodes, then invalid | encodes, then invalid |
| `encodeContract` | encodes, then invalid | encodes, then invalid | encodes, then invalid |
| `encodeLiquidityPool` | encodes, then invalid | encodes, then invalid | encodes, then invalid |
| `encodeClaimableBalance` | encodes, then invalid | encodes, then invalid | valid — correct, this type is 1 type byte + 32-byte hash |

None of these throw. `encodePreAuthTx` and `encodeSha256Hash` accept any length too — `encodePreAuthTx(Buffer.alloc(5))` returns `TAAAAAAAADTMG` — though the SDK exposes no `isValidPreAuthTx`/`isValidSha256Hash`, so there is no validator for them to contradict.

### Why it is Low rather than Medium

Reaching it requires passing a wrong-length buffer, which is a caller bug, and the result fails validation downstream rather than being silently accepted. It is a footgun and a round-trip inconsistency, not a validation bypass — issue 5 is the one that lets bad input in.

### Proposed fix (SDK side)

Have each `encode…` assert its payload length before encoding and throw on mismatch, so an encoder can never produce a value its own validator refuses: 32 bytes for ed25519 public keys and secret seeds, contract, liquidity pool, pre-auth and sha256 hashes; 33 for claimable balance (type byte + hash); 40 for med25519 (key + id); and for signed payload, a 32-byte key plus a 4-byte length prefix plus the payload zero-padded to a 4-byte boundary.

### Not asserted in the suite

Deliberately uncovered, for the same reason as issue 5: a test pinning the current behavior would codify it. Re-check with the probe in this section after any StrKey change.

---

## Issue 9 — Harness housekeeping

**Severity: None** — harness-owned, no SDK involvement. Grouped because each item is small, real, and deliberately deferred rather than overlooked.

### Three of the 27 type errors are ours, not the SDK's

- `tests/sdk-method-surface.test.ts` imports `SorobanDataBuilder` and never uses it (`noUnusedLocals`).
- The `it.each` shim in `tests/helpers/assert.ts` types its cases as `readonly unknown[]`, so every `.each` callback parameter arrives as `unknown` and needs a cast at the call site to be used.
- `tests/sdk-xdr.test.ts` indexes `["u32", "string", "i32"][i]`, which widens to `string` where a narrower union is wanted. An `as const` fixes it.

All three are fixable today. They are left alone because the existing test files are frozen until the v17 re-baseline (issue 4), and touching them now would mean editing files the release workflow treats as the measurement. Fix them in the same pass that regenerates the surface locks.

### Markdown lint

Every table in this repo trips `MD060/table-column-style`, because the separator rows are written `|---|---|` rather than with padding. It is consistent across `README.md`, `ISSUES.md`, and everything under `reports/`, and predates this work. Either adopt the padded style everywhere in one pass or configure the rule off — the current state means real markdown warnings are lost in the noise.

### Minor

- `reports/` has no index; the file list is the index. Fine at two reports, worth revisiting at ten.
- The layout tree in `README.md` cites `e.g. 16.2.0.md` as an example filename, which will read as stale once later versions are tested.

---

## Issue 10 — Reproducibility options considered and declined

**Severity: None** — recorded so these are not re-argued from scratch each release. Each has a stated trigger that would change the decision.

| Option | Decision | Why | Revisit if |
|--------|----------|-----|------------|
| `engines` field / `.tool-versions` | Declined for now | The skill's preflight already checks Node/Deno/Bun/pnpm against minimums and records actuals in every report, so this would duplicate the check without adding enforcement anyone acts on. | The harness starts running unattended (CI, cron), where a preflight message nobody reads is not enough. |
| Devcontainer | Declined | Would pin the toolchain byte-for-byte, but cannot pin either genuinely external input — the npm registry or testnet — so it buys less determinism than it appears to, at real maintenance cost. | Cross-machine divergence actually shows up in a report and is traced to a tool version. |
| Line/branch coverage instrumentation | Declined | `node --experimental-test-coverage` and friends can be pointed at the SDK, but it is a bundled dependency: the output is noisy and any threshold would be arbitrary. Symbol-level behavior coverage (issue 7) is the enforceable measure. | The public surface is fully behavior-tested and the question becomes *how thoroughly*, not *whether*. |

### Deliberately not solved, because they cannot be

Two inputs are outside this repo's control and no amount of pinning fixes them. They are properties of the system under test, not defects:

- **The npm registry.** The PM axis resolves fresh on purpose — `package-managers/.gitignore` excludes all four sandbox lockfiles — because the axis exists to test real installation. The SDK's own dependencies use `^` ranges, so the same SDK version can resolve a different tree later. Mitigated by recording the resolved versions in each report, not by pinning.
- **Testnet.** The live suite hits real infrastructure. Mitigated by running `STELLAR_LIVE=0` first so a testnet failure can never be misfiled as an SDK regression.

---

## Issue 11 — `contract.Spec` decodes struct fields by position, not by key

**Severity: Medium** — a contract's return value can be decoded into an object whose field *names* are attached to the wrong *values*, with no error raised. Found at 16.2.0 while writing `tests/sdk-contract-spec.test.ts`; not assessed against earlier versions.

`Spec.scValToNative` is what `contract.Client` uses to turn a contract's return value into a JS object. For a struct UDT it delegates to `structToNative`, which walks the incoming `scvMap` by index and takes the field name from the spec entry at the *same* index. The map's keys are never read:

```js
// contract/spec.js — structToNative
val.map()?.forEach((entry, i) => {
  const field = fields[i];                       // <- position, not entry.key()
  res[field.name().toString()] = this.scValToNative(entry.val(), field.type());
});
```

### Two SDK decoders disagree about the same bytes

This is the clearest statement of the problem, and it needs no assumption about any particular contract. Given a `Point { x, y }` spec and an `scvMap` whose entries are `y=20, x=10`:

| Decoder | Result |
|---------|--------|
| `scValToNative(scv)` (generic, key-based) | `{ y: 20, x: 10 }` — correct |
| `spec.scValToNative(scv, udt("Point"))` | `{ x: 20, y: 10 }` — **values exchanged** |

### Why this is reachable, not just hostile input

Soroban requires `ScMap` keys to be **sorted**, while a contract spec lists struct fields in **declaration order**. Those two orders coincide only when the Rust struct happens to be declared alphabetically. A struct declared `struct Rec { zed: u32, alpha: u32 }` serializes on the wire as `alpha, zed` and is therefore decoded as `{ zed: <alpha's value>, alpha: <zed's value> }`.

That the spec generator preserves declaration order rather than sorting is visible in the SDK's own embedded SAC spec: `approve` reports its inputs as `from, spender, amount, expiration_ledger`, which is neither alphabetical nor sorted. That is evidence from a function signature rather than a struct, so **the end-to-end case against a real Rust contract still wants confirmation against `soroban-sdk`'s `contracttype` derive** — it is asserted here only as far as it was verified in-session. The decoder defect itself is confirmed and does not depend on it.

### Related, same root cause

Two more consequences of not consulting the keys, both pinned in the same test file:

- **Undeclared keys are accepted and renamed.** A map of `{ bogus: 42, alsoBogus: 43 }` decodes to `{ x: 42, y: 43 }` — a contract's return value is mapped onto the caller's expected field names regardless of what it actually said.
- **Short maps truncate silently.** A one-entry map for a two-field struct yields `{ x: 1 }`, with no indication that `y` was missing.

Separately, `enumToNative` checks only that the value is an `scvU32` and never compares it to the declared cases, so encode and decode disagree about legality: `nativeToScVal(99, Color)` throws `no such enum entry: 99`, while `scValToNative(scvU32(99), Color)` returns `99`. Two different enums in the same spec also decode identically.

### Why upstream misses it

`structToNative`, `nativeToStruct`, and `enumToNative` have no test in `js-stellar-sdk`. The shape of the bug also survives the obvious test: `nativeToScVal` emits map entries in declaration order too, so encoding and decoding through the *same* spec cancels the error out and round-trips cleanly. Only feeding the decoder a validly sorted map — bytes it did not produce — exposes it. This is the same class as issue 5, and the reason the harness rule about external ground truth exists.

### Proposed fix (SDK side)

In `structToNative`, look each field up by its key symbol rather than by index, and fail on a key the struct does not declare or a declared field the map omits. In `nativeToStruct`, emit the map in sorted key order so the SDK stops producing `ScMap`s that violate the sorted-key invariant. In `enumToNative`, take the `udt` that `scValUdtToNative` already has in hand and reject a discriminant that is not a declared case.

### Where it is pinned

`tests/sdk-contract-spec.test.ts`, in the two `describe` blocks headed "struct decoding ignores map keys" and "enum decoding is unvalidated". Each assertion is marked `DEVIATION` in a comment and pinned as observed behaviour, not endorsed — so a fix upstream surfaces as a failure there rather than passing silently.

---

## Issue 12 — The CommonJS build `require()`s ESM-only dependencies

**Severity: High** — `require("@stellar/stellar-sdk")` fails outright wherever Node's `require(esm)` support is not in play. It loads today only because that support has been on by default since Node 22.12. Found at 16.2.0 by extending the package-manager smoke test to cover the CJS half of the dual build, which nothing had done before. **This is the only open finding that blocks a clean release run.**

This is issue 1's mirror image. That one was the **ESM** entry failing under Yarn Berry PnP and is fixed. This is the **CJS** entry failing under the same package manager, and it survived because every CJS test in this repo loaded the UMD `dist/` bundle off disk rather than going through the `require` condition in the exports map.

### Evidence

Three dependencies are `"type": "module"` with **no `require` condition anywhere** in their exports, and the CJS build `require()`s all three across 17 files under `lib/cjs/`:

| Dependency | Version | `type` | `require` condition |
|------------|---------|--------|---------------------|
| `@noble/hashes` | 2.2.0 | `module` | none |
| `@noble/ed25519` | — | `module` | none |
| `uint8array-extras` | — | `module` | none |

The first one reached is `lib/cjs/errors/transaction_failed.js:10`, `require('@noble/hashes/sha2.js')`, pulled in by the root `index.js`. So the failure is on the package root, not some peripheral subpath.

**Under Yarn Berry PnP** (any Node version) — the sandbox in `package-managers/yarn-berry`:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../@noble/hashes/sha2.js
from .../@stellar/stellar-sdk/lib/cjs/errors/transaction_failed.js not supported.
    at require$$0.Module._extensions..js (.../.pnp.cjs:6171:15)
```

PnP patches `Module._extensions['.js']` and resolves through its own loader, which bypasses Node's `require(esm)` path entirely.

**Not PnP-specific.** The same failure reproduces on a plain hoisted npm layout the moment the escape hatch is removed:

```bash
cd package-managers/npm
node -e 'require("@stellar/stellar-sdk")'                              # OK (require(esm) on by default)
node --no-experimental-require-module -e 'require("@stellar/stellar-sdk")'
# Error [ERR_REQUIRE_ESM] ... @noble/hashes/sha2.js
```

So the CJS build is not self-sufficient: it depends on a Node feature that a CommonJS consumer cannot assume. Node lines older than 22.12, where `require(esm)` is flagged or absent, are expected to fail the same way — **stated as expectation, not verified here**, since only Node 22.22 was available in this run.

### Why it went unnoticed

Nothing exercised the `require` condition. `tests/sdk-umd-bundle.test.ts` does call `require()`, but on a copy of `dist/stellar-sdk.js` — a separate single-file UMD artifact that inlines its dependencies and therefore never hits this path. The package-manager smoke test imported ESM only. Both gaps are now closed: `tests/sdk-package-entrypoints.test.ts` loads every subpath through `require()`, and the four sandbox smoke tests do the same under each manager's layout.

### Proposed fix (SDK side)

The CJS build needs a dependency graph that CommonJS can actually load. In rough order of preference:

1. **Bundle the ESM-only dependencies into `lib/cjs`**, the way the vendored `js-xdr` copy already is. Self-contained, no consumer-visible change.
2. **Convert the `require()` calls to dynamic `import()`** in the affected modules, which is what the Node error message itself suggests — but it makes the affected entry points async, which is a breaking change to their shape.
3. **Drop to dependency versions that still ship CJS.** `@noble/hashes` 1.x had a `require` condition; 2.x removed it. Least attractive, since it pins the SDK to older crypto.

Whichever route, a CI job that runs `node --no-experimental-require-module -e 'require("@stellar/stellar-sdk")'` would keep it from regressing.

### Where it is pinned

- `tests/sdk-package-entrypoints.test.ts` — "cannot be require()d without Node's require(esm) support", marked `DEVIATION`, asserting the current broken behaviour so a fix turns it red. Node-only (needs a child process and a Node flag).
- `package-managers/yarn-berry` — fails for real. Recorded as `FAIL` in `reports/baseline.json` under `packageManagerAxis`, deliberately **not** as a `knownFailures` entry: this is a live SDK defect, not a deferred harness expectation.

---

## Issue 13 — Coverage audit was blind to five of eight exported subpaths

**Severity: None** — harness measurement, not an SDK defect. Recorded because the number it produced was quietly incomplete, and because the fix is what stops that recurring.

`coverage-audit.mjs` inventoried three entry points — the root, `./contract`, and `./rpc`. The package declares **eight** subpaths. Nothing measured `./base`, `./axios`, `./axios/contract`, `./axios/rpc`, or `./http-client/axios`, and no test imported any of them, so nothing verified they resolved at all under any runtime or package manager.

Most of the unmeasured surface turned out to be redundant, which is why the symbol count barely moved:

| Subpath | Relationship | Novel symbols |
|---------|--------------|---------------|
| `./axios`, `./axios/contract`, `./axios/rpc` | identical surface to their non-axios twins | 0 |
| `./base` | strict subset of the root | 0 |
| `./http-client/axios` | genuinely distinct | `httpClient`, `create`, `CancelToken` |

But "the count was nearly right" is not the same as "the measurement was sound" — the *resolution* of those five subpaths was untested, and that is the axis issue 1 and issue 12 both live on.

### What changed

- `./http-client/axios` is now a fourth `ENTRY_POINTS` entry. Its three SDK-owned symbols are behavior-tested; the ~34 statics that come with it are axios's own API surfacing through a verbatim re-export, excluded with a reason in `reports/coverage-exclusions.json`.
- The four mirrors are recorded as `MIRRORED_SUBPATHS` — classified, not counted twice.
- **A drift guard**: the audit now reads the SDK's own `exports` map and exits non-zero if a declared subpath is neither an entry point nor a recorded mirror. A new subpath in v17 fails the audit instead of going unmeasured. `tests/sdk-package-entrypoints.test.ts` locks the same set from the test side.
- `reports/surface-inventory.json` regenerated once, deliberately, for the widened entry-point set: 472 → 510 symbols.

### Two mis-credits found while re-checking, both now corrected

Re-running the upstream cross-reference with comments and import lines stripped showed three of the "covered upstream" verdicts resting on incidental text:

- **`rpc.Server#getLedgerEntry`** — credited by two `//` comments in `test/unit/server/soroban/request_airdrop.test.ts`. No upstream test calls it. It was a genuine hole; now covered in `tests/sdk-rpc-errors.test.ts`.
- **`contract.SentTransaction.init`** and **`rpc.Server#getContractWasmByHash`** — no upstream test either, but both are exercised here through `signAndSend` and `Client.fromWasmHash`. Covered in substance, never named.

The audit's name matching cuts both ways, and this is the second time it has mattered. Treat every "covered upstream" verdict as triage, not proof.
