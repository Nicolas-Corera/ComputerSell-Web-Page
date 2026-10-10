// Comprobantes: la revisión del servidor (api/_lib/receipt-check.js) acepta
// PDF/PNG/JPG legítimos y rechaza archivos disfrazados (HTML, ejecutables o
// ZIP con la firma de una imagen), código escondido en metadatos o al final,
// y PDFs con JavaScript / acciones / archivos embebidos.
// Los "payloads" se arman por partes (j()): escritos enteros, el antivirus
// pone este archivo en cuarentena.
// Uso: node --test tests/js/
const { test } = require("node:test");
const assert = require("node:assert");
const zlib = require("zlib");
const { inspectReceipt, crc32 } = require("../../api/_lib/receipt-check");

const j = (...parts) => parts.join("");
const SCRIPT = j("<scr", "ipt>alert(1)</scr", "ipt>");
const PHP = j("<", "?p", "hp sys", "tem('id'); ?", ">");
const EXE = j("M", "Z\x90\0", "This prog", "ram cannot be run in DOS mode");
const ONLOAD = j("<ht", "ml><body onl", "oad=alert(1)>");

// ---------- Generadores ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png({ w = 4, h = 3, extra = [], tail = Buffer.alloc(0), rawOverride } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = rawOverride || Buffer.alloc(h * (w * 3 + 1), 0);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    ...extra,
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
    tail,
  ]);
}
function seg(marker, data) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, data]);
}
function jpeg({ app = [], tail = Buffer.alloc(0) } = {}) {
  const sof = Buffer.from([8, 0, 10, 0, 12, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const scan = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    ...app,
    seg(0xc0, sof),
    seg(0xda, sos),
    scan,
    Buffer.from([0xff, 0xd9]),
    tail,
  ]);
}
function pdf(body = "", { objstm } = {}) {
  const parts = [
    "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n",
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R " + body + " >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n",
  ];
  let bin = Buffer.from(parts.join(""), "latin1");
  if (objstm) {
    const data = zlib.deflateSync(Buffer.from(objstm, "latin1"));
    bin = Buffer.concat([
      bin,
      Buffer.from(`3 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`, "latin1"),
      data,
      Buffer.from("\nendstream\nendobj\n", "latin1"),
    ]);
  }
  return Buffer.concat([bin, Buffer.from("xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n", "latin1")]);
}
const ZIP = Buffer.from("504b0304140000000800", "hex");
const JS_NAME = j("/Java", "Script");

// ---------- Legítimos ----------
test("acepta PNG, JPG y PDF bien formados", () => {
  assert.strictEqual(inspectReceipt(png(), "png", "image/png"), "");
  assert.strictEqual(inspectReceipt(jpeg(), "jpg", "image/jpeg"), "");
  assert.strictEqual(inspectReceipt(pdf("/URI (https://banco.com.ar)"), "pdf", "application/pdf"), "");
  assert.strictEqual(inspectReceipt(pdf("", { objstm: "4 0 << /Font /F1 >>" }), "pdf", "application/pdf"), "");
});

test("acepta metadatos normales (XMP, EXIF, C2PA con logo SVG) y fotos con imagen extra al final (MPF)", () => {
  const xmp = chunk("iTXt", Buffer.from('XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>', "latin1"));
  const c2pa = chunk("caBX", Buffer.from('image/svg+xml\0<svg width="7" xmlns="http://www.w3.org/2000/svg"><path d="M1"/></svg>', "latin1"));
  assert.strictEqual(inspectReceipt(png({ extra: [xmp, c2pa] }), "png"), "");
  assert.strictEqual(inspectReceipt(jpeg({ app: [seg(0xe1, Buffer.from("Exif\0\0MM\0*", "latin1"))], tail: jpeg() }), "jpg"), "");
  assert.strictEqual(inspectReceipt(jpeg({ tail: Buffer.alloc(64, 0) }), "jpg"), "");
});

// ---------- Disfrazados ----------
test("rechaza un HTML, script o ejecutable con la firma de una imagen o renombrado", () => {
  const sig = Buffer.from("89504e470d0a1a0a", "hex");
  assert.notStrictEqual(inspectReceipt(Buffer.concat([sig, Buffer.from(j("<html>", SCRIPT, "</html>"))]), "png"), "");
  assert.notStrictEqual(inspectReceipt(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(PHP)]), "jpg"), "");
  assert.notStrictEqual(inspectReceipt(Buffer.from(j("%PDF-1.4\n", SCRIPT)), "pdf"), "");
  assert.notStrictEqual(inspectReceipt(Buffer.from(EXE, "latin1"), "png"), "");
  assert.notStrictEqual(inspectReceipt(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"), "jpg"), "");
});

test("rechaza una imagen cuyo contenido no corresponde (CRC roto, IDAT que no da el tamaño)", () => {
  const bad = png();
  bad[bad.length - 20] ^= 0xff; // rompe un CRC
  assert.notStrictEqual(inspectReceipt(bad, "png"), "");
  assert.notStrictEqual(inspectReceipt(png({ rawOverride: Buffer.alloc(10, 0) }), "png"), "");
});

test("rechaza archivos pegados al final o escondidos en metadatos", () => {
  assert.notStrictEqual(inspectReceipt(png({ tail: Buffer.concat([ZIP, Buffer.from("payload")]) }), "png"), "");
  assert.notStrictEqual(inspectReceipt(png({ tail: Buffer.from(SCRIPT) }), "png"), "");
  assert.notStrictEqual(inspectReceipt(png({ extra: [chunk("tEXt", Buffer.from(j("Comment\0", SCRIPT)))] }), "png"), "");
  const ztxt = chunk("zTXt", Buffer.concat([Buffer.from("Comment\0\0"), zlib.deflateSync(Buffer.from(PHP))]));
  assert.notStrictEqual(inspectReceipt(png({ extra: [ztxt] }), "png"), "");
  assert.notStrictEqual(inspectReceipt(jpeg({ app: [seg(0xfe, Buffer.from(PHP))] }), "jpg"), "");
  assert.notStrictEqual(inspectReceipt(jpeg({ tail: Buffer.concat([ZIP, Buffer.from("x.js")]) }), "jpg"), "");
  assert.notStrictEqual(inspectReceipt(jpeg({ tail: Buffer.from(ONLOAD) }), "jpg"), "");
});

test("rechaza PDFs con JavaScript, acciones peligrosas o archivos embebidos (también ofuscados o comprimidos)", () => {
  for (const body of [
    j("/OpenAction << /S ", JS_NAME, " /JS (app.alert(1)) >>"),
    j("/OpenAction << /S /J#61va", "Script /J#53 (app.alert(1)) >>"),
    j("/OpenAction << /S /Lau", "nch /F (x) >>"),
    j("/Names << /Embedded", "Files 5 0 R >>"),
    "/AcroForm << /XFA 6 0 R >>",
    j("/AA << /O << /S /Submit", "Form /F (https://x) >> >>"),
  ]) {
    assert.notStrictEqual(inspectReceipt(pdf(body), "pdf"), "", body);
  }
  assert.notStrictEqual(inspectReceipt(pdf("", { objstm: j("4 0 << /S ", JS_NAME, " /JS (app.alert(1)) >>") }), "pdf"), "");
});

test("rechaza un PDF cifrado con object streams (no se puede revisar) y tipos que no coinciden", () => {
  assert.notStrictEqual(inspectReceipt(pdf("/Encrypt 9 0 R", { objstm: "4 0 << >>" }), "pdf"), "");
  assert.notStrictEqual(inspectReceipt(png(), "png", "text/html"), "");
  assert.notStrictEqual(inspectReceipt(png(), "jpg"), "");
  assert.notStrictEqual(inspectReceipt(png(), "svg"), "");
  assert.notStrictEqual(inspectReceipt(Buffer.alloc(0), "png"), "");
  assert.notStrictEqual(inspectReceipt(Buffer.alloc(5 * 1024 * 1024 + 1), "pdf"), "");
});
