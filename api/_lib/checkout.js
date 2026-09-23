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

// Ítems del body -> [{product_id, qty}] (sin repetidos)
function parseItems(raw) {
  const out = new Map();
  (Array.isArray(raw) ? raw : []).forEach((it) => {
    const id = str(it && it.product_id, 64);
    if (!UUID.test(id)) return;
    out.set(id, (out.get(id) || 0) + Math.max(1, parseInt(it.qty, 10) || 1));
  });
  if (!out.size) throw new HttpError(400, "El carrito está vacío");
  return Array.from(out, ([product_id, qty]) => ({ product_id, qty }));
}

// Datos del comprador y dirección de envío del body
function parseCustomer(body, user) {
  const c = body.customer || {};
  const a = body.address || {};
  const address = {
    calle: str(a.calle, 120),
    numero: str(a.numero, 12),
    piso: str(a.piso, 60),
    cp: str(a.cp, 12),
    ciudad: str(a.ciudad, 60),
    provincia: str(a.provincia, 60),
  };
  const customer = {
    name: str(c.name, 120),
    email: str(c.email, 120).toLowerCase() || str(user.email, 120).toLowerCase(),
    phone: str(c.phone, 40),
    dni: str(c.dni, 20),
    address: str(c.address, 300),
    province: address.provincia,
  };
  if (!customer.name || !customer.email) throw new HttpError(400, "Faltan datos del comprador");
  if (!address.provincia) throw new HttpError(400, "Elegí la provincia de envío");
  return { customer, address };
}

// Calcula el total y crea la orden. Devuelve {order, quote}.
// Los productos se leen con la sesión del comprador (token): el service role
// de este proyecto solo ejecuta RPCs, no tiene permisos sobre las tablas.
// beforeCreate(quote): validación extra antes de crear la orden (puede tirar).
async function placeOrder({ user, token, method, items, installments, customer, beforeCreate }) {
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
      },
      { secret: true },
    );
  } catch (e) {
    // Los errores de place_order (stock, precios) son mensajes para el comprador
    if (e instanceof HttpError && e.status === 400) throw new HttpError(409, e.message);
    throw e;
  }
  const order = Array.isArray(placed) ? placed[0] : placed;
  if (!order || !order.id) throw new HttpError(500, "No pudimos crear la orden");
  return { order, quote };
}

module.exports = { pricing, parseItems, parseCustomer, placeOrder };
