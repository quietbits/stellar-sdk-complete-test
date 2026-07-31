# `@stellar/stellar-sdk@<VERSION>` — test report

<!--
Written by /test-latest-sdk. Keep these headings and their order exactly: the
value of these reports is that any two versions are directly comparable.
Fill every field from captured command output, never from memory. If something
was not run, write SKIPPED and why — never leave a field implying it passed.
-->

| | |
|---|---|
| SDK version | `<VERSION>` |
| Previous baseline | `<PREVIOUS VERSION>` |
| Date | `<YYYY-MM-DD>` |
| Verdict | `<PASS / PASS WITH KNOWN FAILURES / NEW FINDINGS>` |

## Toolchain

| Tool | Version |
|------|---------|
| Node | |
| Deno | |
| Bun | |
| npm | |
| pnpm | |
| Yarn classic | |
| Yarn Berry | |
| corepack | |
| Chrome / Chromium | |

## Resolved dependencies

Recorded because the SDK's own dependencies use `^` ranges, so the same SDK version can resolve a different tree over time.

| Package | Resolved |
|---------|----------|
| `@stellar/js-xdr` | |
| `axios` | |
| `@noble/*` | |

## Changelog review

Versions crossed: `<FROM>` → `<TO>`

- **Breaking changes:**
- **New / removed public API:**
- **Fixes touching covered surface:**

## Results

### Runtime axis

| Runtime | Deterministic (`STELLAR_LIVE=0`) | Live | Notes |
|---------|----------------------------------|------|-------|
| Node | | | |
| Deno | | | |
| Bun | | | |

### Package-manager axis

| Manager | Modules | CLI bin |
|---------|---------|---------|
| npm | | |
| pnpm | | |
| yarn-classic | | |
| yarn-berry (PnP) | | |

### Browser axis

| Artifact | Result |
|----------|--------|
| `stellar-sdk.js` | |
| `stellar-sdk.min.js` | |
| `stellar-sdk-axios.js` | |
| `stellar-sdk-axios.min.js` | |

### CLI and artifact axis

| Check | Result |
|-------|--------|
| `stellar-js --help` / `--version` | |
| Invalid arguments | |
| Generate from local WASM | |
| Generated package type check and load | |
| Exports, bin and `dist/` artifact inventory | |

### Type check

| | |
|---|---|
| `tsc --noEmit` errors | |
| Change vs baseline | |

## Baseline diff

Diffed against [`baseline.json`](baseline.json), which holds the pinned version, verified toolchain, and expected status. This report is a dated snapshot of one run; the baseline is the current-status source of truth.

### Expected failures (matched baseline)

<!-- Not findings. List so the report is self-contained. -->

### New failures

<!-- FINDINGS. One entry each: test name, file, assertion, why it is new.
     Write "None." if there were none. -->

### Newly passing

<!-- Baseline entries that now pass — something was fixed upstream.
     Write "None." if there were none. -->

## Coverage of new code

From `coverage-audit.mjs`, which diffs the live public surface against `surface-inventory.json`. Only new-in-this-version gaps block the verdict.

| | |
|---|---|
| Public symbols | |
| New since last inventory | |
| New symbols **without** a behavior test | |
| Pre-existing backlog (not blocking) | |

### New symbols and their coverage

<!-- One line per new symbol: covered / GAP, and which test file covers it. -->

### Behavior changes to existing symbols

<!-- From the changelog, which is the only thing that sees these -- a changed default or
     a fixed error path adds no new symbol. Note whether existing tests pin the new
     behavior. Write "None identified." if so. -->

### Tests added this run

<!-- New files only, with what they cover and which runtimes they were run on.
     Write "None." if nothing was added. -->

## Surface changes

Compared by set difference, not by reading truncated assertion output.

| Lock | Before → after | Added | Removed |
|------|----------------|-------|---------|
| root exports | | | |
| `contract` exports | | | |
| `Keypair` instance | | | |

Removals are breaking; additions are not.

## Skipped

<!-- Anything not run, and why. Write "Nothing skipped." if applicable. -->

## Follow-ups

<!-- What the user decided. Link ISSUES.md entries created. -->
