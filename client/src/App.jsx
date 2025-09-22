import React, { useState, useEffect } from 'react';
import Game from './components/Game.jsx';
import MainMenu from './components/Mainmenu.jsx';
import AuthPage from './components/AuthPage.jsx';
import axios from 'axios';
import { AnimatedBackground } from './components/AnimatedBackground.jsx';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [gameMode, setGameMode] = useState(null);

  useEffect(() => {
    const verifyUser = async () => {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        try {
          const serverUrl = import.meta.env.VITE_SERVER_URL;
          const response = await axios.get(`${serverUrl}/api/verify`, {
            headers: { Authorization: `Bearer ${storedToken}` }
          });
          setUser(response.data);
          setToken(storedToken);
          localStorage.setItem('user', JSON.stringify(response.data));
        } catch (error) {
          console.error("Token verification failed:", error.response?.data?.message);
          handleLogout(); // Log out if token is invalid
        }
      }
    };
    verifyUser();
  }, []);

  const handleLogin = (authData) => {
    localStorage.setItem('token', authData.token);
    localStorage.setItem('user', JSON.stringify(authData.user));
    setToken(authData.token);
    setUser(authData.user);
  };

  const handleGuestLogin = () => {
    const guestUser = { username: 'Guest', isGuest: true };
    setUser(guestUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setGameMode(null);
  };

  const handleSelectMode = (mode) => { setGameMode(mode); };
  const handleExitGame = () => { setGameMode(null); };

  return (
    <>
      <AnimatedBackground />
      <div className="App">
        {!user ? (
          <AuthPage onLogin={handleLogin} onGuestLogin={handleGuestLogin} />
        ) : (
          <>
            <header className="App-header">
              <h1>Welcome, {user.username}!</h1>
              {!user.isGuest && <button onClick={handleLogout} className="logout-btn">Logout</button>}
            </header>
            <main>
              {!gameMode ? (
                <MainMenu onSelectMode={handleSelectMode} user={user} />
              ) : (
                <Game mode={gameMode} onExit={handleExitGame} user={user} token={token} />
              )}
            </main>
          </>
        )}
      </div>
    </>
  );
}

export default App;
