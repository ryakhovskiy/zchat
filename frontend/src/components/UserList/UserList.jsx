import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';
import { Avatar } from '../Common/Avatar';
import { Icon } from '../Common/Icon';
import { Sheet } from '../Common/Sheet';
import './UserList.css';

/** "New conversation" picker: tall bottom sheet on phones, centred modal from 768px. */
export const UserList = ({ open, onClose }) => {
  const { t } = useTranslation();
  const { users, createConversation } = useChat();
  const { user: currentUser } = useAuth();
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [isGroup, setIsGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const typeRefs = useRef([]);

  // Start fresh every time the picker opens
  useEffect(() => {
    if (open) {
      setSelectedUsers([]);
      setIsGroup(false);
      setGroupName('');
      setError('');
    }
  }, [open]);

  const otherUsers = users.filter((u) => u.id !== currentUser.id);

  const setType = (group) => {
    setIsGroup(group);
    setError('');
    // A direct message holds exactly one person
    if (!group) setSelectedUsers((prev) => prev.slice(0, 1));
  };

  const onTypeKeyDown = (e) => {
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const next = !isGroup;
      setType(next);
      typeRefs.current[next ? 1 : 0]?.focus();
    }
  };

  const toggleUser = (userId) => {
    setError('');
    if (!isGroup) {
      setSelectedUsers([userId]);
      return;
    }
    setSelectedUsers((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const handleCreate = async () => {
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
    } catch {
      setError(t('user_list.create_failed'));
    } finally {
      setLoading(false);
    }
  };

  const footer = (
    <>
      <button type="button" className="btn-secondary" onClick={onClose}>
        {t('user_list.cancel')}
      </button>
      <button
        type="button"
        className="btn-primary"
        onClick={handleCreate}
        disabled={loading || selectedUsers.length === 0}
        data-testid="create-conversation"
      >
        {loading ? t('user_list.creating') : t('user_list.create')}
      </button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('user_list.new_conversation')}
      size="tall"
      footer={footer}
      testId="user-list"
      className="user-list-modal"
    >
      {error && <div className="error-message" role="alert"><Icon name="alert" size={20} /><span>{error}</span></div>}

      <div className="conversation-type-toggle segmented" role="radiogroup" aria-label={t('user_list.new_conversation')} onKeyDown={onTypeKeyDown}>
        {[false, true].map((group, i) => (
          <button
            key={String(group)}
            ref={(el) => { typeRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={isGroup === group}
            tabIndex={isGroup === group ? 0 : -1}
            className={`segmented-option ${isGroup === group ? 'segmented-option--checked' : ''}`}
            onClick={() => setType(group)}
            data-testid={group ? 'type-group' : 'type-direct'}
          >
            {group ? t('user_list.group_chat') : t('user_list.direct_message')}
          </button>
        ))}
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
            autoComplete="off"
          />
        </div>
      )}

      <h3 className="user-list-heading" id="user-list-heading">
        {isGroup ? t('user_list.select_user_multi') : t('user_list.select_user_single')}{' '}
        <span className="user-list-count">({t('user_list.selected_count', { count: selectedUsers.length })})</span>
      </h3>

      {otherUsers.length === 0 ? (
        <p className="user-list-empty">{t('user_list.no_users')}</p>
      ) : (
        <div className="users-grid" role="listbox" aria-labelledby="user-list-heading" aria-multiselectable={isGroup}>
          {otherUsers.map((u) => {
            const selected = selectedUsers.includes(u.id);
            return (
              <button
                key={u.id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`user-item ${selected ? 'selected' : ''}`}
                onClick={() => toggleUser(u.id)}
                data-testid="user-item"
              >
                <Avatar name={u.username} size="md" online={!!u.is_online} />
                <span className="user-info">
                  <span className="user-name">{u.username}</span>
                  <span className={`user-status ${u.is_online ? 'online' : 'offline'}`}>
                    {u.is_online ? t('chat.online') : t('chat.offline')}
                  </span>
                </span>
                <span className={`checkbox ${selected ? 'checkbox--checked' : ''}`} aria-hidden="true">
                  {selected && <Icon name="check" size={16} />}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
};
