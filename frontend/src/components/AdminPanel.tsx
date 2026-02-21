import { useEffect, useState } from 'react';
import { adminApi } from '@/services/api';
import { PendingUser, DashboardRole } from '@/types';

const ROLES: DashboardRole[] = ['SAI_VIEWER', 'SAI_OPERATOR', 'SAI_ADMIN'];

export function AdminPanel() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, DashboardRole>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await adminApi.getPendingUsers();
      setUsers(data);
      const defaults: Record<string, DashboardRole> = {};
      data.forEach(u => { defaults[u.zitadelSub] = 'SAI_VIEWER'; });
      setSelectedRoles(prev => ({ ...defaults, ...prev }));
    } catch {
      setError('Error cargando usuarios pendientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (sub: string) => {
    setProcessing(p => ({ ...p, [sub]: true }));
    try {
      await adminApi.approveUser(sub, selectedRoles[sub] || 'SAI_VIEWER');
      setUsers(u => u.filter(x => x.zitadelSub !== sub));
    } catch {
      setError(`Error aprobando usuario`);
    } finally {
      setProcessing(p => ({ ...p, [sub]: false }));
    }
  };

  const handleReject = async (sub: string) => {
    setProcessing(p => ({ ...p, [sub]: true }));
    try {
      await adminApi.rejectUser(sub);
      setUsers(u => u.filter(x => x.zitadelSub !== sub));
    } catch {
      setError(`Error rechazando usuario`);
    } finally {
      setProcessing(p => ({ ...p, [sub]: false }));
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Cargando...</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">
        Solicitudes de acceso pendientes
        {users.length > 0 && (
          <span className="ml-2 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-normal">
            {users.length}
          </span>
        )}
      </h2>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
      )}

      {users.length === 0 ? (
        <p className="text-sm text-gray-500">No hay solicitudes pendientes.</p>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
          {users.map(user => (
            <div key={user.zitadelSub} className="flex items-center gap-4 px-4 py-3 bg-white">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{user.email}</p>
                <p className="text-xs text-gray-400">
                  Primer intento: {new Date(user.firstSeenAt).toLocaleString('es')}
                  {user.attemptCount > 1 && ` · ${user.attemptCount} intentos`}
                </p>
              </div>

              <select
                value={selectedRoles[user.zitadelSub] || 'SAI_VIEWER'}
                onChange={e =>
                  setSelectedRoles(r => ({ ...r, [user.zitadelSub]: e.target.value as DashboardRole }))
                }
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
                disabled={processing[user.zitadelSub]}
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>

              <button
                onClick={() => handleApprove(user.zitadelSub)}
                disabled={processing[user.zitadelSub]}
                className="text-sm px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Aprobar
              </button>

              <button
                onClick={() => handleReject(user.zitadelSub)}
                disabled={processing[user.zitadelSub]}
                className="text-sm px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
              >
                Rechazar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
