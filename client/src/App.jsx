// client/src/App.jsx
import './App.css';
import React, { useState } from 'react';
import Game from './components/Game.jsx';
import MainMenu from './components/MainMenu.jsx';

function App() {
  const [gameMode, setGameMode] = useState(null); // 'online', 'engine', 'local'

  const handleSelectMode = (mode) => {
    setGameMode(mode);
  };

  const handleExitGame = () => {
    setGameMode(null); // Go back to the main menu
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>React Chess</h1>
      </header>
      <main>
        {!gameMode ? (
          <MainMenu onSelectMode={handleSelectMode} />
        ) : (
          <Game mode={gameMode} onExit={handleExitGame} />
        )}
      </main>
    </div>
  );
}

export default App;