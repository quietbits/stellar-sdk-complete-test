import { describe, expect, it } from "vitest";
import * as ContractModule from "@stellar/stellar-sdk/contract";
import * as RpcModule from "@stellar/stellar-sdk/rpc";
import * as StellarSdk from "@stellar/stellar-sdk";

const expectedRootExports = [
  "Account",
  "AccountRequiresMemoError",
  "Address",
  "Asset",
  "AuthClawbackEnabledFlag",
  "AuthImmutableFlag",
  "AuthRequiredFlag",
  "AuthRevocableFlag",
  "BASE_FEE",
  "BadRequestError",
  "BadResponseError",
  "BindingGenerator",
  "Claimant",
  "Config",
  "Contract",
  "Federation",
  "FeeBumpTransaction",
  "Friendbot",
  "Horizon",
  "Hyper",
  "Int128",
  "Int256",
  "Keypair",
  "LiquidityPoolAsset",
  "LiquidityPoolFeeV18",
  "LiquidityPoolId",
  "Memo",
  "MemoHash",
  "MemoID",
  "MemoNone",
  "MemoReturn",
  "MemoText",
  "MuxedAccount",
  "NetworkError",
  "Networks",
  "NotFoundError",
  "Operation",
  "ScInt",
  "SignerKey",
  "Soroban",
  "SorobanDataBuilder",
  "StellarToml",
  "StrKey",
  "TimeoutInfinite",
  "Transaction",
  "TransactionBase",
  "TransactionBuilder",
  "Uint128",
  "Uint256",
  "UnsignedHyper",
  "Utils",
  "WebAuth",
  "XdrLargeInt",
  "authorizeEntry",
  "authorizeInvocation",
  "buildInvocationTree",
  "cereal",
  "contract",
  "decodeAddressToMuxedAccount",
  "default",
  "encodeMuxedAccount",
  "encodeMuxedAccountToAddress",
  "extractBaseAddress",
  "getLiquidityPoolId",
  "hash",
  "humanizeEvents",
  "nativeToScVal",
  "rpc",
  "scValToBigInt",
  "scValToNative",
  "sign",
  "verify",
  "walkInvocationTree",
  "xdr",
].sort();

const expectedContractExports = [
  "AssembledTransaction",
  "Client",
  "DEFAULT_TIMEOUT",
  "Err",
  "NULL_ACCOUNT",
  "Ok",
  "SentTransaction",
  "Spec",
  "Watcher",
  "basicNodeSigner",
].sort();

const expectedRpcExports = [
  "Api",
  "BasicSleepStrategy",
  "Durability",
  "LinearSleepStrategy",
  "Server",
  "assembleTransaction",
  "default",
  "parseRawEvents",
  "parseRawSimulation",
].sort();

const expectedHorizonNamespaceExports = [
  "AccountResponse",
  "HorizonApi",
  "SERVER_TIME_MAP",
  "Server",
  "ServerApi",
  "default",
  "getCurrentServerTime",
].sort();

const expectedWebAuthNamespaceExports = [
  "InvalidChallengeError",
  "buildChallengeTx",
  "gatherTxSigners",
  "readChallengeTx",
  "verifyChallengeTxSigners",
  "verifyChallengeTxThreshold",
  "verifyTxSignedBy",
].sort();

const expectedFederationNamespaceExports = [
  "Api",
  "FEDERATION_RESPONSE_MAX_SIZE",
  "Server",
].sort();

const expectedFriendbotNamespaceExports = ["Api"].sort();

const expectedStellarTomlNamespaceExports = [
  "Api",
  "Resolver",
  "STELLAR_TOML_MAX_SIZE",
].sort();

function normalizedKeys(moduleObject: object): string[] {
  return Object.keys(moduleObject)
    .filter((name) => name !== "__esModule")
    .sort();
}

function assertNoUndefinedExports(moduleObject: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(moduleObject)) {
    if (name === "__esModule") {
      continue;
    }

    expect(value, `Export ${name} should be defined`).not.toBeUndefined();
  }
}

describe("stellar-sdk public API surface", () => {
  it("matches expected root exports", () => {
    expect(normalizedKeys(StellarSdk)).toEqual(expectedRootExports);
    assertNoUndefinedExports(StellarSdk as Record<string, unknown>);
  });

  it("matches expected contract exports", () => {
    expect(normalizedKeys(ContractModule)).toEqual(expectedContractExports);
    assertNoUndefinedExports(ContractModule as Record<string, unknown>);
  });

  it("matches expected rpc exports", () => {
    expect(normalizedKeys(RpcModule)).toEqual(expectedRpcExports);
    assertNoUndefinedExports(RpcModule as Record<string, unknown>);
  });

  it("matches expected Horizon namespace exports", () => {
    expect(normalizedKeys(StellarSdk.Horizon)).toEqual(
      expectedHorizonNamespaceExports,
    );
  });

  it("matches expected nested rpc and contract namespace exports", () => {
    expect(normalizedKeys(StellarSdk.rpc)).toEqual(expectedRpcExports);
    expect(normalizedKeys(StellarSdk.contract)).toEqual(
      expectedContractExports,
    );
  });

  it("matches expected WebAuth namespace exports", () => {
    expect(normalizedKeys(StellarSdk.WebAuth)).toEqual(
      expectedWebAuthNamespaceExports,
    );
  });

  it("matches expected Federation namespace exports", () => {
    expect(normalizedKeys(StellarSdk.Federation)).toEqual(
      expectedFederationNamespaceExports,
    );
  });

  it("matches expected Friendbot namespace exports", () => {
    expect(normalizedKeys(StellarSdk.Friendbot)).toEqual(
      expectedFriendbotNamespaceExports,
    );
  });

  it("matches expected StellarToml namespace exports", () => {
    expect(normalizedKeys(StellarSdk.StellarToml)).toEqual(
      expectedStellarTomlNamespaceExports,
    );
  });

  it("keeps stable constants unchanged", () => {
    expect(StellarSdk.BASE_FEE).toBe("100");
    expect(StellarSdk.TimeoutInfinite).toBe(0);
  });

  it("keeps stable runtime categories unchanged", () => {
    expect(typeof StellarSdk.Horizon).toBe("object");
    expect(typeof StellarSdk.Federation).toBe("object");
    expect(typeof StellarSdk.Soroban).toBe("function");
    expect(typeof StellarSdk.Utils).toBe("function");
  });

  it("keeps core callable exports callable", () => {
    const callableNames = [
      "authorizeEntry",
      "authorizeInvocation",
      "buildInvocationTree",
      "decodeAddressToMuxedAccount",
      "encodeMuxedAccount",
      "encodeMuxedAccountToAddress",
      "extractBaseAddress",
      "getLiquidityPoolId",
      "hash",
      "humanizeEvents",
      "nativeToScVal",
      "scValToBigInt",
      "scValToNative",
      "sign",
      "verify",
      "walkInvocationTree",
    ];

    for (const name of callableNames) {
      const value = (StellarSdk as Record<string, unknown>)[name];
      expect(typeof value, `${name} should stay callable`).toBe("function");
    }
  });
});
