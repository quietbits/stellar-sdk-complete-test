import {
  Account,
  Address,
  Asset,
  Claimant,
  Horizon,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  Soroban,
  xdr,
  hash,
  nativeToScVal,
  rpc,
  scValToBigInt,
  scValToNative,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

function buildClaimableBalanceId(
  source: Keypair,
  destination: Keypair,
): string {
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.createClaimableBalance({
        asset: Asset.native(),
        amount: "1",
        claimants: [
          new Claimant(
            destination.publicKey(),
            Claimant.predicateUnconditional(),
          ),
        ],
      }),
    )
    .setTimeout(30)
    .build();

  return tx.getClaimableBalanceId(0);
}

describe("stellar-sdk core behavior", () => {
  it("roundtrips keypair from secret", () => {
    const keypair = Keypair.random();
    const fromSecret = Keypair.fromSecret(keypair.secret());

    expect(fromSecret.publicKey()).toBe(keypair.publicKey());
  });

  it("signs and verifies messages", () => {
    const keypair = Keypair.random();
    const message = Buffer.from("stellar-sdk-signature-test", "utf8");
    const signature = keypair.sign(message);

    expect(keypair.verify(message, signature)).toBe(true);
    expect(keypair.verify(Buffer.from("tampered", "utf8"), signature)).toBe(
      false,
    );
  });

  it("validates StrKey account and secret formats", () => {
    const keypair = Keypair.random();

    expect(StrKey.isValidEd25519PublicKey(keypair.publicKey())).toBe(true);
    expect(StrKey.isValidEd25519SecretSeed(keypair.secret())).toBe(true);

    expect(StrKey.isValidEd25519PublicKey("G".repeat(56))).toBe(false);
    expect(StrKey.isValidEd25519SecretSeed("S".repeat(56))).toBe(false);
  });

  it("builds and parses a transaction deterministically", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.manageData({
          name: "test_key",
          value: "test_value",
        }),
      )
      .setTimeout(30)
      .build();

    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);

    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].type).toBe("manageData");
  });

  it("keeps core operation factories behavior stable", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");
    const destination = Keypair.random();
    const issuer = Keypair.random();
    const usdc = new Asset("USDC", issuer.publicKey());

    const payment = Operation.payment({
      destination: destination.publicKey(),
      asset: Asset.native(),
      amount: "10",
    });

    const changeTrust = Operation.changeTrust({
      asset: usdc,
      limit: "1000",
    });

    const setOptions = Operation.setOptions({
      homeDomain: "example.org",
    });

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(payment)
      .addOperation(changeTrust)
      .addOperation(setOptions)
      .setTimeout(30)
      .build();

    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);
    const operationTypes = parsed.operations.map((operation) => operation.type);

    expect(operationTypes).toEqual(["payment", "changeTrust", "setOptions"]);
  });

  it("roundtrips Soroban conversion helpers for scalar values", () => {
    const textScVal = nativeToScVal("hello");
    const boolScVal = nativeToScVal(true);
    const bigintScVal = nativeToScVal(123n);

    expect(scValToNative(textScVal)).toBe("hello");
    expect(scValToNative(boolScVal)).toBe(true);
    expect(scValToBigInt(bigintScVal)).toBe(123n);
  });

  it("roundtrips Soroban conversion helpers for arrays and maps", () => {
    const arrayValue = ["hello", 7n, true] as const;
    const mapValue = {
      enabled: true,
      limit: 42n,
      name: "stellar",
    };

    const arrayScVal = nativeToScVal(arrayValue);
    const mapScVal = nativeToScVal(mapValue);

    expect(scValToNative(arrayScVal)).toEqual(["hello", 7n, true]);
    expect(scValToNative(mapScVal)).toEqual({
      enabled: true,
      limit: 42n,
      name: "stellar",
    });
  });

  it("keeps offer and path payment operation families stable", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");
    const destination = Keypair.random();
    const issuer = Keypair.random();
    const usd = new Asset("USD", issuer.publicKey());
    const native = Asset.native();

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.manageSellOffer({
          selling: native,
          buying: usd,
          amount: "10",
          price: "2",
          offerId: "0",
        }),
      )
      .addOperation(
        Operation.manageBuyOffer({
          selling: native,
          buying: usd,
          buyAmount: "10",
          price: "2",
          offerId: "0",
        }),
      )
      .addOperation(
        Operation.pathPaymentStrictReceive({
          sendAsset: native,
          sendMax: "100",
          destination: destination.publicKey(),
          destAsset: usd,
          destAmount: "5",
          path: [],
        }),
      )
      .addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset: native,
          sendAmount: "5",
          destination: destination.publicKey(),
          destAsset: usd,
          destMin: "1",
          path: [],
        }),
      )
      .setTimeout(30)
      .build();

    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);
    const operationTypes = parsed.operations.map((operation) => operation.type);

    expect(operationTypes).toEqual([
      "manageSellOffer",
      "manageBuyOffer",
      "pathPaymentStrictReceive",
      "pathPaymentStrictSend",
    ]);
  });

  it("keeps claimable balance and liquidity pool operation families stable", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");
    const destination = Keypair.random();

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.createClaimableBalance({
          asset: Asset.native(),
          amount: "10",
          claimants: [
            new Claimant(
              destination.publicKey(),
              Claimant.predicateUnconditional(),
            ),
          ],
        }),
      )
      .addOperation(
        Operation.liquidityPoolDeposit({
          liquidityPoolId: "0".repeat(64),
          maxAmountA: "10",
          maxAmountB: "20",
          minPrice: "1",
          maxPrice: "2",
        }),
      )
      .addOperation(
        Operation.liquidityPoolWithdraw({
          liquidityPoolId: "0".repeat(64),
          amount: "5",
          minAmountA: "1",
          minAmountB: "1",
        }),
      )
      .setTimeout(30)
      .build();

    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);
    const operationTypes = parsed.operations.map((operation) => operation.type);

    expect(operationTypes).toEqual([
      "createClaimableBalance",
      "liquidityPoolDeposit",
      "liquidityPoolWithdraw",
    ]);
  });

  it("returns 32-byte digest from hash helper", () => {
    const digest = hash(Buffer.from("abc", "utf8"));

    expect(digest).toHaveLength(32);
  });

  it("keeps sponsorship and revoke operation families stable", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");
    const other = Keypair.random();
    const issuer = Keypair.random();
    const usd = new Asset("USD", issuer.publicKey());
    const claimableBalanceId = buildClaimableBalanceId(source, other);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: other.publicKey(),
        }),
      )
      .addOperation(Operation.endSponsoringFutureReserves({}))
      .addOperation(
        Operation.revokeAccountSponsorship({
          account: other.publicKey(),
        }),
      )
      .addOperation(
        Operation.revokeTrustlineSponsorship({
          account: other.publicKey(),
          asset: usd,
        }),
      )
      .addOperation(
        Operation.revokeOfferSponsorship({
          seller: other.publicKey(),
          offerId: "1",
        }),
      )
      .addOperation(
        Operation.revokeDataSponsorship({
          account: other.publicKey(),
          name: "data-key",
        }),
      )
      .addOperation(
        Operation.revokeClaimableBalanceSponsorship({
          balanceId: claimableBalanceId,
        }),
      )
      .addOperation(
        Operation.revokeLiquidityPoolSponsorship({
          liquidityPoolId: "0".repeat(64),
        }),
      )
      .addOperation(
        Operation.revokeSignerSponsorship({
          account: other.publicKey(),
          signer: { ed25519PublicKey: other.publicKey() },
        }),
      )
      .setTimeout(30)
      .build();

    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);

    expect(parsed.operations).toHaveLength(9);
    expect(parsed.operations[0].type).toBe("beginSponsoringFutureReserves");
    expect(parsed.operations[1].type).toBe("endSponsoringFutureReserves");
  });

  it("keeps advanced operation families stable", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");
    const destination = Keypair.random();
    const issuer = Keypair.random();
    const usd = new Asset("USD", issuer.publicKey());
    const claimableBalanceId = buildClaimableBalanceId(source, destination);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.createAccount({
          destination: destination.publicKey(),
          startingBalance: "10",
        }),
      )
      .addOperation(
        Operation.createPassiveSellOffer({
          selling: Asset.native(),
          buying: usd,
          amount: "10",
          price: "2",
        }),
      )
      .addOperation(
        Operation.allowTrust({
          trustor: destination.publicKey(),
          assetCode: "USD",
          authorize: true,
        }),
      )
      .addOperation(
        Operation.bumpSequence({
          bumpTo: "999",
        }),
      )
      .addOperation(
        Operation.clawback({
          asset: usd,
          amount: "1",
          from: destination.publicKey(),
        }),
      )
      .addOperation(
        Operation.clawbackClaimableBalance({
          balanceId: claimableBalanceId,
        }),
      )
      .addOperation(
        Operation.setTrustLineFlags({
          trustor: destination.publicKey(),
          asset: usd,
          flags: { authorized: true },
        }),
      )
      .addOperation(
        Operation.extendFootprintTtl({
          extendTo: 1000,
        }),
      )
      .addOperation(Operation.restoreFootprint({}))
      .addOperation(
        Operation.createStellarAssetContract({
          asset: usd,
        }),
      )
      .addOperation(
        Operation.uploadContractWasm({
          wasm: Buffer.from([0x00, 0x61, 0x73, 0x6d]),
        }),
      )
      .addOperation(
        Operation.createCustomContract({
          address: Address.fromString(source.publicKey()),
          wasmHash: Buffer.alloc(32, 9),
          salt: Buffer.alloc(32, 8),
        }),
      )
      .addOperation(
        Operation.invokeContractFunction({
          contract: StrKey.encodeContract(Buffer.alloc(32, 3)),
          function: "increment",
          args: [nativeToScVal(1n)],
        }),
      )
      .setTimeout(30)
      .build();

    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);
    const operationTypes = parsed.operations.map((operation) => operation.type);

    expect(operationTypes).toEqual([
      "createAccount",
      "createPassiveSellOffer",
      "allowTrust",
      "bumpSequence",
      "clawback",
      "clawbackClaimableBalance",
      "setTrustLineFlags",
      "extendFootprintTtl",
      "restoreFootprint",
      "invokeHostFunction",
      "invokeHostFunction",
      "invokeHostFunction",
      "invokeHostFunction",
    ]);

    // Ensure host-function wrappers returned expected op family count.
    expect(
      operationTypes.filter((type) => type === "invokeHostFunction"),
    ).toHaveLength(4);
  });

  it("keeps remaining operation families stable", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");
    const destination = Keypair.random();
    const claimableBalanceId = buildClaimableBalanceId(source, destination);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.inflation({
          source: source.publicKey(),
        }),
      )
      .addOperation(
        Operation.claimClaimableBalance({
          balanceId: claimableBalanceId,
        }),
      )
      .addOperation(
        Operation.accountMerge({
          destination: destination.publicKey(),
        }),
      )
      .setTimeout(30)
      .build();

    const parsed = new Transaction(tx.toXDR(), Networks.TESTNET);
    const operationTypes = parsed.operations.map((operation) => operation.type);

    expect(operationTypes).toEqual([
      "inflation",
      "claimClaimableBalance",
      "accountMerge",
    ]);
  });

  it("keeps invokeHostFunction operation callable", () => {
    const invalidFunc = null as unknown as xdr.HostFunction;

    expect(() =>
      Operation.invokeHostFunction({
        func: invalidFunc,
      }),
    ).toThrow();
  });

  it("keeps critical validation error cases stable", () => {
    expect(() =>
      Operation.payment({
        destination: "INVALID_DEST",
        asset: Asset.native(),
        amount: "1",
      }),
    ).toThrow();

    expect(() =>
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "-1",
      }),
    ).toThrow();

    expect(() => Address.fromString("INVALID_ADDRESS")).toThrow();
    expect(() => StrKey.decodeEd25519PublicKey("INVALID_STRKEY")).toThrow();

    expect(() =>
      Operation.claimClaimableBalance({
        balanceId: "invalid-balance-id",
      }),
    ).toThrow();
  });

  it("keeps insecure http constructor defaults strict", () => {
    expect(() => new Horizon.Server("http://horizon.local")).toThrow(
      "Cannot connect to insecure horizon server",
    );
    expect(() => new rpc.Server("http://rpc.local")).toThrow(
      "Cannot connect to insecure Soroban RPC server if `allowHttp` isn't set",
    );
  });

  it("keeps StrKey contract and claimable roundtrips stable", () => {
    const contractRaw = Buffer.alloc(32, 7);
    const claimableRaw = Buffer.alloc(32, 11);
    const contract = StrKey.encodeContract(contractRaw);
    const claimable = StrKey.encodeClaimableBalance(claimableRaw);

    expect(StrKey.decodeContract(contract)).toEqual(contractRaw);
    expect(StrKey.decodeClaimableBalance(claimable)).toEqual(claimableRaw);
    expect(StrKey.isValidContract(contract)).toBe(true);
  });

  it("keeps timeout boundary validation stable", () => {
    const source = Keypair.random();
    const sourceAccount = new Account(source.publicKey(), "1");
    const builder = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    });

    expect(() => builder.setTimeout(-1)).toThrow("timeout cannot be negative");
    expect(() => builder.setTimeout(0)).not.toThrow();
  });

  it("keeps Soroban token amount formatting/parsing stable", () => {
    expect(Soroban.formatTokenAmount("1234567", 7)).toBe("0.1234567");
    expect(Soroban.parseTokenAmount("0.1234567", 7).toString()).toBe("1234567");
  });
});
