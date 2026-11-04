import React, { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import io from 'socket.io-client';
import Board from './Board.jsx';
import './EngineSetup.css';

const ENGINE_LEVELS = [
  { id: 1, name: 'Beginner', hint: 'Makes plenty of mistakes' },
  { id: 2, name: 'Casual', hint: 'Sees simple tactics' },
  { id: 3, name: 'Club', hint: 'Solid, punishes blunders' },
  { id: 4, name: 'Strong', hint: 'Thinks ~3s per move' },
];

let socket;

function Game({ mode, onExit, token }) {
  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState(null);
  const [gameId, setGameId] = useState('');
  const [status, setStatus] = useState("Let's Play!");
  const [moveFrom, setMoveFrom] = useState('');
  const [highlightedSquares, setHighlightedSquares] = useState({});
  const [orientation, setOrientation] = useState('white');
  const [isGameOver, setIsGameOver] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [whiteWins, setWhiteWins] = useState(0);
  const [blackWins, setBlackWins] = useState(0);
  const [showRestartBtn, setShowRestartBtn] = useState(false);
  const [engineLevel, setEngineLevel] = useState(3);
  const [colorChoice, setColorChoice] = useState('w');
  const [engineReady, setEngineReady] = useState(false); // setup finished, game in progress
  const [isThinking, setIsThinking] = useState(false);
  const workerRef = useRef(null);
  const gameRef = useRef(game);
  const positionsRef = useRef([]); // FENs of positions before each move (for repetition)
  const requestId = useRef(0);

  useEffect(() => {
    setGame(new Chess());
    setStatus("Let's Play!");
    setIsGameOver(false);
    setShowRestartBtn(false);
    setMoveFrom('');
    setHighlightedSquares({});
    setPlayerColor(null);
    setGameId('');

    if (mode === 'online') {
      const SERVER_URL = import.meta.env.VITE_SERVER_URL;
      socket = io(SERVER_URL, { auth: { token } });
      socket.on('connect_error', (err) => {
        setStatus(`Connection failed: ${err.message}. Try logging in again.`);
      });
      socket.on('gameError', (msg) => { setStatus(msg); });
      
      socket.on('assignedColor', (color) => { 
        setPlayerColor(color);
        setOrientation(color === 'w' ? 'white' : 'black');
      });
      socket.on('gameState', (fen) => { updateGame(fen); });
      socket.on('moveMade', (data) => { updateGame(data.fen); });
      socket.on('gameOver', (data) => { handleGameOver(data, 'online'); });
      socket.on('gameFound', (data) => {
        setIsSearching(false);
        setGameId(data.roomId);
        updateGame(data.fen);
        setPlayerColor(data.colors[socket.id]);
        setOrientation(data.colors[socket.id] === 'w' ? 'white' : 'black');
      });
      socket.on('opponentDisconnected', () => {
        handleGameOver({ reason: "Opponent disconnected." }, 'online');
      });

    } else if (mode === 'engine') {
      positionsRef.current = [];
      setEngineReady(false);
      setIsThinking(false);
      const worker = new Worker(new URL('../engine/engine.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const { id, move, error } = e.data;
        if (id !== requestId.current) return; // stale answer (game was restarted)
        setIsThinking(false);
        if (error || !move) { setStatus('The engine failed to move. Try restarting.'); return; }
        const g = new Chess(gameRef.current.fen());
        positionsRef.current.push(g.fen());
        try {
          g.move({ from: move.from, to: move.to, promotion: move.promotion });
        } catch {
          setStatus('The engine returned an illegal move.');
          return;
        }
        setGame(g);
        setStatus(getGameStatus(g));
      };
      workerRef.current = worker;
    } else if (mode === 'local') {
      setWhiteWins(0);
      setBlackWins(0);
      setStatus(getGameStatus(new Chess()));
      setOrientation('white');
    }

    return () => {
      if (socket) socket.disconnect();
      if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
    };
  }, [mode]);

  useEffect(() => { gameRef.current = game; }, [game]);

  // Ask the engine for a move whenever it is its turn
  useEffect(() => {
    if (mode !== 'engine' || !engineReady || isGameOver || !workerRef.current) return;
    if (game.turn() === playerColor || game.isGameOver()) return;
    const id = ++requestId.current;
    setIsThinking(true);
    setStatus('Computer is thinking...');
    workerRef.current.postMessage({
      id,
      fen: game.fen(),
      level: engineLevel,
      history: positionsRef.current.slice(),
    });
  }, [game, engineReady, playerColor, isGameOver, mode, engineLevel]);
  
  const getGameStatus = (currentGame) => {
    if (currentGame.isCheckmate()) {
      const winner = currentGame.turn() === 'w' ? 'Black' : 'White';
      if (mode === 'local' && !isGameOver) {
        winner === 'White' ? setWhiteWins(w => w + 1) : setBlackWins(b => b + 1);
      }
      setIsGameOver(true);
      setShowRestartBtn(true);
      return `Checkmate! ${winner} wins.`;
    }
    if (mode === 'engine') {
      const key = (f) => f.split(' ').slice(0, 4).join(' ');
      const k = key(currentGame.fen());
      const seen = positionsRef.current.filter((f) => key(f) === k).length + 1;
      if (seen >= 3) {
        setIsGameOver(true);
        setShowRestartBtn(true);
        return 'Draw by repetition!';
      }
    }
    if (currentGame.isDraw()) {
        setIsGameOver(true);
        setShowRestartBtn(true);
        return "Draw!";
    }
    return `${currentGame.turn() === 'w' ? "White's" : "Black's"} turn`;
  }
  
  const updateGame = (fen) => {
    const newGame = new Chess(fen);
    setGame(newGame);
    setStatus(getGameStatus(newGame));
  };
  
  const handleGameOver = (data, source) => {
    if (source === 'online') {
        setIsGameOver(true);
        setStatus(data.reason);
        alert(data.reason);
    }
  }

  const handleRestart = () => {
    if (mode === 'engine') {
      requestId.current++;
      positionsRef.current = [];
      setIsThinking(false);
      setEngineReady(false);
      setPlayerColor(null);
      setGame(new Chess());
      setIsGameOver(false);
      setShowRestartBtn(false);
      setMoveFrom('');
      setHighlightedSquares({});
      setStatus("Let's Play!");
      return;
    }
    const newGame = new Chess();
    setGame(newGame);
    setStatus(getGameStatus(newGame));
    setIsGameOver(false);
    setShowRestartBtn(false);
    setOrientation('white');
  };

  const handleStartEngineGame = () => {
    const color = colorChoice === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : colorChoice;
    requestId.current++;
    positionsRef.current = [];
    const fresh = new Chess();
    setGame(fresh);
    setPlayerColor(color);
    setOrientation(color === 'w' ? 'white' : 'black');
    setIsGameOver(false);
    setShowRestartBtn(false);
    setEngineReady(true);
    setStatus(color === 'w' ? 'Your move!' : 'Computer is thinking...');
  };

  const handleJoinGame = () => { if (gameId && socket) socket.emit('joinRoom', gameId); };
  const handleFindGame = () => {
    if (socket) {
      setIsSearching(true);
      setStatus("Searching for an opponent...");
      socket.emit('findGame');
    }
  };
  
  function handleMove(from, to) {
    if (isGameOver) return false;
    const gameCopy = new Chess(game.fen());
    const move = gameCopy.move({ from, to, promotion: 'q' });
    if (move === null) return false;

    if (mode === 'local') {
      setGame(gameCopy);
      setStatus(getGameStatus(gameCopy));
      setOrientation(p => p === 'white' ? 'black' : 'white'); 
    } else if (mode === 'engine') {
      if (isThinking || game.turn() !== playerColor) return false;
      positionsRef.current.push(game.fen());
      setGame(gameCopy);
      setStatus(getGameStatus(gameCopy));
    } else if (mode === 'online' && socket) {
      socket.emit('playerMove', { roomId: gameId, from, to, promotion: 'q' });
    }
    return true;
  }

  function onSquareClick(square) {
    if (isGameOver) return;
    
    const currentTurn = game.turn();
    if (mode === 'online' && currentTurn !== playerColor) return;
    if (mode === 'engine' && (!engineReady || isThinking || currentTurn !== playerColor)) return;
    
    const pieceOnTarget = game.get(square);
    if (moveFrom && pieceOnTarget && pieceOnTarget.color === currentTurn) {
      setMoveFrom(square);
      const moves = game.moves({ square, verbose: true });
      const newHighlights = { [square]: { type: 'selected' } };
      moves.forEach(m => { newHighlights[m.to] = { type: 'option' }; });
      setHighlightedSquares(newHighlights);
      return;
    }
    
    if (square === moveFrom) {
      setMoveFrom('');
      setHighlightedSquares({});
      return;
    }

    if (moveFrom) {
      handleMove(moveFrom, square);
      setMoveFrom('');
      setHighlightedSquares({});
      return;
    }

    const piece = game.get(square);
    if (piece && piece.color === currentTurn) {
      setMoveFrom(square);
      const moves = game.moves({ square, verbose: true });
      const newHighlights = { [square]: { type: 'selected' } };
      moves.forEach(m => { newHighlights[m.to] = { type: 'option' }; });
      setHighlightedSquares(newHighlights);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <button onClick={onExit}>← Back to Menu</button>
      </div>
      
      {mode === 'online' && !playerColor && (
        <div className="online-menu">
          <div className="game-controls">
            <input type="text" placeholder="Enter Room ID" value={gameId} onChange={(e) => setGameId(e.target.value)} disabled={isSearching} />
            <button onClick={handleJoinGame} disabled={isSearching}>Join by ID</button>
          </div>
          <div className="separator">OR</div>
          <div className="game-controls">
             <button className="find-game-btn" onClick={handleFindGame} disabled={isSearching}>
                {isSearching ? 'Searching...' : 'Find a Random Game'}
             </button>
          </div>
        </div>
      )}
      
      {mode === 'engine' && !engineReady && (
        <div className="engine-setup">
          <h3>Choose difficulty</h3>
          <div className="option-row">
            {ENGINE_LEVELS.map((l) => (
              <button key={l.id} className={`option-btn ${engineLevel === l.id ? 'active' : ''}`} onClick={() => setEngineLevel(l.id)}>
                {l.name}
              </button>
            ))}
          </div>
          <div className="level-hint">{ENGINE_LEVELS.find((l) => l.id === engineLevel)?.hint}</div>
          <h3>Play as</h3>
          <div className="option-row">
            {[['w', 'White'], ['b', 'Black'], ['r', 'Random']].map(([v, label]) => (
              <button key={v} className={`option-btn ${colorChoice === v ? 'active' : ''}`} onClick={() => setColorChoice(v)}>
                {label}
              </button>
            ))}
          </div>
          <button className="start-btn" onClick={handleStartEngineGame}>Start Game</button>
        </div>
      )}

      {mode === 'engine' && engineReady && showRestartBtn && (
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <button onClick={handleRestart} className="restart-btn">New Game</button>
        </div>
      )}

      {mode === 'local' && (
        <div className="local-game-info">
          <div className="win-counter">White: {whiteWins}</div>
          {showRestartBtn ? (
            <button onClick={handleRestart} className="restart-btn">Play Again</button>
          ) : (
            <button onClick={() => setOrientation(p => p === 'white' ? 'black' : 'white')} className="flip-btn">Flip Board</button>
          )}
          <div className="win-counter">Black: {blackWins}</div>
        </div>
      )}
      
      <p className="status-text">{status}</p>
      {mode === 'online' && playerColor && <p className="status-text">You are playing as {playerColor === 'w' ? 'White' : 'Black'}</p>}
      
      <Board
        boardState={game.board()}
        onSquareClick={onSquareClick}
        highlightedSquares={highlightedSquares}
        orientation={mode === 'online' || mode === 'engine' ? (playerColor === 'b' ? 'black' : 'white') : orientation}
      />
    </div>
  );
}

export default Game;