import type { McpServer } from 'npm:@modelcontextprotocol/server@2.0.0'
import { z } from 'npm:zod@4.4.3'

import { errorResult, jsonResult, runtimeErrorResult } from './result.ts'
import type { ToolContext } from './types.ts'

// Same answer whether the patient does not exist or belongs to another clinic:
// telling the two apart would let a caller probe which ids exist elsewhere.
const PACIENTE_NAO_ENCONTRADO =
  'Paciente nao encontrado na sua organizacao. Use listar_pacientes para ver os ids disponiveis.'

const EXAME_COLUNAS = 'id, paciente_id, organizacao_id, tipo, resultado, realizado_em, criado_por, criado_em'

// The business-rule gate shared by both tools: a patient "exists" for this caller
// only if the user-scoped client can read it, i.e. only if RLS lets it through.
async function pacienteVisivel(supabase: ToolContext['supabase'], id: string) {
  const { data, error } = await supabase
    .from('pacientes')
    .select('id, nome, organizacao_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data
}

export function registerExamesTools(server: McpServer, { supabase, userClaims }: ToolContext): void {
  server.registerTool(
    'buscar_exames',
    {
      description:
        'Retorna os exames de um paciente da clinica do usuario logado, do mais recente ao mais ' +
        'antigo. Falha se o paciente nao pertencer a organizacao do usuario.',
      inputSchema: z.strictObject({
        paciente_id: z.uuid().describe('id do paciente, como retornado por listar_pacientes'),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ paciente_id }) => {
      try {
        const paciente = await pacienteVisivel(supabase, paciente_id)
        if (!paciente) return errorResult(PACIENTE_NAO_ENCONTRADO)

        const { data, error } = await supabase
          .from('exames')
          .select(EXAME_COLUNAS)
          .eq('paciente_id', paciente.id)
          .order('realizado_em', { ascending: false })
        if (error) throw error
        return jsonResult({ paciente, exames: data, total: data.length })
      } catch (error) {
        return runtimeErrorResult(error)
      }
    }
  )

  server.registerTool(
    'criar_exame',
    {
      description:
        'Registra um exame para um paciente da clinica do usuario logado. A organizacao do exame ' +
        'vem do paciente; falha se o paciente nao pertencer a organizacao do usuario.',
      // Strict: an organizacao_id or criado_por smuggled into the arguments is
      // rejected instead of silently ignored.
      inputSchema: z.strictObject({
        paciente_id: z.uuid().describe('id do paciente, como retornado por listar_pacientes'),
        tipo: z.string().trim().min(1).max(200).describe('tipo do exame, ex.: "Hemograma"'),
        resultado: z.string().trim().max(5000).optional().describe('resultado ou laudo resumido'),
        realizado_em: z.iso
          .datetime({ offset: true })
          .optional()
          .describe('quando o exame foi realizado (ISO 8601); padrao: agora'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ paciente_id, tipo, resultado, realizado_em }) => {
      try {
        // Business rule before the write, so the caller gets a clear answer
        // instead of a constraint error. RLS (is_membro on insert) and the
        // composite FK (paciente_id, organizacao_id) still back it up.
        const paciente = await pacienteVisivel(supabase, paciente_id)
        if (!paciente) return errorResult(PACIENTE_NAO_ENCONTRADO)

        const { data, error } = await supabase
          .from('exames')
          .insert({
            paciente_id: paciente.id,
            // Tenant comes from the row the database showed us, never from input.
            organizacao_id: paciente.organizacao_id,
            tipo,
            resultado: resultado ?? null,
            realizado_em,
            // Author comes from the verified token, never from user_metadata.
            criado_por: userClaims.id,
          })
          .select(EXAME_COLUNAS)
          .single()
        if (error) throw error
        return jsonResult({ exame: data })
      } catch (error) {
        return runtimeErrorResult(error)
      }
    }
  )
}
