@echo off
rem Uso: doble clic. Requiere Node.js y, para la verificacion final, Python con castlabs-evs instalado.
rem Construye los artefactos de Windows (instalador y portable) y verifica la firma VMP de EVS.
cd /d "%~dp0"
rem Instala electron-builder solo si falta.
if not exist node_modules\electron-builder call npm install --save-dev electron-builder
rem Genera el instalador (NSIS) y el portable en la carpeta dist; la firma de EVS se aplica en el hook afterSign.
call npx electron-builder --config electron-builder.yml --win
if errorlevel 1 ( echo. & echo Fallo la construccion. Revisa el mensaje de arriba. & pause & exit /b 1 )
echo.
echo Verificando la firma de EVS...
rem La verificacion confirma que el ejecutable quedo firmado y que Widevine funcionara.
python -m castlabs_evs.vmp verify-pkg dist\win-unpacked
echo.
echo Listo. Los archivos estan en la carpeta "dist".
pause
