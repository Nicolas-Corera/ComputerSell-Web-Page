// POST /api/notify-mail — lo llama la base (trigger notifications_mail, pg_net)
// con {id} de la notificación y la clave x-hook-secret (NOTIFY_HOOK_SECRET).
// La notificación y el correo del cliente se leen acá con el service role:
// del body solo se usa el id.
// Push: todos los avisos del cliente, si aceptó notificaciones en algún
// navegador (push_subscriptions, migración 0029). Correo: solo los marcados con
// notifications.mail (migración 0032: pago confirmado, comprobante rechazado y
// despacho para el cliente; comprobante recibido y nueva venta para el panel).
//
// Respuestas: 200 {ok}, 4xx/5xx {error}.
const crypto = require("crypto");
const { env, handler, HttpError, send, readJson, header, sbFetch } = require("./_lib/mp");
const { templates, sendMail, rateLimit, siteUrl } = require("./_lib/mail");
const { sendPush, vapidConfig } = require("./_lib/push");

const UUID_RE = /^[0-9a-f-]{36}$/i;
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

// Push a todos los navegadores del cliente; borra los que se dieron de baja.
// Nunca corta el correo: los errores solo se registran.
async function pushToUser(n, orderId) {
  if (!vapidConfig()) return;
  try {
    const subs = await sbFetch(`/rest/v1/push_subscriptions?user_id=eq.${n.user_id}&select=endpoint,p256dh,auth`, { secret: true });
    if (!Array.isArray(subs) || !subs.length) return;
    const url = orderId ? `/compra-detalle.html?id=${orderId}` : n.target && /^\/[a-z-]+\.html$/.test(String(n.target.url || "")) ? n.target.url : "/perfil.html#avisos";
    const message = { title: n.title, body: n.body, url, tag: "notif-" + n.id };
    const results = await Promise.all(subs.map((s) => sendPush(s, message)));
    const gone = subs.filter((s, i) => results[i] === "gone");
    await Promise.all(
      gone.map((s) => sbFetch(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", secret: true }).catch(() => {})),
    );
  } catch (e) {
    console.error("[notify-push]", e.message);
  }
}

function checkSecret(req) {
  const { NOTIFY_HOOK_SECRET } = env();
  if (!NOTIFY_HOOK_SECRET) throw new HttpError(503, "Hook sin configurar");
  if (!crypto.timingSafeEqual(digest(header(req, "x-hook-secret")), digest(NOTIFY_HOOK_SECRET))) throw new HttpError(401, "No autorizado");
}

module.exports = handler(["POST"], async (req, res) => {
  checkSecret(req);
  const body = await readJson(req);
  const id = String(body.id || "");
  if (!UUID_RE.test(id)) throw new HttpError(400, "id inválido");

  const rows = await sbFetch(`/rest/v1/notifications?id=eq.${id}&select=id,audience,user_id,type,title,body,target,mail`, { secret: true });
  const n = Array.isArray(rows) ? rows[0] : null;
  if (!n) return send(res, 200, { ok: true, ignored: "inexistente" });

  const site = siteUrl(req);
  const orderId = n.target && UUID_RE.test(String(n.target.order || "")) ? n.target.order : "";
  let to, name, button;

  if (n.audience === "user") {
    if (n.user_id) await pushToUser(n, orderId);
    if (!n.mail) return send(res, 200, { ok: true, ignored: "solo push" });
    const profiles = n.user_id ? await sbFetch(`/rest/v1/profiles?id=eq.${n.user_id}&select=email,first_name`, { secret: true }) : [];
    const p = Array.isArray(profiles) ? profiles[0] : null;
    if (!p || !p.email) return send(res, 200, { ok: true, ignored: "sin correo" });
    to = p.email;
    name = p.first_name || "";
    button = orderId
      ? { href: `${site}/compra-detalle?id=${orderId}`, label: n.type === "pago" && /rechazado/i.test(n.title) ? "Subir comprobante" : "Ver mi pedido" }
      : { href: `${site}/perfil`, label: "Ir a mi cuenta" };
  } else if (n.audience === "admin" && n.mail) {
    to = env().NOTIFY_ADMIN_TO;
    button = { href: site.replace(/^(https?:\/\/)(www\.)?/, "$1dash."), label: "Abrir el panel" };
  } else {
    return send(res, 200, { ok: true, ignored: n.type });
  }

  // Límites diarios. El canal del dueño tiene su propio cupo (los clientes no
  // pueden agotarlo creando pedidos) y no consume el de los clientes. Los
  // avisos del panel siguen llegando aunque se corte el correo.
  const { NOTIFY_ADMIN_DAILY_LIMIT, NOTIFY_USER_DAILY_LIMIT, NOTIFY_DAILY_LIMIT } = env();
  const rules =
    n.audience === "admin"
      ? [{ key: "notify:admin", limit: NOTIFY_ADMIN_DAILY_LIMIT, window: 86400 }]
      : [
          { key: "notify:to:" + digest(to.toLowerCase()).toString("hex").slice(0, 32), limit: NOTIFY_USER_DAILY_LIMIT, window: 86400 },
          { key: "notify:all", limit: NOTIFY_DAILY_LIMIT, window: 86400 },
        ];
  const allowed = await rateLimit(rules);
  if (!allowed) {
    console.warn("[notify-mail] límite diario alcanzado: no se envió", n.audience, n.type, n.id);
    return send(res, 200, { ok: true, ignored: "límite" });
  }

  const replyTo = n.audience === "user" ? env().CONTACT_TO : undefined;
  await sendMail({ to, replyTo, ...templates.notification({ ...n, name, button }, site), idempotencyKey: "notif-" + n.id });
  send(res, 200, { ok: true });
});
