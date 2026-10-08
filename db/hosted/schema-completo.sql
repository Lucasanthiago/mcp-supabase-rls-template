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


-- >>>>> 20260910120000_schema.sql <<<<<

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

-- >>>>> 20260910120100_rls_helpers.sql <<<<<

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

-- >>>>> 20260910120200_rls_policies.sql <<<<<

-- =============================================================================
-- Row Level Security: policies
--
-- Tres regras de estilo aplicadas em tudo que vem abaixo:
--
--  1. UMA POLICY POR COMANDO (select/insert/update/delete) em vez de "for all".
--     Policies de comandos diferentes tem semanticas diferentes (USING vs
--     WITH CHECK) e uma policy "for all" esconde essa diferenca. Separado, da
--     para ler a tabela de permissoes direto do arquivo.
--
--  2. `to authenticated`, nunca `to public`. Sem isso a policy tambem e avaliada
--     para o role `anon`, e basta um erro em outro lugar para vazar dado publico.
--
--  3. RLS NAO SUBSTITUI GRANT. Sao dois portoes em serie: sem GRANT o Postgres
--     nem chega a avaliar a policy; sem RLS o GRANT libera a tabela inteira.
--     Os grants explicitos estao no fim do arquivo.
-- =============================================================================

alter table public.organizacoes enable row level security;
alter table public.membros      enable row level security;
alter table public.pacientes    enable row level security;
alter table public.exames       enable row level security;

-- -----------------------------------------------------------------------------
-- organizacoes
--
-- Leitura: so as organizacoes das quais voce e membro.
-- Escrita: NENHUMA policy para `authenticated`.
--   Com RLS ligada e sem policy, o default e negar. Criar/renomear/apagar um
--   tenant e operacao de backoffice (service_role), nao do medico no app.
--   Ausencia de policy aqui e uma decisao, nao um esquecimento.
-- -----------------------------------------------------------------------------
create policy "organizacoes: membro le a propria"
  on public.organizacoes for select to authenticated
  using (public.is_membro(id));

-- -----------------------------------------------------------------------------
-- membros
--
-- Leitura: voce enxerga os colegas das organizacoes das quais participa.
-- Escrita: SO ADMIN.
--   Esta e a tabela que DEFINE pertencimento. Se um medico pudesse inserir
--   linha aqui, ele se auto-adicionaria a organizacao B e todo o isolamento das
--   outras tabelas cairia junto - elas confiam nesta. Por isso e o ponto mais
--   fechado do modelo.
--
-- Note que todas as clausulas passam pelos helpers SECURITY DEFINER: e a tabela
-- onde a recursao aconteceria.
-- -----------------------------------------------------------------------------
create policy "membros: le colegas da propria org"
  on public.membros for select to authenticated
  using (public.is_membro(organizacao_id));

create policy "membros: so admin adiciona"
  on public.membros for insert to authenticated
  with check (public.is_admin(organizacao_id));

create policy "membros: so admin edita"
  on public.membros for update to authenticated
  using (public.is_admin(organizacao_id))
  with check (public.is_admin(organizacao_id));

create policy "membros: so admin remove"
  on public.membros for delete to authenticated
  using (public.is_admin(organizacao_id));

-- -----------------------------------------------------------------------------
-- pacientes
--
-- Medico OPERA (le, cria, edita); admin tambem, e so ele DELETA.
--
-- O UPDATE tem USING **e** WITH CHECK, e a diferenca entre os dois importa:
--   USING      -> quais linhas voce pode sequer alcancar para atualizar.
--   WITH CHECK -> como a linha pode ficar DEPOIS da atualizacao.
--
-- O ataque que isso previne e o "contrabando de tenant":
--     update pacientes set organizacao_id = '<org B>' where id = '<paciente de A>'
-- A linha de origem e minha (passa no USING), mas o destino e outro tenant.
--
-- Medido neste projeto (db/local-verify/), porque a intuicao aqui engana - o
-- Postgres aplica DUAS camadas ao valor NOVO da linha num UPDATE:
--   1. o WITH CHECK da policy de UPDATE; se ele for OMITIDO, o proprio USING e
--      reaproveitado como check (nao e "sem verificacao nenhuma");
--   2. o USING das policies de SELECT, porque nao se pode atualizar uma linha
--      para um estado em que voce nao conseguiria mais le-la.
-- Ou seja: o contrabando so passa se as DUAS camadas estiverem frouxas. Com
-- `with check (true)` aqui e a policy de SELECT intacta, o UPDATE continua
-- barrado; a linha so migra de tenant quando o SELECT tambem vira `using (true)`.
--
-- Entao por que escrever o WITH CHECK explicito? Para nao depender do efeito
-- colateral de outra policy. Se amanha a leitura for afrouxada (um diretorio
-- compartilhado de pacientes, por exemplo), a protecao da escrita nao vai junto.
-- Explicito tambem documenta a intencao para quem revisar depois.
-- -----------------------------------------------------------------------------
create policy "pacientes: le da propria org"
  on public.pacientes for select to authenticated
  using (public.is_membro(organizacao_id));

create policy "pacientes: cria na propria org"
  on public.pacientes for insert to authenticated
  with check (public.is_membro(organizacao_id));

create policy "pacientes: edita dentro da propria org"
  on public.pacientes for update to authenticated
  using (public.is_membro(organizacao_id))
  with check (public.is_membro(organizacao_id));

create policy "pacientes: so admin deleta"
  on public.pacientes for delete to authenticated
  using (public.is_admin(organizacao_id));

-- -----------------------------------------------------------------------------
-- exames
--
-- Mesma forma de pacientes - possivel justamente por causa do organizacao_id
-- denormalizado. Quem garante que o exame nao acaba num paciente de outra org
-- nao e a policy, e a FK composta definida no schema.
-- -----------------------------------------------------------------------------
create policy "exames: le da propria org"
  on public.exames for select to authenticated
  using (public.is_membro(organizacao_id));

create policy "exames: cria na propria org"
  on public.exames for insert to authenticated
  with check (public.is_membro(organizacao_id));

create policy "exames: edita dentro da propria org"
  on public.exames for update to authenticated
  using (public.is_membro(organizacao_id))
  with check (public.is_membro(organizacao_id));

create policy "exames: so admin deleta"
  on public.exames for delete to authenticated
  using (public.is_admin(organizacao_id));

-- -----------------------------------------------------------------------------
-- Grants (o outro portao)
--
-- O role `anon` (usuario nao autenticado, que a anon key materializa) nao tem
-- nada a fazer nestas tabelas. Revogamos o grant em vez de confiar so na
-- ausencia de policy: duas barreiras independentes.
-- -----------------------------------------------------------------------------
revoke all on public.organizacoes from anon;
revoke all on public.membros      from anon;
revoke all on public.pacientes    from anon;
revoke all on public.exames       from anon;

grant select                         on public.organizacoes to authenticated;
grant select, insert, update, delete on public.membros      to authenticated;
grant select, insert, update, delete on public.pacientes    to authenticated;
grant select, insert, update, delete on public.exames       to authenticated;
