// POST /api/mp/webhook — notificaciones de Mercado Pago (tópico "order").
//
// Configurar en Mercado Pago > Tus integraciones > Webhooks:
//   URL: https://<dominio>/api/mp/webhook · evento: Order (Mercado Pago)
// La clave secreta que genera va en CLAVE_WEBHOOK (o MP_WEBHOOK_SECRET).
//
// Se valida la firma (x-signature), se responde 200 rápido y el estado se
// toma SIEMPRE de GET /v1/orders/{id} (no del body), y se aplica con
// mp_apply_payment (idempotente: MP reintenta si no recibe 200).
const crypto = require("crypto");
const { env, handler, send, readJson, query, header, rpc, mpFetch, summarizeOrder } = require("../_lib/mp");

const TOLERANCE_MS = 10 * 60 * 1000; // antigüedad máxima aceptada del ts de la firma

function verifySignature(req, dataId) {
  const secret = env().MP_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "sin clave" };
  const sig = header(req, "x-signature");
  const parts = Object.fromEntries(
    sig
      .split(",")
      .map((p) => p.trim().split("=", 2))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  if (!parts.ts || !parts.v1) return { ok: false, reason: "firma incompleta" };

  // Manifest: id:[data.id];request-id:[x-request-id];ts:[ts]; (data.id alfanumérico en minúsculas)
  const manifest = [];
  if (dataId) manifest.push(`id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId}`);
  const requestId = header(req, "x-request-id");
  if (requestId) manifest.push(`request-id:${requestId}`);
  manifest.push(`ts:${parts.ts}`);
  const expected = crypto.createHmac("sha256", secret).update(manifest.join(";") + ";").digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(parts.v1));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: "firma inválida" };
  if (Math.abs(Date.now() - Number(parts.ts)) > TOLERANCE_MS) return { ok: false, reason: "firma vencida" };
  return { ok: true };
}

module.exports = handler(["POST"], async (req, res) => {
  const q = query(req);
  let body = {};
  try {
    body = await readJson(req);
  } catch (e) {
    body = {};
  }
  const dataId = q.get("data.id") || q.get("id") || (body.data && body.data.id) || "";
  const topic = q.get("type") || q.get("topic") || body.type || "";

  const check = verifySignature(req, dataId);
  if (!check.ok) {
    console.warn("[mp webhook] rechazado:", check.reason);
    return send(res, 401, { error: "Firma inválida" });
  }

  // Solo el tópico order (Checkout API); el resto se acepta para que MP no reintente
  if (topic && topic !== "order") return send(res, 200, { ok: true, ignored: topic });
  if (!dataId) return send(res, 200, { ok: true, ignored: "sin id" });

  const mp = await mpFetch("/v1/orders/" + encodeURIComponent(dataId));
  if (!mp.ok) {
    console.error("[mp webhook] no se pudo leer la order", dataId, mp.status);
    // 200 igual: si la order no existe no tiene sentido que MP reintente; si es un 5xx, MP reenvía
    return send(res, mp.status >= 500 ? 502 : 200, { ok: false, mp_status: mp.status });
  }

  const order = mp.data || {};
  const ref = String(order.external_reference || "");
  if (!/^[0-9a-f-]{36}$/i.test(ref)) return send(res, 200, { ok: true, ignored: "sin external_reference" });

  const info = summarizeOrder(order);
  let rows;
  try {
    rows = await rpc(
      "mp_apply_payment",
      { p_order: ref, p_mp_order_id: order.id || dataId, p_status: info.status, p_status_detail: info.status_detail, p_payment: info.payment },
      { secret: true },
    );
  } catch (e) {
    // Orden que no es de esta base (otro ambiente, prueba): 200 para que MP no reintente
    if (/inexistente/i.test(e.message || "")) return send(res, 200, { ok: true, ignored: "orden desconocida" });
    throw e;
  }
  const applied = Array.isArray(rows) ? rows[0] : rows;
  console.log("[mp webhook]", body.action || topic, dataId, "->", info.status, info.status_detail, "orden", applied && applied.number, applied && applied.status);
  return send(res, 200, { ok: true, order: applied });
});
