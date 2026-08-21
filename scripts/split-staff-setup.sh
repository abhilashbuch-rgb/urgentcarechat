#!/usr/bin/env bash
# Cuts supabase/staff-setup-all.sql into parts small enough for the
# Supabase SQL editor.
#
#   bash scripts/split-staff-setup.sh [out_dir]   # default: supabase/parts
#
# WHY THIS EXISTS. The combined file is around 460KB and the editor
# silently TRUNCATES a paste that large — it did so once mid-way through
# a dollar-quoted JSON literal, ran the fragment, and left the database
# looking set up while the last migration in the file had never executed.
# Nothing errored. The only symptom was a function that did not exist.
#
# So the boundaries here are the generated `-- ========== name.sql =====`
# markers, which fall between whole migrations and therefore can never
# land inside a function body or a quoted string. Each part is a complete,
# idempotent unit: re-running one is safe, and a part that half-succeeded
# can simply be run again.
#
# Regenerate the bundle first — scripts/build-staff-setup.sh — or this
# splits a stale file.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=supabase/staff-setup-all.sql
OUT=${1:-supabase/parts}
# Well under the size that has been observed to truncate, with room for
# one oversized migration to grow before it needs a part of its own.
LIMIT=120000

[ -f "$SRC" ] || { echo "error: $SRC missing — run scripts/build-staff-setup.sh first" >&2; exit 1; }
mkdir -p "$OUT"
rm -f "$OUT"/SETUP-PART-*.sql

SRC="$SRC" OUT="$OUT" LIMIT="$LIMIT" python3 - <<'PY'
import os, re

src = open(os.environ["SRC"]).read()
out_dir, limit = os.environ["OUT"], int(os.environ["LIMIT"])

marks = [m.start() for m in re.finditer(r'^-- ========== .*\.sql ==========$', src, re.M)]
if not marks:
    raise SystemExit("error: no migration markers found — is this the generated bundle?")

header = src[:marks[0]]
blocks = [src[a:b] for a, b in zip(marks, marks[1:] + [len(src)])]
names  = [re.match(r'-- ========== (\S+)\.sql', b).group(1) for b in blocks]

parts, cur, cur_names, size = [], [], [], 0
for block, name in zip(blocks, names):
    if cur and size + len(block) > limit:
        parts.append((cur, cur_names)); cur, cur_names, size = [], [], 0
    cur.append(block); cur_names.append(name); size += len(block)
parts.append((cur, cur_names))

total = len(parts)
for i, (blocks_i, names_i) in enumerate(parts, 1):
    listed = "\n".join("--   " + n for n in names_i)
    banner = f"""-- ============================================================
-- medicin. STAFF MODULE — SETUP PART {i} OF {total}
--
-- RUN THE PARTS IN ORDER, 1 through {total}, each as its own paste.
-- Wait for one to report success before starting the next; a later part
-- refers to tables an earlier one creates.
--
-- Every part is idempotent on its own, so re-running one is safe and a
-- part that half-succeeded can simply be run again.
--
-- Migrations in this part:
{listed}
-- ============================================================

"""
    body = banner + (header if i == 1 else "") + "".join(blocks_i)
    path = os.path.join(out_dir, f"SETUP-PART-{i}-of-{total}.sql")
    open(path, "w").write(body)
    print(f"  part {i}/{total}: {len(body):>7,} bytes, {len(names_i):>2} migrations -> {path}")
PY

echo "wrote $(ls "$OUT"/SETUP-PART-*.sql | wc -l) parts to $OUT/"
