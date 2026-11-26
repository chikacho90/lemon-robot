// 레몬 로봇 피드백 받기(2026-11-26 우: 회사 서버 말고 개인서버에 모으고 우만 보게).
// 우의 집맥(개인서버)에서 돈다 → lemonrobot.woo.moi (Cloudflare 터널). 의존성 없음.
// - POST /api : 레몬 로봇 페이지(lemonrobot.interaction.hnine.com/feedback/)의 글상자가 보낸 한 건을
//               DATA_DIR/feedback.jsonl 에 한 줄로 붙인다. 누구나 보낼 수 있다(1분에 5건까지).
// - GET  /img/<이름> : 붙인 스크린샷(보기와 같은 로그인). 파일은 DATA_DIR/img/
// - GET  /    : 모인 피드백 보기. woo.moi 구글 로그인(우 하나)만 연다. 확인은 옆의 woo-session.mjs
//               (woo-projects 것을 배포 때 복사, 이 공개 저장소에는 넣지 않음)가 맡는다.
// 환경변수: PORT(기본 8790), DATA_DIR(기본 ./data), ALLOW_ORIGIN(기본 https://lemonrobot.interaction.hnine.com)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(HERE, 'data');
const FILE = path.join(DATA, 'feedback.jsonl');
const IMG = path.join(DATA, 'img');  // 피드백에 붙인 스크린샷(2026-11-26 우: 붙여넣기·파일 고르기). 한 건에 3장, 장당 3MB까지
const PORT = Number(process.env.PORT) || 8790;
const ORIGINS = (process.env.ALLOW_ORIGIN || 'https://lemonrobot.interaction.hnine.com').split(',').map(s => s.trim());
fs.mkdirSync(IMG, { recursive: true });

// 로그인 확인: woo-session.mjs 가 내보내는 함수 하나를 쓴다. 없으면 보기 화면은 닫혀 있다
let owner = async () => false, loginUrl = next => `https://woo.moi/login?next=${encodeURIComponent(next)}`;
try {
  const ws = await import('./woo-session.mjs');
  const f = ws.isOwner || ws.verify || ws.session || ws.default || (ws.wooSession && (req => ws.wooSession(req.headers.cookie)));  // woo-projects 것은 wooSession(cookie)
  if (typeof f === 'function') owner = async req => { try { return Boolean(await f(req)); } catch { return false; } };
} catch { console.warn('woo-session.mjs 없음: 보기 화면 닫힘'); }

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
function cors(req) {
  const o = req.headers.origin;
  return ORIGINS.includes(o) ? { 'Access-Control-Allow-Origin': o, 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } : {};
}

const hits = new Map();
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

function receive(req, res) {
  const h = { ...cors(req) }, json = 'application/json';
  let body = '';
  req.on('data', c => { body += c; if (body.length > 13e6) req.destroy(); });
  req.on('end', () => {
    const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(res, 429, JSON.stringify({ ok: false, reason: '잠시 뒤에 다시 보내 주세요' }), json, h);
    let d;
    try { d = JSON.parse(body); } catch { return send(res, 400, JSON.stringify({ ok: false }), json, h); }
    const text = clip(d.text, 4000).trim();
    if (!text) return send(res, 400, JSON.stringify({ ok: false, reason: '내용을 적어 주세요' }), json, h);
    // 그림: data:image/(png|jpeg|webp);base64,... 만 받는다. 이름은 시각+순번이라 밖에서 경로를 못 고른다
    const images = [];
    for (const [i, u] of (Array.isArray(d.images) ? d.images : []).slice(0, 3).entries()) {
      const m = typeof u === 'string' && u.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) continue;
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > 3e6) continue;
      const name = `${Date.now()}-${process.hrtime.bigint() % 100000n}-${i}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      try { fs.writeFileSync(path.join(IMG, name), buf); images.push(name); } catch {}
    }
    const row = { at: new Date().toISOString(), text, images, name: clip(d.name, 80).trim(), app: clip(d.app, 20), code: clip(d.code, 20),
                  mac: clip(d.mac, 80), ua: clip(req.headers['user-agent'], 200) };
    fs.appendFile(FILE, JSON.stringify(row) + '\n', err => {
      if (err) return send(res, 500, JSON.stringify({ ok: false }), json, h);
      send(res, 200, JSON.stringify({ ok: true }), json, h);
    });
  });
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kst = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

async function view(req, res) {
  if (!(await owner(req))) return send(res, 302, '', undefined, { Location: loginUrl('https://lemonrobot.woo.moi/') });
  let raw = '';
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch {}
  const rows = raw.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
  const items = rows.map(r => `<li><p class="t">${esc(r.text).replace(/\n/g, '<br>')}</p>
    ${(r.images || []).length ? `<p class="g">${r.images.map(n => `<a href="/img/${encodeURIComponent(n)}" target="_blank"><img src="/img/${encodeURIComponent(n)}" alt=""></a>`).join('')}</p>` : ''}
    <p class="m">${esc(kst(r.at))} · ${r.name ? esc(r.name) + ' · ' : ''}앱 ${esc(r.app || '-')} · 코드 ${esc(r.code || '-')}${r.mac ? ' · ' + esc(r.mac) : ''}</p></li>`).join('');
  send(res, 200, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>레몬 로봇 피드백</title><style>
:root{--bg:#FFFBEC;--ink:#23511F;--text:#3E4A33;--muted:#6F7862;--line:#EDE6CC;--card:#FFFAE8}
@media (prefers-color-scheme:dark){:root{--bg:#14170F;--ink:#EEF3DF;--text:#C9CFBA;--muted:#959C85;--line:#2A2F21;--card:#1C2016}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;word-break:keep-all}
main{max-width:760px;margin:0 auto;padding:48px 16px}h1{color:var(--ink);font-size:28px;margin:0 0 4px}.n{color:var(--muted);margin:0 0 28px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:12px}li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.t{margin:0;overflow-wrap:anywhere}.g{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}.g img{max-width:220px;max-height:160px;border-radius:6px;border:1px solid var(--line);display:block}.m{margin:8px 0 0;font-size:13px;color:var(--muted)}</style></head>
<body><main><h1>레몬 로봇 피드백</h1><p class="n">${rows.length}건 · 최신이 위</p><ul>${items || '<li>아직 없어요</li>'}</ul></main>
<script src="https://woo.moi/launcher.js" async></script></body></html>`, 'text/html; charset=utf-8', { 'Cache-Control': 'no-store' });
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
async function image(req, res, name) {
  if (!(await owner(req))) return send(res, 403, 'Forbidden');
  const ext = name.split('.').pop();
  if (!/^[\w-]+\.(png|jpg|webp)$/.test(name)) return send(res, 404, 'Not found');
  fs.readFile(path.join(IMG, name), (err, buf) => err ? send(res, 404, 'Not found')
    : send(res, 200, buf, TYPES[ext], { 'Cache-Control': 'private, max-age=86400' }));
}

http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/api' && req.method === 'OPTIONS') return send(res, 204, '', undefined, cors(req));
  if (p === '/api' && req.method === 'POST') return receive(req, res);
  if (p === '/healthz') return send(res, 200, 'ok');
  if (p === '/' && req.method === 'GET') return view(req, res);
  if (p.startsWith('/img/') && req.method === 'GET') return image(req, res, decodeURIComponent(p.slice(5)));
  send(res, 404, 'Not found');
}).listen(PORT, '127.0.0.1', () => console.log(`lemonrobot-feedback on 127.0.0.1:${PORT}, data ${DATA}`));
