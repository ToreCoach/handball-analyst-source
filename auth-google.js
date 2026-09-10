const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

// Impostato più sotto in main.js con i valori veri, presi da Google Cloud
// Console (Credenziali → Crea credenziali → ID client OAuth → tipo "App
// desktop") — collegato allo stesso progetto Firebase. Il Client Secret,
// nonostante il nome, non è un vero segreto per un'app desktop distribuita
// (chi la smonta può comunque trovarlo) — ma Google lo richiede comunque
// nello scambio finale del codice, anche usando PKCE.
let GOOGLE_CLIENT_ID = null;
let GOOGLE_CLIENT_SECRET = null;
function impostaGoogleClientId(id) {
  GOOGLE_CLIENT_ID = id;
}
function impostaGoogleClientSecret(secret) {
  GOOGLE_CLIENT_SECRET = secret;
}

// PKCE: genero una coppia verifier/challenge usa e getta per ogni tentativo
// di accesso — protegge il flusso senza dover nascondere un "client secret"
// dentro l'app distribuita (che sarebbe comunque visibile a chi la smonta).
function generaPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Avvia il login Google: apre il browser di sistema sulla pagina di
 * autorizzazione, ascolta in locale la risposta, scambia il codice per un
 * id_token. Ritorna { idToken } oppure lancia un errore.
 */
function accediConGoogle() {
  return new Promise((resolve, reject) => {
    if (!GOOGLE_CLIENT_ID) {
      reject(new Error('Accesso Google non ancora configurato.'));
      return;
    }

    const { verifier, challenge } = generaPkce();
    let portaLocale = null; // catturata subito all'avvio del server, riusata più avanti

    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const codice = url.searchParams.get('code');
        const erroreGoogle = url.searchParams.get('error');

        if (erroreGoogle) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body>Accesso annullato. Puoi chiudere questa scheda e tornare all\'app.</body></html>');
          server.close();
          reject(new Error('Accesso annullato dall\'utente.'));
          return;
        }
        if (!codice) {
          res.end('Richiesta non valida.');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<html><body style="font-family:sans-serif;text-align:center;padding-top:60px;">✅ Accesso riuscito — puoi chiudere questa scheda e tornare all\'app.</body></html>');
        server.close();

        const corpoRichiesta = new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code: codice,
          code_verifier: verifier,
          redirect_uri: `http://127.0.0.1:${portaLocale}`,
          grant_type: 'authorization_code'
        });

        const rispostaToken = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: corpoRichiesta.toString()
        });
        const datiToken = await rispostaToken.json();

        if (!rispostaToken.ok || !datiToken.id_token) {
          reject(new Error(datiToken.error_description || 'Scambio token non riuscito.'));
          return;
        }

        resolve({ idToken: datiToken.id_token });
      } catch (err) {
        reject(err);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      portaLocale = server.address().port;
      const parametri = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: `http://127.0.0.1:${portaLocale}`,
        response_type: 'code',
        scope: 'openid email profile',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account'
      });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${parametri.toString()}`);
    });

    // se il coach non completa l'accesso entro 3 minuti, non resto in ascolto per sempre
    setTimeout(() => {
      server.close();
      reject(new Error('Tempo scaduto, riprova.'));
    }, 3 * 60 * 1000);
  });
}

module.exports = { accediConGoogle, impostaGoogleClientId, impostaGoogleClientSecret };
