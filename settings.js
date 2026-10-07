// Ventana de ajustes: envía cambios parciales al proceso principal y refleja el estado que este difunde.
const $ = id => document.getElementById(id);

// Elementos que se pueden ocultar (SHOWS), formas de portada (SHAPES) y opciones varias (MISC).
const SHOWS = [['showCover', 'La portada'], ['showArtist', 'El artista'], ['showLike', 'Me gusta (+)'], ['showShuffle', 'Aleatorio'], ['showRepeat', 'Repetir'], ['showTime', 'Barra de tiempo y tiempos'], ['showVolume', 'Volumen']];
const SHAPES = [['rounded', 'Redondeada'], ['square', 'Cuadrada'], ['circle', 'Círculo']];
SHOWS.push(['showDevices', 'Elegir dispositivo']);
const MISC = [['updateCheck', 'Avisar si hay una versión nueva (consulta GitHub al iniciar)'], ['trackNotice', 'Avisar cuando cambia la canción (solo con la ventana en segundo plano)']];
for (const [k, label, box = 'shows'] of [...SHOWS, ...MISC.map(m => [...m, 'misc'])]) {
  const l = document.createElement('label'), i = document.createElement('input'); i.type = 'checkbox'; i.dataset.k = k;
  i.onchange = () => bridge.setSettings({ [k]: i.checked });   // independiente del tema
  l.append(document.createTextNode(label), i); $(box).append(l);
}
for (const [v, label] of SHAPES) {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.v = v; b.textContent = label;
  b.onclick = () => bridge.setSettings({ coverShape: v }); $('coverShape').append(b);
}
// Temas secretos: los paquetes llegan desde el proceso principal; cada uno agrega un botón a la grilla de temas.
let secrets = [], last = {};
function renderSecrets() {
  for (const b of document.querySelectorAll('#themes button.secret')) b.remove();
  for (const p of secrets) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.id = p.id; b.className = 'secret';
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = p.swatch;
    b.append(sw, document.createTextNode(p.label));
    b.onclick = () => bridge.setSettings({ ...p.settings, preset: p.id, blossoms: false });
    $('themes').append(b);
  }
  if (last.preset) show(last);
}
bridge.secretList().then(p => { secrets = p; renderSecrets(); });
bridge.onSecrets(p => { secrets = p; renderSecrets(); });
// El cuadrito del código aparece con una combinación de botones de tamaño. Solo se guarda su hash: la
// combinación no figura en el código. Es un huevo de pascua; la seguridad real está en el código cifrado.
const SEQ_HASH = 'd3cda760237ca18ea7c482d64dbeea0380c93b3c47a94c8be9da1c454dabe7c4';
let seq = [];
// Registra los últimos 5 botones de tamaño pulsados y revela el cuadro del código si su hash coincide.
async function trackSeq(v) {
  seq = [...seq, v].slice(-5); if (seq.length < 5) return;
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seq.join(',')));
  if ([...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('') === SEQ_HASH) { $('secretBox').hidden = false; $('secretCode').focus(); }
}
// Envía el código al proceso principal (que descifra y valida) y muestra el resultado; el campo se vacía siempre.
$('secretGo').onclick = async () => {
  const code = $('secretCode').value; $('secretCode').value = ''; $('secretMsg').textContent = 'Probando…';
  const r = await bridge.secretUnlock(code);
  $('secretMsg').textContent = r.ok ? '¡Desbloqueado: ' + r.label + '!' : r.wait ? 'Demasiados intentos. Esperá un momento.' : 'Código incorrecto.';
};
$('secretCode').onkeydown = e => { if (e.key === 'Enter') $('secretGo').click(); };
$('sfx').onchange = () => bridge.setSettings({ sfx: $('sfx').checked });
// Refleja en los controles el estado de ajustes recibido (también oculta o muestra secciones según el tema).
function show(s) {
  last = s; const sp = secrets.find(p => p.id === s.preset);
  $('sfxRow').hidden = !sp?.sound; $('sfx').checked = s.sfx !== false;
  for (const i of document.querySelectorAll('#shows input, #misc input')) i.checked = s[i.dataset.k] !== false;
  for (const b of document.querySelectorAll('#coverShape button')) b.classList.toggle('on', b.dataset.v === s.coverShape);
  $('coverShape').hidden = s.showCover === false;   // sin portada no hay forma que elegir
  $('font').value = s.font; $('btnStyle').value = s.btnStyle;
  $('bgMode').value = s.bgMode; $('bgColor').value = s.bgColor;
  $('accentMode').value = s.accentMode; $('accentColor').value = s.accentColor;
  $('blossoms').checked = !!s.blossoms;
  $('scale').value = Math.round(s.scale * 100); $('scaleV').textContent = Math.round(s.scale * 100) + '%';
  $('radius').value = s.radius; $('radiusV').textContent = s.radius + ' px';
  const tr = Math.round((1 - s.bgOpacity) * 100); $('bgOpacity').value = tr; $('bgOpacityV').textContent = tr + '%';
  for (const b of document.querySelectorAll('#sizes button')) b.classList.toggle('on', Math.abs(+b.dataset.s - s.scale) < .001);
  $('decor').hidden = s.preset !== 'cherry';   // la opción solo existe en Cherry
  $('bgColorRow').hidden = s.bgMode !== 'fixed';
  $('accentColorRow').hidden = s.accentMode !== 'custom';
  for (const b of document.querySelectorAll('#themes button')) b.classList.toggle('on', b.dataset.id === s.preset);
}
// Cualquier cambio manual deja de ser un tema prediseñado.
const change = p => bridge.setSettings({ ...p, preset: 'custom' });

// Botones de los temas públicos (definidos en themes.js).
for (const [id, t] of Object.entries(THEMES)) {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.id = id;
  const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = t.swatch;
  b.append(sw, document.createTextNode(t.label));
  b.onclick = () => bridge.setSettings({ preset: id, bgMode: t.bgMode, bgColor: t.bgColor, accentMode: t.accentMode, accentColor: t.accentColor, blossoms: !!t.blossoms });
  $('themes').append(b);
}
$('bgMode').onchange = () => change({ bgMode: $('bgMode').value });
$('bgColor').oninput = () => change({ bgColor: $('bgColor').value });
$('accentMode').onchange = () => change({ accentMode: $('accentMode').value });
$('accentColor').oninput = () => change({ accentColor: $('accentColor').value });
// Interruptor independiente: no convierte el tema en "personalizado".
$('blossoms').onchange = () => bridge.setSettings({ blossoms: $('blossoms').checked });
// Tamaño y forma son independientes del tema: no cambian el tema elegido.
$('scale').oninput = () => bridge.setSettings({ scale: $('scale').value / 100 });
$('radius').oninput = () => bridge.setSettings({ radius: +$('radius').value });
$('bgOpacity').oninput = () => bridge.setSettings({ bgOpacity: +(1 - $('bgOpacity').value / 100).toFixed(2) });
for (const b of document.querySelectorAll('#sizes button')) b.onclick = () => { bridge.setSettings({ scale: +b.dataset.s }); trackSeq(b.dataset.s); };
$('font').onchange = () => bridge.setSettings({ font: $('font').value });
$('btnStyle').onchange = () => bridge.setSettings({ btnStyle: $('btnStyle').value });
$('reset').onclick = () => bridge.resetSettings();

bridge.onSettings(show);
bridge.getSettings().then(show);
