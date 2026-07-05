import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

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

export default function NavBar() {
  const { user } = useAuth();
  const allItems = user?.role === 'admin' ? [...items, { to: '/admin', label: 'Admin', icon: '🛠️' }] : items;

  return (
    <>
      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-base-900/95 backdrop-blur border-t border-base-700 flex justify-around pb-[env(safe-area-inset-bottom)]">
        {allItems.map((it) => (
          <NavItem key={it.to} {...it} vertical />
        ))}
      </nav>

      {/* Desktop sidebar */}
      <nav className="hidden sm:flex flex-col gap-1 w-56 shrink-0 border-r border-base-700 bg-base-900 p-4 h-screen sticky top-0">
        <div className="text-xl font-bold text-white px-4 mb-6">TVTracker</div>
        {allItems.map((it) => (
          <NavItem key={it.to} {...it} />
        ))}
      </nav>
    </>
  );
}
