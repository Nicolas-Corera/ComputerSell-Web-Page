// Webhook de Mercado Pago: validación de la firma x-signature (api/mp/webhook.js).
// Mercado Pago puede mandar el ts en segundos o en milisegundos; las dos formas
// deben aceptarse, y una firma vieja o con otra clave se rechaza (401).
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

process.env.VERCEL = "1"; // no leer el .env real
process.env.CLAVE_WEBHOOK = "clave-de-prueba";
process.env.SUPABASE_URL = "https://example.invalid";
const webhook = require("../../api/mp/webhook");

const sign = (id, ts, secret = "clave-de-prueba") =>
  crypto.createHmac("sha256", secret).update(`id:${id};ts:${ts};`).digest("hex");

// type=payment: el webhook valida la firma y lo ignora, sin llamar a Mercado Pago
async function call(ts, secret) {
  const id = "ord01abc";
  const req = {
    method: "POST",
    url: `/api/mp/webhook?data.id=${id}&type=payment`,
    headers: { "x-signature": `ts=${ts},v1=${sign(id, ts, secret)}` },
    body: {},
  };
  const out = {};
  const res = { setHeader() {}, end(b) { out.body = b; }, set statusCode(v) { out.status = v; } };
  await webhook(req, res);
  return out.status;
}

test("[HIGH] firma válida con ts en milisegundos se acepta", async () => {
  assert.strictEqual(await call(Date.now()), 200);
});

test("[HIGH] firma válida con ts en segundos se acepta", async () => {
  assert.strictEqual(await call(Math.floor(Date.now() / 1000)), 200);
});

test("[HIGH] firma vieja (más de 10 minutos) se rechaza, en segundos o milisegundos", async () => {
  const old = Date.now() - 60 * 60 * 1000;
  assert.strictEqual(await call(old), 401);
  assert.strictEqual(await call(Math.floor(old / 1000)), 401);
});

test("[HIGH] firma con otra clave se rechaza", async () => {
  assert.strictEqual(await call(Date.now(), "otra-clave"), 401);
});
