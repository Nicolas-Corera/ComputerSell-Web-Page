// ---- Datos de ejemplo (mock). En producción vendrían del backend. ----
const orders = {
  48213: {
    title: "Pedido #48213",
    date: "12 ago 2026",
    status: "entregado", // confirmado | preparando | enviado | entregado | cancelado
    statusLabel: "Entregado",
    statusClass: "badge-ok",
    steps: {
      confirmado: "12 ago 2026",
      preparando: "13 ago 2026",
      enviado: "14 ago 2026",
      entregado: "16 ago 2026",
    },
    items: [
      {
        name: "PC Gamer Ryzen 5 5600 · RTX 4060 · 16GB",
        qty: 1,
        price: 1380000,
      },
      { name: "Mouse gamer RGB inalámbrico", qty: 1, price: 70000 },
    ],
    subtotal: 1450000,
    shipping: 0,
    discount: 0,
    total: 1450000,
    address: "Av. Siempre Viva 742, 3° B, C1000 · Buenos Aires, Argentina",
    payment: "Tarjeta de crédito · terminada en 4821 · 3 cuotas sin interés",
    invoice: "Factura A-0001-00048213 · Pagada",
  },
  47950: {
    title: "Pedido #47950",
    date: "30 ago 2026",
    status: "enviado",
    statusLabel: "En camino",
    statusClass: "badge-pending",
    steps: {
      confirmado: "30 ago 2026",
      preparando: "31 ago 2026",
      enviado: "01 sep 2026",
      entregado: null,
    },
    items: [
      { name: 'Notebook 15" i5 · 8GB · 512GB SSD', qty: 1, price: 980000 },
    ],
    subtotal: 980000,
    shipping: 0,
    discount: 0,
    total: 980000,
    address: "Av. Siempre Viva 742, 3° B, C1000 · Buenos Aires, Argentina",
    payment: "Mercado Pago · pago único",
    invoice: "Factura A-0001-00047950 · Enviada",
  },
  46102: {
    title: "Pedido #46102",
    date: "02 jul 2026",
    status: "entregado",
    statusLabel: "Entregado",
    statusClass: "badge-ok",
    steps: {
      confirmado: "02 jul 2026",
      preparando: "02 jul 2026",
      enviado: "03 jul 2026",
      entregado: "05 jul 2026",
    },
    items: [
      { name: "Teclado mecánico RGB", qty: 1, price: 95000 },
      { name: "Mouse gamer RGB inalámbrico", qty: 1, price: 70000 },
      { name: "Auriculares gamer 7.1", qty: 1, price: 45500 },
    ],
    subtotal: 210500,
    shipping: 0,
    discount: 0,
    total: 210500,
    address: "Av. Siempre Viva 742, 3° B, C1000 · Buenos Aires, Argentina",
    payment: "Tarjeta de débito",
    invoice: "Factura A-0001-00046102 · Pagada",
  },
};

const stepOrder = ["confirmado", "preparando", "enviado", "entregado"];
const stepMeta = {
  confirmado: { label: "Confirmado", icon: "#ic-check" },
  preparando: { label: "Preparando", icon: "#ic-package" },
  enviado: { label: "Enviado", icon: "#ic-shipping_truck" },
  entregado: { label: "Entregado", icon: "#ic-location" },
};

function money(n) {
  return Number(n || 0).toLocaleString("es-AR");
}

function getOrderId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id") || "48213";
}

function renderStepper(order) {
  const stepper = document.getElementById("stepper");
  stepper.innerHTML = "";

  if (order.status === "cancelado") {
    stepper.innerHTML = `
            <div class="step is-current">
              <div class="step-icon" style="border-color:#ff6b6b;color:#ff6b6b;background:var(--bg-2)">
                <svg class="ic-md"><use href="#ic-close"/></svg>
              </div>
              <div class="step-label">Pedido cancelado</div>
            </div>`;
    return;
  }

  const currentIndex = stepOrder.indexOf(order.status);

  stepOrder.forEach((key, i) => {
    const meta = stepMeta[key];
    const done = i < currentIndex || (i === currentIndex && order.steps[key]);
    const isCurrent = i === currentIndex;
    const cls = i < currentIndex ? "is-done" : isCurrent ? "is-current" : "";
    const date = order.steps[key];

    const el = document.createElement("div");
    el.className = `step ${cls}`;
    el.innerHTML = `
            <div class="step-icon">
              <svg class="ic-md"><use href="${meta.icon}"/></svg>
            </div>
            <div class="step-label">${meta.label}</div>
            <div class="step-date">${date ? date : "Pendiente"}</div>
          `;
    stepper.appendChild(el);
  });
}

function renderOrder(id) {
  const order = orders[id] || orders["48213"];

  document.getElementById("crumbOrderId").textContent = order.title;
  document.getElementById("orderTitle").textContent = order.title;
  document.getElementById("orderSub").textContent =
    "Realizado el " + order.date;

  const badge = document.getElementById("orderBadge");
  badge.textContent = order.statusLabel;
  badge.className = "badge " + order.statusClass;
  badge.style.marginLeft = "10px";
  badge.style.verticalAlign = "middle";

  renderStepper(order);

  const itemsList = document.getElementById("itemsList");
  itemsList.innerHTML = "";
  order.items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
            <div class="item-thumb">
              <svg class="ic-md"><use href="#ic-shopping_bag"/></svg>
            </div>
            <div class="item-info">
              <strong>${item.name}</strong>
              <span class="item-qty">Cantidad: ${item.qty}</span>
            </div>
            <div class="item-price">${money(item.price)}</div>
          `;
    itemsList.appendChild(row);
  });

  document.getElementById("sumSubtotal").textContent = money(order.subtotal);
  document.getElementById("sumShipping").textContent = order.shipping
    ? money(order.shipping)
    : "Gratis";
  document.getElementById("sumDiscount").textContent = order.discount
    ? "-" + money(order.discount)
    : "0";
  document.getElementById("sumTotal").textContent = money(order.total);

  document.getElementById("shipAddress").textContent = order.address;
  document.getElementById("payMethod").textContent = order.payment;
}

document.getElementById("footerYear").textContent = new Date().getFullYear();

const orderId = getOrderId();
renderOrder(orderId);

document.getElementById("downloadInvoiceBtn").addEventListener("click", () => {
  window.location.href = `/perfil.html#facturas`;
});
