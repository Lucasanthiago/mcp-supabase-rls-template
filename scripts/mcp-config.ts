/**
 * Gera o .mcp.json para conversar com o servidor MCP pelo Claude Code.
 *
 *   npm run mcp:config
 *
 * Por que isto existe: o servidor exige o JWT do usuario no `Authorization`, e
 * esse token expira em `jwt_expiry` (1 hora por padrao). Em vez de colar token a
 * mao, este script faz o login de verdade como cada medico e escreve a
 * configuracao com os tokens frescos. Rode de novo quando expirar.
 *
 * Escreve DOIS servidores, um por medico, de proposito: e assim que o
 * isolamento fica visivel em linguagem natural - a mesma pergunta, feita aos
 * dois, devolve pacientes diferentes.
 *
 * O arquivo gerado carrega credencial de usuario (de teste, nunca de producao):
 * esta no .gitignore e nao deve ser commitado.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { comoUsuario } from './lib/clients';
import { MCP_URL } from './lib/env';
import { usuario, type UsuarioSeed } from './lib/fixtures';

const DESTINO = join(import.meta.dirname, '..', '.mcp.json');

/** Nome do servidor no Claude Code -> usuario de teste que ele representa. */
const SERVIDORES: Record<string, UsuarioSeed['chave']> = {
  'clinica-alfa': 'medicoAlfa',
  'clinica-beta': 'medicoBeta',
};

async function main(): Promise<void> {
  const mcpServers: Record<string, unknown> = {};

  for (const [nome, chave] of Object.entries(SERVIDORES)) {
    const u = usuario(chave);
    const sessao = await comoUsuario(u.email, u.senha);
    mcpServers[nome] = {
      type: 'http',
      url: MCP_URL,
      headers: { Authorization: `Bearer ${sessao.accessToken}` },
    };
    console.log(`  ${nome.padEnd(14)} ${u.email} (${u.organizacaoNome})`);
  }

  writeFileSync(DESTINO, `${JSON.stringify({ mcpServers }, null, 2)}\n`);

  console.log(`\n.mcp.json escrito apontando para ${MCP_URL}`);
  console.log('Os tokens expiram em 1 hora. Rode de novo depois disso.');
  console.log('\nNo Claude Code: reinicie a sessao (ou /mcp) para reconectar.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
