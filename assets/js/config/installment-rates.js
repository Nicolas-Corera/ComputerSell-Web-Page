// Costos de Mercado Pago que compensa el recargo por cuotas (tarjeta de crédito).
//
// Se copian tal cual los muestra el simulador de costos de Mercado Pago
// (Checkout · Tarjeta de crédito · Cuotas sin interés · En el momento): el
// porcentaje SIN IVA, y el IVA aparte. Cuando MP cambie sus costos, se
// actualizan acá y listo.
//
// El recargo de cada cantidad de cuotas se calcula para que, después de lo
// que descuenta MP (costo por cobro + costo por ofrecer cuotas sin interés,
// ambos también sobre el recargo), recibas lo mismo que en 1 cuota:
//
//   total × (1 − cobro − cuotas) = total en 1 cuota × (1 − cobro)
//
// Solo se ofrecen las cantidades de cuotas que figuran en `installments`
// (más 1 cuota y las sin interés de los productos). Las cuotas que entran en
// las "cuotas sin interés" de los productos del carrito (panel) no llevan
// recargo. Se aplica sobre el total que ya tiene el recargo por tarjeta.
//
// El checkout nunca muestra estos porcentajes: solo el valor de cada cuota
// y el total. Lo usan el checkout y el backend (api/_lib/checkout.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CS_INSTALLMENT_RATES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return {
    iva: 0.21,

    // "Costo por cobro" (en el momento): 6,60% + IVA
    processing: 0.066,

    // "Costo por ofrecer cuotas sin interés" por cantidad de cuotas, + IVA
    installments: {
      3: 0.1049,
      6: 0.1869,
      9: 0.2649,
      12: 0.3229,
    },
  };
});
