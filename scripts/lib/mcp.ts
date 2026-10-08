/**
 * Cliente MCP minimo: JSON-RPC cru sobre fetch.
 *
 * Sem SDK de proposito. O teste quer enxergar o que trafega (status HTTP,
 * envelope JSON-RPC, isError), e e exatamente isto que um agente embutido no app
 * faz: um POST com o access token do usuario no `Authorization: Bearer`.
 *
 * O servidor e stateless (createMcpHandler do SDK v2): cada POST e atendido por
 * uma instancia nova, sem Mcp-Session-Id. Entao initialize, tools/list e
 * tools/call sao tres requisicoes independentes com o mesmo Bearer.
 */

import { MCP_URL } from './env';

/** Revisao do protocolo que este cliente fala (era 2025, a que os clientes atuais usam). */
export const PROTOCOLO = '2025-06-18';

interface EnvelopeRpc {
  jsonrpc: '2.0';
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface RespostaMcp {
  status: number;
  /** null quando o corpo nao e JSON-RPC, como o 401 do gate de autenticacao. */
  rpc: EnvelopeRpc | null;
  corpo: string;
}

let proximoId = 1;

/** Um request JSON-RPC. `token` null = sem header Authorization. */
export async function rpc(token: string | null, method: string, params?: unknown): Promise<RespostaMcp> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': PROTOCOLO,
  };
  if (token !== null) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: proximoId++, method, params }),
    });
  } catch (e) {
    throw new Error(
      `nao foi possivel falar com ${MCP_URL}. O servidor esta de pe?\n` +
        `  supabase functions serve mcp --env-file supabase/functions/.env\n(${String(e)})`,
    );
  }
  const corpo = await res.text();
  return { status: res.status, rpc: extrairEnvelope(corpo, res.headers.get('content-type')), corpo };
}

/** O servidor responde em JSON puro ou em SSE (`event: message` / `data: {...}`). */
function extrairEnvelope(corpo: string, contentType: string | null): EnvelopeRpc | null {
  const json = contentType?.includes('text/event-stream')
    ? corpo
        .split('\n')
        .filter((linha) => linha.startsWith('data:'))
        .map((linha) => linha.slice(5).trim())
        .at(-1)
    : corpo;
  try {
    const valor: unknown = JSON.parse(json ?? '');
    return valor && typeof valor === 'object' && 'jsonrpc' in valor ? (valor as EnvelopeRpc) : null;
  } catch {
    return null;
  }
}

export interface ResultadoTool<T> {
  status: number;
  /** true para isError da tool E para erro de protocolo (JSON-RPC error). */
  isError: boolean;
  /** O texto que o modelo leria: o JSON da resposta ou a mensagem de erro. */
  texto: string;
  /** structuredContent; null quando a tool falhou. */
  dados: T | null;
}

/** tools/call, achatado no que o teste precisa olhar. */
export async function chamarTool<T = Record<string, unknown>>(
  token: string,
  nome: string,
  args: Record<string, unknown> = {},
): Promise<ResultadoTool<T>> {
  const r = await rpc(token, 'tools/call', { name: nome, arguments: args });
  const result = r.rpc?.result as
    | { content?: { type: string; text?: string }[]; structuredContent?: T; isError?: boolean }
    | undefined;
  if (!result) {
    return { status: r.status, isError: true, texto: r.rpc?.error?.message ?? r.corpo.slice(0, 300), dados: null };
  }
  const isError = result.isError === true;
  return {
    status: r.status,
    isError,
    texto: result.content?.[0]?.text ?? '',
    dados: isError ? null : (result.structuredContent ?? null),
  };
}
