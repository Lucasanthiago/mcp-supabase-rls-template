/**
 * Copie este arquivo para web/config.js e preencha com os dados do SEU projeto
 * Supabase (Project Settings > API Keys no painel):
 *
 *   cp web/config.example.js web/config.js
 *
 * As duas informacoes abaixo sao publicas por natureza: a URL do projeto e a
 * chave "publishable" (ou "anon"), que e justamente a que todo aplicativo web
 * carrega no navegador. A RLS e quem protege os dados.
 *
 * NUNCA coloque aqui a chave "secret" (service_role): ela ignora a RLS por
 * completo. O web/config.js esta no .gitignore.
 */
window.CONFIG = {
  SUPABASE_URL: 'https://SEU-PROJETO.supabase.co',
  CHAVE_PUBLICA: 'sb_publishable_COLE_A_SUA_AQUI',
};
