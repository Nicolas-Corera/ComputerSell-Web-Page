// POST /api/orders/quote — recargo del pago con tarjeta para el carrito.
//
// El recargo depende del costo y del margen de cada producto, que el navegador
// no puede ver (products.cost está oculto). El checkout le pide acá, con la
// sesión, el recargo en pesos de cada opción (crédito en 1/3/6 cuotas y
// débito) para esos productos, con el envío regional y con el nacional: así la
// provincia se resuelve en el navegador y el total aparece al instante. Nunca
// recibe costos ni márgenes.
//
// Como el recargo depende del costo de cada producto, consultarlo en cantidad
// permitiría estimar costos y márgenes: la sesión es obligatoria y hay un
// límite de consultas por usuario y por IP (429).
//
// Body: { items: [{product_id, qty}] }
// Respuesta: 200 { regional: T, national: T } con T = { credito: {1, 3, 6}, debito: {1} }
const { handler, send, readJson, requireUser, HttpError } = require("../_lib/mp");
const { rateLimit, clientIp } = require("../_lib/mail");
const { parseItems, buildQuote } = require("../_lib/checkout");

module.exports = handler(["POST"], async (req, res) => {
  const { user, token } = await requireUser(req);
  const body = await readJson(req);
  const items = parseItems(body.items);
  // Un cliente real consulta una vez por carrito: estos topes no lo afectan,
  // pero cortan un barrido de productos. Corre en paralelo con el cálculo.
  const ip = clientIp(req);
  const [allowed, result] = await Promise.all([
    rateLimit([
      { key: "quote:u10m:" + user.id, limit: 40, window: 600 },
      { key: "quote:uday:" + user.id, limit: 400, window: 86400 },
      { key: "quote:ip10m:" + ip, limit: 120, window: 600 },
    ]),
    buildQuote({ token, items, method: "transferencia", installments: 1, withZones: true }),
  ]);
  if (!allowed) throw new HttpError(429, "Hiciste muchas consultas seguidas. Esperá unos minutos y volvé a intentar.");
  send(res, 200, result.zones);
});
