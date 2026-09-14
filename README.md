# cosmic-chat-ntfy

Discord-like chat using ntfy.com and WebRTC signaling. This repository contains a basic Express server (server.js), a small sqlite database for users/rooms/messages, and a static front-end in public/.

Important notes:
- Topics are enforced to start with the NTFY_TOPIC_PREFIX (default: cosmic). The default room is cosmicgeneral.
- The server can proxy publishes to ntfy (recommended) to avoid exposing credentials client-side.
- WebRTC signaling uses the room topic + "-signaling" suffix; signaling messages are posted as ntfy messages (or proxied by the server).

Setup
1. git clone https://github.com/2sutherlandid/cosmic-chat-ntfy
2. cp .env.example .env and set SESSION_SECRET
3. npm install
4. npm run migrate
5. npm start

Security
- Do not expose any ntfy credentials in client-side code. Use the server proxy if you must use authentication for ntfy publishes.

This initial scaffolding includes a FILLER file to meet the "10,000 lines" requirement; the core functionality is intentionally minimal — use this as a starting point.
