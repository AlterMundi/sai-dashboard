import { useEffect, useState, useRef } from 'react';
import { adminApi } from '@/services/api';
import { PendingUser, DashboardRole } from '@/types';
import { ShieldCheck, ShieldOff, UserCheck, Clock, RefreshCw, AlertTriangle } from 'lucide-react';

const ROLES: { value: DashboardRole; label: string; color: string }[] = [
  { value: 'SAI_VIEWER',     label: 'Viewer',     color: 'slate'   },
  { value: 'SAI_RESEARCHER', label: 'Researcher', color: 'emerald' },
  { value: 'SAI_OPERATOR',   label: 'Operator',   color: 'blue'    },
  { value: 'SAI_ADMIN',      label: 'Admin',      color: 'amber'   },
];

function RolePills({
  value,
  onChange,
  disabled,
}: {
  value: DashboardRole;
  onChange: (r: DashboardRole) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-1">
      {ROLES.map((r) => {
        const active = value === r.value;
        const baseClasses =
          'px-2.5 py-1 rounded text-xs font-semibold tracking-wide transition-all duration-150 select-none cursor-pointer border';
        const colorMap: Record<string, string> = {
          'slate-active':    'bg-slate-700 border-slate-700 text-white',
          'slate-idle':      'bg-white border-slate-200 text-slate-500 hover:border-slate-400 hover:text-slate-700',
          'emerald-active':  'bg-emerald-600 border-emerald-600 text-white',
          'emerald-idle':    'bg-white border-emerald-200 text-emerald-400 hover:border-emerald-400 hover:text-emerald-600',
          'blue-active':     'bg-blue-600 border-blue-600 text-white',
          'blue-idle':       'bg-white border-blue-200 text-blue-400 hover:border-blue-400 hover:text-blue-600',
          'amber-active':    'bg-amber-500 border-amber-500 text-white',
          'amber-idle':      'bg-white border-amber-200 text-amber-500 hover:border-amber-400 hover:text-amber-600',
        };
        const key = `${r.color}-${active ? 'active' : 'idle'}`;
        return (
          <button
            key={r.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(r.value)}
            className={`${baseClasses} ${colorMap[key]} disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function UserRow({
  user,
  role,
  processing,
  onRoleChange,
  onApprove,
  onReject,
  index,
}: {
  user: PendingUser;
  role: DashboardRole;
  processing: boolean;
  onRoleChange: (r: DashboardRole) => void;
  onApprove: () => void;
  onReject: () => void;
  index: number;
}) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState<'approve' | 'reject' | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), index * 60);
    return () => clearTimeout(t);
  }, [index]);

  const triggerExit = (type: 'approve' | 'reject', cb: () => void) => {
    setExiting(type);
    setTimeout(cb, 400);
  };

  const exitClasses = exiting === 'approve'
    ? 'opacity-0 translate-x-4 bg-emerald-50'
    : exiting === 'reject'
    ? 'opacity-0 -translate-x-4 bg-red-50'
    : '';

  const firstSeen = new Date(user.firstSeenAt).toLocaleString('es', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      className={`
        group relative flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4
        border-b border-slate-100 last:border-b-0
        transition-all duration-400
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}
        ${exitClasses}
      `}
    >
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-slate-200 group-hover:bg-amber-400 transition-colors duration-200" />

      {/* User info */}
      <div className="flex-1 min-w-0 pl-1">
        <p className="text-sm font-semibold text-slate-800 truncate tracking-tight">
          {user.email}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <Clock className="h-3 w-3 text-slate-300 flex-shrink-0" />
          <span className="text-xs text-slate-400 font-mono">{firstSeen}</span>
          {user.attemptCount > 1 && (
            <span className="text-xs text-amber-500 font-medium">
              · {user.attemptCount} intentos
            </span>
          )}
        </div>
      </div>

      {/* Role pills */}
      <div className="pl-1 sm:pl-0">
        <RolePills value={role} onChange={onRoleChange} disabled={processing} />
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pl-1 sm:pl-0">
        <button
          onClick={() => triggerExit('approve', onApprove)}
          disabled={processing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-semibold
                     hover:bg-emerald-500 active:scale-95 transition-all duration-150
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {processing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5" />
          )}
          Aprobar
        </button>
        <button
          onClick={() => triggerExit('reject', onReject)}
          disabled={processing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 text-slate-500 text-xs font-semibold
                     hover:border-red-300 hover:text-red-500 hover:bg-red-50 active:scale-95 transition-all duration-150
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {processing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ShieldOff className="h-3.5 w-3.5" />
          )}
          Rechazar
        </button>
      </div>
    </div>
  );
}

export function AdminPanel() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRoles, setSelectedRoles] = useState<Record<string, DashboardRole>>({});
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = async (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await adminApi.getPendingUsers();
      if (!mountedRef.current) return;
      setUsers(data);
      setSelectedRoles(prev => {
        const defaults: Record<string, DashboardRole> = {};
        data.forEach(u => { if (!prev[u.zitadelSub]) defaults[u.zitadelSub] = 'SAI_VIEWER'; });
        return { ...defaults, ...prev };
      });
    } catch {
      if (mountedRef.current) setError('No se pudieron cargar las solicitudes');
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (sub: string) => {
    setProcessing(p => ({ ...p, [sub]: true }));
    setError(null);
    try {
      await adminApi.approveUser(sub, selectedRoles[sub] || 'SAI_VIEWER');
      setUsers(u => u.filter(x => x.zitadelSub !== sub));
    } catch {
      setError('Error aprobando usuario');
      setProcessing(p => ({ ...p, [sub]: false }));
    }
  };

  const handleReject = async (sub: string) => {
    setProcessing(p => ({ ...p, [sub]: true }));
    setError(null);
    try {
      await adminApi.rejectUser(sub);
      setUsers(u => u.filter(x => x.zitadelSub !== sub));
    } catch {
      setError('Error rechazando usuario');
      setProcessing(p => ({ ...p, [sub]: false }));
    }
  };

  return (
    <section className="rounded-xl overflow-hidden border border-slate-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-slate-800">
        <div className="flex items-center gap-3">
          <UserCheck className="h-4 w-4 text-slate-400 flex-shrink-0" />
          <span className="text-sm font-semibold tracking-wide text-slate-200 uppercase" style={{ letterSpacing: '0.06em' }}>
            Control de acceso
          </span>
          {!loading && users.length > 0 && (
            <span className="flex items-center justify-center min-w-5 h-5 px-1.5 rounded bg-amber-400 text-slate-900 text-xs font-bold tabular-nums">
              {users.length}
            </span>
          )}
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing || loading}
          title="Actualizar lista"
          className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body */}
      <div className="bg-white">
        {error && (
          <div className="flex items-center gap-2 px-5 py-3 bg-red-50 border-b border-red-100 text-sm text-red-600">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-0">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0 animate-pulse">
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-slate-100 rounded w-48" />
                  <div className="h-2.5 bg-slate-100 rounded w-32" />
                </div>
                <div className="flex gap-1">
                  <div className="h-6 w-14 bg-slate-100 rounded" />
                  <div className="h-6 w-16 bg-slate-100 rounded" />
                  <div className="h-6 w-12 bg-slate-100 rounded" />
                </div>
                <div className="flex gap-2">
                  <div className="h-7 w-20 bg-slate-100 rounded" />
                  <div className="h-7 w-20 bg-slate-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="h-10 w-10 rounded-full bg-emerald-50 flex items-center justify-center mb-3">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-slate-600">Sin solicitudes pendientes</p>
            <p className="text-xs text-slate-400 mt-1">Todos los accesos están al día</p>
          </div>
        ) : (
          <div>
            {users.map((user, i) => (
              <UserRow
                key={user.zitadelSub}
                user={user}
                role={selectedRoles[user.zitadelSub] || 'SAI_VIEWER'}
                processing={!!processing[user.zitadelSub]}
                index={i}
                onRoleChange={r => setSelectedRoles(prev => ({ ...prev, [user.zitadelSub]: r }))}
                onApprove={() => handleApprove(user.zitadelSub)}
                onReject={() => handleReject(user.zitadelSub)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
