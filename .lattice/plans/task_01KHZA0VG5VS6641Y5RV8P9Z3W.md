# PROJ-7: Update Sharp config defaults and add Cache-Control headers

## Summary

1) backend/src/config/index.ts: THUMBNAIL_SIZE default 200->400, THUMBNAIL_QUALITY default 70->80. 2) stage2-etl-service.ts: cambiar resize() a solo ancho (.resize({ width: cacheConfig.thumbnailSize, withoutEnlargement: true })). 3) executions.ts: agregar Cache-Control: public, max-age=31536000, immutable antes de res.sendFile() en getExecutionThumbnail y getExecutionImage.

## Technical Plan

<!-- Implementation approach, design decisions, open questions. -->

## Acceptance Criteria

<!-- What must be true for this task to be done? -->
