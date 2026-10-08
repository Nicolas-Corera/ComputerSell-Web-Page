// Creación de la orden en el backend (tarjeta y transferencia).
//
// Calcula envío, recargo por tarjeta y recargo por cuotas con el mismo código
// que el checkout (assets/js/core/pricing.js + assets/js/config/*.js) a partir
// de los productos de la base, y crea la orden con place_order (service role).
// place_order valida stock y vuelve a sumar el subtotal bloqueando las filas:
// nunca se usa un monto que venga del navegador.
const pricing = require("../../assets/js/core/pricing.js");
const { HttpError, rpc, sbFetch } = require("./mp");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max || 200);

// Topes (los mismos que aplica place_order en la base)
const MAX_QTY = 10;
const MAX_LINES = 30;

// Ítems del body -> [{product_id, qty}] (sin repetidos)
function parseItems(raw) {
  const out = new Map();
  (Array.isArray(raw) ? raw : []).slice(0, 200).forEach((it) => {
    const id = str(it && it.product_id, 64);
    if (!UUID.test(id)) return;
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, "Cantidad inválida en el carrito");
    out.set(id, (out.get(id) || 0) + qty);
  });
  if (!out.size) throw new HttpError(400, "El carrito está vacío");
  if (out.size > MAX_LINES) throw new HttpError(400, `El pedido tiene demasiados productos distintos (máximo ${MAX_LINES}).`);
  if (Array.from(out.values()).some((q) => q > MAX_QTY))
    throw new HttpError(400, `Podés comprar hasta ${MAX_QTY} unidades de cada producto por pedido. Si necesitás más, escribinos por WhatsApp.`);
  return Array.from(out, ([product_id, qty]) => ({ product_id, qty }));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{M}\s'.-]*$/u;

// Datos del comprador y dirección de envío del body. Se validan igual que el
// formulario: sin dirección, teléfono o DNI no se puede despachar ni emitir la nota.
function parseCustomer(body, user) {
  const c = (body && body.customer) || {};
  const a = (body && body.address) || {};
  const address = {
    calle: str(a.calle, 120),
    numero: str(a.numero, 12),
    piso: str(a.piso, 60),
    cp: str(a.cp, 12),
    ciudad: str(a.ciudad, 60),
    provincia: str(a.provincia, 60),
  };
  const phone = str(c.phone, 40);
  const dni = str(c.dni, 20);
  const customer = {
    name: str(c.name, 120),
    email: str(c.email, 120).toLowerCase() || str(user.email, 120).toLowerCase(),
    phone,
    dni,
    province: address.provincia,
  };
  const fail = (msg) => {
    throw new HttpError(400, msg);
  };
  if (!customer.name || !NAME_RE.test(customer.name)) fail("Revisá tu nombre y apellido");
  if (!EMAIL_RE.test(customer.email)) fail("Ingresá un email válido");
  const phoneDigits = phone.replace(/\D/g, "");
  if (phoneDigits.length < 8 || phoneDigits.length > 15 || /[^\d\s()+-]/.test(phone)) fail("Ingresá un teléfono válido");
  const dniDigits = dni.replace(/\D/g, "");
  if (dniDigits.length < 7 || dniDigits.length > 11 || /[^\d.\s-]/.test(dni)) fail("Ingresá un DNI válido");
  if (!pricing.PROVINCES.includes(address.provincia)) fail("Elegí la provincia de envío");
  if (!address.calle) fail("Completá la calle");
  if (!/^\d{1,6}[a-zA-Z]?$/.test(address.numero) && !/^s\/?n$/i.test(address.numero)) fail("Revisá el número de la dirección");
  if (!/^([A-Za-z]\d{4}[A-Za-z]{3}|\d{4})$/.test(address.cp)) fail("Revisá el código postal (4 números o el formato nuevo, p. ej. C1425ABC)");
  if (!address.ciudad) fail("Completá la ciudad o localidad");
  customer.address = [`${address.calle} ${address.numero}`.trim(), address.piso, address.cp, address.ciudad, address.provincia]
    .filter(Boolean)
    .join(", ")
    .slice(0, 300);
  return { customer, address };
}

// Calcula el total y crea la orden. Devuelve {order, quote}.
// Los productos se leen con la sesión del comprador (token): el service role
// de este proyecto solo ejecuta RPCs, no tiene permisos sobre las tablas.
// beforeCreate(quote): validación extra antes de crear la orden (puede tirar).
async function placeOrder({ user, token, method, items, installments, customer, beforeCreate, expectedTotal, clientKey }) {
  const ids = items.map((it) => it.product_id);
  const rows = await sbFetch(`/rest/v1/products?id=in.(${ids.join(",")})&status=eq.publicado&select=id,price,weight,weight_unit,free_shipping,installments`, { token });
  const byId = new Map((rows || []).map((r) => [r.id, r]));
  if (ids.some((id) => !byId.has(id))) throw new HttpError(409, "Un producto del carrito ya no está disponible");

  const quote = pricing.quote({
    items: items.map((it) => {
      const p = byId.get(it.product_id);
      return { price: p.price, qty: it.qty, weight: p.weight, weightUnit: p.weight_unit, freeShipping: p.free_shipping, installments: p.installments };
    }),
    province: customer.province,
    method,
    installments,
  });
  if (!quote.valid) throw new HttpError(400, "Esa cantidad de cuotas no está disponible para este pedido");
  // El precio cambió entre que el cliente vio el total y confirmó: se avisa
  // en lugar de cobrar otro monto (el navegador manda el total que mostró)
  if (expectedTotal != null && Number(expectedTotal) !== quote.total)
    throw new HttpError(409, `El total cambió a $${quote.total.toLocaleString("es-AR")} (se actualizaron precios o envío). Revisá el resumen y confirmá de nuevo.`, { code: "total_changed", total: quote.total });
  if (beforeCreate) await beforeCreate(quote);

  let placed;
  try {
    placed = await rpc(
      "place_order",
      {
        p_user: user.id,
        p_items: items,
        p_payment_method: method,
        p_customer: customer,
        p_installments: quote.installments,
        p_subtotal: quote.subtotal,
        p_shipping_cost: quote.shipping,
        p_surcharge: quote.cardSurcharge + quote.installmentSurcharge,
        p_note: "",
        p_client_key: clientKey && UUID.test(clientKey) ? clientKey : null,
      },
      { secret: true },
    );
  } catch (e) {
    // Los errores de place_order (stock, precios, límites) son mensajes para el
    // comprador; un error de Postgres sin traducir (p. ej. "out of range") no
    if (e instanceof HttpError && e.status === 400) {
      if (/[a-z]+ .*(violates|out of range|invalid input|syntax|relation|column)/i.test(e.message) && !/[áéíóúñ]/i.test(e.message))
        throw new HttpError(409, "No pudimos crear el pedido con esos datos. Revisá el carrito y volvé a intentar.");
      throw new HttpError(409, e.message);
    }
    throw e;
  }
  const order = Array.isArray(placed) ? placed[0] : placed;
  if (!order || !order.id) throw new HttpError(500, "No pudimos crear la orden");
  return { order, quote };
}

module.exports = { pricing, parseItems, parseCustomer, placeOrder, UUID };
