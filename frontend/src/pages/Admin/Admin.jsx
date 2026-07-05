import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

export default function Admin() {
  const [pending, setPending] = useState(null);
  const [users, setUsers] = useState(null);

  const load = () => {
    api.get('/admin/users/pending').then(setPending);
    api.get('/admin/users').then(setUsers);
  };
  useEffect(() => { load(); }, []);

  const approve = async (id) => { await api.post(`/admin/users/${id}/approve`); load(); };
  const refuse = async (id) => { await api.post(`/admin/users/${id}/refuse`); load(); };
  const disable = async (id) => { await api.post(`/admin/users/${id}/disable`); load(); };
  const enable = async (id) => { await api.post(`/admin/users/${id}/enable`); load(); };
  const remove = async (id) => {
    if (!confirm('Supprimer définitivement ce compte ?')) return;
    await api.delete(`/admin/users/${id}`);
    load();
  };

  return (
    <div className="space-y-8 pb-8">
      <h1 className="text-xl font-bold">Administration</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400">Inscriptions en attente ({pending?.length ?? 0})</h2>
        {pending === null ? (
          <p className="text-sm text-gray-500">Chargement…</p>
        ) : pending.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune demande en attente.</p>
        ) : (
          <div className="space-y-2">
            {pending.map((u) => (
              <div key={u.id} className="flex items-center justify-between bg-base-900 border border-base-700 rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{u.username}</div>
                  <div className="text-xs text-gray-400">{u.email} · {new Date(u.created_at).toLocaleDateString('fr-FR')}</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => approve(u.id)} className="bg-green-600 hover:bg-green-500 text-xs rounded-lg px-3 py-1.5 font-medium">Approuver</button>
                  <button onClick={() => refuse(u.id)} className="bg-base-800 hover:bg-red-900/40 text-red-400 text-xs rounded-lg px-3 py-1.5 font-medium border border-base-700">Refuser</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-400">Utilisateurs ({users?.length ?? 0})</h2>
        {users === null ? (
          <p className="text-sm text-gray-500">Chargement…</p>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between bg-base-900 border border-base-700 rounded-lg px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{u.username} {u.role === 'admin' && <span className="text-accent-500 text-xs">(admin)</span>}</div>
                  <div className="text-xs text-gray-400">{u.email} · {u.status}</div>
                </div>
                {u.role !== 'admin' && (
                  <div className="flex gap-2">
                    {u.status === 'disabled' ? (
                      <button onClick={() => enable(u.id)} className="bg-green-600 hover:bg-green-500 text-xs rounded-lg px-3 py-1.5 font-medium">Réactiver</button>
                    ) : (
                      <button onClick={() => disable(u.id)} className="bg-base-800 text-xs rounded-lg px-3 py-1.5 font-medium border border-base-700">Désactiver</button>
                    )}
                    <button onClick={() => remove(u.id)} className="bg-base-800 hover:bg-red-900/40 text-red-400 text-xs rounded-lg px-3 py-1.5 font-medium border border-base-700">Supprimer</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
