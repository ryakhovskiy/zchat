import React from 'react';
import { useTranslation } from 'react-i18next';
import { ControlPanel } from '../Common/ControlPanel';
import { Icon } from '../Common/Icon';
import './Auth.css';

/** Themed, phone-friendly frame for Login and Register. Settings are reachable before sign-in. */
export const AuthShell = ({ title, children, footer }) => {
  const { t } = useTranslation();
  return (
    <div className="auth-container" data-testid="auth-screen">
      <div className="auth-settings">
        <ControlPanel />
      </div>
      <main className="auth-card">
        <div className="auth-brand">
          <img src="/assets/images/zchat.png" alt="" className="auth-logo" width="56" height="56" />
          <h1>{t('auth.app_title')}</h1>
        </div>
        <h2>{title}</h2>
        {children}
        <p className="auth-switch">{footer}</p>
      </main>
    </div>
  );
};

export const PasswordField = ({ id, name, label, value, onChange, disabled, autoComplete, minLength, hint }) => {
  const { t } = useTranslation();
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <div className="password-wrapper">
        <input
          type={visible ? 'text' : 'password'}
          id={id}
          name={name}
          value={value}
          onChange={onChange}
          required
          minLength={minLength}
          disabled={disabled}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="icon-btn password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('auth.toggle_hide') : t('auth.toggle_show')}
          aria-pressed={visible}
        >
          <Icon name={visible ? 'eye-off' : 'eye'} size={20} />
        </button>
      </div>
      {hint && <small className="field-hint">{hint}</small>}
    </div>
  );
};
