// Página de carrito: lista de ítems con cantidad, eliminar y resumen de compra.
// Se alimenta de window.CartStore (cart.js) y se re-renderiza en cada cambio.
(function () {
  const { formatPrice, escapeHtml } = window.CS;
  const store = window.CartStore;

  const list = document.getElementById("cartPageList");
  const layout = document.getElementById("cartPage");
  const empty = document.getElementById("cartEmpty");
  const countEl = document.getElementById("cartPageCount");
  const subtotalEl = document.getElementById("cartPageSubtotal");
  const totalEl = document.getElementById("cartPageTotal");
  const checkoutBtn = document.getElementById("cartCheckout");

  const ICON_TRASH =
    '<svg viewBox="0 -960 960 960"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>';

  function render() {
    const items = store.getItems();
    const qty = store.totalQty();
    const total = store.totalPrice();

    countEl.textContent =
      qty === 0
        ? "Todavía no agregaste productos"
        : `${qty} ${qty === 1 ? "producto" : "productos"}`;

    layout.hidden = items.length === 0;
    empty.hidden = items.length !== 0;
    if (items.length === 0) {
      list.innerHTML = "";
      return;
    }

    subtotalEl.textContent = formatPrice(total);
    totalEl.textContent = formatPrice(total);

    list.innerHTML = items
      .map(
        (it) => `
        <li class="cartRow" data-id="${escapeHtml(it.id)}">
          <div class="cartRow-img">
            ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" />` : ""}
          </div>
          <div class="cartRow-info">
            <span class="cartRow-name">${escapeHtml(it.name)}</span>
            <div class="prices">
              ${it.oldPrice ? `<span class="dashed">$${formatPrice(it.oldPrice)}</span>` : ""}
              <span class="priceNow">${formatPrice(it.price)}</span>
            </div>
            ${it.cuotas ? `<span class="cuotas">${escapeHtml(it.cuotas)}</span>` : ""}
          </div>
          <div class="cartRow-controls">
            <div class="qty-selector">
              <button type="button" data-action="dec" aria-label="Restar uno">−</button>
              <input type="text" value="${it.qty > 99 ? "99+" : it.qty}" readonly />
              <button type="button" data-action="inc" aria-label="Sumar uno">+</button>
            </div>
            <span class="cartRow-subtotal">${formatPrice(it.price * it.qty)}</span>
            <button type="button" class="cartRow-remove" data-action="remove" aria-label="Eliminar del carrito">${ICON_TRASH}</button>
          </div>
        </li>`,
      )
      .join("");
  }

  // Cantidad y eliminar (delegación: la lista se re-renderiza)
  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const row = btn.closest(".cartRow");
    const id = row.dataset.id;
    const item = store.getItems().find((it) => it.id === id);
    if (!item) return;

    if (btn.dataset.action === "inc") store.setQty(id, item.qty + 1);
    else if (btn.dataset.action === "dec") store.setQty(id, item.qty - 1);
    else if (btn.dataset.action === "remove") store.remove(id);
  });

  // Finalizar compra -> página de pago
  checkoutBtn.addEventListener("click", () => {
    window.location.href = "/pago.html";
  });

  store.onChange(render);
  render();
})();
