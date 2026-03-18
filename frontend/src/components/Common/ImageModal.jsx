import React, { useEffect } from 'react';
import './ImageModal.css';

const ImageModal = ({ url, onClose, originalName }) => {
  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="image-modal-backdrop" onClick={handleBackdropClick}>
      <div className="image-modal-content">
        <div className="image-modal-header">
          <a href={url} download={originalName} className="image-modal-btn" title="Download" target="_blank" rel="noopener noreferrer">
            ⬇
          </a>
          <button className="image-modal-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <img src={url} alt={originalName || 'Image preview'} className="image-modal-image" onClick={handleBackdropClick} />
      </div>
    </div>
  );
};

export default ImageModal;
