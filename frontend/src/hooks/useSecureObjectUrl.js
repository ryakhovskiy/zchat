import { useState, useEffect, useRef } from 'react';
import api from '../services/api';

/**
 * Fetches a file from the authenticated API and returns a blob object URL.
 * The URL is revoked automatically on unmount or when filePath changes.
 *
 * @param {string|null} filePath  e.g. "uploads/abc123.png" or just "/uploads/abc123.png"
 * @returns {string|null} blob URL, or null while loading
 */
export function useSecureObjectUrl(filePath) {
  const [objectUrl, setObjectUrl] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!filePath) return;

    const controller = new AbortController();
    let blobUrl = null;

    const normalised = filePath.replace(/^\/+/, '');
    const apiPath = normalised.startsWith('uploads/') ? `/${normalised}` : `/uploads/${normalised}`;

    api
      .get(apiPath, { responseType: 'blob', signal: controller.signal })
      .then((response) => {
        if (!mountedRef.current) return;
        blobUrl = URL.createObjectURL(response.data);
        setObjectUrl(blobUrl);
      })
      .catch((err) => {
        if (err.name !== 'AbortError' && err.code !== 'ERR_CANCELED') {
          console.error('useSecureObjectUrl: failed to load', filePath, err);
        }
      });

    return () => {
      controller.abort();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setObjectUrl(null);
    };
  }, [filePath]);

  return objectUrl;
}
