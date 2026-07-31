// Package-manager smoke test.
//
// Identical across every sandbox: it only checks that this package manager's
// dependency layout (hoisted node_modules, symlinked store, or Yarn PnP) lets
// the SDK resolve and that its core crypto works. Plain ESM + node:test so it
// runs under Node with no TypeScript or extra tooling.
//
// The subpath list is hard-coded rather than read from the SDK's package.json,
// because under Yarn Berry the package lives inside a zip archive and there is
// no plain file to read. `tests/sdk-package-entrypoints.test.ts` locks the list
// against the real exports map; this file only checks that each entry resolves
// through this manager's layout. That is the axis issue 1 lived on: the SDK
// loaded fine under npm and pnpm while failing outright under Yarn Berry PnP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { Keypair, StrKey, hash } from "@stellar/stellar-sdk";

const SUBPATHS = [
  "@stellar/stellar-sdk",
  "@stellar/stellar-sdk/base",
  "@stellar/stellar-sdk/contract",
  "@stellar/stellar-sdk/rpc",
  "@stellar/stellar-sdk/axios",
  "@stellar/stellar-sdk/axios/contract",
  "@stellar/stellar-sdk/axios/rpc",
  "@stellar/stellar-sdk/http-client/axios",
];

const exportNames = (namespace) =>
  Object.keys(namespace).filter((key) => key !== "default" && key !== "__esModule");

test("SDK resolves and core crypto works under this package manager", () => {
  const kp = Keypair.random();
  const message = Buffer.from("package-manager smoke");
  const signature = kp.sign(message);

  assert.ok(kp.verify(message, signature), "signature must verify");
  assert.ok(
    StrKey.isValidEd25519PublicKey(kp.publicKey()),
    "public key must be valid strkey",
  );
  assert.equal(
    Buffer.from(hash("abc")).toString("hex").length,
    64,
    "sha256 hash must be 32 bytes",
  );
});

test("every declared subpath export resolves under this package manager", async () => {
  for (const specifier of SUBPATHS) {
    const namespace = await import(specifier);
    assert.ok(
      exportNames(namespace).length > 0,
      `${specifier} must expose at least one export (ESM)`,
    );
  }
});

test("the CommonJS half of the dual build resolves under this package manager", () => {
  const require = createRequire(import.meta.url);

  for (const specifier of SUBPATHS) {
    assert.ok(
      exportNames(require(specifier)).length > 0,
      `${specifier} must expose at least one export (CJS)`,
    );
  }

  // Resolution alone is not proof the build works; exercise it.
  const cjs = require("@stellar/stellar-sdk");
  const kp = cjs.Keypair.random();
  const message = Buffer.from("commonjs under this package manager");
  assert.ok(
    kp.verify(message, kp.sign(message)),
    "CJS build must perform real crypto",
  );
});

test("SDK subpath exports resolve under this package manager", async () => {
  const rpc = await import("@stellar/stellar-sdk/rpc");
  assert.equal(typeof rpc.Server, "function", "rpc.Server must be callable");

  const contract = await import("@stellar/stellar-sdk/contract");
  assert.equal(
    typeof contract.Client,
    "function",
    "contract.Client must be callable",
  );

  const http = await import("@stellar/stellar-sdk/http-client/axios");
  assert.equal(
    typeof http.httpClient,
    "function",
    "http-client/axios must expose httpClient",
  );
});
