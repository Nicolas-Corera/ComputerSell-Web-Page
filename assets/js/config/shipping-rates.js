// Tarifas de envío · Correo Argentino, Encomienda Clásica.
//
// Correo Argentino actualiza los precios periódicamente: se cambian SOLO acá.
// Lo usan el checkout (navegador) y el backend que crea la orden
// (api/_lib/checkout.js), así que lo que ve el cliente es lo que se cobra.
//
// - "regional": CABA y Provincia de Buenos Aires (las de regionalProvinces).
// - "national": el resto del país.
// - El rango sale del peso total del pedido (suma de peso × cantidad).
//   Más pesado que el último rango: se arma en bultos de ese peso máximo.
// - Montos en pesos, sin decimales.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CS_SHIPPING_RATES = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return {
    // Tarifa regional y envío gratis (si el producto lo tiene activado).
    // Tienen que coincidir con las opciones del selector de provincia del checkout.
    regionalProvinces: ["CABA", "Buenos Aires"],

    ranges: [
      { maxKg: 1, regional: 19500, national: 26400 },
      { maxKg: 5, regional: 23100, national: 32000 },
      { maxKg: 10, regional: 31100, national: 45200 },
      { maxKg: 15, regional: 38200, national: 56600 },
      { maxKg: 20, regional: 45100, national: 65800 },
      { maxKg: 25, regional: 54200, national: 80900 },
    ],
  };
});
