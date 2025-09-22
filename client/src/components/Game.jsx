import React, { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import io from 'socket.io-client';
import Board from './Board.jsx';
// import Module from '/engine.js'; 

let socket;

function Game({ mode, onExit }) {
  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState(null);
  const [gameId, setGameId] = useState('');
  const [status, setStatus] = useState("Let's Play!");
  const [moveFrom, setMoveFrom] = useState('');
  const [highlightedSquares, setHighlightedSquares] = useState({});
  const [orientation, setOrientation] = useState('white');
  const [isGameOver, setIsGameOver] = useState(false);
  const [engine, setEngine] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [whiteWins, setWhiteWins] = useState(0);
  const [blackWins, setBlackWins] = useState(0);
  const [showRestartBtn, setShowRestartBtn] = useState(false);

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
      socket = io(SERVER_URL);
      
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
      // --- ENGINE LOGIC IS COMMENTED OUT ---
      // When you are ready, uncomment this block to load your WASM engine.
      /*
      setStatus("Loading Engine...");
      Module().then((loadedModule) => {
        const engineAPI = {
          setPosition: loadedModule.cwrap('setPosition', null, ['string']),
          makeUserMove: loadedModule.cwrap('makeUserMove', null, ['string']),
          getBestMove: loadedModule.cwrap('getBestMove', 'string', []),
        };
        engineAPI.setPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
        setEngine(engineAPI);
        setStatus("Engine loaded. Your move!");
      });
      */
    } else if (mode === 'local') {
      setWhiteWins(0);
      setBlackWins(0);
      setStatus(getGameStatus(new Chess()));
      setOrientation('white');
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [mode]);
  
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
    const newGame = new Chess();
    setGame(newGame);
    setStatus(getGameStatus(newGame));
    setIsGameOver(false);
    setShowRestartBtn(false);
    setOrientation('white');
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
    } else if (mode === 'online' && socket) {
      socket.emit('playerMove', { roomId: gameId, from, to, promotion: 'q' });
    }
    return true;
  }

  function onSquareClick(square) {
    if (isGameOver) return;
    
    const currentTurn = game.turn();
    if (mode === 'online' && currentTurn !== playerColor) return;
    
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
        orientation={mode === 'online' ? (playerColor === 'b' ? 'black' : 'white') : orientation}
      />
    </div>
  );
}

export default Game;