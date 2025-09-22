// client/src/components/MainMenu.jsx
import React from 'react';
import './MainMenu.css';

// The component now receives the user object as a prop
function MainMenu({ onSelectMode, user }) {
  const isGuest = user?.isGuest; // Check if the user is a guest

  return (
    <div className="main-menu">
      <h2>Choose a Game Mode</h2>
      <div className="menu-options">
        <button 
          onClick={() => onSelectMode('online')}
          disabled={isGuest} // --- DISABLE BUTTON FOR GUESTS ---
          title={isGuest ? "You must be logged in to play online" : ""}
        >
          <h3>🌐 Play with a Friend</h3>
          <p>Create, join, or find a random game to play online.</p>
        </button>
        <button onClick={() => onSelectMode('engine')}>
          <h3>🤖 Play vs Computer</h3>
          <p>Challenge the offline C++ chess engine.</p>
        </button>
        <button onClick={() => onSelectMode('local')}>
          <h3>👥 Play on Same Device</h3>
          <p>Two players, one screen. Pass and play.</p>
        </button>
      </div>
    </div>
  );
}

export default MainMenu;