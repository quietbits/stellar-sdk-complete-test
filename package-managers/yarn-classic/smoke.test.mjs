// Package-manager smoke test.
//
// Identical across every sandbox: it only checks that this package manager's
// dependency layout (hoisted node_modules, symlinked store, or Yarn PnP) lets
// the SDK resolve and that its core crypto works. Plain ESM + node:test so it
// runs under Node with no TypeScript or extra tooling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, StrKey, hash } from "@stellar/stellar-sdk";

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

test("SDK subpath exports resolve under this package manager", async () => {
  const rpc = await import("@stellar/stellar-sdk/rpc");
  assert.equal(typeof rpc.Server, "function", "rpc.Server must be callable");
});
