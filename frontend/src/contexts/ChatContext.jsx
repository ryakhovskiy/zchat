import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [messages, setMessages] = useState({});
  const [loading, setLoading] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState({});
  
  // Ref to track selected conversation ID for use in WebSocket handler
  const selectedConversationRef = useRef(null);
  
  // Keep ref in sync with state
  useEffect(() => {
    selectedConversationRef.current = selectedConversation?.id || null;
  }, [selectedConversation]);

  // Load initial data
  useEffect(() => {
    if (user) {
      loadConversations();
      loadUsers();
    }
  }, [user]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Handle window focus to clear unread counts for active chat
  useEffect(() => {
    const handleFocus = async () => {
      if (selectedConversationRef.current) {
        // Clear local count
        setUnreadCounts((prev) => ({
          ...prev,
          [selectedConversationRef.current]: 0
        }));
        
        // Mark as read on backend
        try {
          await conversationsAPI.markAsRead(selectedConversationRef.current);
        } catch (error) {
          console.error('Failed to mark as read on focus:', error);
        }
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

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
            file_path: data.file_path,
            file_type: data.file_type,
            is_deleted: data.is_deleted,
          },
        ],
      }));

      // Update conversation's last message and updated_at
      setConversations((prev) =>
        prev.map((conv) =>
          conv.id === data.conversation_id
            ? {
                ...conv,
                updated_at: data.timestamp,
                last_message: {
                  content: data.content,
                  sender_id: data.sender_id,
                },
              }
            : conv
        )
      );

      // Increment unread count only if message is not in currently selected conversation OR if window is not focused
      // We check for window focus. If not focused, we increment even if it matches selectedConversation
      const isChatActive = data.conversation_id === selectedConversationRef.current;
      const isWindowFocused = document.hasFocus();

      if (!isChatActive || !isWindowFocused) {
        setUnreadCounts((prev) => ({
          ...prev,
          [data.conversation_id]: (prev[data.conversation_id] || 0) + 1,
        }));

        // Send push notification
        if ('Notification' in window && Notification.permission === 'granted' && data.sender_id !== user.id) {
          const notificationTitle = `New message from ${data.sender_username}`;
          const notificationOptions = {
            body: data.file_path ? (data.file_type === 'image' ? 'Sent an image' : 'Sent a file') : data.content,
            icon: '/vite.svg', // Default vite icon, can be replaced with app logo
            tag: `conversation-${data.conversation_id}` // Group notifications by conversation
          };
          
          const notification = new Notification(notificationTitle, notificationOptions);
          
          notification.onclick = () => {
            window.focus();
            // Optional: Logic to select the conversation if we could access selectConversation here
            // Since we're inside the effect, we might not want to close over too much state/dispatch
          };
        }
      }
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

    const handleMessageEdited = (data) => {
      setMessages((prev) => {
        const convMessages = prev[data.conversation_id] || [];
        return {
          ...prev,
          [data.conversation_id]: convMessages.map((msg) =>
            msg.id === data.message_id
              ? { ...msg, content: data.content, is_edited: true }
              : msg
          ),
        };
      });
    };

    const handleMessageDeleted = (data) => {
      setMessages((prev) => {
        const convMessages = prev[data.conversation_id] || [];
        if (data.delete_type === 'for_everyone') {
          return {
            ...prev,
            [data.conversation_id]: convMessages.map((msg) =>
              msg.id === data.message_id ? { ...msg, is_deleted: true, content: '' } : msg
            ),
          };
        } else {
          // for_me: remove from local list entirely
          return {
            ...prev,
            [data.conversation_id]: convMessages.filter((msg) => msg.id !== data.message_id),
          };
        }
      });
    };

    wsClient.on('message_edited', handleMessageEdited);
    wsClient.on('message_deleted', handleMessageDeleted);

    return () => {
      wsClient.off('message', handleMessage);
      wsClient.off('user_online', handleUserOnline);
      wsClient.off('user_offline', handleUserOffline);
      wsClient.off('message_edited', handleMessageEdited);
      wsClient.off('message_deleted', handleMessageDeleted);
    };
  }, [wsClient]);

  const loadConversations = async () => {
    try {
      setLoading(true);
      const response = await conversationsAPI.getAll();
      setConversations(response.data);
      
      // Initialize unread counts from backend data
      const counts = {};
      response.data.forEach((conv) => {
        if (conv.unread_count > 0) {
          counts[conv.id] = conv.unread_count;
        }
      });
      setUnreadCounts(counts);
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

  const sendMessage = (conversationId, content, fileData = null) => {
    if (!wsClient) return;
    if (!content && !fileData) return;

    const message = {
      type: 'message',
      conversation_id: conversationId,
      content: content ? content.trim() : (fileData ? 'File attachment' : ''),
    };

    if (fileData) {
      message.file_path = fileData.file_path;
      message.file_type = fileData.file_type;
    }

    wsClient.send(message);
  };

  const editMessage = (messageId, content) => {
    if (!wsClient) return;
    wsClient.send({ type: 'edit_message', message_id: messageId, content });
  };

  const deleteMessage = (messageId, deleteType) => {
    if (!wsClient) return;
    wsClient.send({ type: 'delete_message', message_id: messageId, delete_type: deleteType });
  };

  const selectConversation = async (conversation) => {
    // If opening a conversation, close the browser
    if (conversation) {
      setIsBrowserOpen(false);
    }
    
    setSelectedConversation(conversation);
    
    if (!conversation) return;

    // Reset unread count for this conversation locally
    setUnreadCounts((prev) => ({
      ...prev,
      [conversation.id]: 0,
    }));
    await loadMessages(conversation.id);
    
    // Mark conversation as read on the backend
    try {
      await conversationsAPI.markAsRead(conversation.id);
    } catch (error) {
      console.error('Failed to mark conversation as read:', error);
    }
  };

  const value = {
    conversations,
    users,
    onlineUsers,
    selectedConversation,
    isBrowserOpen,
    setIsBrowserOpen,
    messages,
    loading,
    unreadCounts,
    loadConversations,
    createConversation,
    sendMessage,
    editMessage,
    deleteMessage,
    selectConversation,
    setMessages, 
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};