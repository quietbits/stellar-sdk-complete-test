import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "./helpers/assert.ts";

function isNode(): boolean {
  const globalObject = globalThis as { Deno?: unknown; Bun?: unknown };
  return globalObject.Deno === undefined && globalObject.Bun === undefined;
}

function leb128(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0);
  return Buffer.from(bytes);
}

function contractWasm(): Buffer {
  const name = Buffer.from("contractspecv0", "utf8");
  const entry = xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: "Returns a greeting",
      name: "hello",
      inputs: [],
      outputs: [xdr.ScSpecTypeDef.scSpecTypeString()],
    }),
  ).toXDR();
  const section = Buffer.concat([leb128(name.length), name, entry]);

  return Buffer.concat([
    Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x00]),
    leb128(section.length),
    section,
  ]);
}

describe("published stellar-js CLI", () => {
  if (!isNode()) {
    it("skipped (Node CLI)", () => {});
    return;
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const cli = join(
    root,
    "node_modules",
    "@stellar",
    "stellar-sdk",
    "bin",
    "stellar-js",
  );

  const run = (args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
    });

  it("exposes help and version through the published executable", () => {
    const help = run(["--help"]);
    const version = run(["--version"]);

    expect(help.status).toBe(0);
    expect(help.stdout).toContain("generate [options]");
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("1.0.0");
  });

  it("rejects an incomplete generation request", () => {
    const result = run(["generate", "--output-dir", "unused"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Must provide one of");
  });

  it("generates bindings from local WASM that load after supplying Node types", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "stellar-js-cli-"));
    const wasmPath = join(workDir, "hello.wasm");
    const outputDir = join(workDir, "bindings");
    writeFileSync(wasmPath, contractWasm());

    try {
      const generated = run([
        "generate",
        "--wasm",
        wasmPath,
        "--output-dir",
        outputDir,
        "--contract-name",
        "HelloContract",
      ]);
      expect(generated.status).toBe(0);
      expect(generated.stdout).toContain("Successfully generated bindings");
      expect(
        readFileSync(join(outputDir, "src", "client.ts"), "utf8"),
      ).toContain("hello");

      symlinkSync(
        join(root, "node_modules"),
        join(outputDir, "node_modules"),
        "dir",
      );
      const typecheck = spawnSync(
        join(root, "node_modules", ".bin", "tsc"),
        ["--project", join(outputDir, "tsconfig.json"), "--noEmit"],
        { cwd: outputDir, encoding: "utf8" },
      );
      // DEVIATION: the generated client names Buffer, but its package omits
      // @types/node and its tsconfig does not include Node globals. See issue 14.
      expect(typecheck.status).not.toBe(0);
      expect(typecheck.stdout + typecheck.stderr).toContain("TS2591");

      const tsconfigPath = join(outputDir, "tsconfig.json");
      const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
        compilerOptions: Record<string, unknown>;
      };
      tsconfig.compilerOptions.types = ["node"];
      tsconfig.compilerOptions.rootDir = "./src";
      writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

      const build = spawnSync(
        join(root, "node_modules", ".bin", "tsc"),
        ["--project", tsconfigPath],
        { cwd: outputDir, encoding: "utf8" },
      );
      expect(build.status, build.stdout + build.stderr).toBe(0);

      const generatedModule = await import(
        pathToFileURL(join(outputDir, "dist", "index.js")).href
      );
      expect(typeof generatedModule.Client).toBe("function");
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });
});
