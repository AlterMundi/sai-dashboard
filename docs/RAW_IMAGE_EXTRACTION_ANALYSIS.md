# Raw Image Extraction Analysis

## IMPLEMENTED CHANGES

**Status:** ETL updated to extract raw images. Awaiting YOLO service deployment.

### Changes Made to stage2-etl-service.ts

1. **extractImage()** now extracts `image` field (raw input) instead of `annotated_image`
2. **writeImageFiles()** stores single raw JPEG at `raw/{partition}/{id}.jpg`
3. **performAtomicUpdates()** simplified to store only `original_path` (no thumb/webp)

### Image Flow (Target Architecture)

```
Camera → n8n Webhook → YOLO Inference → Dashboard ETL
                             │
                             └── Returns: detections JSON + raw image (no boxes)
                                          ↓
                                 Frontend draws boxes via SVG overlay
```

### Storage Schema (New)

| Location | Content | Format | Purpose |
|----------|---------|--------|---------|
| `raw/{partition}/{id}.jpg` | Raw input frame | JPEG 95% | Dataset/export/re-analysis |
| (on-demand via imgproxy) | Thumbnail | WebP | Gallery preview |
| (on-demand via imgproxy) | Display size | WebP | Detail view |

---

## Background: Why This Change

### Problem with Previous Architecture

1. YOLO service returned `annotated_image` (bounding boxes burned into pixels)
2. ETL extracted and stored this annotated image
3. Raw frames were lost - unusable for ML dataset construction or re-analysis
4. n8n's binary storage (`filesystem-v2:`) holds raw temporarily but cleans up

---

## YOLO Inference Response Structure

```json
{
  "request_id": "fe0a3320-b583-4b31-ab8d-9df4e238f05a",
  "timestamp": "2026-01-17T22:03:21.359726",
  "processing_time_ms": 49.02,
  "image_size": {"width": 640, "height": 480},
  "detections": [],
  "detection_count": 0,
  "has_fire": false,
  "has_smoke": false,
  "confidence_scores": {"fire": 0, "smoke": 0},
  "alert_level": "none",
  "annotated_image": "/9j/4AAQ...",  // ← 241KB base64 JPEG with boxes
  "version": "SAINet_v10.0_e143.pt"
}
```

**Missing:** `input_image` or similar field with the raw frame.

---

## Options Analysis

### Option 1: Access n8n Binary Storage Directly

**Approach:** Read raw images from n8n's filesystem-v2 storage before they're cleaned up.

**Pros:**
- No YOLO service modification needed
- Raw images already exist

**Cons:**
- Files in `temp/` directory are cleaned up quickly
- Requires filesystem access to n8n data directory
- Complex path resolution needed
- Race condition: ETL must extract before cleanup

**Verdict:** ❌ Not reliable due to temp file cleanup

---

### Option 2: Modify YOLO to Return BOTH Images

**Approach:** Add `input_image` field to YOLO response alongside `annotated_image`.

**Pros:**
- Both images available for flexibility

**Cons:**
- **Doubles response size** (~500KB instead of ~250KB)
- Doubles network traffic between n8n and YOLO service
- User explicitly rejected this approach

**Verdict:** ❌ Rejected due to traffic duplication

---

### Option 3: Modify YOLO to Return ONLY Raw Image

**Approach:** Replace `annotated_image` with `input_image` (or rename to just `image`).

```python
# YOLO Inference service change
class InferenceResponse(BaseModel):
    # ... existing fields ...
    image: Optional[str] = None  # Raw input frame (no annotations)
    # Remove: annotated_image
```

**Pros:**
- No traffic increase (same response size)
- Raw images preserved for dataset/re-analysis
- Frontend draws boxes from `detections` JSON (already implemented!)
- Simple, clean architecture

**Cons:**
- Requires YOLO service deployment
- Historical data has annotated images (can't regenerate raw)

**Verdict:** ✅ **Recommended for new executions**

---

### Option 4: Keep Annotated, Draw Overlay Anyway

**Approach:** Continue extracting annotated images, use detection JSON for programmatic overlay.

**Pros:**
- No changes needed anywhere
- Works immediately

**Cons:**
- Can't reconstruct raw frames
- Bounding boxes "burned in" + overlaid = visual confusion
- Unusable for ML dataset construction

**Verdict:** ⚠️ Acceptable for dashboard viewing, fails dataset goal

---

## Recommended Implementation

### Phase 1: YOLO Service Modification (Required)

Modify YOLO Inference service to return raw input image instead of annotated:

```python
# In /opt/sai-inference/src/inference.py (or models.py)

class InferenceResponse(BaseModel):
    request_id: str
    timestamp: str
    processing_time_ms: float
    image_size: ImageSize
    detections: List[Detection]
    detection_count: int
    has_fire: bool
    has_smoke: bool
    confidence_scores: ConfidenceScores
    alert_level: str
    detection_mode: str
    active_classes: List[str]
    camera_id: str
    version: str
    metadata: Optional[dict] = None
    # CHANGED: Return raw input instead of annotated
    image: Optional[str] = None  # Base64 raw input frame
    # Deprecated - remove after migration:
    # annotated_image: Optional[str] = None

# In inference endpoint:
def inference(request):
    # ... run detection ...
    return InferenceResponse(
        # ... other fields ...
        image=input_image_base64,  # Raw frame sent to this endpoint
    )
```

### Phase 2: ETL Update (After YOLO change deployed)

Update Stage 2 ETL to extract the new `image` field:

```typescript
// backend/src/services/stage2-etl-service.ts

private extractImage(yoloData: any): string | null {
  // Try new field first (raw input)
  const rawImage = yoloData?.image;
  if (rawImage && typeof rawImage === 'string' && rawImage.length > 1000) {
    return rawImage.replace(/^data:image\/[a-z]+;base64,/, '');
  }

  // Fallback to annotated_image for backward compatibility
  const annotatedImage = yoloData?.annotated_image;
  if (annotatedImage && typeof annotatedImage === 'string' && annotatedImage.length > 1000) {
    logger.debug('Using annotated_image fallback (legacy execution)');
    return annotatedImage.replace(/^data:image\/[a-z]+;base64,/, '');
  }

  return null;
}
```

### Phase 3: Storage Simplification (Optional)

Once raw images are flowing, simplify storage:

```
Current (3 files):              Future (1 file):
original/{partition}/{id}.jpg   raw/{partition}/{id}.jpg
webp/{partition}/{id}.webp      (thumbnails on-demand via imgproxy)
thumb/{partition}/{id}.webp
```

---

## Migration Considerations

### Historical Data

- Executions before YOLO change will have `annotated_image` (boxes burned in)
- These cannot be converted to raw frames
- Mark with `image_type: 'annotated'` vs `'raw'` in DB if needed
- For dataset construction, only use executions after the change

### Database Schema

No schema changes needed. The `execution_images` table already stores paths without assumptions about image content.

Optional: Add `image_type` column to track raw vs annotated:
```sql
ALTER TABLE execution_images ADD COLUMN image_type VARCHAR(20) DEFAULT 'annotated';
-- Update to 'raw' for new executions after YOLO change
```

### Frontend

Already handles both cases:
- `BoundingBoxOverlay` component draws SVG boxes from detection JSON
- Works whether underlying image is raw or annotated

---

## Implementation Status

### Completed (Dashboard Side)

| Component | Change | Status |
|-----------|--------|--------|
| `stage2-etl-service.ts` | Extract `image` field (raw input) | ✅ Done |
| `stage2-etl-service.ts` | Store single `raw/{partition}/{id}.jpg` | ✅ Done |
| Database insert | Only `original_path`, no thumb/webp | ✅ Done |
| Backward compatibility | None - clean break | ✅ Done |

### Pending (YOLO Service Side)

| Component | Change | Status |
|-----------|--------|--------|
| YOLO Inference API | Return `image` field with raw input | ⏳ Pending |
| YOLO Inference API | Remove `annotated_image` field | ⏳ Pending |
| Deploy to production | `/opt/sai-inference/` | ⏳ Pending |

### Future (Optional)

| Component | Change | Status |
|-----------|--------|--------|
| imgproxy | On-demand thumbnails/WebP | 📋 Planned |
| nginx | Direct image serving | 📋 Planned |
| Frontend | Use imgproxy URLs | 📋 Planned |

---

## YOLO Service Change Required

Modify `/opt/sai-inference/` to return raw input image:

```python
# In inference endpoint
class InferenceResponse(BaseModel):
    request_id: str
    timestamp: str
    processing_time_ms: float
    image_size: ImageSize
    detections: List[Detection]
    detection_count: int
    has_fire: bool
    has_smoke: bool
    confidence_scores: ConfidenceScores
    alert_level: str
    detection_mode: str
    active_classes: List[str]
    camera_id: str
    version: str
    metadata: Optional[dict] = None
    image: Optional[str] = None  # ← Raw input frame, base64 JPEG

# In the inference function:
return InferenceResponse(
    # ... other fields ...
    image=base64.b64encode(input_image_bytes).decode('utf-8'),
)
```

**Note:** Don't include both `image` AND `annotated_image` - that doubles traffic.
Just replace `annotated_image` with `image` (raw input).
