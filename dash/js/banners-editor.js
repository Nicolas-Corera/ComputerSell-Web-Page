// Panel -> Tienda -> Imágenes y banners.
//
// Editor visual: la tienda real (inicio) se abre dentro del panel con
// ?editor=1, con cada lugar de imagen marcado. Se toca un lugar (en la página
// o en la lista), se cargan las imágenes que irán ahí con su vigencia
// (desde / hasta) y la tienda se ve al instante como quedaría, incluso "el día X".
// Lo guardado lo muestra la tienda sola en la fecha indicada (ver
// assets/js/core/banners.js). La comunicación con la página es por postMessage,
// solo con el origen de la tienda.
import { storeUrl, publicUrl } from "/assets/js/core/supabase.js";
import { SLOTS, SLOT_BY_ID } from "/assets/js/config/banner-slots.js";
import { pickBanner, statusOf, nextChange, safeLink } from "/assets/js/core/banner-schedule.js";
import { BANNERS, uploadBannerFile, removeBannerFiles, saveBanner, deleteBanner } from "./data.js";

const STATUS = {
  live: ["Vigente", "is-ok"],
  scheduled: ["Programada", "is-info"],
  expired: ["Vencida", "is-muted"],
  off: ["Apagada", "is-warn"],
};
const ACCEPT = "image/png,image/jpeg,image/webp";

// ISO -> valor de <input type="datetime-local"> (hora local) y al revés
const pad = (n) => String(n).padStart(2, "0");
function toInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromInput = (v) => (v ? new Date(v).toISOString() : null);

export function initBannerEditor({ toast, confirmModal, escapeHtml: esc, fmtDateTime }) {
  const storeOrigin = new URL(storeUrl("/")).origin;
  let root = null; // overlay del editor (se crea al abrir por primera vez)
  let frame = null;
  let selected = ""; // slot elegido
  let draft = null; // formulario abierto: { id, file, mobileFile, imageUrl, mobileUrl, ... }
  let previewAt = ""; // valor datetime-local de "ver el día"

  const $ = (sel) => root.querySelector(sel);
  const range = (r) => (r.starts_at ? "desde " + fmtDateTime(r.starts_at) : "desde ya") + " · " + (r.ends_at ? "hasta " + fmtDateTime(r.ends_at) : "sin vencimiento");
  const thumb = (path) => (path ? publicUrl("banners", path) : "");

  // ---------- Resumen en la tarjeta de Tienda ----------
  function drawSummary() {
    const box = document.getElementById("bannersSummary");
    if (!box) return;
    const now = Date.now();
    box.innerHTML = SLOTS.map((s) => {
      const live = pickBanner(BANNERS, s.id, now);
      const next = nextChange(BANNERS.filter((r) => r.slot === s.id), now);
      const n = BANNERS.filter((r) => r.slot === s.id).length;
      return `<div class="bnRow">
        <div class="bnRow-img">${live ? `<img src="${esc(thumb(live.image_path))}" alt="" loading="lazy" />` : s.original ? `<img src="${esc(s.original)}" alt="" loading="lazy" />` : `<span>Original</span>`}</div>
        <div class="bnRow-text"><strong>${esc(s.label)}</strong>
          <small>${live ? "Vigente: " + esc(live.alt || "imagen cargada") : "Se ve la imagen original"}${next ? " · próximo cambio " + esc(fmtDateTime(next)) : ""}${n ? ` · ${n} cargada${n === 1 ? "" : "s"}` : ""}</small></div>
        <button class="btn btn-ghost is-sm" type="button" data-bn-slot="${esc(s.id)}">Editar</button>
      </div>`;
    }).join("");
  }

  // ---------- Vista previa ----------
  // Lo que se le manda a la tienda: lo guardado y, con un formulario abierto,
  // ese borrador solo en su lugar (así se ve cómo queda, sin importar sus fechas)
  function previewRows() {
    if (!draft) return BANNERS.map((r) => ({ ...r }));
    const rows = BANNERS.filter((r) => r.slot !== selected).map((r) => ({ ...r }));
    if (!draft.imageUrl) return rows; // sin imagen todavía: se ve la original
    const url = "@draft"; // la imagen va aparte (pushMedia), no en cada cambio
    rows.push({
      id: "draft",
      slot: selected,
      image_path: "",
      image_url: url,
      mobile_url: "@draft",
      link: draft.link,
      alt: draft.alt,
      legal: draft.legal,
      fit: draft.fit,
      zoom: draft.zoom,
      pos_x: draft.posX,
      pos_y: draft.posY,
      enabled: true,
      starts_at: null,
      ends_at: null,
      created_at: new Date().toISOString(),
    });
    return rows;
  }

  function push() {
    if (!frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: "cs-rows", rows: previewRows(), now: draft ? null : fromInput(previewAt), selected, pan: !!(draft && draft.imageUrl) },
      storeOrigin,
    );
  }

  // Las imágenes del borrador viajan una sola vez (pesan): las guardadas por su URL,
  // las recién elegidas como data:
  function pushMedia() {
    if (!frame || !frame.contentWindow || !draft) return;
    const image = draft.file ? draft.imageData : draft.imageUrl;
    const mobile = draft.mobileFile ? draft.mobileData : draft.removeMobile ? "" : draft.mobileUrl;
    frame.contentWindow.postMessage({ type: "cs-media", image, mobile }, storeOrigin);
  }

  function readData(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => resolve("");
      r.readAsDataURL(file);
    });
  }

  // Encuadre: lo que se mueve con el mouse en la página se refleja en los controles
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // ¿Hay algo que mover en cada eje? Solo si la imagen sobra del lugar (llenar: en el eje
  // más largo; mostrar completa: en el que deja bordes) o si tiene zoom
  function axes() {
    const slot = SLOT_BY_ID[selected];
    if (!draft || !draft.ratio || !slot) return { x: true, y: true };
    if (draft.zoom > 1.001) return { x: true, y: true };
    const box = slot.size[0] / slot.size[1];
    const wide = draft.ratio > box * 1.01;
    const tall = draft.ratio < box / 1.01;
    return draft.fit === "cover" ? { x: wide, y: tall } : { x: tall, y: wide };
  }

  function updateAxes() {
    if (!draft || !root || !$("#bnX")) return;
    const a = axes();
    $("#bnX").disabled = !a.x;
    $("#bnY").disabled = !a.y;
    $("#bnAxes").textContent =
      a.x && a.y
        ? ""
        : !a.x && !a.y
          ? "Con este tamaño la imagen ya ocupa todo el lugar y no hay nada que mover. Agrandá el zoom para recortarla y poder moverla."
          : (a.x ? "Solo se puede mover en horizontal" : "Solo se puede mover en vertical") + ": en el otro sentido la imagen ya ocupa todo el lugar. Con zoom se puede en ambos.";
  }

  // Proporción de la imagen elegida (para saber qué se puede mover)
  function loadRatio() {
    const d = draft;
    if (!d || !d.imageUrl) return;
    const src = d.imageUrl;
    const im = new Image();
    im.onload = () => {
      if (draft === d && d.imageUrl === src && im.naturalHeight) {
        d.ratio = im.naturalWidth / im.naturalHeight;
        updateAxes();
      }
    };
    im.src = src;
  }

  function frameChanged() {
    if (!draft || !root) return;
    const set = (id, v) => $(id) && ($(id).value = String(v));
    set("#bnFit", draft.fit);
    set("#bnZoom", draft.zoom);
    set("#bnX", Math.round(draft.posX));
    set("#bnY", Math.round(draft.posY));
    if ($("#bnZoomV")) $("#bnZoomV").textContent = draft.zoom.toFixed(2) + "×";
    updateAxes();
    push();
  }

  // ---------- Panel lateral ----------
  function drawSide() {
    const side = $("#bnSide");
    if (draft) return drawForm(side);
    if (!selected) return drawSlots(side);
    drawEntries(side);
  }

  function drawSlots(side) {
    side.innerHTML = `
      <h3>Elegí un lugar</h3>
      <p class="bnHint">Tocá una zona marcada en la página o elegila de la lista. Después cargás las imágenes y sus fechas.</p>
      <div class="bnSlots">${SLOTS.map((s) => {
        const live = pickBanner(BANNERS, s.id, Date.now());
        return `<button type="button" class="bnSlot" data-pick="${esc(s.id)}"><strong>${esc(s.label)}</strong><small>${s.size[0]}×${s.size[1]} px · ${live ? "con imagen vigente" : "imagen original"}</small></button>`;
      }).join("")}</div>`;
    side.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => select(b.dataset.pick)));
  }

  function drawEntries(side) {
    const s = SLOT_BY_ID[selected];
    const now = Date.now();
    const list = BANNERS.filter((r) => r.slot === selected).sort((a, b) => new Date(b.starts_at || 0) - new Date(a.starts_at || 0) || new Date(b.created_at) - new Date(a.created_at));
    const liveId = (pickBanner(BANNERS, selected, now) || {}).id;
    side.innerHTML = `
      <button class="btn-text bnBack" type="button" id="bnBack">← Todos los lugares</button>
      <h3>${esc(s.label)}</h3>
      <p class="bnHint">Medida recomendada ${s.size[0]}×${s.size[1]} px (PNG, JPG o WebP, hasta 5 MB).${s.note ? " " + esc(s.note) : ""} Si hay varias vigentes a la vez se muestra la que empezó más tarde. Sin ninguna vigente se ve la imagen original.</p>
      <button class="btn btn-secondary" type="button" id="bnNew"><svg><use href="#ic-add_photo_alternate" /></svg>Nueva imagen</button>
      <div class="bnList">${
        list.length
          ? list
              .map((r) => {
                const st = statusOf(r, now);
                return `<div class="bnItem${r.id === liveId ? " is-live" : ""}">
                  <img src="${esc(thumb(r.image_path))}" alt="" loading="lazy" />
                  <div class="bnItem-text">
                    <span class="badge ${STATUS[st][1]}">${STATUS[st][0]}</span>
                    <strong>${esc(r.alt || "Sin texto alternativo")}</strong>
                    <small>${esc(range(r))}</small>
                    ${r.link ? `<small>Link: ${esc(r.link)}</small>` : ""}
                  </div>
                  <div class="bnItem-actions">
                    <button class="btn btn-ghost is-sm" type="button" data-edit="${esc(r.id)}">Editar</button>
                    <button class="btn btn-ghost is-sm" type="button" data-toggle="${esc(r.id)}">${r.enabled ? "Apagar" : "Encender"}</button>
                    <button class="btn btn-ghost is-sm" type="button" data-del="${esc(r.id)}">Borrar</button>
                  </div>
                </div>`;
              })
              .join("")
          : `<p class="bnHint">Todavía no hay imágenes cargadas para este lugar.</p>`
      }</div>`;
    $("#bnBack").addEventListener("click", () => select(""));
    $("#bnNew").addEventListener("click", () => openForm(null));
    side.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openForm(BANNERS.find((r) => r.id === b.dataset.edit))));
    side.querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", async () => {
        const r = BANNERS.find((x) => x.id === b.dataset.toggle);
        if (!r) return;
        b.disabled = true;
        try {
          await saveBanner(r.id, { enabled: !r.enabled });
          toast(r.enabled ? "Imagen apagada" : "Imagen encendida", "ok");
        } catch (e) {
          console.error("[banners]", e);
          toast(e.message || "No se pudo cambiar", "bad");
        }
        b.disabled = false;
      }),
    );
    side.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        const r = BANNERS.find((x) => x.id === b.dataset.del);
        if (!r) return;
        if (!(await confirmModal({ title: "Borrar imagen", text: "Se borra esta carga y sus archivos. Si era la vigente, la tienda vuelve a la siguiente o a la imagen original.", okText: "Borrar", danger: true }))) return;
        try {
          await deleteBanner(r);
          toast("Imagen borrada", "ok");
        } catch (e) {
          console.error("[banners]", e);
          toast(e.message || "No se pudo borrar", "bad");
        }
      }),
    );
  }

  // ---------- Formulario ----------
  function openForm(row) {
    draft = {
      id: row ? row.id : null,
      row,
      file: null,
      mobileFile: null,
      imageUrl: row ? thumb(row.image_path) : "",
      mobileUrl: row && row.mobile_path ? thumb(row.mobile_path) : "",
      removeMobile: false,
      link: row ? row.link || "" : "",
      alt: row ? row.alt : "",
      legal: row ? row.legal || "" : "",
      startsAt: row ? toInput(row.starts_at) : "",
      endsAt: row ? toInput(row.ends_at) : "",
      enabled: row ? row.enabled : true,
      fit: row && row.fit === "contain" ? "contain" : "cover",
      zoom: row ? Number(row.zoom) || 1 : 1,
      posX: row && row.pos_x != null ? row.pos_x : 50,
      posY: row && row.pos_y != null ? row.pos_y : 50,
      ratio: 0,
      imageData: "", // la imagen elegida como data: (la tienda, en otro origen, no puede leer un blob:)
      mobileData: "",
    };
    drawSide();
    loadRatio();
    updateAxes();
    pushMedia();
    push();
  }

  function revoke(url) {
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
  }

  function closeForm() {
    if (draft) {
      if (draft.file) revoke(draft.imageUrl);
      if (draft.mobileFile) revoke(draft.mobileUrl);
    }
    draft = null;
    drawSide();
    push();
  }

  function drawForm(side) {
    const s = SLOT_BY_ID[selected];
    side.innerHTML = `
      <button class="btn-text bnBack" type="button" id="bnCancelTop">← Volver</button>
      <h3>${draft.id ? "Editar imagen" : "Nueva imagen"} · ${esc(s.label)}</h3>
      <p class="bnHint">La página de la izquierda muestra cómo queda en este lugar.</p>
      <form class="bnForm" id="bnForm" novalidate>
        <label class="field"><span>Imagen ${draft.id ? "" : "*"}</span><input type="file" id="bnFile" accept="${ACCEPT}" /></label>
        ${draft.imageUrl ? `<img class="bnPrev" src="${esc(draft.imageUrl)}" alt="" />` : ""}
        ${
          s.mobile
            ? `<label class="field"><span>Imagen para celular (opcional${s.mobileSize ? `, ${s.mobileSize[0]}×${s.mobileSize[1]} px` : ""})</span><input type="file" id="bnFileM" accept="${ACCEPT}" /></label>
               ${draft.mobileUrl && !draft.removeMobile ? `<div class="bnPrevRow"><img class="bnPrev" src="${esc(draft.mobileUrl)}" alt="" /><button class="btn btn-ghost is-sm" type="button" id="bnRmMobile">Quitar la imagen de celular</button></div>` : ""}`
            : ""
        }
        ${s.link ? `<label class="field"><span>Link al tocarla (opcional)</span><input type="text" id="bnLink" maxlength="300" placeholder="/productos?disponibilidad=oferta" value="${esc(draft.link)}" /></label>` : ""}
        ${s.legal ? `<label class="field"><span>Texto de abajo: condiciones de la campaña (opcional)</span><textarea id="bnLegal" rows="4" maxlength="600" placeholder="Ej.: Hasta 30% OFF en productos seleccionados, hasta el 18/10 o hasta agotar stock.">${esc(draft.legal)}</textarea></label>` : ""}
        ${draft.imageUrl ? `<fieldset class="bnFrame"><legend>Encuadre dentro del lugar</legend>
          <p class="bnHint">Arrastrá la imagen en la página para moverla y usá la rueda del mouse para agrandarla.</p>
          <label class="field"><span>Ajuste</span><select id="bnFit"><option value="cover"${draft.fit === "cover" ? " selected" : ""}>Llenar el lugar (recorta lo que sobra)</option><option value="contain"${draft.fit === "contain" ? " selected" : ""}>Mostrar completa (puede dejar bordes)</option></select></label>
          <label class="bnRange"><span>Zoom <b id="bnZoomV">${draft.zoom.toFixed(2)}×</b></span><input type="range" id="bnZoom" min="1" max="3" step="0.05" value="${draft.zoom}" /></label>
          <label class="bnRange"><span>Horizontal</span><input type="range" id="bnX" min="0" max="100" step="1" value="${Math.round(draft.posX)}" /></label>
          <label class="bnRange"><span>Vertical</span><input type="range" id="bnY" min="0" max="100" step="1" value="${Math.round(draft.posY)}" /></label>
          <p class="bnHint" id="bnAxes"></p>
          <button class="btn btn-ghost is-sm" type="button" id="bnCenter">Centrar y restablecer</button>
        </fieldset>` : ""}
        <label class="field"><span>Texto alternativo (describe la imagen)</span><input type="text" id="bnAlt" maxlength="200" value="${esc(draft.alt)}" /></label>
        <div class="bnDates">
          <label class="field"><span>Desde (vacío = ya)</span><input type="datetime-local" id="bnFrom" value="${esc(draft.startsAt)}" /></label>
          <label class="field"><span>Hasta (vacío = sin vencimiento)</span><input type="datetime-local" id="bnTo" value="${esc(draft.endsAt)}" /></label>
        </div>
        <label class="bnCheck"><input type="checkbox" id="bnEnabled" ${draft.enabled ? "checked" : ""} /> Activa (si la apagás no se muestra aunque esté en fecha)</label>
        <p class="bnError" id="bnError" role="alert" hidden></p>
        <div class="bnActions">
          <button class="btn btn-ghost" type="button" id="bnCancel">Cancelar</button>
          <button class="btn btn-secondary" type="submit" id="bnSave">Guardar</button>
        </div>
      </form>`;
    const err = (m) => {
      const el = $("#bnError");
      el.textContent = m;
      el.hidden = !m;
    };
    $("#bnCancelTop").addEventListener("click", closeForm);
    $("#bnCancel").addEventListener("click", closeForm);
    const sync = () => {
      draft.link = $("#bnLink") ? $("#bnLink").value : "";
      draft.alt = $("#bnAlt").value;
      draft.legal = $("#bnLegal") ? $("#bnLegal").value : "";
      draft.startsAt = $("#bnFrom").value;
      draft.endsAt = $("#bnTo").value;
      draft.enabled = $("#bnEnabled").checked;
    };
    const pick = (input, kind) =>
      input.addEventListener("change", () => {
        sync();
        const f = input.files && input.files[0];
        if (!f) return;
        if (!ACCEPT.split(",").includes(f.type)) return err("La imagen tiene que ser PNG, JPG o WebP.");
        if (f.size > 5 * 1024 * 1024) return err("La imagen pesa más de 5 MB.");
        if (kind === "main") {
          if (draft.file) revoke(draft.imageUrl);
          draft.file = f;
          draft.imageUrl = URL.createObjectURL(f);
          draft.imageData = "";
          draft.ratio = 0;
          loadRatio();
          readData(f).then((d) => draft && draft.file === f && ((draft.imageData = d), pushMedia(), push()));
        } else {
          if (draft.mobileFile) revoke(draft.mobileUrl);
          draft.mobileFile = f;
          draft.mobileUrl = URL.createObjectURL(f);
          draft.mobileData = "";
          readData(f).then((d) => draft && draft.mobileFile === f && ((draft.mobileData = d), pushMedia(), push()));
          draft.removeMobile = false;
        }
        drawSide();
        push();
      });
    pick($("#bnFile"), "main");
    if ($("#bnFileM")) pick($("#bnFileM"), "mobile");
    if ($("#bnRmMobile"))
      $("#bnRmMobile").addEventListener("click", () => {
        sync();
        if (draft.mobileFile) revoke(draft.mobileUrl);
        draft.mobileFile = null;
        draft.mobileUrl = "";
        draft.removeMobile = true;
        drawSide();
        push();
      });
    // El link y el texto se ven al instante en la vista previa
    if ($("#bnFit")) {
      $("#bnFit").addEventListener("change", (e) => ((draft.fit = e.target.value === "contain" ? "contain" : "cover"), frameChanged()));
      $("#bnZoom").addEventListener("input", (e) => ((draft.zoom = clamp(Number(e.target.value), 1, 3)), frameChanged()));
      $("#bnX").addEventListener("input", (e) => ((draft.posX = clamp(Number(e.target.value), 0, 100)), frameChanged()));
      $("#bnY").addEventListener("input", (e) => ((draft.posY = clamp(Number(e.target.value), 0, 100)), frameChanged()));
      $("#bnCenter").addEventListener("click", () => ((draft.fit = "cover"), (draft.zoom = 1), (draft.posX = 50), (draft.posY = 50), frameChanged()));
    }
    ["#bnLink", "#bnAlt", "#bnLegal"].forEach((id) => $(id) && $(id).addEventListener("input", () => (sync(), push())));
    $("#bnForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      sync();
      err("");
      if (!draft.id && !draft.file) return err("Elegí la imagen.");
      const link = draft.link.trim();
      if (link && !safeLink(link)) return err("El link tiene que empezar con / (una página de la tienda) o con https://.");
      const from = fromInput(draft.startsAt);
      const to = fromInput(draft.endsAt);
      if (from && to && new Date(to) <= new Date(from)) return err("La fecha de fin tiene que ser posterior a la de inicio.");
      const btn = $("#bnSave");
      btn.disabled = true;
      const uploaded = [];
      try {
        const fields = { slot: selected, link: link || null, alt: draft.alt.trim(), ...(s.legal ? { legal: draft.legal.trim() || null } : {}), starts_at: from, ends_at: to, enabled: draft.enabled, fit: draft.fit, zoom: Math.round(draft.zoom * 100) / 100, pos_x: Math.round(draft.posX), pos_y: Math.round(draft.posY) };
        if (draft.file) uploaded.push((fields.image_path = await uploadBannerFile(selected, draft.file)));
        if (draft.mobileFile) uploaded.push((fields.mobile_path = await uploadBannerFile(selected, draft.mobileFile)));
        else if (draft.removeMobile) fields.mobile_path = null;
        await saveBanner(draft.id, fields);
        // Los archivos reemplazados ya no se usan
        const old = draft.row;
        if (old) await removeBannerFiles([draft.file ? old.image_path : "", draft.mobileFile || draft.removeMobile ? old.mobile_path : ""]).catch(() => {});
        toast(draft.id ? "Imagen actualizada" : "Imagen cargada", "ok");
        closeForm();
      } catch (e2) {
        console.error("[banners]", e2);
        await removeBannerFiles(uploaded).catch(() => {});
        err(e2.message || "No se pudo guardar. Probá de nuevo.");
        btn.disabled = false;
      }
    });
  }

  // ---------- Navegación ----------
  function select(slot) {
    if (draft) closeForm();
    selected = slot;
    drawSide();
    push();
  }

  function setDevice(kind) {
    root.querySelectorAll("[data-dev]").forEach((b) => b.classList.toggle("is-on", b.dataset.dev === kind));
    $("#bnFrameWrap").classList.toggle("is-mobile", kind === "mobile");
  }

  function build() {
    root = document.createElement("div");
    root.className = "bnEditor";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Editor visual de imágenes y banners");
    root.hidden = true;
    root.innerHTML = `
      <header class="bnBar">
        <strong>Editor visual · imágenes y banners</strong>
        <div class="bnTools">
          <div class="bnSeg"><button type="button" data-dev="desktop" class="is-on">Escritorio</button><button type="button" data-dev="mobile">Celular</button></div>
          <label class="bnDate">Ver la tienda el día <input type="datetime-local" id="bnPreviewDate" /></label>
          <button class="btn btn-ghost is-sm" type="button" id="bnToday">Hoy</button>
          <button class="btn btn-secondary is-sm" type="button" id="bnClose">Cerrar</button>
        </div>
      </header>
      <div class="bnBody">
        <div class="bnStage"><div class="bnFrameWrap" id="bnFrameWrap"><iframe id="bnFrame" title="Vista previa de la tienda" referrerpolicy="strict-origin"></iframe></div></div>
        <aside class="bnSide" id="bnSide"></aside>
      </div>`;
    document.body.appendChild(root);
    frame = $("#bnFrame");
    root.querySelectorAll("[data-dev]").forEach((b) => b.addEventListener("click", () => setDevice(b.dataset.dev)));
    $("#bnClose").addEventListener("click", close);
    $("#bnPreviewDate").addEventListener("change", (e) => {
      previewAt = e.target.value;
      push();
    });
    $("#bnToday").addEventListener("click", () => {
      previewAt = "";
      $("#bnPreviewDate").value = "";
      push();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root && !root.hidden && !draft) close();
    });
    window.addEventListener("message", (e) => {
      if (!root || e.origin !== storeOrigin || e.source !== frame.contentWindow || !e.data) return;
      if (e.data.type === "cs-ready") (pushMedia(), push());
      // Con un formulario abierto el toque no cambia de lugar (el arrastre termina en un toque)
      if (e.data.type === "cs-slot-click" && SLOT_BY_ID[e.data.slot] && !draft) select(e.data.slot);
      if (draft && e.data.type === "cs-pan" && Number.isFinite(e.data.dx) && Number.isFinite(e.data.dy)) {
        // Arrastrar a la derecha mueve la imagen a la derecha: se ve más de su lado izquierdo
        const a = axes();
        if (a.x) draft.posX = clamp(draft.posX - e.data.dx, 0, 100);
        if (a.y) draft.posY = clamp(draft.posY - e.data.dy, 0, 100);
        frameChanged();
      }
      if (draft && e.data.type === "cs-zoom" && Number.isFinite(e.data.delta)) {
        draft.zoom = clamp(Math.round((draft.zoom + e.data.delta) * 20) / 20, 1, 3);
        frameChanged();
      }
    });
    frame.src = storeUrl("/?editor=1");
  }

  function open(slot) {
    if (!root) build();
    root.hidden = false;
    document.body.style.overflow = "hidden";
    selected = SLOT_BY_ID[slot] ? slot : "";
    draft = null;
    drawSide();
    push();
    $("#bnClose").focus();
  }

  function close() {
    if (!root) return;
    if (draft) closeForm();
    root.hidden = true;
    document.body.style.overflow = "";
  }

  // ---------- Enganche con la tarjeta de Tienda ----------
  const openBtn = document.getElementById("bannersOpen");
  if (openBtn) openBtn.addEventListener("click", () => open(""));
  const box = document.getElementById("bannersSummary");
  if (box)
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-bn-slot]");
      if (b) open(b.dataset.bnSlot);
    });
  drawSummary();

  return {
    // Cambió la tabla (acá o en otro admin): se redibuja sin pisar un formulario abierto
    refresh() {
      drawSummary();
      if (root && !root.hidden) {
        if (!draft) drawSide();
        push();
      }
    },
  };
}
