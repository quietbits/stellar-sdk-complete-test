// Behavior coverage for the non-SEP-53 APIs added in @stellar/stellar-sdk 16.2.0:
// `contract.KeypairSigner`, `TransactionFailedError`, and the auth-entry
// inspection helpers `inspectAuthEntry` / `checkAuthEntryReadiness`.
//
// The SEP-53 additions (`Keypair.signMessage` / `verifyMessage`) live in
// sdk-sep53.test.ts, where the spec's golden vectors apply.
//
// `TransactionFailedError` is exercised through the loopback server rather than
// live: it needs a Horizon 400 carrying specific `extras`, which a real endpoint
// will not reproduce on demand.
import {
  Account,
  Address,
  Asset,
  BadResponseError,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  TransactionFailedError,
  authorizeEntry,
  checkAuthEntryReadiness,
  inspectAuthEntry,
  xdr,
} from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";
import { describe, expect, it } from "./helpers/assert.ts";
import { startServer } from "./helpers/server.ts";

const CONTRACT_ID = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const NO_SECRET = "cannot sign: no secret key available";

function buildPaymentTransaction(source: Keypair) {
  return new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
}

/**
 * Awaits a call that must reject with `ctor`, and returns the narrowed error so
 * its accessors can be asserted on.
 */
async function rejectsWith<T extends Error>(
  ctor: new (...args: never[]) => T,
  call: () => Promise<unknown>,
): Promise<T> {
  let caught: unknown;
  try {
    await call();
  } catch (error) {
    caught = error;
  }
  if (caught === undefined) {
    throw new Error(`expected a ${ctor.name} rejection, but the call resolved`);
  }
  if (!(caught instanceof ctor)) {
    const actual = caught instanceof Error
      ? `${caught.constructor.name}: ${caught.message}`
      : String(caught);
    throw new Error(`expected a ${ctor.name} rejection, got ${actual}`);
  }
  return caught;
}

describe("stellar-sdk contract.KeypairSigner", () => {
  const keypair = Keypair.random();
  const signer = new KeypairSigner(keypair, Networks.TESTNET);

  it("carries the keypair's account address as its identity", () => {
    expect(signer.address).toBe(keypair.publicKey());
  });

  it("exposes both SEP-43 signing callbacks", () => {
    expect(typeof signer.signTransaction).toBe("function");
    expect(typeof signer.signAuthEntry).toBe("function");
  });

  // The callbacks are instance properties, not prototype methods, so a
  // prototype-based surface lock (see sdk-method-surface.test.ts) cannot see
  // them — assert the shape here instead.
  it("assigns its callbacks as own properties", () => {
    expect(Object.getOwnPropertyNames(KeypairSigner.prototype)).toEqual([
      "constructor",
    ]);
    expect(Object.getOwnPropertyNames(signer)).toContain("signTransaction");
    expect(Object.getOwnPropertyNames(signer)).toContain("signAuthEntry");
  });

  it("signs a transaction with a signature the keypair verifies", async () => {
    const transaction = buildPaymentTransaction(keypair);
    const { signedTxXdr, signerAddress } = await signer.signTransaction(
      transaction.toEnvelope().toXDR("base64"),
    );

    expect(signerAddress).toBe(keypair.publicKey());

    const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
    expect(
      keypair.verify(signed.hash(), signed.signatures[0].signature()),
    ).toBe(true);
  });

  it("leaves the transaction otherwise unchanged", async () => {
    const transaction = buildPaymentTransaction(keypair);
    const { signedTxXdr } = await signer.signTransaction(
      transaction.toEnvelope().toXDR("base64"),
    );

    const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
    expect(signed.hash().toString("hex")).toBe(
      transaction.hash().toString("hex"),
    );
  });

  it("cannot sign with a public-key-only keypair", async () => {
    const publicOnly = new KeypairSigner(
      Keypair.fromPublicKey(keypair.publicKey()),
      Networks.TESTNET,
    );
    const transaction = buildPaymentTransaction(keypair);

    await expect(
      publicOnly.signTransaction(transaction.toEnvelope().toXDR("base64")),
    ).rejects.toThrow(NO_SECRET);
  });
});

describe("stellar-sdk TransactionFailedError (loopback)", () => {
  const source = Keypair.random();

  const operationResult = xdr.OperationResult.opInner(
    xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
  );
  const failedResultXdr = new xdr.TransactionResult({
    // Constructed via xdr.Int64 rather than a bigint literal: the latter is
    // still rejected by the published types (see ISSUES.md issue 2) and both
    // produce identical XDR.
    feeCharged: new xdr.Int64(100),
    result: xdr.TransactionResultResult.txFailed([operationResult]),
    ext: xdr.TransactionResultExt.fromXDR("AAAAAA==", "base64"),
  }).toXDR("base64");

  /**
   * Serves Horizon's `transaction_failed` 400 for the submit itself, and 404 for
   * everything else — notably the destination-account lookup that
   * `submitTransaction`'s memo-required check performs first, which would
   * otherwise be the request that fails.
   */
  async function submitAgainst(extras: unknown): Promise<unknown> {
    const server = await startServer((req) => {
      if (req.method === "POST" && req.pathname === "/transactions") {
        return {
          status: 400,
          json: {
            type: "https://stellar.org/horizon-errors/transaction_failed",
            title: "Transaction Failed",
            status: 400,
            extras,
          },
        };
      }
      return { status: 404, json: {} };
    });

    const transaction = buildPaymentTransaction(source);
    transaction.sign(source);

    try {
      const horizon = new Horizon.Server(server.url, { allowHttp: true });
      return await horizon.submitTransaction(transaction);
    } finally {
      await server.close();
    }
  }

  it("is raised for a transaction_failed response and extends BadResponseError", async () => {
    const error = await rejectsWith(TransactionFailedError, () =>
      submitAgainst({
        result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] },
        result_xdr: failedResultXdr,
      }),
    );

    expect(error).toBeInstanceOf(BadResponseError);
    expect(error.getResultCodes()).toEqual({
      transaction: "tx_failed",
      operations: ["op_underfunded"],
    });
  });

  it("decodes the transaction result from extras.result_xdr", async () => {
    const error = await rejectsWith(TransactionFailedError, () =>
      submitAgainst({
        result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] },
        result_xdr: failedResultXdr,
      }),
    );

    const result = error.getTransactionResult();
    expect(result).not.toBeNull();
    expect(result?.result().switch().name).toBe("txFailed");
    expect(result?.feeCharged().toString()).toBe("100");
  });

  // Horizon omits `operations` for transaction-level failures; the accessor is
  // documented to normalize that to an empty array.
  it("normalizes omitted operation codes to an empty array", async () => {
    const error = await rejectsWith(TransactionFailedError, () =>
      submitAgainst({ result_codes: { transaction: "tx_bad_seq" } }),
    );

    expect(error.getResultCodes()).toEqual({
      transaction: "tx_bad_seq",
      operations: [],
    });
  });

  it("returns null when the response carries no result_xdr", async () => {
    const error = await rejectsWith(TransactionFailedError, () =>
      submitAgainst({ result_codes: { transaction: "tx_failed", operations: [] } }),
    );

    expect(error.getTransactionResult()).toBeNull();
  });

  it("falls back to BadResponseError when no result_codes are present", async () => {
    const error = await rejectsWith(BadResponseError, () => submitAgainst({}));
    expect(error).not.toBeInstanceOf(TransactionFailedError);
  });
});

describe("stellar-sdk auth entry inspection", () => {
  const keypair = Keypair.random();

  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction
      .sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(CONTRACT_ID).toScAddress(),
          functionName: "hello",
          args: [],
        }),
      ),
    subInvocations: [],
  });

  function sourceAccountEntry(): xdr.SorobanAuthorizationEntry {
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: invocation,
    });
  }

  function addressEntry(): xdr.SorobanAuthorizationEntry {
    return new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(keypair.publicKey()).toScAddress(),
          nonce: new xdr.Int64(123456789101112n),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVec([]),
        }),
      ),
      rootInvocation: invocation,
    });
  }

  describe("source-account credentials", () => {
    it("reports no address, nonce, expiration, or signers", () => {
      const info = inspectAuthEntry(sourceAccountEntry());

      expect(info.credentialType).toBe("sourceAccount");
      expect(info.address).toBeNull();
      expect(info.nonce).toBeNull();
      expect(info.signatureExpirationLedger).toBeNull();
      expect(info.signers).toEqual([]);
      // No signature nodes of its own: covered by the envelope signature instead.
      expect(info.signed).toBe(false);
    });

    it("preserves the invocation it authorizes", () => {
      const info = inspectAuthEntry(sourceAccountEntry());
      expect(info.invocation.toXDR("base64")).toBe(invocation.toXDR("base64"));
    });

    // `signed` is false above, yet readiness is true — the two answer different
    // questions, and this pins that distinction.
    it("is always ready to submit regardless of ledger", () => {
      expect(checkAuthEntryReadiness(sourceAccountEntry(), 0)).toEqual({
        ready: true,
        expired: false,
        unsignedBy: [],
      });
      expect(checkAuthEntryReadiness(sourceAccountEntry(), 4294967295)).toEqual({
        ready: true,
        expired: false,
        unsignedBy: [],
      });
    });
  });

  describe("address credentials", () => {
    it("reports the authorizing address, nonce, and an unsigned signer", () => {
      const info = inspectAuthEntry(addressEntry());

      expect(info.credentialType).toBe("address");
      expect(info.address).toBe(keypair.publicKey());
      expect(info.nonce).toBe(123456789101112n);
      expect(info.signatureExpirationLedger).toBe(0);
      expect(info.signers).toHaveLength(1);
      expect(info.signers[0].address).toBe(keypair.publicKey());
      expect(info.signers[0].signed).toBe(false);
      expect(info.signers[0].signatures).toEqual([]);
      expect(info.signed).toBe(false);
    });

    it("names the address that still needs to sign", () => {
      expect(checkAuthEntryReadiness(addressEntry(), 100)).toEqual({
        ready: false,
        expired: true,
        unsignedBy: [keypair.publicKey()],
      });
    });

    it("reports an entry signed by authorizeEntry as signed", async () => {
      const signed = await authorizeEntry(
        addressEntry(),
        keypair,
        500,
        Networks.TESTNET,
      );
      const info = inspectAuthEntry(signed);

      expect(info.signed).toBe(true);
      expect(info.signatureExpirationLedger).toBe(500);
      expect(info.signers).toHaveLength(1);
      expect(info.signers[0].signed).toBe(true);

      // `signatures` is null when the payload is not the SDK's ed25519 shape;
      // authorizeEntry always produces that shape, so this must parse.
      const { signatures } = info.signers[0];
      if (signatures === null) {
        throw new Error("expected the ed25519 signature payload to parse");
      }
      expect(signatures).toHaveLength(1);
      expect(signatures[0].publicKey).toBe(keypair.publicKey());
    });

    it("treats the expiration ledger as exclusive", async () => {
      const signed = await authorizeEntry(
        addressEntry(),
        keypair,
        500,
        Networks.TESTNET,
      );

      expect(checkAuthEntryReadiness(signed, 499)).toEqual({
        ready: true,
        expired: false,
        unsignedBy: [],
      });
      expect(checkAuthEntryReadiness(signed, 500)).toEqual({
        ready: false,
        expired: true,
        unsignedBy: [],
      });
    });
  });

  describe("rejects an out-of-range ledger sequence", () => {
    const cases: number[] = [-1, 1.5, 4294967296, Number.NaN];

    for (const currentLedgerSeq of cases) {
      it(`throws for ${currentLedgerSeq}`, () => {
        expect(() => checkAuthEntryReadiness(sourceAccountEntry(), currentLedgerSeq))
          .toThrow("currentLedgerSeq must be a uint32 ledger sequence");
      });
    }
  });
});
