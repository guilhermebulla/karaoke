/* ============================================================
   KARAOKÊ DO BULLA — servidor local de fila de inscrições
   Node.js puro, zero dependências (só precisa do Node instalado)
   ------------------------------------------------------------
   COMO RODAR:
     1) Instale o Node LTS em https://nodejs.org
     2) Salve este arquivo como C:\karaoke\server.js (UTF-8)
     3) No Prompt de Comando:  cd C:\karaoke  ->  node server.js
   Estrutura esperada:
     C:\karaoke\server.js  +  C:\karaoke\repertorio.json
     C:\karaoke\public\index.html | admin.html | tv.html
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

/* ----------------------- CONFIGURAÇÕES ----------------------- */
const PORT = 8080;              // porta do site local
const ADMIN_CODE = 'bulla2026'; // código secreto do painel do artista
const CAT_FILE = path.join(__dirname, 'repertorio.json'); // catálogo
const STATE_FILE = path.join(__dirname, 'fila.json');     // estado salvo
const PUB_DIR = path.join(__dirname, 'public');           // páginas
const HIST_MAX = 50;           // performances guardadas no histórico
const MAX_ACTIVE = 3;          // máx. de pedidos ativos por pessoa
const MAX_NAME = 40;           // máx. de caracteres no nome do convidado
const MAX_EVENT = 40;          // máx. de caracteres no nome do karaokê

/* ------------------------- UTILITÁRIOS ----------------------- */
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function sanitizeText(s, maxLen) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sendJson(res, code, obj) {
  try {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(obj));
  } catch (e) { /* socket morto: ignora */ }
}

function readBody(req, cb) {
  let size = 0;
  let tooBig = false;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > 20000) { tooBig = true; chunks.length = 0; return; }
    if (!tooBig) chunks.push(c);
  });
  req.on('end', () => {
    if (tooBig) { cb(new Error('Corpo da requisição muito grande.')); return; }
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (e) { cb(e); }
  });
  req.on('error', (e) => cb(e));
}

/* -------------------------- CATÁLOGO ------------------------- */
let catalog = []; // [{ id, t, a, x }]  —  x = texto de busca normalizado

function firstField(obj, names) {
  for (const n of names) {
    if (obj[n] != null && String(obj[n]).trim() !== '') return String(obj[n]).trim();
  }
  return '';
}

const TITLE_KEYS = ['titulo', 'título', 'title', 'musica', 'música', 'nome', 'name', 'song'];
const ARTIST_KEYS = ['artista', 'artist', 'banda', 'interprete', 'intérprete', 'autor', 'singer'];

function loadCatalog() {
  catalog = [];
  let raw;
  try {
    raw = fs.readFileSync(CAT_FILE, 'utf8');
  } catch (e) {
    console.log('');
    console.log('[CATALOGO] repertorio.json nao encontrado em: ' + CAT_FILE);
    console.log('[CATALOGO] Copie o repertorio.json para a raiz do projeto e reinicie.');
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.log('');
    console.log('[CATALOGO] repertorio.json nao e um JSON valido: ' + e.message);
    console.log('[CATALOGO] COLE AS 5 PRIMEIRAS LINHAS DO ARQUIVO NO CHAT p/ corrigir o parser.');
    return;
  }
  // Aceita array direto OU array dentro de um objeto
  let items = null;
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === 'object') {
    const pref = ['musicas', 'músicas', 'songs', 'repertorio', 'repertório',
                  'lista', 'data', 'items', 'itens', 'tracks'];
    for (const k of pref) {
      if (Array.isArray(data[k])) { items = data[k]; break; }
    }
    if (!items) {
      for (const k of Object.keys(data)) {
        if (Array.isArray(data[k]) && data[k].length) { items = data[k]; break; }
      }
    }
  }
  if (!items) {
    console.log('');
    console.log('[CATALOGO] Nao achei a lista de musicas dentro do JSON.');
    console.log('[CATALOGO] COLE AS 5 PRIMEIRAS LINHAS DO ARQUIVO NO CHAT p/ corrigir o parser.');
    return;
  }
  items.forEach((it, idx) => {
    let t = '';
    let a = '';
    const extras = [];
    if (typeof it === 'string') {
      t = it.trim();
    } else if (it && typeof it === 'object') {
      t = firstField(it, TITLE_KEYS);
      a = firstField(it, ARTIST_KEYS);
      for (const k of Object.keys(it)) {
        const kl = k.toLowerCase();
        if (TITLE_KEYS.includes(kl) || ARTIST_KEYS.includes(kl)) continue;
        const v = it[k];
        if (v == null) continue;
        if (typeof v === 'string' && v.trim()) extras.push(v.trim());
        else if (typeof v === 'number' || typeof v === 'boolean') extras.push(String(v));
        else if (Array.isArray(v)) extras.push(v.map(String).join(' '));
      }
    } else {
      return;
    }
    if (!t) return;
    t = t.replace(/^\s*\d+\s*[\.\)\-]\s*/, '').trim(); // remove numeração inicial
    if (!t) return;
    catalog.push({
      id: 'i' + idx,
      t: t,
      a: a,
      x: norm(t + ' ' + a + ' ' + extras.join(' '))
    });
  });
  console.log('[CATALOGO] ' + catalog.length + ' musica(s) carregada(s).');
  if (catalog.length === 0) {
    console.log('[CATALOGO] ATENCAO: 0 musicas lidas.');
    console.log('[CATALOGO] COLE AS 5 PRIMEIRAS LINHAS DO repertorio.json NO CHAT.');
  }
}

/* -------------- ESTADO (persistido em fila.json) -------------- */
// Estados do pedido: fila -> cantando -> concluido | pulou
let state = {
  open: true,      // inscrições abertas?
  rodizio: true,   // rodízio ligado?
  current: null,   // quem está cantando agora
  fila: [],        // pedidos aguardando (em ordem de exibição)
  hist: [],        // últimas performances
  eventName: 'Karaokê do Bulla' // nome exibido em todas as telas
};
let perfCounts = {};          // nome normalizado -> nº de vezes ao microfone
let itemSeq = 0;              // gerador de ids dos pedidos
const sseClients = new Set(); // páginas conectadas em tempo real

function newItemId() {
  itemSeq += 1;
  return 'q' + Date.now().toString(36) + '_' + itemSeq;
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE,
      JSON.stringify({ state: state, perfCounts: perfCounts, itemSeq: itemSeq }, null, 1),
      'utf8');
  } catch (e) {
    console.log('[ERRO] Falha ao salvar fila.json: ' + e.message);
  }
}

function loadState() {
  try {
    const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (d && d.state) {
      state.open = !!d.state.open;
      state.rodizio = !!d.state.rodizio;
      state.eventName = (typeof d.state.eventName === 'string' && d.state.eventName.trim())
        ? d.state.eventName : state.eventName;
      state.current = d.state.current || null;
      state.fila = Array.isArray(d.state.fila) ? d.state.fila : [];
      state.hist = Array.isArray(d.state.hist) ? d.state.hist : [];
      perfCounts = d.perfCounts || {};
      itemSeq = d.itemSeq || 0;
      // Se caiu com alguém "cantando", devolve ao topo da fila
      if (state.current) {
        state.fila.unshift(state.current);
        state.current = null;
      }
      console.log('[ESTADO] fila.json restaurado (' + state.fila.length + ' pedido(s) na fila).');
    }
  } catch (e) {
    // Sem fila.json ainda: começa do zero (normal na primeira execução)
  }
}

function snapshot() {
  return {
    open: state.open,
    rodizio: state.rodizio,
    eventName: state.eventName,
    current: state.current,
    fila: state.fila,
    hist: state.hist.slice(-HIST_MAX)
  };
}

function broadcast() {
  const msg = 'data: ' + JSON.stringify(snapshot()) + '\n\n';
  sseClients.forEach((res) => {
    try { res.write(msg); } catch (e) { /* cliente caiu: ignora */ }
  });
}

/* ---------------------- REGRAS DE NEGÓCIO -------------------- */
function livePerf(name) {
  return perfCounts[norm(name)] || 0;
}

function countActive(name) {
  const k = norm(name);
  let n = state.fila.filter((i) => norm(i.name) === k).length;
  if (state.current && norm(state.current.name) === k) n += 1;
  return n;
}

function songById(id) {
  return catalog.find((s) => s.id === id) || null;
}

function addRequest(songId, rawName) {
  if (!state.open) return { ok: false, msg: 'As inscrições estão fechadas.' };
  const song = songById(String(songId || ''));
  if (!song) return { ok: false, msg: 'Música não encontrada. Atualize a página.' };
  const name = sanitizeText(rawName, MAX_NAME);
  if (!name) return { ok: false, msg: 'Digite seu nome ou apelido (até ' + MAX_NAME + ' caracteres).' };
  const k = norm(name);
  const dup = state.fila.some((i) => i.songId === song.id && norm(i.name) === k) ||
    (state.current && state.current.songId === song.id && norm(state.current.name) === k);
  if (dup) return { ok: false, msg: 'Essa música já está na sua fila.' };
  if (countActive(name) >= MAX_ACTIVE) {
    return { ok: false, msg: 'Você já tem ' + MAX_ACTIVE + ' pedidos ativos. Cante um antes de pedir outro.' };
  }
  const item = {
    itemId: newItemId(),
    songId: song.id,
    t: song.t,
    a: song.a,
    name: name,
    addedAt: Date.now(),
    perf: livePerf(name)
  };
  if (state.rodizio) {
    // Menos apresentações canta primeiro; empate = ordem de chegada
    const idx = state.fila.findIndex((i) => livePerf(i.name) > item.perf);
    if (idx === -1) state.fila.push(item);
    else state.fila.splice(idx, 0, item);
  } else {
    state.fila.push(item);
  }
  saveState();
  broadcast();
  return { ok: true };
}

function reSortQueue() {
  // Ordena: menos vezes cantou primeiro; empate = ordem de chegada
  state.fila.sort((x, y) => {
    const px = livePerf(x.name);
    const py = livePerf(y.name);
    if (px !== py) return px - py;
    return x.addedAt - y.addedAt;
  });
}

function startNext() {
  if (state.fila.length === 0) {
    state.current = null;
    return;
  }
  if (state.rodizio) reSortQueue();
  const it = state.fila.shift();
  state.current = {
    itemId: it.itemId,
    songId: it.songId,
    t: it.t,
    a: it.a,
    name: it.name,
    startedAt: Date.now()
  };
}

function finishCurrent(status) {
  // status: 'concluido' | 'pulou' — ambos contam como "passou a vez" no rodízio
  const cur = state.current;
  if (!cur) return;
  const k = norm(cur.name);
  perfCounts[k] = (perfCounts[k] || 0) + 1;
  state.hist.push({ t: cur.t, a: cur.a, name: cur.name, status: status, at: Date.now() });
  if (state.hist.length > HIST_MAX) state.hist = state.hist.slice(-HIST_MAX);
  state.current = null;
  startNext();
}

function adminAction(b) {
  if (!b || typeof b.code !== 'string' || b.code !== ADMIN_CODE) {
    return { ok: false, msg: 'Código incorreto.' };
  }
  switch (b.op) {
    case 'open':
      state.open = !!b.value;
      break;
    case 'rename': {
      const nm = sanitizeText(b.value, MAX_EVENT);
      if (!nm) return { ok: false, msg: 'Digite um nome para o karaokê.' };
      state.eventName = nm;
      break;
    }
    case 'rodizio':
      state.rodizio = !!b.value;
      if (state.rodizio) reSortQueue();
      break;
    case 'start': {
      if (state.current) {
        return { ok: false, msg: 'Alguém já está cantando — encerre antes de chamar outro.' };
      }
      const i = state.fila.findIndex((x) => x.itemId === b.id);
      if (i === -1) return { ok: false, msg: 'Esse pedido não está mais na fila.' };
      const it = state.fila.splice(i, 1)[0];
      state.current = {
        itemId: it.itemId, songId: it.songId, t: it.t, a: it.a,
        name: it.name, startedAt: Date.now()
      };
      break;
    }
    case 'done':
      if (!state.current) return { ok: false, msg: 'Ninguém está cantando agora.' };
      finishCurrent('concluido');
      break;
    case 'skip':
      if (!state.current) return { ok: false, msg: 'Ninguém está cantando agora.' };
      finishCurrent('pulou');
      break;
    case 'remove': {
      const i = state.fila.findIndex((x) => x.itemId === b.id);
      if (i === -1) return { ok: false, msg: 'Esse pedido não está mais na fila.' };
      state.fila.splice(i, 1);
      break;
    }
    case 'move': {
      const i = state.fila.findIndex((x) => x.itemId === b.id);
      if (i === -1) return { ok: false, msg: 'Esse pedido não está mais na fila.' };
      const j = i + (b.dir < 0 ? -1 : 1);
      if (j >= 0 && j < state.fila.length) {
        const tmp = state.fila.splice(i, 1)[0];
        state.fila.splice(j, 0, tmp);
      }
      break;
    }
    case 'reset':
      state.fila = [];
      state.current = null;
      state.hist = [];
      perfCounts = {};
      break;
    default:
      return { ok: false, msg: 'Operação desconhecida.' };
  }
  saveState();
  broadcast();
  return { ok: true };
}

/* --------------------------- HTTP ---------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, urlPath) {
  let p;
  try {
    p = decodeURIComponent(String(urlPath).split('?')[0]);
  } catch (e) {
    p = '/';
  }
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUB_DIR, p));
  if (file !== PUB_DIR && !file.startsWith(PUB_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 — acesso negado');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 — arquivo nao encontrado: ' + p);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = String(req.url || '/');
  const route = urlPath.split('?')[0];

  // ---------- Requisicao OPTIONS (CORS) ----------
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  // ---------- SSE: tempo real (/events) ----------
  if (route === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');
    res.write('data: ' + JSON.stringify(snapshot()) + '\n\n');
    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // ---------- APIs ----------
  if (route === '/api/catalogo') {
    sendJson(res, 200, catalog);
    return;
  }

  if (route === '/state') {
    sendJson(res, 200, snapshot());
    return;
  }
  if (route === '/api/host') {
    const nets = os.networkInterfaces();
    const ips = [];
    Object.keys(nets).forEach((name) => {
      (nets[name] || []).forEach((net) => {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      });
    });
    sendJson(res, 200, { port: PORT, ips: ips });
    return;
  }

  if (route === '/api/req' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, msg: 'Pedido inválido.' });
        return;
      }
      const r = addRequest(body && body.songId, body && body.name);
      sendJson(res, r.ok ? 200 : 400, r);
    });
    return;
  }

  if (route === '/api/admin' && req.method === 'POST') {
    readBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { ok: false, msg: 'Comando inválido.' });
        return;
      }
      const r = adminAction(body);
      sendJson(res, r.ok ? 200 : 400, r);
    });
    return;
  }

  // ---------- Arquivos estaticos (public/) ----------
  serveStatic(req, res, urlPath);
});

/* ---------------------- INICIALIZACAO ----------------------- */
function printIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    });
  });
  console.log('');
  console.log('==========================================');
  console.log('  KARAOKE DO BULLA - servidor rodando');
  console.log('==========================================');
  console.log('  Neste computador:     http://localhost:' + PORT);
  console.log('  Painel do artista:    http://localhost:' + PORT + '/admin.html');
  console.log('  Telao (TV):           http://localhost:' + PORT + '/tv.html');
  if (ips.length) {
    ips.forEach((ip) => {
      console.log('  Convidados (celular): http://' + ip + ':' + PORT);
    });
  } else {
    console.log('  [AVISO] Nenhum IP local encontrado - ligue o hotspot do notebook.');
  }
  console.log('==========================================');
  console.log('  Deixe esta janela ABERTA durante a festa.');
  console.log('  Para parar o servidor: Ctrl + C');
  console.log('');
}

loadCatalog();
loadState();
server.listen(PORT, '0.0.0.0', () => {
  printIPs();
});