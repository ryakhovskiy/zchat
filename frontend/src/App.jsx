import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useChat } from './contexts/ChatContext';
import { Avatar } from './components/Common/Avatar';
import { Icon } from './components/Common/Icon';
import { useConnectionStatus } from './hooks/useConnectionStatus';
import { useAppHeight } from './hooks/useAppHeight';
import './AppLayout.css';

const ConnectionBanner = () => {
  const { t } = useTranslation();
  const status = useConnectionStatus();
  if (status === 'online') return null;
  return (
    <div className="banner connection-banner" role="status" aria-live="polite" data-testid="connection-banner" data-status={status}>
      <Icon name="alert" size={18} />
      <span>{status === 'offline' ? t('chat.offline_banner') : t('chat.reconnecting_banner')}</span>
    </div>
  );
};

// App bar of the list view. On phones, opening a chat hides this pane: the chat header is the top bar.
const SidebarHeader = ({ onNewChat }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  return (
    <header className="sidebar-header top-bar">
      <div className="top-bar-branding">
        <Avatar name={user.username} size="md" online />
        <div className="top-bar-title">
          <h1>ZChat</h1>
          <span className="user-status online" data-testid="current-username">
            {user.username}
          </span>
        </div>
      </div>
      <div className="sidebar-actions">
        <a
          href="/app/android/zchat.apk"
          download
          className="icon-btn android-download"
          title={t('chat.download_android')}
          aria-label={t('chat.download_android')}
        >
          <Icon name="android" />
        </a>
        <button
          type="button"
          className="icon-btn new-chat-button"
          onClick={onNewChat}
          title={t('user_list.new_chat_button_title')}
          aria-label={t('user_list.new_chat_button_title')}
          data-testid="new-chat-button"
        >
          <Icon name="plus" />
        </button>
        <ControlPanel />
      </div>
    </header>
  );
};

const ChatMain = () => {
  const { selectedConversation, unreadCounts } = useChat();
  const [showUserList, setShowUserList] = useState(false);
  useAppHeight();

  useEffect(() => {
    const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
    document.title = totalUnread > 0 ? `zChat (${totalUnread})` : 'zChat';
  }, [unreadCounts]);

  return (
    <div className="app-layout" data-view={selectedConversation ? 'chat' : 'list'}>
      <ConnectionBanner />
      <div className="chat-container">
        <aside className="sidebar" data-testid="sidebar">
          <SidebarHeader onNewChat={() => setShowUserList(true)} />
          <ConversationList onNewChat={() => setShowUserList(true)} />
        </aside>

        <main className="chat-pane">
          <ChatWindow />
        </main>
      </div>

      <UserList open={showUserList} onClose={() => setShowUserList(false)} />
    </div>
  );
};

const ChatApp = () => {
  const { t } = useTranslation();
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>{t('common.loading')}</p>
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
  useAppHeight();
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