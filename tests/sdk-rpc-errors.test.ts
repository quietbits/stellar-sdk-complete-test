// Behavior coverage for the remaining symbols with no upstream test: the
// `NetworkError` hierarchy (`getResponse`, `BadRequestError`), the `Friendbot`
// namespace, the two RPC sleep strategies, and `rpc.Server`'s
// `prepareTransaction` and `getLedgerEntry`.
//
// Errors are exercised through the loopback server rather than live, because the
// interesting cases are specific HTTP statuses and a Horizon problem document,
// which a real endpoint will not produce on demand.
//
// `getLedgerEntry` (singular) was credited to upstream by the coverage audit on
// the strength of two `//` comments in `test/unit/server/soroban/request_airdrop.test.ts`
// — no upstream test calls it. Recorded under ISSUES.md issue 7.
import {
  Account,
  Asset,
  BadRequestError,
  Contract,
  Friendbot,
  Horizon,
  Keypair,
  NetworkError,
  Networks,
  NotFoundError,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";
import { startServer } from "./helpers/server.ts";

const CONTRACT_ID = "CCN57TGC6EXFCYIQJ4UCD2UDZ4C3AQCHVMK74DGZ3JYCA5HD4BY7FNPC";
const source = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));

/** Runs `call`, requiring it to throw, and returns whatever it threw. */
async function captureThrow(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, but it returned");
}

// --- NetworkError -----------------------------------------------------------

describe("stellar-sdk NetworkError#getResponse", () => {
  it("hands back the response it was constructed with, by reference", () => {
    const response = { status: 500, data: { detail: "boom" } };
    const error = new NetworkError("Server Error", response);

    expect(error.getResponse()).toBe(response);
    expect(error.message).toBe("Server Error");
    expect(error).toBeInstanceOf(Error);
  });

  it("returns undefined when no response was attached", () => {
    expect(new NetworkError("offline", undefined).getResponse()).toBeUndefined();
  });

  describe("as raised by a Horizon call", () => {
    const problemDocument = {
      type: "https://stellar.org/horizon-errors/transaction_malformed",
      title: "Transaction Malformed",
      status: 400,
      detail: "Horizon could not decode the transaction envelope",
      extras: { envelope_xdr: "not-base64" },
    };

    async function callAgainst(status: number, body: unknown): Promise<unknown> {
      const server = await startServer(() => ({ status, json: body }));
      try {
        const horizon = new Horizon.Server(server.url, { allowHttp: true });
        return await captureThrow(() =>
          horizon.transactions().transaction("deadbeef").call()
        );
      } finally {
        await server.close();
      }
    }

    it("carries the whole Horizon problem document as the response", async () => {
      const error = await callAgainst(400, problemDocument);

      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NetworkError).getResponse()).toEqual(problemDocument);
    });

    it("uses the HTTP status text as the error message", async () => {
      const error = await callAgainst(400, problemDocument);

      expect((error as NetworkError).message).toBe("Bad Request");
    });

    it("raises NotFoundError, a NetworkError subclass, for a 404", async () => {
      const notFound = {
        type: "https://stellar.org/horizon-errors/not_found",
        title: "Resource Missing",
        status: 404,
      };
      const error = await callAgainst(404, notFound);

      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(NetworkError);
      expect((error as NotFoundError).getResponse()).toEqual(notFound);
    });

    // Only 404 gets its own class; every other status collapses to the base
    // NetworkError, so a 400 from Horizon is NOT a BadRequestError despite the
    // name. Callers have to read `getResponse().status` to tell them apart.
    it("does not raise BadRequestError for an HTTP 400", async () => {
      const error = await callAgainst(400, problemDocument);

      expect(error).not.toBeInstanceOf(BadRequestError);
      expect((error as NetworkError).getResponse()).toHaveProperty("status", 400);
    });
  });
});

// --- BadRequestError --------------------------------------------------------

describe("stellar-sdk BadRequestError", () => {
  it("extends NetworkError and inherits getResponse", () => {
    const error = new BadRequestError("nope", ["a", "b"]);

    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toBeInstanceOf(Error);
    expect(error.getResponse()).toEqual(["a", "b"]);
  });

  // Every SDK error class reports `name` as "Error" because none of them assign
  // it; this is a long-standing SDK-wide convention, already noted in ISSUES.md
  // issue 4, not something specific to this class.
  it("reports its constructor name only through the constructor", () => {
    const error = new BadRequestError("nope", []);

    expect(error.name).toBe("Error");
    expect(error.constructor.name).toBe("BadRequestError");
  });

  // The one path in the SDK that actually raises it: a call builder is allowed
  // at most one relationship filter, and the second one is rejected client-side
  // before any request goes out.
  it("is raised locally when a call builder is given two filters", async () => {
    const server = await startServer(() => ({ status: 200, json: {} }));
    try {
      const horizon = new Horizon.Server(server.url, { allowHttp: true });
      const error = await captureThrow(() =>
        horizon.operations().forAccount(source.publicKey()).forLedger(1).call()
      );

      expect(error).toBeInstanceOf(BadRequestError);
      expect((error as BadRequestError).message).toBe(
        "Too many filters specified",
      );
    } finally {
      await server.close();
    }
  });

  it("attaches the conflicting filters as its response", async () => {
    const server = await startServer(() => ({ status: 200, json: {} }));
    try {
      const horizon = new Horizon.Server(server.url, { allowHttp: true });
      const error = await captureThrow(() =>
        horizon.operations().forAccount(source.publicKey()).forLedger(1).call()
      );
      const filters = (error as BadRequestError).getResponse();

      expect(filters).toHaveLength(2);
    } finally {
      await server.close();
    }
  });
});

// --- Friendbot --------------------------------------------------------------

describe("stellar-sdk Friendbot", () => {
  // `Friendbot` is a types-only namespace: it declares `Friendbot.Api.Response`
  // for typing a friendbot funding reply, and TypeScript's `export * as` still
  // emits a runtime binding for it. Pinning the shape so a future release that
  // adds runtime members to it shows up here.
  it("is exported at runtime as an empty namespace object", () => {
    expect(typeof Friendbot).toBe("object");
    expect(Friendbot).not.toBeNull();
  });

  it("exposes no runtime members", () => {
    expect(Object.keys(Friendbot)).toEqual([]);
    expect(Object.getOwnPropertyNames(Friendbot)).toEqual([]);
  });
});

// --- Sleep strategies -------------------------------------------------------

describe("stellar-sdk rpc.BasicSleepStrategy", () => {
  it("waits one second regardless of the attempt number", () => {
    expect(rpc.BasicSleepStrategy(1)).toBe(1000);
    expect(rpc.BasicSleepStrategy(2)).toBe(1000);
    expect(rpc.BasicSleepStrategy(99)).toBe(1000);
  });

  it("is constant at the boundary attempts", () => {
    expect(rpc.BasicSleepStrategy(0)).toBe(1000);
    expect(rpc.BasicSleepStrategy(Number.MAX_SAFE_INTEGER)).toBe(1000);
  });

  it("takes the iteration as its single parameter", () => {
    expect(typeof rpc.BasicSleepStrategy).toBe("function");
    expect(rpc.BasicSleepStrategy).toHaveLength(1);
  });
});

describe("stellar-sdk rpc.LinearSleepStrategy", () => {
  it("waits one second per attempt", () => {
    expect(rpc.LinearSleepStrategy(1)).toBe(1000);
    expect(rpc.LinearSleepStrategy(2)).toBe(2000);
    expect(rpc.LinearSleepStrategy(10)).toBe(10000);
  });

  it("does not wait at all on iteration zero", () => {
    expect(rpc.LinearSleepStrategy(0)).toBe(0);
  });

  it("diverges from the basic strategy after the first attempt", () => {
    expect(rpc.LinearSleepStrategy(1)).toBe(rpc.BasicSleepStrategy(1));
    expect(rpc.LinearSleepStrategy(2)).not.toBe(rpc.BasicSleepStrategy(2));
  });
});

// --- rpc.Server#prepareTransaction -----------------------------------------

describe("stellar-sdk rpc.Server#prepareTransaction", () => {
  function sorobanData(resourceFee: number): xdr.SorobanTransactionData {
    return new xdr.SorobanTransactionData({
      ext: new xdr.SorobanTransactionDataExt(0),
      resources: new xdr.SorobanResources({
        footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
        instructions: 7,
        diskReadBytes: 8,
        writeBytes: 9,
      }),
      resourceFee: new xdr.Int64(resourceFee),
    });
  }

  const authEntry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction
        .sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Contract(CONTRACT_ID).address().toScAddress(),
            functionName: "hello",
            args: [],
          }),
        ),
      subInvocations: [],
    }),
  });

  function invokeTransaction(fee = "100") {
    return new TransactionBuilder(new Account(source.publicKey(), "1"), {
      fee,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(new Contract(CONTRACT_ID).call("hello"))
      .setTimeout(30)
      .build();
  }

  const successfulSimulation = {
    latestLedger: 100,
    minResourceFee: "5000",
    transactionData: sorobanData(5000).toXDR("base64"),
    events: [],
    results: [{
      auth: [authEntry.toXDR("base64")],
      xdr: xdr.ScVal.scvString("hi").toXDR("base64"),
    }],
  };

  async function withSimulation<T>(
    result: unknown,
    run: (server: rpc.Server) => Promise<T>,
  ): Promise<T> {
    const loopback = await startServer(() => ({
      json: { jsonrpc: "2.0", id: 1, result },
    }));
    try {
      return await run(new rpc.Server(loopback.url, { allowHttp: true }));
    } finally {
      await loopback.close();
    }
  }

  it("attaches the simulated Soroban resources to the transaction", async () => {
    const prepared = await withSimulation(
      successfulSimulation,
      (server) => server.prepareTransaction(invokeTransaction()),
    );

    const resources = prepared.toEnvelope().v1().tx().ext().sorobanData()
      .resources();
    expect(resources.instructions()).toBe(7);
    expect(resources.diskReadBytes()).toBe(8);
    expect(resources.writeBytes()).toBe(9);
  });

  it("adds the simulated resource fee to the classic fee", async () => {
    const prepared = await withSimulation(
      successfulSimulation,
      (server) => server.prepareTransaction(invokeTransaction("100")),
    );

    expect(prepared.fee).toBe("5100");
  });

  it("copies the authorization entries returned by simulation", async () => {
    const prepared = await withSimulation(
      successfulSimulation,
      (server) => server.prepareTransaction(invokeTransaction()),
    );

    const operation = prepared.operations[0];
    expect(operation.type).toBe("invokeHostFunction");
    if (operation.type === "invokeHostFunction") {
      expect(operation.auth).toHaveLength(1);
      expect(operation.auth?.[0].toXDR("base64")).toBe(
        authEntry.toXDR("base64"),
      );
    }
  });

  it("leaves the transaction it was given untouched", async () => {
    const original = invokeTransaction();
    const before = original.toEnvelope().toXDR("base64");

    await withSimulation(
      successfulSimulation,
      (server) => server.prepareTransaction(original),
    );

    expect(original.toEnvelope().toXDR("base64")).toBe(before);
    expect(original.fee).toBe("100");
  });

  it("throws the simulation error verbatim when simulation fails", async () => {
    const error = await withSimulation(
      { latestLedger: 100, error: "HostError: contract exploded", events: [] },
      (server) => captureThrow(() => server.prepareTransaction(invokeTransaction())),
    );

    expect((error as Error).message).toBe("HostError: contract exploded");
  });

  it("rejects a transaction that is not a Soroban transaction", async () => {
    const classic = new TransactionBuilder(
      new Account(source.publicKey(), "1"),
      { fee: "100", networkPassphrase: Networks.TESTNET },
    )
      .addOperation(
        Operation.payment({
          destination: source.publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(30)
      .build();

    const error = await withSimulation(
      successfulSimulation,
      (server) => captureThrow(() => server.prepareTransaction(classic)),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toContain("unsupported transaction");
  });
});

// --- rpc.Server#getLedgerEntry ---------------------------------------------
//
// The singular convenience wrapper over `getLedgerEntries`. Its whole reason to
// exist is the "exactly one" contract: it unwraps the array, and turns both
// "nothing found" and "more than one" into an error rather than handing back an
// ambiguous result. That contract is what is tested here.

describe("stellar-sdk rpc.Server#getLedgerEntry", () => {
  const accountId = xdr.PublicKey.publicKeyTypeEd25519(source.rawPublicKey());
  const ledgerKey = xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId }),
  );
  const otherKey = xdr.LedgerKey.contractCode(
    new xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, 7) }),
  );

  function accountEntryXdr(balance: number): string {
    return xdr.LedgerEntryData.account(
      new xdr.AccountEntry({
        accountId,
        balance: new xdr.Int64(balance),
        // `SequenceNumber` is an XDR typedef for Int64, missing from the
        // published types (ISSUES.md issue 2).
        seqNum: new xdr.Int64(1),
        numSubEntries: 0,
        inflationDest: null,
        flags: 0,
        homeDomain: "",
        thresholds: Buffer.alloc(4),
        signers: [],
        ext: new xdr.AccountEntryExt(0),
      }),
    ).toXDR("base64");
  }

  async function withEntries<T>(
    entries: unknown[],
    run: (server: rpc.Server) => Promise<T>,
  ): Promise<T> {
    const loopback = await startServer(() => ({
      json: {
        jsonrpc: "2.0",
        id: 1,
        result: { latestLedger: 100, entries },
      },
    }));
    try {
      return await run(new rpc.Server(loopback.url, { allowHttp: true }));
    } finally {
      await loopback.close();
    }
  }

  it("returns the single entry, unwrapped from the array", async () => {
    const entry = await withEntries(
      [{
        key: ledgerKey.toXDR("base64"),
        xdr: accountEntryXdr(250),
        lastModifiedLedgerSeq: 42,
        liveUntilLedgerSeq: 1000,
      }],
      (server) => server.getLedgerEntry(ledgerKey),
    );

    expect(entry.lastModifiedLedgerSeq).toBe(42);
    expect(entry.liveUntilLedgerSeq).toBe(1000);
    expect(entry.val.account().balance().toString()).toBe("250");
  });

  it("decodes the key and value into XDR objects rather than base64", async () => {
    const entry = await withEntries(
      [{
        key: ledgerKey.toXDR("base64"),
        xdr: accountEntryXdr(1),
        lastModifiedLedgerSeq: 1,
      }],
      (server) => server.getLedgerEntry(ledgerKey),
    );

    expect(entry.key.toXDR("base64")).toBe(ledgerKey.toXDR("base64"));
    expect(entry.val.switch().name).toBe("account");
  });

  // The distinguishing behaviour versus `getLedgerEntries`, which returns an
  // empty array for a missing key without complaint.
  it("throws when the key matches no entry", async () => {
    const error = await withEntries(
      [],
      (server) => captureThrow(() => server.getLedgerEntry(ledgerKey)),
    );

    expect((error as Error).message).toContain("failed to find an entry for key");
    expect((error as Error).message).toContain(ledgerKey.toXDR("base64"));
  });

  it("throws when the server returns more than one entry", async () => {
    const error = await withEntries(
      [
        {
          key: ledgerKey.toXDR("base64"),
          xdr: accountEntryXdr(1),
          lastModifiedLedgerSeq: 1,
        },
        {
          key: otherKey.toXDR("base64"),
          xdr: accountEntryXdr(2),
          lastModifiedLedgerSeq: 2,
        },
      ],
      (server) => captureThrow(() => server.getLedgerEntry(ledgerKey)),
    );

    expect((error as Error).message).toContain("failed to find an entry for key");
  });

  it("still returns the entry when the ledger entry has no TTL", async () => {
    const entry = await withEntries(
      [{
        key: ledgerKey.toXDR("base64"),
        xdr: accountEntryXdr(5),
        lastModifiedLedgerSeq: 3,
      }],
      (server) => server.getLedgerEntry(ledgerKey),
    );

    expect(entry.liveUntilLedgerSeq).toBeUndefined();
    expect(entry.lastModifiedLedgerSeq).toBe(3);
  });

  it("propagates a decode failure for malformed entry XDR", async () => {
    const error = await withEntries(
      [{
        key: ledgerKey.toXDR("base64"),
        xdr: "not-valid-xdr",
        lastModifiedLedgerSeq: 1,
      }],
      (server) => captureThrow(() => server.getLedgerEntry(ledgerKey)),
    );

    expect((error as Error).message).toContain("XDR Read Error");
  });
});
