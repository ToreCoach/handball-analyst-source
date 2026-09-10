const crypto = require('crypto');

// Solo la chiave PUBBLICA: può verificare che un codice sia stato firmato con
// la chiave privata (che resta sul computer di chi genera le licenze), ma
// non può generarne di nuovi. È sicuro tenerla qui dentro l'app.
const CHIAVE_PUBBLICA = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/aHirjnsHizmnnKKAMPc0oIjbjE9
z1hjMFVGdYvomWBZAAwN31snmhzADDmwKzkMPMHLjU9ZYXtvcGaJ1usv9g==
-----END PUBLIC KEY-----`;

/**
 * Verifica un codice di attivazione. machineIdAtteso è l'ID di QUESTO
 * computer: se il codice è stato generato per una macchina diversa, viene
 * rifiutato anche se firma e scadenza sono a posto — così un codice non può
 * essere riusato copiando il programma su un altro Mac/PC.
 *
 * Ritorna sempre un oggetto:
 *   { valida: true,  coach, scadenza }
 *   { valida: false, motivo, coach?, scadenza? }  (coach/scadenza presenti solo se il codice era autentico)
 */
function verificaLicenza(codice, machineIdAtteso) {
  try {
    const pulito = (codice || '').trim();
    const parti = pulito.split('.');
    if (parti.length !== 2) return { valida: false, motivo: 'Codice non valido (formato errato).' };

    const [payloadB64, firmaB64] = parti;

    const firmaValida = crypto.verify(
      'sha256',
      Buffer.from(payloadB64),
      CHIAVE_PUBBLICA,
      Buffer.from(firmaB64, 'base64url')
    );
    if (!firmaValida) return { valida: false, motivo: 'Codice non valido.' };

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));

    if (payload.machineId && machineIdAtteso && payload.machineId !== machineIdAtteso) {
      return { valida: false, motivo: 'Questo codice non è valido per questo computer.', coach: payload.coach };
    }

    const scadenzaMs = new Date(payload.scadenza).getTime();
    if (Date.now() > scadenzaMs) {
      return { valida: false, motivo: 'Codice scaduto.', coach: payload.coach, scadenza: payload.scadenza };
    }

    return { valida: true, coach: payload.coach, scadenza: payload.scadenza };
  } catch (err) {
    return { valida: false, motivo: 'Codice non valido.' };
  }
}

module.exports = { verificaLicenza };
