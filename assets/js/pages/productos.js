// Página de productos: filtros, búsqueda, orden y contador de resultados.
// Versión estática: filtra las tarjetas que ya están en el HTML usando sus
// data-* (data-category, data-type, data-brand, data-stock, data-shipping, data-sale).
(function initProductFilters() {
  const aside = document.getElementById("filtersAside");
  const backdrop = document.getElementById("filtersBackdrop");
  const openBtn = document.getElementById("filtersToggle");
  const closeBtn = document.getElementById("filtersClose");
  const activeFilters = document.getElementById("activeFilters");
  const clearAllBtn = document.getElementById("clearAllFilters");
  const filterCount = document.getElementById("filterCount");
  const grid = document.getElementById("productsGrid");
  const emptyState = document.getElementById("productsEmpty");
  const emptyClearBtn = document.getElementById("productsEmptyClear");
  const resultsCount = document.getElementById("resultsCount");
  const searchInput = document.getElementById("searchProducts");
  const sortSelect = document.getElementById("sortProducts");
  const priceMin = document.getElementById("priceMin");
  const priceMax = document.getElementById("priceMax");
  const applyPriceBtn = document.getElementById("applyPrice");
  if (!aside || !grid) return;

  const { parsePrice, formatPrice } = window.CS;

  // "Categoría" -> "categoria", "Envío" -> "envio"
  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  // "Placas de video" -> "placas-de-video" (mismo formato que data-type y ?tipo=)
  const slugify = (s) => normalize(s).replace(/\s+/g, "-");

  // Grupos de subcategorías: la clave es la categoría a la que pertenecen
  const SUBGROUPS = ["componentes", "perifericos"];

  // Opciones de "Disponibilidad" -> atributo data-* de la tarjeta
  const AVAILABILITY = {
    "en stock": "stock",
    "con envio gratis": "shipping",
    "en oferta": "sale",
  };

  // Tarjetas con sus datos precalculados (orden original = relevancia)
  const cards = Array.from(grid.querySelectorAll(".itemDestacado")).map(
    (el, index) => ({
      el,
      index,
      name: normalize(el.querySelector(".textCard > span:first-child").textContent),
      price: parsePrice(el.querySelector(".priceNow").textContent),
      category: normalize(el.dataset.category),
      type: normalize(el.dataset.type),
      brands: normalize(el.dataset.brand).split(/\s+/).filter(Boolean),
      stock: el.dataset.stock === "1",
      shipping: el.dataset.shipping === "1",
      sale: el.dataset.sale === "1",
      order: parseInt(el.dataset.order, 10) || index + 1,
    }),
  );

  const checkboxes = Array.from(
    aside.querySelectorAll('input[type="checkbox"][data-filter-group]'),
  );

  // Subgrupos (Componentes / Periféricos): visibles solo con su categoría marcada
  const subGroups = Array.from(aside.querySelectorAll(".filterGroup[data-parent]"));

  // Rango de precio aplicado (solo cambia con "Aplicar")
  const priceRange = { min: null, max: null };

  // ---------- Acordeón y panel mobile ----------
  aside.querySelectorAll(".filterGroup-head").forEach((head) => {
    head.addEventListener("click", () => {
      head.closest(".filterGroup").classList.toggle("is-collapsed");
    });
  });

  function openAside() {
    aside.classList.add("is-open");
    backdrop.classList.add("is-open");
  }
  function closeAside() {
    aside.classList.remove("is-open");
    backdrop.classList.remove("is-open");
  }
  if (openBtn) openBtn.addEventListener("click", openAside);
  if (closeBtn) closeBtn.addEventListener("click", closeAside);
  if (backdrop) backdrop.addEventListener("click", closeAside);

  // ---------- Contadores por opción (cuántos productos tiene cada filtro) ----------
  function matchesOption(card, input) {
    const group = normalize(input.dataset.filterGroup);
    const label = normalize(input.dataset.filterLabel);
    if (group === "categoria") return card.category === label;
    if (SUBGROUPS.includes(group)) {
      return card.category === group && card.type === slugify(label);
    }
    if (group === "marca") return card.brands.includes(label);
    if (group === "disponibilidad") return !!card[AVAILABILITY[label]];
    return false;
  }

  checkboxes.forEach((input) => {
    const countEl = input.closest(".checkOption")?.querySelector(".count");
    if (countEl) {
      countEl.textContent = cards.filter((c) => matchesOption(c, input)).length;
    }
  });

  // ---------- Filtrado ----------
  function readChecked() {
    const state = {
      categoria: [],
      componentes: [],
      perifericos: [],
      marca: [],
      disponibilidad: [],
    };
    checkboxes.forEach((input) => {
      if (!input.checked) return;
      const group = normalize(input.dataset.filterGroup);
      if (!state[group]) return;
      const label = input.dataset.filterLabel;
      state[group].push(SUBGROUPS.includes(group) ? slugify(label) : normalize(label));
    });
    return state;
  }

  function cardPasses(card, state, query) {
    // Categoría y Marca: OR dentro del grupo. Disponibilidad: todas las marcadas.
    if (state.categoria.length && !state.categoria.includes(card.category)) {
      return false;
    }
    // Subcategoría: solo restringe a las tarjetas de esa categoría (OR dentro del grupo)
    const types = state[card.category];
    if (types && types.length && !types.includes(card.type)) return false;
    if (
      state.marca.length &&
      !state.marca.some((brand) => card.brands.includes(brand))
    ) {
      return false;
    }
    if (state.disponibilidad.some((label) => !card[AVAILABILITY[label]])) {
      return false;
    }
    if (priceRange.min !== null && card.price < priceRange.min) return false;
    if (priceRange.max !== null && card.price > priceRange.max) return false;
    if (query && !card.name.includes(query)) return false;
    return true;
  }

  function sortCards(list) {
    const mode = sortSelect ? sortSelect.value : "relevancia";
    const sorted = list.slice();
    if (mode === "menor-precio") sorted.sort((a, b) => a.price - b.price);
    else if (mode === "mayor-precio") sorted.sort((a, b) => b.price - a.price);
    else if (mode === "novedades") sorted.sort((a, b) => b.order - a.order);
    else sorted.sort((a, b) => a.index - b.index);
    return sorted;
  }

  function applyFilters() {
    const state = readChecked();
    const query = normalize(searchInput ? searchInput.value : "");

    const visible = cards.filter((card) => cardPasses(card, state, query));
    cards.forEach((card) => {
      card.el.hidden = !visible.includes(card);
    });

    // Reordenar en el DOM según el select
    sortCards(visible).forEach((card) => grid.appendChild(card.el));

    if (resultsCount) {
      const n = visible.length;
      resultsCount.innerHTML = `<strong>${n}</strong> ${
        n === 1 ? "producto encontrado" : "productos encontrados"
      }`;
    }
    if (emptyState) emptyState.hidden = visible.length > 0;
    grid.hidden = visible.length === 0;
  }

  // ---------- Tags de filtros activos ----------
  function makeTag(text, onRemove) {
    const tag = document.createElement("span");
    tag.className = "filterTag";

    const label = document.createElement("span");
    label.textContent = text;
    tag.appendChild(label);

    const removeBtn = document.createElement("button");
    removeBtn.className = "filterTag-remove";
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Quitar filtro ${text}`);
    removeBtn.innerHTML = `<svg class="ic-sm"><use href="#ic-close"/></svg>`;
    removeBtn.addEventListener("click", onRemove);
    tag.appendChild(removeBtn);

    activeFilters.insertBefore(tag, clearAllBtn);
  }

  function renderTags() {
    activeFilters.querySelectorAll(".filterTag").forEach((tag) => tag.remove());

    let count = 0;

    checkboxes
      .filter((input) => input.checked)
      .forEach((input) => {
        count++;
        makeTag(
          `${input.dataset.filterGroup}: ${input.dataset.filterLabel}`,
          () => {
            input.checked = false;
            update();
          },
        );
      });

    if (priceRange.min !== null || priceRange.max !== null) {
      count++;
      const min = priceRange.min !== null ? `$${formatPrice(priceRange.min)}` : "";
      const max = priceRange.max !== null ? `$${formatPrice(priceRange.max)}` : "";
      const text = min && max ? `Precio: ${min} – ${max}` : min ? `Precio: desde ${min}` : `Precio: hasta ${max}`;
      makeTag(text, () => {
        clearPrice();
        update();
      });
    }

    activeFilters.hidden = count === 0;
    if (filterCount) {
      filterCount.hidden = count === 0;
      filterCount.textContent = count;
    }
  }

  // Muestra el subgrupo si su categoría está marcada; si no, lo oculta y lo limpia
  function syncSubGroups() {
    subGroups.forEach((group) => {
      const parent = normalize(group.dataset.parent);
      const enabled = checkboxes.some(
        (input) =>
          input.checked &&
          normalize(input.dataset.filterGroup) === "categoria" &&
          normalize(input.dataset.filterLabel) === parent,
      );
      group.hidden = !enabled;
      if (!enabled) {
        group.querySelectorAll("input:checked").forEach((input) => (input.checked = false));
      }
    });
  }

  function update() {
    syncSubGroups();
    renderTags();
    applyFilters();
  }

  // ---------- Precio ----------
  function readPriceInputs() {
    const min = priceMin && priceMin.value !== "" ? Number(priceMin.value) : null;
    const max = priceMax && priceMax.value !== "" ? Number(priceMax.value) : null;
    priceRange.min = min !== null && !Number.isNaN(min) ? min : null;
    priceRange.max = max !== null && !Number.isNaN(max) ? max : null;
  }

  function clearPrice() {
    priceRange.min = null;
    priceRange.max = null;
    if (priceMin) priceMin.value = "";
    if (priceMax) priceMax.value = "";
  }

  if (applyPriceBtn) {
    applyPriceBtn.addEventListener("click", () => {
      readPriceInputs();
      update();
    });
  }
  [priceMin, priceMax].forEach((input) => {
    if (!input) return;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        readPriceInputs();
        update();
      }
    });
  });

  // ---------- Limpiar todo ----------
  function clearAll() {
    checkboxes.forEach((input) => (input.checked = false));
    clearPrice();
    if (searchInput) searchInput.value = "";
    update();
  }
  clearAllBtn.addEventListener("click", clearAll);
  if (emptyClearBtn) emptyClearBtn.addEventListener("click", clearAll);

  // ---------- Eventos ----------
  checkboxes.forEach((input) => input.addEventListener("change", update));
  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (sortSelect) sortSelect.addEventListener("change", applyFilters);

  // Filtros preseleccionados desde la URL, usados por el menú de productos:
  // ?categoria=componentes            -> marca la categoría
  // ?categoria=componentes&tipo=fuentes -> además marca la subcategoría
  const params = new URLSearchParams(window.location.search);
  const categoria = normalize(params.get("categoria"));
  const tipo = slugify(params.get("tipo"));
  if (categoria) {
    checkboxes.forEach((input) => {
      const group = normalize(input.dataset.filterGroup);
      const label = input.dataset.filterLabel;
      if (group === "categoria" && normalize(label) === categoria) {
        input.checked = true;
      }
      if (tipo && group === categoria && slugify(label) === tipo) {
        input.checked = true;
      }
    });
  }

  update();
})();
