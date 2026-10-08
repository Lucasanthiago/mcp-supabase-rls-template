/**
 * Prova de isolamento entre tenants ATRAVES DO SERVIDOR MCP.
 *
 * O test-isolamento.ts prova a RLS falando com o PostgREST. Este prova a camada
 * de cima, pelo mesmo caminho que um agente embutido no app vai usar:
 *
 *   login -> access token (ES256) -> Authorization: Bearer -> Edge Function `mcp`
 *   -> withSupabase verifica o JWT pelo JWKS -> tool -> supabase-js com o JWT do
 *   usuario -> PostgREST -> auth.uid() -> policy.
 *
 * Pre-requisito: `supabase functions serve mcp --env-file supabase/functions/.env`.
 * A service_role aparece so no controle (contagens reais) e na limpeza, como no
 * teste da RLS: o servidor MCP em si nunca a recebe.
 */

import { comoUsuario, serviceClient } from './lib/clients';
import { caso, nota, resumo, secao } from './lib/assert';
import { ORG_ALFA, ORG_BETA, PACIENTES, PACIENTE_ALFA_1, PACIENTE_BETA_1, usuario } from './lib/fixtures';
import { MCP_URL, SUPABASE_ANON_KEY } from './lib/env';
import { chamarTool, rpc } from './lib/mcp';

interface Paciente {
  id: string;
  nome: string;
  organizacao_id: string;
}
interface Exame {
  id: string;
  paciente_id: string;
  organizacao_id: string;
  criado_por: string | null;
}
interface ToolDescrita {
  name: string;
  annotations?: { readOnlyHint?: boolean };
}

const TOOLS_ESPERADAS: Record<string, boolean> = {
  whoami: true,
  listar_pacientes: true,
  buscar_exames: true,
  criar_exame: false, // readOnlyHint
};

const nomeDe = (id: string): string => PACIENTES.find((p) => p.id === id)!.nome;

// Todo exame que alguma chamada disser ter criado, inclusive um que NAO deveria
// existir: a limpeza remove todos, para o teste ser reexecutavel mesmo falhando.
const examesCriados: string[] = [];
function registraCriado(dados: { exame?: Exame } | null): void {
  if (dados?.exame?.id) examesCriados.push(dados.exame.id);
}

async function main(): Promise<void> {
  const db = serviceClient();
  nota(`servidor MCP: ${MCP_URL}`);

  // ---------------------------------------------------------------------------
  secao('CONTROLE (service_role - ignora a RLS)');
  nota('As contagens reais. Sem elas, "lista vazia" ou "erro" nao provariam isolamento.');

  const contar = async (tabela: 'pacientes' | 'exames', coluna: string, valor: string): Promise<number> => {
    const { count, error } = await db.from(tabela).select('id', { count: 'exact', head: true }).eq(coluna, valor);
    if (error) throw new Error(`controle ${tabela}: ${error.message}`);
    return count ?? 0;
  };
  const real = {
    pacientesAlfa: await contar('pacientes', 'organizacao_id', ORG_ALFA),
    pacientesBeta: await contar('pacientes', 'organizacao_id', ORG_BETA),
    examesAlfa: await contar('exames', 'organizacao_id', ORG_ALFA),
    examesBeta: await contar('exames', 'organizacao_id', ORG_BETA),
    examesPacienteAlfa1: await contar('exames', 'paciente_id', PACIENTE_ALFA_1),
    examesPacienteBeta1: await contar('exames', 'paciente_id', PACIENTE_BETA_1),
  };
  nota(`Alfa: ${real.pacientesAlfa} pacientes, ${real.examesAlfa} exames`);
  nota(`Beta: ${real.pacientesBeta} pacientes, ${real.examesBeta} exames`);
  caso(
    '0. as duas organizacoes tem dados no banco',
    real.pacientesAlfa > 0 && real.pacientesBeta > 0 && real.examesPacienteAlfa1 > 0 && real.examesPacienteBeta1 > 0,
    `Alfa ${real.pacientesAlfa}p/${real.examesAlfa}e, Beta ${real.pacientesBeta}p/${real.examesBeta}e`,
  );

  const uAlfa = usuario('medicoAlfa');
  const alfa = await comoUsuario(uAlfa.email, uAlfa.senha);
  const uBeta = usuario('medicoBeta');
  const beta = await comoUsuario(uBeta.email, uBeta.senha);

  // ---------------------------------------------------------------------------
  secao('SEM CREDENCIAL VALIDA (o gate barra antes de qualquer tool)');
  {
    const r = await rpc(null, 'tools/list');
    caso('1. sem Authorization: 401', r.status === 401, `HTTP ${r.status}`);
  }
  {
    const r = await rpc('isto-nao-e-um-jwt', 'tools/list');
    caso('2. token invalido: 401', r.status === 401, `HTTP ${r.status}`);
  }
  {
    // Mesmo header e payload do token do medico, assinatura trocada: prova que
    // o servidor verifica a assinatura, e nao so decodifica o JWT.
    const [h, p, s] = alfa.accessToken.split('.');
    const adulterado = `${h}.${p}.${s!.startsWith('A') ? 'B' : 'A'}${s!.slice(1)}`;
    const r = await rpc(adulterado, 'tools/call', { name: 'listar_pacientes', arguments: {} });
    caso('3. token do medico com assinatura adulterada: 401', r.status === 401, `HTTP ${r.status}`);
  }
  {
    // A anon key e uma credencial valida para o PostgREST (no local, um JWT HS256
    // legado), mas nao e token de usuario: o block so aceita JWT de usuario
    // assinado com chave assimetrica, verificado pelo JWKS.
    const r = await rpc(SUPABASE_ANON_KEY, 'tools/list');
    caso('4. anon key (credencial de projeto, nao de usuario) como Bearer: 401', r.status === 401, `HTTP ${r.status}`);
  }

  // ---------------------------------------------------------------------------
  secao('MEDICO DA CLINICA ALFA, VIA MCP');
  nota(`logado como ${alfa.email} (auth.uid() = ${alfa.userId})`);
  const ta = alfa.accessToken;

  {
    const r = await rpc(ta, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-mcp', version: '1.0.0' },
    });
    const info = r.rpc?.result?.serverInfo as { name?: string } | undefined;
    caso(
      '5. initialize responde',
      r.status === 200 && !!info?.name,
      `HTTP ${r.status}, servidor "${info?.name}", protocolo ${String(r.rpc?.result?.protocolVersion)}`,
    );
  }

  {
    const r = await rpc(ta, 'tools/list');
    const tools = (r.rpc?.result?.tools ?? []) as ToolDescrita[];
    const nomes = tools.map((t) => t.name).sort();
    const esperadas = Object.keys(TOOLS_ESPERADAS).sort();
    const hintsCertos = tools.every((t) => t.annotations?.readOnlyHint === TOOLS_ESPERADAS[t.name]);
    caso(
      '6. tools/list: as 4 tools, com readOnlyHint certo',
      JSON.stringify(nomes) === JSON.stringify(esperadas) && hintsCertos,
      tools.map((t) => `${t.name}(readOnly=${t.annotations?.readOnlyHint})`).join(', '),
    );
  }

  {
    const r = await chamarTool<{ id: string; client_id: string | null }>(ta, 'whoami');
    caso(
      '7. whoami: e o medico da Alfa, sessao de produto (sem client_id OAuth)',
      !r.isError && r.dados?.id === alfa.userId && r.dados?.client_id === null,
      r.texto,
    );
  }

  {
    const r = await chamarTool<{ pacientes: Paciente[]; total: number }>(ta, 'listar_pacientes');
    const lista = r.dados?.pacientes ?? [];
    const fora = lista.filter((p) => p.organizacao_id !== ORG_ALFA);
    caso(
      '8. listar_pacientes: so os da Alfa',
      !r.isError && lista.length === real.pacientesAlfa && fora.length === 0,
      `recebeu ${lista.length} de ${real.pacientesAlfa + real.pacientesBeta} pacientes do banco; ` +
        `${fora.length} de outra org: ${lista.map((p) => p.nome).join(', ')}`,
    );
  }

  {
    const r = await chamarTool<{ exames: Exame[] }>(ta, 'buscar_exames', { paciente_id: PACIENTE_ALFA_1 });
    const exames = r.dados?.exames ?? [];
    const alheios = exames.filter((e) => e.paciente_id !== PACIENTE_ALFA_1 || e.organizacao_id !== ORG_ALFA);
    caso(
      '9. buscar_exames(paciente da Alfa): os exames dele, e so dele',
      !r.isError && exames.length === real.examesPacienteAlfa1 && alheios.length === 0,
      `${exames.length} exame(s) de ${nomeDe(PACIENTE_ALFA_1)}; ${alheios.length} alheio(s)`,
    );
  }

  {
    const r = await chamarTool(ta, 'buscar_exames', { paciente_id: PACIENTE_BETA_1 });
    caso(
      '10. buscar_exames(paciente da Beta): erro, nenhum dado',
      r.isError && r.dados === null && !r.texto.includes(nomeDe(PACIENTE_BETA_1)),
      r.texto,
    );
  }

  {
    const r = await chamarTool<{ exame?: Exame }>(ta, 'criar_exame', {
      paciente_id: PACIENTE_BETA_1,
      tipo: 'Exame intruso via MCP',
    });
    registraCriado(r.dados);
    const examesBeta = await contar('exames', 'organizacao_id', ORG_BETA);
    caso(
      '11. criar_exame(paciente da Beta): erro, e a Beta continua com os mesmos exames',
      r.isError && examesBeta === real.examesBeta,
      `${r.texto} | exames da Beta no banco: ${examesBeta} (antes: ${real.examesBeta})`,
    );
  }

  {
    // O contrabando de tenant pela tool: o paciente e meu, mas declaro a org da Beta.
    const r = await chamarTool<{ exame?: Exame }>(ta, 'criar_exame', {
      paciente_id: PACIENTE_ALFA_1,
      tipo: 'Exame contrabandeado',
      organizacao_id: ORG_BETA,
    });
    registraCriado(r.dados);
    const examesBeta = await contar('exames', 'organizacao_id', ORG_BETA);
    const examesAlfa = await contar('exames', 'organizacao_id', ORG_ALFA);
    caso(
      '12. criar_exame com organizacao_id da Beta no input: rejeitado, nada escrito',
      r.isError && examesBeta === real.examesBeta && examesAlfa === real.examesAlfa,
      `${r.texto} | exames Alfa/Beta no banco: ${examesAlfa}/${examesBeta}`,
    );
  }

  {
    const r = await chamarTool(ta, 'buscar_exames', { paciente_id: 'nao-e-um-uuid' });
    caso('13. paciente_id que nao e uuid: erro de validacao (Zod)', r.isError, r.texto);
  }

  {
    // CONTROLE POSITIVO: uma tool que recusa tudo passaria nos casos 10-13.
    const r = await chamarTool<{ exame: Exame }>(ta, 'criar_exame', {
      paciente_id: PACIENTE_ALFA_1,
      tipo: 'Exame criado via MCP',
      resultado: 'ok',
    });
    registraCriado(r.dados);
    const e = r.dados?.exame;
    caso(
      '14. criar_exame(paciente da Alfa) FUNCIONA: org vem do paciente, autor vem do token',
      !r.isError && e?.organizacao_id === ORG_ALFA && e?.paciente_id === PACIENTE_ALFA_1 && e?.criado_por === alfa.userId,
      r.isError ? r.texto : `exame ${e?.id}: organizacao_id=Alfa, criado_por=${e?.criado_por}`,
    );
  }

  // ---------------------------------------------------------------------------
  secao('MEDICO DA CLINICA BETA, VIA MCP (o isolamento e simetrico)');
  nota(`logado como ${beta.email} (auth.uid() = ${beta.userId})`);
  const tb = beta.accessToken;

  {
    const r = await chamarTool<{ id: string }>(tb, 'whoami');
    caso('15. whoami: e o medico da Beta', !r.isError && r.dados?.id === beta.userId, r.texto);
  }

  {
    const r = await chamarTool<{ pacientes: Paciente[] }>(tb, 'listar_pacientes');
    const lista = r.dados?.pacientes ?? [];
    const fora = lista.filter((p) => p.organizacao_id !== ORG_BETA);
    caso(
      '16. listar_pacientes: so os da Beta',
      !r.isError && lista.length === real.pacientesBeta && fora.length === 0,
      `recebeu ${lista.length} paciente(s); ${fora.length} de outra org: ${lista.map((p) => p.nome).join(', ')}`,
    );
  }

  {
    const r = await chamarTool<{ exames: Exame[] }>(tb, 'buscar_exames', { paciente_id: PACIENTE_BETA_1 });
    const exames = r.dados?.exames ?? [];
    const alheios = exames.filter((e) => e.organizacao_id !== ORG_BETA);
    caso(
      '17. buscar_exames(paciente da Beta): os exames dele',
      !r.isError && exames.length === real.examesPacienteBeta1 && alheios.length === 0,
      `${exames.length} exame(s) de ${nomeDe(PACIENTE_BETA_1)}; ${alheios.length} de outra org`,
    );
  }

  {
    // O paciente Alfa 1 acabou de ganhar um exame no caso 14; nada disso pode vazar.
    const r = await chamarTool(tb, 'buscar_exames', { paciente_id: PACIENTE_ALFA_1 });
    caso(
      '18. buscar_exames(paciente da Alfa): erro, nenhum dado (nem o exame do caso 14)',
      r.isError && r.dados === null && !r.texto.includes(nomeDe(PACIENTE_ALFA_1)),
      r.texto,
    );
  }

  {
    const antesAlfa = await contar('exames', 'organizacao_id', ORG_ALFA);
    const r = await chamarTool<{ exame?: Exame }>(tb, 'criar_exame', {
      paciente_id: PACIENTE_ALFA_1,
      tipo: 'Exame intruso reverso',
    });
    registraCriado(r.dados);
    const depoisAlfa = await contar('exames', 'organizacao_id', ORG_ALFA);
    caso(
      '19. criar_exame(paciente da Alfa): erro, e a Alfa continua com os mesmos exames',
      r.isError && depoisAlfa === antesAlfa,
      `${r.texto} | exames da Alfa no banco: ${depoisAlfa} (antes: ${antesAlfa})`,
    );
  }

  // ---------------------------------------------------------------------------
  // Limpeza: devolve o banco ao estado do seed para o teste ser reexecutavel.
  if (examesCriados.length > 0) await db.from('exames').delete().in('id', examesCriados);

  resumo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
