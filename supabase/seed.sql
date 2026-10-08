-- =============================================================================
-- Seed OPCIONAL, executado automaticamente por `supabase db reset`.
--
-- Cobre so os dados de dominio. Usuarios NAO sao criados aqui de proposito
-- (ver o cabecalho de scripts/seed.ts: inserir credencial na mao em auth.users
-- quebra em silencio quando o formato do GoTrue muda). O caminho oficial deste
-- projeto continua sendo `npm run seed`, que cria os usuarios pela Admin API e
-- reinsere estes mesmos dados.
--
-- Utilidade deste arquivo: depois de um `supabase db reset`, o banco ja volta
-- com as duas clinicas e seus pacientes/exames mesmo antes de rodar o Node -
-- e, se os usuarios de teste ja existirem, os vinculos em `membros` sao
-- refeitos pelo email.
-- =============================================================================

insert into public.organizacoes (id, nome) values
  ('11111111-1111-4111-8111-111111111111', 'Clinica Alfa'),
  ('22222222-2222-4222-8222-222222222222', 'Clinica Beta')
on conflict (id) do nothing;

insert into public.pacientes (id, organizacao_id, nome, data_nascimento) values
  ('aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Ana Alves (Alfa)',   '1985-03-12'),
  ('aaaa0002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Artur Braga (Alfa)', '1972-11-02'),
  ('bbbb0001-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Bruna Costa (Beta)', '1990-07-25'),
  ('bbbb0002-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Bento Dias (Beta)',  '1966-01-30')
on conflict (id) do nothing;

insert into public.exames (id, paciente_id, organizacao_id, tipo, resultado) values
  ('aaae0001-0000-4000-8000-000000000001', 'aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Hemograma',    'Normal'),
  ('aaae0002-0000-4000-8000-000000000002', 'aaaa0001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Raio-X torax', 'Sem alteracoes'),
  ('aaae0003-0000-4000-8000-000000000003', 'aaaa0002-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Glicemia',     '92 mg/dL'),
  ('bbbe0001-0000-4000-8000-000000000001', 'bbbb0001-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Hemograma',    'Leve anemia'),
  ('bbbe0002-0000-4000-8000-000000000002', 'bbbb0002-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Ultrassom',    'Normal')
on conflict (id) do nothing;

-- Vinculos, so para os usuarios de teste que ja existirem em auth.users.
-- Num banco recem-resetado isto nao insere nada, e esta correto: `npm run seed`
-- cria os usuarios e refaz os vinculos.
insert into public.membros (organizacao_id, user_id, papel)
select v.org, u.id, v.papel
from (values
  ('11111111-1111-4111-8111-111111111111'::uuid, 'admin.alfa@exemplo.test',  'admin'::public.papel_membro),
  ('11111111-1111-4111-8111-111111111111'::uuid, 'medico.alfa@exemplo.test', 'medico'::public.papel_membro),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'admin.beta@exemplo.test',  'admin'::public.papel_membro),
  ('22222222-2222-4222-8222-222222222222'::uuid, 'medico.beta@exemplo.test', 'medico'::public.papel_membro)
) as v(org, email, papel)
join auth.users u on u.email = v.email
on conflict (organizacao_id, user_id) do nothing;
