// Coverage for the contract-instance / SAC dynamic-import work added in the
// js-stellar-sdk `issue-1166` branch:
//
//   - rpc.Server.getContractInstance()          (new public method)
//   - rpc.Server.getContractWasmByContractId()  (now rejects a SAC with 400)
//   - contract.Client.from()                    (SAC path lazily `import()`s the
//                                                 embedded SAC spec; Wasm path
//                                                 downloads bytecode)
//
// Like the rest of the suite these run identically on Node, Deno, and Bun. They
// use the real loopback HTTP server (not request interception), so each
// runtime's actual JSON-RPC client and XDR decoder execute end-to-end. Ledger
// fixtures are built from the SDK's own `xdr` constructors (pure Buffer ops, no
// filesystem), so they are always valid for the installed SDK version.
import { Contract, contract, hash, rpc, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";
import { startServer } from "./helpers/server.ts";

const { Server } = rpc;
const { Client } = contract;

const networkPassphrase = "Test SDF Network ; September 2015";
const contractId = "CCN57TGC6EXFCYIQJ4UCD2UDZ4C3AQCHVMK74DGZ3JYCA5HD4BY7FNPC";

const contractObj = new Contract(contractId);
const contractLedgerKey = contractObj.getFootprint();
const address = contractObj.address();

// --- Fixture builders -------------------------------------------------------

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

// Minimal valid WASM whose only content is a `contractspecv0` custom section
// carrying the given spec entries — enough for `Spec.fromWasm` to parse.
function wasmWithSpec(entries: xdr.ScSpecEntry[]): Buffer {
  const name = Buffer.from("contractspecv0", "utf8");
  const payload = Buffer.concat(entries.map((e) => e.toXDR()));
  const sectionBody = Buffer.concat([leb128(name.length), name, payload]);
  const customSection = Buffer.concat([
    Buffer.from([0x00]), // custom section id
    leb128(sectionBody.length),
    sectionBody,
  ]);
  const header = Buffer.from([
    0x00, 0x61, 0x73, 0x6d, // "\0asm" magic
    0x01, 0x00, 0x00, 0x00, // version 1
  ]);
  return Buffer.concat([header, customSection]);
}

function instanceEntry(
  executable: xdr.ContractExecutable,
): xdr.LedgerEntryData {
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: new xdr.ExtensionPoint(0),
      contract: address.toScAddress(),
      durability: xdr.ContractDataDurability.persistent(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      val: xdr.ScVal.scvContractInstance(
        new xdr.ScContractInstance({ executable, storage: null }),
      ),
    }),
  );
}

// A SAC's instance carries a `StellarAsset` executable — no wasm hash.
const sacInstanceEntry = instanceEntry(
  xdr.ContractExecutable.contractExecutableStellarAsset(),
);

// A synthetic wasm exposing a single `hello` function so `Spec.fromWasm` parses.
const wasmBuffer = wasmWithSpec([
  xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({ doc: "", name: "hello", inputs: [], outputs: [] }),
  ),
]);
const wasmHash = hash(wasmBuffer);
const wasmInstanceEntry = instanceEntry(
  xdr.ContractExecutable.contractExecutableWasm(wasmHash),
);
const wasmLedgerKey = xdr.LedgerKey.contractCode(
  new xdr.LedgerKeyContractCode({ hash: wasmHash }),
);
const wasmLedgerCode = xdr.LedgerEntryData.contractCode(
  new xdr.ContractCodeEntry({
    ext: xdr.ContractCodeEntryExt.fromXDR(
      "AAAAAQAAAAAAAAAAAAAVqAAAAJwAAAADAAAAAwAAABgAAAABAAAAAQAAABEAAAAgAAABpA==",
      "base64",
    ),
    hash: wasmHash,
    code: wasmBuffer,
  }),
);

// --- Loopback JSON-RPC harness ---------------------------------------------

interface LedgerEntriesRequest {
  params?: { keys?: string[] };
}

function entriesResult(entryVal: xdr.LedgerEntryData, key: string): unknown {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      latestLedger: 18039,
      entries: [
        {
          liveUntilLedgerSeq: 1000,
          lastModifiedLedgerSeq: 1,
          xdr: entryVal.toXDR("base64"),
          key,
        },
      ],
    },
  };
}

const emptyResult = { jsonrpc: "2.0", id: 1, result: { latestLedger: 18039, entries: [] } };

// Serves `getLedgerEntries`: the instance footprint returns `instance` (or an
// empty entry set when null), the code key returns the synthetic wasm.
async function withLedgerServer(
  instance: xdr.LedgerEntryData | null,
  run: (rpcUrl: string) => Promise<void>,
): Promise<void> {
  const server = await startServer((req) => {
    const parsed = req.json() as LedgerEntriesRequest;
    const key = parsed.params?.keys?.[0];
    if (instance !== null && key === contractLedgerKey.toXDR("base64")) {
      return { json: entriesResult(instance, key) };
    }
    if (key === wasmLedgerKey.toXDR("base64")) {
      return { json: entriesResult(wasmLedgerCode, key) };
    }
    return { json: emptyResult };
  });
  try {
    await run(server.url);
  } finally {
    await server.close();
  }
}

interface RpcRejection {
  code: number;
  message: string;
}

function isRpcRejection(err: unknown): err is RpcRejection {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "number"
  );
}

// Runs `op`, expecting it to reject; returns the rejection value.
async function captureRejection(op: Promise<unknown>): Promise<unknown> {
  try {
    await op;
  } catch (err) {
    return err;
  }
  throw new Error("expected the operation to reject, but it resolved");
}

// --- Tests ------------------------------------------------------------------

describe("rpc.Server.getContractInstance", () => {
  it("returns a StellarAsset executable for a SAC", async () => {
    await withLedgerServer(sacInstanceEntry, async (rpcUrl) => {
      const server = new Server(rpcUrl, { allowHttp: true });
      const instance = await server.getContractInstance(contractId);
      expect(instance.executable().switch().name).toBe(
        "contractExecutableStellarAsset",
      );
    });
  });

  it("returns a Wasm executable carrying the wasm hash", async () => {
    await withLedgerServer(wasmInstanceEntry, async (rpcUrl) => {
      const server = new Server(rpcUrl, { allowHttp: true });
      const instance = await server.getContractInstance(contractId);
      expect(instance.executable().switch().name).toBe("contractExecutableWasm");
      expect(instance.executable().wasmHash().equals(wasmHash)).toBe(true);
    });
  });

  it("rejects with 404 when the instance is not found", async () => {
    await withLedgerServer(null, async (rpcUrl) => {
      const server = new Server(rpcUrl, { allowHttp: true });
      const err = await captureRejection(server.getContractInstance(contractId));
      expect(isRpcRejection(err)).toBe(true);
      if (isRpcRejection(err)) expect(err.code).toBe(404);
    });
  });
});

describe("rpc.Server.getContractWasmByContractId", () => {
  it("returns the wasm bytecode for a wasm contract", async () => {
    await withLedgerServer(wasmInstanceEntry, async (rpcUrl) => {
      const server = new Server(rpcUrl, { allowHttp: true });
      const wasm = await server.getContractWasmByContractId(contractId);
      expect(wasm.equals(wasmBuffer)).toBe(true);
    });
  });

  it("rejects a SAC with a structured 400 error", async () => {
    await withLedgerServer(sacInstanceEntry, async (rpcUrl) => {
      const server = new Server(rpcUrl, { allowHttp: true });
      const err = await captureRejection(
        server.getContractWasmByContractId(contractId),
      );
      expect(isRpcRejection(err)).toBe(true);
      if (isRpcRejection(err)) {
        expect(err.code).toBe(400);
        expect(err.message.includes("Stellar Asset Contract")).toBe(true);
      }
    });
  });

  it("rejects with 404 when the instance is not found", async () => {
    await withLedgerServer(null, async (rpcUrl) => {
      const server = new Server(rpcUrl, { allowHttp: true });
      const err = await captureRejection(
        server.getContractWasmByContractId(contractId),
      );
      expect(isRpcRejection(err)).toBe(true);
      if (isRpcRejection(err)) expect(err.code).toBe(404);
    });
  });
});

describe("contract.Client.from (dynamic SAC-spec import)", () => {
  it("builds a Client from the embedded SAC spec for a SAC", async () => {
    await withLedgerServer(sacInstanceEntry, async (rpcUrl) => {
      const client = await Client.from({
        contractId,
        networkPassphrase,
        rpcUrl,
        allowHttp: true,
      });
      expect(client).toBeInstanceOf(Client);
      // The embedded SAC spec (lazily `import()`ed) defines the standard token
      // interface; its presence proves the dynamic import resolved and loaded.
      const funcs = client.spec.funcs().map((f) => String(f.name()));
      for (const method of ["transfer", "balance", "name", "symbol", "decimals"]) {
        expect(funcs.includes(method)).toBe(true);
      }
    });
  });

  it("builds a Client from downloaded wasm for a wasm contract", async () => {
    await withLedgerServer(wasmInstanceEntry, async (rpcUrl) => {
      const client = await Client.from({
        contractId,
        networkPassphrase,
        rpcUrl,
        allowHttp: true,
      });
      expect(client).toBeInstanceOf(Client);
      const funcs = client.spec.funcs().map((f) => String(f.name()));
      expect(funcs.includes("hello")).toBe(true);
    });
  });

  it("rejects with TypeError when rpcUrl is missing", async () => {
    await expect(
      Client.from({ contractId, networkPassphrase, rpcUrl: "" }),
    ).rejects.toThrow(TypeError);
  });
});
