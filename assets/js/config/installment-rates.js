// Costos de Mercado Pago que cubre el recargo del pago con tarjeta.
//
// Se copian tal cual los muestra el simulador de costos de Mercado Pago
// (Checkout · Tarjeta de crédito · Cuotas sin interés · En el momento): el
// porcentaje SIN IVA, y el IVA aparte. Cuando MP cambie sus costos, se
// actualizan acá y listo.
//
// Con tarjeta, Mercado Pago se queda con un porcentaje de lo que paga el
// cliente: el costo por cobro más, si es en cuotas, el costo por ofrecer
// cuotas sin interés. Ese costo se trata como un costo más del producto, y
// sobre él va el margen del panel (api/_lib/card-pricing.js). El recargo
// resultante se muestra en el checkout como un solo renglón, nunca el %.
//
// Solo se ofrecen las cantidades de cuotas que figuran en `installments` y
// que no superan `maxInstallments`. Las cuotas que admite cada producto salen
// del check "cuotas sin interés" del panel. Lo usan el checkout y el backend
// (api/_lib/checkout.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CS_INSTALLMENT_RATES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return {
    iva: 0.21,

    // "Costo por cobro" (en el momento): 6,60% + IVA. También para débito
    // (hasta cargar el costo de débito del simulador).
    processing: 0.066,

    // "Costo por ofrecer cuotas sin interés" por cantidad de cuotas, + IVA
    installments: {
      3: 0.1049,
      6: 0.1869,
      9: 0.2649,
      12: 0.3229,
    },

    // Máximo de cuotas que se ofrece (aunque el producto admita más)
    maxInstallments: 6,
  };
});
