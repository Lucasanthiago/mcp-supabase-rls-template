#!/usr/bin/env bash
# Gera db/hosted/schema-completo.sql a partir de supabase/migrations/.
# O arquivo e derivado: a fonte da verdade sao as migrations.
#
#   bash db/hosted/gerar.sh              # regenera no lugar
#   bash db/hosted/gerar.sh /tmp/x.sql   # gera em outro caminho (usado no CI para conferir)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DESTINO="${1:-$ROOT/db/hosted/schema-completo.sql}"

{
  cat <<'CABECALHO'
-- =============================================================================
-- ARQUIVO DERIVADO - nao edite este arquivo.
--
-- E a concatenacao, na ordem, das migrations de supabase/migrations/. A fonte
-- da verdade continua sendo aquela pasta (e ela que o Supabase CLI aplica).
-- Este arquivo existe para um caso so: colar de uma vez no SQL Editor do
-- dashboard, quando o projeto e hosted e nao se esta usando o CLI.
--
-- Para regenerar:  bash db/hosted/gerar.sh
-- =============================================================================

CABECALHO

  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo ""
    echo "-- >>>>> $(basename "$f") <<<<<"
    echo ""
    cat "$f"
  done
} > "$DESTINO"
