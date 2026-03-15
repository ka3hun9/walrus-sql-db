import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import * as api from "../src/index.js";
import { loadWalrusSqlClientOptions } from "../src/config.js";

const requiredExports = [
  "WalrusSqlClient",
  "normalizeSql",
  "parseSqlToAst",
  "buildMoveCall",
  "runPerformanceBenchmarks",
  "writePerformanceBenchmarkReport",
  "createSqlError",
  "sqlError",
  "loadWalrusSqlClientOptions",
  "createClientFromConfig",
  "createLogger",
];

for (const key of requiredExports) {
  assert.equal(key in api, true, `missing public export: ${key}`);
}

const cfg = loadWalrusSqlClientOptions({
  env: {
    WALRUS_SQL_PACKAGE_ID: "0xcompat",
    WALRUS_SQL_NETWORK: "sui-testnet",
    WALRUS_SQL_MODE: "simulator",
    WALRUS_SQL_DIALECT: "ansi",
    WALRUS_SQL_LOG_LEVEL: "error",
  },
});

assert.equal(cfg.packageId, "0xcompat");
assert.equal(cfg.mode, "simulator");
assert.equal(cfg.dialect, "ansi");
assert.equal(cfg.logging?.level, "error");

const doc = readFileSync("docs/sql-release-compatibility-checklist.md", "utf8");
assert.ok(doc.includes("## I-ENG-004"));
assert.ok(doc.includes("## Backward Compatibility Statement"));
assert.ok(doc.includes("## Pre-Release Gate Checklist"));

console.log("ok: I-ENG-004 pre-release compatibility checklist + API contract gate");
