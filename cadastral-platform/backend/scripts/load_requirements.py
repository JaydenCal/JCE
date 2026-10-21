#!/usr/bin/env python3
"""Load cited requirements from the knowledge folders into planning.requirements (reference rows, project_id NULL).

    python scripts/load_requirements.py --dry-run                 # print the rows, no database
    python scripts/load_requirements.py --lga gunnedah            # platform default profile + knowledge/gunnedah/
    python scripts/load_requirements.py --all                     # platform default profile + every LGA folder
    DATABASE_URL=postgresql://... python scripts/load_requirements.py --all

Reads knowledge/platform_default/requirements.json and knowledge/<lga>/requirements.json (the folder is the legacy
lowercase name such as ``gunnedah`` or an lga_code such as ``nsw-gunnedah``). Each row is validated with the
``Requirement`` model, then upserted:

* resolved / user_confirmed rows on the existing cache index ``ux_requirements_cache`` (key, applies_to, file hash, project);
* platform_default rows on ``ux_requirements_platform_default`` (key, applies_to, profile), added by db/007.

value_json holds the scalar value, or {"value": scalar, "struct": {...}} when the requirement also has a structured value.
Rows with status unresolved or conflict are not loaded (they carry no value; the unresolved lists stay in the JSON files).
The connection role must be able to write reference rows (project_id NULL), i.e. bypass the table's row-level security
(owner or service role). Nothing is invented: a resolved row without a quote and file hash is rejected before it reaches
the database, exactly as the table CHECK would reject it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.requirements.models import PLATFORM_DEFAULT_STAMP, Requirement  # noqa: E402

KNOWLEDGE_DIR = Path(__file__).resolve().parents[1] / "knowledge"
PLATFORM_DEFAULT_DIR = "platform_default"
NOT_LGA_FOLDERS = {PLATFORM_DEFAULT_DIR, "esc", "pathway", "lga_boundaries", "raw"}
LOADABLE = ("resolved", "user_confirmed", "platform_default")
NIL_UUID = "00000000-0000-0000-0000-000000000000"

COLUMNS = ["requirement_key", "applies_to", "value_json", "unit", "status", "extraction_method", "confidence", "doc_title",
           "authority", "version_label", "effective_date", "page", "section_ref", "quote", "source_url", "retrieved_at",
           "file_sha256", "prompt", "entered_by", "entered_at", "verified_by", "entered_value", "entered_unit",
           "quote_language", "quote_en", "quote_en_machine_translated", "lga_code", "default_profile", "default_stamp"]
JSON_COLUMNS = {"applies_to", "value_json"}


class RowError(ValueError):
    pass


def build_row(raw: dict[str, Any]) -> dict[str, Any]:
    """One requirement dict (as in requirements.json) -> a planning.requirements row dict (keys = COLUMNS).

    Raises RowError when the row would break the table's citation rule."""
    r = Requirement.model_validate(raw)
    if r.status not in LOADABLE:
        raise RowError(f"{r.key}: status {r.status} is not loaded")
    if r.value is None and r.value_struct is None:
        raise RowError(f"{r.key}: no value")
    row = r.to_db_row()
    if r.value_struct is not None and r.value is not None:
        # Requirement.to_db_row stores only the struct when there is one, which would drop the scalar (e.g. 6.5 m).
        # Keep both: value_json = {"value": <scalar>, "struct": <struct>}.
        row["value_json"] = {"value": r.value, "struct": r.value_struct}
    if r.is_platform_default:
        if r.extraction_method != "platform_default":
            raise RowError(f"{r.key}: a platform_default row needs extraction_method platform_default")
        if not (row["default_profile"] or "").strip() or row["default_stamp"] != PLATFORM_DEFAULT_STAMP:
            raise RowError(f"{r.key}: a platform_default row needs a profile name and the stamp")
    else:
        cited = bool((row["quote"] or "").strip() and row["file_sha256"])
        if not (cited or r.extraction_method == "user_entered"):
            raise RowError(f"{r.key}: no value without a citation (quote and file hash) or a user entry")
    return {c: row.get(c) for c in COLUMNS}


def build_rows(doc: dict[str, Any]) -> tuple[list[dict[str, Any]], list[str]]:
    """A requirements.json document -> (rows, notes). Unloadable rows are reported in notes; invalid rows raise RowError."""
    rows, notes = [], []
    skipped: dict[str, int] = {}
    for raw in doc.get("requirements", []):
        st = raw.get("status")
        if st not in LOADABLE:
            skipped[str(st)] = skipped.get(str(st), 0) + 1
            continue
        rows.append(build_row(raw))
    for st, n in sorted(skipped.items()):
        notes.append(f"{n} row(s) with status {st} not loaded")
    return rows, notes


def discover(knowledge_dir: Path, lgas: list[str] | None, all_lgas: bool, include_default: bool) -> list[Path]:
    files: list[Path] = []
    if include_default:
        files.append(knowledge_dir / PLATFORM_DEFAULT_DIR / "requirements.json")
    names = sorted(d.name for d in knowledge_dir.iterdir()
                   if d.is_dir() and d.name not in NOT_LGA_FOLDERS and (d / "requirements.json").exists()) if all_lgas else []
    for n in list(lgas or []) + names:
        p = knowledge_dir / n / "requirements.json"
        if p not in files:
            files.append(p)
    return files


def upsert_sql(row: dict[str, Any]) -> str:
    cols = ", ".join(COLUMNS)
    ph = ", ".join(f"%({c})s" for c in COLUMNS)
    if row["status"] == "platform_default":
        target = "(requirement_key, applies_to, default_profile) WHERE status = 'platform_default'"
        keys = {"requirement_key", "applies_to", "default_profile"}
    else:
        target = (f"(requirement_key, applies_to, COALESCE(file_sha256, ''), COALESCE(project_id, '{NIL_UUID}'::uuid)) "
                  "WHERE status IN ('resolved','user_confirmed')")
        keys = {"requirement_key", "applies_to", "file_sha256"}
    sets = ", ".join(f"{c} = EXCLUDED.{c}" for c in COLUMNS if c not in keys)
    return f"INSERT INTO planning.requirements ({cols}) VALUES ({ph}) ON CONFLICT {target} DO UPDATE SET {sets}"


def load(files: list[Path], dsn: str | None, dry_run: bool, echo=print) -> dict[str, int]:
    total = {"rows": 0, "default": 0, "files": 0}
    batches: list[tuple[Path, list[dict[str, Any]]]] = []
    for p in files:
        if not p.exists():
            echo(f"missing: {p}")
            continue
        rows, notes = build_rows(json.loads(p.read_text(encoding="utf-8")))
        for n in notes:
            echo(f"{p.parent.name}: {n}")
        batches.append((p, rows))
        total["files"] += 1
        total["rows"] += len(rows)
        total["default"] += sum(r["status"] == "platform_default" for r in rows)
    if dry_run:
        for p, rows in batches:
            echo(f"== {p.parent.name}: {len(rows)} row(s)")
            for r in rows:
                stamp = f"  [{r['default_stamp']}]" if r["default_stamp"] else ""
                echo(f"  {r['requirement_key']:<52} {json.dumps(r['value_json']):<10} {r['unit'] or '':<5} {r['status']:<16} "
                     f"lga_code={r['lga_code']}{stamp}")
        return total
    if not dsn:
        raise SystemExit("DATABASE_URL (or --dsn) is required unless --dry-run is given")
    import psycopg
    from psycopg.types.json import Jsonb
    with psycopg.connect(dsn) as conn:
        for p, rows in batches:
            for r in rows:
                params = {c: (Jsonb(v) if c in JSON_COLUMNS and v is not None else v) for c, v in r.items()}
                conn.execute(upsert_sql(r), params)
            echo(f"loaded {len(rows)} row(s) from {p.parent.name}")
    return total


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--lga", action="append", help="knowledge folder to load (name or lga_code); repeatable")
    ap.add_argument("--all", action="store_true", help="load every LGA folder that has a requirements.json")
    ap.add_argument("--no-default", action="store_true", help="do not load the platform default profile")
    ap.add_argument("--dry-run", action="store_true", help="print the rows, do not connect to a database")
    ap.add_argument("--dsn", default=None, help="database URL (default env DATABASE_URL)")
    ap.add_argument("--knowledge", default=str(KNOWLEDGE_DIR))
    a = ap.parse_args(argv)
    files = discover(Path(a.knowledge), a.lga, a.all, not a.no_default)
    try:
        t = load(files, a.dsn or os.environ.get("DATABASE_URL"), a.dry_run)
    except RowError as ex:
        print(f"REJECTED: {ex}", file=sys.stderr)
        return 2
    print(f"{t['rows']} row(s) from {t['files']} file(s), {t['default']} platform default"
          f"{' (dry run, nothing written)' if a.dry_run else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
