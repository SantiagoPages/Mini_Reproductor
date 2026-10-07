/**
 * Hook `afterSign` de electron-builder: aplica la firma VMP de EVS al paquete de Windows.
 *
 * Orden requerido por Widevine en Windows: firma de código (si existe) -> firma VMP -> instaladores.
 * Credenciales: las almacenadas por `castlabs_evs.account signup` o las variables de entorno
 * EVS_ACCOUNT_NAME y EVS_PASSWD. No deben incluirse en el repositorio.
 */
const { execFileSync } = require('child_process');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;
  const py = process.env.PYTHON || 'python';
  console.log('\n[EVS] Firmando', context.appOutDir);
  execFileSync(py, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  console.log('[EVS] Firma aplicada.\n');
};
