import React, { useState } from 'react';
import { useSecureObjectUrl } from '../../hooks/useSecureObjectUrl';
import api from '../../services/api';

/**
 * Renders an <img> whose source is fetched with the Authorization header.
 * The blob URL is revoked automatically on unmount.
 */
export function SecureImg({ filePath, alt, className, style, onClickWithUrl }) {
  const url = useSecureObjectUrl(filePath);
  if (!url) return <div className={`media-loading ${className || ''}`} style={style} />;
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      style={style}
      onClick={onClickWithUrl ? () => onClickWithUrl(url) : undefined}
    />
  );
}

/**
 * Renders a <video> whose source is fetched with the Authorization header.
 */
export function SecureVideo({ filePath, className, style, onClick }) {
  const url = useSecureObjectUrl(filePath);
  if (!url) return <div className={`media-loading ${className || ''}`} style={style} />;
  return (
    <video
      src={url}
      className={className}
      controls
      preload="metadata"
      onClick={onClick}
    />
  );
}

/**
 * Renders a download button. The file is fetched on click (not on render)
 * to avoid loading large files into memory before the user requests them.
 */
export function SecureFileLink({ filePath, fileName, fileSize, formatBytes, children }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (e) => {
    e.preventDefault();
    if (!filePath || downloading) return;
    setDownloading(true);
    try {
      const normalised = filePath.replace(/^\/+/, '');
      const apiPath = normalised.startsWith('uploads/') ? `/${normalised}` : `/uploads/${normalised}`;
      const response = await api.get(apiPath, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('SecureFileLink: download failed', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button type="button" className="attachment-file-btn" onClick={handleDownload} disabled={downloading}>
      {children || (
        <>
          📄 {fileName}
          {fileSize && formatBytes && (
            <span className="attachment-size" style={{ fontSize: '0.8em', color: '#888', marginLeft: '5px' }}>
              ({formatBytes(fileSize)})
            </span>
          )}
        </>
      )}
    </button>
  );
}
