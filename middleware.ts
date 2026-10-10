// Routing Middleware de Vercel: corre en el servidor ANTES que cualquier
// archivo, rewrite o función, así que no se puede esquivar cambiando la URL.
//
// 1) Rutas con "../", barras invertidas, bytes nulos o su versión codificada
//    (en el camino o en los parámetros) -> 400. Nada del sitio las usa.
// 2) Modo mantenimiento (panel -> Tienda; public.store_settings.maintenance):
//    en el dominio de la tienda TODO pedido termina en /mantenimiento, sea la
//    ruta que sea (/productos, /tienda/carrito.html, /dash/..., ?id=...). Solo
//    pasan los estilos, imágenes y el script que usa esa página y el aviso interno de la
//    base (/api/notify-mail, con clave). El panel (dash.<dominio>) sigue
//    funcionando para poder desactivarlo, pero ahí tampoco se sirven páginas
//    de la tienda. Con el modo apagado, /mantenimiento vuelve al inicio.
//
// El estado se lee de Supabase con la anon key y se guarda unos segundos en
// memoria. Si Supabase no responde se usa el último valor conocido.

export const config = {
  runtime: "nodejs",
  // Imágenes, íconos y estilos son archivos estáticos: no hace falta revisarlos
  matcher: ["/((?!assets/css/|assets/images/|assets/icons/).*)"],
};

// Variables de entorno de Vercel (sin @types/node en el proyecto)
declare const process: { env: Record<string, string | undefined> };

const TTL_MS = 5000;
let cache: { value: boolean; at: number } | null = null;

async function inMaintenance(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) return cache ? cache.value : false;
  try {
    const r = await fetch(`${url}/rest/v1/store_settings?select=maintenance&id=eq.true`, {
      headers: { apikey: key, Authorization: "Bearer " + key },
      signal: AbortSignal.timeout(2000),
    });
    if (!r.ok) throw new Error("store_settings " + r.status);
    const rows = await r.json();
    cache = { value: !!(Array.isArray(rows) && rows[0] && rows[0].maintenance === true), at: now };
  } catch (e) {
    console.error("[middleware] no se pudo leer el modo mantenimiento", e);
    // Último valor conocido; se reintenta en el próximo pedido
    if (cache) cache.at = now - TTL_MS + 1000;
    return cache ? cache.value : false;
  }
  return cache.value;
}

// Traversal: "../" o "..\" (también al final), bytes nulos y barras invertidas
// en la ruta. Se revisa la URL decodificada hasta 3 veces ("%252e%252e%252f"
// es "../" codificado dos veces) y los "../" en UTF-8 inválido (%c0%ae).
const DOTS = /(^|[\/\\=&?,])\.\.([\/\\]|$|[&#?])|\x00/;
const RAW_BAD = /%c0%ae|%c0%af|%c1%9c|%e0%80%ae|%uff0e/i;

function decodeAll(s: string): string {
  let out = s;
  for (let i = 0; i < 3; i++) {
    let d: string;
    try {
      d = decodeURIComponent(out);
    } catch (e) {
      return out; // un "%" suelto (p. ej. "?q=100%") no es un ataque
    }
    if (d === out) break;
    out = d;
  }
  return out;
}

function isTraversal(pathname: string, search: string): boolean {
  if (RAW_BAD.test(pathname + search)) return true;
  const p = decodeAll(pathname);
  if (DOTS.test(p) || p.includes("\\")) return true;
  return DOTS.test(decodeAll(search.replace(/\+/g, " ")));
}

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location, ...NO_STORE } });
}

// Lo único que se sirve en la tienda durante el mantenimiento
const MAINTENANCE_PAGE = /^\/(mantenimiento|mantenimiento\.html|tienda\/mantenimiento(\.html)?)$/;
const ALWAYS_OPEN = /^\/(assets\/(css|images|icons|fonts)\/[^?]*|assets\/js\/pages\/mantenimiento\.js|favicon\.ico|robots\.txt|tienda\/(favicon\.ico|robots\.txt)|\.well-known\/security\.txt|api\/notify-mail)$/;

export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  // new URL() resuelve los "../" literales: se revisa también lo que mandó el cliente
  const raw = request.url.slice(url.origin.length);
  const q = raw.indexOf("?");
  const rawPath = q < 0 ? raw : raw.slice(0, q);
  const rawSearch = q < 0 ? "" : raw.slice(q);
  if (isTraversal(rawPath, rawSearch) || isTraversal(url.pathname, url.search)) {
    return new Response("Solicitud inválida", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
  }

  const path = url.pathname;
  const isDash = /^dash\./i.test(url.hostname);
  const onMaintenancePage = !isDash && MAINTENANCE_PAGE.test(path);
  if (isDash && !/^\/tienda(\/|$)/.test(path)) return; // el panel nunca se bloquea
  if (!isDash && !onMaintenancePage && ALWAYS_OPEN.test(path)) return;

  const active = await inMaintenance();
  if (!active) {
    if (onMaintenancePage) return redirect("/");
    return;
  }
  if (isDash) return redirect("/");
  if (onMaintenancePage) {
    // Siempre la misma URL: /mantenimiento (vercel.json la sirve desde tienda/)
    if (path !== "/mantenimiento") return redirect("/mantenimiento");
    return;
  }
  // APIs y pedidos que no son de navegación (fetch, formularios): 503 en JSON
  if (path.startsWith("/api/") || (request.method !== "GET" && request.method !== "HEAD")) {
    return new Response(JSON.stringify({ error: "La tienda está en mantenimiento. Volvé a intentar en un rato." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Retry-After": "600", ...NO_STORE },
    });
  }
  return redirect("/mantenimiento");
}
