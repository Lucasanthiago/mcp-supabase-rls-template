/**
 * Runner minimalista de assercoes.
 *
 * Nao ha framework de teste aqui de proposito: a saida deste script E a prova
 * de isolamento que vai colada no README, entao ela precisa ser legivel por
 * uma pessoa, nao so por um CI.
 */

import type { PostgrestError } from '@supabase/supabase-js';

interface Resultado {
  label: string;
  ok: boolean;
  detalhe: string;
}

const resultados: Resultado[] = [];

export function secao(titulo: string): void {
  console.log(`\n=== ${titulo} ${'='.repeat(Math.max(0, 66 - titulo.length))}`);
}

export function nota(texto: string): void {
  console.log(`    ${texto}`);
}

/** Registra um caso. `detalhe` deve dizer o que de fato aconteceu. */
export function caso(label: string, ok: boolean, detalhe: string): void {
  resultados.push({ label, ok, detalhe });
  const marca = ok ? 'OK  ' : 'FALHOU';
  console.log(`  ${marca}  ${label}`);
  console.log(`          -> ${detalhe}`);
}

/**
 * Uma escrita foi bloqueada pela RLS?
 *
 * O Postgres devolve 42501 ("new row violates row-level security policy")
 * quando a linha nova nao passa no WITH CHECK. Checar o codigo, e nao so "deu
 * erro", evita que um erro de digitacao no nome da tabela vire um falso OK.
 */
export function bloqueadaPorRls(error: PostgrestError | null): boolean {
  return error?.code === '42501';
}

/** Descreve um erro do PostgREST em uma linha. */
export function descreveErro(error: PostgrestError | null): string {
  if (!error) return 'nenhum erro (a operacao passou)';
  return `${error.code}: ${error.message}`;
}

export function resumo(): void {
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(72)}`);
  if (falhas.length === 0) {
    console.log(`TODOS OS ${resultados.length} CASOS PASSARAM - isolamento entre tenants confirmado.`);
    return;
  }
  console.log(`${falhas.length} de ${resultados.length} casos FALHARAM:`);
  for (const f of falhas) console.log(`  - ${f.label}\n      ${f.detalhe}`);
  process.exitCode = 1;
}
