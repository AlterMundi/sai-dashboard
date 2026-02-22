# PROJ-9: Run thumbnail regeneration on production server

## Summary

SSH a inference-public. Dry-run primero para contar imágenes. Luego ejecutar: IMAGE_BASE_PATH=/mnt/raid1/n8n-backup/images npx ts-node backend/scripts/regenerate-thumbnails.ts --concurrency=4. Verificar spot-check de 3-5 thumbnails antes/después.

## Technical Plan

<!-- Implementation approach, design decisions, open questions. -->

## Acceptance Criteria

<!-- What must be true for this task to be done? -->
