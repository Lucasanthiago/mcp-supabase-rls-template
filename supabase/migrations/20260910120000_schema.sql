-- =============================================================================
-- Schema minimo multitenant: duas clinicas no mesmo banco
--
-- Cadeia de pertencimento que todo o RLS vai usar:
--   exame -> paciente -> organizacao -> membro -> auth.users (auth.uid())
-- =============================================================================

-- Papel do usuario DENTRO de uma organizacao. Nao e um papel global: a mesma
-- pessoa pode ser admin na clinica A e medico na clinica B.
create type public.papel_membro as enum ('admin', 'medico');

-- -----------------------------------------------------------------------------
-- organizacoes: o tenant. Uma clinica.
-- -----------------------------------------------------------------------------
create table public.organizacoes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  criado_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- membros: liga auth.users <-> organizacoes. E a TABELA-RAIZ DE CONFIANCA do
-- modelo: todas as policies das outras tabelas perguntam "existe linha aqui?".
-- Por isso a escrita nela e a mais restrita de todas (so admin).
-- -----------------------------------------------------------------------------
create table public.membros (
  id             uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  papel          public.papel_membro not null default 'medico',
  criado_em      timestamptz not null default now(),
  unique (organizacao_id, user_id)
);

-- -----------------------------------------------------------------------------
-- pacientes: pertence diretamente a uma organizacao.
-- -----------------------------------------------------------------------------
create table public.pacientes (
  id              uuid primary key default gen_random_uuid(),
  organizacao_id  uuid not null references public.organizacoes (id) on delete cascade,
  nome            text not null,
  data_nascimento date,
  criado_por      uuid references auth.users (id) on delete set null,
  criado_em       timestamptz not null default now(),

  -- Necessario para a FK composta de exames (ver abaixo). Redundante com a PK
  -- do ponto de vista de unicidade, mas e o que permite referenciar o par.
  unique (id, organizacao_id)
);

-- -----------------------------------------------------------------------------
-- exames: pertence a um paciente e, transitivamente, a uma organizacao.
--
-- organizacao_id e DENORMALIZADO de proposito:
--   1. Performance: sem essa coluna, a policy de exames precisaria de um
--      subselect em pacientes (que tambem tem RLS) para CADA linha avaliada.
--      Com ela, a policy vira uma checagem direta que usa indice.
--   2. Simetria: exames e pacientes ficam com policies de forma identica,
--      mais faceis de auditar.
--
-- O risco de dado denormalizado e divergir. A FK COMPOSTA abaixo torna a
-- divergencia impossivel no nivel do banco: um exame so pode apontar para um
-- paciente que esteja na MESMA organizacao. Isso e garantia estrutural, nao
-- convencao - e continua valendo mesmo se alguem escrever com service_role.
-- -----------------------------------------------------------------------------
create table public.exames (
  id             uuid primary key default gen_random_uuid(),
  paciente_id    uuid not null,
  organizacao_id uuid not null,
  tipo           text not null,
  resultado      text,
  realizado_em   timestamptz not null default now(),
  criado_por     uuid references auth.users (id) on delete set null,
  criado_em      timestamptz not null default now(),

  foreign key (paciente_id, organizacao_id)
    references public.pacientes (id, organizacao_id)
    on update cascade
    on delete cascade
);

-- -----------------------------------------------------------------------------
-- Indices: exatamente as colunas pelas quais as policies filtram.
-- Uma policy sem indice por baixo vira seq scan em toda leitura.
-- -----------------------------------------------------------------------------
create index membros_user_id_idx        on public.membros (user_id);
create index membros_organizacao_id_idx on public.membros (organizacao_id);
create index pacientes_organizacao_idx  on public.pacientes (organizacao_id);
create index exames_organizacao_idx     on public.exames (organizacao_id);
create index exames_paciente_idx        on public.exames (paciente_id);
