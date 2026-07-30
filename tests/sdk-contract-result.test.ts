// contract.Ok / contract.Err -- the Rust-style Result pair used by generated contract clients -- plus the contract module's exported constants.
//
// The interesting behaviour is the failure direction: unwrapping the wrong arm must throw rather than return undefined, because a generated client relies on that to surface a contract error instead of silently continuing with a missing value.
import { Err, DEFAULT_TIMEOUT, NULL_ACCOUNT, Ok } from "@stellar/stellar-sdk/contract";
import { StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

describe("stellar-sdk contract Result types", () => {
  describe("Ok", () => {
    it("reports itself as ok and not err", () => {
      const result = new Ok(42);
      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
    });

    it("unwraps to the wrapped value", () => {
      expect(new Ok(42).unwrap()).toBe(42);
      expect(new Ok("text").unwrap()).toBe("text");
    });

    it("exposes the value as a readonly property", () => {
      expect(new Ok(42).value).toBe(42);
    });

    it("throws when unwrapped as an error", () => {
      expect(() => new Ok(42).unwrapErr()).toThrow("No error");
    });

    // A falsy payload must still be a successful result: `isOk` cannot be derived from truthiness.
    it("treats falsy values as successful", () => {
      expect(new Ok(0).isOk()).toBe(true);
      expect(new Ok(0).unwrap()).toBe(0);
      expect(new Ok(null).isOk()).toBe(true);
      expect(new Ok(null).unwrap()).toBeNull();
      expect(new Ok(undefined).isOk()).toBe(true);
      expect(new Ok(undefined).unwrap()).toBeUndefined();
    });
  });

  describe("Err", () => {
    it("reports itself as err and not ok", () => {
      const result = new Err({ message: "boom" });
      expect(result.isErr()).toBe(true);
      expect(result.isOk()).toBe(false);
    });

    it("unwraps to the wrapped error", () => {
      expect(new Err({ message: "boom" }).unwrapErr().message).toBe("boom");
    });

    it("exposes the error as a readonly property", () => {
      expect(new Err({ message: "boom" }).error.message).toBe("boom");
    });

    // Throwing here is what makes an unhandled contract error loud instead of a silent undefined.
    it("throws its message when unwrapped as a value", () => {
      expect(() => new Err({ message: "boom" }).unwrap()).toThrow("boom");
    });

    it("preserves extra fields on the error object", () => {
      const result = new Err({ message: "boom", code: 7 });
      expect(result.unwrapErr().code).toBe(7);
    });
  });

  describe("the two arms are mutually exclusive", () => {
    it("never reports both ok and err", () => {
      const results = [new Ok(1), new Err({ message: "e" })];
      for (const result of results) {
        expect(result.isOk()).toBe(!result.isErr());
      }
    });
  });

  describe("contract constants", () => {
    it("DEFAULT_TIMEOUT is five minutes in seconds", () => {
      expect(DEFAULT_TIMEOUT).toBe(300);
    });

    // The null account is the all-zero ed25519 key, used as a source for read-only simulation.
    it("NULL_ACCOUNT is a valid all-zero ed25519 address", () => {
      expect(NULL_ACCOUNT).toBe("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
      expect(StrKey.isValidEd25519PublicKey(NULL_ACCOUNT)).toBe(true);
      expect(StrKey.decodeEd25519PublicKey(NULL_ACCOUNT).equals(Buffer.alloc(32))).toBe(true);
    });
  });
});
