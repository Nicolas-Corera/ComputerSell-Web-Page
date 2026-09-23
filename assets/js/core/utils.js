// Utilidades compartidas por la tienda y el panel.
// Expone window.CS: formateo de precios, storage local, escape de HTML,
// registro de productos renderizados y la tarjeta de producto.
window.CS = (function () {
  // "1.304.424" -> 1304424
  function parsePrice(text) {
    const digits = String(text || "").replace(/[^\d]/g, "");
    return digits ? parseInt(digits, 10) : 0;
  }

  // 1304424 -> "1.304.424"
  function formatPrice(n) {
    return Number(n || 0).toLocaleString("es-AR");
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Persistencia simple en localStorage (devuelve [] si no hay nada o falla)
  function loadList(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveList(key, items) {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch (e) {
      /* storage no disponible: el estado vive solo en memoria */
    }
  }

  // Productos que están renderizados en la página (id -> datos de tarjeta).
  // Lo llenan las páginas al dibujar tarjetas o la ficha.
  const registry = {};
  function register(list) {
    (Array.isArray(list) ? list : [list]).forEach((p) => p && (registry[p.id] = p));
  }

  // Tarjeta de producto (.itemDestacado[data-id])
  function readCardProduct(card) {
    if (!card) return null;
    const p = registry[card.dataset.id];
    return p ? { ...p, qty: 1 } : null;
  }

  // Ficha de producto (detail.html): la cantidad elegida vive en #qtyInput
  function readDetailProduct() {
    const root = document.querySelector(".product-detail[data-id]");
    if (!root) return null;
    const p = registry[root.dataset.id];
    if (!p) return null;
    const qtyEl = document.getElementById("qtyInput");
    return { ...p, qty: qtyEl ? parseInt(qtyEl.dataset.qty || qtyEl.value, 10) || 1 : 1 };
  }

  // Producto asociado a un botón (según esté en una tarjeta o en la ficha)
  function productForButton(btn) {
    return btn.closest(".product-info") ? readDetailProduct() : readCardProduct(btn.closest(".itemDestacado"));
  }

  // HTML de la tarjeta de producto (misma en inicio, productos, favoritos, relacionados)
  function cardHtml(p, extraAttrs) {
    register(p);
    const out = p.stock <= 0;
    return `
      <div class="itemDestacado${out ? " is-out" : ""}" data-id="${escapeHtml(p.id)}" ${extraAttrs || ""}>
        <a class="imageDestacado" href="/detail.html?id=${escapeHtml(p.id)}">
          ${p.image ? `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" />` : ""}
          ${p.oldPrice ? `<span class="cardBadge-sale">${Math.round((1 - p.price / p.oldPrice) * 100)}% OFF</span>` : ""}
          ${out ? `<span class="cardBadge-out">Sin stock</span>` : ""}
          ${p.freeShipping ? `<span class="cardBadge-ship"><svg><use href="#ic-shipping_truck" /></svg>Envío gratis</span>` : ""}
        </a>
        <div class="textCard">
          <span>${escapeHtml(p.name)}</span>
          <div class="prices">
            ${p.oldPrice ? `<span class="dashed">$${formatPrice(p.oldPrice)}</span>` : ""}
            <span class="priceNow">${formatPrice(p.price)}</span>
          </div>
          ${p.cuotas ? `<span class="cuotas">${escapeHtml(p.cuotas)}</span>` : ""}
        </div>
        <div class="actionsDestacados">
          <button class="btn btn-secondary" type="button" ${out ? "disabled" : ""}>
            <span>${out ? "Sin stock" : "Seleccionar"}</span>
          </button>
          <button class="btn btn-third" type="button" onclick="window.location.href = '/detail.html?id=${escapeHtml(p.id)}'" aria-label="Ver detalle">
            <svg class="ic-md"><use href="#ic-info" /></svg>
          </button>
          <button class="btn btn-third" type="button" aria-label="Favorito">
            <svg class="ic-md"><use class="favorite-icon" href="#ic-favorite" /></svg>
          </button>
        </div>
      </div>`;
  }

  // Bloque "sin productos" para grillas y carruseles
  function emptyHtml(title, text, opts) {
    opts = opts || {};
    const action = opts.href
      ? `<a class="btn btn-secondary" href="${escapeHtml(opts.href)}">${escapeHtml(opts.label || "Ver productos")}</a>`
      : opts.buttonId
        ? `<button class="btn btn-secondary" type="button" id="${escapeHtml(opts.buttonId)}">${escapeHtml(opts.label || "Limpiar filtros")}</button>`
        : "";
    return `
      <div class="catalogEmpty">
        <svg><use href="#${escapeHtml(opts.icon || "ic-shopping_bag")}" /></svg>
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(text)}</p>
        ${action}
      </div>`;
  }

  // Aviso flotante simple (tienda)
  let toastEl;
  function toast(text, type) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "cs-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.className = "cs-toast is-visible" + (type ? " is-" + type : "");
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }

  return {
    parsePrice,
    formatPrice,
    escapeHtml,
    loadList,
    saveList,
    registry,
    register,
    readCardProduct,
    readDetailProduct,
    productForButton,
    cardHtml,
    emptyHtml,
    toast,
  };
})();
