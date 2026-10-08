// Utilidades compartidas por la tienda y el panel.
// Expone window.CS: formateo de precios, storage local, escape de HTML,
// registro de productos renderizados y la tarjeta de producto.

// Clicks declarados con data-* (no hay onclick="..." en el HTML: la Content
// Security Policy no permite JavaScript dentro del HTML, ver vercel.json)
//   data-href="/ruta"                              -> navega
//   data-carousel-target="id" data-carousel-dir="±1" -> mueve el carrusel
document.addEventListener("click", function (e) {
  const link = e.target.closest("[data-href]");
  if (link) {
    window.location.href = link.dataset.href;
    return;
  }
  const arrow = e.target.closest("[data-carousel-target]");
  if (arrow && typeof window.scrollCarousel === "function") {
    window.scrollCarousel(arrow.dataset.carouselTarget, Number(arrow.dataset.carouselDir) || 1);
  }
});

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
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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
          ${p.freeShipping ? `<span class="cardBadge-ship" title="Envío gratis a CABA y Provincia de Buenos Aires. Al resto del país se cobra según el peso."><svg aria-hidden="true"><use href="#ic-shipping_truck" /></svg>Envío gratis CABA y Bs. As.</span>` : ""}
        </a>
        <div class="textCard">
          <span>${escapeHtml(p.name)}</span>
          <div class="prices">
            ${p.oldPrice ? `<del class="dashed"><span class="sr-only">Precio anterior: </span>$${formatPrice(p.oldPrice)}</del>` : ""}
            <span class="priceNow"><span class="sr-only">${p.oldPrice ? "Precio actual: " : "Precio: "}</span>${formatPrice(p.price)}</span>
          </div>
          ${p.cuotas ? `<span class="cuotas">${escapeHtml(p.cuotas)}</span>` : ""}
        </div>
        <div class="actionsDestacados">
          <button class="btn btn-secondary" type="button" ${out ? "disabled" : ""}>
            <span>${out ? "Sin stock" : "Seleccionar"}</span>
          </button>
          <button class="btn btn-third" type="button" data-href="/detail.html?id=${escapeHtml(p.id)}" aria-label="Ver detalle">
            <svg class="ic-md"><use href="#ic-info" /></svg>
          </button>
          <button class="btn btn-third" type="button" aria-label="Agregar a favoritos" aria-pressed="false" data-fav>
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

  // Teléfono a 10 dígitos (descarta +54, el 9 y el 0 inicial). La
  // característica es de 2 dígitos en AMBA (11) y de 3 en el resto del país
  // (la mayoría): "11 2345-6789", "351 412-3456". Los dígitos nunca se pierden.
  function formatPhone(value) {
    let d = String(value || "").replace(/\D/g, "");
    if (d.length > 10 && d.startsWith("54")) d = d.slice(2);
    if (d.length > 10 && d.startsWith("9")) d = d.slice(1);
    if (d.startsWith("0")) d = d.slice(1);
    d = d.slice(0, 10);
    const area = d.startsWith("11") ? 2 : 3;
    if (d.length <= area) return d;
    const rest = d.slice(area);
    if (rest.length <= 4) return `${d.slice(0, area)} ${rest}`;
    return `${d.slice(0, area)} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  }

  // DNI de 7/8 dígitos -> "30.123.456"
  function formatDni(value) {
    const d = String(value || "").replace(/\D/g, "").slice(0, 8);
    return d.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }

  // Formatea mientras se escribe todo <input data-format="phone|dni">
  const FORMATS = { phone: formatPhone, dni: formatDni };
  document.addEventListener("input", (e) => {
    const fn = FORMATS[e.target.dataset && e.target.dataset.format];
    if (fn) e.target.value = fn(e.target.value);
  });

  return {
    formatPhone,
    formatDni,
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
