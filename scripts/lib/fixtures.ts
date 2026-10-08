/**
 * Dados fixos da POC.
 *
 * Os UUIDs de organizacoes, pacientes e exames sao FIXOS de proposito: o teste
 * de isolamento precisa citar, como usuario da Alfa, o id de um paciente da
 * Beta para tentar le-lo e edita-lo. Sem id conhecido, nao da para provar que o
 * acesso cruzado e bloqueado - so que a propria org aparece.
 *
 * Os ids dos USUARIOS nao estao aqui: quem os gera e a Admin API do GoTrue no
 * momento do seed. O seed resolve email -> id e passa adiante.
 *
 * Sao os mesmos UUIDs usados em db/local-verify/10_seed_local.sql.
 */

export const ORG_ALFA = '11111111-1111-4111-8111-111111111111';
export const ORG_BETA = '22222222-2222-4222-8222-222222222222';

export const SENHA_PADRAO = 'senha-de-teste-123';

export type PapelMembro = 'admin' | 'medico';

export interface UsuarioSeed {
  chave: 'adminAlfa' | 'medicoAlfa' | 'adminBeta' | 'medicoBeta';
  email: string;
  senha: string;
  papel: PapelMembro;
  organizacaoId: string;
  organizacaoNome: string;
}

export const USUARIOS: UsuarioSeed[] = [
  { chave: 'adminAlfa',  email: 'admin.alfa@exemplo.test',  senha: SENHA_PADRAO, papel: 'admin',  organizacaoId: ORG_ALFA, organizacaoNome: 'Clinica Alfa' },
  { chave: 'medicoAlfa', email: 'medico.alfa@exemplo.test', senha: SENHA_PADRAO, papel: 'medico', organizacaoId: ORG_ALFA, organizacaoNome: 'Clinica Alfa' },
  { chave: 'adminBeta',  email: 'admin.beta@exemplo.test',  senha: SENHA_PADRAO, papel: 'admin',  organizacaoId: ORG_BETA, organizacaoNome: 'Clinica Beta' },
  { chave: 'medicoBeta', email: 'medico.beta@exemplo.test', senha: SENHA_PADRAO, papel: 'medico', organizacaoId: ORG_BETA, organizacaoNome: 'Clinica Beta' },
];

export function usuario(chave: UsuarioSeed['chave']): UsuarioSeed {
  const u = USUARIOS.find((x) => x.chave === chave);
  if (!u) throw new Error(`usuario de fixture desconhecido: ${chave}`);
  return u;
}

export const ORGANIZACOES = [
  { id: ORG_ALFA, nome: 'Clinica Alfa' },
  { id: ORG_BETA, nome: 'Clinica Beta' },
];

export const PACIENTES = [
  { id: 'aaaa0001-0000-4000-8000-000000000001', organizacao_id: ORG_ALFA, nome: 'Ana Alves (Alfa)',   data_nascimento: '1985-03-12' },
  { id: 'aaaa0002-0000-4000-8000-000000000002', organizacao_id: ORG_ALFA, nome: 'Artur Braga (Alfa)', data_nascimento: '1972-11-02' },
  { id: 'bbbb0001-0000-4000-8000-000000000001', organizacao_id: ORG_BETA, nome: 'Bruna Costa (Beta)', data_nascimento: '1990-07-25' },
  { id: 'bbbb0002-0000-4000-8000-000000000002', organizacao_id: ORG_BETA, nome: 'Bento Dias (Beta)',  data_nascimento: '1966-01-30' },
];

export const PACIENTE_ALFA_1 = PACIENTES[0]!.id;
export const PACIENTE_BETA_1 = PACIENTES[2]!.id;

export const EXAMES = [
  { id: 'aaae0001-0000-4000-8000-000000000001', paciente_id: PACIENTES[0]!.id, organizacao_id: ORG_ALFA, tipo: 'Hemograma',    resultado: 'Normal' },
  { id: 'aaae0002-0000-4000-8000-000000000002', paciente_id: PACIENTES[0]!.id, organizacao_id: ORG_ALFA, tipo: 'Raio-X torax', resultado: 'Sem alteracoes' },
  { id: 'aaae0003-0000-4000-8000-000000000003', paciente_id: PACIENTES[1]!.id, organizacao_id: ORG_ALFA, tipo: 'Glicemia',     resultado: '92 mg/dL' },
  { id: 'bbbe0001-0000-4000-8000-000000000001', paciente_id: PACIENTES[2]!.id, organizacao_id: ORG_BETA, tipo: 'Hemograma',    resultado: 'Leve anemia' },
  { id: 'bbbe0002-0000-4000-8000-000000000002', paciente_id: PACIENTES[3]!.id, organizacao_id: ORG_BETA, tipo: 'Ultrassom',    resultado: 'Normal' },
];
