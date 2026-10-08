-- =============================================================================
-- Matriz de isolamento executada direto no Postgres.
--
-- Cada `set request.jwt.claims` + `set role authenticated` equivale ao que o
-- PostgREST faz ao receber o JWT de um usuario logado.
--
-- Falhou = o script aborta com "FALHOU: <caso>" (ON_ERROR_STOP).
-- =============================================================================
-- Tudo roda dentro de uma transacao que termina em ROLLBACK: os casos escrevem
-- (inserem exame, deletam paciente) mas o banco volta ao estado do seed, entao
-- o arquivo pode ser reexecutado quantas vezes se quiser.
begin;

\echo ''
\echo '=== CONTROLE (dono da tabela, sem RLS) ==============================='
\echo 'Sem esta secao, "0 linhas" nao provaria nada: poderia ser tabela vazia.'

do $$
begin
  perform harness.assert((select count(*) from public.organizacoes) = 2, 'existem 2 organizacoes no banco');
  perform harness.assert((select count(*) from public.pacientes)    = 4, 'existem 4 pacientes no banco (2 por org)');
  perform harness.assert((select count(*) from public.exames)       = 5, 'existem 5 exames no banco (3 Alfa + 2 Beta)');
end $$;

\echo ''
\echo '=== MEDICO DA CLINICA ALFA ==========================================='
reset role;
set request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000002"}';
set role authenticated;

do $$
declare
  org_b      constant uuid := '22222222-2222-4222-8222-222222222222';
  org_a      constant uuid := '11111111-1111-4111-8111-111111111111';
  pac_a1     constant uuid := 'aaaa0001-0000-4000-8000-000000000001';
  pac_b1     constant uuid := 'bbbb0001-0000-4000-8000-000000000001';
  n          integer;
  bloqueado  boolean;
begin
  -- 1. so ve pacientes da propria organizacao
  perform harness.assert(
    (select count(*) from public.pacientes) = 2
    and not exists (select 1 from public.pacientes where organizacao_id <> org_a),
    '1. le 2 pacientes, todos da Alfa');

  -- 2. idem para exames
  perform harness.assert(
    (select count(*) from public.exames) = 3
    and not exists (select 1 from public.exames where organizacao_id <> org_a),
    '2. le 3 exames, todos da Alfa');

  -- 3. leitura direcionada a um paciente da Beta: 0 linhas, NAO um erro.
  --    A RLS filtra o SELECT silenciosamente - o dado nao existe do seu ponto
  --    de vista. Quem so testa "deu erro?" nao percebe isso.
  perform harness.assert(
    (select count(*) from public.pacientes where id = pac_b1) = 0,
    '3. paciente da Beta buscado por id: 0 linhas (RLS filtra, nao da erro)');

  -- 4. inserir paciente na organizacao alheia: bloqueado pelo WITH CHECK
  bloqueado := false;
  begin
    insert into public.pacientes (organizacao_id, nome) values (org_b, 'Invasor');
  exception when insufficient_privilege then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '4. INSERT de paciente na Beta bloqueado (42501)');

  -- 5. atualizar paciente da Beta: o USING nem deixa alcancar a linha
  update public.pacientes set nome = 'Sequestrado' where id = pac_b1;
  get diagnostics n = row_count;
  perform harness.assert(n = 0, '5. UPDATE em paciente da Beta afeta 0 linhas (USING)');

  -- 6. O CONTRABANDO: mover um paciente MEU para a organizacao alheia.
  --    A linha de origem passa no USING (e minha); o que barra e a validacao do
  --    valor NOVO. Ver o comentario longo em 20260910120200_rls_policies.sql:
  --    sao duas camadas (WITH CHECK do UPDATE + USING do SELECT aplicado a linha
  --    nova) e o vazamento so acontece se ambas estiverem frouxas.
  bloqueado := false;
  begin
    update public.pacientes set organizacao_id = org_b where id = pac_a1;
  exception when insufficient_privilege then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '6. UPDATE movendo paciente proprio para a Beta bloqueado (WITH CHECK)');

  -- 7. inserir exame na organizacao alheia
  bloqueado := false;
  begin
    insert into public.exames (paciente_id, organizacao_id, tipo)
    values (pac_b1, org_b, 'Exame intruso');
  exception when insufficient_privilege then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '7. INSERT de exame na Beta bloqueado (42501)');

  -- 7b. tentar "puxar" o paciente da Beta para dentro da minha org: a RLS
  --     aprovaria (org_a e minha), quem barra e a FK COMPOSTA do schema.
  bloqueado := false;
  begin
    insert into public.exames (paciente_id, organizacao_id, tipo)
    values (pac_b1, org_a, 'Exame com paciente alheio');
  exception when foreign_key_violation then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '7b. exame apontando paciente da Beta com org propria barrado pela FK composta (23503)');

  -- 8. medico nao deleta (eixo papel)
  delete from public.pacientes where id = pac_a1;
  get diagnostics n = row_count;
  perform harness.assert(n = 0, '8. DELETE de paciente proprio afeta 0 linhas (medico nao deleta)');

  -- 9. CONTROLE POSITIVO: o caso legitimo tem de funcionar. Uma policy que
  --    bloqueia tudo tambem passaria nos testes 1-8.
  insert into public.exames (paciente_id, organizacao_id, tipo, resultado)
  values (pac_a1, org_a, 'Exame legitimo do medico', 'ok');
  get diagnostics n = row_count;
  perform harness.assert(n = 1, '9. INSERT de exame no proprio paciente FUNCIONA (controle positivo)');

  -- 10. medico nao mexe em membros
  bloqueado := false;
  begin
    insert into public.membros (organizacao_id, user_id, papel)
    values (org_a, 'b0000000-0000-4000-8000-000000000002', 'medico');
  exception when insufficient_privilege then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '10. INSERT em membros bloqueado para medico (so admin gerencia)');

  -- 11. organizacoes tambem sao filtradas
  perform harness.assert(
    (select count(*) from public.organizacoes) = 1
    and (select id from public.organizacoes) = org_a,
    '11. enxerga 1 organizacao (a Alfa)');
end $$;

\echo ''
\echo '=== ADMIN DA CLINICA ALFA ============================================'
reset role;
set request.jwt.claims = '{"sub":"a0000000-0000-4000-8000-000000000001"}';
set role authenticated;

do $$
declare
  org_a      constant uuid := '11111111-1111-4111-8111-111111111111';
  org_b      constant uuid := '22222222-2222-4222-8222-222222222222';
  descartavel constant uuid := 'cccc0001-0000-4000-8000-000000000001';
  n          integer;
  bloqueado  boolean;
begin
  -- 12. admin deleta (o que o medico nao conseguiu no caso 8)
  insert into public.pacientes (id, organizacao_id, nome) values (descartavel, org_a, 'Paciente descartavel');
  delete from public.pacientes where id = descartavel;
  get diagnostics n = row_count;
  perform harness.assert(n = 1, '12. DELETE de paciente pelo admin FUNCIONA (eixo papel confirmado)');

  -- 13. admin gerencia membros da propria org
  insert into public.membros (organizacao_id, user_id, papel)
  values (org_a, 'b0000000-0000-4000-8000-000000000001', 'medico');
  get diagnostics n = row_count;
  perform harness.assert(n = 1, '13. admin adiciona membro na propria org');
  delete from public.membros where organizacao_id = org_a and user_id = 'b0000000-0000-4000-8000-000000000001';

  -- 14. ...mas nao na organizacao alheia. Ser admin nao atravessa o tenant.
  bloqueado := false;
  begin
    insert into public.membros (organizacao_id, user_id, papel)
    values (org_b, 'a0000000-0000-4000-8000-000000000001', 'admin');
  exception when insufficient_privilege then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '14. admin da Alfa NAO adiciona membro na Beta (papel nao atravessa tenant)');
end $$;

\echo ''
\echo '=== MEDICO DA CLINICA BETA (o isolamento e simetrico) ================='
reset role;
set request.jwt.claims = '{"sub":"b0000000-0000-4000-8000-000000000002"}';
set role authenticated;

do $$
declare
  org_a     constant uuid := '11111111-1111-4111-8111-111111111111';
  org_b     constant uuid := '22222222-2222-4222-8222-222222222222';
  pac_a1    constant uuid := 'aaaa0001-0000-4000-8000-000000000001';
  n         integer;
  bloqueado boolean;
begin
  -- 15. so ve o proprio tenant. Note que a Alfa ganhou um exame no caso 9;
  --     a contagem da Beta nao se mexe.
  perform harness.assert(
    (select count(*) from public.pacientes) = 2
    and not exists (select 1 from public.pacientes where organizacao_id <> org_b),
    '15. le 2 pacientes, todos da Beta');
  perform harness.assert(
    (select count(*) from public.exames) = 2
    and not exists (select 1 from public.exames where organizacao_id <> org_b),
    '16. le 2 exames, todos da Beta (o exame criado na Alfa nao aparece)');

  -- 17. nao alcanca a Alfa
  perform harness.assert(
    (select count(*) from public.pacientes where id = pac_a1) = 0,
    '17. paciente da Alfa buscado por id: 0 linhas');

  update public.pacientes set nome = 'Sequestrado' where id = pac_a1;
  get diagnostics n = row_count;
  perform harness.assert(n = 0, '18. UPDATE em paciente da Alfa afeta 0 linhas');

  bloqueado := false;
  begin
    insert into public.pacientes (organizacao_id, nome) values (org_a, 'Invasor reverso');
  exception when insufficient_privilege then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '19. INSERT de paciente na Alfa bloqueado (42501)');
end $$;

\echo ''
\echo '=== SEM LOGIN (role anon) ============================================'
reset role;
set request.jwt.claims = '';
set role anon;

do $$
declare bloqueado boolean := false;
begin
  begin
    perform 1 from public.pacientes;
  exception when insufficient_privilege then bloqueado := true;
  end;
  perform harness.assert(bloqueado, '20. anon nem chega na tabela (GRANT revogado, antes mesmo da policy)');
end $$;

reset role;
rollback;

\echo ''
\echo '=== TODOS OS CASOS PASSARAM =========================================='
