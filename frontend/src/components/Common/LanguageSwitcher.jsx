import React from 'react';
import { useTranslation } from 'react-i18next';
import './LanguageSwitcher.css';

export const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const currentLang = (i18n.resolvedLanguage || 'en').substring(0, 2).toLowerCase();
    let nextLang;

    if (currentLang === 'en') {
      nextLang = 'de';
    } else if (currentLang === 'de') {
      nextLang = 'ru';
    } else {
      nextLang = 'en';
    }

    i18n.changeLanguage(nextLang);
  };

  // Get current language for display (uppercase)
  // i18n.resolvedLanguage might be 'en-US' or 'en', so we take the first 2 chars
  const displayLang = (i18n.resolvedLanguage || 'EN').substring(0, 2).toUpperCase();

  return (
    <button
      className="language-switcher"
      onClick={toggleLanguage}
      aria-label={`Current language: ${displayLang}. Click to switch.`}
      title="Switch Language (EN / DE / RU)"
    >
      {displayLang}
    </button>
  );
};
