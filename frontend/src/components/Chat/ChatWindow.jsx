import React, { useState, useEffect, useRef } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { textToEmoji } from '../../utils/emojiUtils';
import { filesAPI } from '../../services/api';
import './Chat.css';

export const ChatWindow = () => {
  const { t } = useTranslation();
  const { selectedConversation, messages, sendMessage } = useChat();
  const { user } = useAuth();
  const [inputValue, setInputValue] = useState('');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const messagesEndRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const fileInputRef = useRef(null);

  const conversationMessages = selectedConversation
    ? messages[selectedConversation.id] || []
    : [];

  useEffect(() => {
    scrollToBottom();
  }, [conversationMessages]);

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
          <h3>{getConversationTitle()}</h3>
          {isOnline !== null && (
            <span className={`status-indicator ${isOnline ? 'online' : 'offline'}`}>
              {isOnline ? t('chat.online') : t('chat.offline')}
            </span>
          )}
        </div>
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
                <div className="message-text">{textToEmoji(message.content)}</div>
                <div className="message-time">{formatTime(message.created_at)}</div>
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
          >
            📎
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
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={uploading ? t('chat.uploading') : t('chat.type_message')}
            maxLength={5000}
            className="message-input"
            disabled={uploading}
          />
        </div>
        <button type="submit" className="send-button" disabled={(!inputValue.trim() && !selectedFile) || uploading}>
          {uploading ? '...' : t('chat.send')}
        </button>
      </form>
    </div>
  );
};
