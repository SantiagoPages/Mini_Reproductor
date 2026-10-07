// Pinta el aviso con los datos que valida el proceso principal y lo anima. La ventana la oculta el proceso principal.
const $ = id => document.getElementById(id);
let t;
toast.onShow(d => {
  $('ti').textContent = d.title; $('ar').textContent = d.artist;
  const r = document.documentElement.style; r.setProperty('--bg', d.bg); r.setProperty('--fg', d.fg);   // CSSOM: compatible con la CSP
  $('c').hidden = !d.cover; $('c').style.backgroundImage = d.cover ? `url(${d.cover})` : 'none';
  // Si llega otra canción con el aviso visible, la animación y el temporizador se reinician.
  clearTimeout(t); document.body.className = ''; void document.body.offsetWidth; document.body.className = 'in';
  t = setTimeout(() => document.body.className = 'out', 3800);
});
