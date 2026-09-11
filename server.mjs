import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, rename, copyFile, readdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { initialState, advance, viewState, applyAction, validateBackup } from './lib/domain.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([['/', 'index.html'], ['/app.js', 'app.js'], ['/style.css', 'style.css'], ['/icon.svg', 'icon.svg']]);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

export async function createApp({ dataDir = path.join(ROOT, 'data'), port = 17414 } = {}) {
  await mkdir(path.join(dataDir, 'backups'), { recursive: true });
  const statePath = path.join(dataDir, 'state.json');
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); validateBackup(state); }
  catch (e) { if (e.code !== 'ENOENT') throw new Error('저장 파일을 읽을 수 없습니다. data/state.json과 data/backups를 보존하고 복구해 주세요.', { cause: e }); state = initialState(); }
  const token = randomBytes(32).toString('hex');
  let queue = Promise.resolve();
  async function persist(next, backupLabel = '') {
    if (backupLabel) {
      try { await copyFile(statePath, path.join(dataDir, 'backups', `${Date.now()}-${backupLabel}.json`)); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    const temp = statePath + '.tmp';
    await writeFile(temp, JSON.stringify(next, null, 2), { encoding: 'utf8', flush: true });
    await rename(temp, statePath);
    state = next;
  }
  // One automatic snapshot per launch; keep the latest 30 automatic snapshots.
  await persist(state, 'auto');
  const backups = (await readdir(path.join(dataDir, 'backups'))).filter(n => /^\d+-auto\.json$/.test(n)).sort();
  for (const file of backups.slice(0, -30)) await unlink(path.join(dataDir, 'backups', file));
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", ...headers });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('파일은 8MB 이하여야 해요.'); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const server = http.createServer((req, res) => {
    const run = async () => {
      const address = server.address();
      const host = `127.0.0.1:${address.port}`;
      if (req.headers.host !== host && req.headers.host !== `localhost:${address.port}`) return send(res, 403, { error: '로컬 주소에서 열어 주세요.' });
      const url = new URL(req.url, `http://${host}`);
      if (req.method === 'POST' && (req.headers['x-app-token'] !== token || (req.headers.origin && ![`http://${host}`, `http://localhost:${address.port}`].includes(req.headers.origin)))) return send(res, 403, { error: '앱을 새로고침해 주세요.' });
      if (url.pathname === '/api/health' && req.method === 'GET') return send(res, 200, { app: 'ffxiv-companion', version: 1 });
      if (url.pathname.startsWith('/api/')) {
        const next = structuredClone(state);
        if (advance(next)) { next.revision++; await persist(next); }
      }
      if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, { ...viewState(state), token });
      if (url.pathname === '/api/backup' && req.method === 'GET') return send(res, 200, state, { 'Content-Disposition': 'attachment; filename="ffxiv-backup.json"' });
      if (url.pathname === '/api/action' && req.method === 'POST') {
        const action = await body(req);
        if (action.revision !== state.revision) return send(res, 409, { error: '다른 창이나 반복 시간이 바뀌었어요. 최신 화면에서 다시 시도해 주세요.' });
        const next = applyAction(structuredClone(state), action); next.revision++;
        await persist(next); return send(res, 200, { ...viewState(state), token });
      }
      if (url.pathname === '/api/restore' && req.method === 'POST') {
        const input = await body(req);
        if (input.revision !== state.revision) return send(res, 409, { error: '화면을 새로고침한 후 다시 복원해 주세요.' });
        const next = validateBackup(input.backup); advance(next); next.revision = state.revision + 1;
        await persist(next, 'before-restore'); return send(res, 200, { ...viewState(state), token });
      }
      if (url.pathname === '/api/shutdown' && req.method === 'POST') {
        send(res, 200, { ok: true }); server.close(); return;
      }
      if (req.method === 'GET' && publicFiles.has(url.pathname)) {
        const file = publicFiles.get(url.pathname);
        return send(res, 200, await readFile(path.join(ROOT, 'public', file)), { 'Content-Type': mime[path.extname(file)] });
      }
      send(res, 404, { error: '페이지를 찾을 수 없어요.' });
    };
    queue = queue.then(run).catch(e => { if (!res.headersSent) send(res, 400, { error: e.message || '저장에 실패했어요.' }); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApp({ dataDir: process.env.FFXIV_DATA_DIR || undefined, port: Number(process.env.FFXIV_PORT || 17414) })
    .then(({ url }) => console.log(`FFXIV Companion: ${url}`))
    .catch(e => { console.error(e.message); process.exitCode = 1; });
}
