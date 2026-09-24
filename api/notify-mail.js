// POST /api/notify-mail — lo llama la base (trigger notifications_mail, pg_net)
// con {id} de la notificación y la clave x-hook-secret (NOTIFY_HOOK_SECRET).
// La notificación y el correo del cliente se leen acá con el service role:
// del body solo se usa el id.
//
// Respuestas: 200 {ok}, 4xx/5xx {error}.
const crypto = require("crypto");
const { env, handler, HttpError, send, readJson, header, sbFetch } = require("./_lib/mp");
const { templates, sendMail, rateLimit, siteUrl } = require("./_lib/mail");

const UUID_RE = /^[0-9a-f-]{36}$/i;
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();

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

  const rows = await sbFetch(`/rest/v1/notifications?id=eq.${id}&select=id,audience,user_id,type,title,body,target`, { secret: true });
  const n = Array.isArray(rows) ? rows[0] : null;
  if (!n) return send(res, 200, { ok: true, ignored: "inexistente" });

  const site = siteUrl(req);
  const orderId = n.target && UUID_RE.test(String(n.target.order || "")) ? n.target.order : "";
  let to, name, button;

  if (n.audience === "user") {
    const profiles = n.user_id ? await sbFetch(`/rest/v1/profiles?id=eq.${n.user_id}&select=email,first_name`, { secret: true }) : [];
    const p = Array.isArray(profiles) ? profiles[0] : null;
    if (!p || !p.email) return send(res, 200, { ok: true, ignored: "sin correo" });
    to = p.email;
    name = p.first_name || "";
    button = orderId
      ? { href: `${site}/compra-detalle?id=${orderId}`, label: n.type === "pago" && /rechazado/i.test(n.title) ? "Subir comprobante" : "Ver mi pedido" }
      : { href: `${site}/perfil`, label: "Ir a mi cuenta" };
  } else if (n.audience === "admin" && ["venta", "pago"].includes(n.type)) {
    to = env().NOTIFY_ADMIN_TO;
    button = { href: site.replace(/^(https?:\/\/)(www\.)?/, "$1dash."), label: "Abrir el panel" };
  } else {
    return send(res, 200, { ok: true, ignored: n.type });
  }

  const allowed = await rateLimit([
    { key: "notify:to:" + digest(to.toLowerCase()).toString("hex").slice(0, 32), limit: 30, window: 86400 },
    { key: "notify:all", limit: 300, window: 86400 },
  ]);
  if (!allowed) return send(res, 200, { ok: true, ignored: "límite" });

  const replyTo = n.audience === "user" ? env().CONTACT_TO : undefined;
  await sendMail({ to, replyTo, ...templates.notification({ ...n, name, button }, site), idempotencyKey: "notif-" + n.id });
  send(res, 200, { ok: true });
});
