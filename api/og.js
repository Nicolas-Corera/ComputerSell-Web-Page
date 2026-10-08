// GET /api/og?id=<uuid> — vista previa de un producto para WhatsApp, Facebook,
// X, Telegram, etc. Esos bots no ejecutan JavaScript: sin esto todas las
// fichas se compartían con el mismo título y el logo.
//
// vercel.json manda acá /detail?id=… solo cuando el User-Agent es de un bot de
// previews; las personas siguen viendo la ficha normal (tienda/detail.html).
// Devuelve un HTML mínimo con las etiquetas Open Graph y un enlace a la ficha.
// Solo lee productos publicados (anon key + RLS) y escapa todo lo que imprime.
const { handler, sbFetch } = require("./_lib/mp");
const { siteUrl } = require("./_lib/mail");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => Number(n || 0).toLocaleString("es-AR");

function page({ title, description, image, url, price }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(url)}" />
<meta property="og:type" content="product" />
<meta property="og:site_name" content="ComputerSell" />
<meta property="og:locale" content="es_AR" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(url)}" />
<meta property="og:image" content="${esc(image)}" />
<meta name="twitter:card" content="summary_large_image" />
${price ? `<meta property="product:price:amount" content="${esc(price)}" />\n<meta property="product:price:currency" content="ARS" />` : ""}
</head>
<body>
<p><a href="${esc(url)}">${esc(title)}</a></p>
</body>
</html>`;
}

module.exports = handler(["GET", "HEAD"], async (req, res) => {
  const base = siteUrl(req).replace(/\/+$/, "");
  const id = new URL(req.url, "http://localhost").searchParams.get("id") || "";
  const fallback = {
    title: "ComputerSell — PCs armadas, notebooks y componentes",
    description: "Equipos armados, notebooks, tablets y componentes con garantía. Envíos a todo el país.",
    image: base + "/assets/images/isotipo-dark.png",
    url: base + "/productos",
  };
  let data = fallback;
  if (UUID.test(id)) {
    const rows = await sbFetch(`/rest/v1/products?id=eq.${id}&status=eq.publicado&select=id,title,brand,price,images,description`).catch(() => []);
    const p = Array.isArray(rows) ? rows[0] : null;
    if (p) {
      const desc = String(p.description || "").replace(/\s+/g, " ").trim();
      data = {
        title: `${p.title} — ComputerSell`,
        description: `$${money(p.price)} · ${desc ? desc.slice(0, 150) + (desc.length > 150 ? "…" : "") : `${p.brand || ""} con garantía y envío a todo el país.`.trim()}`,
        image: p.images && /^https:\/\//.test(p.images[0] || "") ? p.images[0] : fallback.image,
        url: `${base}/detail?id=${p.id}`,
        price: String(p.price),
      };
    }
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=600, stale-while-revalidate=86400");
  res.setHeader("X-Robots-Tag", "noindex");
  res.end(req.method === "HEAD" ? "" : page(data));
});
