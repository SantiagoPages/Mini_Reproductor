#!/usr/bin/env bash
# Uso: bash construir.sh   (en Ubuntu; requiere Node.js y npm)
# Construye los paquetes de Linux (.deb y .AppImage) en la carpeta dist. No necesita la firma de EVS:
# Widevine solo la exige en Windows y macOS.
set -euo pipefail
cd "$(dirname "$0")"

# Instala las dependencias del proyecto (incluido el Electron con Widevine de castLabs) solo si faltan.
[ -d node_modules ] || npm install
# El paquete de castLabs no descarga el programa de Electron al instalarse: se pide aparte si falta.
[ -d node_modules/electron/dist ] || node node_modules/electron/install.js
# Instala electron-builder solo si falta.
[ -d node_modules/electron-builder ] || npm install --save-dev electron-builder

# Genera los paquetes de Linux (sin publicar nada: las releases se suben a mano en GitHub).
npx electron-builder --config electron-builder.yml --linux --publish never

echo
echo "Listo. Los archivos estan en la carpeta dist:"
ls -1 dist/*.deb dist/*.AppImage
