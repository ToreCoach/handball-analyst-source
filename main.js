const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');
const { getDb, initDb } = require('./db');
const { esportaPresentazione } = require('./export');
const { verificaLicenza } = require('./licenza');
const { accediConGoogle, impostaGoogleClientId, impostaGoogleClientSecret } = require('./auth-google');

let mainWindow;

// Rete di sicurezza: qualsiasi errore imprevisto nel processo principale (non
// nella pagina, quello lo vede già la Console sviluppatori) altrimenti lascia
// l'app aperta ma invisibile, senza finestra né alcun indizio del perché.
process.on('uncaughtException', (err) => {
  dialog.showErrorBox(
    'Errore imprevisto in Handball Analyst',
    'Dettagli tecnici (mandali a chi ti segue per l\'assistenza):\n' + (err && err.stack ? err.stack : err)
  );
});

// Segnaposto: sostituito con l'ID vero preso da Google Cloud Console
// (Credenziali → ID client OAuth → tipo "App desktop") quando pronto.
impostaGoogleClientId('1021442407572-4u51uc0u8ov25s0nmmccnrk1l3n7isqg.apps.googleusercontent.com');
impostaGoogleClientSecret('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');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 960,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Cmd+Option+I (o Ctrl+Shift+I su Windows) apre la Console sviluppatori —
  // utile per diagnosticare problemi, non collegato di default da Electron
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    const combinazione = (input.meta && input.alt && input.key.toLowerCase() === 'i')
      || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (combinazione) mainWindow.webContents.toggleDevTools();
  });
}

app.whenReady().then(() => {
  try {
    initDb(); // crea/apre il DB SQLite locale e applica schema + seed al primo avvio
  } catch (err) {
    // Senza questo avviso, un errore qui lascia l'app aperta ma invisibile:
    // nessuna finestra, nessun crash registrato da macOS, nessun indizio —
    // sembra semplicemente che "non si apra". Meglio mostrarlo subito.
    dialog.showErrorBox(
      'Errore all\'avvio di Handball Analyst',
      'Non sono riuscito ad aprire il database dei tuoi dati.\n\n' +
      'Dettagli tecnici (mandali a chi ti segue per l\'assistenza):\n' + (err && err.stack ? err.stack : err)
    );
    app.quit();
    return;
  }
  createWindow();

  // Aggiornamenti automatici: solo nell'app pacchettizzata (con npm start,
  // in sviluppo, non ha senso — e "electron-updater" darebbe solo errori
  // perché non trova i metadati di release che genera electron-builder)
  if (app.isPackaged) {
    controllaAggiornamenti();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// -------------------------------------------------------
// AGGIORNAMENTI AUTOMATICI (electron-updater + GitHub Releases privato)
// -------------------------------------------------------
function controllaAggiornamenti() {
  autoUpdater.autoDownload = true; // scarica da solo appena trova una versione nuova
  autoUpdater.autoInstallOnAppQuit = false; // non installare di nascosto alla chiusura: chiedo conferma

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('aggiornamento:disponibile', { versione: info.version });
  });

  autoUpdater.on('download-progress', (progresso) => {
    mainWindow.webContents.send('aggiornamento:progresso', { percento: Math.round(progresso.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('aggiornamento:pronto', { versione: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('Errore controllo aggiornamenti:', err.message);
    mainWindow.webContents.send('aggiornamento:errore', { messaggio: err.message });
  });

  autoUpdater.checkForUpdates();
}

ipcMain.handle('aggiornamento:installaOra', () => {
  autoUpdater.quitAndInstall();
});

// -------------------------------------------------------
// Alberatura tag: una categoria contiene tag e/o cartelle; le cartelle
// contengono a loro volta altre voci (anche cartelle, a qualsiasi livello).
// -------------------------------------------------------
function costruisciAlberoTag(righeTag) {
  const perId = new Map(righeTag.map(t => [t.id, { ...t, children: [] }]));
  const radici = [];
  righeTag.forEach(t => {
    const nodo = perId.get(t.id);
    if (t.genitore_id && perId.has(t.genitore_id)) perId.get(t.genitore_id).children.push(nodo);
    else radici.push(nodo);
  });
  return radici;
}

// Rimuove i rami (cartella + tutto il suo contenuto) che partono da un nodo disattivato
function potaRamiInattivi(nodi) {
  return nodi.filter(n => n.attivo).map(n => ({ ...n, children: potaRamiInattivi(n.children) }));
}

// -------------------------------------------------------
// PANNELLI TAG: raccolte di categorie con un nome (es. "Partita",
// "Didattica"), per scegliere in Analisi quale set di tag usare
// -------------------------------------------------------
ipcMain.handle('pannelli:elenco', () => {
  return getDb().prepare('SELECT * FROM pannelli_tag ORDER BY ordine').all();
});

ipcMain.handle('pannelli:crea', (_e, nome) => {
  const database = getDb();
  const maxOrdine = database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM pannelli_tag').get().m;
  return database.prepare('INSERT INTO pannelli_tag (nome, ordine) VALUES (?, ?)').run(nome, maxOrdine + 1).lastInsertRowid;
});

ipcMain.handle('pannelli:rinomina', (_e, { id, nome }) => {
  getDb().prepare('UPDATE pannelli_tag SET nome = ? WHERE id = ?').run(nome, id);
});

// Non permette di eliminare l'ultimo pannello rimasto: Analisi ha sempre
// bisogno di almeno un pannello da mostrare
ipcMain.handle('pannelli:elimina', (_e, id) => {
  const database = getDb();
  const totale = database.prepare('SELECT COUNT(*) AS n FROM pannelli_tag').get().n;
  if (totale <= 1) return { errore: 'Non puoi eliminare l\'ultimo pannello rimasto.' };

  database.prepare('DELETE FROM pannelli_tag WHERE id = ?').run(id); // cascata su categorie_tag, tag, evento_tag
  return { ok: true };
});

// -------------------------------------------------------
// IPC: lettura categorie/tag per costruire il pannello di tagging (solo attivi)
// -------------------------------------------------------
ipcMain.handle('tags:getAll', (_e, pannelloId) => {
  const categorie = getDb().prepare(
    'SELECT * FROM categorie_tag WHERE attiva = 1 AND pannello_id = ? ORDER BY ordine'
  ).all(pannelloId);

  const tagStmt = getDb().prepare('SELECT * FROM tag WHERE categoria_id = ? ORDER BY ordine');

  return categorie.map(cat => ({
    ...cat,
    tag: potaRamiInattivi(costruisciAlberoTag(tagStmt.all(cat.id)))
  }));
});

// Elenco leggero delle categorie attive di TUTTI i pannelli (senza l'albero
// dei tag), per la riga "ordina per tag" nella vista Eventi — lì ha senso
// vedere tutte le categorie usate nel tempo, non solo quelle del pannello
// attualmente selezionato in Analisi
ipcMain.handle('categorie:elenco', () => {
  return getDb().prepare('SELECT * FROM categorie_tag WHERE attiva = 1 ORDER BY ordine').all();
});

// =========================================================
// GESTIONE TAG (Impostazioni): ogni coach personalizza il proprio pannello
// =========================================================

// Elenco COMPLETO di UN pannello (anche categorie/tag disattivati), per la schermata di gestione
ipcMain.handle('tags:getAllPerGestione', (_e, pannelloId) => {
  const categorie = getDb().prepare('SELECT * FROM categorie_tag WHERE pannello_id = ? ORDER BY ordine').all(pannelloId);
  const tagStmt = getDb().prepare('SELECT * FROM tag WHERE categoria_id = ? ORDER BY ordine');
  return categorie.map(cat => ({ ...cat, tag: costruisciAlberoTag(tagStmt.all(cat.id)) }));
});

ipcMain.handle('categorie:crea', (_e, { pannelloId, nome, gruppo }) => {
  const database = getDb();
  const maxOrdine = database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM categorie_tag WHERE pannello_id = ?').get(pannelloId).m;
  return database.prepare(
    'INSERT INTO categorie_tag (pannello_id, nome, gruppo, ordine, is_default, attiva) VALUES (?, ?, ?, ?, 0, 1)'
  ).run(pannelloId, nome, gruppo || 'generale', maxOrdine + 1).lastInsertRowid;
});

ipcMain.handle('categorie:toggleAttiva', (_e, { id, attiva }) => {
  getDb().prepare('UPDATE categorie_tag SET attiva = ? WHERE id = ?').run(attiva ? 1 : 0, id);
});

// Crea un tag o una cartella. genitore_id nullo = voce di primo livello nella categoria;
// valorizzato = voce dentro quella cartella (a qualsiasi profondità).
ipcMain.handle('tag:crea', (_e, { categoria_id, genitore_id, nome, colore, e_cartella }) => {
  const database = getDb();
  const maxOrdine = genitore_id
    ? database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM tag WHERE categoria_id = ? AND genitore_id = ?').get(categoria_id, genitore_id).m
    : database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM tag WHERE categoria_id = ? AND genitore_id IS NULL').get(categoria_id).m;

  return database.prepare(`
    INSERT INTO tag (categoria_id, genitore_id, e_cartella, nome, colore, ordine, is_default, attivo)
    VALUES (?, ?, ?, ?, ?, ?, 0, 1)
  `).run(categoria_id, genitore_id || null, e_cartella ? 1 : 0, nome, e_cartella ? null : (colore || null), maxOrdine + 1).lastInsertRowid;
});

ipcMain.handle('tag:toggleAttivo', (_e, { id, attivo }) => {
  getDb().prepare('UPDATE tag SET attivo = ? WHERE id = ?').run(attivo ? 1 : 0, id);
});

// Per una categoria vuota usata come flag rapido (es. "Attacco"/"Difesa" senza
// sottovoci): al primo click nel pannello di tagging, crea un tag col suo
// stesso nome così diventa selezionabile. Se esiste già, lo riusa.
ipcMain.handle('tag:creaOTrovaPerCategoria', (_e, categoriaId) => {
  const database = getDb();
  const cat = database.prepare('SELECT * FROM categorie_tag WHERE id = ?').get(categoriaId);
  if (!cat) return null;

  const esistente = database.prepare(
    'SELECT id FROM tag WHERE categoria_id = ? AND genitore_id IS NULL AND nome = ?'
  ).get(categoriaId, cat.nome);
  if (esistente) return esistente.id;

  return database.prepare(
    'INSERT INTO tag (categoria_id, nome, ordine, is_default, attivo) VALUES (?, ?, 0, 0, 1)'
  ).run(categoriaId, cat.nome).lastInsertRowid;
});

// Sposta un tag/cartella su/giù TRA I SUOI FRATELLI (stessa categoria E stesso genitore)
ipcMain.handle('tag:spostaOrdine', (_e, { id, direzione }) => {
  const database = getDb();
  const t = database.prepare('SELECT * FROM tag WHERE id = ?').get(id);
  if (!t) return;

  const filtroGenitore = t.genitore_id ? 'genitore_id = ?' : 'genitore_id IS NULL';
  const paramsFratelli = t.genitore_id ? [t.categoria_id, t.genitore_id] : [t.categoria_id];

  const vicino = direzione === 'su'
    ? database.prepare(`SELECT * FROM tag WHERE categoria_id = ? AND ${filtroGenitore} AND ordine < ? ORDER BY ordine DESC LIMIT 1`).get(...paramsFratelli, t.ordine)
    : database.prepare(`SELECT * FROM tag WHERE categoria_id = ? AND ${filtroGenitore} AND ordine > ? ORDER BY ordine ASC LIMIT 1`).get(...paramsFratelli, t.ordine);
  if (!vicino) return;

  const transazione = database.transaction(() => {
    database.prepare('UPDATE tag SET ordine = ? WHERE id = ?').run(vicino.ordine, t.id);
    database.prepare('UPDATE tag SET ordine = ? WHERE id = ?').run(t.ordine, vicino.id);
  });
  transazione();
});

// Sposta una categoria su/giù, scambiando "ordine" con la vicina — SOLO
// dentro lo stesso pannello, altrimenti rischia di scambiarsi con una
// categoria di un pannello completamente diverso
ipcMain.handle('categorie:spostaOrdine', (_e, { id, direzione }) => {
  const database = getDb();
  const cat = database.prepare('SELECT * FROM categorie_tag WHERE id = ?').get(id);
  if (!cat) return;

  const vicina = direzione === 'su'
    ? database.prepare('SELECT * FROM categorie_tag WHERE pannello_id = ? AND ordine < ? ORDER BY ordine DESC LIMIT 1').get(cat.pannello_id, cat.ordine)
    : database.prepare('SELECT * FROM categorie_tag WHERE pannello_id = ? AND ordine > ? ORDER BY ordine ASC LIMIT 1').get(cat.pannello_id, cat.ordine);
  if (!vicina) return;

  const transazione = database.transaction(() => {
    database.prepare('UPDATE categorie_tag SET ordine = ? WHERE id = ?').run(vicina.ordine, cat.id);
    database.prepare('UPDATE categorie_tag SET ordine = ? WHERE id = ?').run(cat.ordine, vicina.id);
  });
  transazione();
});

// Elimina una categoria (in cascata: tutti i suoi tag/cartelle e i
// collegamenti evento_tag che li usavano — gli eventi restano, solo quei
// tag specifici non sono più agganciati)
ipcMain.handle('categorie:elimina', (_e, id) => {
  getDb().prepare('DELETE FROM categorie_tag WHERE id = ?').run(id);
});

ipcMain.handle('categorie:rinomina', (_e, { id, nome, gruppo }) => {
  getDb().prepare('UPDATE categorie_tag SET nome = ?, gruppo = ? WHERE id = ?').run(nome, gruppo, id);
});

// Elimina un tag o una cartella (in cascata: se è una cartella, anche tutto
// il suo contenuto annidato, a qualsiasi profondità)
ipcMain.handle('tag:elimina', (_e, id) => {
  getDb().prepare('DELETE FROM tag WHERE id = ?').run(id);
});

ipcMain.handle('tag:rinomina', (_e, { id, nome, colore }) => {
  getDb().prepare('UPDATE tag SET nome = ?, colore = ? WHERE id = ?').run(nome, colore || null, id);
});

// Sposta un tag/cartella dentro un'altra cartella (o al primo livello) DELLA STESSA CATEGORIA
// Sposta un tag/cartella dentro un'altra cartella (o al primo livello),
// eventualmente anche in una CATEGORIA diversa da quella di partenza.
// Se è una cartella, propaga il cambio di categoria a tutto il contenuto annidato.
ipcMain.handle('tag:spostaGenitore', (_e, { id, categoria_id, genitore_id }) => {
  const database = getDb();
  const t = database.prepare('SELECT * FROM tag WHERE id = ?').get(id);
  if (!t) return;

  const categoriaFinale = categoria_id || t.categoria_id;

  const maxOrdine = genitore_id
    ? database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM tag WHERE categoria_id = ? AND genitore_id = ?').get(categoriaFinale, genitore_id).m
    : database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM tag WHERE categoria_id = ? AND genitore_id IS NULL').get(categoriaFinale).m;

  const transazione = database.transaction(() => {
    database.prepare('UPDATE tag SET categoria_id = ?, genitore_id = ?, ordine = ? WHERE id = ?')
      .run(categoriaFinale, genitore_id || null, maxOrdine + 1, id);

    if (categoriaFinale !== t.categoria_id) {
      const propaga = (genitoreId) => {
        const figli = database.prepare('SELECT id FROM tag WHERE genitore_id = ?').all(genitoreId);
        figli.forEach(f => {
          database.prepare('UPDATE tag SET categoria_id = ? WHERE id = ?').run(categoriaFinale, f.id);
          propaga(f.id);
        });
      };
      propaga(id);
    }
  });
  transazione();
});


// -------------------------------------------------------
// IPC: crea un evento con intervallo Z/M (inizio_sec/fine_sec) e i tag scelti
// -------------------------------------------------------
ipcMain.handle('eventi:crea', (_e, { partita_id, inizio_sec, fine_sec, squadra_riferimento_id, giocatore_id, note, tagIds }) => {
  const database = getDb();
  const insertEvento = database.prepare(`
    INSERT INTO eventi (partita_id, inizio_sec, fine_sec, squadra_riferimento_id, giocatore_id, note, ordine)
    VALUES (@partita_id, @inizio_sec, @fine_sec, @squadra_riferimento_id, @giocatore_id, @note, @ordine)
  `);
  const insertTag = database.prepare('INSERT INTO evento_tag (evento_id, tag_id) VALUES (?, ?)');

  const transazione = database.transaction((payload) => {
    const maxOrdine = database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM eventi WHERE partita_id = ?').get(payload.partita_id).m;
    const info = insertEvento.run({ ...payload, ordine: maxOrdine + 1 });
    const eventoId = info.lastInsertRowid;
    for (const tagId of payload.tagIds || []) {
      insertTag.run(eventoId, tagId);
    }
    return eventoId;
  });

  return transazione({ partita_id, inizio_sec, fine_sec, squadra_riferimento_id, giocatore_id, note, tagIds });
});

// -------------------------------------------------------
// IPC: elenco eventi di UNA partita, con i tag aggregati (per l'archivio "Eventi")
// -------------------------------------------------------
ipcMain.handle('eventi:elencoPerPartita', (_e, partitaId) => {
  const database = getDb();
  const eventi = database.prepare(`
    SELECT e.id, e.inizio_sec, e.fine_sec, e.note, e.ordine,
           s.nome AS squadra_riferimento_nome,
           g.nome AS giocatore_nome, g.cognome AS giocatore_cognome
    FROM eventi e
    LEFT JOIN squadre s ON s.id = e.squadra_riferimento_id
    LEFT JOIN giocatori g ON g.id = e.giocatore_id
    WHERE e.partita_id = ?
    ORDER BY e.ordine
  `).all(partitaId);

  const tagStmt = database.prepare(`
    SELECT t.id, t.nome, t.ordine AS tag_ordine, c.id AS categoria_id, c.nome AS categoria, c.gruppo
    FROM evento_tag et
    JOIN tag t ON t.id = et.tag_id
    JOIN categorie_tag c ON c.id = t.categoria_id
    WHERE et.evento_id = ?
    ORDER BY c.ordine, t.ordine
  `);

  return eventi.map(ev => ({ ...ev, tag: tagStmt.all(ev.id) }));
});

// Sposta un evento su/giù nella lista, scambiando "ordine" col vicino
// Scambia l'ordine tra DUE eventi specifici (quelli visivamente adiacenti
// nella lista che l'utente sta guardando in quel momento — funziona anche
// con un ordinamento per categoria o un filtro squadra attivi, perché non
// presuppone nessun ordine particolare: scambia solo i due indicati)
ipcMain.handle('eventi:scambiaOrdine', (_e, { eventoIdA, eventoIdB }) => {
  const database = getDb();
  const a = database.prepare('SELECT id, ordine FROM eventi WHERE id = ?').get(eventoIdA);
  const b = database.prepare('SELECT id, ordine FROM eventi WHERE id = ?').get(eventoIdB);
  if (!a || !b) return;

  const transazione = database.transaction(() => {
    database.prepare('UPDATE eventi SET ordine = ? WHERE id = ?').run(b.ordine, a.id);
    database.prepare('UPDATE eventi SET ordine = ? WHERE id = ?').run(a.ordine, b.id);
  });
  transazione();
});

// Modifica la nota di un evento già creato (dalla vista Eventi)
ipcMain.handle('eventi:aggiornaNota', (_e, { eventoId, note }) => {
  getDb().prepare('UPDATE eventi SET note = ? WHERE id = ?').run(note || null, eventoId);
});

// Riassegna l'ordine di TUTTI gli eventi di una partita in base all'elenco di
// id passato (nell'ordine desiderato) — usato per spostare su/giù un intero
// gruppo di eventi selezionati insieme, non solo uno alla volta
ipcMain.handle('eventi:riordinaGruppo', (_e, eventoIdsInOrdine) => {
  const database = getDb();
  const aggiorna = database.prepare('UPDATE eventi SET ordine = ? WHERE id = ?');
  const transazione = database.transaction((ids) => {
    ids.forEach((id, indice) => aggiorna.run(indice + 1, id));
  });
  transazione(eventoIdsInOrdine);
});

// -------------------------------------------------------
// IPC: filtro eventi di una partita per uno o più tag
// -------------------------------------------------------
ipcMain.handle('eventi:filtra', (_e, { partita_id, tagIds }) => {
  const database = getDb();
  if (!tagIds || tagIds.length === 0) {
    return database.prepare('SELECT * FROM eventi WHERE partita_id = ? ORDER BY inizio_sec').all(partita_id);
  }
  const placeholders = tagIds.map(() => '?').join(',');
  return database.prepare(`
    SELECT e.* FROM eventi e
    WHERE e.partita_id = ?
      AND (SELECT COUNT(DISTINCT et.tag_id) FROM evento_tag et
           WHERE et.evento_id = e.id AND et.tag_id IN (${placeholders})) = ?
    ORDER BY e.inizio_sec
  `).all(partita_id, ...tagIds, tagIds.length);
});

// -------------------------------------------------------
// IPC: opzioni per i menu a tendina dell'Archivio
// -------------------------------------------------------
ipcMain.handle('archivio:opzioniFiltri', () => {
  const database = getDb();
  return {
    stagioni: database.prepare('SELECT * FROM stagioni ORDER BY label DESC').all(),
    squadre: database.prepare('SELECT * FROM squadre ORDER BY nome').all(),
    competizioni: database.prepare(
      "SELECT DISTINCT competizione FROM partite WHERE competizione IS NOT NULL ORDER BY competizione"
    ).all().map(r => r.competizione)
  };
});

// -------------------------------------------------------
// IPC: elenco partite filtrato, con conteggi eventi/tiri/gol
// -------------------------------------------------------
ipcMain.handle('archivio:elencoPartite', (_e, filtri = {}) => {
  const database = getDb();
  const { stagione_id, squadra_id, competizione, avversario_id, ricerca } = filtri;

  const condizioni = [];
  const params = {};

  if (stagione_id) { condizioni.push('p.stagione_id = @stagione_id'); params.stagione_id = stagione_id; }
  if (squadra_id) { condizioni.push('(p.squadra_casa_id = @squadra_id OR p.squadra_ospite_id = @squadra_id)'); params.squadra_id = squadra_id; }
  if (competizione) { condizioni.push('p.competizione = @competizione'); params.competizione = competizione; }
  if (avversario_id) { condizioni.push('(p.squadra_casa_id = @avversario_id OR p.squadra_ospite_id = @avversario_id)'); params.avversario_id = avversario_id; }
  if (ricerca) { condizioni.push("(sc.nome LIKE @ricerca OR so.nome LIKE @ricerca)"); params.ricerca = `%${ricerca}%`; }

  const whereSql = condizioni.length ? `WHERE ${condizioni.join(' AND ')}` : '';

  const partite = database.prepare(`
    SELECT
      p.id, p.data, p.competizione, p.risultato_casa, p.risultato_ospite,
      sc.nome AS squadra_casa, so.nome AS squadra_ospite,
      (SELECT COUNT(*) FROM eventi e WHERE e.partita_id = p.id) AS n_eventi,
      (SELECT COUNT(*) FROM eventi e
         JOIN evento_tag et ON et.evento_id = e.id
         JOIN tag t ON t.id = et.tag_id
         JOIN categorie_tag c ON c.id = t.categoria_id
         WHERE e.partita_id = p.id AND c.nome = 'Tipologia tiro') AS n_tiri,
      (SELECT COUNT(*) FROM eventi e
         JOIN evento_tag et ON et.evento_id = e.id
         JOIN tag t ON t.id = et.tag_id
         JOIN categorie_tag c ON c.id = t.categoria_id
         WHERE e.partita_id = p.id AND c.nome = 'Esito' AND t.nome = 'Goal') AS n_gol
    FROM partite p
    JOIN squadre sc ON sc.id = p.squadra_casa_id
    JOIN squadre so ON so.id = p.squadra_ospite_id
    ${whereSql}
    ORDER BY p.data DESC
  `).all(params);

  const totali = partite.reduce((acc, p) => ({
    partite: acc.partite + 1,
    eventi: acc.eventi + p.n_eventi,
    tiri: acc.tiri + p.n_tiri,
    gol: acc.gol + p.n_gol
  }), { partite: 0, eventi: 0, tiri: 0, gol: 0 });

  return { partite, totali };
});

// -------------------------------------------------------
// IPC: ricerca cross-partita ("tutti i gol ala destra vs 5:1
// nelle ultime 10 partite", "7vs6 contro Cassano ultime 3 stagioni"...)
// -------------------------------------------------------
ipcMain.handle('eventi:ricercaGlobale', (_e, filtri = {}) => {
  const database = getDb();
  const { tagIds = [], squadra_id, avversario_id, stagione_ids = [], ultimeNPartite } = filtri;

  const condizioniPartite = [];
  const paramsPartite = {};

  if (squadra_id) { condizioniPartite.push('(p.squadra_casa_id = @squadra_id OR p.squadra_ospite_id = @squadra_id)'); paramsPartite.squadra_id = squadra_id; }
  if (avversario_id) { condizioniPartite.push('(p.squadra_casa_id = @avversario_id OR p.squadra_ospite_id = @avversario_id)'); paramsPartite.avversario_id = avversario_id; }
  if (stagione_ids.length) {
    condizioniPartite.push(`p.stagione_id IN (${stagione_ids.map((_, i) => `@st${i}`).join(',')})`);
    stagione_ids.forEach((id, i) => { paramsPartite[`st${i}`] = id; });
  }

  const whereSql = condizioniPartite.length ? `WHERE ${condizioniPartite.join(' AND ')}` : '';
  const limitSql = ultimeNPartite ? `LIMIT ${Number(ultimeNPartite)}` : '';

  const partite = database.prepare(`
    SELECT p.id FROM partite p ${whereSql} ORDER BY p.data DESC ${limitSql}
  `).all(paramsPartite);

  if (partite.length === 0) return [];
  const partitaIds = partite.map(p => p.id);
  const placeholdersPartite = partitaIds.map(() => '?').join(',');

  let sql = `
    SELECT
      e.id, e.inizio_sec, e.fine_sec, e.note,
      p.id AS partita_id, p.video_path, p.proxy_path, p.data,
      sc.nome AS squadra_casa, so.nome AS squadra_ospite
    FROM eventi e
    JOIN partite p ON p.id = e.partita_id
    JOIN squadre sc ON sc.id = p.squadra_casa_id
    JOIN squadre so ON so.id = p.squadra_ospite_id
    WHERE e.partita_id IN (${placeholdersPartite})
  `;
  const params = [...partitaIds];

  if (tagIds.length > 0) {
    const placeholdersTag = tagIds.map(() => '?').join(',');
    sql += `
      AND (SELECT COUNT(DISTINCT et.tag_id) FROM evento_tag et
           WHERE et.evento_id = e.id AND et.tag_id IN (${placeholdersTag})) = ?
    `;
    params.push(...tagIds, tagIds.length);
  }

  sql += ' ORDER BY p.data DESC, e.inizio_sec';

  return database.prepare(sql).all(...params);
});

// -------------------------------------------------------
// IPC: crea-o-trova squadra/stagione (evita duplicati per nome)
// -------------------------------------------------------
ipcMain.handle('squadre:creaOTrova', (_e, nome) => {
  const database = getDb();
  const esistente = database.prepare('SELECT id FROM squadre WHERE nome = ?').get(nome);
  if (esistente) return esistente.id;
  return database.prepare('INSERT INTO squadre (nome) VALUES (?)').run(nome).lastInsertRowid;
});

ipcMain.handle('stagioni:creaOTrova', (_e, label) => {
  const database = getDb();
  const esistente = database.prepare('SELECT id FROM stagioni WHERE label = ?').get(label);
  if (esistente) return esistente.id;
  return database.prepare('INSERT INTO stagioni (label) VALUES (?)').run(label).lastInsertRowid;
});

// =========================================================
// SQUADRE (con categoria/rosa) E GIOCATORI
// =========================================================

ipcMain.handle('squadre:elenco', () => {
  return getDb().prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM giocatori g WHERE g.squadra_id = s.id) AS n_giocatori
    FROM squadre s ORDER BY s.nome, s.categoria
  `).all();
});

// Crea esplicitamente una squadra con la sua categoria (usata dalla schermata Giocatori,
// per avere una rosa distinta per ogni categoria dello stesso nome, es. Modena Serie A / Modena U18)
ipcMain.handle('squadre:crea', (_e, { nome, categoria }) => {
  return getDb().prepare('INSERT INTO squadre (nome, categoria) VALUES (?, ?)').run(nome, categoria || null).lastInsertRowid;
});

ipcMain.handle('squadre:elimina', (_e, id) => {
  const database = getDb();

  const numeroPartite = database.prepare(
    'SELECT COUNT(*) AS n FROM partite WHERE squadra_casa_id = ? OR squadra_ospite_id = ?'
  ).get(id, id).n;

  if (numeroPartite > 0) {
    return { ok: false, numeroPartite };
  }

  database.prepare('DELETE FROM squadre WHERE id = ?').run(id);
  return { ok: true };
});

ipcMain.handle('giocatori:elencoPerSquadra', (_e, squadraId) => {
  return getDb().prepare('SELECT * FROM giocatori WHERE squadra_id = ? ORDER BY ordine').all(squadraId);
});

ipcMain.handle('giocatori:crea', (_e, { squadra_id, nome, cognome, ruolo, numero }) => {
  const database = getDb();
  const maxOrdine = database.prepare('SELECT COALESCE(MAX(ordine), 0) AS m FROM giocatori WHERE squadra_id = ?').get(squadra_id).m;
  return database.prepare(`
    INSERT INTO giocatori (squadra_id, nome, cognome, ruolo, numero, ordine) VALUES (?, ?, ?, ?, ?, ?)
  `).run(squadra_id, nome, cognome || null, ruolo || null, numero || null, maxOrdine + 1).lastInsertRowid;
});

// Sposta un giocatore su/giù nella rosa, scambiando "ordine" con il vicino
// (solo dentro la stessa squadra)
ipcMain.handle('giocatori:spostaOrdine', (_e, { id, direzione }) => {
  const database = getDb();
  const g = database.prepare('SELECT * FROM giocatori WHERE id = ?').get(id);
  if (!g) return;

  const vicino = direzione === 'su'
    ? database.prepare('SELECT * FROM giocatori WHERE squadra_id = ? AND ordine < ? ORDER BY ordine DESC LIMIT 1').get(g.squadra_id, g.ordine)
    : database.prepare('SELECT * FROM giocatori WHERE squadra_id = ? AND ordine > ? ORDER BY ordine ASC LIMIT 1').get(g.squadra_id, g.ordine);
  if (!vicino) return;

  const transazione = database.transaction(() => {
    database.prepare('UPDATE giocatori SET ordine = ? WHERE id = ?').run(vicino.ordine, g.id);
    database.prepare('UPDATE giocatori SET ordine = ? WHERE id = ?').run(g.ordine, vicino.id);
  });
  transazione();
});

// Riordina automaticamente tutta la rosa secondo il ruolo tattico standard
// (stesso ordine delle opzioni nel modulo "Nuovo giocatore"); chi non ha un
// ruolo riconosciuto va in fondo, ordinato per numero di maglia
const ORDINE_RUOLI = ['Portiere', 'Ala sinistra', 'Terzino sinistro', 'Centrale', 'Terzino destro', 'Ala destra', 'Pivot'];
ipcMain.handle('giocatori:ordinaPerRuolo', (_e, squadraId) => {
  const database = getDb();
  const giocatori = database.prepare('SELECT * FROM giocatori WHERE squadra_id = ?').all(squadraId);

  giocatori.sort((a, b) => {
    const indiceA = ORDINE_RUOLI.indexOf(a.ruolo);
    const indiceB = ORDINE_RUOLI.indexOf(b.ruolo);
    const rangoA = indiceA === -1 ? ORDINE_RUOLI.length : indiceA;
    const rangoB = indiceB === -1 ? ORDINE_RUOLI.length : indiceB;
    if (rangoA !== rangoB) return rangoA - rangoB;
    return (a.numero ?? 999) - (b.numero ?? 999);
  });

  const transazione = database.transaction(() => {
    giocatori.forEach((g, indice) => {
      database.prepare('UPDATE giocatori SET ordine = ? WHERE id = ?').run(indice + 1, g.id);
    });
  });
  transazione();
});

ipcMain.handle('giocatori:aggiorna', (_e, { id, nome, cognome, ruolo, numero }) => {
  getDb().prepare(`
    UPDATE giocatori SET nome = ?, cognome = ?, ruolo = ?, numero = ? WHERE id = ?
  `).run(nome, cognome || null, ruolo || null, numero || null, id);
});

ipcMain.handle('giocatori:elimina', (_e, id) => {
  getDb().prepare('DELETE FROM giocatori WHERE id = ?').run(id);
});

// Tutti gli eventi legati a UN giocatore, su tutte le partite (per "trovarli subito")
ipcMain.handle('giocatori:eventi', (_e, giocatoreId) => {
  const database = getDb();
  const eventi = database.prepare(`
    SELECT e.id, e.inizio_sec, e.fine_sec, p.id AS partita_id, p.data,
           sc.nome AS squadra_casa, so.nome AS squadra_ospite
    FROM eventi e
    JOIN partite p ON p.id = e.partita_id
    JOIN squadre sc ON sc.id = p.squadra_casa_id
    JOIN squadre so ON so.id = p.squadra_ospite_id
    WHERE e.giocatore_id = ?
    ORDER BY p.data DESC, e.inizio_sec
  `).all(giocatoreId);

  const tagStmt = database.prepare(`
    SELECT t.id, t.nome, t.ordine AS tag_ordine, c.id AS categoria_id, c.nome AS categoria, c.gruppo
    FROM evento_tag et
    JOIN tag t ON t.id = et.tag_id
    JOIN categorie_tag c ON c.id = t.categoria_id
    WHERE et.evento_id = ?
    ORDER BY c.ordine, t.ordine
  `);

  return eventi.map(ev => ({ ...ev, tag: tagStmt.all(ev.id) }));
});

// -------------------------------------------------------
// IPC: crea una nuova partita e la collega al video importato
// -------------------------------------------------------
ipcMain.handle('partite:crea', (_e, payload) => {
  const database = getDb();
  const info = database.prepare(`
    INSERT INTO partite (squadra_casa_id, squadra_ospite_id, data, stagione_id, competizione, video_path)
    VALUES (@squadra_casa_id, @squadra_ospite_id, @data, @stagione_id, @competizione, @video_path)
  `).run(payload);
  return info.lastInsertRowid;
});

// -------------------------------------------------------
// IPC: elenco partite (semplice, per il selettore dell'archivio Eventi)
// -------------------------------------------------------
ipcMain.handle('partite:elencoConConteggi', () => {
  return getDb().prepare(`
    SELECT p.id, p.data, p.competizione, p.video_path,
           sc.id AS squadra_casa_id, sc.nome AS squadra_casa,
           so.id AS squadra_ospite_id, so.nome AS squadra_ospite,
           (SELECT COUNT(*) FROM eventi e WHERE e.partita_id = p.id) AS n_eventi
    FROM partite p
    JOIN squadre sc ON sc.id = p.squadra_casa_id
    JOIN squadre so ON so.id = p.squadra_ospite_id
    ORDER BY p.data DESC
  `).all();
});

// Elimina una partita — in cascata (già previsto nello schema) sparisce
// anche tutto ciò che dipende da lei: i suoi eventi, i tag su quegli eventi,
// ed eventuali clip in presentazioni che li usavano. Il video sul disco NON
// viene toccato, solo il riferimento nel database.
ipcMain.handle('partite:elimina', (_e, id) => {
  getDb().prepare('DELETE FROM partite WHERE id = ?').run(id);
});

// =========================================================
// PRESENTAZIONI
// =========================================================

ipcMain.handle('presentazioni:elenco', () => {
  return getDb().prepare('SELECT * FROM presentazioni ORDER BY id DESC').all();
});

ipcMain.handle('presentazioni:crea', (_e, nome) => {
  return getDb().prepare('INSERT INTO presentazioni (nome) VALUES (?)').run(nome).lastInsertRowid;
});

// Elimina una presentazione (in cascata: solo i collegamenti presentazione_eventi,
// gli eventi originali e le partite restano intatti)
ipcMain.handle('presentazioni:elimina', (_e, id) => {
  getDb().prepare('DELETE FROM presentazioni WHERE id = ?').run(id);
});

// Importa uno o più eventi (anche da partite diverse) in una presentazione,
// creandola se presentazioneId non è passato.
ipcMain.handle('presentazioni:aggiungiEventi', (_e, { presentazioneId, nomeNuovaPresentazione, eventoIds }) => {
  const database = getDb();

  const transazione = database.transaction(() => {
    let id = presentazioneId;
    if (!id) {
      id = database.prepare('INSERT INTO presentazioni (nome) VALUES (?)').run(nomeNuovaPresentazione).lastInsertRowid;
    }

    const maxOrdine = database.prepare(
      'SELECT COALESCE(MAX(ordine), -1) AS m FROM presentazione_eventi WHERE presentazione_id = ?'
    ).get(id).m;

    const insertClip = database.prepare(`
      INSERT INTO presentazione_eventi (presentazione_id, evento_id, ordine, inizio_sec, fine_sec)
      VALUES (?, ?, ?, ?, ?)
    `);
    const leggiEvento = database.prepare('SELECT inizio_sec, fine_sec FROM eventi WHERE id = ?');

    eventoIds.forEach((eventoId, i) => {
      const ev = leggiEvento.get(eventoId);
      insertClip.run(id, eventoId, maxOrdine + 1 + i, ev.inizio_sec, ev.fine_sec);
    });

    return id;
  });

  return transazione();
});

ipcMain.handle('presentazioni:clip', (_e, presentazioneId) => {
  const database = getDb();
  const clip = database.prepare(`
    SELECT
      pe.id, pe.ordine, pe.inizio_sec, pe.fine_sec,
      pe.tipo, pe.schermata_sfondo, pe.schermata_testo, pe.schermata_colore_testo, pe.schermata_durata_sec,
      pe.audio_muto, pe.audio_volume, pe.velocita,
      e.id AS evento_id, e.inizio_sec AS evento_inizio_sec, e.fine_sec AS evento_fine_sec,
      p.video_path,
      sc.nome AS squadra_casa, so.nome AS squadra_ospite
    FROM presentazione_eventi pe
    LEFT JOIN eventi e ON e.id = pe.evento_id
    LEFT JOIN partite p ON p.id = e.partita_id
    LEFT JOIN squadre sc ON sc.id = p.squadra_casa_id
    LEFT JOIN squadre so ON so.id = p.squadra_ospite_id
    WHERE pe.presentazione_id = ?
    ORDER BY pe.ordine
  `).all(presentazioneId);

  const momentiStmt = database.prepare(`
    SELECT id, ordine, pausa_timestamp_sec, pausa_durata_sec, disegni_json
    FROM disegni_momento WHERE presentazione_evento_id = ? ORDER BY pausa_timestamp_sec
  `);
  return clip.map(c => ({ ...c, momenti: momentiStmt.all(c.id) }));
});

ipcMain.handle('presentazioni:aggiornaClip', (_e, { id, inizio_sec, fine_sec, audio_muto, audio_volume, velocita }) => {
  getDb().prepare(`
    UPDATE presentazione_eventi
    SET inizio_sec = ?, fine_sec = ?, audio_muto = ?, audio_volume = ?, velocita = ?
    WHERE id = ?
  `).run(inizio_sec, fine_sec, audio_muto ? 1 : 0, audio_volume ?? 1.0, velocita ?? 1.0, id);
});

// --- Momenti di pausa/disegno di una clip (una clip può averne più di uno) ---

ipcMain.handle('disegniMomento:elencoPerClip', (_e, presentazioneEventoId) => {
  return getDb().prepare(`
    SELECT id, ordine, pausa_timestamp_sec, pausa_durata_sec, disegni_json
    FROM disegni_momento
    WHERE presentazione_evento_id = ?
    ORDER BY pausa_timestamp_sec
  `).all(presentazioneEventoId);
});

ipcMain.handle('disegniMomento:crea', (_e, { presentazioneEventoId, pausaTimestampSec, pausaDurataSec, disegniJson }) => {
  const database = getDb();
  const maxOrdine = database.prepare('SELECT COALESCE(MAX(ordine), -1) AS m FROM disegni_momento WHERE presentazione_evento_id = ?').get(presentazioneEventoId).m;
  const info = database.prepare(`
    INSERT INTO disegni_momento (presentazione_evento_id, ordine, pausa_timestamp_sec, pausa_durata_sec, disegni_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(presentazioneEventoId, maxOrdine + 1, pausaTimestampSec, pausaDurataSec ?? 3, disegniJson || null);
  return info.lastInsertRowid;
});

ipcMain.handle('disegniMomento:aggiorna', (_e, { id, pausaTimestampSec, pausaDurataSec, disegniJson }) => {
  getDb().prepare(`
    UPDATE disegni_momento SET pausa_timestamp_sec = ?, pausa_durata_sec = ?, disegni_json = ?
    WHERE id = ?
  `).run(pausaTimestampSec, pausaDurataSec ?? 3, disegniJson || null, id);
});

ipcMain.handle('disegniMomento:elimina', (_e, id) => {
  getDb().prepare('DELETE FROM disegni_momento WHERE id = ?').run(id);
});

// Muta/smuta TUTTE le clip video di una presentazione in un colpo solo
// (le schermate di testo non hanno audio, non serve toccarle)
ipcMain.handle('presentazioni:mutaTutteClip', (_e, { presentazioneId, muto }) => {
  getDb().prepare(`
    UPDATE presentazione_eventi SET audio_muto = ?
    WHERE presentazione_id = ? AND tipo = 'clip'
  `).run(muto ? 1 : 0, presentazioneId);
});

ipcMain.handle('presentazioni:rimuoviClip', (_e, id) => {
  getDb().prepare('DELETE FROM presentazione_eventi WHERE id = ?').run(id);
});

// Inserisce una "schermata di testo" (sfondo + scritta, senza video) nella
// sequenza della presentazione. primaDiClipId: se dato, la inserisce appena
// prima di quella clip (utile per un'introduzione o un separatore tra
// eventi); se assente, la aggiunge in fondo alla presentazione.
ipcMain.handle('presentazioni:aggiungiSchermata', (_e, { presentazioneId, primaDiClipId, sfondo, testo, coloreTesto, durataSec }) => {
  const database = getDb();
  let ordineInserimento;

  if (primaDiClipId) {
    const clipRif = database.prepare('SELECT ordine FROM presentazione_eventi WHERE id = ?').get(primaDiClipId);
    ordineInserimento = clipRif ? clipRif.ordine : 0;
  } else {
    const max = database.prepare('SELECT COALESCE(MAX(ordine), -1) AS m FROM presentazione_eventi WHERE presentazione_id = ?').get(presentazioneId).m;
    ordineInserimento = max + 1;
  }

  const transazione = database.transaction(() => {
    // faccio spazio: sposto avanti di 1 tutte le righe da quella posizione in poi
    database.prepare('UPDATE presentazione_eventi SET ordine = ordine + 1 WHERE presentazione_id = ? AND ordine >= ?')
      .run(presentazioneId, ordineInserimento);

    database.prepare(`
      INSERT INTO presentazione_eventi
        (presentazione_id, evento_id, ordine, tipo, schermata_sfondo, schermata_testo, schermata_colore_testo, schermata_durata_sec)
      VALUES (?, NULL, ?, 'schermata', ?, ?, ?, ?)
    `).run(presentazioneId, ordineInserimento, sfondo, testo, coloreTesto, durataSec);
  });
  transazione();
});

ipcMain.handle('presentazioni:aggiornaSchermata', (_e, { id, sfondo, testo, coloreTesto, durataSec }) => {
  getDb().prepare(`
    UPDATE presentazione_eventi
    SET schermata_sfondo = ?, schermata_testo = ?, schermata_colore_testo = ?, schermata_durata_sec = ?
    WHERE id = ?
  `).run(sfondo, testo, coloreTesto, durataSec, id);
});

// Duplica una forma di testo (con lo stesso stile/posizione) nelle N clip
// successive della stessa presentazione, in ordine — per una scritta che
// resta identica in sovraimpressione lungo più eventi di fila (es. "2° tempo",
// il nome di un'azione tattica ripetuta, ecc.)
ipcMain.handle('presentazioni:applicaTestoAPiuClip', (_e, { presentazioneId, clipId, formaTesto, numeroClip, canvasSizeOrigine }) => {
  const database = getDb();

  const clipCorrente = database.prepare('SELECT ordine FROM presentazione_eventi WHERE id = ?').get(clipId);
  if (!clipCorrente) return 0;

  const successive = database.prepare(`
    SELECT id, inizio_sec FROM presentazione_eventi
    WHERE presentazione_id = ? AND ordine > ?
    ORDER BY ordine
    LIMIT ?
  `).all(presentazioneId, clipCorrente.ordine, numeroClip);

  const trovaPrimoMomento = database.prepare(`
    SELECT id, disegni_json FROM disegni_momento
    WHERE presentazione_evento_id = ? ORDER BY pausa_timestamp_sec LIMIT 1
  `);
  const aggiornaMomento = database.prepare('UPDATE disegni_momento SET disegni_json = ? WHERE id = ?');
  const creaMomento = database.prepare(`
    INSERT INTO disegni_momento (presentazione_evento_id, ordine, pausa_timestamp_sec, pausa_durata_sec, disegni_json)
    VALUES (?, 0, ?, 3, ?)
  `);

  const transazione = database.transaction(() => {
    successive.forEach(clip => {
      const esistente = trovaPrimoMomento.get(clip.id);

      if (esistente) {
        const dati = esistente.disegni_json ? JSON.parse(esistente.disegni_json) : null;
        const forme = dati ? (Array.isArray(dati) ? dati : (dati.forme || [])) : [];
        const canvasSize = (dati && !Array.isArray(dati) && dati.canvasSize) || canvasSizeOrigine || null;
        forme.push(formaTesto);
        aggiornaMomento.run(JSON.stringify({ forme, canvasSize }), esistente.id);
      } else {
        // questa clip non ha ancora nessun momento: ne creo uno apposta,
        // posizionato al suo inizio, solo per ospitare il testo fisso
        const forme = [formaTesto];
        creaMomento.run(clip.id, clip.inizio_sec, JSON.stringify({ forme, canvasSize: canvasSizeOrigine || null }));
      }
    });
  });
  transazione();

  return successive.length;
});

// Scrive un PNG (data URL base64 generato dal canvas dei disegni) su un file
// temporaneo, cosí l'export via ffmpeg può usarlo come overlay.
ipcMain.handle('export:scriviPngTemp', (_e, dataUrlBase64) => {
  const base64 = dataUrlBase64.replace(/^data:image\/png;base64,/, '');
  const tmpPath = path.join(app.getPath('temp'), `overlay-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`);
  fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
  return tmpPath;
});

// Esporta la presentazione come MP4 unico: taglia ogni clip (durata modificata
// in editor), inserendo — se presente — il fermo immagine con i disegni nel
// punto in cui il coach ha messo in pausa, per la durata che ha scelto.
// overlayPngPerClip: { [presentazione_eventi.id]: percorsoPngTemp }
ipcMain.handle('presentazioni:esporta', async (_e, { presentazioneId, overlayPngPerClip = {} }) => {
  const database = getDb();
  const presentazione = database.prepare('SELECT * FROM presentazioni WHERE id = ?').get(presentazioneId);
  const clip = database.prepare(`
    SELECT pe.id, pe.inizio_sec, pe.fine_sec,
           pe.tipo, pe.schermata_sfondo, pe.schermata_testo, pe.schermata_colore_testo, pe.schermata_durata_sec,
           pe.audio_muto, pe.audio_volume, pe.velocita,
           e.inizio_sec AS evento_inizio, e.fine_sec AS evento_fine, p.video_path
    FROM presentazione_eventi pe
    LEFT JOIN eventi e ON e.id = pe.evento_id
    LEFT JOIN partite p ON p.id = e.partita_id
    WHERE pe.presentazione_id = ?
    ORDER BY pe.ordine
  `).all(presentazioneId);

  const momentiStmt = database.prepare(`
    SELECT id, pausa_timestamp_sec, pausa_durata_sec FROM disegni_momento
    WHERE presentazione_evento_id = ? ORDER BY pausa_timestamp_sec
  `);

  const destinazione = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `${presentazione.nome.replace(/[^\w\- ]/g, '')}.mp4`,
    filters: [{ name: 'Video MP4', extensions: ['mp4'] }]
  });
  if (destinazione.canceled) return null;

  const cartellaTemp = path.join(app.getPath('temp'), `handball-analyst-export-${presentazioneId}-${Date.now()}`);

  const presetSalvato = database.prepare("SELECT valore FROM impostazioni_app WHERE chiave = 'export_preset'").get();

  const outputFinale = await esportaPresentazione({
    clips: clip.map(c => {
      const overlayClip = overlayPngPerClip[c.id] || {};
      const momentiDb = momentiStmt.all(c.id);
      return {
        tipo: c.tipo || 'clip',
        videoSorgente: c.video_path,
        inizioSec: c.inizio_sec ?? c.evento_inizio,
        fineSec: c.fine_sec ?? c.evento_fine,
        momenti: momentiDb.map(m => ({
          pausaTimestampSec: m.pausa_timestamp_sec,
          pausaDurataSec: m.pausa_durata_sec,
          overlayPngPath: (overlayClip.momenti && overlayClip.momenti[m.id]) || null
        })),
        overlayPngPathSoloFissi: overlayClip.soloFissi || null,
        schermataSfondo: c.schermata_sfondo,
        schermataTesto: c.schermata_testo,
        schermataColoreTesto: c.schermata_colore_testo,
        schermataDurataSec: c.schermata_durata_sec,
        audioMuto: !!c.audio_muto,
        audioVolume: c.audio_volume ?? 1.0,
        velocita: c.velocita ?? 1.0
      };
    }),
    cartellaTemp,
    outputFinale: destinazione.filePath,
    preset: presetSalvato ? presetSalvato.valore : 'veryfast',
    onProgress: (attuale, totale, fase) => {
      mainWindow.webContents.send('export:avanzamento', { attuale, totale, fase: fase || 'clip' });
    }
  });

  return outputFinale;
});

// -------------------------------------------------------
// IPC: selezione file video da importare
// -------------------------------------------------------
ipcMain.handle('video:seleziona', async () => {
  const pref = getDb().prepare("SELECT valore FROM impostazioni_app WHERE chiave = 'cartella_video_predefinita'").get();
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4'] }],
    defaultPath: pref ? pref.valore : undefined
  });
  return result.canceled ? null : result.filePaths[0];
});

// =========================================================
// IMPOSTAZIONI APP: preferenze locali, cartella video, cache, info
// =========================================================

// Licenza: riverifica ad ogni avvio (non solo alla prima attivazione), così
// un codice a tempo smette davvero di funzionare passata la scadenza.
// L'ID macchina viene creato una volta sola al primo avvio e resta fisso:
// lega il codice di attivazione a QUESTO computer.
function ottieniMachineId() {
  const database = getDb();
  const esistente = database.prepare("SELECT valore FROM impostazioni_app WHERE chiave = 'machine_id'").get();
  if (esistente) return esistente.valore;

  const nuovo = crypto.randomUUID();
  database.prepare(`
    INSERT INTO impostazioni_app (chiave, valore) VALUES ('machine_id', ?)
    ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore
  `).run(nuovo);
  return nuovo;
}

ipcMain.handle('licenza:machineId', () => ottieniMachineId());

// Accesso con Google: apre il browser di sistema, ritorna l'id_token da
// usare poi lato renderer con Firebase (signInWithCredential)
ipcMain.handle('auth:accediGoogle', async () => {
  try {
    const { idToken } = await accediConGoogle();
    return { ok: true, idToken };
  } catch (err) {
    return { ok: false, errore: err.message };
  }
});

ipcMain.handle('licenza:stato', () => {
  const salvato = getDb().prepare("SELECT valore FROM impostazioni_app WHERE chiave = 'licenza_codice'").get();
  if (!salvato) return { attivata: false };

  const esito = verificaLicenza(salvato.valore, ottieniMachineId());
  return { attivata: esito.valida, ...esito };
});

ipcMain.handle('licenza:attiva', (_e, codice) => {
  const esito = verificaLicenza(codice, ottieniMachineId());
  if (esito.valida) {
    getDb().prepare(`
      INSERT INTO impostazioni_app (chiave, valore) VALUES ('licenza_codice', ?)
      ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore
    `).run(codice.trim());
  }
  return esito;
});

ipcMain.handle('impostazioniApp:leggi', () => {
  const righe = getDb().prepare('SELECT chiave, valore FROM impostazioni_app').all();
  const risultato = {};
  righe.forEach(r => { risultato[r.chiave] = r.valore; });
  return risultato;
});

ipcMain.handle('impostazioniApp:scrivi', (_e, { chiave, valore }) => {
  getDb().prepare(`
    INSERT INTO impostazioni_app (chiave, valore) VALUES (?, ?)
    ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore
  `).run(chiave, valore);
});

ipcMain.handle('video:sceglieCartella', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

// Cache = cartelle temporanee create durante l'export delle presentazioni
function cartellaCache() {
  return app.getPath('temp');
}
function trovaCartelleCacheExport() {
  const base = cartellaCache();
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .filter(nome => nome.startsWith('handball-analyst-export-'))
    .map(nome => path.join(base, nome));
}
function dimensioneCartella(cartella) {
  let totale = 0;
  const voci = fs.readdirSync(cartella, { withFileTypes: true });
  for (const voce of voci) {
    const p = path.join(cartella, voce.name);
    if (voce.isDirectory()) totale += dimensioneCartella(p);
    else totale += fs.statSync(p).size;
  }
  return totale;
}

ipcMain.handle('cache:dimensione', () => {
  const cartelle = trovaCartelleCacheExport();
  let totale = 0;
  cartelle.forEach(c => { try { totale += dimensioneCartella(c); } catch (e) { /* ignora */ } });
  return { byte: totale, numeroCartelle: cartelle.length };
});

ipcMain.handle('cache:svuota', () => {
  const cartelle = trovaCartelleCacheExport();
  cartelle.forEach(c => { try { fs.rmSync(c, { recursive: true, force: true }); } catch (e) { /* ignora */ } });
  return cartelle.length;
});

ipcMain.handle('app:versione', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
  return pkg.version;
});

// Reset completo dei dati locali (partite, eventi, giocatori, tag, presentazioni):
// ripristina anche i tag di default via seed, per ripartire puliti
ipcMain.handle('datiLocali:eliminaTutto', () => {
  const database = getDb();
  const transazione = database.transaction(() => {
    ['presentazione_eventi', 'presentazioni', 'evento_tag', 'eventi', 'giocatori',
     'partite', 'squadre', 'stagioni', 'tag', 'categorie_tag', 'pannelli_tag'].forEach(tabella => {
      database.exec(`DELETE FROM ${tabella}`);
    });
    const seed = fs.readFileSync(path.join(__dirname, 'db', 'seed-tags.sql'), 'utf-8');
    database.exec(seed);
  });
  transazione();
});

// Rimuove SOLO i doppioni di categorie/tag (stesso nome nello stesso punto
// dell'albero) — non tocca partite, eventi, giocatori, presentazioni.
// Se un evento era già taggato sia col doppione che con l'originale (caso
// raro), il collegamento doppio viene unito, non perso.
ipcMain.handle('tag:rimuoviDoppioni', () => {
  const database = getDb();
  let rimossi = 0;

  const transazione = database.transaction(() => {
    // 1) Categorie duplicate (stesso nome, STESSO pannello): sposto tutti i
    // loro tag sotto quella "tenuta" (la più vecchia, id più basso), poi
    // elimino il duplicato. Categorie con lo stesso nome ma in PANNELLI
    // diversi sono legittime, non vanno toccate.
    const categorie = database.prepare('SELECT id, pannello_id, nome FROM categorie_tag ORDER BY id').all();
    const categoriaTenutaPerNome = new Map();
    categorie.forEach(c => {
      const chiave = `${c.pannello_id}|${c.nome}`;
      if (categoriaTenutaPerNome.has(chiave)) {
        const tenutaId = categoriaTenutaPerNome.get(chiave);
        database.prepare('UPDATE tag SET categoria_id = ? WHERE categoria_id = ?').run(tenutaId, c.id);
        database.prepare('DELETE FROM categorie_tag WHERE id = ?').run(c.id);
        rimossi++;
      } else {
        categoriaTenutaPerNome.set(chiave, c.id);
      }
    });

    // 2) Tag duplicati (stessa categoria + stesso genitore + stesso nome).
    // Ripeto più passaggi: unendo una cartella duplicata, i suoi figli si
    // spostano sotto quella tenuta e potrebbero rivelare NUOVE coincidenze
    // tra fratelli, quindi ricontrollo finché un giro non trova più nulla.
    let trovatiInQuestoGiro = true;
    while (trovatiInQuestoGiro) {
      trovatiInQuestoGiro = false;
      const tutti = database.prepare('SELECT id, categoria_id, genitore_id, nome FROM tag ORDER BY id').all();
      const chiaveTenuta = new Map();

      for (const t of tutti) {
        const chiave = `${t.categoria_id}|${t.genitore_id ?? 'radice'}|${t.nome}`;
        if (!chiaveTenuta.has(chiave)) {
          chiaveTenuta.set(chiave, t.id);
          continue;
        }
        const tenutaId = chiaveTenuta.get(chiave);

        // eventuali figli (se era una cartella) passano sotto la cartella tenuta
        database.prepare('UPDATE tag SET genitore_id = ? WHERE genitore_id = ?').run(tenutaId, t.id);

        // i collegamenti agli eventi passano al tag tenuto; se un evento aveva
        // già ENTRAMBI (raro), il conflitto sulla chiave primaria viene ignorato
        // invece di bloccare tutto — il collegamento doppio si unisce in uno
        database.prepare('UPDATE OR IGNORE evento_tag SET tag_id = ? WHERE tag_id = ?').run(tenutaId, t.id);
        database.prepare('DELETE FROM evento_tag WHERE tag_id = ?').run(t.id); // eventuali rimasti, già coperti dalla riga tenuta

        database.prepare('DELETE FROM tag WHERE id = ?').run(t.id);
        rimossi++;
        trovatiInQuestoGiro = true;
        break; // ricomincio il giro sui dati aggiornati
      }
    }
  });

  transazione();
  return rimossi;
});
