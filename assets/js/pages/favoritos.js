// Página de favoritos: grilla con las mismas tarjetas de producto del sitio.
// Se alimenta de window.FavoritesStore (favorites.js). Los botones de las
// tarjetas (Seleccionar / info / corazón) ya los manejan cart.js y favorites.js.
(function () {
  const { formatPrice, escapeHtml } = window.CS;
  const store = window.FavoritesStore;

  const grid = document.getElementById("favGrid");
  const empty = document.getElementById("favEmpty");
  const countEl = document.getElementById("favPageCount");

  function cardTemplate(it) {
    return `
      <div class="itemDestacado">
        <div class="imageDestacado">
          ${it.image ? `<img src="${escapeHtml(it.image)}" alt="" />` : ""}
        </div>
        <div class="textCard">
          <span>${escapeHtml(it.name)}</span>
          <div class="prices">
            ${it.oldPrice ? `<span class="dashed">$${formatPrice(it.oldPrice)}</span>` : ""}
            <span class="priceNow">${formatPrice(it.price)}</span>
          </div>
          ${it.cuotas ? `<span class="cuotas">${escapeHtml(it.cuotas)}</span>` : ""}
        </div>
        <div class="actionsDestacados">
          <button class="btn btn-secondary">
            <span>Seleccionar</span>
          </button>
          <button
            class="btn btn-third"
            onclick="window.location.href = '/detail.html'"
          >
            <svg class="ic-md"><use href="#ic-info" /></svg>
          </button>
          <button class="btn btn-third">
            <svg class="ic-md">
              <use class="favorite-icon" href="#ic-favorite-fill" />
            </svg>
          </button>
        </div>
      </div>`;
  }

  function render() {
    const items = store.getItems();
    const n = items.length;

    countEl.textContent =
      n === 0
        ? "Todavía no guardaste productos"
        : `${n} ${n === 1 ? "producto guardado" : "productos guardados"}`;

    grid.hidden = n === 0;
    empty.hidden = n !== 0;

    grid.innerHTML = items.map(cardTemplate).join("");
    // Marca los corazones de las tarjetas recién insertadas
    if (window.syncFavorites) window.syncFavorites(grid);
  }

  // Al quitar un favorito desde su corazón, la tarjeta desaparece
  store.onChange(render);
  render();
})();
