import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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

describe("stellar-sdk mocked response behavior", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  it("fetches base fee from mocked Horizon response", async () => {
    const horizonUrl = "http://horizon.local";
    const server = new Horizon.Server(horizonUrl, { allowHttp: true });

    const scope = nock(horizonUrl)
      .get("/fee_stats")
      .reply(200, {
        last_ledger: "123456",
        last_ledger_base_fee: "321",
        ledger_capacity_usage: "0.50",
        fee_charged: {
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
        },
        max_fee: {
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
        },
      });

    const baseFee = await server.fetchBaseFee();

    expect(baseFee).toBe(321);
    scope.done();
  });

  it("fetches health data from mocked Soroban RPC response", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getHealth";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 1,
        result: {
          status: "healthy",
          latestLedger: 999,
          oldestLedger: 900,
          ledgerRetentionWindow: 99,
        },
      });

    const health = await server.getHealth();

    expect(health.status).toBe("healthy");
    expect(health.latestLedger).toBe(999);
    expect(health.oldestLedger).toBe(900);
    scope.done();
  });

  it("fetches Horizon root from mocked response", async () => {
    const horizonUrl = "http://horizon.local";
    const server = new Horizon.Server(horizonUrl, { allowHttp: true });

    const scope = nock(horizonUrl).get("/").reply(200, {
      horizon_version: "2.0.0",
      core_version: "23.0.0",
      network_passphrase: "Test SDF Network ; September 2015",
    });

    const root = await server.root();

    expect(root.horizon_version).toBe("2.0.0");
    scope.done();
  });

  it("fetches network and latest ledger from mocked Soroban RPC responses", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });

    const networkScope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getNetwork";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 2,
        result: {
          passphrase: "Test SDF Network ; September 2015",
          protocolVersion: "23",
          friendbotUrl: "https://friendbot.stellar.org",
        },
      });

    const latestLedgerScope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getLatestLedger";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 3,
        result: {
          id: "abc123",
          sequence: 1234,
          protocolVersion: "23",
          // v16: getLatestLedger now XDR-decodes headerXdr (LedgerHeader) and
          // metadataXdr (LedgerCloseMeta); both are required. These fixtures
          // are valid base64 XDR for a ledger at sequence 1234.
          headerXdr:
            "AAAAFwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZAX14QAAAABkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          metadataXdr:
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABNIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAZAX14QAAAABkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
        },
      });

    const network = await server.getNetwork();
    const latest = await server.getLatestLedger();

    expect(network.passphrase).toBe("Test SDF Network ; September 2015");
    expect(latest.sequence).toBe(1234);
    networkScope.done();
    latestLedgerScope.done();
  });

  it("fetches fee stats from mocked Soroban RPC response", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getFeeStats";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 4,
        result: {
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
        },
      });

    const feeStats = await server.getFeeStats();

    expect(feeStats.latestLedger).toBe(555);
    scope.done();
  });

  it("handles NOT_FOUND getTransaction status from mocked Soroban RPC", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const txHash = "cafebabe";

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getTransaction";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 5,
        result: {
          status: "NOT_FOUND",
          latestLedger: 100,
          latestLedgerCloseTime: 1700000000,
          oldestLedger: 90,
          oldestLedgerCloseTime: 1699999000,
        },
      });

    const result = await server.getTransaction(txHash);

    expect(result.status).toBe("NOT_FOUND");
    expect(result.txHash).toBe(txHash);
    scope.done();
  });

  it("throws for malformed SUCCESS getTransaction response", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getTransaction";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 6,
        result: {
          status: "SUCCESS",
          latestLedger: 100,
          latestLedgerCloseTime: 1700000000,
          oldestLedger: 90,
          oldestLedgerCloseTime: 1699999000,
        },
      });

    await expect(server.getTransaction("hash-success")).rejects.toThrow();
    scope.done();
  });

  it("throws for malformed FAILED getTransaction response", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getTransaction";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 7,
        result: {
          status: "FAILED",
          latestLedger: 100,
          latestLedgerCloseTime: 1700000000,
          oldestLedger: 90,
          oldestLedgerCloseTime: 1699999000,
        },
      });

    await expect(server.getTransaction("hash-failed")).rejects.toThrow();
    scope.done();
  });

  it("throws when Horizon fee stats returns 500", async () => {
    const horizonUrl = "http://horizon.local";
    const server = new Horizon.Server(horizonUrl, { allowHttp: true });

    const scope = nock(horizonUrl)
      .get("/fee_stats")
      .reply(500, { title: "Internal Server Error" });

    await expect(server.feeStats()).rejects.toThrow();
    scope.done();
  });

  it("throws when Soroban RPC returns jsonrpc error payload", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getHealth";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 8,
        error: {
          code: -32603,
          message: "internal error",
        },
      });

    await expect(server.getHealth()).rejects.toThrow();
    scope.done();
  });

  it("falls back to default base fee for invalid Horizon payload", async () => {
    const horizonUrl = "http://horizon.local";
    const server = new Horizon.Server(horizonUrl, { allowHttp: true });

    const scope = nock(horizonUrl)
      .get("/fee_stats")
      .reply(200, {
        last_ledger: "123",
        last_ledger_base_fee: "not-a-number",
        ledger_capacity_usage: "0.1",
        fee_charged: {
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
        },
        max_fee: {
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
        },
      });

    const baseFee = await server.fetchBaseFee();

    expect(baseFee).toBe(100);
    scope.done();
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
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const txHash = "hash-success-valid";
    const fixtures = makeTransactionFixtures();

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getTransaction";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 9,
        result: {
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
        },
      });

    const result = await server.getTransaction(txHash);

    expect(result.status).toBe("SUCCESS");
    expect(result.envelopeXdr.toXDR("base64")).toBe(fixtures.envelopeXdr);
    expect(result.resultXdr.toXDR("base64")).toBe(fixtures.successResultXdr);
    expect(result.resultMetaXdr.toXDR("base64")).toBe(fixtures.resultMetaXdr);
    scope.done();
  });

  it("parses valid FAILED getTransaction response fixtures", async () => {
    const rpcUrl = "http://rpc.local";
    const server = new rpc.Server(rpcUrl, { allowHttp: true });
    const txHash = "hash-failed-valid";
    const fixtures = makeTransactionFixtures();

    const scope = nock(rpcUrl)
      .post("/", (body: unknown) => {
        if (typeof body !== "object" || body === null) {
          return false;
        }

        const parsed = body as { method?: string };
        return parsed.method === "getTransaction";
      })
      .reply(200, {
        jsonrpc: "2.0",
        id: 10,
        result: {
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
        },
      });

    const result = await server.getTransaction(txHash);

    expect(result.status).toBe("FAILED");
    expect(result.envelopeXdr.toXDR("base64")).toBe(fixtures.envelopeXdr);
    expect(result.resultXdr.toXDR("base64")).toBe(fixtures.failedResultXdr);
    expect(result.resultMetaXdr.toXDR("base64")).toBe(fixtures.resultMetaXdr);
    scope.done();
  });
});
