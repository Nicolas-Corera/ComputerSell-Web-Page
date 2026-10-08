// Notificaciones push del navegador (Web Push) sin dependencias: cifrado del
// mensaje (RFC 8291, aes128gcm) y firma VAPID (RFC 8292) con node:crypto.
//
// Variables: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (se generan con
// `npm run push:keys`) y VAPID_SUBJECT (mailto: de contacto). La pública
// también va al navegador (env.js) para suscribirse.
const crypto = require("crypto");
const { env } = require("./mp");

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const fromB64u = (s) => Buffer.from(String(s || ""), "base64url");

// Par de claves VAPID nuevo (P-256): pública sin comprimir (65 bytes) y privada (32 bytes), en base64url
function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  return {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(pub.x), fromB64u(pub.y)])),
    privateKey: jwk.d,
  };
}

function vapidPrivateKey(publicKey, privateKey) {
  const pub = fromB64u(publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY inválida");
  return crypto.createPrivateKey({
    format: "jwk",
    key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)), d: privateKey },
  });
}

// Authorization: vapid t=<JWT ES256>, k=<clave pública>
function vapidHeader(endpoint, { publicKey, privateKey, subject }) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), {
    key: vapidPrivateKey(publicKey, privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

// Cifra el mensaje para la suscripción {p256dh, auth} (un solo registro aes128gcm)
function encrypt(payload, { p256dh, auth }, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Suscripción push inválida");
  if (!ecdh) {
    ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
  }
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 = último registro, sin relleno
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Solo los servicios de push de los navegadores (Chrome/Edge/Opera, Firefox,
// Safari, Windows). El endpoint lo manda el navegador del cliente: sin esta
// lista se podría usar el servidor para hacer pedidos a cualquier URL (SSRF).
// La misma lista está en el CHECK de push_subscriptions (migración 0029).
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

function allowedEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && (u.port === "" || u.port === "443") && !u.username && !u.password && PUSH_HOSTS.test(u.hostname);
  } catch (e) {
    return false;
  }
}

function vapidConfig() {
  const e = env();
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) return null;
  return { publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT };
}

// Manda un aviso a una suscripción {endpoint, p256dh, auth}.
// -> "ok" | "gone" (el navegador la dio de baja: hay que borrarla) | "error"
async function sendPush(sub, message, { ttl = 86400 } = {}) {
  const vapid = vapidConfig();
  if (!vapid) return "error";
  if (!allowedEndpoint(sub.endpoint)) return "gone";
  try {
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        TTL: String(ttl),
        Urgency: "normal",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        Authorization: vapidHeader(sub.endpoint, vapid),
      },
      body: encrypt(JSON.stringify(message), sub),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    if (!res.ok) {
      console.error("[push]", res.status, (await res.text()).slice(0, 300));
      return "error";
    }
    return "ok";
  } catch (e) {
    console.error("[push]", e.message);
    return "error";
  }
}

module.exports = { generateVapidKeys, vapidHeader, encrypt, sendPush, vapidConfig, allowedEndpoint };
