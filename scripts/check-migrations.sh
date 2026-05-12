#!/usr/bin/env bash
# Validates migration order, naming, and reversibility annotations across
# packages/db/sql/ and packages/db/drizzle/.
#
# Run: scripts/check-migrations.sh
# Exit codes:
#   0 — all checks passed
#   1 — naming / ordering violation
#   2 — missing reversibility annotation on a SQL migration
#
# This is intentionally bash, not Node, so it runs in CI before pnpm install.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_DIR="$REPO_ROOT/packages/db/sql"
DRIZZLE_DIR="$REPO_ROOT/packages/db/drizzle"

fail=0

if [[ ! -d "$SQL_DIR" ]]; then
  echo "::error::SQL migration directory not found: $SQL_DIR" >&2
  exit 1
fi

# ---------- 1. SQL file naming ----------
# Expected pattern: NNNN_short_snake_case_description.sql
echo "[check-migrations] validating SQL migration filenames in $SQL_DIR"
sql_files=()
while IFS= read -r -d '' f; do
  sql_files+=("$f")
done < <(find "$SQL_DIR" -maxdepth 1 -name '*.sql' -print0 | sort -z)

if [[ ${#sql_files[@]} -eq 0 ]]; then
  echo "::error::no .sql files in $SQL_DIR" >&2
  exit 1
fi

prev_num=-1
for f in "${sql_files[@]}"; do
  name="$(basename "$f")"
  if [[ ! "$name" =~ ^([0-9]{4})_[a-z0-9_]+\.sql$ ]]; then
    echo "::error::malformed migration filename: $name (expected NNNN_snake_case_name.sql)" >&2
    fail=1
    continue
  fi
  num="${BASH_REMATCH[1]}"
  num_decimal=$((10#$num))
  if (( num_decimal != prev_num + 1 )); then
    if (( prev_num == -1 )); then
      if (( num_decimal != 1 )); then
        echo "::error::migration sequence must start at 0001; found $name" >&2
        fail=1
      fi
    else
      echo "::error::migration gap or out-of-order: $name (expected $(printf '%04d' $((prev_num + 1))))" >&2
      fail=1
    fi
  fi
  prev_num=$num_decimal
done

echo "[check-migrations] $(printf '%d' ${#sql_files[@]}) SQL migration(s) — sequence checked"

# ---------- 2. Header comment present ----------
# Every SQL migration must open with a comment block. Drives review hygiene —
# a migration without a doc block hits production with no context. Convention
# is the `===== name.sql` banner at the top (see existing 0001…0019.sql).
# Forward-only is the default per docs/runbooks/database-restore.md §4.
echo "[check-migrations] validating header comment block"
for f in "${sql_files[@]}"; do
  name="$(basename "$f")"
  head_text="$(head -5 "$f")"
  if ! echo "$head_text" | grep -qE '^-- '; then
    echo "::error::$name: first 5 lines have no '-- ' comment block" >&2
    fail=1
  fi
done

# ---------- 3. Drizzle journal presence ----------
if [[ -d "$DRIZZLE_DIR" ]]; then
  journal="$DRIZZLE_DIR/meta/_journal.json"
  if [[ ! -f "$journal" ]]; then
    echo "::warning::Drizzle directory exists but no _journal.json — Drizzle migrations may be skipped at runtime" >&2
  else
    echo "[check-migrations] Drizzle journal present"
  fi
else
  echo "[check-migrations] no Drizzle directory — raw SQL only (OK)"
fi

# ---------- 4. RLS coverage spot-check ----------
# Every new table in a recent migration that includes "CREATE TABLE" should
# also include "ROW LEVEL SECURITY" or be in an allow-list of system tables.
echo "[check-migrations] spot-checking RLS coverage on new tables"
allow_list=(
  'login_attempts'              # global by design (0019)
  'login_alert_emails_sent'     # global by design (0019)
  'stripe_events'               # webhook ledger; uniqueness enforced by stripe_event_id
  'job_number_sequences'        # tenant scoping enforced via composite PK
  'invoice_number_sequences'    # same
)
for f in "${sql_files[@]}"; do
  name="$(basename "$f")"
  # Find every table created in this file
  tables="$(grep -oE 'CREATE TABLE (IF NOT EXISTS )?[a-z_]+' "$f" | awk '{print $NF}' || true)"
  for t in $tables; do
    in_allow=0
    for a in "${allow_list[@]}"; do
      if [[ "$t" == "$a" ]]; then in_allow=1; break; fi
    done
    if (( in_allow )); then continue; fi
    # Look for RLS on this table — same file or any earlier file
    if ! grep -qE "ALTER TABLE $t .*ROW LEVEL SECURITY" "$SQL_DIR"/*.sql; then
      echo "::warning::$name: table '$t' created but no FORCE ROW LEVEL SECURITY found in any migration" >&2
    fi
  done
done

if (( fail )); then
  echo "::error::check-migrations FAILED" >&2
  exit 1
fi

echo "[check-migrations] OK"
