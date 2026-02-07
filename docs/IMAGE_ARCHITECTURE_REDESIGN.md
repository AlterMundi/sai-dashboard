# Image Architecture Redesign Proposal

## Current Problems

1. **No Raw Frames** - Only annotated images (with bounding boxes) are stored
2. **Triple File Redundancy** - 3 files per execution (original.jpg, webp, thumb.webp)
3. **Express Serving** - Node.js handles every image request (inefficient)
4. **Path Complexity** - 3 fallback patterns, stored paths vs computed paths
5. **Storage Inflexibility** - Tightly coupled to filesystem

---

## Requirements (Clarified)

### Use Cases
1. **Quick Review** - Dashboard gallery with thumbnails, click for detail
2. **Dataset Construction** - Raw frames + detection metadata for ML training
3. **Re-analysis** - Ability to re-run YOLO on raw frames

### Image Types Needed
| Type | Purpose | When Generated |
|------|---------|----------------|
| **Raw Frame** | Archive, re-analysis, dataset | At capture (before YOLO) |
| **Annotated** | Visual verification of detections | Optional, can regenerate |
| **Thumbnail** | Gallery quick preview | On-demand or pre-generated |

### Storage Goals
- Raw frames are the source of truth
- Bounding boxes drawn programmatically in frontend (already implemented!)
- Efficient serving for web gallery (not through Node.js)

---

## Proposed Architecture

### 1. Image Source: Raw Frames

**Option A: Modify YOLO Inference Service** (Recommended)

```python
# In /opt/sai-inference/src/models.py
class InferenceResponse(BaseModel):
    # ... existing fields ...
    annotated_image: Optional[str] = None  # Keep for backward compat
    input_image: Optional[str] = None      # NEW: Raw frame base64
```

```python
# In inference endpoint
return InferenceResponse(
    # ... existing ...
    annotated_image=annotated_base64 if include_annotated else None,
    input_image=input_base64 if include_raw else None,  # NEW
)
```

**Benefit:** Single source change, n8n workflow unchanged, ETL just extracts different field.

### 2. Storage Schema: Simplified

**Current (3 files, stored paths):**
```
execution_images:
  - original_path: "original/410/410000.jpg"
  - thumbnail_path: "thumb/410/410000.webp"
  - cached_path: "webp/410/410000.webp"
```

**Proposed (1 file, computed paths):**
```
execution_images:
  - has_image: boolean
  - image_hash: varchar(64)  -- Optional: for deduplication
  - size_bytes: integer
  - width: integer
  - height: integer
```

**Path Convention (computed, not stored):**
```
{BASE_PATH}/raw/{partition}/{execution_id}.jpg

Partition = execution_id // 1000
Example: /images/raw/410/410123.jpg
```

**Thumbnails:** Generated on-demand by image proxy, cached by CDN/nginx.

### 3. Serving Strategy: Nginx Direct + On-Demand Transforms

**Current Flow:**
```
Browser → Express → fs.readFile → Response
         ↑ Every request through Node.js
```

**Proposed Flow:**
```
Browser → Nginx → Static file (raw images)
                → imgproxy (thumbnails/webp on-demand)
                → Cache (nginx proxy_cache or CDN)
```

**Nginx Configuration:**
```nginx
# Direct serving for raw images (authenticated)
location /api/images/raw/ {
    auth_request /auth/verify;
    alias /mnt/raid1/images/raw/;
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# On-demand transforms via imgproxy
location /api/images/thumb/ {
    auth_request /auth/verify;
    proxy_pass http://imgproxy:8080/resize:fit:300:300/plain/local:///raw/$uri;
    proxy_cache images;
    proxy_cache_valid 200 30d;
}

location /api/images/webp/ {
    auth_request /auth/verify;
    proxy_pass http://imgproxy:8080/format:webp/plain/local:///raw/$uri;
    proxy_cache images;
    proxy_cache_valid 200 30d;
}
```

**Benefits:**
- Node.js never handles image bytes
- Thumbnails generated on first request, cached forever
- CDN-ready (just put Cloudflare in front)
- Same auth model (JWT verified by nginx auth_request)

### 4. Frontend Changes

**Already Implemented:**
- `BoundingBoxOverlay` component draws SVG boxes from detection data
- `useSecureImage` hook fetches with Authorization header

**Needed Changes:**
```typescript
// ImageModal.tsx - Use raw image + overlay
<img src={rawImageUrl} />
<BoundingBoxOverlay detections={execution.detections} />

// Remove: annotated image display
// Keep: overlay toggle for viewing with/without boxes
```

**Export/Download:**
- Raw frame: Direct download of stored file
- Annotated: Generate client-side with canvas + detection overlay
- Or: Server-side render on-demand via imgproxy with overlay support

### 5. Database Migration

```sql
-- Migration: Simplify execution_images

-- 1. Add new columns
ALTER TABLE execution_images
  ADD COLUMN image_hash VARCHAR(64),
  ADD COLUMN has_raw BOOLEAN DEFAULT false;

-- 2. Backfill has_raw based on file existence (run script)

-- 3. Drop redundant path columns (after migration complete)
-- ALTER TABLE execution_images DROP COLUMN original_path;
-- ALTER TABLE execution_images DROP COLUMN thumbnail_path;
-- ALTER TABLE execution_images DROP COLUMN cached_path;
```

### 6. ETL Changes

```typescript
// stage2-etl-service.ts

private async processImage(executionId: number, yoloData: any): Promise<ImageResult> {
  // NEW: Extract raw frame instead of annotated
  const rawImage = yoloData?.input_image;  // Changed from annotated_image

  if (!rawImage) return null;

  const buffer = Buffer.from(rawImage, 'base64');
  const partition = Math.floor(executionId / 1000);
  const path = `raw/${partition}/${executionId}.jpg`;

  // Write single file
  await this.writeFile(path, buffer);

  // No thumbnail generation - done on-demand by imgproxy

  return {
    has_raw: true,
    size_bytes: buffer.length,
    // Optionally compute hash for deduplication
    image_hash: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}
```

---

## Migration Path

### Phase 1: YOLO Service Update
1. Add `input_image` field to YOLO Inference response
2. Deploy updated service
3. Verify n8n receives both fields

### Phase 2: ETL Update
1. Update stage2-etl to extract `input_image` instead of `annotated_image`
2. Change storage path from `original/` to `raw/`
3. Stop generating webp/thumb variants

### Phase 3: Nginx Setup
1. Configure nginx for direct image serving
2. Deploy imgproxy for on-demand transforms
3. Set up caching

### Phase 4: Frontend Update
1. Update image URLs to new paths
2. Ensure BoundingBoxOverlay works with raw images
3. Update export to use raw + client-side annotation

### Phase 5: Cleanup
1. Remove old path columns from database
2. Archive old annotated images (or delete)
3. Remove Sharp processing from ETL

---

## Comparison

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Files per execution** | 3 | 1 |
| **Storage size** | ~85KB | ~30KB (raw only) |
| **Image source** | Annotated (boxes drawn) | Raw frame |
| **Bounding boxes** | Burned into image | SVG overlay in frontend |
| **Thumbnail generation** | ETL (Sharp) | On-demand (imgproxy) |
| **Serving** | Express sendFile | Nginx direct |
| **Path storage** | 3 columns in DB | Computed from ID |
| **Re-analysis possible** | No (boxes burned in) | Yes (raw preserved) |
| **Dataset export** | Unusable (annotated) | Clean raw frames |

---

## Questions to Resolve

1. **YOLO Service Access:** Do you have access to modify the inference service?

2. **Backward Compatibility:** Keep annotated images for historical data, or regenerate?

3. **imgproxy vs alternatives:**
   - imgproxy (Go, fast, Docker-ready)
   - thumbor (Python, more features)
   - Cloudinary/Imgix (SaaS)

4. **Deduplication:** Same camera often sends identical/similar frames. Worth hashing?

5. **Retention Policy:** How long to keep raw frames? Delete after N days?
