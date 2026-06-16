import {
  Federation,
  Keypair,
  Networks,
  StellarToml,
  WebAuth,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";
import { startServer } from "./helpers/server.ts";

/** Strip the scheme so a value can be used as a `host:port` "domain". */
function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

describe("stellar-sdk domain service behavior", () => {
  it("builds and reads SEP-10 challenge transactions", () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = WebAuth.buildChallengeTx(
      serverKeypair,
      clientKeypair.publicKey(),
      "example.org",
      300,
      Networks.TESTNET,
      "auth.example.org",
    );

    const parsed = WebAuth.readChallengeTx(
      challenge,
      serverKeypair.publicKey(),
      Networks.TESTNET,
      "example.org",
      "auth.example.org",
    );

    expect(parsed.clientAccountID).toBe(clientKeypair.publicKey());
    expect(parsed.matchedHomeDomain).toBe("example.org");
  });

  it("throws when reading SEP-10 challenge with wrong server key", () => {
    const serverKeypair = Keypair.random();
    const wrongServer = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = WebAuth.buildChallengeTx(
      serverKeypair,
      clientKeypair.publicKey(),
      "example.org",
      300,
      Networks.TESTNET,
      "auth.example.org",
    );

    expect(() =>
      WebAuth.readChallengeTx(
        challenge,
        wrongServer.publicKey(),
        Networks.TESTNET,
        "example.org",
        "auth.example.org",
      ),
    ).toThrow();
  });

  it("resolves valid account IDs via federation static resolver", async () => {
    const accountId = Keypair.random().publicKey();

    const result = await Federation.Server.resolve(accountId, {
      allowHttp: true,
    });

    expect(result.account_id).toBe(accountId);
  });

  it("rejects invalid account IDs via federation static resolver", async () => {
    await expect(
      Federation.Server.resolve("invalid-account-id", { allowHttp: true }),
    ).rejects.toThrow("Invalid Account ID");
  });

  it("resolves stellar addresses via a federation server", async () => {
    // NOTE: the SDK validates the domain (RFC 1035) on the toml-discovery path,
    // so a loopback "127.0.0.1:port" domain can't drive `Federation.Server.resolve`.
    // We exercise the federation query/parse directly — the runtime-relevant
    // HTTP behavior — while toml fetch/parse is covered by the tests below.
    const accountId = Keypair.random().publicKey();

    const server = await startServer((req) => {
      if (req.pathname === "/federation") {
        return {
          json: {
            stellar_address: req.query.get("q"),
            account_id: accountId,
            memo_type: "id",
            memo: "123",
          },
        };
      }
      return { status: 404, json: { error: "not found" } };
    });

    try {
      const federation = new Federation.Server(
        `${server.url}/federation`,
        "example.org",
        { allowHttp: true },
      );
      const result = await federation.resolveAddress("bob*example.org");
      expect(result.account_id).toBe(accountId);
    } finally {
      await server.close();
    }
  });

  it("throws for insecure federation server when allowHttp is not set", () => {
    expect(
      () =>
        new Federation.Server("http://federation.local/federation", "local"),
    ).toThrow("Cannot connect to insecure federation server");
  });

  it("parses valid stellar.toml payloads", async () => {
    const signingKey = Keypair.random().publicKey();

    const server = await startServer((_req, baseUrl) => ({
      text: `FEDERATION_SERVER="${baseUrl}/federation"\nSIGNING_KEY="${signingKey}"`,
    }));

    try {
      const result = await StellarToml.Resolver.resolve(hostOf(server.url), {
        allowHttp: true,
      });

      expect(result.FEDERATION_SERVER).toBe(`${server.url}/federation`);
      expect(result.SIGNING_KEY).toBe(signingKey);
    } finally {
      await server.close();
    }
  });

  it("throws for invalid stellar.toml payloads", async () => {
    const server = await startServer(() => ({ text: "NOT = valid = toml" }));

    try {
      await expect(
        StellarToml.Resolver.resolve(hostOf(server.url), { allowHttp: true }),
      ).rejects.toThrow("stellar.toml is invalid");
    } finally {
      await server.close();
    }
  });
});
