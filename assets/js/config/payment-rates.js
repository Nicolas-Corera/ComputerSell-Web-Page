// Medios de pago del checkout. `card: true` = se cobra con tarjeta (Mercado
// Pago). El recargo de la tarjeta no es un porcentaje fijo: lo calcula el
// servidor con el costo de Mercado Pago y el margen de cada producto
// (api/_lib/card-pricing.js). La transferencia no tiene recargo.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CS_PAYMENT_RATES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return {
    credito: { label: "Tarjeta de crédito", card: true },
    debito: { label: "Tarjeta de débito", card: true },
    transferencia: { label: "Transferencia", card: false },
  };
});
