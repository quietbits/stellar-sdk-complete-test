// Config (process-global HTTP defaults), Utils, scvSortedMap, and the standalone constants.
//
// Config is mutable global state shared by every Horizon/RPC client in the process, so each test here restores it with setDefault(). Without that, a stray setAllowHttp(true) would leak into unrelated suites and could make a test pass only because of ordering.
//
// UPSTREAM OVERLAP: mostly none, and that is where issue 6 came from. js-stellar-sdk never tests Utils.validateTimebounds or Utils.sleep, and touches Config only as incidental setup in other suites (setAllowHttp / setDefault are called but never asserted). scvSortedMap is the one exception, covered by test/unit/base/scval.test.ts. Worth extending rather than trimming.
import { Config, MemoReturn, TimeoutInfinite, Utils, nativeToScVal, scValToNative, scvSortedMap, xdr } from "@stellar/stellar-sdk";
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it } from "./helpers/assert.ts";

function buildTransaction(timebounds: { minTime: number; maxTime: number }) {
  return new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
    timebounds,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .build();
}

describe("stellar-sdk Config", () => {
  // Restore the process-wide defaults after every case so nothing leaks between tests or suites.
  afterEach(() => {
    Config.setDefault();
  });

  it("defaults to disallowing plain HTTP and no timeout", () => {
    Config.setDefault();
    expect(Config.isAllowHttp()).toBe(false);
    expect(Config.getTimeout()).toBe(0);
  });

  it("round-trips allowHttp", () => {
    Config.setAllowHttp(true);
    expect(Config.isAllowHttp()).toBe(true);
    Config.setAllowHttp(false);
    expect(Config.isAllowHttp()).toBe(false);
  });

  it("round-trips timeout", () => {
    Config.setTimeout(5000);
    expect(Config.getTimeout()).toBe(5000);
  });

  it("setDefault resets both values together", () => {
    Config.setAllowHttp(true);
    Config.setTimeout(5000);

    Config.setDefault();

    expect(Config.isAllowHttp()).toBe(false);
    expect(Config.getTimeout()).toBe(0);
  });
});

describe("stellar-sdk Utils", () => {
  describe("validateTimebounds", () => {
    it("accepts a transaction inside its window", () => {
      const now = Math.floor(Date.now() / 1000);
      expect(Utils.validateTimebounds(buildTransaction({ minTime: now - 60, maxTime: now + 600 }))).toBe(true);
    });

    it("rejects a transaction whose window has passed", () => {
      expect(Utils.validateTimebounds(buildTransaction({ minTime: 0, maxTime: 100 }))).toBe(false);
    });

    it("rejects a transaction whose window has not opened", () => {
      const now = Math.floor(Date.now() / 1000);
      expect(Utils.validateTimebounds(buildTransaction({ minTime: now + 600, maxTime: now + 1200 }))).toBe(false);
    });

    it("widens the window by the grace period at both ends", () => {
      const now = Math.floor(Date.now() / 1000);
      const expired = buildTransaction({ minTime: 0, maxTime: now - 100 });
      expect(Utils.validateTimebounds(expired)).toBe(false);
      expect(Utils.validateTimebounds(expired, 300)).toBe(true);

      const notYetValid = buildTransaction({ minTime: now + 100, maxTime: now + 1200 });
      expect(Utils.validateTimebounds(notYetValid)).toBe(false);
      expect(Utils.validateTimebounds(notYetValid, 300)).toBe(true);
    });

    // maxTime is compared literally (now <= maxTime + gracePeriod), so a stored maxTime of 0 reads as "expired in 1970" rather than as TimeoutInfinite.
    it("treats a stored maxTime of 0 as expired rather than infinite", () => {
      expect(Utils.validateTimebounds(buildTransaction({ minTime: 0, maxTime: 0 }))).toBe(false);
    });

    // Consequence of the above, and the reason it matters: setTimeout(TimeoutInfinite) is the documented way to build a transaction with no expiry, yet the resulting transaction is reported invalid by the SDK's own validator. Pinned as observed behaviour, not endorsed -- see ISSUES.md issue 6.
    it("reports a TimeoutInfinite transaction as outside its timebounds", () => {
      const infinite = new TransactionBuilder(new Account(Keypair.random().publicKey(), "1"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: Keypair.random().publicKey(),
            asset: Asset.native(),
            amount: "1",
          }),
        )
        .setTimeout(TimeoutInfinite)
        .build();

      expect(infinite.timeBounds).toEqual({ minTime: "0", maxTime: "0" });
      expect(Utils.validateTimebounds(infinite)).toBe(false);
    });
  });

  describe("sleep", () => {
    it("resolves after at least the requested delay", async () => {
      const started = Date.now();
      await Utils.sleep(20);
      // Timers may fire late but never early; only the lower bound is safe to assert.
      expect(Date.now() - started >= 15).toBe(true);
    });

    it("returns a promise", () => {
      const pending = Utils.sleep(0);
      expect(pending instanceof Promise).toBe(true);
      return pending;
    });
  });
});

describe("stellar-sdk scvSortedMap", () => {
  const entry = (key: string, value: number) =>
    new xdr.ScMapEntry({
      key: nativeToScVal(key, { type: "symbol" }),
      val: nativeToScVal(value, { type: "u32" }),
    });

  it("sorts entries by key regardless of input order", () => {
    const sorted = scvSortedMap([entry("zebra", 1), entry("apple", 2), entry("mango", 3)]);
    expect(Object.keys(scValToNative(sorted))).toEqual(["apple", "mango", "zebra"]);
  });

  it("preserves each key's own value while reordering", () => {
    const sorted = scValToNative(scvSortedMap([entry("zebra", 1), entry("apple", 2)]));
    expect(sorted.apple).toBe(2);
    expect(sorted.zebra).toBe(1);
  });

  it("produces an scvMap that round-trips through XDR", () => {
    const sorted = scvSortedMap([entry("b", 1), entry("a", 2)]);
    expect(sorted.switch().name).toBe("scvMap");

    const restored = xdr.ScVal.fromXDR(sorted.toXDR("base64"), "base64");
    expect(Object.keys(scValToNative(restored))).toEqual(["a", "b"]);
  });

  it("accepts an empty entry list", () => {
    expect(scValToNative(scvSortedMap([]))).toEqual({});
  });
});

describe("stellar-sdk standalone constants", () => {
  // TimeoutInfinite is the sentinel accepted by TransactionBuilder.setTimeout to mean "no timebound".
  it("TimeoutInfinite is zero", () => {
    expect(TimeoutInfinite).toBe(0);
  });

  it("MemoReturn is the return memo type tag", () => {
    expect(MemoReturn).toBe("return");
  });
});
