// Lugares de la tienda donde el panel puede cambiar la imagen o el banner
// (Tienda -> Imágenes y banners). Cada slot es un elemento del HTML con
// id="slot-<id>" y data-slot="<id>"; la imagen que ya trae el HTML es la
// "original" y es la que se ve cuando ninguna carga programada está vigente.
//
// Para sumar un lugar: agregá el id/data-slot en el HTML y una fila acá.
//   id      identificador fijo (minúsculas y guiones; es lo que guarda la base)
//   page    página donde está (hoy solo el inicio)
//   original imagen que trae el HTML (para mostrarla en el panel; tiene que coincidir con la del HTML)
//   label   nombre que ve el admin
//   size    medida recomendada (ancho × alto) y mobileSize si acepta versión celular
//   mobile  true si la versión celular tiene sentido en ese lugar
//   link    true si el lugar es clicable (el hero es solo una imagen)
//   ratio   true si la imagen de ese lugar toma su alto de la proporción (size) y no de un recuadro fijo
//   legal   true si lleva un texto debajo (condiciones de la campaña); en el HTML es el elemento [data-slot-default]
export const SLOTS = [
  { id: "home-hero", page: "home", original: "/assets/images/pc.webp", label: "Inicio · Imagen principal", size: [520, 520], mobile: false, link: false, ratio: true, note: "Mejor con fondo transparente (PNG o WebP): lleva sombra." },
  { id: "home-promo", page: "home", original: "/assets/images/bannerMotherDay.webp", label: "Inicio · Banner de campaña", size: [1600, 497], mobileSize: [800, 800], mobile: true, link: true, legal: true, ratio: true, note: "Se muestra solo si hay una carga vigente. El texto de abajo es el que cargues; sin texto no se muestra nada." },
  { id: "home-intercom", page: "home", original: "/assets/images/BANNER_INTERCOMSITE.webp", label: "Inicio · Banner ancho superior", size: [1400, 572], mobile: false, link: true },
  { id: "home-envios", page: "home", original: "/assets/images/envios.webp", label: "Inicio · Cuadrado envíos", size: [800, 800], mobile: false, link: true },
  { id: "home-vertical", page: "home", original: "/assets/images/tall_banner.webp", label: "Inicio · Banner vertical", size: [720, 1080], mobile: false, link: true },
  { id: "home-ofertas", page: "home", original: "/assets/images/bigsell.webp", label: "Inicio · Cuadrado ofertas", size: [800, 800], mobile: false, link: true },
  { id: "home-portfolio", page: "home", original: "/assets/images/portfolio.webp", label: "Inicio · Imagen servicios", size: [1000, 667], mobile: false, link: true },
  { id: "home-nosotros", page: "home", original: "/assets/images/banner3.webp", label: "Inicio · Banner ancho inferior", size: [1400, 560], mobile: false, link: true },
];

export const SLOT_BY_ID = Object.fromEntries(SLOTS.map((s) => [s.id, s]));
