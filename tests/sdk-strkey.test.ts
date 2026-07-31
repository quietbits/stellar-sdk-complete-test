// StrKey codecs and validators.
//
// The valid and invalid cases are the official test vectors from SEP-23, which states that implementations "must accept the following valid test cases and reject the invalid test cases" and warns that accepting the invalid ones "could in turn cause security problems". Using the spec's own vectors rather than round-tripping the SDK against itself is the point: a round-trip passes even when both directions are wrong in the same way.
//
// Four of the fifteen SEP-23 invalid vectors are currently ACCEPTED by the SDK. They are listed in INVALID_BUT_ACCEPTED below and deliberately not asserted here, because a test asserting the current behaviour would codify the defect. See ISSUES.md issue 5.
//
// UPSTREAM OVERLAP: js-stellar-sdk has test/unit/base/strkey.test.ts covering the valid SEP-23 vectors, round-trips, muxed accounts, signed-payload size bounds, and getVersionByteForPrefix. What is distinct here: it tests only 8 of the 15 invalid vectors, parks #15 as a known limitation, and has no encoder length cases at all. The three signed-payload cases below (ISSUES.md issue 5) are missed upstream for a structural reason -- its tests build an xdr.SignerKeyEd25519SignedPayload and then encode it, so the XDR writer always emits a correct length prefix and padding. That path cannot produce a mismatch; only decoding a hostile string can, which is the end-user direction this repo exists to probe.
//
// SOURCE: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

// Every SEP-23 vector encodes this same 32-byte ed25519 key / hash payload.
const PAYLOAD_HEX = "3f0c34bf93ad0d9971d04ccc90f705511c838aad9734a4a2fb0d7a03fc7fe89a";
const PAYLOAD = Buffer.from(PAYLOAD_HEX, "hex");

const ED25519 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
const MUXED_ID_0 = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ";
// id = 9223372036854775808, i.e. one past the maximum *signed* 64-bit integer.
const MUXED_ID_UNSIGNED = "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAJLK";
const SIGNED_PAYLOAD_32 =
  "PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAQACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IBZGM";
const SIGNED_PAYLOAD_29 =
  "PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAOQCAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUAAAAFGBU";
const LIQUIDITY_POOL = "LA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUPJN";
const CLAIMABLE_BALANCE = "BAAD6DBUX6J22DMZOHIEZTEQ64CVCHEDRKWZONFEUL5Q26QD7R76RGR4TU";

// The SEP-53 test-vector seed, reused here so the decoded bytes can be cross-checked against Keypair rather than only against StrKey's own encoder.
const SECRET_SEED = "SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW";

type Validator = (value: string) => boolean;

interface InvalidCase {
  reason: string;
  strkey: string;
  validator: Validator;
}

const INVALID: InvalidCase[] = [
  { reason: "ed25519 length is 5 bytes, not 32", strkey: "GAAAAAAAACGC6", validator: StrKey.isValidEd25519PublicKey },
  { reason: "unused trailing bit is not zero", strkey: "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUR", validator: StrKey.isValidMed25519PublicKey },
  { reason: "length congruent to 1 mod 8", strkey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZA", validator: StrKey.isValidEd25519PublicKey },
  { reason: "base-32 decodes to 36 bytes, not 35", strkey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUACUSI", validator: StrKey.isValidEd25519PublicKey },
  { reason: "invalid algorithm: low 3 bits of version byte are 7", strkey: "G47QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVP2I", validator: StrKey.isValidEd25519PublicKey },
  { reason: "length congruent to 6 mod 8", strkey: "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAJLKA", validator: StrKey.isValidMed25519PublicKey },
  { reason: "base-32 decodes to 44 bytes, not 43", strkey: "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAAV75I", validator: StrKey.isValidMed25519PublicKey },
  { reason: "muxed invalid algorithm: low 3 bits of version byte are 7", strkey: "M47QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ", validator: StrKey.isValidMed25519PublicKey },
  { reason: "base-32 padding bytes are not allowed", strkey: "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUK===", validator: StrKey.isValidMed25519PublicKey },
  { reason: "invalid checksum", strkey: "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUO", validator: StrKey.isValidMed25519PublicKey },
  { reason: "unused trailing 2 bits of the last symbol are not zero", strkey: "BAAD6DBUX6J22DMZOHIEZTEQ64CVCHEDRKWZONFEUL5Q26QD7R76RGR4TV", validator: StrKey.isValidClaimableBalance },
];

// SEP-23 requires these to be rejected; the SDK accepts them. Tracked as ISSUES.md issue 5 rather than asserted, so the suite never claims the current behaviour is correct.
const INVALID_BUT_ACCEPTED = [
  "PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAQACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IAAAAAAAAPM",
  "PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAOQCAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4Z2PQ",
  "PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAOQCAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DXFH6",
  "BAAT6DBUX6J22DMZOHIEZTEQ64CVCHEDRKWZONFEUL5Q26QD7R76RGXACA",
];

describe("stellar-sdk StrKey", () => {
  describe("SEP-23 valid vectors", () => {
    it("accepts and decodes a multiplexed account", () => {
      expect(StrKey.isValidMed25519PublicKey(MUXED_ID_0)).toBe(true);

      const decoded = StrKey.decodeMed25519PublicKey(MUXED_ID_0);
      // 32-byte ed25519 key followed by the 8-byte id, id = 0 here.
      expect(decoded).toHaveLength(40);
      expect(decoded.subarray(0, 32).toString("hex")).toBe(PAYLOAD_HEX);
      expect(decoded.subarray(32).toString("hex")).toBe("0000000000000000");
      expect(StrKey.encodeMed25519PublicKey(decoded)).toBe(MUXED_ID_0);
    });

    // The id is read as unsigned; a signed-64-bit implementation would mangle this one.
    it("accepts a multiplexed id past the maximum signed 64-bit integer", () => {
      expect(StrKey.isValidMed25519PublicKey(MUXED_ID_UNSIGNED)).toBe(true);

      const decoded = StrKey.decodeMed25519PublicKey(MUXED_ID_UNSIGNED);
      expect(decoded.subarray(0, 32).toString("hex")).toBe(PAYLOAD_HEX);
      expect(decoded.subarray(32).toString("hex")).toBe("8000000000000000");
      expect(StrKey.encodeMed25519PublicKey(decoded)).toBe(MUXED_ID_UNSIGNED);
    });

    it("accepts and decodes a signed payload with a 32-byte payload", () => {
      expect(StrKey.isValidSignedPayload(SIGNED_PAYLOAD_32)).toBe(true);

      const decoded = StrKey.decodeSignedPayload(SIGNED_PAYLOAD_32);
      // 32-byte key + 4-byte length prefix + 32-byte payload.
      expect(decoded).toHaveLength(68);
      expect(decoded.subarray(0, 32).toString("hex")).toBe(PAYLOAD_HEX);
      expect(decoded.readUInt32BE(32)).toBe(32);
      expect(decoded.subarray(36).toString("hex")).toBe(
        "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      );
      expect(StrKey.encodeSignedPayload(decoded)).toBe(SIGNED_PAYLOAD_32);
    });

    // A 29-byte payload is zero-padded to a 4-byte boundary, so the encoding is 32 bytes wide while the length prefix still says 29.
    it("accepts a signed payload whose 29-byte payload is zero padded", () => {
      expect(StrKey.isValidSignedPayload(SIGNED_PAYLOAD_29)).toBe(true);

      const decoded = StrKey.decodeSignedPayload(SIGNED_PAYLOAD_29);
      expect(decoded.readUInt32BE(32)).toBe(29);
      expect(decoded.subarray(36, 65).toString("hex")).toBe(
        "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d",
      );
      expect(StrKey.encodeSignedPayload(decoded)).toBe(SIGNED_PAYLOAD_29);
    });

    it("accepts and decodes a liquidity pool address", () => {
      expect(StrKey.isValidLiquidityPool(LIQUIDITY_POOL)).toBe(true);
      expect(StrKey.decodeLiquidityPool(LIQUIDITY_POOL).toString("hex")).toBe(PAYLOAD_HEX);
      expect(StrKey.encodeLiquidityPool(PAYLOAD)).toBe(LIQUIDITY_POOL);
    });

    it("accepts a claimable balance address", () => {
      expect(StrKey.isValidClaimableBalance(CLAIMABLE_BALANCE)).toBe(true);
    });
  });

  describe("SEP-23 invalid vectors are rejected", () => {
    for (const { reason, strkey, validator } of INVALID) {
      it(`rejects: ${reason}`, () => {
        expect(validator(strkey)).toBe(false);
      });
    }

    it("documents the vectors SEP-23 rejects but the SDK accepts", () => {
      // Not an assertion about correctness: this only pins how many known deviations exist, so adding or fixing one is visible here. See ISSUES.md issue 5.
      expect(INVALID_BUT_ACCEPTED).toHaveLength(4);
      expect(INVALID.length + INVALID_BUT_ACCEPTED.length).toBe(15);
    });
  });

  describe("round-trips for codecs without SEP-23 vectors", () => {
    it("decodes an ed25519 secret seed to the same bytes Keypair reports", () => {
      const decoded = StrKey.decodeEd25519SecretSeed(SECRET_SEED);
      expect(decoded).toHaveLength(32);
      // Cross-checked against a second SDK path rather than only re-encoding.
      expect(decoded.equals(Keypair.fromSecret(SECRET_SEED).rawSecretKey())).toBe(true);
      expect(StrKey.encodeEd25519SecretSeed(decoded)).toBe(SECRET_SEED);
    });

    it("round-trips a pre-auth transaction hash", () => {
      const encoded = StrKey.encodePreAuthTx(PAYLOAD);
      expect(encoded.startsWith("T")).toBe(true);
      expect(StrKey.decodePreAuthTx(encoded).equals(PAYLOAD)).toBe(true);
    });

    it("round-trips a sha256 hash", () => {
      const encoded = StrKey.encodeSha256Hash(PAYLOAD);
      expect(encoded.startsWith("X")).toBe(true);
      expect(StrKey.decodeSha256Hash(encoded).equals(PAYLOAD)).toBe(true);
    });

    it("rejects a payload encoded under a different version byte", () => {
      expect(() => StrKey.decodePreAuthTx(ED25519)).toThrow("invalid version byte");
      expect(() => StrKey.decodeSha256Hash(ED25519)).toThrow("invalid version byte");
      expect(() => StrKey.decodeLiquidityPool(ED25519)).toThrow("invalid version byte");
    });
  });

  describe("getVersionByteForPrefix", () => {
    const prefixes: Array<[string, string]> = [
      [ED25519, "ed25519PublicKey"],
      [SECRET_SEED, "ed25519SecretSeed"],
      [MUXED_ID_0, "med25519PublicKey"],
      [SIGNED_PAYLOAD_32, "signedPayload"],
      [LIQUIDITY_POOL, "liquidityPool"],
      [CLAIMABLE_BALANCE, "claimableBalance"],
      [StrKey.encodePreAuthTx(PAYLOAD), "preAuthTx"],
      [StrKey.encodeSha256Hash(PAYLOAD), "sha256Hash"],
    ];

    for (const [strkey, expected] of prefixes) {
      it(`names ${expected} from its prefix`, () => {
        expect(StrKey.getVersionByteForPrefix(strkey)).toBe(expected);
      });
    }

    it("returns undefined for an unrecognised prefix", () => {
      expect(StrKey.getVersionByteForPrefix("QBADQBAD")).toBeUndefined();
      expect(StrKey.getVersionByteForPrefix("")).toBeUndefined();
    });
  });
});
