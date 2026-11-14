// Cálculo del total del checkout: envío + recargo del pago con tarjeta. Mismo
// código en el navegador (pago.js, como window.CSPricing) y en el backend
// (api/_lib/checkout.js, con require). Las tarifas están en assets/js/config/.
//
// El recargo de la tarjeta NO se calcula acá: depende del costo y del margen de
// cada producto, que el navegador nunca ve. Lo calcula el servidor
// (api/_lib/card-pricing.js) y llega como `card`:
//   { credito: { 1: recargo, 3: recargo, 6: recargo }, debito: { 1: recargo } }
// (recargo en pesos sobre el total de productos + envío). Sin `card` el total
// con tarjeta todavía no se conoce (pending).
//
// Ítems: [{ price, qty, weight, weightUnit, freeShipping, installments }]
//   weight/weightUnit: peso del producto ("g" o "kg")
//   freeShipping: toggle "Envío gratis" del producto
//   installments: cuotas que admite el producto (0 = solo 1 pago)
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../config/shipping-rates.js"), require("../config/payment-rates.js"), require("../config/installment-rates.js"));
  } else {
    root.CSPricing = factory(root.CS_SHIPPING_RATES, root.CS_PAYMENT_RATES, root.CS_INSTALLMENT_RATES);
  }
})(typeof self !== "undefined" ? self : this, function (SHIPPING, PAYMENT, MP_FEES) {
  const qtyOf = (it) => Math.max(1, parseInt(it.qty, 10) || 1);
  // Máximo de cuotas que se ofrece (config)
  const MAX_INSTALLMENTS = MP_FEES.maxInstallments;
  const toKg = (weight, unit) => (Number(weight) || 0) / (unit === "g" ? 1000 : 1);

  function isRegional(province) {
    return SHIPPING.regionalProvinces.includes(province);
  }

  // Tarifa por peso. Si supera el último rango se arma en bultos de ese peso.
  function rateForWeight(kg, zone) {
    const ranges = SHIPPING.ranges;
    const last = ranges[ranges.length - 1];
    let cost = 0;
    let rest = kg;
    while (rest > last.maxKg) {
      cost += last[zone];
      rest = Math.round((rest - last.maxKg) * 1000) / 1000;
    }
    return cost + ranges.find((r) => rest <= r.maxKg)[zone];
  }

  // Envío del pedido según la provincia. cost = null si todavía no se eligió.
  // En CABA / Buenos Aires los productos con envío gratis no suman peso (si
  // todos lo tienen, el envío es gratis); en el resto del país suman todos.
  function shipping(items, province) {
    if (!province) return { cost: null, kg: 0, regional: false };
    const regional = isRegional(province);
    const paid = regional ? items.filter((it) => !it.freeShipping) : items;
    if (!paid.length) return { cost: 0, kg: 0, regional };
    const kg = Math.round(paid.reduce((sum, it) => sum + toKg(it.weight, it.weightUnit) * qtyOf(it), 0) * 1000) / 1000;
    return { cost: rateForWeight(kg, regional ? "regional" : "national"), kg, regional };
  }

  // Cuotas máximas del pedido: las que admiten TODOS los productos (con tope)
  function maxInstallments(items) {
    if (!items.length) return 0;
    return Math.min(MAX_INSTALLMENTS, ...items.map((it) => parseInt(it.installments, 10) || 0));
  }

  // Cuotas que se ofrecen: 1 pago y las de la tabla de costos de Mercado Pago
  // hasta el máximo del pedido
  function installmentOptions(max) {
    const list = [1];
    Object.keys(MP_FEES.installments)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((n) => n <= max && n <= MAX_INSTALLMENTS && list.push(n));
    return list;
  }

  // Desglose completo. method: credito | debito | transferencia.
  // Las cuotas solo aplican a crédito. valid = false si las cuotas no se ofrecen.
  // pending = true si es con tarjeta y todavía no llegó el recargo del servidor.
  function quote({ items, province, method, installments, card }) {
    const pay = PAYMENT[method];
    if (!pay) throw new Error("Medio de pago inválido");
    const subtotal = items.reduce((sum, it) => sum + it.price * qtyOf(it), 0);
    const ship = shipping(items, province);
    const shippingCost = ship.cost || 0;
    const transferTotal = subtotal + shippingCost;
    const max = maxInstallments(items);
    const n = method === "credito" ? Math.max(1, parseInt(installments, 10) || 1) : 1;

    let valid = installmentOptions(max).includes(n);
    let cardSurcharge = 0;
    let pending = false;
    if (pay.card) {
      const s = card && card[method] ? card[method][n] : undefined;
      if (Number.isInteger(s) && s >= 0) cardSurcharge = s;
      else pending = true;
    }
    // Monto de referencia para pedirle a Mercado Pago los planes de cuotas del
    // BIN: el total con tarjeta de crédito en 1 pago
    const credit1 = card && card.credito ? card.credito[1] : undefined;
    const base = transferTotal + (Number.isInteger(credit1) ? credit1 : 0);
    return {
      subtotal,
      shipping: ship.cost, // null = falta la provincia
      shippingKg: ship.kg,
      transferTotal, // productos + envío, sin recargo
      cardSurcharge,
      base,
      installments: n,
      total: transferTotal + cardSurcharge,
      maxInstallments: max,
      pending,
      valid,
    };
  }

  return { PAYMENT, PROVINCES: SHIPPING.provinces, isRegional, shipping, maxInstallments, installmentOptions, quote };
});
