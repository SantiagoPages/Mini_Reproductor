// Ventana de ajustes: envía cambios parciales al proceso principal y refleja el estado que este difunde.
// Settings window: sends partial changes to the main process and mirrors the state it broadcasts.
const $ = id => document.getElementById(id);

function show(s) {
  $('bgMode').value = s.bgMode; $('bgColor').value = s.bgColor;
  $('accentMode').value = s.accentMode; $('accentColor').value = s.accentColor;
  $('blossoms').checked = !!s.blossoms;
  $('decor').hidden = s.preset !== 'cherry';   // la opción solo existe en Cherry
  $('bgColorRow').hidden = s.bgMode !== 'fixed';
  $('accentColorRow').hidden = s.accentMode !== 'custom';
  for (const b of document.querySelectorAll('#themes button')) b.classList.toggle('on', b.dataset.id === s.preset);
}
// Cualquier cambio manual deja de ser un tema prediseñado. / A manual change is no longer a preset.
const change = p => bridge.setSettings({ ...p, preset: 'custom' });

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
// Interruptor independiente: no convierte el tema en "personalizado". / Independent toggle: keeps the preset.
$('blossoms').onchange = () => bridge.setSettings({ blossoms: $('blossoms').checked });
$('reset').onclick = () => bridge.resetSettings();

bridge.onSettings(show);
bridge.getSettings().then(show);
