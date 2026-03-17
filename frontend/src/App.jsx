import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { CallProvider } from './contexts/CallContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { CallOverlay } from './components/Chat/CallModal';
import { Login } from './components/Auth/Login';
import { Register } from './components/Auth/Register';
import { ChatWindow } from './components/Chat/ChatWindow';
import { ConversationList } from './components/Chat/ConversationList';
import { UserList } from './components/UserList/UserList';
import { ControlPanel } from './components/Common/ControlPanel';
import { WebBrowser } from './components/Browser/WebBrowser';
import { useChat } from './contexts/ChatContext';
import './App.css';
import './AppLayout.css';

const TopBar = () => {
  return (
    <div className="top-bar">
      <div className="top-bar-branding">
        <h1>ZChat</h1>
        <a href="/app/android/zchat.apk" download className="android-download" title="Download Android App">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0012 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.983 5.983 0 006 7h12c0-2.21-1.2-4.15-2.97-5.18-.15-.09-.2-.15-.5.16zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/>
          </svg>
        </a>
      </div>
      <ControlPanel />
    </div>
  );
};

const ChatMain = () => {
  const { user } = useAuth();
  const { selectedConversation, unreadCounts, isBrowserOpen } = useChat();
  const [showUserList, setShowUserList] = useState(false);

  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    document.title = totalUnread > 0 ? `zChat (${totalUnread})` : 'zChat';
  }, [unreadCounts]);

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

        {isBrowserOpen ? (
            <WebBrowser /> 
        ) : (
            <ChatWindow />
        )}

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
      <CallProvider>
        <CallOverlay />
        <ChatMain />
      </CallProvider>
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