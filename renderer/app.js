// ============================================================
// HANDBALL ANALYST — renderer
// ============================================================

// Link di pagamento Stripe per l'acquisto della licenza, mostrato quando il
// periodo di prova scade — cambialo qui se in futuro lo aggiorni su Stripe
const LINK_ACQUISTO_LICENZA = 'https://buy.stripe.com/9B614nfKa6DL57o8Is48000';

// --- Firebase: inizializzato subito, usato dalla sezione Account in
// Impostazioni per login email/password e Google. Se la configurazione è
// ancora il segnaposto (prima di creare il progetto Firebase vero), le
// chiamate falliranno con un errore chiaro invece di bloccare l'app.
try {
  firebase.initializeApp(FIREBASE_CONFIG);
} catch (err) {
  console.error('Firebase non inizializzato:', err.message);
}

// --- Aggiornamenti automatici: mostra un banner discreto in alto quando
// c'è una versione nuova, durante lo scaricamento, e quando è pronta
const bannerAgg = document.getElementById('bannerAggiornamento');
const bannerAggTesto = document.getElementById('bannerAggiornamentoTesto');
const btnInstallaAgg = document.getElementById('btnInstallaAggiornamento');

window.api.onAggiornamentoDisponibile(({ versione }) => {
  bannerAgg.style.display = 'flex';
  bannerAggTesto.textContent = `🔄 Nuova versione ${versione} trovata, scaricamento in corso...`;
});

window.api.onAggiornamentoProgresso(({ percento }) => {
  bannerAgg.style.display = 'flex';
  bannerAggTesto.textContent = `🔄 Scaricamento aggiornamento... ${percento}%`;
});

window.api.onAggiornamentoPronto(({ versione }) => {
  bannerAgg.style.display = 'flex';
  bannerAggTesto.textContent = `✅ Versione ${versione} pronta.`;
  btnInstallaAgg.style.display = 'inline-block';
});

window.api.onAggiornamentoErrore(({ messaggio }) => {
  bannerAgg.style.display = 'flex';
  bannerAgg.style.borderBottomColor = '#ff6b6b';
  bannerAggTesto.textContent = `⚠️ Controllo aggiornamenti non riuscito: ${messaggio}`;
});

btnInstallaAgg.addEventListener('click', () => {
  window.api.installaAggiornamentoOra();
});

// --- Controllo licenza: la schermata di attivazione (nell'HTML) è visibile
// di default e copre tutto — la nascondiamo solo se il codice è valido.
// Viene riverificata ad ogni avvio, non solo alla prima attivazione.
(async function controllaLicenza() {
  try {
  const overlay = document.getElementById('overlayLicenza');
  const titolo = document.getElementById('licenzaTitolo');
  const testo = document.getElementById('licenzaTesto');
  const errore = document.getElementById('licenzaErrore');

  const stato = await window.api.statoLicenza();
  if (stato.attivata) {
    overlay.style.display = 'none';
    return;
  }

  // codice mai inserito vs. codice che era valido ma è scaduto/di un'altra macchina: messaggi diversi
  if (stato.coach) {
    const provaScaduta = stato.motivo !== 'Questo codice non è valido per questo computer.';
    titolo.textContent = provaScaduta ? '⏰ Periodo di prova scaduto' : '⚠️ Codice non valido per questo computer';
    testo.textContent = provaScaduta
      ? `Il periodo di prova per ${stato.coach} è terminato. Per continuare ad usare Handball Analyst, acquista la licenza qui sotto — dopo il pagamento riceverai un nuovo codice via email.`
      : 'Il codice salvato appartiene a un altro computer. Manda il codice macchina qui sotto a chi ti ha dato l\'app per riceverne uno valido per questo Mac/PC.';

    if (provaScaduta) {
      const linkAcquista = document.getElementById('linkAcquista');
      linkAcquista.href = LINK_ACQUISTO_LICENZA;
      linkAcquista.style.display = 'block';
    }
  }

  const machineId = await window.api.machineId();
  document.getElementById('licenzaMachineId').textContent = machineId;

  document.getElementById('btnCopiaMachineId').addEventListener('click', () => {
    navigator.clipboard.writeText(machineId);
    const btn = document.getElementById('btnCopiaMachineId');
    btn.textContent = '✓';
    setTimeout(() => { btn.textContent = '📋'; }, 1500);
  });

  document.getElementById('btnAttivaLicenza').addEventListener('click', async () => {
    const codice = document.getElementById('licenzaInput').value;
    if (!codice.trim()) return;

    const esito = await window.api.attivaLicenza(codice);
    if (esito.valida) {
      errore.textContent = `✓ Attivato per ${esito.coach}, valido fino al ${new Date(esito.scadenza).toLocaleDateString('it-IT')}`;
      errore.classList.add('successo');
      setTimeout(() => { overlay.style.display = 'none'; }, 1200);
    } else {
      errore.textContent = esito.motivo || 'Codice non valido.';
      errore.classList.remove('successo');
    }
  });
  } catch (err) {
    console.error('Errore in controllaLicenza:', err);
    alert('Errore durante il controllo della licenza (mandalo a chi ti segue per l\'assistenza):\n\n' + (err && err.stack ? err.stack : err));
  }
})();

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// -------------------------------------------------------
// Pannello tag riusabile: costruisce bottoni dal DB, gestisce selezione
// -------------------------------------------------------
// Tavolozza per distinguere a colpo d'occhio ogni categoria nel pannello tag
// di Analisi — un colore diverso per ognuna, in ciclo se le categorie sono
// più dei colori disponibili.
const TAVOLOZZA_CATEGORIE = [
  '#43a047', '#42a5f5', '#ffb347', '#ab47bc', '#26c6da', '#ef5350',
  '#ffee58', '#8d6e63', '#ec407a', '#66bb6a', '#5c6bc0', '#ffa726',
  '#26a69a', '#7e57c2', '#d4e157', '#78909c'
];

async function caricaPannelloTag(container, onToggle, selezionati) {
  await assicuraPannelloAttivo();
  await popolaSelettoriPannello();
  const categorie = await window.api.getTags(pannelloAttivoId);
  container.innerHTML = '';

  categorie.forEach((cat, indice) => {
    const blocco = document.createElement('div');
    blocco.className = 'categoria-blocco';

    const colore = TAVOLOZZA_CATEGORIE[indice % TAVOLOZZA_CATEGORIE.length];
    blocco.style.borderLeftColor = colore;
    blocco.style.background = `${colore}14`; // sfondo molto tenue (~8% opacità), stesso colore del bordo

    if (cat.tag.length === 0) {
      // categoria vuota: il titolo stesso funge da flag rapido (es. "Attacco"/"Difesa"
      // senza sottovoci) — al primo click materializza un tag reale e lo seleziona
      const titolo = document.createElement('button');
      titolo.type = 'button';
      titolo.className = 'categoria-titolo-flag';
      titolo.textContent = `✓ ${cat.nome.toUpperCase()}`;
      titolo.addEventListener('click', async () => {
        const tagId = await window.api.creaOTrovaTagCategoria(cat.id);
        if (!tagId) return;
        if (selezionati.has(tagId)) { selezionati.delete(tagId); titolo.classList.remove('selezionato'); }
        else { selezionati.add(tagId); titolo.classList.add('selezionato'); }
        if (onToggle) onToggle();
      });
      blocco.appendChild(titolo);
      container.appendChild(blocco);
      return;
    }

    const titolo = document.createElement('h3');
    titolo.textContent = cat.nome.toUpperCase();
    blocco.appendChild(titolo);

    const lista = document.createElement('div');
    lista.className = 'tag-lista';

    cat.tag.forEach(nodo => renderizzaNodoTag(nodo, lista, onToggle, selezionati));

    blocco.appendChild(lista);
    container.appendChild(blocco);
  });
}

// Renderizza UN nodo dell'albero tag: se è una cartella, un'intestazione
// espandibile con i figli annidati dentro (a qualsiasi profondità); se è
// una voce foglia, un bottone cliccabile normale come prima.
function renderizzaNodoTag(nodo, contenitore, onToggle, selezionati) {
  if (nodo.e_cartella) {
    const cartella = document.createElement('div');
    cartella.className = 'tag-cartella';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'tag-cartella-header';
    header.innerHTML = `<span class="chevron">▾</span> 📁 ${nodo.nome}`;

    const figli = document.createElement('div');
    figli.className = 'tag-cartella-figli';

    header.addEventListener('click', () => {
      const chiusa = figli.style.display === 'none';
      figli.style.display = chiusa ? 'flex' : 'none';
      header.querySelector('.chevron').textContent = chiusa ? '▾' : '▸';
    });

    nodo.children.forEach(figlio => renderizzaNodoTag(figlio, figli, onToggle, selezionati));

    cartella.appendChild(header);
    cartella.appendChild(figli);
    contenitore.appendChild(cartella);
    return;
  }

  const btn = document.createElement('button');
  btn.className = 'tag-btn';
  btn.textContent = nodo.nome;
  btn.dataset.tagId = nodo.id;
  if (nodo.colore) btn.style.borderColor = nodo.colore;

  btn.addEventListener('click', () => {
    if (selezionati.has(nodo.id)) { selezionati.delete(nodo.id); btn.classList.remove('selezionato'); }
    else { selezionati.add(nodo.id); btn.classList.add('selezionato'); }
    if (onToggle) onToggle();
  });

  contenitore.appendChild(btn);
}

// ============================================================
// VISTA ANALISI: import partita + tagging live con Z (inizio) / M (fine)
// ============================================================
const player = document.getElementById('player');
const videoTitle = document.getElementById('videoTitle');
const categorieContainer = document.getElementById('categorie');
const btnApri = document.getElementById('btnApri');
const btnSalvaTag = document.getElementById('btnSalvaTag');
const tempoCorrente = document.getElementById('tempoCorrente');
const catturaStato = document.getElementById('catturaStato');

let tagSelezionati = new Set();
let partitaCorrenteId = null;
let inizioCatturato = null;
let fineCatturata = null;
let squadraCasaCorrente = null;   // { id, nome }
let squadraOspiteCorrente = null; // { id, nome }
let squadraRiferimentoSelezionata = null; // sticky: resta selezionata tra un evento e l'altro
let giocatoreSelezionato = null;  // NON sticky: si azzera dopo ogni salvataggio

// --------------------------------------------------------------
// Piccolo modale con casella di testo, al posto di prompt() — Electron
// non supporta prompt() nativamente (a differenza di alert/confirm)
// --------------------------------------------------------------
function mostraPromptModal(titolo, valoreIniziale = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${titolo}</h2>
        <input type="text" id="promptModalInput" style="width:100%; background:#1c2530; border:1px solid var(--border); color:var(--text); padding:8px; border-radius:6px; box-sizing:border-box; font-size:13px;">
        <div class="modal-azioni">
          <button id="promptModalAnnulla" class="secondario">Annulla</button>
          <button id="promptModalOk" class="primario">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#promptModalInput');
    input.value = valoreIniziale;
    setTimeout(() => { input.focus(); input.select(); }, 0);

    const chiudi = (valore) => { overlay.remove(); resolve(valore); };

    overlay.querySelector('#promptModalOk').addEventListener('click', () => chiudi(input.value));
    overlay.querySelector('#promptModalAnnulla').addEventListener('click', () => chiudi(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') chiudi(input.value);
      if (e.key === 'Escape') chiudi(null);
    });
  });
}

// --------------------------------------------------------------
// PANNELLI TAG: quale set di categorie/tag è attivo in questo momento,
// sia per il tagging in Analisi sia per Gestione Tag. Resta salvato tra
// una sessione e l'altra (impostazioni_app).
// --------------------------------------------------------------
let pannelloAttivoId = null;

async function assicuraPannelloAttivo() {
  if (pannelloAttivoId != null) return pannelloAttivoId;

  const impostazioni = await window.api.leggiImpostazioniApp();
  const salvato = impostazioni.pannello_attivo_id ? Number(impostazioni.pannello_attivo_id) : null;

  const pannelli = await window.api.elencoPannelli();
  if (salvato && pannelli.some(p => p.id === salvato)) {
    pannelloAttivoId = salvato;
  } else if (pannelli.length > 0) {
    pannelloAttivoId = pannelli[0].id;
  }
  return pannelloAttivoId;
}

async function impostaPannelloAttivo(id) {
  pannelloAttivoId = id;
  await window.api.scriviImpostazioneApp({ chiave: 'pannello_attivo_id', valore: String(id) });
}

async function popolaSelettoriPannello() {
  await assicuraPannelloAttivo();
  const pannelli = await window.api.elencoPannelli();
  const opzioniHtml = pannelli.map(p => `<option value="${p.id}" ${p.id === pannelloAttivoId ? 'selected' : ''}>${p.nome}</option>`).join('');

  ['selettorePannelloAnalisi', 'selettorePannelloGestione'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = opzioniHtml;
  });
}

async function onCambiaPannello(nuovoId) {
  await impostaPannelloAttivo(Number(nuovoId));
  await popolaSelettoriPannello();
  caricaPannelloTag(categorieContainer, null, tagSelezionati);
  if (document.getElementById('view-statistiche').classList.contains('active')) {
    caricaVistaImpostazioni();
  }
}

document.getElementById('selettorePannelloAnalisi').addEventListener('change', (e) => onCambiaPannello(e.target.value));
document.getElementById('selettorePannelloGestione').addEventListener('change', (e) => onCambiaPannello(e.target.value));

document.getElementById('btnNuovoPannello').addEventListener('click', async () => {
  const nome = await mostraPromptModal('Nome del nuovo pannello (es. "Didattica", "Portieri"...)');
  if (!nome || !nome.trim()) return;
  const nuovoId = await window.api.creaPannello(nome.trim());
  await impostaPannelloAttivo(nuovoId);
  await popolaSelettoriPannello();
  caricaVistaImpostazioni();
});

document.getElementById('btnRinominaPannello').addEventListener('click', async () => {
  const pannelli = await window.api.elencoPannelli();
  const corrente = pannelli.find(p => p.id === pannelloAttivoId);
  const nuovoNome = await mostraPromptModal('Nuovo nome per questo pannello', corrente ? corrente.nome : '');
  if (!nuovoNome || !nuovoNome.trim()) return;
  await window.api.rinominaPannello({ id: pannelloAttivoId, nome: nuovoNome.trim() });
  await popolaSelettoriPannello();
});

document.getElementById('btnEliminaPannello').addEventListener('click', async () => {
  const pannelli = await window.api.elencoPannelli();
  const corrente = pannelli.find(p => p.id === pannelloAttivoId);
  if (!confirm(`Eliminare il pannello "${corrente ? corrente.nome : ''}" e TUTTE le sue categorie/tag? Gli eventi già taggati non vengono toccati, ma perdono i tag di questo pannello.`)) return;

  const esito = await window.api.eliminaPannello(pannelloAttivoId);
  if (esito.errore) { alert(esito.errore); return; }

  pannelloAttivoId = null; // forza il ricalcolo al prossimo assicuraPannelloAttivo()
  await popolaSelettoriPannello();
  caricaVistaImpostazioni();
});

caricaPannelloTag(categorieContainer, null, tagSelezionati);

player.addEventListener('timeupdate', () => {
  tempoCorrente.textContent = `${formatTime(player.currentTime)} / ${formatTime(player.duration || 0)}`;
});

// --- Nuova partita ---
const modalNP = document.getElementById('modalNuovaPartita');
const npVideoScelto = document.getElementById('npVideoScelto');
let videoSelezionatoPath = null;

btnApri.addEventListener('click', () => modalNP.classList.add('active'));
document.getElementById('npAnnulla').addEventListener('click', () => modalNP.classList.remove('active'));

document.getElementById('npSelezionaVideo').addEventListener('click', async () => {
  const filePath = await window.api.selezionaVideo();
  if (!filePath) return;
  videoSelezionatoPath = filePath;
  npVideoScelto.textContent = filePath.split('/').pop();
});

document.getElementById('npCrea').addEventListener('click', async () => {
  const casa = document.getElementById('npCasa').value.trim();
  const ospite = document.getElementById('npOspite').value.trim();
  const data = document.getElementById('npData').value;
  const stagioneLabel = document.getElementById('npStagione').value.trim();
  const competizione = document.getElementById('npCompetizione').value.trim();

  if (!casa || !ospite || !videoSelezionatoPath) {
    alert('Squadra casa, squadra ospite e video sono obbligatori.');
    return;
  }

  const squadraCasaId = await window.api.creaOTrovaSquadra(casa);
  const squadraOspiteId = await window.api.creaOTrovaSquadra(ospite);
  const stagioneId = stagioneLabel ? await window.api.creaOTrovaStagione(stagioneLabel) : null;

  const nuovaPartitaId = await window.api.creaPartita({
    squadra_casa_id: squadraCasaId, squadra_ospite_id: squadraOspiteId,
    data: data || null, stagione_id: stagioneId, competizione: competizione || null,
    video_path: videoSelezionatoPath
  });

  modalNP.classList.remove('active');

  apriPartitaInAnalisi({
    id: nuovaPartitaId,
    video_path: videoSelezionatoPath,
    squadra_casa_id: squadraCasaId, squadra_casa: casa,
    squadra_ospite_id: squadraOspiteId, squadra_ospite: ospite,
    n_eventi: 0
  });
});

// Apre una partita (nuova o già esistente) nel player di Analisi: video,
// squadre di riferimento, e indicatore eventi già salvati
async function apriPartitaInAnalisi(p) {
  partitaCorrenteId = p.id;
  player.src = `file://${p.video_path}`;
  videoTitle.textContent = `${p.squadra_casa} - ${p.squadra_ospite}`;

  squadraCasaCorrente = { id: p.squadra_casa_id, nome: p.squadra_casa };
  squadraOspiteCorrente = { id: p.squadra_ospite_id, nome: p.squadra_ospite };
  squadraRiferimentoSelezionata = null;
  giocatoreSelezionato = null;
  renderizzaSquadreRiferimento();

  inizioCatturato = null;
  fineCatturata = null;
  aggiornaStatoCattura();

  const nota = document.getElementById('eventiSalvatiNota');
  if (p.n_eventi > 0) {
    nota.style.display = 'block';
    nota.innerHTML = `📌 ${p.n_eventi} eventi già salvati per questa partita — <a id="linkVediEventiAnalisi">vedili in Eventi</a>`;
    document.getElementById('linkVediEventiAnalisi').addEventListener('click', () => {
      document.querySelector('nav button[data-view="eventi"]').click();
      apriPartitaInEventi(p.id, `${p.squadra_casa} - ${p.squadra_ospite}`, null, p.squadra_casa, p.squadra_ospite);
    });
  } else {
    nota.style.display = 'none';
  }
}

// --- Apri partita esistente ---
const modalApriPartita = document.getElementById('modalApriPartita');

document.getElementById('btnApriEsistente').addEventListener('click', async () => {
  const partite = await window.api.elencoPartiteConConteggi();
  const cont = document.getElementById('elencoApriPartita');
  cont.innerHTML = '';

  if (partite.length === 0) {
    cont.innerHTML = '<p style="color:var(--muted); font-size:13px;">Nessuna partita ancora creata.</p>';
  }

  partite.forEach(p => {
    const riga = document.createElement('div');
    riga.className = 'apri-partita-riga';
    riga.innerHTML = `<span>${p.squadra_casa} - ${p.squadra_ospite}</span><span class="conteggio">${p.n_eventi} eventi</span>`;
    riga.addEventListener('click', () => {
      apriPartitaInAnalisi(p);
      modalApriPartita.classList.remove('active');
    });
    cont.appendChild(riga);
  });

  modalApriPartita.classList.add('active');
});

document.getElementById('apriPartitaAnnulla').addEventListener('click', () => modalApriPartita.classList.remove('active'));

// --- Riferimento squadra (sticky) + rosa selezionabile (non sticky) ---
const riferimentoSquadraEl = document.getElementById('riferimentoSquadra');
const squadraButtonsEl = document.getElementById('squadraButtons');
const giocatoreButtonsEl = document.getElementById('giocatoreButtons');

function renderizzaSquadreRiferimento() {
  riferimentoSquadraEl.style.display = 'block';
  squadraButtonsEl.innerHTML = '';

  [squadraCasaCorrente, squadraOspiteCorrente].forEach(sq => {
    const btn = document.createElement('button');
    btn.className = 'squadra-btn';
    btn.textContent = sq.nome;
    if (squadraRiferimentoSelezionata && squadraRiferimentoSelezionata.id === sq.id) btn.classList.add('selezionato');
    btn.addEventListener('click', () => selezionaSquadraRiferimento(sq, btn));
    squadraButtonsEl.appendChild(btn);
  });

  if (squadraRiferimentoSelezionata) caricaRosaGiocatoreButtons(squadraRiferimentoSelezionata.id);
  else giocatoreButtonsEl.innerHTML = '';
}

async function selezionaSquadraRiferimento(sq, btnEl) {
  squadraRiferimentoSelezionata = sq;
  giocatoreSelezionato = null;
  document.querySelectorAll('.squadra-btn').forEach(b => b.classList.remove('selezionato'));
  btnEl.classList.add('selezionato');
  await caricaRosaGiocatoreButtons(sq.id);
}

async function caricaRosaGiocatoreButtons(squadraId) {
  const giocatori = await window.api.elencoGiocatoriPerSquadra(squadraId);
  giocatoreButtonsEl.innerHTML = '';

  giocatori.forEach(g => {
    const btn = document.createElement('button');
    btn.className = 'giocatore-btn';
    btn.textContent = `${g.numero ? g.numero + ' · ' : ''}${g.nome} ${g.cognome || ''}`.trim();
    btn.addEventListener('click', () => {
      const eraSelezionato = giocatoreSelezionato === g.id;
      document.querySelectorAll('.giocatore-btn').forEach(b => b.classList.remove('selezionato'));
      giocatoreSelezionato = eraSelezionato ? null : g.id;
      if (!eraSelezionato) btn.classList.add('selezionato');
    });
    giocatoreButtonsEl.appendChild(btn);
  });
}

// --- Cattura Z (inizio) / M (fine) ---
function aggiornaStatoCattura() {
  if (inizioCatturato === null) {
    catturaStato.textContent = "Premi N per segnare l'inizio di un evento, M per la fine.";
    catturaStato.classList.remove('attiva');
    btnSalvaTag.disabled = true;
  } else if (fineCatturata === null) {
    catturaStato.textContent = `Evento iniziato a ${formatTime(inizioCatturato)} — premi M per chiudere.`;
    catturaStato.classList.add('attiva');
    btnSalvaTag.disabled = true;
  } else {
    catturaStato.textContent = `Evento ${formatTime(inizioCatturato)} → ${formatTime(fineCatturata)}: scegli i tag e salva.`;
    catturaStato.classList.add('attiva');
    btnSalvaTag.disabled = false;
  }
}

// Fase di CATTURA (terzo parametro true): intercetta N/M prima che il player
// video nativo li gestisca lui stesso (es. M = muto, un tasto riservato dai
// controlli HTML5 quando il video ha il focus).
window.addEventListener('keydown', (e) => {
  if (e.key !== 'n' && e.key !== 'N' && e.key !== 'm' && e.key !== 'M') return;
  if (e.repeat) return; // ignora l'auto-repeat se il tasto resta premuto
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (!document.getElementById('view-analisi').classList.contains('active')) return;
  if (!partitaCorrenteId) return;

  e.preventDefault();
  e.stopImmediatePropagation(); // nessun altro listener può intercettare/rallentare questo tasto

  if (e.key === 'n' || e.key === 'N') {
    inizioCatturato = player.currentTime;
    fineCatturata = null;
    aggiornaStatoCattura();
  }
  if (e.key === 'm' || e.key === 'M') {
    if (inizioCatturato === null) return;
    fineCatturata = Math.max(player.currentTime, inizioCatturato + 0.2);
    player.pause(); // tempo per taggare con calma
    aggiornaStatoCattura();
  }
}, true);

// Frecce ← → = avanti/indietro di 5 secondi, durante l'analisi della gara
window.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (!document.getElementById('view-analisi').classList.contains('active')) return;
  if (!partitaCorrenteId) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  const delta = e.key === 'ArrowRight' ? 5 : -5;
  player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + delta));
}, true);

btnSalvaTag.addEventListener('click', async () => {
  if (inizioCatturato === null || fineCatturata === null) return;

  const campoNota = document.getElementById('notaEvento');

  await window.api.creaEvento({
    partita_id: partitaCorrenteId,
    inizio_sec: inizioCatturato,
    fine_sec: fineCatturata,
    squadra_riferimento_id: squadraRiferimentoSelezionata ? squadraRiferimentoSelezionata.id : null,
    giocatore_id: giocatoreSelezionato,
    note: campoNota.value.trim() || null,
    tagIds: Array.from(tagSelezionati)
  });

  tagSelezionati.clear();
  document.querySelectorAll('#categorie .tag-btn.selezionato').forEach(b => b.classList.remove('selezionato'));
  campoNota.value = ''; // la nota NON è sticky: si azzera ad ogni evento salvato, come i tag

  // il giocatore NON è sticky: si azzera. La squadra di riferimento invece resta
  // selezionata (sticky) per l'evento successivo, come richiesto.
  giocatoreSelezionato = null;
  document.querySelectorAll('.giocatore-btn.selezionato').forEach(b => b.classList.remove('selezionato'));

  inizioCatturato = null;
  fineCatturata = null;
  aggiornaStatoCattura();
  document.getElementById('statoSalvataggio').textContent = 'Evento salvato';
});

aggiornaStatoCattura();

// ============================================================
// SWITCH VISTE
// ============================================================
document.querySelectorAll('nav button[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');

    if (btn.dataset.view === 'partite') caricaArchivio();
    if (btn.dataset.view === 'eventi') caricaVistaEventi();
    if (btn.dataset.view === 'presentazioni') caricaVistaPresentazioni();
    if (btn.dataset.view === 'giocatori') caricaVistaGiocatori();
    if (btn.dataset.view === 'statistiche') caricaVistaImpostazioni(); // ora ospita Gestione Tag
    if (btn.dataset.view === 'impostazioni') caricaVistaImpostazioniApp();
    if (btn.dataset.view === 'analisi') caricaPannelloTag(categorieContainer, null, tagSelezionati); // rispecchia eventuali modifiche fatte in Statistiche
  });
});

// ============================================================
// VISTA PARTITE (archivio con filtri)
// ============================================================
const selStagione = document.getElementById('filtroStagione');
const selSquadra = document.getElementById('filtroSquadra');
const selCompetizione = document.getElementById('filtroCompetizione');
const selAvversario = document.getElementById('filtroAvversario');
const inputRicerca = document.getElementById('filtroRicerca');

let opzioniFiltriCaricate = false;

async function caricaArchivio() {
  if (!opzioniFiltriCaricate) {
    const opzioni = await window.api.opzioniFiltriArchivio();
    opzioni.stagioni.forEach(s => selStagione.add(new Option(s.label, s.id)));
    opzioni.squadre.forEach(s => { selSquadra.add(new Option(s.nome, s.id)); selAvversario.add(new Option(s.nome, s.id)); });
    opzioni.competizioni.forEach(c => selCompetizione.add(new Option(c, c)));
    [selStagione, selSquadra, selCompetizione, selAvversario].forEach(sel => sel.addEventListener('change', eseguiRicercaArchivio));
    inputRicerca.addEventListener('input', debounce(eseguiRicercaArchivio, 300));
    opzioniFiltriCaricate = true;
  }
  eseguiRicercaArchivio();
}

async function eseguiRicercaArchivio() {
  const { partite, totali } = await window.api.elencoPartite({
    stagione_id: selStagione.value || null,
    squadra_id: selSquadra.value || null,
    competizione: selCompetizione.value || null,
    avversario_id: selAvversario.value || null,
    ricerca: inputRicerca.value || null
  });

  document.getElementById('archivioTotali').innerHTML = `
    <span><b>${totali.partite}</b>partite</span>
    <span><b>${totali.eventi}</b>eventi</span>
    <span><b>${totali.tiri}</b>tiri</span>
    <span><b>${totali.gol}</b>gol</span>
  `;

  const lista = document.getElementById('archivioLista');
  lista.innerHTML = '';
  partite.forEach(p => {
    const riga = document.createElement('div');
    riga.className = 'partita-riga';
    riga.innerHTML = `
      <span>${p.squadra_casa} - ${p.squadra_ospite}</span>
      <span class="n-eventi">${p.n_eventi} eventi · seleziona →</span>
      <button class="elimina-partita" title="Elimina partita">✕</button>
    `;
    riga.querySelector('.elimina-partita').addEventListener('click', async (e) => {
      e.stopPropagation();
      const conferma = confirm(
        `Eliminare la partita "${p.squadra_casa} - ${p.squadra_ospite}"?\n\n` +
        `Vengono eliminati anche i suoi ${p.n_eventi} eventi, i tag su quegli eventi, ed eventuali clip che li usano in una presentazione. ` +
        `Il file video sul disco NON viene toccato.`
      );
      if (!conferma) return;
      await window.api.eliminaPartita(p.id);
      eseguiRicercaArchivio();
    });
    riga.addEventListener('click', () => {
      document.querySelector('nav button[data-view="eventi"]').click();
      apriPartitaInEventi(p.id, `${p.squadra_casa} - ${p.squadra_ospite}`, null, p.squadra_casa, p.squadra_ospite);
    });
    lista.appendChild(riga);
  });
}

// ============================================================
// VISTA EVENTI: partite -> eventi -> seleziona -> importa in presentazione
// ============================================================
const eventiElencoPartite = document.getElementById('eventiElencoPartite');
const eventiPartitaTitolo = document.getElementById('eventiPartitaTitolo');
const eventiTabella = document.getElementById('eventiTabella');
const btnImportaPresentazione = document.getElementById('btnImportaPresentazione');

let partiteCaricateInEventi = false;
let partitaApertaInEventiId = null;
let eventiPartitaCorrente = [];
let eventiSelezionati = new Set(); // cumulativa: resta valida anche cambiando partita
let ordinaPerCategorieIds = []; // in ordine di click: [primario, secondario, ...]
let categorieDisponibiliEventi = [];

function aggiornaContatoreSelezione() {
  const contatore = document.getElementById('contatoreSelezioneEventi');
  const n = eventiSelezionati.size;
  if (n > 0) {
    contatore.style.display = 'inline';
    contatore.textContent = `${n} evento${n > 1 ? 'i' : ''} selezionat${n > 1 ? 'i' : 'o'} (anche da altre partite)`;
  } else {
    contatore.style.display = 'none';
  }
  btnImportaPresentazione.disabled = n === 0;

  // lo spostamento manuale del gruppo ha senso solo sull'ordine "naturale":
  // con un ordinamento per categoria o un filtro squadra attivi, la lista
  // mostrata non rispecchia l'ordine reale, spostare "su/giù" confonderebbe più che aiutare
  const selezionatiInQuestaPartita = eventiPartitaCorrente
    ? eventiPartitaCorrente.filter(ev => eventiSelezionati.has(ev.id)).length
    : 0;
  const spostamentoDisponibile = selezionatiInQuestaPartita > 0 && ordinaPerCategorieIds.length === 0 && !filtroSquadraEventi;
  document.getElementById('btnSpostaGruppoSu').disabled = !spostamentoDisponibile;
  document.getElementById('btnSpostaGruppoGiu').disabled = !spostamentoDisponibile;
}

// Calcola il nuovo ordine spostando in blocco gli elementi selezionati di una
// posizione su/giù, senza scomporre gruppi non contigui (stesso comportamento
// di "sposta righe selezionate" nei fogli di calcolo)
function calcolaSpostamentoGruppo(elencoIds, selezionatiSet, direzione) {
  const arr = [...elencoIds];
  if (direzione === 'su') {
    for (let i = 1; i < arr.length; i++) {
      if (selezionatiSet.has(arr[i]) && !selezionatiSet.has(arr[i - 1])) {
        [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
      }
    }
  } else {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (selezionatiSet.has(arr[i]) && !selezionatiSet.has(arr[i + 1])) {
        [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      }
    }
  }
  return arr;
}

async function spostaGruppoSelezionato(direzione) {
  const idsPartitaCorrente = eventiPartitaCorrente.map(ev => ev.id);
  const selezionatiInQuestaPartita = new Set(idsPartitaCorrente.filter(id => eventiSelezionati.has(id)));
  if (selezionatiInQuestaPartita.size === 0) return;

  const nuovoOrdine = calcolaSpostamentoGruppo(idsPartitaCorrente, selezionatiInQuestaPartita, direzione);
  await window.api.riordinaGruppoEventi(nuovoOrdine);
  eventiPartitaCorrente = await window.api.elencoEventiPerPartita(partitaApertaInEventiId);
  renderizzaTabellaEventi();
}

document.getElementById('btnSpostaGruppoSu').addEventListener('click', () => spostaGruppoSelezionato('su'));
document.getElementById('btnSpostaGruppoGiu').addEventListener('click', () => spostaGruppoSelezionato('giu'));

async function caricaVistaEventi() {
  if (!partiteCaricateInEventi) {
    const partite = await window.api.elencoPartiteConConteggi();
    eventiElencoPartite.innerHTML = '';
    partite.forEach(p => {
      const riga = document.createElement('div');
      riga.className = 'eventi-partita-riga';
      riga.innerHTML = `${p.squadra_casa} - ${p.squadra_ospite}<span class="conteggio">${p.n_eventi} eventi</span>`;
      riga.addEventListener('click', () => apriPartitaInEventi(p.id, `${p.squadra_casa} - ${p.squadra_ospite}`, riga, p.squadra_casa, p.squadra_ospite));
      eventiElencoPartite.appendChild(riga);
    });
    categorieDisponibiliEventi = await window.api.elencoCategorie();
    renderizzaOrdinaCategorie();
    partiteCaricateInEventi = true;
  }
}

function renderizzaOrdinaCategorie() {
  const cont = document.getElementById('eventiOrdinaCategorie');
  cont.innerHTML = '';

  categorieDisponibiliEventi.forEach(cat => {
    const btn = document.createElement('button');
    const posizione = ordinaPerCategorieIds.indexOf(cat.id);
    btn.className = 'gruppo-btn gruppo-' + (cat.gruppo || 'generale') + (posizione !== -1 ? ' selezionato' : '');
    btn.textContent = posizione !== -1 ? `${cat.nome} ${posizione + 1}°` : cat.nome;

    btn.addEventListener('click', (e) => {
      const giaPresente = ordinaPerCategorieIds.includes(cat.id);

      if (e.shiftKey) {
        // shift: aggiunge o toglie un criterio di ordinamento secondario, senza toccare gli altri
        if (giaPresente) ordinaPerCategorieIds = ordinaPerCategorieIds.filter(id => id !== cat.id);
        else ordinaPerCategorieIds.push(cat.id);
      } else {
        // click semplice: diventa l'UNICO criterio (o si spegne se era già l'unico)
        ordinaPerCategorieIds = (giaPresente && ordinaPerCategorieIds.length === 1) ? [] : [cat.id];
      }

      renderizzaOrdinaCategorie();
      renderizzaTabellaEventi();
      aggiornaContatoreSelezione();
    });

    cont.appendChild(btn);
  });

  aggiornaStatoOrdinamento('eventiStatoOrdinamento', ordinaPerCategorieIds, categorieDisponibiliEventi);
}

// Riga di stato leggibile ("Ordinamento: Fase (1°) → Gesto tecnico (2°)"),
// così è sempre chiaro cosa è attivo senza dover indovinare dai bottoni
function aggiornaStatoOrdinamento(elementoId, categorieIds, categorieDisponibili) {
  const el = document.getElementById(elementoId);
  if (!el) return;
  if (categorieIds.length === 0) {
    el.textContent = 'Nessun ordinamento per tag attivo — ordine manuale.';
    el.classList.remove('attivo');
    return;
  }
  const nomi = categorieIds.map((id, i) => {
    const cat = categorieDisponibili.find(c => c.id === id);
    return `${cat ? cat.nome : '?'} (${i + 1}°)`;
  });
  el.textContent = `Ordinamento attivo: ${nomi.join(' → ')}`;
  el.classList.add('attivo');
}

let filtroSquadraEventi = '';

async function apriPartitaInEventi(partitaId, titolo, rigaEl, squadraCasa, squadraOspite) {
  document.querySelectorAll('.eventi-partita-riga').forEach(r => r.classList.remove('attiva'));
  if (rigaEl) rigaEl.classList.add('attiva');

  partitaApertaInEventiId = partitaId;
  eventiPartitaTitolo.textContent = titolo;
  // NON azzero eventiSelezionati qui: la selezione resta valida anche
  // cambiando partita, così puoi scegliere eventi da più gare diverse
  // prima di importarli tutti insieme in una presentazione
  filtroSquadraEventi = '';

  renderizzaFiltroSquadraEventi(squadraCasa, squadraOspite);

  eventiPartitaCorrente = await window.api.elencoEventiPerPartita(partitaId);
  renderizzaTabellaEventi();
  aggiornaContatoreSelezione();
}

function renderizzaFiltroSquadraEventi(squadraCasa, squadraOspite) {
  const cont = document.getElementById('eventiFiltroSquadra');
  cont.innerHTML = '';
  if (!squadraCasa && !squadraOspite) return;

  const opzioni = [{ nome: '', label: 'Tutte le squadre' }, { nome: squadraCasa, label: squadraCasa }, { nome: squadraOspite, label: squadraOspite }];
  opzioni.forEach(o => {
    const btn = document.createElement('button');
    btn.className = 'gruppo-btn' + (o.nome === '' ? ' selezionato' : '');
    btn.textContent = o.label;
    btn.addEventListener('click', () => {
      cont.querySelectorAll('.gruppo-btn').forEach(b => b.classList.remove('selezionato'));
      btn.classList.add('selezionato');
      filtroSquadraEventi = o.nome;
      renderizzaTabellaEventi();
      aggiornaContatoreSelezione();
    });
    cont.appendChild(btn);
  });
}

// Ordina per una o più categorie (in priorità di click): per ogni evento,
// usa la posizione (ordine) del tag che ha in quella categoria; chi non ha
// nessun tag in quella categoria scivola in fondo. A parità totale, resta
// l'ordine manuale originale (il sort di JS è stabile).
function ordinaEventiPerCategorie(eventi, categorieIds) {
  if (categorieIds.length === 0) return eventi;
  return [...eventi].sort((a, b) => {
    for (const catId of categorieIds) {
      const tagA = a.tag.find(t => t.categoria_id === catId);
      const tagB = b.tag.find(t => t.categoria_id === catId);
      const ordA = tagA ? tagA.tag_ordine : Infinity;
      const ordB = tagB ? tagB.tag_ordine : Infinity;
      if (ordA !== ordB) return ordA - ordB;
    }
    return 0;
  });
}

let eventiVisibiliCorrente = []; // lista filtrata/ordinata attualmente mostrata, usata da "Seleziona tutti"

function renderizzaTabellaEventi() {
  const totalePartita = eventiPartitaCorrente.length;
  let filtrati = eventiPartitaCorrente;
  if (filtroSquadraEventi) {
    filtrati = filtrati.filter(ev => ev.squadra_riferimento_nome === filtroSquadraEventi);
  }
  filtrati = ordinaEventiPerCategorie(filtrati, ordinaPerCategorieIds);
  eventiVisibiliCorrente = filtrati;

  const avviso = document.getElementById('eventiAvvisoFiltro');
  if (filtroSquadraEventi && filtrati.length < totalePartita) {
    const nascosti = totalePartita - filtrati.length;
    avviso.style.display = 'block';
    avviso.textContent = `⚠️ Il filtro "${filtroSquadraEventi}" nasconde ${nascosti} evento${nascosti > 1 ? 'i' : ''} di questa partita (probabilmente senza squadra assegnata durante il tagging) — clicca "Tutte le squadre" per vederli tutti.`;
  } else {
    avviso.style.display = 'none';
  }

  eventiTabella.innerHTML = '';
  filtrati.forEach((ev, i) => {
    const riga = document.createElement('div');
    riga.className = 'eventi-riga';
    const badge = ev.tag.map(t => `<span class="tag-badge">${t.nome}</span>`).join('');
    const chiSquadra = ev.squadra_riferimento_nome ? `<span class="tag-badge">${ev.squadra_riferimento_nome}</span>` : '';
    const chiGiocatore = ev.giocatore_nome ? `<span class="tag-badge">${ev.giocatore_nome} ${ev.giocatore_cognome || ''}</span>` : '';

    riga.innerHTML = `
      <span class="ordina-gruppo">
        <button class="ordina-btn ordina-su" ${i === 0 ? 'disabled' : ''} title="Sposta su">▲</button>
        <button class="ordina-btn ordina-giu" ${i === filtrati.length - 1 ? 'disabled' : ''} title="Sposta giù">▼</button>
      </span>
      <input type="checkbox" data-evento-id="${ev.id}" ${eventiSelezionati.has(ev.id) ? 'checked' : ''}>
      <span class="tempo">${formatTime(ev.inizio_sec)}-${formatTime(ev.fine_sec)}</span>
      <span>${chiSquadra}${chiGiocatore}${badge}</span>
      <button class="nota-btn ${ev.note ? 'ha-nota' : ''}" title="${ev.note ? ev.note.replace(/"/g, '&quot;') : 'Aggiungi nota'}">📝</button>
    `;
    riga.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) eventiSelezionati.add(ev.id); else eventiSelezionati.delete(ev.id);
      aggiornaContatoreSelezione();
    });
    riga.querySelector('.nota-btn').addEventListener('click', async () => {
      const nuovaNota = await mostraPromptModal('Nota per questo evento', ev.note || '');
      if (nuovaNota === null) return; // annullato
      await window.api.aggiornaNotaEvento({ eventoId: ev.id, note: nuovaNota.trim() || null });
      eventiPartitaCorrente = await window.api.elencoEventiPerPartita(partitaApertaInEventiId);
      renderizzaTabellaEventi();
    });

    riga.querySelector('.ordina-su').addEventListener('click', async () => {
      if (i === 0) return;
      await window.api.scambiaOrdineEventi({ eventoIdA: ev.id, eventoIdB: filtrati[i - 1].id });
      eventiPartitaCorrente = await window.api.elencoEventiPerPartita(partitaApertaInEventiId);
      renderizzaTabellaEventi();
    });
    riga.querySelector('.ordina-giu').addEventListener('click', async () => {
      if (i === filtrati.length - 1) return;
      await window.api.scambiaOrdineEventi({ eventoIdA: ev.id, eventoIdB: filtrati[i + 1].id });
      eventiPartitaCorrente = await window.api.elencoEventiPerPartita(partitaApertaInEventiId);
      renderizzaTabellaEventi();
    });

    eventiTabella.appendChild(riga);
  });
}

// --- Importa in presentazione (riusabile: vista Eventi + pannello Giocatore) ---
const modalImp = document.getElementById('modalImportaPresentazione');
const impPresentazioneEsistente = document.getElementById('impPresentazioneEsistente');
const impNuovaPresentazione = document.getElementById('impNuovaPresentazione');

let sorgenteImportCorrente = null; // { eventiSet, dopoImport() }

function apriModaleImporta(sorgente) {
  sorgenteImportCorrente = sorgente;
  window.api.elencoPresentazioni().then(presentazioni => {
    impPresentazioneEsistente.innerHTML = '<option value="">— nessuna —</option>';
    presentazioni.forEach(p => impPresentazioneEsistente.add(new Option(p.nome, p.id)));
    impNuovaPresentazione.value = '';
    modalImp.classList.add('active');
  });
}

document.getElementById('btnSelezionaTuttiEventi').addEventListener('click', () => {
  eventiVisibiliCorrente.forEach(ev => eventiSelezionati.add(ev.id));
  aggiornaContatoreSelezione();
  renderizzaTabellaEventi();
});

document.getElementById('btnDeselezionaTuttiEventi').addEventListener('click', () => {
  eventiVisibiliCorrente.forEach(ev => eventiSelezionati.delete(ev.id));
  aggiornaContatoreSelezione();
  renderizzaTabellaEventi();
});

btnImportaPresentazione.addEventListener('click', () => {
  apriModaleImporta({
    eventiSet: eventiSelezionati,
    dopoImport: () => { aggiornaContatoreSelezione(); renderizzaTabellaEventi(); }
  });
});

document.getElementById('impAnnulla').addEventListener('click', () => modalImp.classList.remove('active'));

document.getElementById('impConferma').addEventListener('click', async () => {
  if (!sorgenteImportCorrente) return;
  const presentazioneId = impPresentazioneEsistente.value || null;
  const nomeNuova = impNuovaPresentazione.value.trim();

  if (!presentazioneId && !nomeNuova) { alert('Scegli una presentazione esistente o dai un nome a quella nuova.'); return; }

  const { eventiSet, dopoImport } = sorgenteImportCorrente;

  await window.api.aggiungiEventiAPresentazione({
    presentazioneId: presentazioneId ? Number(presentazioneId) : null,
    nomeNuovaPresentazione: nomeNuova || null,
    eventoIds: Array.from(eventiSet)
  });

  modalImp.classList.remove('active');
  document.getElementById('statoSalvataggio').textContent = `${eventiSet.size} eventi importati in presentazione`;
  eventiSet.clear();
  if (dopoImport) dopoImport();
});

// ============================================================
// VISTA PRESENTAZIONI: editor durata + disegni + export
// ============================================================
const elencoPresentazioniEl = document.getElementById('elencoPresentazioni');
const presentazioneTitolo = document.getElementById('presentazioneTitolo');
const presentazioneClipLista = document.getElementById('presentazioneClipLista');
const presentazioneVideo = document.getElementById('presentazioneVideo');
const trimInizio = document.getElementById('trimInizio');
const trimFine = document.getElementById('trimFine');

let presentazioneApertaId = null;
let clipPresentazioneCorrente = [];
let clipSelezionataId = null;

async function caricaVistaPresentazioni() {
  // rete di sicurezza: ricalcola le dimensioni del canvas ora che il riquadro
  // è visibile e il video ha la sua dimensione CSS definitiva
  window.dispatchEvent(new Event('resize'));

  const presentazioni = await window.api.elencoPresentazioni();
  elencoPresentazioniEl.innerHTML = '';
  presentazioni.forEach(p => {
    const riga = document.createElement('div');
    riga.className = 'playlist-riga';
    riga.innerHTML = `
      <span class="playlist-riga-nome">${p.nome}</span>
      <button class="playlist-riga-elimina" title="Elimina presentazione">🗑</button>
    `;
    riga.querySelector('.playlist-riga-nome').addEventListener('click', () => apriPresentazione(p.id, p.nome, riga));
    riga.querySelector('.playlist-riga-elimina').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Eliminare la presentazione "${p.nome}"? Gli eventi originali e le partite non vengono toccati, solo questa raccolta.`)) return;
      await window.api.eliminaPresentazione(p.id);
      if (presentazioneApertaId === p.id) {
        presentazioneApertaId = null;
        clipPresentazioneCorrente = [];
        presentazioneTitolo.textContent = 'Nessuna presentazione aperta';
        presentazioneVideo.removeAttribute('src');
        presentazioneClipLista.innerHTML = '';
        Disegno.caricaForme(null);
      }
      caricaVistaPresentazioni();
    });
    elencoPresentazioniEl.appendChild(riga);
  });
}

async function apriPresentazione(id, nome, rigaEl) {
  document.querySelectorAll('#elencoPresentazioni .playlist-riga').forEach(r => r.classList.remove('attiva'));
  if (rigaEl) rigaEl.classList.add('attiva');

  presentazioneApertaId = id;
  presentazioneTitolo.textContent = nome;
  clipPresentazioneCorrente = await window.api.clipPresentazione(id);
  renderizzaListaClipPresentazione();
  if (clipPresentazioneCorrente.length > 0) apriClipPresentazione(clipPresentazioneCorrente[0]);
}

function renderizzaListaClipPresentazione() {
  presentazioneClipLista.innerHTML = '';
  clipPresentazioneCorrente.forEach((c, i) => {
    const riga = document.createElement('div');
    riga.className = 'pres-clip-riga';
    if (c.id === clipSelezionataId) riga.classList.add('attiva');

    if (c.tipo === 'schermata') {
      riga.classList.add('riga-schermata');
      const anteprimaTesto = (c.schermata_testo || '').split('\n')[0].slice(0, 28) || '(schermata vuota)';
      riga.innerHTML = `<span class="schermata-pallino" style="background:${c.schermata_sfondo || '#0d1117'};"></span> ${i + 1}. 📄 ${anteprimaTesto}`;
    } else {
      riga.textContent = `${i + 1}. ${c.squadra_casa} - ${c.squadra_ospite}`;
    }

    riga.addEventListener('click', () => apriClipPresentazione(c, riga));
    presentazioneClipLista.appendChild(riga);
  });
}

let ultimoPausaSec = null; // momento in cui il coach ha messo in pausa per disegnare, per il momento ATTIVO
let pausaProgrammataDaCodice = false; // true quando siamo NOI a mettere in pausa (anteprima automatica), non l'utente
let momentiClipCorrente = []; // tutti i momenti di pausa/disegno salvati per la clip aperta
let momentoAttivoId = null; // id del momento attualmente caricato nel canvas (null = nuovo, non ancora salvato)
let momentiPassatiInPreview = new Set(); // id dei momenti già "attivati" durante la riproduzione corrente

async function apriClipPresentazione(c) {
  document.querySelectorAll('.pres-clip-riga').forEach(r => r.classList.remove('attiva'));
  clipSelezionataId = c.id;
  renderizzaListaClipPresentazione();

  if (c.tipo === 'schermata') {
    document.getElementById('editorClipVideo').style.display = 'none';
    document.getElementById('editorSchermata').style.display = 'block';
    presentazioneVideo.pause();
    apriSchermataPresentazione(c);
    return;
  }

  document.getElementById('editorSchermata').style.display = 'none';
  document.getElementById('editorClipVideo').style.display = 'block';

  const inizio = c.inizio_sec ?? c.evento_inizio_sec;
  const fine = c.fine_sec ?? c.evento_fine_sec;

  // fermo il video PRIMA di cambiare sorgente: se era rimasto "in riproduzione"
  // da prima (es. dopo Salva clip), altrimenti riparte da solo appena pronto
  // e cancella subito i disegni appena caricati
  presentazioneVideo.pause();
  presentazioneVideo.src = `file://${c.video_path}`;
  presentazioneVideo.addEventListener('loadedmetadata', function alSeek() {
    presentazioneVideo.pause();
    presentazioneVideo.currentTime = inizio;
    presentazioneVideo.removeEventListener('loadedmetadata', alSeek);
  });

  trimInizio.value = inizio.toFixed(1);
  trimFine.value = fine.toFixed(1);

  // parto sempre con nessuno strumento attivo: i controlli video restano usabili subito
  document.querySelectorAll('.disegno-tool').forEach(b => b.classList.remove('selezionato'));
  Disegno.impostaStrumento(null);

  momentiClipCorrente = await window.api.elencoMomentiClip(c.id);
  momentiPassatiInPreview = new Set();
  if (momentiClipCorrente.length > 0) {
    caricaMomento(momentiClipCorrente[0]);
  } else {
    momentoAttivoId = null;
    ultimoPausaSec = null;
    Disegno.caricaForme(null);
    document.getElementById('pausaDurata').value = 3;
    aggiornaStatoPausa();
  }
  renderizzaChipMomenti();

  const muto = !!c.audio_muto;
  const volume = c.audio_volume ?? 1;
  document.getElementById('clipAudioMuto').checked = muto;
  document.getElementById('clipAudioVolume').value = volume;
  document.getElementById('clipAudioVolume').disabled = muto;
  document.getElementById('clipAudioVolumeEtichetta').textContent = `${Math.round(volume * 100)}%`;
  presentazioneVideo.muted = muto;
  presentazioneVideo.volume = Math.min(1, volume); // il player nativo non amplifica oltre l'originale, solo l'export lo fa davvero

  const velocita = c.velocita ?? 1;
  document.getElementById('clipVelocita').value = velocita;
  document.getElementById('clipVelocitaEtichetta').textContent = `${Math.round(velocita * 100)}%`;
  presentazioneVideo.playbackRate = velocita; // così l'anteprima mostra già l'effetto rallentatore/accelerato
}

document.getElementById('clipAudioMuto').addEventListener('change', (e) => {
  presentazioneVideo.muted = e.target.checked;
  document.getElementById('clipAudioVolume').disabled = e.target.checked;
});
document.getElementById('clipAudioVolume').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  presentazioneVideo.volume = Math.min(1, v);
  document.getElementById('clipAudioVolumeEtichetta').textContent = `${Math.round(v * 100)}%`;
});
document.getElementById('clipVelocita').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  presentazioneVideo.playbackRate = v;
  document.getElementById('clipVelocitaEtichetta').textContent = `${Math.round(v * 100)}%`;
});

// Mostra e prepara l'editor di una schermata (sfondo + testo, niente video)
function apriSchermataPresentazione(c) {
  const sfondoInput = document.getElementById('schermataEditSfondo');
  const coloreInput = document.getElementById('schermataEditColoreTesto');
  const testoInput = document.getElementById('schermataEditTesto');
  const durataInput = document.getElementById('schermataEditDurata');

  sfondoInput.value = c.schermata_sfondo || '#0d1117';
  coloreInput.value = c.schermata_colore_testo || '#ffffff';
  testoInput.value = c.schermata_testo || '';
  durataInput.value = c.schermata_durata_sec || 4;

  aggiornaAnteprimaSchermata();
}

function aggiornaAnteprimaSchermata() {
  const sfondo = document.getElementById('schermataEditSfondo').value;
  const colore = document.getElementById('schermataEditColoreTesto').value;
  const testo = document.getElementById('schermataEditTesto').value;

  document.getElementById('schermataPreviewSfondo').style.background = sfondo;
  const anteprimaTesto = document.getElementById('schermataPreviewTesto');
  anteprimaTesto.style.color = colore;
  anteprimaTesto.textContent = testo;
}

['schermataEditSfondo', 'schermataEditColoreTesto', 'schermataEditTesto'].forEach(id => {
  document.getElementById(id).addEventListener('input', aggiornaAnteprimaSchermata);
});

document.getElementById('btnSalvaSchermata').addEventListener('click', async () => {
  if (!clipSelezionataId) return;
  await window.api.aggiornaSchermata({
    id: clipSelezionataId,
    sfondo: document.getElementById('schermataEditSfondo').value,
    testo: document.getElementById('schermataEditTesto').value,
    coloreTesto: document.getElementById('schermataEditColoreTesto').value,
    durataSec: Number(document.getElementById('schermataEditDurata').value) || 4
  });
  clipPresentazioneCorrente = await window.api.clipPresentazione(presentazioneApertaId);
  renderizzaListaClipPresentazione();
  document.getElementById('statoSalvataggio').textContent = 'Schermata salvata';
});

document.getElementById('btnRimuoviSchermata').addEventListener('click', async () => {
  if (!clipSelezionataId) return;
  if (!confirm('Rimuovere questa schermata dalla presentazione?')) return;
  await window.api.rimuoviClipPresentazione(clipSelezionataId);
  clipSelezionataId = null;
  clipPresentazioneCorrente = await window.api.clipPresentazione(presentazioneApertaId);
  document.getElementById('editorSchermata').style.display = 'none';
  document.getElementById('editorClipVideo').style.display = 'block';
  renderizzaListaClipPresentazione();
});

// --- Form "Aggiungi schermata di testo" ---
document.getElementById('btnMostraFormSchermata').addEventListener('click', () => {
  document.getElementById('formSchermata').style.display = 'flex';
});
document.getElementById('btnAnnullaSchermata').addEventListener('click', () => {
  document.getElementById('formSchermata').style.display = 'none';
});

async function mutaTutteLeClip(muto) {
  if (!presentazioneApertaId) { alert('Apri prima una presentazione.'); return; }
  if (!confirm(muto ? 'Togliere l\'audio da TUTTE le clip di questa presentazione?' : 'Riattivare l\'audio su TUTTE le clip di questa presentazione?')) return;

  await window.api.mutaTutteClip({ presentazioneId: presentazioneApertaId, muto });
  clipPresentazioneCorrente = await window.api.clipPresentazione(presentazioneApertaId);

  // se una clip è aperta in questo momento, aggiorno anche i suoi controlli e il player, non solo il database
  if (clipSelezionataId) {
    document.getElementById('clipAudioMuto').checked = muto;
    document.getElementById('clipAudioVolume').disabled = muto;
    presentazioneVideo.muted = muto;
  }

  document.getElementById('statoSalvataggio').textContent = muto ? 'Audio tolto da tutte le clip' : 'Audio riattivato su tutte le clip';
}

document.getElementById('btnMutaTutte').addEventListener('click', () => mutaTutteLeClip(true));
document.getElementById('btnSmutaTutte').addEventListener('click', () => mutaTutteLeClip(false));

async function creaSchermataDaForm(primaDiClipId) {
  if (!presentazioneApertaId) { alert('Apri prima una presentazione.'); return; }

  await window.api.aggiungiSchermata({
    presentazioneId: presentazioneApertaId,
    primaDiClipId: primaDiClipId || null,
    sfondo: document.getElementById('schermataSfondoInput').value,
    testo: document.getElementById('schermataTestoInput').value,
    coloreTesto: document.getElementById('schermataColoreTestoInput').value,
    durataSec: Number(document.getElementById('schermataDurataInput').value) || 4
  });

  document.getElementById('formSchermata').style.display = 'none';
  document.getElementById('schermataTestoInput').value = '';
  clipPresentazioneCorrente = await window.api.clipPresentazione(presentazioneApertaId);
  renderizzaListaClipPresentazione();
  document.getElementById('statoSalvataggio').textContent = 'Schermata aggiunta';
}

document.getElementById('btnInserisciSchermataQui').addEventListener('click', () => {
  creaSchermataDaForm(clipSelezionataId);
});
document.getElementById('btnAggiungiSchermataFine').addEventListener('click', () => {
  creaSchermataDaForm(null);
});

function aggiornaStatoPausa() {
  const stato = document.getElementById('pausaStato');
  const btnRimuovi = document.getElementById('btnRimuoviPausa');
  if (ultimoPausaSec != null) {
    stato.textContent = `Pausa impostata a ${formatTime(ultimoPausaSec)} — nel video esportato il fotogramma resterà fermo lì con i disegni`;
    btnRimuovi.style.display = 'inline';
  } else {
    stato.textContent = 'Nessuna pausa impostata per questo momento (metti in pausa il video per impostarla)';
    btnRimuovi.style.display = 'none';
  }
}

// Carica un momento già salvato nel canvas/controlli per continuare a
// modificarlo (disegni, punto di pausa, durata)
function caricaMomento(m) {
  momentoAttivoId = m.id;
  ultimoPausaSec = m.pausa_timestamp_sec;
  document.getElementById('pausaDurata').value = m.pausa_durata_sec ?? 3;
  Disegno.caricaForme(m.disegni_json || null);
  aggiornaStatoPausa();
  renderizzaChipMomenti();
}

// Disegna i "chip" cliccabili di tutti i momenti salvati per la clip aperta
function renderizzaChipMomenti() {
  const cont = document.getElementById('momentiLista');
  cont.innerHTML = '';
  momentiClipCorrente.forEach((m, i) => {
    const chip = document.createElement('span');
    chip.className = 'momento-chip' + (m.id === momentoAttivoId ? ' attivo' : '');
    chip.innerHTML = `🎨 ${i + 1} (${formatTime(m.pausa_timestamp_sec)}) <button class="elimina-momento" title="Elimina questo momento">✕</button>`;
    chip.addEventListener('click', () => caricaMomento(m));
    chip.querySelector('.elimina-momento').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.eliminaMomento(m.id);
      momentiClipCorrente = momentiClipCorrente.filter(x => x.id !== m.id);
      if (momentoAttivoId === m.id) {
        momentoAttivoId = null;
        ultimoPausaSec = null;
        Disegno.caricaForme(null);
        document.getElementById('pausaDurata').value = 3;
        aggiornaStatoPausa();
      }
      renderizzaChipMomenti();
    });
    cont.appendChild(chip);
  });
}

document.getElementById('btnNuovoMomento').addEventListener('click', () => {
  momentoAttivoId = null;
  ultimoPausaSec = null;
  Disegno.caricaForme(null);
  document.getElementById('pausaDurata').value = 3;
  aggiornaStatoPausa();
  renderizzaChipMomenti();
});

// Salva (crea o aggiorna) il momento attualmente attivo nel canvas, o lo
// elimina se la pausa è stata rimossa. Richiamata da "Salva clip".
async function salvaMomentoAttivo() {
  const pausaDurata = Number(document.getElementById('pausaDurata').value) || 3;
  const disegniJson = Disegno.ottieniFormeJSON();

  if (ultimoPausaSec == null) {
    if (momentoAttivoId) {
      await window.api.eliminaMomento(momentoAttivoId);
      momentiClipCorrente = momentiClipCorrente.filter(x => x.id !== momentoAttivoId);
      momentoAttivoId = null;
    }
    return;
  }

  if (momentoAttivoId) {
    await window.api.aggiornaMomento({ id: momentoAttivoId, pausaTimestampSec: ultimoPausaSec, pausaDurataSec: pausaDurata, disegniJson });
  } else {
    momentoAttivoId = await window.api.creaMomento({ presentazioneEventoId: clipSelezionataId, pausaTimestampSec: ultimoPausaSec, pausaDurataSec: pausaDurata, disegniJson });
  }
  momentiClipCorrente = await window.api.elencoMomentiClip(clipSelezionataId);
}

document.getElementById('btnRimuoviPausa').addEventListener('click', () => {
  ultimoPausaSec = null;
  aggiornaStatoPausa();
});

document.getElementById('btnSalvaClip').addEventListener('click', async () => {
  if (!clipSelezionataId) return;

  await window.api.aggiornaClipPresentazione({
    id: clipSelezionataId,
    inizio_sec: Number(trimInizio.value),
    fine_sec: Number(trimFine.value),
    audio_muto: document.getElementById('clipAudioMuto').checked,
    audio_volume: Number(document.getElementById('clipAudioVolume').value),
    velocita: Number(document.getElementById('clipVelocita').value)
  });

  await salvaMomentoAttivo();
  renderizzaChipMomenti();

  // ricarico dal database (non solo aggiorno a mano la copia in memoria):
  // cosí i disegni salvati non possono più disallinearsi da quello che vedi
  // se riapri questa clip più tardi nella stessa sessione
  clipPresentazioneCorrente = await window.api.clipPresentazione(presentazioneApertaId);

  document.getElementById('statoSalvataggio').textContent = 'Clip salvata';

  // l'azione riparte: il listener 'play' del video pulisce da solo i disegni
  // dalla preview (restano comunque salvati per l'export)
  presentazioneVideo.play();
});

// Mostra il pannello "quante clip", chiamato subito dopo aver confermato un
// testo fisso (invece di dover cliccare separatamente "Applica" dopo).
// È un overlay in posizione assoluta: non sposta né ridimensiona il video
// sottostante (altrimenti le coordinate dei disegni già fatti si
// disallineano rispetto a dove erano stati posizionati).
function apriEditorNumeroClipTestoFisso() {
  const pannello = document.getElementById('pannelloTestoFisso');
  pannello.style.display = 'flex';
  document.getElementById('esitoTestoFisso').textContent = '';
  const input = document.getElementById('numeroClipTestoFisso');
  setTimeout(() => input.focus(), 0);
}

document.getElementById('btnApplicaTestoFisso').addEventListener('click', async () => {
  if (!clipSelezionataId) return;
  const esito = document.getElementById('esitoTestoFisso');

  const testo = Disegno.ultimoTesto();
  if (!testo) {
    esito.textContent = '⚠️ Disegna prima un testo con lo strumento "📌 Testo fisso".';
    return;
  }
  testo.fisso = true; // resta visibile anche quando il video riparte a giocare, su questa e sulle prossime clip

  const numeroClip = Number(document.getElementById('numeroClipTestoFisso').value) || 1;

  // salvo prima la clip attuale (cosí il testo resta anche qui, non solo nelle prossime)
  const pausaDurata = Number(document.getElementById('pausaDurata').value) || 3;
  await window.api.aggiornaClipPresentazione({
    id: clipSelezionataId,
    inizio_sec: Number(trimInizio.value),
    fine_sec: Number(trimFine.value),
    disegni_json: Disegno.ottieniFormeJSON(),
    pausa_timestamp_sec: ultimoPausaSec,
    pausa_durata_sec: pausaDurata,
    audio_muto: document.getElementById('clipAudioMuto').checked,
    audio_volume: Number(document.getElementById('clipAudioVolume').value),
    velocita: Number(document.getElementById('clipVelocita').value)
  });

  const canvasCorrente = document.getElementById('disegnoCanvas');
  const numeroApplicate = await window.api.applicaTestoAPiuClip({
    presentazioneId: presentazioneApertaId,
    clipId: clipSelezionataId,
    formaTesto: testo,
    numeroClip,
    canvasSizeOrigine: { larghezza: canvasCorrente.width, altezza: canvasCorrente.height }
  });

  clipPresentazioneCorrente = await window.api.clipPresentazione(presentazioneApertaId);
  esito.textContent = numeroApplicate > 0
    ? `✓ Testo applicato anche alle prossime ${numeroApplicate} clip.`
    : 'Non ci sono altre clip dopo questa nella presentazione.';
  document.getElementById('statoSalvataggio').textContent = 'Testo fisso applicato';
  setTimeout(() => { document.getElementById('pannelloTestoFisso').style.display = 'none'; }, 2000);
});

document.getElementById('btnRimuoviClip').addEventListener('click', async () => {
  if (!clipSelezionataId) return;
  if (!confirm('Rimuovere questa clip dalla presentazione?')) return;
  await window.api.rimuoviClipPresentazione(clipSelezionataId);
  clipPresentazioneCorrente = clipPresentazioneCorrente.filter(c => c.id !== clipSelezionataId);
  clipSelezionataId = null;
  renderizzaListaClipPresentazione();
  if (clipPresentazioneCorrente.length > 0) apriClipPresentazione(clipPresentazioneCorrente[0]);
  else { presentazioneVideo.removeAttribute('src'); Disegno.caricaForme(null); }
});

document.getElementById('btnEsportaPresentazione').addEventListener('click', async () => {
  if (!presentazioneApertaId) { alert('Apri prima una presentazione.'); return; }
  if (clipPresentazioneCorrente.length === 0) { alert('La presentazione non ha clip.'); return; }

  const btn = document.getElementById('btnEsportaPresentazione');
  btn.textContent = 'Esportazione in corso...';
  btn.disabled = true;

  const progressWrap = document.getElementById('exportProgressWrap');
  const progressBarra = document.getElementById('exportProgressBarra');
  const progressTesto = document.getElementById('exportProgressTesto');
  progressWrap.style.display = 'flex';
  progressBarra.style.width = '0%';
  progressTesto.textContent = 'Preparazione…';

  window.api.onAvanzamentoExport(({ attuale, totale, fase }) => {
    const percento = Math.round((attuale / totale) * 100);
    progressBarra.style.width = `${percento}%`;
    progressTesto.textContent = fase === 'concatenazione'
      ? 'Unione clip finali…'
      : `Clip ${attuale} di ${totale}`;
  });

  // se la clip aperta ha modifiche non salvate, le salvo prima di esportare
  if (clipSelezionataId) {
    await window.api.aggiornaClipPresentazione({
      id: clipSelezionataId,
      inizio_sec: Number(trimInizio.value),
      fine_sec: Number(trimFine.value),
      audio_muto: document.getElementById('clipAudioMuto').checked,
      audio_volume: Number(document.getElementById('clipAudioVolume').value),
      velocita: Number(document.getElementById('clipVelocita').value)
    });
    await salvaMomentoAttivo();
  }

  // rigenero l'elenco aggiornato e preparo gli overlay PNG per le clip che hanno momenti.
  // Per ogni clip: un'immagine "solo fissi" (il testo fisso COMBINATO da tutti
  // i suoi momenti, applicata a tutta la clip così resta visibile in
  // continuazione) più un'immagine "completa" PER OGNI momento (i suoi
  // disegni, usata solo nel proprio fermo immagine)
  clipPresentazioneCorrente = await window.api.clipPresentazione(presentazioneApertaId);
  const overlayPngPerClip = {};

  const estraiFormeECanvasSize = (disegniJson) => {
    if (!disegniJson) return { forme: [], canvasSize: null };
    const dati = JSON.parse(disegniJson);
    return Array.isArray(dati) ? { forme: dati, canvasSize: null } : { forme: dati.forme || [], canvasSize: dati.canvasSize || null };
  };

  for (const c of clipPresentazioneCorrente) {
    if (!c.momenti || c.momenti.length === 0) continue;

    const overlay = { momenti: {} };
    let canvasSizeRiferimento = null;
    const formeFisseCombinate = [];
    c.momenti.forEach(m => {
      const { forme, canvasSize } = estraiFormeECanvasSize(m.disegni_json);
      if (canvasSize && !canvasSizeRiferimento) canvasSizeRiferimento = canvasSize;
      forme.filter(f => f.fisso).forEach(f => formeFisseCombinate.push(f));
    });

    if (formeFisseCombinate.length > 0) {
      Disegno.caricaForme(JSON.stringify({ forme: formeFisseCombinate, canvasSize: canvasSizeRiferimento }));
      const soloFissi = Disegno.generaPngPerExport(true);
      if (soloFissi) overlay.soloFissi = await window.api.scriviPngTemp(soloFissi);
    }

    for (const m of c.momenti) {
      Disegno.caricaForme(m.disegni_json);
      const completo = Disegno.generaPngPerExport(false);
      if (completo) overlay.momenti[m.id] = await window.api.scriviPngTemp(completo);
    }

    if (overlay.soloFissi || Object.keys(overlay.momenti).length > 0) overlayPngPerClip[c.id] = overlay;
  }

  // ripristino sul canvas i disegni del momento attualmente attivo
  if (clipSelezionataId) {
    const m = momentiClipCorrente.find(x => x.id === momentoAttivoId);
    Disegno.caricaForme(m ? m.disegni_json : null);
  }

  let risultato;
  try {
    risultato = await window.api.esportaPresentazione({ presentazioneId: presentazioneApertaId, overlayPngPerClip });
  } catch (err) {
    alert(`Esportazione non riuscita: ${err.message || err}`);
  }

  btn.textContent = '⬇ Esporta come MP4';
  btn.disabled = false;
  progressWrap.style.display = 'none';
  if (risultato) alert(`Esportato in: ${risultato}`);
});

// --- Toolbar disegno (percorsi, cerchi, triangoli, testo, fascio luce) ---
// --- "Disegna" dedicato: funziona SEMPRE, anche con uno strumento di
// disegno attivo (il canvas sopra il video blocca i controlli nativi quando
// è in modalità disegno — questo pulsante vive fuori dal canvas). Blocca il
// fotogramma; quando l'azione riparte (da qualunque comando: play nativo,
// barra spazio, o Salva clip), i disegni spariscono dalla preview — restano
// comunque salvati per l'export una volta premuto Salva clip. ---
const btnDisegnaFreeze = document.getElementById('btnDisegnaFreeze');

btnDisegnaFreeze.addEventListener('click', () => {
  presentazioneVideo.pause();
});

presentazioneVideo.addEventListener('play', () => {
  Disegno.cancellaNonFissi();
});
presentazioneVideo.addEventListener('pause', () => {
  if (pausaProgrammataDaCodice) { pausaProgrammataDaCodice = false; return; } // pausa nostra (anteprima), non un'azione dell'utente
  // registro il punto di pausa (solo se il video ha già riprodotto qualcosa,
  // per non scattare al semplice caricamento della clip)
  if (presentazioneVideo.currentTime > 0) {
    ultimoPausaSec = presentazioneVideo.currentTime;
    aggiornaStatoPausa();
  }
});

// La clip deve durare esattamente quanto stabilito nel taglio (Inizio → Fine):
// senza questo controllo, la riproduzione continuava oltre il bordo "Fine",
// dentro il resto della partita, invece di fermarsi alla durata scelta.
presentazioneVideo.addEventListener('timeupdate', () => {
  if (presentazioneVideo.paused) return;
  const fine = Number(trimFine.value);
  if (!fine) return;
  if (presentazioneVideo.currentTime >= fine) {
    presentazioneVideo.pause();
    presentazioneVideo.currentTime = fine; // non va oltre il bordo
  }
});

// Rivedendo una clip già salvata: quando la riproduzione raggiunge un punto
// di pausa già registrato (uno qualsiasi dei suoi momenti), si ferma da
// sola, richiama i disegni di QUEL momento e li tiene a schermo per la sua
// durata, poi riparte da sola (i disegni spariscono di nuovo grazie al
// listener 'play' qui sopra).
presentazioneVideo.addEventListener('timeupdate', () => {
  if (presentazioneVideo.paused) return;
  const momento = momentiClipCorrente.find(m =>
    !momentiPassatiInPreview.has(m.id) && presentazioneVideo.currentTime >= m.pausa_timestamp_sec
  );
  if (!momento) return;

  momentiPassatiInPreview.add(momento.id);
  pausaProgrammataDaCodice = true;
  presentazioneVideo.pause();
  Disegno.caricaForme(momento.disegni_json);

  const durataMs = (momento.pausa_durata_sec || 3) * 1000;
  setTimeout(() => { presentazioneVideo.play(); }, durataMs);
});

// Riavvolgendo prima di un momento, l'anteprima automatica può scattare di
// nuovo per quel momento al prossimo passaggio in avanti
presentazioneVideo.addEventListener('seeked', () => {
  momentiPassatiInPreview.forEach(id => {
    const m = momentiClipCorrente.find(x => x.id === id);
    if (m && presentazioneVideo.currentTime < m.pausa_timestamp_sec - 0.05) {
      momentiPassatiInPreview.delete(id);
    }
  });
});

// barra spaziatrice = play/pausa, anche mentre disegni (ma non mentre scrivi un testo)
window.addEventListener('keydown', (e) => {
  if (!document.getElementById('view-presentazioni').classList.contains('active')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.code !== 'Space') return;
  e.preventDefault();
  if (presentazioneVideo.paused) presentazioneVideo.play();
  else presentazioneVideo.pause();
}, true);

// frecce ← → = avanti/indietro di 5 secondi, anche in Presentazioni
window.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  if (!document.getElementById('view-presentazioni').classList.contains('active')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

  e.preventDefault();
  e.stopImmediatePropagation();

  const delta = e.key === 'ArrowRight' ? 5 : -5;
  presentazioneVideo.currentTime = Math.max(0, Math.min(presentazioneVideo.duration || Infinity, presentazioneVideo.currentTime + delta));
}, true);

Disegno.init(presentazioneVideo, document.getElementById('disegnoCanvas'), {
  stileIniziale: { colore: '#ff3b30', spessore: 4 },
  onTestoFissoConfermato: () => apriEditorNumeroClipTestoFisso()
});

document.querySelectorAll('.disegno-tool').forEach(btn => {
  btn.addEventListener('click', () => {
    const eraAttivo = btn.classList.contains('selezionato');
    document.querySelectorAll('.disegno-tool').forEach(b => b.classList.remove('selezionato'));

    if (eraAttivo) {
      // riclicco lo stesso strumento: lo spengo, così il video torna cliccabile
      Disegno.impostaStrumento(null);
      return;
    }

    btn.classList.add('selezionato');
    Disegno.impostaStrumento(btn.dataset.tool);
    document.getElementById('disegnoCanvas').style.cursor = btn.dataset.tool === 'seleziona' ? 'grab' : 'crosshair';
  });
});

function aggiornaStileDaToolbar() {
  Disegno.impostaStile({
    colore: document.getElementById('optColore').value,
    spessore: Number(document.getElementById('optSpessore').value),
    curva: document.getElementById('optCurva').checked,
    tratteggiata: document.getElementById('optTratteggiata').checked,
    freccia: document.getElementById('optFreccia').checked,
    font: document.getElementById('optFont').value,
    coloreTesto: document.getElementById('optTestoColoreTesto').value,
    sfondoTesto: document.getElementById('optTestoColoreSfondo').value,
    sfondoTestoAttivo: document.getElementById('optTestoSfondoAttivo').checked,
    bordoTesto: document.getElementById('optTestoColoreBordo').value,
    bordoTestoAttivo: document.getElementById('optTestoBordoAttivo').checked,
    dimensioneTesto: Number(document.getElementById('optTestoDimensione').value) || 22
  });
}
['optColore', 'optSpessore', 'optCurva', 'optTratteggiata', 'optFreccia', 'optFont',
 'optTestoColoreTesto', 'optTestoColoreSfondo', 'optTestoSfondoAttivo',
 'optTestoColoreBordo', 'optTestoBordoAttivo', 'optTestoDimensione']
  .forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('change', aggiornaStileDaToolbar);
    el.addEventListener('input', aggiornaStileDaToolbar); // i selettori colore nativi a volte confermano solo su 'input', non su 'change'
  });
aggiornaStileDaToolbar();

document.getElementById('disegnoAnnulla').addEventListener('click', () => Disegno.annullaUltimo());
document.getElementById('disegnoElimina').addEventListener('click', () => {
  if (!Disegno.haSelezione()) { alert('Seleziona prima una forma con lo strumento "Sposta" (clicca sopra al disegno).'); return; }
  Disegno.eliminaSelezionata();
});
document.getElementById('disegnoCancella').addEventListener('click', () => Disegno.cancellaTutto());

// ============================================================
// VISTA GIOCATORI: squadre per categoria + rosa (nome, cognome, ruolo, numero)
// ============================================================
const elencoSquadreGiocatoriEl = document.getElementById('elencoSquadreGiocatori');
const rosaSquadraTitolo = document.getElementById('rosaSquadraTitolo');
const nuovoGiocatoreForm = document.getElementById('nuovoGiocatoreForm');
const tabellaRosa = document.getElementById('tabellaRosa');

let squadraApertaInGiocatoriId = null;

async function caricaVistaGiocatori() {
  const squadre = await window.api.elencoSquadre();
  elencoSquadreGiocatoriEl.innerHTML = '';

  squadre.forEach(sq => {
    const riga = document.createElement('div');
    riga.className = 'squadra-riga-giocatori';
    riga.innerHTML = `
      <span>${sq.nome}${sq.categoria ? `<span class="categoria-label">${sq.categoria}</span>` : ''}</span>
      <span>${sq.n_giocatori} <button class="elimina-squadra" title="Elimina squadra">✕</button></span>
    `;
    riga.querySelector('.elimina-squadra').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Eliminare "${sq.nome}"${sq.categoria ? ' (' + sq.categoria + ')' : ''} e tutta la sua rosa?`)) return;

      const esito = await window.api.eliminaSquadra(sq.id);
      if (!esito.ok) {
        alert(`Non posso eliminare "${sq.nome}": è collegata a ${esito.numeroPartite} partit${esito.numeroPartite === 1 ? 'a' : 'e'} nell'archivio. Elimina prima quelle partite (dalla vista Partite), poi riprova.`);
        return;
      }

      if (squadraApertaInGiocatoriId === sq.id) { squadraApertaInGiocatoriId = null; nuovoGiocatoreForm.style.display = 'none'; tabellaRosa.innerHTML = ''; rosaSquadraTitolo.textContent = 'Seleziona una squadra'; }
      caricaVistaGiocatori();
    });
    riga.addEventListener('click', () => apriRosaSquadra(sq, riga));
    elencoSquadreGiocatoriEl.appendChild(riga);
  });
}

document.getElementById('btnNuovaSquadra').addEventListener('click', async () => {
  const nome = document.getElementById('nsNome').value.trim();
  const categoria = document.getElementById('nsCategoria').value.trim();
  if (!nome) { alert('Il nome squadra è obbligatorio.'); return; }

  await window.api.creaSquadra({ nome, categoria: categoria || null });
  document.getElementById('nsNome').value = '';
  document.getElementById('nsCategoria').value = '';
  caricaVistaGiocatori();
});

// Piccolo modale per modificare un giocatore già inserito (nome, cognome,
// numero, ruolo) — stesso stile di mostraPromptModal ma con più campi
function mostraModaleModificaGiocatore(g) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal">
        <h2>✏️ Modifica giocatore</h2>
        <input type="text" id="modGiocNome" placeholder="Nome" value="${g.nome || ''}">
        <input type="text" id="modGiocCognome" placeholder="Cognome" value="${g.cognome || ''}">
        <select id="modGiocRuolo">
          <option value="">Ruolo</option>
          <option value="Portiere">Portiere</option>
          <option value="Ala sinistra">Ala sinistra</option>
          <option value="Terzino sinistro">Terzino sinistro</option>
          <option value="Centrale">Centrale</option>
          <option value="Terzino destro">Terzino destro</option>
          <option value="Ala destra">Ala destra</option>
          <option value="Pivot">Pivot</option>
        </select>
        <input type="number" id="modGiocNumero" placeholder="Numero maglia" value="${g.numero ?? ''}">
        <div class="modal-azioni">
          <button id="modGiocAnnulla" class="secondario">Annulla</button>
          <button id="modGiocSalva" class="primario">Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#modGiocRuolo').value = g.ruolo || '';

    const nomeInput = overlay.querySelector('#modGiocNome');
    setTimeout(() => { nomeInput.focus(); }, 0);

    const chiudi = (valore) => { overlay.remove(); resolve(valore); };

    overlay.querySelector('#modGiocSalva').addEventListener('click', () => {
      const nome = overlay.querySelector('#modGiocNome').value.trim();
      if (!nome) { alert('Il nome è obbligatorio.'); return; }
      chiudi({
        nome,
        cognome: overlay.querySelector('#modGiocCognome').value.trim(),
        ruolo: overlay.querySelector('#modGiocRuolo').value,
        numero: overlay.querySelector('#modGiocNumero').value
      });
    });
    overlay.querySelector('#modGiocAnnulla').addEventListener('click', () => chiudi(null));
  });
}

async function apriRosaSquadra(sq, rigaEl) {
  document.querySelectorAll('.squadra-riga-giocatori').forEach(r => r.classList.remove('attiva'));
  if (rigaEl) rigaEl.classList.add('attiva');

  squadraApertaInGiocatoriId = sq.id;
  rosaSquadraTitolo.textContent = `${sq.nome}${sq.categoria ? ' — ' + sq.categoria : ''}`;
  nuovoGiocatoreForm.style.display = 'flex';
  document.getElementById('btnOrdinaPerRuolo').style.display = 'inline-block';

  await renderizzaRosa();
}

async function renderizzaRosa() {
  const giocatori = await window.api.elencoGiocatoriPerSquadra(squadraApertaInGiocatoriId);
  tabellaRosa.innerHTML = '';

  giocatori.forEach(g => {
    const riga = document.createElement('div');
    riga.className = 'rosa-riga';
    riga.innerHTML = `
      <span class="numero">${g.numero || '-'}</span>
      <span>${g.nome} ${g.cognome || ''}</span>
      <span class="ruolo">${g.ruolo || ''}</span>
      <span class="rosa-riga-frecce">
        <button class="rosa-sposta-su" title="Sposta su">▲</button>
        <button class="rosa-sposta-giu" title="Sposta giù">▼</button>
      </span>
      <button class="modifica-giocatore" title="Modifica">✏️</button>
      <button class="elimina-giocatore" title="Rimuovi">✕</button>
      <span style="color:var(--muted); font-size:11px;">🔎</span>
    `;
    riga.querySelector('.rosa-sposta-su').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.spostaOrdineGiocatore({ id: g.id, direzione: 'su' });
      renderizzaRosa();
    });
    riga.querySelector('.rosa-sposta-giu').addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.api.spostaOrdineGiocatore({ id: g.id, direzione: 'giu' });
      renderizzaRosa();
    });
    riga.querySelector('.modifica-giocatore').addEventListener('click', async (e) => {
      e.stopPropagation();
      const modifiche = await mostraModaleModificaGiocatore(g);
      if (!modifiche) return;
      await window.api.aggiornaGiocatore({
        id: g.id,
        nome: modifiche.nome,
        cognome: modifiche.cognome || null,
        ruolo: modifiche.ruolo || null,
        numero: modifiche.numero ? Number(modifiche.numero) : null
      });
      renderizzaRosa();
      caricaVistaGiocatori();
    });
    riga.querySelector('.elimina-giocatore').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Rimuovere ${g.nome} ${g.cognome || ''} dalla rosa?`)) return;
      await window.api.eliminaGiocatore(g.id);
      renderizzaRosa();
      caricaVistaGiocatori();
    });
    riga.addEventListener('click', () => apriEventiGiocatore(g));
    tabellaRosa.appendChild(riga);
  });
}

document.getElementById('btnOrdinaPerRuolo').addEventListener('click', async () => {
  if (!squadraApertaInGiocatoriId) return;
  await window.api.ordinaGiocatoriPerRuolo(squadraApertaInGiocatoriId);
  renderizzaRosa();
});

document.getElementById('btnAggiungiGiocatore').addEventListener('click', async () => {
  if (!squadraApertaInGiocatoriId) return;
  const nome = document.getElementById('ngNome').value.trim();
  const cognome = document.getElementById('ngCognome').value.trim();
  const ruolo = document.getElementById('ngRuolo').value.trim();
  const numero = document.getElementById('ngNumero').value;

  if (!nome) { alert('Il nome è obbligatorio.'); return; }

  await window.api.creaGiocatore({
    squadra_id: squadraApertaInGiocatoriId,
    nome, cognome: cognome || null, ruolo: ruolo || null,
    numero: numero ? Number(numero) : null
  });

  document.getElementById('ngNome').value = '';
  document.getElementById('ngCognome').value = '';
  document.getElementById('ngRuolo').value = '';
  document.getElementById('ngNumero').value = '';

  await renderizzaRosa();
  caricaVistaGiocatori();
});

// ============================================================
// EVENTI DEL GIOCATORE: apri dal click su una riga della rosa,
// filtra per tag (es. "tutti i tiri da ala") e importa in presentazione
// ============================================================
const modalEventiGiocatore = document.getElementById('modalEventiGiocatore');
const titoloEventiGiocatore = document.getElementById('titoloEventiGiocatore');
const listaEventiGiocatoreEl = document.getElementById('listaEventiGiocatore');
const btnImportaEventiGiocatore = document.getElementById('btnImportaEventiGiocatore');

let eventiGiocatoreCorrente = [];
let eventiSelezionatiGiocatore = new Set();
let ordinaPerCategorieIdsGiocatore = []; // in ordine di click: [primario, secondario, ...]

async function apriEventiGiocatore(g) {
  titoloEventiGiocatore.textContent = `Eventi di ${g.nome} ${g.cognome || ''}`;
  eventiSelezionatiGiocatore.clear();
  ordinaPerCategorieIdsGiocatore = [];
  btnImportaEventiGiocatore.disabled = true;

  eventiGiocatoreCorrente = await window.api.eventiGiocatore(g.id);
  // non presuppongo che l'utente sia già passato da Eventi: carico le
  // categorie da solo, così questa riga funziona indipendentemente
  categorieDisponibiliEventi = await window.api.elencoCategorie();
  renderizzaOrdinaCategorieGiocatore();
  renderizzaListaEventiGiocatore();

  modalEventiGiocatore.classList.add('active');
}

function renderizzaOrdinaCategorieGiocatore() {
  const cont = document.getElementById('eventiOrdinaCategorieGiocatore');
  cont.innerHTML = '';

  categorieDisponibiliEventi.forEach(cat => {
    const btn = document.createElement('button');
    const posizione = ordinaPerCategorieIdsGiocatore.indexOf(cat.id);
    btn.className = 'gruppo-btn gruppo-' + (cat.gruppo || 'generale') + (posizione !== -1 ? ' selezionato' : '');
    btn.textContent = posizione !== -1 ? `${cat.nome} ${posizione + 1}°` : cat.nome;

    btn.addEventListener('click', (e) => {
      const giaPresente = ordinaPerCategorieIdsGiocatore.includes(cat.id);

      if (e.shiftKey) {
        if (giaPresente) ordinaPerCategorieIdsGiocatore = ordinaPerCategorieIdsGiocatore.filter(id => id !== cat.id);
        else ordinaPerCategorieIdsGiocatore.push(cat.id);
      } else {
        ordinaPerCategorieIdsGiocatore = (giaPresente && ordinaPerCategorieIdsGiocatore.length === 1) ? [] : [cat.id];
      }

      renderizzaOrdinaCategorieGiocatore();
      renderizzaListaEventiGiocatore();
    });

    cont.appendChild(btn);
  });

  aggiornaStatoOrdinamento('eventiGiocatoreStatoOrdinamento', ordinaPerCategorieIdsGiocatore, categorieDisponibiliEventi);
}

function renderizzaListaEventiGiocatore() {
  const filtrati = ordinaEventiPerCategorie(eventiGiocatoreCorrente, ordinaPerCategorieIdsGiocatore);

  listaEventiGiocatoreEl.innerHTML = '';

  if (filtrati.length === 0) {
    listaEventiGiocatoreEl.innerHTML = '<p style="color:var(--muted); font-size:12px;">Nessun evento con questi tag per questo giocatore.</p>';
    return;
  }

  filtrati.forEach(ev => {
    const riga = document.createElement('div');
    riga.className = 'eventi-giocatore-riga';
    const badge = ev.tag.map(t => `<span class="tag-badge">${t.nome}</span>`).join('');
    riga.innerHTML = `
      <input type="checkbox">
      <span class="partita-label">${ev.squadra_casa} - ${ev.squadra_ospite}</span>
      <span class="tempo">${formatTime(ev.inizio_sec)}-${formatTime(ev.fine_sec)}</span>
      <span>${badge}</span>
    `;
    riga.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) eventiSelezionatiGiocatore.add(ev.id); else eventiSelezionatiGiocatore.delete(ev.id);
      btnImportaEventiGiocatore.disabled = eventiSelezionatiGiocatore.size === 0;
    });
    listaEventiGiocatoreEl.appendChild(riga);
  });
}

document.getElementById('chiudiEventiGiocatore').addEventListener('click', () => {
  modalEventiGiocatore.classList.remove('active');
});

btnImportaEventiGiocatore.addEventListener('click', () => {
  apriModaleImporta({
    eventiSet: eventiSelezionatiGiocatore,
    dopoImport: () => {
      btnImportaEventiGiocatore.disabled = true;
      modalEventiGiocatore.classList.remove('active');
    }
  });
});

// ============================================================
// VISTA IMPOSTAZIONI: gestione tag — ogni coach personalizza il proprio pannello
// ============================================================
async function caricaVistaImpostazioni() {
  await popolaSelettoriPannello();
  const categorie = await window.api.getTagsPerGestione(pannelloAttivoId);
  const cont = document.getElementById('gestioneCategorie');
  cont.innerHTML = '';

  categorie.forEach((cat, indiceCat) => {
    const blocco = document.createElement('div');
    blocco.className = 'gestione-categoria-blocco';
    blocco.innerHTML = `
      <div class="gestione-categoria-header">
        <input type="checkbox" ${cat.attiva ? 'checked' : ''} class="cat-toggle">
        <input type="text" class="cat-nome-input" value="${cat.nome}">
        <select class="cat-gruppo-select">
          <option value="generale" ${cat.gruppo === 'generale' || !cat.gruppo ? 'selected' : ''}>Generale</option>
          <option value="attacco" ${cat.gruppo === 'attacco' ? 'selected' : ''}>Attacco</option>
          <option value="difesa" ${cat.gruppo === 'difesa' ? 'selected' : ''}>Difesa</option>
        </select>
        <span class="ordina-gruppo">
          <button class="ordina-btn cat-su" ${indiceCat === 0 ? 'disabled' : ''} title="Sposta su">▲</button>
          <button class="ordina-btn cat-giu" ${indiceCat === categorie.length - 1 ? 'disabled' : ''} title="Sposta giù">▼</button>
        </span>
        <button class="cat-elimina" title="Elimina questa categoria (e tutto il suo contenuto)">🗑</button>
      </div>
      <div class="gestione-tag-lista"></div>
    `;

    blocco.querySelector('.cat-toggle').addEventListener('change', async (e) => {
      await window.api.toggleAttivaCategoria({ id: cat.id, attiva: e.target.checked });
    });
    const salvaNomeCat = async () => {
      const nome = blocco.querySelector('.cat-nome-input').value.trim();
      const gruppo = blocco.querySelector('.cat-gruppo-select').value;
      if (!nome) return;
      await window.api.rinominaCategoria({ id: cat.id, nome, gruppo });
    };
    blocco.querySelector('.cat-nome-input').addEventListener('blur', salvaNomeCat);
    blocco.querySelector('.cat-nome-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    blocco.querySelector('.cat-gruppo-select').addEventListener('change', salvaNomeCat);

    blocco.querySelector('.cat-su').addEventListener('click', async () => {
      await window.api.spostaOrdineCategoria({ id: cat.id, direzione: 'su' });
      caricaVistaImpostazioni();
    });
    blocco.querySelector('.cat-giu').addEventListener('click', async () => {
      await window.api.spostaOrdineCategoria({ id: cat.id, direzione: 'giu' });
      caricaVistaImpostazioni();
    });
    blocco.querySelector('.cat-elimina').addEventListener('click', async () => {
      if (!confirm(`Eliminare tutta la categoria "${cat.nome}" con tutto il suo contenuto? Non si può annullare.`)) return;
      await window.api.eliminaCategoria(cat.id);
      caricaVistaImpostazioni();
    });

    const cartelleDisponibili = raccogliCartelle(cat.tag);
    const altreCategorie = categorie.filter(c => c.id !== cat.id).map(c => ({ id: c.id, nome: c.nome }));
    const listaTag = blocco.querySelector('.gestione-tag-lista');
    cat.tag.forEach((nodo, i) => renderizzaNodoGestione(nodo, listaTag, cat.id, cat.tag.length, i, cartelleDisponibili, altreCategorie));
    listaTag.appendChild(creaMiniFormAggiungiTag(cat.id, null));

    cont.appendChild(blocco);
  });
}

// Raccoglie tutte le cartelle di una categoria (a qualsiasi profondità),
// con un'etichetta leggibile del percorso, per popolare il menu "Sposta in"
function raccogliCartelle(nodi, prefisso = '') {
  let risultato = [];
  nodi.forEach(n => {
    if (n.e_cartella) {
      const etichetta = prefisso + n.nome;
      risultato.push({ id: n.id, etichetta });
      risultato = risultato.concat(raccogliCartelle(n.children, etichetta + ' › '));
    }
  });
  return risultato;
}

// Renderizza UN nodo nell'editor di gestione (tag o cartella): nome
// editabile, attivo/disattivo, ▲▼ tra fratelli, menu "sposta in" verso
// un'altra cartella della stessa categoria, ed eliminazione. Se è una
// cartella, mostra anche i figli annidati sotto e un mini-form per
// aggiungerne di nuovi dentro quella cartella specifica.
function renderizzaNodoGestione(nodo, contenitore, categoriaId, numFratelli, indice, cartelleDisponibili, altreCategorie) {
  const riga = document.createElement('div');
  riga.className = 'gestione-tag-riga' + (nodo.e_cartella ? ' gestione-cartella-riga' : '');

  const opzioniSposta = cartelleDisponibili
    .filter(c => c.id !== nodo.id)
    .map(c => `<option value="cartella:${c.id}" ${c.id === nodo.genitore_id ? 'selected' : ''}>${c.etichetta}</option>`)
    .join('');

  const opzioniAltreCategorie = (altreCategorie || [])
    .map(c => `<option value="categoria:${c.id}">${c.nome}</option>`)
    .join('');

  riga.innerHTML = `
    <input type="checkbox" ${nodo.attivo ? 'checked' : ''}>
    ${nodo.e_cartella ? '<span>📁</span>' : ''}
    <input type="text" class="nodo-nome-input" value="${nodo.nome}">
    ${!nodo.e_cartella ? `<input type="color" class="nodo-colore-input" value="${nodo.colore || '#8899aa'}" title="Colore">` : ''}
    <select class="nodo-sposta-in" title="Sposta qui dentro o in un'altra categoria">
      <option value="qui" ${!nodo.genitore_id ? 'selected' : ''}>— primo livello (qui) —</option>
      ${opzioniSposta}
      ${opzioniAltreCategorie ? `<optgroup label="Sposta in un'altra categoria">${opzioniAltreCategorie}</optgroup>` : ''}
    </select>
    <span class="ordina-gruppo">
      <button class="ordina-btn nodo-su" ${indice === 0 ? 'disabled' : ''} title="Sposta su">▲</button>
      <button class="ordina-btn nodo-giu" ${indice === numFratelli - 1 ? 'disabled' : ''} title="Sposta giù">▼</button>
    </span>
    <button class="nodo-elimina" title="Elimina${nodo.e_cartella ? ' (e tutto il contenuto dentro)' : ''}">🗑</button>
  `;

  riga.querySelector('input[type="checkbox"]').addEventListener('change', async (e) => {
    await window.api.toggleAttivoTag({ id: nodo.id, attivo: e.target.checked });
  });

  const salvaNodo = async () => {
    const nome = riga.querySelector('.nodo-nome-input').value.trim();
    if (!nome) return;
    const coloreInput = riga.querySelector('.nodo-colore-input');
    await window.api.rinominaTag({ id: nodo.id, nome, colore: coloreInput ? coloreInput.value : null });
  };
  riga.querySelector('.nodo-nome-input').addEventListener('blur', salvaNodo);
  riga.querySelector('.nodo-nome-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  const coloreInput = riga.querySelector('.nodo-colore-input');
  if (coloreInput) coloreInput.addEventListener('change', salvaNodo);

  riga.querySelector('.nodo-sposta-in').addEventListener('change', async (e) => {
    const valore = e.target.value;
    const payload = { id: nodo.id };
    if (valore.startsWith('categoria:')) {
      payload.categoria_id = Number(valore.split(':')[1]);
      payload.genitore_id = null;
    } else if (valore.startsWith('cartella:')) {
      payload.genitore_id = Number(valore.split(':')[1]);
    } else {
      payload.genitore_id = null; // "qui", primo livello della categoria attuale
    }
    await window.api.spostaGenitoreTag(payload);
    caricaVistaImpostazioni();
  });

  riga.querySelector('.nodo-su').addEventListener('click', async () => {
    await window.api.spostaOrdineTag({ id: nodo.id, direzione: 'su' });
    caricaVistaImpostazioni();
  });
  riga.querySelector('.nodo-giu').addEventListener('click', async () => {
    await window.api.spostaOrdineTag({ id: nodo.id, direzione: 'giu' });
    caricaVistaImpostazioni();
  });
  riga.querySelector('.nodo-elimina').addEventListener('click', async () => {
    const avviso = nodo.e_cartella
      ? `Eliminare la cartella "${nodo.nome}" e tutto quello che contiene dentro?`
      : `Eliminare "${nodo.nome}"?`;
    if (!confirm(avviso)) return;
    await window.api.eliminaTag(nodo.id);
    caricaVistaImpostazioni();
  });

  contenitore.appendChild(riga);

  if (nodo.e_cartella) {
    const figliWrap = document.createElement('div');
    figliWrap.className = 'gestione-tag-figli';
    nodo.children.forEach((figlio, i) => renderizzaNodoGestione(figlio, figliWrap, categoriaId, nodo.children.length, i, cartelleDisponibili, altreCategorie));
    figliWrap.appendChild(creaMiniFormAggiungiTag(categoriaId, nodo.id));
    contenitore.appendChild(figliWrap);
  }
}

// Form per aggiungere una voce (tag o cartella) dentro una categoria o
// dentro una cartella specifica (genitoreId nullo = primo livello)
function creaMiniFormAggiungiTag(categoriaId, genitoreId) {
  const form = document.createElement('div');
  form.className = 'nuovo-tag-form';
  form.innerHTML = `
    <input type="text" placeholder="${genitoreId ? 'Nuova voce qui dentro' : 'Nuovo tag in questa categoria'}" class="nt-nome">
    <label class="nt-cartella-label"><input type="checkbox" class="nt-cartella"> Cartella</label>
    <input type="color" class="nt-colore" value="#8899aa" title="Colore (opzionale)">
    <button class="nt-aggiungi">+ Aggiungi</button>
  `;

  form.querySelector('.nt-aggiungi').addEventListener('click', async () => {
    const nomeInput = form.querySelector('.nt-nome');
    const nome = nomeInput.value.trim();
    if (!nome) return;
    const eCartella = form.querySelector('.nt-cartella').checked;
    const colore = form.querySelector('.nt-colore').value;

    await window.api.creaTag({
      categoria_id: categoriaId,
      genitore_id: genitoreId,
      nome,
      colore: eCartella ? null : colore,
      e_cartella: eCartella
    });
    caricaVistaImpostazioni();
  });

  return form;
}

document.getElementById('btnNuovaCategoria').addEventListener('click', async () => {
  const nomeInput = document.getElementById('ncNome');
  const nome = nomeInput.value.trim();
  const gruppo = document.getElementById('ncGruppo').value;
  if (!nome) { alert('Dai un nome alla categoria.'); return; }

  await window.api.creaCategoria({ pannelloId: pannelloAttivoId, nome, gruppo });
  nomeInput.value = '';
  caricaVistaImpostazioni();
});

// ============================================================
// VISTA IMPOSTAZIONI (Account, Abbonamento, Video, Privacy, Supporto, Info)
// App interamente locale: nessun server, nessun login, nessun pagamento.
// Le sezioni che richiederebbero un backend cloud sono segnalate come tali
// invece di mostrare dati finti.
// ============================================================
let sezioneImpostazioniAttiva = 'account';
let impostazioniAppCache = {};

async function caricaVistaImpostazioniApp() {
  impostazioniAppCache = await window.api.leggiImpostazioniApp();

  document.querySelectorAll('.impostazioni-sezione-btn').forEach(btn => {
    btn.classList.toggle('attiva', btn.dataset.sezione === sezioneImpostazioniAttiva);
    btn.onclick = () => {
      sezioneImpostazioniAttiva = btn.dataset.sezione;
      document.querySelectorAll('.impostazioni-sezione-btn').forEach(b => b.classList.remove('attiva'));
      btn.classList.add('attiva');
      renderizzaSezioneImpostazioni();
    };
  });

  renderizzaSezioneImpostazioni();
}

function renderizzaSezioneImpostazioni() {
  const cont = document.getElementById('impostazioniAppContenuto');
  if (sezioneImpostazioniAttiva === 'account') return renderizzaSezioneAccount(cont);
  if (sezioneImpostazioniAttiva === 'abbonamento') return renderizzaSezioneAbbonamento(cont);
  if (sezioneImpostazioniAttiva === 'video') return renderizzaSezioneVideo(cont);
  if (sezioneImpostazioniAttiva === 'privacy') return renderizzaSezionePrivacy(cont);
  if (sezioneImpostazioniAttiva === 'supporto') return renderizzaSezioneSupporto(cont);
  if (sezioneImpostazioniAttiva === 'info') return renderizzaSezioneInfo(cont);
}

function renderizzaSezioneAccount(cont) {
  const utente = firebase.auth().currentUser;

  if (utente) {
    // già loggato: mostro chi è, con possibilità di uscire
    cont.innerHTML = `
      <h2>👤 Account</h2>
      <div class="campo-impostazione">
        <label>Accesso effettuato come</label>
        <span class="desc">${utente.email || '(senza email)'}</span>
      </div>
      <div class="campo-impostazione">
        <label>Nome coach</label>
        <span class="desc">Usato per identificarti nelle esportazioni future. Salvato solo su questo Mac.</span>
        <input type="text" id="accNomeCoach" placeholder="Es. Salvatore Onelli" value="${impostazioniAppCache.nome_coach || ''}">
      </div>
      <div class="campo-impostazione">
        <button class="btn-impostazione" id="btnLogout">Esci (logout)</button>
      </div>
    `;
    document.getElementById('btnLogout').addEventListener('click', async () => {
      await firebase.auth().signOut();
      renderizzaSezioneAccount(cont);
    });
    document.getElementById('accNomeCoach').addEventListener('blur', async (e) => {
      const valore = e.target.value.trim();
      await window.api.scriviImpostazioneApp({ chiave: 'nome_coach', valore });
      impostazioniAppCache.nome_coach = valore;
      document.getElementById('statoSalvataggio').textContent = 'Nome salvato';
    });
    return;
  }

  // non loggato: schermata di accesso/registrazione
  cont.innerHTML = `
    <h2>👤 Account</h2>
    <div class="account-login-box">
      <div class="campo-impostazione">
        <label>Email</label>
        <input type="email" id="accLoginEmail" placeholder="la-tua-email@esempio.com">
      </div>
      <div class="campo-impostazione">
        <label>Password</label>
        <input type="password" id="accLoginPassword" placeholder="••••••••">
      </div>
      <div class="account-login-azioni">
        <button class="primario" id="btnAccedi">Accedi</button>
        <button class="btn-impostazione" id="btnRegistrati">Crea account</button>
      </div>
      <p class="account-login-errore" id="accLoginErrore"></p>

      <div class="account-login-separatore"><span>oppure</span></div>

      <button class="btn-google" id="btnAccediGoogle">
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.27c-.8.54-1.83.86-3.05.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34C2.44 15.98 5.48 18 9 18z"/><path fill="#FBBC05" d="M3.95 10.69c-.18-.54-.28-1.11-.28-1.69s.1-1.15.28-1.69V4.97H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.03l2.99-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.97l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58z"/></svg>
        Accedi con Google
      </button>

      <p class="account-login-nota">Le tue partite, giocatori e presentazioni restano sempre solo su questo Mac — l'account serve solo per l'accesso e in futuro l'abbonamento.</p>
    </div>
  `;

  const emailInput = document.getElementById('accLoginEmail');
  const passwordInput = document.getElementById('accLoginPassword');
  const erroreEl = document.getElementById('accLoginErrore');

  const mostraErrore = (err) => {
    erroreEl.textContent = tradduciErroreFirebase(err);
  };

  document.getElementById('btnAccedi').addEventListener('click', async () => {
    erroreEl.textContent = '';
    try {
      await firebase.auth().signInWithEmailAndPassword(emailInput.value.trim(), passwordInput.value);
      renderizzaSezioneAccount(cont);
    } catch (err) {
      mostraErrore(err);
    }
  });

  document.getElementById('btnRegistrati').addEventListener('click', async () => {
    erroreEl.textContent = '';
    try {
      await firebase.auth().createUserWithEmailAndPassword(emailInput.value.trim(), passwordInput.value);
      renderizzaSezioneAccount(cont);
    } catch (err) {
      mostraErrore(err);
    }
  });

  document.getElementById('btnAccediGoogle').addEventListener('click', async () => {
    erroreEl.textContent = '';
    const btn = document.getElementById('btnAccediGoogle');
    btn.disabled = true;
    btn.textContent = 'Apro il browser...';

    const esito = await window.api.accediGoogle();
    if (!esito.ok) {
      erroreEl.textContent = esito.errore;
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.27c-.8.54-1.83.86-3.05.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34C2.44 15.98 5.48 18 9 18z"/><path fill="#FBBC05" d="M3.95 10.69c-.18-.54-.28-1.11-.28-1.69s.1-1.15.28-1.69V4.97H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.03l2.99-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.97l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58z"/></svg> Accedi con Google';
      return;
    }

    try {
      const credenziale = firebase.auth.GoogleAuthProvider.credential(esito.idToken);
      await firebase.auth().signInWithCredential(credenziale);
      renderizzaSezioneAccount(cont);
    } catch (err) {
      erroreEl.textContent = tradduciErroreFirebase(err);
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.88 2.69-6.64z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.27c-.8.54-1.83.86-3.05.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34C2.44 15.98 5.48 18 9 18z"/><path fill="#FBBC05" d="M3.95 10.69c-.18-.54-.28-1.11-.28-1.69s.1-1.15.28-1.69V4.97H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.03l2.99-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.97l2.99 2.34C4.66 5.17 6.65 3.58 9 3.58z"/></svg> Accedi con Google';
      console.error('Errore signInWithCredential:', err);
    }
  });
}

// Traduce i codici errore di Firebase Auth in messaggi comprensibili
function tradduciErroreFirebase(err) {
  const codice = err && err.code;
  const mappa = {
    'auth/invalid-email': 'Email non valida.',
    'auth/user-not-found': 'Nessun account con questa email.',
    'auth/wrong-password': 'Password sbagliata.',
    'auth/invalid-credential': 'Email o password sbagliate.',
    'auth/email-already-in-use': 'Esiste già un account con questa email — prova ad accedere invece di registrarti.',
    'auth/weak-password': 'Password troppo corta (minimo 6 caratteri).',
    'auth/network-request-failed': 'Nessuna connessione internet.'
  };
  return mappa[codice] || (err && err.message) || 'Errore imprevisto.';
}

function renderizzaSezioneAbbonamento(cont) {
  cont.innerHTML = `
    <h2>💳 Abbonamento</h2>
    <span class="badge-locale">Versione locale</span>
    <p class="sotto-intro">
      Questa è la versione locale di Handball Analyst: gira interamente sul tuo Mac, senza abbonamenti né pagamenti.
      Tutte le funzionalità sono incluse. Se in futuro arriverà una versione REVOS con servizi cloud
      (sincronizzazione multi-coach, backup online), qui troverai piano, rinnovo, fatture e metodo di pagamento.
    </p>
  `;
}

function renderizzaSezioneVideo(cont) {
  const cartella = impostazioniAppCache.cartella_video_predefinita || '';
  const proxyAttivo = impostazioniAppCache.proxy_attivo === '1';
  const proxyQualita = impostazioniAppCache.proxy_qualita || 'media';
  const exportPreset = impostazioniAppCache.export_preset || 'veryfast';
  const percorsoLabel = cartella || "nessuna impostata (si parte dall'ultima cartella aperta)";

  cont.innerHTML = `
    <h2>🎥 Video</h2>

    <div class="campo-impostazione">
      <label>Cartella video predefinita</label>
      <span class="desc">Punto di partenza quando selezioni un video per una nuova partita.</span>
      <div class="riga-azione">
        <button class="btn-impostazione" id="videoCambiaCartella">Cambia cartella…</button>
        <span class="percorso-attuale">${percorsoLabel}</span>
      </div>
    </div>

    <div class="campo-impostazione">
      <label><input type="checkbox" id="videoProxyAttivo" ${proxyAttivo ? 'checked' : ''}> Genera proxy automaticamente</label>
      <span class="desc">Copia leggera a bassa risoluzione per lavorare più fluido durante l'analisi. <strong>Non ancora attiva in questa versione</strong> — la preferenza viene salvata, la generazione arriverà in un prossimo aggiornamento.</span>
      <select id="videoProxyQualita" ${!proxyAttivo ? 'disabled' : ''}>
        <option value="bassa" ${proxyQualita === 'bassa' ? 'selected' : ''}>Qualità bassa (più veloce)</option>
        <option value="media" ${proxyQualita === 'media' ? 'selected' : ''}>Qualità media</option>
        <option value="alta" ${proxyQualita === 'alta' ? 'selected' : ''}>Qualità alta</option>
      </select>
    </div>

    <div class="campo-impostazione">
      <label>Cache export</label>
      <span class="desc">File temporanei creati durante l'esportazione delle presentazioni.</span>
      <div class="riga-azione">
        <span class="percorso-attuale" id="cacheInfo">calcolo in corso…</span>
        <button class="btn-impostazione pericolo" id="btnSvuotaCache">Svuota cache</button>
      </div>
    </div>

    <div class="campo-impostazione">
      <label>Qualità esportazione</label>
      <span class="desc">Compromesso velocità/qualità per i video esportati dalle presentazioni.</span>
      <select id="videoExportPreset">
        <option value="ultrafast" ${exportPreset === 'ultrafast' ? 'selected' : ''}>Più veloce (file più pesante)</option>
        <option value="veryfast" ${exportPreset === 'veryfast' ? 'selected' : ''}>Veloce (consigliato)</option>
        <option value="medium" ${exportPreset === 'medium' ? 'selected' : ''}>Bilanciato</option>
        <option value="slow" ${exportPreset === 'slow' ? 'selected' : ''}>Qualità migliore (più lento)</option>
      </select>
    </div>
  `;

  document.getElementById('videoCambiaCartella').addEventListener('click', async () => {
    const cartellaScelta = await window.api.sceglieCartellaVideo();
    if (!cartellaScelta) return;
    await window.api.scriviImpostazioneApp({ chiave: 'cartella_video_predefinita', valore: cartellaScelta });
    impostazioniAppCache.cartella_video_predefinita = cartellaScelta;
    renderizzaSezioneVideo(cont);
  });

  document.getElementById('videoProxyAttivo').addEventListener('change', async (e) => {
    await window.api.scriviImpostazioneApp({ chiave: 'proxy_attivo', valore: e.target.checked ? '1' : '0' });
    impostazioniAppCache.proxy_attivo = e.target.checked ? '1' : '0';
    renderizzaSezioneVideo(cont);
  });
  document.getElementById('videoProxyQualita').addEventListener('change', async (e) => {
    await window.api.scriviImpostazioneApp({ chiave: 'proxy_qualita', valore: e.target.value });
    impostazioniAppCache.proxy_qualita = e.target.value;
  });
  document.getElementById('videoExportPreset').addEventListener('change', async (e) => {
    await window.api.scriviImpostazioneApp({ chiave: 'export_preset', valore: e.target.value });
    impostazioniAppCache.export_preset = e.target.value;
  });

  window.api.dimensioneCache().then(({ byte, numeroCartelle }) => {
    const mb = (byte / (1024 * 1024)).toFixed(1);
    const info = document.getElementById('cacheInfo');
    if (info) info.textContent = `${mb} MB in ${numeroCartelle} cartelle temporanee`;
  });

  document.getElementById('btnSvuotaCache').addEventListener('click', async () => {
    await window.api.svuotaCache();
    document.getElementById('statoSalvataggio').textContent = 'Cache svuotata';
    renderizzaSezioneVideo(cont);
  });
}

function renderizzaSezionePrivacy(cont) {
  cont.innerHTML = `
    <h2>🔐 Privacy &amp; Sicurezza</h2>
    <span class="badge-locale">Versione locale</span>

    <div class="campo-impostazione">
      <label>Password</label>
      <span class="nota-non-disponibile">Non applicabile: nessun account online in questa versione</span>
    </div>
    <div class="campo-impostazione">
      <label>Dispositivi collegati / Sessioni</label>
      <span class="nota-non-disponibile">Richiede un account REVOS online — non disponibile in locale</span>
    </div>
    <div class="campo-impostazione">
      <label>Dove sono i tuoi dati</label>
      <span class="desc">Partite, tag, giocatori e presentazioni restano solo su questo Mac, in un database locale. Nessun dato viene inviato a server esterni.</span>
    </div>
    <div class="campo-impostazione">
      <label>Rimuovi tag doppioni</label>
      <span class="desc">Se noti categorie o tag ripetuti (es. due cartelle "In Attacco"), unisce i doppioni in uno solo. Non tocca partite, eventi, giocatori o presentazioni — se un evento era taggato sia col doppione che con l'originale, i due si uniscono in uno solo, non si perde nulla.</span>
      <div class="riga-azione">
        <button class="btn-impostazione" id="btnRimuoviDoppioni">🧹 Rimuovi tag doppioni</button>
        <span id="esitoDoppioni" class="desc"></span>
      </div>
    </div>
    <div class="campo-impostazione">
      <label>Elimina tutti i dati locali</label>
      <span class="desc">Cancella per sempre partite, eventi, giocatori, presentazioni e tag personalizzati. I tag tornano ai valori di default.</span>
      <div class="riga-azione">
        <button class="btn-impostazione pericolo" id="btnEliminaDatiLocali">🗑 Elimina tutti i dati locali</button>
      </div>
    </div>
  `;

  document.getElementById('btnRimuoviDoppioni').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Controllo in corso…';
    const rimossi = await window.api.rimuoviTagDoppioni();
    e.target.disabled = false;
    e.target.textContent = '🧹 Rimuovi tag doppioni';
    document.getElementById('esitoDoppioni').textContent = rimossi > 0
      ? `Trovati e uniti ${rimossi} doppioni.`
      : 'Nessun doppione trovato, tutto pulito.';
    document.getElementById('statoSalvataggio').textContent = 'Controllo doppioni completato';
  });

  document.getElementById('btnEliminaDatiLocali').addEventListener('click', () => {
    document.getElementById('resetConfermaInput').value = '';
    document.getElementById('modalConfermaReset').classList.add('active');
  });
}

function renderizzaSezioneSupporto(cont) {
  cont.innerHTML = `
    <h2>❓ Supporto</h2>
    <div class="campo-impostazione">
      <label>Guida</label>
      <span class="desc">In arrivo.</span>
    </div>
    <div class="campo-impostazione">
      <label>Tutorial</label>
      <span class="desc">In arrivo.</span>
    </div>
    <div class="campo-impostazione">
      <label>Contatta assistenza</label>
      <span class="desc">Da configurare quando avrai un indirizzo email di supporto dedicato.</span>
    </div>
    <div class="campo-impostazione">
      <label>Segnala un problema</label>
      <span class="desc">In arrivo.</span>
    </div>
  `;
}

function renderizzaSezioneInfo(cont) {
  cont.innerHTML = `
    <h2>ℹ️ Informazioni</h2>
    <div class="campo-impostazione">
      <label>Versione REVOS Handball Analyst</label>
      <span class="desc" id="infoVersione">caricamento…</span>
    </div>
    <div class="campo-impostazione">
      <label>Aggiornamenti</label>
      <span class="nota-non-disponibile">Controllo automatico non disponibile in questa versione locale</span>
    </div>
    <div class="campo-impostazione">
      <label>Licenze open source</label>
      <ul class="lista-licenze">
        <li>Electron</li>
        <li>better-sqlite3</li>
        <li>ffmpeg-static / FFmpeg</li>
        <li>fluent-ffmpeg</li>
      </ul>
    </div>
    <div class="campo-impostazione">
      <label>Termini e Privacy</label>
      <span class="desc">In preparazione.</span>
    </div>
  `;

  window.api.versioneApp().then(v => {
    const el = document.getElementById('infoVersione');
    if (el) el.textContent = `v${v}`;
  });
}

// --- Conferma eliminazione dati locali ---
document.getElementById('resetAnnulla').addEventListener('click', () => {
  document.getElementById('modalConfermaReset').classList.remove('active');
});
document.getElementById('resetConferma').addEventListener('click', async () => {
  const testo = document.getElementById('resetConfermaInput').value.trim();
  if (testo !== 'ELIMINA') { alert('Scrivi ELIMINA (tutto maiuscolo) per confermare.'); return; }

  await window.api.eliminaTuttiDatiLocali();
  document.getElementById('modalConfermaReset').classList.remove('active');

  // ricarico l'intera app: è il modo più sicuro per azzerare tutte le
  // variabili in memoria delle altre viste dopo un reset totale dei dati
  location.reload();
});
