# Image Storage Implementation Plan

## Architecture Overview

```
BINARY MODE (current n8n flow):
Camera → n8n → [base64 in payload] → YOLO → [hash + detections] → n8n → Dashboard ETL
                                       ↓                                     ↓
                              Stores raw image                    Stores hash reference
                              Returns hash/path                   (no file writing)
                                       ↓
                              /mnt/raid1/sai-images/{hash}.jpg

REFERENCE MODE (future IPFS flow):
Camera → IPFS → [CID] → n8n → [CID in payload] → YOLO → [detections] → n8n → Dashboard ETL
                                                   ↓                            ↓
                                          Fetches by CID                Stores CID reference
                                          (no storage)
```

**Key principle:** YOLO handles all image storage. ETL never touches image bytes.

## Implementation Status

### 1. YOLO Inference Service (Pending)

**Files to add/modify:**

```
/opt/sai-inference/src/
├── storage.py          # NEW - content-addressed storage module
├── models.py           # MODIFY - add image_hash, image_path to response
├── inference.py        # MODIFY - integrate storage before detection
└── config.py           # MODIFY - add SAI_IMAGE_STORAGE_PATH
```

**Storage module:** See `patches/sai-inference/storage.py`

**Response changes:**
```python
class InferenceResponse(BaseModel):
    # ... existing fields ...
    image_hash: Optional[str] = Field(None, description="SHA256 of raw input")
    image_path: Optional[str] = Field(None, description="Storage path")
    # annotated_image field removed (or deprecated)
```

**Storage location:** `/mnt/raid1/sai-images/{hash[0:2]}/{hash[2:4]}/{hash}.jpg`

### 2. Dashboard ETL (Done ✅)

**File:** `backend/src/services/stage2-etl-service.ts`

**Changes made:**
- Added `image_hash` and `image_path` fields to extraction result
- `extractImageRef()` extracts hash/path reference from YOLO response
- Removed all image file handling (no sharp, no fs, no local storage)
- ETL only stores the reference - never touches image bytes
- Clean separation: YOLO stores images, ETL stores metadata

### 3. Dashboard Image API (Pending)

Need to update image serving to support hash-based fetching:

```typescript
// New endpoint
GET /api/images/hash/:imageHash
// Fetches from YOLO storage path

// Or proxy to inference server
GET /api/images/hash/:imageHash → proxy to inference-server/images/:hash
```

### 4. Database Schema (Optional)

Add `image_hash` column for future IPFS migration:

```sql
ALTER TABLE execution_images
  ADD COLUMN image_hash VARCHAR(64),
  ADD COLUMN storage_mode VARCHAR(20) DEFAULT 'local';

CREATE INDEX idx_images_hash ON execution_images(image_hash);
```

---

## Deployment Steps

### Step 1: Deploy YOLO Storage Module

```bash
# On inference server
ssh inference-public

# Backup
cd /opt/sai-inference
sudo -u service cp -r src src.backup.$(date +%Y%m%d)

# Copy storage module
sudo -u service cp /path/to/storage.py src/

# Create storage directory
sudo mkdir -p /mnt/raid1/sai-images
sudo chown service:service /mnt/raid1/sai-images

# Install dependency
sudo -u service bash -c 'source venv/bin/activate && pip install aiofiles'

# Apply code changes (see patches/sai-inference/README.md)
# Edit models.py and inference.py

# Restart service
sudo systemctl restart sai-inference
```

### Step 2: Verify YOLO Response

```bash
# Test inference endpoint
curl -X POST http://localhost:8888/api/v1/inference \
  -H "Content-Type: application/json" \
  -d '{"image": "base64...", "camera_id": "test"}' | jq '{image_hash, image_path}'

# Should return:
# {
#   "image_hash": "abc123...",
#   "image_path": "/mnt/raid1/sai-images/ab/c1/abc123....jpg"
# }
```

### Step 3: Verify Dashboard ETL

After YOLO is updated, new executions will:
- Have `imageMode: "reference"` in logs
- Store the inference server path in `execution_images.original_path`
- Not write files locally (no more Sharp processing)

### Step 4: Update Image Serving (TODO)

Options:
1. **Proxy:** Dashboard proxies to inference server storage
2. **Mount:** NFS mount RAID on dashboard server
3. **API:** Inference server exposes `/images/:hash` endpoint

---

## Phase 2: IPFS Migration

When ready to move to IPFS:

1. **Storage module swap:**
```python
# Replace filesystem storage with IPFS
class IPFSStorage:
    async def store(self, data) -> StorageResult:
        cid = await ipfs.add(data)
        return StorageResult(hash=cid, path=f"ipfs://{cid}", ...)
```

2. **Camera nodes:**
   - Cameras on VPN upload directly to IPFS
   - Send only CID in webhook payload
   - YOLO fetches from IPFS by CID

3. **Dashboard:**
   - Fetches images via IPFS gateway
   - Or local IPFS node with pinning

---

## Benefits

| Metric | Before | After |
|--------|--------|-------|
| YOLO response size | ~250KB (annotated base64) | ~200 bytes (hash only) |
| n8n payload size | ~250KB | ~200 bytes |
| Dashboard storage | 3 files per execution | 0 files (reference only) |
| Deduplication | None | Automatic (same hash = same file) |
| Raw frames | Lost (boxes burned in) | Preserved |
| Dataset export | Unusable | Clean raw frames + JSON |
