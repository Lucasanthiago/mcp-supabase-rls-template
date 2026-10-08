-- =============================================================================
-- SHIM do ambiente Supabase para PostgreSQL puro.
--
-- ISTO NAO E O SUPABASE. E o minimo que o Supabase fornece e do qual as
-- migrations dependem, recriado a mao para que as MIGRATIONS REAIS possam ser
-- aplicadas e as policies possam ser executadas sem Docker/GoTrue/PostgREST:
--
--   * os roles anon / authenticated / service_role;
--   * o schema auth com a tabela auth.users (alvo das FKs);
--   * auth.uid(), que no Supabase le o `sub` do JWT injetado pelo PostgREST em
--     `request.jwt.claims`. Aqui a claim e setada a mao com SET, que e
--     exatamente o que o PostgREST faz por baixo.
--
-- O que este harness prova: a logica das policies e o comportamento da RLS no
-- Postgres. O que ele NAO prova: login real, emissao de JWT e o PostgREST -
-- isso e o papel de scripts/test-isolamento.ts contra um Supabase de verdade.
-- =============================================================================

-- Roles do Supabase -----------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- Schema auth -----------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

-- Mesma definicao que o Supabase usa: le o claim `sub` do JWT da requisicao.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

grant usage   on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Utilitario de assercao, so do harness (nao existe nas migrations) -----------
create schema if not exists harness;
grant usage on schema harness to authenticated, anon;

create or replace function harness.assert(cond boolean, label text)
returns void
language plpgsql
as $$
begin
  if cond is true then
    raise notice '  OK    %', label;
  else
    raise exception 'FALHOU: %', label;
  end if;
end;
$$;

grant execute on function harness.assert(boolean, text) to authenticated, anon;
