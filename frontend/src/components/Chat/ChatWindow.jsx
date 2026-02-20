import React, { useState, useEffect, useRef } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { useCall } from '../../contexts/CallContext';
import { textToEmoji } from '../../utils/emojiUtils';
import { filesAPI } from '../../services/api';
import { ControlPanel } from '../Common/ControlPanel';
import './Chat.css';

export const ChatWindow = () => {
  const { t } = useTranslation();
  const { selectedConversation, messages, sendMessage, selectConversation, setMessages } = useChat();
  const { user, wsClient } = useAuth();
  const { startCall } = useCall();
  const [inputValue, setInputValue] = useState('');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const messagesEndRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const conversationMessages = selectedConversation
    ? messages[selectedConversation.id] || []
    : [];

  useEffect(() => {
    scrollToBottom();
  }, [conversationMessages]);

  useEffect(() => {
    if (textareaRef.current) {
        // Reset height to auto to correctly calculate scrollHeight for shrinking
        textareaRef.current.style.height = 'auto';
        const scrollHeight = textareaRef.current.scrollHeight;
        // Max height approx 120px (4-5 lines)
        textareaRef.current.style.height = `${Math.min(scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  // Handle read receipts
  useEffect(() => {
    if (!wsClient) return;

    const handleMessagesRead = (data) => {
      // If the read receipt is from the current user, we don't update our own sent messages 
      // as read by "someone else". However, in a multi-device scenario, this might need adjustment.
      if (data.user_id === user.id) return;

      setMessages((prev) => {
        const conversationId = data.conversation_id;
        const currentMessages = prev[conversationId] || [];
        
        // Check if any message needs update to avoid unnecessary re-renders
        const hasUnreadSentMessages = currentMessages.some(
          msg => msg.sender_id === user.id && !msg.is_read
        );

        if (!hasUnreadSentMessages) return prev;

        return {
          ...prev,
          [conversationId]: currentMessages.map((msg) => 
            (msg.sender_id === user.id && !msg.is_read) ? { ...msg, is_read: true } : msg
          )
        };
      });
    };

    wsClient.on('messages_read', handleMessagesRead);
    return () => wsClient.off('messages_read', handleMessagesRead);
  }, [wsClient, setMessages, user.id]);

  // Mark as read when conversation is open or messages update
  useEffect(() => {
    if (selectedConversation && wsClient) {
        const handleFocus = () => {
             wsClient.markRead(selectedConversation.id);
        };
        
        if (document.hasFocus()) {
            handleFocus();
        }
        
        window.addEventListener('focus', handleFocus);
        return () => window.removeEventListener('focus', handleFocus);
    }
  }, [selectedConversation, wsClient, conversationMessages.length]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleSubmit(e);
    }
  };

  useEffect(() => {
    if (!isEmojiPickerOpen) return;

    const handleClickOutside = (event) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target)) {
        setIsEmojiPickerOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isEmojiPickerOpen]);

  const formatMessageContent = (content) => {
    if (!content) return null;

    // URL regex pattern to capture links
    const urlPattern = /(https?:\/\/[^\s]+)/;
    
    // Split content by URLs, including the separators (URLs themselves)
    return content.split(urlPattern).map((part, index) => {
      // Check if part is a URL
      if (part.match(urlPattern)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="message-link"
            onClick={(e) => e.stopPropagation()}
            style={{ color: '#4dabf7', textDecoration: 'underline' }}
          >
            {part}
          </a>
        );
      }
      
      // If not a URL, apply emoji conversion
      return <span key={index}>{textToEmoji(part)}</span>;
    });
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if ((!inputValue.trim() && !selectedFile) || !selectedConversation) return;

    try {
      let fileData = null;
      if (selectedFile) {
        setUploading(true);
        const response = await filesAPI.upload(selectedFile);
        fileData = response.data;
        setUploading(false);
      }

      sendMessage(selectedConversation.id, inputValue, fileData);
      setInputValue('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setIsEmojiPickerOpen(false);
    } catch (error) {
      console.error('Failed to send message:', error);
      setUploading(false);
      let errorMessage = t('chat.failed_to_send');
      
      if (error.response) {
        // Backend returned an error response
        if (error.response.data && error.response.data.detail) {
           errorMessage = error.response.data.detail;
        } else if (error.response.status === 413) {
           errorMessage = t('chat.file_too_large');
        }
      } else if (error.request) {
        // Request was made but no response received
        errorMessage = "Network error. Please check your connection.";
      }

      alert(errorMessage);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const MAX_SIZE = 50 * 1024 * 1024; // 50MB
      
      const FORBIDDEN_EXTENSIONS = [
        '.exe', '.dll', '.bat', '.cmd', '.sh', '.cgi', '.jar', '.js', '.vbs', 
        '.ps1', '.py', '.php', '.msi', '.com', '.scr', '.pif', '.reg', '.app',
        '.bin', '.wsf', '.vb', '.iso', '.dmg', '.pkg'
      ];

      if (file.size > MAX_SIZE) {
        alert(t('chat.file_too_large'));
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (FORBIDDEN_EXTENSIONS.includes(ext)) {
        alert(t('chat.file_type_not_allowed'));
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      setSelectedFile(file);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleEmojiSelect = (emoji) => {
    if (!emoji || !emoji.native) return;
    setInputValue((prev) => `${prev}${emoji.native}`);
    setIsEmojiPickerOpen(false);
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getConversationTitle = () => {
    if (!selectedConversation) return '';
    
    if (selectedConversation.is_group) {
      return selectedConversation.name || t('chat.group_chat_default');
    }
    
    const otherUser = selectedConversation.participants.find(
      (p) => p.id !== user.id
    );
    return otherUser?.username || 'Chat';
  };

  const getOnlineStatus = () => {
    if (!selectedConversation || selectedConversation.is_group) return null;
    
    const otherUser = selectedConversation.participants.find(
      (p) => p.id !== user.id
    );
    return otherUser?.is_online;
  };

  if (!selectedConversation) {
    return (
      <div className="chat-window">
        <div className="empty-state">
          <h2>{t('chat.welcome_title')}</h2>
          <p>{t('chat.welcome_subtitle')}</p>
        </div>
      </div>
    );
  }

  const isOnline = getOnlineStatus();

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-info">
          <button 
            className="mobile-back-button"
            onClick={() => selectConversation(null)}
            aria-label="Back to conversations"
          >
            ←
          </button>
          <div className="chat-info-text">
            <h3>{getConversationTitle()}</h3>
            {isOnline !== null && (
              <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}>
                {isOnline ? t('chat.online') : t('chat.offline')}
              </span>
            )}
          </div>
        </div>

        {selectedConversation && !selectedConversation.is_group && (
            <button 
                className="call-button"
                onClick={() => {
                    const otherUser = selectedConversation.participants?.find(p => p.id !== user.id);
                    if (otherUser) {
                        startCall(otherUser.id, otherUser.username);
                    }
                }}
                title={t('chat.start_call', 'Call')}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    marginLeft: 'auto',
                    padding: '8px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-primary)',
                    transition: 'background-color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-bg)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
            </button>
        )}

      </div>

      <div className="messages-container">
        {conversationMessages.length === 0 ? (
          <div className="no-messages">
            <p>{t('chat.no_messages')}</p>
          </div>
        ) : (
          conversationMessages.map((message) => (
            <div
              key={message.id}
              className={`message ${
                message.sender_id === user.id ? 'message-sent' : 'message-received'
              }`}
            >
              <div className="message-content">
                {message.sender_id !== user.id && (
                  <div className="message-sender">{message.sender_username}</div>
                )}
                {message.file_path && !message.is_deleted && (
                  <div className="message-attachment">
                    {message.file_type === 'image' ? (
                      <img 
                        src={filesAPI.getFileUrl(message.file_path.split('\\').pop().split('/').pop())} 
                        alt={t('chat.attachment')} 
                        className="attachment-image" 
                      />
                    ) : (
                      <div className="attachment-file">
                        <a 
                          href={filesAPI.getFileUrl(message.file_path.split('\\').pop().split('/').pop())}
                          target="_blank" 
                          rel="noopener noreferrer"
                        >
                          📄 {message.file_path.split('\\').pop().split('/').pop()}
                        </a>
                      </div>
                    )}
                  </div>
                )}
                {/* <div className="message-text">{textToEmoji(message.content)}</div> */}
                <div className="message-text">{formatMessageContent(message.content)}</div>
                <div className="message-time">
                  {formatTime(message.created_at)}
                  {message.sender_id === user.id && (
                    <span className="read-receipt" style={{ marginLeft: '4px', fontSize: '0.8em' }}>
                      {!message.id ? '' : (message.is_read ? '✓✓' : '✓')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="message-input-container" onSubmit={handleSubmit}>
        <div className="attachment-button-wrapper">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="attachment-button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('chat.attach_file')}
            title={t('chat.attach_file')}
          >
            <svg viewBox="0 0 24 24" fill="none" class="paperclip-icon" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
        </div>
        <div className="emoji-picker-wrapper" ref={emojiPickerRef}>
            <button
              type="button"
              className="emoji-button"
              onClick={() => setIsEmojiPickerOpen((prev) => !prev)}
              aria-label={t('chat.toggle_emoji')}
            >
              😊
            </button>
            {isEmojiPickerOpen && (
              <div className="emoji-picker">
                <Picker data={data} onEmojiSelect={handleEmojiSelect} theme="light" previewPosition="none" />
              </div>
            )}
        </div>
        <div className="input-field-wrapper" style={{ flex: 1, position: 'relative' }}>
          {selectedFile && (
            <div className="selected-file-preview">
              <span>{selectedFile.name}</span>
              <button type="button" onClick={clearFile} className="clear-file-btn">×</button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={uploading ? t('chat.uploading') : t('chat.type_message')}
            maxLength={5000}
            className="message-input"
            disabled={uploading}
            rows={1}
          />
        </div>
        <button type="submit" className="send-button" disabled={(!inputValue.trim() && !selectedFile) || uploading}>
          {uploading ? '...' : t('chat.send')}
        </button>
      </form>
    </div>
  );
};
