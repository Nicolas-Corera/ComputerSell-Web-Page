// Página de favoritos: requiere sesión. Grilla con las tarjetas de producto
// guardadas en la cuenta; se actualiza en tiempo real (favoritos y productos).
import { requireAuth, loading } from "../core/supabase.js";
import { onCatalogChange } from "../core/catalog.js";

const { cardHtml } = window.CS;
const grid = document.getElementById("favGrid");
const empty = document.getElementById("favEmpty");
const countEl = document.getElementById("favPageCount");

loading(async () => {
  if (!(await requireAuth())) return;
  const store = window.FavoritesStore;
  await store.ready;

  let rendering = false;
  async function render() {
    if (rendering) return;
    rendering = true;
    const items = await store.getItems();
    rendering = false;
    const n = items.length;
    countEl.textContent = n === 0 ? "Todavía no guardaste productos" : `${n} ${n === 1 ? "producto guardado" : "productos guardados"}`;
    grid.hidden = n === 0;
    empty.hidden = n !== 0;
    grid.innerHTML = items.map((it) => cardHtml(it)).join("");
    if (window.syncFavorites) window.syncFavorites(grid);
  }

  store.onChange(render);
  // Cambios de precio/stock de los productos guardados
  onCatalogChange((change) => (change.resync || store.has(change.id)) && render());
  await render();
});
