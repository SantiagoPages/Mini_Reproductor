/** Temas prediseñados: cada uno es un conjunto de ajustes que se aplica con un clic. */
// Cada clave es un id de tema; `swatch` es la muestra que se ve en el botón de Ajustes.
const THEMES = {
  classic: { label: 'Clásico', bgMode: 'dynamic', bgColor: '#2a2060', accentMode: 'white', accentColor: '#ffffff', swatch: 'linear-gradient(135deg,#3b2d8f,#b0508a)' },
  pure:    { label: 'Oscuro puro', bgMode: 'fixed', bgColor: '#0e0e10', accentMode: 'white', accentColor: '#ffffff', swatch: '#0e0e10' },
  light:   { label: 'Claro', bgMode: 'fixed', bgColor: '#f2efe9', accentMode: 'custom', accentColor: '#3b2d8f', swatch: '#f2efe9' },
  neon:    { label: 'Neón', bgMode: 'fixed', bgColor: '#0b0b1a', accentMode: 'custom', accentColor: '#00e5ff', swatch: 'linear-gradient(135deg,#0b0b1a,#00e5ff)' },
  cherry:  { label: 'Cherry', bgMode: 'fixed', bgColor: '#f7c6d5', accentMode: 'custom', accentColor: '#b3265a', blossoms: true, swatch: 'linear-gradient(135deg,#ffe0ea,#f7a8c0)' },
  rainbow: { label: 'Arcoíris', bgMode: 'rainbow', bgColor: '#2a2060', accentMode: 'auto', accentColor: '#ffffff', swatch: 'linear-gradient(135deg,#e53935,#fdd835,#43a047,#1e88e5,#8e24aa)' }
};
