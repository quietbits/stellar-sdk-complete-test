// Large-integer types: Hyper / UnsignedHyper (64-bit) and the XdrLargeInt family (Int128/256, Uint128/256).
//
// The bounds are asserted as exact decimal strings rather than computed from the SDK's own MAX_VALUE, so an off-by-one or a sign error in the type definitions cannot pass by agreeing with itself. Every value below is the mathematical two's-complement bound for its width.
//
// The conversion checks matter more than the arithmetic: these types exist to move values across the JS-number boundary, where silently losing precision is worse than throwing.
import { Hyper, Int128, Int256, Uint128, Uint256, UnsignedHyper, XdrLargeInt } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

interface Bounds {
  name: string;
  type: { MAX_VALUE: unknown; MIN_VALUE: unknown };
  max: string;
  min: string;
}

const BOUNDS: Bounds[] = [
  { name: "Hyper (i64)", type: Hyper, max: "9223372036854775807", min: "-9223372036854775808" },
  { name: "UnsignedHyper (u64)", type: UnsignedHyper, max: "18446744073709551615", min: "0" },
  {
    name: "Int128",
    type: Int128,
    max: "170141183460469231731687303715884105727",
    min: "-170141183460469231731687303715884105728",
  },
  {
    name: "Uint128",
    type: Uint128,
    max: "340282366920938463463374607431768211455",
    min: "0",
  },
  {
    name: "Int256",
    type: Int256,
    max: "57896044618658097711785492504343953926634992332820282019728792003956564819967",
    min: "-57896044618658097711785492504343953926634992332820282019728792003956564819968",
  },
  {
    name: "Uint256",
    type: Uint256,
    max: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    min: "0",
  },
];

describe("stellar-sdk large integers", () => {
  describe("two's-complement bounds", () => {
    for (const { name, type, max, min } of BOUNDS) {
      it(`${name} reports the exact width bounds`, () => {
        expect(String(type.MAX_VALUE)).toBe(max);
        expect(String(type.MIN_VALUE)).toBe(min);
      });
    }

    // Unsigned types must floor at zero; a signed MIN_VALUE here would mean the wrong base type was used. Accessed through the table because Uint128/Uint256 inherit MIN_VALUE from the untyped js-xdr base, so a direct Uint128.MIN_VALUE does not type-check (ISSUES.md issue 2).
    it("exactly the unsigned types have a zero lower bound", () => {
      const unsigned = BOUNDS.filter((bounds) => bounds.min === "0");
      expect(unsigned.map((bounds) => bounds.name)).toEqual([
        "UnsignedHyper (u64)",
        "Uint128",
        "Uint256",
      ]);
      for (const { type } of unsigned) {
        expect(String(type.MIN_VALUE)).toBe("0");
      }
    });
  });

  describe("Hyper and UnsignedHyper bit halves", () => {
    // fromBits takes (low, high): the first argument is the low 32 bits.
    it("builds a value from its low word", () => {
      expect(Hyper.fromBits(1, 0).toString()).toBe("1");
      expect(UnsignedHyper.fromBits(5, 0).toString()).toBe("5");
    });

    it("exposes high and low halves separately", () => {
      const value = Hyper.fromBits(0, 1);
      expect(value.high).toBe(1);
      expect(value.low).toBe(0);
      // high = 1, low = 0 is exactly 2^32.
      expect(value.toString()).toBe("4294967296");
    });

    it("round-trips the halves of an unsigned value", () => {
      const value = UnsignedHyper.fromBits(7, 3);
      expect(value.low).toBe(7);
      expect(value.high).toBe(3);
      expect(value.toString()).toBe(String(3n * 2n ** 32n + 7n));
    });
  });

  describe("XdrLargeInt type tags", () => {
    const valid = ["i64", "u64", "i128", "u128", "i256", "u256", "timepoint", "duration"];

    for (const type of valid) {
      it(`recognises ${type} as a type`, () => {
        expect(XdrLargeInt.isType(type)).toBe(true);
      });
    }

    it("rejects an unknown type tag", () => {
      expect(XdrLargeInt.isType("nope")).toBe(false);
      expect(XdrLargeInt.isType("u32")).toBe(false);
      expect(XdrLargeInt.isType("")).toBe(false);
    });

    it("maps an ScVal discriminant to its type tag", () => {
      expect(XdrLargeInt.getType("scvI128")).toBe("i128");
      expect(XdrLargeInt.getType("scvU256")).toBe("u256");
      expect(XdrLargeInt.getType("scvTimepoint")).toBe("timepoint");
    });

    it("returns undefined for a discriminant that is not a large int", () => {
      expect(XdrLargeInt.getType("bogus")).toBeUndefined();
      expect(XdrLargeInt.getType("scvBool")).toBeUndefined();
    });
  });

  describe("XdrLargeInt conversions", () => {
    it("converts to bigint, number, and string", () => {
      const value = new XdrLargeInt("i128", 42);
      expect(value.toBigInt()).toBe(42n);
      expect(value.toNumber()).toBe(42);
      expect(value.toString()).toBe("42");
      expect(String(value.valueOf())).toBe("42");
    });

    it("serialises to a value/type pair via toJSON", () => {
      expect(new XdrLargeInt("u256", 7).toJSON()).toEqual({ value: "7", type: "u256" });
      expect(new XdrLargeInt("i64", -3).toJSON()).toEqual({ value: "-3", type: "i64" });
    });

    // The reason these types exist: refusing an unrepresentable conversion instead of silently truncating.
    it("throws rather than lose precision in toNumber", () => {
      const tooBig = new XdrLargeInt("i128", "170141183460469231731687303715884105727");
      expect(() => tooBig.toNumber()).toThrow("not in range for Number");
    });

    it("rejects a negative value for an unsigned type", () => {
      expect(() => new XdrLargeInt("u64", -1)).toThrow("expected a positive value");
      expect(() => new XdrLargeInt("u128", -1)).toThrow("expected a positive value");
    });

    it("rejects a value wider than its declared type", () => {
      expect(() => new XdrLargeInt("i64", "9223372036854775808")).toThrow("out of range");
      expect(() => new XdrLargeInt("i64", Hyper.MIN_VALUE.toString() + "0")).toThrow("out of range");
    });

    it("accepts the exact boundary values of its declared type", () => {
      expect(new XdrLargeInt("i64", "9223372036854775807").toBigInt()).toBe(9223372036854775807n);
      expect(new XdrLargeInt("i64", "-9223372036854775808").toBigInt()).toBe(-9223372036854775808n);
      expect(new XdrLargeInt("u64", "18446744073709551615").toBigInt()).toBe(18446744073709551615n);
      expect(new XdrLargeInt("u64", 0).toBigInt()).toBe(0n);
    });
  });
});
