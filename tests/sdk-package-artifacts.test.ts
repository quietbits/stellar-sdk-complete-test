import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "./helpers/assert.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sdkRoot = join(root, "node_modules", "@stellar", "stellar-sdk");
const packageJson = JSON.parse(
  readFileSync(join(sdkRoot, "package.json"), "utf8"),
) as {
  bin: Record<string, string>;
  exports: Record<string, Record<string, string>>;
  files: string[];
};

const DIST_ARTIFACTS = [
  "stellar-sdk.js",
  "stellar-sdk.js.map",
  "stellar-sdk.min.js",
  "stellar-sdk.min.js.map",
  "stellar-sdk-axios.js",
  "stellar-sdk-axios.js.map",
  "stellar-sdk-axios.min.js",
  "stellar-sdk-axios.min.js.map",
] as const;

describe("published package artifacts", () => {
  it("ships every target named by the exports map", () => {
    for (const conditions of Object.values(packageJson.exports)) {
      for (const target of Object.values(conditions)) {
        expect(readFileSync(join(sdkRoot, target)).length > 0).toBe(true);
      }
    }
  });

  it("declares one executable and ships a Node entry point", () => {
    expect(packageJson.bin).toEqual({ "stellar-js": "./bin/stellar-js" });
    const source = readFileSync(
      join(sdkRoot, packageJson.bin["stellar-js"]),
      "utf8",
    );
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("classifies every browser artifact shipped in dist", () => {
    const declaredFiles = new Set(
      packageJson.files.map((path) => path.replace(/^\//, "")),
    );
    expect(declaredFiles.has("dist")).toBe(true);
    expect(readdirSync(join(sdkRoot, "dist")).sort()).toEqual(
      [...DIST_ARTIFACTS].sort(),
    );
  });
});
