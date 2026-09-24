// POST /api/orders/transfer — orden pagada por transferencia.
//
// Crea la orden con el envío calculado en el backend (api/_lib/checkout.js):
// el navegador manda ítems, datos del comprador y dirección, nunca montos.
// Después el navegador sube el comprobante (storage "receipts" +
// payment_receipts) con su propia sesión, igual que antes.
//
// Respuestas: 200 {order}, 4xx/5xx {error}.
const { handler, send, readJson, requireUser } = require("../_lib/mp");
const { parseItems, parseCustomer, placeOrder } = require("../_lib/checkout");
const { sendOrderMail } = require("../_lib/mail");

module.exports = handler(["POST"], async (req, res) => {
  const { user, token } = await requireUser(req);
  const body = await readJson(req);
  const items = parseItems(body.items);
  const { customer } = parseCustomer(body, user);
  const { order } = await placeOrder({ user, token, method: "transferencia", items, installments: 1, customer });
  await sendOrderMail("orderReceived", { ...order, payment_method: "transferencia" }, customer, req);
  send(res, 200, { order });
});
