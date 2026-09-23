// Política de venta: recargos y ejemplo de cuotas con las mismas tarifas y
// el mismo cálculo que el checkout (assets/js/config/*.js + core/pricing.js),
// así el texto nunca queda desactualizado respecto de lo que se cobra.
//
//   [data-rate="credito"|"debito"]  -> recargo por medio de pago ("10%")
//   #installmentRates tbody          -> recargo por financiación de cada cuota
//   #installmentExample              -> ejemplo: data-price (precio del producto)
//                                       y data-free (cuotas sin interés del producto)
(function () {
  const P = window.CSPricing;
  if (!P) return;
  const pct = (n) => Math.round(n * 1000) / 10 + "%";
  const money = (n) => "$" + Number(n).toLocaleString("es-AR");

  document.querySelectorAll("[data-rate]").forEach((el) => {
    const pay = P.PAYMENT[el.dataset.rate];
    if (pay) el.textContent = pct(pay.surcharge);
  });

  const rates = document.querySelector("#installmentRates tbody");
  if (rates) {
    rates.innerHTML = P.installmentOptions(0)
      .filter((n) => n > 1)
      .map((n) => `<tr><td data-label="Cuotas">${n}</td><td data-label="Recargo">${pct(P.installmentRate(n, 0))}</td></tr>`)
      .join("");
  }

  const ex = document.getElementById("installmentExample");
  if (ex) {
    const price = +ex.dataset.price;
    const free = +ex.dataset.free;
    // Producto con envío gratis en CABA: el ejemplo no depende de la tarifa de envío
    const item = { price, qty: 1, weight: 0, weightUnit: "kg", freeShipping: true, installments: free };
    const row = (label, q, each) =>
      `<tr><td data-label="Opción">${label}</td><td data-label="Cada cuota">${each}</td><td data-label="Total">${money(q.total)}</td></tr>`;
    const transfer = P.quote({ items: [item], province: "CABA", method: "transferencia" });
    const out = [row("Transferencia", transfer, "—")];
    P.installmentOptions(free).forEach((n) => {
      const q = P.quote({ items: [item], province: "CABA", method: "credito", installments: n });
      if (!q.valid) return;
      const plan = P.installmentPlan(q.base, n, free);
      const label = n === 1 ? "Crédito en 1 pago" : `Crédito en ${n} cuotas${plan.free ? " sin interés" : ""}`;
      out.push(row(label, q, n === 1 ? "—" : money(plan.each)));
    });
    ex.querySelector("tbody").innerHTML = out.join("");
    ex.querySelectorAll("[data-example-price]").forEach((el) => (el.textContent = money(price)));
  }
})();
