/**
 * Idioma de la interfaz: español (el del código y el HTML) o inglés.
 *
 * Con «English» elegido, este módulo traduce lo que se ve: textos y atributos title / aria-label / placeholder, también
 * los que aparecen después (MutationObserver), así el resto del código sigue escrito en español. Los textos con datos
 * (nombres, números, motivos de error) se traducen con reglas por patrón. El contenido del usuario (títulos, artistas,
 * nombres de listas) nunca se traduce: en esas zonas solo se cambian unos pocos textos fijos de la app. Al volver a
 * español se restauran los textos originales. No usa innerHTML: solo cambia el valor de nodos de texto y atributos.
 */
(() => {
  // Textos fijos: español → inglés.
  const EN = {
    // Ventana del reproductor y asistente inicial
    'Mini Player': 'Mini Player', 'Configurar Spotify': 'Set up Spotify',
    'Se hace una sola vez (unos 3 minutos). Necesitás Spotify Premium.': 'You only do this once (about 3 minutes). You need Spotify Premium.',
    'Abrí el panel y creá una app (el nombre es libre). Marcá': 'Open the dashboard and create an app (any name). Tick',
    'y': 'and', 'Abrir panel de Spotify': 'Open Spotify dashboard', 'En': 'In', 'poné': 'enter', 'y guardá.': 'and save.',
    'Copiar dirección': 'Copy address', '¡Copiada!': 'Copied!', 'Copiá el': 'Copy your app’s', 'de tu app y pegalo acá:': 'and paste it here:',
    'Conectar con Spotify': 'Connect to Spotify', 'Completá el inicio de sesión en tu navegador…': 'Finish signing in in your browser…',
    'El Client ID debe tener 32 caracteres.': 'The Client ID must be 32 characters long.',
    'No se pudo iniciar sesión. Probá de nuevo.': 'Couldn’t sign in. Try again.',
    'Se agregaron permisos nuevos: volvé a conectarte.': 'New permissions were added: connect again.',
    'Tu sesión expiró. Volvé a conectarte.': 'Your session expired. Connect again.',
    'No se pudo conectar. Revisá tu internet y reabrí la app.': 'Couldn’t connect. Check your internet and reopen the app.',
    'Conectando…': 'Connecting…', 'Spotify no respondió. ¿Premium activo?': 'Spotify didn’t respond. Is Premium active?',
    'El reproductor aún no está listo': 'The player isn’t ready yet',
    'Nada sonando': 'Nothing playing', 'Pegá un link de Spotify (Ctrl+V)': 'Paste a Spotify link (Ctrl+V)',
    'Ver': 'View', 'Cerrar aviso': 'Close notice', 'Cerrar': 'Close', 'Silenciar': 'Mute', 'Activar sonido': 'Unmute', 'Volumen': 'Volume',
    'Elegir dispositivo': 'Choose device', 'Ajustes de apariencia': 'Appearance settings', 'Ajustes': 'Settings',
    'Biblioteca y buscador (Esc para volver)': 'Library and search (Esc to go back)', 'Siempre encima': 'Always on top',
    'Modo video': 'Video mode', 'Mostrar controles (Esc)': 'Show controls (Esc)', 'Solo video (Esc para volver)': 'Video only (Esc to go back)',
    'Volver al modo música': 'Back to music mode', 'Velocidad de reproducción': 'Playback speed',
    'Aleatorio': 'Shuffle', 'Aleatorio: activado': 'Shuffle: on', 'Aleatorio: desactivado': 'Shuffle: off',
    'Anterior': 'Previous', 'Siguiente': 'Next', 'Pausa / Reanudar': 'Pause / Resume',
    'Repetir': 'Repeat', 'Repetir: apagado': 'Repeat: off', 'Repetir: playlist o álbum': 'Repeat: playlist or album', 'Repetir: esta canción': 'Repeat: this song',
    'Bajar volumen': 'Volume down', 'Subir volumen': 'Volume up', 'Volumen (también con la rueda del ratón)': 'Volume (also with the mouse wheel)',
    'Guardar en tus Me gusta': 'Save to your Liked Songs', 'Guardar en… (tecla L: Me gusta)': 'Save to… (L key: Liked Songs)',
    'Guardada en Me gusta · elegir dónde guardar': 'Saved to Liked Songs · choose where to save', 'Agregar a una lista': 'Add to a list',
    'Agregar a…': 'Add to…', 'Agregar a': 'Add to', 'Canciones que te gustan': 'Liked Songs',
    'Tocá para guardarla': 'Tap to save it', 'Guardada ✓ · tocá para quitarla': 'Saved ✓ · tap to remove it',
    'Cargando tus playlists…': 'Loading your playlists…', 'Playlists de Spotify': 'Spotify playlists', 'No tenés playlists propias': 'You have no playlists of your own',
    'Tuya': 'Yours', 'Colaborativa': 'Collaborative', 'Agregando…': 'Adding…', 'Agregada ✓': 'Added ✓', 'Agregado ✓': 'Added ✓',
    'Sin permiso para editarla (403)': 'No permission to edit it (403)',
    // Biblioteca
    'Me gusta': 'Liked', 'Mis listas': 'My lists', 'Buscar': 'Search', 'Top': 'Top', 'Colección': 'Collection', 'Cola': 'Queue', 'Reciente': 'Recent',
    '4 semanas': '4 weeks', '6 meses': '6 months', 'Siempre': 'All time', 'Canciones': 'Songs', 'Videos': 'Videos', 'Mezcla': 'Mix',
    'Ambas': 'Both', 'Dónde buscar': 'Where to search', 'Qué mostrar': 'What to show',
    'Buscar o pegar un link': 'Search or paste a link', 'Buscar en Spotify o pegar un link': 'Search Spotify or paste a link',
    'Buscar en YouTube (Enter) o pegar un link': 'Search YouTube (Enter) or paste a link',
    'Cargando…': 'Loading…', 'Sin resultados': 'No results', 'Spotify: sin resultados': 'Spotify: no results', 'YouTube: sin resultados': 'YouTube: no results',
    'Tus playlists': 'Your playlists', 'Álbumes': 'Albums', 'Artistas': 'Artists', 'Playlists': 'Playlists', 'Artista': 'Artist',
    'Apretá Enter para buscar en YouTube': 'Press Enter to search YouTube', 'Escribí y apretá Enter para buscar en YouTube': 'Type and press Enter to search YouTube',
    'Buscando en YouTube…': 'Searching YouTube…', 'Videos de YouTube': 'YouTube videos',
    'Para buscar en YouTube, agregá tu clave en Ajustes › Sistema › YouTube': 'To search YouTube, add your key in Settings › System › YouTube',
    'Se terminó el cupo diario de búsquedas de YouTube (se renueva cada día)': 'The daily YouTube search quota is used up (it resets every day)',
    'Sin conexión: no se pudo buscar en YouTube': 'Offline: couldn’t search YouTube',
    'Todavía no guardaste canciones': 'You haven’t saved any songs yet', 'Tus más escuchados': 'Your most played', 'Todavía no hay datos suficientes': 'Not enough data yet',
    'Álbumes guardados': 'Saved albums', 'Artistas que seguís': 'Artists you follow', 'Tus artistas más escuchados': 'Your most played artists',
    'Todavía no guardaste álbumes': 'You haven’t saved any albums yet', 'Todavía no seguís artistas': 'You don’t follow any artists yet',
    '← Volver': '← Back', 'Cargando álbumes…': 'Loading albums…', 'Álbumes y sencillos': 'Albums and singles', 'Sin álbumes': 'No albums',
    'Álbum': 'Album', 'Sencillo': 'Single', 'Sonando ahora': 'Now playing', 'A continuación': 'Up next', 'La cola está vacía': 'The queue is empty',
    'Canciones recientes': 'Recent songs', 'Videos recientes': 'Recent videos', 'Escuchado y visto recientemente': 'Recently played and watched',
    'Todavía no hay historial': 'No history yet', 'Todavía no viste videos': 'You haven’t watched any videos yet',
    'Buscando dispositivos…': 'Looking for devices…', 'No hay dispositivos disponibles': 'No devices available', 'Reproduciendo': 'Playing',
    'Agregada a la cola': 'Added to queue', 'Primero reproducí algo en este reproductor': 'Play something on this player first',
    'Cola de Spotify': 'Spotify queue', 'Suena después de lo actual': 'Plays after the current one',
    // Listas propias
    '+ Nueva': '+ New', 'Importar': 'Import', 'Importar una lista desde un archivo .txt': 'Import a list from a .txt file',
    'Todavía no tenés listas. Creá una, o usá el botón + de una canción o un video.': 'You don’t have any lists yet. Create one, or use the + button on a song or video.',
    '← Mis listas': '← My lists', '▶ Reproducir': '▶ Play', 'Exportar': 'Export', 'Guardar como archivo .txt para compartir': 'Save as a .txt file to share',
    'Renombrar': 'Rename', 'Borrar': 'Delete', '¿Seguro?': 'Sure?', 'Borrar la lista': 'Delete the list', 'Guardar': 'Save', 'Crear': 'Create',
    'Nombre de la lista': 'List name', 'Nueva lista': 'New list', 'Nueva lista…': 'New list…', 'Crearla y agregar': 'Create it and add',
    'Vacía': 'Empty', 'Vacía: agregá canciones o videos con el botón + de los resultados o del título.': 'Empty: add songs or videos with the + button on results or next to the title.',
    'Subir': 'Move up', 'Bajar': 'Move down', 'Quitar de la lista': 'Remove from list', 'Lista importada': 'Imported list', 'Lista exportada': 'List exported',
    'La lista está vacía': 'The list is empty', 'No se pudo exportar la lista': 'Couldn’t export the list', 'No se pudo importar la lista': 'Couldn’t import the list',
    'No se pudieron guardar las listas': 'Couldn’t save the lists', 'Sin título': 'Untitled', 'Sin nombre': 'Untitled',
    'El archivo no es una lista de Mini Player (falta la primera línea MINIPLAYER-PLAYLIST 1)': 'The file isn’t a Mini Player list (the first line MINIPLAYER-PLAYLIST 1 is missing)',
    'El archivo es demasiado grande (máximo 256 KB)': 'The file is too large (256 KB max)', 'No se pudo leer el archivo': 'Couldn’t read the file',
    // YouTube
    'Cargando video…': 'Loading video…', 'No se pudo cargar YouTube (¿sin conexión?)': 'Couldn’t load YouTube (offline?)',
    'Video en pausa mientras buscás': 'Video paused while you browse', 'Sesión de Google iniciada': 'Signed in to Google',
    'el enlace no es válido': 'the link isn’t valid', 'falló el reproductor': 'the player failed', 'el video no existe o es privado': 'the video doesn’t exist or is private',
    'el dueño no permite verlo fuera de YouTube': 'the owner doesn’t allow playback outside YouTube', 'YouTube rechazó el origen': 'YouTube rejected the origin',
    'Aviso de canción nueva': 'New song notice', 'Así se verá, abajo a la derecha': 'This is how it looks, bottom right',
    // Ajustes
    'Los cambios se ven al instante en el reproductor y se guardan en esta PC.': 'Changes show up instantly in the player and are saved on this PC.',
    'Apariencia': 'Appearance', 'Ventana': 'Window', 'Sistema': 'System', 'Temas': 'Themes', 'Sonidos': 'Sounds', 'Sonidos del tema': 'Theme sounds',
    'Fondo': 'Background', 'Modo de fondo': 'Background mode', 'Dinámico (color de la portada)': 'Dynamic (cover color)', 'Color fijo': 'Solid color',
    'Degradado de dos colores de la portada': 'Gradient of two cover colors', 'Portada difuminada': 'Blurred cover',
    'Arcoíris (cambio de color continuo)': 'Rainbow (continuous color change)', 'Trío (fondo, acento y detalles de la portada)': 'Trio (background, accent and details from the cover)',
    'Color del fondo': 'Background color', 'Acento': 'Accent', 'Color de acento': 'Accent color', 'Blanco': 'White', 'Color elegido': 'Chosen color', 'Tono de la portada': 'Cover hue',
    'Decoración': 'Decoration', 'Flores y pétalos': 'Flowers and petals', 'Tipografía': 'Font', 'Inter (la actual)': 'Inter (current)',
    'Redondeada (Nunito)': 'Rounded (Nunito)', 'Geométrica (Outfit)': 'Geometric (Outfit)', 'Monoespaciada (LCD retro)': 'Monospaced (retro LCD)',
    'Amigable con la dislexia (Atkinson Hyperlegible)': 'Dyslexia-friendly (Atkinson Hyperlegible)',
    'Tamaño y forma': 'Size and shape', 'Chico': 'Small', 'Normal': 'Normal', 'Grande': 'Large', 'Enorme': 'Huge', 'Tamaño': 'Size', 'Esquinas': 'Corners',
    'Transparencia del fondo': 'Background transparency', 'Qué se muestra': 'What’s shown', 'La portada': 'The cover', 'El artista': 'The artist',
    'Botón + (Me gusta y playlists)': '+ button (Liked Songs and playlists)', 'Barra de tiempo y tiempos': 'Time bar and times',
    'Redondeada': 'Rounded', 'Cuadrada': 'Square', 'Círculo': 'Circle', 'Botones': 'Buttons', 'Estilo de botones': 'Button style',
    'Relieve físico (el actual)': 'Physical relief (current)', 'Planos': 'Flat', 'Contorno': 'Outline', 'Solo ícono': 'Icon only',
    'Rueda estilo MP4 (MENU abre estos Ajustes)': 'MP4-style wheel (MENU opens these Settings)',
    'Avisos y sistema': 'Notices and system', 'Avisar si hay una versión nueva (consulta GitHub al iniciar)': 'Notify me of new versions (checks GitHub on start)',
    'Avisar cuando cambia la canción (solo con la ventana en segundo plano)': 'Notify me when the song changes (only with the window in the background)',
    'Iniciar con el sistema (arranca oculto en la bandeja)': 'Start with the system (starts hidden in the tray)',
    'Atajos de teclado': 'Keyboard shortcuts', 'Con la ventana del reproductor activa:': 'With the player window active:', 'Espacio': 'Space',
    'pausa': 'pause', 'anterior / siguiente': 'previous / next', 'volumen': 'volume', 'silencio': 'mute',
    'En cualquier momento:': 'Anytime:', 'centra la ventana en el monitor donde esté el mouse.': 'centers the window on the monitor where the mouse is.',
    'Pegá un enlace de YouTube (Ctrl+V) para verlo en el reproductor. Calidad y subtítulos: en el engranaje del propio video.': 'Paste a YouTube link (Ctrl+V) to watch it in the player. Quality and subtitles: in the video’s own gear menu.',
    'Conectar con Google': 'Connect to Google', 'Seguir reproduciendo con la ventana tapada o en segundo plano': 'Keep playing when the window is covered or in the background',
    'Para buscar videos desde el buscador hace falta tu propia clave de la API de YouTube (gratis, unas 100 búsquedas por día). Se guarda cifrada en esta PC.': 'Searching videos needs your own YouTube API key (free, about 100 searches a day). It’s stored encrypted on this PC.',
    'Clave de API de YouTube': 'YouTube API key', 'Guardar clave': 'Save key', 'Cómo conseguirla': 'How to get one', 'Comprobando…': 'Checking…',
    'Sin clave: el buscador solo busca en Spotify.': 'No key: search only covers Spotify.',
    'Clave guardada. Para cambiarla, pegá otra; para borrarla, guardá el campo vacío.': 'Key saved. To change it, paste another; to remove it, save an empty field.',
    'Eso no parece una clave de API (suelen empezar con «AIza»).': 'That doesn’t look like an API key (they usually start with “AIza”).',
    'La clave existe, pero la API de YouTube no está habilitada en tu proyecto de Google Cloud.': 'The key exists, but the YouTube API isn’t enabled in your Google Cloud project.',
    'Google rechazó la clave. Revisá que esté bien copiada.': 'Google rejected the key. Check that it was copied correctly.',
    'Sin conexión: no se pudo comprobar la clave.': 'Offline: couldn’t check the key.', 'Esta PC no tiene dónde guardarla cifrada.': 'This PC has no place to store it encrypted.',
    'No se pudo guardar la clave.': 'Couldn’t save the key.', 'Idioma': 'Language',
    'Código': 'Code', 'Agregar': 'Add', 'Probando…': 'Trying…', 'Código incorrecto.': 'Wrong code.', 'Demasiados intentos. Esperá un momento.': 'Too many attempts. Wait a moment.',
    'Restablecer valores': 'Reset to defaults',
    // Nombres de los temas públicos
    'Clásico': 'Classic', 'Oscuro puro': 'Pure dark', 'Claro': 'Light', 'Neón': 'Neon', 'Trío': 'Trio', 'Arcoíris': 'Rainbow',
    // Partes de mensajes armados con datos (las usan las reglas de abajo)
    'No se pudo iniciar la reproducción': 'Couldn’t start playback', 'No se pudo reproducir': 'Couldn’t play', 'No se pudo guardar': 'Couldn’t save',
    'No se pudo agregar': 'Couldn’t add', 'No se pudo agregar a la cola': 'Couldn’t add to queue', 'No se pudo cambiar el aleatorio': 'Couldn’t change shuffle',
    'No se pudo cambiar el modo de repetición': 'Couldn’t change repeat mode', 'No se pudo cambiar de dispositivo': 'Couldn’t switch device',
    'No se pudieron cargar los dispositivos': 'Couldn’t load devices', 'No se pudieron cargar los álbumes': 'Couldn’t load albums',
    'No se pudieron cargar tus playlists': 'Couldn’t load your playlists', 'Error al buscar en Spotify': 'Spotify search error', 'No se pudo buscar en YouTube': 'Couldn’t search YouTube',
    'No se pudo cargar': 'Couldn’t load', 'Mostrando lo último cargado': 'Showing the last loaded version',
    'tus playlists': 'your playlists', 'tus Me gusta': 'your Liked Songs', 'tus más escuchados': 'your most played', 'la cola': 'the queue',
    'el historial': 'the history', 'tu colección': 'your collection'
  };
  const tr0 = s => EN[s];
  // Textos con datos: [patrón, armado, soloInterfaz]. Si el armado devuelve undefined, se prueba la regla siguiente.
  // soloInterfaz: la regla no se aplica en zonas con contenido del usuario (p. ej. «Siempre (Live)» es un título).
  const RULES = [
    [/^Spotify limitó las consultas, esperá (.+)$/, (m, t) => 'Spotify is rate-limiting requests, wait ' + t],
    [/^No se pudo cargar (.+) \((.+)\)$/, (m, a, b) => tr0(a) && 'Couldn’t load ' + tr0(a) + ' (' + tr(b) + ')', true],
    [/^(.+) \((.+)\)$/, (m, a, b) => tr0(a) && tr0(a) + ' (' + tr(b) + ')', true],
    [/^Agregada a «(.*)»$/, (m, n) => 'Added to “' + n + '”'], [/^Agregado a «(.*)»$/, (m, n) => 'Added to “' + n + '”'],
    [/^No se pudo agregar a «(.*)»$/, (m, n) => 'Couldn’t add to “' + n + '”'], [/^Fin de la lista «(.*)»$/, (m, n) => 'End of list “' + n + '”'],
    [/^«(.*)» llegó al máximo de (\d+)$/, (m, n, k) => '“' + n + '” reached the limit of ' + k],
    [/^Llegaste al máximo de (\d+) listas$/, (m, k) => 'You reached the limit of ' + k + ' lists'],
    [/^Sigue en (\d+) s · no disponible: (.+)$/, (m, k, r) => 'Next in ' + k + ' s · unavailable: ' + tr(r)],
    [/^No disponible: (.+)$/, (m, r) => 'Unavailable: ' + tr(r)],
    [/^Importada: (\d+) elementos?(?: · (\d+) líneas no válidas descartadas)?$/, (m, k, d) => 'Imported: ' + k + (k === '1' ? ' item' : ' items') + (d ? ' · ' + d + ' invalid lines skipped' : '')],
    [/^Nueva versión (.+)$/, (m, v) => 'New version ' + v],
    [/^Playlist · (.*)$/, (m, o) => 'Playlist · ' + o], [/^Álbum · (.*)$/, (m, r) => 'Album · ' + r], [/^Sencillo · (.*)$/, (m, r) => 'Single · ' + r],
    [/^Reproducir a (.+)$/, (m, n) => 'Play ' + n], [/^Este reproductor · (.+)$/, (m, r) => 'This player · ' + tr(r)],
    [/^(\d+) (canción|canciones)(?: y (\d+) (videos?))?$/, (m, a, c, b, v) => a + (a === '1' ? ' song' : ' songs') + (b ? ' and ' + b + (b === '1' ? ' video' : ' videos') : '')],
    [/^(\d+) (videos?)$/, (m, a) => a + (a === '1' ? ' video' : ' videos')],
    [/^(.+) · ((?:\d+ (?:canción|canciones|videos?))(?: y \d+ videos?)?|Vacía)$/, (m, n, c) => n + ' · ' + tr(c)],   // «nombre de lista · cantidad»
    [/^¡Tema agregado: (.+)!$/, (m, n) => 'Theme added: ' + n + '!'],
    [/^Sonido: (.+)$/, (m, e) => 'Sound: ' + e]
  ];
  // Zonas con contenido del usuario: ahí solo se traducen estos textos fijos de la app y las reglas con datos.
  const USER_ZONE = '#title,#artist,.tx';
  const USER_EXACT = new Set(['Nada sonando', 'Pegá un link de Spotify (Ctrl+V)', 'Canciones que te gustan', 'Nueva lista…', 'Crearla y agregar',
    'Cola de Spotify', 'Suena después de lo actual', '← Volver', '← Mis listas', 'Artista', 'Tuya', 'Colaborativa', 'Tocá para guardarla',
    'Guardada ✓ · tocá para quitarla', 'Agregado ✓', 'Agregada ✓', 'Agregando…', 'Vacía', 'Sin título', 'Sin nombre', 'Reproduciendo', 'Colección',
    'Sin permiso para editarla (403)']);
  let lang = 'es';
  /** Traduce un texto (conserva los espacios de los bordes). `user`: zona con contenido del usuario. */
  function tr(s, user = false) {
    if (lang !== 'en' || typeof s !== 'string') return s;
    const k = s.trim(); if (!k) return s;
    let out = !user || USER_EXACT.has(k) ? EN[k] : undefined;
    if (out === undefined) for (const [re, f, ui] of RULES) { if (ui && user) continue; const m = k.match(re); if (m) { const r = f(...m); if (r) { out = r; break; } } }
    if (out === undefined) return s;
    const i = s.indexOf(k); return s.slice(0, i) + out + s.slice(i + k.length);
  }
  // Originales y traducciones aplicadas: permiten volver a español y evitar traducir dos veces.
  const orig = new WeakMap(), done = new WeakMap(), aOrig = new WeakMap(), aDone = new WeakMap();
  const ATTRS = ['title', 'aria-label', 'placeholder'];
  const inUser = n => !!(n.nodeType === 3 ? n.parentElement : n)?.closest?.(USER_ZONE);
  function doText(n) {
    const p = n.parentElement; if (!p || p.closest('script,style')) return;
    if (done.has(n) && n.nodeValue === done.get(n)) { if (lang === 'es') { n.nodeValue = orig.get(n); done.delete(n); } return; }
    done.delete(n); if (lang !== 'en') return;
    const src = n.nodeValue, out = tr(src, inUser(n));
    if (out !== src) { orig.set(n, src); done.set(n, out); n.nodeValue = out; }
  }
  function doAttr(el, a) {
    const v = el.getAttribute(a); if (v === null) return;
    const o = aOrig.get(el) || {}, d = aDone.get(el) || {};
    if (d[a] !== undefined && v === d[a]) { if (lang === 'es') { el.setAttribute(a, o[a]); delete d[a]; } return; }
    delete d[a]; if (lang === 'en') { const out = tr(v, a !== 'placeholder' && inUser(el)); if (out !== v) { o[a] = v; d[a] = out; el.setAttribute(a, out); } }
    aOrig.set(el, o); aDone.set(el, d);
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) doText(n);
    for (const el of [root, ...root.querySelectorAll('[title],[aria-label],[placeholder]')]) for (const a of ATTRS) if (el.hasAttribute?.(a)) doAttr(el, a);
  }
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttr(m.target, m.attributeName);
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  window.i18n = {
    tr,
    /** Cambia el idioma ('es' o 'en') y retraduce o restaura todo lo visible. */
    setLang(l) { l = l === 'en' ? 'en' : 'es'; if (l === lang) return; lang = l; document.documentElement.lang = l; walk(document.documentElement); },
    get lang() { return lang; }
  };
})();
