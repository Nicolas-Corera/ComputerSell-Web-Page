// Política de envíos: completa la lógica del cálculo con la misma
// configuración que el checkout (config/shipping-rates.js + core/pricing.js).
// No muestra precios: esos solo los calcula el checkout.
//
//   [data-ship="regional"]  -> provincias con tarifa regional ("CABA y Buenos Aires")
//   [data-ship="maxKg"]     -> peso máximo por bulto ("25 kg")
//   #shippingExample        -> ejemplo de peso y rango con productos de ejemplo
(function () {
  const R = window.CS_SHIPPING_RATES;
  const P = window.CSPricing;
  if (!R || !P) return;
  const kg = (n) => n.toLocaleString("es-AR", { maximumFractionDigits: 3 }) + " kg";
  const list = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " y " + a[a.length - 1] : a[0] || "");
  const maxKg = R.ranges[R.ranges.length - 1].maxKg;
  // En la config (y el checkout) "Buenos Aires" es la provincia
  const PROVINCE_LABEL = { "Buenos Aires": "la Provincia de Buenos Aires" };

  document.querySelectorAll('[data-ship="regional"]').forEach((el) => (el.textContent = list(R.regionalProvinces.map((p) => PROVINCE_LABEL[p] || p))));
  document.querySelectorAll('[data-ship="maxKg"]').forEach((el) => (el.textContent = kg(maxKg)));

  // Rango de peso que se cobra ("hasta 10 kg"); por encima del máximo, bultos
  const rangeText = (w) => {
    if (w <= maxKg) return `rango de hasta ${kg(R.ranges.find((r) => w <= r.maxKg).maxKg)}`;
    const full = Math.floor(w / maxKg);
    const rest = Math.round((w - full * maxKg) * 1000) / 1000;
    const tail = rest > 0 ? ` + un bulto de ${kg(rest)} (rango de hasta ${kg(R.ranges.find((r) => rest <= r.maxKg).maxKg)})` : "";
    return `${full} bulto${full > 1 ? "s" : ""} de ${kg(maxKg)}${tail}`;
  };

  const ex = document.getElementById("shippingExample");
  if (ex) {
    const items = [
      { name: "Gabinete", price: 1, qty: 1, weight: 8, weightUnit: "kg", freeShipping: false },
      { name: "Mouse (con envío gratis)", price: 1, qty: 2, weight: 150, weightUnit: "g", freeShipping: true },
    ];
    const regional = R.regionalProvinces[0];
    const national = "Córdoba";
    const row = (dest, s) => `<tr><td data-label="Destino">${dest}</td><td data-label="Peso que se cobra">${kg(s.kg)}</td><td data-label="Tarifa">${s.cost === 0 ? "Gratis" : (s.regional ? "Regional" : "Nacional") + ", " + rangeText(s.kg)}</td></tr>`;
    ex.querySelector("tbody").innerHTML = row(regional, P.shipping(items, regional)) + row(national, P.shipping(items, national));
    const heavy = maxKg + 5;
    ex.querySelectorAll("[data-ship-heavy]").forEach((el) => (el.textContent = `${kg(heavy)} se cobra como ${rangeText(heavy)}`));
  }
})();
