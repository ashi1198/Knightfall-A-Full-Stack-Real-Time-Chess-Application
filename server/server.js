import express from "express";
import http from "http";
import { Server } from "socket.io";
import { Chess } from "chess.js";
import { v4 as uuidv4 } from "uuid";
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import "dotenv/config";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
// --- DATABASE SETUP ---
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Cloud Postgres (Neon, Render, Supabase) needs SSL; set DATABASE_SSL=false for local dev
  ssl:
    process.env.DATABASE_SSL === "false"
      ? false
      : { rejectUnauthorized: false },
});

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

// =======================================================
// --- AUTHENTICATION API ENDPOINTS ---
// =======================================================
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ message: "Username and password are required." });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username",
      [username, hashedPassword],
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Username already exists." });
    }
    console.error(error);
    res.status(500).json({ message: "Server error during registration" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    if (!user.password) {
      return res
        .status(400)
        .json({ message: "This account uses Google sign-in." });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    // Use the JWT_SECRET from your .env file
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error during login" });
  }
});

const signToken = (user) =>
  jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1d" });

// Express middleware: requires "Authorization: Bearer <jwt>"
const requireAuth = async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Missing token." });
  try {
    const { userId } = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      "SELECT id, username FROM users WHERE id = $1",
      [userId],
    );
    if (!result.rows[0])
      return res.status(401).json({ message: "User no longer exists." });
    req.user = result.rows[0];
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token." });
  }
};

// Used by the client on page load to restore a session
app.get("/api/verify", requireAuth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// Google sign-in: the client sends the Google ID token ("credential"),
// we verify it with Google, then issue our own JWT.
app.post("/api/auth/google", async (req, res) => {
  const { credential } = req.body;
  if (!credential)
    return res.status(400).json({ message: "Missing Google credential." });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified) {
      return res
        .status(401)
        .json({ message: "Google account email is not verified." });
    }
    const { sub: googleId, email, name } = payload;

    // 1) returning Google user
    let result = await pool.query(
      "SELECT id, username FROM users WHERE google_id = $1",
      [googleId],
    );
    let user = result.rows[0];

    // 2) existing account with same verified email: link it
    if (!user) {
      result = await pool.query(
        "UPDATE users SET google_id = $1 WHERE email = $2 RETURNING id, username",
        [googleId, email],
      );
      user = result.rows[0];
    }

    // 3) brand new user: create with a unique username
    if (!user) {
      const base =
        (name || email.split("@")[0]).replace(/\s+/g, "").slice(0, 20) ||
        "player";
      let username = base;
      for (let i = 0; i < 5; i++) {
        const taken = await pool.query(
          "SELECT 1 FROM users WHERE username = $1",
          [username],
        );
        if (!taken.rows[0]) break;
        username = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
      }
      result = await pool.query(
        "INSERT INTO users (username, email, google_id) VALUES ($1, $2, $3) RETURNING id, username",
        [username, email, googleId],
      );
      user = result.rows[0];
    }

    res.json({ token: signToken(user), user });
  } catch (error) {
    console.error("Google auth failed:", error.message);
    res.status(401).json({ message: "Google sign-in failed." });
  }
});

// =======================================================
// --- REAL-TIME CHESS LOGIC (Socket.IO) ---
// =======================================================
const rooms = {};
const playerQueue = [];

// Online play requires a valid JWT; the client sends it in the Socket.IO handshake
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication required"));
  try {
    socket.userId = jwt.verify(token, process.env.JWT_SECRET).userId;
    next();
  } catch {
    next(new Error("Invalid or expired token"));
  }
});

io.on("connection", (socket) => {
  console.log("connected", socket.id, "user", socket.userId);

  socket.on("joinRoom", (roomId) => {
    let room = rooms[roomId];
    if (!room) {
      room = { id: roomId, chess: new Chess(), players: {} };
      rooms[roomId] = room;
    }
    if (room.players.w && room.players.b) {
      socket.emit("gameError", "Room is full.");
      return;
    }
    socket.join(roomId);
    socket.gameId = roomId;
    const color = !room.players.w ? "w" : "b";
    room.players[color] = socket.id;
    socket.emit("assignedColor", color);
    if (Object.keys(room.players).length === 2) {
      io.to(roomId).emit("gameState", room.chess.fen());
    }
  });

  socket.on("findGame", () => {
    if (!playerQueue.includes(socket.id)) playerQueue.push(socket.id);
    if (playerQueue.length >= 2) {
      const p1Id = playerQueue.shift();
      const p2Id = playerQueue.shift();
      const p1Socket = io.sockets.sockets.get(p1Id);
      const p2Socket = io.sockets.sockets.get(p2Id);
      if (!p1Socket || !p2Socket) return;
      const roomId = uuidv4();
      p1Socket.join(roomId);
      p2Socket.join(roomId);
      p1Socket.gameId = roomId;
      p2Socket.gameId = roomId;
      rooms[roomId] = {
        id: roomId,
        chess: new Chess(),
        players: { w: p1Id, b: p2Id },
      };
      io.to(roomId).emit("gameFound", {
        roomId,
        fen: rooms[roomId].chess.fen(),
        colors: { [p1Id]: "w", [p2Id]: "b" },
      });
    }
  });

  socket.on("playerMove", (moveData) => {
    const gameId = socket.gameId;
    const room = rooms[gameId];
    if (!room) return;
    const playerColor = Object.keys(room.players).find(
      (key) => room.players[key] === socket.id,
    );
    if (playerColor !== room.chess.turn()) return;
    handleMove(room, moveData);
  });

  function handleMove(room, move) {
    try {
      if (room.chess.move(move)) {
        io.to(room.id).emit("moveMade", { fen: room.chess.fen() });
        if (room.chess.isGameOver()) {
          let reason = "Game Over";
          if (room.chess.isCheckmate()) {
            const winner = room.chess.turn() === "w" ? "Black" : "White";
            reason = `Checkmate! ${winner} wins.`;
          } else if (room.chess.isDraw()) {
            reason = "Draw!";
          }
          io.to(room.id).emit("gameOver", { reason });
        }
      }
    } catch (err) {
      socket.emit("invalidMove", { message: "Invalid move format" });
    }
  }

  socket.on("disconnect", () => {
    console.log(`User Disconnected: ${socket.id}`);
    const gameId = socket.gameId;
    if (gameId && rooms[gameId]) {
      io.to(gameId).emit("opponentDisconnected");
      delete rooms[gameId];
    }
    const queueIndex = playerQueue.indexOf(socket.id);
    if (queueIndex > -1) {
      playerQueue.splice(queueIndex, 1);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
