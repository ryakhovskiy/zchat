import React from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { textToEmoji } from '../../utils/emojiUtils';
import './Chat.css';

export const ConversationList = ({ onNewChat }) => {
  const { t } = useTranslation();
  const { conversations, selectedConversation, selectConversation, loading, unreadCounts } = useChat();
  const { user } = useAuth();

  const getConversationTitle = (conversation) => {
    if (conversation.is_group) {
      return conversation.name || t('chat.group_chat_default');
    }
    
    const otherUser = conversation.participants.find((p) => p.id !== user.id);
    return otherUser?.username || t('chat.unknown_user');
  };

  const getLastMessage = (conversation) => {
    if (!conversation.last_message) return t('chat.no_messages');
    
    const prefix = conversation.last_message.sender_id === user.id ? `${t('chat.you')}: ` : '';
    const content = textToEmoji(conversation.last_message.content);
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
          <h2>{t('user_list.chats_header')}</h2>
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
        <h2>{t('user_list.chats_header')}</h2>
        <button className="new-chat-button" onClick={onNewChat} title={t('user_list.new_chat_button_title')}>
          +
        </button>
      </div>

      <div className="conversations">
        {conversations.length === 0 ? (
          <div className="empty-conversations">
            <p>{t('user_list.no_conversations')}</p>
            <button className="btn-secondary" onClick={onNewChat}>
              {t('user_list.start_new_chat')}
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