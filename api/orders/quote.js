// POST /api/orders/quote — recargo del pago con tarjeta para el carrito.
//
// El recargo depende del costo y del margen de cada producto, que el navegador
// no puede ver (products.cost está oculto). El checkout le pide acá, con la
// sesión, el recargo en pesos de cada opción (crédito en 1/3/6 cuotas y
// débito) para esos productos y esa provincia; nunca recibe costos ni márgenes.
//
// Body: { items: [{product_id, qty}], province }
// Respuesta: 200 { card: { credito: {1, 3, 6}, debito: {1} }, shipping, subtotal }
const { handler, send, readJson, requireUser, HttpError } = require("../_lib/mp");
const { parseItems, buildQuote, pricing } = require("../_lib/checkout");

module.exports = handler(["POST"], async (req, res) => {
  const { token } = await requireUser(req);
  const body = await readJson(req);
  const items = parseItems(body.items);
  const province = typeof body.province === "string" ? body.province : "";
  if (!pricing.PROVINCES.includes(province)) throw new HttpError(400, "Elegí la provincia de envío");
  const { quote, card } = await buildQuote({ token, items, province, method: "transferencia", installments: 1, withTable: true });
  send(res, 200, { card, shipping: quote.shipping, subtotal: quote.subtotal });
});
