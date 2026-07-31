// Packaging and module-resolution coverage for every entry point the published
// package declares.
//
// This is the axis `js-stellar-sdk` has no equivalent for — it tests `src/`, not
// the artifact — and the one that produced the highest-severity finding so far
// (ISSUES.md issue 1: the SDK failed to load at all under Yarn Berry PnP).
//
// It exists because the symbol audit was structurally blind here. Its
// `ENTRY_POINTS` list covers the root, `/contract`, and `/rpc`; the package
// declares eight subpaths. Nothing verified that the other five resolved at all,
// under any runtime. A subpath can break independently of the root entry — a
// missing `default` condition, a bad relative path in the exports map, a bundler
// that only maps `.` — and none of it would have surfaced.
//
// Two contracts are locked here:
//
//   1. The *set* of declared subpaths. If a release adds one, the assertion
//      below fails, which is the signal to widen the audit's ENTRY_POINTS rather
//      than let a new subpath go unmeasured.
//   2. The mirror relationships between them. `/axios*` re-exports the same
//      surface as its non-axios twin and `/base` is a subset of the root; those
//      hold by construction in the rollup config, so a divergence means a build
//      regression rather than an intentional API change.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CancelToken,
  create,
  httpClient,
} from "@stellar/stellar-sdk/http-client/axios";
import { describe, expect, it } from "./helpers/assert.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(
  here,
  "..",
  "node_modules",
  "@stellar",
  "stellar-sdk",
  "package.json",
);

interface ExportsMap {
  [subpath: string]: Record<string, string>;
}

// Read off disk rather than imported: `./package.json` is deliberately absent
// from the exports map, so `import`ing it fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
// That is correct packaging on the SDK's part, and it is why this test reaches
// for the file directly instead.
const exportsMap = JSON.parse(readFileSync(packageJsonPath, "utf8")).exports as
  ExportsMap;

/** Every subpath the package declares, as an importable specifier. */
const DECLARED_SUBPATHS = [
  ".",
  "./base",
  "./contract",
  "./rpc",
  "./axios",
  "./axios/contract",
  "./axios/rpc",
  "./http-client/axios",
] as const;

function specifierFor(subpath: string): string {
  return subpath === "."
    ? "@stellar/stellar-sdk"
    : `@stellar/stellar-sdk/${subpath.slice(2)}`;
}

async function namespaceOf(subpath: string): Promise<Record<string, unknown>> {
  return await import(specifierFor(subpath)) as Record<string, unknown>;
}

/** Sorted export names, ignoring the interop keys a runtime may inject. */
function exportNames(namespace: Record<string, unknown>): string[] {
  return Object.keys(namespace)
    .filter((key) => key !== "default" && key !== "__esModule")
    .sort();
}

describe("stellar-sdk package exports map", () => {
  it("declares exactly the subpaths this suite knows about", () => {
    expect(Object.keys(exportsMap).sort()).toEqual([...DECLARED_SUBPATHS].sort());
  });

  // Every entry needs all four conditions: `types` for TypeScript, `import` for
  // ESM, `require` for the CJS half of the dual build, and `default` as the
  // fallback bundlers and older resolvers land on.
  describe("declares a complete condition set for each subpath", () => {
    for (const subpath of DECLARED_SUBPATHS) {
      it(`${subpath}`, () => {
        const conditions = exportsMap[subpath];

        expect(Object.keys(conditions).sort()).toEqual([
          "default",
          "import",
          "require",
          "types",
        ]);
        for (const target of Object.values(conditions)) {
          expect(target.startsWith("./")).toBe(true);
        }
      });
    }
  });

  it("does not expose its own package.json", () => {
    expect(Object.keys(exportsMap)).not.toContain("./package.json");
  });
});

describe("stellar-sdk subpath resolution", () => {
  for (const subpath of DECLARED_SUBPATHS) {
    it(`resolves ${specifierFor(subpath)} and exposes a non-empty namespace`, async () => {
      const namespace = await namespaceOf(subpath);

      expect(exportNames(namespace).length).toBeTruthy();
    });
  }
});

describe("stellar-sdk subpath mirror invariants", () => {
  // The `/axios` family is the same build wired to the axios HTTP client, so it
  // must expose an identical surface to its twin. A drift here means the rollup
  // config stopped emitting one of them from the same source.
  const mirrors: [string, string][] = [
    [".", "./axios"],
    ["./contract", "./axios/contract"],
    ["./rpc", "./axios/rpc"],
  ];

  for (const [canonical, axiosTwin] of mirrors) {
    it(`${axiosTwin} exposes the same surface as ${canonical}`, async () => {
      const [a, b] = await Promise.all([
        namespaceOf(canonical),
        namespaceOf(axiosTwin),
      ]);

      expect(exportNames(b)).toEqual(exportNames(a));
    });
  }

  // `/base` is the protocol layer without the network clients, so it is a strict
  // subset of the root — every name it exports must also be reachable from the
  // package root, or an application importing the root would be missing API.
  it("./base is a subset of the root export", async () => {
    const [base, root] = await Promise.all([
      namespaceOf("./base"),
      namespaceOf("."),
    ]);
    const rootNames = new Set(exportNames(root));

    const missing = exportNames(base).filter((name) => !rootNames.has(name));
    expect(missing).toEqual([]);
  });

  it("./base omits the network-client namespaces the root adds", async () => {
    const baseNames = new Set(exportNames(await namespaceOf("./base")));

    for (const clientOnly of ["rpc", "contract", "Horizon", "Friendbot"]) {
      expect(baseNames.has(clientOnly)).toBe(false);
    }
  });
});

describe("stellar-sdk /http-client/axios", () => {
  it("exports the client, its factory, and a cancellation token", () => {
    expect(typeof httpClient).toBe("function");
    expect(typeof create).toBe("function");
    expect(typeof CancelToken).toBe("function");
  });

  it("creates an independent client carrying the requested config", () => {
    const client = create({ baseURL: "http://127.0.0.1:1", timeout: 5 });

    expect(typeof client.get).toBe("function");
    expect(typeof client.post).toBe("function");
    expect(client).not.toBe(httpClient);
  });

  // The SDK ships its own promise-based CancelToken rather than re-exporting
  // axios's, so its semantics are the SDK's to keep: the executor receives a
  // cancel function, and calling it both records the reason and settles the
  // promise the request adapter is waiting on.
  describe("CancelToken", () => {
    it("does not throw before cancellation is requested", () => {
      const token = new CancelToken(() => {});

      expect(token.reason).toBeUndefined();
      expect(() => token.throwIfRequested()).not.toThrow();
    });

    it("records the reason and throws it once cancelled", () => {
      let cancel: (reason?: string) => void = () => {};
      const token = new CancelToken((fn) => {
        cancel = fn;
      });

      cancel("user aborted");

      expect(token.reason).toBe("user aborted");
      expect(() => token.throwIfRequested()).toThrow("user aborted");
    });

    it("settles its promise when cancelled", async () => {
      let cancel: (reason?: string) => void = () => {};
      const token = new CancelToken((fn) => {
        cancel = fn;
      });

      let settled = false;
      const waiter = token.promise.then(() => {
        settled = true;
      });

      cancel("done");
      await waiter;

      expect(settled).toBe(true);
    });
  });
});

// The dual build's CJS half. Until now the only `require()` in the suite loaded
// the UMD `dist/` bundle off disk (sdk-umd-bundle.test.ts); the `require`
// condition in the exports map, which is what a CommonJS application actually
// hits, was never exercised. v16 moved the primary entry to ESM — the root cause
// of issue 1 — so leaving that half untested is exactly the wrong bet.
describe("stellar-sdk CommonJS entry (exports-map require condition)", () => {
  const require = createRequire(import.meta.url);

  it("loads the package root through require()", () => {
    const cjs = require("@stellar/stellar-sdk") as Record<string, unknown>;

    expect(typeof cjs.Keypair).toBe("function");
    expect(typeof cjs.TransactionBuilder).toBe("function");
  });

  // Set containment rather than equality, deliberately. Deno's CJS/ESM interop
  // injects `default` and a key literally named `module.exports` into the ESM
  // namespace once the same specifier has been require()d in the process. That
  // is Deno's behaviour, not the SDK's — it reproduces with a twelve-line dual
  // package that has nothing to do with Stellar — so `exportNames` filters
  // `default` and the comparison checks that nothing is *missing*.
  it("exposes every ESM export through the CJS build", async () => {
    const cjs = require("@stellar/stellar-sdk") as Record<string, unknown>;
    const esm = await namespaceOf(".");

    const cjsNames = new Set(exportNames(cjs));
    const missing = exportNames(esm).filter((name) => !cjsNames.has(name));

    expect(missing).toEqual([]);
  });

  describe("resolves the subpaths that declare a require condition", () => {
    for (const subpath of DECLARED_SUBPATHS) {
      it(`${specifierFor(subpath)}`, () => {
        const loaded = require(specifierFor(subpath)) as Record<string, unknown>;

        expect(exportNames(loaded).length).toBeTruthy();
      });
    }
  });

  // Resolution alone is not proof the build works: the CJS bundle has its own
  // copy of the vendored js-xdr and crypto wiring.
  it("performs real crypto through the CJS build", () => {
    const cjs = require("@stellar/stellar-sdk") as typeof import(
      "@stellar/stellar-sdk"
    );
    const keypair = cjs.Keypair.random();
    const message = Buffer.from("commonjs entry point");

    expect(keypair.verify(message, keypair.sign(message))).toBe(true);
    expect(cjs.StrKey.isValidEd25519PublicKey(keypair.publicKey())).toBe(true);
  });

  // DEVIATION — pinned, not endorsed. See ISSUES.md issue 12.
  //
  // The CJS build `require()`s three ESM-only packages (`@noble/hashes`,
  // `@noble/ed25519`, `uint8array-extras` — all `"type": "module"` with no
  // `require` condition). It loads here only because Node's `require(esm)`
  // support has been on by default since 22.12. Take that away and the package
  // root cannot be require()d at all:
  //
  //   node --no-experimental-require-module -e 'require("@stellar/stellar-sdk")'
  //   -> Error [ERR_REQUIRE_ESM]
  //
  // The same failure hits Yarn Berry PnP unconditionally, because its loader
  // patches `Module._extensions['.js']` and bypasses require(esm) — see the
  // yarn-berry sandbox in `package-managers/`. This assertion pins the root
  // cause deterministically, independent of any package-manager layout, so a
  // fix (shipping a real CJS dependency graph) turns it red here first.
  //
  // Node-only: it needs a child process and a Node-specific flag.
  it("cannot be require()d without Node's require(esm) support", () => {
    const isNode = typeof process !== "undefined" &&
      process.versions?.node !== undefined &&
      process.versions?.bun === undefined &&
      typeof (globalThis as { Deno?: unknown }).Deno === "undefined";

    if (!isNode) return;

    const result = spawnSync(
      process.execPath,
      [
        "--no-experimental-require-module",
        "-e",
        'require("@stellar/stellar-sdk")',
      ],
      { encoding: "utf8", cwd: join(here, "..") },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ERR_REQUIRE_ESM");
    // Names one of the ESM-only dependencies, confirming the cause.
    expect(/@noble|uint8array-extras/.test(result.stderr)).toBe(true);
  });

  // Cross-build interop: a value produced by the CJS build must decode in the
  // ESM build. Both vendor their own js-xdr copy, so this is not tautological.
  it("produces XDR the ESM build decodes", async () => {
    const cjs = require("@stellar/stellar-sdk") as typeof import(
      "@stellar/stellar-sdk"
    );
    const esm = await import("@stellar/stellar-sdk");

    const encoded = cjs.xdr.ScVal.scvString("across the build boundary").toXDR(
      "base64",
    );

    expect(esm.scValToNative(esm.xdr.ScVal.fromXDR(encoded, "base64"))).toBe(
      "across the build boundary",
    );
  });
});
