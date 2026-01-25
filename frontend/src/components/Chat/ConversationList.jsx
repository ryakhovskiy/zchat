import React from 'react';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import './Chat.css';

export const ConversationList = ({ onNewChat }) => {
  const { conversations, selectedConversation, selectConversation, loading, unreadCounts } = useChat();
  const { user } = useAuth();

  const getConversationTitle = (conversation) => {
    if (conversation.is_group) {
      return conversation.name || 'Group Chat';
    }
    
    const otherUser = conversation.participants.find((p) => p.id !== user.id);
    return otherUser?.username || 'Unknown';
  };

  const getLastMessage = (conversation) => {
    if (!conversation.last_message) return 'No messages yet';
    
    const prefix = conversation.last_message.sender_id === user.id ? 'You: ' : '';
    const content = conversation.last_message.content;
    return prefix + (content.length > 40 ? content.substring(0, 40) + '...' : content);
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now - date) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  if (loading) {
    return (
      <div className="conversation-list">
        <div className="conversation-list-header">
          <h2>Chats</h2>
          <button className="new-chat-button" onClick={onNewChat}>
            +
          </button>
        </div>
        <div className="loading-state">Loading...</div>
      </div>
    );
  }

  return (
    <div className="conversation-list">
      <div className="conversation-list-header">
        <h2>Chats</h2>
        <button className="new-chat-button" onClick={onNewChat} title="New conversation">
          +
        </button>
      </div>

      <div className="conversations">
        {conversations.length === 0 ? (
          <div className="empty-conversations">
            <p>No conversations yet</p>
            <button className="btn-secondary" onClick={onNewChat}>
              Start a new chat
            </button>
          </div>
        ) : (
          conversations
            .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
            .map((conversation) => {
              const unreadCount = unreadCounts[conversation.id] || 0;
              const isUnread = unreadCount > 0 && selectedConversation?.id !== conversation.id;
              
              return (
                <div
                  key={conversation.id}
                  className={`conversation-item ${
                    selectedConversation?.id === conversation.id ? 'active' : ''
                  }${isUnread ? ' unread' : ''}`}
                  onClick={() => selectConversation(conversation)}
                >
                  <div className="conversation-avatar">
                    {getConversationTitle(conversation).charAt(0).toUpperCase()}
                  </div>
                  <div className="conversation-details">
                    <div className="conversation-header-row">
                      <h4>{getConversationTitle(conversation)}</h4>
                      <div className="conversation-meta">
                        {isUnread && (
                          <span className="unread-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                        )}
                        {conversation.last_message && (
                          <span className="conversation-time">
                            {formatTime(conversation.updated_at)}
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="conversation-preview">{getLastMessage(conversation)}</p>
                  </div>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
};