// Página de mantenimiento: vuelve sola a la tienda apenas se desactiva el modo.
// Le pregunta al servidor por esta misma página cada pocos segundos: mientras
// dura el mantenimiento responde 200; cuando termina, middleware.ts la
// redirige al inicio. No necesita Supabase (durante el mantenimiento el
// servidor solo deja pasar este archivo, los estilos y las imágenes).
const EVERY_MS = 5000;

async function check() {
  try {
    const r = await fetch(location.pathname, { redirect: "manual", cache: "no-store" });
    if (r.type === "opaqueredirect" || r.redirected || (r.status >= 300 && r.status < 400)) location.replace("/");
  } catch (e) {
    // Sin conexión: se reintenta en la próxima vuelta
  }
}

setInterval(() => {
  if (!document.hidden) check();
}, EVERY_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) check();
});
