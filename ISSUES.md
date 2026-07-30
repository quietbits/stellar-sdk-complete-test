# Issues found in `@stellar/stellar-sdk`

Found while building the multi-runtime / multi-package-manager harness in this repo. Each issue is reproducible with the commands in [README.md](README.md).

The pinned SDK version, the toolchain it was verified against, and the current expected pass/fail status all live in [`reports/baseline.json`](reports/baseline.json) — the single source of truth. Per-version run records are in [`reports/`](reports/). This file covers only the findings themselves, so it does not need updating when counts change.

| # | Issue | Severity | Surface | Blocks? | Status |
|---|-------|----------|---------|---------|--------|
| 1 | SDK fails to load under Yarn Berry (PnP) | **High** | install/resolution | no | ✅ **Fixed** |
| 2 | Published types lag the runtime API | Medium | TypeScript DX | no | ⏳ **Open**, improved: 30 → 27 errors, 3 fixed, 0 new |
| 3 | Hand-rolled ledger XDR fixtures don't decode | Low | test data only | no | ✔️ Mitigated (covered live); no SDK fix needed |
| 4 | Surface locks intentionally red pending v17 | None (harness) | test expectations | no | 📌 **Deferred to v17** — additive-only |
| 5 | StrKey accepts 4 of 15 SEP-23 invalid vectors | **Medium** | input validation | no | 🔴 **Open** — 3 new, 1 known upstream |
| 6 | `TimeoutInfinite` transactions fail `Utils.validateTimebounds` | Low | API consistency | no | 🔴 **Open** — two SDK APIs disagree |
| 7 | Coverage retargeted to end-user-distinct surface | None (harness) | test coverage | no | 🟡 **In progress** — see revised scope |
| 8 | StrKey encoders emit strkeys the SDK itself rejects | Low | input validation | no | 🔴 **Open** — no length validation on encode |
| 9 | Harness housekeeping | None (harness) | tooling | no | 🟡 **Open** — deliberately deferred |
| 10 | Reproducibility options considered and declined | None (harness) | tooling | no | 📋 **Decided** — revisit only on the stated triggers |

**Blocks?** means: would this stop `/test-latest-sdk` calling a run clean. Only two things do — a test failure with no `knownFailures` entry in [`reports/baseline.json`](reports/baseline.json), and a symbol new in the version under test with no behavior test. Everything currently open is real work that does not gate a release. Nothing outstanding blocks today.

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
