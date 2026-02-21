import { useEffect, useState } from 'react';
import { authApi } from '@/services/api';

export function PendingApproval() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const e = params.get('email');
    if (e) setEmail(e);
  }, []);

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
        <p className="text-gray-600 mb-8">
          Tu cuenta fue autenticada correctamente, pero todavía no tiene un rol
          asignado en este sistema. Un administrador revisará tu solicitud y te
          asignará acceso.
        </p>
        <p className="text-sm text-gray-400 mb-6">
          Una vez aprobado, podés iniciar sesión nuevamente para acceder al dashboard.
        </p>
        <button
          onClick={() => authApi.login()}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          Intentar iniciar sesión
        </button>
      </div>
    </div>
  );
}
