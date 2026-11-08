/**
 * Herramienta de desarrollo (no se incluye en la app): arma un paquete de tema que se agrega con un código.
 *
 *   node herramientas/empacar.js <tema>.json
 *
 * Pide el código por teclado (no se guarda en ningún archivo) y escribe paquetes/<nombre-al-azar>.bin.
 * El .json de origen no se sube al repositorio.
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
const { seal } = require('../paquetes');

const src = process.argv[2];
if (!src) { console.error('Uso: node herramientas/empacar.js <tema.json>'); process.exit(1); }
const pack = JSON.parse(fs.readFileSync(src, 'utf8'));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Código para este tema (usá una frase larga): ', async code => {
  rl.close();
  if (code.trim().length < 8) { console.error('Muy corto: usá al menos 8 caracteres (mejor una frase).'); process.exit(1); }
  if (!/\s/.test(code.trim())) console.warn('Aviso: un código de una sola palabra es fácil de adivinar. Mejor una frase larga y rara.');
  const out = path.join(__dirname, '..', 'paquetes'); fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, crypto.randomBytes(6).toString('hex') + '.bin');   // nombre al azar: no revela el tema
  fs.writeFileSync(file, await seal(pack, code));
  console.log('Listo:', file);
});
