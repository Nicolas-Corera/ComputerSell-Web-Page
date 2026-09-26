// Regresión de products.cost / created_by: la tienda pide solo columnas
// públicas (la base ya no deja leer las otras: migración 0017) y el panel lee
// la fila completa con admin_products() y guarda con insert/update.
// La lista de PRODUCT_COLUMNS se valida contra la base en tests/db/cases/products_hide_cost.sql.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function walk(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".js") && e.name !== "env.js" ? [path.join(dir, e.name)] : [],
  );
}

test("[LOW] PRODUCT_COLUMNS no incluye cost ni created_by", () => {
  const m = read("assets/js/core/supabase.js").match(/export const PRODUCT_COLUMNS =([\s\S]*?);/);
  assert.ok(m, "no se encontró PRODUCT_COLUMNS");
  const cols = m[1].replace(/["+\s]/g, "").split(",");
  assert.ok(!cols.includes("cost") && !cols.includes("created_by"), cols.join(","));
  assert.ok(cols.includes("price") && cols.includes("stock"));
});

test("[LOW] CARD_COLUMNS (tarjetas) es un subconjunto de PRODUCT_COLUMNS", () => {
  const all = read("assets/js/core/supabase.js").match(/export const PRODUCT_COLUMNS =([\s\S]*?);/)[1].replace(/["+\s]/g, "").split(",");
  const m = read("assets/js/core/catalog.js").match(/export const CARD_COLUMNS =([\s\S]*?);/);
  assert.ok(m, "no se encontró CARD_COLUMNS");
  const cols = m[1].replace(/["+\s]/g, "").split(",");
  for (const c of cols) assert.ok(all.includes(c), `${c} no es una columna pública`);
  assert.ok(!cols.includes("description") && !cols.includes("specs"), "las tarjetas no deberían bajar descripción ni specs");
});

test("[LOW] la tienda no hace select('*') sobre products", () => {
  for (const f of walk("assets/js")) {
    assert.ok(!/from\(\s*["']products["']\s*\)\s*\.select\(\s*["']\*["']/.test(read(f)), `${f} pide select("*") de products`);
  }
});

test("[LOW] el panel lee productos con admin_products() y no usa upsert", () => {
  assert.match(read("dash/js/data.js"), /rpc\(\s*["']admin_products["']\s*\)/);
  assert.ok(!/from\(\s*["']products["']\s*\)\s*\.upsert\(/.test(read("dash/js/dashboard.js")), "dashboard.js sigue usando upsert en products");
});
