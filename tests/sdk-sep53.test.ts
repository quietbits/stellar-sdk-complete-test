// SEP-53 arbitrary-message signing: `Keypair.signMessage` / `verifyMessage`,
// new in @stellar/stellar-sdk 16.2.0.
//
// The three signing cases are the official test vectors from the SEP itself, so
// these are golden values checked against the spec rather than against the SDK's
// own output. Each is asserted in both base64 and hex, which is also how the two
// encodings in the spec are cross-checked against each other.
//
// The message hash is additionally re-derived here with node:crypto. Without it,
// `signMessage`/`verifyMessage` could agree with each other while both drifting
// from the spec's `SHA256(prefix + message)` construction.
//
// SOURCE: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

const SEED = "SAKICEVQLYWGSOJS4WW7HZJWAHZVEEBS527LHK5V4MLJALYKICQCJXMW";
const ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
const PREFIX = "Stellar Signed Message:\n";

interface Vector {
  label: string;
  message: string | Buffer;
  base64: string;
  hex: string;
}

const VECTORS: Vector[] = [
  {
    label: "ASCII",
    message: "Hello, World!",
    base64:
      "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==",
    hex:
      "7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd" +
      "6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04",
  },
  {
    label: "UTF-8 (Japanese)",
    message: "こんにちは、世界！",
    base64:
      "CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==",
    hex:
      "083536eb95ecf32dce59b07fe7a1fd8cf814b2ce46f40d2a16e4ea1f6cecd980" +
      "e04e6fbef9d21f98011c785a81edb85f3776a6e7d942b435eb0adc07da4d4604",
  },
  {
    label: "binary",
    // Spec states this vector's message as base64-encoded raw bytes.
    message: Buffer.from("2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=", "base64"),
    base64:
      "VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==",
    hex:
      "540d7eee179f370bf634a49c1fa9fe4a58e3d7990b0207be336c04edfcc539ff" +
      "8bd0c31bb2c0359b07c9651cb2ae104e4504657b5d17d43c69c7e50e23811b0d",
  },
];

/** The spec's construction: SHA-256 over the prefix concatenated with the message. */
function sep53Hash(message: string | Buffer): Buffer {
  const messageBytes = typeof message === "string"
    ? Buffer.from(message, "utf8")
    : message;
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(PREFIX, "utf8"), messageBytes]))
    .digest();
}

describe("stellar-sdk SEP-53 message signing", () => {
  const keypair = Keypair.fromSecret(SEED);

  it("derives the spec's address from the spec's seed", () => {
    expect(keypair.publicKey()).toBe(ADDRESS);
  });

  describe("official spec vectors", () => {
    for (const vector of VECTORS) {
      it(`signs the ${vector.label} vector to the published signature`, () => {
        const signature = keypair.signMessage(vector.message);
        expect(signature).toHaveLength(64);
        expect(signature.toString("base64")).toBe(vector.base64);
        expect(signature.toString("hex")).toBe(vector.hex);
      });

      it(`verifies the published ${vector.label} signature`, () => {
        expect(
          keypair.verifyMessage(
            vector.message,
            Buffer.from(vector.base64, "base64"),
          ),
        ).toBe(true);
      });

      it(`signs the ${vector.label} vector over SHA256(prefix + message)`, () => {
        // Verified through `verify`, not `verifyMessage`, so the assertion does
        // not depend on the same prefixing code path that produced the signature.
        expect(
          keypair.verify(
            sep53Hash(vector.message),
            keypair.signMessage(vector.message),
          ),
        ).toBe(true);
      });
    }
  });

  describe("encoding equivalence", () => {
    it("treats a UTF-8 string and its bytes as the same message", () => {
      expect(
        keypair.signMessage("Hello, World!").equals(
          keypair.signMessage(Buffer.from("Hello, World!", "utf8")),
        ),
      ).toBe(true);
    });

    it("signs and verifies an empty message", () => {
      const signature = keypair.signMessage("");
      expect(signature).toHaveLength(64);
      expect(keypair.verifyMessage("", signature)).toBe(true);
    });
  });

  describe("rejects invalid signatures", () => {
    const signature = keypair.signMessage("Hello, World!");

    it("rejects a different message", () => {
      expect(keypair.verifyMessage("Hello, World?", signature)).toBe(false);
    });

    it("rejects a signature from another key", () => {
      const other = Keypair.random();
      expect(keypair.verifyMessage("Hello, World!", other.signMessage("Hello, World!")))
        .toBe(false);
    });

    it("rejects a truncated signature", () => {
      expect(keypair.verifyMessage("Hello, World!", signature.subarray(0, 32)))
        .toBe(false);
    });

    it("rejects an empty signature", () => {
      expect(keypair.verifyMessage("Hello, World!", Buffer.alloc(0))).toBe(false);
    });

    // Guards against the prefix being applied twice, or not at all: a caller who
    // pre-prefixes the message must not land on the same hash.
    it("does not accept a caller-prefixed message", () => {
      expect(keypair.verifyMessage(`${PREFIX}Hello, World!`, signature)).toBe(false);
    });
  });

  describe("keys without a secret", () => {
    const publicOnly = Keypair.fromPublicKey(ADDRESS);

    it("cannot sign", () => {
      expect(() => publicOnly.signMessage("Hello, World!")).toThrow(
        "cannot sign: no secret key available",
      );
    });

    it("can still verify", () => {
      expect(
        publicOnly.verifyMessage(
          "Hello, World!",
          Buffer.from(VECTORS[0].base64, "base64"),
        ),
      ).toBe(true);
    });
  });
});
