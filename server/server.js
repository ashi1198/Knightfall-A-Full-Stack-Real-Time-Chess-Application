import express from "express";
import http from "http";
import { Server } from "socket.io";
import { Chess } from "chess.js";
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import pg from "pg";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import 'dotenv/config';
import cors from 'cors';
// --- DATABASE SETUP ---
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
   ssl: {
    rejectUnauthorized: false // Required for some cloud providers
  }
});

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://knightfall-chess.vercel.app/",
    methods: ["GET", "POST"],
  },
});

// =======================================================
// --- AUTHENTICATION API ENDPOINTS ---
// =======================================================
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Username and password are required." });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id, username",
      [username, hashedPassword]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: "Username already exists." });
    }
    console.error(error);
    res.status(500).json({ message: "Server error during registration" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    // Use the JWT_SECRET from your .env file
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1d' });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error during login" });
  }
});

// =======================================================
// --- REAL-TIME CHESS LOGIC (Socket.IO) ---
// =======================================================
const rooms = {};
const engines = {};
const playerQueue = [];

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    socket.gameId = roomId;
    let room = rooms[roomId];
    if (!room) {
      room = { id: roomId, chess: new Chess(), players: {} };
      rooms[roomId] = room;
    }
    const color = !room.players.w ? 'w' : 'b';
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
      rooms[roomId] = { id: roomId, chess: new Chess(), players: { w: p1Id, b: p2Id } };
      io.to(roomId).emit("gameFound", {
        roomId,
        fen: rooms[roomId].chess.fen(),
        colors: { [p1Id]: 'w', [p2Id]: 'b' }
      });
    }
  });

  socket.on('startEngineGame', () => {
    const gameId = uuidv4();
    rooms[gameId] = { id: gameId, chess: new Chess(), players: { w: socket.id } };
    socket.join(gameId);
    socket.gameId = gameId;
    socket.emit('assignedColor', 'w');
    socket.emit('gameState', rooms[gameId].chess.fen());
    const enginePath = './engine.exe';
    try {
      const engine = spawn(enginePath);
      engines[gameId] = engine;
      engine.stdout.on('data', (data) => {
        const output = data.toString().trim();
        if (output.startsWith('bestmove')) {
          const moveStr = output.split(' ')[1];
          const room = rooms[gameId];
          if (room && room.chess.turn() === 'b') {
            handleMove(room, { from: moveStr.substring(0, 2), to: moveStr.substring(2, 4) }, 'engine');
          }
        }
      });
      engine.on('error', (err) => io.to(gameId).emit('gameError', 'Could not start the chess engine.'));
      engine.on('close', () => delete engines[gameId]);
    } catch (err) {
      io.to(gameId).emit('gameError', 'Could not find the chess engine executable.');
    }
  });

  socket.on("playerMove", (moveData) => {
    const gameId = socket.gameId;
    const room = rooms[gameId];
    if (!room) return;
    const playerColor = Object.keys(room.players).find(key => room.players[key] === socket.id);
    if (playerColor !== room.chess.turn()) return;
    handleMove(room, moveData, 'player');
  });

  function handleMove(room, move, source) {
    try {
      if (room.chess.move(move)) {
        io.to(room.id).emit("moveMade", { fen: room.chess.fen() });
        if (room.chess.isGameOver()) {
          let reason = 'Game Over';
          if (room.chess.isCheckmate()) {
            const winner = room.chess.turn() === 'w' ? 'Black' : 'White';
            reason = `Checkmate! ${winner} wins.`;
          } else if (room.chess.isDraw()) {
            reason = 'Draw!';
          }
          io.to(room.id).emit('gameOver', { reason });
        } else if (source === 'player' && engines[room.id]) {
          const engine = engines[room.id];
          engine.stdin.write(`position fen ${room.chess.fen()}\n`);
          engine.stdin.write('go movetime 2000\n');
        }
      }
    } catch (err) {
      socket.emit('invalidMove', { message: 'Invalid move format' });
    }
  }

  socket.on('disconnect', () => {
    console.log(`User Disconnected: ${socket.id}`);
    const gameId = socket.gameId;
    if (gameId && rooms[gameId]) {
      io.to(gameId).emit('opponentDisconnected');
      if(engines[gameId]) {
        engines[gameId].kill();
        delete engines[gameId];
      }
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
