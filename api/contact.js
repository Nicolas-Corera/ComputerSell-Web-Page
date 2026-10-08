// POST /api/contact — formulario de contacto de la tienda.
//
// Manda la consulta a CONTACT_TO (reply-to = cliente) y un acuse al cliente.
// Anti-bots: origen del mismo sitio, campo trampa ("website"), tiempo mínimo
// de llenado y límite por IP, por correo y diario total (mail_rate_hit).
// El acuse no repite el mensaje: no sirve para mandar spam a terceros.
//
// Respuestas: 200 {ok}, 4xx/5xx {error}.
const crypto = require("crypto");
const { env, handler, HttpError, send, readJson, header } = require("./_lib/mp");
const { templates, sendMail, sendSafe, rateLimit, clientIp, siteUrl, MOTIVOS } = require("./_lib/mail");

const MIN_FILL_MS = 3000;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const str = (v, max) =>
  String(v == null ? "" : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
const line = (v, max) => str(v, max).replace(/[\r\n]+/g, " ");
const hash = (s) => crypto.createHash("sha256").update(String(s).toLowerCase()).digest("hex").slice(0, 32);

function sameOrigin(req) {
  const origin = header(req, "origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === header(req, "host") || host === header(req, "x-forwarded-host");
  } catch (e) {
    return false;
  }
}

module.exports = handler(["POST"], async (req, res) => {
  if (!sameOrigin(req)) throw new HttpError(403, "Origen no permitido");
  // Mientras los correos a la casilla de contacto estén pausados (el formulario
  // abre WhatsApp, assets/js/config/legal.js: emailPausado) el endpoint queda
  // cerrado: no tiene sentido aceptar envíos que nadie lee.
  if (env().CONTACT_FORM_ENABLED !== "true") throw new HttpError(503, "Por ahora las consultas se responden por WhatsApp.");

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    throw new HttpError(400, "Datos inválidos");
  }

  // Bots: se responde "ok" para no darles pistas
  const elapsed = Date.now() - Number(body.t || 0);
  if (str(body.website, 200) || !(elapsed >= MIN_FILL_MS && elapsed <= 6 * 3600 * 1000)) return send(res, 200, { ok: true });

  const c = {
    nombre: line(body.nombre, 60),
    apellido: line(body.apellido, 60),
    email: line(body.email, 120).toLowerCase(),
    telefono: line(body.telefono, 30),
    motivo: line(body.motivo, 20),
    detalle: line(body.detalle, 120),
    mensaje: str(body.mensaje, 3000),
  };
  if (!c.nombre || !c.apellido) throw new HttpError(400, "Completá tu nombre y apellido");
  if (!EMAIL_RE.test(c.email)) throw new HttpError(400, "El email no es válido");
  if (!MOTIVOS[c.motivo]) throw new HttpError(400, "Elegí un motivo de consulta");
  if (c.mensaje.length < 5) throw new HttpError(400, "Escribí tu mensaje");
  if (c.telefono && !/^[\d\s()+-]{6,30}$/.test(c.telefono)) throw new HttpError(400, "El teléfono no es válido");
  if ((c.mensaje.match(/https?:\/\//gi) || []).length > 3) throw new HttpError(400, "El mensaje tiene demasiados enlaces");

  const { CONTACT_TO, CONTACT_DAILY_LIMIT } = env();
  if (!CONTACT_TO) throw new HttpError(503, "El formulario no está disponible. Escribinos por WhatsApp.");

  const ip = hash(clientIp(req));
  const allowed = await rateLimit([
    { key: "contact:ip10m:" + ip, limit: 3, window: 600 },
    { key: "contact:ipday:" + ip, limit: 10, window: 86400 },
    { key: "contact:mail:" + hash(c.email), limit: 3, window: 86400 },
    { key: "contact:all", limit: CONTACT_DAILY_LIMIT, window: 86400 },
  ]);
  if (!allowed) throw new HttpError(429, "Recibimos muchas consultas seguidas. Probá de nuevo más tarde o escribinos por WhatsApp.");

  const site = siteUrl(req);
  await sendMail({ to: CONTACT_TO, replyTo: c.email, ...templates.contactStore(c, site) });
  await sendSafe({ to: c.email, replyTo: CONTACT_TO, ...templates.contactCustomer(c, site) });
  send(res, 200, { ok: true });
});
