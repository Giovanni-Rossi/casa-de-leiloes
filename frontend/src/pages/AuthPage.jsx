import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function AuthPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'licitante' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = mode === 'login' ? await login(form) : await register(form);
      navigate(user.role === 'leiloeiro' ? '/leiloeiro' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <h1>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
      <div className="ornament">
        <span />
      </div>
      {mode === 'register' && (
        <>
          <label>
            Nome
            <input value={form.name} onChange={set('name')} required />
          </label>
          <label>
            Perfil
            <select value={form.role} onChange={set('role')}>
              <option value="licitante">Licitante (dou lances)</option>
              <option value="leiloeiro">Leiloeiro (crio lotes)</option>
            </select>
          </label>
        </>
      )}
      <label>
        E-mail
        <input type="email" value={form.email} onChange={set('email')} required />
      </label>
      <label>
        Senha
        <input
          type="password"
          value={form.password}
          onChange={set('password')}
          required
          minLength={6}
        />
      </label>
      {error && <div className="alert error">{error}</div>}
      <div className="actions">
        <button className="primary" disabled={busy}>
          {mode === 'login' ? 'Entrar' : 'Cadastrar'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? 'Criar conta' : 'Já tenho conta'}
        </button>
      </div>
      {mode === 'login' && (
        <p className="muted hint">
          Contas de teste (senha <code>senha123</code>): leiloeiro@teste.com, ana@teste.com,
          bruno@teste.com
        </p>
      )}
    </form>
  );
}
