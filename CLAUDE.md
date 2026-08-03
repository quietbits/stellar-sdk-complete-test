# stellar-sdk-complete-test

## Purpose

**This repo exists to fully test the end-user experience of `@stellar/stellar-sdk`.**

The subject under test is the **published npm package**, consumed as a real application consumes it: installed from the registry, reached only through its public API, across Node/Deno/Bun, real-browser bundles, the installed CLI, and npm/pnpm/Yarn classic/Yarn Berry (PnP).

It is **not** a replacement for [`js-stellar-sdk`](https://github.com/stellar/js-stellar-sdk)'s own suite (~125 unit/e2e files testing `src/` for implementation correctness). Different subject; duplicating it adds little.

## Before adding a test

1. Check whether `js-stellar-sdk/test/` already covers it — run `node .claude/skills/test-latest-sdk/scripts/coverage-audit.mjs --vs-upstream`, which splits the backlog into *covered upstream* (deprioritize) and *no upstream test* (write first). If upstream covers it and the behavior is a pure function with no packaging or runtime dimension, the marginal value here is low.
2. Prefer, in order: public API with **no** upstream test; **malformed or hostile input** through public decoders; **packaging / module format**; **cross-runtime divergence** (Buffer, crypto, `fetch`, XDR).
3. Prefer external ground truth — official SEP vectors, upstream fixtures — over asserting the SDK agrees with itself. A test that signs with `signMessage` and verifies with `verifyMessage` passes even if both drift from the spec.
4. Cover failure paths, not just happy paths: invalid input, missing capability, boundary values.
5. Run new tests on **all three** runtimes and keep `npm run typecheck` at its current error count.

## Hard rules

- **Never modify an existing file under `tests/` to make a run pass.** Those expectations are the measurement. Adding a new test file is fine; rewriting an assertion to go green is not. If a lock looks outdated, report it.
- **Never write results from memory.** Save command output, then transcribe. Report what actually ran, including anything skipped.
- Do not codify a known defect as expected behavior. Record it in `ISSUES.md` and leave it unasserted, or pin it with an explicit comment saying it is a deviation.
- **Only published versions.** The target must resolve from the npm registry. Never repoint the harness at a git branch, a local build, a tarball, or a `file:`/`link:` dependency — `reports/baseline.json` is keyed to an immutable published version and the packaging axis measures what the registry ships. Unpublished changes belong in `js-stellar-sdk`'s own suite.

## Where things live

- `ISSUES.md` — every finding, with a `Blocks?` column. Issue 7 explains why coverage targets end-user-distinct surface rather than every symbol.
- **Issue numbers are permanent.** They are cited from `tests/`, `reports/`, and the skill, and test files are frozen — so an issue is never deleted or renumbered, and every number must keep resolving. When one is verified fixed in a published version, **condense it in place**: keep the number, title, severity, a short what-it-was, the version that fixed it, and anything other issues still reference; drop reproduction commands, breakdown tables, and proposed fixes, which remain in `git log -p ISSUES.md`. Decision records (issue 10) and issues with a still-open half (issue 1, pending issue 12) keep their full text.
- `reports/baseline.json` — pinned version, toolchain, expected pass/fail, known failures. **The single source of truth for current status**; do not duplicate those numbers elsewhere.
- `reports/<version>.md` — one report per tested SDK version.
- `/test-latest-sdk` — the full release-test run (`.claude/skills/test-latest-sdk/`).

The coverage backlog count is a **progress signal, not a target**. A nonzero backlog is not a defect.

Markdown here is not hand-wrapped: one continuous line per paragraph, list item, and table row.
