// Pruebas de seguridad de la base en un PostgreSQL local descartable.
//
// Levanta un contenedor postgres:16-alpine efímero (sin red, datos en tmpfs),
// aplica los stubs de Supabase (roles, auth.*, storage.*, publicación) y TODAS
// las migraciones de supabase/migrations en orden, y corre cada
// tests/db/cases/*.sql en una base nueva clonada de esa plantilla. Nunca se
// conecta a Supabase. Al terminar el contenedor se borra.
//
// Uso: node tests/db/run.js [filtro]   (requiere Docker)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const HERE = __dirname;
const IMAGE = process.env.PG_TEST_IMAGE || "postgres:16-alpine";
const NAME = `cs-pgtest-${process.pid}`;

function docker(args, input) {
  const r = spawnSync("docker", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return r;
}

// Corre SQL (texto) en la base indicada; ON_ERROR_STOP corta en el primer error
function psql(db, sql) {
  return docker(["exec", "-i", NAME, "psql", "-X", "-q", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1"], sql);
}

function must(db, sql, label) {
  const r = psql(db, sql);
  if (r.status !== 0) throw new Error(`fallo en ${label}:\n${r.stderr || r.stdout}`);
}

let started = false;
try {
  let r = docker(["run", "-d", "--rm", "--name", NAME, "--network", "none", "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE]);
  if (r.status !== 0) throw new Error("docker run: " + r.stderr);
  started = true;
  // La imagen reinicia el servidor tras el init: esperar a que acepte consultas reales
  const t0 = Date.now();
  while (psql("postgres", "select 1").status !== 0 || docker(["exec", NAME, "pg_isready", "-U", "postgres", "-h", "127.0.0.1"]).status !== 0) {
    if (Date.now() - t0 > 60000) throw new Error("postgres no arrancó");
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},500)"]);
  }

  // Plantilla: stubs + migraciones + helpers + fixture
  must("postgres", "create database base", "create database");
  const migrations = fs
    .readdirSync(path.join(ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(ROOT, "supabase", "migrations", f));
  for (const f of [path.join(HERE, "stubs.sql"), ...migrations, path.join(HERE, "helpers.sql"), path.join(HERE, "fixture.sql")]) {
    must("base", fs.readFileSync(f, "utf8"), path.relative(ROOT, f));
  }

  const filter = process.argv[2] || "";
  const cases = fs
    .readdirSync(path.join(HERE, "cases"))
    .filter((f) => f.endsWith(".sql") && f.includes(filter))
    .sort();
  let failed = 0;
  cases.forEach((f, i) => {
    const db = "t" + i;
    must("postgres", `create database ${db} template base`, "create database " + db);
    const res = psql(db, fs.readFileSync(path.join(HERE, "cases", f), "utf8"));
    const ok = res.status === 0;
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${f}`);
    if (!ok || process.env.VERBOSE) console.log((res.stdout + res.stderr).replace(/^/gm, "     "));
  });
  console.log(`\n${cases.length - failed}/${cases.length} casos OK`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error(e.message);
  process.exitCode = 2;
} finally {
  if (started) docker(["rm", "-f", NAME]);
}
