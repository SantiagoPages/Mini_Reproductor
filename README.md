# Mini Player

Reproductor de escritorio minimalista para Spotify (Windows). Una ventana pequeña y movible que reproduce
audio por sí misma, sin necesidad de tener abierta la aplicación de Spotify.

## Características

- Portada, título, artista y barra de progreso con salto por clic o arrastre.
- Fondo que toma el color dominante de la portada de cada canción.
- Anterior, play/pausa, siguiente, aleatorio, volumen y botón de Me gusta.
- Biblioteca (tus playlists) y buscador de canciones, álbumes, artistas y playlists.
- Ícono en la bandeja, modo "siempre encima" y teclas multimedia globales.
- Sesión persistente, guardada cifrada con el almacén de credenciales de Windows.

## Requisitos

- Windows 10 u 11.
- Una cuenta de **Spotify Premium** (el reproductor integrado no funciona con cuentas gratuitas).
- **Tu propio Client ID** de Spotify: la aplicación no incluye ninguno. Seguí las instrucciones de
  [`INSTRUCCIONES.txt`](INSTRUCCIONES.txt) (unos 3 minutos); la app también las muestra en la primera ejecución.

## Uso

Descargá el instalador o la versión portable desde la sección **Releases** del repositorio. Windows puede
mostrar un aviso de "editor desconocido" (SmartScreen) porque el ejecutable no tiene certificado de firma de
código: elegí *Más información → Ejecutar de todos modos*.

## Compilar desde el código

Requisitos: Node.js 20 o superior, Python 3 y una cuenta gratuita de [castLabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS).
La aplicación usa la build de Electron de castLabs, que incluye Widevine; sin firma de EVS, Spotify rechaza la
reproducción (`playback_error`).

```
npm install
pip install castlabs-evs
python -m castlabs_evs.account signup
python -m castlabs_evs.vmp sign-pkg node_modules\electron\dist
npm start
```

Para generar el instalador y la versión portable: `construir.bat` (resultado en `dist/`).

## Arquitectura y seguridad

- **Proceso principal** (`main.js`): ventana, bandeja, teclas multimedia y un servidor HTTP enlazado solo a
  `127.0.0.1` que sirve la interfaz y recibe el retorno de OAuth.
- **Interfaz** (`app.js`): sandbox, aislamiento de contexto y sin acceso a Node. Solo usa la API definida en
  `preload.js`, que mapea cada método a un canal IPC con argumentos validados.
- **Autenticación**: OAuth 2.0 con PKCE (cliente público, sin secretos). El refresh token se cifra con `safeStorage`.
- **Endurecimiento**: CSP restrictiva, validación del encabezado Host (anti DNS rebinding), navegación y ventanas
  nuevas bloqueadas, permisos de mínimo privilegio y construcción del DOM con `textContent`.
- **Repositorio**: no contiene ningún Client ID ni credencial.

## Limitaciones

- Spotify exige Premium y que cada persona use su propia app de desarrollador (modo desarrollo: hasta 5 usuarios por app).
- La firma de EVS puede vencer: de vez en cuando hace falta recompilar y volver a publicar el ejecutable.
- No es un producto oficial de Spotify.

## Aviso legal

Mini Player es un proyecto independiente, sin afiliación con Spotify AB. Spotify es una marca registrada de
Spotify AB. El uso de la API está sujeto a los términos para desarrolladores de Spotify.

## English summary

Minimal Windows desktop player for Spotify that plays audio on its own through the Web Playback SDK (Premium
required). Built with Electron (castLabs build with Widevine; EVS signing required). Every user supplies their own
Spotify Client ID: none is bundled. OAuth 2.0 PKCE, encrypted session storage, sandboxed UI with a strict CSP.
See "Compilar desde el código" for build steps.

## Licencia

[MIT](LICENSE)
