document.addEventListener("DOMContentLoaded", () => {
  const motivoSelect = document.getElementById("motivo");
  const extraField = document.getElementById("motivoExtraField");

  if (!motivoSelect || !extraField) return;

  // Reemplazá esta lista por tu catálogo real de productos
  const productos = [
    "Computadoras",
    "Notebooks",
    "Placas de video",
    "Procesadores",
    "Memorias RAM",
    "Almacenamiento",
    "Motherboards",
    "Fuentes",
    "Gabinetes",
    "Refrigeración",
    "Teclados",
    "Mouse",
    "Auriculares",
    "Monitores",
    "Micrófonos",
    "Webcams",
    "Parlantes",
    "Mousepads",
  ];

  function crearSelectProductos(idCampo, textoLabel) {
    const label = document.createElement("label");
    label.setAttribute("for", idCampo);
    label.textContent = textoLabel;

    const select = document.createElement("select");
    select.id = idCampo;
    select.required = true;

    productos.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      select.appendChild(opt);
    });

    return [label, select];
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
});
