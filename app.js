/**
 * Interfaz de Mini Player (proceso renderer).
 *
 * Orden de los módulos: autenticación (OAuth PKCE) · Web Playback SDK · color dinámico · apariencia y temas ·
 * controles · Me gusta · aleatorio · repetir · volumen · rueda MP4 · biblioteca y búsqueda · dispositivos ·
 * aviso de actualización · arranque.
 *
 * Convenciones: `bridge` es la API definida en preload.js; `sp()` accede a la Web API de Spotify;
 * el contenido externo se inserta con textContent, nunca con innerHTML.
 */
const $ = id => document.getElementById(id);
// Debe coincidir con la redirect URI registrada en Spotify y con el puerto del servidor local.
const REDIRECT = location.origin + '/';   // el origen lo define el servidor local (PORT en main.js): fuente única
// Enlace o URI de Spotify (playlist, álbum o pista) con su ID de 22 caracteres.
const LINK = /(playlist|album|track)[\/:]([A-Za-z0-9]{22})/;
// Permisos solicitados. Si esta lista cambia, la sesión guardada se invalida y se pide reautorización.
const SCOPE = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-library-modify user-read-recently-played user-top-read';
// Utilidades PKCE: codificación base64url y valores aleatorios criptográficamente seguros.
const b64 = a => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const rand = n => b64(crypto.getRandomValues(new Uint8Array(n)));
// Formatea milisegundos como m:ss.
const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// Íconos SVG (solo el trazo interior) que se insertan dentro de los botones.
const ICON = { play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>', minus: '<path d="M5 11h14v2H5z"/>',
  repeat: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>',
  repeat1: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>',
  prev: '<path d="M6 6h2v12H6zM9.5 12 18 6v12z"/>', next: '<path d="M16 6h2v12h-2zM6 18V6l8.5 6z"/>', check: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>' };
// Estado de módulo: credenciales en memoria (S), parámetros del login en curso y estado del reproductor.
let S = { cid: '', rt: '', at: '', exp: 0 }, ver, state, player, dev, st, t0 = 0, lastCover = '';

// ---------- Autenticación: OAuth 2.0 Authorization Code con PKCE ----------
// Cliente público: no existe client secret. El refresh token es la única credencial persistida
// (cifrada por el proceso principal).
/** Solicita tokens a Spotify y actualiza S; persiste el refresh token cuando se emite uno nuevo. */
async function tok(body) {
  const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: S.cid, ...body }) });
  const d = await r.json();
  if (!r.ok) throw Object.assign(new Error(d.error_description || d.error), { code: d.error });
  S.at = d.access_token; S.exp = Date.now() + d.expires_in * 1000 - 60000;
  if (d.refresh_token) { S.rt = d.refresh_token; await bridge.saveSession({ cid: S.cid, rt: S.rt, sc: SCOPE }); }
}
/** Devuelve un access token vigente, renovándolo con 60 s de margen antes del vencimiento. */
// Renovación de una sola petición: las llamadas concurrentes (API y sondeos) esperan la misma promesa,
// de modo que un refresh token rotado nunca se consume dos veces.
let refreshing = null;
const token = async () => {
  if (Date.now() <= S.exp) return S.at;
  refreshing ??= tok({ grant_type: 'refresh_token', refresh_token: S.rt }).finally(() => { refreshing = null; });
  await refreshing;
  return S.at;
};
/** Cliente mínimo de la Web API: devuelve la Response sin interpretar. */
const sp = async (p, m = 'GET', b) => fetch('https://api.spotify.com/v1' + p, { method: m,
  headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });

/** Muestra la pantalla de configuración/conexión, con un mensaje opcional. */
function showLogin(msg = '') { $('player').hidden = true; $('setup').hidden = false; $('msg').textContent = msg; }
$('dash').onclick = () => bridge.openDashboard();
$('copy').onclick = () => { bridge.copyRedirect(); $('copy').textContent = '¡Copiada!'; setTimeout(() => $('copy').textContent = 'Copiar dirección', 1500); };
// Inicio del flujo: genera verifier y state, calcula el challenge S256 y abre el navegador del sistema.
$('login').onclick = async () => {
  const cid = $('cid').value.trim();
  if (!/^[a-f0-9]{32}$/i.test(cid)) return $('msg').textContent = 'El Client ID debe tener 32 caracteres.';
  S.cid = cid; ver = rand(48); state = rand(16);
  const ch = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver)));
  bridge.openLogin('https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: cid, response_type: 'code',
    redirect_uri: REDIRECT, scope: SCOPE, state, code_challenge_method: 'S256', code_challenge: ch }));
  $('msg').textContent = 'Completá el inicio de sesión en tu navegador…';
};
// Retorno del flujo OAuth: se verifica el state antes de canjear el código.
bridge.onAuth(async ({ code, state: s, error }) => {
  if (error || !code || s !== state) return showLogin('No se pudo iniciar sesión. Probá de nuevo.');
  try { await tok({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: ver }); start(); }
  catch (e) { showLogin(e.message); }
});

// ---------- Reproductor ----------
// Web Playback SDK: registra la aplicación como dispositivo de Spotify Connect (requiere Premium y Widevine).
function start() {
  $('setup').hidden = true; $('player').hidden = false;
  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new Spotify.Player({ name: 'Mini Player', getOAuthToken: cb => token().then(cb), volume: savedVol() });
    // 'ready' se emite de nuevo en cada reconexión del SDK, por lo que aquí NO se transfiere la reproducción:
    // hacerlo le quitaría el audio al dispositivo que el usuario esté usando.
    player.addListener('ready', ({ device_id }) => { dev = device_id; status(''); });
    ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(e => player.addListener(e, ({ message }) => status(message)));
    player.addListener('player_state_changed', s => { st = s; t0 = performance.now(); render(); });
    status('Conectando…');
    setTimeout(() => { if (!dev) status('Spotify no respondió. ¿Premium activo?'); }, 10000);
    player.connect();
  };
  const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js'; document.head.append(s);
}
// Mensaje breve de estado/error bajo el título (vacío = sin mensaje).
const status = t => $('status').textContent = t || '';

/** Refleja el estado del SDK en la interfaz: metadatos, play/pausa, aleatorio, portada y color. */
async function render() {
  if (st) { paintShuffle(!!st.shuffle); paintRepeat(st.repeat_mode || 0); }
  const t = st?.track_window?.current_track; if (!t) return;
  $('title').textContent = t.name; $('artist').textContent = t.artists.map(a => a.name).join(', ');
  bridge.nowPlaying?.(t.name, $('artist').textContent);
  for (const p of document.querySelectorAll('.pp svg')) p.innerHTML = st.paused ? ICON.play : ICON.pause;   // botón central (normal y rueda)
  $('dur').textContent = fmt(st.duration);
  if (t.uri !== curUri) { curUri = t.uri; syncLike(t.uri); if (tab === 'queue' && !$('library').hidden) loadQueue(); }   // la cola cambia con cada pista
  const url = t.album.images.reduce((a, b) => (b.height || 0) > (a.height || 0) ? b : a, t.album.images[0] || {}).url;
  if (url && url !== lastCover) {
    lastCover = url; const data = await bridge.cover(url); if (!data || url !== lastCover) return;   // descarta respuestas obsoletas
    coverData = data; $('cover').style.backgroundImage = `url(${data})`;
    const img = new Image(); img.onload = () => { if (url === lastCover) tint(img); }; img.src = data;
  }
}
// Progreso: el SDK emite estado solo ante eventos, por lo que la posición se interpola localmente cada 200 ms.
let dragging = false;
const show = r => { const pc = r * 100 + '%'; $('fill').style.width = pc; $('knob').style.left = pc; $('cur').textContent = fmt(r * st.duration); };
setInterval(() => {
  if (!st?.duration || dragging) return;
  show(Math.min(st.duration, st.paused ? st.position : st.position + performance.now() - t0) / st.duration);
}, 200);

// ---------- Color dominante de la portada ----------
/** RGB (0..255) a HSL (h en grados; s y l en 0..1). */
function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
/** HSL (h en grados; s y l en 0..1) a RGB (0..1). / HSL to RGB. */
function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}
/** Luminancia relativa según WCAG 2.x. / WCAG 2.x relative luminance. */
function relLuminance([r, g, b]) {
  const c = v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  return .2126 * c(r) + .7152 * c(g) + .0722 * c(b);
}
/**
 * Color dominante: la imagen se reduce a 24×24 px y sus píxeles se agrupan en 12 sectores de tono (30° cada uno),
 * ponderados por saturación². Se descartan píxeles muy oscuros, muy claros o casi acromáticos. Se toma el sector
 * de mayor peso y se oscurece hasta que el texto blanco alcance contraste AA.
 */
function tint(img) {
  const c = document.createElement('canvas'); c.width = c.height = 24;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
  const d = x.getImageData(0, 0, 24, 24).data, bk = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2]); if (l < .08 || l > .94 || s < .12) continue;
    const b = bk[Math.floor(h / 30) % 12], w = s * s; b.w += w; b.h += h * w; b.s += s * w; b.l += l * w;
  }
  const ranked = bk.filter(b => b.w > 0).sort((a, b) => b.w - a.w);
  // Se oscurece cada tono hasta contraste >= 4,5:1 con texto blanco; 0,17 deja margen para el degradado.
  const tone = b => {
    const h = b.h / b.w, s = Math.min(.75, Math.max(.35, b.s / b.w)); let l = Math.min(.4, Math.max(.22, b.l / b.w));
    while (l > .08 && relLuminance(hslToRgb(h, s, l)) > .17) l -= .02;
    return [h, s, l];
  };
  const c1 = ranked[0] ? tone(ranked[0]) : [250, .15, .25];   // respaldo: portada sin color dominante
  const c2 = ranked[1] && ranked[1].w > ranked[0].w * .2 ? tone(ranked[1]) : [(c1[0] + 30) % 360, c1[1], Math.max(.1, c1[2] - .1)];
  palette = [c1, c2]; paint();
}

// ---------- Apariencia ----------
// El tema se resuelve en variables CSS (--bg, --fg, --accent...) a partir de los ajustes y de la paleta de la
// portada actual.
let cfg = { bgMode: 'dynamic', bgColor: '#2a2060', accentMode: 'white', accentColor: '#ffffff', radius: 28, bgOpacity: 1,
  font: 'inter', btnStyle: 'raised', coverShape: 'rounded' };
let palette = null, coverData = '';
// Modo arcoíris: el tono avanza de forma continua (ciclo de ~22 s). Los colores se oscurecen igual que los de la
// portada para que el texto blanco conserve el contraste. Se pausa con la ventana oculta y se respeta la
// preferencia del sistema de reducir animaciones.
let hue = 0, rainbowTimer = null;
// Oscurece un color hasta que el texto blanco conserve el contraste (misma regla que para la portada).
const dark = (h, s, l) => { while (l > .08 && relLuminance(hslToRgb(h, s, l)) > .17) l -= .02; return [h % 360, s, l]; };
const rainbowPalette = h => [dark(h, .7, .4), dark(h + 50, .7, .4)];
// Activa o detiene la animación del modo arcoíris.
function setRainbow(on) {
  clearInterval(rainbowTimer); rainbowTimer = null;
  if (!on || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  rainbowTimer = setInterval(() => { if (!document.hidden) { hue = (hue + .8) % 360; paint(); } }, 50);
}
// Conversiones de color: HSL a texto CSS, hexadecimal a RGB (0..1) y RGB (0..1) a texto CSS.
const hsl = ([h, s, l]) => `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
const hexRgb = x => { const n = parseInt(x.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const rgbCss = c => `rgb(${c.map(v => Math.round(v * 255)).join(' ')})`;
// Por encima de este umbral de luminancia, el texto oscuro contrasta más que el blanco.
const isLight = rgb => relLuminance(rgb) > .179;
/** Resuelve el tema en variables CSS (fondo, acento, contraste, esquinas, transparencia) y el fondo difuminado. */
function paint() {
  const [c1, c2] = cfg.bgMode === 'rainbow' ? rainbowPalette(hue) : palette || [[250, .15, .25], [250, .15, .25]], fixed = cfg.bgMode === 'fixed';
  const light = fixed && isLight(hexRgb(cfg.bgColor));   // los demás modos siempre producen fondos oscuros
  const bg = fixed ? cfg.bgColor : (cfg.bgMode === 'gradient' || cfg.bgMode === 'rainbow') ? `linear-gradient(160deg, ${hsl(c1)}, ${hsl(c2)})` : hsl(c1);
  const accent = cfg.accentMode === 'custom' ? hexRgb(cfg.accentColor)
    : cfg.accentMode === 'auto' ? hslToRgb(c1[0], Math.max(.5, c1[1]), light ? .25 : .78)
    : light ? [.09, .1, .11] : [1, 1, 1];
  const set = (k, v) => document.documentElement.style.setProperty(k, v);
  set('--bg', bg); set('--fg', light ? '#16181d' : '#fff');
  set('--btn', light ? 'rgba(0,0,0,.1)' : 'rgba(0,0,0,.28)');
  set('--line', light ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.22)');
  set('--shade', light ? 'linear-gradient(160deg,rgba(255,255,255,.35),rgba(0,0,0,.06))' : 'linear-gradient(160deg,rgba(255,255,255,.1),rgba(0,0,0,.35))');
  set('--accent', rgbCss(accent)); set('--accent-fg', isLight(accent) ? '#16181d' : '#fff');
  set('--radius', (cfg.radius ?? 28) + 'px'); set('--bgo', cfg.bgOpacity ?? 1);
  const blur = cfg.bgMode === 'blur' && coverData;
  $('bgimg').hidden = !blur; if (blur) $('bgimg').style.backgroundImage = `url(${coverData})`;
  // Las flores son parte del tema Cherry: en cualquier otro tema (o personalizado) no se muestran.
  $('bloom').hidden = !(cfg.blossoms && cfg.preset === 'cherry');
}
// Pétalos: se crean una vez con valores aleatorios (CSSOM, compatible con la CSP) y se animan por CSS.
// El retraso negativo reparte los pétalos a lo largo de la caída desde el primer fotograma. Se pausan con la
// ventana oculta.
(() => {
  const r = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('i'); p.className = i % 3 ? 'pa' : 'pb';
    p.style.setProperty('--x', r(0, 100).toFixed(1) + '%');
    p.style.setProperty('--s', r(7, 13).toFixed(1) + 'px');
    p.style.setProperty('--d', r(9, 16).toFixed(1) + 's');
    p.style.setProperty('--dl', (-r(0, 16)).toFixed(1) + 's');
    p.style.setProperty('--sw', r(-30, 30).toFixed(0) + 'px');
    $('petals').append(p);
  }
  document.addEventListener('visibilitychange', () => document.body.classList.toggle('paused', document.hidden));
})();
// Escala: el proceso principal dimensiona la ventana; la interfaz (280 px de diseño) se ajusta a su ancho.
const fitScale = () => document.documentElement.style.setProperty('--z', (innerWidth / 280).toFixed(4));
addEventListener('resize', fitScale); fitScale();
// Elementos visibles, tipografía, estilo de botones y forma de portada: atributos/clases que activan reglas CSS.
const HIDES = { showCover: 'no-cover', showArtist: 'no-artist', showLike: 'no-like', showShuffle: 'no-shuffle', showRepeat: 'no-repeat', showDevices: 'no-devices', showTime: 'no-time', showVolume: 'no-volume' };
/** Aplica tipografía, estilo de botones, forma de portada y elementos ocultos (atributos y clases que activan reglas CSS). */
function applyLook() {
  const d = document.documentElement.dataset; d.font = cfg.font; d.btn = cfg.btnStyle; d.cover = cfg.coverShape;
  // En el modo rueda no hay fila de transporte: Aleatorio y Repetir vuelven a la barra superior.
  const wheel = cfg.btnStyle === 'wheel', inTop = $('shuf').parentElement === $('top');
  if (wheel && !inTop) $('top').insertBefore($('rep'), $('dev')), $('top').insertBefore($('shuf'), $('rep'));
  else if (!wheel && inTop) { $('ctl').prepend($('shuf')); $('ctl').append($('rep')); }
  for (const [k, c] of Object.entries(HIDES)) document.body.classList.toggle(c, cfg[k] === false);
}
// ---------- Temas secretos ----------
// El proceso principal entrega paquetes ya validados (solo datos). El SVG se vuelve a depurar aquí con una lista
// blanca de elementos y atributos antes de insertarlo; los estilos se aplican por CSSOM (compatible con la CSP).
let packs = [], pack = null, builtId = null, dim = 0;
const SVG_OK = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline', 'defs', 'symbol', 'use', 'linearGradient', 'radialGradient', 'stop']);
/** Depura un nodo SVG de forma recursiva: elimina elementos fuera de la lista blanca y atributos peligrosos (eventos, estilos, referencias externas). */
function cleanNode(n) {
  for (const c of [...n.children]) {
    if (!SVG_OK.has(c.localName)) { c.remove(); continue; }
    for (const at of [...c.attributes]) {
      const bad = /^on/i.test(at.name) || at.name === 'style' || (/href$/i.test(at.name) && !at.value.startsWith('#')) || /url\(\s*(?!#)/i.test(at.value);
      if (bad) c.removeAttribute(at.name);
    }
    cleanNode(c);
  }
}
/** Convierte un texto SVG en un nodo seguro; devuelve null si no es un SVG válido. */
function safeSvg(str) {
  const doc = new DOMParser().parseFromString(str, 'image/svg+xml'), root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) return null;
  cleanNode(root); root.removeAttribute('width'); root.removeAttribute('height');
  return document.importNode(root, true);
}
/** Reconstruye la decoración solo cuando cambia el tema secreto activo (no en cada ajuste). */
function applyPack() {
  pack = packs.find(p => p.id === cfg.preset) || null;
  $('secret').hidden = !pack; if ((pack?.id || null) === builtId) return;
  builtId = pack?.id || null; $('secret').replaceChildren(); prepSound();
  $('player').style.setProperty('--padb', (pack?.pad || 20) + 'px');   // margen inferior propio del tema
  if (!pack) return;
  if (pack.image) {   // imagen de fondo, con una capa oscura opcional para que el texto siga legible
    const bg = document.createElement('div'); bg.className = 'bgart', dim = pack.imageDim || 0;
    bg.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),url(${pack.image})`; $('secret').append(bg);
  }
  for (const d of pack.decor || []) {
    const s = safeSvg(d.svg); if (!s) continue;
    const w = document.createElement('div'); w.className = 'dec ' + d.at; w.append(s); $('secret').append(w);
  }
  const r = (x, y) => x + Math.random() * (y - x);
  for (let i = 0; i < (pack.fall?.count || 0); i++) {
    const s = safeSvg(pack.fall.svg); if (!s) break;
    const f = document.createElement('div'); f.className = 'fi'; f.append(s);
    f.style.setProperty('--x', r(0, 94).toFixed(1) + '%'); f.style.setProperty('--s', r(12, 20).toFixed(1) + 'px');
    f.style.setProperty('--d', r(9, 16).toFixed(1) + 's'); f.style.setProperty('--dl', (-r(0, 16)).toFixed(1) + 's');
    f.style.setProperty('--sw', r(-30, 30).toFixed(0) + 'px'); $('secret').append(f);
  }
}
// Sonido del tema: una muestra de audio (mp3 en base64) incluida en el paquete cifrado. Se decodifica una vez y se
// reproduce en cada pulsación de botón, con una leve variación de tono para que no suene siempre igual.
let actx, lastPlay = 0, sampleBuf = null, sampleFor = null;
/** Decodifica la muestra del tema activo (una sola vez por tema). */
async function prepSound() {
  if (sampleFor === (pack?.id || null)) return; sampleFor = pack?.id || null; sampleBuf = null;
  if (!pack?.sound?.data) return;
  try {
    const bin = atob(pack.sound.data), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    actx ??= new AudioContext(); sampleBuf = await actx.decodeAudioData(u.buffer);
  } catch (err) { sampleBuf = null; console.error('Sonido no disponible:', err); }
}
/** Reproduce la muestra con el volumen indicado; limita la frecuencia a una vez cada 150 ms. */
function playSample(vol) {
  if (performance.now() - lastPlay < 150) return; lastPlay = performance.now();
  if (actx.state === 'suspended') actx.resume();
  const s = actx.createBufferSource(), g = actx.createGain(); s.buffer = sampleBuf; s.playbackRate.value = .9 + Math.random() * .25;
  g.gain.value = vol; s.connect(g); g.connect(actx.destination); s.start();
}
// Cada pulsación de un botón dispara el sonido del tema activo (si está habilitado).
document.addEventListener('click', e => {
  if (!(sampleBuf && pack?.sound && cfg.sfx !== false && e.target.closest('button'))) return;
  try { playSample(pack.sound.volume); } catch (err) { console.error('Sonido:', err); status('Sonido: ' + err.message); }
}, true);
bridge.secretList?.().then(p => { packs = p; builtId = undefined; applyPack(); });
bridge.onSecrets?.(p => { packs = p; builtId = undefined; applyPack(); });
// Punto único de entrada para los ajustes: actualiza el estado y repinta todo lo que depende de ellos.
const applyCfg = s => { cfg = s; setRainbow(s.bgMode === 'rainbow'); applyLook(); applyPack(); paint(); };
// Alto de diseño: la ventana se ajusta a lo que hay visible. Se informa al proceso principal (que redimensiona).
// ResizeObserver mide el diseño sin escala, por lo que no depende de --z.
let lastH = 0, rq = 0;
const reportSize = () => {
  rq = 0; const el = [$('player'), $('setup')].find(e => !e.hidden), h = el?.offsetHeight;
  if (h > 100 && h !== lastH) { lastH = h; bridge.setLayoutHeight(h); }
};
const ro = new ResizeObserver(() => { rq ||= requestAnimationFrame(reportSize); });
ro.observe($('player')); ro.observe($('setup'));
bridge.onSettings?.(applyCfg);
bridge.getSettings?.().then(applyCfg);

// ---------- Controles ----------
/**
 * Play/pausa. Si este dispositivo no es el activo (getCurrentState() === null), pulsar play es una acción
 * explícita del usuario y transfiere la reproducción aquí; nunca se transfiere de forma automática.
 */
async function togglePlayback() {
  if (!player || !dev) return;
  if (await player.getCurrentState()) return player.togglePlay();
  const r = await sp('/me/player', 'PUT', { device_ids: [dev], play: true });
  if (!r.ok) status('No se pudo iniciar la reproducción (' + r.status + ')');
}
$('play').onclick = togglePlayback;
$('prev').onclick = () => player?.previousTrack();
$('next').onclick = () => player?.nextTrack();
// Barra de progreso: arrastre con captura de puntero; el seek se ejecuta al soltar para no generar saltos de audio.
const ratio = e => { const r = $('track').getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
$('bar').onpointerdown = e => { if (!st?.duration) return; dragging = true; $('bar').classList.add('drag'); $('bar').setPointerCapture(e.pointerId); show(ratio(e)); };
$('bar').onpointermove = e => { if (dragging) show(ratio(e)); };
$('bar').onpointerup = e => {
  if (!dragging) return; dragging = false; $('bar').classList.remove('drag');
  const r = ratio(e); player.seek(r * st.duration); st.position = r * st.duration; t0 = performance.now();
};
$('bar').onpointercancel = () => { dragging = false; $('bar').classList.remove('drag'); };
// Arrastre de ventana: el movimiento se delega al proceso principal; se excluyen los controles interactivos.
let from = null;
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button,input,#bar')) return;
  from = { x: e.screenX, y: e.screenY }; bridge.dragStart(); e.target.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => { if (from) bridge.dragMove(e.screenX - from.x, e.screenY - from.y); });
document.addEventListener('pointerup', () => from = null);
document.addEventListener('pointercancel', () => from = null);
$('pin').onclick = async () => $('pin').classList.toggle('on', await bridge.togglePin());
$('close').onclick = () => bridge.close();
$('cfg').onclick = () => bridge.openSettings();
bridge.onPinned?.(v => $('pin').classList.toggle('on', v));
bridge.onMedia?.(cmd => { if (!player) return; if (cmd === 'toggle') togglePlayback(); else if (cmd === 'next') player.nextTrack(); else if (cmd === 'prev') player.previousTrack(); });
// Atajo: al pegar (Ctrl+V) un enlace de Spotify se inicia su reproducción.
document.addEventListener('paste', async e => {
  if (e.target.tagName === 'INPUT' || !dev) return;
  const m = (e.clipboardData.getData('text') || '').match(LINK); if (!m) return;
  await playUri(`spotify:${m[1]}:${m[2]}`);
});

// ---------- Me gusta (guardar en la biblioteca) ----------
// Usa los endpoints de biblioteca vigentes (/me/library). Actualización optimista con reversión ante error.
let curUri = '', liked = false, busy = false, likeTouched = 0;
/** Refleja el estado de Me gusta en el botón (ícono y descripción). */
function paintLike(on) {
  liked = on; $('like').classList.toggle('on', on); $('like').firstElementChild.innerHTML = on ? ICON.check : ICON.plus;
  $('like').title = on ? 'Quitar de tus Me gusta' : 'Guardar en tus Me gusta';
}
/** Consulta a Spotify si la pista actual está guardada; oculta el botón si no es una canción (p. ej. un episodio). */
async function syncLike(uri) {
  const ok = uri?.startsWith('spotify:track:'); $('like').hidden = !ok; if (!ok) return;
  paintLike(false);
  try { const r = await sp('/me/library/contains?uris=' + encodeURIComponent(uri)); if (r.ok && uri === curUri) paintLike((await r.json())[0] === true); } catch {}
}
$('like').onclick = async () => {
  if (busy || !curUri) return; busy = true; likeTouched = Date.now(); const want = !liked; paintLike(want);
  const r = await sp('/me/library?uris=' + encodeURIComponent(curUri), want ? 'PUT' : 'DELETE');
  if (!r.ok) { paintLike(!want); status('No se pudo guardar (' + r.status + ')'); }
  busy = false;
};

// Sondeo periódico: refleja cambios hechos desde otros dispositivos (el SDK no emite eventos para ello).
// Se omite con la ventana oculta y tras una acción reciente del usuario, para no sobrescribirla.
setInterval(async () => {
  const uri = curUri;
  if (!uri.startsWith('spotify:track:') || document.hidden || busy || Date.now() - likeTouched < 4000) return;
  try {
    const r = await sp('/me/library/contains?uris=' + encodeURIComponent(uri));
    if (!r.ok || uri !== curUri || busy) return;
    const v = (await r.json())[0] === true; if (v !== liked) paintLike(v);
  } catch {}
}, 5000);

// ---------- Aleatorio ----------
// El estado real proviene del SDK (state.shuffle); el botón solo solicita el cambio a la Web API.
let shuffled = false;
function paintShuffle(on) { shuffled = on; $('shuf').classList.toggle('on', on); $('shuf').title = on ? 'Aleatorio: activado' : 'Aleatorio: desactivado'; }
$('shuf').onclick = async () => {
  if (!dev) return; const want = !shuffled; paintShuffle(want);
  const r = await sp(`/me/player/shuffle?state=${want}&device_id=${dev}`, 'PUT');
  if (!r.ok) { paintShuffle(!want); status('No se pudo cambiar el aleatorio (' + r.status + ')'); }
};

// ---------- Repetir ----------
// repeat_mode del SDK: 0 apagado, 1 contexto (playlist/álbum), 2 pista. La Web API recibe el nombre del modo.
const REPEAT = ['off', 'context', 'track'], REPEAT_TXT = ['Repetir: apagado', 'Repetir: playlist o álbum', 'Repetir: esta canción'];
let repMode = 0;
/** Refleja el modo de repetición en el botón (apagado, playlist/álbum o canción). */
function paintRepeat(m) {
  repMode = m; $('rep').classList.toggle('on', m > 0); $('rep').title = REPEAT_TXT[m];
  $('rep').firstElementChild.innerHTML = m === 2 ? ICON.repeat1 : ICON.repeat;
}
$('rep').onclick = async () => {
  if (!dev) return; const prev = repMode, want = (prev + 1) % 3; paintRepeat(want);
  const r = await sp(`/me/player/repeat?state=${REPEAT[want]}&device_id=${dev}`, 'PUT');
  if (!r.ok) { paintRepeat(prev); status('No se pudo cambiar el modo de repetición (' + r.status + ')'); }
};

// ---------- Volumen ----------
const savedVol = () => { const v = parseFloat(localStorage.getItem('vol')); return Number.isFinite(v) ? v : .6; };
$('vol').value = savedVol() * 100;
let volTouched = 0;
/** Aplica un volumen 0..100 (control superior, rueda del ratón o modo VOL de la rueda). */
function applyVolume(p) {
  p = Math.min(100, Math.max(0, Math.round(p))); $('vol').value = p; volTouched = Date.now(); volLabel();
  player?.setVolume(p / 100); try { localStorage.setItem('vol', p / 100); } catch {}
}
$('vol').oninput = () => applyVolume(+$('vol').value);
// Sondeo de volumen: sincroniza cambios remotos (Spotify Connect) solo si este dispositivo es el activo
// y la ventana está visible.
setInterval(async () => {
  if (!dev || document.hidden || Date.now() - volTouched < 3000) return;   // período de gracia tras una interacción local
  try {
    const r = await sp('/me/player'); if (r.status !== 200) return;
    const d = (await r.json()).device;
    if (d?.id !== dev || d.volume_percent == null || Math.abs(d.volume_percent - $('vol').value) < 2) return;
    $('vol').value = d.volume_percent; volLabel(); try { localStorage.setItem('vol', d.volume_percent / 100); } catch {}
  } catch {}
}, 3000);

// ---------- Rueda estilo MP4 ----------
// MENU abre los ajustes; VOL activa un modo en el que ◀ ▶ pasan a ser − / + (5 %) y que se desactiva solo a los
// 5 s. La rueda del ratón sobre el dial ajusta el volumen siempre.
let volMode = false, volTimer;
// Texto del botón VOL: muestra el porcentaje mientras el modo volumen está activo.
function volLabel() { $('wVol').textContent = volMode ? 'VOL ' + Math.round($('vol').value) : 'VOL'; }
// Activa o desactiva el modo volumen: ◀ ▶ pasan a ser − / + y el modo se apaga solo a los 5 s.
function setVolMode(on) {
  volMode = on; clearTimeout(volTimer); $('wVol').classList.toggle('on', on);
  $('wPrev').firstElementChild.innerHTML = on ? ICON.minus : ICON.prev; $('wNext').firstElementChild.innerHTML = on ? ICON.plus : ICON.next;
  $('wPrev').title = on ? 'Bajar volumen' : 'Anterior'; $('wNext').title = on ? 'Subir volumen' : 'Siguiente';
  if (on) volTimer = setTimeout(() => setVolMode(false), 5000);
  volLabel();
}
// Cambia el volumen en `d` puntos y reinicia el temporizador del modo volumen.
const nudge = d => { applyVolume(+$('vol').value + d); if (volMode) setVolMode(true); };
$('wPlay').onclick = togglePlayback;
$('wMenu').onclick = () => bridge.openSettings();
$('wVol').onclick = () => setVolMode(!volMode);
$('wPrev').onclick = () => volMode ? nudge(-5) : player?.previousTrack();
$('wNext').onclick = () => volMode ? nudge(5) : player?.nextTrack();
$('wheel').addEventListener('wheel', e => { e.preventDefault(); nudge(e.deltaY < 0 ? 5 : -5); }, { passive: false });

// ---------- Biblioteca y buscador ----------
/** Reproduce un contexto (playlist, álbum, artista o pista) en este dispositivo. Devuelve true si Spotify aceptó la orden. */
async function playUri(uri, ctx) {
  if (!dev) { status('El reproductor aún no está listo'); return false; }
  let body = { context_uri: uri };
  if (uri.startsWith('spotify:track:')) {   // Una pista suelta se inicia dentro de su álbum para heredar la continuidad (autoplay) del contexto.
    if (!ctx) { try { const t = await sp('/tracks/' + uri.split(':')[2]); if (t.ok) ctx = (await t.json()).album?.uri; } catch {} }
    body = ctx ? { context_uri: ctx, offset: { uri } } : { uris: [uri] };
  }
  const r = await sp('/me/player/play?device_id=' + dev, 'PUT', body);
  status(r.ok ? '' : 'No se pudo reproducir (' + r.status + ')'); return r.ok;
}
/** Reproduce una lista de pistas empezando por `uri`, para que la reproducción continúe con las siguientes. */
async function playTracks(list, uri) {
  if (!dev) { status('El reproductor aún no está listo'); return false; }
  const r = await sp('/me/player/play?device_id=' + dev, 'PUT', { uris: list.slice(0, 100), offset: { uri } });
  status(r.ok ? '' : 'No se pudo reproducir (' + r.status + ')'); return r.ok;
}
// Elige la imagen más chica de la lista (suficiente para las miniaturas).
const img = a => a?.length ? a[a.length - 1].url : null;
// Encabezado de sección (o nota) como elemento de lista.
const sec = (t, cls = 'sec') => { const d = document.createElement('li'); d.className = cls; d.textContent = t; return d; };
const note = t => sec(t, 'sec empty');
/** Fila de resultado construida por DOM con textContent (nunca innerHTML): los nombres provienen de contenido de usuarios. */
function row(o) {
  const li = document.createElement('li'); li.className = 'it';
  const th = document.createElement('div'); th.className = 'th';
  if (o.img?.startsWith('https://')) th.style.backgroundImage = `url("${o.img.replace(/"/g, '%22')}")`;
  const tx = document.createElement('div'); tx.className = 'tx';
  const b = document.createElement('b'); b.textContent = o.name;
  const s = document.createElement('span'); s.textContent = o.sub;
  tx.append(b, s); li.append(th, tx);
  if (o.plain) { li.classList.add('plain'); return li; }   // filas informativas (cola): sin acción al hacer clic
  li.tabIndex = 0; li.setAttribute('role', 'button');
  // Botón "+": agrega la pista a la cola sin interrumpir lo que suena.
  if (o.uri.startsWith('spotify:track:')) {
    const q = document.createElement('button'); q.className = 'btn mini qb'; q.title = 'Agregar a la cola';
    q.innerHTML = '<svg viewBox="0 0 24 24">' + ICON.plus + '</svg>';
    q.onclick = e => { e.stopPropagation(); addToQueue(o.uri, q); };
    li.append(q);
  }
  const go = async () => { if (await (o.list ? playTracks(o.list, o.uri) : playUri(o.uri, o.ctx))) toggleLib(false); };
  li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter' && e.target === li) go(); };
  return li;
}
/** Agrega una pista a la cola del reproductor y muestra una confirmación breve en el botón. */
async function addToQueue(uri, btn) {
  if (!dev) return status('El reproductor aún no está listo');
  const r = await sp('/me/player/queue?uri=' + encodeURIComponent(uri) + '&device_id=' + dev, 'POST');
  if (!r.ok) return status(r.status === 404 ? 'Primero reproducí algo en este reproductor' : 'No se pudo agregar a la cola (' + r.status + ')');
  btn.firstElementChild.innerHTML = ICON.check; status('Agregada a la cola');
  setTimeout(() => { btn.firstElementChild.innerHTML = ICON.plus; status(''); }, 1500);
}
// Reemplaza el contenido de la lista y vuelve al principio.
const fill = parts => { const l = $('list'); l.replaceChildren(...parts); l.scrollTop = 0; };
// Subtítulo de una playlist: autor.
const owner = p => 'Playlist · ' + (p.owner?.display_name || '');

/** Lista las playlists del usuario (hasta 150, en 3 páginas). */
async function loadPlaylists() {
  fill([note('Cargando…')]);
  let url = '/me/playlists?limit=50', out = [];
  for (let i = 0; i < 3 && url; i++) {
    const r = await sp(url); if (!r.ok) return fill([note('No se pudieron cargar tus playlists (' + r.status + ')')]);
    if (tab !== 'search') return;
    const d = await r.json(); out.push(...d.items.filter(Boolean));
    url = d.next ? d.next.replace('https://api.spotify.com/v1', '') : null;
  }
  if ($('q').value.trim()) return;
  fill([sec('Tus playlists'), ...out.map(p => row({ name: p.name, sub: owner(p), uri: p.uri, img: img(p.images) }))]);
}
// El modo desarrollo limita la búsqueda a 10 resultados por consulta; se piden 3 por tipo.
/** Busca canciones, álbumes, artistas y playlists y arma la lista de resultados. */
async function search(q) {
  const r = await sp('/search?' + new URLSearchParams({ q, type: 'track,album,playlist,artist', limit: 3 }));
  if (tab !== 'search' || q !== $('q').value.trim()) return;   // descarta respuestas obsoletas (el usuario siguió escribiendo)
  if (!r.ok) return fill([note('Error al buscar (' + r.status + ')')]);
  const d = await r.json(), parts = [];
  const add = (title, o, map) => { const xs = (o?.items || []).filter(Boolean); if (xs.length) parts.push(sec(title), ...xs.map(x => row(map(x)))); };
  add('Canciones', d.tracks, t => ({ name: t.name, sub: t.artists.map(a => a.name).join(', '), uri: t.uri, ctx: t.album?.uri, img: img(t.album?.images) }));
  add('Álbumes', d.albums, a => ({ name: a.name, sub: a.artists.map(x => x.name).join(', '), uri: a.uri, img: img(a.images) }));
  add('Artistas', d.artists, a => ({ name: a.name, sub: 'Artista', uri: a.uri, img: img(a.images) }));
  add('Playlists', d.playlists, p => ({ name: p.name, sub: owner(p), uri: p.uri, img: img(p.images) }));
  fill(parts.length ? parts : [note('Sin resultados')]);
}
// Pestañas de la vista de biblioteca: Buscar · Me gusta · Top · Cola · Historial. Cada carga descarta su resultado
// si el usuario cambió de pestaña mientras esperaba.
let tab = 'search';
const trackRow = (t, list) => row({ name: t.name, sub: t.artists.map(a => a.name).join(', '), uri: t.uri, ctx: t.album?.uri, img: img(t.album?.images), list });
/** Canciones guardadas (hasta 100, en 2 páginas). */
async function loadLiked() {
  fill([note('Cargando…')]);
  let url = '/me/tracks?limit=50', out = [];
  for (let i = 0; i < 2 && url; i++) {
    const r = await sp(url); if (tab !== 'liked') return;
    if (!r.ok) return fill([note('No se pudieron cargar tus Me gusta (' + r.status + ')')]);
    const d = await r.json(); out.push(...d.items.map(x => x.track).filter(t => t?.uri));
    url = d.next ? d.next.replace('https://api.spotify.com/v1', '') : null;
  }
  const uris = out.map(t => t.uri);
  fill(out.length ? [sec('Canciones que te gustan'), ...out.map(t => trackRow(t, uris))] : [note('Todavía no guardaste canciones')]);
}
// Período del Top: short_term (4 semanas), medium_term (6 meses) o long_term (un año).
let topRange = 'medium_term';
/** Canciones más escuchadas del usuario en el período elegido (hasta 30). */
async function loadTop() {
  fill([note('Cargando…')]);
  const r = await sp('/me/top/tracks?limit=30&time_range=' + topRange); if (tab !== 'top') return;
  if (!r.ok) return fill([note('No se pudieron cargar tus más escuchados (' + r.status + ')')]);
  const items = ((await r.json()).items || []).filter(t => t?.uri), uris = items.map(t => t.uri);
  fill(items.length ? [sec('Tus más escuchados'), ...items.map(t => trackRow(t, uris))] : [note('Todavía no hay datos suficientes')]);
}
for (const b of document.querySelectorAll('#ranges button')) b.onclick = () => {
  topRange = b.dataset.r; for (const x of document.querySelectorAll('#ranges button')) x.classList.toggle('on', x === b); loadTop();
};
/** Cola de reproducción: pista actual y las siguientes (solo lectura). */
async function loadQueue() {
  fill([note('Cargando…')]);
  const r = await sp('/me/player/queue'); if (tab !== 'queue') return;
  if (!r.ok) return fill([note('No se pudo cargar la cola (' + r.status + ')')]);
  const d = await r.json(), cur = d.currently_playing, parts = [];
  const map = t => ({ name: t.name, sub: (t.artists || []).map(x => x.name).join(', '), img: img(t.album?.images), plain: true });
  if (cur) parts.push(sec('Sonando ahora'), row(map(cur)));
  const next = (d.queue || []).filter(t => t?.name);
  parts.push(sec('A continuación'), ...(next.length ? next.map(t => row(map(t))) : [note('La cola está vacía')]));
  fill(parts);
}
/** Últimas 30 reproducciones, sin repeticiones consecutivas. */
async function loadHistory() {
  fill([note('Cargando…')]);
  const r = await sp('/me/player/recently-played?limit=30'); if (tab !== 'history') return;
  if (!r.ok) return fill([note('No se pudo cargar el historial (' + r.status + ')')]);
  const items = (await r.json()).items || [], seen = [];
  for (const it of items) { const t = it.track; if (t && seen[seen.length - 1]?.uri !== t.uri) seen.push(t); }   // quita repeticiones consecutivas
  fill(seen.length ? [sec('Escuchado recientemente'), ...seen.map(t => row({ name: t.name, sub: t.artists.map(a => a.name).join(', '), uri: t.uri, ctx: t.album?.uri, img: img(t.album?.images) }))] : [note('Todavía no hay historial')]);
}
/** Cambia de pestaña en la biblioteca y carga su contenido. */
function setTab(t) {
  tab = t; for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.t === t);
  $('q').hidden = t !== 'search'; $('ranges').hidden = t !== 'top';
  if (t === 'search') { $('q').focus(); $('q').value.trim() ? search($('q').value.trim()) : loadPlaylists(); }
  else if (t === 'liked') loadLiked(); else if (t === 'top') loadTop(); else if (t === 'queue') loadQueue(); else loadHistory();
}
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => setTab(b.dataset.t);
let timer;
$('q').oninput = () => { clearTimeout(timer); const q = $('q').value.trim(); timer = setTimeout(() => q ? search(q) : loadPlaylists(), 350); };
$('q').onkeydown = async e => {
  const m = e.key === 'Enter' && $('q').value.match(LINK);
  if (m && await playUri(`spotify:${m[1]}:${m[2]}`)) toggleLib(false);
};
/** Muestra u oculta la vista de biblioteca (reemplaza a la vista del reproductor mientras está abierta). */
function toggleLib(open = $('library').hidden) {
  $('library').hidden = !open; $('now').hidden = open; $('player').classList.toggle('lib', open); $('libbtn').classList.toggle('on', open);
  if (open) { $('q').value = ''; setTab('search'); }
}
$('libbtn').onclick = () => toggleLib();
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('devs').hidden) toggleDevices(false); else if (!$('library').hidden) toggleLib(false);
});

// ---------- Aviso de actualización ----------
/** Consulta (vía el proceso principal) si hay una versión nueva y, de haberla, muestra el aviso con su botón. */
async function checkUpdate() {
  const u = await bridge.checkUpdate?.(); if (!u) return;
  $('updt').textContent = 'Nueva versión ' + u.version; $('upd').hidden = false;
}
$('updgo').onclick = () => bridge.openUpdate();
$('updx').onclick = () => $('upd').hidden = true;

// ---------- Dispositivos (Spotify Connect) ----------
// Elegir uno transfiere la reproducción: es una acción explícita del usuario.
async function toggleDevices(open = $('devs').hidden) {
  $('devs').hidden = !open; $('dev').classList.toggle('on', open); if (!open) return;
  $('devs').replaceChildren(note('Buscando dispositivos…'));
  const r = await sp('/me/player/devices'); if ($('devs').hidden) return;
  if (!r.ok) return $('devs').replaceChildren(note('No se pudieron cargar los dispositivos (' + r.status + ')'));
  const ds = ((await r.json()).devices || []).filter(d => d.id);
  $('devs').replaceChildren(...(ds.length ? ds.map(d => {
    const li = document.createElement('li'); li.className = 'it' + (d.is_active ? ' cur' : ''); li.tabIndex = 0; li.setAttribute('role', 'button');
    const tx = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span'); tx.className = 'tx';
    b.textContent = d.name; s.textContent = (d.id === dev ? 'Este reproductor · ' : '') + (d.is_active ? 'Reproduciendo' : d.type);
    tx.append(b, s); li.append(tx);
    const go = async () => {
      const t = await sp('/me/player', 'PUT', { device_ids: [d.id] });
      status(t.ok ? '' : 'No se pudo cambiar de dispositivo (' + t.status + ')'); toggleDevices(false);
    };
    li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter') go(); };
    return li;
  }) : [note('No hay dispositivos disponibles')]));
}
$('dev').onclick = () => toggleDevices();

// ---------- Arranque: retoma la sesión guardada ----------
(async () => {
  const saved = await bridge.loadSession();
  if (!saved) return showLogin();
  // Los permisos solicitados cambiaron desde que se guardó la sesión: se exige reautorización.
  if (saved.sc !== SCOPE) { $('cid').value = saved.cid; await bridge.clearSession(); return showLogin('Se agregaron permisos nuevos: volvé a conectarte.'); }
  S.cid = saved.cid; S.rt = saved.rt;
  try { await token(); start(); checkUpdate(); }
  catch (e) {
    if (e.code === 'invalid_grant') { await bridge.clearSession(); showLogin('Tu sesión expiró. Volvé a conectarte.'); }
    else { $('cid').value = S.cid; showLogin('No se pudo conectar. Revisá tu internet y reabrí la app.'); }
  }
})();
