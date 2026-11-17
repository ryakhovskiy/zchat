import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChat } from '../../contexts/ChatContext';
import { filesAPI } from '../../services/api';
import { useCoarsePointer, useIsPhone } from '../../hooks/useMediaQuery';
import { Icon } from '../Common/Icon';
import { Sheet } from '../Common/Sheet';
import { EmojiPicker } from './EmojiPicker';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_LINES = 5;
const FORBIDDEN_EXTENSIONS = [
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.cgi', '.jar', '.js', '.vbs',
  '.ps1', '.py', '.php', '.msi', '.com', '.scr', '.pif', '.reg', '.app',
  '.bin', '.wsf', '.vb', '.iso', '.dmg', '.pkg',
];

/**
 * Message composer: auto-growing textarea (max ~5 lines, 16px so iOS doesn't zoom), attach,
 * emoji, send, plus reply / edit banners and an inline error state. Exposes focus() and
 * addFile() (used by drag & drop in the parent).
 */
export const Composer = forwardRef(({ conversation, replyingTo, editing, onCancelReply, onCancelEdit, onNotify }, ref) => {
  const { t } = useTranslation();
  const { sendMessage, editMessage } = useChat();
  const isPhone = useIsPhone();
  const coarse = useCoarsePointer();

  const [value, setValue] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [emojiOpen, setEmojiOpen] = useState(false);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiWrapRef = useRef(null);
  // Sends finish asynchronously (upload, REST fallback). Their cleanup must only touch the chat and
  // the exact draft/file that started them, never a different chat opened in the meantime.
  const conversationIdRef = useRef(conversation.id);
  const valueRef = useRef('');
  const fileRef = useRef(null);
  const pendingChats = useRef(new Set());

  const clearFile = () => {
    setFile(null);
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addFile = (picked) => {
    if (!picked) return;
    if (picked.size > MAX_FILE_SIZE) {
      setError(t('chat.file_too_large'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const ext = `.${picked.name.split('.').pop().toLowerCase()}`;
    if (FORBIDDEN_EXTENSIONS.includes(ext)) {
      setError(t('chat.file_type_not_allowed'));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setError('');
    setFile(picked);
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return picked.type.startsWith('image/') ? URL.createObjectURL(picked) : null;
    });
  };

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    addFile,
  }));

  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    fileRef.current = file;
  }, [file]);

  // Reset per-conversation state when switching chats
  useEffect(() => {
    conversationIdRef.current = conversation.id;
    setValue('');
    setError('');
    setEmojiOpen(false);
    setUploading(false);
    setProgress(0);
    clearFile();
  }, [conversation.id]);

  // Entering edit mode loads the message text into the box
  useEffect(() => {
    if (editing) {
      setValue(editing.content || '');
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [editing]);

  // Replying focuses the box so the keyboard is ready
  useEffect(() => {
    if (replyingTo) setTimeout(() => textareaRef.current?.focus(), 0);
  }, [replyingTo]);

  // Auto-grow up to MAX_LINES
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 24;
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * MAX_LINES + padding)}px`;
  }, [value]);

  // Close the desktop emoji popover on outside click
  useEffect(() => {
    if (!emojiOpen || isPhone) return undefined;
    const onDown = (e) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target)) setEmojiOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [emojiOpen, isPhone]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const canSend = (value.trim() || file) && !uploading;

  const submit = async (e) => {
    e?.preventDefault();
    if (!canSend) return;
    setError('');

    if (editing) {
      if (!value.trim()) return;
      editMessage(editing.id, value.trim());
      setValue('');
      onCancelEdit();
      return;
    }

    const chatId = conversation.id;
    if (pendingChats.current.has(chatId)) return; // already sending in this chat: no duplicates
    const sentValue = value;
    const sentFile = file;
    const sentReplyId = replyingTo?.id;
    const stillHere = () => conversationIdRef.current === chatId;

    pendingChats.current.add(chatId);
    try {
      let fileData = null;
      if (sentFile) {
        setUploading(true);
        setProgress(0);
        const response = await filesAPI.upload(sentFile, (event) => {
          if (event.total && stillHere()) setProgress(Math.round((event.loaded * 100) / event.total));
        });
        fileData = response.data;
        if (stillHere()) {
          setUploading(false);
          setProgress(0);
        }
      }
      await sendMessage(chatId, sentValue, fileData, sentReplyId);
      if (stillHere()) {
        // Clear only what was sent: text typed or files picked meanwhile must survive
        if (valueRef.current === sentValue) setValue('');
        if (fileRef.current === sentFile) clearFile();
        onCancelReply(sentReplyId);
        setEmojiOpen(false);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      let message = t('chat.failed_to_send');
      if (err.response) {
        if (err.response.data?.detail) message = err.response.data.detail;
        else if (err.response.status === 413) message = t('chat.file_too_large');
      } else if (err.request) {
        message = t('chat.network_error');
      }
      if (stillHere()) {
        setUploading(false);
        setProgress(0);
        // The text stays in the box so the user can simply retry
        setError(message);
      } else {
        onNotify?.(message); // the user already left that chat: don't show its error in another one
      }
    } finally {
      pendingChats.current.delete(chatId);
    }
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return;
    // Touch keyboards: Enter inserts a newline (the Send button sends). Hardware keyboards: Enter sends.
    if (coarse) return;
    e.preventDefault();
    submit(e);
  };

  const onPaste = (e) => {
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        addFile(item.getAsFile());
        return;
      }
    }
  };

  const insertEmoji = (emoji) => {
    if (!emoji?.native) return;
    setValue((prev) => `${prev}${emoji.native}`);
    setEmojiOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <form className="message-input-container composer" onSubmit={submit} data-testid="composer">
      {error && (
        <div className="composer-error" role="alert" data-testid="composer-error">
          <Icon name="alert" size={20} />
          <div className="composer-error-text">
            <span>{error}</span>
            {!file && value && <small>{t('chat.send_failed_hint')}</small>}
          </div>
          <button type="button" className="icon-btn" onClick={() => setError('')} aria-label={t('common.dismiss')}>
            <Icon name="close" size={20} />
          </button>
        </div>
      )}

      {editing && (
        <div className="composer-banner edit-mode-banner" data-testid="edit-banner">
          <Icon name="edit" size={18} />
          <span className="composer-banner-text">{t('chat.editing_message', 'Editing message')}</span>
          <button type="button" className="icon-btn cancel-edit-btn" onClick={() => { setValue(''); onCancelEdit(); }} aria-label={t('chat.cancel_edit')}>
            <Icon name="close" size={20} />
          </button>
        </div>
      )}

      {replyingTo && !editing && (
        <div className="composer-banner reply-mode-banner" data-testid="reply-banner">
          <Icon name="reply" size={18} />
          <div className="reply-content-preview">
            <span className="reply-sender">{replyingTo.sender_username}</span>
            <span className="reply-text">{replyingTo.content || t('chat.attachment')}</span>
          </div>
          <button type="button" className="icon-btn cancel-reply-btn" onClick={() => onCancelReply()} aria-label={t('chat.cancel_reply')}>
            <Icon name="close" size={20} />
          </button>
        </div>
      )}

      {file && (
        <div className="selected-file-preview" data-testid="file-preview">
          {preview ? (
            <img src={preview} alt={t('chat.attachment_preview')} className="selected-file-thumb" />
          ) : (
            <span className="selected-file-icon"><Icon name="file" /></span>
          )}
          <div className="selected-file-info">
            <span className="selected-file-name">{file.name}</span>
            {uploading && (
              <div className="upload-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="upload-progress-bar" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
          <button type="button" onClick={clearFile} className="icon-btn clear-file-btn" disabled={uploading} aria-label={t('chat.remove_attachment')}>
            <Icon name="close" size={20} />
          </button>
        </div>
      )}

      <div className="composer-row message-input-row">
        <input type="file" ref={fileInputRef} onChange={(e) => addFile(e.target.files?.[0])} hidden tabIndex={-1} />
        <button
          type="button"
          className="icon-btn attachment-button"
          onClick={() => fileInputRef.current?.click()}
          aria-label={t('chat.attach_file')}
          title={t('chat.attach_file')}
          disabled={!!editing}
        >
          <Icon name="paperclip" />
        </button>

        <div className="input-field-wrapper">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={uploading ? t('chat.uploading') : t('chat.type_message')}
            aria-label={t('chat.type_message')}
            maxLength={5000}
            className="message-input"
            disabled={uploading}
            rows={1}
            enterKeyHint={coarse ? 'enter' : 'send'}
            data-testid="message-input"
          />
          <div className="emoji-picker-wrapper" ref={emojiWrapRef}>
            <button
              type="button"
              className="icon-btn emoji-button"
              onClick={() => setEmojiOpen((open) => !open)}
              aria-label={t('chat.toggle_emoji')}
              aria-expanded={emojiOpen}
            >
              <Icon name="smile" />
            </button>
            {emojiOpen && !isPhone && (
              <div className="emoji-picker emoji-popover" role="dialog" aria-label={t('chat.toggle_emoji')}>
                <div className="emoji-popover-header">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => { setEmojiOpen(false); textareaRef.current?.focus(); }}
                    aria-label={t('common.close')}
                    data-testid="emoji-close"
                  >
                    <Icon name="close" size={20} />
                  </button>
                </div>
                <EmojiPicker onSelect={insertEmoji} />
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          className="send-button"
          disabled={!canSend}
          aria-label={editing ? t('chat.edit_message', 'Edit') : t('chat.send')}
          data-testid="send-button"
        >
          <Icon name={editing ? 'check' : 'send'} size={22} />
        </button>
      </div>

      {isPhone && (
        <Sheet open={emojiOpen} onClose={() => setEmojiOpen(false)} title={t('chat.toggle_emoji')} testId="emoji-sheet">
          <EmojiPicker onSelect={insertEmoji} fluid />
        </Sheet>
      )}
    </form>
  );
});

Composer.displayName = 'Composer';
