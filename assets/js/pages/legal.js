// Páginas legales (tienda/terminos.html, privacidad.html, …; base: tienda/plantilla-legal.html)
//
// - Inyecta los datos de LEGAL en los data-legal del contenido.
// - "Última actualización": LEGAL.fechaVigencia, o data-updated="AAAA-MM-DD"
//   en .legal-doc si ese documento cambió en otra fecha.
// - Arma el índice con las secciones (.legal-section > h2). La numeración
//   (1., 1.1) la pone el CSS; los ids de las secciones son las anclas.
// - Lista "Otros documentos" con LEGAL_PAGES.
import { LEGAL, LEGAL_PAGES, isPendiente } from "../config/legal.js";
import { fillLegal, formatDate } from "../core/legal.js";

const doc = document.getElementById("legalDoc");
const toc = document.getElementById("legalToc");
const MOBILE = window.matchMedia("(max-width: 991.98px)");

const slugify = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function buildToc(sections) {
  const list = toc.querySelector("ol");
  list.innerHTML = "";
  sections.forEach((section) => {
    const h2 = section.querySelector("h2");
    if (!section.id) section.id = slugify(h2.textContent);
    const a = document.createElement("a");
    a.href = "#" + section.id;
    a.textContent = h2.textContent.trim();
    const li = document.createElement("li");
    li.appendChild(a);
    list.appendChild(li);
  });

  // En mobile el índice arranca cerrado y se cierra al elegir una sección
  toc.open = !MOBILE.matches;
  MOBILE.addEventListener("change", (e) => (toc.open = !e.matches));
  list.addEventListener("click", (e) => {
    if (e.target.closest("a") && MOBILE.matches) toc.open = false;
  });

  // Sección visible resaltada en el índice
  const links = new Map([...list.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.remove("is-active"));
        const a = links.get(entry.target.id);
        if (a) a.classList.add("is-active");
      });
    },
    { rootMargin: "-20% 0px -70% 0px" },
  );
  sections.forEach((s) => io.observe(s));
}

function buildRelated() {
  const nav = document.getElementById("legalRelated");
  if (!nav) return;
  const current = location.pathname.replace(/\.html$/, "").replace(/\/$/, "").split("/").pop();
  const items = LEGAL_PAGES.filter((p) => p.slug !== current)
    .map((p) => `<li><a href="/${p.slug}">${p.title}</a></li>`)
    .join("");
  nav.innerHTML = `<h2>Otros documentos</h2><ul>${items}</ul>`;
}

// Canonical absoluto y datos estructurados (schema.org, JSON-LD) desde LEGAL.
// El HTML trae un canonical relativo (/terminos) que funciona sin JS; acá se
// completa con LEGAL.sitioWeb o, si todavía falta, con el dominio actual.
// Los datos pendientes ([COMPLETAR…]) no se publican.
function structuredData() {
  const ok = (v) => v != null && v !== "" && !isPendiente(v);
  const origin = (ok(LEGAL.sitioWeb) ? LEGAL.sitioWeb : location.origin).replace(/\/$/, "");
  const canonical = document.querySelector('link[rel="canonical"]');
  const path = canonical ? new URL(canonical.getAttribute("href"), location.origin).pathname : location.pathname.replace(/\.html$/, "");
  const url = origin + path;
  if (canonical) canonical.href = url;

  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const org = clean({
    "@type": "Organization",
    "@id": origin + "/#organizacion",
    name: LEGAL.nombreFantasia,
    url: origin,
    logo: origin + "/assets/images/isotipo.png",
    email: ok(LEGAL.emailContacto) ? LEGAL.emailContacto : undefined,
    telephone: ok(LEGAL.telefono) ? LEGAL.telefono : undefined,
  });
  const page = clean({
    "@type": "WebPage",
    "@id": url,
    url,
    name: (document.querySelector("h1") || {}).textContent,
    description: (document.querySelector('meta[name="description"]') || {}).content,
    inLanguage: "es-AR",
    dateModified: /^\d{4}-\d{2}-\d{2}$/.test(doc.dataset.updated || LEGAL.fechaVigencia) ? doc.dataset.updated || LEGAL.fechaVigencia : undefined,
    isPartOf: { "@type": "WebSite", url: origin, name: LEGAL.nombreFantasia },
    publisher: { "@id": org["@id"] },
  });
  const graph = [org, page];

  // Preguntas frecuentes: <details class="legal-faq"><summary>Pregunta</summary><div>Respuesta</div></details>
  // (las que tienen un dato pendiente no se publican hasta completarlo)
  const faqs = [...document.querySelectorAll("details.legal-faq")].filter((d) => !d.querySelector(".legal-pending"));
  if (faqs.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": url + "#preguntas",
      mainEntity: faqs.map((d) => ({
        "@type": "Question",
        name: d.querySelector("summary").textContent.trim(),
        // textContent: innerText viene vacío con el <details> cerrado
        acceptedAnswer: {
          "@type": "Answer",
          text: d.querySelector("summary + *").textContent.replace(/\s*\[REVISAR[^\]]*\]/g, "").replace(/\s+/g, " ").trim(),
        },
      })),
    });
  }

  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
  document.head.appendChild(script);
}

if (doc) {
  const time = document.querySelector(".legal-updated time");
  if (time && doc.dataset.updated) {
    time.removeAttribute("data-legal");
    time.textContent = formatDate(doc.dataset.updated);
    time.dateTime = doc.dataset.updated;
  }
  fillLegal(document.querySelector("main"));
  const sections = [...doc.querySelectorAll(":scope > .legal-section")].filter((s) => !s.hidden);
  if (toc && sections.length) buildToc(sections);
  else if (toc) toc.closest(".legal-aside").hidden = true;
  buildRelated();
  structuredData();
}
