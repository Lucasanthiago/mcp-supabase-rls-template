/**
 * A demonstracao de um comando: a MESMA pergunta, dois medicos, respostas
 * diferentes.
 *
 *   npm run demo
 *
 * Nao e um teste - para provar o isolamento, use `npm run test:mcp`, que tem o
 * controle com service_role e os casos negativos. Este script existe para
 * mostrar o efeito a quem nao vai ler saida de teste: faz login de verdade como
 * cada medico, chama `listar_pacientes` pelo servidor MCP e imprime os nomes.
 *
 * O ponto que a demonstracao faz: nao ha filtro de organizacao em lugar nenhum
 * aqui nem na tool. Quem decide quais pacientes existem e a RLS, a partir do
 * JWT de quem perguntou.
 */

import { chamarTool } from './lib/mcp';
import { comoUsuario } from './lib/clients';
import { MCP_URL } from './lib/env';
import { usuario } from './lib/fixtures';

interface Paciente {
  nome: string;
}

async function main(): Promise<void> {
  console.log(`\n    servidor MCP: ${MCP_URL}\n`);

  for (const chave of ['medicoAlfa', 'medicoBeta'] as const) {
    const u = usuario(chave);
    const sessao = await comoUsuario(u.email, u.senha);
    const r = await chamarTool<{ pacientes: Paciente[] }>(sessao.accessToken, 'listar_pacientes');

    if (r.isError || !r.dados) {
      console.error(`  ${u.email}: a chamada falhou -> ${r.texto}`);
      process.exit(1);
    }

    console.log(`Pergunta: "quais sao meus pacientes?"  --  quem pergunta: ${u.email} (${u.organizacaoNome})`);
    for (const p of r.dados.pacientes) console.log(`   - ${p.nome}`);
    console.log();
  }

  console.log('Nenhum filtro de organizacao foi escrito no codigo desta consulta.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
