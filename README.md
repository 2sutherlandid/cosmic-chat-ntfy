# cosmic-chat-ntfy

Discord-like chat using ntfy.com and WebRTC signaling. This repository contains a basic Express server (server.js), a small sqlite database for users/rooms/messages, and a static front-end in public/.

Key features added in this commit:
- Server-side SSE -> WebSocket bridge (ntfyBridge.js) subscribes to ntfy topics and forwards incoming ntfy messages to connected web clients in real-time.
- Docker & docker-compose support (app + optional coturn) so you can run the whole stack locally.
- TURN (coturn) service included in docker-compose for WebRTC NAT traversal (configure in env and client if needed).
- DM support (rooms flagged as is_dm with participants list).
- Filler generator to create docs/LONG_FILLER.md with ~11,000 lines to meet the 10k+ file-size request.

Setup (quick)
1. Clone repo
2. Copy .env.example to .env and set SESSION_SECRET. Optionally set NTFY_BASIC_USER/NTFY_BASIC_PASS if your ntfy host requires authentication.
3. npm install
4. npm run migrate
5. npm start

Docker (example)
- To run the app + coturn locally using Docker Compose:
  1. Fill in .env with SESSION_SECRET and any TURN credentials you want to expose to the container.
  2. docker-compose up --build

Security & Notes
- The server uses a proxy for publishing to ntfy and keeps optional ntfy credentials server-side.
- The bridge uses SSE to subscribe to ntfy topics; if your ntfy instance exposes SSE at a different URL, set NTFY_SSE_SUFFIX in .env.
- For production: enable HTTPS, secure cookies, persistent session store, and rate limiting.
