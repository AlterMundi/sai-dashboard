---                                                                                    
  Análisis Crítico de la Implementación ETL                                              
                                                                                         
  Resumen Ejecutivo                                                                      
                                                                                         
  La implementación ETL de dos etapas es sólida arquitecturalmente, con buenas decisiones
   de diseño como la separación Stage 1 (rápido) / Stage 2 (profundo), el uso de triggers
   de PostgreSQL, y una cola con reintentos. Sin embargo, hay deficiencias críticas en el
   manejo de colas, transacciones y patrones de acceso a datos que reducen la            
  escalabilidad y confiabilidad.                                                         
                                                                                         
  ---                                                                                    
  🔴 PROBLEMAS CRÍTICOS                                                                  
                                                                                         
  1. Ausencia de SKIP LOCKED - Condiciones de Carrera en Cola                            
                                                                                         
  Problema: La implementación actual selecciona ítems del queue y luego intenta marcarlos
   como "processing", pero no usa FOR UPDATE SKIP LOCKED:                                
                                                                                         
  // stage2-etl-service.ts:280-292                                                       
  private async getNextBatch(): Promise<Array<{ execution_id: number }>> {               
    const result = await this.saiPool.query(`                                            
      SELECT execution_id                                                                
      FROM etl_processing_queue                                                          
      WHERE status = 'pending' AND stage = 'stage2' AND attempts < max_attempts          
      ORDER BY priority ASC, queued_at ASC                                               
      LIMIT $1                                                                           
    `, [this.BATCH_SIZE]);                                                               
    return result.rows;                                                                  
  }                                                                                      
                                                                                         
  Consecuencia: Múltiples workers pueden seleccionar los mismos ítems, causando trabajo  
  duplicado y contención.                                                                
                                                                                         
  Solución (Supabase Best Practice 5.4):                                                 
                                                                                         
  -- Usar SKIP LOCKED para que los workers obtengan ítems diferentes                     
  SELECT execution_id                                                                    
  FROM etl_processing_queue                                                              
  WHERE status = 'pending' AND stage = 'stage2' AND attempts < max_attempts              
  ORDER BY priority ASC, queued_at ASC                                                   
  LIMIT $1                                                                               
  FOR UPDATE SKIP LOCKED;                                                                
                                                                                         
  ---                                                                                    
  2. Operaciones Stage 2 Sin Transacción Atómica                                         
                                                                                         
  Problema: Stage 2 ejecuta múltiples operaciones independientes que pueden fallar       
  parcialmente:                                                                          
                                                                                         
  // stage2-etl-service.ts:319-339                                                       
  await this.updateExecution(executionId, extracted);     // Puede completar             
  await this.upsertAnalysis(executionId, extracted);      // Puede completar             
  await this.processImage(executionId, imageBase64);       // FALLA AQUÍ                 
  await this.insertNotification(executionId, extracted);  // Nunca se ejecuta            
  await this.markCompleted(executionId, processingTime);  // Nunca se ejecuta            
                                                                                         
  Consecuencia: Estado inconsistente - la ejecución tiene análisis pero no imagen, y el  
  ítem queda marcado como "failed" para reintento, pero los datos parciales ya están     
  escritos.                                                                              
                                                                                         
  Solución:                                                                              
                                                                                         
  const client = await this.saiPool.connect();                                           
  try {                                                                                  
    await client.query('BEGIN');                                                         
    await this.updateExecution(client, executionId, extracted);                          
    await this.upsertAnalysis(client, executionId, extracted);                           
    await this.processImage(executionId, imageBase64); // Fuera de transacción           
  (filesystem)                                                                           
    await this.insertNotification(client, executionId, extracted);                       
    await client.query('SELECT etl_mark_completed($1, $2)', [executionId,                
  processingTime]);                                                                      
    await client.query('COMMIT');                                                        
  } catch (error) {                                                                      
    await client.query('ROLLBACK');                                                      
    throw error;                                                                         
  } finally {                                                                            
    client.release();                                                                    
  }                                                                                      
                                                                                         
  ---                                                                                    
  3. Índice Parcial Incompleto para Consulta Principal                                   
                                                                                         
  Problema: El índice idx_etl_queue_pending no incluye attempts < max_attempts:          
                                                                                         
  -- Migration 002:42-43                                                                 
  CREATE INDEX idx_etl_queue_pending ON etl_processing_queue(status, priority, queued_at)
    WHERE status = 'pending';                                                            
                                                                                         
  Pero el query filtra también por attempts < max_attempts:                              
                                                                                         
  WHERE status = 'pending' AND stage = 'stage2' AND attempts < max_attempts              
                                                                                         
  Consecuencia: El índice parcial se usa, pero después PostgreSQL debe filtrar ítems por 
  attempts y stage, haciendo la consulta menos eficiente.                                
                                                                                         
  Solución:                                                                              
                                                                                         
  CREATE INDEX idx_etl_queue_ready ON etl_processing_queue(priority, queued_at)          
    WHERE status = 'pending' AND stage = 'stage2' AND attempts < max_attempts;           
                                                                                         
  ---                                                                                    
  4. Polling Ineficiente - Sin LISTEN/NOTIFY para Stage 2                                
                                                                                         
  Problema: Stage 1 usa NOTIFY para respuesta inmediata, pero Stage 2 usa polling cada 5 
  segundos:                                                                              
                                                                                         
  // stage2-etl-service.ts:246                                                           
  this.POLL_INTERVAL_MS = 5000; // Process queue every 5 seconds                         
                                                                                         
  Consecuencia:                                                                          
  - Latencia mínima de 5 segundos entre Stage 1 y Stage 2                                
  - Queries innecesarios cuando el queue está vacío                                      
  - Desperdicio de recursos de base de datos                                             
                                                                                         
  Solución: Usar NOTIFY desde el trigger de queue:                                       
                                                                                         
  -- En queue_stage2_processing()                                                        
  PERFORM pg_notify('stage2_ready', NEW.id::text);                                       
                                                                                         
  // En stage2-etl-service.ts                                                            
  this.notifyClient.on('notification', (msg) => {                                        
    if (msg.channel === 'stage2_ready') {                                                
      this.processBatch();                                                               
    }                                                                                    
  });                                                                                    
                                                                                         
  ---                                                                                    
  🟠 PROBLEMAS IMPORTANTES                                                               
                                                                                         
  5. Falta de Covering Index para Consulta de Queue                                      
                                                                                         
  Problema: La consulta solo necesita execution_id, pero el índice no lo incluye:        
                                                                                         
  SELECT execution_id FROM etl_processing_queue WHERE status = 'pending'...              
                                                                                         
  Solución (Supabase Best Practice 1.4):                                                 
                                                                                         
  CREATE INDEX idx_etl_queue_ready_covering                                              
  ON etl_processing_queue(priority, queued_at)                                           
  INCLUDE (execution_id)                                                                 
  WHERE status = 'pending' AND stage = 'stage2' AND attempts < max_attempts;             
                                                                                         
  ---                                                                                    
  6. Procesamiento de Imagen con I/O Síncrono                                            
                                                                                         
  Problema: sharp ejecuta 3 operaciones de imagen secuencialmente:                       
                                                                                         
  // stage2-etl-service.ts:736-745                                                       
  await sharp(imageBuffer).jpeg({ quality: 95 }).toFile(originalPath);                   
  await sharp(imageBuffer).webp({ quality: 85 }).toFile(webpPath);                       
  await sharp(imageBuffer).resize(300, 300, ...).webp({ quality: 75 }).toFile(thumbPath);
                                                                                         
  Consecuencia: 3x tiempo de procesamiento de imagen.                                    
                                                                                         
  Solución:                                                                              
                                                                                         
  await Promise.all([                                                                    
    sharp(imageBuffer).jpeg({ quality: 95 }).toFile(originalPath),                       
    sharp(imageBuffer).webp({ quality: 85 }).toFile(webpPath),                           
    sharp(imageBuffer).resize(300, 300, ...).webp({ quality: 75 }).toFile(thumbPath)     
  ]);                                                                                    
                                                                                         
  ---                                                                                    
  7. N+1 Query en Procesamiento por Lotes                                                
                                                                                         
  Problema: Para cada ítem del batch, se ejecutan 6+ queries individuales:               
                                                                                         
  // stage2-etl-service.ts:267-270                                                       
  for (const item of pending) {                                                          
    await this.processStage2(item.execution_id);                                         
    // Dentro: fetchExecutionData, updateExecution, upsertAnalysis,                      
    //         processImage, insertNotification, markCompleted                           
  }                                                                                      
                                                                                         
  Consecuencia: 10 ítems × 6 queries = 60 round trips a la base de datos.                
                                                                                         
  Solución (Supabase Best Practice 6.2): Batch fetch de execution_data:                  
                                                                                         
  const executionIds = pending.map(p => p.execution_id);                                 
  const result = await this.n8nPool.query(`                                              
    SELECT "executionId", data                                                           
    FROM execution_data                                                                  
    WHERE "executionId" = ANY($1)                                                        
  `, [executionIds]);                                                                    
                                                                                         
  ---                                                                                    
  8. Falta de Statement Timeout                                                          
                                                                                         
  Problema: No hay timeout para queries, que pueden bloquearse indefinidamente:          
                                                                                         
  // stage2-etl-service.ts:128-136                                                       
  this.n8nPool = new Pool({                                                              
    // Sin statement_timeout                                                             
    max: 5,                                                                              
    idleTimeoutMillis: 30000                                                             
  });                                                                                    
                                                                                         
  Solución:                                                                              
                                                                                         
  this.n8nPool = new Pool({                                                              
    ...                                                                                  
    statement_timeout: 30000, // 30 segundos máximo por query                            
  });                                                                                    
                                                                                         
  ---                                                                                    
  9. Pool Sizing Arbitrario                                                              
                                                                                         
  Problema: Los tamaños de pool están hardcodeados sin justificación:                    
                                                                                         
  // n8nPool: max 5, saiPool: max 10                                                     
                                                                                         
  Consecuencia: Puede ser insuficiente bajo carga alta, o excesivo desperdiciando        
  conexiones.                                                                            
                                                                                         
  Solución (Supabase Best Practice 2.2):                                                 
                                                                                         
  // Formula: (cores * 2) + 1 para CPU-bound, menos para I/O bound                       
  const POOL_SIZE = Math.floor(os.cpus().length * 2) + 1;                                
                                                                                         
  ---                                                                                    
  10. Detección de Workers Muertos                                                       
                                                                                         
  Problema: Si un worker crashea durante status = 'processing', el ítem queda atascado:  
                                                                                         
  -- No hay limpieza de ítems huérfanos                                                  
  SELECT * FROM etl_processing_queue WHERE status = 'processing'                         
    AND started_at < NOW() - INTERVAL '10 minutes';                                      
                                                                                         
  Solución: Agregar función de limpieza periódica:                                       
                                                                                         
  CREATE OR REPLACE FUNCTION etl_cleanup_stale() RETURNS INTEGER AS $$                   
  DECLARE stale_count INTEGER;                                                           
  BEGIN                                                                                  
    UPDATE etl_processing_queue                                                          
    SET status = 'pending', last_error = 'Worker timeout - requeued'                     
    WHERE status = 'processing'                                                          
      AND started_at < NOW() - INTERVAL '5 minutes';                                     
    GET DIAGNOSTICS stale_count = ROW_COUNT;                                             
    RETURN stale_count;                                                                  
  END;                                                                                   
  $$ LANGUAGE plpgsql;                                                                   
                                                                                         
  ---                                                                                    
  🟡 MEJORAS RECOMENDADAS                                                                
                                                                                         
  11. Uso de GIN Index para Detections JSONB                                             
                                                                                         
  Ya existe en migration 005, pero validar que se use:                                   
                                                                                         
  CREATE INDEX idx_execution_analysis_detections_gin                                     
    ON execution_analysis USING GIN (detections jsonb_path_ops);                         
                                                                                         
  Verificar con:                                                                         
  EXPLAIN ANALYZE SELECT * FROM execution_analysis                                       
  WHERE detections @> '[{"class": "fire"}]'::jsonb;                                      
                                                                                         
  ---                                                                                    
  12. Agregar Índice para Queries de Dashboard por Fecha                                 
                                                                                         
  -- Para paginación cursor-based (Supabase Best Practice 6.3)                           
  CREATE INDEX idx_executions_date_id ON executions(execution_timestamp DESC, id DESC);  
                                                                                         
  ---                                                                                    
  13. Vacío Más Agresivo para la Cola                                                    
                                                                                         
  ALTER TABLE etl_processing_queue SET (                                                 
    autovacuum_vacuum_scale_factor = 0.02,   -- 2% de dead tuples                        
    autovacuum_analyze_scale_factor = 0.01   -- 1% de cambios                            
  );                                                                                     
                                                                                         
  ---                                                                                    
  14. Monitoreo con pg_stat_statements                                                   
                                                                                         
  -- Habilitar para identificar queries lentos                                           
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;                                     
                                                                                         
  -- Query para encontrar los peores performers                                          
  SELECT                                                                                 
    calls,                                                                               
    round(mean_exec_time::numeric, 2) as avg_ms,                                         
    round(total_exec_time::numeric, 2) as total_ms,                                      
    query                                                                                
  FROM pg_stat_statements                                                                
  ORDER BY total_exec_time DESC                                                          
  LIMIT 10;                                                                              
                                                                                         
  ---                                                                                    
  Tabla de Prioridades de Mejora                                                         
  ┌─────┬───────────────────────────┬─────────┬──────────┬───────────┐                   
  │  #  │         Problema          │ Impacto │ Esfuerzo │ Prioridad │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 1   │ Sin SKIP LOCKED           │ CRÍTICO │ Bajo     │ 🔴 P0     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 2   │ Sin transacción atómica   │ CRÍTICO │ Medio    │ 🔴 P0     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 3   │ Índice parcial incompleto │ ALTO    │ Bajo     │ 🟠 P1     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 4   │ Polling vs NOTIFY         │ ALTO    │ Medio    │ 🟠 P1     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 6   │ Sharp secuencial          │ MEDIO   │ Bajo     │ 🟠 P1     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 7   │ N+1 queries               │ MEDIO   │ Medio    │ 🟡 P2     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 10  │ Workers muertos           │ MEDIO   │ Bajo     │ 🟡 P2     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 5   │ Covering index            │ BAJO    │ Bajo     │ 🟢 P3     │                   
  ├─────┼───────────────────────────┼─────────┼──────────┼───────────┤                   
  │ 8   │ Statement timeout         │ BAJO    │ Bajo     │ 🟢 P3     │                   
  └─────┴───────────────────────────┴─────────┴──────────┴───────────┘                   
  ---                                                                                    
  Conclusión                                                                             
                                                                                         
  La arquitectura de dos etapas es correcta y bien pensada. Los problemas principales    
  son:                                                                                   
  1. Concurrencia insegura (SKIP LOCKED)                                                 
  2. Atomicidad incompleta (transacciones)                                               
  3. Latencia innecesaria (polling vs NOTIFY)                                            
                                                                                         
  Implementar las mejoras P0 y P1 mejorará significativamente la confiabilidad y el      
  rendimiento del sistema ETL. 

---

# PARTE 2: Análisis del Modelo de Datos (Fundamentos)

**Fecha:** 2026-01-24
**Basado en:** Supabase Postgres Best Practices

---

## 1. Resumen del Esquema Actual

### Tablas Principales

| Tabla | Propósito | Filas (est.) |
|-------|-----------|--------------|
| `executions` | Metadatos core de ejecuciones n8n | Alto (100K+) |
| `execution_analysis` | Resultados YOLO fuego/humo | Alto |
| `execution_images` | Paths de imágenes en filesystem | Alto |
| `execution_notifications` | Tracking de Telegram | Medio |
| `etl_processing_queue` | Cola de trabajos Stage 2 | Dinámico |

### Relaciones

```
executions (PK: id)
    ├── execution_analysis (FK: execution_id) 1:1
    ├── execution_images (FK: execution_id) 1:1
    ├── execution_notifications (FK: execution_id) 1:1
    └── etl_processing_queue (FK: execution_id) 1:N (por stage)
```

Todas las tablas hijas tienen `ON DELETE CASCADE` - correcto para integridad.

---

## 2. Problemas Críticos del Modelo de Datos

### 2.1 CRÍTICO: Índices Faltantes en `executions`

**Problema:** La query principal en `new-execution-service.ts` (líneas 264-316):

```sql
SELECT ... FROM executions e
LEFT JOIN execution_analysis ea ON e.id = ea.execution_id
LEFT JOIN execution_images ei ON e.id = ei.execution_id
LEFT JOIN execution_notifications en ON e.id = en.execution_id
WHERE {filtros dinámicos}
ORDER BY e.execution_timestamp DESC
LIMIT $n OFFSET $m
```

**Índices faltantes para patrones comunes:**

| Filtro | Columna | ¿Índice? |
|--------|---------|----------|
| Rango fecha | `execution_timestamp` | Parcial (006) |
| Estado | `status` | NO |
| Cámara | `camera_id` | NO |
| Ubicación | `location` | NO |
| Dispositivo | `device_id` | NO |
| Nodo | `node_id` | NO |
| Tipo cámara | `camera_type` | NO |

**Impacto:** Full table scans en 100K+ filas para filtros comunes del dashboard.

**Recomendación:**
```sql
-- Índice compuesto para patrón de query más común
CREATE INDEX idx_executions_timestamp_status
  ON executions(execution_timestamp DESC, status);

-- Covering index para queries de paginación
CREATE INDEX idx_executions_main_query
  ON executions(execution_timestamp DESC)
  INCLUDE (workflow_id, status, mode, camera_id, location, device_id, node_id);

-- Índice parcial para filtrado por cámara (caso de uso común)
CREATE INDEX idx_executions_camera
  ON executions(camera_id, execution_timestamp DESC)
  WHERE camera_id IS NOT NULL;
```

---

### 2.2 ALTO: Filtro Duplicado de Tipo de Cámara

**Problema:** En `new-execution-service.ts` líneas 99-110 Y 195-205, el filtrado está duplicado:

```typescript
// Líneas 99-110
if (cameraTypes && cameraTypes.length > 0) {
  whereConditions.push(`e.camera_type = ANY($${paramCount})`);
}

// Líneas 195-205 (¡DUPLICADO!)
if (cameraTypes && cameraTypes.length > 0) {
  whereConditions.push(`e.camera_type = ANY($${paramCount})`);
}
```

**Impacto:**
- Cláusulas WHERE duplicadas
- Desajuste en conteo de parámetros
- Errores potenciales de query

**Acción:** Eliminar bloque duplicado en líneas 195-205.

---

### 2.3 ALTO: COUNT(*) Ineficiente para Paginación

**Problema:** Cada query paginada ejecuta un COUNT separado (líneas 247-254):

```sql
SELECT COUNT(DISTINCT e.id) as total
FROM executions e
LEFT JOIN execution_analysis ea ...
LEFT JOIN execution_images ei ...
LEFT JOIN execution_notifications en ...
WHERE {filters}
```

**Impacto:**
- Doble costo por cada carga de página
- JOINs innecesarios para contar
- `DISTINCT` es costoso

**Solución:** Usar paginación basada en cursor:

```sql
-- En lugar de COUNT + OFFSET, usar cursor (keyset pagination)
SELECT ... FROM executions e
WHERE e.execution_timestamp < $cursor_timestamp
  AND (e.execution_timestamp < $cursor_timestamp
       OR (e.execution_timestamp = $cursor_timestamp AND e.id < $cursor_id))
ORDER BY e.execution_timestamp DESC, e.id DESC
LIMIT 51  -- Fetch limit+1 para detectar hasNext
```

La migración 006 ya creó `idx_executions_timestamp_id` para este patrón pero no se usa.

---

### 2.4 MEDIO: Índices Parciales Faltantes en `execution_analysis`

**Problema:** La migración 005 creó un índice GIN pero faltan B-tree para patrones comunes:

```sql
-- Índice GIN existente (para containment JSONB)
idx_execution_analysis_detections_gin

-- Índices B-tree faltantes para:
- has_fire (filtro booleano - muy común)
- has_smoke (filtro booleano - muy común)  
- alert_level (filtro enum - muy común)
- confidence_fire (filtro de rango)
- confidence_smoke (filtro de rango)
```

**Recomendación:**
```sql
-- Índice parcial para detecciones de fuego (hot path)
CREATE INDEX idx_analysis_fire
  ON execution_analysis(execution_id)
  WHERE has_fire = true;

-- Índice parcial para detecciones de humo
CREATE INDEX idx_analysis_smoke
  ON execution_analysis(execution_id)
  WHERE has_smoke = true;

-- Índice parcial para alertas de alta prioridad
CREATE INDEX idx_analysis_alerts_priority
  ON execution_analysis(execution_id, alert_level)
  WHERE alert_level IN ('high', 'critical');

-- Índice para filtrado por confianza
CREATE INDEX idx_analysis_confidence
  ON execution_analysis(confidence_score DESC)
  WHERE confidence_score IS NOT NULL;
```

---

### 2.5 MEDIO: Desajuste TypeScript ↔ DB

**Problema:** `SaiEnhancedAnalysis` (types/index.ts líneas 40-117) tiene campos que NO existen en DB:

| Campo Interface | Columna DB | Estado |
|-----------------|------------|--------|
| `falsePositiveFlag` | - | NO EN DB |
| `verifiedByHuman` | - | NO EN DB |
| `humanVerifier` | - | NO EN DB |
| `emailSent` | - | NO EN DB |
| `smsSent` | - | NO EN DB |
| `latitude` | - | NO EN DB |
| `longitude` | - | NO EN DB |
| `elevation` | - | NO EN DB |
| `fireZoneRisk` | - | NO EN DB |
| `isDaylight` | - | NO EN DB |
| `weatherConditions` | - | NO EN DB |
| `temperatureCelsius` | - | NO EN DB |
| `humidityPercent` | - | NO EN DB |
| `windSpeedKmh` | - | NO EN DB |
| `incidentId` | - | NO EN DB |
| `relatedExecutionIds` | - | NO EN DB |
| `duplicateOf` | - | NO EN DB |

**Impacto:**
- Interface sugiere features inexistentes
- Confusión para desarrolladores
- Ilusión de type safety

**Acción:** Eliminar campos de interface (si no están planeados) o agregar columnas si se necesitan.

---

### 2.6 MEDIO: `ExpertReview` Interface Sin Tabla DB

**Problema:** La interface `ExpertReview` (líneas 119-173) define ~40 campos pero no existe tabla correspondiente. CLAUDE.md indica que expert review está "DISABLED".

**Impacto:**
- Código/interfaces muertos
- Desperdicio de memoria en JS compilado
- Confusión de desarrolladores

**Acción:** Eliminar interface `ExpertReview` y código relacionado hasta implementación real.

---

### 2.7 CRÍTICO (Seguridad): Inyección SQL en getDailySummary

**Problema:** Usa interpolación de strings para interval:

```typescript
// new-execution-service.ts:403-425
WHERE e.execution_timestamp >= CURRENT_DATE - INTERVAL '${days} days'
```

**Riesgo de inyección SQL!** Debe usar query parametrizada:

```sql
WHERE e.execution_timestamp >= CURRENT_DATE - ($1 || ' days')::interval
```

O mejor aún:
```sql
WHERE e.execution_timestamp >= CURRENT_DATE - make_interval(days => $1)
```

---

## 3. Migración Recomendada: 009_performance_indexes.sql

```sql
-- ============================================================================
-- Migration 009: Performance Indexes
-- Purpose: Agregar índices faltantes para patrones de query comunes
-- ============================================================================

BEGIN;

-- 1. Optimización de query principal de executions
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_executions_main_query
  ON executions(execution_timestamp DESC)
  INCLUDE (workflow_id, status, mode, camera_id, location, device_id, node_id, camera_type);

-- 2. Filtrado por cámara
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_executions_camera
  ON executions(camera_id, execution_timestamp DESC)
  WHERE camera_id IS NOT NULL;

-- 3. Filtrado por estado
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_executions_status
  ON executions(status, execution_timestamp DESC);

-- 4. Detecciones de fuego (hot path)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_fire
  ON execution_analysis(execution_id)
  WHERE has_fire = true;

-- 5. Detecciones de humo
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_smoke
  ON execution_analysis(execution_id)
  WHERE has_smoke = true;

-- 6. Alertas de alta prioridad
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_high_alert
  ON execution_analysis(execution_id, alert_level)
  WHERE alert_level IN ('high', 'critical');

-- 7. Ranking por confianza
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analysis_confidence
  ON execution_analysis(confidence_score DESC NULLS LAST)
  WHERE confidence_score IS NOT NULL;

-- Estadísticas para el planificador
ANALYZE executions;
ANALYZE execution_analysis;
ANALYZE execution_images;
ANALYZE execution_notifications;

COMMIT;
```

---

## 4. Inventario de Índices Actuales

De migraciones 002-007:

```sql
-- etl_processing_queue
idx_etl_queue_pending (status, priority, queued_at) WHERE status = 'pending'
idx_etl_queue_failed (status, attempts) WHERE status = 'failed'
idx_etl_queue_execution (execution_id)
idx_etl_queue_stage (stage, status)
idx_etl_queue_ready (priority, queued_at) INCLUDE (execution_id)
  WHERE status = 'pending' AND stage = 'stage2'

-- execution_analysis
idx_execution_analysis_detections_gin (detections jsonb_path_ops)
idx_execution_analysis_detection_count (detection_count) WHERE detection_count > 0

-- executions
idx_executions_timestamp_id (execution_timestamp DESC, id DESC)
```

---

## 5. Resumen de Prioridades

| Prioridad | Issue | Esfuerzo | Impacto |
|-----------|-------|----------|---------|
| 🔴 P0 | Fix SQL injection (2.7) | Bajo | Crítico (seguridad) |
| 🔴 P0 | Eliminar filtro duplicado (2.2) | Bajo | Medio |
| 🟠 P1 | Crear migration 009 (2.1, 2.4) | Medio | Alto |
| 🟠 P1 | Implementar cursor pagination (2.3) | Alto | Alto |
| 🟡 P2 | Limpiar interfaces TS (2.5, 2.6) | Bajo | Bajo |

---

## 6. Próximos Pasos

1. **Inmediato:** Fix SQL injection en `getDailySummary()`
2. **Inmediato:** Eliminar filtro duplicado de camera type
3. **Corto plazo:** Crear migration 009 con índices de rendimiento
4. **Corto plazo:** Implementar cursor-based pagination
5. **Medio plazo:** Limpiar interfaces TypeScript no usadas
