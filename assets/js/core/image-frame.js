// Encuadre de una imagen dentro de su recuadro (ajuste, zoom y posición).
// Lo comparten el panel (acomoda la imagen del producto sobre la vista previa)
// y la tienda (la aplica en la tarjeta). Mismo formato que public.products.image_frames
// (migración 0044): { fit: "cover" | "contain", zoom: 1-3, x: 0-100, y: 0-100 }.

export const DEFAULT_FRAME = { fit: "contain", zoom: 1, x: 50, y: 50 };

const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Number(v))) : d);

// Un encuadre válido y acotado, o null si no hay nada (o es el de siempre)
export function normalizeFrame(f) {
  if (!f || typeof f !== "object") return null;
  const out = {
    fit: f.fit === "cover" ? "cover" : "contain",
    zoom: Math.round(num(f.zoom, 1, 3, 1) * 100) / 100,
    x: Math.round(num(f.x, 0, 100, 50)),
    y: Math.round(num(f.y, 0, 100, 50)),
  };
  return isDefault(out) ? null : out;
}

export function isDefault(f) {
  return !f || (f.fit === "contain" && f.zoom === 1 && f.x === 50 && f.y === 50);
}

// Estilo en línea de la <img> (cadena ya segura: solo números y palabras fijas); "" = como siempre
export function frameStyle(f) {
  const n = normalizeFrame(f);
  if (!n) return "";
  return `object-fit:${n.fit};object-position:${n.x}% ${n.y}%;` + (n.zoom !== 1 ? `transform:scale(${n.zoom});transform-origin:${n.x}% ${n.y}%;` : "");
}

// La lista a guardar: null si ninguna imagen tiene encuadre propio
export function framesToSave(frames) {
  const list = frames.map(normalizeFrame);
  return list.some(Boolean) ? list : null;
}
