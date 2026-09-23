// Recargo por medio de pago (fracción: 0.1 = 10%).
//
// Se aplica sobre subtotal de productos + envío. Lo usan el checkout
// (navegador) y el backend que crea la orden (api/_lib/checkout.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CS_PAYMENT_RATES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return {
    credito: { label: "Tarjeta de crédito", surcharge: 0.1, card: true },
    debito: { label: "Tarjeta de débito", surcharge: 0.1, card: true },
    transferencia: { label: "Transferencia", surcharge: 0, card: false },
  };
});
