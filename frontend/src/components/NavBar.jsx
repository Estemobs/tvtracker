import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import logo from '../assets/logo.svg';

const items = [
  { to: '/series', label: 'Séries', icon: '📺' },
  { to: '/films', label: 'Films', icon: '🎬' },
  { to: '/explorer', label: 'Explorer', icon: '🔍' },
  { to: '/profil', label: 'Profil', icon: '👤' },
];

function NavItem({ to, label, icon, vertical }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg transition-colors ${
          vertical ? 'flex-col gap-1 px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
        } ${isActive ? 'text-accent-500 bg-accent-500/10' : 'text-gray-400 hover:text-gray-200'}`
      }
    >
      <span className={vertical ? 'text-xl' : 'text-lg'}>{icon}</span>
      <span className={vertical ? '' : 'font-medium'}>{label}</span>
    </NavLink>
  );
}

function VersionLink({ className }) {
  const [version, setVersion] = useState(null);

  useEffect(() => {
    fetch('/api/version').then((r) => r.json()).then((d) => setVersion(d.version)).catch(() => {});
  }, []);

  if (!version) return null;
  if (version === 'dev') return <span className={className}>dev</span>;

  return (
    <a
      href={`https://github.com/Estemobs/tvtracker/commit/${version}`}
      target="_blank"
      rel="noreferrer"
      className={`${className} hover:text-gray-400 hover:underline`}
      title="Voir ce commit sur GitHub"
    >
      {version.slice(0, 7)}
    </a>
  );
}

export default function NavBar() {
  const { user, logout } = useAuth();
  const allItems = user?.role === 'admin' ? [...items, { to: '/admin', label: 'Admin', icon: '🛠️' }] : items;

  return (
    <>
      {/* Mobile top bar */}
      <header className="sm:hidden fixed top-0 inset-x-0 z-40 bg-base-900/95 backdrop-blur border-b border-base-700 flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <img src={logo} alt="TVTracker" className="w-7 h-7" />
          <span className="font-bold text-white">TVTracker</span>
        </div>
        <div className="flex items-center gap-2">
          <VersionLink className="text-[10px] text-gray-600" />
          <button
            onClick={logout}
            title="Se déconnecter"
            className="flex items-center gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
          >
            <span>🚪</span> Déconnexion
          </button>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-base-900/95 backdrop-blur border-t border-base-700 flex justify-around pb-[env(safe-area-inset-bottom)]">
        {allItems.map((it) => (
          <NavItem key={it.to} {...it} vertical />
        ))}
      </nav>

      {/* Desktop sidebar */}
      <nav className="hidden sm:flex flex-col gap-1 w-56 shrink-0 border-r border-base-700 bg-base-900 p-4 h-screen sticky top-0">
        <div className="flex items-center gap-2 px-4 mb-6">
          <img src={logo} alt="TVTracker" className="w-8 h-8" />
          <span className="text-xl font-bold text-white">TVTracker</span>
        </div>
        {allItems.map((it) => (
          <NavItem key={it.to} {...it} />
        ))}
        <div className="mt-auto flex items-center gap-2 px-4">
          <button
            onClick={logout}
            className="flex-1 flex items-center gap-3 py-2.5 rounded-lg text-sm font-medium text-red-400 hover:text-white hover:bg-red-600 transition-colors"
          >
            <span className="text-lg">🚪</span>
            Se déconnecter
          </button>
          <VersionLink className="text-[10px] text-gray-600 shrink-0" />
        </div>
      </nav>
    </>
  );
}
