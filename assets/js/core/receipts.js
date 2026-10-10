// Comprobantes de transferencia: validación del archivo y subida.
// Lo usan la confirmación del pago (pago.js) y el detalle del pedido
// (compra-detalle.js). La base fija el monto (total del pedido), exige que el
// archivo exista en el bucket con el nombre <user>/<pedido>-<timestamp>.<ext>
// y limita la cantidad de archivos por pedido (migración 0030). La revisión
// de acá es solo para avisar rápido: la que vale es la del servidor
// (api/orders/receipt), sin la cual la base no registra el comprobante (0033).
import { sb } from "./supabase.js";

export const RECEIPT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
const TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const MAX = 5 * 1024 * 1024;

// Primeros bytes de cada formato: un HTML renombrado a .png no pasa
const MAGIC = {
  pdf: [0x25, 0x50, 0x44, 0x46], // %PDF
  png: [0x89, 0x50, 0x4e, 0x47],
  jpg: [0xff, 0xd8, 0xff],
};

async function realType(file) {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return Object.keys(MAGIC).find((k) => MAGIC[k].every((b, i) => head[i] === b)) || "";
}

// "" si el archivo sirve; si no, el motivo para mostrarle al cliente
export async function receiptProblem(file) {
  if (!file) return "Elegí el archivo del comprobante.";
  if (!TYPES[file.type] || !/\.(pdf|jpe?g|png)$/i.test(file.name)) return "Solo se aceptan archivos PDF, JPG o PNG.";
  if (file.size > MAX) return "El archivo supera los 5 MB.";
  if (file.size === 0) return "El archivo está vacío.";
  const real = await realType(file);
  if (!real || real !== TYPES[file.type]) return "El archivo no es un PDF, JPG o PNG válido.";
  return "";
}

// Sube el archivo y registra el comprobante. Tira Error con un mensaje para el cliente.
export async function uploadReceipt({ userId, orderId, file }) {
  const problem = await receiptProblem(file);
  if (problem) throw new Error(problem);
  const path = `${userId}/${orderId}-${Date.now()}.${TYPES[file.type]}`;
  const up = await sb.storage.from("receipts").upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) {
    console.error("[comprobante] storage", up.error);
    throw new Error(
      /row-level security|unauthorized|403/i.test(up.error.message || "")
        ? "Este pedido ya no acepta comprobantes (puede que ya tenga uno en revisión o que se haya cancelado). Recargá la página."
        : "No pudimos subir el archivo. Revisá tu conexión y probá de nuevo.",
    );
  }
  // El servidor revisa el contenido real del archivo (no solo los primeros
  // bytes) y recién ahí registra el comprobante: si no pasa, lo borra
  const { data: sess } = await sb.auth.getSession();
  if (!sess || !sess.session) throw new Error("Tu sesión venció. Volvé a ingresar.");
  let res;
  try {
    res = await fetch("/api/orders/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.session.access_token },
      body: JSON.stringify({ order_id: orderId, file_path: path }),
    });
  } catch (e) {
    throw new Error("Subimos el archivo pero no pudimos registrarlo. Revisá tu conexión y probá de nuevo.");
  }
  if (!res.ok) {
    let out = {};
    try {
      out = await res.json();
    } catch (e) {}
    console.error("[comprobante] registro", res.status, out);
    throw new Error(out.error || "Subimos el archivo pero no pudimos registrarlo. Probá de nuevo en unos minutos.");
  }
}
