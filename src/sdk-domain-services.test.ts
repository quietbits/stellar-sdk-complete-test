import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  Federation,
  Keypair,
  Networks,
  StellarToml,
  WebAuth,
} from "@stellar/stellar-sdk";

describe("stellar-sdk domain service behavior", () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

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

  it("resolves stellar addresses via federation server discovered from stellar.toml", async () => {
    const domain = "acme.test";
    const accountId = Keypair.random().publicKey();

    const tomlScope = nock(`http://${domain}`)
      .get("/.well-known/stellar.toml")
      .reply(
        200,
        `FEDERATION_SERVER=\"http://federation.${domain}/federation\"`,
      );

    const federationScope = nock(`http://federation.${domain}`)
      .get("/federation")
      .query({ type: "name", q: `bob*${domain}` })
      .reply(200, {
        stellar_address: `bob*${domain}`,
        account_id: accountId,
        memo_type: "id",
        memo: "123",
      });

    const result = await Federation.Server.resolve(`bob*${domain}`, {
      allowHttp: true,
    });

    expect(result.account_id).toBe(accountId);
    tomlScope.done();
    federationScope.done();
  });

  it("throws for insecure federation server when allowHttp is not set", () => {
    expect(
      () =>
        new Federation.Server("http://federation.local/federation", "local"),
    ).toThrow("Cannot connect to insecure federation server");
  });

  it("parses valid stellar.toml payloads", async () => {
    const domain = "toml.test";
    const signingKey = Keypair.random().publicKey();

    const scope = nock(`http://${domain}`)
      .get("/.well-known/stellar.toml")
      .reply(
        200,
        `FEDERATION_SERVER=\"http://federation.${domain}/federation\"\nSIGNING_KEY=\"${signingKey}\"`,
      );

    const result = await StellarToml.Resolver.resolve(domain, {
      allowHttp: true,
    });

    expect(result.FEDERATION_SERVER).toBe(
      `http://federation.${domain}/federation`,
    );
    expect(result.SIGNING_KEY).toBe(signingKey);
    scope.done();
  });

  it("throws for invalid stellar.toml payloads", async () => {
    const domain = "bad-toml.test";

    const scope = nock(`http://${domain}`)
      .get("/.well-known/stellar.toml")
      .reply(200, "NOT = valid = toml");

    await expect(
      StellarToml.Resolver.resolve(domain, { allowHttp: true }),
    ).rejects.toThrow("stellar.toml is invalid");

    scope.done();
  });
});
