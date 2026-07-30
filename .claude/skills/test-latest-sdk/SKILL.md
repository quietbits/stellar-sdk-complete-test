---
name: test-latest-sdk
description: Run the full multi-runtime and multi-package-manager test matrix in this repo against the latest published @stellar/stellar-sdk release. Reviews the changelog, runs the suite unmodified, diffs the outcome against the committed baseline, audits whether new SDK APIs have behavior tests, and writes a report to reports/. Use when validating a new SDK version.
disable-model-invocation: true
---

Validate the latest published `@stellar/stellar-sdk` against both axes of this harness and record the outcome in `reports/`.

## Rules

1. **Never modify an existing file under `tests/`.** The expectations *are* the measurement. If a lock looks outdated, report it — do not update it. Adding a **new** test file is allowed, but only in step 9, after the result has been recorded, and only with the user's approval.
2. **Never write results from memory.** Save raw output to the scratchpad, then transcribe. Report exactly what ran, including anything skipped.
3. **Stop at every ⏸ gate** and wait for the user.
4. Report failures plainly. Do not describe a run as clean when it is not.

## Step 1 — Preflight

Record actual versions and check the minimums:

```bash
node -v; deno -v; bun -v; npm -v; pnpm -v; yarn -v; corepack -v
```

| Tool | Minimum | If unmet |
|------|---------|----------|
| Node | 22.18 | **Abort.** Below this there is no native TS type-stripping and `test:node` cannot run. |
| Deno | 2.0 | Report the Deno axis as SKIPPED. |
| Bun | 1.0 | Report the Bun axis as SKIPPED. |
| pnpm | 9 | **Abort** — used for the root install. |
| npm / yarn / corepack | any | Report that sandbox as SKIPPED (`scripts/test-pms.sh` already does this). |

Keep these versions; every report must list them.

## Step 2 — Resolve the target version

```bash
npm view @stellar/stellar-sdk dist-tags --json
```

Read the current pin from `package.json`. Report both to the user:

- latest published version
- currently pinned version
- whether this would be an upgrade, a re-test of the same version, or a downgrade

⏸ **Ask the user to confirm before testing.** Do not proceed unprompted.

## Step 3 — Review the changelog

```bash
curl -sS --max-time 30 https://raw.githubusercontent.com/stellar/js-stellar-sdk/main/CHANGELOG.md
```

Sections are `## [vX.Y.Z]` headings. Extract **only** the versions between the pinned version (exclusive) and the target (inclusive) — not the whole file.

Summarize for the user:

- breaking changes
- new or removed public API (these predict surface-lock drift)
- fixes that touch anything this harness covers: XDR, module format or packaging, Horizon/RPC parsing, auth, types

If the changelog is unreachable, say so and continue — do not invent its contents.

## Step 4 — Pin the target version

Update the version in all five files:

- `package.json`
- `package-managers/npm/package.json`
- `package-managers/pnpm/package.json`
- `package-managers/yarn-classic/package.json`
- `package-managers/yarn-berry/package.json`

Use an exact version, never a range. Then install clean, so a stale tree cannot mask or invent failures:

```bash
rm -rf node_modules && pnpm install
node -e "console.log(require('./node_modules/@stellar/stellar-sdk/package.json').version)"
```

Confirm the printed version matches the target before running anything.

Also record the resolved transitive versions — the SDK's own dependencies use `^` ranges, so the same SDK version can resolve differently over time:

```bash
find node_modules/.pnpm -maxdepth 1 -name "@stellar+js-xdr@*" -o -maxdepth 1 -name "axios@*" -o -maxdepth 1 -name "@noble+*"
```

## Step 5 — Run the matrix, unmodified

Deterministic first, so testnet flakiness can never be misfiled as an SDK regression:

```bash
STELLAR_LIVE=0 npm run test:node
STELLAR_LIVE=0 npm run test:deno
STELLAR_LIVE=0 npm run test:bun
```

Then the live pass, the package-manager axis, and the type check:

```bash
npm run test:node && npm run test:deno && npm run test:bun
npm run test:pm
npx tsc --noEmit 2>&1 | grep -cE "error TS"
```

Capture each command's full output to the scratchpad. For any failure, capture the assertion diff — the failing test's **name** is what the baseline matches on.

`npm run test:pm` installs into `package-managers/*/`; those lockfiles and `node_modules` are gitignored by design, because that axis tests fresh resolution. Leave them uncommitted.

## Step 6 — Diff against the baseline

Read `reports/baseline.json` and classify every failure:

- **Expected** — matches a `knownFailures` entry. Not a finding.
- **New** — a failure with no baseline entry. **This is a finding.**
- **Newly passing** — a baseline entry that now passes. Also report it; it means something was fixed upstream.

Compare the `tsc` error count too, and diff surface-lock changes by **set difference** (added vs removed symbols), not by reading the truncated assertion output — a truncated diff can hide a removal, and removals are breaking while additions are not.

## Step 7 — Audit test coverage of new code

Every symbol new in this version needs a **behavior** test. Appearing in a surface lock only proves it exists.

```bash
node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs
```

It enumerates the live public surface (root, `/contract`, `/rpc`, including statics and prototype methods), diffs it against `reports/surface-inventory.json` to find what is genuinely new, and checks whether each new symbol is referenced anywhere in `tests/` outside the two surface-lock files. Exit code 1 means new symbols lack behavior tests. Add `--list-backlog` to print the pre-existing gaps.

Read the code, not the changelog, to decide what is new — the script does this by construction. Then use the changelog as a **hint** for what the script cannot see:

- **Changed behavior on existing symbols** — new optional parameters, changed defaults, fixed error paths. No new symbol appears, so only the changelog will point at these. Check whether existing tests actually pin the new behavior.
- **Removals.** The script reports these separately as breaking changes. They are never a coverage gap; report them as a finding.

Two limits to state honestly in the report rather than paper over:

- The reference check is word-boundary name matching. Short names (`sleep`, `none`, `init`) can collide, and a symbol exercised indirectly is invisible to it. **Verify every reported gap by reading the test file** before calling it uncovered.
- The pre-existing backlog is large and is **not** blocking. Only new-in-this-version gaps block the verdict.

## Step 8 — Write the report

Copy `reports/TEMPLATE.md` to `reports/<version>.md` and fill every section from the captured output. Keep the template's headings and order exactly; the value of these reports is that any two are comparable.

## Step 9 — Report and ask

Summarize: the verdict, new findings, newly-passing baseline entries, coverage gaps for new symbols, and anything skipped.

⏸ **Ask the user how to address any new findings and any coverage gaps.** Do not fix findings, write tests, update `reports/baseline.json`, or edit `ISSUES.md` unprompted.

If the user approves writing tests for the gaps:

- **New files only.** Never edit an existing test file. Name by domain, matching the existing `sdk-<area>.test.ts` convention.
- **Prefer external ground truth** — official spec vectors, upstream fixtures — over asserting that the SDK agrees with itself. A test that signs with `signMessage` and verifies with `verifyMessage` passes even if both drift from the spec.
- Cover the failure paths too, not just the happy path: invalid input, missing capability, boundary values.
- Run the new tests on **all three** runtimes, and re-run `npx tsc --noEmit` — new tests must not raise the error count.
- Update the report's coverage section with what was added.

If the user adopts the new version, then update `reports/baseline.json` — its `sdkVersion`, `lastVerified`, counts, and `knownFailures` — and re-snapshot the surface:

```bash
node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs --update-inventory
```

Never update the baseline to paper over a new failure, and never re-snapshot the inventory to make a coverage gap disappear. Each baseline entry needs a recorded reason.
