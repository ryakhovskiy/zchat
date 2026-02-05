import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import './UserList.css';

export const UserList = ({ onClose }) => {
  const { t } = useTranslation();
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
      setError(t('user_list.error_select_one'));
      return;
    }

    if (isGroup && selectedUsers.length < 2) {
      setError(t('user_list.error_group_min'));
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
          <h2>{t('user_list.new_conversation')}</h2>
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
            <span>{t('user_list.direct_message')}</span>
          </label>
          <label className="toggle-option">
            <input
              type="radio"
              checked={isGroup}
              onChange={() => setIsGroup(true)}
            />
            <span>{t('user_list.group_chat')}</span>
          </label>
        </div>

        {isGroup && (
          <div className="form-group">
            <label htmlFor="groupName">{t('user_list.group_name_label')}</label>
            <input
              type="text"
              id="groupName"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t('user_list.group_name_placeholder')}
              maxLength={100}
            />
          </div>
        )}

        <div className="user-list-content">
          <h3>
            {isGroup ? t('user_list.select_user_multi') : t('user_list.select_user_single')} ({t('user_list.selected_count', { count: selectedUsers.length })})
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
                    {user.is_online ? t('chat.online') : t('chat.offline')}
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
            {t('user_list.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={handleCreateConversation}
            disabled={loading || selectedUsers.length === 0}
          >
            {loading ? t('user_list.creating') : t('user_list.create')}
          </button>
        </div>
      </div>
    </div>
  );
};