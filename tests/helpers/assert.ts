/**
 * Portable test shim.
 *
 * Goal: let the ported test files keep Vitest's `expect(...).matcher()` style
 * verbatim while running natively on Node, Deno, and Bun via `node:test` +
 * `node:assert`. Only the matchers actually used by this suite are implemented.
 *
 * Hooks are re-exported from `node:test`, with Vitest's `beforeAll`/`afterAll`
 * aliased onto `node:test`'s `before`/`after`.
 */
import assert from "node:assert/strict";
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it as nodeIt,
  test as nodeTest,
} from "node:test";

export { describe, beforeEach, afterEach };
// Vitest names: beforeAll/afterAll map to node:test's before/after.
export const beforeAll = before;
export const afterAll = after;

/**
 * Vitest's `it.each` / `test.each`. `node:test` has no equivalent, so we attach
 * a compatible `.each` onto its `it`/`test`. Supports the printf-style name
 * tokens this suite uses (`%s`/`%d`/`%i`/`%f`/`%j`/`%o`, `%#` index, `%%`).
 */
type AnyTestFn = (...args: unknown[]) => unknown;
type Runner = (name: string, fn: AnyTestFn) => unknown;
type EachRunner = Runner & {
  each: (cases: readonly unknown[]) => (template: string, fn: AnyTestFn) => void;
};

function formatName(template: string, args: unknown[], index: number): string {
  let cursor = 0;
  return template.replace(/%[sdifjo#%]/g, (token) => {
    if (token === "%%") return "%";
    if (token === "%#") return String(index);
    const arg = args[cursor++];
    if (token === "%j" || token === "%o") return JSON.stringify(arg);
    return String(arg);
  });
}

function attachEach(runner: Runner): EachRunner {
  const withEach = runner as EachRunner;
  withEach.each =
    (cases: readonly unknown[]) =>
    (template: string, fn: AnyTestFn): void => {
      cases.forEach((testCase, index) => {
        const args = Array.isArray(testCase) ? testCase : [testCase];
        runner(formatName(template, args, index), () => fn(...args));
      });
    };
  return withEach;
}

export const it = attachEach(nodeIt as Runner);
export const test = attachEach(nodeTest as Runner);

type ErrorMatcher = string | RegExp | (new (...args: never[]) => Error);

function formatMessage(base: string, custom?: string): string {
  return custom ? `${custom}: ${base}` : base;
}

function throwsValidator(expected?: ErrorMatcher): (err: unknown) => boolean {
  return (err: unknown): boolean => {
    if (expected === undefined) {
      return true;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (typeof expected === "string") {
      return message.includes(expected);
    }
    if (expected instanceof RegExp) {
      return expected.test(message);
    }
    return err instanceof expected;
  };
}

function getPath(target: unknown, path: string): { found: boolean; value: unknown } {
  let current: unknown = target;
  for (const key of path.split(".")) {
    if (current == null || !(key in (current as object))) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}

class Matchers {
  protected readonly actual: unknown;
  protected readonly message: string | undefined;
  protected readonly negated: boolean;

  constructor(actual: unknown, message: string | undefined, negated: boolean) {
    this.actual = actual;
    this.message = message;
    this.negated = negated;
  }

  private check(pass: boolean, detail: string): void {
    const ok = this.negated ? !pass : pass;
    assert.ok(ok, formatMessage(detail, this.message));
  }

  toBe(expected: unknown): void {
    if (this.negated) {
      assert.notStrictEqual(this.actual, expected, this.message);
    } else {
      assert.strictEqual(this.actual, expected, this.message);
    }
  }

  toEqual(expected: unknown): void {
    if (this.negated) {
      assert.notDeepStrictEqual(this.actual, expected, this.message);
    } else {
      assert.deepStrictEqual(this.actual, expected, this.message);
    }
  }

  toStrictEqual(expected: unknown): void {
    this.toEqual(expected);
  }

  toThrow(expected?: ErrorMatcher): void {
    if (typeof this.actual !== "function") {
      throw new TypeError("expect(...).toThrow requires a function");
    }
    const fn = this.actual as () => unknown;
    if (this.negated) {
      assert.doesNotThrow(fn, this.message);
    } else {
      assert.throws(fn, throwsValidator(expected), this.message);
    }
  }

  toHaveLength(length: number): void {
    const actualLength = (this.actual as { length?: number })?.length;
    this.check(actualLength === length, `expected length ${actualLength} to be ${length}`);
  }

  toBeInstanceOf(cls: new (...args: never[]) => unknown): void {
    this.check(this.actual instanceof cls, `expected value to be instance of ${cls.name}`);
  }

  toBeDefined(): void {
    this.check(this.actual !== undefined, "expected value to be defined");
  }

  toBeUndefined(): void {
    this.check(this.actual === undefined, "expected value to be undefined");
  }

  toBeNull(): void {
    this.check(this.actual === null, "expected value to be null");
  }

  toBeTruthy(): void {
    this.check(Boolean(this.actual), "expected value to be truthy");
  }

  toBeFalsy(): void {
    this.check(!this.actual, "expected value to be falsy");
  }

  toContain(item: unknown): void {
    const container = this.actual as string | unknown[];
    this.check(container.includes(item as never), "expected container to include item");
  }

  toHaveProperty(path: string, value?: unknown): void {
    const { found, value: actualValue } = getPath(this.actual, path);
    if (value === undefined) {
      this.check(found, `expected property "${path}" to exist`);
      return;
    }
    this.check(found && actualValue === value, `expected property "${path}" to equal value`);
  }
}

interface AsyncMatchers {
  toThrow(expected?: ErrorMatcher): Promise<void>;
}

class Expectation extends Matchers {
  constructor(actual: unknown, message?: string) {
    super(actual, message, false);
  }

  get not(): Matchers {
    return new Matchers(this.actual, this.message, true);
  }

  get rejects(): AsyncMatchers {
    return {
      toThrow: async (expected?: ErrorMatcher): Promise<void> => {
        await assert.rejects(
          this.actual as Promise<unknown>,
          throwsValidator(expected),
          this.message,
        );
      },
    };
  }

  get resolves(): { toBeDefined(): Promise<void> } {
    return {
      toBeDefined: async (): Promise<void> => {
        const resolved = await (this.actual as Promise<unknown>);
        assert.ok(resolved !== undefined, this.message);
      },
    };
  }
}

export function expect(actual: unknown, message?: string): Expectation {
  return new Expectation(actual, message);
}
