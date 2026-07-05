import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import logo from '../assets/logo.svg';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(identifier, password);
      navigate('/series');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={logo} alt="TVTracker" className="w-16 h-16" />
          <h1 className="text-2xl font-bold">TVTracker</h1>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 bg-base-900 p-6 rounded-xl border border-base-700">
          <div>
            <label className="block text-sm text-gray-400 mb-1">E-mail ou nom d'utilisateur</label>
            <input
              className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Mot de passe</label>
            <input
              type="password"
              className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-600 hover:bg-accent-500 transition-colors rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-400 mt-4">
          Pas de compte ? <Link to="/register" className="text-accent-500 hover:underline">S'inscrire</Link>
        </p>
      </div>
    </div>
  );
}
