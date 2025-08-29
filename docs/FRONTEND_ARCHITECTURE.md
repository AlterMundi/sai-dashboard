# Frontend Component Architecture Guide

**React component hierarchy and state management strategy for SAI Dashboard**

---

## 🏗️ Architecture Overview

### Component Hierarchy
```
App
├── AuthProvider (Context)
├── Router
│   ├── LoginPage
│   └── DashboardLayout
│       ├── Header
│       │   ├── Logo
│       │   ├── StatusIndicator
│       │   └── UserMenu
│       ├── Sidebar (optional)
│       │   ├── FilterPanel
│       │   └── StatsPanel
│       └── MainContent
│           ├── ImageGallery
│           │   ├── GalleryControls
│           │   ├── ImageGrid
│           │   │   └── ImageCard[]
│           │   └── LoadMoreButton
│           ├── ImageModal
│           │   ├── ImageViewer
│           │   ├── AnalysisOverlay
│           │   └── ExecutionDetails
│           └── SSEProvider (Context)
```

---

## 📦 Core Dependencies

### React Ecosystem
```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^6.15.0",
  "@tanstack/react-query": "^4.35.0"
}
```

### UI & Styling
```json
{
  "tailwindcss": "^3.3.3",
  "@headlessui/react": "^1.7.17",
  "@heroicons/react": "^2.0.18",
  "clsx": "^2.0.0"
}
```

### Image Handling
```json
{
  "react-image": "^4.1.0",
  "react-intersection-observer": "^9.5.2",
  "react-virtualized-auto-sizer": "^1.0.20"
}
```

### Development Tools
```json
{
  "vite": "^4.4.9",
  "typescript": "^5.2.2",
  "@types/react": "^18.2.21",
  "@types/react-dom": "^18.2.7"
}
```

---

## 🎯 Component Specifications

### 1. App Component
```tsx
// App.tsx - Root application component
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { Router } from './components/Router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 3,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

### 2. Authentication Context
```tsx
// contexts/AuthContext.tsx - Authentication state management
interface AuthContextType {
  isAuthenticated: boolean;
  token: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
  error: string | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    localStorage.getItem('sai-token')
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (password: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      
      if (response.ok) {
        const { token } = await response.json();
        setToken(token);
        localStorage.setItem('sai-token', token);
        return true;
      } else {
        setError('Invalid password');
        return false;
      }
    } catch (err) {
      setError('Login failed');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setToken(null);
    localStorage.removeItem('sai-token');
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!token,
        token,
        login,
        logout,
        isLoading,
        error,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
```

### 3. Image Gallery Component
```tsx
// components/ImageGallery.tsx - Main gallery with lazy loading
import { useInfiniteQuery } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';

interface ImageGalleryProps {
  filters: FilterState;
}

export function ImageGallery({ filters }: ImageGalleryProps) {
  const { ref, inView } = useInView();
  
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: ['executions', filters],
    queryFn: ({ pageParam = 0 }) =>
      fetchExecutions({ ...filters, offset: pageParam }),
    getNextPageParam: (lastPage, pages) => {
      if (lastPage.meta.hasMore) {
        return pages.length * 50; // 50 items per page
      }
      return undefined;
    },
  });

  useEffect(() => {
    if (inView && hasNextPage) {
      fetchNextPage();
    }
  }, [inView, fetchNextPage, hasNextPage]);

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;

  const executions = data?.pages.flatMap(page => page.data) ?? [];

  return (
    <div className="image-gallery">
      <GalleryControls filters={filters} />
      
      <ImageGrid>
        {executions.map((execution) => (
          <ImageCard
            key={execution.id}
            execution={execution}
            onClick={() => openModal(execution)}
          />
        ))}
      </ImageGrid>

      {/* Infinite scroll trigger */}
      <div ref={ref} className="h-4" />
      
      {isFetchingNextPage && <LoadingSpinner />}
    </div>
  );
}
```

### 4. Image Card Component
```tsx
// components/ImageCard.tsx - Individual execution display
interface ImageCardProps {
  execution: Execution;
  onClick: () => void;
}

export function ImageCard({ execution, onClick }: ImageCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  return (
    <div
      className={clsx(
        'relative bg-white rounded-lg shadow-md overflow-hidden cursor-pointer',
        'hover:shadow-lg transition-shadow duration-200',
        'aspect-square'
      )}
      onClick={onClick}
    >
      {/* Status Badge */}
      <StatusBadge
        status={execution.status}
        className="absolute top-2 left-2 z-10"
      />

      {/* Image with lazy loading */}
      <div className="relative w-full h-full">
        {!imageLoaded && !imageError && (
          <div className="flex items-center justify-center h-full bg-gray-100">
            <div className="animate-pulse w-8 h-8 bg-gray-300 rounded" />
          </div>
        )}
        
        <img
          src={execution.thumbnailUrl}
          alt={`Execution ${execution.id}`}
          className={clsx(
            'w-full h-full object-cover transition-opacity duration-300',
            imageLoaded ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => setImageLoaded(true)}
          onError={() => setImageError(true)}
          loading="lazy"
        />

        {imageError && (
          <div className="flex items-center justify-center h-full bg-gray-100">
            <span className="text-gray-500">Image unavailable</span>
          </div>
        )}
      </div>

      {/* Execution Info Overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-3">
        <div className="text-white text-sm">
          <div className="font-medium">#{execution.id}</div>
          <div className="text-xs opacity-90">
            {formatRelativeTime(execution.startedAt)}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 5. Image Modal Component
```tsx
// components/ImageModal.tsx - Full-screen image viewer
interface ImageModalProps {
  execution: Execution | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageModal({ execution, isOpen, onClose }: ImageModalProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

  if (!isOpen || !execution) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-90">
      <div className="flex h-full">
        {/* Image Viewer */}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="relative max-w-full max-h-full">
            {!imageLoaded && (
              <div className="flex items-center justify-center w-96 h-96">
                <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full" />
              </div>
            )}
            
            <img
              src={execution.imageUrl}
              alt={`Execution ${execution.id}`}
              className={clsx(
                'max-w-full max-h-full object-contain transition-opacity duration-300',
                imageLoaded ? 'opacity-100' : 'opacity-0'
              )}
              onLoad={() => setImageLoaded(true)}
            />
          </div>
        </div>

        {/* Analysis Sidebar */}
        <div className="w-80 bg-white flex flex-col">
          <ModalHeader execution={execution} onClose={onClose} />
          
          <div className="flex-1 overflow-y-auto p-4">
            <AnalysisDetails execution={execution} />
            <ExecutionTimeline execution={execution} />
            <TelegramStatus execution={execution} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 6. SSE Provider Component
```tsx
// contexts/SSEContext.tsx - Server-Sent Events management
interface SSEContextType {
  isConnected: boolean;
  connectionError: string | null;
  lastEvent: SSEEvent | null;
}

export function SSEProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!token) return;

    const eventSource = new EventSource('/api/events', {
      headers: { Authorization: `Bearer ${token}` },
    });

    eventSource.addEventListener('execution:new', (event) => {
      const execution = JSON.parse(event.data);
      setLastEvent({ type: 'execution:new', data: execution });
      
      // Invalidate and update cache
      queryClient.invalidateQueries(['executions']);
      queryClient.setQueryData(['executions'], (oldData: any) => {
        if (!oldData) return oldData;
        return {
          ...oldData,
          pages: [
            {
              ...oldData.pages[0],
              data: [execution, ...oldData.pages[0].data],
            },
            ...oldData.pages.slice(1),
          ],
        };
      });
    });

    eventSource.addEventListener('execution:error', (event) => {
      const execution = JSON.parse(event.data);
      setLastEvent({ type: 'execution:error', data: execution });
      
      // Show error notification
      showNotification({
        type: 'error',
        title: 'Execution Failed',
        message: `Execution ${execution.id} failed`,
      });
    });

    eventSource.onopen = () => {
      setIsConnected(true);
      setConnectionError(null);
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      setConnectionError('Connection lost');
    };

    return () => {
      eventSource.close();
    };
  }, [token, queryClient]);

  return (
    <SSEContext.Provider value={{ isConnected, connectionError, lastEvent }}>
      {children}
    </SSEContext.Provider>
  );
}
```

---

## 🎨 Styling Strategy

### Tailwind Configuration
```js
// tailwind.config.js
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#f0f9ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
      },
      aspectRatio: {
        'square': '1 / 1',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio'),
  ],
};
```

### Component Styling Patterns
```tsx
// Consistent styling patterns using clsx
const buttonStyles = {
  base: 'inline-flex items-center px-4 py-2 rounded-md font-medium transition-colors',
  variants: {
    primary: 'bg-primary-600 text-white hover:bg-primary-700',
    secondary: 'bg-gray-200 text-gray-900 hover:bg-gray-300',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  },
  sizes: {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  },
};

export function Button({ variant = 'primary', size = 'md', className, ...props }) {
  return (
    <button
      className={clsx(
        buttonStyles.base,
        buttonStyles.variants[variant],
        buttonStyles.sizes[size],
        className
      )}
      {...props}
    />
  );
}
```

---

## 🔄 State Management Strategy

### React Query for Server State
```tsx
// hooks/useExecutions.ts - Server state management
export function useExecutions(filters: FilterState) {
  return useInfiniteQuery({
    queryKey: ['executions', filters],
    queryFn: ({ pageParam = 0 }) => api.fetchExecutions({ ...filters, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.meta.hasMore ? lastPage.meta.nextOffset : undefined,
    staleTime: 30 * 1000, // 30 seconds
    cacheTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useExecution(executionId: number) {
  return useQuery({
    queryKey: ['execution', executionId],
    queryFn: () => api.fetchExecution(executionId),
    enabled: !!executionId,
    staleTime: 5 * 60 * 1000, // 5 minutes (executions don't change)
  });
}
```

### Local State for UI
```tsx
// hooks/useLocalState.ts - UI state management
export function useModalState() {
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openModal = (execution: Execution) => {
    setSelectedExecution(execution);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedExecution(null);
  };

  return { selectedExecution, isModalOpen, openModal, closeModal };
}

export function useFilters() {
  const [filters, setFilters] = useState<FilterState>({
    status: 'all',
    days: 30,
    search: '',
  });

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return { filters, updateFilter, setFilters };
}
```

---

## 📱 Responsive Design Strategy

### Breakpoint System
```tsx
// utils/responsive.ts
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// Responsive grid classes
export const gridClasses = {
  // Gallery grid responsiveness
  gallery: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4',
  
  // Modal layout
  modal: 'flex flex-col lg:flex-row h-full',
  modalSidebar: 'w-full lg:w-80 bg-white flex flex-col',
  modalImage: 'flex-1 flex items-center justify-center p-4',
};
```

### Mobile-First Components
```tsx
// components/MobileNavigation.tsx
export function MobileNavigation() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile menu button */}
      <button
        className="lg:hidden p-2"
        onClick={() => setIsOpen(true)}
      >
        <Bars3Icon className="w-6 h-6" />
      </button>

      {/* Mobile slide-over menu */}
      <Transition show={isOpen}>
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black bg-opacity-25" />
          <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-lg">
            <FilterPanel onClose={() => setIsOpen(false)} />
          </div>
        </div>
      </Transition>
    </>
  );
}
```

---

## ⚡ Performance Optimizations

### Image Loading Strategy
```tsx
// components/LazyImage.tsx - Optimized image loading
interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  onLoad?: () => void;
}

export function LazyImage({ src, alt, className, onLoad }: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const { ref, inView } = useInView({
    threshold: 0,
    triggerOnce: true,
  });

  useEffect(() => {
    if (inView) {
      setIsInView(true);
    }
  }, [inView]);

  return (
    <div ref={ref} className={clsx('relative', className)}>
      {isInView && (
        <img
          src={src}
          alt={alt}
          className={clsx(
            'transition-opacity duration-300',
            isLoaded ? 'opacity-100' : 'opacity-0'
          )}
          onLoad={() => {
            setIsLoaded(true);
            onLoad?.();
          }}
          loading="lazy"
        />
      )}
      
      {(!isInView || !isLoaded) && (
        <div className="absolute inset-0 bg-gray-200 animate-pulse" />
      )}
    </div>
  );
}
```

### Virtual Scrolling (Future Enhancement)
```tsx
// For very large galleries (1000+ images)
import { FixedSizeGrid as Grid } from 'react-window';

export function VirtualizedGallery({ executions }: { executions: Execution[] }) {
  const Cell = ({ columnIndex, rowIndex, style }: any) => {
    const index = rowIndex * 5 + columnIndex; // 5 columns
    const execution = executions[index];
    
    if (!execution) return null;

    return (
      <div style={style} className="p-2">
        <ImageCard execution={execution} />
      </div>
    );
  };

  return (
    <Grid
      columnCount={5}
      columnWidth={200}
      height={600}
      rowCount={Math.ceil(executions.length / 5)}
      rowHeight={220}
      width="100%"
    >
      {Cell}
    </Grid>
  );
}
```

---

## 🧪 Testing Strategy

### Component Testing
```tsx
// __tests__/ImageCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageCard } from '../components/ImageCard';

const mockExecution: Execution = {
  id: 1,
  status: 'success',
  startedAt: '2025-08-28T10:00:00Z',
  thumbnailUrl: '/api/executions/1/image?size=thumbnail',
};

describe('ImageCard', () => {
  it('renders execution information correctly', () => {
    render(<ImageCard execution={mockExecution} onClick={() => {}} />);
    
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = jest.fn();
    render(<ImageCard execution={mockExecution} onClick={onClick} />);
    
    fireEvent.click(screen.getByRole('img'));
    expect(onClick).toHaveBeenCalled();
  });

  it('handles image loading states', async () => {
    render(<ImageCard execution={mockExecution} onClick={() => {}} />);
    
    // Should show loading state initially
    expect(screen.getByTestId('loading-placeholder')).toBeInTheDocument();
  });
});
```

---

## 📁 Complete package.json

```json
{
  "name": "sai-dashboard-ui",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "lint:fix": "eslint . --ext ts,tsx --fix",
    "format": "prettier --write src/**/*.{ts,tsx}",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.15.0",
    "@tanstack/react-query": "^4.35.0",
    "@headlessui/react": "^1.7.17",
    "@heroicons/react": "^2.0.18",
    "clsx": "^2.0.0",
    "react-intersection-observer": "^9.5.2"
  },
  "devDependencies": {
    "@types/react": "^18.2.21",
    "@types/react-dom": "^18.2.7",
    "@typescript-eslint/eslint-plugin": "^6.4.1",
    "@typescript-eslint/parser": "^6.4.1",
    "@vitejs/plugin-react": "^4.0.4",
    "autoprefixer": "^10.4.15",
    "eslint": "^8.47.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.3",
    "postcss": "^8.4.29",
    "prettier": "^3.0.2",
    "tailwindcss": "^3.3.3",
    "typescript": "^5.2.2",
    "vite": "^4.4.9",
    "vitest": "^0.34.4",
    "@testing-library/react": "^13.4.0",
    "@testing-library/jest-dom": "^6.1.3"
  }
}
```

This architecture provides a solid foundation for the SAI Dashboard frontend with optimal performance, maintainability, and user experience.

---

*Frontend Architecture Guide Version: 1.0*  
*Last Updated: August 28, 2025*