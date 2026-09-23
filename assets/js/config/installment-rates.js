// Recargo por cuotas con tarjeta de crédito (fracción: 0.2 = 20%).
//
// { cantidad de cuotas: recargo }. Solo se ofrecen estas cantidades (más 1
// cuota y las sin interés de los productos). Se aplica sobre el total que ya
// tiene el recargo por tarjeta (primero tarjeta, después cuotas).
//
// Las cuotas que entran en las "cuotas sin interés" de los productos del
// carrito (se configuran en el panel) no llevan este recargo.
//
// El checkout nunca muestra estos porcentajes: solo el valor de cada cuota
// y el total. Lo usan el checkout y el backend (api/_lib/checkout.js).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CS_INSTALLMENT_RATES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return {
    3: 0.11,
    6: 0.2,
    9: 0.3,
    12: 0.35,
  };
});
