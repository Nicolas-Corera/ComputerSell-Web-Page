# ComputerSell — Tienda + Panel

Sitio estático (HTML/CSS/JS sin build) conectado a **Supabase** (Auth, Postgres, Storage y Realtime).
Todo lo que se ve en la tienda y en el panel sale de la base y se actualiza en tiempo real.

## Estructura

```
├── tienda/                   páginas de la tienda (index, productos, detail, carrito, pago, perfil,
│                             compra-detalle, favoritos, acceso, nosotros, contacto) → dominio raíz
├── dash/                     panel de administración (index = dashboard, login) + css/ y js/ propios
│                             → subdominio dash.<dominio>
├── assets/                   compartido por tienda y panel
│   ├── css/                  base, header, footer, components/, pages/
│   ├── icons/, images/
│   └── js/
│       ├── core/             env.js (generado), supabase.js, utils.js, catalog.js, cart.js, favorites.js, account.js
│       ├── components/       navbar, menu, carousel, loader
│       ├── pages/            un módulo por página de la tienda (auth.js también lo usa el panel)
│       └── sprites/          sprites SVG
├── supabase/migrations/      esquema, RPCs, RLS, realtime y buckets (se aplica con npm run db:push)
├── scripts/                  dev server, build-env, db-push, sync-admins, configure-auth
├── .env                      tokens y configuración (no se sube) — ver .env.example
└── vercel.json               build: genera env.js; cleanUrls; ruteo por dominio (ver Vercel)
```

## Puesta en marcha

```bash
npm run setup     # aplica migraciones + sincroniza admins + configura auth + genera env.js
npm run dev       # tienda: http://localhost:3000 · panel: http://dash.localhost:3000
```

El servidor local reproduce el ruteo por dominio de Vercel: `localhost` sirve `tienda/` y `dash.localhost` sirve `dash/`
(los navegadores resuelven `*.localhost` solos, no hay que tocar el archivo hosts).

Comandos sueltos: `npm run db:push`, `npm run admins:sync`, `npm run auth:configure`, `npm run env`, `npm run firma`.

## Variables (.env)

| Variable | Uso |
| --- | --- |
| `SUPABASE` | access token de la Management API (solo scripts) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | públicos, van al navegador vía `assets/js/core/env.js` |
| `ADMIN_EMAILS` | correos que pueden crear cuenta en el panel (`npm run admins:sync`) |
| `SITE_URL`, `EXTRA_REDIRECT_URLS` | URLs permitidas para el login (`npm run auth:configure`) |
| `MAILER_AUTOCONFIRM` | `true` = sin verificación de correo (desarrollo) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | login con Google |
| `SUPABASE_SECRET_KEY` | solo scripts (`npm run firma`), nunca va al navegador |

## Nota de venta

Datos del vendedor en `assets/js/core/sale-note.js` (`SELLER`). La imagen de la firma (`assets/images/firma.png`) está ignorada por git: se sube al bucket privado `docs` con `npm run firma` y la nota la lee con URL firmada (solo usuarios con sesión).

## Google

1. Google Cloud Console → APIs y servicios → Credenciales → *ID de cliente OAuth 2.0* (aplicación web).
2. Orígenes autorizados: `http://localhost:3000` y el dominio de Vercel.
3. URI de redirección autorizada: `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Pegar `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en el `.env` y correr `npm run auth:configure`.

Con Google, el nombre y la foto de perfil se toman de la cuenta de Google.

## Modelo de datos

- `profiles` (1:1 con `auth.users`, rol `customer`/`admin`), `admin_allowlist`
- `products` (SKU único, imágenes en bucket `products`), `favorites`
- `orders` + `order_items` + `order_events` (timeline), `invoices`, `payment_receipts` (bucket `receipts`)
- `reservations`, `notifications` (panel y clientes)

RPCs: `place_order` (valida stock y precios, descuenta stock, emite factura si el pago se acredita),
`set_order_status` (admin; devuelve stock al cancelar, nota de crédito), `review_receipt` (admin),
`mark_notifications_read`. Todo protegido con RLS.

## Vercel (un solo proyecto, un solo repo)

La tienda y el panel se despliegan juntos; `vercel.json` rutea por dominio:

- `<dominio>` → `tienda/` (por ejemplo `/productos` sirve `tienda/productos.html`)
- `dash.<dominio>` → `dash/` (`/` es el dashboard, `/login` el acceso)
- `/assets/...` se sirve igual en los dos (la regla del host solo aplica a lo que no existe en la raíz)

Pasos:

1. Variables de entorno del proyecto: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`.
2. Settings → Domains: agregar `<dominio>` **y** `dash.<dominio>` al mismo proyecto (en el DNS, un CNAME `dash` → `cname.vercel-dns.com`).
3. En el `.env`: `SITE_URL=https://<dominio>` y `EXTRA_REDIRECT_URLS=https://dash.<dominio>,http://dash.localhost:3000`, y correr `npm run auth:configure`.
4. En Google Cloud, sumar `https://dash.<dominio>` a los orígenes autorizados.

Sin dominio propio (`*.vercel.app`) el panel también responde en `https://<proyecto>.vercel.app/dash`; los enlaces internos del panel son relativos, así que funciona en los dos lugares.
