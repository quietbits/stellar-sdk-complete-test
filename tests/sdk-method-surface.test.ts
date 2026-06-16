import {
  Address,
  Asset,
  Claimant,
  Contract,
  FeeBumpTransaction,
  Keypair,
  LiquidityPoolAsset,
  Memo,
  MuxedAccount,
  Operation,
  SignerKey,
  Soroban,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  TransactionBuilder,
  Utils,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

function ownMethods(target: object): string[] {
  return Object.getOwnPropertyNames(target)
    .filter(
      (name) => name !== "length" && name !== "name" && name !== "prototype",
    )
    .sort();
}

function protoMethods(target: { prototype: object }): string[] {
  return Object.getOwnPropertyNames(target.prototype)
    .filter((name) => name !== "constructor")
    .sort();
}

describe("stellar-sdk class and method surface locks", () => {
  it("keeps Keypair static and instance methods stable", () => {
    expect(ownMethods(Keypair)).toEqual([
      "fromPublicKey",
      "fromRawEd25519Seed",
      "fromSecret",
      "master",
      "random",
    ]);

    expect(protoMethods(Keypair)).toEqual([
      "canSign",
      "publicKey",
      "rawPublicKey",
      "rawSecretKey",
      "secret",
      "sign",
      "signDecorated",
      "signPayloadDecorated",
      "signatureHint",
      "verify",
      "xdrAccountId",
      "xdrMuxedAccount",
      "xdrPublicKey",
    ]);
  });

  it("keeps Asset and LiquidityPoolAsset method surfaces stable", () => {
    expect(ownMethods(Asset)).toEqual(["compare", "fromOperation", "native"]);

    expect(protoMethods(Asset)).toEqual([
      "_toXDRObject",
      "contractId",
      "equals",
      "getAssetType",
      "getCode",
      "getIssuer",
      "getRawAssetType",
      "isNative",
      "toChangeTrustXDRObject",
      "toString",
      "toTrustLineXDRObject",
      "toXDRObject",
    ]);

    expect(ownMethods(LiquidityPoolAsset)).toEqual(["fromOperation"]);

    expect(protoMethods(LiquidityPoolAsset)).toEqual([
      "equals",
      "getAssetType",
      "getLiquidityPoolParameters",
      "toString",
      "toXDRObject",
    ]);
  });

  it("keeps Transaction and builder method surfaces stable", () => {
    expect(ownMethods(TransactionBuilder)).toEqual([
      "buildFeeBumpTransaction",
      "cloneFrom",
      "fromXDR",
    ]);

    expect(protoMethods(TransactionBuilder)).toEqual([
      "addMemo",
      "addOperation",
      "addOperationAt",
      "addSacTransferOperation",
      "build",
      "clearOperationAt",
      "clearOperations",
      "hasV2Preconditions",
      "setExtraSigners",
      "setLedgerbounds",
      "setMinAccountSequence",
      "setMinAccountSequenceAge",
      "setMinAccountSequenceLedgerGap",
      "setNetworkPassphrase",
      "setSorobanData",
      "setTimebounds",
      "setTimeout",
    ]);

    expect(protoMethods(Transaction)).toEqual([
      "extraSigners",
      "getClaimableBalanceId",
      "ledgerBounds",
      "memo",
      "minAccountSequence",
      "minAccountSequenceAge",
      "minAccountSequenceLedgerGap",
      "operations",
      "sequence",
      "signatureBase",
      "source",
      "timeBounds",
      "toEnvelope",
    ]);

    expect(protoMethods(FeeBumpTransaction)).toEqual([
      "feeSource",
      "innerTransaction",
      "operations",
      "signatureBase",
      "toEnvelope",
    ]);
  });

  it("keeps utility object and helper method surfaces stable", () => {
    expect(ownMethods(StrKey)).toEqual([
      "decodeClaimableBalance",
      "decodeContract",
      "decodeEd25519PublicKey",
      "decodeEd25519SecretSeed",
      "decodeLiquidityPool",
      "decodeMed25519PublicKey",
      "decodePreAuthTx",
      "decodeSha256Hash",
      "decodeSignedPayload",
      "encodeClaimableBalance",
      "encodeContract",
      "encodeEd25519PublicKey",
      "encodeEd25519SecretSeed",
      "encodeLiquidityPool",
      "encodeMed25519PublicKey",
      "encodePreAuthTx",
      "encodeSha256Hash",
      "encodeSignedPayload",
      "getVersionByteForPrefix",
      "isValidClaimableBalance",
      "isValidContract",
      "isValidEd25519PublicKey",
      "isValidEd25519SecretSeed",
      "isValidLiquidityPool",
      "isValidMed25519PublicKey",
      "isValidSignedPayload",
      "types",
    ]);

    expect(ownMethods(SignerKey)).toEqual(["decodeAddress", "encodeSignerKey"]);
    expect(ownMethods(Utils)).toEqual(["sleep", "validateTimebounds"]);
    expect(ownMethods(Soroban)).toEqual([
      "formatTokenAmount",
      "parseTokenAmount",
    ]);
    expect(ownMethods(Operation)).toContain("fromXDRObject");
  });

  it("keeps Contract, Address, Claimant, Memo, MuxedAccount method surfaces stable", () => {
    expect(protoMethods(Contract)).toEqual([
      "address",
      "call",
      "contractId",
      "getFootprint",
      "toString",
    ]);

    expect(ownMethods(Address)).toEqual([
      "account",
      "claimableBalance",
      "contract",
      "fromScAddress",
      "fromScVal",
      "fromString",
      "liquidityPool",
      "muxedAccount",
    ]);

    expect(protoMethods(Address)).toEqual([
      "toBuffer",
      "toScAddress",
      "toScVal",
      "toString",
      "type",
    ]);

    expect(ownMethods(Claimant)).toEqual([
      "fromXDR",
      "predicateAnd",
      "predicateBeforeAbsoluteTime",
      "predicateBeforeRelativeTime",
      "predicateNot",
      "predicateOr",
      "predicateUnconditional",
    ]);

    expect(protoMethods(Claimant)).toEqual([
      "destination",
      "predicate",
      "toXDRObject",
    ]);

    expect(ownMethods(Memo)).toEqual([
      "_validateHashValue",
      "_validateIdValue",
      "_validateTextValue",
      "fromXDRObject",
      "hash",
      "id",
      "none",
      "return",
      "text",
    ]);

    expect(protoMethods(Memo)).toEqual(["toXDRObject", "type", "value"]);

    expect(ownMethods(MuxedAccount)).toEqual(["fromAddress"]);
    expect(protoMethods(MuxedAccount)).toEqual([
      "accountId",
      "baseAccount",
      "equals",
      "id",
      "incrementSequenceNumber",
      "sequenceNumber",
      "setId",
      "toXDRObject",
    ]);
  });
});
