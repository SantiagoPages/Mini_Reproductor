/**
 * Herramienta de desarrollo (no se incluye en la app): cifra un tema secreto.
 *
 *   node herramientas/empacar-secreto.js secretos-src/<tema>.json
 *
 * Pide el código por teclado (no se guarda en ningún archivo) y escribe secretos/<nombre-al-azar>.bin.
 * El .json de origen está en claro: NO se sube al repositorio (ver .gitignore).
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
const { seal } = require('../secretos');

const src = process.argv[2];
if (!src) { console.error('Uso: node herramientas/empacar-secreto.js <tema.json>'); process.exit(1); }
const pack = JSON.parse(fs.readFileSync(src, 'utf8'));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Código para este tema (usá una frase larga): ', async code => {
  rl.close();
  if (code.trim().length < 8) { console.error('Muy corto: usá al menos 8 caracteres (mejor una frase).'); process.exit(1); }
  const out = path.join(__dirname, '..', 'secretos'); fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, crypto.randomBytes(6).toString('hex') + '.bin');   // nombre al azar: no revela el tema
  fs.writeFileSync(file, await seal(pack, code));
  console.log('Listo:', file);
});
