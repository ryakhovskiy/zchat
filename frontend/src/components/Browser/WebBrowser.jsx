import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browserAPI } from '../../services/api';
import { Icon } from '../Common/Icon';
import './WebBrowser.css';

export const WebBrowser = () => {
  const { t } = useTranslation();
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    let targetUrl = inputUrl.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      // Looks like a domain: add https. Otherwise treat it as a search query.
      targetUrl = targetUrl.includes('.') && !targetUrl.includes(' ')
        ? `https://${targetUrl}`
        : `https://www.bing.com/search?q=${encodeURIComponent(targetUrl)}`;
    }

    setLoading(true);
    setError(null);
    setHtmlContent('');

    try {
      const response = await browserAPI.proxy(targetUrl);
      if (typeof response.data === 'string') {
        setHtmlContent(response.data);
      } else if (response.data?.html) {
        setHtmlContent(response.data.html);
      } else {
        setError('Unexpected response format from browser proxy');
      }
    } catch (err) {
      console.error('Browser failed:', err);
      setError(err.response?.data?.error || err.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  };

  const urlForm = (className, inputClass) => (
    <form onSubmit={handleSearch} className={className}>
      <input
        type="text"
        className={inputClass}
        value={inputUrl}
        onChange={(e) => setInputUrl(e.target.value)}
        placeholder={t('browser.placeholder')}
        aria-label={t('browser.placeholder')}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
      />
      <button type="submit" className="btn-primary browser-go-btn" disabled={loading}>
        {loading ? <span className="spinner spinner--inline" aria-hidden="true" /> : <Icon name="globe" size={20} />}
        <span>{t('browser.go')}</span>
      </button>
    </form>
  );

  return (
    <div className="web-browser-container">
      <div className="browser-toolbar">{urlForm('url-bar-form', 'browser-url-input')}</div>

      <div className="browser-content">
        {loading && <div className="browser-loading" role="progressbar" aria-label={t('common.loading')} />}

        {error ? (
          <div className="browser-error" role="alert">
            <Icon name="alert" size={32} />
            <h3>{t('browser.error_title')}</h3>
            <p>{error}</p>
          </div>
        ) : htmlContent ? (
          <iframe
            srcDoc={htmlContent}
            className="browser-frame"
            title={t('browser.view')}
            sandbox="allow-scripts allow-forms allow-popups"
          />
        ) : (
          <div className="browser-placeholder">
            <div className="placeholder-content">
              <Icon name="globe" size={48} />
              <h2>{t('browser.title')}</h2>
              {urlForm('placeholder-form', 'big-search-input')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
