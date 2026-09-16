// Utilidades compartidas por carrito y favoritos.
// Expone window.CS: formateo de precios, persistencia y lectura de productos desde el DOM.
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
    return String(str)
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

  // Tarjeta de producto (.itemDestacado): index, productos, relacionados, favoritos.
  // Mientras no haya IDs reales, el id es el nombre del producto.
  function readCardProduct(card) {
    if (!card) return null;
    const nameEl = card.querySelector(".textCard > span:first-child");
    const priceEl = card.querySelector(".priceNow");
    const oldEl = card.querySelector(".dashed");
    const cuotasEl = card.querySelector(".cuotas");
    const imgEl = card.querySelector(".imageDestacado img");
    if (!nameEl) return null;
    const name = nameEl.textContent.trim();
    return {
      id: name,
      name,
      price: priceEl ? parsePrice(priceEl.textContent) : 0,
      oldPrice: oldEl ? parsePrice(oldEl.textContent) : 0,
      cuotas: cuotasEl ? cuotasEl.textContent.trim() : "",
      image: imgEl ? imgEl.getAttribute("src") : "",
      qty: 1,
    };
  }

  // Ficha de producto (detail.html)
  function readDetailProduct() {
    const nameEl = document.querySelector(".product-info h1");
    const priceEl = document.querySelector(".price-block .priceNow");
    const oldEl = document.querySelector(".price-block .dashed");
    const cuotasEl = document.querySelector(".price-block .cuotas");
    const imgEl = document.getElementById("mainImage");
    const qtyEl = document.getElementById("qtyInput");
    if (!nameEl) return null;
    const name = nameEl.textContent.trim();
    return {
      id: name,
      name,
      price: priceEl ? parsePrice(priceEl.textContent) : 0,
      oldPrice: oldEl ? parsePrice(oldEl.textContent) : 0,
      cuotas: cuotasEl ? cuotasEl.textContent.trim() : "",
      image: imgEl ? imgEl.getAttribute("src") : "",
      qty: qtyEl ? parseInt(qtyEl.dataset.qty || qtyEl.value, 10) || 1 : 1,
    };
  }

  // Producto asociado a un botón (según esté en una tarjeta o en la ficha)
  function productForButton(btn) {
    return btn.closest(".product-info")
      ? readDetailProduct()
      : readCardProduct(btn.closest(".itemDestacado"));
  }

  return {
    parsePrice,
    formatPrice,
    escapeHtml,
    loadList,
    saveList,
    readCardProduct,
    readDetailProduct,
    productForButton,
  };
})();
