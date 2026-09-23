// Regresión de los hallazgos de scripts/dev-server.js. Corre el servidor real
// sobre una copia descartable del repo con un .env FICTICIO (nunca el real) y
// solo compara códigos de estado / marcadores, sin imprimir cuerpos.
// Uso: node --test tests/js/
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cs-devserver-"));
const APP = path.join(TMP, "app");
const PORT = 38000 + Math.floor(Math.random() * 1000);
const MARKER = "DUMMY-SECRET-MARKER";
let server;

function copy(rel) {
  fs.cpSync(path.join(ROOT, rel), path.join(APP, rel), {
    recursive: true,
    filter: (src) => !/[\\/]env\.js$/.test(src),
  });
}

function request(method, url, host) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: url, headers: { Host: host || `localhost:${PORT}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  ["scripts", "tienda", "dash", "assets", "api", "package.json"].forEach(copy);
  fs.writeFileSync(path.join(APP, ".env"), `# .env ficticio del test\nSUPABASE_URL=https://dummy.supabase.co\nSUPABASE_ANON_KEY=dummy\nSUPABASE=${MARKER}\n`);
  fs.mkdirSync(path.join(APP, ".git"));
  fs.writeFileSync(path.join(APP, ".git", "HEAD"), `ref: refs/heads/${MARKER}\n`);
  // Carpeta hermana cuyo nombre empieza igual que la raíz (app-sibling vs app)
  fs.mkdirSync(path.join(TMP, "app-sibling"));
  fs.writeFileSync(path.join(TMP, "app-sibling", "secret.txt"), MARKER);
  // Carpeta dentro de la raíz cuyo nombre empieza como una servida (tienda-x vs tienda)
  fs.mkdirSync(path.join(APP, "tienda-x"));
  fs.writeFileSync(path.join(APP, "tienda-x", "secret.txt"), MARKER);
  // Módulo "api" hermano (app/api-x) que no debe ejecutarse
  fs.mkdirSync(path.join(APP, "api-x"));
  fs.writeFileSync(path.join(APP, "api-x", "echo.js"), `module.exports = (req, res) => { require("fs").writeFileSync(${JSON.stringify(path.join(TMP, "executed"))}, "1"); res.end("${MARKER}"); };`);

  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(PORT) };
  server = spawn(process.execPath, [path.join(APP, "scripts", "dev-server.js")], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] });
  server.exited = new Promise((r) => server.on("exit", (code) => r(code)));
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("el dev server no arrancó")), 15000);
    server.stdout.on("data", (d) => /\[dev\] http/.test(String(d)) && (clearTimeout(t), resolve()));
    server.on("exit", (c) => reject(new Error("el dev server terminó al arrancar: " + c)));
  });
});

after(() => {
  if (server && server.exitCode == null) server.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("sigue sirviendo la tienda, el panel y los assets", async () => {
  assert.strictEqual((await request("GET", "/")).status, 200);
  assert.strictEqual((await request("GET", "/productos")).status, 200);
  assert.strictEqual((await request("GET", "/assets/js/core/utils.js")).status, 200);
  assert.strictEqual((await request("GET", "/", `dash.localhost:${PORT}`)).status, 200);
  assert.strictEqual((await request("GET", "/dash/js/dashboard.js", `dash.localhost:${PORT}`)).status, 200);
});

test("[HIGH] no sirve .env, .git ni archivos de la raíz del repo", async () => {
  for (const url of ["/.env", "/.git/HEAD", "/package.json", "/scripts/lib.js", "/api/mp/pay.js", "/assets/../.env", "/%2Eenv"]) {
    const r = await request("GET", url);
    assert.strictEqual(r.status, 404, `${url} devolvió ${r.status}`);
    assert.ok(!r.body.includes(MARKER), `${url} filtró el contenido`);
  }
  for (const url of ["/.env", "/.git/HEAD"]) {
    const r = await request("GET", url, `dash.localhost:${PORT}`);
    assert.strictEqual(r.status, 404, `dash ${url} devolvió ${r.status}`);
  }
});

test("[HIGH] escucha solo en 127.0.0.1 por defecto", async () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  if (!lan) return; // sin interfaz de red no hay nada que probar
  const reachable = await new Promise((resolve) => {
    const s = net.connect({ host: lan.address, port: PORT });
    s.setTimeout(2000, () => (s.destroy(), resolve(false)));
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
  assert.strictEqual(reachable, false, `el dev server responde en ${lan.address}`);
});

test("[LOW] un %-encoding inválido responde 400 y no tira el proceso", async () => {
  const r = await request("GET", "/%E0%A4%A");
  assert.strictEqual(r.status, 400);
  assert.strictEqual(server.exitCode, null, "el proceso terminó");
  assert.strictEqual((await request("GET", "/")).status, 200);
});

test("[LOW] no sale de la raíz hacia carpetas hermanas (app-sibling, api-x)", async () => {
  const r1 = await request("GET", "/..%2Fapp-sibling%2Fsecret.txt");
  assert.strictEqual(r1.status, 404, `archivo hermano devolvió ${r1.status}`);
  assert.ok(!r1.body.includes(MARKER));
  const r3 = await request("GET", "/..%2Ftienda-x%2Fsecret.txt");
  assert.strictEqual(r3.status, 404, `tienda-x devolvió ${r3.status}`);
  assert.ok(!r3.body.includes(MARKER));
  const r2 = await request("POST", "/api/..%2Fapi-x%2Fecho");
  assert.strictEqual(r2.status, 404, `módulo hermano devolvió ${r2.status}`);
  assert.ok(!fs.existsSync(path.join(TMP, "executed")), "se ejecutó un módulo fuera de api/");
});
