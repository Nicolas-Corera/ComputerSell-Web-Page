// Notificaciones push (api/_lib/push.js): el cifrado tiene que dar exactamente
// el ejemplo del RFC 8291 (apéndice A) y la firma VAPID tiene que verificar con
// la clave pública. Si no, los navegadores descartan el mensaje en silencio.
const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { encrypt, vapidHeader, generateVapidKeys } = require("../../api/_lib/push");

const b64u = (s) => Buffer.from(s, "base64url");

// RFC 8291, Appendix A
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

// Lo que hace el navegador al recibirlo
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const uaPublic = uaEcdh.getPublicKey();
  const shared = uaEcdh.computeSecret(asPublic);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const out = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.strictEqual(out[out.length - 1], 2, "falta el delimitador de último registro");
  return out.subarray(0, -1).toString();
}

test("push: el cifrado coincide con el ejemplo del RFC 8291", () => {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(b64u(RFC.asPrivate));
  const body = encrypt(RFC.plaintext, { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: b64u(RFC.salt), ecdh });
  assert.strictEqual(body.toString("base64url"), RFC.body);
});

test("push: un navegador descifra el mensaje (claves nuevas)", () => {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  const msg = JSON.stringify({ title: "Pedido CS-1042: Despachado", body: "Ya está en camino ñ áé", url: "/perfil.html#avisos" });
  const body = encrypt(msg, { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") });
  assert.strictEqual(decrypt(body, ua, auth), msg);
});

test("push: suscripción con claves inválidas se rechaza", () => {
  assert.throws(() => encrypt("x", { p256dh: "AAAA", auth: RFC.auth }), /inválida/);
});

test("push: la firma VAPID verifica con la clave pública", () => {
  const keys = generateVapidKeys();
  assert.strictEqual(b64u(keys.publicKey).length, 65);
  assert.strictEqual(b64u(keys.privateKey).length, 32);
  const h = vapidHeader("https://fcm.googleapis.com/fcm/send/abc", { ...keys, subject: "mailto:contacto@example.test" });
  const m = h.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, h);
  assert.strictEqual(m[4], keys.publicKey);
  const claims = JSON.parse(b64u(m[2]).toString());
  assert.strictEqual(claims.aud, "https://fcm.googleapis.com");
  assert.strictEqual(claims.sub, "mailto:contacto@example.test");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  const pub = b64u(keys.publicKey);
  const key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") } });
  assert.ok(crypto.verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, b64u(m[3])));
});

test("push: solo se envía a servicios de push conocidos (sin SSRF)", () => {
  const { allowedEndpoint } = require("../../api/_lib/push");
  for (const ok of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ]) assert.ok(allowedEndpoint(ok), ok);
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost/x",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilfcm.googleapis.com.example/x",
    "https://fcm.googleapis.com:8443/x",
    "https://user:pass@fcm.googleapis.com/x",
    "nada",
  ]) assert.ok(!allowedEndpoint(bad), bad);
});
