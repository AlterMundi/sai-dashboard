import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { LoadingSpinner } from './ui/LoadingSpinner';
import { cn } from '@/utils';
import { Eye, EyeOff, Lock, Shield, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface LoginFormProps {
  onSuccess?: () => void;
  className?: string;
}

export function LoginForm({ onSuccess, className }: LoginFormProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { login, isLoading, error } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!password.trim()) {
      toast.error('Password is required');
      return;
    }

    try {
      await login(password);
      toast.success('Successfully logged in!');
      onSuccess?.();
    } catch (error) {
      // Error is already handled by useAuth and shown in the form
      console.error('Login failed:', error);
    }
  };

  return (
    <div className={cn('w-full max-w-md mx-auto', className)}>
      <div className="bg-white shadow-lg rounded-lg p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-100 rounded-full mb-4">
            <Shield className="h-8 w-8 text-primary-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">SAI Dashboard</h1>
          <p className="text-gray-600 mt-2">
            Enter your dashboard password to continue
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-danger-50 border border-danger-200 rounded-lg flex items-start">
            <AlertCircle className="h-5 w-5 text-danger-600 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="text-sm font-medium text-danger-800">Login Failed</h3>
              <p className="text-sm text-danger-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              Dashboard Password
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-gray-400" />
              </div>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(
                  'block w-full pl-10 pr-10 py-3 border rounded-lg text-sm',
                  'focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
                  'placeholder-gray-400',
                  error
                    ? 'border-danger-300 bg-danger-50'
                    : 'border-gray-300 bg-white hover:border-gray-400'
                )}
                placeholder="Enter your password"
                disabled={isLoading}
                autoComplete="current-password"
                autoFocus
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                ) : (
                  <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className={cn(
              'w-full flex items-center justify-center py-3 px-4 rounded-lg text-sm font-medium',
              'transition-colors duration-200',
              'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500',
              isLoading || !password.trim()
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700 text-white'
            )}
          >
            {isLoading ? (
              <>
                <LoadingSpinner size="sm" color="white" className="mr-2" />
                Signing in...
              </>
            ) : (
              <>
                <Shield className="h-4 w-4 mr-2" />
                Sign In
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500">
            SAI Image Analysis Dashboard v1.0.0
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Visual management interface for n8n workflows
          </p>
        </div>
      </div>

      {/* Security Note */}
      <div className="mt-6 text-center">
        <p className="text-xs text-gray-500">
          🔐 This is a secure area. All sessions are encrypted and monitored.
        </p>
      </div>
    </div>
  );
}