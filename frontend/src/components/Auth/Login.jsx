import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { Icon } from '../Common/Icon';
import { AuthShell, PasswordField } from './AuthShell';

export const Login = ({ onSwitchToRegister }) => {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  });
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(formData.username, formData.password, rememberMe);

    if (!result.success) {
      setError(result.error);
    }

    setLoading(false);
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <AuthShell
      title={t('auth.sign_in_header')}
      footer={(
        <>
          {t('auth.no_account')}{' '}
          <button type="button" onClick={onSwitchToRegister} className="link-button">
            {t('auth.sign_up_button')}
          </button>
        </>
      )}
    >
      {error && <div className="error-message" role="alert"><Icon name="alert" size={20} /><span>{error}</span></div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="username">{t('auth.username')}</label>
          <input
            type="text"
            id="username"
            name="username"
            value={formData.username}
            onChange={handleChange}
            required
            disabled={loading}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <PasswordField
          id="password"
          name="password"
          label={t('auth.password')}
          value={formData.password}
          onChange={handleChange}
          disabled={loading}
          autoComplete="current-password"
        />

        <label className="checkbox-label remember-me">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            disabled={loading}
          />
          <span>{t('auth.remember_me')}</span>
        </label>

        <button type="submit" className="btn-primary auth-submit" disabled={loading}>
          {loading ? t('auth.signing_in') : t('auth.sign_in_button')}
        </button>
      </form>
    </AuthShell>
  );
};
