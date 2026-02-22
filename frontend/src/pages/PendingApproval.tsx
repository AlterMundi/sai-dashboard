import { useEffect, useState, useRef, useCallback } from 'react';
import { authApi } from '@/services/api';

const POLL_INTERVAL_MS = 30_000;

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'not_found';

export function PendingApproval() {
  const [email, setEmail] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [status, setStatus] = useState<ApprovalStatus>('pending');
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEmail(params.get('email'));
    setSub(params.get('sub'));
  }, []);

  const checkStatus = useCallback(async (currentSub: string) => {
    setChecking(true);
    try {
      const result = await authApi.getPendingStatus(currentSub);
      setStatus(result.status);

      if (result.status === 'approved') {
        if (intervalRef.current) clearInterval(intervalRef.current);
        // Use loginFresh() instead of login() to force Zitadel to re-authenticate
        // and issue a new token that includes the newly assigned role grant.
        // Without this, Zitadel may reuse the cached SSO session and return a token
        // without the new grant, causing an infinite redirect loop to pending-approval.
        setTimeout(() => authApi.loginFresh(), 1500);
      } else if (result.status === 'rejected') {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!sub) return;

    checkStatus(sub);
    intervalRef.current = setInterval(() => checkStatus(sub), POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [sub, checkStatus]);

  if (status === 'approved') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">✅</div>
          <h1 className="text-2xl font-semibold text-gray-800 mb-3">¡Acceso aprobado!</h1>
          <p className="text-gray-600">Iniciando sesión…</p>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6">🚫</div>
          <h1 className="text-2xl font-semibold text-gray-800 mb-3">Solicitud rechazada</h1>
          <p className="text-gray-600">
            Tu solicitud de acceso no fue aprobada. Contactá al administrador del sistema
            si creés que esto es un error.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="text-6xl mb-6">🔐</div>
        <h1 className="text-2xl font-semibold text-gray-800 mb-3">
          Acceso pendiente de aprobación
        </h1>
        {email && (
          <p className="text-sm text-gray-500 mb-2">
            Cuenta: <span className="font-medium text-gray-700">{email}</span>
          </p>
        )}
        <p className="text-gray-600 mb-6">
          Tu cuenta fue autenticada correctamente, pero todavía no tiene un rol
          asignado en este sistema. Un administrador revisará tu solicitud.
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-6">
          <span
            className={`inline-block w-2 h-2 rounded-full ${checking ? 'bg-blue-400 animate-pulse' : 'bg-gray-300'}`}
          />
          {checking ? 'Verificando estado…' : 'Verificación automática cada 30 segundos'}
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => sub && checkStatus(sub)}
            disabled={checking || !sub}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Comprobar ahora
          </button>
          <button
            onClick={() => authApi.login()}
            className="px-5 py-2.5 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors text-sm"
          >
            Intentar iniciar sesión manualmente
          </button>
        </div>
      </div>
    </div>
  );
}
