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
const SCOPE = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-library-modify user-read-recently-played user-top-read playlist-modify-public playlist-modify-private user-follow-read';
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
  prev: '<path d="M6 6h2v12H6zM9.5 12 18 6v12z"/>', next: '<path d="M16 6h2v12h-2zM6 18V6l8.5 6z"/>', check: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  vol: '<path d="M3 9v6h4l5 5V4L7 9zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/>',
  mute: '<path d="M3 9v6h4l5 5V4L7 9zm12.3.3 1.4-1.4 2.3 2.3 2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3z"/>' };
// Estado de módulo: credenciales en memoria (S), parámetros del login en curso y estado del reproductor.
let S = { cid: '', rt: '', at: '', exp: 0 }, ver, state, player, dev, st, t0 = 0, lastCover = '';
// Fuente de lo que suena ('spotify' o 'youtube') y estado del reproductor de YouTube (ver la sección YouTube).
let src = 'spotify', yt = null, ytReady = false, ytApi = null, ytList = [], ytIdx = -1, ytId = '';
// Lista propia que está sonando ({ l, i, uri, started, ending }) y lista abierta en la pestaña Listas (ver «Listas propias»).
let listPlay = null, openListId = null;
// Enlace de YouTube (video, shorts, embed, live o youtu.be) con su ID de 11 caracteres.
const YTID = /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/;

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
/**
 * Cliente mínimo de la Web API: devuelve la Response sin interpretar.
 * Si Spotify limita las consultas (429) se respeta la espera que indica (cabecera Retry-After o, si no llega, una
 * espera que crece en cada intento): mientras dure no se hace ningún pedido de ese grupo, porque insistir puede
 * alargar el castigo. Hay dos grupos con espera propia: los datos (listas, búsqueda, Me gusta) y los comandos de
 * reproducción (play, pausa, volumen, cola…), que siguen funcionando aunque los datos estén limitados.
 */
const blocked = { data: 0, cmd: 0 }, strikes = { data: 0, cmd: 0 };
const kind = (p, m) => m !== 'GET' && p.startsWith('/me/player') ? 'cmd' : 'data';
const sp = async (p, m = 'GET', b) => {
  const k = kind(p, m);
  if (Date.now() < blocked[k]) return new Response(null, { status: 429 });   // en espera: sin tocar la red
  const r = await fetch('https://api.spotify.com/v1' + p, { method: m,
    headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) });
  if (r.status === 429) {
    const hdr = Number(r.headers.get('Retry-After')); strikes[k]++;
    blocked[k] = Date.now() + Math.min(hdr > 0 ? hdr : 60 * 2 ** (strikes[k] - 1), 86400) * 1000;   // máximo un día
  } else if (r.ok) strikes[k] = 0;
  return r;
};
/** Tiempo de espera restante de un grupo, en palabras. */
const waitText = k => { const s = Math.max(1, Math.ceil((blocked[k] - Date.now()) / 1000)); return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h'; };
/** Motivo de un error de la API: el 429 se explica en lugar de mostrar solo el número. */
const why = (s, k = 'data') => s === 429 ? 'Spotify limitó las consultas, esperá ' + waitText(k) : s;

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
    player.addListener('player_state_changed', s => {
      const prev = st, prevT0 = t0; st = s; t0 = performance.now();
      if (listPlay && src === 'spotify') checkListEnd(prev, prevT0, s);   // ¿terminó la canción de la lista?
      render();
    });
    status('Conectando…');
    setTimeout(() => { if (!dev) status('Spotify no respondió. ¿Premium activo?'); }, 10000);
    player.connect();
  };
  const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js'; document.head.append(s);
}
// Mensaje breve de estado/error bajo el título (vacío = sin mensaje).
let statusTimer, statusNow = '';   // statusNow: el aviso tal como se pidió (en pantalla puede estar traducido)
const status = (t, ms = 0) => {
  clearTimeout(statusTimer); statusNow = t || ''; $('status').textContent = $('status').title = statusNow;   // title: texto completo si no entra
  if (t && ms) statusTimer = setTimeout(() => { if (statusNow === t) status(''); }, ms);
};

/** Refleja el estado del SDK en la interfaz: metadatos, play/pausa, aleatorio, portada y color. */
async function render() {
  // Con YouTube activo, el estado de Spotify solo importa si Spotify vuelve a sonar (por ejemplo, desde la biblioteca).
  if (src === 'youtube') { if (st && !st.paused) useSpotify(); else return; }
  if (st) { paintShuffle(!!st.shuffle); paintRepeat(st.repeat_mode || 0); }
  const t = st?.track_window?.current_track; if (!t) return;
  $('title').textContent = t.name; $('artist').textContent = t.artists.map(a => a.name).join(', ');
  bridge.nowPlaying?.(t.name, $('artist').textContent);
  for (const p of document.querySelectorAll('.pp svg')) p.innerHTML = st.paused ? ICON.play : ICON.pause;   // botón central (normal y rueda)
  $('dur').textContent = fmt(st.duration);
  let changed = false;   // true si cambió la pista (la primera al abrir la app no cuenta): sirve para el aviso
  if (t.uri !== curUri) { if (!$('pick').hidden) togglePick(false); changed = !!curUri; curUri = t.uri; syncLike(t.uri); if (tab === 'queue' && !$('library').hidden) loadQueue(); }   // la cola cambia con cada pista
  const url = t.album.images.reduce((a, b) => (b.height || 0) > (a.height || 0) ? b : a, t.album.images[0] || {}).url;
  let cover = coverData;   // portada vigente (la anterior mientras no haya otra)
  if (url && url !== lastCover) {
    lastCover = url; const data = await bridge.cover(url); if (url !== lastCover) return;   // descarta respuestas obsoletas
    if (data) {
      coverData = cover = data; setCover(data);
      // Se espera a que el color de la portada nueva esté aplicado: el aviso debe salir con el color de esta canción, no de la anterior.
      await new Promise(done => { const img = new Image(); img.onload = () => { if (url === lastCover) tint(img); done(); }; img.onerror = done; img.src = data; });
      if (url !== lastCover) return;
    } else cover = '';
  }
  if (changed) announce(t, url ? cover : '');
}
/** Envía los datos de la pista nueva a la ventanita de aviso, si la opción está activa y esta ventana no tiene el foco. */
function announce(t, cover, preview = false) {
  if (!cfg.trackNotice || (!preview && document.hasFocus())) return;
  // El aviso toma del tema actual el fondo (sólido o degradado), el texto y el color de acento; main valida cada uno.
  const cs = getComputedStyle(document.documentElement), v = k => cs.getPropertyValue(k).trim();
  bridge.announce?.({ title: t.name, artist: t.artists.map(a => a.name).join(', '), cover, bg: v('--bg'), fg: v('--fg'), accent: v('--accent'), preview });
}
// Progreso: el SDK emite estado solo ante eventos, por lo que la posición se interpola localmente cada 200 ms.
let dragging = false;
// Duración vigente en ms (de Spotify o del video de YouTube).
const curDur = () => src === 'youtube' ? (ytReady ? yt.getDuration() * 1000 : 0) : st?.duration || 0;
const show = r => { const pc = r * 100 + '%'; $('fill').style.width = pc; $('knob').style.left = pc; $('cur').textContent = fmt(r * curDur()); };
setInterval(() => {
  if (dragging) return;
  if (src === 'youtube') {   // YouTube informa la posición al consultarla (sin red)
    const d = curDur(); if (!d) return;
    $('dur').textContent = fmt(d); return show(Math.min(1, yt.getCurrentTime() * 1000 / d));
  }
  if (!st?.duration) return;
  show(Math.min(st.duration, st.paused ? st.position : st.position + performance.now() - t0) / st.duration);
}, 200);
/** Pinta la portada (en el modo video, también el fondo difuminado de los costados). */
const setCover = data => $('cover').style.setProperty('--cov', `url(${data})`);

// ---------- Color dominante de la portada ----------
/** RGB (0..255) a HSL (h en grados; s y l en 0..1). */
function toHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
/** HSL (h en grados; s y l en 0..1) a RGB (0..1). */
function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}
/** Luminancia relativa según WCAG 2.x. */
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
  palette = [c1, c2]; trio = trioColors(img); paint();
}

/**
 * Tema Trío: los tres colores más presentes de la portada, ordenados por superficie. A diferencia de tint(), no se
 * descartan oscuros, claros ni grises (un fondo negro o blanco puede ser el color principal). Los píxeles se agrupan en
 * cubos (tono × luminosidad; los neutros solo por luminosidad) y se eligen cubos cuyos colores se distingan entre sí.
 * Devuelve hasta 3 colores RGB (0..1); los que no existan quedan en null.
 */
function trioColors(img) {
  const N = 32, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data, bk = new Map(); let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2]); total++;
    const key = s < .15 || l < .1 || l > .92 ? 'n' + Math.min(3, Math.floor(l * 4)) : 'c' + (Math.floor(h / 30) % 12) + (l < .35 ? 0 : l < .65 ? 1 : 2);
    const b = bk.get(key) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; bk.set(key, b);
  }
  const ranked = [...bk.values()].sort((a, b) => b.n - a.n).map(b => ({ n: b.n, c: [b.r / b.n, b.g / b.n, b.b / b.n] }));
  const out = [];
  for (const b of ranked) {
    if (out.length && b.n < total * .015) break;   // ignora manchas minúsculas
    if (out.every(o => Math.hypot(o[0] - b.c[0], o[1] - b.c[1], o[2] - b.c[2]) >= 70)) out.push(b.c);
    if (out.length === 3) break;
  }
  return [0, 1, 2].map(i => out[i] ? out[i].map(v => v / 255) : null);
}

// ---------- Apariencia ----------
// El tema se resuelve en variables CSS (--bg, --fg, --accent...) a partir de los ajustes y de la paleta de la
// portada actual.
let cfg = { bgMode: 'dynamic', bgColor: '#2a2060', accentMode: 'white', accentColor: '#ffffff', radius: 28, bgOpacity: 1,
  font: 'inter', btnStyle: 'raised', coverShape: 'rounded' };
let palette = null, trio = null, coverData = '';
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
// Contraste WCAG entre dos colores RGB (0..1) y ajuste de un color hasta alcanzar el mínimo sobre un fondo.
const contrast = (a, b) => { const x = relLuminance(a), y = relLuminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
function ensure(c, bgc, min, fallback) {
  // Se mueve solo la luminosidad (aclara sobre fondos oscuros, oscurece sobre claros) para conservar tono y saturación.
  const up = !isLight(bgc); let [h, s, l] = toHsl(c[0] * 255, c[1] * 255, c[2] * 255);
  for (let i = 0; i <= 50 && l >= 0 && l <= 1; i++, l += up ? .02 : -.02) { const m = hslToRgb(h, s, l); if (contrast(m, bgc) >= min) return m; }
  return fallback;
}
const rgbHex = c => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
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
  // Tema Trío: fondo = color más presente de la portada, acento = el segundo, detalles (título y borde) = el tercero.
  const tri = cfg.bgMode === 'trio' && trio && trio[0];
  document.body.classList.toggle('trio', !!tri);
  if (tri) {
    const bgc = trio[0], lt = isLight(bgc), fgc = lt ? [.09, .1, .11] : [1, 1, 1];
    const ac = trio[1] ? ensure(trio[1], bgc, 2, fgc) : fgc, de = trio[2] ? ensure(trio[2], bgc, 4.5, fgc) : fgc;
    set('--bg', rgbHex(bgc)); set('--fg', lt ? '#16181d' : '#fff');
    set('--btn', relLuminance(bgc) < .04 ? 'rgba(255,255,255,.1)' : lt ? 'rgba(0,0,0,.09)' : 'rgba(0,0,0,.28)');
    set('--line', lt ? 'rgba(0,0,0,.2)' : 'rgba(255,255,255,.22)'); set('--shade', 'none');
    set('--accent', rgbCss(ac)); set('--accent-fg', isLight(ac) ? '#16181d' : '#fff'); set('--det', rgbCss(de));
  }
  set('--radius', (cfg.radius ?? 28) + 'px'); set('--bgo', cfg.bgOpacity ?? 1);
  const blur = cfg.bgMode === 'blur' && coverData;
  $('bgimg').hidden = !blur; if (blur) $('bgimg').style.backgroundImage = `url(${coverData})`;
  // Las flores son parte de los temas Cherry y Sakura: en cualquier otro tema (o personalizado) no se muestran.
  $('bloom').hidden = !(cfg.blossoms && (cfg.preset === 'cherry' || cfg.preset === 'sakura'));
  $('bloom').classList.toggle('s', cfg.preset === 'sakura');
}
// Pétalos: se crean una vez con valores aleatorios (CSSOM, compatible con la CSP) y se animan por CSS.
// El retraso negativo reparte los pétalos a lo largo de la caída desde el primer fotograma. Se pausan con la
// ventana oculta.
(() => {
  const r = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < 24; i++) {
    const p = document.createElement('i'); p.className = (i % 3 ? 'pa' : 'pb') + (i >= 16 ? ' ex' : '');   // los 8 últimos solo se ven en Sakura
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
// El ancho de diseño es 280 en el modo música y 384 en el modo video.
let designW = 280;
const fitScale = () => document.documentElement.style.setProperty('--z', (innerWidth / designW).toFixed(4));
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
// ---------- Paquetes de temas ----------
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
/** Reconstruye la decoración solo cuando cambia el tema de paquete activo (no en cada ajuste). */
function applyPack() {
  pack = packs.find(p => p.id === cfg.preset) || null;
  $('deco').hidden = !pack; if ((pack?.id || null) === builtId) return;
  builtId = pack?.id || null; $('deco').replaceChildren(); prepSound();
  $('player').style.setProperty('--padb', (pack?.pad || 20) + 'px');   // margen inferior propio del tema
  lastH = 0; requestAnimationFrame(() => reportSize());   // vuelve a informar el alto: la ventana debe crecer con el margen
  if (!pack) return;
  if (pack.image) {   // imagen de fondo, con una capa oscura opcional para que el texto siga legible
    const bg = document.createElement('div'); bg.className = 'bgart', dim = pack.imageDim || 0;
    bg.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim})),url(${pack.image})`; $('deco').append(bg);
  }
  for (const d of pack.decor || []) {
    const s = safeSvg(d.svg); if (!s) continue;
    const w = document.createElement('div'); w.className = 'dec ' + d.at; w.append(s); $('deco').append(w);
  }
  if (pack.art) {   // imagen apoyada abajo, por encima de la decoración y por debajo de lo que cae
    const im = document.createElement('img'); im.className = 'art'; im.alt = ''; im.src = pack.art; im.style.width = (pack.artW || 70) + '%'; $('deco').append(im);
  }
  const r = (x, y) => x + Math.random() * (y - x);
  for (let i = 0; i < (pack.fall?.count || 0); i++) {
    const s = safeSvg(pack.fall.svg); if (!s) break;
    const f = document.createElement('div'); f.className = 'fi'; f.append(s);
    f.style.setProperty('--x', r(0, 94).toFixed(1) + '%'); f.style.setProperty('--s', r(12, 20).toFixed(1) + 'px');
    f.style.setProperty('--d', r(9, 16).toFixed(1) + 's'); f.style.setProperty('--dl', (-r(0, 16)).toFixed(1) + 's');
    f.style.setProperty('--sw', r(-30, 30).toFixed(0) + 'px'); $('deco').append(f);
  }
}
// Sonido del tema: una muestra de audio (mp3 en base64) incluida en el paquete. Se decodifica una vez y se
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
bridge.packList?.().then(p => { packs = p; builtId = undefined; applyPack(); });
bridge.onPacks?.(p => { packs = p; builtId = undefined; applyPack(); });
// Punto único de entrada para los ajustes: actualiza el estado y repinta todo lo que depende de ellos.
const applyCfg = s => {
  const noticeOn = cfg.trackNotice === false && s.trackNotice;   // la opción se acaba de activar (no al cargar)
  cfg = s; window.i18n?.setLang(s.lang); setRainbow(s.bgMode === 'rainbow'); applyLook(); applyPack(); paint();
  // Vista previa: un aviso de ejemplo con los colores del tema, para comprobar que funciona.
  const tr = t => window.i18n?.tr(t) ?? t;   // la ventanita del aviso no traduce: se le manda el texto ya traducido
  if (noticeOn) announce({ name: tr('Aviso de canción nueva'), artists: [{ name: tr('Así se verá, abajo a la derecha') }] }, '', true);
};
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
  if (src === 'youtube') return ytToggle();
  if (!player || !dev) return;
  if (await player.getCurrentState()) return player.togglePlay();
  const r = await sp('/me/player', 'PUT', { device_ids: [dev], play: true });
  if (!r.ok) status('No se pudo iniciar la reproducción (' + why(r.status, 'cmd') + ')');
}
// Detener: Spotify no tiene "stop", así que se pausa y se vuelve al principio de la pista.
async function stopPlayback() {
  if (src === 'youtube') { if (ytReady) { yt.pauseVideo(); yt.seekTo(0, true); } return; }
  if (!player || !(await player.getCurrentState())) return;
  await player.pause(); await player.seek(0);
  if (st) { st.position = 0; t0 = performance.now(); }
}
$('play').onclick = togglePlayback;
// Anterior: si la pista ya lleva más de 4 s, se reinicia en vez de volver a la anterior (como en la app de Spotify).
const RESTART_MS = 4000;
function goPrev() {
  // En una lista: pasados 4 s (o en el primer elemento) vuelve al principio; si no, al elemento anterior.
  if (listPlay) return curPos() > RESTART_MS || listPlay.i === 0 ? seekStart() : listStep(-1);
  if (src === 'youtube') return ytPrev();
  if (!player) return;
  const pos = st ? (st.paused ? st.position : st.position + performance.now() - t0) : 0;
  if (pos > RESTART_MS) { player.seek(0); st.position = 0; t0 = performance.now(); } else player.previousTrack();
}
$('prev').onclick = goPrev;
/** Siguiente: en YouTube, el próximo video pegado; en Spotify, la pista siguiente. */
function goNext() { if (listStep(1)) return; if (src === 'youtube') return ytStep(1); player?.nextTrack(); }
$('next').onclick = goNext;
// Barra de progreso: arrastre con captura de puntero; el seek se ejecuta al soltar para no generar saltos de audio.
const ratio = e => { const r = $('track').getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
$('bar').onpointerdown = e => { if (!curDur()) return; dragging = true; $('bar').classList.add('drag'); $('bar').setPointerCapture(e.pointerId); show(ratio(e)); };
$('bar').onpointermove = e => { if (dragging) show(ratio(e)); };
$('bar').onpointerup = e => {
  if (!dragging) return; dragging = false; $('bar').classList.remove('drag');
  const r = ratio(e);
  if (src === 'youtube') return ytReady && yt.seekTo(r * curDur() / 1000, true);
  player.seek(r * st.duration); st.position = r * st.duration; t0 = performance.now();
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
const paintPin = v => $('pin').classList.toggle('on', v);
$('pin').onclick = async () => paintPin(await bridge.togglePin());
$('close').onclick = () => bridge.close();
$('cfg').onclick = () => bridge.openSettings();
bridge.onPinned?.(paintPin);
bridge.onMedia?.(cmd => { if (!player && src !== 'youtube') return; if (cmd === 'toggle') togglePlayback(); else if (cmd === 'stop') stopPlayback(); else if (cmd === 'next') goNext(); else if (cmd === 'prev') goPrev(); });
// Atajo: al pegar (Ctrl+V) un enlace de Spotify o de YouTube se inicia su reproducción.
document.addEventListener('paste', async e => {
  if (e.target.tagName === 'INPUT') return;
  const t = e.clipboardData.getData('text') || '', y = t.match(YTID);
  if (y) return playYt(y[1]);
  const m = dev && t.match(LINK); if (!m) return;
  await playUri(`spotify:${m[1]}:${m[2]}`);
});

// ---------- Me gusta (guardar en la biblioteca) ----------
// Usa los endpoints de biblioteca vigentes (/me/library). Actualización optimista con reversión ante error.
let curUri = '', liked = false, busy = false, likeTouched = 0;
/** Refleja el estado de Me gusta en el botón (ícono y descripción). */
function paintLike(on) {
  liked = on; $('like').classList.toggle('on', on); $('like').firstElementChild.innerHTML = on ? ICON.check : ICON.plus;
  $('like').title = on ? 'Guardada en Me gusta · elegir dónde guardar' : 'Guardar en… (tecla L: Me gusta)';
}
/** Consulta a Spotify si la pista actual está guardada; oculta el botón si no es una canción (p. ej. un episodio). */
async function syncLike(uri) {
  const ok = uri?.startsWith('spotify:track:'); $('like').hidden = !ok; if (!ok) return;
  paintLike(false);
  try { const r = await sp('/me/library/contains?uris=' + encodeURIComponent(uri)); if (r.ok && uri === curUri) paintLike((await r.json())[0] === true); } catch {}
}
/** Guarda o quita la pista actual de Me gusta (tecla L y fila "Canciones que te gustan" de la mini ventana). */
async function toggleLike() {
  if (busy || !curUri.startsWith('spotify:track:')) return; busy = true; likeTouched = Date.now(); const want = !liked; paintLike(want);
  const r = await sp('/me/library?uris=' + encodeURIComponent(curUri), want ? 'PUT' : 'DELETE');
  if (!r.ok) { paintLike(!want); status('No se pudo guardar (' + why(r.status) + ')'); }
  delete cache.liked; busy = false; if (!$('pick').hidden) paintPickLike();   // la lista de Me gusta guardada quedó vieja
}
$('like').onclick = () => togglePick();

/** Consulta si la pista actual está en Me gusta (cambios hechos desde otro dispositivo). Se omite tras una acción local reciente. */
async function checkLike() {
  const uri = curUri;
  if (!uri.startsWith('spotify:track:') || busy || Date.now() - likeTouched < 4000) return;
  try {
    const r = await sp('/me/library/contains?uris=' + encodeURIComponent(uri));
    if (!r.ok || uri !== curUri || busy) return;
    const v = (await r.json())[0] === true; if (v !== liked) paintLike(v);
  } catch {}
}

// ---------- Aleatorio ----------
// El estado real proviene del SDK (state.shuffle); el botón solo solicita el cambio a la Web API.
let shuffled = false;
function paintShuffle(on) { shuffled = on; $('shuf').classList.toggle('on', on); $('shuf').title = on ? 'Aleatorio: activado' : 'Aleatorio: desactivado'; }
$('shuf').onclick = async () => {
  if (!dev) return; const want = !shuffled; paintShuffle(want);
  const r = await sp(`/me/player/shuffle?state=${want}&device_id=${dev}`, 'PUT');
  if (!r.ok) { paintShuffle(!want); status('No se pudo cambiar el aleatorio (' + why(r.status, 'cmd') + ')'); }
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
  if (!r.ok) { paintRepeat(prev); status('No se pudo cambiar el modo de repetición (' + why(r.status, 'cmd') + ')'); }
};

// ---------- Volumen ----------
const savedVol = () => { const v = parseFloat(localStorage.getItem('vol')); return Number.isFinite(v) ? v : .6; };
$('vol').value = savedVol() * 100;
let volTouched = 0;
// Último volumen mayor que cero (0..1): es el que se recupera al quitar el silencio. Se guarda para el próximo inicio.
let lastVol = .5;
try { const v = parseFloat(localStorage.getItem('volLast')); if (v > 0) lastVol = v; } catch {}
const keepVol = v => { if (v > 0) { lastVol = v; try { localStorage.setItem('volLast', v); } catch {} } };
// Ícono del botón de silencio: parlante tachado cuando el volumen es 0.
function paintVol(p) {
  $('mute').firstElementChild.innerHTML = p === 0 ? ICON.mute : ICON.vol;
  $('mute').title = $('mute').ariaLabel = p === 0 ? 'Activar sonido' : 'Silenciar';
}
paintVol(+$('vol').value);
/** Aplica un volumen 0..100 (control superior, rueda del ratón o modo VOL de la rueda). */
function applyVolume(p) {
  p = Math.min(100, Math.max(0, Math.round(p))); $('vol').value = p; volTouched = Date.now(); volLabel(); paintVol(p);
  player?.setVolume(p / 100); if (ytReady) yt.setVolume(p); try { localStorage.setItem('vol', p / 100); } catch {}
}
$('vol').oninput = () => applyVolume(+$('vol').value);
// Al soltar el deslizador se recuerda el volumen elegido (un 0 no cuenta: así se puede volver al valor anterior).
$('vol').onchange = () => keepVol(+$('vol').value / 100);
// Silencio: con volumen > 0 lo recuerda y silencia; con volumen 0 recupera el recordado.
function toggleMute() {
  const v = +$('vol').value;
  if (v > 0) { keepVol(v / 100); applyVolume(0); } else applyVolume(lastVol * 100);
}
$('mute').onclick = toggleMute;
/** Consulta el volumen del dispositivo (cambios remotos por Spotify Connect), solo si este reproductor es el activo. */
async function checkVolume() {
  if (!dev || Date.now() - volTouched < 3000) return;   // período de gracia tras una interacción local
  try {
    const r = await sp('/me/player'); if (r.status !== 200) return;
    const d = (await r.json()).device;
    if (d?.id !== dev || d.volume_percent == null || Math.abs(d.volume_percent - $('vol').value) < 2) return;
    $('vol').value = d.volume_percent; volLabel(); paintVol(d.volume_percent); keepVol(d.volume_percent / 100); try { localStorage.setItem('vol', d.volume_percent / 100); } catch {}
  } catch {}
}

// ---------- Sincronización con otros dispositivos ----------
// Sin consultas permanentes (cuidan el cupo de la API en modo desarrollo): el corazón de Me gusta y el volumen se
// consultan una sola vez al mirar la ventana (foco, volver a mostrarla o pasar el mouse), con 30 s como mínimo
// entre consultas. Con la biblioteca abierta, la pestaña actual se refresca cada minuto (ver más abajo).
let lastSync = 0;
function syncRemote() {
  // Mientras suena YouTube no se consulta a Spotify (cuida el límite de uso de la API).
  if (src === 'youtube' || document.hidden || $('player').hidden || Date.now() - lastSync < 30000) return;
  lastSync = Date.now(); checkLike(); checkVolume();
}
window.addEventListener('focus', syncRemote);
document.addEventListener('visibilitychange', syncRemote);
document.documentElement.addEventListener('pointerenter', syncRemote);

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
$('wPrev').onclick = () => volMode ? nudge(-5) : goPrev();
$('wNext').onclick = () => volMode ? nudge(5) : goNext();
$('wheel').addEventListener('wheel', e => { e.preventDefault(); nudge(e.deltaY < 0 ? 5 : -5); }, { passive: false });

// ---------- Atajos de teclado ----------
// Valen con la ventana del reproductor activa. Se ignoran al escribir en un campo de texto (búsqueda o Client ID);
// sobre el deslizador de volumen, las flechas las maneja el propio control. Con la biblioteca o la lista de
// dispositivos abiertas, ↑ ↓ quedan para recorrer la lista.
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || $('player').hidden) return;
  const el = e.target, isInput = el.tagName === 'INPUT', onRange = isInput && el.type === 'range';
  if (isInput && !onRange) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, listOpen = !$('library').hidden || !$('devs').hidden || !$('pick').hidden;
  let used = true;
  if (k === ' ') { if (!e.repeat) togglePlayback(); }
  else if (k === 'ArrowLeft' && !onRange) goPrev();
  else if (k === 'ArrowRight' && !onRange) goNext();
  else if ((k === 'ArrowUp' || k === 'ArrowDown') && !onRange && !listOpen) nudge(k === 'ArrowUp' ? 5 : -5);
  else if (k === 'm') { if (!e.repeat) toggleMute(); }
  else if (k === 'l') { if (!e.repeat && $('like').offsetParent) toggleLike(); }   // sin efecto si el botón está oculto
  else used = false;
  if (used) e.preventDefault();
});
// Un botón con el foco se activa al soltar la barra espaciadora: se bloquea para que la acción no se repita.
document.addEventListener('keyup', e => { if (e.key === ' ' && e.target.tagName === 'BUTTON') e.preventDefault(); });

// ---------- Biblioteca y buscador ----------
/** Reproduce un contexto (playlist, álbum, artista o pista) en este dispositivo. Devuelve true si Spotify aceptó la orden. */
async function playUri(uri, ctx) {
  if (!dev) { status('El reproductor aún no está listo'); return false; }
  listPlay = null; useSpotify();
  let body = { context_uri: uri };
  if (uri.startsWith('spotify:track:')) {   // Una pista suelta se inicia dentro de su álbum para heredar la continuidad (autoplay) del contexto.
    if (!ctx) { try { const t = await sp('/tracks/' + uri.split(':')[2]); if (t.ok) ctx = (await t.json()).album?.uri; } catch {} }
    body = ctx ? { context_uri: ctx, offset: { uri } } : { uris: [uri] };
  }
  const r = await sp('/me/player/play?device_id=' + dev, 'PUT', body);
  status(r.ok ? '' : 'No se pudo reproducir (' + why(r.status, 'cmd') + ')'); return r.ok;
}
/** Reproduce una lista de pistas empezando por `uri`, para que la reproducción continúe con las siguientes. */
async function playTracks(list, uri, keepList = false) {
  if (!dev) { status('El reproductor aún no está listo'); return false; }
  if (!keepList) listPlay = null;
  useSpotify();
  const r = await sp('/me/player/play?device_id=' + dev, 'PUT', { uris: list.slice(0, 100), offset: { uri } });
  status(r.ok ? '' : 'No se pudo reproducir (' + why(r.status, 'cmd') + ')'); return r.ok;
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
  // Botón "+": abre «Agregar a…» (tus listas, una lista nueva o la cola de Spotify) sin interrumpir lo que suena.
  const isYt = o.uri.startsWith('youtube:');
  if (o.uri.startsWith('spotify:track:') || isYt) {
    const q = document.createElement('button'); q.className = 'btn mini qb'; q.title = 'Agregar a…';
    q.innerHTML = '<svg viewBox="0 0 24 24">' + ICON.plus + '</svg>';
    const item = cleanItem({ k: isYt ? 'youtube' : 'spotify', id: o.uri.split(':').pop(), title: o.name, sub: o.sub, img: o.img });
    q.onclick = e => { e.stopPropagation(); togglePick(true, item, q); };
    li.append(q);
  }
  const go = o.open || (async () => { if (await (o.list ? playTracks(o.list, o.uri) : playUri(o.uri, o.ctx))) toggleLib(false); });
  li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter' && e.target === li) go(); };
  return li;
}
/** Agrega una pista a la cola del reproductor y muestra una confirmación breve en el botón. */
async function addToQueue(uri, btn) {
  if (!dev) return status('El reproductor aún no está listo');
  const r = await sp('/me/player/queue?uri=' + encodeURIComponent(uri) + '&device_id=' + dev, 'POST');
  if (!r.ok) return status(r.status === 404 ? 'Primero reproducí algo en este reproductor' : 'No se pudo agregar a la cola (' + why(r.status, 'cmd') + ')');
  btn.firstElementChild.innerHTML = ICON.check; status('Agregada a la cola');
  setTimeout(() => { btn.firstElementChild.innerHTML = ICON.plus; status(''); }, 1500);
}
// Reemplaza el contenido de la lista y vuelve al principio.
// En las actualizaciones automáticas ("quiet") no se muestra "Cargando…" ni se mueve el scroll de la lista, y un
// error pasajero no borra lo que ya se estaba viendo.
let quiet = false;
const fill = parts => {
  const l = $('list'); if (quiet && parts.length === 1) return;   // aviso suelto (cargando, error): se conserva la lista actual
  const y = l.scrollTop; l.replaceChildren(...parts); l.scrollTop = quiet ? y : 0;
};
// Caché de pestañas: al volver a una ya cargada se muestra al instante, sin consultar de nuevo (cuida el cupo de la
// API). Si una consulta falla (p. ej. por el límite de Spotify), se muestra lo último cargado en lugar de un error.
const cache = {}, ttl = key => key.startsWith('history') ? 60000 : 180000;
/** Muestra una lista cargada con éxito y la guarda para la próxima vez. */
const keep = (key, parts) => { cache[key] = { t: Date.now(), parts }; fill(parts); };
/** Muestra el fallo de una carga: lo último guardado con un aviso, o el error si no hay nada guardado. */
const failed = (key, label, code) => {
  if (quiet) return;   // las actualizaciones automáticas no pisan lo que ya se ve
  const c = cache[key];
  fill(c ? [note('Mostrando lo último cargado (' + why(code) + ')'), ...c.parts] : [note('No se pudo cargar ' + label + ' (' + why(code) + ')')]);
};
// Subtítulo de una playlist: autor.
const owner = p => 'Playlist · ' + (p.owner?.display_name || '');

/** Lista las playlists del usuario (hasta 150, en 3 páginas). */
async function loadPlaylists() {
  fill([note('Cargando…')]);
  let url = '/me/playlists?limit=50', out = [];
  for (let i = 0; i < 3 && url; i++) {
    const r = await sp(url); if (!r.ok) return tab === 'search' && !$('q').value.trim() ? failed('playlists', 'tus playlists', r.status) : undefined;
    if (tab !== 'search') return;
    const d = await r.json(); out.push(...d.items.filter(Boolean));
    url = d.next ? d.next.replace('https://api.spotify.com/v1', '') : null;
  }
  if ($('q').value.trim()) return;
  keep('playlists', [sec('Tus playlists'), ...out.map(p => row({ name: p.name, sub: owner(p), uri: p.uri, img: img(p.images) }))]);
}
// El modo desarrollo limita la búsqueda a 10 resultados por consulta; se piden 10 por tipo (el máximo).
// Dónde busca el buscador: 'spotify', 'youtube' o 'both' (se recuerda en esta PC).
let searchSrc = 'both';
try { const v = localStorage.getItem('searchSrc'); if (['spotify', 'youtube', 'both'].includes(v)) searchSrc = v; } catch {}
const YT_SEARCH_ERR = { nokey: 'Para buscar en YouTube, agregá tu clave en Ajustes › Sistema › YouTube',
  quota: 'Se terminó el cupo diario de búsquedas de YouTube (se renueva cada día)', net: 'Sin conexión: no se pudo buscar en YouTube' };
/**
 * Busca en Spotify (canciones, álbumes, artistas y playlists) y/o en YouTube (videos). Spotify busca mientras se
 * escribe; YouTube solo con Enter (`withYt`), porque cada búsqueda gasta una parte grande del cupo diario.
 */
async function search(q, withYt = false) {
  const useSp = searchSrc !== 'youtube', useYt = withYt && searchSrc !== 'spotify';
  if (useYt) fill([note('Buscando en YouTube…')]);
  const [r, y] = await Promise.all([useSp ? sp('/search?' + new URLSearchParams({ q, type: 'track,album,playlist,artist', limit: 10 })) : null, useYt ? bridge.ytSearch(q) : null]);
  if (tab !== 'search' || q !== $('q').value.trim()) return;   // descarta respuestas obsoletas (el usuario siguió escribiendo)
  const parts = [];
  if (y) {   // los videos van primero: es lo que se pidió con Enter
    if (y.error) parts.push(note(YT_SEARCH_ERR[y.error] || 'No se pudo buscar en YouTube (' + (y.status || y.error) + ')'));
    else if (y.items.length) parts.push(sec('Videos de YouTube'), ...y.items.map(v => row({ name: v.title, sub: v.channel, uri: 'youtube:' + v.id,
      img: 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg', open: () => { toggleLib(false); playYt(v.id); } })));
    else parts.push(note('YouTube: sin resultados'));
  } else if (searchSrc !== 'spotify') parts.push(note('Apretá Enter para buscar en YouTube'));
  if (r) {
    if (!r.ok) parts.push(note('Error al buscar en Spotify (' + why(r.status) + ')'));
    else {
      const d = await r.json(), sp0 = parts.length;
      const add = (title, o, map) => { const xs = (o?.items || []).filter(Boolean); if (xs.length) parts.push(sec(title), ...xs.map(x => row(map(x)))); };
      add('Canciones', d.tracks, t => ({ name: t.name, sub: t.artists.map(a => a.name).join(', '), uri: t.uri, ctx: t.album?.uri, img: img(t.album?.images) }));
      add('Álbumes', d.albums, a => ({ name: a.name, sub: a.artists.map(x => x.name).join(', '), uri: a.uri, img: img(a.images) }));
      add('Artistas', d.artists, a => ({ name: a.name, sub: 'Artista', uri: a.uri, img: img(a.images) }));
      add('Playlists', d.playlists, p => ({ name: p.name, sub: owner(p), uri: p.uri, img: img(p.images) }));
      if (parts.length === sp0) parts.push(note('Spotify: sin resultados'));
    }
  }
  fill(parts.length ? parts : [note('Sin resultados')]);
}
/** Buscador vacío: tus playlists de Spotify, o una indicación si solo se busca en YouTube (sin gastar consultas). */
const emptySearch = () => searchSrc === 'youtube' ? fill([note('Escribí y apretá Enter para buscar en YouTube')]) : loadPlaylists();
const SRC_HINT = { spotify: 'Buscar en Spotify o pegar un link', youtube: 'Buscar en YouTube (Enter) o pegar un link', both: 'Buscar o pegar un link' };
/** Cambia dónde busca el buscador y repite la búsqueda actual (solo la parte de Spotify; YouTube espera a Enter). */
const paintSrc = () => { for (const b of document.querySelectorAll('#srcs button')) b.classList.toggle('on', b.dataset.s === searchSrc); $('q').placeholder = SRC_HINT[searchSrc]; };
function setSearchSrc(v) {
  searchSrc = v; try { localStorage.setItem('searchSrc', v); } catch {}
  paintSrc();
  if (tab === 'search' && !$('library').hidden) { const q = $('q').value.trim(); q ? search(q) : emptySearch(); }
}
for (const b of document.querySelectorAll('#srcs button')) b.onclick = () => { setSearchSrc(b.dataset.s); $('q').focus(); };
paintSrc();
/** Fila genérica con textContent (sin reproducir): usada por la mini ventana y la vista de artista. */
function listRow({ name, sub, img: src, on, onclick }) {
  const li = document.createElement('li'); li.className = 'it' + (on ? ' cur' : ''); li.tabIndex = 0; li.setAttribute('role', 'button');
  if (src !== undefined) {
    const th = document.createElement('div'); th.className = 'th';
    if (src?.startsWith('https://')) th.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
    li.append(th);
  }
  const tx = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span'); tx.className = 'tx';
  b.textContent = name; s.textContent = sub || ''; tx.append(b, s); li.append(tx);
  li.onclick = onclick; li.onkeydown = e => { if (e.key === 'Enter') onclick(); };
  return li;
}

// ---------- Mini ventana "Guardar en…" ----------
// El botón + abre una lista con Me gusta y las playlists que el usuario puede editar (propias o colaborativas).
let meId = null, plCache = null, plAt = 0;
/** Id del usuario actual (para distinguir sus playlists de las que solo sigue). */
async function myId() { if (!meId) { const r = await sp('/me'); if (r.ok) meId = (await r.json()).id; } return meId; }
/** Playlists editables del usuario (hasta 150), con caché de un minuto. */
async function editablePlaylists() {
  if (plCache && Date.now() - plAt < 60000) return plCache;
  const id = await myId(); let url = '/me/playlists?limit=50', out = [];
  for (let i = 0; i < 3 && url; i++) {
    const r = await sp(url); if (!r.ok) throw r.status;
    const d = await r.json(); out.push(...(d.items || []).filter(Boolean));
    url = d.next ? d.next.replace('https://api.spotify.com/v1', '') : null;
  }
  plCache = out.filter(p => p.collaborative || (id && p.owner?.id === id)); plAt = Date.now();
  return plCache;
}
/** Fila "Canciones que te gustan": guarda o quita la pista actual sin cerrar la mini ventana. */
function paintPickLike() {
  const first = $('picklist').firstElementChild; if (!first?.dataset.like) return;
  first.querySelector('span').textContent = liked ? 'Guardada ✓ · tocá para quitarla' : 'Tocá para guardarla';
  first.classList.toggle('cur', liked);
}
/** Agrega la pista actual a una playlist y confirma en la fila. */
async function addToPlaylist(p, li) {
  const uri = curUri; if (!uri) return;
  li.querySelector('span').textContent = 'Agregando…';
  const r = await sp('/playlists/' + encodeURIComponent(p.id) + '/items', 'POST', { uris: [uri] });
  if (!r.ok) {
    li.querySelector('span').textContent = r.status === 403 ? 'Sin permiso para editarla (403)' : 'No se pudo agregar (' + why(r.status) + ')';
    return status('No se pudo agregar a «' + p.name + '»');
  }
  li.classList.add('cur'); li.querySelector('span').textContent = 'Agregada ✓';
  status('Agregada a «' + p.name + '»'); setTimeout(() => { status(''); togglePick(false); }, 900);
}
/** Muestra u oculta la mini ventana. Se cierra sola si cambia la pista. */
/**
 * Menú «Agregar a…». Sin `item` es lo que suena (botón + del título): Me gusta, tus listas y tus playlists de Spotify.
 * Con `item` es una fila de resultados: tus listas, una lista nueva y la cola de Spotify (solo canciones).
 */
async function togglePick(open = $('pick').hidden, item = null, qbtn = null) {
  const cur = !item; item ??= curItem();
  if (open && !item) open = false;
  $('pick').hidden = !open; $('like').classList.toggle('on', open || liked);
  if (!open) return;
  if (!$('devs').hidden) toggleDevices(false);
  // El menú queda encima de la portada: un video que suena se pausa (el reproductor de YouTube nunca se tapa sonando).
  if (src === 'youtube' && ytReady && yt.getPlayerState() === 1 && $('library').hidden) yt.pauseVideo();
  const own = addListRows(item);
  if (!cur || item.k !== 'spotify') {
    const extra = !cur && item.k === 'spotify' ? [sec('Spotify'), listRow({ name: 'Cola de Spotify', sub: 'Suena después de lo actual', onclick: () => { addToQueue(itemUri(item), qbtn); togglePick(false); } })] : [];
    return $('picklist').replaceChildren(...own, ...extra);
  }
  const uri = curUri;
  const likeRow = listRow({ name: 'Canciones que te gustan', sub: '', onclick: toggleLike }); likeRow.dataset.like = '1';
  $('picklist').replaceChildren(likeRow, ...own, sec('Playlists de Spotify'), note('Cargando tus playlists…')); paintPickLike(); likeRow.focus();
  let rows;
  try {
    const pls = await editablePlaylists(); if ($('pick').hidden || uri !== curUri) return;
    rows = pls.length ? pls.map(p => { const li = listRow({ name: p.name, sub: p.collaborative ? 'Colaborativa' : 'Tuya', img: img(p.images), onclick: () => addToPlaylist(p, li) }); return li; }) : [note('No tenés playlists propias')];
  } catch (s) {
    if ($('pick').hidden || uri !== curUri) return;
    rows = [note('No se pudieron cargar tus playlists (' + why(s) + ')')];
  }
  $('picklist').replaceChildren(likeRow, ...addListRows(item), sec('Playlists de Spotify'), ...rows);
}
$('pickx').onclick = () => togglePick(false);

// ---------- Colección: álbumes guardados, artistas seguidos y artistas más escuchados ----------
let collSeq = 0;   // descarta respuestas de una vista anterior (otra pestaña o un artista distinto)
const albumRow = a => row({ name: a.name, sub: (a.album_type === 'single' ? 'Sencillo' : 'Álbum') + ' · ' + (a.artists || []).map(x => x.name).join(', ') + (a.release_date ? ' · ' + a.release_date.slice(0, 4) : ''), uri: a.uri, img: img(a.images) });
const artistRow = a => row({ name: a.name, sub: 'Artista', uri: a.uri, img: img(a.images), open: () => openArtist(a) });
// Pide un recurso y devuelve su JSON, o el código de error numérico si falló.
const getJson = async p => { try { const r = await sp(p); return r.ok ? await r.json() : r.status; } catch { return 0; } };
/** Carga las tres secciones de la Colección en paralelo; cada una falla por separado. */
async function loadColl() {
  const my = ++collSeq; fill([note('Cargando…')]);
  const [al, fo, to] = await Promise.all([getJson('/me/albums?limit=50'), getJson('/me/following?type=artist&limit=50'), getJson('/me/top/artists?limit=20&time_range=medium_term')]);
  if (tab !== 'coll' || my !== collSeq) return;
  const parts = [], section = (title, d, items, map, empty) => {
    parts.push(sec(title));
    if (typeof d === 'number') return parts.push(note('No se pudo cargar (' + why(d) + ')'));
    const xs = items(d).filter(Boolean); parts.push(...(xs.length ? xs.map(map) : [note(empty)]));
  };
  section('Álbumes guardados', al, d => (d.items || []).map(x => x.album), albumRow, 'Todavía no guardaste álbumes');
  section('Artistas que seguís', fo, d => d.artists?.items || [], artistRow, 'Todavía no seguís artistas');
  section('Tus artistas más escuchados', to, d => d.items || [], artistRow, 'Todavía no hay datos suficientes');
  // Si una sección falló: con una copia guardada se muestra esa (con aviso); si no, lo que sí cargó. Nunca se guarda
  // una carga incompleta, así la próxima vez se vuelve a intentar.
  const code = [al, fo, to].find(d => typeof d === 'number');
  if (code !== undefined) return cache.coll ? failed('coll', 'tu colección', code) : fill(parts);
  keep('coll', parts);
}
/** Vista de un artista: reproducirlo y ver sus álbumes y sencillos (sin duplicados). */
async function openArtist(a) {
  const my = ++collSeq, back = listRow({ name: '← Volver', sub: 'Colección', onclick: () => setTab('coll') });
  fill([back, note('Cargando álbumes…')]);
  const d = await getJson('/artists/' + encodeURIComponent(a.id) + '/albums?include_groups=album,single&limit=50');
  if (tab !== 'coll' || my !== collSeq) return;
  const seen = new Set(), albums = (typeof d === 'number' ? [] : d.items || []).filter(x => x && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()));
  fill([back, row({ name: 'Reproducir a ' + a.name, sub: 'Artista', uri: a.uri, img: img(a.images) }), sec('Álbumes y sencillos'),
    ...(typeof d === 'number' ? [note('No se pudieron cargar los álbumes (' + why(d) + ')')] : albums.length ? albums.map(albumRow) : [note('Sin álbumes')])]);
}
// Pestañas de la vista de biblioteca: Buscar · Me gusta · Top · Colección · Cola · Reciente. Cada carga descarta su resultado
// si el usuario cambió de pestaña mientras esperaba.
let tab = 'search';
const trackRow = (t, list) => row({ name: t.name, sub: t.artists.map(a => a.name).join(', '), uri: t.uri, ctx: t.album?.uri, img: img(t.album?.images), list });
/** Canciones guardadas (hasta 100, en 2 páginas). */
async function loadLiked() {
  fill([note('Cargando…')]);
  let url = '/me/tracks?limit=50', out = [];
  for (let i = 0; i < 2 && url; i++) {
    const r = await sp(url); if (tab !== 'liked') return;
    if (!r.ok) return failed('liked', 'tus Me gusta', r.status);
    const d = await r.json(); out.push(...d.items.map(x => x.track).filter(t => t?.uri));
    url = d.next ? d.next.replace('https://api.spotify.com/v1', '') : null;
  }
  const uris = out.map(t => t.uri);
  keep('liked', out.length ? [sec('Canciones que te gustan'), ...out.map(t => trackRow(t, uris))] : [note('Todavía no guardaste canciones')]);
}
// Período del Top: short_term (4 semanas), medium_term (6 meses) o long_term (un año).
let topRange = 'medium_term';
/** Canciones más escuchadas del usuario en el período elegido (hasta 30). */
async function loadTop() {
  fill([note('Cargando…')]);
  const key = 'top:' + topRange;   // cada período tiene su propia copia guardada
  const r = await sp('/me/top/tracks?limit=30&time_range=' + topRange); if (tab !== 'top' || key !== 'top:' + topRange) return;
  if (!r.ok) return failed(key, 'tus más escuchados', r.status);
  const items = ((await r.json()).items || []).filter(t => t?.uri), uris = items.map(t => t.uri);
  keep(key, items.length ? [sec('Tus más escuchados'), ...items.map(t => trackRow(t, uris))] : [note('Todavía no hay datos suficientes')]);
}
for (const b of document.querySelectorAll('#ranges button')) b.onclick = () => {
  topRange = b.dataset.r; for (const x of document.querySelectorAll('#ranges button')) x.classList.toggle('on', x === b); setTab('top');
};
/** Cola de reproducción: pista actual y las siguientes (solo lectura). */
async function loadQueue() {
  fill([note('Cargando…')]);
  const r = await sp('/me/player/queue'); if (tab !== 'queue') return;
  if (!r.ok) return failed('queue', 'la cola', r.status);
  const d = await r.json(), cur = d.currently_playing, parts = [];
  const map = t => ({ name: t.name, sub: (t.artists || []).map(x => x.name).join(', '), img: img(t.album?.images), plain: true });
  if (cur) parts.push(sec('Sonando ahora'), row(map(cur)));
  const next = (d.queue || []).filter(t => t?.name);
  parts.push(sec('A continuación'), ...(next.length ? next.map(t => row(map(t))) : [note('La cola está vacía')]));
  keep('queue', parts);
}
// Videos vistos (solo en esta PC): id, título, canal y fecha. Hasta 50, el más reciente primero.
const ytHistory = () => {
  try {
    const a = JSON.parse(localStorage.getItem('ytHistory') || '[]');
    return Array.isArray(a) ? a.filter(v => /^[\w-]{11}$/.test(v?.id) && typeof v.title === 'string' && Number.isFinite(v.at)).slice(0, 50) : [];
  } catch { return []; }
};
function addYtHistory(id, title, channel) {
  const a = ytHistory().filter(v => v.id !== id);   // si ya estaba, sube al principio
  a.unshift({ id, title: String(title).slice(0, 200), channel: String(channel || '').slice(0, 100), at: Date.now() });
  try { localStorage.setItem('ytHistory', JSON.stringify(a.slice(0, 50))); } catch {}
  delete cache['history:youtube']; delete cache['history:both'];
}
const ytRow = v => row({ name: v.title, sub: v.channel, uri: 'youtube:' + v.id, img: 'https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg', open: () => { toggleLib(false); playYt(v.id); } });
// Qué muestra Recientes: 'spotify' (canciones), 'youtube' (videos) o 'both' (mezcla). Se recuerda en esta PC.
let histSrc = 'both';
try { const v = localStorage.getItem('histSrc'); if (['spotify', 'youtube', 'both'].includes(v)) histSrc = v; } catch {}
const paintHist = () => { for (const b of document.querySelectorAll('#hsrc button')) b.classList.toggle('on', b.dataset.h === histSrc); };
paintHist();
for (const b of document.querySelectorAll('#hsrc button')) b.onclick = () => {
  histSrc = b.dataset.h; try { localStorage.setItem('histSrc', histSrc); } catch {}
  paintHist(); setTab('history');
};
/** Recientes: canciones de Spotify (últimas 30, sin repeticiones seguidas), videos vistos o ambas mezcladas por fecha. */
async function loadHistory() {
  const key = 'history:' + histSrc, vids = histSrc !== 'spotify' ? ytHistory() : [];
  if (histSrc === 'youtube') return keep(key, vids.length ? [sec('Videos recientes'), ...vids.map(ytRow)] : [note('Todavía no viste videos')]);   // sin consultar a Spotify
  fill([note('Cargando…')]);
  const r = await sp('/me/player/recently-played?limit=30'); if (tab !== 'history' || key !== 'history:' + histSrc) return;
  if (!r.ok) return failed(key, 'el historial', r.status);
  const items = (await r.json()).items || [], seen = [];
  for (const it of items) { const t = it.track; if (t && seen[seen.length - 1]?.t.uri !== t.uri) seen.push({ t, at: Date.parse(it.played_at) || 0 }); }   // quita repeticiones consecutivas
  const songRow = ({ t }) => row({ name: t.name, sub: t.artists.map(a => a.name).join(', '), uri: t.uri, ctx: t.album?.uri, img: img(t.album?.images) });
  if (histSrc === 'spotify') return keep(key, seen.length ? [sec('Canciones recientes'), ...seen.map(songRow)] : [note('Todavía no hay historial')]);
  const mix = [...seen.map(s => ({ at: s.at, el: () => songRow(s) })), ...vids.map(v => ({ at: v.at, el: () => ytRow(v) }))].sort((a, b) => b.at - a.at).slice(0, 40);
  keep(key, mix.length ? [sec('Escuchado y visto recientemente'), ...mix.map(m => m.el())] : [note('Todavía no hay historial')]);
}
/** Cambia de pestaña en la biblioteca y carga su contenido. */
function setTab(t) {
  quiet = false; tab = t; for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.t === t);
  $('q').hidden = $('srcs').hidden = t !== 'search'; $('ranges').hidden = t !== 'top'; $('hsrc').hidden = t !== 'history';
  if (t === 'search') $('q').focus();
  // La cola cambia con cada pista: siempre se pide. Las demás se reutilizan mientras la copia guardada sea reciente.
  const key = t === 'liked' ? 'liked' : t === 'top' ? 'top:' + topRange : t === 'coll' ? 'coll' : t === 'history' ? 'history:' + histSrc : t === 'search' && !$('q').value.trim() && searchSrc !== 'youtube' ? 'playlists' : null;
  const c = key && cache[key]; if (c && Date.now() - c.t < ttl(key)) return fill(c.parts);
  if (t === 'search') $('q').value.trim() ? search($('q').value.trim()) : emptySearch();
  else if (t === 'lists') loadLists();
  else if (t === 'liked') loadLiked(); else if (t === 'top') loadTop(); else if (t === 'coll') loadColl(); else if (t === 'queue') loadQueue(); else loadHistory();
}
for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => setTab(b.dataset.t);
let timer;
$('q').oninput = () => { clearTimeout(timer); const q = $('q').value.trim(); timer = setTimeout(() => q ? search(q) : emptySearch(), 350); };
$('q').onkeydown = async e => {
  if (e.key !== 'Enter') return;
  const y = $('q').value.match(YTID);
  if (y) { toggleLib(false); return playYt(y[1]); }
  const m = $('q').value.match(LINK);
  if (m) { if (await playUri(`spotify:${m[1]}:${m[2]}`)) toggleLib(false); return; }
  const q = $('q').value.trim();
  if (q && searchSrc !== 'spotify') { clearTimeout(timer); search(q, true); }   // Enter: también busca en YouTube
};
/** Muestra u oculta la vista de biblioteca (reemplaza a la vista del reproductor mientras está abierta). */
function toggleLib(open = $('library').hidden) {
  // La biblioteca ocupa el lugar del reproductor: un video de YouTube se pausa (nunca se oculta mientras suena).
  if (open && src === 'youtube' && ytReady && yt.getPlayerState() === 1) { yt.pauseVideo(); status('Video en pausa mientras buscás'); }
  $('library').hidden = !open; $('now').hidden = open; $('player').classList.toggle('lib', open); $('libbtn').classList.toggle('on', open);
  if (open) { $('q').value = ''; setTab('search'); } else syncRemote();   // al volver al reproductor se refresca el estado
}
$('libbtn').onclick = () => toggleLib();
// Con la biblioteca abierta, las pestañas que cambian con el uso se refrescan cada minuto (sin parpadeo ni saltos).
const REFRESH = { liked: loadLiked, queue: loadQueue, history: loadHistory };
setInterval(async () => {
  if ($('library').hidden || document.hidden || !REFRESH[tab]) return;
  quiet = true; try { await REFRESH[tab](); } finally { quiet = false; }
}, 60000);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('pick').hidden) togglePick(false); else if (!$('devs').hidden) toggleDevices(false); else if (!$('library').hidden) toggleLib(false);
});

// ---------- YouTube ----------
// Un enlace de YouTube pegado (Ctrl+V o en el buscador) se reproduce con el reproductor oficial embebido, que ocupa el
// recuadro de la portada. Reglas: nunca se tapa, oculta ni modifica el reproductor, no se intenta evitar anuncios y,
// mientras suena YouTube, no se consulta la API de Spotify de forma periódica. Los videos pegados forman una lista
// local para Anterior/Siguiente (sin API de YouTube ni inicio de sesión obligatorio).
const YT_ERR = { 2: 'el enlace no es válido', 5: 'falló el reproductor', 100: 'el video no existe o es privado',
  101: 'el dueño no permite verlo fuera de YouTube', 150: 'el dueño no permite verlo fuera de YouTube', 153: 'YouTube rechazó el origen' };
/** Carga la API oficial del reproductor una sola vez. */
const loadYtApi = () => ytApi ??= new Promise((ok, no) => {
  window.onYouTubeIframeAPIReady = ok;
  const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api';
  s.onerror = () => { ytApi = null; s.remove(); no(new Error('sin conexión')); };
  document.head.append(s);
});
/** Ancho de diseño y escala mínima: con YouTube el reproductor debe verse de al menos 200 px de alto. */
const reportWidth = () => {
  const v = $('player').classList.contains('video');
  bridge.setLayoutWidth?.(v ? 384 : 280, src === 'youtube' ? (v ? 1 : .84) : 0);
};
/** Pasa a YouTube: pausa Spotify (por el SDK, sin la Web API) y muestra el reproductor en la portada. */
function useYoutube() {
  if (src !== 'youtube') { src = 'youtube'; if (st && !st.paused) player?.pause()?.catch?.(() => {}); }
  document.body.classList.add('yt'); $('ytbox').hidden = false;
  if (!$('devs').hidden) toggleDevices(false);
  if (!$('pick').hidden) togglePick(false);
  if (!$('library').hidden) toggleLib(false);
  reportWidth();
}
/** Vuelve a Spotify: pausa el video y quita el reproductor de la portada (la portada se vuelve a cargar). */
function useSpotify() {
  if (src !== 'youtube') return;
  src = 'spotify'; if (ytReady) yt.pauseVideo();
  $('ytbox').hidden = true; document.body.classList.remove('yt'); lastCover = ''; status(''); reportWidth();
}
/** Reproduce un video por su ID y lo agrega al final de la lista local. */
async function playYt(id, keepList = false) {
  if (!keepList) listPlay = null;
  ytList.push(id); ytIdx = ytList.length - 1; ytId = id;
  useYoutube(); status('Cargando video…');
  try { await loadYtApi(); } catch { return status('No se pudo cargar YouTube (¿sin conexión?)'); }
  if (!yt) yt = new YT.Player('yt', { width: '100%', height: '100%', videoId: id,
    playerVars: { origin: location.origin, playsinline: 1, rel: 0 },
    events: { onReady: ytOnReady, onStateChange: ytOnState, onError: ytOnError,
      onPlaybackRateChange: e => $('rate').textContent = e.data + '×' } });
  else if (ytReady) yt.loadVideoById(id);
}
/**
 * Un video que no se puede reproducir (por ejemplo, el dueño no permite verlo fuera de YouTube). Dentro de una lista,
 * a los 10 s pasa solo al siguiente elemento, con la cuenta regresiva en el aviso; se cancela si mientras tanto se
 * elige otra cosa (Siguiente, Anterior o cualquier otro elemento).
 */
let skipTimer;
function ytOnError(e) {
  const why = YT_ERR[e.data] || 'error ' + e.data; clearInterval(skipTimer);
  if (!listPlay) return status('No disponible: ' + why, 8000);
  const lp = listPlay; let n = 10;
  const tick = () => {
    if (listPlay !== lp) return clearInterval(skipTimer);   // ya se eligió otra cosa
    if (n === 0) { clearInterval(skipTimer); return listStep(1); }
    status('Sigue en ' + n-- + ' s · no disponible: ' + why);   // la cuenta va primero: el aviso es de una línea
  };
  tick(); skipTimer = setInterval(tick, 1000);
}
function ytOnReady() {
  ytReady = true; yt.setVolume(+$('vol').value);
  if (yt.getVideoData()?.video_id !== ytId) yt.loadVideoById(ytId); else yt.playVideo();
}
function ytOnState(e) {
  if (src !== 'youtube') return;
  for (const p of document.querySelectorAll('.pp svg')) p.innerHTML = e.data === 1 ? ICON.pause : ICON.play;
  if (e.data === 1) status('');
  if (e.data === 1 || e.data === 5 || e.data === -1) ytMeta();
  if (e.data === 0) { if (listPlay) listStep(1); else ytStep(1); }   // terminó: sigue la lista, o el próximo video pegado
}
/** Título, canal, miniatura (color del tema y aviso de canción nueva) del video actual. */
async function ytMeta() {
  const d = yt.getVideoData() || {}, id = d.video_id; if (!d.title || !id) return;
  $('title').textContent = d.title; $('artist').textContent = d.author || 'YouTube';
  bridge.nowPlaying?.(d.title, $('artist').textContent);
  const uri = 'youtube:' + id; if (uri === curUri) return;
  const changed = !!curUri; curUri = uri; $('like').hidden = false; paintLike(false); $('like').title = 'Agregar a una lista'; addYtHistory(id, d.title, $('artist').textContent);
  const url = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'; lastCover = url;
  const data = await bridge.cover(url); if (lastCover !== url) return;
  if (data) {
    coverData = data; setCover(data);
    await new Promise(done => { const im = new Image(); im.onload = () => { if (url === lastCover) tint(im); done(); }; im.onerror = done; im.src = data; });
  }
  if (changed && lastCover === url) announce({ name: d.title, artists: [{ name: $('artist').textContent }] }, data || '');
}
const ytToggle = () => { if (ytReady) yt.getPlayerState() === 1 ? yt.pauseVideo() : yt.playVideo(); };
/** Avanza o retrocede en la lista local de videos pegados. */
function ytStep(n) {
  const i = ytIdx + n; if (!ytReady || i < 0 || i >= ytList.length) return;
  ytIdx = i; ytId = ytList[i]; yt.loadVideoById(ytId);
}
// Anterior: igual que con Spotify, pasados 4 s reinicia el video.
const ytPrev = () => { if (ytReady && yt.getCurrentTime() > RESTART_MS / 1000) yt.seekTo(0, true); else ytStep(-1); };
// Velocidad de reproducción (la calidad y los subtítulos quedan en el engranaje del propio reproductor).
const RATES = [1, 1.25, 1.5, 2, .5, .75];
$('rate').onclick = () => { if (ytReady) yt.setPlaybackRate(RATES[(RATES.indexOf(yt.getPlaybackRate()) + 1) % RATES.length]); };
// Al terminar el inicio de sesión de Google se recarga el video para que tome la cuenta.
bridge.onYtLogin?.(() => { status('Sesión de Google iniciada'); if (ytReady && ytId) yt.loadVideoById(ytId, yt.getCurrentTime()); });

// ---------- Modo video ----------
// Ventana más ancha (384 px de diseño) con la pantalla 16:9 arriba y los controles abajo. Funciona con YouTube y con
// Spotify (la portada se centra con la misma portada difuminada a los costados). Volver al modo música es un clic.
function setVideo(on) {
  if (on && !$('library').hidden) toggleLib(false);
  if (!on) setSolo(false);
  $('player').classList.toggle('video', on); designW = on ? 384 : 280; fitScale(); reportWidth();
}
$('vidbtn').onclick = () => setVideo(true);
$('toMusic').onclick = () => setVideo(false);
// Solo video: se quita todo menos el video (para dejarlo a un costado sin menús). Se vuelve con el botón de abajo o Esc.
function setSolo(on) {
  $('player').classList.toggle('solo', on);
  if (on) { if (!$('library').hidden) toggleLib(false); if (!$('devs').hidden) toggleDevices(false); }
}
$('solo').onclick = () => setSolo(true);
$('soloOff').onclick = () => setSolo(false);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('player').classList.contains('solo')) { e.stopImmediatePropagation(); setSolo(false); } }, true);

// Tamaño del modo video a gusto: arrastrando cualquier borde o esquina. Solo cambia la escala (el video conserva su
// proporción); el proceso principal mantiene fijo el borde opuesto y guarda el tamaño para la próxima vez.
const EDGE = 8;
let rz = null, rzPend = null, rzFrame = 0;
const edgeAt = e => {
  if (!$('player').classList.contains('video')) return '';
  const v = e.clientY < EDGE ? 'n' : e.clientY > innerHeight - EDGE ? 's' : '', h = e.clientX < EDGE ? 'w' : e.clientX > innerWidth - EDGE ? 'e' : '';
  return v + h;
};
document.addEventListener('pointerdown', e => {
  const k = e.button === 0 && edgeAt(e); if (!k) return;
  e.stopImmediatePropagation(); e.preventDefault();   // no es un arrastre de ventana
  rz = { k, x: e.screenX, y: e.screenY, w: innerWidth, h: innerHeight };
  e.target.setPointerCapture(e.pointerId); bridge.resizeStart?.();
}, true);
document.addEventListener('pointermove', e => {
  if (!rz) { const k = edgeAt(e); if (document.documentElement.dataset.rz !== k) document.documentElement.dataset.rz = k; return; }
  const gw = rz.k.includes('e') ? e.screenX - rz.x : rz.k.includes('w') ? rz.x - e.screenX : null;
  const gh = rz.k.includes('s') ? e.screenY - rz.y : rz.k.includes('n') ? rz.y - e.screenY : null;
  const fw = gw === null ? 0 : (rz.w + gw) / rz.w, fh = gh === null ? 0 : (rz.h + gh) / rz.h;
  rzPend = rz.w / 384 * Math.max(fw, fh);
  rzFrame ||= requestAnimationFrame(() => { rzFrame = 0; if (rz && rzPend) bridge.resizeVideo?.(rzPend, rz.k.includes('w'), rz.k.includes('n')); });
});
const rzEnd = () => { if (rz) { rz = null; bridge.resizeEnd?.(); } };
document.addEventListener('pointerup', rzEnd);
document.addEventListener('pointercancel', rzEnd);
document.documentElement.addEventListener('pointerleave', () => { if (!rz) document.documentElement.dataset.rz = ''; });
$('vPlay').onclick = togglePlayback;
$('vPrev').onclick = goPrev;
$('vNext').onclick = goNext;

// ---------- Listas propias (canciones de Spotify y videos de YouTube mezclados) ----------
// Se guardan en esta PC (localStorage): hasta 50 listas de 500 elementos. Cada elemento es { k: 'spotify'|'youtube', id,
// title, sub, img? }; la imagen solo se guarda para Spotify (CDN de Spotify) y la de YouTube se arma desde el ID. Al
// reproducir una lista, Siguiente/Anterior la recorren y, al terminar el último elemento, se frena con «Fin de la lista».
// Cada canción de Spotify que empieza es un solo pedido a la API; el final se detecta con los avisos del SDK (sin red).
const LIST_MAX = 500, LISTS_MAX = 50;
const ID_OK = { spotify: /^[A-Za-z0-9]{22}$/, youtube: /^[\w-]{11}$/ };
const cleanTxt = (t, n) => String(t ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').trim().slice(0, n);
const cleanItem = x => x && ID_OK[x.k]?.test(x.id) ? { k: x.k, id: x.id, title: cleanTxt(x.title, 200) || 'Sin título', sub: cleanTxt(x.sub, 200),
  ...(x.k === 'spotify' && typeof x.img === 'string' && x.img.startsWith('https://i.scdn.co/image/') ? { img: x.img } : {}) } : null;
let lists = [];
try {
  const a = JSON.parse(localStorage.getItem('lists') || '[]');
  if (Array.isArray(a)) lists = a.filter(l => l && typeof l.id === 'string').slice(0, LISTS_MAX)
    .map(l => ({ id: l.id.slice(0, 20), name: cleanTxt(l.name, 60) || 'Sin nombre', items: (Array.isArray(l.items) ? l.items : []).map(cleanItem).filter(Boolean).slice(0, LIST_MAX) }));
} catch {}
const saveLists = () => { try { localStorage.setItem('lists', JSON.stringify(lists)); } catch { status('No se pudieron guardar las listas', 6000); } };
function newList(name) {
  if (lists.length >= LISTS_MAX) { status('Llegaste al máximo de ' + LISTS_MAX + ' listas', 6000); return null; }
  const l = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: cleanTxt(name, 60) || 'Nueva lista', items: [] };
  lists.push(l); saveLists(); return l;
}
function addToList(l, item) {
  if (l.items.length >= LIST_MAX) { status('«' + l.name + '» llegó al máximo de ' + LIST_MAX, 6000); return false; }
  l.items.push(item); saveLists();
  if (tab === 'lists' && openListId === l.id && !$('library').hidden) showList(l, false, true);
  return true;
}
const itemImg = x => x.k === 'youtube' ? 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg' : x.img || null;
const itemUri = x => (x.k === 'spotify' ? 'spotify:track:' : 'youtube:') + x.id;
function countText(l) {
  const s = l.items.filter(x => x.k === 'spotify').length, v = l.items.length - s;
  return l.items.length ? [s && s + (s === 1 ? ' canción' : ' canciones'), v && v + (v === 1 ? ' video' : ' videos')].filter(Boolean).join(' y ') : 'Vacía';
}
/** Lo que suena ahora como elemento de lista (o null si no es una canción ni un video). */
function curItem() {
  const m = curUri.match(/^(spotify:track:|youtube:)(.+)$/); if (!m) return null;
  const yt = m[1] === 'youtube:';
  return cleanItem({ k: yt ? 'youtube' : 'spotify', id: m[2], title: $('title').textContent, sub: $('artist').textContent, img: yt ? undefined : lastCover });
}

// Reproducción de una lista.
function playListAt(l, i) {
  const x = l.items[i]; if (!x) return;
  listPlay = { l, i, uri: itemUri(x), started: false, ending: false };
  status(''); if (!$('library').hidden) toggleLib(false);
  if (x.k === 'youtube') playYt(x.id, true);
  else playTracks([listPlay.uri], listPlay.uri, true);   // una pista suelta (sin álbum): al terminar no sigue sola
}
/** Pasa al elemento siguiente o anterior. Al pasar del último, frena y avisa «Fin de la lista». */
function listStep(n) {
  if (!listPlay) return false;
  const i = listPlay.i + n;
  if (i >= listPlay.l.items.length) { endList(); return true; }
  playListAt(listPlay.l, Math.max(0, i)); return true;
}
function endList() {
  const name = listPlay.l.name; listPlay = null;
  if (src === 'youtube') { if (ytReady) yt.pauseVideo(); }
  else if (st && !st.paused) player?.pause()?.catch?.(() => {});
  status('Fin de la lista «' + name + '»');
}
// Posición actual (ms) de lo que suena y vuelta al principio, sea Spotify o YouTube.
const curPos = () => src === 'youtube' ? (ytReady ? yt.getCurrentTime() * 1000 : 0) : st ? (st.paused ? st.position : st.position + performance.now() - t0) : 0;
function seekStart() {
  if (src === 'youtube') { if (ytReady) yt.seekTo(0, true); }
  else if (player) { player.seek(0); if (st) { st.position = 0; t0 = performance.now(); } }
}
/**
 * Fin de una canción de Spotify dentro de una lista, a partir de los avisos del SDK: queda en pausa en 0 justo después de
 * estar sonando cerca del final, o empieza a sonar otra cosa sin pedirla (la reproducción automática de Spotify).
 */
function checkListEnd(prev, prevT0, s) {
  if (!s || listPlay.ending) return;
  const t = s.track_window?.current_track, ours = t && (t.uri === listPlay.uri || t.linked_from?.uri === listPlay.uri);
  if (ours) {
    if (!s.paused) listPlay.started = true;
    const was = prev && !prev.paused ? prev.position + performance.now() - prevT0 : 0;
    if (listPlay.started && s.paused && s.position === 0 && was >= (s.duration || prev?.duration || 0) - 3000) { listPlay.ending = true; listStep(1); }
  } else if (listPlay.started && !s.paused) { listPlay.ending = true; listStep(1); }
}

// Vista de listas dentro de la biblioteca.
const btnTxt = (text, fn, title) => {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = text; if (title) b.title = b.ariaLabel = title;
  b.onclick = e => { e.stopPropagation(); fn(b); }; return b;
};
const barRow = (...btns) => { const li = document.createElement('li'); li.className = 'lbar'; li.append(...btns); return li; };
/** Fila con un campo de nombre (crear o renombrar). Enter confirma; Esc cancela. */
function nameRow(value, label, ok, cancel) {
  const i = document.createElement('input'); i.maxLength = 60; i.value = value; i.placeholder = 'Nombre de la lista'; i.ariaLabel = 'Nombre de la lista';
  i.onkeydown = e => { if (e.key === 'Enter') ok(i.value); else if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
  const li = barRow(i, btnTxt(label, () => ok(i.value))); setTimeout(() => i.focus()); return li;
}
// Reemplaza la lista visible conservando el scroll (para ordenar o quitar sin saltar arriba).
const refill = parts => { const l = $('list'), y = l.scrollTop; l.replaceChildren(...parts); l.scrollTop = y; };
const listCards = () => lists.length ? [sec('Mis listas'), ...lists.map(l => listRow({ name: l.name, sub: countText(l), img: l.items[0] ? itemImg(l.items[0]) : null, on: listPlay?.l === l,
  onclick: () => { openListId = l.id; loadLists(); } }))] : [note('Todavía no tenés listas. Creá una, o usá el botón + de una canción o un video.')];
/** Pestaña Listas: tus listas, o la lista abierta. */
function loadLists() {
  const l = lists.find(x => x.id === openListId); if (l) return showList(l);
  openListId = null;
  const create = () => fill([nameRow('', 'Crear', n => { const nl = newList(n); if (nl) openListId = nl.id; loadLists(); }, loadLists), ...listCards()]);
  fill([barRow(btnTxt('+ Nueva', create), btnTxt('Importar', importList, 'Importar una lista desde un archivo .txt')), ...listCards()]);
}
function showList(l, confirmDel = false, keepScroll = false) {
  const back = listRow({ name: '← Mis listas', sub: l.name + ' · ' + countText(l), onclick: () => { openListId = null; loadLists(); } });
  const rename = () => fill([back, nameRow(l.name, 'Guardar', n => { l.name = cleanTxt(n, 60) || l.name; saveLists(); showList(l); }, () => showList(l))]);
  const del = btnTxt(confirmDel ? '¿Seguro?' : 'Borrar', () => {
    if (!confirmDel) return showList(l, true, true);
    if (listPlay?.l === l) listPlay = null;
    lists = lists.filter(x => x !== l); saveLists(); openListId = null; loadLists();
  }, 'Borrar la lista');
  const parts = [back, barRow(btnTxt('▶ Reproducir', () => l.items.length && playListAt(l, 0)), btnTxt('Exportar', () => exportList(l), 'Guardar como archivo .txt para compartir'), btnTxt('Renombrar', rename), del)];
  if (!l.items.length) parts.push(note('Vacía: agregá canciones o videos con el botón + de los resultados o del título.'));
  l.items.forEach((x, i) => parts.push(itemRow(l, x, i)));
  (keepScroll ? refill : fill)(parts);
}
/** Fila de un elemento de la lista: origen (punto verde Spotify, rojo YouTube), subir, bajar y quitar. */
function itemRow(l, x, i) {
  const li = listRow({ name: x.title, sub: x.sub || (x.k === 'youtube' ? 'YouTube' : 'Spotify'), img: itemImg(x), on: listPlay?.l === l && listPlay.i === i, onclick: () => playListAt(l, i) });
  const dot = document.createElement('span'); dot.className = 'srcdot ' + (x.k === 'youtube' ? 'yt' : 'sp'); dot.title = x.k === 'youtube' ? 'YouTube' : 'Spotify';
  li.querySelector('.th').append(dot);
  const move = d => {
    const j = i + d; if (j < 0 || j >= l.items.length) return;
    [l.items[i], l.items[j]] = [l.items[j], l.items[i]];
    if (listPlay?.l === l) listPlay.i = listPlay.i === i ? j : listPlay.i === j ? i : listPlay.i;
    saveLists(); showList(l, false, true);
  };
  const remove = () => {
    l.items.splice(i, 1);
    if (listPlay?.l === l && listPlay.i >= i) listPlay.i--;   // si se quita lo que suena, Siguiente va al que quedó en su lugar
    saveLists(); showList(l, false, true);
  };
  const ctl = document.createElement('span'); ctl.className = 'lc';
  ctl.append(btnTxt('▲', () => move(-1), 'Subir'), btnTxt('▼', () => move(1), 'Bajar'), btnTxt('✕', remove, 'Quitar de la lista'));
  li.append(ctl); return li;
}
async function exportList(l) {
  if (!l.items.length) return status('La lista está vacía', 4000);
  const r = await bridge.listExport(l.name, l.items.map(({ k, id, title, sub }) => ({ k, id, title, sub })));
  if (r?.ok) status('Lista exportada', 4000); else if (r?.error) status('No se pudo exportar la lista', 6000);
}
const IMPORT_ERR = { format: 'El archivo no es una lista de Mini Player (falta la primera línea MINIPLAYER-PLAYLIST 1)',
  big: 'El archivo es demasiado grande (máximo 256 KB)', read: 'No se pudo leer el archivo' };
async function importList() {
  const r = await bridge.listImport(); if (!r) return;   // cancelado
  if (r.error) return status(IMPORT_ERR[r.error] || 'No se pudo importar la lista', 8000);
  const items = (r.items || []).map(cleanItem).filter(Boolean).slice(0, LIST_MAX);
  const l = newList(r.name || 'Lista importada'); if (!l) return;
  l.items = items; saveLists(); openListId = l.id; loadLists();
  status('Importada: ' + items.length + (items.length === 1 ? ' elemento' : ' elementos') + (r.skipped ? ' · ' + r.skipped + ' líneas no válidas descartadas' : ''), 8000);
}

// Menú «Agregar a…» de una canción o un video: nueva lista y tus listas.
function addListRows(item) {
  const rows = [sec('Mis listas')];
  const create = listRow({ name: 'Nueva lista…', sub: 'Crearla y agregar', onclick: () => create.replaceWith(nameRow('', 'Crear', n => {
    const l = newList(n); if (l && addToList(l, { ...item })) { status('Agregado a «' + l.name + '»', 3000); togglePick(false); }
  }, () => togglePick(false))) });
  rows.push(create);
  for (const l of lists) {
    const li = listRow({ name: l.name, sub: countText(l), img: l.items[0] ? itemImg(l.items[0]) : null, onclick: () => {
      if (!addToList(l, { ...item })) return;
      li.classList.add('cur'); li.querySelector('span').textContent = 'Agregado ✓'; setTimeout(() => togglePick(false), 700);
    } });
    rows.push(li);
  }
  return rows;
}

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
  if (!r.ok) return $('devs').replaceChildren(note('No se pudieron cargar los dispositivos (' + why(r.status) + ')'));
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
