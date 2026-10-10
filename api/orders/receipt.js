// POST /api/orders/receipt — registra el comprobante de una transferencia.
//
// El navegador sube el archivo al bucket privado "receipts" (la base limita
// nombre, tipo, tamaño y cantidad) y después llama acá. Esta función baja el
// archivo con el service role y revisa su contenido real
// (api/_lib/receipt-check.js): si no es un PDF/PNG/JPG legítimo o trae código
// escondido, lo borra y responde 400. Si está bien lo anota como verificado
// (mark_receipt_verified) y crea la fila de payment_receipts con la sesión del
// cliente, así siguen valiendo las políticas de la base (pedido propio,
// pendiente, un comprobante en revisión). payment_receipts no acepta archivos
// que no pasaron por acá (migración 0033).
//
// Body: { order_id, file_path }  (file_path = <user>/<pedido>-<timestamp>.<pdf|png|jpg>)
// Respuestas: 200 {ok}, 4xx/5xx {error}.
const crypto = require("crypto");
const { env, handler, send, readJson, requireUser, rpc, sbFetch, HttpError } = require("../_lib/mp");
const { inspectReceipt, MAX_BYTES } = require("../_lib/receipt-check");
const { UUID } = require("../_lib/checkout");

function storage(path, method) {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new HttpError(500, "Falta la configuración de Supabase");
  return fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${path}`, {
    method: method || "GET",
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: "Bearer " + SUPABASE_SECRET_KEY },
  });
}

module.exports = handler(["POST"], async (req, res) => {
  const { user, token } = await requireUser(req);
  const body = await readJson(req);
  const orderId = String(body.order_id || "");
  const path = String(body.file_path || "");
  if (!UUID.test(orderId) || !UUID.test(user.id)) throw new HttpError(400, "Pedido inválido");
  // Solo archivos de este cliente y este pedido: sin "..", barras de más ni otras carpetas
  const m = path.match(new RegExp(`^${user.id}/${orderId}-[0-9]{10,16}\\.(pdf|png|jpg)$`, "i"));
  if (!m) throw new HttpError(400, "Archivo inválido. Volvé a subir el comprobante.");
  const ext = m[1].toLowerCase();

  const r = await storage(path);
  if (r.status === 400 || r.status === 404) throw new HttpError(400, "No encontramos el archivo. Volvé a subir el comprobante.");
  if (!r.ok) throw new Error("storage " + r.status);
  if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) {
    await storage(path, "DELETE").catch(() => {});
    throw new HttpError(400, "El archivo supera los 5 MB.");
  }
  const buf = Buffer.from(await r.arrayBuffer());

  const problem = inspectReceipt(buf, ext, r.headers.get("content-type") || "");
  if (problem) {
    // Fuera del bucket: no queda nada que el panel pueda abrir
    const del = await storage(path, "DELETE").catch((e) => e);
    console.warn("[comprobante] rechazado", { user: user.id, order: orderId, path, problem, deleted: del && del.ok });
    throw new HttpError(400, problem);
  }

  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  await rpc("mark_receipt_verified", { p_path: path, p_sha256: sha256 }, { secret: true });

  try {
    await sbFetch("/rest/v1/payment_receipts", {
      method: "POST",
      token,
      body: { order_id: orderId, user_id: user.id, file_path: path },
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 400) {
      // Políticas de la base (en inglés) -> mensaje para el cliente; las
      // excepciones propias de la base ya vienen en castellano
      if (/row-level security|violates|duplicate key/i.test(e.message))
        throw new HttpError(409, "Este pedido ya tiene un comprobante en revisión o ya no está pendiente de pago. Recargá la página.");
      throw new HttpError(409, e.message);
    }
    throw e;
  }
  send(res, 200, { ok: true });
});
