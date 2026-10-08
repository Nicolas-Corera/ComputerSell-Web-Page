// GET /sitemap.xml (rewrite en vercel.json) — sitemap para Google Search Console.
//
// Páginas fijas indexables + una entrada por producto publicado
// (/detail?id=...), con su updated_at como lastmod. Las páginas con
// <meta name="robots" content="noindex"> no van acá.
const { handler, sbFetch } = require("./_lib/mp");
const { siteUrl } = require("./_lib/mail");

const PAGES = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/productos", changefreq: "daily", priority: "0.9" },
  { path: "/nosotros", changefreq: "monthly", priority: "0.5" },
  { path: "/contacto", changefreq: "monthly", priority: "0.5" },
  { path: "/envios", changefreq: "monthly", priority: "0.5" },
  { path: "/cambios-y-devoluciones", changefreq: "monthly", priority: "0.5" },
  { path: "/informacion-legal", changefreq: "monthly", priority: "0.4" },
  { path: "/politica-de-venta", changefreq: "yearly", priority: "0.3" },
  { path: "/terminos", changefreq: "yearly", priority: "0.3" },
  { path: "/privacidad", changefreq: "yearly", priority: "0.3" },
  { path: "/cookies", changefreq: "yearly", priority: "0.3" },
  { path: "/arrepentimiento", changefreq: "yearly", priority: "0.3" },
];

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

const entry = ({ loc, lastmod, changefreq, priority }) =>
  "  <url>\n" +
  `    <loc>${xml(loc)}</loc>\n` +
  (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : "") +
  (changefreq ? `    <changefreq>${changefreq}</changefreq>\n` : "") +
  (priority ? `    <priority>${priority}</priority>\n` : "") +
  "  </url>\n";

module.exports = handler(["GET", "HEAD"], async (req, res) => {
  const base = siteUrl(req).replace(/\/+$/, "");
  const products = await sbFetch("/rest/v1/products?status=eq.publicado&select=id,updated_at&order=updated_at.desc");
  const latest = products.length ? products[0].updated_at.slice(0, 10) : undefined;

  const urls = [
    ...PAGES.map((p) => ({ ...p, loc: base + p.path, lastmod: p.changefreq === "daily" ? latest : undefined })),
    ...products.map((p) => ({ loc: `${base}/detail?id=${p.id}`, lastmod: p.updated_at.slice(0, 10), changefreq: "weekly", priority: "0.7" })),
  ];

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  // Cache en el CDN de Vercel: 1 h, y sirve la copia vieja mientras regenera
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400");
  res.end(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(entry).join("") +
      "</urlset>\n"
  );
});
