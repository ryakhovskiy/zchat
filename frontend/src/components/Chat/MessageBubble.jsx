import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { textToEmoji, LINK_PATTERN, isLink } from '../../utils/emojiUtils';
import { hueFromName } from '../../utils/avatar';
import { filesAPI } from '../../services/api';
import { useMessageGestures } from '../../hooks/useMessageGestures';
import { Icon } from '../Common/Icon';

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

const baseName = (path) => path.split('\\').pop().split('/').pop();

export const getAttachments = (msg) => {
  if (msg.attachments && msg.attachments.length > 0) return msg.attachments;
  if (msg.file_path) {
    const fileName = baseName(msg.file_path);
    const ext = fileName.split('.').pop().toLowerCase();
    return [{
      file_path: msg.file_path,
      file_type: msg.file_type || (IMAGE_EXTENSIONS.includes(ext) ? 'image' : VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'file'),
      original_name: fileName,
      file_size: null,
    }];
  }
  return [];
};

const formatBytes = (bytes, decimals = 1) => {
  if (!bytes || +bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
};

const MessageText = ({ content }) => {
  if (!content) return null;
  // Split by links (http, https, tg), keeping the links themselves
  return content.split(LINK_PATTERN).map((part, index) => {
    if (isLink(part)) {
      return (
        <a
          key={index}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="message-link"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return <span key={index}>{textToEmoji(part)}</span>;
  });
};

const Attachments = ({ message, onImageClick }) => {
  const { t } = useTranslation();
  const attachments = getAttachments(message);
  if (attachments.length === 0 || message.is_deleted) return null;

  return (
    <div className="message-attachments">
      {attachments.map((att, i) => {
        const fileName = att.original_name || baseName(att.file_path);
        const fileUrl = filesAPI.getFileUrl(baseName(att.file_path));
        return (
          <div key={att.id || i} className="message-attachment">
            {att.file_type === 'image' ? (
              <button
                type="button"
                className="attachment-image-btn"
                onClick={(e) => { e.stopPropagation(); onImageClick({ url: fileUrl, name: fileName }); }}
                aria-label={`${t('chat.open_image')}: ${fileName}`}
              >
                <img src={fileUrl} alt={t('chat.attachment')} className="attachment-image" loading="lazy" />
              </button>
            ) : att.file_type === 'video' ? (
              <video
                src={fileUrl}
                className="attachment-video"
                controls
                preload="metadata"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="attachment-file">
                <a href={fileUrl} target="_blank" rel="noopener noreferrer" download>
                  <Icon name="file" size={20} />
                  <span className="attachment-name">{fileName}</span>
                  {att.file_size ? <span className="attachment-size">{formatBytes(att.file_size)}</span> : null}
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * One message. `continuesPrev` / `continuesNext` say whether the previous / next message is
 * from the same sender close in time, which tightens spacing and rounds the bubble stack.
 */
export const MessageBubble = ({
  message,
  isMine,
  senderName,
  showSender,
  replied,
  continuesPrev,
  continuesNext,
  coarse,
  currentUserId,
  locale,
  onOpenActions,
  onSwipeReply,
  onImageClick,
  onReact,
}) => {
  const { t } = useTranslation();
  const deleted = !!message.is_deleted;

  const open = useCallback(
    (point) => onOpenActions(message, point),
    [onOpenActions, message]
  );
  const gestures = useMessageGestures({
    onOpenActions: open,
    onSwipeReply: () => onSwipeReply(message),
    coarse,
  });

  const time = new Date(message.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const handlers = deleted ? {} : gestures.handlers;

  return (
    <div
      ref={gestures.ref}
      className={[
        'message',
        isMine ? 'message-sent' : 'message-received',
        continuesPrev && 'message--continues',
        continuesNext && 'message--continued',
        deleted && 'message--deleted',
      ].filter(Boolean).join(' ')}
      data-testid="message"
      data-message-id={message.id}
      {...handlers}
    >
      <div className="message-content">
        {showSender && (
          <div className="message-sender" style={{ '--sender-hue': hueFromName(senderName) }}>
            {senderName}
          </div>
        )}

        {replied && (
          <div className="message-replied-to">
            <span className="replied-sender">{replied.sender_username || t('chat.unknown_user', 'Unknown')}</span>
            <span className="replied-text">{replied.content || t('chat.attachment', 'Attachment')}</span>
          </div>
        )}

        <Attachments message={message} onImageClick={onImageClick} />

        <div className="message-text">
          {deleted
            ? <em className="message-deleted-text">{t('chat.message_deleted', 'Message deleted')}</em>
            : <MessageText content={message.content} />}
        </div>

        <div className="message-time">
          <span>{time}</span>
          {message.is_edited && !deleted && (
            <span className="message-edited-label">{t('chat.edited', 'edited')}</span>
          )}
          {isMine && message.id && !deleted && (
            <span
              className={`read-receipt ${message.is_read ? 'read-receipt--read' : ''}`}
              role="img"
              aria-label={message.is_read ? t('chat.status_read') : t('chat.status_sent')}
            >
              <Icon name={message.is_read ? 'check-double' : 'check'} size={14} />
            </span>
          )}
        </div>

        {!deleted && message.reactions && message.reactions.length > 0 && (
          <div className="message-reactions">
            {message.reactions.map((r) => {
              const mine = r.user_ids?.includes(currentUserId);
              return (
                <button
                  key={r.emoji}
                  type="button"
                  className={`reaction-chip ${mine ? 'reaction-chip--mine' : ''}`}
                  aria-pressed={!!mine}
                  onClick={(e) => { e.stopPropagation(); onReact(message, r.emoji); }}
                  title={mine ? t('chat.remove_reaction', 'Remove reaction') : t('chat.add_reaction', 'Add reaction')}
                >
                  <span>{r.emoji}</span>
                  <span className="reaction-count">{r.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!deleted && (
        <button
          type="button"
          className="message-more-btn"
          aria-label={t('chat.message_actions')}
          data-testid="message-more"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            open({ x: rect.left, y: rect.bottom + 4, via: 'mouse' });
          }}
        >
          <Icon name="more" size={20} />
        </button>
      )}
    </div>
  );
};
