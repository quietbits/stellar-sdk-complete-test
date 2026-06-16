// HTTP response-handling coverage for @stellar/stellar-sdk.
//
// These are response *parsing* tests (exact values, error paths, malformed
// payloads, echoed XDR) that a live endpoint cannot reproduce deterministically.
// They run against a real loopback HTTP server (see helpers/server.ts) so each
// runtime's actual HTTP client is exercised — nothing about the transport is
// faked. Genuinely live behavior is covered in sdk-live-network.test.ts.
import {
  Account,
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";
import {
  type MockRequest,
  type MockResponse,
  startServer,
} from "./helpers/server.ts";

function makeTransactionFixtures() {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
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

  const operationResult = xdr.OperationResult.opInner(
    xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
  );
  const ext = xdr.TransactionResultExt.fromXDR("AAAAAA==", "base64");
  const successResult = new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txSuccess([operationResult]),
    ext,
  });
  const failedResult = new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txFailed([operationResult]),
    ext,
  });

  // switch(0) + empty operation list
  const resultMetaXdr = "AAAAAAAAAAA=";

  return {
    envelopeXdr: tx.toEnvelope().toXDR("base64"),
    successResultXdr: successResult.toXDR("base64"),
    failedResultXdr: failedResult.toXDR("base64"),
    resultMetaXdr,
  };
}

/** Echo the incoming JSON-RPC id back so any id-matching in the SDK passes. */
function rpcResult(req: MockRequest, result: unknown): MockResponse {
  const id = (req.json() as { id?: unknown }).id ?? 1;
  return { json: { jsonrpc: "2.0", id, result } };
}

function rpcError(req: MockRequest, error: unknown): MockResponse {
  const id = (req.json() as { id?: unknown }).id ?? 1;
  return { json: { jsonrpc: "2.0", id, error } };
}

function rpcMethod(req: MockRequest): string | undefined {
  return (req.json() as { method?: string }).method;
}

const FEE_STATS_BLOCK = {
  min: "100",
  max: "500",
  mode: "321",
  p10: "120",
  p20: "150",
  p30: "170",
  p40: "190",
  p50: "210",
  p60: "240",
  p70: "270",
  p80: "300",
  p90: "350",
  p95: "400",
  p99: "450",
};

describe("stellar-sdk HTTP response behavior (loopback)", () => {
  it("fetches base fee from a Horizon response", async () => {
    const server = await startServer((req) => {
      if (req.method === "GET" && req.pathname === "/fee_stats") {
        return {
          json: {
            last_ledger: "123456",
            last_ledger_base_fee: "321",
            ledger_capacity_usage: "0.50",
            fee_charged: FEE_STATS_BLOCK,
            max_fee: FEE_STATS_BLOCK,
          },
        };
      }
      return { status: 404, json: {} };
    });

    try {
      const horizon = new Horizon.Server(server.url, { allowHttp: true });
      expect(await horizon.fetchBaseFee()).toBe(321);
    } finally {
      await server.close();
    }
  });

  it("fetches health data from a Soroban RPC response", async () => {
    const server = await startServer((req) =>
      rpcMethod(req) === "getHealth"
        ? rpcResult(req, {
            status: "healthy",
            latestLedger: 999,
            oldestLedger: 900,
            ledgerRetentionWindow: 99,
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      const health = await server2.getHealth();
      expect(health.status).toBe("healthy");
      expect(health.latestLedger).toBe(999);
      expect(health.oldestLedger).toBe(900);
    } finally {
      await server.close();
    }
  });

  it("fetches Horizon root", async () => {
    const server = await startServer(() => ({
      json: {
        horizon_version: "2.0.0",
        core_version: "23.0.0",
        network_passphrase: "Test SDF Network ; September 2015",
      },
    }));

    try {
      const horizon = new Horizon.Server(server.url, { allowHttp: true });
      const root = await horizon.root();
      expect(root.horizon_version).toBe("2.0.0");
    } finally {
      await server.close();
    }
  });

  it("fetches network info from Soroban RPC", async () => {
    // NOTE: getLatestLedger XDR-decodes LedgerHeader + LedgerCloseMeta, which a
    // hand-rolled fixture can't satisfy under 16.0.0. That path is covered live
    // (sdk-live-network.test.ts) where the RPC returns genuinely valid XDR.
    const server = await startServer((req) =>
      rpcMethod(req) === "getNetwork"
        ? rpcResult(req, {
            passphrase: "Test SDF Network ; September 2015",
            protocolVersion: "23",
            friendbotUrl: "https://friendbot.stellar.org",
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      const network = await server2.getNetwork();
      expect(network.passphrase).toBe("Test SDF Network ; September 2015");
    } finally {
      await server.close();
    }
  });

  it("fetches fee stats from Soroban RPC", async () => {
    const server = await startServer((req) =>
      rpcMethod(req) === "getFeeStats"
        ? rpcResult(req, {
            feeCharged: {
              max: "1000",
              min: "100",
              mode: "120",
              p10: "110",
              p20: "115",
              p30: "118",
              p40: "119",
              p50: "120",
              p60: "121",
              p70: "122",
              p80: "123",
              p90: "124",
              p95: "125",
              p99: "126",
            },
            maxFee: {
              max: "2000",
              min: "200",
              mode: "220",
              p10: "210",
              p20: "215",
              p30: "218",
              p40: "219",
              p50: "220",
              p60: "221",
              p70: "222",
              p80: "223",
              p90: "224",
              p95: "225",
              p99: "226",
            },
            latestLedger: 555,
            ledgerCapacityUsage: 0.5,
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      const feeStats = await server2.getFeeStats();
      expect(feeStats.latestLedger).toBe(555);
    } finally {
      await server.close();
    }
  });

  it("handles NOT_FOUND getTransaction status from Soroban RPC", async () => {
    const txHash = "cafebabe";
    const server = await startServer((req) =>
      rpcMethod(req) === "getTransaction"
        ? rpcResult(req, {
            status: "NOT_FOUND",
            latestLedger: 100,
            latestLedgerCloseTime: 1700000000,
            oldestLedger: 90,
            oldestLedgerCloseTime: 1699999000,
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      const result = await server2.getTransaction(txHash);
      expect(result.status).toBe("NOT_FOUND");
      expect(result.txHash).toBe(txHash);
    } finally {
      await server.close();
    }
  });

  it("throws for malformed SUCCESS getTransaction response", async () => {
    const server = await startServer((req) =>
      rpcMethod(req) === "getTransaction"
        ? rpcResult(req, {
            status: "SUCCESS",
            latestLedger: 100,
            latestLedgerCloseTime: 1700000000,
            oldestLedger: 90,
            oldestLedgerCloseTime: 1699999000,
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      await expect(server2.getTransaction("hash-success")).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it("throws for malformed FAILED getTransaction response", async () => {
    const server = await startServer((req) =>
      rpcMethod(req) === "getTransaction"
        ? rpcResult(req, {
            status: "FAILED",
            latestLedger: 100,
            latestLedgerCloseTime: 1700000000,
            oldestLedger: 90,
            oldestLedgerCloseTime: 1699999000,
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      await expect(server2.getTransaction("hash-failed")).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it("throws when Horizon fee stats returns 500", async () => {
    const server = await startServer(() => ({
      status: 500,
      json: { title: "Internal Server Error" },
    }));

    try {
      const horizon = new Horizon.Server(server.url, { allowHttp: true });
      await expect(horizon.feeStats()).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it("throws when Soroban RPC returns a jsonrpc error payload", async () => {
    const server = await startServer((req) =>
      rpcMethod(req) === "getHealth"
        ? rpcError(req, { code: -32603, message: "internal error" })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      await expect(server2.getHealth()).rejects.toThrow();
    } finally {
      await server.close();
    }
  });

  it("falls back to default base fee for invalid Horizon payload", async () => {
    const server = await startServer((req) => {
      if (req.method === "GET" && req.pathname === "/fee_stats") {
        const flat = {
          min: "100",
          max: "100",
          mode: "100",
          p10: "100",
          p20: "100",
          p30: "100",
          p40: "100",
          p50: "100",
          p60: "100",
          p70: "100",
          p80: "100",
          p90: "100",
          p95: "100",
          p99: "100",
        };
        return {
          json: {
            last_ledger: "123",
            last_ledger_base_fee: "not-a-number",
            ledger_capacity_usage: "0.1",
            fee_charged: flat,
            max_fee: flat,
          },
        };
      }
      return { status: 404, json: {} };
    });

    try {
      const horizon = new Horizon.Server(server.url, { allowHttp: true });
      expect(await horizon.fetchBaseFee()).toBe(100);
    } finally {
      await server.close();
    }
  });

  it("keeps rpc parser behavior stable for empty events", () => {
    const parsed = rpc.parseRawEvents({
      transactionEventsXdr: [],
      contractEventsXdr: [],
    });

    expect(parsed.events).toEqual([]);
    expect(parsed.latestLedger).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
  });

  it("keeps rpc parser behavior stable for minimal simulation payload", () => {
    const parsed = rpc.parseRawSimulation({
      latestLedger: 1,
      cost: { cpuInsns: "1", memBytes: "1" },
      transactionData: "",
      events: [],
      minResourceFee: "1",
    });

    expect(parsed.latestLedger).toBe(1);
    expect(parsed.minResourceFee).toBe("1");
    expect(parsed.events).toEqual([]);
  });

  it("parses valid SUCCESS getTransaction response fixtures", async () => {
    const txHash = "hash-success-valid";
    const fixtures = makeTransactionFixtures();
    const server = await startServer((req) =>
      rpcMethod(req) === "getTransaction"
        ? rpcResult(req, {
            status: "SUCCESS",
            txHash,
            latestLedger: 120,
            latestLedgerCloseTime: 1700001000,
            oldestLedger: 100,
            oldestLedgerCloseTime: 1700000000,
            ledger: 110,
            createdAt: 1700000500,
            applicationOrder: 1,
            feeBump: false,
            envelopeXdr: fixtures.envelopeXdr,
            resultXdr: fixtures.successResultXdr,
            resultMetaXdr: fixtures.resultMetaXdr,
            events: { transactionEventsXdr: [], contractEventsXdr: [] },
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      const result = await server2.getTransaction(txHash);
      expect(result.status).toBe("SUCCESS");
      expect(result.envelopeXdr.toXDR("base64")).toBe(fixtures.envelopeXdr);
      expect(result.resultXdr.toXDR("base64")).toBe(fixtures.successResultXdr);
      expect(result.resultMetaXdr.toXDR("base64")).toBe(fixtures.resultMetaXdr);
    } finally {
      await server.close();
    }
  });

  it("parses valid FAILED getTransaction response fixtures", async () => {
    const txHash = "hash-failed-valid";
    const fixtures = makeTransactionFixtures();
    const server = await startServer((req) =>
      rpcMethod(req) === "getTransaction"
        ? rpcResult(req, {
            status: "FAILED",
            txHash,
            latestLedger: 120,
            latestLedgerCloseTime: 1700001000,
            oldestLedger: 100,
            oldestLedgerCloseTime: 1700000000,
            ledger: 110,
            createdAt: 1700000500,
            applicationOrder: 1,
            feeBump: false,
            envelopeXdr: fixtures.envelopeXdr,
            resultXdr: fixtures.failedResultXdr,
            resultMetaXdr: fixtures.resultMetaXdr,
            events: { transactionEventsXdr: [], contractEventsXdr: [] },
          })
        : { status: 404, json: {} },
    );

    try {
      const server2 = new rpc.Server(server.url, { allowHttp: true });
      const result = await server2.getTransaction(txHash);
      expect(result.status).toBe("FAILED");
      expect(result.envelopeXdr.toXDR("base64")).toBe(fixtures.envelopeXdr);
      expect(result.resultXdr.toXDR("base64")).toBe(fixtures.failedResultXdr);
      expect(result.resultMetaXdr.toXDR("base64")).toBe(fixtures.resultMetaXdr);
    } finally {
      await server.close();
    }
  });
});
