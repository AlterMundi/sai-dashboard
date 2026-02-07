"""
SAI Image Storage Module

Content-addressed storage for raw inference images.
Phase 1: Filesystem with SHA256 hashing
Phase 2: Drop-in IPFS replacement (same interface)

Storage layout:
  /mnt/raid1/sai-images/
  ├── ab/
  │   └── cd/
  │       └── abcd1234...5678.jpg
  └── manifest.json  (optional: hash → metadata mapping)

Usage:
  storage = ImageStorage()
  result = await storage.store(image_bytes)
  # result = {"hash": "abcd1234...", "path": "/mnt/raid1/sai-images/ab/cd/abcd...jpg", "size": 12345}

  image_bytes = await storage.fetch("abcd1234...")
"""

import hashlib
import aiofiles
import aiofiles.os
from pathlib import Path
from typing import Optional, Dict, Any, Union
from dataclasses import dataclass
from datetime import datetime
import logging
import io

logger = logging.getLogger(__name__)


@dataclass
class StorageResult:
    """Result of storing an image"""
    hash: str           # SHA256 hex digest
    path: str           # Filesystem path (or IPFS path in Phase 2)
    size: int           # Size in bytes
    is_duplicate: bool  # True if image already existed
    stored_at: datetime


class ImageStorage:
    """
    Content-addressed image storage.

    Interface designed for easy IPFS migration:
    - store(bytes) -> StorageResult with hash
    - fetch(hash) -> bytes
    - exists(hash) -> bool
    """

    def __init__(
        self,
        base_path: str = "/mnt/raid1/sai-images",
        shard_depth: int = 2,  # 2 levels: ab/cd/abcd....jpg
        shard_width: int = 2,  # 2 chars per level
    ):
        self.base_path = Path(base_path)
        self.shard_depth = shard_depth
        self.shard_width = shard_width

    def _compute_hash(self, data: bytes) -> str:
        """Compute SHA256 hash of image data"""
        return hashlib.sha256(data).hexdigest()

    def _get_shard_path(self, hash: str) -> Path:
        """
        Get sharded directory path for a hash.

        Example with shard_depth=2, shard_width=2:
          hash = "abcd1234..."
          path = base_path/ab/cd/
        """
        parts = []
        for i in range(self.shard_depth):
            start = i * self.shard_width
            end = start + self.shard_width
            parts.append(hash[start:end])
        return self.base_path.joinpath(*parts)

    def _get_file_path(self, hash: str, extension: str = ".jpg") -> Path:
        """Get full file path for a hash"""
        shard_dir = self._get_shard_path(hash)
        return shard_dir / f"{hash}{extension}"

    async def store(
        self,
        image_data: Union[bytes, io.BytesIO],
        extension: str = ".jpg",
        metadata: Optional[Dict[str, Any]] = None
    ) -> StorageResult:
        """
        Store image with content-based addressing.

        Args:
            image_data: Raw image bytes
            extension: File extension (default .jpg)
            metadata: Optional metadata (for future manifest)

        Returns:
            StorageResult with hash, path, and deduplication info
        """
        # Handle BytesIO
        if isinstance(image_data, io.BytesIO):
            image_data = image_data.getvalue()

        # Compute hash
        image_hash = self._compute_hash(image_data)
        file_path = self._get_file_path(image_hash, extension)

        # Check if already exists (deduplication)
        is_duplicate = file_path.exists()

        if not is_duplicate:
            # Create shard directory
            shard_dir = self._get_shard_path(image_hash)
            await aiofiles.os.makedirs(shard_dir, exist_ok=True)

            # Write file atomically (write to temp, then rename)
            temp_path = file_path.with_suffix('.tmp')
            try:
                async with aiofiles.open(temp_path, 'wb') as f:
                    await f.write(image_data)
                await aiofiles.os.rename(temp_path, file_path)
                logger.info(f"Stored image: {image_hash} ({len(image_data)} bytes)")
            except Exception as e:
                # Cleanup temp file on failure
                if temp_path.exists():
                    await aiofiles.os.remove(temp_path)
                raise
        else:
            logger.debug(f"Image already exists (dedup): {image_hash}")

        return StorageResult(
            hash=image_hash,
            path=str(file_path),
            size=len(image_data),
            is_duplicate=is_duplicate,
            stored_at=datetime.utcnow()
        )

    async def fetch(self, image_hash: str, extension: str = ".jpg") -> Optional[bytes]:
        """
        Fetch image by hash.

        Args:
            image_hash: SHA256 hex digest
            extension: File extension

        Returns:
            Image bytes or None if not found
        """
        file_path = self._get_file_path(image_hash, extension)

        if not file_path.exists():
            logger.warning(f"Image not found: {image_hash}")
            return None

        async with aiofiles.open(file_path, 'rb') as f:
            return await f.read()

    def exists(self, image_hash: str, extension: str = ".jpg") -> bool:
        """Check if image exists by hash"""
        file_path = self._get_file_path(image_hash, extension)
        return file_path.exists()

    def get_path(self, image_hash: str, extension: str = ".jpg") -> str:
        """Get filesystem path for a hash (without checking existence)"""
        return str(self._get_file_path(image_hash, extension))

    async def delete(self, image_hash: str, extension: str = ".jpg") -> bool:
        """
        Delete image by hash.

        Returns True if deleted, False if didn't exist.
        """
        file_path = self._get_file_path(image_hash, extension)

        if not file_path.exists():
            return False

        await aiofiles.os.remove(file_path)
        logger.info(f"Deleted image: {image_hash}")

        # Optionally clean up empty shard directories
        # (not implemented to avoid race conditions)

        return True


# Global instance
image_storage = ImageStorage()


# ============================================================
# Integration with inference.py
# ============================================================

"""
To integrate with the inference engine, modify inference.py:

1. Add import:
   from .storage import image_storage

2. In InferenceEngine.infer(), after decoding the image:

   # Store raw image before processing
   if isinstance(image_data, str):
       image_bytes = base64.b64decode(image_data.split(',')[-1])
   elif isinstance(image_data, bytes):
       image_bytes = image_data
   else:
       # numpy array - encode to JPEG
       _, buffer = cv2.imencode('.jpg', image_data)
       image_bytes = buffer.tobytes()

   storage_result = await image_storage.store(image_bytes)
   image_hash = storage_result.hash
   image_path = storage_result.path

3. Add to InferenceResponse in models.py:

   image_hash: Optional[str] = Field(None, description="SHA256 hash of raw input image")
   image_path: Optional[str] = Field(None, description="Storage path of raw input image")

4. Include in response:

   response = InferenceResponse(
       ...
       image_hash=image_hash,
       image_path=image_path,
       ...
   )
"""
