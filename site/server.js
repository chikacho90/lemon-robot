// 레몬 로봇 페이지 서버(2026-11-26 우: 피드백을 /feedback 으로 모으고 우만 보게).
// IX 앱 lemonrobot(런타임 node, Start: {{NODE}} server.js). 의존성 없음.
// - 이 폴더의 정적 파일(내려받기 페이지, install.sh, 그림)을 그대로 준다
// - POST /feedback/api : 피드백 한 건을 IX_DATA_DIR/feedback.jsonl 에 한 줄로 붙인다(재배포해도 남는 폴더)
// - GET  /feedback/admin : 모인 피드백 보기. 환경변수 FEEDBACK_ADMIN_TOKEN 과 맞는 열쇠가 있어야 열린다
//   (처음 ?key=… 로 열면 쿠키에 담고 주소에서 지운다). 토큰이 없으면 보기 화면은 없다(404)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA = process.env.IX_DATA_DIR || path.join(ROOT, 'data');
const FILE = path.join(DATA, 'feedback.jsonl');
const TOKEN = process.env.FEEDBACK_ADMIN_TOKEN || '';
const PORT = Number(process.env.PORT) || 8080;
const HIDDEN = new Set(['server.js', 'package.json', 'package-lock.json', 'data']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.sh': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

fs.mkdirSync(DATA, { recursive: true });

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel.split('/').some(p => p.startsWith('.') || HIDDEN.has(p))) return send(res, 404, 'Not found');
  let file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 404, 'Not found');
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (!pathname.endsWith('/')) return send(res, 301, '', undefined, { Location: pathname + '/' });
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (e, data) => {
      if (e) return send(res, 404, 'Not found');
      const cache = file.endsWith('.html') || file.endsWith('.sh') ? 'no-cache' : 'public, max-age=3600';
      send(res, 200, req.method === 'HEAD' ? undefined : data, TYPES[path.extname(file)] || 'application/octet-stream', { 'Cache-Control': cache });
    });
  });
}

// 같은 곳에서 너무 자주 보내면 막는다(1분에 5건)
const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}

function clip(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }

function receive(req, res) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 20000) req.destroy(); });
  req.on('end', () => {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(res, 429, JSON.stringify({ ok: false, reason: '잠시 뒤에 다시 보내 주세요' }), 'application/json');
    let d;
    try { d = JSON.parse(body); } catch { return send(res, 400, JSON.stringify({ ok: false }), 'application/json'); }
    const text = clip(d.text, 4000).trim();
    if (!text) return send(res, 400, JSON.stringify({ ok: false, reason: '내용을 적어 주세요' }), 'application/json');
    const row = { at: new Date().toISOString(), text, name: clip(d.name, 80).trim(), app: clip(d.app, 20), code: clip(d.code, 20),
                  mac: clip(d.mac, 80), ua: clip(req.headers['user-agent'], 200) };
    fs.appendFile(FILE, JSON.stringify(row) + '\n', err => {
      if (err) return send(res, 500, JSON.stringify({ ok: false }), 'application/json');
      send(res, 200, JSON.stringify({ ok: true }), 'application/json');
    });
  });
}

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function cookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function admin(req, res, url) {
  if (!TOKEN) return send(res, 404, 'Not found');
  const key = url.searchParams.get('key');
  if (key && same(key, TOKEN)) {
    return send(res, 302, '', undefined, { Location: '/feedback/admin',
      'Set-Cookie': `lr_admin=${encodeURIComponent(key)}; Path=/feedback; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000` });
  }
  if (!same(cookie(req, 'lr_admin'), TOKEN)) return send(res, 404, 'Not found');
  fs.readFile(FILE, 'utf8', (err, raw) => {
    const rows = (err ? '' : raw).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
    const kst = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const items = rows.map(r => `<li><p class="t">${esc(r.text).replace(/\n/g, '<br>')}</p>
      <p class="m">${esc(kst(r.at))} · ${r.name ? esc(r.name) + ' · ' : ''}앱 ${esc(r.app || '-')} · 코드 ${esc(r.code || '-')}${r.mac ? ' · ' + esc(r.mac) : ''}</p></li>`).join('');
    send(res, 200, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>피드백 모음</title><link rel="icon" href="/favicon.png"><style>
:root{--bg:#FFFBEC;--ink:#23511F;--text:#3E4A33;--muted:#6F7862;--line:#EDE6CC;--card:#FFFAE8}
@media (prefers-color-scheme:dark){:root{--bg:#14170F;--ink:#EEF3DF;--text:#C9CFBA;--muted:#959C85;--line:#2A2F21;--card:#1C2016}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;word-break:keep-all}
main{max-width:760px;margin:0 auto;padding:48px 16px}h1{color:var(--ink);font-size:28px;margin:0 0 4px}.n{color:var(--muted);margin:0 0 28px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.t{margin:0;color:var(--text);overflow-wrap:anywhere}.m{margin:8px 0 0;font-size:13px;color:var(--muted)}</style></head>
<body><main><h1>레몬 로봇 피드백</h1><p class="n">${rows.length}건 · 최신이 위</p><ul>${items || '<li>아직 없어요</li>'}</ul></main></body></html>`,
    'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/feedback/api' && req.method === 'POST') return receive(req, res);
  if (p === '/feedback/admin' && req.method === 'GET') return admin(req, res, url);
  if (p === '/healthz') return send(res, 200, 'ok');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  serveStatic(req, res, p);
}).listen(PORT, '0.0.0.0', () => console.log(`lemonrobot on ${PORT}, data ${DATA}`));
