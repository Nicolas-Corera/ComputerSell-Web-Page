// Regresión de headers de seguridad: vercel.json los manda en todas las rutas
// (tienda, panel y assets). Sin X-Frame-Options / frame-ancestors el panel se
// podía meter en un iframe de otro sitio (clickjacking).
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

test("[LOW] vercel.json manda los headers de seguridad en todas las rutas", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const all = (cfg.headers || []).find((h) => h.source === "/(.*)");
  assert.ok(all, "falta el bloque de headers para /(.*)");
  const h = Object.fromEntries(all.headers.map((x) => [x.key.toLowerCase(), x.value]));
  assert.strictEqual(h["x-content-type-options"], "nosniff");
  assert.strictEqual(h["x-frame-options"], "DENY");
  assert.match(h["content-security-policy"] || "", /frame-ancestors 'none'/);
  assert.ok(h["referrer-policy"], "falta Referrer-Policy");
  assert.match(h["strict-transport-security"] || "", /max-age=\d{8,}; includeSubDomains/);
  assert.strictEqual(h["cross-origin-opener-policy"], "same-origin");
});

test("[LOW] security.txt publicado (RFC 9116) y vigente", () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.ok(cfg.rewrites.some((r) => r.source === "/.well-known/security.txt"), "falta el rewrite de /.well-known/security.txt");
  const txt = fs.readFileSync(path.join(ROOT, "tienda/security.txt"), "utf8");
  assert.match(txt, /^Contact: mailto:/m);
  const exp = new Date(txt.match(/^Expires: (.+)$/m)[1]);
  assert.ok(exp > new Date(), "security.txt venció: actualizá Expires (máximo un año)");
});
