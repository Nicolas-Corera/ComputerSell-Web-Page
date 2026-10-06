// Datos de quien vende. Fuente única: los usan la nota de venta
// (assets/js/core/sale-note.js) y los datos legales (assets/js/config/legal.js).
// No importa nada (ni Supabase), así que se puede cargar desde cualquier página.
export const SELLER = {
  name: "ComputerSell",
  owner: "Nicolás Corera", // nombre completo de quien vende (aparece en "Vendedor" y en la firma)
  doc: "20465842920", // DNI o CUIT de quien vende, ej. "CUIT 20-12345678-9"
  address: "",
  phone: "+54 9 11 4094-2695",
  email: "contacto@computersell.com.ar",
};
