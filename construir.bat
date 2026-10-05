@echo off
rem Construye los artefactos de Windows (instalador y portable) y verifica la firma VMP de EVS.
cd /d "%~dp0"
if not exist node_modules\electron-builder call npm install --save-dev electron-builder
call npx electron-builder --config electron-builder.yml --win
if errorlevel 1 ( echo. & echo Fallo la construccion. Revisa el mensaje de arriba. & pause & exit /b 1 )
echo.
echo Verificando la firma de EVS...
python -m castlabs_evs.vmp verify-pkg dist\win-unpacked
echo.
echo Listo. Los archivos estan en la carpeta "dist".
pause
