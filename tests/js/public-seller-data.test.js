// Regresión de datos del vendedor en archivos públicos: assets/, dash/, tienda/
// y 404.html se publican tal cual (scripts/build.js), así que no pueden tener
// CBU/CVU, CUIT/CUIL ni el nombre completo de quien vende. Esos datos salen de
// seller_private() (migración 0022), solo con sesión.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PUBLIC = ["assets", "dash", "tienda", "404.html"];

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(rel, e.name)) : /\.(html|js|css|txt|json|svg)$/.test(e.name) && e.name !== "env.js" ? [path.join(rel, e.name)] : [],
  );
}

test("[MEDIUM] los archivos públicos no tienen CBU/CVU ni CUIT/CUIL", () => {
  const bad = [];
  for (const f of PUBLIC.flatMap(walk)) {
    const txt = fs.readFileSync(path.join(ROOT, f), "utf8");
    // 22 dígitos seguidos (CBU/CVU) o CUIT/CUIL con o sin guiones
    const m = txt.match(/(?<![\w.#-])\d{22}(?![\w-])|\b(20|23|24|27|30|33|34)-?\d{8}-?\d\b/);
    if (m) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepStrictEqual(bad, []);
});

test("[MEDIUM] SELLER (público) no tiene nombre completo ni documento", () => {
  const src = fs.readFileSync(path.join(ROOT, "assets/js/config/seller.js"), "utf8");
  assert.ok(!/\b(owner|doc)\s*:/.test(src), "owner/doc tienen que salir de seller_private()");
});
