import { useState, useEffect, useRef } from 'react';
import { tokenManager } from '@/services/api';

interface SecureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** The URL to fetch (without token - will be added via Authorization header) */
  secureUrl: string;
  /** Fallback content when image fails to load */
  fallback?: React.ReactNode;
}

/**
 * SecureImage component that loads images using Authorization headers
 * instead of exposing tokens in URL query parameters.
 *
 * This prevents token leakage in:
 * - Browser history
 * - Server access logs
 * - Referrer headers
 */
export function SecureImage({
  secureUrl,
  fallback,
  alt = '',
  onLoad,
  onError,
  ...imgProps
}: SecureImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!secureUrl) {
      setLoading(false);
      setError(true);
      return;
    }

    // Abort any previous request
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    setLoading(true);
    setError(false);

    const fetchImage = async () => {
      const token = tokenManager.get();

      if (!token) {
        console.warn('SecureImage: No authentication token available');
        setError(true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(secureUrl, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          signal: abortControllerRef.current?.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setLoading(false);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return; // Request was cancelled, ignore
        }
        console.warn('SecureImage: Failed to load image', err);
        setError(true);
        setLoading(false);
      }
    };

    fetchImage();

    // Cleanup: revoke blob URL and abort request
    return () => {
      abortControllerRef.current?.abort();
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [secureUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle successful image load
  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    onLoad?.(e);
  };

  // Handle image error (blob URL failed to render)
  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setError(true);
    onError?.(e);
  };

  if (error && fallback) {
    return <>{fallback}</>;
  }

  if (loading || !blobUrl) {
    // Return nothing while loading - parent component handles loading state
    return null;
  }

  return (
    <img
      {...imgProps}
      src={blobUrl}
      alt={alt}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}

/**
 * Hook version for more complex use cases
 */
export function useSecureImage(url: string | undefined) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  // Ref tracks the latest live blob URL so the unmount cleanup can revoke it
  // without needing blobUrl in any dependency array.
  const latestBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!url) {
      setLoading(false);
      setError(true);
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(false);

    const fetchImage = async () => {
      const token = tokenManager.get();

      if (!token) {
        setError(true);
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: abortController.signal,
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        // Decode before setting state so the browser knows the image dimensions
        // the instant React renders the <img>, preventing a resize flash.
        const img = new Image();
        img.src = objectUrl;
        await img.decode().catch((decodeErr) => {
          if (import.meta.env.DEV) console.debug('SecureImage: img.decode() failed (non-fatal)', decodeErr);
        });
        if (abortController.signal.aborted) { URL.revokeObjectURL(objectUrl); return; }
        // Atomically revoke the previous blob URL and install the new one.
        if (latestBlobUrlRef.current) URL.revokeObjectURL(latestBlobUrlRef.current);
        latestBlobUrlRef.current = objectUrl;
        setBlobUrl(objectUrl);
        setLoading(false);
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchImage();

    return () => {
      abortController.abort();
    };
  }, [url]);

  // Revoke the active blob URL only on unmount (not on every blobUrl change,
  // which would revoke the URL that was just set and cause a blank frame).
  useEffect(() => {
    return () => {
      if (latestBlobUrlRef.current) URL.revokeObjectURL(latestBlobUrlRef.current);
    };
  }, []);

  return { blobUrl, loading, error };
}
