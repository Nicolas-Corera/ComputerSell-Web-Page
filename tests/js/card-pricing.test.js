// Recargo del pago con tarjeta: el margen del panel se mantiene sobre lo que
// paga el cliente, descontando lo que cobra Mercado Pago (api/_lib/card-pricing.js).
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const { feeRate, cardTotal, surchargeTable } = require("../../api/_lib/card-pricing");
const pricing = require("../../assets/js/core/pricing.js");
const rates = require("../../assets/js/config/installment-rates.js");

const line = { price: 1500000, qty: 1, cost: 1000000 }; // margen 33,3%

// Ganancia real: lo que cobra Mercado Pago ya descontado, menos costo y envío
function profit(lines, shipping, n, total) {
  const cost = lines.reduce((s, l) => s + (l.cost > 0 ? Math.min(l.cost, l.price) : l.price) * l.qty, 0);
  return total * (1 - feeRate(n)) - cost - shipping;
}

test("el margen del panel se mantiene sobre lo que paga el cliente en 1, 3 y 6 cuotas", () => {
  for (const n of [1, 3, 6]) {
    const total = cardTotal({ lines: [line], shipping: 0, installments: n });
    const margin = profit([line], 0, n, total) / total;
    assert.ok(Math.abs(margin - 1 / 3) < 0.0005, `${n} cuotas: margen ${margin}`);
  }
});

test("ejemplo: $1.500.000 con costo $1.000.000 en 1 cuota paga $1.704.139", () => {
  assert.strictEqual(cardTotal({ lines: [line], shipping: 0, installments: 1 }), 1704139);
});

test("con envío: Mercado Pago también cobra sobre el envío, que se traslada sin margen", () => {
  const total = cardTotal({ lines: [line], shipping: 8000, installments: 1 });
  const productsPart = total - 8000;
  const margin = profit([line], 8000, 1, total) / productsPart;
  assert.ok(Math.abs(margin - 1 / 3) < 0.0005, `margen ${margin}`);
});

test("sin costo cargado solo se compensa lo que cobra Mercado Pago", () => {
  const total = cardTotal({ lines: [{ price: 1500000, qty: 1, cost: 0 }], shipping: 0, installments: 1 });
  assert.strictEqual(total, Math.round(1500000 / (1 - feeRate(1))));
  // costo mayor al precio: igual, sin margen negativo
  assert.strictEqual(cardTotal({ lines: [{ price: 1500000, qty: 1, cost: 2000000 }], shipping: 0, installments: 1 }), total);
});

test("varios productos: el margen es el del pedido", () => {
  const lines = [
    { price: 1000000, qty: 1, cost: 800000 }, // 20%
    { price: 500000, qty: 2, cost: 250000 }, // 50%
  ];
  const total = cardTotal({ lines, shipping: 0, installments: 3 });
  const subtotal = 2000000;
  const cost = 800000 + 500000;
  const m = (subtotal - cost) / subtotal;
  assert.ok(Math.abs(profit(lines, 0, 3, total) / total - m) < 0.0005);
});

test("la tabla ofrece crédito en 1, 3 y 6 cuotas (máximo 6) y débito en 1; el recargo nunca es negativo", () => {
  const t = surchargeTable({ lines: [line], shipping: 0 });
  assert.deepStrictEqual(Object.keys(t.credito).map(Number), [1, 3, 6]);
  assert.deepStrictEqual(Object.keys(t.debito).map(Number), [1]);
  Object.values(t.credito).forEach((s) => assert.ok(s > 0));
  assert.ok(t.credito[6] > t.credito[3] && t.credito[3] > t.credito[1]);
  assert.strictEqual(rates.maxInstallments, 6);
});

test("un margen enorme no dispara el total (piso del divisor)", () => {
  const total = cardTotal({ lines: [{ price: 1000000, qty: 1, cost: 10000 }], shipping: 0, installments: 6 });
  assert.ok(total <= 1000000 * 10, `total ${total}`);
});

test("pricing.quote: sin recargo del servidor el total con tarjeta queda pendiente", () => {
  const items = [{ price: 1500000, qty: 1, weight: 1, weightUnit: "kg", freeShipping: true, installments: 6 }];
  const q = pricing.quote({ items, province: "CABA", method: "credito", installments: 3 });
  assert.strictEqual(q.pending, true);
  const t = surchargeTable({ lines: [line], shipping: 0 });
  const ok = pricing.quote({ items, province: "CABA", method: "credito", installments: 3, card: t });
  assert.strictEqual(ok.pending, false);
  assert.strictEqual(ok.total, 1500000 + t.credito[3]);
  assert.strictEqual(ok.valid, true);
});

test("pricing.quote: cuotas fuera de lo que admite el pedido no son válidas; transferencia sin recargo", () => {
  const free = { price: 1500000, qty: 1, weight: 1, weightUnit: "kg", freeShipping: true };
  const t = surchargeTable({ lines: [line], shipping: 0 });
  // el producto admite 3: 6 cuotas no vale
  assert.strictEqual(pricing.quote({ items: [{ ...free, installments: 3 }], province: "CABA", method: "credito", installments: 6, card: t }).valid, false);
  // el producto no admite cuotas: solo 1 pago
  assert.deepStrictEqual(pricing.installmentOptions(pricing.maxInstallments([{ ...free, installments: 0 }])), [1]);
  // el producto admite 12: se ofrece hasta 6
  assert.deepStrictEqual(pricing.installmentOptions(pricing.maxInstallments([{ ...free, installments: 12 }])), [1, 3, 6]);
  const tr = pricing.quote({ items: [{ ...free, installments: 3 }], province: "CABA", method: "transferencia", card: t });
  assert.strictEqual(tr.cardSurcharge, 0);
  assert.strictEqual(tr.total, 1500000);
});
