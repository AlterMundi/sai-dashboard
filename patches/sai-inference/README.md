# SAI Inference Service - Image Storage Patch

Adds content-addressed raw image storage to the inference service.

## Files

- `storage.py` - New module: content-addressed storage with SHA256 hashing
- `models.patch` - Adds `image_hash` and `image_path` fields to response
- `inference.patch` - Integrates storage into inference pipeline

## Installation

```bash
# SSH to inference server
ssh inference-public

# Backup current code
cd /opt/sai-inference
cp -r src src.backup.$(date +%Y%m%d)

# Copy new storage module
scp user@local:patches/sai-inference/storage.py src/

# Apply patches (or manually edit)
# See detailed changes below

# Create storage directory
sudo mkdir -p /mnt/raid1/sai-images
sudo chown service:service /mnt/raid1/sai-images

# Add dependency
echo "aiofiles>=23.0.0" >> requirements.txt
source venv/bin/activate
pip install aiofiles

# Restart service
sudo systemctl restart sai-inference
```

## Manual Changes

### 1. models.py - Add to InferenceResponse class:

```python
class InferenceResponse(BaseModel):
    # ... existing fields ...

    # Image storage (NEW)
    image_hash: Optional[str] = Field(None, description="SHA256 hash of raw input image")
    image_path: Optional[str] = Field(None, description="Storage path (filesystem or IPFS)")

    annotated_image: Optional[str] = Field(None, description="Base64 encoded annotated image")
    # ... rest of fields ...
```

### 2. inference.py - Integrate storage:

At top of file:
```python
from .storage import image_storage
import cv2
```

In `InferenceEngine.infer()` method, after image decoding (around line 280):

```python
# After: image = self._decode_image_direct(image_data) or similar

# Store raw image before processing
try:
    if isinstance(image_data, str):
        # Base64 string
        if "," in image_data:
            image_data_clean = image_data.split(",")[1]
        else:
            image_data_clean = image_data
        raw_bytes = base64.b64decode(image_data_clean)
    elif isinstance(image_data, bytes):
        raw_bytes = image_data
    else:
        # numpy array - encode to JPEG
        _, buffer = cv2.imencode('.jpg', image_data, [cv2.IMWRITE_JPEG_QUALITY, 95])
        raw_bytes = buffer.tobytes()

    storage_result = await image_storage.store(raw_bytes)
    image_hash = storage_result.hash
    image_path = storage_result.path
    logger.info(f"Stored raw image: {image_hash[:16]}... dedup={storage_result.is_duplicate}")
except Exception as e:
    logger.error(f"Image storage failed: {e}")
    image_hash = None
    image_path = None
```

In the response construction (around line 450):
```python
response = InferenceResponse(
    # ... existing fields ...
    image_hash=image_hash,      # ADD
    image_path=image_path,      # ADD
    annotated_image=annotated_image_b64,
    # ... rest ...
)
```

## Environment Variables

Optional configuration via environment:

```bash
# Storage base path (default: /mnt/raid1/sai-images)
export SAI_IMAGE_STORAGE_PATH=/mnt/raid1/sai-images
```

## Phase 2: IPFS Migration

The storage interface is designed for drop-in IPFS replacement:

```python
# Future: IPFSStorage with same interface
class IPFSStorage:
    async def store(self, image_data) -> StorageResult:
        # Upload to IPFS, return CID as hash
        cid = await ipfs_client.add(image_data)
        return StorageResult(hash=cid, path=f"ipfs://{cid}", ...)

    async def fetch(self, cid) -> bytes:
        return await ipfs_client.cat(cid)
```

## Testing

```bash
# Test storage module
python -c "
import asyncio
from src.storage import image_storage

async def test():
    data = b'test image data'
    result = await image_storage.store(data)
    print(f'Stored: {result.hash}')
    print(f'Path: {result.path}')
    print(f'Dedup: {result.is_duplicate}')

    fetched = await image_storage.fetch(result.hash)
    print(f'Fetched: {len(fetched)} bytes')
    assert fetched == data

asyncio.run(test())
"
```

## Dashboard Integration

After deploying this patch, update the dashboard ETL to use `image_hash` instead of extracting base64:

```typescript
// stage2-etl-service.ts
const imageHash = yoloData?.image_hash;
const imagePath = yoloData?.image_path;

// Store reference, not the image itself
await client.query(`
  INSERT INTO execution_images (execution_id, image_hash, image_path, ...)
  VALUES ($1, $2, $3, ...)
`, [executionId, imageHash, imagePath]);
```

Then serve images by fetching from the storage path (or IPFS in Phase 2).
