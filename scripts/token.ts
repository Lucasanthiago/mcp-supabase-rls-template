/**
 * Imprime o access token de um usuario de teste, para chamar o servidor MCP a
 * mao (curl) ou pelo MCP Inspector:
 *
 *   npm run -s token -- medicoAlfa
 *
 * O token e o mesmo que o app teria apos o login: um JWT ES256 que expira em
 * `jwt_expiry` segundos (supabase/config.toml). Dado de POC, nunca de producao.
 */

import { comoUsuario } from './lib/clients';
import { USUARIOS, usuario, type UsuarioSeed } from './lib/fixtures';

async function main(): Promise<void> {
  const chave = process.argv[2] ?? 'medicoAlfa';
  if (!USUARIOS.some((u) => u.chave === chave)) {
    console.error(`usuario desconhecido: ${chave}. Use um de: ${USUARIOS.map((u) => u.chave).join(', ')}`);
    process.exit(1);
  }
  const u = usuario(chave as UsuarioSeed['chave']);
  const sessao = await comoUsuario(u.email, u.senha);
  console.log(sessao.accessToken);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
