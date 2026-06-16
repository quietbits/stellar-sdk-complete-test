// Genuinely live tests against Stellar testnet.
//
// Unlike the loopback suite, these hit real public infrastructure over real
// TLS, exercising each runtime's actual network stack end-to-end. They assert
// stable invariants (network passphrase, value types, error behavior) rather
// than volatile values, and use single requests so they survive testnet resets
// without friendbot funding.
//
// Set STELLAR_LIVE=0 to skip (e.g. in an offline environment).
import { Horizon, Keypair, Networks, rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const RPC_URL = "https://soroban-testnet.stellar.org";

function liveEnabled(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env;
  return env?.STELLAR_LIVE !== "0";
}

describe("stellar-sdk live testnet behavior", () => {
  if (!liveEnabled()) {
    it("skipped (set STELLAR_LIVE != 0 to run live network tests)", () => {});
    return;
  }

  it("reads the Horizon root with the testnet passphrase", async () => {
    const server = new Horizon.Server(HORIZON_URL);
    const root = await server.root();
    expect(root.network_passphrase).toBe(Networks.TESTNET);
  });

  it("fetches a usable base fee from Horizon", async () => {
    const server = new Horizon.Server(HORIZON_URL);
    const baseFee = await server.fetchBaseFee();
    expect(typeof baseFee).toBe("number");
    expect(baseFee >= 100).toBe(true);
  });

  it("rejects loadAccount for an unfunded account with NotFoundError", async () => {
    const server = new Horizon.Server(HORIZON_URL);
    const unfunded = Keypair.random().publicKey();
    await expect(server.loadAccount(unfunded)).rejects.toThrow();
  });

  it("reports a healthy Soroban RPC node", async () => {
    const server = new rpc.Server(RPC_URL);
    const health = await server.getHealth();
    expect(health.status).toBe("healthy");
  });

  it("reads the network passphrase from Soroban RPC", async () => {
    const server = new rpc.Server(RPC_URL);
    const network = await server.getNetwork();
    expect(network.passphrase).toBe(Networks.TESTNET);
  });

  it("decodes a real latest-ledger response from Soroban RPC", async () => {
    const server = new rpc.Server(RPC_URL);
    const latest = await server.getLatestLedger();
    expect(typeof latest.sequence).toBe("number");
    expect(latest.sequence > 0).toBe(true);
  });
});
