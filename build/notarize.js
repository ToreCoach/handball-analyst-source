// Eseguito automaticamente da electron-builder subito dopo la firma del .app,
// prima di chiuderlo nel .dmg. Manda l'app ad Apple per la notarizzazione:
// senza, macOS mostrerebbe lo stesso blocco "contiene malware" già visto
// durante lo sviluppo, a chiunque la apra.
//
// Richiede tre variabili d'ambiente al momento della build:
//   APPLE_ID                    -> l'email del tuo Apple ID (quello del Developer Program)
//   APPLE_APP_SPECIFIC_PASSWORD -> generata su appleid.apple.com > Sicurezza > Password per app
//   APPLE_TEAM_ID                -> il Team ID (10 caratteri) da developer.apple.com > Membership

const { notarize } = require('@electron/notarize');

exports.default = async function notarizzaApp(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return; // solo per il build Mac

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('⚠️  Variabili Apple non impostate: salto la notarizzazione (l\'app risulterà firmata ma non notarizzata).');
    return;
  }

  const nomeApp = context.packager.appInfo.productFilename;

  console.log('📤 Invio ad Apple per la notarizzazione (può richiedere qualche minuto)...');

  await notarize({
    appBundleId: 'com.torecoach.handballanalyst',
    appPath: `${appOutDir}/${nomeApp}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  });

  console.log('✅ Notarizzazione completata.');
};
