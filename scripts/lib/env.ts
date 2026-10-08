/**
 * Leitura e validacao das variaveis de ambiente.
 *
 * Node 22 le o .env nativamente com process.loadEnvFile(), entao nao ha
 * dependencia de dotenv aqui. Variaveis ja presentes no shell tem precedencia.
 */

try {
  process.loadEnvFile();
} catch {
  // Sem .env no diretorio: tudo bem se as variaveis vierem do ambiente.
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor || valor.startsWith('cole-a-')) {
    console.error(
      `\nFalta a variavel ${nome}.\n` +
        `Copie .env.example para .env e preencha com a saida de \`supabase status\`\n` +
        `(ou com as chaves do projeto hosted, em Project Settings > API).\n`,
    );
    process.exit(1);
  }
  return valor;
}

export const SUPABASE_URL = obrigatoria('SUPABASE_URL');
export const SUPABASE_ANON_KEY = obrigatoria('SUPABASE_ANON_KEY');
export const SUPABASE_SERVICE_ROLE_KEY = obrigatoria('SUPABASE_SERVICE_ROLE_KEY');

// Opcional, so o teste do MCP usa. O padrao e onde `supabase functions serve mcp`
// expoe a funcao (o gateway local responde em SUPABASE_URL).
export const MCP_URL = process.env.MCP_URL || `${SUPABASE_URL}/functions/v1/mcp`;
