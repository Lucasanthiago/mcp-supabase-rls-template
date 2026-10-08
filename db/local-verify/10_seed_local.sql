-- =============================================================================
-- Seed do harness local. Mesmos UUIDs fixos de scripts/lib/fixtures.ts para as
-- organizacoes, pacientes e exames.
--
-- Diferenca em relacao ao seed real: aqui os IDs dos usuarios tambem sao fixos,
-- porque estamos inserindo direto na tabela auth.users do shim. Contra o
-- Supabase de verdade os usuarios sao criados pela Admin API e o id vem dela.
-- =============================================================================

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin.alfa@exemplo.test'),
  ('a0000000-0000-4000-8000-000000000002', 'medico.alfa@exemplo.test'),
  ('b0000000-0000-4000-8000-000000000001', 'admin.beta@exemplo.test'),
  ('b0000000-0000-4000-8000-000000000002', 'medico.beta@exemplo.test');

insert into public.organizacoes (id, nome) values
  ('11111111-1111-4111-8111-111111111111', 'Clinica Alfa'),
  ('22222222-2222-4222-8222-222222222222', 'Clinica Beta');

insert into public.membros (organizacao_id, user_id, papel) values
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000001', 'admin'),
  ('11111111-1111-4111-8111-111111111111', 'a0000000-0000-4000-8000-000000000002', 'medico'),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000001', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'b0000000-0000-4000-8000-000000000002', 'medico');

insert into public.pacientes (id, organizacao_id, nome, data_nascimento) values
  ('aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Ana Alves (Alfa)',    '1985-03-12'),
  ('aaaa0002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Artur Braga (Alfa)',  '1972-11-02'),
  ('bbbb0001-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Bruna Costa (Beta)',  '1990-07-25'),
  ('bbbb0002-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Bento Dias (Beta)',   '1966-01-30');

insert into public.exames (id, paciente_id, organizacao_id, tipo, resultado) values
  ('aaae0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Hemograma',   'Normal'),
  ('aaae0002-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Raio-X torax','Sem alteracoes'),
  ('aaae0003-0000-4000-8000-000000000003', 'aaaa0002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Glicemia',    '92 mg/dL'),
  ('bbbe0001-0000-4000-8000-000000000001', 'bbbb0001-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Hemograma',   'Leve anemia'),
  ('bbbe0002-0000-4000-8000-000000000002', 'bbbb0002-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Ultrassom',   'Normal');
