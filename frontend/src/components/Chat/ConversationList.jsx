import React from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { textToEmoji } from '../../utils/emojiUtils';
import { Avatar } from '../Common/Avatar';
import { Icon } from '../Common/Icon';
import './ConversationList.css';

const SkeletonRows = () => (
  <div className="conversations" aria-busy="true" data-testid="conversations-skeleton">
    {Array.from({ length: 7 }, (_, i) => (
      <div className="conversation-item conversation-item--skeleton" key={i} aria-hidden="true">
        <span className="skeleton skeleton--circle" style={{ width: 48, height: 48 }} />
        <span className="conversation-details">
          <span className="skeleton" style={{ width: `${45 + ((i * 17) % 35)}%`, height: 14 }} />
          <span className="skeleton" style={{ width: `${60 + ((i * 11) % 30)}%`, height: 12, marginTop: 8 }} />
        </span>
      </div>
    ))}
  </div>
);

export const ConversationList = ({ onNewChat }) => {
  const { t, i18n } = useTranslation();
  const { conversations, selectedConversation, selectConversation, loading, unreadCounts } = useChat();
  const { user } = useAuth();

  const getOtherUser = (conversation) => conversation.participants.find((p) => p.id !== user.id);

  const getConversationTitle = (conversation) => {
    if (conversation.is_group) return conversation.name || t('chat.group_chat_default');
    return getOtherUser(conversation)?.username || t('chat.unknown_user');
  };

  const getLastMessage = (conversation) => {
    const last = conversation.last_message;
    if (!last) return t('chat.no_messages');
    const prefix = last.sender_id === user.id ? `${t('chat.you')}: ` : '';
    // textToEmoji leaves URLs (http://, tg://, ...) untouched
    return prefix + textToEmoji(last.content || '');
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
    return date.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  if (loading) return <SkeletonRows />;

  if (conversations.length === 0) {
    return (
      <div className="conversations">
        <div className="empty-conversations" data-testid="empty-conversations">
          <span className="empty-icon" aria-hidden="true"><Icon name="chat" size={40} /></span>
          <p>{t('user_list.no_conversations')}</p>
          <button type="button" className="btn-primary" onClick={onNewChat}>
            <Icon name="plus" size={20} />
            {t('user_list.start_new_chat')}
          </button>
        </div>
      </div>
    );
  }

  const sorted = [...conversations].sort((a, b) => {
    const aTime = a.last_message?.created_at || a.updated_at;
    const bTime = b.last_message?.created_at || b.updated_at;
    return new Date(bTime) - new Date(aTime);
  });

  return (
    <nav className="conversations" aria-label={t('user_list.chats_header')} data-testid="conversation-list">
      {sorted.map((conversation) => {
        const unreadCount = unreadCounts[conversation.id] || 0;
        const active = selectedConversation?.id === conversation.id;
        const isUnread = unreadCount > 0 && !active;
        const title = getConversationTitle(conversation);
        const other = conversation.is_group ? null : getOtherUser(conversation);

        return (
          <button
            type="button"
            key={conversation.id}
            className={`conversation-item${active ? ' active' : ''}${isUnread ? ' unread' : ''}`}
            onClick={() => selectConversation(conversation)}
            aria-current={active ? 'true' : undefined}
            data-testid="conversation-item"
            data-conversation-id={conversation.id}
          >
            <Avatar
              name={title}
              size="lg"
              isGroup={conversation.is_group}
              online={other ? !!other.is_online : null}
            />
            <span className="conversation-details">
              <span className="conversation-header-row">
                <span className="conversation-title">{title}</span>
                {conversation.last_message && (
                  <span className="conversation-time">
                    {formatTime(conversation.last_message.created_at || conversation.updated_at)}
                  </span>
                )}
              </span>
              <span className="conversation-footer-row">
                <span className="conversation-preview">{getLastMessage(conversation)}</span>
                {isUnread && (
                  <span className="unread-badge" aria-label={t('chat.unread_count', { count: unreadCount })}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
};
