import { BrowserRouter as Router, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { HelmetProvider } from 'react-helmet-async';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SSEProvider } from '@/contexts/SSEContext';
import { LanguageProvider, useTranslation } from '@/contexts/LanguageContext';
import { Dashboard } from '@/pages/Dashboard';
import { Login } from '@/pages/Login';
import { Stats } from '@/pages/Stats';
import './index.css';

// Protected Route Component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="xl" />
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="login" replace />;
  }

  return <>{children}</>;
}

function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300">{t('notFound.title')}</h1>
        <p className="text-gray-600 mt-4">{t('notFound.message')}</p>
        <Link
          to="/"
          className="inline-block mt-6 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          {t('notFound.goToDashboard')}
        </Link>
      </div>
    </div>
  );
}

function App() {
  return (
    <HelmetProvider>
      <LanguageProvider>
      <Router basename={import.meta.env.VITE_BASE_PATH || '/'}>
        <div className="App">
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            
            {/* Protected Routes */}
            <Route 
              path="/" 
              element={
                <ProtectedRoute>
                  <SSEProvider>
                    <Dashboard />
                  </SSEProvider>
                </ProtectedRoute>
              } 
            />
            
            {/* Statistics Page */}
            <Route
              path="/stats"
              element={
                <ProtectedRoute>
                  <Stats />
                </ProtectedRoute>
              }
            />

            {/* Legacy dashboard route redirect */}
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            
            {/* 404 fallback */}
            <Route
              path="*"
              element={<NotFoundPage />}
            />
          </Routes>
        </div>

        {/* Global Toast Notifications */}
        <Toaster 
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#fff',
              color: '#374151',
              border: '1px solid #e5e7eb',
              borderRadius: '0.5rem',
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
            },
            success: {
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
      </Router>
      </LanguageProvider>
    </HelmetProvider>
  );
}

export default App;