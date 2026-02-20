#!/usr/bin/env python3
"""
Re-run YOLO inference on executions with zero bounding boxes.
Updates ONLY execution_analysis - does NOT touch executions table.

Usage:
    python3 reprocess_bboxes.py [--dry-run] [--batch-size N] [--limit N]
"""

import argparse
import json
import sys
import time
import psycopg2
import requests
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
INFERENCE_URL = "http://localhost:8888/api/v1/infer"
DB_DSN = "host=localhost dbname=sai_dashboard user=n8n_user password=REDACTED"
CONFIDENCE_THRESHOLD = 0.25
IOU_THRESHOLD = 0.1
REQUEST_TIMEOUT = 30  # seconds per image

# ── Helpers ────────────────────────────────────────────────────────────────────

def xyxy_to_xywh(x1, y1, x2, y2):
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


def infer_image(image_path: str) -> dict | None:
    """POST image to YOLO service, return parsed detections or None on error."""
    try:
        with open(image_path, "rb") as f:
            resp = requests.post(
                INFERENCE_URL,
                files={"file": (Path(image_path).name, f, "image/jpeg")},
                data={
                    "confidence_threshold": CONFIDENCE_THRESHOLD,
                    "iou_threshold": IOU_THRESHOLD,
                    "return_image": "false",
                },
                timeout=REQUEST_TIMEOUT,
            )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"    ERROR calling inference: {e}", file=sys.stderr)
        return None


def build_detections(raw_detections: list) -> list:
    """Convert YOLO xyxy detections to dashboard xywh format."""
    out = []
    for det in raw_detections:
        bbox = det.get("bbox", {})
        out.append({
            "class": det.get("class_name") or det.get("class") or "unknown",
            "confidence": det.get("confidence", 0),
            "bounding_box": xyxy_to_xywh(
                bbox.get("x1", 0), bbox.get("y1", 0),
                bbox.get("x2", 0), bbox.get("y2", 0),
            ),
        })
    return out


def update_analysis(cur, execution_id: int, result: dict, dry_run: bool) -> bool:
    """Update execution_analysis with corrected detection data."""
    raw_detections = result.get("detections", [])
    detections = build_detections(raw_detections)

    confidence_scores = result.get("confidence_scores", {})
    # confidence_scores keys are enum values: may be "fire"/"smoke" or DetectionClass objects
    conf_fire  = confidence_scores.get("fire",  confidence_scores.get("DetectionClass.FIRE",  0)) or 0
    conf_smoke = confidence_scores.get("smoke", confidence_scores.get("DetectionClass.SMOKE", 0)) or 0
    conf_score = max(conf_fire, conf_smoke) or None

    if dry_run:
        print(f"    [DRY RUN] would update execution_id={execution_id}: "
              f"{len(detections)} detections, has_fire={result.get('has_fire')}, "
              f"has_smoke={result.get('has_smoke')}, alert_level derived")
        return True

    cur.execute("""
        UPDATE execution_analysis SET
            detections          = %s,
            detection_count     = %s,
            has_fire            = %s,
            has_smoke           = %s,
            confidence_fire     = %s,
            confidence_smoke    = %s,
            confidence_score    = %s,
            updated_at          = NOW()
        WHERE execution_id = %s
    """, (
        json.dumps(detections),
        len(detections),
        result.get("has_fire", False),
        result.get("has_smoke", False),
        conf_fire  if conf_fire  > 0 else None,
        conf_smoke if conf_smoke > 0 else None,
        conf_score,
        execution_id,
    ))
    return cur.rowcount == 1


def fetch_targets(cur, limit: int | None) -> list[tuple]:
    """Fetch executions with zero bounding boxes that have images."""
    query = """
        SELECT ea.execution_id, ei.original_path
        FROM execution_analysis ea
        JOIN execution_images ei ON ea.execution_id = ei.execution_id
        WHERE ea.detections IS NOT NULL
          AND ea.detections != '[]'::jsonb
          AND (ea.detections->0->'bounding_box'->>'width')::numeric = 0
          AND ei.original_path IS NOT NULL
        ORDER BY ea.execution_id
    """
    if limit:
        query += f" LIMIT {int(limit)}"
    cur.execute(query)
    return cur.fetchall()


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Re-run YOLO on zero-bbox executions")
    parser.add_argument("--dry-run", action="store_true", help="Query and infer but do not write to DB")
    parser.add_argument("--limit",   type=int, default=None, help="Max executions to process")
    parser.add_argument("--delay",   type=float, default=0.1, help="Seconds between requests (default 0.1)")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_DSN)
    conn.autocommit = False
    cur = conn.cursor()

    targets = fetch_targets(cur, args.limit)
    total = len(targets)
    print(f"Found {total} executions to reprocess{' (dry-run)' if args.dry_run else ''}.")

    if total == 0:
        print("Nothing to do.")
        return

    ok = 0
    skip = 0
    fail = 0
    t0 = time.time()

    for i, (exec_id, img_path) in enumerate(targets, 1):
        prefix = f"[{i:>3}/{total}] exec {exec_id}"

        if not Path(img_path).exists():
            print(f"{prefix}  SKIP  image not found: {img_path}")
            skip += 1
            continue

        print(f"{prefix}  inferring {img_path} ...", end=" ", flush=True)
        t1 = time.time()
        result = infer_image(img_path)
        elapsed = time.time() - t1

        if result is None:
            print(f"FAILED ({elapsed:.1f}s)")
            fail += 1
            continue

        n_det = result.get("detection_count", 0)
        print(f"{n_det} detections  ({elapsed:.1f}s)", end=" ")

        if update_analysis(cur, exec_id, result, args.dry_run):
            if not args.dry_run:
                conn.commit()
            print("✓")
            ok += 1
        else:
            print("UPDATE returned 0 rows — skipping")
            conn.rollback()
            fail += 1

        if args.delay > 0 and i < total:
            time.sleep(args.delay)

    total_time = time.time() - t0
    print(f"\nDone in {total_time:.1f}s — ok={ok}  skip={skip}  fail={fail}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
