-- ============================================================
-- HANDBALL ANALYST - Schema database (SQLite)
-- Il DB contiene SOLO metadati. I video restano su disco/NAS.
-- ============================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------
-- Anagrafiche
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS squadre (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL,
  categoria TEXT
);

CREATE TABLE IF NOT EXISTS stagioni (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE          -- es. "2026-27"
);

CREATE TABLE IF NOT EXISTS giocatori (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nome       TEXT NOT NULL,
  cognome    TEXT,
  numero     INTEGER,
  ruolo      TEXT,                    -- Ala sx / Terzino sx / Centrale / Terzino dx / Ala dx / Pivot / Portiere
  ordine     INTEGER DEFAULT 0,       -- ordine personalizzato nella rosa, il coach lo sceglie liberamente
  squadra_id INTEGER REFERENCES squadre(id) ON DELETE SET NULL
);

-- --------------------------------------------------------
-- Partite / video
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS partite (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  squadra_casa_id  INTEGER REFERENCES squadre(id),
  squadra_ospite_id INTEGER REFERENCES squadre(id),
  data             TEXT,              -- ISO date
  stagione_id      INTEGER REFERENCES stagioni(id),
  competizione     TEXT,              -- es. "Serie A Silver"
  video_path       TEXT NOT NULL,     -- percorso del video originale (qualità piena, per l'export)
  proxy_path       TEXT,              -- percorso del proxy a bassa risoluzione (per editing/scrub veloce)
  video_device_id  TEXT,              -- identificativo volume (SSD/NAS) per rilevare disconnessione
  durata_sec       INTEGER,
  risultato_casa   INTEGER,
  risultato_ospite INTEGER
);

-- --------------------------------------------------------
-- Tag: categorie + tag, con supporto default/custom
-- --------------------------------------------------------
-- Pannelli tag: raccolte di categorie con un nome (es. "Partita", "Didattica"),
-- per poter scegliere in Analisi quale set di tag usare a seconda dello scopo
CREATE TABLE IF NOT EXISTS pannelli_tag (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  nome   TEXT NOT NULL UNIQUE,
  ordine INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categorie_tag (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pannello_id  INTEGER NOT NULL REFERENCES pannelli_tag(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,          -- es. "Attacco", "Difesa", "Ruolo" — unico DENTRO il pannello, non più globale
  gruppo       TEXT,                   -- raggruppamento UI: 'attacco' | 'difesa' | 'generale'
  ordine       INTEGER DEFAULT 0,
  is_default   INTEGER DEFAULT 1,      -- 1 = categoria di sistema, 0 = creata dal coach
  attiva       INTEGER DEFAULT 1,
  UNIQUE(pannello_id, nome)
);

CREATE TABLE IF NOT EXISTS tag (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria_id INTEGER NOT NULL REFERENCES categorie_tag(id) ON DELETE CASCADE,
  genitore_id  INTEGER REFERENCES tag(id) ON DELETE CASCADE,  -- se dentro una cartella, punta alla cartella
  e_cartella   INTEGER DEFAULT 0,     -- 1 = è una cartella (contenitore, non assegnabile a un evento)
  nome         TEXT NOT NULL,
  colore       TEXT,                   -- hex, per la UI (badge colorati come nel mockup)
  ordine       INTEGER DEFAULT 0,
  is_default   INTEGER DEFAULT 1,      -- 1 = tag di sistema, 0 = creato dal coach
  attivo       INTEGER DEFAULT 1       -- il coach può disattivare senza cancellare (mantiene storico)
);
-- L'indice univoco (categoria_id, genitore_id, nome) viene creato in db.js,
-- in una migrazione apposita DOPO aver ripulito eventuali doppioni già
-- esistenti — crearlo qui, eseguito ad ogni avvio prima di quella pulizia,
-- farebbe fallire l'apertura dell'app per chiunque avesse già dei doppioni.

-- --------------------------------------------------------
-- Eventi: intervallo definito dal coach in diretta (Z = inizio, M = fine),
-- poi taggato. È l'unità base dell'archivio "Eventi".
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS eventi (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  partita_id            INTEGER NOT NULL REFERENCES partite(id) ON DELETE CASCADE,
  inizio_sec            REAL NOT NULL,          -- momento del tasto Z
  fine_sec              REAL NOT NULL,          -- momento del tasto M
  squadra_riferimento_id INTEGER REFERENCES squadre(id),  -- a quale delle due squadre si riferisce l'evento
  giocatore_id          INTEGER REFERENCES giocatori(id),
  note                  TEXT,
  ordine                INTEGER DEFAULT 0,      -- ordine manuale scelto dal coach nella lista Eventi
  creato_il             TEXT DEFAULT (datetime('now'))
);

-- N:N tra evento e tag (un evento porta più tag insieme, es. Attacco 5:1 + Ala sinistra + Tiro elevazione + Gol)
CREATE TABLE IF NOT EXISTS evento_tag (
  evento_id INTEGER NOT NULL REFERENCES eventi(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (evento_id, tag_id)
);

-- --------------------------------------------------------
-- Presentazioni: raccolte di eventi (anche da partite diverse),
-- ognuno con la propria durata modificabile e i propri disegni,
-- pronte per l'esportazione in un unico MP4.
-- --------------------------------------------------------
-- --------------------------------------------------------
-- Impostazioni app: preferenze locali (chiave/valore), es. cartella
-- video predefinita, nome coach, qualità export
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS impostazioni_app (
  chiave TEXT PRIMARY KEY,
  valore TEXT
);

CREATE TABLE IF NOT EXISTS presentazioni (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  nome      TEXT NOT NULL,
  creata_il TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS presentazione_eventi (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  presentazione_id INTEGER NOT NULL REFERENCES presentazioni(id) ON DELETE CASCADE,
  evento_id        INTEGER REFERENCES eventi(id) ON DELETE CASCADE, -- NULL per le schermate di testo
  ordine           INTEGER DEFAULT 0,
  inizio_sec       REAL,               -- durata modificabile in presentazione (parte da eventi.inizio_sec)
  fine_sec         REAL,               -- durata modificabile in presentazione (parte da eventi.fine_sec)
  disegni_json     TEXT,               -- DEPRECATO: sostituito da disegni_momento (più pause per clip). Resta per compatibilità con dati vecchi, non più scritto.
  pausa_timestamp_sec REAL,            -- DEPRECATO: vedi sopra
  pausa_durata_sec    REAL DEFAULT 3,  -- DEPRECATO: vedi sopra
  tipo                  TEXT DEFAULT 'clip',   -- 'clip' (video) oppure 'schermata' (pagina di solo testo)
  schermata_sfondo      TEXT,                  -- colore di sfondo della schermata
  schermata_testo       TEXT,                  -- testo mostrato
  schermata_colore_testo TEXT DEFAULT '#ffffff',
  schermata_durata_sec  REAL DEFAULT 3,
  audio_muto            INTEGER DEFAULT 0,     -- 1 = clip senza audio nell'esportazione
  audio_volume          REAL DEFAULT 1.0,      -- 0 (silenzio) — 1 (originale) — oltre 1 per amplificare
  velocita              REAL DEFAULT 1.0       -- 1 = normale, es. 0.5 = metà velocità (rallentatore)
);

-- Una clip può avere PIÙ momenti di pausa/disegno (non solo uno): ognuno
-- ferma il video nel proprio punto, per la propria durata, con i propri
-- disegni sopra. Sostituisce disegni_json/pausa_* su presentazione_eventi.
CREATE TABLE IF NOT EXISTS disegni_momento (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  presentazione_evento_id INTEGER NOT NULL REFERENCES presentazione_eventi(id) ON DELETE CASCADE,
  ordine                  INTEGER DEFAULT 0,      -- ordine cronologico dei momenti dentro la stessa clip
  pausa_timestamp_sec     REAL NOT NULL,
  pausa_durata_sec        REAL DEFAULT 3,
  disegni_json            TEXT
);

-- --------------------------------------------------------
-- Indici
-- --------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_eventi_partita ON eventi(partita_id);
CREATE INDEX IF NOT EXISTS idx_evento_tag_tag ON evento_tag(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_categoria ON tag(categoria_id);
CREATE INDEX IF NOT EXISTS idx_pres_eventi_pres ON presentazione_eventi(presentazione_id);
