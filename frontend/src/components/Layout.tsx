import { ReactNode, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSSE } from '@/contexts/SSEContext';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { cn } from '@/utils';
import {
  LogOut,
  Activity,
  Users,
  Wifi,
  WifiOff,
  RefreshCw,
  Settings,
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
  const { isConnected, connectionStatus, clientCount } = useSSE();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      toast.error('Logout failed');
    }
  };

  const handleSettingsClick = () => {
    toast('Settings coming soon', { icon: '⚙️' });
  };

  const getConnectionStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi className="h-4 w-4 text-success-600" />;
      case 'connecting':
        return <RefreshCw className="h-4 w-4 text-warning-600 animate-spin" />;
      case 'error':
        return <WifiOff className="h-4 w-4 text-danger-600" />;
      default:
        return <WifiOff className="h-4 w-4 text-gray-400" />;
    }
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Real-time connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Connection failed';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown status';
    }
  };

  const navLinks = [
    { to: '/', label: 'Gallery', icon: Home },
    { to: '/stats', label: 'Statistics', icon: BarChart3 },
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
          <p className="mt-4 text-gray-600">Loading dashboard...</p>
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
                  {navLinks.map(({ to, label, icon: Icon }) => (
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
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Right side controls */}
            <div className="flex items-center space-x-4">
              {/* Connection Status */}
              <div className="flex items-center space-x-2 text-sm">
                {getConnectionStatusIcon()}
                <span className="hidden sm:inline text-gray-600">
                  {getConnectionStatusText()}
                </span>
                {isConnected && clientCount > 0 && (
                  <div className="flex items-center text-xs text-gray-500">
                    <Users className="h-3 w-3 mr-1" aria-hidden="true" />
                    {clientCount}
                  </div>
                )}
              </div>

              {/* Settings Button */}
              <button
                onClick={handleSettingsClick}
                className="hidden sm:block p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Settings"
                aria-label="Settings"
              >
                <Settings className="h-5 w-5" aria-hidden="true" />
              </button>

              {/* Logout Button - Desktop */}
              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center px-3 py-2 text-sm text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title="Sign out"
              >
                <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
                <span>Sign out</span>
              </button>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                aria-expanded={mobileMenuOpen}
                aria-label="Toggle menu"
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
              {navLinks.map(({ to, label, icon: Icon }) => (
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
                  {label}
                </Link>
              ))}

              <hr className="my-2 border-gray-200" />

              <button
                onClick={() => {
                  handleSettingsClick();
                  setMobileMenuOpen(false);
                }}
                className="flex items-center w-full px-3 py-2 rounded-md text-base font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                <Settings className="h-5 w-5 mr-3" aria-hidden="true" />
                Settings
              </button>

              <button
                onClick={() => {
                  handleLogout();
                  setMobileMenuOpen(false);
                }}
                className="flex items-center w-full px-3 py-2 rounded-md text-base font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
              >
                <LogOut className="h-5 w-5 mr-3" aria-hidden="true" />
                Sign out
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
              <span>SAI Image Analysis Dashboard</span>
              <span className="mx-2">•</span>
              <span>v1.0.0</span>
            </div>

            <div className="flex items-center space-x-6 mt-4 md:mt-0 text-sm text-gray-500">
              <span>Visual interface for n8n workflows</span>
              <div className="flex items-center">
                <div className="h-2 w-2 bg-success-500 rounded-full mr-2 animate-pulse"></div>
                <span>Production Ready</span>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
