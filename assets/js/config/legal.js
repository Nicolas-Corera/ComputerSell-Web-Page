// Datos de ComputerSell para las páginas legales y el footer.
//
// Los textos legales no repiten estos datos a mano: se inyectan en el HTML con
// data-legal="campo" (ver assets/js/core/legal.js). Cambiás un dato acá y se
// actualiza en todas las páginas.
//
// - Lo que ya existe en SELLER (assets/js/config/seller.js, lo usa también la
//   nota de venta) se toma de ahí: completalo en SELLER, no acá.
// - PENDIENTE("…") marca un dato sin completar: en la página se ve resaltado
//   y la consola avisa qué falta.
import { SELLER } from "./seller.js";

const PENDIENTE = (que) => `[COMPLETAR: ${que}]`;
export const isPendiente = (v) => typeof v === "string" && v.startsWith("[COMPLETAR");

export const LEGAL = {
  // --- Tienda ---
  // Hoy el sitio se identifica solo con el nombre de fantasía y los datos de
  // contacto (sin razón social, CUIT, condición fiscal ni domicilio legal).
  nombreFantasia: SELLER.name,

  // --- Contacto y atención al consumidor ---
  emailContacto: SELLER.email,
  emailPrivacidad:"privacidad@computersell.com.ar",
  telefono: SELLER.phone,
  whatsapp: "+54 9 11 4094-2695",
  // TEMPORAL (hasta ~2027-01-05): los mails a contacto@ / soporte@ llegan a
  // Resend pero no a la casilla de Gmail. Mientras sea true, todo contacto se
  // deriva a WhatsApp: los links a emailContacto pasan a WhatsApp, se ocultan
  // los renglones marcados con data-legal-email y el formulario de contacto
  // abre WhatsApp en vez de mandar un mail. Para volver al email: false.
  emailPausado: true,
  // Disp. 954/2025 art. 6: atención mínima de 8 h diarias de lunes a viernes
  // (o el horario comercial) por teléfono, email o sitio web.
  horarioAtencion: "Lunes a viernes de 09:00 a 19:00 hs. Sábados de 10:00 a 14:00 hs.",

  // --- Plazos comerciales (se citan en Términos y Política de venta) ---
  // Un pedido por transferencia sin comprobante se cancela solo a las 48 hs
  // (expire_stale_transfer_orders, migración 0030).
  plazoPagoTransferencia: "48 horas",

  // --- Jurisdicción ---
  // En contratos de consumo a distancia la prórroga de jurisdicción se
  // tiene por no escrita y es competente el lugar donde el consumidor recibió o
  // debió recibir el producto (art. 1109 CCyC; art. 36 Ley 24.240 en operaciones
  // de crédito). CABA solo aplicaría a quien no es consumidor.
  jurisdiccion:
    "los tribunales ordinarios competentes del domicilio del consumidor o del lugar donde recibió o debió recibir el producto (art. 1109 del Código Civil y Comercial). Para quienes no revistan el carácter de consumidores, los Tribunales Ordinarios de la Ciudad Autónoma de Buenos Aires",

  // --- Vigencia de los documentos ---
  fechaVigencia: "2026-10-10", // se muestra como "10 de octubre de 2026"
  version: "3.3", // subir en cada cambio de los textos
  // Versión de la Política de cookies: si cambia, el banner vuelve a pedir el consentimiento.
  versionCookies: "3.0",

  // --- Links externos ---
  sitioWeb: "https://computersell.com.ar",
};

// Documentos legales (footer, "Otros documentos" y sitemap). Ruta = cleanUrls de tienda/<slug>.html
export const LEGAL_PAGES = [
  { slug: "terminos", title: "Términos y condiciones" },
  { slug: "privacidad", title: "Política de privacidad" },
  { slug: "cookies", title: "Política de cookies" },
  { slug: "politica-de-venta", title: "Política de venta" },
  { slug: "envios", title: "Envíos" },
  { slug: "cambios-y-devoluciones", title: "Cambios y devoluciones" },
  { slug: "arrepentimiento", title: "Botón de arrepentimiento" },
  { slug: "informacion-legal", title: "Información legal" },
];
