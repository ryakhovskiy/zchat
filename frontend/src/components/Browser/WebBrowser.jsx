import React, { useState } from 'react';
import { browserAPI } from '../../services/api';
import './WebBrowser.css';

export const WebBrowser = () => {
  const [url, setUrl] = useState('');
  const [inputUrl, setInputUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [htmlContent, setHtmlContent] = useState('');
  const [error, setError] = useState(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    let targetUrl = inputUrl;
    
    // Basic URL validation/fixing
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
        // If it looks like a domain, prepend https
        if (targetUrl.includes('.') && !targetUrl.includes(' ')) {
            targetUrl = `https://${targetUrl}`;
        } else {
            // Otherwise treat as search query
            targetUrl = `https://www.bing.com/search?q=${encodeURIComponent(targetUrl)}`;
        }
    }

    setLoading(true);
    setUrl(targetUrl);
    setError(null);
    setHtmlContent('');

    try {
        const response = await browserAPI.proxy(targetUrl);
        if (typeof response.data === 'string') {
          setHtmlContent(response.data);
        } else if (response.data?.html) {
          setHtmlContent(response.data.html);
        } else {
          setHtmlContent('');
          setError('Unexpected response format from browser proxy');
        }
    } catch (err) {
        console.error("Browser failed:", err);
        setError("Failed to load page. " + (err.response?.data?.error || err.response?.data?.detail || err.message));
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="web-browser-container">
      <div className="browser-toolbar">
        <form onSubmit={handleSearch} className="url-bar-form">
          <input
            type="text"
            className="browser-url-input"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Search Google or enter a URL"
          />
          <button type="submit" className="browser-go-btn" disabled={loading}>
            {loading ? '...' : 'Go'}
          </button>
        </form>
      </div>
      
      <div className="browser-content">
        {loading && <div className="browser-loading"></div>}
        
        {error ? (
             <div className="browser-error" style={{padding: '2rem', textAlign: 'center', color: 'var(--error-color)'}}>
                <h3>Error loading page</h3>
                <p>{error}</p>
            </div>
        ) : htmlContent ? (
          <iframe 
            srcDoc={htmlContent}
            className="browser-frame" 
            title="Browser View"
            sandbox="allow-scripts allow-forms allow-popups"
          />
        ) : (
          <div className="browser-placeholder">
             <div className="placeholder-content">
                <h2>Chat Browser</h2>
                <form onSubmit={handleSearch}>
                    <input 
                        type="text" 
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                        className="big-search-input"
                        placeholder="Search Google or type a URL"
                    />
                </form>
             </div>
          </div>
        )}
      </div>
    </div>
  );
};
