import React, { useState } from 'react';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import './UserList.css';

export const UserList = ({ onClose }) => {
  const { users, createConversation } = useChat();
  const { user: currentUser } = useAuth();
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [isGroup, setIsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const otherUsers = users.filter((u) => u.id !== currentUser.id);

  const toggleUserSelection = (userId) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleCreateConversation = async () => {
    if (selectedUsers.length === 0) {
      setError('Please select at least one user');
      return;
    }

    if (isGroup && selectedUsers.length < 2) {
      setError('Group chats need at least 2 other users');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await createConversation(selectedUsers, isGroup, groupName || null);
      onClose();
    } catch (err) {
      setError('Failed to create conversation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="user-list-overlay" onClick={onClose}>
      <div className="user-list-modal" onClick={(e) => e.stopPropagation()}>
        <div className="user-list-header">
          <h2>New Conversation</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="conversation-type-toggle">
          <label className="toggle-option">
            <input
              type="radio"
              checked={!isGroup}
              onChange={() => setIsGroup(false)}
            />
            <span>Direct Message</span>
          </label>
          <label className="toggle-option">
            <input
              type="radio"
              checked={isGroup}
              onChange={() => setIsGroup(true)}
            />
            <span>Group Chat</span>
          </label>
        </div>

        {isGroup && (
          <div className="form-group">
            <label htmlFor="groupName">Group Name (optional)</label>
            <input
              type="text"
              id="groupName"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Enter group name..."
              maxLength={100}
            />
          </div>
        )}

        <div className="user-list-content">
          <h3>
            Select {isGroup ? 'users' : 'a user'} ({selectedUsers.length} selected)
          </h3>
          <div className="users-grid">
            {otherUsers.map((user) => (
              <div
                key={user.id}
                className={`user-item ${
                  selectedUsers.includes(user.id) ? 'selected' : ''
                }`}
                onClick={() => {
                  if (!isGroup) {
                    setSelectedUsers([user.id]);
                  } else {
                    toggleUserSelection(user.id);
                  }
                }}
              >
                <div className="user-avatar">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div className="user-info">
                  <div className="user-name">{user.username}</div>
                  <div className={`user-status ${user.is_online ? 'online' : 'offline'}`}>
                    {user.is_online ? 'Online' : 'Offline'}
                  </div>
                </div>
                {(isGroup || selectedUsers.includes(user.id)) && (
                  <div className="checkbox">
                    {selectedUsers.includes(user.id) ? '✓' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="user-list-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreateConversation}
            disabled={loading || selectedUsers.length === 0}
          >
            {loading ? 'Creating...' : 'Create Conversation'}
          </button>
        </div>
      </div>
    </div>
  );
};