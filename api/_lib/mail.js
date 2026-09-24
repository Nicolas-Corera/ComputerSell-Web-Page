// Correos transaccionales por la API de Resend (sin SDK) + límite de envíos.
//
// Variables: RESEND (API key), RESEND_FROM (dominio verificado en Resend),
// RESEND_SENDER_NAME, CONTACT_TO, CONTACT_DAILY_LIMIT, SITE_URL.
//
// El límite se guarda en Supabase (mail_rate_hit, migración 0018) para que sea
// compartido entre instancias; si la base falla queda el límite en memoria.
const { env, HttpError, header, rpc } = require("./mp");

const BLUE = "#3b82f6";
const DARK = "#0d0f12";
const INK = "#1a1d21";
const SOFT = "#5b6068";
const FONT = "Montserrat, 'Segoe UI', Helvetica, Arial, sans-serif";

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nl2br = (s) => esc(s).replace(/\r?\n/g, "<br />");

function siteUrl(req) {
  const { SITE_URL } = env();
  if (SITE_URL && !/localhost/.test(SITE_URL)) return SITE_URL;
  const host = req && header(req, "host");
  return host ? `${/localhost|127\.0\.0\.1/.test(host) ? "http" : "https"}://${host}` : SITE_URL;
}

function layout({ preheader, title, intro, rows, button, note, site }) {
  const table = rows && rows.length
    ? `<tr><td style="padding-bottom:24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8eb;border-radius:10px">
          ${rows
            .map(
              ([k, v], i) => `<tr>
            <td style="font-family:${FONT};font-size:13px;color:${SOFT};padding:10px 14px;vertical-align:top;white-space:nowrap;${i ? "border-top:1px solid #e6e8eb;" : ""}">${esc(k)}</td>
            <td style="font-family:${FONT};font-size:14px;color:${INK};padding:10px 14px;${i ? "border-top:1px solid #e6e8eb;" : ""}">${v}</td>
          </tr>`,
            )
            .join("")}
        </table>
      </td></tr>`
    : "";
  const cta = button
    ? `<tr><td style="padding:0 0 24px">
          <a href="${esc(button.href)}" style="display:inline-block;background:${BLUE};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:10px">${esc(button.label)}</a>
        </td></tr>`
    : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" />
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f4f6">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f6">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td style="background:${DARK};padding:22px 32px;font-family:Inter, ${FONT};font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.2px">
        Computer<span style="color:${BLUE}">Sell</span>
      </td></tr>
      <tr><td style="padding:32px 32px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="font-family:Inter, ${FONT};font-size:22px;line-height:30px;font-weight:700;color:${INK};padding-bottom:12px">${esc(title)}</td></tr>
          <tr><td style="font-family:${FONT};font-size:15px;line-height:24px;color:${INK};padding-bottom:24px">${intro}</td></tr>
          ${table}
          ${cta}
          ${note ? `<tr><td style="font-family:${FONT};font-size:13px;line-height:20px;color:${SOFT};border-top:1px solid #e6e8eb;padding:20px 0 28px">${note}</td></tr>` : ""}
        </table>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
      <tr><td align="center" style="font-family:${FONT};font-size:12px;line-height:18px;color:${SOFT};padding:20px 16px">
        ComputerSell${site ? ` · <a href="${esc(site)}" style="color:${SOFT}">${esc(site.replace(/^https?:\/\//, ""))}</a>` : ""}<br />
        Este es un correo automático.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ---------- Plantillas ----------
const MOTIVOS = {
  armado: "Armado de PC a medida",
  producto: "Consulta sobre un producto",
  pedido: "Estado de un pedido",
  garantia: "Garantía / service técnico",
  otro: "Otro",
};

const templates = {
  contactStore(c, site) {
    const fields = [
      ["Nombre", `${c.nombre} ${c.apellido}`],
      ["Email", c.email],
      ["Teléfono", c.telefono || "—"],
      ["Motivo", MOTIVOS[c.motivo] || c.motivo],
      ...(c.detalle ? [["Detalle", c.detalle]] : []),
      ["Mensaje", c.mensaje],
    ];
    const rows = fields.map(([k, v]) => [k, k === "Email" ? `<a href="mailto:${esc(v)}" style="color:${BLUE}">${esc(v)}</a>` : nl2br(v)]);
    return {
      subject: `Nueva consulta · ${MOTIVOS[c.motivo] || "Contacto"} · ${c.nombre} ${c.apellido}`.slice(0, 150),
      html: layout({
        preheader: c.mensaje.slice(0, 120),
        title: "Nueva consulta desde la web",
        intro: "Llegó una consulta por el formulario de contacto. Respondé este correo para contestarle directo al cliente.",
        rows,
        site,
      }),
      text: fields.map(([k, v]) => `${k}: ${v}`).join("\n"),
    };
  },

  contactCustomer(c, site) {
    return {
      subject: "Recibimos tu consulta · ComputerSell",
      html: layout({
        preheader: "Te respondemos a la brevedad.",
        title: `¡Gracias, ${c.nombre}!`,
        intro: `Recibimos tu consulta sobre <strong>${esc(MOTIVOS[c.motivo] || "tu consulta")}</strong>. Nuestro equipo la revisa y te responde a este correo a la brevedad, en horario comercial.`,
        button: site ? { href: site + "/productos", label: "Ver productos" } : null,
        note: "Si no enviaste ninguna consulta, ignorá este correo.",
        site,
      }),
      text: `¡Gracias, ${c.nombre}! Recibimos tu consulta y te respondemos a la brevedad.\n\nSi no enviaste ninguna consulta, ignorá este correo.`,
    };
  },

  notification(n, site) {
    const hi = n.name ? `Hola ${esc(n.name)}, ` : "";
    const body = n.body ? nl2br(n.body) : "Hay una novedad en tu cuenta.";
    return {
      subject: `${n.title} · ComputerSell`.slice(0, 150),
      html: layout({
        preheader: n.body || n.title,
        title: n.title,
        intro: hi + body,
        button: n.button,
        note: n.audience === "admin" ? "Aviso automático del panel de ComputerSell." : "Te escribimos porque hay una novedad en tu pedido. También la ves en la campanita de la tienda.",
        site,
      }),
      text: `${n.title}\n\n${n.body || ""}${n.button ? "\n\n" + n.button.href : ""}`,
    };
  },
};

// ---------- Envío ----------
async function sendMail({ to, subject, html, text, replyTo, idempotencyKey }) {
  const { RESEND, RESEND_FROM, RESEND_SENDER_NAME } = env();
  if (!RESEND || !RESEND_FROM) throw new HttpError(503, "El envío de correos no está configurado");
  const headers = { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: `${RESEND_SENDER_NAME} <${RESEND_FROM}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("[mail] Resend", res.status, data && (data.message || data.name));
    throw new HttpError(res.status === 429 ? 429 : 502, "No pudimos enviar el correo. Probá de nuevo en unos minutos.");
  }
  return data;
}

// Para correos secundarios: si falla solo queda en el log
async function sendSafe(msg) {
  try {
    return await sendMail(msg);
  } catch (e) {
    console.warn("[mail] no enviado:", msg.subject, e.message);
    return null;
  }
}

// ---------- Límite de envíos ----------
const memory = new Map();

function memoryHit(rules) {
  const now = Date.now();
  for (const r of rules) {
    const list = (memory.get(r.key) || []).filter((t) => now - t < r.window * 1000);
    memory.set(r.key, list);
    if (list.length >= r.limit) return false;
  }
  rules.forEach((r) => memory.get(r.key).push(now));
  if (memory.size > 5000) memory.clear();
  return true;
}

async function rateLimit(rules) {
  if (!memoryHit(rules)) return false;
  try {
    const ok = await rpc("mail_rate_hit", { p_rules: rules }, { secret: true });
    return ok !== false;
  } catch (e) {
    console.warn("[mail] rate limit en memoria (sin mail_rate_hit):", e.message);
    return true;
  }
}

function clientIp(req) {
  return (
    header(req, "x-vercel-forwarded-for") ||
    header(req, "x-real-ip") ||
    header(req, "x-forwarded-for").split(",")[0] ||
    (req.socket && req.socket.remoteAddress) ||
    "?"
  ).trim();
}

module.exports = { templates, sendMail, sendSafe, rateLimit, clientIp, siteUrl, MOTIVOS };
