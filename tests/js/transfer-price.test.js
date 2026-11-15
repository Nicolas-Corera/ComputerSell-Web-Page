// Precio con transferencia (migración 0042): el cálculo del checkout usa el valor
// de transferencia solo cuando corresponde. La base lo repite en product_unit_price.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const pricing = require("../../assets/js/core/pricing.js");
const ROOT = path.join(__dirname, "..", "..");

const item = (o) => ({ price: 100000, qty: 1, weight: 1, weightUnit: "kg", freeShipping: true, installments: 0, ...o });

test("unitPrice: con transferencia usa el precio especial; con tarjeta o sin precio especial, el normal", () => {
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: 90000 }), "transferencia"), 90000);
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: 90000 }), "credito"), 100000);
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: 90000 }), "debito"), 100000);
  assert.strictEqual(pricing.unitPrice(item({}), "transferencia"), 100000);
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: 0 }), "transferencia"), 100000);
});

test("unitPrice: un precio con transferencia que no es menor se ignora", () => {
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: 100000 }), "transferencia"), 100000);
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: 150000 }), "transferencia"), 100000);
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: -5 }), "transferencia"), 100000);
  assert.strictEqual(pricing.unitPrice(item({ transferPrice: "x" }), "transferencia"), 100000);
});

test("quote: el subtotal por transferencia usa el precio especial y por tarjeta el normal", () => {
  const items = [item({ transferPrice: 90000, qty: 2 }), item({ price: 50000 })];
  const t = pricing.quote({ items, province: "CABA", method: "transferencia" });
  assert.strictEqual(t.subtotal, 90000 * 2 + 50000);
  assert.strictEqual(t.cardSurcharge, 0);
  const c = pricing.quote({ items, province: "CABA", method: "credito", installments: 1 });
  assert.strictEqual(c.subtotal, 100000 * 2 + 50000);
  assert.strictEqual(c.pending, true, "el recargo de tarjeta llega del servidor (card-pricing), no de este cálculo");
});

test("la base cobra lo mismo: place_order usa product_unit_price y la columna es pública", () => {
  const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/0042_precio_transferencia.sql"), "utf8");
  assert.match(sql, /transfer_price < price/);
  assert.match(sql, /grant select \(transfer_price\) on public\.products to anon, authenticated/);
  assert.strictEqual((sql.match(/product_unit_price\(v_prod\.price, v_prod\.transfer_price, p_payment_method\)/g) || []).length, 2, "subtotal y order_items");
  const fn = sql.match(/create or replace function public\.product_unit_price[\s\S]*?\$\$;/)[0];
  assert.match(fn, /p_method = 'transferencia'/);
});

test("el backend del checkout pide transfer_price y lo pasa al cálculo", () => {
  const src = fs.readFileSync(path.join(ROOT, "api/_lib/checkout.js"), "utf8");
  assert.match(src, /select=id,price,transfer_price,/);
  assert.match(src, /transferPrice: p\.transfer_price \|\| 0/);
});
