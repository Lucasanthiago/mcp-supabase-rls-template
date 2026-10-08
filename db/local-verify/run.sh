#!/usr/bin/env bash
# =============================================================================
# Harness de verificacao em PostgreSQL puro (sem Docker, sem Supabase).
#
# Cria um banco descartavel, aplica o shim do schema `auth`, DEPOIS as
# migrations reais de supabase/migrations/ sem nenhuma alteracao, o seed e a
# bateria de testes de isolamento.
#
# Uso:  bash db/local-verify/run.sh
# Requer: um PostgreSQL local acessivel como superusuario.
# =============================================================================
set -euo pipefail

DB="${DB:-rls_poc_verify}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Como falar com o Postgres como superusuario. Se estamos como root numa maquina
# com o usuario do SO `postgres` (peer auth do Debian/Ubuntu), passa por ele.
if [ "$(id -u)" = "0" ] && id -u postgres >/dev/null 2>&1; then
  run_psql() { su postgres -c "psql $*"; }
else
  run_psql() { eval "psql $*"; }
fi

PSQL_OPTS="-v ON_ERROR_STOP=1 -X -q"

echo "==> recriando banco $DB"
run_psql "$PSQL_OPTS -d postgres -c 'drop database if exists $DB'"
run_psql "$PSQL_OPTS -d postgres -c 'create database $DB'"

echo "==> shim do ambiente Supabase (roles, schema auth, auth.uid())"
run_psql "$PSQL_OPTS -d $DB -f $ROOT/db/local-verify/00_auth_shim.sql"

echo "==> migrations reais (supabase/migrations/)"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "    - $(basename "$f")"
  run_psql "$PSQL_OPTS -d $DB -f $f"
done

echo "==> seed"
run_psql "$PSQL_OPTS -d $DB -f $ROOT/db/local-verify/10_seed_local.sql"

echo "==> testes de isolamento"
# As assercoes saem como NOTICE, que o psql prefixa com "arquivo:linha:". O sed
# tira so esse prefixo; linhas de ERROR passam intactas.
run_psql "$PSQL_OPTS -d $DB -f $ROOT/db/local-verify/99_tests.sql" 2>&1 \
  | sed -E 's/^psql:[^ ]+ NOTICE:  //'

