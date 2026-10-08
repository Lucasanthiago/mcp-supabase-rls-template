import type { McpServer } from 'npm:@modelcontextprotocol/server@2.0.0'

import { jsonResult, runtimeErrorResult } from './result.ts'
import type { ToolContext } from './types.ts'

// No organizacao_id filter on purpose: the RLS policy (is_membro) is what decides
// which patients exist for this caller, so the tool can neither widen nor pick
// the tenant. It only shapes the answer.
export function registerPacientesTools(server: McpServer, { supabase }: ToolContext): void {
  server.registerTool(
    'listar_pacientes',
    {
      description:
        'Lista os pacientes da clinica (organizacao) do usuario logado: id, nome, data de ' +
        'nascimento e organizacao. Use o id retornado em buscar_exames e criar_exame.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const { data, error } = await supabase
          .from('pacientes')
          .select('id, nome, data_nascimento, organizacao_id')
          .order('nome')
        if (error) throw error
        return jsonResult({ pacientes: data, total: data.length })
      } catch (error) {
        return runtimeErrorResult(error)
      }
    }
  )
}
