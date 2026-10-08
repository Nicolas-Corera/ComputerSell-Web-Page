// GET /api/firma — imagen de la firma para la nota de venta.
//
// La firma manuscrita vive en el bucket privado "docs" y ya no se puede leer
// con cualquier sesión (migración 0031). Solo la recibe quien tiene una nota
// de venta vigente o un admin (can_view_signature, con la sesión del
// navegador), y se entrega acá con el service role: sin URLs firmadas que
// sirvan para siempre ni listado del bucket.
//
// Respuestas: 200 image/png, 401/403/404 {error}.
const { env, handler, HttpError, send, requireUser, rpc } = require("./_lib/mp");

module.exports = handler(["GET"], async (req, res) => {
  const { token } = await requireUser(req);
  const allowed = await rpc("can_view_signature", {}, { token });
  if (allowed !== true) throw new HttpError(403, "No autorizado");

  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new HttpError(500, "Falta la configuración de Supabase");
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/docs/firma.png`, {
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: "Bearer " + SUPABASE_SECRET_KEY },
  });
  if (r.status === 404 || r.status === 400) return send(res, 404, { error: "Sin firma" });
  if (!r.ok) throw new Error("storage " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 2 * 1024 * 1024 || buf.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("firma.png inválida");
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(buf);
});
