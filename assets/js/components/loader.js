// Loader inicial: skeleton de página completa.
// Se carga arriba del body (después de .loader-wrap) para dibujar el
// esqueleto al instante. El sitio (.site) queda oculto hasta que TODO lo que
// viene de la base terminó de cargar y renderizarse.
//
// API (window.PageLoader):
//   PageLoader.wait(promesa)  -> el loader espera a que resuelva (se puede
//                                llamar varias veces: cuenta, perfil, favoritos…)
//   PageLoader.hold()         -> deja el loader puesto (redirecciones al login)
//   PageLoader.ready          -> promesa que resuelve cuando el sitio se mostró
//
// El loader se saca cuando: el DOM terminó de parsear, todas las promesas
// registradas resolvieron, las fuentes están listas y las imágenes visibles
// cargaron. Si la página no tiene .loader-wrap, la API es un no-op.
(function () {
  const MIN_SHOW = 350; // ms mínimos con el skeleton (evita parpadeo)
  const SETTLE = 80; // ms de gracia para promesas encadenadas
  const IMG_TIMEOUT = 8000; // tope de espera de imágenes
  const FONT_TIMEOUT = 3000; // tope de espera de fuentes
  const HARD_CAP = 20000; // red de seguridad si una request queda colgada

  const wrap = document.querySelector(".loader-wrap");
  const body = document.body;
  const site = () => document.getElementById("site");
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Sin loader en la página: API vacía y sitio visible
  if (!wrap) {
    body.classList.remove("is-loading");
    const s = site();
    if (s) s.classList.add("is-visible");
    window.PageLoader = { wait: (p) => p, hold() {}, ready: Promise.resolve() };
    return;
  }

  // ---------- Estado ----------
  const started = Date.now();
  let pending = 0;
  let domReady = false;
  let finished = false;
  let held = false;
  let timer = null;
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  const PageLoader = {
    ready,
    wait(p) {
      const promise = Promise.resolve(typeof p === "function" ? p() : p);
      if (finished) return promise;
      pending++;
      clearTimeout(timer);
      promise.catch(() => {}).then(() => {
        pending--;
        check();
      });
      return promise;
    },
    hold() {
      held = true;
      clearTimeout(timer);
    },
  };
  window.PageLoader = PageLoader;

  function check() {
    if (finished || held) return;
    clearTimeout(timer);
    if (!domReady || pending > 0) return;
    timer = setTimeout(() => {
      if (!held && pending === 0) finish();
    }, SETTLE);
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return Promise.race([document.fonts.ready, delay(FONT_TIMEOUT)]);
  }

  // Imágenes del sitio que están en pantalla (o cerca): se fuerzan a cargar y
  // se espera a que terminen. Las lejanas quedan lazy como siempre.
  function imagesReady() {
    const s = site();
    if (!s) return Promise.resolve();
    const limit = window.innerHeight * 1.5;
    const imgs = Array.from(s.querySelectorAll("img")).filter((img) => {
      if (!img.getAttribute("src") || img.complete) return false;
      return img.getBoundingClientRect().top < limit;
    });
    imgs.forEach((img) => {
      if (img.loading === "lazy") img.loading = "eager";
    });
    const all = Promise.all(
      imgs.map(
        (img) =>
          new Promise((res) => {
            if (img.complete) return res();
            img.addEventListener("load", res, { once: true });
            img.addEventListener("error", res, { once: true });
          }),
      ),
    );
    return Promise.race([all, delay(IMG_TIMEOUT)]);
  }

  async function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    await fontsReady();
    await imagesReady();
    const left = MIN_SHOW - (Date.now() - started);
    if (left > 0) await delay(left);
    reveal();
  }

  function reveal() {
    const s = site();
    if (s) s.classList.add("is-visible");
    body.classList.remove("is-loading");
    wrap.classList.add("is-done");
    wrap.setAttribute("aria-hidden", "true");
    const remove = () => wrap.parentNode && wrap.remove();
    wrap.addEventListener("transitionend", remove, { once: true });
    setTimeout(remove, 600);
    resolveReady();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      domReady = true;
      check();
    });
  } else {
    domReady = true;
    check();
  }
  setTimeout(() => {
    if (!held && !finished) finish();
  }, HARD_CAP);

  // ---------- Skeletons ----------
  const sk = (cls) => `<span class="sk ${cls || ""}"></span>`;
  const text = (cls) => sk(`sk-text ${cls || ""}`);
  const rep = (n, html) =>
    Array.from({ length: n }, (_, i) => (typeof html === "function" ? html(i) : html)).join("");

  const marquee = () => `<div class="sk-marquee">${rep(3, text("w-220 sm"))}</div>`;

  const nav = () => `
    <div class="sk-nav">
      <div class="sk-nav-logo">${sk("sk-circle")}${text("w-140 lg")}</div>
      <div class="sk-nav-links">${rep(5, text("w-90"))}</div>
      <div class="sk-nav-icons">${sk("sk-icon")}${sk("sk-icon")}${sk("sk-icon")}<span class="sk-nav-toggle">${sk("sk-icon")}</span></div>
    </div>`;

  const card = () => `
    <div class="sk-card">
      ${sk("sk-img")}
      <div class="sk-card-text">
        ${text("w-90p")}${text("w-60p")}
        <div class="sk-row">${text("w-80 sm")}${text("w-120 lg")}</div>
        ${text("w-50p sm")}
      </div>
      <div class="sk-card-actions">${sk("sk-btn grow")}${sk("sk-btn sq")}${sk("sk-btn sq")}</div>
    </div>`;

  const pageHead = (extra) => `
    <div class="sk-page-head">
      <div class="sk-stack">${sk("sk-title w-260")}${text("w-180")}</div>
      ${extra === undefined ? text("w-140") : extra}
    </div>`;

  const sectionHead = () => `
    <div class="sk-section-head">${sk("sk-title w-260")}${text("w-40p")}</div>`;

  const field = (cls) => `<div class="sk-field ${cls || ""}">${text("w-100 sm")}${sk("sk-input")}</div>`;
  const formGrid = (n) => `<div class="sk-form-grid">${rep(n, field())}</div>`;

  const item = () => `
    <div class="sk-item">
      ${sk("sk-thumb")}
      <div class="sk-stack">${text("w-70p")}${text("w-40p sm")}${text("w-100 lg")}</div>
      ${sk("sk-btn sq")}
    </div>`;

  const summaryPanel = () => `
    <div class="sk-panel">
      ${sk("sk-title w-140")}
      <div class="sk-row between">${text("w-80")}${text("w-100")}</div>
      <div class="sk-row between">${text("w-100")}${text("w-80")}</div>
      <div class="sk-row between">${text("w-60 lg")}${text("w-120 lg")}</div>
      ${sk("sk-btn w-full")}
      ${text("w-60p sm")}
    </div>`;

  const footer = () => `
    <div class="sk-footer"><div class="sk-container">
      <div class="sk-footer-top">
        <div class="sk-stack"><div class="sk-row">${sk("sk-circle")}${text("w-140 lg")}</div>${text("w-90p sm")}${text("w-80p sm")}${text("w-60p sm")}<div class="sk-row">${sk("sk-icon")}${sk("sk-icon")}${sk("sk-icon")}</div></div>
        ${rep(4, `<div class="sk-stack">${text("w-100 lg")}${rep(5, text("w-120 sm"))}</div>`)}
      </div>
      <div class="sk-row wrap" style="margin-bottom:1.5rem">${sk("sk-btn w-220")}${sk("sk-btn w-260")}${text("w-40p sm")}</div>
      <div class="sk-footer-bottom">${text("w-260 sm")}<div class="sk-row">${text("w-120 sm")}${text("w-80 sm")}</div>${text("w-180 sm")}</div>
    </div></div>`;

  const container = (html, cls) => `<div class="sk-container ${cls || ""}">${html}</div>`;
  const page = (html) => marquee() + nav() + container(html, "sk-page-container") + footer();

  const templates = {
    home() {
      const hero = `
        <div class="sk-hero"><div class="sk-hero-inner">
          <div class="sk-hero-copy">
            ${sk("sk-title xl w-90p")}${sk("sk-title xl w-70p")}
            <div style="height:8px"></div>
            ${text("w-90p")}${text("w-80p")}${text("w-60p")}
            <div class="sk-actions">${sk("sk-btn w-180")}${text("w-100")}</div>
          </div>
          <div class="sk-hero-visual">${sk("sk-block")}</div>
        </div></div>`;
      const main = `
        <div class="sk-section">${sectionHead()}<div class="sk-grid">${rep(4, card)}</div></div>
        ${sk("sk-block sk-banner")}
        <div class="sk-section">${sectionHead()}<div class="sk-carousel">${rep(6, card)}</div></div>
        <div class="sk-masonry">
          <div class="is-wide">${sk("sk-block")}</div>
          <div class="is-tall">${sk("sk-block")}</div>
          <div class="is-xtall">${sk("sk-block")}</div>
          <div class="is-tall">${sk("sk-block")}</div>
          <div>${sk("sk-block")}</div>
          <div class="is-wide">${sk("sk-block")}</div>
        </div>`;
      return marquee() + nav() + hero + container(main) + footer();
    },

    productos() {
      const bar = `
        <div class="sk-row between wrap" style="margin-bottom:1.5rem">
          <div class="sk-row wrap">${sk("sk-btn w-120")}${sk("sk-input w-260")}${sk("sk-input w-180")}</div>
          ${text("w-180")}
        </div>`;
      const group = () => `
        <div class="sk-filter-group">
          ${text("w-120 lg")}
          ${rep(4, `<div class="sk-check">${sk("sk-box")}${text("w-140 sm")}</div>`)}
        </div>`;
      return page(`
        ${pageHead("")}
        ${bar}
        <div class="sk-layout products">
          <div class="sk-filters">${rep(4, group)}</div>
          <div class="sk-grid compact">${rep(6, card)}</div>
        </div>`);
    },

    detail() {
      const crumb = `<div class="sk-row" style="margin-bottom:1rem">${text("w-60 sm")}${text("w-80 sm")}${text("w-180 sm")}</div>`;
      const layout = `
        <div class="sk-layout detail">
          <div class="sk-gallery">${sk("sk-img")}<div class="sk-thumbs">${rep(4, sk("sk-thumb"))}</div></div>
          <div class="sk-info">
            <div class="sk-row">${text("w-80 sm")}${text("w-100 sm")}</div>
            ${sk("sk-title w-90p")}${sk("sk-title w-60p")}
            <div style="height:6px"></div>
            ${text("w-120")}${sk("sk-title w-180")}${text("w-140 sm")}
            <div class="sk-row">${sk("sk-circle")}${text("w-120 sm")}</div>
            <div class="sk-row" style="margin-top:8px">${sk("sk-input w-140")}${sk("sk-btn w-220")}${sk("sk-btn sq")}</div>
            ${sk("sk-btn w-full")}
            <div class="sk-stack" style="margin-top:8px">${text("w-70p sm")}${text("w-60p sm")}${text("w-50p sm")}</div>
          </div>
        </div>
        <div class="sk-tabs">${text("w-100 lg")}${text("w-120 lg")}${text("w-140 lg")}</div>
        <div class="sk-stack">${text("w-90p")}${text("w-80p")}${text("w-70p")}${text("w-40p")}</div>
        <div class="sk-section">${sectionHead()}<div class="sk-grid">${rep(4, card)}</div></div>`;
      return page(crumb + layout);
    },

    favoritos() {
      return page(`${pageHead()}<div class="sk-grid compact">${rep(8, card)}</div>`);
    },

    carrito() {
      return page(`
        ${pageHead()}
        <div class="sk-layout cart">
          <div class="sk-col">${rep(3, item)}</div>
          ${summaryPanel()}
        </div>`);
    },

    perfil() {
      const aside = `
        <div class="sk-panel center">
          ${sk("sk-circle sk-avatar")}
          ${sk("sk-title w-180")}${text("w-220 sm")}
          ${sk("sk-btn w-180")}${text("w-120 sm")}
        </div>`;
      const form = `
        <div class="sk-panel">
          ${sk("sk-title w-220")}${text("w-60p sm")}
          <div class="sk-row">${sk("sk-icon")}${text("w-140 lg")}</div>
          ${formGrid(4)}
          <div class="sk-row" style="margin-top:8px">${sk("sk-icon")}${text("w-140 lg")}</div>
          ${formGrid(6)}
          <div class="sk-row" style="justify-content:flex-end">${sk("sk-btn w-140")}${sk("sk-btn w-180")}</div>
        </div>`;
      const tabs = `
        <div class="sk-tabs">${text("w-100 lg")}${text("w-100 lg")}${text("w-80 lg")}</div>
        <div class="sk-col">${rep(3, item)}</div>`;
      return page(`${pageHead()}<div class="sk-layout profile">${aside}${form}</div>${tabs}`);
    },

    pago() {
      const section = (n) => `
        <div class="sk-panel">
          <div class="sk-row">${sk("sk-circle")}${sk("sk-title w-220")}</div>
          ${formGrid(n)}
        </div>`;
      const payment = `
        <div class="sk-panel">
          <div class="sk-row">${sk("sk-circle")}${sk("sk-title w-220")}</div>
          <div class="sk-row wrap">${sk("sk-btn w-180")}${sk("sk-btn w-180")}${sk("sk-btn w-180")}</div>
          <div class="sk-two">
            ${sk("sk-block")}
            ${formGrid(4)}
          </div>
        </div>`;
      const summary = `
        <div class="sk-panel">
          ${sk("sk-title w-140")}
          ${rep(2, `<div class="sk-row">${sk("sk-thumb sm")}<div class="sk-stack" style="flex:1">${text("w-80p")}${text("w-40p sm")}</div></div>`)}
          <div class="sk-row between">${text("w-80")}${text("w-100")}</div>
          <div class="sk-row between">${text("w-100")}${text("w-80")}</div>
          <div class="sk-row between">${text("w-60 lg")}${text("w-120 lg")}</div>
          ${sk("sk-btn w-full")}
        </div>`;
      return page(`
        ${pageHead()}
        <div class="sk-layout checkout">
          <div class="sk-col">${section(4)}${section(6)}${payment}</div>
          ${summary}
        </div>`);
    },

    "compra-detalle"() {
      const head = `
        <div class="sk-page-head">
          <div class="sk-stack">${text("w-120 sm")}${sk("sk-title w-260")}${text("w-220 sm")}</div>
          <div class="sk-row">${sk("sk-btn w-180")}${sk("sk-btn w-140")}</div>
        </div>`;
      const stepper = `
        <div class="sk-panel"><div class="sk-stepper">
          ${rep(4, `<div class="sk-step">${sk("sk-circle")}${text("w-80 sm")}</div>`)}
        </div></div>`;
      const grid = `
        <div class="sk-layout order" style="margin-top:24px">
          <div class="sk-panel">${sk("sk-title w-180")}${rep(3, item)}</div>
          <div class="sk-col">${summaryPanel()}<div class="sk-panel">${sk("sk-title w-140")}${text("w-90p sm")}${text("w-70p sm")}${text("w-80p sm")}</div></div>
        </div>`;
      return page(head + stepper + grid);
    },

    contacto() {
      const info = `
        <div class="sk-info-grid">
          ${rep(3, `<div class="sk-panel">${sk("sk-icon")}${sk("sk-title w-140")}${text("w-90p sm")}${text("w-70p sm")}</div>`)}
        </div>`;
      const form = `
        <div class="sk-two" style="align-items:start">
          <div class="sk-panel">${sk("sk-circle")}${sk("sk-title w-220")}${text("w-90p sm")}${text("w-60p sm")}${sk("sk-btn w-180")}</div>
          <div class="sk-panel">${sk("sk-title w-220")}${formGrid(4)}${field("full")}<div class="sk-field">${text("w-100 sm")}${sk("sk-input")}${sk("sk-input")}</div>${sk("sk-btn w-180")}</div>
        </div>`;
      return page(pageHead() + info + form);
    },

    legal() {
      const toc = `<div class="sk-panel">${text("w-100 sm")}${rep(6, text("w-90p sm"))}</div>`;
      const section = () => `<div class="sk-stack" style="margin-bottom:2rem">${sk("sk-title w-260")}${text("w-90p")}${text("w-80p")}${text("w-60p")}</div>`;
      return page(`${pageHead()}<div class="sk-layout legal">${toc}<div>${text("w-80p lg")}<div style="height:1.5rem"></div>${rep(3, section)}</div></div>`);
    },

    nosotros() {
      const story = `
        <div class="sk-two" style="margin-bottom:4rem">
          ${sk("sk-block")}
          <div class="sk-stack">${sk("sk-title w-220")}${text("w-90p")}${text("w-80p")}${text("w-90p")}${text("w-60p")}</div>
        </div>`;
      const values = `
        ${sectionHead()}
        <div class="sk-info-grid values" style="margin-top:1.5rem">
          ${rep(4, `<div class="sk-panel">${sk("sk-icon")}${sk("sk-title w-140")}${text("w-90p sm")}${text("w-70p sm")}</div>`)}
        </div>
        <div class="sk-panel center" style="margin-bottom:3rem">${sk("sk-title w-260")}${text("w-50p")}${sk("sk-btn w-180")}</div>`;
      return page(pageHead() + story + values);
    },
  };

  function detectPage() {
    if (body.dataset.page) return body.dataset.page;
    const file = location.pathname.split("/").pop();
    if (!file || file === "index.html") return "home";
    return file.replace(/\.html$/, "");
  }

  const tpl = templates[detectPage()] || templates.favoritos;
  wrap.innerHTML = tpl();
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-label", "Cargando…");
})();
