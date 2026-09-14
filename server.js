// server.js - basic Express server with auth and ntfy proxy
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const fetch = require('node-fetch');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const NTFY_HOST = process.env.NTFY_HOST || 'https://ntfy.com';
const NTFY_TOPIC_PREFIX = process.env.NTFY_TOPIC_PREFIX || 'cosmic';
const NTFY_PROXY_ENABLED = (process.env.NTFY_PROXY_ENABLED || 'true') === 'true';
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

// Create room - enforces topic prefix
app.post('/api/rooms', requireAuth, (req, res) => {
  let { topic, name } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic required' });
  // ensure prefix
  if (!topic.startsWith(NTFY_TOPIC_PREFIX)) {
    topic = `${NTFY_TOPIC_PREFIX}${topic}`;
  }
  db.run('INSERT INTO rooms (topic, name, created_by) VALUES (?, ?, ?)', [topic, name || topic, req.session.user.id], function(err) {
    if (err) return res.status(400).json({ error: 'room exists or invalid' });
    res.json({ ok: true, room: { id: this.lastID, topic, name: name || topic } });
  });
});

app.get('/api/rooms', requireAuth, (req, res) => {
  db.all('SELECT id, topic, name, created_at FROM rooms ORDER BY id DESC LIMIT 200', [], (err, rows) => {
    res.json({ rooms: rows });
  });
});

// Message history
app.get('/api/rooms/:room/messages', requireAuth, (req, res) => {
  const roomId = req.params.room;
  db.all('SELECT id, author, payload, created_at FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 500', [roomId], (err, rows) => {
    res.json({ messages: rows.reverse() });
  });
});

// Publish to ntfy (server proxy)
app.post('/api/publish', requireAuth, async (req, res) => {
  if (!NTFY_PROXY_ENABLED) return res.status(403).json({ error: 'proxy disabled' });
  const { topic, title, message, priority, tags, contentType } = req.body;
  if (!topic || !message) return res.status(400).json({ error: 'topic and message required' });
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
    // Optionally store message locally when posting via proxy
    db.get('SELECT id FROM rooms WHERE topic = ?', [topic], (err, room) => {
      const room_id = room ? room.id : null;
      db.run('INSERT INTO messages (room_id, author, payload, ntfy_id) VALUES (?, ?, ?, ?)', [room_id, req.session.user.username, message, null]);
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'publish error', detail: e.message });
  }
});

// Simple endpoint to publish without auth if proxy disabled (not recommended)
app.post('/api/publish-direct', (req, res) => {
  // This proxy intentionally allows unauthenticated publishes only when proxy is disabled and client opts in. Not recommended.
  if (NTFY_PROXY_ENABLED) return res.status(403).json({ error: 'direct publish disabled' });
  const { topic, message } = req.body;
  if (!topic || !message) return res.status(400).json({ error: 'topic and message required' });
  fetch(`${NTFY_HOST}/${topic}`, { method: 'POST', body: message }).then(r => {
    res.json({ ok: true, status: r.status });
  }).catch(e => res.status(500).json({ error: 'publish failed' }));
});

// Serve single-page app
app.get('*', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log('Server running on port', PORT));
