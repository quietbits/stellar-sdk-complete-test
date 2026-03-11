# Stellar JS SDK API Compatibility Test Harness

This repository is a test-only project for validating public API compatibility of `@stellar/stellar-sdk` during refactors (especially changes affecting `@stellar/stellar-base` and related internals).

## Goal

Catch breaking changes early by testing:

- Exported public API surface
- Class and method surface stability
- Transaction and operation behavior
- Error and validation paths
- RPC and Horizon response parsing
- Snapshot-based serialization stability

## Tech Stack

- pnpm
- TypeScript
- Vitest
- `@stellar/stellar-sdk`
- nock (mocked HTTP responses)

## Quick Start

1. Install dependencies:

```bash
pnpm install
```

2. Run full test suite:

```bash
pnpm test
```

3. Run in watch mode:

```bash
pnpm test:watch
```

4. Run coverage:

```bash
pnpm test:coverage
```

## Snapshot Tests (Optional)

Snapshot tests are isolated in a dedicated file and can be run independently.

- Run snapshot tests only:

```bash
pnpm test:snapshots
```

- Update snapshots intentionally:

```bash
pnpm test:snapshots:update
```

## Refactor Validation Workflow

Use this loop when refactoring internals and validating compatibility:

1. Run baseline tests:

```bash
pnpm test
```

2. Replace `@stellar/stellar-base` (or other internal dependency under test) with your refactored version.

3. Re-run tests:

```bash
pnpm test
```

4. Investigate any failures as potential API or behavior regressions.

## Test Files

- `src/sdk-api-surface.test.ts`: public exports and namespace surface locks
- `src/sdk-method-surface.test.ts`: class/object method surface locks
- `src/sdk-core-behavior.test.ts`: operation and transaction behavior coverage
- `src/sdk-mocked-responses.test.ts`: RPC/Horizon mocked response and error cases
- `src/sdk-domain-services.test.ts`: WebAuth, Federation, StellarToml behaviors
- `src/sdk-snapshots.test.ts`: optional golden snapshots for deterministic outputs

## Notes

- This harness prioritizes API compatibility confidence over UI concerns.
- Keep snapshots deterministic; avoid random/time-based inputs in snapshot tests.
- If you intentionally change behavior, update tests and snapshots together with clear rationale.
