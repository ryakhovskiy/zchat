import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './ControlPanel.css';

const THEME_ICONS = { light: 'sun', dark: 'moon', 'tech-green': 'terminal', 'tech-red': 'zap' };
const LANGUAGES = [
  { code: 'en', short: 'EN', name: 'English' },
  { code: 'de', short: 'DE', name: 'Deutsch' },
  { code: 'ru', short: 'RU', name: 'Русский' },
];

/** Roving-tabindex radiogroup: arrows move the selection, Tab leaves the group. */
const useRadioKeys = (count, selectedIndex, onSelect) => (e) => {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    onSelect(e.key === 'Home' ? 0 : count - 1);
  } else if (keys[e.key]) {
    e.preventDefault();
    onSelect((selectedIndex + keys[e.key] + count) % count);
  }
};

const ThemePicker = () => {
  const { t } = useTranslation();
  const { theme, setTheme, themes } = useTheme();
  const refs = useRef([]);

  const select = (index) => {
    setTheme(themes[index]);
    refs.current[index]?.focus();
  };
  const onKeyDown = useRadioKeys(themes.length, themes.indexOf(theme), select);

  return (
    <section className="settings-section" aria-labelledby="settings-theme-label">
      <h3 id="settings-theme-label" className="settings-label">{t('settings.theme')}</h3>
      <div className="theme-grid" role="radiogroup" aria-labelledby="settings-theme-label" onKeyDown={onKeyDown}>
        {themes.map((id, index) => {
          const checked = id === theme;
          const name = t(`theme.name_${id.replace('-', '_')}`);
          return (
            <button
              key={id}
              ref={(el) => { refs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={name}
              tabIndex={checked ? 0 : -1}
              className={`theme-card ${checked ? 'theme-card--checked' : ''}`}
              onClick={() => setTheme(id)}
              data-theme-option={id}
              data-testid={`theme-option-${id}`}
            >
              {/* Mini preview: scoped data-theme makes every token resolve to THAT theme */}
              <span className="theme-preview" data-theme={id} aria-hidden="true">
                <span className="theme-preview-bar" />
                <span className="theme-preview-bubble theme-preview-bubble--in" />
                <span className="theme-preview-bubble theme-preview-bubble--out" />
                {checked && (
                  <span className="theme-preview-check"><Icon name="check" size={14} /></span>
                )}
              </span>
              <span className="theme-card-name">
                <Icon name={THEME_ICONS[id]} size={18} />
                <span>{name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

const LanguagePicker = () => {
  const { t, i18n } = useTranslation();
  const current = (i18n.resolvedLanguage || 'en').substring(0, 2).toLowerCase();
  const selectedIndex = Math.max(0, LANGUAGES.findIndex((l) => l.code === current));
  const refs = useRef([]);

  const select = (index) => {
    i18n.changeLanguage(LANGUAGES[index].code);
    refs.current[index]?.focus();
  };
  const onKeyDown = useRadioKeys(LANGUAGES.length, selectedIndex, select);

  return (
    <section className="settings-section" aria-labelledby="settings-language-label">
      <h3 id="settings-language-label" className="settings-label">{t('settings.language')}</h3>
      <div className="segmented" role="radiogroup" aria-labelledby="settings-language-label" onKeyDown={onKeyDown}>
        {LANGUAGES.map((lang, index) => {
          const checked = index === selectedIndex;
          return (
            <button
              key={lang.code}
              ref={(el) => { refs.current[index] = el; }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={lang.name}
              lang={lang.code}
              tabIndex={checked ? 0 : -1}
              className={`segmented-option ${checked ? 'segmented-option--checked' : ''}`}
              onClick={() => i18n.changeLanguage(lang.code)}
              data-testid={`language-option-${lang.code}`}
            >
              <span aria-hidden="true">{lang.short}</span>
              <span className="segmented-name" aria-hidden="true">{lang.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

/** Gear button + Settings sheet (popover on desktop, bottom sheet on phones). */
export const ControlPanel = ({ className = '' }) => {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-btn settings-btn ${className}`.trim()}
        onClick={() => setOpen((v) => !v)}
        aria-label={t('settings.title')}
        title={t('settings.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="settings-button"
      >
        <Icon name="settings" />
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('settings.title')}
        anchorRef={buttonRef}
        testId="settings-sheet"
      >
        <div className="settings-content">
          <ThemePicker />
          <LanguagePicker />

          {user && (
            <section className="settings-section settings-account" aria-labelledby="settings-account-label">
              <h3 id="settings-account-label" className="settings-label">{t('settings.account')}</h3>
              <p className="settings-user">{t('settings.signed_in_as', { name: user.username })}</p>
              <button
                type="button"
                className="btn-danger settings-logout"
                onClick={() => { setOpen(false); logout(); }}
                data-testid="logout-button"
              >
                <Icon name="logout" size={20} />
                <span>{t('settings.logout')}</span>
              </button>
            </section>
          )}
        </div>
      </Sheet>
    </>
  );
};
