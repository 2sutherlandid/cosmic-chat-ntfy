// migrate.js - create tables and seed cosmicgeneral
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'cosmic.sqlite');

if (!fs.existsSync(path.dirname(dbPath))) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);

const run = () => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT UNIQUE NOT NULL,
      name TEXT,
      is_dm INTEGER DEFAULT 0,
      participants TEXT DEFAULT '',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER,
      author TEXT,
      payload TEXT,
      ntfy_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // seed default room cosmicgeneral if not exists
    const defaultTopic = (process.env.NTFY_TOPIC_PREFIX || 'cosmic') + 'general';
    db.get('SELECT id FROM rooms WHERE topic = ?', [defaultTopic], (err, row) => {
      if (!row) {
        db.run('INSERT INTO rooms (topic, name, created_by) VALUES (?, ?, ?)', [defaultTopic, 'General', null], function(e) {
          if (!e) console.log('Seeded default room:', defaultTopic);
        });
      } else {
        console.log('Default room exists');
      }
    });

    console.log('Migration complete.');
    db.close();
  });
};

run();
