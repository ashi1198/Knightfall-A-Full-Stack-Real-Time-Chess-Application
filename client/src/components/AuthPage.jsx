// client/src/components/AuthPage.jsx
import React, { useState } from 'react';
import axios from 'axios';
import { GoogleLogin } from '@react-oauth/google';
import "./AuthPage.css"
// The onAuth prop is now an onLogin prop to be more specific
function AuthPage({ onLogin, onGuestLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const endpoint = isLogin ? '/api/login' : '/api/register';
    const serverUrl = import.meta.env.VITE_SERVER_URL;
    
    try {
      const response = await axios.post(`${serverUrl}${endpoint}`, { username, password });
      if (isLogin) {
        onLogin(response.data); 
      } else {
        alert('Registration successful! Please log in.');
        setIsLogin(true);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'An error occurred.');
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL;
      const response = await axios.post(`${serverUrl}/api/auth/google`, {
        credential: credentialResponse.credential,
      });
      onLogin(response.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Google sign-in failed.');
    }
  };

  return (
    <div className="auth-container">
      <form onSubmit={handleSubmit} className="auth-form">
        <h2>{isLogin ? 'Login' : 'Register'}</h2>
        {error && <p className="error-message">{error}</p>}
        <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit">{isLogin ? 'Login' : 'Register'}</button>
        <p onClick={() => { setIsLogin(!isLogin); setError(''); }} className="toggle-auth">
          {isLogin ? 'Need an account? Register' : 'Have an account? Login'}
        </p>
        
        <div className="separator">OR</div>
        <div className="google-btn-wrapper">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => setError('Google sign-in failed.')}
            theme="filled_black"
            shape="pill"
          />
        </div>
        <div className="separator">OR</div>
        <button type="button" className="guest-btn" onClick={onGuestLogin}>
          Play as Guest
        </button>
      </form>
    </div>
  );
}

export default AuthPage;