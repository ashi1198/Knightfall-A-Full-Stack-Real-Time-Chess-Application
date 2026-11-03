# Chessclash (Knightfall)

A full-stack, real-time multiplayer chess app.

**Stack:** React 19 + Vite, Node/Express 5, Socket.IO, PostgreSQL, chess.js, JWT + Google Sign-In.

## Features
- Register/login with username and password, or **Sign in with Google**
- Real-time online play: random matchmaking or join by room ID
- All moves validated on the server (chess.js), with turn enforcement
- Socket connections require a valid JWT
- Pass-and-play on the same device, guest mode

## Architecture
```
React client ──HTTP──> Express API ──> PostgreSQL (users)
     └───Socket.IO (JWT in handshake)──> game rooms (in-memory, chess.js)
```
Google flow: client gets a Google ID token, sends it to `POST /api/auth/google`,
the server verifies it with Google, finds/creates the user, and returns its own JWT.

## Run locally
```bash
# 1. Database: run server/schema.sql on your Postgres
# 2. Server
cd server && cp .env.example .env   # fill in values
npm install && npm run dev
# 3. Client
cd client && cp .env.example .env   # fill in values
npm install && npm run dev
```

## Google OAuth setup
1. Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID (Web application)
2. Authorized JavaScript origins: `http://localhost:5173` and your deployed frontend URL
3. Put the client ID in `server/.env` (`GOOGLE_CLIENT_ID`) and `client/.env` (`VITE_GOOGLE_CLIENT_ID`)

## Deployment
- Client: Vercel (set `VITE_SERVER_URL`, `VITE_GOOGLE_CLIENT_ID`)
- Server: Render/Railway (set the variables from `server/.env.example`; `CLIENT_ORIGIN` = your Vercel URL)
- Database: Neon/Supabase/Render Postgres

## Known limitations / roadmap
- Games live in server memory and end if a player disconnects (reconnect support planned)
- Vs-computer mode is not enabled yet
- Promotion is always to a queen
