// Catálogo en tiempo real: carga productos publicados y mantiene una copia
// local que se actualiza con cada cambio en la tabla products.
// Uso: const cat = createCatalog(); cat.onChange(render); await cat.ready;
import { fetchPublished, subscribe, toCard } from "./supabase.js";

export function createCatalog() {
  let rows = [];
  const listeners = [];
  let timer = null;

  function emit() {
    // Se agrupan varios eventos seguidos en un solo render
    clearTimeout(timer);
    timer = setTimeout(() => listeners.forEach((fn) => fn(catalog)), 30);
  }

  const catalog = {
    ready: fetchPublished().then((data) => {
      rows = data;
      // Carrito: refresca precio/stock y quita lo que ya no está publicado
      if (window.CartStore) window.CartStore.refresh(rows.map(toCard), rows.map((r) => r.id));
      emit();
      return catalog;
    }),
    all: () => rows,
    cards: () => rows.map(toCard),
    byId: (id) => rows.find((r) => r.id === id),
    featured: () => rows.filter((r) => r.featured),
    byCategory: (c) => rows.filter((r) => r.category === c),
    onChange(fn) {
      listeners.push(fn);
    },
  };

  subscribe("products", (p) => {
    const row = p.new && p.new.id ? p.new : null;
    if (p.eventType === "DELETE" || (row && row.status !== "publicado")) {
      const id = row ? row.id : p.old.id;
      const before = rows.length;
      rows = rows.filter((r) => r.id !== id);
      if (window.CartStore) window.CartStore.refresh([], rows.map((r) => r.id));
      if (rows.length !== before) emit();
      return;
    }
    if (!row) return;
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = row;
    else rows.unshift(row);
    if (window.CartStore) window.CartStore.refresh([toCard(row)]);
    emit();
  });

  return catalog;
}
