// Claimant and its claim-predicate constructors.
//
// Every predicate is asserted through its XDR discriminant and decoded arms rather than by comparing objects, so the test pins the wire encoding a validator will actually see. Predicates that nest (and/or/not) are checked by reading their children back out.
//
// UPSTREAM OVERLAP: substantial. js-stellar-sdk has test/unit/base/claimant.test.ts covering the constructor, the unconditional default, and every predicate constructor. This file adds little beyond exercising the published artifact on three runtimes; keep that in mind before extending it. See ISSUES.md issue 7.
import { Claimant, Keypair, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

const DESTINATION = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";

describe("stellar-sdk Claimant", () => {
  describe("predicate defaults", () => {
    // The predicate is optional and documented to default to unconditional.
    it("defaults to an unconditional predicate", () => {
      const claimant = new Claimant(DESTINATION);
      expect(claimant.predicate.switch().name).toBe("claimPredicateUnconditional");
    });

    it("keeps the destination it was constructed with", () => {
      expect(new Claimant(DESTINATION).destination).toBe(DESTINATION);
    });

    it("returns the predicate it was constructed with", () => {
      const predicate = Claimant.predicateBeforeAbsoluteTime("1700000000");
      const claimant = new Claimant(DESTINATION, predicate);
      expect(claimant.predicate.switch().name).toBe("claimPredicateBeforeAbsoluteTime");
      expect(claimant.predicate.absBefore().toString()).toBe("1700000000");
    });
  });

  describe("time predicates", () => {
    it("builds a before-absolute-time predicate", () => {
      const predicate = Claimant.predicateBeforeAbsoluteTime("1700000000");
      expect(predicate.switch().name).toBe("claimPredicateBeforeAbsoluteTime");
      expect(predicate.absBefore().toString()).toBe("1700000000");
    });

    // Absolute times are unix seconds and must survive past the 32-bit range.
    it("keeps an absolute time beyond 32 bits intact", () => {
      const predicate = Claimant.predicateBeforeAbsoluteTime("9223372036854775807");
      expect(predicate.absBefore().toString()).toBe("9223372036854775807");
    });

    it("builds a before-relative-time predicate", () => {
      const predicate = Claimant.predicateBeforeRelativeTime("300");
      expect(predicate.switch().name).toBe("claimPredicateBeforeRelativeTime");
      expect(predicate.relBefore().toString()).toBe("300");
    });
  });

  describe("logical predicates", () => {
    const left = Claimant.predicateBeforeRelativeTime("100");
    const right = Claimant.predicateBeforeAbsoluteTime("1700000000");

    it("builds an and predicate holding both operands in order", () => {
      const predicate = Claimant.predicateAnd(left, right);
      expect(predicate.switch().name).toBe("claimPredicateAnd");

      const operands = predicate.andPredicates();
      expect(operands).toHaveLength(2);
      expect(operands[0].switch().name).toBe("claimPredicateBeforeRelativeTime");
      expect(operands[1].switch().name).toBe("claimPredicateBeforeAbsoluteTime");
    });

    it("builds an or predicate holding both operands in order", () => {
      const predicate = Claimant.predicateOr(left, right);
      expect(predicate.switch().name).toBe("claimPredicateOr");

      const operands = predicate.orPredicates();
      expect(operands).toHaveLength(2);
      expect(operands[0].switch().name).toBe("claimPredicateBeforeRelativeTime");
      expect(operands[1].switch().name).toBe("claimPredicateBeforeAbsoluteTime");
    });

    it("builds a not predicate wrapping its operand", () => {
      const predicate = Claimant.predicateNot(left);
      expect(predicate.switch().name).toBe("claimPredicateNot");

      const inner = predicate.notPredicate();
      if (inner === null || inner === undefined) {
        throw new Error("expected the not predicate to wrap an operand");
      }
      expect(inner.switch().name).toBe("claimPredicateBeforeRelativeTime");
      expect(inner.relBefore().toString()).toBe("100");
    });

    it("nests logical predicates", () => {
      const predicate = Claimant.predicateAnd(Claimant.predicateNot(left), Claimant.predicateOr(left, right));
      const operands = predicate.andPredicates();
      expect(operands[0].switch().name).toBe("claimPredicateNot");
      expect(operands[1].switch().name).toBe("claimPredicateOr");
      expect(operands[1].orPredicates()).toHaveLength(2);
    });
  });

  describe("XDR round-trip", () => {
    it("survives toXDRObject and fromXDR with its predicate", () => {
      const original = new Claimant(DESTINATION, Claimant.predicateBeforeRelativeTime("42"));
      const restored = Claimant.fromXDR(original.toXDRObject());

      expect(restored.destination).toBe(DESTINATION);
      expect(restored.predicate.switch().name).toBe("claimPredicateBeforeRelativeTime");
      expect(restored.predicate.relBefore().toString()).toBe("42");
    });

    it("encodes to a decodable xdr.Claimant", () => {
      const claimant = new Claimant(Keypair.random().publicKey(), Claimant.predicateUnconditional());
      const base64 = claimant.toXDRObject().toXDR("base64");
      expect(xdr.Claimant.fromXDR(base64, "base64").switch().name).toBe("claimantTypeV0");
    });
  });
});
