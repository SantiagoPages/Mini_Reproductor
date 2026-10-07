/**
 * Paquetes secretos: cifrado y descifrado.
 *
 * Un paquete es un JSON cifrado con AES-256-GCM. La clave se deriva del código con scrypt (costoso a propósito,
 * para encarecer los intentos de adivinar). El código NO se guarda en ningún lado: un código es correcto si y
 * solo si el descifrado autentica (la etiqueta GCM coincide). Formato: "MPS1" | sal(16) | iv(12) | etiqueta(16) | datos.
 * Lo usan el proceso principal (descifrar) y herramientas/empacar-secreto.js (cifrar).
 */
const crypto = require('crypto');
const MAGIC = Buffer.from('MPS1');
// Se normaliza el código para tolerar mayúsculas y espacios sobrantes.
const norm = c => String(c).normalize('NFKC').trim().toLowerCase();
const derive = (code, salt) => new Promise((ok, no) =>
  crypto.scrypt(norm(code), salt, 32, { N: 1 << 16, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }, (e, k) => e ? no(e) : ok(k)));

/** Cifra un objeto con el código dado y devuelve el Buffer del paquete. */
async function seal(obj, code) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = await derive(code, salt);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), data]);
}
/** Descifra un paquete; devuelve el objeto, o null si el código es incorrecto o el archivo no es válido. */
async function open(buf, code) {
  if (buf.length < 49 || !buf.subarray(0, 4).equals(MAGIC)) return null;
  try {
    const key = await derive(code, buf.subarray(4, 20));
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(20, 32));
    d.setAuthTag(buf.subarray(32, 48));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(48)), d.final()]).toString('utf8'));
  } catch { return null; }
}
module.exports = { seal, open };
