import express from "express";
import http from "http";
import { Server } from "socket.io";
import { Chess } from "chess.js";
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid'; // Added for unique room IDs

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

const rooms = {};
const engines = {};
const playerQueue = []; // ADDED: The matchmaking queue

io.on("connection", (socket) => {
  console.log("connected", socket.id);

  // Logic for joining a specific room by ID
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

  // ADDED: Logic for finding a random game
  socket.on("findGame", () => {
    if (!playerQueue.includes(socket.id)) {
        playerQueue.push(socket.id);
    }
    console.log("Player Queue:", playerQueue);

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
      console.log(`Match found! Room ${roomId} for ${p1Id} vs ${p2Id}`);
    }
  });

  // Logic for starting a game vs the C++ engine
  socket.on('startEngineGame', () => {
    const gameId = uuidv4();
    const room = { id: gameId, chess: new Chess(), players: { w: socket.id } };
    rooms[gameId] = room;
    socket.join(gameId);
    socket.gameId = gameId;
    socket.emit('assignedColor', 'w');
    socket.emit('gameState', room.chess.fen());

    const enginePath = './engine.exe';
    try {
        const engine = spawn(enginePath);
        engines[gameId] = engine;
        engine.stdout.on('data', (data) => {
            const output = data.toString().trim();
            if (output.startsWith('bestmove')) {
                const moveStr = output.split(' ')[1];
                const currentRoom = rooms[gameId];
                if (currentRoom && currentRoom.chess.turn() === 'b') {
                    handleMove(currentRoom, { from: moveStr.substring(0, 2), to: moveStr.substring(2, 4) }, 'engine');
                }
            }
        });
        engine.on('error', (err) => { console.error(`Engine error for game ${gameId}:`, err); });
        engine.on('close', () => delete engines[gameId]);
    } catch (err) {
        console.error(`Error spawning engine for game ${gameId}:`, err);
    }
  });

  // Unified logic for handling moves from players
  socket.on("playerMove", (moveData) => {
    const gameId = socket.gameId;
    const room = rooms[gameId];
    if (!room) return;
    
    const playerColor = Object.keys(room.players).find(key => room.players[key] === socket.id);
    if (playerColor !== room.chess.turn()) return;

    handleMove(room, moveData, 'player');
  });

  // Central function to process any move
  function handleMove(room, move, source) {
    try {
      const result = room.chess.move(move);
      if (result) {
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
          const fen = room.chess.fen();
          engine.stdin.write(`position fen ${fen}\n`);
          engine.stdin.write('go movetime 2000\n');
        }
      } else {
        socket.emit('invalidMove', { message: 'Invalid move' });
      }
    } catch (err) {
        // Catches errors from badly formatted moves
    }
  }

  // Robust disconnect logic
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

server.listen(5000, () => console.log("Server running on 5000"));