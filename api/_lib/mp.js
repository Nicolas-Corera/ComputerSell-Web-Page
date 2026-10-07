// Helpers del backend de pagos (Vercel Functions en api/mp/*, también los
// sirve scripts/dev-server.js en local). Sin dependencias: todo con fetch.
//
// Variables (Vercel o .env):
//   ACCESS_TOKEN  / MP_ACCESS_TOKEN    access token de Mercado Pago (secreto)
//   CLAVE_WEBHOOK / MP_WEBHOOK_SECRET  clave secreta de los webhooks
//   SUPABASE_URL, SUPABASE_ANON_KEY    proyecto Supabase
//   SUPABASE_SECRET_KEY                service role: confirma/cancela órdenes
const fs = require("fs");
const path = require("path");

// En local se lee el .env del proyecto; en Vercel las variables ya están en process.env
let cached = null;
function env() {
  if (cached) return cached;
  const out = { ...process.env };
  const file = path.join(__dirname, "..", "..", ".env");
  if (!process.env.VERCEL && fs.existsSync(file)) {
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
        if (!m || line.trim().startsWith("#")) return;
        if (out[m[1]] === undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      });
  }
  cached = {
    MP_ACCESS_TOKEN: out.MP_ACCESS_TOKEN || out.ACCESS_TOKEN || "",
    MP_WEBHOOK_SECRET: out.MP_WEBHOOK_SECRET || out.CLAVE_WEBHOOK || "",
    SUPABASE_URL: (out.SUPABASE_URL || "").replace(/\/$/, ""),
    SUPABASE_ANON_KEY: out.SUPABASE_ANON_KEY || "",
    SUPABASE_SECRET_KEY: out.SUPABASE_SECRET_KEY || "",
    RESEND: out.RESEND || out.RESEND_API_KEY || "",
    RESEND_FROM: out.RESEND_FROM || "",
    RESEND_SENDER_NAME: out.RESEND_SENDER_NAME || "ComputerSell",
    CONTACT_TO: out.CONTACT_TO || "contacto@computersell.com.ar",
    NOTIFY_ADMIN_TO: out.NOTIFY_ADMIN_TO || out.CONTACT_TO || "ventas@computersell.com.ar",
    CONTACT_DAILY_LIMIT: Number(out.CONTACT_DAILY_LIMIT) || 40,
    NOTIFY_HOOK_SECRET: out.NOTIFY_HOOK_SECRET || "",
    SITE_URL: (out.SITE_URL || "").replace(/\/$/, ""),
  };
  return cached;
}

// ---------- HTTP ----------
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Body JSON: Vercel ya lo parsea (req.body); en el dev server se lee del stream
async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString("utf8")) : {};
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function query(req) {
  return new URL(req.url, "http://localhost").searchParams;
}

function header(req, name) {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v || "";
}

// Envuelve un handler: método, errores -> JSON
function handler(methods, fn) {
  return async (req, res) => {
    if (!methods.includes(req.method)) {
      res.setHeader("Allow", methods.join(", "));
      return send(res, 405, { error: "Método no permitido" });
    }
    try {
      await fn(req, res);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error("[mp]", e);
      // Un 500 (inesperado o de configuración) no le muestra el detalle interno
      // al navegador: queda en el log. Los demás son mensajes para el usuario.
      if (status === 500) return send(res, 500, { error: "Ocurrió un error. Probá de nuevo en unos minutos." });
      send(res, status, { error: e.message || "Error interno", ...(e.extra || {}) });
    }
  };
}

// ---------- Supabase (REST, sin SDK) ----------
async function sbFetch(route, { method = "GET", token, body, secret } = {}) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SECRET_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new HttpError(500, "Falta la configuración de Supabase");
  const key = secret ? SUPABASE_SECRET_KEY : SUPABASE_ANON_KEY;
  if (secret && !key) throw new HttpError(500, "Falta SUPABASE_SECRET_KEY");
  const res = await fetch(SUPABASE_URL + route, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + (secret ? key : token || key),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error_description || data.error || data.msg)) || `Supabase ${res.status}`;
    throw new HttpError(res.status === 401 ? 401 : 400, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

// Usuario de la sesión (JWT que manda el navegador en Authorization: Bearer)
async function requireUser(req) {
  const auth = header(req, "authorization");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Tenés que iniciar sesión para comprar");
  let user;
  try {
    user = await sbFetch("/auth/v1/user", { token });
  } catch (e) {
    throw new HttpError(401, "Tu sesión venció. Volvé a ingresar.");
  }
  if (!user || !user.id) throw new HttpError(401, "Tu sesión venció. Volvé a ingresar.");
  return { user, token };
}

// RPC como el usuario (auth.uid() = usuario) o con el service role
function rpc(name, args, opts) {
  return sbFetch("/rest/v1/rpc/" + name, { method: "POST", body: args, ...(opts || {}) });
}

// ---------- Mercado Pago ----------
const MP_API = "https://api.mercadopago.com";

async function mpFetch(route, { method = "GET", body, idempotencyKey } = {}) {
  const { MP_ACCESS_TOKEN } = env();
  if (!MP_ACCESS_TOKEN) throw new HttpError(500, "Falta el access token de Mercado Pago");
  const headers = { Authorization: "Bearer " + MP_ACCESS_TOKEN, "Content-Type": "application/json" };
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const res = await fetch(MP_API + route, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = { raw: text };
  }
  return { ok: res.ok, status: res.status, data };
}

// Mensajes para el comprador según status_detail (transacción u order)
const REJECTION = {
  bad_filled_card_data: "Revisá los datos de la tarjeta: hay algún dato incorrecto.",
  bad_filled_security_code: "El código de seguridad es incorrecto.",
  bad_filled_date: "La fecha de vencimiento es incorrecta.",
  bad_filled_other: "Revisá los datos de la tarjeta.",
  invalid_card_token: "No pudimos validar la tarjeta. Volvé a cargar los datos.",
  high_risk: "El pago fue rechazado por seguridad. Probá con otro medio de pago.",
  rejected_by_issuer: "El banco emisor rechazó el pago. Comunicate con tu banco o probá con otra tarjeta.",
  rejected_by_bank: "El banco emisor rechazó el pago. Comunicate con tu banco o probá con otra tarjeta.",
  required_call_for_authorize: "Tenés que autorizar el pago con tu banco antes de reintentar.",
  cc_rejected_call_for_authorize: "Tenés que autorizar el pago con tu banco antes de reintentar.",
  max_attempts_exceeded: "Superaste el límite de intentos. Probá con otra tarjeta.",
  card_disabled: "La tarjeta está deshabilitada. Comunicate con tu banco.",
  cc_rejected_card_disabled: "La tarjeta está deshabilitada. Comunicate con tu banco.",
  insufficient_amount: "La tarjeta no tiene fondos suficientes.",
  card_insufficient_amount: "La tarjeta no tiene fondos suficientes.",
  cc_rejected_insufficient_amount: "La tarjeta no tiene fondos suficientes.",
  amount_limit_exceeded: "El monto supera el límite de la tarjeta.",
  invalid_installments: "La tarjeta no acepta esa cantidad de cuotas.",
  cc_rejected_invalid_installments: "La tarjeta no acepta esa cantidad de cuotas.",
  duplicated_payment: "Ya hiciste un pago por el mismo monto hace instantes. Si querés repetirlo, usá otra tarjeta.",
  cc_rejected_duplicated_payment: "Ya hiciste un pago por el mismo monto hace instantes. Si querés repetirlo, usá otra tarjeta.",
  cc_rejected_bad_filled_security_code: "El código de seguridad es incorrecto.",
  cc_rejected_bad_filled_date: "La fecha de vencimiento es incorrecta.",
  cc_rejected_bad_filled_other: "Revisá los datos de la tarjeta.",
  cc_rejected_blacklist: "No pudimos procesar el pago con esa tarjeta.",
  cc_rejected_high_risk: "El pago fue rechazado por seguridad. Probá con otro medio de pago.",
  cc_rejected_other_reason: "La tarjeta rechazó el pago. Probá con otra.",
  "3ds_challenge_expired": "Venció el tiempo para autenticar la tarjeta. Volvé a intentar.",
  processing_error: "Hubo un error al procesar el pago. Volvé a intentar en unos minutos.",
  expired: "El pago venció antes de completarse.",
};

function rejectionMessage(detail) {
  return REJECTION[detail] || "La tarjeta rechazó el pago. Probá con otra tarjeta u otro medio de pago.";
}

// Resume una order de Mercado Pago en lo que guarda la base
function summarizeOrder(mpOrder) {
  const pay = ((mpOrder.transactions || {}).payments || [])[0] || {};
  const pm = pay.payment_method || {};
  return {
    status: mpOrder.status || pay.status || "",
    status_detail: pay.status_detail || mpOrder.status_detail || "",
    payment: {
      mp_order_id: mpOrder.id || "",
      mp_payment_id: pay.id || "",
      method_id: pm.id || "",
      type: pm.type || "",
      installments: pm.installments || 1,
      installment_amount: pm.installment_amount || null,
      paid_amount: pay.paid_amount || null,
      total_amount: mpOrder.total_amount || null,
    },
  };
}

module.exports = { env, HttpError, send, readJson, query, header, handler, sbFetch, requireUser, rpc, mpFetch, rejectionMessage, summarizeOrder };
