# SAI Dashboard nginx Configuration

## 🎯 The ONLY File You Need

**File: `sai-production.conf`**
- ✅ **Domain**: sai.altermundi.net/dashboard/  
- ✅ **Self-Contained**: No URL rewriting, no conflicts
- ✅ **Tested**: Local development confirmed working
- ✅ **Clean**: Single location block handles everything

## 🚀 Quick Deployment

1. **Start Services:**
   ```bash
   # Backend (port 3001) - Self-contained under /dashboard/api
   cd backend && npm run dev
   
   # Frontend (port 3000) - With updated Vite proxy
   cd frontend
   VITE_BASE_PATH=/dashboard/ VITE_API_URL=/dashboard/api npm run dev
   ```

2. **Deploy nginx Configuration:**
   ```bash
   # Copy the COMPLETE server block from sai-production.conf
   # to your sai.altermundi.net nginx configuration
   
   sudo nginx -t && sudo systemctl reload nginx
   ```

3. **Access Dashboard:**
   - URL: https://sai.altermundi.net/dashboard/
   - Password: `CHANGE_THIS_SECURE_PASSWORD_2025`

## ✅ Self-Contained Benefits

- **Zero Conflicts**: Existing `/api/` → SAI Proxy (port 8003) untouched
- **No URL Rewriting**: Backend handles `/dashboard/api/*` natively
- **Simple nginx**: One location block with conditional routing
- **Future-Proof**: Standard web application pattern

## Image Serving via X-Accel-Redirect

Image requests flow through Express for **auth + path resolution only**, then nginx serves the file directly from disk via `X-Accel-Redirect` (zero-copy `sendfile` syscall). Node.js never touches image bytes.

```
Client → nginx → Express (auth + resolve path) → X-Accel-Redirect header
                 nginx ← /internal-images/... → sendfile from disk → Client
```

The `/internal-images/` location is marked `internal`, so direct requests return 404. Only Express can trigger it via the `X-Accel-Redirect` response header.

Key nginx directives:
- `proxy_buffering on` on the API location (required for X-Accel-Redirect)
- `proxy_buffering off` on the SSE location (required for streaming)
- `open_file_cache` on the internal location for hot-image FD caching

The Express fallback (`res.sendFile`) is used in development when nginx is not present.

## Files

- **`sai-dashboard-docker.conf`** - Docker deployment (matches live server config)
- **`sai-production.conf`** - Reference production config
- **`sai-dashboard-local.conf`** - Local development with nginx
- **`README.md`** - This guide