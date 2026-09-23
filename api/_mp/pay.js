// POST /api/mp/pay — cobro con tarjeta (Mercado Pago Checkout API / Orders).
//
// El navegador tokeniza la tarjeta con el SDK de Mercado Pago (los datos
// nunca pasan por acá) y manda: ítems, datos del comprador y dirección, medio
// (crédito o débito), cuotas y el token. Este endpoint:
//   1. valida la sesión de Supabase (Authorization: Bearer <jwt>)
//   2. crea la orden (api/_lib/checkout.js): envío por peso y provincia,
//      recargo por tarjeta y por cuotas calculados acá; place_order valida
//      stock y precios en la base. Nunca se confía en un monto del cliente.
//   3. crea la order en Mercado Pago (POST /v1/orders, modo automático)
//   4. aplica el resultado con mp_apply_payment: pagado / cancelado / pendiente
//
// Respuestas: 200 {result:'approved'|'pending', order}, 402 {error, order}
// cuando la tarjeta rechazó, 4xx/5xx {error} en el resto.
const { handler, HttpError, send, readJson, requireUser, rpc, sbFetch, mpFetch, rejectionMessage, summarizeOrder } = require("../_lib/mp");
const { parseItems, parseCustomer, placeOrder } = require("../_lib/checkout");

const CARD_TYPES = { credito: "credit_card", debito: "debit_card" };

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

  const items = parseItems(body.items);

  const card = body.card || {};
  const cardToken = str(card.token, 128);
  const paymentMethodId = str(card.payment_method_id, 40);
  if (!cardToken) throw new HttpError(400, "Falta el token de la tarjeta");
  if (!paymentMethodId) throw new HttpError(400, "No pudimos identificar la tarjeta");

  const { customer, address: addr } = parseCustomer(body, user);
  const dni = digits(customer.dni);
  if (dni.length < 7 || dni.length > 8) throw new HttpError(400, "El DNI no es válido");

  const [firstName, ...rest] = customer.name.split(/\s+/);
  const lastName = rest.join(" ") || firstName;

  // ---------- 1. Orden en la base (total calculado acá) ----------
  const bin = digits(card.bin).slice(0, 8);
  const { order, quote } = await placeOrder({
    user,
    token,
    method,
    items,
    installments: body.installments,
    customer,
    beforeCreate: (q) => assertNoBuyerInterest(bin, q),
  });
  const installments = quote.installments;

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
    if (orderDetail.surcharge > 0) lines.push({ title: `Recargo pago con ${method === "credito" ? "tarjeta de crédito" : "tarjeta de débito"}`, unit_price: money(orderDetail.surcharge), quantity: 1, external_code: "RECARGO" });
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

// En cuotas, el total ya lleva nuestro recargo. Si Mercado Pago además le
// cobrara su propio interés al comprador (la cuenta no ofrece esa cantidad de
// cuotas sin interés para la tarjeta), pagaría más de lo que vio: no se cobra.
async function assertNoBuyerInterest(bin, quote) {
  if (quote.installments <= 1) return;
  const unavailable = new HttpError(400, "Tu tarjeta no admite esa cantidad de cuotas para este pedido. Elegí otra cantidad.");
  if (bin.length < 6) throw unavailable;
  const r = await mpFetch(`/v1/payment_methods/installments?amount=${quote.base}&bin=${bin}&payment_type_id=credit_card`);
  const plans = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].payer_costs || [] : null;
  if (!plans) throw new HttpError(502, "No pudimos consultar las cuotas con Mercado Pago. Volvé a intentar en unos minutos.");
  const plan = plans.find((p) => p.installments === quote.installments);
  if (!plan || Number(plan.installment_rate) > 0) throw unavailable;
}

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
