import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { chromium } from "playwright";

const ROOT = process.cwd();
const DIST = join(ROOT, "node_modules", "@stellar", "stellar-sdk", "dist");
const BUNDLES = [
  "stellar-sdk.js",
  "stellar-sdk.min.js",
  "stellar-sdk-axios.js",
  "stellar-sdk-axios.min.js",
];

const FEE_STATS_BLOCK = {
  min: "100",
  max: "500",
  mode: "321",
  p10: "120",
  p20: "150",
  p30: "170",
  p40: "190",
  p50: "210",
  p60: "240",
  p70: "270",
  p80: "300",
  p90: "350",
  p95: "400",
  p99: "450",
};

function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find(
    (candidate) => candidate !== undefined && existsSync(candidate),
  );
}

describe("published browser bundles", () => {
  let browser;
  let origin;
  let server;

  before(async () => {
    server = createServer((request, response) => {
      if (request.url === "/fee_stats") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            last_ledger: "123456",
            last_ledger_base_fee: "321",
            ledger_capacity_usage: "0.50",
            fee_charged: FEE_STATS_BLOCK,
            max_fee: FEE_STATS_BLOCK,
          }),
        );
        return;
      }

      const bundle = request.url?.startsWith("/dist/")
        ? request.url.slice("/dist/".length)
        : undefined;
      if (bundle !== undefined && BUNDLES.includes(bundle)) {
        response.setHeader("content-type", "text/javascript");
        response.end(readFileSync(join(DIST, bundle)));
        return;
      }

      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><html><body></body></html>");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Browser test server did not bind to a TCP port");
    }
    origin = `http://127.0.0.1:${address.port}`;

    const executablePath = chromeExecutable();
    browser = await chromium.launch(
      executablePath === undefined ? {} : { executablePath },
    );
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve, reject) => {
      server?.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  for (const bundle of BUNDLES) {
    test(`${bundle} attaches its global and performs crypto, XDR, and HTTP`, async () => {
      const page = await browser.newPage();
      try {
        await page.goto(origin);
        await page.addScriptTag({ url: `${origin}/dist/${bundle}` });
        const result = await page.evaluate(async () => {
          const sdk = globalThis.StellarSdk;
          const keypair = sdk.Keypair.random();
          const message = new Uint8Array([1, 2, 3, 4]);
          const scVal = sdk.nativeToScVal("browser-round-trip");
          const horizon = new sdk.Horizon.Server(location.origin, {
            allowHttp: true,
          });

          return {
            rootExports: Object.keys(sdk).length,
            signatureVerified: keypair.verify(message, keypair.sign(message)),
            xdrValue: sdk.scValToNative(scVal),
            baseFee: await horizon.fetchBaseFee(),
          };
        });

        assert.ok(result.rootExports > 50);
        assert.equal(result.signatureVerified, true);
        assert.equal(result.xdrValue, "browser-round-trip");
        assert.equal(result.baseFee, 321);
      } finally {
        await page.close();
      }
    });
  }
});
