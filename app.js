/**
 * Interfaz de Mini Player (proceso renderer).
 *
 * Orden de los módulos: autenticación (OAuth PKCE) · Web Playback SDK · color dinámico ·
 * controles · Me gusta · aleatorio · volumen · biblioteca y búsqueda · arranque.
 *
 * Convenciones: `bridge` es la API definida en preload.js; `sp()` accede a la Web API de Spotify;
 * el contenido externo se inserta con textContent, nunca con innerHTML.
 */
/**
 * Mini Player UI (renderer process). Sections: OAuth PKCE auth, Web Playback SDK, dynamic color, controls,
 * likes, shuffle, volume, library/search, startup. `bridge` is the preload API; `sp()` wraps the Spotify Web API;
 * external content is inserted with textContent, never innerHTML.
 */
const $ = id => document.getElementById(id);
// Debe coincidir con la redirect URI registrada en Spotify y con el puerto del servidor local.
const REDIRECT = location.origin + '/';   // el origen lo define el servidor local (PORT en main.js): fuente única
// Enlace o URI de Spotify (playlist, álbum o pista) con su ID de 22 caracteres.
// Spotify link/URI matcher (playlist, album or track) with its 22-character ID.
const LINK = /(playlist|album|track)[\/:]([A-Za-z0-9]{22})/;
// Permisos solicitados. Si esta lista cambia, la sesión guardada se invalida y se pide reautorización.
// Requested scopes. Changing this list invalidates stored sessions and triggers re-authorization.
const SCOPE = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-library-modify';
// Utilidades PKCE: codificación base64url y valores aleatorios criptográficamente seguros.
const b64 = a => btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const rand = n => b64(crypto.getRandomValues(new Uint8Array(n)));
const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const ICON = { play: '<path d="M8 5v14l11-7z"/>', pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>', check: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>' };
// Estado de módulo: credenciales en memoria (S), parámetros del login en curso y estado del reproductor.
let S = { cid: '', rt: '', at: '', exp: 0 }, ver, state, player, dev, st, t0 = 0, lastCover = '';

// ---------- Autenticación: OAuth 2.0 Authorization Code con PKCE ----------
// Cliente público: no existe client secret. El refresh token es la única credencial persistida
// (cifrada por el proceso principal).
/** Solicita tokens a Spotify y actualiza S; persiste el refresh token cuando se emite uno nuevo. */
/** Requests tokens from Spotify and updates S; persists the refresh token whenever a new one is issued. */
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
// Single-flight refresh: concurrent callers await the same request, so a rotated refresh token is never spent twice.
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
// Starts the PKCE flow: generates verifier and state, derives the S256 challenge and opens the system browser.
// Public client: there is no client secret.
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
// OAuth callback: the state parameter is verified (CSRF protection) before the code is exchanged.
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
// 'ready' fires again on every SDK reconnect, so playback must not be transferred here; doing so would
// hijack the device the user is currently listening on.
    player.addListener('ready', ({ device_id }) => { dev = device_id; status(''); });
    ['initialization_error', 'authentication_error', 'account_error', 'playback_error'].forEach(e => player.addListener(e, ({ message }) => status(message)));
    player.addListener('player_state_changed', s => { st = s; t0 = performance.now(); render(); });
    status('Conectando…');
    setTimeout(() => { if (!dev) status('Spotify no respondió. ¿Premium activo?'); }, 10000);
    player.connect();
  };
  const s = document.createElement('script'); s.src = 'https://sdk.scdn.co/spotify-player.js'; document.head.append(s);
}
const status = t => $('status').textContent = t || '';

/** Refleja el estado del SDK en la interfaz: metadatos, play/pausa, aleatorio, portada y color. */
async function render() {
  if (st) paintShuffle(!!st.shuffle);
  const t = st?.track_window?.current_track; if (!t) return;
  $('title').textContent = t.name; $('artist').textContent = t.artists.map(a => a.name).join(', ');
  bridge.nowPlaying?.(t.name, $('artist').textContent);
  $('play').firstElementChild.innerHTML = st.paused ? ICON.play : ICON.pause;
  $('dur').textContent = fmt(st.duration);
  if (t.uri !== curUri) { curUri = t.uri; syncLike(t.uri); }
  const url = t.album.images.reduce((a, b) => (b.height || 0) > (a.height || 0) ? b : a, t.album.images[0] || {}).url;
  if (url && url !== lastCover) {
    lastCover = url; const data = await bridge.cover(url); if (!data || url !== lastCover) return;   // descarta respuestas obsoletas
    $('cover').style.backgroundImage = `url(${data})`;
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
// La imagen se reduce a 24×24 px y sus píxeles se agrupan en 12 sectores de tono (30° cada uno),
// ponderados por saturación². Se descartan píxeles muy oscuros, muy claros o casi acromáticos.
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
 * Dominant color: downscale to 24x24, bucket pixels into 12 hue sectors weighted by saturation squared,
 * take the heaviest sector, then darken until white text reaches AA contrast.
 */
function tint(img) {
  const c = document.createElement('canvas'); c.width = c.height = 24;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
  const d = x.getImageData(0, 0, 24, 24).data, bk = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0, l: 0 }));
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = toHsl(d[i], d[i + 1], d[i + 2]); if (l < .08 || l > .94 || s < .12) continue;
    const b = bk[Math.floor(h / 30) % 12], w = s * s; b.w += w; b.h += h * w; b.s += s * w; b.l += l * w;
  }
  const best = bk.reduce((a, b) => b.w > a.w ? b : a);
  let h = 250, s = .15, l = .25;                       // valores de respaldo para portadas sin color dominante
  if (best.w > 0) { h = best.h / best.w; s = Math.min(.75, Math.max(.35, best.s / best.w)); l = Math.min(.4, Math.max(.22, best.l / best.w)); }
  // Se oscurece el color hasta lograr un contraste >= 4,5:1 con texto blanco (WCAG AA); 0,17 deja margen
  // para el degradado superpuesto.
  // Darken until contrast against white text reaches 4.5:1 (WCAG AA); 0.17 leaves headroom for the overlay gradient.
  while (l > .08 && relLuminance(hslToRgb(h, s, l)) > .17) l -= .02;
  document.documentElement.style.setProperty('--bg', `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`);
}

// ---------- Controles ----------
/**
 * Play/pausa. Si este dispositivo no es el activo (getCurrentState() === null), pulsar play es una acción
 * explícita del usuario y transfiere la reproducción aquí; nunca se transfiere de forma automática.
 * Play/pause. When this device is not the active one, pressing play is an explicit user action and moves
 * playback here; playback is never transferred automatically.
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
function paintLike(on) {
  liked = on; $('like').classList.toggle('on', on); $('like').firstElementChild.innerHTML = on ? ICON.check : ICON.plus;
  $('like').title = on ? 'Quitar de tus Me gusta' : 'Guardar en tus Me gusta';
}
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
// Remote changes (other Connect devices) are not pushed by the SDK, so they are polled. Polling is skipped while
// the window is hidden or right after a local interaction, so it never overwrites the user's action.
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

// ---------- Volumen ----------
const savedVol = () => { const v = parseFloat(localStorage.getItem('vol')); return Number.isFinite(v) ? v : .6; };
$('vol').value = savedVol() * 100;
let volTouched = 0;
$('vol').oninput = () => { volTouched = Date.now(); const v = $('vol').value / 100; player?.setVolume(v); try { localStorage.setItem('vol', v); } catch {} };
// Sondeo de volumen: sincroniza cambios remotos (Spotify Connect) solo si este dispositivo es el activo
// y la ventana está visible.
// Same strategy for volume; only applied when this device is the active one.
setInterval(async () => {
  if (!dev || document.hidden || Date.now() - volTouched < 3000) return;   // período de gracia tras una interacción local
  try {
    const r = await sp('/me/player'); if (r.status !== 200) return;
    const d = (await r.json()).device;
    if (d?.id !== dev || d.volume_percent == null || Math.abs(d.volume_percent - $('vol').value) < 2) return;
    $('vol').value = d.volume_percent; try { localStorage.setItem('vol', d.volume_percent / 100); } catch {}
  } catch {}
}, 3000);

// ---------- Biblioteca y buscador ----------
// El modo desarrollo limita la búsqueda a 10 resultados por consulta; se piden 3 por tipo.
async function playUri(uri, ctx) {
  if (!dev) { status('El reproductor aún no está listo'); return false; }
  let body = { context_uri: uri };
  // A standalone track starts inside its album context so playback continues afterwards (autoplay is inherited).
  if (uri.startsWith('spotify:track:')) {   // Una pista suelta se inicia dentro de su álbum para heredar la continuidad (autoplay) del contexto.
    if (!ctx) { try { const t = await sp('/tracks/' + uri.split(':')[2]); if (t.ok) ctx = (await t.json()).album?.uri; } catch {} }
    body = ctx ? { context_uri: ctx, offset: { uri } } : { uris: [uri] };
  }
  const r = await sp('/me/player/play?device_id=' + dev, 'PUT', body);
  status(r.ok ? '' : 'No se pudo reproducir (' + r.status + ')'); return r.ok;
}
const img = a => a?.length ? a[a.length - 1].url : null;
const sec = (t, cls = 'sec') => { const d = document.createElement('li'); d.className = cls; d.textContent = t; return d; };
const note = t => sec(t, 'sec empty');
// UI built with DOM APIs and textContent (never innerHTML): names come from user-generated Spotify content.
function row(o) {   // Construcción por DOM con textContent (nunca innerHTML): los nombres provienen de contenido de usuarios.
  const li = document.createElement('li'); li.className = 'it'; li.tabIndex = 0; li.setAttribute('role', 'button');
  const th = document.createElement('div'); th.className = 'th';
  if (o.img?.startsWith('https://')) th.style.backgroundImage = `url("${o.img.replace(/"/g, '%22')}")`;
  const tx = document.createElement('div'); tx.className = 'tx';
  const b = document.createElement('b'); b.textContent = o.name;
  const s = document.createElement('span'); s.textContent = o.sub;
  tx.append(b, s); li.append(th, tx);
  const go = async () => { if (await playUri(o.uri, o.ctx)) toggleLib(false); };
  li.onclick = go; li.onkeydown = e => { if (e.key === 'Enter') go(); };
  return li;
}
const fill = parts => { const l = $('list'); l.replaceChildren(...parts); l.scrollTop = 0; };
const owner = p => 'Playlist · ' + (p.owner?.display_name || '');

async function loadPlaylists() {
  fill([note('Cargando…')]);
  let url = '/me/playlists?limit=50', out = [];
  for (let i = 0; i < 3 && url; i++) {
    const r = await sp(url); if (!r.ok) return fill([note('No se pudieron cargar tus playlists (' + r.status + ')')]);
    const d = await r.json(); out.push(...d.items.filter(Boolean));
    url = d.next ? d.next.replace('https://api.spotify.com/v1', '') : null;
  }
  if ($('q').value.trim()) return;
  fill([sec('Tus playlists'), ...out.map(p => row({ name: p.name, sub: owner(p), uri: p.uri, img: img(p.images) }))]);
}
async function search(q) {
  const r = await sp('/search?' + new URLSearchParams({ q, type: 'track,album,playlist,artist', limit: 3 }));
  if (q !== $('q').value.trim()) return;   // descarta respuestas obsoletas (el usuario siguió escribiendo)
  if (!r.ok) return fill([note('Error al buscar (' + r.status + ')')]);
  const d = await r.json(), parts = [];
  const add = (title, o, map) => { const xs = (o?.items || []).filter(Boolean); if (xs.length) parts.push(sec(title), ...xs.map(x => row(map(x)))); };
  add('Canciones', d.tracks, t => ({ name: t.name, sub: t.artists.map(a => a.name).join(', '), uri: t.uri, ctx: t.album?.uri, img: img(t.album?.images) }));
  add('Álbumes', d.albums, a => ({ name: a.name, sub: a.artists.map(x => x.name).join(', '), uri: a.uri, img: img(a.images) }));
  add('Artistas', d.artists, a => ({ name: a.name, sub: 'Artista', uri: a.uri, img: img(a.images) }));
  add('Playlists', d.playlists, p => ({ name: p.name, sub: owner(p), uri: p.uri, img: img(p.images) }));
  fill(parts.length ? parts : [note('Sin resultados')]);
}
let timer;
$('q').oninput = () => { clearTimeout(timer); const q = $('q').value.trim(); timer = setTimeout(() => q ? search(q) : loadPlaylists(), 350); };
$('q').onkeydown = async e => {
  const m = e.key === 'Enter' && $('q').value.match(LINK);
  if (m && await playUri(`spotify:${m[1]}:${m[2]}`)) toggleLib(false);
};
function toggleLib(open = $('library').hidden) {
  $('library').hidden = !open; $('now').hidden = open; $('libbtn').classList.toggle('on', open);
  if (open) { $('q').value = ''; $('q').focus(); loadPlaylists(); }
}
$('libbtn').onclick = () => toggleLib();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('library').hidden) toggleLib(false); });

// ---------- Arranque: retoma la sesión guardada ----------
(async () => {
  const saved = await bridge.loadSession();
  if (!saved) return showLogin();
  // Los permisos solicitados cambiaron desde que se guardó la sesión: se exige reautorización.
  // Requested scopes changed since the session was stored: force re-authorization.
  if (saved.sc !== SCOPE) { $('cid').value = saved.cid; await bridge.clearSession(); return showLogin('Se agregaron permisos nuevos: volvé a conectarte.'); }
  S.cid = saved.cid; S.rt = saved.rt;
  try { await token(); start(); }
  catch (e) {
    if (e.code === 'invalid_grant') { await bridge.clearSession(); showLogin('Tu sesión expiró. Volvé a conectarte.'); }
    else { $('cid').value = S.cid; showLogin('No se pudo conectar. Revisá tu internet y reabrí la app.'); }
  }
})();
