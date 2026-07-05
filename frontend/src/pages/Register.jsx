import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';

export default function Register() {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const data = await api.post('/auth/register', form);
      setSuccess(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-8">Créer un compte</h1>
        {success ? (
          <div className="bg-base-900 border border-base-700 rounded-xl p-6 text-center space-y-4">
            <p className="text-sm text-gray-200">{success}</p>
            <Link to="/login" className="inline-block text-accent-500 hover:underline text-sm">Retour à la connexion</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 bg-base-900 p-6 rounded-xl border border-base-700">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Nom d'utilisateur</label>
              <input
                className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                value={form.username}
                onChange={update('username')}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">E-mail</label>
              <input
                type="email"
                className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                value={form.email}
                onChange={update('email')}
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Mot de passe</label>
              <input
                type="password"
                className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                value={form.password}
                onChange={update('password')}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Confirmation du mot de passe</label>
              <input
                type="password"
                className="w-full rounded-lg bg-base-800 border border-base-600 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
                value={form.confirmPassword}
                onChange={update('confirmPassword')}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent-600 hover:bg-accent-500 transition-colors rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Envoi…' : "S'inscrire"}
            </button>
          </form>
        )}
        <p className="text-center text-sm text-gray-400 mt-4">
          Déjà un compte ? <Link to="/login" className="text-accent-500 hover:underline">Se connecter</Link>
        </p>
      </div>
    </div>
  );
}
