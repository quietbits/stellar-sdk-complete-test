// Behavior coverage for the `contract` assembly pipeline: `AssembledTransaction`'s
// `buildWithOp`, `validateInvokeContractOp`, `parseError` and `handleWalletError`,
// plus `SentTransaction`, `Watcher`, and `Client.fromWasmHash`.
//
// None of these have a test in js-stellar-sdk's suite. Its contract tests reach
// the network (`test/e2e`), so the failure paths here — a wallet returning a
// SEP-43 error code, a contract error discriminant, an envelope that targets the
// wrong contract — are not covered there and cannot be reproduced against a live
// endpoint on demand.
//
// Everything runs against the loopback JSON-RPC server: a real socket, so each
// runtime's own HTTP client and XDR decoder execute end to end. Ledger and
// simulation fixtures are built with the SDK's `xdr` constructors, so they stay
// valid for whichever version is installed.
import {
  Account,
  Asset,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  contract,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";
import { startServer } from "./helpers/server.ts";

const { AssembledTransaction, Client, Err, SentTransaction, Watcher } = contract;

const CONTRACT_ID = "CCN57TGC6EXFCYIQJ4UCD2UDZ4C3AQCHVMK74DGZ3JYCA5HD4BY7FNPC";
const OTHER_CONTRACT_ID =
  "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const NETWORK_PASSPHRASE = Networks.TESTNET;
// contract/types.js — the placeholder source used when no publicKey is supplied.
const NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
const RETURN_VALUE = xdr.ScVal.scvString("hello");

// --- Fixtures ---------------------------------------------------------------

const SOROBAN_DATA = new xdr.SorobanTransactionData({
  ext: new xdr.SorobanTransactionDataExt(0),
  resources: new xdr.SorobanResources({
    footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
    instructions: 0,
    diskReadBytes: 0,
    writeBytes: 0,
  }),
  resourceFee: new xdr.Int64(0),
});

const ACCOUNT_KEY = xdr.LedgerKey.account(
  new xdr.LedgerKeyAccount({
    accountId: xdr.PublicKey.publicKeyTypeEd25519(signer.rawPublicKey()),
  }),
).toXDR("base64");

function accountEntry(sequence: number): unknown {
  const accountId = xdr.PublicKey.publicKeyTypeEd25519(signer.rawPublicKey());
  const data = xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId,
      balance: new xdr.Int64(1000000000),
      // `SequenceNumber` is an XDR typedef for Int64; the alias is missing from
      // the published types (ISSUES.md issue 2), so construct the Int64 directly.
      seqNum: new xdr.Int64(sequence),
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.alloc(4),
      signers: [],
      ext: new xdr.AccountEntryExt(0),
    }),
  );
  return {
    key: ACCOUNT_KEY,
    xdr: data.toXDR("base64"),
    lastModifiedLedgerSeq: 1,
  };
}

const SUCCESS_META = new xdr.TransactionMeta(
  3,
  new xdr.TransactionMetaV3({
    ext: new xdr.ExtensionPoint(0),
    txChangesBefore: [],
    operations: [],
    txChangesAfter: [],
    sorobanMeta: new xdr.SorobanTransactionMeta({
      ext: new xdr.SorobanTransactionMetaExt(0),
      events: [],
      returnValue: RETURN_VALUE,
      diagnosticEvents: [],
    }),
  }),
).toXDR("base64");

const SUCCESS_RESULT = new xdr.TransactionResult({
  feeCharged: new xdr.Int64(100),
  result: xdr.TransactionResultResult.txSuccess([
    xdr.OperationResult.opInner(
      xdr.OperationResultTr.invokeHostFunction(
        xdr.InvokeHostFunctionResult.invokeHostFunctionSuccess(Buffer.alloc(32)),
      ),
    ),
  ]),
  ext: xdr.TransactionResultExt.fromXDR("AAAAAA==", "base64"),
}).toXDR("base64");

// LEB128 unsigned varint, as used for WASM section lengths.
function leb128(value: number): Buffer {
  const bytes: number[] = [];
  let n = value;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (n !== 0);
  return Buffer.from(bytes);
}

// Minimal valid WASM whose only content is a `contractspecv0` custom section.
function wasmWithSpec(entries: xdr.ScSpecEntry[]): Buffer {
  const name = Buffer.from("contractspecv0", "utf8");
  const sectionBody = Buffer.concat([
    leb128(name.length),
    name,
    Buffer.concat(entries.map((entry) => entry.toXDR())),
  ]);
  return Buffer.concat([
    Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
    Buffer.from([0x00]),
    leb128(sectionBody.length),
    sectionBody,
  ]);
}

const WASM = wasmWithSpec([
  xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: "",
      name: "hello",
      inputs: [],
      outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
    }),
  ),
]);
const WASM_HASH = hash(WASM);
const WASM_KEY = xdr.LedgerKey.contractCode(
  new xdr.LedgerKeyContractCode({ hash: WASM_HASH }),
).toXDR("base64");
const WASM_ENTRY = xdr.LedgerEntryData.contractCode(
  new xdr.ContractCodeEntry({
    ext: xdr.ContractCodeEntryExt.fromXDR(
      "AAAAAQAAAAAAAAAAAAAVqAAAAJwAAAADAAAAAwAAABgAAAABAAAAAQAAABEAAAAgAAABpA==",
      "base64",
    ),
    hash: WASM_HASH,
    code: WASM,
  }),
).toXDR("base64");

const HELLO_SPEC = new contract.Spec([
  xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: "",
      name: "hello",
      inputs: [],
      outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
    }),
  ),
]);

// --- Loopback JSON-RPC harness ---------------------------------------------

interface RpcRequest {
  method?: string;
  params?: { keys?: string[] };
}

interface RpcScript {
  /** `sendTransaction` result; defaults to a PENDING acknowledgement. */
  send?: unknown;
  /** `getTransaction` results, consumed one per call; the last one repeats. */
  getTransaction?: unknown[];
  /** Replaces the whole `simulateTransaction` result. */
  simulation?: unknown;
}

const PENDING_SEND = {
  status: "PENDING",
  hash: "ab".repeat(32),
  latestLedger: 100,
  latestLedgerCloseTime: "1",
};

function successfulGetTransaction(envelopeXdr: string): unknown {
  return {
    status: "SUCCESS",
    latestLedger: 101,
    latestLedgerCloseTime: "2",
    oldestLedger: 1,
    oldestLedgerCloseTime: "1",
    ledger: 100,
    createdAt: "1",
    applicationOrder: 1,
    feeBump: false,
    envelopeXdr,
    resultXdr: SUCCESS_RESULT,
    resultMetaXdr: SUCCESS_META,
  };
}

const NOT_FOUND_GET_TRANSACTION = {
  status: "NOT_FOUND",
  latestLedger: 100,
  latestLedgerCloseTime: "1",
  oldestLedger: 1,
  oldestLedgerCloseTime: "1",
};

/** Serves the RPC methods the assembly pipeline calls, then closes the server. */
async function withRpc<T>(
  run: (rpcUrl: string) => Promise<T>,
  script: RpcScript = {},
): Promise<T> {
  let getTransactionCalls = 0;

  const server = await startServer((req) => {
    const body = req.json() as RpcRequest;
    const wrap = (result: unknown) => ({
      json: { jsonrpc: "2.0", id: 1, result },
    });

    switch (body.method) {
      case "getLedgerEntries": {
        const key = body.params?.keys?.[0];
        if (key === WASM_KEY) {
          return wrap({
            latestLedger: 100,
            entries: [{
              key,
              xdr: WASM_ENTRY,
              lastModifiedLedgerSeq: 1,
              liveUntilLedgerSeq: 1000,
            }],
          });
        }
        if (key === ACCOUNT_KEY) {
          return wrap({ latestLedger: 100, entries: [accountEntry(1)] });
        }
        // Anything else — notably a contractCode key for wasm we do not hold —
        // is genuinely absent.
        return wrap({ latestLedger: 100, entries: [] });
      }
      case "simulateTransaction":
        return wrap(script.simulation ?? {
          latestLedger: 100,
          minResourceFee: "100",
          transactionData: SOROBAN_DATA.toXDR("base64"),
          events: [],
          results: [{ auth: [], xdr: RETURN_VALUE.toXDR("base64") }],
        });
      case "sendTransaction":
        return wrap(script.send ?? PENDING_SEND);
      case "getTransaction": {
        const responses = script.getTransaction ?? [];
        const index = Math.min(getTransactionCalls, responses.length - 1);
        getTransactionCalls += 1;
        return wrap(responses[index] ?? NOT_FOUND_GET_TRANSACTION);
      }
      default:
        return wrap({});
    }
  });

  try {
    return await run(server.url);
  } finally {
    await server.close();
  }
}

interface RpcRejection {
  code: number;
  message: string;
}

function isRpcRejection(value: unknown): value is RpcRejection {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code: unknown }).code === "number"
  );
}

/** Runs `call`, requiring it to throw, and returns whatever it threw. */
async function captureThrow(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw, but it returned");
}

function describeError(value: unknown): string {
  return value instanceof Error
    ? `${value.constructor.name}: ${value.message}`
    : String(value);
}

// --- AssembledTransaction.buildWithOp --------------------------------------

describe("stellar-sdk contract.AssembledTransaction.buildWithOp", () => {
  const baseOptions = {
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    allowHttp: true,
    method: "hello",
    parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
  };

  it("wraps an operation other than invokeHostFunction", async () => {
    const built = await withRpc((rpcUrl) =>
      AssembledTransaction.buildWithOp(
        Operation.extendFootprintTtl({ extendTo: 1000 }),
        { ...baseOptions, rpcUrl },
      )
    );

    const operations = built.built?.operations ?? [];
    expect(operations).toHaveLength(1);
    expect(operations[0].type).toBe("extendFootprintTtl");
  });

  it("is what build() delegates to, with a contract-call operation", async () => {
    const built = await withRpc((rpcUrl) =>
      AssembledTransaction.build({ ...baseOptions, rpcUrl, args: [] })
    );

    const operations = built.built?.operations ?? [];
    expect(operations).toHaveLength(1);
    expect(operations[0].type).toBe("invokeHostFunction");
  });

  it("skips simulation when simulate is false", async () => {
    const built = await withRpc((rpcUrl) =>
      AssembledTransaction.buildWithOp(
        Operation.extendFootprintTtl({ extendTo: 1000 }),
        { ...baseOptions, rpcUrl, simulate: false },
      )
    );

    expect(built.built).toBeUndefined();
    expect(built.simulation).toBeUndefined();
    expect(built.raw).toBeDefined();
  });

  it("sources the transaction from the null account when no publicKey is given", async () => {
    const built = await withRpc((rpcUrl) =>
      AssembledTransaction.buildWithOp(
        Operation.extendFootprintTtl({ extendTo: 1000 }),
        { ...baseOptions, rpcUrl },
      )
    );

    expect(built.built?.source).toBe(NULL_ACCOUNT);
  });

  it("fetches the sequence number when a publicKey is given", async () => {
    const built = await withRpc((rpcUrl) =>
      AssembledTransaction.buildWithOp(
        Operation.extendFootprintTtl({ extendTo: 1000 }),
        { ...baseOptions, rpcUrl, publicKey: signer.publicKey() },
      )
    );

    expect(built.built?.source).toBe(signer.publicKey());
    // The account is at sequence 1, so the transaction takes the next one.
    expect(built.built?.sequence).toBe("2");
  });

  it("carries the requested fee and timeout into the built transaction", async () => {
    const built = await withRpc((rpcUrl) =>
      AssembledTransaction.buildWithOp(
        Operation.extendFootprintTtl({ extendTo: 1000 }),
        { ...baseOptions, rpcUrl, fee: "12345", timeoutInSeconds: 77, simulate: false },
      )
    );

    const raw = built.raw?.build();
    expect(raw?.fee).toBe("12345");
    expect(Number(raw?.timeBounds?.maxTime ?? 0)).toBeTruthy();
  });
});

// --- AssembledTransaction.validateInvokeContractOp -------------------------
//
// Private, and reached through `fromXDR` / `fromJSON`, which is the path an
// application uses when a transaction arrives from elsewhere for co-signing.
// Every check below is a rejection of an envelope a caller did not author.

describe("stellar-sdk contract.AssembledTransaction envelope validation", () => {
  const options = {
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    allowHttp: true,
  };

  async function buildEncoded(): Promise<string> {
    return withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        contractId: CONTRACT_ID,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl,
        allowHttp: true,
        method: "hello",
        args: [],
        parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
      });
      return built.toXDR();
    });
  }

  function envelopeOf(operations: xdr.Operation[]): string {
    const builder = new TransactionBuilder(
      new Account(signer.publicKey(), "1"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE },
    );
    for (const operation of operations) builder.addOperation(operation);
    return builder.setTimeout(30).build().toEnvelope().toXDR("base64");
  }

  it("accepts a single invokeContract operation and recovers the method name", async () => {
    const encoded = await buildEncoded();
    const restored = await withRpc(async (rpcUrl) =>
      AssembledTransaction.fromXDR({ ...options, rpcUrl }, encoded, HELLO_SPEC)
    );

    expect(restored.options.method).toBe("hello");
    expect(restored.toXDR()).toBe(encoded);
  });

  it("rejects an envelope carrying more than one operation", async () => {
    const call = new Contract(CONTRACT_ID).call("hello");
    const encoded = envelopeOf([call, call]);

    const error = await withRpc(async (rpcUrl) =>
      captureThrow(() =>
        AssembledTransaction.fromXDR({ ...options, rpcUrl }, encoded, HELLO_SPEC)
      )
    );
    expect(describeError(error)).toContain("exactly one operation");
  });

  it("rejects an envelope whose operation is not invokeHostFunction", async () => {
    const encoded = envelopeOf([
      Operation.payment({
        destination: signer.publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    ]);

    const error = await withRpc(async (rpcUrl) =>
      captureThrow(() =>
        AssembledTransaction.fromXDR({ ...options, rpcUrl }, encoded, HELLO_SPEC)
      )
    );
    expect(describeError(error)).toContain(
      "does not contain an invokeHostFunction operation",
    );
  });

  it("rejects an invokeHostFunction that is not a contract invocation", async () => {
    const encoded = envelopeOf([Operation.uploadContractWasm({ wasm: WASM })]);

    const error = await withRpc(async (rpcUrl) =>
      captureThrow(() =>
        AssembledTransaction.fromXDR({ ...options, rpcUrl }, encoded, HELLO_SPEC)
      )
    );
    expect(describeError(error)).toContain(
      "does not contain an invokeContract host function",
    );
  });

  // The check that matters for a co-signing flow: a valid envelope for the
  // wrong contract must not be signed just because it parses.
  it("rejects an envelope targeting a different contract", async () => {
    const encoded = await buildEncoded();

    const error = await withRpc(async (rpcUrl) =>
      captureThrow(() =>
        AssembledTransaction.fromXDR(
          { ...options, contractId: OTHER_CONTRACT_ID, rpcUrl },
          encoded,
          HELLO_SPEC,
        )
      )
    );
    expect(describeError(error)).toContain(
      `targets contract ${CONTRACT_ID}, but this Client is configured for ${OTHER_CONTRACT_ID}`,
    );
  });

  it("rejects a fromJSON payload whose method disagrees with the envelope", async () => {
    const serialized = await withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        contractId: CONTRACT_ID,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl,
        allowHttp: true,
        method: "hello",
        args: [],
        parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
      });
      return built.toJSON();
    });

    const parsed = JSON.parse(serialized) as {
      tx: string;
      simulationResult: { auth: string[]; retval: string };
      simulationTransactionData: string;
    };

    const error = await withRpc(async (rpcUrl) =>
      captureThrow(() =>
        AssembledTransaction.fromJSON(
          {
            ...options,
            rpcUrl,
            method: "goodbye",
            parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
          },
          parsed,
        )
      )
    );
    expect(describeError(error)).toContain(
      "calls method 'hello', but the provided method is 'goodbye'",
    );
  });
});

// --- AssembledTransaction#parseError ---------------------------------------
//
// Private, and reached through the `result` getter: when `parseResultXdr` throws
// a host error naming a contract error discriminant, `parseError` maps it onto
// the caller's `errorTypes` table instead of propagating a raw string.

describe("stellar-sdk contract.AssembledTransaction contract-error mapping", () => {
  const errorTypes = {
    3: { message: "contract said no" },
  };

  function optionsThrowing(message: string, withErrorTypes: boolean) {
    return {
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      allowHttp: true,
      method: "hello",
      args: [],
      parseResultXdr: (): string => {
        throw new Error(message);
      },
      ...(withErrorTypes ? { errorTypes } : {}),
    };
  }

  it("maps a contract error discriminant onto the configured error type", async () => {
    const result = await withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        ...optionsThrowing("HostError: Error(Contract, #3)", true),
        rpcUrl,
      });
      return built.result;
    });

    expect(result).toBeInstanceOf(Err);
    expect(result).toHaveProperty("error.message", "contract said no");
  });

  it("rethrows when the discriminant has no entry in errorTypes", async () => {
    const error = await withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        ...optionsThrowing("HostError: Error(Contract, #99)", true),
        rpcUrl,
      });
      return captureThrow(() => built.result);
    });

    expect(describeError(error)).toContain("Error(Contract, #99)");
  });

  it("rethrows when no errorTypes table was supplied", async () => {
    const error = await withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        ...optionsThrowing("HostError: Error(Contract, #3)", false),
        rpcUrl,
      });
      return captureThrow(() => built.result);
    });

    expect(describeError(error)).toContain("Error(Contract, #3)");
  });

  // Only contract errors are translated; anything else must surface unchanged
  // rather than being swallowed into an Err.
  it("rethrows an error that is not a contract error", async () => {
    const error = await withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        ...optionsThrowing("something else went wrong", true),
        rpcUrl,
      });
      return captureThrow(() => built.result);
    });

    expect(describeError(error)).toContain("something else went wrong");
  });
});

// --- AssembledTransaction#handleWalletError --------------------------------
//
// Private, and reached through `sign()` when a SEP-43 wallet returns an error
// object instead of a signed envelope. The four negative codes are defined by
// SEP-43; each maps to a distinct error class so an application can branch on
// "user rejected" without string matching.

describe("stellar-sdk contract.AssembledTransaction wallet error codes", () => {
  async function signAgainstWalletError(
    walletError: { code: number; message: string; ext?: string[] },
  ): Promise<unknown> {
    return withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        contractId: CONTRACT_ID,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl,
        allowHttp: true,
        method: "hello",
        args: [],
        publicKey: signer.publicKey(),
        parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
        signTransaction: async () => ({ signedTxXdr: "", error: walletError }),
      });
      return captureThrow(() => built.sign({ force: true }));
    });
  }

  const cases: [number, string][] = [
    [-1, "InternalWalletError"],
    [-2, "ExternalServiceError"],
    [-3, "InvalidClientRequestError"],
    [-4, "UserRejectedError"],
  ];

  for (const [code, className] of cases) {
    it(`maps code ${code} to ${className}`, async () => {
      const error = await signAgainstWalletError({
        code,
        message: "wallet says no",
      });

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).constructor.name).toBe(className);
      expect((error as Error).message).toBe("wallet says no");
    });
  }

  it("falls back to a plain Error for an unrecognised code", async () => {
    const error = await signAgainstWalletError({
      code: -5,
      message: "wallet says no",
    });

    expect((error as Error).message).toBe("Unhandled error: wallet says no");
  });

  it("appends the ext details to the message", async () => {
    const error = await signAgainstWalletError({
      code: -4,
      message: "wallet says no",
      ext: ["detail-a", "detail-b"],
    });

    expect((error as Error).message).toBe(
      "wallet says no (detail-a, detail-b)",
    );
  });

  it("signs normally when the wallet returns no error", async () => {
    const signed = await withRpc(async (rpcUrl) => {
      const built = await AssembledTransaction.build({
        contractId: CONTRACT_ID,
        networkPassphrase: NETWORK_PASSPHRASE,
        rpcUrl,
        allowHttp: true,
        method: "hello",
        args: [],
        publicKey: signer.publicKey(),
        parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
        signTransaction: async (envelope: string) => {
          const transaction = TransactionBuilder.fromXDR(
            envelope,
            NETWORK_PASSPHRASE,
          );
          transaction.sign(signer);
          return { signedTxXdr: transaction.toXDR() };
        },
      });
      await built.sign({ force: true });
      return built.signed;
    });

    expect(signed?.signatures).toHaveLength(1);
  });
});

// --- SentTransaction and Watcher -------------------------------------------

describe("stellar-sdk contract.SentTransaction", () => {
  function sendOptions(rpcUrl: string) {
    return {
      contractId: CONTRACT_ID,
      networkPassphrase: NETWORK_PASSPHRASE,
      rpcUrl,
      allowHttp: true,
      method: "hello",
      args: [],
      publicKey: signer.publicKey(),
      timeoutInSeconds: 10,
      parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
      signTransaction: async (envelope: string) => {
        const transaction = TransactionBuilder.fromXDR(
          envelope,
          NETWORK_PASSPHRASE,
        );
        transaction.sign(signer);
        return { signedTxXdr: transaction.toXDR() };
      },
    };
  }

  it("parses the contract return value out of the transaction meta", async () => {
    const sent = await withRpc(
      async (rpcUrl) => {
        const built = await AssembledTransaction.build(sendOptions(rpcUrl));
        return built.signAndSend({ force: true });
      },
      {
        getTransaction: [
          successfulGetTransaction(
            new TransactionBuilder(new Account(signer.publicKey(), "1"), {
              fee: "100",
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(new Contract(CONTRACT_ID).call("hello"))
              .setTimeout(30)
              .build()
              .toEnvelope()
              .toXDR("base64"),
          ),
        ],
      },
    );

    expect(sent).toBeInstanceOf(SentTransaction);
    expect(sent.result).toBe("hello");
  });

  it("records the sendTransaction acknowledgement", async () => {
    const sent = await withRpc(
      async (rpcUrl) => {
        const built = await AssembledTransaction.build(sendOptions(rpcUrl));
        return built.signAndSend({ force: true });
      },
      {
        getTransaction: [
          successfulGetTransaction(
            new TransactionBuilder(new Account(signer.publicKey(), "1"), {
              fee: "100",
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(new Contract(CONTRACT_ID).call("hello"))
              .setTimeout(30)
              .build()
              .toEnvelope()
              .toXDR("base64"),
          ),
        ],
      },
    );

    expect(sent.sendTransactionResponse?.status).toBe("PENDING");
    expect(sent.sendTransactionResponse?.hash).toBe("ab".repeat(32));
  });

  it("keeps every getTransaction attempt while polling past NOT_FOUND", async () => {
    const envelope = new TransactionBuilder(
      new Account(signer.publicKey(), "1"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(new Contract(CONTRACT_ID).call("hello"))
      .setTimeout(30)
      .build()
      .toEnvelope()
      .toXDR("base64");

    const sent = await withRpc(
      async (rpcUrl) => {
        const built = await AssembledTransaction.build(sendOptions(rpcUrl));
        return built.signAndSend({ force: true });
      },
      {
        getTransaction: [
          NOT_FOUND_GET_TRANSACTION,
          successfulGetTransaction(envelope),
        ],
      },
    );

    expect(sent.getTransactionResponseAll).toHaveLength(2);
    expect(sent.getTransactionResponseAll?.[0].status).toBe("NOT_FOUND");
    expect(sent.getTransactionResponse?.status).toBe("SUCCESS");
  });

  // `send()` is the half of `signAndSend` that skips signing, for a transaction
  // that was signed elsewhere.
  it("can be sent on its own once the transaction is already signed", async () => {
    const envelope = new TransactionBuilder(
      new Account(signer.publicKey(), "1"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(new Contract(CONTRACT_ID).call("hello"))
      .setTimeout(30)
      .build()
      .toEnvelope()
      .toXDR("base64");

    const sent = await withRpc(
      async (rpcUrl) => {
        const built = await AssembledTransaction.build(sendOptions(rpcUrl));
        await built.sign({ force: true });
        return built.send();
      },
      { getTransaction: [successfulGetTransaction(envelope)] },
    );

    expect(sent).toBeInstanceOf(SentTransaction);
    expect(sent.result).toBe("hello");
  });

  it("raises SendFailed when the network does not accept the transaction", async () => {
    const error = await withRpc(
      async (rpcUrl) => {
        const built = await AssembledTransaction.build(sendOptions(rpcUrl));
        return captureThrow(() => built.signAndSend({ force: true }));
      },
      {
        send: {
          status: "ERROR",
          hash: "cd".repeat(32),
          latestLedger: 100,
          latestLedgerCloseTime: "1",
        },
      },
    );

    expect((error as Error).constructor.name).toBe("SendFailedError");
    expect((error as Error).message).toContain("failed");
  });
});

describe("stellar-sdk contract.Watcher", () => {
  it("is an abstract class with no concrete members of its own", () => {
    expect(typeof Watcher).toBe("function");
    expect(Object.getOwnPropertyNames(Watcher.prototype)).toEqual([
      "constructor",
    ]);
  });

  it("receives the send acknowledgement and every poll result", async () => {
    const events: [string, string | undefined][] = [];

    class RecordingWatcher extends Watcher {
      onSubmitted(response?: { status: string }): void {
        events.push(["submitted", response?.status]);
      }
      onProgress(response?: { status: string }): void {
        events.push(["progress", response?.status]);
      }
    }

    const envelope = new TransactionBuilder(
      new Account(signer.publicKey(), "1"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(new Contract(CONTRACT_ID).call("hello"))
      .setTimeout(30)
      .build()
      .toEnvelope()
      .toXDR("base64");

    await withRpc(
      async (rpcUrl) => {
        const built = await AssembledTransaction.build({
          contractId: CONTRACT_ID,
          networkPassphrase: NETWORK_PASSPHRASE,
          rpcUrl,
          allowHttp: true,
          method: "hello",
          args: [],
          publicKey: signer.publicKey(),
          timeoutInSeconds: 10,
          parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
          signTransaction: async (raw: string) => {
            const transaction = TransactionBuilder.fromXDR(
              raw,
              NETWORK_PASSPHRASE,
            );
            transaction.sign(signer);
            return { signedTxXdr: transaction.toXDR() };
          },
        });
        return built.signAndSend({
          force: true,
          watcher: new RecordingWatcher(),
        });
      },
      {
        getTransaction: [
          NOT_FOUND_GET_TRANSACTION,
          successfulGetTransaction(envelope),
        ],
      },
    );

    expect(events).toEqual([
      ["submitted", "PENDING"],
      ["progress", "NOT_FOUND"],
      ["progress", "SUCCESS"],
    ]);
  });

  // The callbacks are declared optional, so a watcher that implements only one
  // of them must not break the send loop.
  it("tolerates a watcher that implements only one callback", async () => {
    const seen: string[] = [];

    class SubmitOnlyWatcher extends Watcher {
      onSubmitted(): void {
        seen.push("submitted");
      }
      onProgress = undefined;
    }

    const envelope = new TransactionBuilder(
      new Account(signer.publicKey(), "1"),
      { fee: "100", networkPassphrase: NETWORK_PASSPHRASE },
    )
      .addOperation(new Contract(CONTRACT_ID).call("hello"))
      .setTimeout(30)
      .build()
      .toEnvelope()
      .toXDR("base64");

    const sent = await withRpc(
      async (rpcUrl) => {
        const built = await AssembledTransaction.build({
          contractId: CONTRACT_ID,
          networkPassphrase: NETWORK_PASSPHRASE,
          rpcUrl,
          allowHttp: true,
          method: "hello",
          args: [],
          publicKey: signer.publicKey(),
          timeoutInSeconds: 10,
          parseResultXdr: (value: xdr.ScVal): string => value.str().toString(),
          signTransaction: async (raw: string) => {
            const transaction = TransactionBuilder.fromXDR(
              raw,
              NETWORK_PASSPHRASE,
            );
            transaction.sign(signer);
            return { signedTxXdr: transaction.toXDR() };
          },
        });
        return built.signAndSend({
          force: true,
          watcher: new SubmitOnlyWatcher(),
        });
      },
      { getTransaction: [successfulGetTransaction(envelope)] },
    );

    expect(seen).toEqual(["submitted"]);
    expect(sent.result).toBe("hello");
  });
});

// --- Client.fromWasmHash ---------------------------------------------------

describe("stellar-sdk contract.Client.fromWasmHash", () => {
  const options = {
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    allowHttp: true,
  };

  it("accepts a hex hash by default", async () => {
    const client = await withRpc((rpcUrl) =>
      Client.fromWasmHash(WASM_HASH.toString("hex"), { ...options, rpcUrl })
    );

    expect(client).toBeInstanceOf(Client);
    expect(client.spec.funcs().map((func) => func.name().toString())).toEqual([
      "hello",
    ]);
  });

  it("accepts a base64 hash when told the format", async () => {
    const client = await withRpc((rpcUrl) =>
      Client.fromWasmHash(
        WASM_HASH.toString("base64"),
        { ...options, rpcUrl },
        "base64",
      )
    );

    expect(client.spec.funcs()).toHaveLength(1);
  });

  it("accepts a raw Buffer hash", async () => {
    const client = await withRpc((rpcUrl) =>
      Client.fromWasmHash(WASM_HASH, { ...options, rpcUrl })
    );

    expect(client.spec.funcs()).toHaveLength(1);
  });

  it("rejects with a TypeError when rpcUrl is missing", async () => {
    await expect(
      Client.fromWasmHash(WASM_HASH, { ...options, rpcUrl: "" }),
    ).rejects.toThrow(TypeError);
  });

  it("rejects with 404 when no ledger entry holds that wasm", async () => {
    const error = await withRpc((rpcUrl) =>
      captureThrow(() =>
        Client.fromWasmHash(hash(Buffer.from("absent")), { ...options, rpcUrl })
      )
    );

    expect(isRpcRejection(error)).toBe(true);
    if (isRpcRejection(error)) expect(error.code).toBe(404);
  });
});
