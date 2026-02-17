import { ReactNode, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSSE } from '@/contexts/SSEContext';
import { useTranslation } from '@/contexts/LanguageContext';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { SettingsDropdown } from './SettingsDropdown';
import { cn } from '@/utils';
import {
  LogOut,
  Activity,
  Users,
  BarChart3,
  Image as ImageIcon,
  Home,
  Menu,
  X,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';

interface LayoutProps {
  children: ReactNode;
  className?: string;
}

export function Layout({ children, className }: LayoutProps) {
  const { logout, isLoading: authLoading } = useAuth();
  const { isConnected, clientCount, lastEvent } = useSSE();
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      toast.error(t('login.logoutFailed'));
    }
  };

  const navLinks = [
    { to: '/', labelKey: 'nav.gallery', icon: Home },
    { to: '/stats', labelKey: 'nav.statistics', icon: BarChart3 },
  ];

  const isActiveRoute = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <LoadingSpinner size="xl" />
          <p className="mt-4 text-gray-600">{t('loadingDashboard')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Header */}
      <nav className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo and Title */}
            <div className="flex items-center">
              <div className="flex items-center">
                <div className="flex-shrink-0 flex items-center">
                  <div className="h-8 w-8 bg-primary-600 rounded-lg flex items-center justify-center">
                    <ImageIcon className="h-5 w-5 text-white" aria-hidden="true" />
                  </div>
                  <h1 className="ml-3 text-xl font-semibold text-gray-900">
                    SAI Dashboard
                  </h1>
                </div>
              </div>

              {/* Desktop Navigation Links */}
              <div className="hidden md:block ml-10">
                <div className="flex items-baseline space-x-4">
                  {navLinks.map(({ to, labelKey, icon: Icon }) => (
                    <Link
                      key={to}
                      to={to}
                      className={cn(
                        'px-3 py-2 rounded-md text-sm font-medium flex items-center transition-colors',
                        isActiveRoute(to)
                          ? 'text-primary-600 bg-primary-50'
                          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                      )}
                    >
                      <Icon className="h-4 w-4 mr-2" aria-hidden="true" />
                      {t(labelKey)}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Right side controls */}
            <div className="flex items-center space-x-4">
              {/* Connection Status: dot · clients · last update */}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <div className={cn(
                  "h-2 w-2 rounded-full flex-shrink-0",
                  isConnected ? "bg-green-500" : "bg-red-500"
                )} title={isConnected ? t('nav.connected') : t('nav.disconnected')} />
                {clientCount > 0 && (
                  <span className="flex items-center gap-0.5">
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {clientCount}
                  </span>
                )}
                {lastEvent?.timestamp && (
                  <span className="hidden sm:inline text-gray-400">
                    {t('nav.updated')}: {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(lastEvent.timestamp)}
                  </span>
                )}
              </div>

              {/* Settings Dropdown */}
              <SettingsDropdown className="hidden sm:block" />

              {/* Logout Button - Desktop */}
              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title={t('nav.signOut')}
              >
                <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
                <span>{t('nav.signOut')}</span>
              </button>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                aria-expanded={mobileMenuOpen}
                aria-label={t('nav.toggleMenu')}
              >
                {mobileMenuOpen ? (
                  <X className="h-6 w-6" aria-hidden="true" />
                ) : (
                  <Menu className="h-6 w-6" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <div className="px-4 py-3 space-y-1">
              {navLinks.map(({ to, labelKey, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center px-3 py-2 rounded-md text-base font-medium transition-colors',
                    isActiveRoute(to)
                      ? 'text-primary-600 bg-primary-50'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
                  )}
                >
                  <Icon className="h-5 w-5 mr-3" aria-hidden="true" />
                  {t(labelKey)}
                </Link>
              ))}

              <hr className="my-2 border-gray-200" />

              <SettingsDropdown className="w-full" />

              <button
                onClick={() => {
                  handleLogout();
                  setMobileMenuOpen(false);
                }}
                className="flex items-center w-full px-3 py-2 rounded-md text-base font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                <LogOut className="h-5 w-5 mr-3" aria-hidden="true" />
                {t('nav.signOut')}
              </button>
            </div>
          </div>
        )}
      </nav>

      {/* Main Content */}
      <main className={cn('max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8', className)}>
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-8 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center text-sm text-gray-500">
              <Activity className="h-4 w-4 mr-2" aria-hidden="true" />
              <span>{t('footer.title')}</span>
              <span className="mx-2">•</span>
              <span>{t('footer.version')}</span>
            </div>

            <div className="flex items-center space-x-6 mt-4 md:mt-0 text-sm text-gray-500">
              <span>{t('footer.subtitle')}</span>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-success-500 rounded-full mr-2 animate-pulse"></div>
                <span>{t('footer.productionReady')}</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
