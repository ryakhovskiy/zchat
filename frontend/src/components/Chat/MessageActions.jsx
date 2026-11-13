import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Common/Icon';
import { Sheet } from '../Common/Sheet';
import './MessageActions.css';

// 5 + the "more" button = 6 x 44px targets, which fits the 286px body of a 320px sheet
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏'];

/**
 * Actions for one message. Touch (long-press) opens a bottom action sheet with quick reactions;
 * mouse (right-click or the hover "more" button) opens a small context menu at the pointer.
 *
 * target: { message, x, y, via: 'touch' | 'mouse', isMine }
 */
export const MessageActions = ({ target, onClose, onReply, onCopy, onEdit, onDelete, onReact, onMoreReactions }) => {
  const { t } = useTranslation();
  if (!target) return null;
  const { message, isMine, via } = target;
  const hasText = !!message.content;

  const run = (fn) => () => {
    onClose();
    fn();
  };

  const items = [
    { key: 'react', icon: 'smile', label: t('chat.react_to_message', 'React'), onClick: run(onMoreReactions), hideOnTouch: true },
    { key: 'reply', icon: 'reply', label: t('chat.reply_message', 'Reply'), onClick: run(onReply) },
    hasText && { key: 'copy', icon: 'copy', label: t('chat.copy'), onClick: run(onCopy) },
    isMine && { key: 'edit', icon: 'edit', label: t('chat.edit_message', 'Edit'), onClick: run(onEdit) },
    { key: 'delete-me', icon: 'trash', label: t('chat.delete_for_me', 'Delete for me'), onClick: run(() => onDelete('for_me')) },
    isMine && { key: 'delete-all', icon: 'trash', danger: true, label: t('chat.delete_for_everyone', 'Delete for everyone'), onClick: run(() => onDelete('for_everyone')) },
  ].filter(Boolean);

  if (via === 'touch') {
    return (
      <Sheet open onClose={onClose} title={t('chat.message_actions')} testId="message-action-sheet">
        <div className="quick-reactions" role="group" aria-label={t('chat.react_to_message', 'React')}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="quick-reaction"
              onClick={run(() => onReact(emoji))}
              aria-label={emoji}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            className="quick-reaction quick-reaction--more"
            onClick={run(onMoreReactions)}
            aria-label={t('chat.more_reactions')}
          >
            <Icon name="plus" />
          </button>
        </div>
        <ul className="action-list">
          {items.filter((item) => !item.hideOnTouch).map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className={`action-item ${item.danger ? 'action-item--danger' : ''}`}
                onClick={item.onClick}
                data-testid={`action-${item.key}`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }

  return <ContextMenu target={target} items={items} onClose={onClose} />;
};

const ContextMenu = ({ target, items, onClose }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: target.x, top: target.y });

  // Keep the menu inside the viewport
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(target.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(target.y, window.innerHeight - height - 8)),
    });
  }, [target.x, target.y]);

  useEffect(() => {
    const first = ref.current?.querySelector('button');
    first?.focus({ preventScroll: true });

    const onPointerDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKeyDown = (e) => {
      const buttons = [...(ref.current?.querySelectorAll('button') || [])];
      const index = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        buttons[(index + step + buttons.length) % buttons.length]?.focus();
      } else if (e.key === 'Tab') {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="message-context-menu"
      role="menu"
      style={pos}
      data-testid="message-context-menu"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={`context-menu-item ${item.danger ? 'context-menu-item--danger' : ''}`}
          onClick={item.onClick}
          data-testid={`action-${item.key}`}
        >
          <Icon name={item.icon} size={18} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};
