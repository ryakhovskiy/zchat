import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { Login } from './components/Auth/Login';
import { Register } from './components/Auth/Register';
import { ChatWindow } from './components/Chat/ChatWindow';
import { ConversationList } from './components/Chat/ConversationList';
import { UserList } from './components/UserList/UserList';
import './App.css';

const ChatApp = () => {
  const { user, logout, loading } = useAuth();
  const [showUserList, setShowUserList] = useState(false);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthFlow />;
  }

  return (
    <ChatProvider>
      <div className="chat-container">
        <div className="sidebar">
          <div className="sidebar-header">
            <div>
              <h2>{user.username}</h2>
              <span className="user-status online">Online</span>
            </div>
            <button className="logout-button" onClick={logout}>
              Logout
            </button>
          </div>
          <ConversationList onNewChat={() => setShowUserList(true)} />
        </div>

        <ChatWindow />

        {showUserList && <UserList onClose={() => setShowUserList(false)} />}
      </div>
    </ChatProvider>
  );
};

const AuthFlow = () => {
  const [isLogin, setIsLogin] = useState(true);

  return isLogin ? (
    <Login onSwitchToRegister={() => setIsLogin(false)} />
  ) : (
    <Register onSwitchToLogin={() => setIsLogin(true)} />
  );
};

function App() {
  return (
    <AuthProvider>
      <ChatApp />
    </AuthProvider>
  );
}

export default App;