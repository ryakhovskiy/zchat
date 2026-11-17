import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Common/Icon';
import { MessageBubble } from './MessageBubble';

const GROUP_GAP_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 80;

const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const SkeletonMessages = () => (
  <div className="messages-skeleton" aria-busy="true" data-testid="messages-skeleton">
    {[62, 40, 70, 48, 58].map((w, i) => (
      <span
        key={i}
        className={`skeleton message-skeleton ${i % 2 ? 'message-skeleton--out' : ''}`}
        style={{ width: `${w}%` }}
      />
    ))}
  </div>
);

/**
 * Scrollable message history. Stays pinned to the bottom for new messages unless the reader
 * scrolled up (then shows a "jump to latest" button). Loads older pages near the top.
 */
export const MessageList = ({
  conversation,
  title,
  messages, // undefined while the first page is loading
  user,
  coarse,
  locale,
  hasMore,
  loadOlder,
  onOpenActions,
  onSwipeReply,
  onImageClick,
  onReact,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const pinnedRef = useRef(true);
  const lastCountRef = useRef(0);
  const lastIdRef = useRef(null);
  const [showJump, setShowJump] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const list = useMemo(() => messages || [], [messages]);

  const items = useMemo(() => {
    const byId = new Map(list.map((m) => [m.id, m]));
    return list.map((message, i) => {
      const prev = list[i - 1];
      const next = list[i + 1];
      const sameBlock = (a, b) =>
        a && b && a.sender_id === b.sender_id && dayKey(a.created_at) === dayKey(b.created_at) &&
        Math.abs(new Date(b.created_at) - new Date(a.created_at)) < GROUP_GAP_MS;
      const startsDay = !prev || dayKey(prev.created_at) !== dayKey(message.created_at);
      return {
        message,
        startsDay,
        continuesPrev: sameBlock(prev, message),
        continuesNext: sameBlock(message, next),
        replied: message.reply_to_id ? byId.get(message.reply_to_id) : null,
      };
    });
  }, [list]);

  // Automatic follows are instant: a smooth scroll fires intermediate scroll events that would
  // look like the reader scrolling away and wrongly un-pin the list. Only the explicit
  // "Jump to latest" button scrolls smoothly, and not when the user prefers reduced motion.
  const smoothingRef = useRef(false);
  const smoothTimer = useRef(null);
  const scrollToBottom = useCallback((smooth = false) => {
    const el = containerRef.current;
    if (!el) return;
    pinnedRef.current = true;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (smooth && !reduceMotion) {
      smoothingRef.current = true;
      clearTimeout(smoothTimer.current);
      smoothTimer.current = setTimeout(() => {
        smoothingRef.current = false;
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' }); // settle exactly at the bottom
      }, 600);
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    }
  }, []);

  useEffect(() => () => clearTimeout(smoothTimer.current), []);

  // New conversation: jump to the bottom without animation
  useLayoutEffect(() => {
    pinnedRef.current = true;
    lastCountRef.current = 0;
    lastIdRef.current = null;
    setShowJump(false);
  }, [conversation.id]);

  // New messages: follow if pinned or if I sent it; otherwise offer "jump to latest"
  useLayoutEffect(() => {
    if (!messages) return;
    const last = list[list.length - 1];
    const firstPaint = lastCountRef.current === 0;
    const appended = last && last.id !== lastIdRef.current && list.length >= lastCountRef.current;
    const mine = last && last.sender_id === user.id;

    if (firstPaint) {
      scrollToBottom(false);
    } else if (appended && (pinnedRef.current || mine)) {
      scrollToBottom(false);
    } else if (appended && !mine) {
      setShowJump(true);
    }
    lastCountRef.current = list.length;
    lastIdRef.current = last?.id ?? null;
  }, [list, messages, user.id, scrollToBottom]);

  // Keyboard / composer growth changes the viewport size: keep the bottom anchored
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom(false);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollToBottom, conversation.id]);

  const onScroll = async () => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Our own smooth scroll passes through intermediate positions: only real scrolling counts
    if (!smoothingRef.current) pinnedRef.current = distance < NEAR_BOTTOM_PX;
    if (pinnedRef.current) setShowJump(false);

    if (el.scrollTop < 100 && hasMore && !loadingOlder) {
      setLoadingOlder(true);
      const prevHeight = el.scrollHeight;
      const older = await loadOlder();
      if (older.length > 0) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight - prevHeight;
        });
      }
      setLoadingOlder(false);
    }
  };

  const dayLabel = (iso) => {
    const d = new Date(iso);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return t('chat.today');
    if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday');
    return d.toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  };

  return (
    <div className="messages-wrapper">
      <div
        className="messages-container"
        ref={containerRef}
        onScroll={onScroll}
        onLoadCapture={() => { if (pinnedRef.current) scrollToBottom(false); }}
        role="log"
        aria-live="polite"
        aria-label={t('chat.conversation_with', { name: title })}
        data-testid="messages-container"
      >
        {loadingOlder && <div className="loading-older" role="status">{t('chat.loading_older')}</div>}

        {messages === undefined ? (
          <SkeletonMessages />
        ) : list.length === 0 ? (
          <div className="no-messages" data-testid="no-messages">
            <span className="empty-icon" aria-hidden="true"><Icon name="chat" size={40} /></span>
            <p>{t('chat.no_messages')}</p>
          </div>
        ) : (
          items.map(({ message, startsDay, continuesPrev, continuesNext, replied }) => {
            const isMine = message.sender_id === user.id;
            const senderName = message.sender_username || (isMine ? user.username : t('chat.unknown_user'));
            return (
              <React.Fragment key={message.id}>
                {startsDay && (
                  <div className="date-separator" role="separator" data-testid="date-separator">
                    <span>{dayLabel(message.created_at)}</span>
                  </div>
                )}
                <MessageBubble
                  message={message}
                  isMine={isMine}
                  senderName={senderName}
                  showSender={!isMine && !!conversation.is_group && !continuesPrev}
                  replied={replied}
                  continuesPrev={continuesPrev && !startsDay}
                  continuesNext={continuesNext}
                  coarse={coarse}
                  currentUserId={user.id}
                  locale={locale}
                  onOpenActions={onOpenActions}
                  onSwipeReply={onSwipeReply}
                  onImageClick={onImageClick}
                  onReact={onReact}
                />
              </React.Fragment>
            );
          })
        )}
      </div>

      {showJump && (
        <button
          type="button"
          className="jump-to-latest"
          onClick={() => { scrollToBottom(true); setShowJump(false); }}
          data-testid="jump-to-latest"
        >
          <Icon name="arrow-down" size={18} />
          <span>{t('chat.jump_to_latest')}</span>
        </button>
      )}
    </div>
  );
};
