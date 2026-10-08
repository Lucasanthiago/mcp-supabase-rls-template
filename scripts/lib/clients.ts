/**
 * Fabricas de client do Supabase.
 *
 * A distincao que da sentido a POC inteira:
 *
 *   serviceClient()  -> usa a service_role key. IGNORA RLS por completo.
 *                       E exatamente por isso que o servidor MCP oficial do
 *                       Supabase nao serve para o cenario do medico final: ele
 *                       roda com essa chave. Aqui ela aparece so no seed e no
 *                       bloco de controle do teste.
 *
 *   comoUsuario()    -> usa a anon key e faz login de verdade. A partir dai
 *                       toda requisicao carrega o JWT do usuario, o PostgREST
 *                       injeta as claims e auth.uid() passa a valer no banco.
 *                       E o que o app do medico faz - e o que sera preciso
 *                       replicar no servidor MCP da proxima etapa.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from './env';

// Sem persistencia de sessao: cada client e independente e o processo pode
// manter varios usuarios logados ao mesmo tempo sem um sobrescrever o outro.
const semPersistencia = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
} as const;

export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, semPersistencia);
}

export function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, semPersistencia);
}

export interface Sessao {
  client: SupabaseClient;
  userId: string;
  email: string;
  /** O JWT do usuario, cru. E o que vai no `Authorization: Bearer` do servidor MCP. */
  accessToken: string;
}

/** Faz login com email/senha e devolve um client que carrega esse JWT. */
export async function comoUsuario(email: string, senha: string): Promise<Sessao> {
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: senha });
  if (error || !data.user || !data.session) {
    throw new Error(`falha ao logar como ${email}: ${error?.message ?? 'sem usuario na resposta'}`);
  }
  return { client, userId: data.user.id, email, accessToken: data.session.access_token };
}
