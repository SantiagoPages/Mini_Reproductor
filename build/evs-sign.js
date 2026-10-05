/**
 * Hook `afterSign` de electron-builder: aplica la firma VMP de EVS al paquete de Windows.
 *
 * Orden requerido por Widevine en Windows: firma de código (si existe) -> firma VMP -> instaladores.
 * Credenciales: las almacenadas por `castlabs_evs.account signup` o las variables de entorno
 * EVS_ACCOUNT_NAME y EVS_PASSWD. No deben incluirse en el repositorio.
 */
/**
 * electron-builder afterSign hook: applies the EVS VMP signature (required by Widevine on Windows) after code
 * signing and before the installers are built. Credentials come from the EVS CLI store or EVS_ACCOUNT_NAME /
 * EVS_PASSWD and must never be committed.
 */
const { execFileSync } = require('child_process');

exports.default = async function (context) {
  if (context.electronPlatformName !== 'win32') return;
  const py = process.env.PYTHON || 'python';
  console.log('\n[EVS] Firmando', context.appOutDir);
  execFileSync(py, ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: 'inherit' });
  console.log('[EVS] Firma aplicada.\n');
};
