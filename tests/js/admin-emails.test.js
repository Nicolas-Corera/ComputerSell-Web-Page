// Regresión: los correos de admin no se publican (env.js) ni se leen de
// admin_allowlist desde el navegador. Corre scripts/build-env.js sobre una
// copia descartable con un .env FICTICIO.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");

test("[LOW] env.js no incluye ADMIN_EMAILS", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cs-buildenv-"));
  try {
    fs.cpSync(path.join(ROOT, "scripts"), path.join(tmp, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".env"), "SUPABASE_URL=https://dummy.supabase.co\nSUPABASE_ANON_KEY=dummy-anon\nPUBLIC_KEY=dummy-pk\nADMIN_EMAILS=secret-admin@example.test\n");
    execFileSync(process.execPath, [path.join(tmp, "scripts", "build-env.js")], { cwd: tmp, env: { PATH: process.env.PATH }, stdio: "pipe" });
    const out = fs.readFileSync(path.join(tmp, "assets", "js", "core", "env.js"), "utf8");
    assert.ok(!out.includes("secret-admin@example.test"), "env.js publica un correo de admin");
    assert.ok(!out.includes("ADMIN_EMAILS"), "env.js todavía tiene la clave ADMIN_EMAILS");
    assert.ok(out.includes("dummy-anon") && out.includes("dummy-pk"), "env.js perdió la configuración pública");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("[LOW] el alta del panel consulta is_admin_email en vez de leer admin_allowlist", () => {
  const src = fs.readFileSync(path.join(ROOT, "assets/js/pages/auth.js"), "utf8");
  assert.ok(!/from\(\s*["']admin_allowlist["']\s*\)/.test(src), "auth.js sigue leyendo la tabla admin_allowlist");
  assert.match(src, /rpc\(\s*["']is_admin_email["']/);
});
