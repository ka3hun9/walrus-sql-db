import "dotenv/config";
import { getFullnodeUrl, SuiClient } from "@mysten/sui/client";
import { WalrusSqlClient, type OnchainQueryRequest, type QueryResult, type SqlRow } from "../src/index.js";

const PACKAGE_ID =
  process.env.WALRUS_SQL_PACKAGE_ID ??
  "0x630e7563985686b50d05d20b73e2603b10578bbe76ce51f8b82e65c83638fe95";
const NETWORK = process.env.SUI_NETWORK ?? "testnet";
const SUI_RPC_URL =
  process.env.SUI_RPC_URL ?? (NETWORK === "mainnet" ? getFullnodeUrl("mainnet") : getFullnodeUrl("testnet"));

const TABLE_NAME = process.env.WALRUS_SQL_TABLE_NAME ?? "orders";
const TABLE_ID = process.env.WALRUS_SQL_TABLE_ID;

if (!TABLE_ID) {
  throw new Error("Missing WALRUS_SQL_TABLE_ID in .env");
}

const client = new SuiClient({ url: SUI_RPC_URL });
const tableRegistry = new Map<string, string>([[TABLE_NAME, TABLE_ID]]);

function pickFields(row: SqlRow, fields: string[] | ["*"]): SqlRow {
  if (fields.length === 1 && fields[0] === "*") return row;
  const out: SqlRow = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
}

async function onchainQueryExecutor(req: OnchainQueryRequest): Promise<QueryResult> {
  const tableId = tableRegistry.get(req.table);
  if (!tableId) {
    throw new Error(`Table not found: ${req.table}`);
  }

  const obj = await client.getObject({
    id: tableId,
    options: { showContent: true, showType: true },
  });

  const content = obj.data?.content;
  if (!content || content.dataType !== "moveObject") {
    return { rows: [] };
  }

  const fields = (content.fields ?? {}) as Record<string, unknown>;
  const baseRow: SqlRow = {
    id: tableId,
    name: typeof fields.name === "string" ? fields.name : String(fields.name ?? ""),
    schema: typeof fields.schema === "string" ? fields.schema : String(fields.schema ?? ""),
    commit_count: Number(fields.commit_count ?? 0),
    latest_manifest_hash:
      typeof fields.latest_manifest_hash === "string"
        ? fields.latest_manifest_hash
        : String(fields.latest_manifest_hash ?? ""),
    latest_index_root:
      typeof fields.latest_index_root === "string"
        ? fields.latest_index_root
        : String(fields.latest_index_root ?? ""),
  };

  if (req.where) {
    const where = req.where.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)/i);
    if (!where) throw new Error(`Unsupported WHERE expression: ${req.where}`);
    const field = where[1].trim();
    const raw = where[2].trim();
    const value =
      (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))
        ? raw.slice(1, -1)
        : raw;

    if (String(baseRow[field]) !== value) {
      return { rows: [] };
    }
  }

  return { rows: [pickFields(baseRow, req.fields)] };
}

async function main() {
  const db = new WalrusSqlClient({
    packageId: PACKAGE_ID,
    network: `sui-${NETWORK}`,
    mode: "onchain",
    onchainQueryExecutor,
  });

  console.log(`Using RPC: ${SUI_RPC_URL}`);
  console.log(`Reading table: ${TABLE_NAME} -> ${TABLE_ID}`);

  const all = await db.query(`SELECT * FROM ${TABLE_NAME}`);
  console.log("SELECT * =>", all.rows);

  const one = await db.query(`SELECT id, name, schema, commit_count FROM ${TABLE_NAME} WHERE id = '${TABLE_ID}'`);
  console.log("SELECT filtered =>", one.rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
