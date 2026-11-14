// Recargo del pago con tarjeta (solo servidor: usa el costo de cada producto,
// que el navegador nunca ve).
//
// Mercado Pago se queda con un porcentaje `f` de lo que paga el cliente (costo
// por cobro, más el costo de las cuotas sin interés si es en cuotas, con IVA).
// Ese porcentaje se trata como un costo más y sobre todo el costo va el MISMO
// margen que muestra el panel, medido sobre lo que paga el cliente:
//
//   total = costo / (1 − margen − f)
//
// Con envío (que se traslada al costo, sin margen, pero sobre el que Mercado
// Pago también cobra) y varios productos:
//
//   C = Σ costo × cantidad            (productos)
//   M = (subtotal − C) / subtotal     (margen de los productos del pedido)
//   total × (1 − f) − C − envío = M × (total − envío)
//   total = (C + envío × (1 − M)) / (1 − f − M)
//
// Un producto sin costo cargado (o con costo mayor al precio) no tiene margen:
// el recargo solo cubre lo que cobra Mercado Pago. El recargo nunca es menor a
// cero ni deja el total por debajo del de transferencia.
const rates = require("../../assets/js/config/installment-rates.js");
const pricing = require("../../assets/js/core/pricing.js");

// Piso del divisor: con un margen altísimo el total no se dispara
const MIN_DIVISOR = 0.2;

// Fracción de lo que paga el cliente que se queda Mercado Pago (null = esa
// cantidad de cuotas no está en la tabla de costos)
function feeRate(n) {
  const processing = rates.processing * (1 + rates.iva);
  if (n <= 1) return processing;
  const fee = rates.installments[n];
  if (fee == null) return null;
  return processing + fee * (1 + rates.iva);
}

// lines: [{ price, qty, cost }]. Devuelve el total con tarjeta en n cuotas.
function cardTotal({ lines, shipping, installments }) {
  const f = feeRate(installments);
  if (f == null) return null;
  const ship = Math.max(0, Number(shipping) || 0);
  let subtotal = 0;
  let cost = 0;
  lines.forEach((l) => {
    const qty = Math.max(1, parseInt(l.qty, 10) || 1);
    const price = Number(l.price) || 0;
    const c = Number(l.cost) > 0 ? Math.min(Number(l.cost), price) : price;
    subtotal += price * qty;
    cost += c * qty;
  });
  const margin = subtotal > 0 ? (subtotal - cost) / subtotal : 0;
  const divisor = Math.max(1 - f - margin, MIN_DIVISOR);
  const total = Math.round((cost + ship * (1 - margin)) / divisor);
  return Math.max(total, subtotal + ship);
}

// Recargo en pesos de cada opción: { credito: {1, 3, 6}, debito: {1} }
function surchargeTable({ lines, shipping }) {
  const subtotal = lines.reduce((sum, l) => sum + (Number(l.price) || 0) * Math.max(1, parseInt(l.qty, 10) || 1), 0);
  const transfer = subtotal + Math.max(0, Number(shipping) || 0);
  const surcharge = (n) => {
    const total = cardTotal({ lines, shipping, installments: n });
    return total == null ? null : total - transfer;
  };
  const table = { credito: {}, debito: {} };
  pricing.installmentOptions(rates.maxInstallments).forEach((n) => {
    const s = surcharge(n);
    if (s != null) table.credito[n] = s;
  });
  table.debito[1] = surcharge(1);
  return table;
}

module.exports = { feeRate, cardTotal, surchargeTable };
