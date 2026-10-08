-- =============================================================================
-- Helpers de RLS
--
-- POR QUE ESSAS FUNCOES EXISTEM (e o ponto central do aprendizado aqui):
--
-- A policy de SELECT da tabela `membros` precisa consultar `membros` para saber
-- se voce e membro da organizacao. Escrito inline:
--
--     create policy ... on public.membros for select
--       using (organizacao_id in (select organizacao_id from public.membros
--                                 where user_id = auth.uid()));
--
-- ...o Postgres reaplica a RLS de `membros` DENTRO da subconsulta, que reaplica
-- de novo, e o resultado e o erro 42P17 "infinite recursion detected in policy
-- for relation membros".
--
-- Uma funcao SECURITY DEFINER roda com os privilegios do dono da tabela, e o
-- dono nao esta sujeito a RLS (a menos que se use FORCE ROW LEVEL SECURITY).
-- Isso quebra o ciclo. E o padrao recomendado pela propria Supabase.
--
-- Cuidados obrigatorios ao usar SECURITY DEFINER:
--   * `set search_path = ''` + todos os nomes qualificados. Sem isso, um usuario
--     pode criar uma tabela `membros` num schema que ele controla e sequestrar a
--     resolucao de nome dentro de uma funcao privilegiada - escalonamento classico.
--   * `stable`: o resultado nao muda dentro do mesmo statement, entao o planner
--     pode chamar uma vez em vez de uma vez por linha.
--   * NUNCA usar `alter table public.membros force row level security`. Com FORCE,
--     ate o dono passa a ser filtrado pela RLS e o helper volta a nao enxergar nada.
--   * `revoke ... from anon`: quem nao autenticou nao tem por que sondar isso.
-- =============================================================================

-- O usuario logado e membro desta organizacao? (qualquer papel)
create or replace function public.is_membro(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membros m
    where m.organizacao_id = org
      and m.user_id = (select auth.uid())
  );
$$;

-- O usuario logado e ADMIN desta organizacao?
create or replace function public.is_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.membros m
    where m.organizacao_id = org
      and m.user_id = (select auth.uid())
      and m.papel = 'admin'
  );
$$;

comment on function public.is_membro(uuid) is
  'RLS helper. SECURITY DEFINER para evitar recursao infinita nas policies de membros.';
comment on function public.is_admin(uuid) is
  'RLS helper. Papel admin dentro da organizacao (gerencia membros e deleta dados).';

revoke execute on function public.is_membro(uuid) from public, anon;
revoke execute on function public.is_admin(uuid)  from public, anon;
grant  execute on function public.is_membro(uuid) to authenticated;
grant  execute on function public.is_admin(uuid)  to authenticated;
