// server.js - Express server with auth, ntfy proxy, WebSocket broadcast, user list, and DM support
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fetch = require('node-fetch');
const db = require('./db');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const NTFY_HOST = process.env.NTFY_HOST || 'https://ntfy.com';
const NTFY_TOPIC_PREFIX = process.env.NTFY_TOPIC_PREFIX || 'cosmic';
const NTFY_PROXY_ENABLED = true; // require proxy for real-time forwarding
const NTFY_BASIC_USER = process.env.NTFY_BASIC_USER || '';
const NTFY_BASIC_PASS = process.env.NTFY_BASIC_PASS || '';

app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// prepare HTTP server so ws can attach
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Track subscriptions: topic -> Set of ws
const topicSubs = new Map();
function subscribeClient(ws, topic) {
  if (!topicSubs.has(topic)) topicSubs.set(topic, new Set());
  topicSubs.get(topic).add(ws);
}
function unsubscribeClient(ws, topic) {
  if (!topicSubs.has(topic)) return;
  topicSubs.get(topic).delete(ws);
}

wss.on('connection', (ws, req) => {
  ws.on('message', message => {
    try {
      const msg = JSON.parse(message.toString());
      if (msg.type === 'subscribe' && msg.topic) subscribeClient(ws, msg.topic);
      if (msg.type === 'unsubscribe' && msg.topic) unsubscribeClient(ws, msg.topic);
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    } catch(e) { console.error('ws message error', e); }
  });
  ws.on('close', () => {
    // cleanup from all topics
    for (const [topic, set] of topicSubs.entries()) {
      set.delete(ws);
    }
  });
});

function broadcastToTopic(topic, payload) {
  const set = topicSubs.get(topic);
  if (!set) return;
  const data = JSON.stringify({ type: 'message', topic, payload });
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// Helper: require auth
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const hash = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash], function(err) {
    if (err) return res.status(400).json({ error: 'username taken' });
    req.session.user = { id: this.lastID, username };
    res.json({ ok: true, user: { id: this.lastID, username } });
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  db.get('SELECT id, username, password_hash FROM users WHERE username = ?', [username], async (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'invalid credentials' });
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) return res.status(400).json({ error: 'invalid credentials' });
    req.session.user = { id: row.id, username: row.username };
    res.json({ ok: true, user: { id: row.id, username: row.username } });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// List users (for DM creation)
app.get('/api/users', requireAuth, (req, res) => {
  db.all('SELECT id, username, created_at FROM users ORDER BY username LIMIT 500', [], (err, rows) => {
    res.json({ users: rows });
  });
});

// Create room - enforces topic prefix. For DMs, use is_dm and participants field
app.post('/api/rooms', requireAuth, (req, res) => {
  let { topic, name, is_dm, participants } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });
  // ensure prefix
  if (!topic.startsWith(NTFY_TOPIC_PREFIX)) {
    topic = `${NTFY_TOPIC_PREFIX}${topic}`;
  }
  const pText = participants ? participants.join(',') : '';
  db.run('INSERT INTO rooms (topic, name, is_dm, participants, created_by) VALUES (?, ?, ?, ?, ?)', [topic, name || topic, is_dm ? 1 : 0, pText, req.session.user.id], function(err) {
    if (err) return res.status(400).json({ error: 'room exists or invalid' });
    res.json({ ok: true, room: { id: this.lastID, topic, name: name || topic, is_dm: is_dm ? 1 : 0, participants: pText } });
  });
});

app.get('/api/rooms', requireAuth, (req, res) => {
  db.all('SELECT id, topic, name, is_dm, participants, created_at FROM rooms ORDER BY id DESC LIMIT 500', [], (err, rows) => {
    res.json({ rooms: rows });
  });
});

// Message history
app.get('/api/rooms/:room/messages', requireAuth, (req, res) => {
  const roomId = req.params.room;
  db.all('SELECT id, author, payload, created_at FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 1000', [roomId], (err, rows) => {
    res.json({ messages: rows.reverse() });
  });
});

// Publish to ntfy (server proxy) and broadcast to WebSocket subscribers
app.post('/api/publish', requireAuth, async (req, res) => {
  const { topic, title, message, priority, tags, contentType } = req.body;
  if (!topic || !message) return res.status(400).json({ error: 'topic and message required' });
  // keep server proxy enforced
  const url = `${NTFY_HOST}/${topic}`;
  const headers = { 'Title': title || '', 'Priority': priority || 'default' };
  if (tags) headers['Tags'] = Array.isArray(tags) ? tags.join(',') : tags;
  if (contentType) headers['Content-Type'] = contentType;
  if (NTFY_BASIC_USER && NTFY_BASIC_PASS) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${NTFY_BASIC_USER}:${NTFY_BASIC_PASS}`).toString('base64');
  }
  try {
    const resp = await fetch(url, { method: 'POST', headers, body: message });
    if (!resp.ok) return res.status(502).json({ error: 'ntfy publish failed', status: resp.status });
    // store message locally when posting via proxy
    db.get('SELECT id FROM rooms WHERE topic = ?', [topic], (err, room) => {
      const room_id = room ? room.id : null;
      db.run('INSERT INTO messages (room_id, author, payload, ntfy_id) VALUES (?, ?, ?, ?)', [room_id, req.session.user.username, message, null], function(e) {
        const payload = { id: this ? this.lastID : null, room_id, author: req.session.user.username, payload: message, created_at: new Date().toISOString() };
        // broadcast to ws subscribers
        broadcastToTopic(topic, payload);
      });
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'publish error', detail: e.message });
  }
});

// For demo only: direct publish disabled because proxy is required for real-time features
app.post('/api/publish-direct', (req, res) => {
  return res.status(403).json({ error: 'direct publish disabled. Use /api/publish via authenticated session' });
});

// Serve single-page app
app.get('*', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => console.log('Server running on port', PORT));
