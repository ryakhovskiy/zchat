import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { Icon } from '../Common/Icon';
import { AuthShell, PasswordField } from './AuthShell';

export const Register = ({ onSwitchToLogin }) => {
  const { t } = useTranslation();
  const { register } = useAuth();
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError(t('auth.password_match_error'));
      return;
    }

    // Password complexity check
    const password = formData.password;
    if (password.length < 10) {
      setError(t('auth.password_length_error'));
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError(t('auth.password_char_error'));
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError(t('auth.password_char_error'));
      return;
    }
    if (!/\d/.test(password)) {
      setError(t('auth.password_char_error'));
      return;
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      setError(t('auth.password_char_error'));
      return;
    }

    setLoading(true);

    const result = await register(
      formData.username,
      formData.password,
      formData.email || undefined
    );

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
      title={t('auth.sign_up_header')}
      footer={(
        <>
          {t('auth.has_account')}{' '}
          <button type="button" onClick={onSwitchToLogin} className="link-button">
            {t('auth.sign_in_button')}
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
            minLength={3}
            maxLength={50}
            disabled={loading}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <div className="form-group">
          <label htmlFor="email">{t('auth.email_optional')}</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            disabled={loading}
            autoComplete="email"
          />
        </div>

        <PasswordField
          id="password"
          name="password"
          label={t('auth.password')}
          value={formData.password}
          onChange={handleChange}
          disabled={loading}
          autoComplete="new-password"
          minLength={6}
          hint={t('auth.password_requirements')}
        />

        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label={t('auth.confirm_password')}
          value={formData.confirmPassword}
          onChange={handleChange}
          disabled={loading}
          autoComplete="new-password"
          minLength={6}
        />

        <button type="submit" className="btn-primary auth-submit" disabled={loading}>
          {loading ? t('auth.signing_up') : t('auth.sign_up_button')}
        </button>
      </form>
    </AuthShell>
  );
};
