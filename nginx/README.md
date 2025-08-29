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

## 📁 Clean Directory

- **`sai-production.conf`** - THE definitive configuration
- **`README.md`** - This guide

All experimental/obsolete files removed for clarity.