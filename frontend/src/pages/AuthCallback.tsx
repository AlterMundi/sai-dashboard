import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '@/services/api';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

export function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const found = authApi.getTokenFromUrl();
      if (found) {
        navigate('/', { replace: true });
      } else {
        setError('No se recibió token de autenticación. Por favor intenta iniciar sesión nuevamente.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de autenticación desconocido.');
    }
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="text-red-500 text-5xl mb-4">⚠</div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">Error de autenticación</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => authApi.login()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Volver al inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <LoadingSpinner size="xl" />
        <p className="mt-4 text-gray-600">Completando autenticación…</p>
      </div>
    </div>
  );
}
