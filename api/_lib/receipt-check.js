// Revisión del contenido de un comprobante (PDF, PNG o JPG) en el servidor.
//
// El navegador ya mira los primeros bytes, pero eso se saltea subiendo directo
// al bucket, y unos bytes mágicos no alcanzan: un HTML, un ejecutable o un ZIP
// se pueden disfrazar de imagen poniéndole adelante la firma de un PNG. Acá se
// recorre la estructura completa del formato y se rechaza:
//   - lo que no es un PNG/JPG/PDF bien formado de punta a punta
//     (PNG: chunks con CRC, IHDR, IDAT que descomprime al tamaño exacto, IEND
//      al final y nada después; JPG: segmentos, SOF, SOS y EOI)
//   - datos pegados después del final que no sean de la propia imagen
//   - PDFs con JavaScript, acciones que abren programas o archivos embebidos
//   - código (HTML, scripts, PHP) o ejecutables/archivos comprimidos escondidos
//     en metadatos, comentarios o al final del archivo
// Sin dependencias: Buffer + zlib de Node.
const zlib = require("zlib");

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 20000; // px por lado
const MAX_RAW = 160 * 1024 * 1024; // PNG descomprimido
const MAX_INFLATE = 50 * 1024 * 1024; // PDF: total de object streams descomprimidos

const BAD = "El archivo no es un PDF, JPG o PNG válido.";
const UNSAFE = "El archivo tiene contenido no permitido (código o archivos ocultos). Subí una captura o el PDF original del banco.";

// Código o markup que no tiene nada que hacer dentro de un comprobante.
// Todos de 5 caracteres o más: se buscan también en datos binarios (miniaturas,
// video de "foto en movimiento") y uno más corto aparecería ahí por azar.
const MARKUP = [
  "<script", "<?php", "<html", "<iframe", "<object", "<embed", "<body", "<form",
  "javascript:", "vbscript:", "onerror=", "onload=", "eval(", "document.cookie", "fromcharcode",
  "powershell", "cmd.exe", "wscript", "/bin/sh", "/bin/bash", "base64_decode", "shell_exec",
];
// Archivos de otro tipo metidos adentro: zip/jar/docx (cabecera local con
// versión), ejecutables Linux/Windows, rar, 7z
const SIGNATURES = [
  Buffer.from("504b03040a00", "hex"),
  Buffer.from("504b03041400", "hex"),
  Buffer.from("504b03042d00", "hex"),
  Buffer.from("7f454c460101", "hex"),
  Buffer.from("7f454c460201", "hex"),
  Buffer.from("526172211a07", "hex"),
  Buffer.from("377abcaf271c", "hex"),
  Buffer.from("This program cannot be run", "latin1"),
  Buffer.from("This program must be run", "latin1"),
];

function hasMarkup(buf) {
  const text = buf.toString("latin1").toLowerCase();
  return MARKUP.some((m) => text.includes(m));
}
function hasEmbeddedFile(buf, { pdf = true } = {}) {
  if (SIGNATURES.some((s) => buf.includes(s))) return true;
  return pdf && buf.includes("%PDF-");
}
const suspicious = (buf, opts) => hasMarkup(buf) || hasEmbeddedFile(buf, opts);

// ---------- PNG ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = Buffer.from("89504e470d0a1a0a", "hex");
const PNG_CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [
  [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
]; // [x0, y0, dx, dy]

// Bytes que tiene que dar el IDAT descomprimido (filas + byte de filtro)
function pngRawSize(w, h, bitsPerPixel, interlace) {
  const row = (width) => (width ? Math.ceil((width * bitsPerPixel) / 8) + 1 : 0);
  if (!interlace) return h * row(w);
  return ADAM7.reduce((sum, [x0, y0, dx, dy]) => {
    const pw = Math.ceil((w - x0) / dx);
    const ph = Math.ceil((h - y0) / dy);
    return pw > 0 && ph > 0 ? sum + ph * row(pw) : sum;
  }, 0);
}

function inspectPng(buf) {
  if (buf.length < 57 || !buf.subarray(0, 8).equals(PNG_SIG)) return BAD;
  let pos = 8;
  let ihdr = null;
  let ended = false;
  const idat = [];
  const meta = [];
  while (pos < buf.length) {
    if (pos + 12 > buf.length) return BAD;
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || len > buf.length - pos - 12) return BAD;
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (crc32(buf.subarray(pos + 4, pos + 8 + len)) !== buf.readUInt32BE(pos + 8 + len)) return BAD;
    pos += 12 + len;

    if (!ihdr && type !== "IHDR") return BAD;
    if (type === "IHDR") {
      if (ihdr || len !== 13) return BAD;
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") {
      if (len !== 0) return BAD;
      ended = true;
      break;
    } else if (type === "zTXt" || type === "iTXt") {
      meta.push(data);
      // Texto comprimido: se descomprime (con tope) para revisarlo también
      const nul = data.indexOf(0);
      const start = type === "zTXt" ? nul + 2 : -1;
      if (type === "zTXt" && nul > 0) {
        try {
          meta.push(zlib.inflateSync(data.subarray(start), { maxOutputLength: 1024 * 1024 }));
        } catch (e) {
          return BAD;
        }
      } else if (type === "iTXt" && nul > 0 && data[nul + 1] === 1) {
        const rest = data.subarray(nul + 3);
        const a = rest.indexOf(0);
        const b = a >= 0 ? rest.indexOf(0, a + 1) : -1;
        if (b < 0) return BAD;
        try {
          meta.push(zlib.inflateSync(rest.subarray(b + 1), { maxOutputLength: 1024 * 1024 }));
        } catch (e) {
          return BAD;
        }
      }
    } else meta.push(data); // tEXt, eXIf y cualquier otro chunk auxiliar
  }
  if (!ended || pos !== buf.length) return pos !== buf.length && ended ? UNSAFE : BAD; // nada después de IEND
  if (!idat.length) return BAD;

  const { w, h, depth, color, compression, filter, interlace } = ihdr;
  if (!w || !h || w > MAX_SIDE || h > MAX_SIDE) return BAD;
  if (!PNG_CHANNELS[color] || !PNG_DEPTHS[color].includes(depth) || compression !== 0 || filter !== 0 || interlace > 1) return BAD;
  const expected = pngRawSize(w, h, PNG_CHANNELS[color] * depth, interlace);
  if (expected > MAX_RAW) return "La imagen es demasiado grande. Subí una captura más chica.";

  // Los datos de la imagen tienen que descomprimir exactamente al tamaño de la imagen
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected + 1 });
  } catch (e) {
    return BAD;
  }
  if (raw.length !== expected) return BAD;
  if (!interlace) {
    const stride = Math.ceil((w * PNG_CHANNELS[color] * depth) / 8) + 1;
    for (let i = 0; i < raw.length; i += stride) if (raw[i] > 4) return BAD;
  }
  if (meta.some((m) => suspicious(m))) return UNSAFE;
  return "";
}

// ---------- JPEG ----------
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

// Devuelve { error } o { end } (posición después del EOI)
function walkJpeg(buf, start, meta) {
  if (buf[start] !== 0xff || buf[start + 1] !== 0xd8 || buf[start + 2] !== 0xff) return { error: BAD };
  let pos = start + 2;
  let frame = false;
  let scans = 0;
  while (pos < buf.length) {
    if (buf[pos] !== 0xff) return { error: BAD };
    while (buf[pos] === 0xff && pos < buf.length) pos++; // relleno 0xFF
    if (pos >= buf.length) return { error: BAD };
    const marker = buf[pos++];
    if (marker === 0xd9) {
      if (!frame || !scans) return { error: BAD };
      return { end: pos };
    }
    if (marker === 0x00 || marker === 0xd8) return { error: BAD };
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (pos + 2 > buf.length) return { error: BAD };
    const len = buf.readUInt16BE(pos);
    if (len < 2 || pos + len > buf.length) return { error: BAD };
    const seg = buf.subarray(pos + 2, pos + len);
    pos += len;

    if (SOF.has(marker)) {
      if (seg.length < 6) return { error: BAD };
      const h = seg.readUInt16BE(1);
      const w = seg.readUInt16BE(3);
      const comps = seg[5];
      if (!w || !h || w > MAX_SIDE || h > MAX_SIDE || ![1, 3, 4].includes(comps) || seg.length < 6 + comps * 3) return { error: BAD };
      frame = true;
    } else if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      meta.push(seg); // APPn (EXIF, XMP, ICC...) y comentarios
    } else if (marker === 0xda) {
      if (!frame) return { error: BAD };
      scans++;
      // Datos comprimidos hasta el próximo marcador (0xFF00 = byte escapado, RSTn = reinicio)
      while (pos < buf.length) {
        if (buf[pos] === 0xff) {
          const next = buf[pos + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            pos += 2;
            continue;
          }
          if (next === 0xff) {
            pos++;
            continue;
          }
          break;
        }
        pos++;
      }
    }
  }
  return { error: BAD };
}

function inspectJpeg(buf) {
  const meta = [];
  let r = walkJpeg(buf, 0, meta);
  if (r.error) return r.error;
  let pos = r.end;
  // Después del final: relleno, imágenes extra de la cámara (MPF: miniaturas,
  // mapas de profundidad) o metadatos del fabricante. Se revisa todo.
  for (let extra = 0; pos < buf.length && extra < 8; extra++) {
    const rest = buf.subarray(pos);
    if (rest.every((b) => b === 0x00 || b === 0xff)) {
      pos = buf.length;
      break;
    }
    const at = rest.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
    if (at !== 0) {
      // Datos sueltos (p. ej. trailer de Samsung): no pueden tener código ni archivos
      if (suspicious(rest)) return UNSAFE;
      pos = buf.length;
      break;
    }
    r = walkJpeg(buf, pos, meta);
    if (r.error) return UNSAFE;
    pos = r.end;
  }
  if (pos < buf.length) return UNSAFE;
  if (meta.some((m) => suspicious(m))) return UNSAFE;
  return "";
}

// ---------- PDF ----------
// Nombres PDF que ejecutan código, abren programas, envían datos o traen archivos adentro
const PDF_FORBIDDEN = new Set([
  "javascript", "js", "launch", "embeddedfile", "embeddedfiles", "richmedia", "xfa",
  "submitform", "importdata", "gotoe", "gotor", "sound", "movie", "renditionaction",
]);
// "/J#61vaScript" == "/JavaScript": los nombres se decodifican antes de comparar
function pdfNames(text) {
  const out = new Set();
  const re = /\/([^\s\/<>\[\]\(\)\{\}%]+)/g;
  let m;
  while ((m = re.exec(text))) {
    out.add(m[1].replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).toLowerCase());
  }
  return out;
}
const pdfUnsafe = (text) => {
  for (const n of pdfNames(text)) if (PDF_FORBIDDEN.has(n)) return true;
  return false;
};

function inspectPdf(buf) {
  const head = buf.toString("latin1", 0, 16);
  if (!/^%PDF-[12]\.\d/.test(head)) return BAD;
  const tail = buf.toString("latin1", Math.max(0, buf.length - 2048));
  if (!tail.includes("%%EOF")) return BAD;
  const text = buf.toString("latin1");
  if (!/\d+\s+\d+\s+obj\b/.test(text) || !/(trailer|\/XRef)/.test(text)) return BAD;
  // Diccionarios y objetos sin el contenido de los streams (fuentes, imágenes:
  // binario donde un "/JS" o un "<body" aparecen por azar)
  const objects = text.replace(/stream\r?\n[\s\S]*?endstream/g, "stream endstream");
  if (pdfUnsafe(objects) || hasMarkup(Buffer.from(objects, "latin1"))) return UNSAFE;

  // Object streams (PDF 1.5+): los diccionarios van comprimidos y ahí se
  // podría esconder un /JavaScript. Se descomprimen y se revisan también.
  const encrypted = /\/Encrypt\b/.test(text);
  const re = /obj\s*<<((?:(?!endobj)[\s\S]){0,4096}?)>>\s*stream\r?\n/g;
  let m;
  let inflated = 0;
  while ((m = re.exec(text))) {
    const dict = m[1];
    if (!/\/Type\s*\/ObjStm\b/.test(dict)) continue;
    // Cifrado: el contenido no se puede revisar
    if (encrypted) return "El PDF está protegido con contraseña o cifrado. Subí una captura (JPG o PNG) del comprobante.";
    if (!/\/FlateDecode\b/.test(dict) || /\/DecodeParms|\[\s*\/\w+\s+\/\w+/.test(dict)) return UNSAFE;
    const start = m.index + m[0].length;
    const lenM = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    let end = lenM ? start + Number(lenM[1]) : text.indexOf("endstream", start);
    if (end < start || end > buf.length) end = text.indexOf("endstream", start);
    if (end < start) return BAD;
    let out;
    try {
      out = zlib.inflateSync(buf.subarray(start, end), { maxOutputLength: MAX_INFLATE - inflated });
    } catch (e) {
      try {
        // Algunos generadores dejan basura al final del stream
        out = zlib.inflateSync(buf.subarray(start, end), { maxOutputLength: MAX_INFLATE - inflated, finishFlush: zlib.constants.Z_SYNC_FLUSH });
      } catch (e2) {
        return BAD;
      }
    }
    inflated += out.length;
    if (pdfUnsafe(out.toString("latin1")) || hasMarkup(out)) return UNSAFE;
  }
  return "";
}

// ---------- Entrada ----------
const MIME = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg" };

// "" si el archivo está bien; si no, el motivo para mostrarle al cliente.
// ext: "pdf" | "png" | "jpg" (del nombre en el bucket); mime: Content-Type guardado
function inspectReceipt(buf, ext, mime) {
  if (!Buffer.isBuffer(buf) || !buf.length) return "El archivo está vacío.";
  if (buf.length > MAX_BYTES) return "El archivo supera los 5 MB.";
  if (!MIME[ext]) return "Solo se aceptan archivos PDF, JPG o PNG.";
  if (mime !== undefined && String(mime).split(";")[0].trim().toLowerCase() !== MIME[ext]) return BAD;
  try {
    if (ext === "png") return inspectPng(buf);
    if (ext === "jpg") return inspectJpeg(buf);
    return inspectPdf(buf);
  } catch (e) {
    return BAD;
  }
}

module.exports = { inspectReceipt, MIME, MAX_BYTES, crc32 };
