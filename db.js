const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

let dbInstance = null;

function initDb() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'handball-analyst.db');
  const isNuovo = !fs.existsSync(dbPath);

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  migraSchemaEventi(dbInstance); // va PRIMA della CREATE TABLE: eventi ha cambiato struttura

  const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf-8');
  dbInstance.exec(schema);

  migraColonnePartite(dbInstance);
  migraColonneGiocatoriEventi(dbInstance);
  migraColonnePresentazioneEventi(dbInstance);
  migraSchermatePresentazione(dbInstance);
  migraDisegniMomento(dbInstance);
  migraAudioClip(dbInstance);
  migraOrdineEventi(dbInstance);
  migraOrdineGiocatori(dbInstance);
  migraGerarchiaTag(dbInstance);
  migraPannelliTag(dbInstance);
  correggeRiferimentoTagCategorie(dbInstance);
  deduplicaTagInRadice(dbInstance);
  assicuraIndiceTagUnivoco(dbInstance);
  // va DOPO le migrazioni sopra: inserisce righe dentro "tag", che devono
  // già avere lo schema corretto e ripulito a questo punto
  migraTagEsitoPortiere(dbInstance);
  try {
    migraPannelloXPS(dbInstance);
  } catch (err) {
    // possibile scontro tra due istanze avviate quasi in contemporanea:
    // non blocco l'avvio, verrà ritentata (in modo sicuro, idempotente) al prossimo avvio
    console.error('Migrazione pannello tag non completata, riproverò al prossimo avvio:', err.message);
  }

  if (isNuovo) {
    const seed = fs.readFileSync(path.join(__dirname, 'db', 'seed-tags.sql'), 'utf-8');
    dbInstance.exec(seed);
  }

  return dbInstance;
}

// Lo schema eventi è passato da timestamp_sec/clip_start/clip_end a inizio_sec/fine_sec
// (tasti Z/M), e playlist/pausa/clip sono stati sostituiti da presentazioni.
// Essendo dati di solo test in questa fase di sviluppo, se troviamo la vecchia
// struttura ripartiamo pulendo le tabelle superate invece di scrivere una
// migrazione dati che non avrebbe nulla di reale da preservare.
function migraSchemaEventi(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('eventi')) return;

  const colonneEventi = db.prepare("PRAGMA table_info(eventi)").all().map(c => c.name);
  const schemaVecchio = !colonneEventi.includes('inizio_sec');
  if (!schemaVecchio) return;

  console.log('[migrazione] Schema eventi obsoleto rilevato: ricreo le tabelle interessate (dati di test).');
  db.exec(`
    DROP TABLE IF EXISTS playlist_eventi;
    DROP TABLE IF EXISTS playlist;
    DROP TABLE IF EXISTS pausa;
    DROP TABLE IF EXISTS clip;
    DROP TABLE IF EXISTS evento_tag;
    DROP TABLE IF EXISTS eventi;
  `);
}

// Aggiunge colonne mancanti ai DB creati con versioni precedenti dello schema
// (SQLite non supporta ALTER TABLE ... ADD COLUMN IF NOT EXISTS)
function migraColonnePartite(db) {
  const colonnePartite = db.prepare("PRAGMA table_info(partite)").all().map(c => c.name);
  if (!colonnePartite.includes('competizione')) {
    db.exec('ALTER TABLE partite ADD COLUMN competizione TEXT');
  }
  if (!colonnePartite.includes('proxy_path')) {
    db.exec('ALTER TABLE partite ADD COLUMN proxy_path TEXT');
  }
}

// Aggiunge colonne introdotte dopo il primo rilascio: additiva, non tocca dati esistenti
function migraColonneGiocatoriEventi(db) {
  const colonneGiocatori = db.prepare("PRAGMA table_info(giocatori)").all().map(c => c.name);
  if (!colonneGiocatori.includes('cognome')) {
    db.exec('ALTER TABLE giocatori ADD COLUMN cognome TEXT');
  }

  const colonneEventi = db.prepare("PRAGMA table_info(eventi)").all().map(c => c.name);
  if (!colonneEventi.includes('squadra_riferimento_id')) {
    db.exec('ALTER TABLE eventi ADD COLUMN squadra_riferimento_id INTEGER REFERENCES squadre(id)');
  }
}

// La vecchia categoria "Portiere" (Goal/No Goal) diventa "Esito"; il nome
// "Portiere" viene poi riutilizzato per la nuova categoria (Positivo/Negativo).
// Idempotente: sui DB nuovi (seed già corretto) non fa nulla.
// Garantisce che esista sempre un pannello "Partita" da usare come riserva
// — va chiamata PRIMA di qualunque altra migrazione che crei categorie
// (altrimenti "categorie_tag.pannello_id", che non accetta mai un valore
// vuoto, farebbe fallire l'inserimento). Sicura da richiamare più volte.
function assicuraPannelloDefault(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pannelli_tag (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      nome   TEXT NOT NULL UNIQUE,
      ordine INTEGER DEFAULT 0
    );
    INSERT OR IGNORE INTO pannelli_tag (nome, ordine) VALUES ('Partita', 1);
  `);
  return db.prepare("SELECT id FROM pannelli_tag WHERE nome = 'Partita'").get().id;
}

function migraTagEsitoPortiere(db) {
  const pannelloDefaultId = assicuraPannelloDefault(db);
  const trovaCategoria = (nome) => db.prepare('SELECT * FROM categorie_tag WHERE nome = ?').get(nome);

  const vecchiaPortiere = trovaCategoria('Portiere');
  const esito = trovaCategoria('Esito');

  if (vecchiaPortiere && !esito) {
    db.prepare('UPDATE categorie_tag SET nome = ? WHERE id = ?').run('Esito', vecchiaPortiere.id);
  }

  const portiereNuovo = trovaCategoria('Portiere');
  if (!portiereNuovo) {
    const info = db.prepare('INSERT INTO categorie_tag (nome, gruppo, ordine, pannello_id) VALUES (?, ?, ?, ?)').run('Portiere', 'generale', 12, pannelloDefaultId);
    const catId = info.lastInsertRowid;
    db.prepare('INSERT INTO tag (categoria_id, nome, colore, ordine) VALUES (?, ?, ?, ?)').run(catId, 'Positivo', '#2e7d32', 1);
    db.prepare('INSERT INTO tag (categoria_id, nome, colore, ordine) VALUES (?, ?, ?, ?)').run(catId, 'Negativo', '#c62828', 2);
  }
}

// Aggiunge il punto/durata di pausa (fermo immagine con disegni) ai DB già esistenti
function migraColonnePresentazioneEventi(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('presentazione_eventi')) return;

  const colonne = db.prepare("PRAGMA table_info(presentazione_eventi)").all().map(c => c.name);
  if (!colonne.includes('pausa_timestamp_sec')) {
    db.exec('ALTER TABLE presentazione_eventi ADD COLUMN pausa_timestamp_sec REAL');
  }
  if (!colonne.includes('pausa_durata_sec')) {
    db.exec('ALTER TABLE presentazione_eventi ADD COLUMN pausa_durata_sec REAL DEFAULT 3');
  }
}

// Le "schermate di testo" (pagine intere senza video, solo sfondo+testo)
// richiedono che evento_id possa essere NULL — SQLite non permette di
// togliere un vincolo NOT NULL con un ALTER, quindi ricreo la tabella
// preservando tutte le righe esistenti (che restano tipo 'clip' con
// evento_id valorizzato come prima).
// Muto/volume audio per singola clip in presentazione
function migraAudioClip(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('presentazione_eventi')) return;

  const colonne = db.prepare("PRAGMA table_info(presentazione_eventi)").all().map(c => c.name);
  if (!colonne.includes('audio_muto')) {
    db.exec('ALTER TABLE presentazione_eventi ADD COLUMN audio_muto INTEGER DEFAULT 0');
  }
  if (!colonne.includes('audio_volume')) {
    db.exec('ALTER TABLE presentazione_eventi ADD COLUMN audio_volume REAL DEFAULT 1.0');
  }
  if (!colonne.includes('velocita')) {
    db.exec('ALTER TABLE presentazione_eventi ADD COLUMN velocita REAL DEFAULT 1.0');
  }
}

function migraSchermatePresentazione(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('presentazione_eventi')) return;

  const colonne = db.prepare("PRAGMA table_info(presentazione_eventi)").all().map(c => c.name);
  if (colonne.includes('tipo')) return; // già migrato

  db.exec(`
    ALTER TABLE presentazione_eventi RENAME TO presentazione_eventi_old;

    CREATE TABLE presentazione_eventi (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      presentazione_id INTEGER NOT NULL REFERENCES presentazioni(id) ON DELETE CASCADE,
      evento_id        INTEGER REFERENCES eventi(id) ON DELETE CASCADE,
      ordine           INTEGER DEFAULT 0,
      inizio_sec       REAL,
      fine_sec         REAL,
      disegni_json     TEXT,
      pausa_timestamp_sec REAL,
      pausa_durata_sec    REAL DEFAULT 3,
      tipo                  TEXT DEFAULT 'clip',
      schermata_sfondo      TEXT,
      schermata_testo       TEXT,
      schermata_colore_testo TEXT DEFAULT '#ffffff',
      schermata_durata_sec  REAL DEFAULT 3
    );

    INSERT INTO presentazione_eventi
      (id, presentazione_id, evento_id, ordine, inizio_sec, fine_sec, disegni_json, pausa_timestamp_sec, pausa_durata_sec, tipo)
    SELECT id, presentazione_id, evento_id, ordine, inizio_sec, fine_sec, disegni_json, pausa_timestamp_sec, pausa_durata_sec, 'clip'
    FROM presentazione_eventi_old;

    DROP TABLE presentazione_eventi_old;
  `);
}

// Sposta l'eventuale pausa/disegno esistente (uno solo per clip, il vecchio
// modello) nella nuova tabella disegni_momento, che ne supporta più di uno
// per clip. Idempotente: se la tabella esiste già, non rifà nulla.
function migraDisegniMomento(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('presentazione_eventi') || !tabelle.includes('disegni_momento')) return;

  // il controllo giusto NON è "esiste già la tabella" (schema.sql la crea
  // comunque prima di arrivare qui, quindi risulterebbe sempre vera e la
  // migrazione non partirebbe mai) — è "quali righe non sono ancora state
  // spostate", verificabile in ogni momento senza rischio di rifarle due volte
  const daMigrare = db.prepare(`
    SELECT pe.id, pe.disegni_json, pe.pausa_timestamp_sec, pe.pausa_durata_sec
    FROM presentazione_eventi pe
    WHERE pe.pausa_timestamp_sec IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM disegni_momento dm WHERE dm.presentazione_evento_id = pe.id)
  `).all();

  if (daMigrare.length === 0) return;

  const inserisci = db.prepare(`
    INSERT INTO disegni_momento (presentazione_evento_id, ordine, pausa_timestamp_sec, pausa_durata_sec, disegni_json)
    VALUES (?, 0, ?, ?, ?)
  `);
  const transazione = db.transaction(() => {
    daMigrare.forEach(c => inserisci.run(c.id, c.pausa_timestamp_sec, c.pausa_durata_sec ?? 3, c.disegni_json));
  });
  transazione();
}

// Aggiunge la colonna "ordine" (riordino manuale in Eventi) e, sui DB già
// esistenti, la inizializza rispettando l'ordine cronologico attuale
function migraOrdineEventi(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('eventi')) return;

  const colonne = db.prepare("PRAGMA table_info(eventi)").all().map(c => c.name);
  if (colonne.includes('ordine')) return;

  db.exec('ALTER TABLE eventi ADD COLUMN ordine INTEGER DEFAULT 0');
  db.exec(`
    UPDATE eventi SET ordine = (
      SELECT COUNT(*) FROM eventi e2
      WHERE e2.partita_id = eventi.partita_id
        AND (e2.inizio_sec < eventi.inizio_sec OR (e2.inizio_sec = eventi.inizio_sec AND e2.id <= eventi.id))
    )
  `);
}

// Ordine personalizzato per i giocatori nella rosa (frecce su/giù, oppure
// "Ordina per ruolo"). Sui DB già esistenti, lo ricalcola ricalcando
// l'ordinamento attuale (numero, poi cognome, poi nome) DENTRO ogni singola
// squadra, così nessun giocatore "salta" posizione alla prima apertura.
function migraOrdineGiocatori(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('giocatori')) return;

  const colonne = db.prepare("PRAGMA table_info(giocatori)").all().map(c => c.name);
  if (colonne.includes('ordine')) return;

  db.exec('ALTER TABLE giocatori ADD COLUMN ordine INTEGER DEFAULT 0');
  db.exec(`
    UPDATE giocatori SET ordine = (
      SELECT COUNT(*) FROM giocatori g2
      WHERE (g2.squadra_id = giocatori.squadra_id OR (g2.squadra_id IS NULL AND giocatori.squadra_id IS NULL))
        AND (
          IFNULL(g2.numero, 999999) < IFNULL(giocatori.numero, 999999)
          OR (IFNULL(g2.numero, 999999) = IFNULL(giocatori.numero, 999999) AND IFNULL(g2.cognome,'') < IFNULL(giocatori.cognome,''))
          OR (IFNULL(g2.numero, 999999) = IFNULL(giocatori.numero, 999999) AND IFNULL(g2.cognome,'') = IFNULL(giocatori.cognome,'') AND g2.id <= giocatori.id)
        )
    )
  `);
}

// Aggiunge la gerarchia a cartelle/sottovoci ai tag già esistenti
function migraGerarchiaTag(db) {
  const colonne = db.prepare("PRAGMA table_info(tag)").all().map(c => c.name);
  if (!colonne.includes('genitore_id')) {
    db.exec('ALTER TABLE tag ADD COLUMN genitore_id INTEGER REFERENCES tag(id)');
  }
  if (!colonne.includes('e_cartella')) {
    db.exec('ALTER TABLE tag ADD COLUMN e_cartella INTEGER DEFAULT 0');
  }
}

// Introduce i "pannelli tag" (raccolte di categorie con un nome, es.
// "Partita"/"Didattica"): le categorie che il coach ha già finiscono tutte
// in un pannello "Partita" creato apposta, senza perdere nulla. SQLite non
// permette di aggiungere una colonna NOT NULL con FK a una tabella già
// popolata: ricreo categorie_tag preservando gli STESSI id (così i
// riferimenti da "tag" restano validi automaticamente).
// Corregge un effetto collaterale di migraPannelliTag: rinominando
// categorie_tag, SQLite riscrive DA SOLO il riferimento dentro "tag" (che la
// referenzia) per puntare al nome temporaneo — che poi viene eliminato,
// lasciando "tag" a puntare a una tabella che non esiste più. Il sintomo:
// creare un nuovo tag falliva con "no such table: categorie_tag_old".
// Va ricreata anche evento_tag per lo stesso identico motivo: rinominando
// "tag" per sistemarla, SQLite romperebbe ALLO STESSO MODO il riferimento
// da evento_tag verso "tag" se non la sistemassi nello stesso passaggio.
// Ripulisce eventuali tag doppioni creati PRIMA che esistesse un modo
// efficace di impedirli (il vecchio vincolo UNIQUE non funzionava per i tag
// "in radice", con genitore_id NULL — due NULL non sono mai "uguali" in
// SQL, quindi il vincolo non li vedeva come duplicati). Stessa identica
// logica del pulsante "Rimuovi tag doppioni" in Impostazioni, ma automatica
// e silenziosa. Va eseguita PRIMA di assicuraIndiceTagUnivoco.
function deduplicaTagInRadice(db) {
  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('tag') || !tabelle.includes('evento_tag')) return;

  const transazione = db.transaction(() => {
    let trovatiInQuestoGiro = true;
    while (trovatiInQuestoGiro) {
      trovatiInQuestoGiro = false;
      const tutti = db.prepare('SELECT id, categoria_id, genitore_id, nome FROM tag ORDER BY id').all();
      const chiaveTenuta = new Map();

      for (const t of tutti) {
        const chiave = `${t.categoria_id}|${t.genitore_id ?? 'radice'}|${t.nome}`;
        if (!chiaveTenuta.has(chiave)) {
          chiaveTenuta.set(chiave, t.id);
          continue;
        }
        const tenutaId = chiaveTenuta.get(chiave);

        // eventuali figli (se era una cartella) passano sotto la cartella tenuta
        db.prepare('UPDATE tag SET genitore_id = ? WHERE genitore_id = ?').run(tenutaId, t.id);
        // i collegamenti agli eventi passano al tag tenuto
        db.prepare('UPDATE OR IGNORE evento_tag SET tag_id = ? WHERE tag_id = ?').run(tenutaId, t.id);
        db.prepare('DELETE FROM evento_tag WHERE tag_id = ?').run(t.id); // eventuali rimasti, già coperti dalla riga tenuta
        db.prepare('DELETE FROM tag WHERE id = ?').run(t.id);
        trovatiInQuestoGiro = true;
        break; // ricomincio il giro sui dati aggiornati
      }
    }
  });
  transazione();
}

// Crea l'indice univoco vero (con COALESCE, tratta correttamente i NULL come
// tutti uguali tra loro) — solo dopo deduplicaTagInRadice, altrimenti
// fallirebbe sui doppioni ancora presenti
function assicuraIndiceTagUnivoco(db) {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tag_univoco ON tag (categoria_id, COALESCE(genitore_id, 0), nome)');
}

function correggeRiferimentoTagCategorie(db) {
  const schemaAttuale = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'tag'").get();
  if (!schemaAttuale || !schemaAttuale.sql.includes('categorie_tag_old')) return; // già a posto

  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      ALTER TABLE tag RENAME TO tag_old;

      CREATE TABLE tag (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        categoria_id INTEGER NOT NULL REFERENCES categorie_tag(id) ON DELETE CASCADE,
        genitore_id  INTEGER REFERENCES tag(id) ON DELETE CASCADE,
        e_cartella   INTEGER DEFAULT 0,
        nome         TEXT NOT NULL,
        colore       TEXT,
        ordine       INTEGER DEFAULT 0,
        is_default   INTEGER DEFAULT 1,
        attivo       INTEGER DEFAULT 1
      );
      -- l'indice arriva più avanti (deduplicaTagInRadice), DOPO aver ripulito
      -- eventuali doppioni già presenti — altrimenti questo INSERT fallirebbe
      -- appena incontra il primo doppione già esistente

      INSERT INTO tag (id, categoria_id, genitore_id, e_cartella, nome, colore, ordine, is_default, attivo)
      SELECT id, categoria_id, genitore_id, e_cartella, nome, colore, ordine, is_default, attivo FROM tag_old;

      DROP TABLE tag_old;

      ALTER TABLE evento_tag RENAME TO evento_tag_old;

      CREATE TABLE evento_tag (
        evento_id INTEGER NOT NULL REFERENCES eventi(id) ON DELETE CASCADE,
        tag_id    INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
        PRIMARY KEY (evento_id, tag_id)
      );

      INSERT INTO evento_tag (evento_id, tag_id) SELECT evento_id, tag_id FROM evento_tag_old;

      DROP TABLE evento_tag_old;
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function migraPannelliTag(db) {
  const colonneEsistenti = db.prepare("PRAGMA table_info(categorie_tag)").all().map(c => c.name);
  if (colonneEsistenti.includes('pannello_id')) return; // già migrato

  const tabelle = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  if (!tabelle.includes('categorie_tag')) return; // DB nuovo: lo crea già giusto schema.sql più avanti

  db.exec(`
    CREATE TABLE IF NOT EXISTS pannelli_tag (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      nome   TEXT NOT NULL UNIQUE,
      ordine INTEGER DEFAULT 0
    );
    INSERT OR IGNORE INTO pannelli_tag (nome, ordine) VALUES ('Partita', 1);
  `);
  const pannelloDefault = db.prepare("SELECT id FROM pannelli_tag WHERE nome = 'Partita'").get();

  // IMPORTANTE: disattivo le foreign key prima di rinominare/eliminare la
  // vecchia tabella — altrimenti "tag" (che referenzia categorie_tag in
  // cascata) verrebbe svuotata quando la vecchia tabella viene droppata,
  // anche se gli id nella nuova tabella restano identici.
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      ALTER TABLE categorie_tag RENAME TO categorie_tag_old;

      CREATE TABLE categorie_tag (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        pannello_id  INTEGER NOT NULL REFERENCES pannelli_tag(id) ON DELETE CASCADE,
        nome         TEXT NOT NULL,
        gruppo       TEXT,
        ordine       INTEGER DEFAULT 0,
        is_default   INTEGER DEFAULT 1,
        attiva       INTEGER DEFAULT 1,
        UNIQUE(pannello_id, nome)
      );
    `);

    db.prepare(`
      INSERT INTO categorie_tag (id, pannello_id, nome, gruppo, ordine, is_default, attiva)
      SELECT id, ?, nome, gruppo, ordine, is_default, attiva FROM categorie_tag_old
    `).run(pannelloDefault.id);

    db.exec('DROP TABLE categorie_tag_old');
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

// Ristruttura il pannello tag di default sul modello mostrato dal coach
// (screenshot del pannello XPS): Distanza Tiro, Tipologia tiro, Gesto
// tecnico con cartelle In Attacco/In Difesa, Fasi unificata, Posizione più
// granulare, più le categorie vuote "Gioco..." da compilare con le giocate
// della propria squadra. Idempotente: sui DB già migrati (o nuovi, il cui
// seed è già in questo formato) non fa nulla.
function migraPannelloXPS(db) {
  const giaFatto = db.prepare("SELECT id FROM categorie_tag WHERE nome = 'Tipologia tiro'").get();
  if (giaFatto) return; // già a posto

  // Reset pulito SOLO di tag/categorie (partite, eventi, giocatori,
  // presentazioni non vengono toccati): elimino la vecchia struttura e
  // ricostruisco da un'unica fonte — lo stesso seed-tags.sql dei DB nuovi —
  // invece di tanti passaggi separati che in caso di interruzione lasciavano
  // il pannello a metà.
  db.exec('DELETE FROM categorie_tag'); // in cascata elimina anche tag ed evento_tag

  const seedSql = fs.readFileSync(path.join(__dirname, 'db', 'seed-tags.sql'), 'utf-8');
  db.exec(seedSql);
}

function getDb() {
  if (!dbInstance) throw new Error('DB non ancora inizializzato: chiama initDb() all\'avvio.');
  return dbInstance;
}

module.exports = { initDb, getDb };
