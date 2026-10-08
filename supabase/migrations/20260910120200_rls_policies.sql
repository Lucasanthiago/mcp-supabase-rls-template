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
