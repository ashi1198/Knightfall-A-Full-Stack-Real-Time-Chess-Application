// client/src/components/Board.jsx
import React from 'react';
import './Board.css';

const PIECE_UNICODE = {
  w: { p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔' },
  b: { p: '♟︎', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚' }
};

function Board({ boardState, onSquareClick, highlightedSquares, orientation, onPieceDragStart, onSquareDragOver, onSquareDrop }) {
  
  function renderBoard() {
    const board = [];
    // 'i' represents the visual row from top (0) to bottom (7)
    for (let i = 0; i < 8; i++) {
      // 'j' represents the visual col from left (0) to right (7)
      for (let j = 0; j < 8; j++) {
        
        // --- THIS IS THE CORRECTED LOGIC ---
        // It correctly determines which piece belongs on which visual square.
        const rankIndex = orientation === 'white' ? i : 7 - i;
        const fileIndex = orientation === 'white' ? j : 7 - j;

        const piece = boardState[rankIndex][fileIndex];

        // This calculation ensures the square name always matches the true coordinate
        const squareName = `${String.fromCharCode(97 + fileIndex)}${8 - rankIndex}`;
        
        // Visual coloring is always simple
        const isLight = (i + j) % 2 !== 0;

        const highlightClass = highlightedSquares[squareName]
          ? highlightedSquares[squareName].type === 'selected'
            ? 'selected'
            : 'option'
          : '';

        board.push(
          <div
            key={squareName}
            className={`square ${isLight ? 'light' : 'dark'}`}
            onClick={() => onSquareClick(squareName)}
            onDragOver={onSquareDragOver}
            onDrop={(e) => onSquareDrop(e, squareName)}
          >
            <div className={`highlight-overlay ${highlightClass}`}></div>
            {piece && 
              <span 
                className={`piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`}
                draggable="true"
                onDragStart={(e) => onPieceDragStart(e, squareName, piece)}
              >
                {PIECE_UNICODE[piece.color][piece.type]}
              </span>
            }
          </div>
        );
      }
    }
    return board;
  }

  return (
    <div className="board-container">
      <div className="board">
        {renderBoard()}
      </div>
    </div>
  );
}

export default Board;