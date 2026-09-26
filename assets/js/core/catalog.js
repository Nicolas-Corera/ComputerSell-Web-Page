// Catálogo: la tienda pide a la base solo lo que muestra.
//   searchProducts(filtros) -> una página de tarjetas + total (RPC search_products)
//   fetchFacets()           -> contadores de los filtros (RPC catalog_facets, cacheado)
//   fetchCards(q => ...)    -> tarjetas con una consulta a medida (inicio, relacionados)
//   refreshCart()           -> precio/stock de lo que está en el carrito (solo esos ids)
//   onCatalogChange(fn)     -> cambios en vivo por Broadcast (canal "catalog"):
//                              fn({ id, removed } | fila de tarjeta | { resync: true })
// Los índices y funciones están en supabase/migrations/0021_catalog_search.sql.
import { sb, toCard } from "./supabase.js";

// Columnas que usa toCard (tarjetas, carrito, favoritos): nada de descripción/specs
export const CARD_COLUMNS =
  "id,title,brand,category,subcategory,price,old_price,on_sale,stock,installments,free_shipping,delivery,weight,weight_unit,images";

export function fetchCards(build) {
  let q = sb.from("products").select(CARD_COLUMNS).eq("status", "publicado");
  if (build) q = build(q);
  return q.then(({ data, error }) => {
    if (error) console.error(error);
    return data || [];
  });
}

// ---------- Búsqueda paginada ----------
// Caché corto en memoria: volver a una página o a un filtro ya visto no consulta de nuevo.
const CACHE_TTL = 60 * 1000;
const CACHE_MAX = 40;
const cache = new Map();

export function clearSearchCache() {
  cache.clear();
}

// params: { words, categories, componentes, perifericos, brands, inStock, freeShipping, onSale, min, max, sort, limit, offset }
export async function searchProducts(params) {
  const args = {
    p_words: params.words || [],
    p_categories: params.categories || [],
    p_componentes: params.componentes || [],
    p_perifericos: params.perifericos || [],
    p_brands: params.brands || [],
    p_in_stock: !!params.inStock,
    p_free_shipping: !!params.freeShipping,
    p_on_sale: !!params.onSale,
    p_min: params.min ?? null,
    p_max: params.max ?? null,
    p_sort: params.sort || "relevancia",
    p_limit: params.limit || 24,
    p_offset: params.offset || 0,
  };
  const key = JSON.stringify(args);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.promise;

  const promise = sb.rpc("search_products", args).then(({ data, error }) => {
    if (error) {
      cache.delete(key);
      throw error;
    }
    return { total: data.total || 0, items: data.items || [] };
  });
  cache.delete(key);
  cache.set(key, { at: Date.now(), promise });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  promise.catch(() => {});
  return promise;
}

// ---------- Contadores de filtros ----------
// Cambian poco: se guardan 5 minutos por visitante (sessionStorage) y se
// invalidan cuando llega un cambio del catálogo.
const FACETS_KEY = "cs_facets_v1";
const FACETS_TTL = 5 * 60 * 1000;
let facetsPromise = null;

export function clearFacets() {
  facetsPromise = null;
  try {
    sessionStorage.removeItem(FACETS_KEY);
  } catch (e) {}
}

export function fetchFacets() {
  if (facetsPromise) return facetsPromise;
  try {
    const saved = JSON.parse(sessionStorage.getItem(FACETS_KEY) || "null");
    if (saved && Date.now() - saved.at < FACETS_TTL) return (facetsPromise = Promise.resolve(saved.data));
  } catch (e) {}
  facetsPromise = sb.rpc("catalog_facets").then(({ data, error }) => {
    if (error) {
      console.error(error);
      facetsPromise = null;
      return null;
    }
    try {
      sessionStorage.setItem(FACETS_KEY, JSON.stringify({ at: Date.now(), data }));
    } catch (e) {}
    return data;
  });
  return facetsPromise;
}

// ---------- Carrito ----------
// Refresca precio/stock y quita lo que ya no está publicado. Solo consulta los
// productos del carrito. Devuelve las filas encontradas.
export async function refreshCart() {
  const store = window.CartStore;
  const ids = store ? store.getItems().map((it) => it.id) : [];
  if (!ids.length) return [];
  const { data, error } = await sb.from("products").select(CARD_COLUMNS).in("id", ids).eq("status", "publicado");
  if (error) {
    // Sin respuesta de la base no se toca el carrito
    console.error(error);
    return [];
  }
  store.refresh(data.map(toCard), data.map((r) => r.id));
  return data;
}

// ---------- En vivo ----------
// Un solo canal compartido por la página. Si la pestaña queda oculta más de
// un minuto se desconecta (libera la conexión de Realtime) y al volver avisa
// { resync: true } para que la página vuelva a pedir lo que muestra.
const listeners = [];
let channel = null;
let hiddenAt = 0;
let hideTimer = null;

function emit(change) {
  if (!change.resync) clearSearchCache();
  clearFacets();
  listeners.forEach((fn) => fn(change));
}

function connect() {
  if (channel) return;
  channel = sb
    .channel("catalog", { config: { private: false } })
    .on("broadcast", { event: "product" }, ({ payload }) => {
      if (!payload || !payload.id) return;
      // Carrito siempre al día (en cualquier página)
      if (window.CartStore) {
        if (payload.removed) window.CartStore.refresh([], window.CartStore.getItems().map((it) => it.id).filter((id) => id !== payload.id));
        else window.CartStore.refresh([toCard(payload)]);
      }
      emit(payload);
    })
    .subscribe();
}

function disconnect() {
  if (!channel) return;
  sb.removeChannel(channel);
  channel = null;
}

document.addEventListener("visibilitychange", () => {
  if (!listeners.length) return;
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
    hideTimer = setTimeout(disconnect, 60 * 1000);
    return;
  }
  clearTimeout(hideTimer);
  const away = !channel;
  connect();
  // Estuvo desconectado: pudo haberse perdido algún cambio
  if (away && hiddenAt) {
    clearSearchCache();
    emit({ resync: true });
  }
});

export function onCatalogChange(fn) {
  listeners.push(fn);
  connect();
}

// Aplica un cambio en vivo a una lista de filas en pantalla. Devuelve la lista
// nueva, o null si el cambio no afecta a ninguna.
export function applyChange(rows, change) {
  const i = rows.findIndex((r) => r.id === change.id);
  if (i < 0) return null;
  if (change.removed) return rows.filter((r) => r.id !== change.id);
  const next = rows.slice();
  next[i] = { ...rows[i], ...change };
  return next;
}
