import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

function deterministicKeypair(byte: number): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.alloc(32, byte));
}

describe("stellar-sdk golden snapshots", () => {
  it("keeps deterministic payment transaction envelope stable", () => {
    const source = deterministicKeypair(1);
    const destination = deterministicKeypair(2);

    const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: destination.publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      )
      .setTimebounds(0, 1700000000)
      .build();

    expect(tx.toEnvelope().toXDR("base64")).toMatchInlineSnapshot(
      `"AAAAAgAAAACKiOPddAnxlf1S2y08ul1yymcJvx2UEhvzdIgBtA9vXAAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAABlU/EAAAAAAAAAAAEAAAAAAAAAAQAAAACBOXcOqH0XX1ajVGbDTH7My42KkbTuN6Jd9g9bj8mzlAAAAAAAAAAAAJiWgAAAAAAAAAAA"`,
    );
  });

  it("keeps deterministic operation XDR values stable", () => {
    const source = deterministicKeypair(3);
    const destination = deterministicKeypair(4);

    const payment = Operation.payment({
      source: source.publicKey(),
      destination: destination.publicKey(),
      asset: Asset.native(),
      amount: "5",
    });

    const manageData = Operation.manageData({
      source: source.publicKey(),
      name: "snapshot-key",
      value: "snapshot-value",
    });

    expect(payment.toXDR("base64")).toMatchInlineSnapshot(
      `"AAAAAQAAAADtSSjGKNHCxurpAziQWZVhKVknOlxj+TY2wUYUrIc30QAAAAEAAAAAypOsFwUYcHHWe4PH/w7+gQjo7EUwV113JoeTM9vavnwAAAAAAAAAAAL68IA="`,
    );

    expect(manageData.toXDR("base64")).toMatchInlineSnapshot(
      `"AAAAAQAAAADtSSjGKNHCxurpAziQWZVhKVknOlxj+TY2wUYUrIc30QAAAAoAAAAMc25hcHNob3Qta2V5AAAAAQAAAA5zbmFwc2hvdC12YWx1ZQAA"`,
    );
  });

  it("keeps deterministic transaction hash stable", () => {
    const source = deterministicKeypair(7);
    const destination = deterministicKeypair(8);

    const tx = new TransactionBuilder(new Account(source.publicKey(), "5"), {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.createAccount({
          destination: destination.publicKey(),
          startingBalance: "2",
        }),
      )
      .setTimebounds(0, 1700000045)
      .build();

    expect(tx.hash().toString("hex")).toMatchInlineSnapshot(
      `"1fdf5bcb1cef77f4fd497b11c1ef35e8df8bd159a657926ecdce3f36f5b20a90"`,
    );
  });
});
