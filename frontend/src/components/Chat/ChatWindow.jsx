import React, { useState, useEffect, useRef } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import './Chat.css';

export const ChatWindow = () => {
  const { selectedConversation, messages, sendMessage } = useChat();
  const { user } = useAuth();
  const [inputValue, setInputValue] = useState('');
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const emojiPickerRef = useRef(null);

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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputValue.trim() || !selectedConversation) return;

    sendMessage(selectedConversation.id, inputValue);
    setInputValue('');
    setIsEmojiPickerOpen(false);
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
      return selectedConversation.name || 'Group Chat';
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
          <h2>Welcome to Chat</h2>
          <p>Select a conversation or start a new one to begin messaging</p>
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
              {isOnline ? 'Online' : 'Offline'}
            </span>
          )}
        </div>
      </div>

      <div className="messages-container">
        {conversationMessages.length === 0 ? (
          <div className="no-messages">
            <p>No messages yet. Start the conversation!</p>
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
                <div className="message-text">{message.content}</div>
                <div className="message-time">{formatTime(message.created_at)}</div>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="message-input-container" onSubmit={handleSubmit}>
        <div className="emoji-picker-wrapper" ref={emojiPickerRef}>
            <button
              type="button"
              className="emoji-button"
              onClick={() => setIsEmojiPickerOpen((prev) => !prev)}
              aria-label="Toggle emoji picker"
            >
              😊
            </button>
            {isEmojiPickerOpen && (
              <div className="emoji-picker">
                <Picker data={data} onEmojiSelect={handleEmojiSelect} theme="light" previewPosition="none" />
              </div>
            )}
        </div>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type a message..."
          maxLength={5000}
          className="message-input"
        />
        <button type="submit" className="send-button" disabled={!inputValue.trim()}>
          Send
        </button>
      </form>
    </div>
  );
};