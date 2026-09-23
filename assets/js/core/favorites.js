// Favoritos — guardados en la cuenta (tabla favorites) y sincronizados en
// tiempo real entre pestañas/dispositivos. Sin sesión, el corazón lleva al login.
// Expone window.FavoritesStore; marca los corazones y el badge del header.
// Requiere utils.js (window.CS).
import { sb, getUser, onAuth, subscribe, toCard, loading, PRODUCT_COLUMNS } from "./supabase.js";

const { productForButton, toast } = window.CS;
const FAVORITES_URL = "/favoritos.html";
const HEART_SELECTOR = ".actionsDestacados .btn-third:last-child, .purchase-row .btn-third";

// ---------- Store ----------
let ids = new Set(); // product_id de los favoritos del usuario
let user = null;
let unsubscribe = null;
const listeners = [];

function emit() {
  listeners.forEach((fn) => fn(FavoritesStore));
}

async function load() {
  user = await getUser();
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  if (!user) {
    ids = new Set();
    emit();
    return;
  }
  const { data } = await sb.from("favorites").select("product_id").eq("user_id", user.id);
  ids = new Set((data || []).map((r) => r.product_id));
  emit();
  // Cambios desde otra pestaña/dispositivo
  unsubscribe = subscribe(
    "favorites",
    (p) => {
      if (p.eventType === "INSERT") ids.add(p.new.product_id);
      else if (p.eventType === "DELETE") ids.delete(p.old.product_id);
      emit();
    },
    `user_id=eq.${user.id}`,
  );
}

const FavoritesStore = {
  ids: () => Array.from(ids),
  count: () => ids.size,
  has: (id) => ids.has(id),
  isLoggedIn: () => !!user,
  // Devuelve true si quedó agregado, false si se quitó (null si no hay sesión)
  async toggle(product) {
    if (!user) {
      toast("Iniciá sesión para guardar favoritos");
      const next = encodeURIComponent(location.pathname + location.search);
      setTimeout(() => (location.href = `/acceso.html?next=${next}#login`), 600);
      return null;
    }
    const adding = !ids.has(product.id);
    // Optimista: se refleja al instante y se confirma con la base
    if (adding) ids.add(product.id);
    else ids.delete(product.id);
    emit();
    const { error } = adding
      ? await sb.from("favorites").insert({ user_id: user.id, product_id: product.id })
      : await sb.from("favorites").delete().eq("user_id", user.id).eq("product_id", product.id);
    if (error && !/duplicate/i.test(error.message)) {
      if (adding) ids.delete(product.id);
      else ids.add(product.id);
      emit();
      toast("No se pudo actualizar favoritos", "bad");
      return !adding;
    }
    return adding;
  },
  remove(id) {
    return FavoritesStore.toggle({ id });
  },
  // Productos completos de los favoritos (para la página de favoritos)
  async getItems() {
    if (!ids.size) return [];
    const { data } = await sb.from("products").select(PRODUCT_COLUMNS).in("id", Array.from(ids)).eq("status", "publicado");
    return (data || []).map(toCard);
  },
  onChange(fn) {
    listeners.push(fn);
  },
  ready: loading(load()),
};
window.FavoritesStore = FavoritesStore;

// ---------- Corazones + badge ----------
const badge = document.getElementById("favBadge");

function setHeartState(btn, active) {
  btn.classList.toggle("is-favorited", active);
  const icon = btn.querySelector(".favorite-icon");
  if (icon) icon.setAttribute("href", active ? "#ic-favorite-fill" : "#ic-favorite");
}

// Marca/desmarca todos los corazones según el estado guardado
function syncHearts(scope) {
  (scope || document).querySelectorAll(HEART_SELECTOR).forEach((btn) => {
    const product = productForButton(btn);
    setHeartState(btn, !!product && ids.has(product.id));
  });
  if (badge) {
    const n = ids.size;
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
if (badge) badge.addEventListener("animationend", () => badge.classList.remove("is-bump"));

// Ícono FAVORITOS del header -> página de favoritos
const favBtn = document.getElementById("favBtn");
if (favBtn) favBtn.addEventListener("click", () => (location.href = FAVORITES_URL));

// Delegación: funciona también con tarjetas agregadas después de cargar
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(HEART_SELECTOR);
  if (!btn) return;
  const product = productForButton(btn);
  if (!product) return;
  if ((await FavoritesStore.toggle(product)) === true) bumpBadge();
});

// Para tarjetas insertadas dinámicamente
window.syncFavorites = syncHearts;

FavoritesStore.onChange(() => syncHearts());
onAuth((u) => {
  if ((u && u.id) !== (user && user.id)) load();
});
syncHearts();
