import { CATEGORIES } from "/assets/js/core/supabase.js";

document.addEventListener("DOMContentLoaded", () => {
  const motivoSelect = document.getElementById("motivo");
  const extraField = document.getElementById("motivoExtraField");

  if (!motivoSelect || !extraField) return;

  function crearSelect(idCampo, textoLabel, opciones, required) {
    const label = document.createElement("label");
    label.setAttribute("for", idCampo);
    label.textContent = textoLabel;

    const select = document.createElement("select");
    select.id = idCampo;
    select.required = required;

    opciones.forEach(([value, text]) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      select.appendChild(opt);
    });

    return [label, select];
  }

  function crearSelectProductos(idCampo, textoLabel) {
    const [label, select] = crearSelect(idCampo, textoLabel, [["", "Seleccionar…"], ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])], true);
    const subField = document.createElement("div");
    subField.hidden = true;

    select.addEventListener("change", () => {
      const subs = (CATEGORIES[select.value] || { subs: [] }).subs;
      subField.innerHTML = "";
      subField.hidden = !subs.length;
      if (!subs.length) return;
      crearSelect("motivoSubcategoria", "Subcategoría", [["", "Sin subcategoría"], ...subs.map((s) => [s, s])], false).forEach((el) => subField.appendChild(el));
    });

    return [label, select, subField];
  }

  function crearInput(idCampo, textoLabel, placeholder) {
    const label = document.createElement("label");
    label.setAttribute("for", idCampo);
    label.textContent = textoLabel;

    const input = document.createElement("input");
    input.type = "text";
    input.id = idCampo;
    input.placeholder = placeholder;
    input.required = true;

    return [label, input];
  }

  const motivoRow = document.getElementById("motivoRow");
  const TRANSITION_MS = 350;
  let hideTimeout = null;

  function showExtraField(elementos) {
    clearTimeout(hideTimeout);
    extraField.innerHTML = "";
    elementos.forEach((el) => extraField.appendChild(el));

    // fuerza un reflow para que el navegador registre el estado inicial
    // antes de aplicar la clase, y así la transición se dispare
    void extraField.offsetWidth;

    motivoRow.classList.add("has-extra");
  }

  function hideExtraField() {
    motivoRow.classList.remove("has-extra");
    clearTimeout(hideTimeout);
    // esperamos a que termine la animación de salida antes de vaciar el campo
    hideTimeout = setTimeout(() => {
      extraField.innerHTML = "";
    }, TRANSITION_MS);
  }

  function renderExtraField(motivo) {
    let elementos = [];

    switch (motivo) {
      case "producto":
        elementos = crearSelectProductos("motivoProducto", "Producto");
        break;
      case "garantia":
        elementos = crearSelectProductos("motivoProducto", "Producto / equipo");
        break;
      case "pedido":
        elementos = crearInput(
          "motivoPedido",
          "Número de pedido",
          "Ej: #A1023",
        );
        break;
      case "otro":
        elementos = crearInput(
          "motivoOtro",
          "¿Cuál es el motivo de tu consulta?",
          "Especificá el motivo",
        );
        break;
      default:
        hideExtraField();
        return;
    }

    showExtraField(elementos);
  }

  motivoSelect.addEventListener("change", (e) => {
    renderExtraField(e.target.value);
  });

  // Por si el form carga con una opción distinta a la primera ya seleccionada
  renderExtraField(motivoSelect.value);

  const form = document.getElementById("contactForm");
  const status = document.getElementById("contactStatus");
  const submit = document.getElementById("contactSubmit");
  const openedAt = Date.now();
  const val = (id) => (document.getElementById(id) || { value: "" }).value.trim();

  function showStatus(text, ok) {
    status.hidden = false;
    status.textContent = text;
    status.style.color = ok ? "" : "#dc2626";
  }

  function detalle() {
    const cat = document.getElementById("motivoProducto");
    if (cat && cat.value) {
      const label = cat.options[cat.selectedIndex].textContent;
      const sub = document.getElementById("motivoSubcategoria");
      return sub ? `${label} · ${sub.value || "Sin subcategoría"}` : label;
    }
    return val("motivoPedido") || val("motivoOtro");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.hidden = true;
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: val("nombre"),
          apellido: val("apellido"),
          email: val("email"),
          telefono: val("telefono"),
          motivo: motivoSelect.value,
          detalle: detalle(),
          mensaje: val("mensaje"),
          website: val("website"),
          t: openedAt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No pudimos enviar tu consulta. Probá de nuevo.");
      form.reset();
      renderExtraField(motivoSelect.value);
      showStatus("¡Gracias! Recibimos tu consulta y te respondemos a la brevedad. Te mandamos una confirmación por email.", true);
    } catch (err) {
      showStatus(err.message || "No pudimos enviar tu consulta. Probá de nuevo.", false);
    } finally {
      submit.disabled = false;
    }
  });
});
