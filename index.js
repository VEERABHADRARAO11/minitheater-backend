import 'dotenv/config';
import express from 'express'; import http from 'http'; import { Server } from 'socket.io';
import multer from 'multer'; import cors from 'cors'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL;
const CORS_ORIGIN = process.env.CORS_ORIGIN || CLIENT_URL || '*';
const up = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads'); fs.mkdirSync(up, { recursive: true });
const app = express(); app.use(cors({ origin: CORS_ORIGIN })); app.use(express.json());
app.use('/uploads', express.static(up));
const store = multer({ storage: multer.diskStorage({ destination: up, filename: (q, f, cb) => cb(null, Date.now() + '-' + f.originalname.replace(/[^\w.-]/g, '_')) }) });
app.post('/api/upload', store.single('file'), (q, s) => s.json({ url: '/uploads/' + q.file.filename }));

const rooms = {}, ROWS = 'ABCDEFGH', COLS = 8;
const mk = () => { let c; do { c = Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('') } while (rooms[c]); return c };
const cur = r => ({ ...r.st, time: r.st.time + (r.st.playing ? (Date.now() - r.st.at) / 1000 : 0) });
const view = r => ({
  code: r.code, host: r.host, movie: r.movie, fan: r.fan, st: cur(r),
  people: Object.values(r.people).map(p => ({ id: p.id, name: p.name, seat: p.seat, isHost: p.id === r.hostId }))
});
app.post('/api/rooms', (q, s) => {
  const c = mk(), { host, movie, fan } = q.body;
  rooms[c] = { code: c, host, movie, fan: fan || null, people: {}, hostId: null, msgs: [], st: { phase: 'lobby', playing: false, time: 0, at: Date.now() } }; s.json({ code: c })
});
app.get('/api/rooms/:c', (q, s) => { const r = rooms[q.params.c.toUpperCase()]; r ? s.json({ code: r.code, host: r.host }) : s.status(404).json({ error: 'Room not found' }) });

const srv = http.createServer(app), io = new Server(srv, { cors: { origin: CORS_ORIGIN } });
io.on('connection', s => {
  let r, me; const isH = () => r && me && r.hostId === me.id; const all = ev => io.to(r.code).emit(ev, cur(r));
  s.on('join', ({ code, name, cid, host }, ack) => {
    r = rooms[(code || '').toUpperCase()]; if (!r) return ack({ error: 'Room not found. Check the code.' });
    me = r.people[cid];
    if (!me) {
      const taken = new Set(Object.values(r.people).map(p => p.seat)); let seat;
      o: for (const a of ROWS) for (let i = 1; i <= COLS; i++)if (!taken.has(a + i)) { seat = a + i; break o }
      if (!seat) return ack({ error: 'Theater is full' });
      me = r.people[cid] = { id: cid, name: (name || '').trim() || 'Friend ' + (Object.keys(r.people).length + 1), seat }
    }
    if (host && !r.hostId) r.hostId = cid;
    s.join(r.code); ack({ me, isHost: r.hostId === cid, room: view(r), msgs: r.msgs || [] }); io.to(r.code).emit('room', view(r));
  });
  s.on('open', () => { if (!isH()) return; r.st = { phase: r.fan ? 'fan' : 'movie', playing: true, time: 0, at: Date.now() }; all('state'); io.to(r.code).emit('burst') });
  s.on('ctrl', ({ playing, time }) => { if (!isH()) return; r.st = { ...r.st, playing, time, at: Date.now() }; all('state') });
  s.on('phase', p => { if (!isH()) return; r.st = { phase: p, playing: p === 'movie', time: 0, at: Date.now() }; all('state') });
  s.on('react', e => { if (r && me) io.to(r.code).emit('react', { e: String(e).slice(0, 4), seat: me.seat, k: Date.now() + Math.random() }) });
  s.on('chat', ({ text }) => {
    if (!r || !me || !text || !text.trim()) return;
    const msg = { id: Math.random().toString(36).slice(2), name: me.name, seat: me.seat, text: text.trim().slice(0, 200), t: Date.now() };
    r.msgs = r.msgs || []; r.msgs.push(msg); if (r.msgs.length > 200) r.msgs.shift();
    io.to(r.code).emit('chat', msg);
  });
});
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
