import React, { useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { Login } from './components/Auth/Login';
import { Register } from './components/Auth/Register';
import { ChatWindow } from './components/Chat/ChatWindow';
import { ConversationList } from './components/Chat/ConversationList';
import { UserList } from './components/UserList/UserList';
import { ControlPanel } from './components/Common/ControlPanel';
import { useChat } from './contexts/ChatContext';
import './App.css';
import './AppLayout.css';

const TopBar = () => {
  return (
    <div className="top-bar">
      <div className="top-bar-branding">
        <h1>ZChat</h1>
      </div>
      <ControlPanel />
    </div>
  );
};

const ChatMain = () => {
  const { user } = useAuth();
  const { selectedConversation } = useChat();
  const [showUserList, setShowUserList] = useState(false);

  return (
    <div className="app-layout">
      <TopBar />
      <div className={`chat-container ${selectedConversation ? 'conversation-active' : ''}`}>
        <div className="sidebar">
          <div className="sidebar-header">
            <div>
              <h2>{user.username}</h2>
              <span className="user-status online">Online</span>
            </div>
            {/* ControlPanel removed from here */}
          </div>
          <ConversationList onNewChat={() => setShowUserList(true)} />
        </div>

        <ChatWindow />

        {showUserList && <UserList onClose={() => setShowUserList(false)} />}
      </div>
    </div>
  );
};

const ChatApp = () => {
  const { user, loading } = useAuth();

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
      <ChatMain />
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
    <ThemeProvider>
      <AuthProvider>
        <ChatApp />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;