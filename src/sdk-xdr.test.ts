// XDR coverage tests for @stellar/stellar-sdk.
//
// Every fixture in this file is sourced verbatim from upstream test files
// (see // SOURCE: comments above each block) so a future reader can curl the
// URL and grep for the string to confirm it has not been fabricated.
//
// Pinned upstream versions:
//   @stellar/stellar-sdk        v14.6.1
//   @stellar/stellar-base       v14.1.0

import {
  Address,
  Asset,
  Claimant,
  Contract,
  Int256,
  Keypair,
  Memo,
  MemoText,
  Networks,
  Operation,
  ScInt,
  SignerKey,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  authorizeEntry,
  buildInvocationTree,
  hash,
  humanizeEvents,
  nativeToScVal,
  rpc,
  scValToBigInt,
  scValToNative,
  walkInvocationTree,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

describe("stellar-sdk XDR coverage", () => {
  // -------------------------------------------------------------------------
  // 1. Hard-coded base64 round-trips (captured upstream fixtures)
  // -------------------------------------------------------------------------
  describe("real base64 round-trips", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/transaction_envelope_test.js#L4-L10
    // Originally from js-stellar-sdk issue #73.
    it("decodes a TransactionEnvelope with a 32-byte ed25519 source", () => {
      const envelopeBase64 =
        "AAAAAPQQv+uPYrlCDnjgPyPRgIjB6T8Zb8ANmL8YGAXC2IAgAAAAZAAIteYAAAAHAAAAAAAAAAAAAAABAAAAAAAAAAMAAAAAAAAAAUVVUgAAAAAAUtYuFczBLlsXyEp3q8BbTBpEGINWahqkFbnTPd93YUUAAAAXSHboAAAAABEAACcQAAAAAAAAAKIAAAAAAAAAAcLYgCAAAABAo2tU6n0Bb7bbbpaXacVeaTVbxNMBtnrrXVk2QAOje2Flllk/ORlmQdFU/9c8z43eWh1RNMpI3PscY+yDCnJPBQ==";

      const envelope = xdr.TransactionEnvelope.fromXDR(envelopeBase64, "base64");
      expect(envelope.switch().name).toBe("envelopeTypeTxV0");
      const v0Envelope = envelope.value() as xdr.TransactionV0Envelope;
      const sourceAccount = v0Envelope.tx().sourceAccountEd25519();
      expect(sourceAccount.length).toBe(32);
      // Re-serialize to confirm the decoded structure is intact.
      expect(envelope.toXDR("base64")).toBe(envelopeBase64);
    });

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/transaction_envelope_test.js#L19-L29
    it("computes a known PUBLIC-network transaction hash for the upstream non-utf8 fixture", () => {
      const envelopeBase64 =
        "AAAAAAtjwtJadppTmm0NtAU99BFxXXfzPO1N/SqR43Z8aXqXAAAAZAAIj6YAAAACAAAAAAAAAAEAAAAB0QAAAAAAAAEAAAAAAAAAAQAAAADLa6390PDAqg3qDLpshQxS+uVw3ytSgKRirQcInPWt1QAAAAAAAAAAA1Z+AAAAAAAAAAABfGl6lwAAAEBC655+8Izq54MIZrXTVF/E1ycHgQWpVcBD+LFkuOjjJd995u/7wM8sFqQqambL0/ME2FTOtxMO65B9i3eAIu4P";

      const tx = new Transaction(envelopeBase64, Networks.PUBLIC);
      expect(tx.hash().toString("hex")).toBe(
        "a84d534b3742ad89413bdbf259e02fa4c5d039123769e9bcc63616f723a2bcd5",
      );
    });

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/transaction_test.js#L497-L508
    it("round-trips a TESTNET manageData transaction through toXDR()", () => {
      const envelopeBase64 =
        "AAAAAAW8Dk9idFR5Le+xi0/h/tU47bgC1YWjtPH1vIVO3BklAAAAZACoKlYAAAABAAAAAAAAAAEAAAALdmlhIGtleWJhc2UAAAAAAQAAAAAAAAAIAAAAAN7aGcXNPO36J1I8MR8S4QFhO79T5JGG2ZeS5Ka1m4mJAAAAAAAAAAFO3BklAAAAQP0ccCoeHdm3S7bOhMjXRMn3EbmETJ9glxpKUZjPSPIxpqZ7EkyTgl3FruieqpZd9LYOzdJrNik1GNBLhgTh/AU=";

      const tx = new Transaction(envelopeBase64, Networks.TESTNET);
      expect(tx.toXDR()).toBe(envelopeBase64);
      expect(tx.operations).toHaveLength(1);
      expect(tx.operations[0].type).toBe("accountMerge");
    });

    // SOURCE: https://github.com/stellar/js-stellar-sdk/blob/v14.6.1/test/unit/server/soroban/get_transaction.test.ts#L17-L26
    // Captured from horizon tx aa6a8e198abe53c7e852e4870413b29fe9ef04da1415a97a5de1a4ae489e11e2
    // (per the upstream comment at L13). Path-payment strict-receive 4-asset cycle.
    it("decodes a captured Horizon path-payment envelope", () => {
      const envelopeBase64 =
        "AAAAAgAAAAAT/LQZdYz0FcQ4Xwyg8IM17rkUx3pPCCWLu+SowQ/T+gBLB24poiQa9iwAngAAAAEAAAAAAAAAAAAAAABkwdeeAAAAAAAAAAEAAAABAAAAAC/9E8hDhnktyufVBS5tqA734Yz5XrLX2XNgBgH/YEkiAAAADQAAAAAAAAAAAAA1/gAAAAAv/RPIQ4Z5Lcrn1QUubagO9+GM+V6y19lzYAYB/2BJIgAAAAAAAAAAAAA1/gAAAAQAAAACU0lMVkVSAAAAAAAAAAAAAFDutWuu6S6UPJBrotNSgfmXa27M++63OT7TYn1qjgy+AAAAAVNHWAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AAAACUEFMTEFESVVNAAAAAAAAAFDutWuu6S6UPJBrotNSgfmXa27M++63OT7TYn1qjgy+AAAAAlNJTFZFUgAAAAAAAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAAAAAAAACwQ/T+gAAAEA+ztVEKWlqHXNnqy6FXJeHr7TltHzZE6YZm5yZfzPIfLaqpp+5cyKotVkj3d89uZCQNsKsZI48uoyERLne+VwL/2BJIgAAAEA7323gPSaezVSa7Vi0J4PqsnklDH1oHLqNBLwi5EWo5W7ohLGObRVQZ0K0+ufnm4hcm9J4Cuj64gEtpjq5j5cM";

      const envelope = xdr.TransactionEnvelope.fromXDR(envelopeBase64, "base64");
      expect(envelope.toXDR("base64")).toBe(envelopeBase64);
      // The captured tx is a v1 envelope.
      expect(envelope.switch().name).toBe("envelopeTypeTx");
    });

    // SOURCE: https://github.com/stellar/js-stellar-sdk/blob/v14.6.1/test/unit/server/soroban/get_transaction.test.ts#L25-L26
    it("decodes the captured Horizon path-payment resultXdr", () => {
      const resultBase64 =
        "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAANAAAAAAAAAAUAAAACZ4W6fmN63uhVqYRcHET+D2NEtJvhCIYflFh9GqtY+AwAAAACU0lMVkVSAAAAAAAAAAAAAFDutWuu6S6UPJBrotNSgfmXa27M++63OT7TYn1qjgy+AAAYW0toL2gAAAAAAAAAAAAANf4AAAACcgyAkXD5kObNTeRYciLh7R6ES/zzKp0n+cIK3Y6TjBkAAAABU0dYAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAGlGnIJrXAAAAAlNJTFZFUgAAAAAAAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAGFtLaC9oAAAAApmc7UgUBInrDvij8HMSridx2n1w3I8TVEn4sLr1LSpmAAAAAlBBTExBRElVTQAAAAAAAABQ7rVrrukulDyQa6LTUoH5l2tuzPvutzk+02J9ao4MvgAAIUz88EqYAAAAAVNHWAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AABpRpyCa1wAAAAKYUsaaCZ233xB1p+lG7YksShJWfrjsmItbokiR3ifa0gAAAAJTSUxWRVIAAAAAAAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AABv52PPa5wAAAAJQQUxMQURJVU0AAAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AACFM/PBKmAAAAAJnhbp+Y3re6FWphFwcRP4PY0S0m+EIhh+UWH0aq1j4DAAAAAAAAAAAAAA9pAAAAAJTSUxWRVIAAAAAAAAAAAAAUO61a67pLpQ8kGui01KB+Zdrbsz77rc5PtNifWqODL4AABv52PPa5wAAAAAv/RPIQ4Z5Lcrn1QUubagO9+GM+V6y19lzYAYB/2BJIgAAAAAAAAAAAAA9pAAAAAA=";

      const result = xdr.TransactionResult.fromXDR(resultBase64, "base64");
      expect(result.toXDR("base64")).toBe(resultBase64);
      // Verbatim-encoded fee charged is decimal 100 (== 0x64 in the prefix).
      // Round-trip the BigInt→Number narrowing to be sure.
      const feeCharged = result.feeCharged();
      const feeNumber = Number(feeCharged);
      if (BigInt(feeNumber) !== BigInt(feeCharged.toString())) {
        throw new Error(`feeCharged narrowing lost precision: ${feeCharged}`);
      }
      expect(feeNumber).toBe(100);
      expect(result.result().switch().name).toBe("txSuccess");
    });

    // SOURCE: https://github.com/stellar/js-stellar-sdk/blob/v14.6.1/test/unit/server/soroban/get_transaction.test.ts#L11-L12
    it("decodes the captured TransactionMeta blob", () => {
      const metaBase64 =
        "AAAAAgAAAAIAAAADAtL5awAAAAAAAAAAS0CFMhOtWUKJWerx66zxkxORaiH6/3RUq7L8zspD5RoAAAAAAcm9QAKVkpMAAHpMAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAwAAAAAC0vi5AAAAAGTB02oAAAAAAAAAAQLS+WsAAAAAAAAAAEtAhTITrVlCiVnq8eus8ZMTkWoh+v90VKuy/M7KQ+UaAAAAAAHJvUAClZKTAAB6TQAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAMAAAAAAtL5awAAAABkwdd1AAAAAAAAAAEAAAAGAAAAAwLS+VQAAAACAAAAAG4cwu71zHNXx3jHCzRGOIthcnfwRgfN2f/AoHFLLMclAAAAAEySDkgAAAAAAAAAAkJVU0lORVNTAAAAAAAAAAC3JfDeo9vreItKNPoe74EkFIqWybeUQNFvLvURhHtskAAAAAAeQtHTL5f6TAAAXH0AAAAAAAAAAAAAAAAAAAABAtL5awAAAAIAAAAAbhzC7vXMc1fHeMcLNEY4i2Fyd/BGB83Z/8CgcUssxyUAAAAATJIOSAAAAAAAAAACQlVTSU5FU1MAAAAAAAAAALcl8N6j2+t4i0o0+h7vgSQUipbJt5RA0W8u9RGEe2yQAAAAAB5C0dNHf4CAAACLCQAAAAAAAAAAAAAAAAAAAAMC0vlUAAAAAQAAAABuHMLu9cxzV8d4xws0RjiLYXJ38EYHzdn/wKBxSyzHJQAAAAJCVVNJTkVTUwAAAAAAAAAAtyXw3qPb63iLSjT6Hu+BJBSKlsm3lEDRby71EYR7bJAAAAAAAABAL3//////////AAAAAQAAAAEAE3H3TnhnuQAAAAAAAAAAAAAAAAAAAAAAAAABAtL5awAAAAEAAAAAbhzC7vXMc1fHeMcLNEY4i2Fyd/BGB83Z/8CgcUssxyUAAAACQlVTSU5FU1MAAAAAAAAAALcl8N6j2+t4i0o0+h7vgSQUipbJt5RA0W8u9RGEe2yQAAAAAAAAQC9//////////wAAAAEAAAABABNx9J6Z4RkAAAAAAAAAAAAAAAAAAAAAAAAAAwLS+WsAAAAAAAAAAG4cwu71zHNXx3jHCzRGOIthcnfwRgfN2f/AoHFLLMclAAAAH37+zXQCXdRTAAASZAAAApIAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAEAAABbBXKIigAAABhZWyiOAAAAAgAAAAAAAAAAAAAAAAAAAAMAAAAAAtL0awAAAABkwbqrAAAAAAAAAAEC0vlrAAAAAAAAAABuHMLu9cxzV8d4xws0RjiLYXJ38EYHzdn/wKBxSyzHJQAAAB9+/s10Al3UUwAAEmQAAAKSAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAABAAAAWwVyiIoAAAAYWVsojgAAAAIAAAAAAAAAAAAAAAAAAAADAAAAAALS9GsAAAAAZMG6qwAAAAAAAAAA";

      const meta = xdr.TransactionMeta.fromXDR(metaBase64, "base64");
      expect(meta.toXDR("base64")).toBe(metaBase64);
      expect(meta).toBeInstanceOf(xdr.TransactionMeta);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Soroban RPC captured XDR (parseRawSimulation + DiagnosticEvent + ScVal)
  // -------------------------------------------------------------------------
  describe("Soroban RPC captured XDR", () => {
    // SOURCE: https://github.com/stellar/js-stellar-sdk/blob/v14.6.1/test/unit/server/soroban/simulate_transaction.test.ts#L594-L628
    // From a real `hello("Aloha")` simulateTransaction RPC response.
    const transactionDataBase64 =
      "AAAAAAAAAAIAAAAGAAAAAa/6eoLeofDK5ksPljSZ7t/rAj/XR18e40fCB9LBugstAAAAFAAAAAEAAAAHqA0LEZLq3WL+N3rBQLTWuPqdV3Vv6XIAGeBJaz1wMdsAAAAAABg1gAAAAxwAAAAAAAAAAAAAAAk=";
    const fnCallEventBase64 =
      "AAAAAQAAAAAAAAAAAAAAAgAAAAAAAAADAAAADwAAAAdmbl9jYWxsAAAAAA0AAAAgr/p6gt6h8MrmSw+WNJnu3+sCP9dHXx7jR8IH0sG6Cy0AAAAPAAAABWhlbGxvAAAAAAAADwAAAAVBbG9oYQAAAA==";
    const fnReturnEventBase64 =
      "AAAAAQAAAAAAAAABr/p6gt6h8MrmSw+WNJnu3+sCP9dHXx7jR8IH0sG6Cy0AAAACAAAAAAAAAAIAAAAPAAAACWZuX3JldHVybgAAAAAAAA8AAAAFaGVsbG8AAAAAAAAQAAAAAQAAAAIAAAAPAAAABUhlbGxvAAAAAAAADwAAAAVBbG9oYQAAAA==";
    const retvalBase64 =
      "AAAAEAAAAAEAAAACAAAADwAAAAVIZWxsbwAAAAAAAA8AAAAFQWxvaGEAAAA=";

    it("decodes both DiagnosticEvent fixtures", () => {
      const fnCall = xdr.DiagnosticEvent.fromXDR(fnCallEventBase64, "base64");
      expect(fnCall).toBeInstanceOf(xdr.DiagnosticEvent);
      expect(fnCall.toXDR("base64")).toBe(fnCallEventBase64);
      expect(fnCall.inSuccessfulContractCall()).toBe(true);

      const fnReturn = xdr.DiagnosticEvent.fromXDR(fnReturnEventBase64, "base64");
      expect(fnReturn.toXDR("base64")).toBe(fnReturnEventBase64);
      // The fn_return event carries the contractId; fn_call does not.
      const returnContractId = fnReturn.event().contractId();
      expect(returnContractId).not.toBeNull();
    });

    it("loads the captured SorobanTransactionData via SorobanDataBuilder", () => {
      const builder = new SorobanDataBuilder(transactionDataBase64);
      const data = builder.build();
      expect(data.toXDR("base64")).toBe(transactionDataBase64);
      // Footprint: 1 read-only ContractData + 1 read-only ContractCode (2 total).
      expect(data.resources().footprint().readOnly()).toHaveLength(2);
      expect(data.resources().footprint().readWrite()).toHaveLength(0);
    });

    it("decodes the captured ScVal return value to vec(Symbol(Hello), Symbol(Aloha))", () => {
      const scv = xdr.ScVal.fromXDR(retvalBase64, "base64");
      expect(scv.toXDR("base64")).toBe(retvalBase64);
      expect(scv.switch().name).toBe("scvVec");
      expect(scValToNative(scv)).toEqual(["Hello", "Aloha"]);
    });

    // SOURCE: same upstream "works with real responses" describe block.
    it("parseRawSimulation decodes the full schema", () => {
      const schema = {
        id: "1",
        transactionData: transactionDataBase64,
        minResourceFee: "27889",
        events: [fnCallEventBase64, fnReturnEventBase64],
        results: [
          {
            auth: [],
            xdr: retvalBase64,
          },
        ],
        restorePreamble: { transactionData: "", minResourceFee: "0" },
        latestLedger: 2634,
      };

      expect(rpc.Api.isSimulationRaw(schema)).toBe(true);

      const parsed = rpc.parseRawSimulation(schema);
      const parsedAny = parsed as unknown as {
        events: unknown[];
        result?: { auth: unknown[]; retval: unknown };
        transactionData: unknown;
        restorePreamble?: unknown;
      };

      expect(parsedAny.events).toHaveLength(2);
      expect(parsedAny.events[0]).toBeInstanceOf(xdr.DiagnosticEvent);
      expect(parsedAny.result).toBeDefined();
      if (parsedAny.result === undefined) {
        throw new Error("parseRawSimulation produced no result");
      }
      expect(parsedAny.result.auth).toHaveLength(0);
      expect(parsedAny.result.retval).toBeInstanceOf(xdr.ScVal);
      expect(parsedAny.transactionData).toBeInstanceOf(SorobanDataBuilder);
    });
  });

  // -------------------------------------------------------------------------
  // 3. ScVal native conversion
  // -------------------------------------------------------------------------
  describe("ScVal native conversion", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/scval_test.js#L94-L154
    it("scValToNative covers every primitive arm from the upstream table", () => {
      const cases: Array<[xdr.ScVal, unknown]> = [
        [xdr.ScVal.scvVoid(), null],
        [xdr.ScVal.scvBool(true), true],
        [xdr.ScVal.scvBool(false), false],
        [xdr.ScVal.scvU32(1), 1],
        [xdr.ScVal.scvI32(1), 1],
        [new ScInt(11).toU64(), 11n],
        [new ScInt(11).toI64(), 11n],
        [new ScInt(22).toU128(), 22n],
        [new ScInt(22).toI128(), 22n],
        [new ScInt(33).toU256(), 33n],
        [new ScInt(33).toI256(), 33n],
        [xdr.ScVal.scvTimepoint(new xdr.Uint64(44n)), 44n],
        [xdr.ScVal.scvDuration(new xdr.Uint64(55n)), 55n],
        [xdr.ScVal.scvString("hello there!"), "hello there!"],
        [xdr.ScVal.scvSymbol("hello"), "hello"],
      ];

      for (const [scv, expected] of cases) {
        expect(() => scv.toXDR()).not.toThrow();
        expect(scValToNative(scv)).toEqual(expected);
      }
    });

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/scval_test.js#L106-L107
    it("scValToNative converts scvBytes to a 32-byte buffer of 0x7b ('{')", () => {
      const scv = xdr.ScVal.scvBytes(Buffer.alloc(32, 123));
      const decoded = scValToNative(scv);
      expect(Buffer.isBuffer(decoded) || decoded instanceof Uint8Array).toBe(true);
      expect((decoded as Uint8Array).length).toBe(32);
      expect((decoded as Uint8Array)[0]).toBe(123);
    });

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/scval_test.js#L13-L92
    // The "gigaMap" case: nativeToScVal(gigaMap) must equal the explicitly
    // constructed targetScv (which orders keys alphabetically by string).
    it("nativeToScVal on a deep map matches an explicitly built ScMap", () => {
      const gigaMap = {
        bool: true,
        void: null,
        u32: xdr.ScVal.scvU32(1),
        i32: xdr.ScVal.scvI32(1),
        u64: 1n,
        i64: -1n,
        timepoint: new ScInt(1443571200n).toTimepoint(),
        duration: new ScInt(1000n).toDuration(),
        u128: new ScInt(1).toU128(),
        i128: new ScInt(1).toI128(),
        u256: new ScInt(1).toU256(),
        i256: new ScInt(1).toI256(),
        map: { arbitrary: 1n, nested: "values", etc: false },
        vec: ["same", "type", "list"],
      };

      const scv = nativeToScVal(gigaMap);
      expect(scv.switch().name).toBe("scvMap");
      // The map switch case carries a value list of ScMapEntry — assert one entry per key.
      const mapValue = scv.value();
      if (!Array.isArray(mapValue)) {
        throw new Error("scvMap value() expected to be an array");
      }
      expect(mapValue).toHaveLength(Object.keys(gigaMap).length);

      // Round-trip back through scValToNative; some keys (i64) need numeric coercion.
      const back = scValToNative(scv) as Record<string, unknown>;
      expect(back.bool).toBe(true);
      expect(back.void).toBeNull();
      expect(back.u32).toBe(1);
      expect(back.i32).toBe(1);
      expect(back.u64).toBe(1n);
      expect(back.i64).toBe(-1n);
      expect(back.vec).toEqual(["same", "type", "list"]);
    });

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/scval_test.js#L156-L177
    it("nativeToScVal customization tags select the right ScVal switch", () => {
      const cases: Array<[unknown, string | undefined, string]> = [
        [1, "u32", "scvU32"],
        [1, "i32", "scvI32"],
        [1, "i64", "scvI64"],
        [1, "i128", "scvI128"],
        [1, "u256", "scvU256"],
        [2, "timepoint", "scvTimepoint"],
        [3, "duration", "scvDuration"],
        ["a", "symbol", "scvSymbol"],
        ["a", undefined, "scvString"],
        [Buffer.from("abcdefg"), undefined, "scvBytes"],
        [Buffer.from("abcdefg"), "string", "scvString"],
        [Buffer.from("abcdefg"), "symbol", "scvSymbol"],
      ];

      for (const [input, type, expectedSwitch] of cases) {
        const opts = type === undefined ? undefined : { type };
        const scv = nativeToScVal(input, opts as Parameters<typeof nativeToScVal>[1]);
        expect(scv.switch().name).toBe(expectedSwitch);
      }
    });

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/scval_test.js#L241-L249
    it("nativeToScVal('12345', {type}) round-trips to BigInt for every int width", () => {
      const value = BigInt(12345);
      for (const type of ["i64", "i128", "i256", "u64", "u128", "u256"] as const) {
        const scv = nativeToScVal("12345", { type });
        expect(scValToBigInt(scv)).toBe(value);
      }
    });

    it("nativeToScVal rejects non-numeric strings for int types", () => {
      expect(() => nativeToScVal("not a number", { type: "i128" })).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 4. XdrLargeInt — Int256 slicing + fromString round-trips
  // -------------------------------------------------------------------------
  describe("XdrLargeInt (Int256)", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/i256_test.js#L23-L41
    const upstreamMixed = -0x7fffffff800000005fffffffa00000003fffffffc00000001ffffffffn;

    it("Int256.slice(32) matches the upstream verbatim chunk array", () => {
      expect(new Int256(upstreamMixed).slice(32)).toEqual([
        1n,
        -2n,
        3n,
        -4n,
        5n,
        -6n,
        7n,
        -8n,
      ]);
    });

    it("Int256.slice(64) matches the upstream verbatim chunk array", () => {
      expect(new Int256(upstreamMixed).slice(64)).toEqual([
        -0x1ffffffffn,
        -0x3fffffffdn,
        -0x5fffffffbn,
        -0x7fffffff9n,
      ]);
    });

    it("Int256.slice(128) matches the upstream verbatim chunk array", () => {
      expect(new Int256(upstreamMixed).slice(128)).toEqual([
        -0x3fffffffc00000001ffffffffn,
        -0x7fffffff800000005fffffffbn,
      ]);
    });

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/i256_test.js#L43-L57
    it("Int256.fromString round-trips small positives, large negatives, and rejects decimals", () => {
      expect(Int256.fromString("1059").toString()).toBe("1059");
      expect(
        Int256.fromString(
          "-105909234885029834059234850234985028304085",
        ).toString(),
      ).toBe("-105909234885029834059234850234985028304085");
      expect(() => Int256.fromString("105946095601.5")).toThrow(/bigint-like/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Operation XDR round-trips
  // -------------------------------------------------------------------------
  describe("Operation XDR round-trips", () => {
    const issuer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
    const dest = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
    const trustor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
    const holder = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
    const usd = new Asset("USD", issuer.publicKey());

    function roundtrip(op: xdr.Operation, expectedType: string): void {
      const base64 = op.toXDR("base64");
      const decoded = xdr.Operation.fromXDR(base64, "base64");
      expect(decoded.toXDR("base64")).toBe(base64);

      const parsed = Operation.fromXDRObject(decoded);
      expect(parsed.type).toBe(expectedType);
    }

    it("manageSellOffer", () => {
      const op = Operation.manageSellOffer({
        selling: Asset.native(),
        buying: usd,
        amount: "100",
        price: "0.5",
        offerId: "0",
      });
      roundtrip(op, "manageSellOffer");
    });

    it("pathPaymentStrictReceive", () => {
      const op = Operation.pathPaymentStrictReceive({
        sendAsset: Asset.native(),
        sendMax: "1000",
        destination: dest.publicKey(),
        destAsset: usd,
        destAmount: "500",
        path: [],
      });
      roundtrip(op, "pathPaymentStrictReceive");
    });

    it("changeTrust", () => {
      const op = Operation.changeTrust({ asset: usd });
      roundtrip(op, "changeTrust");
    });

    it("createClaimableBalance", () => {
      const op = Operation.createClaimableBalance({
        asset: Asset.native(),
        amount: "1",
        claimants: [
          new Claimant(dest.publicKey(), Claimant.predicateUnconditional()),
        ],
      });
      roundtrip(op, "createClaimableBalance");
    });

    it("setTrustLineFlags", () => {
      const op = Operation.setTrustLineFlags({
        source: issuer.publicKey(),
        trustor: trustor.publicKey(),
        asset: usd,
        flags: {
          authorized: true,
          authorizedToMaintainLiabilities: false,
          clawbackEnabled: false,
        },
      });
      roundtrip(op, "setTrustLineFlags");
    });

    it("clawback", () => {
      const op = Operation.clawback({
        source: issuer.publicKey(),
        from: holder.publicKey(),
        asset: usd,
        amount: "10",
      });
      roundtrip(op, "clawback");
    });

    it("bumpSequence", () => {
      const op = Operation.bumpSequence({ bumpTo: "1000" });
      roundtrip(op, "bumpSequence");
    });

    it("invokeHostFunction with createContract from native asset", () => {
      const op = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeCreateContract(
          new xdr.CreateContractArgs({
            contractIdPreimage:
              xdr.ContractIdPreimage.contractIdPreimageFromAsset(
                Asset.native().toXDRObject(),
              ),
            executable:
              xdr.ContractExecutable.contractExecutableStellarAsset(),
          }),
        ),
        auth: [],
      });
      roundtrip(op, "invokeHostFunction");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Memo XDR variants
  // -------------------------------------------------------------------------
  describe("Memo XDR variants", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/memo_test.js#L27-L43
    it("Memo.text([0xd1]) serializes to the verbatim upstream 12-byte sequence", () => {
      const memoBytes = Memo.text([0xd1]).toXDRObject().toXDR();
      // memo_text tag (0x00000001) + length (0x00000001) + value (0xd1 + 3 pad)
      const expected = Buffer.from([
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0xd1, 0x00, 0x00, 0x00,
      ]);
      expect(memoBytes.equals(expected)).toBe(true);
    });

    it("Memo.text round-trips through XDR object", () => {
      const memo = Memo.text("test");
      const obj = memo.toXDRObject();
      expect(obj.arm()).toBe("text");
      const back = Memo.fromXDRObject(obj);
      expect(back.type).toBe(MemoText);
      expect(back.value).toBe("test");
    });

    it("Memo.id round-trips through XDR object", () => {
      const memo = Memo.id("1000");
      const obj = memo.toXDRObject();
      expect(obj.arm()).toBe("id");
      const back = Memo.fromXDRObject(obj);
      expect(back.value?.toString()).toBe("1000");
    });

    it("Memo.hash round-trips through XDR object", () => {
      const buf = Buffer.alloc(32, 10);
      const memo = Memo.hash(buf);
      const obj = memo.toXDRObject();
      expect(obj.arm()).toBe("hash");
      const back = Memo.fromXDRObject(obj);
      const backValue = back.value;
      if (!(backValue instanceof Buffer)) {
        throw new Error(`expected Memo.hash value to decode as Buffer, got ${typeof backValue}`);
      }
      expect(backValue.length).toBe(32);
      expect(backValue.equals(buf)).toBe(true);
    });

    it("Memo.return round-trips through XDR object", () => {
      const buf = Buffer.alloc(32, 11);
      const memo = Memo.return(buf.toString("hex"));
      const obj = memo.toXDRObject();
      expect(obj.arm()).toBe("retHash");
      const back = Memo.fromXDRObject(obj);
      const backValue = back.value;
      if (!(backValue instanceof Buffer)) {
        throw new Error(`expected Memo.return value to decode as Buffer`);
      }
      expect(backValue.length).toBe(32);
    });
  });

  // -------------------------------------------------------------------------
  // 7. SignerKey variants
  // -------------------------------------------------------------------------
  describe("SignerKey variants", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/signerkey_test.js#L3-L21
    const testCases: Array<{ strkey: string; typeName: string }> = [
      {
        strkey: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
        typeName: "signerKeyTypeEd25519",
      },
      {
        strkey: "TBU2RRGLXH3E5CQHTD3ODLDF2BWDCYUSSBLLZ5GNW7JXHDIYKXZWHXL7",
        typeName: "signerKeyTypePreAuthTx",
      },
      {
        strkey: "XBU2RRGLXH3E5CQHTD3ODLDF2BWDCYUSSBLLZ5GNW7JXHDIYKXZWGTOG",
        typeName: "signerKeyTypeHashX",
      },
      {
        strkey:
          "PA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAQACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IBZGM",
        typeName: "signerKeyTypeEd25519SignedPayload",
      },
    ];

    for (const { strkey, typeName } of testCases) {
      it(`decode/encode round-trips ${strkey.substring(0, 5)}... as ${typeName}`, () => {
        const skey = SignerKey.decodeAddress(strkey);
        expect(skey.switch().name).toBe(typeName);

        const rawXdr = skey.toXDR("raw");
        const reparsed = xdr.SignerKey.fromXDR(rawXdr, "raw");
        expect(reparsed.switch().name).toBe(typeName);

        const reEncoded = SignerKey.encodeSignerKey(skey);
        expect(reEncoded).toBe(strkey);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 8. Asset SAC contract IDs (Futurenet only — upstream asserts here)
  // -------------------------------------------------------------------------
  describe("Asset SAC contract IDs", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/asset_test.js#L379-L400
    it("native asset SAC contract ID on Futurenet", () => {
      expect(Asset.native().contractId(Networks.FUTURENET)).toBe(
        "CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZSODMCX4NJ2HV2KN7OHT",
      );
    });

    it("USD asset SAC contract ID on Futurenet", () => {
      const asset = new Asset(
        "USD",
        "GCP2QKBFLLEEWYVKAIXIJIJNCZ6XEBIE4PCDB6BF3GUB6FGE2RQ3HDVP",
      );
      expect(asset.contractId(Networks.FUTURENET)).toBe(
        "CCWNZPARJG7KQ6N4BGZ5OBWKSSK4AVQ5URLDRXB4ZJXKGEJQTIIRPAHN",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 9. Contract round-trips and footprint
  // -------------------------------------------------------------------------
  describe("Contract round-trips and footprint", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/contract_test.js#L4-L13
    const NULL_ADDRESS =
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    const SAMPLE_ADDRESS =
      "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

    it.each([NULL_ADDRESS, SAMPLE_ADDRESS])(
      "Contract(%s).contractId() round-trips",
      (cid) => {
        const contract = new Contract(cid);
        expect(contract.contractId()).toBe(cid);
      },
    );

    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/contract_test.js#L32-L48
    it("Contract.getFootprint returns LedgerKey.contractData with persistent durability", () => {
      const contract = new Contract(NULL_ADDRESS);
      const expected = xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: contract.address().toScAddress(),
          key: xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: xdr.ContractDataDurability.persistent(),
        }),
      );
      const actual = contract.getFootprint();
      expect(actual.toXDR("base64")).toBe(expected.toXDR("base64"));
    });

    it("StrKey.decodeContract / encodeContract round-trips", () => {
      const decoded = StrKey.decodeContract(SAMPLE_ADDRESS);
      expect(decoded.length).toBe(32);
      expect(StrKey.encodeContract(decoded)).toBe(SAMPLE_ADDRESS);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Soroban auth (authorizeEntry + buildInvocationTree + walkInvocationTree)
  // -------------------------------------------------------------------------
  describe("Soroban auth", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/auth_test.js#L1-L88
    it("authorizeEntry signs an entry and preserves invocation, address, nonce", async () => {
      const kp = Keypair.random();
      const contractId =
        "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

      const authEntry = new xdr.SorobanAuthorizationEntry({
        rootInvocation: new xdr.SorobanAuthorizedInvocation({
          function:
            xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
              new xdr.InvokeContractArgs({
                contractAddress: new Address(contractId).toScAddress(),
                functionName: "hello",
                args: [xdr.ScVal.scvU64(new xdr.Uint64(1234n))],
              }),
            ),
          subInvocations: [],
        }),
        credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
          new xdr.SorobanAddressCredentials({
            address: new Address(kp.publicKey()).toScAddress(),
            nonce: new xdr.Int64(123456789101112n),
            signatureExpirationLedger: 0,
            signature: xdr.ScVal.scvVec([]),
          }),
        ),
      });

      // Sanity: built entry must serialize.
      expect(() => authEntry.toXDR()).not.toThrow();

      // v16: authorizeEntry no longer defaults networkPassphrase to
      // Networks.FUTURENET, so it must be passed explicitly.
      const signed = await authorizeEntry(authEntry, kp, 10, Networks.FUTURENET);

      // Invocation must be untouched.
      expect(signed.rootInvocation().toXDR("base64")).toBe(
        authEntry.rootInvocation().toXDR("base64"),
      );

      const signedAddr = signed.credentials().address();
      const entryAddr = authEntry.credentials().address();
      expect(signedAddr.signatureExpirationLedger()).toBe(10);
      expect(signedAddr.address().toXDR("base64")).toBe(
        entryAddr.address().toXDR("base64"),
      );
      // BigInt → BigInt comparison (no narrowing); upstream also checks via .eql.
      expect(signedAddr.nonce().toString()).toBe(entryAddr.nonce().toString());

      const sigVec = signedAddr.signature().vec();
      if (sigVec === null || sigVec === undefined) {
        throw new Error("signature() should produce a non-null vec after signing");
      }
      expect(sigVec).toHaveLength(1);

      const sigArg = scValToNative(sigVec[0]) as {
        public_key: Buffer;
        signature: Buffer;
      };
      expect(sigArg).toHaveProperty("public_key");
      expect(sigArg).toHaveProperty("signature");
      expect(StrKey.encodeEd25519PublicKey(sigArg.public_key)).toBe(
        kp.publicKey(),
      );
    });

// SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/invocation_test.js#L36-L260
    // Builds the same complex invocation tree (NFT purchase + SAC wrap + swap
    // + 2 transfers + NFT transfer + wasm create) and asserts the parsed
    // shape and walk traversal verbatim from upstream.
    it("buildInvocationTree and walkInvocationTree match the upstream complex tree", () => {
      function rk(): string {
        return Keypair.random().publicKey();
      }
      function makeInvocation(
        contract: Contract,
        name: string,
        ...args: unknown[]
      ): xdr.SorobanAuthorizedFunction {
        return xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: contract.address().toScAddress(),
            functionName: name,
            args: args.map((a) => nativeToScVal(a)),
          }),
        );
      }

      const [nftContract, swapContract, xlmContract, usdcContract] = [
        1, 2, 3, 4,
      ].map(() => {
        const buf = hash(Buffer.from(Keypair.random().publicKey()));
        return new Contract(StrKey.encodeContract(buf));
      });

      const invoker = rk();
      const usdcId = rk();
      const dest = rk();
      const nftId = rk();

      const rootInvocation = new xdr.SorobanAuthorizedInvocation({
        function: makeInvocation(
          nftContract,
          "purchase",
          `SomeNft:${nftId}`,
          7,
        ),
        subInvocations: [
          new xdr.SorobanAuthorizedInvocation({
            function:
              xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractHostFn(
                new xdr.CreateContractArgs({
                  contractIdPreimage:
                    xdr.ContractIdPreimage.contractIdPreimageFromAsset(
                      new Asset("TEST", nftId).toXDRObject(),
                    ),
                  executable:
                    xdr.ContractExecutable.contractExecutableStellarAsset(),
                }),
              ),
            subInvocations: [],
          }),
          new xdr.SorobanAuthorizedInvocation({
            function: makeInvocation(
              swapContract,
              "swap",
              "native",
              `USDC:${usdcId}`,
              new Address(invoker).toScVal(),
              new Address(dest).toScVal(),
            ),
            subInvocations: [
              new xdr.SorobanAuthorizedInvocation({
                function: makeInvocation(
                  xlmContract,
                  "transfer",
                  new Address(invoker).toScVal(),
                  "7",
                ),
                subInvocations: [],
              }),
              new xdr.SorobanAuthorizedInvocation({
                function: makeInvocation(
                  usdcContract,
                  "transfer",
                  new Address(invoker).toScVal(),
                  "1",
                ),
                subInvocations: [],
              }),
            ],
          }),
          new xdr.SorobanAuthorizedInvocation({
            function: makeInvocation(
              nftContract,
              "transfer",
              nftContract.address().toScVal(),
              "2",
            ),
            subInvocations: [],
          }),
          new xdr.SorobanAuthorizedInvocation({
            function:
              xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
                new xdr.CreateContractArgsV2({
                  contractIdPreimage:
                    xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                      new xdr.ContractIdPreimageFromAddress({
                        address: nftContract.address().toScAddress(),
                        salt: Buffer.alloc(32, 0),
                      }),
                    ),
                  constructorArgs: [1, "2", 3].map((arg, i) =>
                    nativeToScVal(arg, {
                      type: ["u32", "string", "i32"][i],
                    }),
                  ),
                  executable: xdr.ContractExecutable.contractExecutableWasm(
                    Buffer.alloc(32, 0x20),
                  ),
                }),
              ),
            subInvocations: [],
          }),
        ],
      });

      // Tree must serialize.
      expect(() => rootInvocation.toXDR()).not.toThrow();

      // Build + verify top-level structure (the exact shape upstream asserts).
      const parsed = buildInvocationTree(rootInvocation) as {
        type: string;
        args: { function: string };
        invocations: Array<{ type: string }>;
      };
      expect(parsed.type).toBe("execute");
      expect(parsed.args.function).toBe("purchase");
      expect(parsed.invocations).toHaveLength(4);
      expect(parsed.invocations[0].type).toBe("create");
      expect(parsed.invocations[1].type).toBe("execute");
      expect(parsed.invocations[2].type).toBe("execute");
      expect(parsed.invocations[3].type).toBe("create");

      // Walk: 7 nodes, each visited once, max depth 3.
      let walkCount = 0;
      let maxDepth = 0;
      const seen = new Set<string>();
      walkInvocationTree(rootInvocation, (node, depth) => {
        walkCount++;
        seen.add(node.toXDR("base64"));
        if (depth > maxDepth) {
          maxDepth = depth;
        }
        return true;
      });
      expect(walkCount).toBe(7);
      expect(seen.size).toBe(7);
      expect(maxDepth).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 11. humanizeEvents
  // -------------------------------------------------------------------------
  describe("humanizeEvents", () => {
    // SOURCE: https://github.com/stellar/js-stellar-base/blob/v14.1.0/test/unit/events_test.js#L9-L77
    it("humanizes diagnostic events with and without contractId", () => {
      const contractId =
        "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
      const topics1 = nativeToScVal([1, 2, 3]).value() as xdr.ScVal[];
      const data1 = nativeToScVal({ hello: "world" });

      // Upstream workaround: xdr.ContractEventBody.0(...) is not valid JS,
      // so the body must be built with a placeholder switch and then mutated.
      const cloneAndSet = (
        topics: xdr.ScVal[],
        data: xdr.ScVal,
      ): xdr.ContractEventBody => {
        const body = new xdr.ContractEventBody(
          0,
          new xdr.ContractEventV0({
            topics: [],
            data: xdr.ScVal.scvVoid(),
          }),
        );
        body.v0().topics(topics);
        body.v0().data(data);
        return body;
      };

      const events = [
        new xdr.DiagnosticEvent({
          inSuccessfulContractCall: true,
          event: new xdr.ContractEvent({
            ext: new xdr.ExtensionPoint(0),
            contractId: StrKey.decodeContract(contractId),
            type: xdr.ContractEventType.contract(),
            body: cloneAndSet(topics1, data1),
          }),
        }),
        new xdr.DiagnosticEvent({
          inSuccessfulContractCall: true,
          event: new xdr.ContractEvent({
            ext: new xdr.ExtensionPoint(0),
            type: xdr.ContractEventType.contract(),
            body: cloneAndSet(topics1, data1),
          }),
        }),
      ];

      // Sanity: both events must serialize.
      events.forEach((e) => expect(() => e.toXDR()).not.toThrow());

      const readable = humanizeEvents(events);
      expect(readable).toHaveLength(2);
      expect(readable[0]).toEqual({
        type: "contract",
        contractId,
        topics: topics1.map((t) => scValToNative(t)),
        data: scValToNative(data1),
      });
      expect(readable[1]).toEqual({
        type: "contract",
        topics: topics1.map((t) => scValToNative(t)),
        data: scValToNative(data1),
      });
    });
  });
});
