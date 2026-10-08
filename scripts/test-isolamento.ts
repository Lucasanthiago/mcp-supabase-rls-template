/**
 * Prova de isolamento entre tenants, ponta a ponta.
 *
 * Diferente do harness de db/local-verify/ (que fala SQL direto com o Postgres),
 * aqui o caminho e o mesmo do app real: anon key -> login -> JWT -> PostgREST ->
 * auth.uid() -> policy. Se o isolamento passa aqui, passa para o medico.
 *
 * Estrutura de cada caso: o que se tenta, o que se esperava, o que aconteceu.
 * A saida e feita para ser lida e colada no README.
 */

import { comoUsuario, anonClient, serviceClient } from './lib/clients';
import { bloqueadaPorRls, caso, descreveErro, nota, resumo, secao } from './lib/assert';
import {
  ORG_ALFA,
  ORG_BETA,
  PACIENTE_ALFA_1,
  PACIENTE_BETA_1,
  usuario,
} from './lib/fixtures';

// Linhas criadas durante o teste; removidas no fim para que ele seja reexecutavel.
const EXAME_CRIADO = 'aaae9999-0000-4000-8000-000000000009';
const PACIENTE_DESCARTAVEL = 'cccc0001-0000-4000-8000-000000000001';

async function main(): Promise<void> {
  const db = serviceClient();

  // ---------------------------------------------------------------------------
  secao('CONTROLE (service_role - ignora a RLS)');
  nota('Sem esta secao o teste nao provaria nada: "0 linhas" tambem e o que se');
  nota('ve numa tabela vazia. Aqui ficam as contagens REAIS de cada tenant.');

  const contar = async (tabela: string, org: string): Promise<number> => {
    const { count, error } = await db
      .from(tabela)
      .select('id', { count: 'exact', head: true })
      .eq('organizacao_id', org);
    if (error) throw new Error(`controle ${tabela}: ${error.message}`);
    return count ?? 0;
  };

  const real = {
    pacientesAlfa: await contar('pacientes', ORG_ALFA),
    pacientesBeta: await contar('pacientes', ORG_BETA),
    examesAlfa: await contar('exames', ORG_ALFA),
    examesBeta: await contar('exames', ORG_BETA),
  };
  nota(`Alfa: ${real.pacientesAlfa} pacientes, ${real.examesAlfa} exames`);
  nota(`Beta: ${real.pacientesBeta} pacientes, ${real.examesBeta} exames`);

  caso(
    '0. as duas organizacoes tem dados no banco',
    real.pacientesAlfa > 0 && real.pacientesBeta > 0 && real.examesAlfa > 0 && real.examesBeta > 0,
    `Alfa ${real.pacientesAlfa}p/${real.examesAlfa}e, Beta ${real.pacientesBeta}p/${real.examesBeta}e`,
  );

  // Resolvido cedo porque o caso 10 precisa de um user_id que AINDA NAO seja
  // membro da Alfa: reusar alguem que ja e membro dispararia violacao de
  // unicidade (23505) e mascararia o bloqueio de RLS que queremos observar.
  const uMedicoBeta = usuario('medicoBeta');
  const medicoBetaSessao = await comoUsuario(uMedicoBeta.email, uMedicoBeta.senha);
  const idMedicoBeta = medicoBetaSessao.userId;

  // ---------------------------------------------------------------------------
  secao('MEDICO DA CLINICA ALFA');
  const uMedicoAlfa = usuario('medicoAlfa');
  const medicoAlfa = await comoUsuario(uMedicoAlfa.email, uMedicoAlfa.senha);
  nota(`logado como ${medicoAlfa.email} (auth.uid() = ${medicoAlfa.userId})`);
  const ca = medicoAlfa.client;

  {
    const { data, error } = await ca.from('pacientes').select('id, organizacao_id');
    const foraDaAlfa = (data ?? []).filter((p) => p.organizacao_id !== ORG_ALFA);
    caso(
      '1. le pacientes: so os da Alfa',
      !error && data?.length === real.pacientesAlfa && foraDaAlfa.length === 0,
      `recebeu ${data?.length ?? 0} de ${real.pacientesAlfa + real.pacientesBeta} pacientes do banco; ` +
        `${foraDaAlfa.length} de outra org. ${descreveErro(error)}`,
    );
  }

  {
    const { data, error } = await ca.from('exames').select('id, organizacao_id');
    const foraDaAlfa = (data ?? []).filter((e) => e.organizacao_id !== ORG_ALFA);
    caso(
      '2. le exames: so os da Alfa',
      !error && data?.length === real.examesAlfa && foraDaAlfa.length === 0,
      `recebeu ${data?.length ?? 0} de ${real.examesAlfa + real.examesBeta} exames do banco; ` +
        `${foraDaAlfa.length} de outra org. ${descreveErro(error)}`,
    );
  }

  {
    // Ponto didatico: leitura barrada nao vira erro 403. A linha simplesmente
    // nao existe do ponto de vista de quem consulta.
    const { data, error } = await ca.from('pacientes').select('id').eq('id', PACIENTE_BETA_1);
    caso(
      '3. busca por id um paciente da Beta: 0 linhas, sem erro',
      !error && data?.length === 0,
      `${data?.length ?? 0} linha(s), ${descreveErro(error)}`,
    );
  }

  {
    const { error } = await ca
      .from('pacientes')
      .insert({ organizacao_id: ORG_BETA, nome: 'Invasor' })
      .select();
    caso('4. INSERT de paciente na Beta e bloqueado', bloqueadaPorRls(error), descreveErro(error));
  }

  {
    const { data, error } = await ca
      .from('pacientes')
      .update({ nome: 'Sequestrado' })
      .eq('id', PACIENTE_BETA_1)
      .select();
    caso(
      '5. UPDATE em paciente da Beta afeta 0 linhas',
      !error && data?.length === 0,
      `${data?.length ?? 0} linha(s) alterada(s) (o USING nem alcanca a linha), ${descreveErro(error)}`,
    );
  }

  {
    // O contrabando de tenant. Ver o comentario longo em
    // supabase/migrations/20260910120200_rls_policies.sql: sao duas camadas
    // validando o valor NOVO da linha.
    const { error } = await ca
      .from('pacientes')
      .update({ organizacao_id: ORG_BETA })
      .eq('id', PACIENTE_ALFA_1)
      .select();
    caso(
      '6. UPDATE movendo um paciente PROPRIO para a Beta e bloqueado',
      bloqueadaPorRls(error),
      descreveErro(error),
    );
  }

  {
    const { error } = await ca
      .from('exames')
      .insert({ paciente_id: PACIENTE_BETA_1, organizacao_id: ORG_BETA, tipo: 'Exame intruso' })
      .select();
    caso('7. INSERT de exame na Beta e bloqueado', bloqueadaPorRls(error), descreveErro(error));
  }

  {
    // Aqui a RLS aprovaria (a org declarada e a minha); quem barra e a FK
    // composta do schema, que exige que o par (paciente, org) exista.
    const { error } = await ca
      .from('exames')
      .insert({ paciente_id: PACIENTE_BETA_1, organizacao_id: ORG_ALFA, tipo: 'Paciente alheio' })
      .select();
    caso(
      '7b. exame apontando paciente da Beta sob a org propria e barrado pela FK composta',
      error?.code === '23503',
      descreveErro(error),
    );
  }

  {
    const { data, error } = await ca.from('pacientes').delete().eq('id', PACIENTE_ALFA_1).select();
    caso(
      '8. DELETE de paciente proprio afeta 0 linhas (medico nao deleta)',
      !error && data?.length === 0,
      `${data?.length ?? 0} linha(s) removida(s), ${descreveErro(error)}`,
    );
  }

  {
    // CONTROLE POSITIVO: uma policy que bloqueia tudo tambem passaria nos casos
    // 1-8. O fluxo legitimo do medico precisa funcionar.
    const { data, error } = await ca
      .from('exames')
      .insert({
        id: EXAME_CRIADO,
        paciente_id: PACIENTE_ALFA_1,
        organizacao_id: ORG_ALFA,
        tipo: 'Exame criado pelo medico',
        resultado: 'ok',
      })
      .select();
    caso(
      '9. INSERT de exame no proprio paciente FUNCIONA (controle positivo)',
      !error && data?.length === 1,
      `${data?.length ?? 0} linha(s) inserida(s), ${descreveErro(error)}`,
    );
  }

  {
    const { error } = await ca
      .from('membros')
      .insert({ organizacao_id: ORG_ALFA, user_id: idMedicoBeta, papel: 'medico' })
      .select();
    caso(
      '10. medico nao escreve em membros (nem na propria org)',
      bloqueadaPorRls(error),
      descreveErro(error),
    );
  }

  {
    const { data, error } = await ca.from('organizacoes').select('id, nome');
    caso(
      '11. enxerga 1 organizacao (a Alfa)',
      !error && data?.length === 1 && data[0]?.id === ORG_ALFA,
      `${data?.length ?? 0} organizacao(oes): ${(data ?? []).map((o) => o.nome).join(', ')}`,
    );
  }

  // ---------------------------------------------------------------------------
  secao('ADMIN DA CLINICA ALFA (o eixo papel)');
  const uAdminAlfa = usuario('adminAlfa');
  const adminAlfa = await comoUsuario(uAdminAlfa.email, uAdminAlfa.senha);
  nota(`logado como ${adminAlfa.email}`);
  const aa = adminAlfa.client;

  {
    await aa
      .from('pacientes')
      .insert({ id: PACIENTE_DESCARTAVEL, organizacao_id: ORG_ALFA, nome: 'Paciente descartavel' })
      .select();
    const { data, error } = await aa.from('pacientes').delete().eq('id', PACIENTE_DESCARTAVEL).select();
    caso(
      '12. DELETE de paciente pelo admin FUNCIONA (o que o medico nao pode no caso 8)',
      !error && data?.length === 1,
      `${data?.length ?? 0} linha(s) removida(s), ${descreveErro(error)}`,
    );
  }

  {
    const { data, error } = await aa
      .from('membros')
      .insert({ organizacao_id: ORG_ALFA, user_id: idMedicoBeta, papel: 'medico' })
      .select();
    caso(
      '13. admin adiciona membro na PROPRIA org',
      !error && data?.length === 1,
      `${data?.length ?? 0} linha(s) inserida(s), ${descreveErro(error)}`,
    );
    // Desfaz antes da secao da Beta - senao o medico da Beta passaria a ser
    // membro da Alfa e o caso 15 falharia (com razao).
    const { data: removidos } = await aa
      .from('membros')
      .delete()
      .eq('organizacao_id', ORG_ALFA)
      .eq('user_id', idMedicoBeta)
      .select();
    caso(
      '14. admin remove membro da propria org',
      removidos?.length === 1,
      `${removidos?.length ?? 0} linha(s) removida(s)`,
    );
  }

  {
    const { error } = await aa
      .from('membros')
      .insert({ organizacao_id: ORG_BETA, user_id: adminAlfa.userId, papel: 'admin' })
      .select();
    caso(
      '15. admin da Alfa NAO adiciona membro na Beta (papel nao atravessa o tenant)',
      bloqueadaPorRls(error),
      descreveErro(error),
    );
  }

  // ---------------------------------------------------------------------------
  secao('MEDICO DA CLINICA BETA (o isolamento e simetrico)');
  nota(`logado como ${medicoBetaSessao.email}`);
  const cb = medicoBetaSessao.client;

  {
    const { data, error } = await cb.from('pacientes').select('id, organizacao_id');
    const foraDaBeta = (data ?? []).filter((p) => p.organizacao_id !== ORG_BETA);
    caso(
      '16. le pacientes: so os da Beta',
      !error && data?.length === real.pacientesBeta && foraDaBeta.length === 0,
      `recebeu ${data?.length ?? 0} paciente(s); ${foraDaBeta.length} de outra org`,
    );
  }

  {
    // Atencao ao numero esperado: a Alfa ganhou um exame no caso 9 e isso NAO
    // pode aparecer aqui.
    const { data, error } = await cb.from('exames').select('id, organizacao_id');
    const foraDaBeta = (data ?? []).filter((e) => e.organizacao_id !== ORG_BETA);
    caso(
      '17. le exames: so os da Beta (o exame criado na Alfa nao aparece)',
      !error && data?.length === real.examesBeta && foraDaBeta.length === 0,
      `recebeu ${data?.length ?? 0} exame(s); ${foraDaBeta.length} de outra org`,
    );
  }

  {
    const { data, error } = await cb.from('pacientes').select('id').eq('id', PACIENTE_ALFA_1);
    caso(
      '18. busca por id um paciente da Alfa: 0 linhas',
      !error && data?.length === 0,
      `${data?.length ?? 0} linha(s), ${descreveErro(error)}`,
    );
  }

  {
    const { data, error } = await cb
      .from('pacientes')
      .update({ nome: 'Sequestrado' })
      .eq('id', PACIENTE_ALFA_1)
      .select();
    caso(
      '19. UPDATE em paciente da Alfa afeta 0 linhas',
      !error && data?.length === 0,
      `${data?.length ?? 0} linha(s) alterada(s)`,
    );
  }

  {
    const { error } = await cb
      .from('pacientes')
      .insert({ organizacao_id: ORG_ALFA, nome: 'Invasor reverso' })
      .select();
    caso('20. INSERT de paciente na Alfa e bloqueado', bloqueadaPorRls(error), descreveErro(error));
  }

  // ---------------------------------------------------------------------------
  secao('SEM LOGIN (anon key crua)');
  {
    const anon = anonClient();
    const { data, error } = await anon.from('pacientes').select('id');
    caso(
      '21. sem autenticar nao se le nada',
      (data?.length ?? 0) === 0,
      error ? descreveErro(error) : `${data?.length ?? 0} linha(s) - GRANT revogado para anon`,
    );
  }

  // ---------------------------------------------------------------------------
  // Limpeza: devolve o banco ao estado do seed para o teste ser reexecutavel.
  await db.from('exames').delete().eq('id', EXAME_CRIADO);
  await db.from('pacientes').delete().eq('id', PACIENTE_DESCARTAVEL);

  resumo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
