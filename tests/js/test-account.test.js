// Modo de prueba de las cuotas: solo se activa con credenciales de un usuario de
// prueba de Mercado Pago (api/_lib/mp.js -> isTestAccount). Con una cuenta real,
// o si Mercado Pago no responde, es siempre false: no puede quedar activado en producción.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");

process.env.VERCEL = "1"; // no leer el .env real
process.env.ACCESS_TOKEN = "token-de-prueba";

const MP = require.resolve("../../api/_lib/mp");
const realFetch = global.fetch;

// Módulo nuevo (la respuesta se guarda en memoria) con fetch simulado
async function withMp(reply, fn) {
  delete require.cache[MP];
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return reply();
  };
  try {
    return await fn(require(MP), () => calls);
  } finally {
    global.fetch = realFetch;
  }
}

const json = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test("[HIGH] usuario de prueba de Mercado Pago: modo de prueba activo (y se consulta una sola vez)", async () => {
  await withMp(
    () => json(200, { id: 1, tags: ["test_user", "normal"] }),
    async ({ isTestAccount }, calls) => {
      assert.strictEqual(await isTestAccount(), true);
      assert.strictEqual(await isTestAccount(), true);
      assert.strictEqual(calls(), 1);
    },
  );
});

test("[HIGH] cuenta real: el modo de prueba nunca se activa", async () => {
  await withMp(
    () => json(200, { id: 2, tags: ["normal", "mercadopago_cc_enabled"] }),
    async ({ isTestAccount }) => assert.strictEqual(await isTestAccount(), false),
  );
  await withMp(
    () => json(200, { id: 3 }),
    async ({ isTestAccount }) => assert.strictEqual(await isTestAccount(), false),
  );
});

test("[HIGH] si Mercado Pago falla o no responde, no se activa y se vuelve a consultar", async () => {
  await withMp(
    () => json(500, { error: "x" }),
    async ({ isTestAccount }, calls) => {
      assert.strictEqual(await isTestAccount(), false);
      assert.strictEqual(await isTestAccount(), false);
      assert.strictEqual(calls(), 2);
    },
  );
  await withMp(
    () => {
      throw new Error("red caída");
    },
    async ({ isTestAccount }) => assert.strictEqual(await isTestAccount(), false),
  );
});
