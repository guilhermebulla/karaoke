/* ============================================================
   gera-letras.js — casa as letras do Chordle com o repertório
   Rodar na raiz do kit:  node gera-letras.js
   Lê:    letras/*.cho  +  repertorio.json
   Gera:  letras.json   (índice usado pela rota /letra do server.js)
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const REP_FILE = path.join(__dirname, 'repertorio.json');
const LET_DIR = path.join(__dirname, 'letras');
const OUT_FILE = path.join(__dirname, 'letras.json');

const TITLE_KEYS = ['titulo', 'título', 'title', 'musica', 'música', 'nome', 'name', 'song'];
const ARTIST_KEYS = ['artista', 'artist', 'banda', 'interprete', 'intérprete', 'autor', 'singer'];

/* Normalização: a do server.js + pontuação/apóstrofos/feat. */
function key(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2019\u2018]/g, "'")
    .replace(/\(feat\.?[^)]*\)/gi, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function firstField(obj, names) {
  for (const n of names) {
    if (obj[n] != null && String(obj[n]).trim() !== '') return String(obj[n]).trim();
  }
  return '';
}

/* ---------- 1. Lê os .cho do Chordle ---------- */
const files = fs.readdirSync(LET_DIR).filter((f) => f.toLowerCase().endsWith('.cho'));
const letras = [];
for (const f of files) {
  let raw;
  try { raw = fs.readFileSync(path.join(LET_DIR, f), 'utf8'); }
  catch (e) { console.log('[AVISO] não li ' + f + ': ' + e.message); continue; }
  const mT = raw.match(/\{title:([^}]*)\}/i);
  const mA = raw.match(/\{artist:([^}]*)\}/i);
  if (!mT || !mT[1].trim()) { console.log('[AVISO] sem {title} — ignorado: ' + f); continue; }
  letras.push({ f: f, t: mT[1].trim(), a: mA ? mA[1].trim() : '',
    kt: key(mT[1]), ka: mA ? key(mA[1]) : '' });
}

/* ---------- 2. Lê o repertório ---------- */
let rawRep;
try { rawRep = JSON.parse(fs.readFileSync(REP_FILE, 'utf8')); }
catch (e) { console.log('[ERRO] repertorio.json: ' + e.message); process.exit(1); }
let items = Array.isArray(rawRep) ? rawRep : null;
if (!items) {
  const pref = ['musicas', 'músicas', 'songs', 'repertorio', 'repertório',
    'lista', 'data', 'items', 'itens', 'tracks'];
  for (const k of Object.keys(rawRep)) {
    if (pref.indexOf(k) !== -1 && Array.isArray(rawRep[k])) { items = rawRep[k]; break; }
  }
  if (!items) {
    for (const k of Object.keys(rawRep)) {
      if (Array.isArray(rawRep[k])) { items = rawRep[k]; break; }
    }
  }
}
if (!items) { console.log('[ERRO] repertorio.json sem lista de músicas.'); process.exit(1); }
const catalogo = items.map((o) => ({ t: firstField(o, TITLE_KEYS), a: firstField(o, ARTIST_KEYS) }))
  .filter((s) => s.t);

/* ---------- 3. Casa: par título+artista exato → título único ---------- */
const byKey = {};
const byTitle = {};
const titleCount = {};
letras.forEach((l) => { titleCount[l.kt] = (titleCount[l.kt] || 0) + 1; });
letras.forEach((l) => { byKey[l.kt + '|' + l.ka] = l; });
letras.forEach((l) => { if (titleCount[l.kt] === 1) byTitle[l.kt] = l; });

const ok = [], porTitulo = [], semLetra = [];
const usadas = {};
catalogo.forEach((s) => {
  const kt = key(s.t), ka = key(s.a);
  const l = byKey[kt + '|' + ka] || byTitle[kt] || null;
  if (l) { (byKey[kt + '|' + ka] ? ok : porTitulo).push(s); usadas[l.f] = true; }
  else semLetra.push(s);
});
const orfas = letras.filter((l) => !usadas[l.f]);

/* ---------- 4. Gera letras.json ---------- */
const indice = { byKey: {}, byTitle: {} };
letras.forEach((l) => {
  indice.byKey[l.kt + '|' + l.ka] = { f: l.f, t: l.t, a: l.a };
  if (titleCount[l.kt] === 1) indice.byTitle[l.kt] = { f: l.f, t: l.t, a: l.a };
});
fs.writeFileSync(OUT_FILE, JSON.stringify(indice), 'utf8');

/* ---------- 5. Relatório ---------- */
console.log('');
console.log('==========================================');
console.log('  LETRAS: ' + letras.length + ' arquivo(s) .cho lido(s)');
console.log('  Casadas exatas: ' + ok.length);
console.log('  Casadas por título: ' + porTitulo.length);
console.log('  Repertório SEM letra: ' + semLetra.length);
console.log('  Arquivos .cho sem dono: ' + orfas.length);
if (semLetra.length) {
  console.log('  --- Sem letra (até 25) ---');
  semLetra.slice(0, 25).forEach((s) => console.log('   · ' + s.t + (s.a ? ' — ' + s.a : '')));
  if (semLetra.length > 25) console.log('   … e mais ' + (semLetra.length - 25));
}
if (orfas.length) {
  console.log('  --- Sem dono no repertório (até 25) ---');
  orfas.slice(0, 25).forEach((l) => console.log('   · ' + l.t + (l.a ? ' — ' + l.a : '') + '  (' + l.f + ')'));
}
console.log('  Gerado: letras.json');
console.log('==========================================');
console.log('');