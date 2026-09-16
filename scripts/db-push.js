// Aplica las migraciones de supabase/migrations en orden usando la
// Management API (no hace falta la CLI de Supabase ni psql).
// Uso: node scripts/db-push.js [archivo.sql]
const fs = require("fs");
const path = require("path");
const { ROOT, readEnv, sql } = require("./lib");

(async () => {
  const env = readEnv();
  const dir = path.join(ROOT, "supabase", "migrations");
  const only = process.argv[2];
  const files = only ? [only] : fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const file = path.isAbsolute(f) ? f : path.join(dir, f);
    process.stdout.write(`[db] ${path.basename(file)} ... `);
    await sql(env, fs.readFileSync(file, "utf8"));
    console.log("ok");
  }
})().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
