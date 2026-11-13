import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { useCall } from '../../contexts/CallContext';
import { useCoarsePointer, useIsPhone } from '../../hooks/useMediaQuery';
import { Avatar } from '../Common/Avatar';
import { Icon } from '../Common/Icon';
import { Sheet } from '../Common/Sheet';
import ImageModal from '../Common/ImageModal';
import { Composer } from './Composer';
import { EmojiPicker } from './EmojiPicker';
import { MessageActions } from './MessageActions';
import { MessageList } from './MessageList';
import './ChatWindow.css';

const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a temporary textarea
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  }
};

export const ChatWindow = () => {
  const { t, i18n } = useTranslation();
  const {
    selectedConversation, messages, deleteMessage, reactToMessage, selectConversation,
    setMessages, loadOlderMessages, hasMoreMessages,
  } = useChat();
  const { user, wsClient } = useAuth();
  const { startCall } = useCall();
  const coarse = useCoarsePointer();
  const isPhone = useIsPhone();

  const [modalImage, setModalImage] = useState(null); // { url, name }
  const [isDragging, setIsDragging] = useState(false);
  const [actionTarget, setActionTarget] = useState(null); // { message, x, y, via, isMine }
  const [reactionFor, setReactionFor] = useState(null);   // message awaiting an emoji
  const [editing, setEditing] = useState(null);           // { id, content }
  const [replyingTo, setReplyingTo] = useState(null);     // { id, content, sender_username }
  const [toast, setToast] = useState('');
  const composerRef = useRef(null);
  const toastTimer = useRef(null);
  const actionTriggerRef = useRef(null); // where focus was when the actions opened

  const conversationId = selectedConversation?.id;
  const conversationMessages = conversationId ? messages[conversationId] : undefined;

  // Per-conversation UI state must not leak between chats
  useEffect(() => {
    setEditing(null);
    setReplyingTo(null);
    setActionTarget(null);
    setReactionFor(null);
  }, [conversationId]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Read receipts from the other side
  useEffect(() => {
    if (!wsClient) return undefined;
    const handleMessagesRead = (data) => {
      if (data.user_id === user.id) return;
      setMessages((prev) => {
        const current = prev[data.conversation_id] || [];
        if (!current.some((m) => m.sender_id === user.id && !m.is_read)) return prev;
        return {
          ...prev,
          [data.conversation_id]: current.map((m) =>
            m.sender_id === user.id && !m.is_read ? { ...m, is_read: true } : m
          ),
        };
      });
    };
    wsClient.on('messages_read', handleMessagesRead);
    return () => wsClient.off('messages_read', handleMessagesRead);
  }, [wsClient, setMessages, user.id]);

  // Mark as read while the conversation is open and messages arrive
  useEffect(() => {
    if (!selectedConversation || !wsClient) return undefined;
    const markRead = () => wsClient.markRead(selectedConversation.id);
    if (document.hasFocus()) markRead();
    window.addEventListener('focus', markRead);
    return () => window.removeEventListener('focus', markRead);
  }, [selectedConversation, wsClient, conversationMessages?.length]);

  const showToast = useCallback((text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  }, []);

  const openActions = useCallback((message, point) => {
    // Remember where focus was (hover button, composer...) or fall back to the message row,
    // which survives the menu/sheet unmounting, so closing never drops focus onto <body>
    const active = document.activeElement;
    actionTriggerRef.current = active && active !== document.body
      ? active
      : document.querySelector(`[data-message-id="${message.id}"]`);
    setActionTarget({ message, ...point, isMine: message.sender_id === user.id });
  }, [user.id]);

  const closeActions = useCallback(() => {
    setActionTarget(null);
    const trigger = actionTriggerRef.current;
    if (trigger && document.contains(trigger)) {
      trigger.focus({ preventScroll: true });
    } else if (!coarse) {
      composerRef.current?.focus(); // the message is gone (deleted): keep keyboard users in the chat
    }
  }, [coarse]);

  const startReply = useCallback((message) => {
    setEditing(null);
    setReplyingTo({
      id: message.id,
      content: message.content,
      sender_username: message.sender_username || user.username,
    });
  }, [user.username]);

  const startEdit = (message) => {
    setReplyingTo(null);
    setEditing({ id: message.id, content: message.content });
  };

  const handleCopy = async (message) => {
    if (await copyText(message.content || '')) showToast(t('chat.copied'));
  };

  const handleReact = useCallback((message, emoji) => reactToMessage(message.id, emoji), [reactToMessage]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e) => {
    // Ignore dragleave fired when moving between child elements
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) composerRef.current?.addFile(e.dataTransfer.files[0]);
  };

  if (!selectedConversation) {
    return (
      <div className="chat-window chat-window--empty" data-testid="chat-empty">
        <div className="empty-state">
          <span className="empty-icon empty-icon--lg" aria-hidden="true"><Icon name="chat" size={48} /></span>
          <h2>{t('chat.welcome_title')}</h2>
          <p>{t('chat.welcome_subtitle')}</p>
        </div>
      </div>
    );
  }

  const other = selectedConversation.is_group
    ? null
    : selectedConversation.participants?.find((p) => p.id !== user.id);
  const title = selectedConversation.is_group
    ? selectedConversation.name || t('chat.group_chat_default')
    : other?.username || 'Chat';
  const subtitle = selectedConversation.is_group
    ? selectedConversation.participants?.map((p) => p.username).join(', ')
    : other?.is_online ? t('chat.online') : t('chat.offline');

  return (
    <div
      className={`chat-window ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-testid="chat-window"
    >
      {/* On phones this header IS the top bar (the app bar belongs to the list view) */}
      <header className="chat-header">
        <button
          type="button"
          className="icon-btn mobile-back-button"
          onClick={() => selectConversation(null)}
          aria-label={t('chat.back')}
          data-testid="back-button"
        >
          <Icon name="back" />
        </button>
        <Avatar name={title} size="md" isGroup={selectedConversation.is_group} online={other ? !!other.is_online : null} />
        <div className="chat-info-text">
          <h2 className="chat-title" data-testid="chat-title">{title}</h2>
          <span className={`status-indicator ${other ? (other.is_online ? 'online' : 'offline') : 'group'}`}>
            {subtitle}
          </span>
        </div>
        {other && (
          <button
            type="button"
            className="icon-btn call-button"
            onClick={() => startCall(other.id, other.username, selectedConversation.id)}
            title={t('chat.start_call')}
            aria-label={t('chat.start_call')}
            data-testid="call-button"
          >
            <Icon name="phone" />
          </button>
        )}
      </header>

      <MessageList
        conversation={selectedConversation}
        title={title}
        messages={conversationMessages}
        user={user}
        coarse={coarse}
        locale={i18n.language}
        hasMore={!!hasMoreMessages[selectedConversation.id]}
        loadOlder={() => loadOlderMessages(selectedConversation.id)}
        onOpenActions={openActions}
        onSwipeReply={startReply}
        onImageClick={setModalImage}
        onReact={handleReact}
      />

      {toast && (
        <div className="toast" role="status" data-testid="toast">{toast}</div>
      )}

      <Composer
        ref={composerRef}
        conversation={selectedConversation}
        replyingTo={replyingTo}
        editing={editing}
        onCancelReply={() => setReplyingTo(null)}
        onCancelEdit={() => setEditing(null)}
      />

      {isDragging && (
        <div className="drop-overlay" aria-hidden="true">
          <Icon name="paperclip" size={32} />
          <span>{t('chat.attach_file')}</span>
        </div>
      )}

      <MessageActions
        target={actionTarget}
        onClose={closeActions}
        onReply={() => startReply(actionTarget.message)}
        onCopy={() => handleCopy(actionTarget.message)}
        onEdit={() => startEdit(actionTarget.message)}
        onDelete={(type) => deleteMessage(actionTarget.message.id, type)}
        onReact={(emoji) => handleReact(actionTarget.message, emoji)}
        onMoreReactions={() => setReactionFor(actionTarget.message)}
      />

      <Sheet
        open={!!reactionFor}
        onClose={() => setReactionFor(null)}
        title={t('chat.add_reaction', 'Add reaction')}
        testId="reaction-sheet"
      >
        <EmojiPicker
          fluid={isPhone}
          skinTone={false}
          onSelect={(emoji) => {
            if (emoji?.native) handleReact(reactionFor, emoji.native);
            setReactionFor(null);
          }}
        />
      </Sheet>

      {modalImage && (
        <ImageModal url={modalImage.url} originalName={modalImage.name} onClose={() => setModalImage(null)} />
      )}
    </div>
  );
};
