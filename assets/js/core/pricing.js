// Cálculo del total del checkout: envío + recargo por tarjeta + recargo por
// cuotas. Mismo código en el navegador (pago.js, como window.CSPricing) y en
// el backend (api/_lib/checkout.js, con require), así el total que se muestra
// es exactamente el que se cobra. Los valores están en assets/js/config/.
//
// Ítems: [{ price, qty, weight, weightUnit, freeShipping, installments }]
//   weight/weightUnit: peso del producto ("g" o "kg")
//   freeShipping: toggle "Envío gratis" del producto
//   installments: cuotas sin interés del producto (0 = no tiene)
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../config/shipping-rates.js"), require("../config/payment-rates.js"), require("../config/installment-rates.js"));
  } else {
    root.CSPricing = factory(root.CS_SHIPPING_RATES, root.CS_PAYMENT_RATES, root.CS_INSTALLMENT_RATES);
  }
})(typeof self !== "undefined" ? self : this, function (SHIPPING, PAYMENT, MP_FEES) {
  const qtyOf = (it) => Math.max(1, parseInt(it.qty, 10) || 1);
  // Máximo de cuotas que se ofrece: la mayor de la tabla de costos de MP (12)
  const MAX_INSTALLMENTS = Math.max(...Object.keys(MP_FEES.installments).map(Number));
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

  // Cuotas sin interés del pedido: las que admiten TODOS los productos (hasta el máximo)
  function freeInstallments(items) {
    if (!items.length) return 0;
    return Math.min(MAX_INSTALLMENTS, ...items.map((it) => parseInt(it.installments, 10) || 0));
  }

  // Cuotas que se ofrecen: todas hasta las sin interés del pedido y, por
  // encima, las que tienen recargo configurado
  function installmentOptions(freeMax) {
    const list = [1];
    for (let n = 2; n <= freeMax; n++) list.push(n);
    Object.keys(MP_FEES.installments)
      .map(Number)
      .sort((a, b) => a - b)
      .forEach((n) => n > freeMax && list.push(n));
    return list;
  }

  // Recargo de una cantidad de cuotas (0 si es sin interés, null si no se
  // ofrece). Compensa lo que cobra Mercado Pago: con el recargo, lo que queda
  // después de sus costos (que también se cobran sobre el recargo) es lo mismo
  // que en 1 cuota. total × (1 − cobro − cuotas) = base × (1 − cobro)
  function installmentRate(n, freeMax) {
    if (n <= 1 || n <= freeMax) return 0;
    const fee = MP_FEES.installments[n];
    if (fee == null) return null;
    const processing = MP_FEES.processing * (1 + MP_FEES.iva);
    const installments = fee * (1 + MP_FEES.iva);
    return (1 - processing) / (1 - processing - installments) - 1;
  }

  // Total en n cuotas a partir del total con recargo por tarjeta
  function installmentPlan(base, n, freeMax) {
    const rate = installmentRate(n, freeMax);
    if (rate === null) return null;
    const total = base + Math.round(base * rate);
    return { installments: n, total, each: Math.round(total / n), free: rate === 0 };
  }

  // Desglose completo. method: credito | debito | transferencia.
  // Las cuotas solo aplican a crédito. valid = false si las cuotas no se ofrecen.
  function quote({ items, province, method, installments }) {
    const pay = PAYMENT[method];
    if (!pay) throw new Error("Medio de pago inválido");
    const subtotal = items.reduce((sum, it) => sum + it.price * qtyOf(it), 0);
    const ship = shipping(items, province);
    const shippingCost = ship.cost || 0;
    const cardSurcharge = Math.round((subtotal + shippingCost) * pay.surcharge);
    const base = subtotal + shippingCost + cardSurcharge;
    const freeMax = freeInstallments(items);
    const n = method === "credito" ? Math.max(1, parseInt(installments, 10) || 1) : 1;
    const plan = installmentPlan(base, n, freeMax);
    const total = plan ? plan.total : base;
    return {
      subtotal,
      shipping: ship.cost, // null = falta la provincia
      shippingKg: ship.kg,
      cardSurcharge,
      base, // subtotal + envío + recargo por tarjeta
      installments: n,
      installmentSurcharge: total - base,
      total,
      freeInstallments: freeMax,
      valid: !!plan,
    };
  }

  return { PAYMENT, isRegional, shipping, freeInstallments, installmentOptions, installmentRate, installmentPlan, quote };
});
