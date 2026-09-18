// POST /api/mp/pay — cobro con tarjeta (Mercado Pago Checkout API / Orders).
//
// El navegador tokeniza la tarjeta con el SDK de Mercado Pago (los datos
// nunca pasan por acá) y manda: ítems, datos del comprador, medio (crédito o
// débito), cuotas y el token. Este endpoint:
//   1. valida la sesión de Supabase (Authorization: Bearer <jwt>)
//   2. crea la orden con place_order como ese usuario (valida stock y precios,
//      calcula el total en la base: nunca se confía en un monto del cliente)
//   3. crea la order en Mercado Pago (POST /v1/orders, modo automático)
//   4. aplica el resultado con mp_apply_payment: pagado / cancelado / pendiente
//
// Respuestas: 200 {result:'approved'|'pending', order}, 402 {error, order}
// cuando la tarjeta rechazó, 4xx/5xx {error} en el resto.
const { handler, HttpError, send, readJson, requireUser, rpc, sbFetch, mpFetch, rejectionMessage, summarizeOrder } = require("../_lib/mp");

const CARD_TYPES = { credito: "credit_card", debito: "debit_card" };
const MAX_INSTALLMENTS = 18; // tope del panel (cuotas sin interés por producto)

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max || 200);
const digits = (v) => String(v == null ? "" : v).replace(/\D/g, "");
const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);

// Teléfono "11 2345-6789" -> {area_code: "11", number: "23456789"}
function phoneParts(phone) {
  const d = digits(phone);
  if (d.length < 8) return null;
  return { area_code: d.slice(0, d.length - 8), number: d.slice(-8) };
}

module.exports = handler(["POST"], async (req, res) => {
  const { user, token } = await requireUser(req);
  const body = await readJson(req);

  // ---------- Validación de entrada ----------
  const method = str(body.method, 20);
  if (!CARD_TYPES[method]) throw new HttpError(400, "Medio de pago inválido");

  const items = Array.isArray(body.items)
    ? body.items.map((it) => ({ product_id: str(it.product_id, 64), qty: Math.max(1, parseInt(it.qty, 10) || 1) })).filter((it) => it.product_id)
    : [];
  if (!items.length) throw new HttpError(400, "El carrito está vacío");

  const card = body.card || {};
  const cardToken = str(card.token, 128);
  const paymentMethodId = str(card.payment_method_id, 40);
  if (!cardToken) throw new HttpError(400, "Falta el token de la tarjeta");
  if (!paymentMethodId) throw new HttpError(400, "No pudimos identificar la tarjeta");

  let installments = method === "credito" ? parseInt(body.installments, 10) || 1 : 1;
  installments = Math.min(MAX_INSTALLMENTS, Math.max(1, installments));

  const c = body.customer || {};
  const customer = {
    name: str(c.name, 120),
    email: str(c.email, 120).toLowerCase() || str(user.email, 120).toLowerCase(),
    phone: str(c.phone, 40),
    dni: str(c.dni, 20),
    address: str(c.address, 300),
  };
  const dni = digits(customer.dni);
  if (!customer.name || !customer.email) throw new HttpError(400, "Faltan datos del comprador");
  if (dni.length < 7 || dni.length > 8) throw new HttpError(400, "El DNI no es válido");

  const [firstName, ...rest] = customer.name.split(/\s+/);
  const lastName = rest.join(" ") || firstName;
  const addr = body.address || {};

  // ---------- 1. Orden en la base (como el usuario) ----------
  const placed = await rpc(
    "place_order",
    { p_items: items, p_payment_method: method, p_shipping_method: "domicilio", p_customer: customer, p_installments: installments, p_note: "" },
    { token },
  );
  const order = Array.isArray(placed) ? placed[0] : placed;
  if (!order || !order.id) throw new HttpError(500, "No pudimos crear la orden");

  // Detalle de la orden desde la base (precios reales) para informar los ítems a MP
  let orderDetail = null;
  try {
    const rows = await sbFetch(`/rest/v1/orders?id=eq.${order.id}&select=shipping_cost,surcharge,order_items(title,sku,image,unit_price,qty)`, { token });
    orderDetail = Array.isArray(rows) ? rows[0] : null;
  } catch (e) {
    console.warn("[mp] no se pudo leer el detalle de la orden", e.message);
  }

  // ---------- 2. Order en Mercado Pago ----------
  const total = money(order.total);
  const payer = {
    email: customer.email,
    entity_type: "individual",
    first_name: firstName,
    last_name: lastName,
    identification: { type: "DNI", number: dni },
  };
  const phone = phoneParts(customer.phone);
  if (phone) payer.phone = phone;
  if (addr.calle) {
    payer.address = {
      zip_code: str(addr.cp, 12),
      street_name: str(addr.calle, 120),
      street_number: str(addr.numero, 12),
      state: str(addr.provincia, 60),
      city: str(addr.ciudad, 60),
      complement: str(addr.piso, 60),
    };
    Object.keys(payer.address).forEach((k) => !payer.address[k] && delete payer.address[k]);
  }

  const mpBody = {
    type: "online",
    processing_mode: "automatic",
    capture_mode: "automatic",
    external_reference: order.id,
    total_amount: total,
    description: `ComputerSell · Pedido CS-${order.number}`,
    payer,
    transactions: {
      payments: [
        {
          amount: total,
          payment_method: {
            id: paymentMethodId,
            type: CARD_TYPES[method],
            token: cardToken,
            installments,
            statement_descriptor: "COMPUTERSELL",
          },
        },
      ],
    },
  };
  // Ítems (mejoran la tasa de aprobación). MP exige que sumen total_amount,
  // así que envío y recargo van como renglones aparte.
  if (orderDetail && Array.isArray(orderDetail.order_items) && orderDetail.order_items.length) {
    const lines = orderDetail.order_items.map((it, i) => ({
      title: str(it.title, 120) || "Producto",
      unit_price: money(it.unit_price || 0),
      quantity: Math.max(1, parseInt(it.qty, 10) || 1),
      external_code: str(it.sku, 30) || String(i + 1),
      ...(it.image && /^https?:\/\//.test(it.image) ? { picture_url: str(it.image, 500) } : {}),
    }));
    if (orderDetail.shipping_cost > 0) lines.push({ title: "Envío a domicilio", unit_price: money(orderDetail.shipping_cost), quantity: 1, external_code: "ENVIO" });
    if (orderDetail.surcharge > 0) lines.push({ title: `Recargo ${method === "credito" ? "tarjeta de crédito" : "tarjeta de débito"}`, unit_price: money(orderDetail.surcharge), quantity: 1, external_code: "RECARGO" });
    const sum = lines.reduce((acc, l) => acc + Number(l.unit_price) * l.quantity, 0);
    if (money(sum) === total) mpBody.items = lines;
  }

  // La clave de idempotencia es la orden: un reintento del mismo pedido no cobra dos veces
  let mp;
  try {
    mp = await mpFetch("/v1/orders", { method: "POST", body: mpBody, idempotencyKey: order.id });
  } catch (e) {
    console.error("[mp] error de red", e);
    await apply(order.id, "", "failed", "processing_error", { brand: str(card.brand, 20), last_four: digits(card.last_four).slice(-4) });
    throw new HttpError(502, "No pudimos comunicarnos con Mercado Pago. Tu tarjeta no fue cobrada; volvé a intentar en unos minutos.", { order: { id: order.id, number: order.number } });
  }

  // ---------- 3. Resultado ----------
  // Con 402 (transacción rechazada) la order viene anidada en data.data
  const raw = mp.data || {};
  const data = raw.data && raw.data.id ? raw.data : raw;
  const info = summarizeOrder(data);
  const snapshot = { ...info.payment, brand: str(card.brand, 20) || info.payment.method_id, last_four: digits(card.last_four).slice(-4) };
  const pending = ["processing", "action_required", "in_review", "created"];

  if (mp.ok && info.status === "processed") {
    const applied = await apply(order.id, data.id, "processed", info.status_detail, snapshot);
    return send(res, 200, { result: "approved", order: applied, payment: publicPayment(snapshot) });
  }

  if (mp.ok && pending.includes(info.status)) {
    const applied = await apply(order.id, data.id, info.status, info.status_detail, snapshot);
    return send(res, 200, { result: "pending", order: applied, payment: publicPayment(snapshot), detail: info.status_detail });
  }

  // Rechazo (402 con la order creada) o error de validación de MP (4xx sin order)
  const errors = Array.isArray(raw.errors) ? raw.errors : [];
  const detail = (info.status_detail !== "failed" && info.status_detail) || (errors[0] && (errors[0].code || errors[0].message)) || info.status_detail || "";
  console.warn("[mp] pago no aprobado", mp.status, order.id, JSON.stringify(raw).slice(0, 1200));
  await apply(order.id, data.id || "", "failed", detail, snapshot);

  if (mp.status >= 500) {
    throw new HttpError(502, "Mercado Pago no pudo procesar el pago. Tu tarjeta no fue cobrada; volvé a intentar en unos minutos.", { order: { id: order.id, number: order.number } });
  }
  const validation =
    mp.status === 400 && errors.length
      ? errors
          .map((e) => (Array.isArray(e.details) && e.details.length ? e.details.join("; ") : e.message || e.code))
          .filter(Boolean)
          .join(". ")
      : "";
  throw new HttpError(402, validation ? `Mercado Pago rechazó los datos: ${validation}` : rejectionMessage(detail), {
    result: "rejected",
    detail,
    order: { id: order.id, number: order.number },
  });
});

// Aplica el estado en la base con el service role (pagado / cancelado / pendiente)
async function apply(orderId, mpOrderId, status, detail, payment) {
  const rows = await rpc(
    "mp_apply_payment",
    { p_order: orderId, p_mp_order_id: mpOrderId || null, p_status: status, p_status_detail: detail || "", p_payment: payment || {} },
    { secret: true },
  );
  return Array.isArray(rows) ? rows[0] : rows;
}

function publicPayment(p) {
  return { brand: p.brand, last_four: p.last_four, installments: p.installments, installment_amount: p.installment_amount };
}
