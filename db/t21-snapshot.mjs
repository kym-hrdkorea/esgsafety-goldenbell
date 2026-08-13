import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const TABLES = [
  ["app_config", "key"],
  ["org_category", "code"],
  ["org_unit", "id"],
  ["department", "id"],
  ["participant", "id"],
  ["quiz_round", "round_no"],
  ["quiz_item", "id"],
  ["quiz_session", "id"],
  ["quiz_session_item", "id"],
  ["prelearning_view", "id"],
  ["ranking_snapshot", "id"],
  ["admin_user", "id"],
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const outDir = path.resolve(
  argValue(
    "--out",
    path.join(process.cwd(), "..", "..", "supabase-backups", "t21-snapshot")
  )
);
const includeData = process.argv.includes("--include-data");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
}

const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function countTable(table) {
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function readTable(table, primaryKey) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(primaryKey, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

await mkdir(outDir, { recursive: true });

const capturedAt = new Date().toISOString();
const tables = [];
for (const [table] of TABLES) {
  tables.push({ table, count: await countTable(table) });
}

const snapshot = {
  capturedAt,
  projectHost: new URL(url).host,
  mode: includeData ? "counts-and-data" : "counts-only",
  tables,
};
await writeFile(
  path.join(outDir, "row-counts.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8"
);

if (includeData) {
  const data = {};
  for (const [table, primaryKey] of TABLES) {
    data[table] = await readTable(table, primaryKey);
  }
  await writeFile(
    path.join(outDir, "public-data.json"),
    `${JSON.stringify({ capturedAt, projectHost: new URL(url).host, data }, null, 2)}\n`,
    "utf8"
  );
}

console.log(`T21 스냅샷 완료: ${outDir}`);
for (const { table, count } of tables) console.log(`${table}\t${count}`);
