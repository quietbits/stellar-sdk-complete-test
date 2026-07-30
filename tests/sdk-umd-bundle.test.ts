// Guards the rollup change that pairs with the SAC dynamic import: the UMD
// `dist/` bundles set `inlineDynamicImports: true`, because a single-file UMD
// build can hold only one chunk. If the `import("../bindings/sac-spec.js")` in
// contract/client were left as a runtime dynamic import, the single-file UMD
// bundle would try to load a chunk that does not exist and `Client.from()`
// would break for any SAC.
//
// This is inherently a bundle-artifact + module-system check, so it is
// Node-only: it reads `dist/*.js` off disk and loads the UMD build. Deno and
// Bun skip it (they consume the ESM `lib/` build, covered by
// sdk-dynamic-imports.test.ts).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { Contract, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";
import { startServer } from "./helpers/server.ts";

// A SAC instance fixture, built with the installed SDK's own xdr constructors
// (the UMD bundle decodes the same XDR the ESM build produces).
const contractId = "CCN57TGC6EXFCYIQJ4UCD2UDZ4C3AQCHVMK74DGZ3JYCA5HD4BY7FNPC";
const contractObj = new Contract(contractId);
const contractLedgerKeyXdr = contractObj.getFootprint().toXDR("base64");
const sacInstanceXdr = xdr.LedgerEntryData.contractData(
  new xdr.ContractDataEntry({
    ext: new xdr.ExtensionPoint(0),
    contract: contractObj.address().toScAddress(),
    durability: xdr.ContractDataDurability.persistent(),
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    val: xdr.ScVal.scvContractInstance(
      new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
        storage: null,
      }),
    ),
  }),
).toXDR("base64");

function isNode(): boolean {
  const g = globalThis as {
    Deno?: unknown;
    Bun?: unknown;
    process?: { versions?: { node?: string }; pid?: number };
  };
  return (
    g.Deno === undefined &&
    g.Bun === undefined &&
    g.process?.versions?.node !== undefined
  );
}

describe("stellar-sdk UMD bundle (dist) inlines the SAC dynamic import", () => {
  if (!isNode()) {
    it("skipped (Node-only: reads dist/ and loads the UMD build)", () => {});
    return;
  }

  const require = createRequire(import.meta.url);
  const here = dirname(fileURLToPath(import.meta.url));
  const distDir = join(
    here,
    "..",
    "node_modules",
    "@stellar",
    "stellar-sdk",
    "dist",
  );
  const umdPath = join(distDir, "stellar-sdk.js");
  const umdMinPath = join(distDir, "stellar-sdk.min.js");

  it("emits no runtime dynamic import() in either UMD bundle", () => {
    for (const p of [umdPath, umdMinPath]) {
      const src = readFileSync(p, "utf8");
      expect(src.includes("import(")).toBe(false);
      // The spec must instead be inlined into the single file.
      expect(src.includes("SAC_SPEC")).toBe(true);
    }
  });

  it("builds a SAC Client end-to-end from the loaded UMD bundle", async () => {
    // The published package is `type: module`, so Node reads a bare `.js` in
    // dist as ESM — under which the UMD wrapper attaches nothing to
    // module.exports. Copy the single file to a `.cjs` so Node evaluates it as
    // CommonJS (the UMD's Node branch), giving us the real bundled SDK object.
    const cjsCopy = join(tmpdir(), `stellar-sdk-umd-${process.pid}.cjs`);
    writeFileSync(cjsCopy, readFileSync(umdPath));

    const server = await startServer((_req) => ({
      json: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          latestLedger: 18039,
          entries: [
            {
              liveUntilLedgerSeq: 1000,
              lastModifiedLedgerSeq: 1,
              xdr: sacInstanceXdr,
              key: contractLedgerKeyXdr,
            },
          ],
        },
      },
    }));

    try {
      const StellarSdk = require(cjsCopy) as typeof import("@stellar/stellar-sdk");
      const { contract } = StellarSdk;
      const client = await contract.Client.from({
        contractId,
        networkPassphrase: "Test SDF Network ; September 2015",
        rpcUrl: server.url,
        allowHttp: true,
      });
      expect(client).toBeInstanceOf(contract.Client);
      const funcs = client.spec.funcs().map((f) => String(f.name()));
      expect(funcs.includes("transfer")).toBe(true);
    } finally {
      await server.close();
      rmSync(cjsCopy, { force: true });
    }
  });
});
