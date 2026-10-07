// Datos de quien vende. Fuente única: los usan la nota de venta
// (assets/js/core/sale-note.js) y los datos legales (assets/js/config/legal.js).
// No importa nada (ni Supabase), así que se puede cargar desde cualquier página.
// Este archivo es público: solo datos de contacto del comercio. El nombre
// completo, DNI/CUIT y datos bancarios se leen con el RPC seller_private()
// (solo con sesión) y se cargan desde el .env con `npm run seller:sync`.
export const SELLER = {
  name: "ComputerSell",
  address: "",
  phone: "+54 9 11 4094-2695",
  email: "contacto@computersell.com.ar",
};
