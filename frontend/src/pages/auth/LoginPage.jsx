import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Globe } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { ROLE_HOME_PATH } from '../../config/roles';
import './LoginPage.css';

export default function LoginPage() {
  const { login, isAuthenticated, role, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [lang, setLang] = useState('TH');

  if (!loading && isAuthenticated) {
    return <Navigate to={ROLE_HOME_PATH[role] ?? '/dashboard'} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const user = await login({ email, password, remember });
      navigate(ROLE_HOME_PATH[user.role] ?? '/dashboard', { replace: true });
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <header className="login-header">
        <span className="login-header__brand">Master Roster</span>
        <button
          type="button"
          className="login-header__lang"
          onClick={() => setLang((prev) => (prev === 'TH' ? 'EN' : 'TH'))}
          aria-label={`เปลี่ยนภาษา ปัจจุบัน ${lang}`}
        >
          <Globe size={14} strokeWidth={2.5} aria-hidden="true" />
          {lang}
        </button>
      </header>

      <div className="login-body">
        <div className="login-card">
          <h1 className="login-card__title">WELCOME BACK</h1>
          <p className="login-card__subtitle">Welcome back! Please enter your details.</p>

          <form onSubmit={handleSubmit} noValidate>
            <label className="login-field" htmlFor="email">
              <span>Email</span>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>

            <label className="login-field" htmlFor="password">
              <span>Password</span>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>

            <div className="login-meta">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <a href="#forgot" className="login-forgot">
                Forgot password
              </a>
            </div>

            {formError && (
              <p className="login-error" role="alert">
                {formError}
              </p>
            )}

            <button type="submit" className="login-submit" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
