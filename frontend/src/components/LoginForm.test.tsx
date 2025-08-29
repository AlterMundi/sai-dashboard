import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginForm } from './LoginForm';
import { 
  renderWithProviders, 
  screen, 
  fireEvent,
  waitFor,
  userEvent
} from '@/test/test-utils';
import * as useAuthModule from '@/hooks/useAuth';
import * as toast from 'react-hot-toast';

vi.mock('@/hooks/useAuth');
vi.mock('react-hot-toast');

describe('LoginForm', () => {
  const mockLogin = vi.fn();
  const mockOnSuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(useAuthModule).useAuth = vi.fn().mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      login: mockLogin,
      logout: vi.fn(),
      token: null,
      error: null,
    });
  });

  it('renders login form with all elements', () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);

    expect(screen.getByText(/SAI Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Enter your dashboard password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Dashboard Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });

  it('allows typing in password field', async () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = screen.getByLabelText(/Dashboard Password/i) as HTMLInputElement;
    const user = userEvent.setup();
    
    await user.type(passwordInput, 'test-password');
    
    expect(passwordInput.value).toBe('test-password');
  });

  it('toggles password visibility', async () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = screen.getByLabelText(/Dashboard Password/i) as HTMLInputElement;
    const toggleButton = screen.getByRole('button', { name: '' }); // Eye icon button
    
    // Initially password type
    expect(passwordInput.type).toBe('password');
    
    // Click to show password
    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('text');
    
    // Click to hide password
    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('password');
  });

  it('submits form with valid password', async () => {
    mockLogin.mockResolvedValue(undefined);
    
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = screen.getByLabelText(/Dashboard Password/i);
    const submitButton = screen.getByRole('button', { name: /Sign In/i });
    
    const user = userEvent.setup();
    await user.type(passwordInput, 'valid-password');
    
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('valid-password');
      expect(toast.success).toHaveBeenCalledWith('Successfully logged in!');
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('shows error when password is empty', async () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const submitButton = screen.getByRole('button', { name: /Sign In/i });
    
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Password is required');
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });

  it('displays error message from hook', () => {
    vi.mocked(useAuthModule).useAuth = vi.fn().mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      login: mockLogin,
      logout: vi.fn(),
      token: null,
      error: 'Invalid credentials',
    });

    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    expect(screen.getByText(/Login Failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Invalid credentials/i)).toBeInTheDocument();
  });

  it('disables form during loading', () => {
    vi.mocked(useAuthModule).useAuth = vi.fn().mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      login: mockLogin,
      logout: vi.fn(),
      token: null,
      error: null,
    });

    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = screen.getByLabelText(/Dashboard Password/i) as HTMLInputElement;
    const submitButton = screen.getByRole('button', { name: /Signing in/i });
    
    expect(passwordInput).toBeDisabled();
    expect(submitButton).toBeDisabled();
    expect(screen.getByText(/Signing in.../i)).toBeInTheDocument();
  });

  it('handles login failure gracefully', async () => {
    const error = new Error('Network error');
    mockLogin.mockRejectedValue(error);
    
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = screen.getByLabelText(/Dashboard Password/i);
    const submitButton = screen.getByRole('button', { name: /Sign In/i });
    
    const user = userEvent.setup();
    await user.type(passwordInput, 'test-password');
    
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test-password');
      expect(mockOnSuccess).not.toHaveBeenCalled();
      // Error should be handled by the hook
    });
  });

  it('prevents form submission with Enter key when password is empty', async () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const form = screen.getByLabelText(/Dashboard Password/i).closest('form');
    
    fireEvent.submit(form!);
    
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Password is required');
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });

  it('submits form with Enter key when password is provided', async () => {
    mockLogin.mockResolvedValue(undefined);
    
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = screen.getByLabelText(/Dashboard Password/i);
    
    const user = userEvent.setup();
    await user.type(passwordInput, 'test-password');
    await user.keyboard('{Enter}');
    
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test-password');
    });
  });

  it('focuses password input on mount', () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = screen.getByLabelText(/Dashboard Password/i);
    expect(document.activeElement).toBe(passwordInput);
  });

  it('applies error styling when there is an error', () => {
    vi.mocked(useAuthModule).useAuth = vi.fn().mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      login: mockLogin,
      logout: vi.fn(),
      token: null,
      error: 'Invalid password',
    });

    const { container } = renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    const passwordInput = container.querySelector('input[type="password"]');
    expect(passwordInput?.className).toContain('border-danger-300');
    expect(passwordInput?.className).toContain('bg-danger-50');
  });

  it('displays version information', () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    expect(screen.getByText(/SAI Image Analysis Dashboard v1.0.0/i)).toBeInTheDocument();
    expect(screen.getByText(/Visual management interface for n8n workflows/i)).toBeInTheDocument();
  });

  it('shows security notice', () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />);
    
    expect(screen.getByText(/This is a secure area/i)).toBeInTheDocument();
  });
});