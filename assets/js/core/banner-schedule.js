// Lógica pura (sin DOM ni red) de las imágenes programadas: qué entrada está
// vigente en un momento dado y cuándo cambia la próxima. La usan la tienda
// (banners.js), el panel (editor visual) y los tests.

const ts = (v) => (v ? new Date(v).getTime() : null);

// ¿Está vigente `row` en `now` (ms)? Sin "desde" empieza ya; sin "hasta" no vence.
export function isLive(row, now) {
  if (!row || row.enabled === false) return false;
  const from = ts(row.starts_at);
  const to = ts(row.ends_at);
  if (from !== null && now < from) return false;
  if (to !== null && now >= to) return false;
  return true;
}

// Estado para mostrar en el panel
export function statusOf(row, now) {
  if (row.enabled === false) return "off";
  const from = ts(row.starts_at);
  const to = ts(row.ends_at);
  if (from !== null && now < from) return "scheduled";
  if (to !== null && now >= to) return "expired";
  return "live";
}

// La entrada que se muestra en `slot`: entre las vigentes gana la que empezó
// más tarde (la campaña nueva pisa a la de siempre); a igualdad, la cargada
// último. Sin ninguna vigente devuelve null y la tienda deja su imagen original.
export function pickBanner(rows, slot, now) {
  const live = (rows || []).filter((r) => r.slot === slot && isLive(r, now));
  live.sort((a, b) => (ts(b.starts_at) ?? -Infinity) - (ts(a.starts_at) ?? -Infinity) || (ts(b.created_at) ?? 0) - (ts(a.created_at) ?? 0));
  return live[0] || null;
}

// Próximo instante (ms) en que algo empieza o vence, o null si no hay.
export function nextChange(rows, now) {
  let next = null;
  for (const r of rows || []) {
    if (r.enabled === false) continue;
    for (const t of [ts(r.starts_at), ts(r.ends_at)]) {
      if (t !== null && t > now && (next === null || t < next)) next = t;
    }
  }
  return next;
}

// Solo rutas del propio sitio o https (nunca javascript:, data: ni "//otro")
export function safeLink(link) {
  const s = String(link || "").trim();
  if (/^\/(?![/\\])[^\s\\]*$/.test(s) || /^https:\/\/[^\s\\]+$/i.test(s)) return s;
  return "";
}
