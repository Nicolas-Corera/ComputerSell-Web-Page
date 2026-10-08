// POST /api/orders/transfer — pedido pagado por transferencia.
//
// El pedido se crea ANTES de que el cliente transfiera: reserva el stock y fija
// el monto (el envío lo calcula el backend, api/_lib/checkout.js; el navegador
// manda ítems, datos del comprador y dirección, nunca montos). Recién con el
// pedido creado se le muestran los datos de la cuenta (seller_private) y sube
// el comprobante desde la confirmación o el detalle del pedido. Si no lo sube
// en 48 h, el pedido vence solo (expire_stale_transfer_orders).
//
// Body: { items, customer, address, expected_total, client_key }
//   expected_total: el total que vio el cliente; si cambió -> 409 total_changed
//   client_key: uuid del intento de compra; reintentar devuelve el mismo pedido
//
// Respuestas: 200 {order}, 4xx/5xx {error}.
const { handler, send, readJson, requireUser, HttpError } = require("../_lib/mp");
const { parseItems, parseCustomer, placeOrder } = require("../_lib/checkout");

module.exports = handler(["POST"], async (req, res) => {
  const { user, token } = await requireUser(req);
  const body = await readJson(req);
  const items = parseItems(body.items);
  const { customer } = parseCustomer(body, user);
  const expected = Number(body.expected_total);
  if (!Number.isInteger(expected) || expected <= 0) throw new HttpError(400, "Falta el total del pedido. Recargá la página.");
  const { order } = await placeOrder({
    user,
    token,
    method: "transferencia",
    items,
    installments: 1,
    customer,
    expectedTotal: expected,
    clientKey: typeof body.client_key === "string" ? body.client_key : null,
  });
  send(res, 200, { order });
});
