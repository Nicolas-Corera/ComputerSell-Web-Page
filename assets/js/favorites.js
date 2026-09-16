// Favoritos — compartido por todas las páginas.
// Expone window.FavoritesStore; marca los corazones y el badge del header.
// Requiere utils.js (window.CS).
(function () {
  const { loadList, saveList, productForButton } = window.CS;
  const STORAGE_KEY = "computersell-favorites";
  const FAVORITES_URL = "/favoritos.html";
  const HEART_SELECTOR =
    ".actionsDestacados .btn-third:last-child, .purchase-row .btn-third";

  // ---------- Store ----------
  let favorites = loadList(STORAGE_KEY);
  const listeners = [];

  function commit() {
    saveList(STORAGE_KEY, favorites);
    listeners.forEach((fn) => fn(FavoritesStore));
  }

  const FavoritesStore = {
    getItems: () => favorites.map((it) => ({ ...it })),
    count: () => favorites.length,
    has: (id) => favorites.some((it) => it.id === id),
    // Devuelve true si quedó agregado, false si se quitó
    toggle(product) {
      const adding = !FavoritesStore.has(product.id);
      if (adding) {
        const { qty, ...rest } = product; // la cantidad no aplica a favoritos
        favorites.push(rest);
      } else {
        favorites = favorites.filter((it) => it.id !== product.id);
      }
      commit();
      return adding;
    },
    remove(id) {
      favorites = favorites.filter((it) => it.id !== id);
      commit();
    },
    onChange(fn) {
      listeners.push(fn);
    },
  };
  window.FavoritesStore = FavoritesStore;

  // ---------- Corazones + badge ----------
  const badge = document.getElementById("favBadge");

  function setHeartState(btn, active) {
    btn.classList.toggle("is-favorited", active);
    const icon = btn.querySelector(".favorite-icon");
    if (icon) {
      icon.setAttribute(
        "href",
        active ? "#ic-favorite-fill" : "#ic-favorite",
      );
    }
  }

  // Marca/desmarca todos los corazones según el estado guardado
  function syncHearts(scope) {
    (scope || document).querySelectorAll(HEART_SELECTOR).forEach((btn) => {
      const product = productForButton(btn);
      setHeartState(btn, !!product && FavoritesStore.has(product.id));
    });

    if (badge) {
      const n = FavoritesStore.count();
      // Al llegar a 0 no escribimos "0": el badge se achica mostrando el último número
      if (n > 0) badge.textContent = n > 99 ? "99+" : n;
      badge.classList.toggle("is-visible", n > 0);
    }
  }

  function bumpBadge() {
    if (!badge) return;
    badge.classList.remove("is-bump");
    void badge.offsetWidth; // reinicia la animación
    badge.classList.add("is-bump");
  }

  if (badge) {
    badge.addEventListener("animationend", () => {
      badge.classList.remove("is-bump");
    });
  }

  // Ícono FAVORITOS del header -> página de favoritos
  const favBtn = document.getElementById("favBtn");
  if (favBtn) {
    favBtn.addEventListener("click", () => {
      window.location.href = FAVORITES_URL;
    });
  }

  // Delegación: funciona también con tarjetas agregadas/clonadas después de cargar.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(HEART_SELECTOR);
    if (!btn) return;
    const product = productForButton(btn);
    if (!product) return;
    // Solo al agregar: si se quita el último, el badge se achica sin "bump"
    if (FavoritesStore.toggle(product)) bumpBadge();
  });

  // Para tarjetas insertadas dinámicamente (carruseles, filtros, etc.)
  window.syncFavorites = syncHearts;

  FavoritesStore.onChange(() => syncHearts());
  syncHearts();
})();
