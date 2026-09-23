# ComputerSell — Tienda + Panel

Sitio estático (HTML/CSS/JS sin build) conectado a **Supabase** (Auth, Postgres, Storage y Realtime).
Todo lo que se ve en la tienda y en el panel sale de la base y se actualiza en tiempo real.

## Estructura

```
├── tienda/                   páginas de la tienda (index, productos, detail, carrito, pago, perfil,
│                             compra-detalle, favoritos, acceso, nosotros, contacto) → dominio raíz
├── dash/                     panel de administración (index = dashboard, login) + css/ y js/ propios
│                             → subdominio dash.<dominio>
├── api/                      Vercel Functions: mp/pay.js (cobro con tarjeta) y mp/webhook.js
│                             (notificaciones de Mercado Pago); _lib/ helpers
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
│                             (en Vercel van como variables de entorno del proyecto)
└── vercel.json               build: genera env.js; cleanUrls; ruteo por dominio (ver Vercel)
```

## Puesta en marcha

```bash
npm run setup     # aplica migraciones + sincroniza admins + configura auth + genera env.js
npm run dev       # tienda: http://localhost:3000 · panel: http://dash.localhost:3000
```

El servidor local también ejecuta las funciones de `api/` (`/api/mp/pay`, `/api/mp/webhook`), así que el pago con
tarjeta se puede probar sin subir a Vercel (con las tarjetas de prueba de Mercado Pago).

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
| `SUPABASE_SECRET_KEY` | scripts (`npm run firma`) y `api/mp/*` (confirma/cancela órdenes), nunca va al navegador |
| `PUBLIC_KEY` | Mercado Pago, pública: va al navegador vía `env.js` (SDK) |
| `ACCESS_TOKEN` | Mercado Pago, secreta: solo `api/mp/*` |
| `CLAVE_WEBHOOK` | clave secreta de los webhooks de Mercado Pago (valida `x-signature`) |

## Envío y recargos del checkout

Tarifas y porcentajes en archivos separados, fáciles de editar (los usan el checkout **y** el backend que crea la
orden, así que lo que ve el cliente es lo que se cobra):

| Archivo | Qué tiene |
| --- | --- |
| `assets/js/config/shipping-rates.js` | Tarifas de Correo Argentino (Encomienda Clásica) por rango de peso: regional (CABA y Bs As) y nacional |
| `assets/js/config/payment-rates.js` | Recargo por medio de pago (tarjeta de crédito y débito: 10%) |
| `assets/js/config/installment-rates.js` | Recargo por cuotas con crédito (3: 11%, 6: 20%, 9: 30%, 12: 35%) |

El cálculo está en `assets/js/core/pricing.js`:

- **Envío**: peso total del pedido (peso × cantidad) según la tabla. CABA y Buenos Aires usan la columna regional y
  los productos con "Envío gratis" no suman peso (si todos lo tienen, el envío es gratis); el resto del país usa la
  nacional para todos los productos. Más de 25 kg: bultos de 25 kg.
- **Recargo por tarjeta**: sobre productos + envío.
- **Recargo por cuotas**: sobre el total con el recargo por tarjeta. Las cuotas hasta las "cuotas sin interés" de los
  productos del carrito (panel) van sin recargo. El checkout muestra el valor de cada cuota y el total, nunca el %.
- `orders.surcharge` = recargo por tarjeta + recargo por cuotas.

## Pagos con tarjeta (Mercado Pago · Checkout API / Orders)

El cobro es transparente: el comprador nunca sale del sitio.

1. `tienda/pago.html` carga el SDK (`sdk.mercadopago.com/js/v2`). Número, vencimiento y CVV son **Secure Fields**
   (iframes de Mercado Pago): los datos de la tarjeta no pasan por nuestro código (PCI). Con el BIN el SDK identifica
   la tarjeta (marca, crédito/débito) y trae las cuotas reales para el monto.
2. Al pagar, el navegador crea el token (`mp.fields.createCardToken`) y llama a `POST /api/mp/pay` con la sesión de
   Supabase, los ítems del carrito, los datos del comprador, el medio (`credito`/`debito`), las cuotas y el token.
3. `api/mp/pay.js` crea la orden (`api/_lib/checkout.js`: calcula envío y recargos, `place_order` valida stock y
   precios; nunca se usa un monto del cliente), arma la order en Mercado Pago (`POST /v1/orders`, `processing_mode: automatic`,
   `external_reference` = id de la orden, `X-Idempotency-Key` = id de la orden) y aplica el resultado con la RPC
   `mp_apply_payment` (service role): `processed` → `pagado` (nota de venta + notificaciones), `failed` → `cancelado`
   (devuelve stock, motivo en el timeline), `processing`/`action_required` → sigue `pendiente`.
4. `api/mp/webhook.js` recibe las notificaciones (tópico **Order**): valida la firma `x-signature` con `CLAVE_WEBHOOK`,
   lee la order con `GET /v1/orders/{id}` (nunca confía en el body) y vuelve a aplicar `mp_apply_payment`
   (idempotente: acreditaciones tardías, reembolsos desde Mercado Pago → `cancelado` sin comprobante, contracargos → aviso al panel).

Las órdenes con tarjeta nacen `pendiente` y las confirma el backend; la transferencia crea la orden con
`POST /api/orders/transfer` y después el navegador sube el comprobante (revisión en el panel). En `orders` quedan `mp_order_id` y `payment` (marca, últimos 4, ids y estado de MP).

Configuración en Mercado Pago (Tus integraciones → aplicación):

- **Credenciales**: `PUBLIC_KEY` y `ACCESS_TOKEN` en el `.env` (y en Vercel). Para probar hay que usar las
  credenciales de producción de un **usuario de prueba vendedor** (Orders no acepta las `TEST-`); el comprador
  se simula con las [tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/resources/test-cards)
  y el nombre del titular decide el resultado (`APRO` aprobado, `OTHE` rechazado, `FUND` sin fondos, etc.).
- **Webhooks**: URL `https://<dominio>/api/mp/webhook`, evento *Order (Mercado Pago)*; la clave secreta que genera va
  en `CLAVE_WEBHOOK`. Se puede probar con "Simular notificación".

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

RPCs: `place_order` (solo service role, la llama `api/_lib/checkout.js`: valida stock y precios, descuenta stock;
la orden nace pendiente), `mp_apply_payment`
(solo service role: aplica el resultado de Mercado Pago),
`set_order_status` (admin; al cancelar devuelve stock y borra la nota de venta: un pedido cancelado no tiene comprobante), `review_receipt` (admin),
`mark_notifications_read`. Todo protegido con RLS.

## Vercel (un solo proyecto, un solo repo)

La tienda y el panel se despliegan juntos; `vercel.json` rutea por dominio:

- `<dominio>` → `tienda/` (por ejemplo `/productos` sirve `tienda/productos.html`)
- `dash.<dominio>` → `dash/` (`/` es el dashboard, `/login` el acceso)
- `/assets/...` se sirve igual en los dos (la regla del host solo aplica a lo que no existe en la raíz)

Pasos:

1. Variables de entorno del proyecto: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ADMIN_EMAILS`, y para el pago:
   `SUPABASE_SECRET_KEY`, `PUBLIC_KEY`, `ACCESS_TOKEN`, `CLAVE_WEBHOOK`.
2. Settings → Domains: agregar `<dominio>` **y** `dash.<dominio>` al mismo proyecto (en el DNS, un CNAME `dash` → `cname.vercel-dns.com`).
3. En el `.env`: `SITE_URL=https://<dominio>` y `EXTRA_REDIRECT_URLS=https://dash.<dominio>,http://dash.localhost:3000`, y correr `npm run auth:configure`.
4. En Google Cloud, sumar `https://dash.<dominio>` a los orígenes autorizados.

Sin dominio propio (`*.vercel.app`) el panel también responde en `https://<proyecto>.vercel.app/dash`; los enlaces internos del panel son relativos, así que funciona en los dos lugares.
