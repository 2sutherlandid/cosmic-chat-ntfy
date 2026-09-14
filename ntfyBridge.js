// ntfyBridge.js - subscribes to ntfy topics (SSE) and forwards incoming messages to WebSocket subscribers via broadcast function
// It attempts to use EventSource against `${NTFY_HOST}/${topic}${NTFY_SSE_SUFFIX}`. Adjust NTFY_SSE_SUFFIX if your NTFY installation exposes SSE on a different path.

const EventSource = require('eventsource');
const db = require('./db');

module.exports = function startBridge(broadcastToTopic){
  const NTFY_HOST = process.env.NTFY_HOST || 'https://ntfy.com';
  const NTFY_SSE_SUFFIX = process.env.NTFY_SSE_SUFFIX || '/sse'; // default assumed path for SSE on ntfy
  const NTFY_BASIC_USER = process.env.NTFY_BASIC_USER || '';
  const NTFY_BASIC_PASS = process.env.NTFY_BASIC_PASS || '';

  function headers() {
    const h = {};
    if (NTFY_BASIC_USER && NTFY_BASIC_PASS) {
      h['Authorization'] = 'Basic ' + Buffer.from(`${NTFY_BASIC_USER}:${NTFY_BASIC_PASS}`).toString('base64');
    }
    return h;
  }

  function subscribeTopic(topic) {
    const url = `${NTFY_HOST}/${topic}${NTFY_SSE_SUFFIX}`;
    console.log('ntfyBridge: subscribing to', url);
    const es = new EventSource(url, { headers: headers() });
    es.onmessage = (evt) => {
      try {
        const payload = evt.data;
        // store in local DB (attempt to match room)
        db.get('SELECT id FROM rooms WHERE topic = ?', [topic], (err, row) => {
          const room_id = row ? row.id : null;
          db.run('INSERT INTO messages (room_id, author, payload, ntfy_id) VALUES (?, ?, ?, ?)', [room_id, 'ntfy', payload, null], function(e) {
            const msg = { id: this ? this.lastID : null, room_id, author: 'ntfy', payload, created_at: new Date().toISOString() };
            // broadcast to WS subscribers
            broadcastToTopic(topic, msg);
          });
        });
      } catch (e) {
        console.error('ntfyBridge: error on message', e);
      }
    };
    es.onerror = (e) => {
      console.error('ntfyBridge: EventSource error for', topic, e && e.message);
      // EventSource will automatically try to reconnect in many implementations
    };
  }

  // Subscribe to all existing rooms on startup
  db.all('SELECT topic FROM rooms', [], (err, rows) => {
    if (err) return console.error('ntfyBridge: failed to fetch rooms', err);
    rows.forEach(r => subscribeTopic(r.topic));
  });

  // Watch for newly created rooms by polling every 30s (simple approach)
  setInterval(() => {
    db.all('SELECT topic FROM rooms', [], (err, rows) => {
      if (err) return;
      rows.forEach(r => subscribeTopic(r.topic));
    });
  }, 30000);

  console.log('ntfyBridge: started (SSE -> WS bridge).');
};
