// POST /api/orders/quote — recargo del pago con tarjeta para el carrito.
//
// El recargo depende del costo y del margen de cada producto, que el navegador
// no puede ver (products.cost está oculto). El checkout le pide acá, con la
// sesión, el recargo en pesos de cada opción (crédito en 1/3/6 cuotas y
// débito) para esos productos y esa provincia; nunca recibe costos ni márgenes.
//
// Como el recargo depende del costo de cada producto, consultarlo en cantidad
// permitiría estimar costos y márgenes: la sesión es obligatoria y hay un
// límite de consultas por usuario y por IP (429).
//
// Body: { items: [{product_id, qty}], province }
// Respuesta: 200 { card: { credito: {1, 3, 6}, debito: {1} }, shipping, subtotal }
const { handler, send, readJson, requireUser, HttpError } = require("../_lib/mp");
const { rateLimit, clientIp } = require("../_lib/mail");
const { parseItems, buildQuote, pricing } = require("../_lib/checkout");

module.exports = handler(["POST"], async (req, res) => {
  const { user, token } = await requireUser(req);
  // Un cliente real consulta unas pocas veces (provincia, cantidades): estos
  // topes no lo afectan, pero cortan un barrido de productos
  const ip = clientIp(req);
  const allowed = await rateLimit([
    { key: "quote:u10m:" + user.id, limit: 40, window: 600 },
    { key: "quote:uday:" + user.id, limit: 400, window: 86400 },
    { key: "quote:ip10m:" + ip, limit: 120, window: 600 },
  ]);
  if (!allowed) throw new HttpError(429, "Hiciste muchas consultas seguidas. Esperá unos minutos y volvé a intentar.");
  const body = await readJson(req);
  const items = parseItems(body.items);
  const province = typeof body.province === "string" ? body.province : "";
  if (!pricing.PROVINCES.includes(province)) throw new HttpError(400, "Elegí la provincia de envío");
  const { quote, card } = await buildQuote({ token, items, province, method: "transferencia", installments: 1, withTable: true });
  send(res, 200, { card, shipping: quote.shipping, subtotal: quote.subtotal });
});
