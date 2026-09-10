const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');

// Punto critico per il pacchetto distribuito: dentro l'app impacchettata
// (.asar) il percorso restituito da ffmpeg-static punta ancora dentro
// l'archivio compresso — da lì un programma non può essere ESEGUITO
// (si può solo leggere), serve reindirizzarlo alla cartella "estratta"
// gestita da electron-builder tramite "asarUnpack" in package.json.
// In sviluppo (npm start) non esiste nessun app.asar, quindi questa riga
// non cambia nulla e il percorso resta quello originale.
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
ffmpeg.setFfmpegPath(ffmpegPath);

// Taglia un singolo segmento dal video sorgente, con overlay PNG opzionale
// L'audio non accetta qualsiasi velocità in un colpo solo: il filtro
// "atempo" di ffmpeg funziona solo tra 0.5x e 2x — per un rallentatore più
// spinto (es. 0.25x) serve incatenare più filtri atempo insieme.
function catenaAtempo(velocita) {
  const filtri = [];
  let rimanente = velocita;
  while (rimanente < 0.5) { filtri.push('atempo=0.5'); rimanente /= 0.5; }
  while (rimanente > 2.0) { filtri.push('atempo=2.0'); rimanente /= 2.0; }
  filtri.push(`atempo=${rimanente.toFixed(6)}`);
  return filtri;
}

// Taglia una clip dal video sorgente, con: overlay opzionale dei disegni
// (i disegni fatti sopra la clip) composto sopra il video, controllo
// audio (muto del tutto, oppure volume regolato — 1 = originale), e
// velocità opzionale (1 = normale, es. 0.5 = rallentatore a metà velocità).
function tagliaClip({ videoSorgente, inizioSec, fineSec, outputPath, overlayPngPath, preset, audioMuto, audioVolume, velocita }) {
  return new Promise((resolve, reject) => {
    const durata = Math.max(0.1, fineSec - inizioSec);
    const presetFinale = preset || 'veryfast';
    const velocitaFinale = velocita && velocita > 0 ? velocita : 1;
    const cambiaVelocita = Math.abs(velocitaFinale - 1) > 0.001;
    const cmd = ffmpeg(videoSorgente).setStartTime(inizioSec).setDuration(durata);

    // rallentare/accelerare il VIDEO si fa con setpts: un fattore 2x sul
    // tempo raddoppia la durata (metà velocità), quindi il moltiplicatore
    // da usare è l'inverso della velocità desiderata
    const filtroSetpts = `setpts=${(1 / velocitaFinale).toFixed(6)}*PTS`;

    const filtroVideo = [];
    if (overlayPngPath) {
      cmd.input(overlayPngPath);
      filtroVideo.push('[1:v][0:v]scale2ref[ovl][base]');
      filtroVideo.push(cambiaVelocita
        ? `[base][ovl]overlay=0:0,${filtroSetpts}[uscita]`
        : '[base][ovl]overlay=0:0[uscita]');
    } else if (cambiaVelocita) {
      filtroVideo.push(`[0:v]${filtroSetpts}[uscita]`);
    }

    // rallentare/accelerare l'AUDIO in proporzione, altrimenti resta alla
    // velocità originale mentre il video cambia — suonerebbe sbagliato
    const opzioniAudio = [];
    if (audioMuto) {
      opzioniAudio.push('-an');
    } else {
      opzioniAudio.push('-c:a aac');
      const filtriAudio = [];
      if (cambiaVelocita) filtriAudio.push(...catenaAtempo(velocitaFinale));
      if (audioVolume != null && audioVolume !== 1) filtriAudio.push(`volume=${audioVolume}`);
      if (filtriAudio.length) opzioniAudio.push(`-af ${filtriAudio.join(',')}`);
    }

    if (filtroVideo.length > 0) {
      cmd.complexFilter(filtroVideo);
      cmd.outputOptions([
        '-map [uscita]',
        ...(audioMuto ? [] : ['-map 0:a?']),
        '-c:v libx264', `-preset ${presetFinale}`, '-r 25', '-pix_fmt yuv420p',
        ...opzioniAudio
      ]);
    } else {
      cmd.outputOptions(['-c:v libx264', `-preset ${presetFinale}`, '-r 25', '-pix_fmt yuv420p', ...opzioniAudio]);
    }

    cmd.on('end', () => resolve(outputPath)).on('error', reject).save(outputPath);
  });
}

// Estrae un singolo fotogramma fermo, al secondo esatto della pausa
function estraiFotogramma(videoSorgente, timestampSec, outputPngPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoSorgente)
      .screenshots({
        timestamps: [timestampSec],
        filename: path.basename(outputPngPath),
        folder: path.dirname(outputPngPath)
        // nessun "size": senza specificarlo, ffmpeg mantiene da solo la
        // risoluzione originale del video sorgente
      })
      .on('end', () => resolve(outputPngPath))
      .on('error', reject);
  });
}

// Compone il fotogramma fermo con l'overlay dei disegni sopra
function componiFotogrammaConOverlay(framePngPath, overlayPngPath, outputPngPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(framePngPath)
      .input(overlayPngPath)
      .complexFilter(['[1:v][0:v]scale2ref[ovl][base]', '[base][ovl]overlay=0:0'])
      .outputOptions(['-frames:v 1'])
      .on('end', () => resolve(outputPngPath))
      .on('error', reject)
      .save(outputPngPath);
  });
}

// Crea un segmento video "congelato": lo stesso fotogramma ripetuto per
// tutta la durata della pausa scelta dal coach
function creaSegmentoCongelato(immaginePngPath, durataSec, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(immaginePngPath)
      .loop(durataSec)
      .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-r 25'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// Concatena più file MP4 in un unico output, usando il concat demuxer di ffmpeg
function concatenaFile(listaFile, outputPath, cartellaTemp) {
  return new Promise((resolve, reject) => {
    const listaPath = path.join(cartellaTemp, `concat_${Date.now()}.txt`);
    const contenutoLista = listaFile.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listaPath, contenutoLista);

    ffmpeg()
      .input(listaPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

// Taglia una clip gestendo l'eventuale pausa al suo interno: se c'è una
// pausa valida, spezza in [prima della pausa] + [fermo immagine con
// disegni per la durata scelta] + [dopo la pausa], poi concatena i tre pezzi.
// Taglia una clip che può avere ZERO, UNO o PIÙ momenti di pausa/disegno.
// Tra un momento e l'altro (e prima del primo/dopo l'ultimo) va SOLO il
// testo fisso; ogni fermo immagine mostra invece i SUOI disegni completi
// (overlayPngPath specifico di quel momento).
async function tagliaClipConMomenti({ videoSorgente, inizioSec, fineSec, momenti, overlayPngPathSoloFissi, cartellaTemp, outputPath, indice, preset, audioMuto, audioVolume, velocita }) {
  const validi = (momenti || [])
    .filter(m => m.pausaTimestampSec > inizioSec && m.pausaTimestampSec < fineSec)
    .sort((a, b) => a.pausaTimestampSec - b.pausaTimestampSec);

  if (validi.length === 0) {
    // nessun momento di pausa: l'intera clip è un unico pezzo, solo testo fisso se presente
    return tagliaClip({ videoSorgente, inizioSec, fineSec, outputPath, overlayPngPath: overlayPngPathSoloFissi, preset, audioMuto, audioVolume, velocita });
  }

  const pezzi = [];
  let cursore = inizioSec;

  for (let i = 0; i < validi.length; i++) {
    const m = validi[i];

    const video = path.join(cartellaTemp, `seg_${indice}_${i}.mp4`);
    await tagliaClip({ videoSorgente, inizioSec: cursore, fineSec: m.pausaTimestampSec, outputPath: video, overlayPngPath: overlayPngPathSoloFissi, preset, audioMuto, audioVolume, velocita });
    pezzi.push(video);

    const frame = path.join(cartellaTemp, `frame_${indice}_${i}.png`);
    await estraiFotogramma(videoSorgente, m.pausaTimestampSec, frame);

    let fotogrammaFinale = frame;
    if (m.overlayPngPath) {
      fotogrammaFinale = path.join(cartellaTemp, `frame_disegnato_${indice}_${i}.png`);
      await componiFotogrammaConOverlay(frame, m.overlayPngPath, fotogrammaFinale);
    }

    const segmentoPausa = path.join(cartellaTemp, `pausa_${indice}_${i}.mp4`);
    await creaSegmentoCongelato(fotogrammaFinale, m.pausaDurataSec, segmentoPausa);
    pezzi.push(segmentoPausa);

    cursore = m.pausaTimestampSec;
  }

  const ultimo = path.join(cartellaTemp, `seg_${indice}_finale.mp4`);
  await tagliaClip({ videoSorgente, inizioSec: cursore, fineSec, outputPath: ultimo, overlayPngPath: overlayPngPathSoloFissi, preset, audioMuto, audioVolume, velocita });
  pezzi.push(ultimo);

  return concatenaFile(pezzi, outputPath, cartellaTemp);
}

// Spezza il testo su più righe perché entri nella larghezza del video,
// invece di uscire dai bordi (come è successo con un testo lungo). Rispetta
// gli "a capo" scritti a mano, e ne aggiunge altri dove servono.
function spezzaTestoPerLarghezza(testo, larghezzaFrame, fontsize) {
  const margineSicurezza = 0.82; // lascio un margine ai lati, non uso tutta la larghezza
  const larghezzaMediaCarattere = fontsize * 0.56; // stima prudente, varia da font a font
  const massimoCaratteriPerRiga = Math.max(10, Math.floor((larghezzaFrame * margineSicurezza) / larghezzaMediaCarattere));

  const righeOriginali = (testo || '').split('\n');
  const righeFinali = [];

  righeOriginali.forEach(riga => {
    const parole = riga.split(' ').filter(p => p.length > 0);
    let corrente = '';
    parole.forEach(parola => {
      const prova = corrente ? `${corrente} ${parola}` : parola;
      if (prova.length > massimoCaratteriPerRiga && corrente) {
        righeFinali.push(corrente);
        corrente = parola;
      } else {
        corrente = prova;
      }
    });
    righeFinali.push(corrente);
  });

  return righeFinali.join('\n');
}

// Genera una "schermata di testo": un video a tinta unita con una scritta
// sopra, per la durata scelta — usata come introduzione o separatore tra
// eventi, senza bisogno di un video sorgente.
// Il testo viene scritto su un file temporaneo (textfile=) invece di essere
// passato in linea: evita un sacco di problemi di escaping (apostrofi, "a
// capo", due punti) col filtro drawtext di ffmpeg.
function creaSchermataTesto({ sfondo, testo, coloreTesto, durataSec, outputPath, cartellaTemp, larghezza, altezza }) {
  return new Promise((resolve, reject) => {
    const w = larghezza || 1920;
    const h = altezza || 1080;
    const coloreFFmpeg = (sfondo || '#000000').replace('#', '0x');
    const coloreTestoFFmpeg = (coloreTesto || '#ffffff').replace('#', '0x');

    // dimensione carattere che si riduce se il testo è lungo (altrimenti,
    // spezzato su tante righe, uscirebbe fuori in verticale)
    let fontsize = 64;
    let testoFormattato = spezzaTestoPerLarghezza(testo, w, fontsize);
    const numeroRighe = testoFormattato.split('\n').length;
    if (numeroRighe > 6) fontsize = 40;
    else if (numeroRighe > 3) fontsize = 50;
    testoFormattato = spezzaTestoPerLarghezza(testo, w, fontsize); // ricalcolo l'a capo con la dimensione finale

    const testoFilePath = path.join(cartellaTemp, `testo_schermata_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(testoFilePath, testoFormattato, 'utf-8');
    // il percorso del file va scappato nel filtro (i due punti sono un separatore per ffmpeg)
    const testoFilePathEscape = testoFilePath.replace(/\\/g, '\\\\').replace(/:/g, '\\:');

    ffmpeg()
      .input(`color=c=${coloreFFmpeg}:s=${w}x${h}:d=${Math.max(0.5, durataSec || 3)}`)
      .inputFormat('lavfi')
      .videoFilters([
        `drawtext=textfile='${testoFilePathEscape}':fontcolor=${coloreTestoFFmpeg}:fontsize=${fontsize}:line_spacing=14:x=(w-text_w)/2:y=(h-text_h)/2`
      ])
      .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-r 25'])
      .on('end', () => resolve(outputPath))
      .on('error', reject)
      .save(outputPath);
  });
}

/**
 * Esporta una presentazione: costruisce ogni clip (con eventuale pausa) e le
 * concatena in un unico MP4, nell'ordine dato. onProgress(indiceClipCompletata,
 * totaleClips) viene chiamato dopo ogni clip finita, per una barra di avanzamento.
 */
async function esportaPresentazione({ clips, cartellaTemp, outputFinale, preset, onProgress }) {
  fs.mkdirSync(cartellaTemp, { recursive: true });

  const clipFinali = [];
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    const outPath = path.join(cartellaTemp, `clipfinale_${i}.mp4`);

    if (c.tipo === 'schermata') {
      await creaSchermataTesto({
        sfondo: c.schermataSfondo,
        testo: c.schermataTesto,
        coloreTesto: c.schermataColoreTesto,
        durataSec: c.schermataDurataSec,
        outputPath: outPath,
        cartellaTemp
      });
    } else {
      await tagliaClipConMomenti({
        videoSorgente: c.videoSorgente,
        inizioSec: c.inizioSec,
        fineSec: c.fineSec,
        momenti: c.momenti || [],
        overlayPngPathSoloFissi: c.overlayPngPathSoloFissi || null,
        cartellaTemp,
        outputPath: outPath,
        indice: i,
        preset,
        velocita: c.velocita || 1,
        audioMuto: c.audioMuto,
        audioVolume: c.audioVolume
      });
    }

    clipFinali.push(outPath);
    if (onProgress) onProgress(i + 1, clips.length);
  }

  if (clipFinali.length === 1) {
    fs.copyFileSync(clipFinali[0], outputFinale);
    return outputFinale;
  }

  if (onProgress) onProgress(clips.length, clips.length, 'concatenazione');
  return concatenaFile(clipFinali, outputFinale, cartellaTemp);
}

module.exports = { tagliaClip, tagliaClipConMomenti, esportaPresentazione };
