import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { conversationsAPI, usersAPI } from '../services/api';

const ChatContext = createContext(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return context;
};

export const ChatProvider = ({ children }) => {
  const { wsClient, user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [users, setUsers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState({});
  const [loading, setLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    if (user) {
      loadConversations();
      loadUsers();
    }
  }, [user]);

  // Setup WebSocket listeners
  useEffect(() => {
    if (!wsClient) return;

    const handleMessage = (data) => {
      setMessages((prev) => ({
        ...prev,
        [data.conversation_id]: [
          ...(prev[data.conversation_id] || []),
          {
            id: data.message_id,
            content: data.content,
            sender_id: data.sender_id,
            sender_username: data.sender_username,
            conversation_id: data.conversation_id,
            created_at: data.timestamp,
          },
        ],
      }));

      // Update conversation's last message
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === data.conversation_id
            ? { ...conv, updated_at: data.timestamp }
            : conv
        )
      );
    };

    const handleUserOnline = (data) => {
      setOnlineUsers((prev) => {
        if (!prev.some((u) => u.id === data.user_id)) {
          return [...prev, { id: data.user_id, username: data.username }];
        }
        return prev;
      });

      setUsers((prev) =>
        prev.map((u) =>
          u.id === data.user_id ? { ...u, is_online: true } : u
        )
      );
    };

    const handleUserOffline = (data) => {
      setOnlineUsers((prev) => prev.filter((u) => u.id !== data.user_id));

      setUsers((prev) =>
        prev.map((u) =>
          u.id === data.user_id ? { ...u, is_online: false } : u
        )
      );
    };

    wsClient.on('message', handleMessage);
    wsClient.on('user_online', handleUserOnline);
    wsClient.on('user_offline', handleUserOffline);

    return () => {
      wsClient.off('message', handleMessage);
      wsClient.off('user_online', handleUserOnline);
      wsClient.off('user_offline', handleUserOffline);
    };
  }, [wsClient]);

  const loadConversations = async () => {
    try {
      setLoading(true);
      const response = await conversationsAPI.getAll();
      setConversations(response.data);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await usersAPI.getAll();
      const allUsers = response.data;
      setUsers(allUsers);
      // Filter online users from the list
      setOnlineUsers(allUsers.filter(u => u.is_online));
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const loadMessages = async (conversationId) => {
    if (messages[conversationId]) return; // Already loaded

    try {
      const response = await conversationsAPI.getMessages(conversationId);
      setMessages((prev) => ({
        ...prev,
        [conversationId]: response.data,
      }));
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const createConversation = async (participantIds, isGroup = false, name = null) => {
    try {
      const response = await conversationsAPI.create({
        participant_ids: participantIds,
        is_group: isGroup,
        name,
      });
      
      const newConversation = response.data;
      setConversations((prev) => [...prev, newConversation]);
      setSelectedConversation(newConversation);
      
      return newConversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      throw error;
    }
  };

  const sendMessage = (conversationId, content) => {
    if (!wsClient || !content.trim()) return;

    wsClient.send({
      type: 'message',
      conversation_id: conversationId,
      content: content.trim(),
    });
  };

  const selectConversation = async (conversation) => {
    setSelectedConversation(conversation);
    await loadMessages(conversation.id);
  };

  const value = {
    conversations,
    users,
    onlineUsers,
    selectedConversation,
    messages,
    loading,
    loadConversations,
    createConversation,
    sendMessage,
    selectConversation,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};