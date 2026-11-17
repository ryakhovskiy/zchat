import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { isTopOverlay, popOverlay, pushOverlay } from '../../utils/overlayStack';
import './ImageModal.css';

/** Full-screen lightbox on every viewport. Closes with X, a backdrop tap or Esc. */
const ImageModal = ({ url, onClose, originalName }) => {
  const { t } = useTranslation();
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const token = pushOverlay();
    closeRef.current?.focus();
    const onKeyDown = (e) => {
      if (!isTopOverlay(token)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        // Two controls only: keep focus inside the dialog
        const controls = [...document.querySelectorAll('.image-modal-backdrop .image-modal-btn')];
        const index = controls.indexOf(document.activeElement);
        if (controls.length) {
          e.preventDefault();
          controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      popOverlay(token);
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, []);

  const onBackdrop = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="image-modal-backdrop"
      onClick={onBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label={originalName || t('chat.attachment')}
      data-testid="image-modal"
    >
      <div className="image-modal-header">
        <a
          href={url}
          download={originalName}
          className="icon-btn image-modal-btn"
          title={t('common.download')}
          aria-label={t('common.download')}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Icon name="download" />
        </a>
        <button
          type="button"
          ref={closeRef}
          className="icon-btn image-modal-btn"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
          data-testid="image-modal-close"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="image-modal-stage" onClick={onBackdrop}>
        <img src={url} alt={originalName || t('chat.attachment')} className="image-modal-image" />
      </div>
    </div>
  );
};

export default ImageModal;
