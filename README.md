# ComputerSell — Tienda + Panel

Sitio estático (HTML/CSS/JS sin build) conectado a **Supabase** (Auth, Postgres, Storage y Realtime).
Todo lo que se ve en la tienda y en el panel sale de la base y se actualiza en tiempo real.

## Estructura

```
├── *.html                    páginas (index, productos, detail, carrito, pago, perfil, compra-detalle,
│                             favoritos, acceso, admin-login, dashboard, nosotros, contacto)
├── assets/
│   ├── css/                  base, header, footer, components/, pages/
│   ├── icons/, images/
│   └── js/
│       ├── core/             env.js (generado), supabase.js, utils.js, catalog.js, cart.js, favorites.js, account.js
│       ├── components/       navbar, menu, carousel, loader
│       ├── pages/            un módulo por página (+ dashboard/data.js: datos y realtime del panel)
│       └── sprites/          sprites SVG
├── supabase/migrations/      esquema, RPCs, RLS, realtime y buckets (se aplica con npm run db:push)
├── scripts/                  dev server, build-env, db-push, sync-admins, configure-auth
├── .env                      tokens y configuración (no se sube) — ver .env.example
└── vercel.json               build: genera env.js; cleanUrls
```

## Puesta en marcha

```bash
npm run setup     # aplica migraciones + sincroniza admins + configura auth + genera env.js
npm run dev       # http://localhost:3000
```

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

## Vercel

Variables de entorno en el proyecto: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`.
Después del primer deploy, agregar el dominio a `EXTRA_REDIRECT_URLS` (o `SITE_URL`) y correr `npm run auth:configure`.
