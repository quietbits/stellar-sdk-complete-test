// Behavior coverage for `TransactionBase` and the `signatureBase()` overrides on
// `Transaction` and `FeeBumpTransaction`.
//
// These four symbols have NO test in js-stellar-sdk's own suite (`grep -rn
// signatureBase test/` returns nothing there), which is why they are in this
// repo's work list rather than deprioritized as upstream-covered.
//
// Ground truth is external, not the SDK agreeing with itself:
//
//   * The layout is the XDR `TransactionSignaturePayload` from Stellar-transaction.x
//     — a 32-byte `networkId` Hash followed by the `EnvelopeType`-discriminated
//     `taggedTransaction` union. The discriminant values (`ENVELOPE_TYPE_TX` = 2,
//     `ENVELOPE_TYPE_TX_FEE_BUMP` = 5) are protocol constants, asserted literally.
//   * `networkId` and the transaction hash are re-derived with `node:crypto`
//     rather than the SDK's own `hash()` helper, so a change to the SDK's
//     hashing cannot move both sides of the assertion together.
//   * The strongest anchor: a fee-bump envelope captured from upstream carries
//     two real ed25519 signatures produced elsewhere. Both verify against
//     `sha256(signatureBase())` as derived here, which pins the byte layout to
//     something the rest of the network already accepted.
import { createHash } from "node:crypto";
import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  Transaction,
  TransactionBase,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

// Stellar-transaction.x, `enum EnvelopeType`.
const ENVELOPE_TYPE_TX = 2;
const ENVELOPE_TYPE_TX_FEE_BUMP = 5;

const NETWORK_ID_LENGTH = 32;
const DISCRIMINANT_LENGTH = 4;
const HEADER_LENGTH = NETWORK_ID_LENGTH + DISCRIMINANT_LENGTH;

// SOURCE: https://github.com/stellar/js-stellar-sdk/blob/main/test/unit/base/transaction_builder.test.ts#L1342
// A fee-bump envelope with a real outer (fee-source) signature and a real inner
// (source) signature. Upstream decodes it with `Networks.TESTNET`, but only
// asserts XDR round-tripping and never checks the signatures; they were in fact
// produced against `Networks.STANDALONE`, which is the passphrase used here so
// the cryptographic check below is meaningful rather than vacuous.
const FEE_BUMP_ENVELOPE =
  "AAAABQAAAADgSJG2GOUMy/H9lHyjYZOwyuyytH8y0wWaoc596L+bEgAAAAAAAADIAAAAAgAAAABzdv3ojkzWHMD7KUoXhrPx0GH18vHKV0ZfqpMiEblG1gAAAGQAAAAAAAAACAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAA9IYXBweSBiaXJ0aGRheSEAAAAAAQAAAAAAAAABAAAAAOBIkbYY5QzL8f2UfKNhk7DK7LK0fzLTBZqhzn3ov5sSAAAAAAAAAASoF8gAAAAAAAAAAAERuUbWAAAAQK933Dnt1pxXlsf1B5CYn81PLxeYsx+MiV9EGbMdUfEcdDWUySyIkdzJefjpR5ejdXVp/KXosGmNUQ+DrIBlzg0AAAAAAAAAAei/mxIAAABAijIIQpL6KlFefiL4FP8UWQktWEz4wFgGNSaXe7mZdVMuiREntehi1b7MRqZ1h+W+Y0y+Z2HtMunsilT2yS5mAA==";

// SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/transaction_envelope_test.js#L4-L10
// A pre-Protocol-13 v0 envelope, used here for the v0 re-tagging branch of
// `Transaction.signatureBase()`.
const V0_ENVELOPE =
  "AAAAAPQQv+uPYrlCDnjgPyPRgIjB6T8Zb8ANmL8YGAXC2IAgAAAAZAAIteYAAAAHAAAAAAAAAAAAAAABAAAAAAAAAAMAAAAAAAAAAUVVUgAAAAAAUtYuFczBLlsXyEp3q8BbTBpEGINWahqkFbnTPd93YUUAAAAXSHboAAAAABEAACcQAAAAAAAAAKIAAAAAAAAAAcLYgCAAAABAo2tU6n0Bb7bbbpaXacVeaTVbxNMBtnrrXVk2QAOje2Flllk/ORlmQdFU/9c8z43eWh1RNMpI3PscY+yDCnJPBQ==";

/** SHA-256 via `node:crypto`, deliberately not the SDK's own `hash()`. */
function sha256(payload: Buffer): Buffer {
  return createHash("sha256").update(payload).digest();
}

function feeBumpFixture(): FeeBumpTransaction {
  const parsed = TransactionBuilder.fromXDR(
    FEE_BUMP_ENVELOPE,
    Networks.STANDALONE,
  );
  if (!(parsed instanceof FeeBumpTransaction)) {
    throw new Error("fixture did not decode as a FeeBumpTransaction");
  }
  return parsed;
}

function paymentTransaction(
  networkPassphrase: string = Networks.TESTNET,
): Transaction {
  return TransactionBuilder.fromXDR(
    feeBumpFixture().innerTransaction.toEnvelope(),
    networkPassphrase,
  ) as Transaction;
}

describe("stellar-sdk TransactionBase", () => {
  const fixture = feeBumpFixture();

  it("is the shared base class of Transaction and FeeBumpTransaction", () => {
    expect(Object.getPrototypeOf(Transaction)).toBe(TransactionBase);
    expect(Object.getPrototypeOf(FeeBumpTransaction)).toBe(TransactionBase);
    expect(fixture).toBeInstanceOf(TransactionBase);
    expect(fixture.innerTransaction).toBeInstanceOf(TransactionBase);
  });

  it("exposes the fee, passphrase, and signatures it was constructed with", () => {
    const base = new TransactionBase(fixture.tx, [], "200", Networks.STANDALONE);

    expect(base.fee).toBe("200");
    expect(base.networkPassphrase).toBe(Networks.STANDALONE);
    expect(base.signatures).toEqual([]);
  });

  // The base class deliberately implements nothing: both `signatureBase` and
  // `toEnvelope` are placeholders, so `hash` and `toXDR` inherit the failure.
  describe("throws for every method a subclass must implement", () => {
    const base = new TransactionBase(fixture.tx, [], "200", Networks.STANDALONE);

    it("signatureBase", () => {
      expect(() => base.signatureBase()).toThrow("Implement in subclass");
    });

    it("toEnvelope", () => {
      expect(() => base.toEnvelope()).toThrow("Implement in subclass");
    });

    it("hash, because it hashes the signature base", () => {
      expect(() => base.hash()).toThrow("Implement in subclass");
    });

    it("toXDR, because it serializes the envelope", () => {
      expect(() => base.toXDR()).toThrow("Implement in subclass");
    });
  });

  describe("rejects every mutating setter", () => {
    it("signatures", () => {
      const base = new TransactionBase(fixture.tx, [], "1", Networks.STANDALONE);
      expect(() => {
        base.signatures = [];
      }).toThrow("Transaction is immutable");
    });

    it("tx", () => {
      const base = new TransactionBase(fixture.tx, [], "1", Networks.STANDALONE);
      expect(() => {
        base.tx = fixture.tx;
      }).toThrow("Transaction is immutable");
    });

    it("fee", () => {
      const base = new TransactionBase(fixture.tx, [], "1", Networks.STANDALONE);
      expect(() => {
        base.fee = "2";
      }).toThrow("Transaction is immutable");
    });

    it("networkPassphrase", () => {
      const base = new TransactionBase(fixture.tx, [], "1", Networks.STANDALONE);
      expect(() => {
        base.networkPassphrase = Networks.PUBLIC;
      }).toThrow("Transaction is immutable");
    });
  });

  // Documented as a defensive copy: mutating what the getter hands back must not
  // reach the transaction that will be signed.
  it("returns a fresh tx object on every read", () => {
    const base = new TransactionBase(fixture.tx, [], "200", Networks.STANDALONE);

    expect(base.tx).not.toBe(base.tx);
    expect(base.tx.toXDR("base64")).toBe(base.tx.toXDR("base64"));
  });
});

describe("stellar-sdk Transaction#signatureBase", () => {
  const transaction = paymentTransaction(Networks.TESTNET);
  const base = transaction.signatureBase();

  it("starts with the SHA-256 of the network passphrase", () => {
    expect(
      base.subarray(0, NETWORK_ID_LENGTH).equals(
        sha256(Buffer.from(Networks.TESTNET, "utf8")),
      ),
    ).toBe(true);
  });

  it("tags the payload with ENVELOPE_TYPE_TX", () => {
    expect(base.readUInt32BE(NETWORK_ID_LENGTH)).toBe(ENVELOPE_TYPE_TX);
  });

  it("appends the transaction body verbatim", () => {
    expect(base.subarray(HEADER_LENGTH).equals(transaction.tx.toXDR())).toBe(true);
    expect(base.length).toBe(HEADER_LENGTH + transaction.tx.toXDR().length);
  });

  it("decodes as a TransactionSignaturePayload", () => {
    const payload = xdr.TransactionSignaturePayload.fromXDR(base);

    expect(payload.taggedTransaction().switch().name).toBe("envelopeTypeTx");
    expect(payload.networkId().equals(sha256(Buffer.from(Networks.TESTNET, "utf8"))))
      .toBe(true);
  });

  it("is what hash() hashes", () => {
    expect(transaction.hash().equals(sha256(base))).toBe(true);
  });

  // The whole point of mixing the network id in: the same transaction bytes must
  // not produce a signable hash that is valid on two networks.
  it("changes with the network passphrase while the body stays identical", () => {
    const onPublic = paymentTransaction(Networks.PUBLIC);
    const publicBase = onPublic.signatureBase();

    expect(publicBase.subarray(HEADER_LENGTH).equals(base.subarray(HEADER_LENGTH)))
      .toBe(true);
    expect(publicBase.subarray(0, NETWORK_ID_LENGTH).equals(
      base.subarray(0, NETWORK_ID_LENGTH),
    )).toBe(false);
    expect(onPublic.hash().equals(transaction.hash())).toBe(false);
  });

  // External anchor: this signature was produced by another party, so it can
  // only verify if the payload assembled above is byte-identical to theirs.
  it("verifies the inner signature carried by the upstream fee-bump fixture", () => {
    const inner = feeBumpFixture().innerTransaction;
    const signer = Keypair.fromPublicKey(inner.source);

    expect(
      signer.verify(
        sha256(inner.signatureBase()),
        inner.signatures[0].signature(),
      ),
    ).toBe(true);
  });

  // A v0 envelope has the AccountID discriminant stripped from its source; the
  // signature base has to put it back and re-tag as ENVELOPE_TYPE_TX, otherwise
  // pre-Protocol-13 transactions would hash differently than the network expects.
  describe("v0 envelopes", () => {
    const v0 = new Transaction(V0_ENVELOPE, Networks.PUBLIC);
    const v0Base = v0.signatureBase();

    it("still decodes from the v0 envelope type", () => {
      expect(
        xdr.TransactionEnvelope.fromXDR(V0_ENVELOPE, "base64").switch().name,
      ).toBe("envelopeTypeTxV0");
    });

    it("is tagged ENVELOPE_TYPE_TX, not the v0 envelope type", () => {
      expect(v0Base.readUInt32BE(NETWORK_ID_LENGTH)).toBe(ENVELOPE_TYPE_TX);
    });

    it("restores the 4-byte AccountID discriminant ahead of the source key", () => {
      const body = v0Base.subarray(HEADER_LENGTH);

      // v1 body starts with the muxed source account: a 4-byte key-type
      // discriminant followed by the 32-byte key.
      expect(body.readUInt32BE(0)).toBe(0); // KEY_TYPE_ED25519
      expect(body.length).toBe(v0.tx.toXDR().length + DISCRIMINANT_LENGTH);
    });

    it("verifies the signature the v0 fixture already carries", () => {
      const signer = Keypair.fromPublicKey(v0.source);

      expect(
        signer.verify(sha256(v0Base), v0.signatures[0].signature()),
      ).toBe(true);
    });
  });
});

describe("stellar-sdk FeeBumpTransaction#signatureBase", () => {
  const feeBump = feeBumpFixture();
  const base = feeBump.signatureBase();

  it("starts with the SHA-256 of the network passphrase", () => {
    expect(
      base.subarray(0, NETWORK_ID_LENGTH).equals(
        sha256(Buffer.from(Networks.STANDALONE, "utf8")),
      ),
    ).toBe(true);
  });

  it("tags the payload with ENVELOPE_TYPE_TX_FEE_BUMP", () => {
    expect(base.readUInt32BE(NETWORK_ID_LENGTH)).toBe(ENVELOPE_TYPE_TX_FEE_BUMP);
  });

  it("appends the fee-bump body verbatim", () => {
    expect(base.subarray(HEADER_LENGTH).equals(feeBump.tx.toXDR())).toBe(true);
  });

  it("decodes as a TransactionSignaturePayload", () => {
    const payload = xdr.TransactionSignaturePayload.fromXDR(base);
    expect(payload.taggedTransaction().switch().name).toBe(
      "envelopeTypeTxFeeBump",
    );
  });

  it("is what hash() hashes", () => {
    expect(feeBump.hash().equals(sha256(base))).toBe(true);
  });

  // External anchor, as above — this one signed by the fee source.
  it("verifies the outer signature carried by the upstream fixture", () => {
    const signer = Keypair.fromPublicKey(feeBump.feeSource);

    expect(
      signer.verify(sha256(base), feeBump.signatures[0].signature()),
    ).toBe(true);
  });

  // The two payloads differ in both discriminant and body, so bumping a fee can
  // never replay the inner transaction's signature.
  it("differs from the inner transaction's signature base and hash", () => {
    const innerBase = feeBump.innerTransaction.signatureBase();

    expect(base.equals(innerBase)).toBe(false);
    expect(base.readUInt32BE(NETWORK_ID_LENGTH)).not.toBe(
      innerBase.readUInt32BE(NETWORK_ID_LENGTH),
    );
    expect(feeBump.hash().equals(feeBump.innerTransaction.hash())).toBe(false);
  });
});
