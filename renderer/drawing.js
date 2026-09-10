// ============================================================
// Modulo disegno tattico: overlay canvas sopra il video.
// Le forme sono salvate come JSON (vettoriale) legato all'evento,
// non "bruciate" nel video.
// ============================================================
window.Disegno = (function () {
  let canvas, ctx, video;
  let forme = [];
  let strumentoAttivo = null;

  // stile corrente, letto dalla toolbar
  let stile = {
    colore: '#ff3b30', spessore: 4, tratteggiata: false, freccia: true, font: 'Barlow', dimensioneTesto: 22,
    coloreTesto: '#ffffff', sfondoTesto: '#000000', sfondoTestoAttivo: true,
    bordoTesto: '#ffffff', bordoTestoAttivo: true
  };

  // stato di disegno in corso
  let percorsoInCorso = null;   // { punti: [...] } mentre si clicca un percorso
  let trascinamento = null;     // { tipo, x0, y0 } per cerchio/triangolo/fascio

  // selezione/spostamento di una forma già esistente
  let formaSelezionata = null;
  let trascinamentoSelezione = null; // { ultimoX, ultimoY } mentre si trascina

  let callbackTestoFissoConfermato = null; // avvisa l'app quando un testo fisso viene confermato

  function init(videoEl, canvasEl, opzioni) {
    video = videoEl;
    canvas = canvasEl;
    ctx = canvas.getContext('2d');

    Object.assign(stile, opzioni.stileIniziale || {});
    callbackTestoFissoConfermato = opzioni.onTestoFissoConfermato || null;
    canvas.style.pointerEvents = 'none'; // esplicito: nessuno strumento attivo all'avvio

    const ridimensiona = () => {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
      ridisegnaTutto();
    };
    video.addEventListener('loadedmetadata', ridimensiona);
    window.addEventListener('resize', ridimensiona);
    ridimensiona();

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('dblclick', finalizzaPercorso);

    window.addEventListener('keydown', (e) => {
      // mai intercettare se si sta scrivendo in un campo di testo qualsiasi
      // (incluso l'input volante per disegnare il testo sul campo)
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.key === 'Enter') finalizzaPercorso();
      if (e.key === 'Escape') { percorsoInCorso = null; ridisegnaTutto(); }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); eliminaSelezionata(); }
    });
  }

  function impostaStrumento(nome) {
    strumentoAttivo = nome;
    percorsoInCorso = null;
    canvas.style.pointerEvents = nome ? 'auto' : 'none';
    if (nome !== 'seleziona') {
      formaSelezionata = null;
      trascinamentoSelezione = null;
      ridisegnaTutto();
    }
  }

  function impostaStile(parziale) { Object.assign(stile, parziale); }

  // Carica le forme di UNA clip (JSON salvato in presentazione_eventi.disegni_json)
  // dimensioni del canvas nel momento in cui "forme" è stata popolata
  // (tramite caricaForme) — usate in export per generare l'immagine alle
  // coordinate GIUSTE per quella specifica clip, non per quella che
  // capita di essere aperta nell'editor in quel momento
  let formeCanvasSize = null;

  function caricaForme(json) {
    if (!json) {
      forme = [];
      formeCanvasSize = null;
    } else {
      const dati = JSON.parse(json);
      if (Array.isArray(dati)) {
        // formato salvato PRIMA di questa correzione: solo l'array di forme,
        // senza dimensioni — uso quelle del canvas attuale, meglio di niente
        forme = dati;
        formeCanvasSize = null;
      } else {
        forme = dati.forme || [];
        formeCanvasSize = dati.canvasSize || null;
      }
    }
    formaSelezionata = null;
    ridisegnaTutto();
  }

  function ottieniFormeJSON() {
    return JSON.stringify({ forme, canvasSize: { larghezza: canvas.width, altezza: canvas.height } });
  }

  // Renderizza le forme correnti su un canvas offscreen e restituisce un PNG
  // base64: usato in fase di export per comporre l'overlay dei disegni sopra
  // il video via ffmpeg. Usa le dimensioni SALVATE insieme a queste forme
  // (non quelle del canvas visibile ora, che potrebbe appartenere a
  // tutt'altra clip ancora aperta nell'editor).
  function generaPngPerExport(soloFissi) {
    const formeDaDisegnare = soloFissi ? forme.filter(f => f.fisso) : forme;
    if (formeDaDisegnare.length === 0) return null;
    const off = document.createElement('canvas');
    off.width = (formeCanvasSize && formeCanvasSize.larghezza) || canvas.width;
    off.height = (formeCanvasSize && formeCanvasSize.altezza) || canvas.height;
    const ctxOriginale = ctx;
    ctx = off.getContext('2d');
    formeDaDisegnare.forEach(disegnaForma);
    const dataUrl = off.toDataURL('image/png');
    ctx = ctxOriginale;
    return dataUrl;
  }

  function annullaUltimo() { forme.pop(); formaSelezionata = null; ridisegnaTutto(); }
  function cancellaTutto() { forme = []; formaSelezionata = null; ridisegnaTutto(); }

  // Come cancellaTutto, ma preserva le forme marcate "fisse" (es. il testo
  // applicato a più clip): usata quando il video riparte a giocare, così i
  // disegni tattici normali spariscono ma un testo fisso resta visibile
  function cancellaNonFissi() {
    forme = forme.filter(f => f.fisso);
    formaSelezionata = null;
    ridisegnaTutto();
  }

  function eliminaSelezionata() {
    if (!formaSelezionata) return;
    forme = forme.filter(f => f !== formaSelezionata);
    formaSelezionata = null;
    ridisegnaTutto();
  }

  function haSelezione() { return formaSelezionata !== null; }

  // --------------------------------------------------------
  // Interazione mouse
  // --------------------------------------------------------
  function posizione(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onMouseDown(e) {
    const p = posizione(e);

    if (strumentoAttivo === 'seleziona') {
      // topmost prima: cerco a partire dall'ultima forma disegnata
      const trovata = [...forme].reverse().find(f => formaContienePunto(f, p));
      formaSelezionata = trovata || null;
      trascinamentoSelezione = trovata ? { ultimoX: p.x, ultimoY: p.y } : null;
      ridisegnaTutto();
      return;
    }

    if (!strumentoAttivo) return;

    if (strumentoAttivo === 'percorso') {
      if (!percorsoInCorso) percorsoInCorso = { tipo: 'percorso', punti: [p], ...stile };
      else percorsoInCorso.punti.push(p);
      ridisegnaTutto();
      return;
    }

    if (strumentoAttivo === 'testo') {
      apriInputTesto(p, false);
      return;
    }
    if (strumentoAttivo === 'testo-fisso') {
      apriInputTesto(p, true);
      return;
    }

    // cerchio, triangolo, fascio: trascinamento da un punto iniziale
    trascinamento = { tipo: strumentoAttivo, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }

  function onMouseMove(e) {
    const p = posizione(e);

    if (trascinamentoSelezione && formaSelezionata) {
      const dx = p.x - trascinamentoSelezione.ultimoX;
      const dy = p.y - trascinamentoSelezione.ultimoY;
      spostaForma(formaSelezionata, dx, dy);
      trascinamentoSelezione.ultimoX = p.x;
      trascinamentoSelezione.ultimoY = p.y;
      ridisegnaTutto();
      return;
    }

    if (percorsoInCorso) {
      ridisegnaTutto();
      disegnaForma({ ...percorsoInCorso, punti: [...percorsoInCorso.punti, p] });
      return;
    }

    if (trascinamento) {
      trascinamento.x1 = p.x;
      trascinamento.y1 = p.y;
      ridisegnaTutto();
      disegnaForma(formaDaTrascinamento(trascinamento));
    }
  }

  function onMouseUp() {
    if (trascinamentoSelezione) {
      trascinamentoSelezione = null;
      return;
    }
    if (trascinamento) {
      forme.push(formaDaTrascinamento(trascinamento));
      trascinamento = null;
      ridisegnaTutto();
    }
  }

  function finalizzaPercorso() {
    if (percorsoInCorso && percorsoInCorso.punti.length >= 2) {
      forme.push(percorsoInCorso);
    }
    percorsoInCorso = null;
    ridisegnaTutto();
  }

  function formaDaTrascinamento(t) {
    if (t.tipo === 'cerchio') {
      const r = Math.hypot(t.x1 - t.x0, t.y1 - t.y0);
      return { tipo: 'cerchio', cx: t.x0, cy: t.y0, r, ...stile };
    }
    if (t.tipo === 'triangolo') {
      return { tipo: 'triangolo', x: Math.min(t.x0, t.x1), y: Math.min(t.y0, t.y1),
               w: Math.abs(t.x1 - t.x0), h: Math.abs(t.y1 - t.y0), ...stile };
    }
    if (t.tipo === 'fascio') {
      return {
        tipo: 'fascio', x: t.x0, y: t.y0,
        lunghezza: t.y0, // sempre dal bordo superiore del video (il "tetto") fino al punto cliccato
        larghezza: Math.max(18, Math.abs(t.x1 - t.x0) * 2 || 36),
        colore: stile.colore
      };
    }
  }

  // --------------------------------------------------------
  // Selezione: bounding box, hit-test, spostamento per tipo di forma
  // --------------------------------------------------------
  function bboxForma(f) {
    const pad = 10;
    if (f.tipo === 'percorso') {
      const xs = f.punti.map(p => p.x), ys = f.punti.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    if (f.tipo === 'cerchio') return { x: f.cx - f.r - pad, y: f.cy - f.r - pad, w: (f.r + pad) * 2, h: (f.r + pad) * 2 };
    if (f.tipo === 'triangolo') return { x: f.x - pad, y: f.y - pad, w: f.w + pad * 2, h: f.h + pad * 2 };
    if (f.tipo === 'testo') {
      const righe = f.testo.split('\n');
      const larghezzaMax = Math.max(...righe.map(r => r.length)) * f.dimensione * 0.6;
      const altezzaTotale = righe.length * f.dimensione * 1.3;
      return { x: f.x - pad, y: f.y - pad, w: larghezzaMax + pad * 2, h: altezzaTotale + pad * 2 };
    }
    if (f.tipo === 'fascio') {
      const apiceY = Math.max(0, f.y - f.lunghezza);
      return { x: f.x - f.larghezza / 2 - pad, y: apiceY - pad, w: f.larghezza + pad * 2, h: (f.y - apiceY) + pad * 2 };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  function puntoInBbox(p, box) {
    return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h;
  }

  function distanzaPuntoSegmento(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lungh2 = dx * dx + dy * dy;
    if (lungh2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lungh2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function formaContienePunto(f, p) {
    if (f.tipo === 'percorso') {
      const soglia = 10;
      for (let i = 0; i < f.punti.length - 1; i++) {
        if (distanzaPuntoSegmento(p, f.punti[i], f.punti[i + 1]) <= soglia) return true;
      }
      return false;
    }
    if (f.tipo === 'cerchio') {
      return Math.hypot(p.x - f.cx, p.y - f.cy) <= f.r + 10;
    }
    return puntoInBbox(p, bboxForma(f)); // triangolo, testo, fascio: bbox approssimata
  }

  function spostaForma(f, dx, dy) {
    if (f.tipo === 'percorso') f.punti.forEach(p => { p.x += dx; p.y += dy; });
    else if (f.tipo === 'cerchio') { f.cx += dx; f.cy += dy; }
    else { f.x += dx; f.y += dy; } // triangolo, testo, fascio
  }

  // --------------------------------------------------------
  // Testo: casella HTML multi-riga posizionata sul punto scelto.
  // Invio va a capo (comportamento naturale textarea); si conferma
  // cliccando fuori dal campo, oppure Escape per annullare.
  // --------------------------------------------------------
  function apriInputTesto(p, fisso) {
    // fotografo lo stile scelto ORA, nel momento del click — non lo rileggo
    // più dopo, così qualsiasi ritardo del selettore colore nativo non può
    // più disallinearsi da quello che l'utente vedeva scegliere
    const stileTesto = {
      colore: stile.coloreTesto,
      sfondo: stile.sfondoTestoAttivo ? stile.sfondoTesto : null,
      bordo: stile.bordoTesto,
      bordoAttivo: stile.bordoTestoAttivo,
      font: stile.font,
      dimensione: stile.dimensioneTesto
    };

    const area = document.createElement('textarea');
    area.className = 'disegno-input-testo';
    area.rows = 1;
    area.style.left = `${p.x}px`;
    area.style.top = `${p.y}px`;
    area.style.color = stileTesto.colore;
    area.style.background = stileTesto.sfondo || 'transparent';
    area.style.fontFamily = stileTesto.font;
    area.style.fontSize = `${stileTesto.dimensione}px`;
    if (fisso) area.style.outline = '2px solid #8ce600'; // segnale visivo: questo testo sarà "fisso"
    canvas.parentElement.appendChild(area);

    // la casella cresce da sola in larghezza/altezza seguendo il contenuto,
    // così vedi già mentre scrivi che forma avrà il riquadro finale
    const adattaDimensione = () => {
      const righe = area.value.split('\n');
      const carattereMax = Math.max(1, ...righe.map(r => r.length));
      area.style.width = `${Math.max(50, carattereMax * stileTesto.dimensione * 0.62 + 16)}px`;
      area.style.height = `${righe.length * stileTesto.dimensione * 1.3 + 14}px`;
    };
    area.addEventListener('input', adattaDimensione);

    // Focus DIFFERITO: se lo chiamiamo nello stesso istante sincrono del click
    // che ha aperto il campo, il browser a volte processa il proprio focus-shift
    // di default DOPO il nostro .focus() e glielo toglie subito — bug classico.
    // Rimandarlo a un nuovo giro dell'event loop lo rende affidabile.
    setTimeout(() => { area.focus(); adattaDimensione(); }, 0);

    let confermato = false;
    const conferma = () => {
      if (confermato) return; // evita doppio invio (blur causato da remove())
      confermato = true;
      const testo = area.value.replace(/\n+$/, ''); // toglie eventuali righe vuote finali
      if (testo.trim()) {
        const forma = {
          tipo: 'testo', x: p.x, y: p.y, testo,
          colore: stileTesto.colore, font: stileTesto.font, dimensione: stileTesto.dimensione,
          sfondo: stileTesto.sfondo, bordo: stileTesto.bordo, bordoAttivo: stileTesto.bordoAttivo,
          fisso: !!fisso
        };
        forme.push(forma);
        ridisegnaTutto();
        // se è un testo fisso, avviso subito l'app: apre il piccolo editor
        // "applica a quante clip" senza bisogno di un secondo passaggio manuale
        if (fisso && callbackTestoFissoConfermato) callbackTestoFissoConfermato(forma);
      }
      area.remove();
    };
    area.addEventListener('keydown', (e) => {
      e.stopPropagation(); // non far arrivare Escape/Backspace ai listener globali (Invio resta normale: va a capo)
      if (e.key === 'Escape') { confermato = true; area.remove(); }
    });
    area.addEventListener('blur', conferma);
  }

  // --------------------------------------------------------
  // Rendering
  // --------------------------------------------------------
  function ridisegnaTutto() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    forme.forEach(disegnaForma);
    if (formaSelezionata) disegnaContornoSelezione(formaSelezionata);
  }

  function disegnaContornoSelezione(f) {
    const box = bboxForma(f);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#4da3ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }

  function disegnaForma(f) {
    ctx.save();
    ctx.strokeStyle = f.colore || stile.colore;
    ctx.fillStyle = f.colore || stile.colore;
    ctx.lineWidth = f.spessore || stile.spessore;
    ctx.setLineDash(f.tratteggiata ? [10, 8] : []);

    if (f.tipo === 'percorso') disegnaPercorso(f);
    else if (f.tipo === 'cerchio') disegnaCerchio(f);
    else if (f.tipo === 'triangolo') disegnaTriangolo(f);
    else if (f.tipo === 'testo') disegnaTesto(f);
    else if (f.tipo === 'fascio') disegnaFascio(f);

    ctx.restore();
  }

  function disegnaPercorso(f) {
    const pts = f.punti;
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);

    if (f.curva && pts.length > 2) {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    } else {
      pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    }
    ctx.stroke();

    if (f.freccia) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      disegnaPuntaFreccia(a, b, f.colore || stile.colore, f.spessore || stile.spessore);
    }
  }

  function disegnaPuntaFreccia(a, b, colore, spessore) {
    const angolo = Math.atan2(b.y - a.y, b.x - a.x);
    const lunghezza = 10 + spessore * 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - lunghezza * Math.cos(angolo - Math.PI / 7), b.y - lunghezza * Math.sin(angolo - Math.PI / 7));
    ctx.lineTo(b.x - lunghezza * Math.cos(angolo + Math.PI / 7), b.y - lunghezza * Math.sin(angolo + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = colore;
    ctx.fill();
  }

  function disegnaCerchio(f) {
    ctx.beginPath();
    ctx.arc(f.cx, f.cy, f.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  function disegnaTriangolo(f) {
    ctx.beginPath();
    ctx.moveTo(f.x + f.w / 2, f.y);
    ctx.lineTo(f.x + f.w, f.y + f.h);
    ctx.lineTo(f.x, f.y + f.h);
    ctx.closePath();
    ctx.stroke();
  }

  function disegnaTesto(f) {
    ctx.setLineDash([]);
    ctx.font = `700 ${f.dimensione}px ${f.font}, sans-serif`;

    const righe = f.testo.split('\n');
    const altezzaRiga = f.dimensione * 1.3;

    if (f.sfondo) {
      const paddingX = 10, paddingY = 6;
      const larghezzaMax = Math.max(...righe.map(r => ctx.measureText(r).width));
      const altezzaTotale = righe.length * altezzaRiga;
      const { r, g, b } = esadecimaleInRgb(f.sfondo);

      ctx.fillStyle = `rgba(${r},${g},${b},0.72)`;
      ctx.fillRect(f.x - paddingX, f.y - paddingY, larghezzaMax + paddingX * 2, altezzaTotale + paddingY * 2);

      if (f.bordoAttivo) {
        ctx.strokeStyle = f.bordo || f.colore;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(f.x - paddingX, f.y - paddingY, larghezzaMax + paddingX * 2, altezzaTotale + paddingY * 2);
      }
    }

    ctx.fillStyle = f.colore;
    ctx.textBaseline = 'top';
    righe.forEach((riga, i) => ctx.fillText(riga, f.x, f.y + i * altezzaRiga));
  }

  // Converte un colore esadecimale (#rrggbb) nei suoi componenti r,g,b,
  // necessari per costruire le sfumature rgba() del fascio di luce
  function esadecimaleInRgb(hex) {
    const pulito = (hex || '#ffe08a').replace('#', '');
    const bignum = parseInt(pulito.length === 3
      ? pulito.split('').map(c => c + c).join('')
      : pulito, 16);
    return { r: (bignum >> 16) & 255, g: (bignum >> 8) & 255, b: bignum & 255 };
  }

  function disegnaFascio(f) {
    ctx.setLineDash([]);
    const { r, g, b } = esadecimaleInRgb(f.colore);
    const centroX = f.x;
    const baseY = f.y;
    const cimaY = Math.max(0, f.y - f.lunghezza);
    const semiLarghezza = f.larghezza / 2;

    // corpo CILINDRICO: larghezza costante dall'alto in basso (non più un cono),
    // con una dissolvenza verso l'alto
    const gradiente = ctx.createLinearGradient(centroX, cimaY, centroX, baseY);
    gradiente.addColorStop(0, `rgba(${r},${g},${b},0)`);
    gradiente.addColorStop(0.75, `rgba(${r},${g},${b},0.35)`);
    gradiente.addColorStop(1, `rgba(${r},${g},${b},0.55)`);

    ctx.beginPath();
    ctx.rect(centroX - semiLarghezza, cimaY, semiLarghezza * 2, baseY - cimaY);
    ctx.fillStyle = gradiente;
    ctx.fill();

    // alone morbido alla base, sul punto/giocatore evidenziato
    const alone = ctx.createRadialGradient(centroX, baseY, 0, centroX, baseY, semiLarghezza * 1.4);
    alone.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
    alone.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.ellipse(centroX, baseY, semiLarghezza * 1.4, semiLarghezza * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = alone;
    ctx.fill();
  }

  // Ultimo testo disegnato su questa clip (serve al pulsante "applica a più
  // clip" in Presentazioni: prende l'ultima scritta fatta e la duplica avanti)
  function ultimoTesto() {
    const testi = forme.filter(f => f.tipo === 'testo');
    return testi.length ? testi[testi.length - 1] : null;
  }

  return {
    init, impostaStrumento, impostaStile, caricaForme, ottieniFormeJSON, generaPngPerExport,
    annullaUltimo, cancellaTutto, cancellaNonFissi, eliminaSelezionata, haSelezione, ultimoTesto
  };
})();
