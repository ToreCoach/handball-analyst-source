-- ============================================================
-- SEED: categorie e tag di default (ristrutturato sul modello
-- del pannello XPS mostrato dal coach: categorie con cartelle,
-- Distanza Tiro, Tipologia tiro, Gesto tecnico In Attacco/In Difesa,
-- Fasi unificata, Posizione più granulare)
-- Ogni coach potrà rinominare/disattivare/aggiungere senza
-- perdere lo storico (vedi is_default / attivo)
-- ============================================================

INSERT OR IGNORE INTO pannelli_tag (nome, ordine) VALUES ('Partita', 1);

INSERT OR IGNORE INTO categorie_tag (pannello_id, nome, gruppo, ordine)
SELECT (SELECT id FROM pannelli_tag WHERE nome = 'Partita'), nome, gruppo, ordine FROM (
  SELECT 'Attacco' AS nome, 'attacco' AS gruppo, 1 AS ordine
  UNION ALL SELECT 'Tipologia tiro', 'attacco', 2
  UNION ALL SELECT 'Gesto tecnico', 'generale', 3
  UNION ALL SELECT 'Fasi', 'generale', 4
  UNION ALL SELECT 'Difesa', 'difesa', 5
  UNION ALL SELECT 'Giocatori in campo', 'generale', 6
  UNION ALL SELECT 'Azione', 'generale', 7
  UNION ALL SELECT 'Ruolo', 'generale', 8
  UNION ALL SELECT 'Distanza Tiro', 'generale', 9
  UNION ALL SELECT 'Esito', 'generale', 10
  UNION ALL SELECT 'Portiere', 'generale', 11
  UNION ALL SELECT 'Gioco standard', 'generale', 12
  UNION ALL SELECT 'Gioco a 4', 'generale', 13
  UNION ALL SELECT 'Gioco 7vs6', 'generale', 14
  UNION ALL SELECT 'Gioco Extra Player', 'generale', 15
  UNION ALL SELECT 'Gioco 6vs5', 'generale', 16
);

-- Attacco: sistemi offensivi
INSERT OR IGNORE INTO tag (categoria_id, nome, ordine)
SELECT id, v, rowid FROM categorie_tag, (SELECT '6:0' v UNION SELECT '5:1' UNION SELECT '4:2' UNION SELECT '3:3')
WHERE categorie_tag.nome = 'Attacco';

-- Difesa: sistemi difensivi
INSERT OR IGNORE INTO tag (categoria_id, nome, ordine)
SELECT id, v, rowid FROM categorie_tag, (SELECT '6:0' v UNION SELECT '5:1' UNION SELECT '4:2' UNION SELECT '3:3')
WHERE categorie_tag.nome = 'Difesa';

-- Tipologia tiro
INSERT OR IGNORE INTO tag (categoria_id, nome, ordine)
SELECT id, v, rowid FROM categorie_tag,
  (SELECT 'Elevazione' v UNION SELECT 'Appoggio' UNION SELECT 'Sottomano'
   UNION SELECT '1vs1' UNION SELECT 'Penetrazione' UNION SELECT 'Fly')
WHERE categorie_tag.nome = 'Tipologia tiro';

-- Fasi (unica: sostituisce la vecchia coppia Rete realizzata/subita)
INSERT OR IGNORE INTO tag (categoria_id, nome, ordine)
SELECT id, v, rowid FROM categorie_tag, (SELECT '1ª Fase' v UNION SELECT '2ª Fase' UNION SELECT '3ª Fase' UNION SELECT '4ª Fase')
WHERE categorie_tag.nome = 'Fasi';

-- Giocatori in campo
INSERT OR IGNORE INTO tag (categoria_id, nome, ordine)
SELECT id, v, rowid FROM categorie_tag,
  (SELECT '6vs6' v UNION SELECT 'Superiorità numerica' UNION SELECT 'Inferiorità numerica' UNION SELECT '7vs6' UNION SELECT 'Empty goal')
WHERE categorie_tag.nome = 'Giocatori in campo';

-- Azione: esito
INSERT OR IGNORE INTO tag (categoria_id, nome, colore, ordine)
SELECT id, v, c, rowid FROM categorie_tag,
  (SELECT 'Positivo' v, '#2e7d32' c UNION SELECT 'Negativo', '#c62828' UNION SELECT 'Neutro', '#757575')
WHERE categorie_tag.nome = 'Azione';

-- Ruolo (Posizione)
INSERT OR IGNORE INTO tag (categoria_id, nome, ordine)
SELECT id, v, rowid FROM categorie_tag,
  (SELECT 'Ala sx' v UNION SELECT 'Ala dx' UNION SELECT 'Terzino sx' UNION SELECT 'Terzino dx'
   UNION SELECT 'Centrale' UNION SELECT 'Centrale sx' UNION SELECT 'Centrale dx'
   UNION SELECT 'Pivot' UNION SELECT 'Portiere')
WHERE categorie_tag.nome = 'Ruolo';

-- Distanza Tiro
INSERT OR IGNORE INTO tag (categoria_id, nome, ordine)
SELECT id, v, rowid FROM categorie_tag,
  (SELECT '6m' v UNION SELECT '7m' UNION SELECT '9m' UNION SELECT '10m+' UNION SELECT 'Lunga distanza')
WHERE categorie_tag.nome = 'Distanza Tiro';

-- Esito
INSERT OR IGNORE INTO tag (categoria_id, nome, colore, ordine)
SELECT id, v, c, rowid FROM categorie_tag,
  (SELECT 'Goal' v, '#2e7d32' c UNION SELECT 'No Goal', '#1565c0')
WHERE categorie_tag.nome = 'Esito';

-- Portiere: valutazione prestazione + collaborazione muro
INSERT OR IGNORE INTO tag (categoria_id, nome, colore, ordine)
SELECT id, v, c, rowid FROM categorie_tag,
  (SELECT 'Positivo' v, '#2e7d32' c UNION SELECT 'Negativo', '#c62828' UNION SELECT 'Collaborazione Muro', NULL)
WHERE categorie_tag.nome = 'Portiere';

-- Gesto tecnico: due cartelle, In Attacco e In Difesa
INSERT OR IGNORE INTO tag (categoria_id, nome, e_cartella, ordine)
SELECT id, 'In Attacco', 1, 1 FROM categorie_tag WHERE nome = 'Gesto tecnico';
INSERT OR IGNORE INTO tag (categoria_id, nome, e_cartella, ordine)
SELECT id, 'In Difesa', 1, 2 FROM categorie_tag WHERE nome = 'Gesto tecnico';

INSERT OR IGNORE INTO tag (categoria_id, genitore_id, nome, ordine)
SELECT t.categoria_id, t.id, v, rowid FROM tag t,
  (SELECT 'Assist' v UNION SELECT 'Sfondo' UNION SELECT 'Palla persa'
   UNION SELECT 'Invasione' UNION SELECT 'Passi' UNION SELECT 'Doppia')
WHERE t.nome = 'In Attacco' AND t.e_cartella = 1;

INSERT OR IGNORE INTO tag (categoria_id, genitore_id, nome, ordine)
SELECT t.categoria_id, t.id, v, rowid FROM tag t,
  (SELECT 'Palla recuperata' v UNION SELECT 'Anticipo' UNION SELECT 'Muro' UNION SELECT 'Compattezza'
   UNION SELECT 'Errore indotto' UNION SELECT 'Attitudine' UNION SELECT 'Aiuto' UNION SELECT 'Fallo'
   UNION SELECT 'Ammonizione' UNION SELECT 'Esclusione 2''' UNION SELECT 'Esclusione def' UNION SELECT 'Errore difensivo')
WHERE t.nome = 'In Difesa' AND t.e_cartella = 1;
