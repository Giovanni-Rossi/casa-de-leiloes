import { useEffect, useState } from 'react';
import { NavLink, Link, Route, Routes, Navigate } from 'react-router-dom';
import { Gavel, Moon, Sun } from 'lucide-react';
import { useAuth } from './auth.jsx';
import Showcase from './pages/Showcase.jsx';
import AuthPage from './pages/AuthPage.jsx';
import LotRoom from './pages/LotRoom.jsx';
import Wallet from './pages/Wallet.jsx';
import MyBids from './pages/MyBids.jsx';
import Seller from './pages/Seller.jsx';
import Audit from './pages/Audit.jsx';
import Receipt from './pages/Receipt.jsx';

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('leilao.theme');
      if (saved) return saved;
    } catch {
      /* localStorage bloqueado: segue com a preferência do sistema */
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('leilao.theme', theme);
    } catch {
      /* localStorage bloqueado: o tema vale só nesta sessão */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function Protected({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="container">Carregando…</p>;
  if (!user) return <Navigate to="/entrar" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  return (
    <>
      <header className="top">
        <div className="container">
          <Link to="/" className="brand">
            <Gavel size={26} strokeWidth={1.5} aria-hidden="true" />
            <span>
              <span className="brand-name">Casa de Leilões</span>
              <span className="brand-tag">Arte · Antiguidades · Coleções</span>
            </span>
          </Link>
          <nav>
            <NavLink to="/" end>
              Vitrine
            </NavLink>
            {user?.role === 'licitante' && (
              <>
                <NavLink to="/meus-arremates">Meus arremates</NavLink>
                <NavLink to="/carteira">Carteira</NavLink>
              </>
            )}
            {user?.role === 'leiloeiro' && <NavLink to="/leiloeiro">Painel do leiloeiro</NavLink>}
            {user ? (
              <>
                <span className="nav-user">{user.name}</span>
                <button onClick={logout}>Sair</button>
              </>
            ) : (
              <NavLink to="/entrar">Entrar</NavLink>
            )}
          </nav>
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Alternar tema">
            {theme === 'dark' ? (
              <Sun size={17} strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Moon size={17} strokeWidth={1.75} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Showcase />} />
          <Route path="/entrar" element={<AuthPage />} />
          <Route path="/lotes/:id" element={<LotRoom />} />
          <Route path="/auditoria/:id" element={<Audit />} />
          <Route path="/comprovante/:token" element={<Receipt />} />
          <Route
            path="/carteira"
            element={
              <Protected role="licitante">
                <Wallet />
              </Protected>
            }
          />
          <Route
            path="/meus-arremates"
            element={
              <Protected role="licitante">
                <MyBids />
              </Protected>
            }
          />
          <Route
            path="/leiloeiro"
            element={
              <Protected role="leiloeiro">
                <Seller />
              </Protected>
            }
          />
          <Route path="*" element={<p>Página não encontrada.</p>} />
        </Routes>
      </main>
      <footer className="site-footer">
        <div className="container">
          <strong>Casa de Leilões</strong>
          <span>
            Acervo: Cleveland Museum of Art — Open Access (CC0). Saldos e valores simulados.
          </span>
        </div>
      </footer>
    </>
  );
}
