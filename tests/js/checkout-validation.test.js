// Validación del backend del checkout (api/_lib/checkout.js y api/_lib/mp.js):
// un pedido sin dirección/teléfono/DNI, con una provincia inventada, con
// cantidades fuera de rango o con un body roto no tiene que llegar a la base.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const { Readable } = require("stream");
const { parseCustomer, parseItems } = require("../../api/_lib/checkout");
const { readJson, HttpError } = require("../../api/_lib/mp");

const UUID = "0c340438-9df5-4a49-9c77-d47d0b9a0521";
const valid = () => ({
  customer: { name: "Juan Pérez", email: "juan@example.com", phone: "11 2345-6789", dni: "30.123.456" },
  address: { calle: "Av. Siempre Viva", numero: "742", piso: "", cp: "1425", ciudad: "CABA", provincia: "CABA" },
});
const rejects = (fn, re) =>
  assert.throws(fn, (e) => e instanceof HttpError && e.status === 400 && (!re || re.test(e.message)));

test("[HIGH] un pedido sin dirección, teléfono o DNI se rechaza", () => {
  for (const field of ["calle", "numero", "cp", "ciudad"]) {
    const b = valid();
    b.address[field] = "";
    rejects(() => parseCustomer(b, { email: "x@y.com" }));
  }
  for (const field of ["phone", "dni", "name"]) {
    const b = valid();
    b.customer[field] = "";
    rejects(() => parseCustomer(b, { email: "x@y.com" }));
  }
});

test("[HIGH] la provincia tiene que ser una de las del checkout", () => {
  const b = valid();
  b.address.provincia = "Tierra Media";
  rejects(() => parseCustomer(b, {}), /provincia/i);
});

test("[MEDIUM] código postal, número y teléfono con formatos inválidos", () => {
  const cases = [
    ["address", "cp", "abc"],
    ["address", "numero", "-5"],
    ["customer", "phone", "<script>"],
    ["customer", "dni", "12"],
    ["customer", "email", "a@b"],
  ];
  for (const [group, key, value] of cases) {
    const b = valid();
    b[group][key] = value;
    rejects(() => parseCustomer(b, {}));
  }
});

test("[LOW] un pedido válido arma la dirección para el despacho", () => {
  const { customer } = parseCustomer(valid(), {});
  assert.strictEqual(customer.address, "Av. Siempre Viva 742, 1425, CABA, CABA");
  assert.strictEqual(customer.province, "CABA");
  // CP con el formato nuevo (CPA)
  const b = valid();
  b.address.cp = "C1425ABC";
  assert.doesNotThrow(() => parseCustomer(b, {}));
});

test("[HIGH] cantidades: enteras, positivas y con tope por producto", () => {
  assert.deepStrictEqual(parseItems([{ product_id: UUID, qty: 2 }, { product_id: UUID, qty: 3 }]), [{ product_id: UUID, qty: 5 }]);
  rejects(() => parseItems([{ product_id: UUID, qty: 2.5 }]));
  rejects(() => parseItems([{ product_id: UUID, qty: -1 }]));
  rejects(() => parseItems([{ product_id: UUID, qty: 6000000000000000 }]));
  rejects(() => parseItems([{ product_id: UUID, qty: 11 }]), /hasta 10/);
  rejects(() => parseItems([{ product_id: "no-es-un-uuid", qty: 1 }]), /vacío/);
});

test("[MEDIUM] body JSON roto o que no es un objeto -> 400 (no 500)", async () => {
  const req = (raw) => Object.assign(Readable.from([Buffer.from(raw)]), { body: undefined });
  for (const raw of ["{roto", "null", "[1,2]", '"texto"']) {
    await assert.rejects(readJson(req(raw)), (e) => e instanceof HttpError && e.status === 400);
  }
  assert.deepStrictEqual(await readJson(req('{"a":1}')), { a: 1 });
  assert.deepStrictEqual(await readJson(req("")), {});
});
