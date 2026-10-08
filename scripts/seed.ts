/**
 * Seed da POC. Roda com service_role, portanto IGNORA a RLS - e o unico jeito
 * de popular dois tenants de uma vez.
 *
 * Por que os usuarios sao criados aqui e nao em supabase/seed.sql:
 * inserir usuario de senha direto em auth.users exige acertar a mao
 * encrypted_password, email_confirmed_at e uma linha correspondente em
 * auth.identities (com provider_id). Esse formato muda entre versoes do GoTrue
 * e, quando erra, nao falha no insert: falha depois, no login, com
 * "invalid credentials" - o pior tipo de bug para depurar. A Admin API e
 * estavel e se comporta igual no Supabase local e no hosted.
 *
 * O script e idempotente: pode rodar quantas vezes quiser. Os dados de dominio
 * das duas organizacoes sao apagados e reinseridos, entao as contagens ficam
 * sempre exatas - inclusive depois de o teste de isolamento ter criado linhas.
 */

import { serviceClient } from './lib/clients';
import { EXAMES, ORGANIZACOES, ORG_ALFA, ORG_BETA, PACIENTES, USUARIOS } from './lib/fixtures';

const db = serviceClient();
const ORGS = [ORG_ALFA, ORG_BETA];

function falhar(contexto: string, error: { message: string } | null): void {
  if (error) {
    console.error(`\nerro em ${contexto}: ${error.message}`);
    process.exit(1);
  }
}

/** Cria o usuario, ou reaproveita o existente garantindo a senha conhecida. */
async function garantirUsuario(email: string, senha: string): Promise<string> {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  falhar('listUsers', error);

  const existente = data.users.find((u) => u.email === email);
  if (existente) {
    // A senha pode ter sido definida em outra rodada; reafirmamos para que o
    // login do teste nao dependa do historico do banco.
    const { error: erroUpdate } = await db.auth.admin.updateUserById(existente.id, {
      password: senha,
      email_confirm: true,
    });
    falhar(`updateUserById(${email})`, erroUpdate);
    console.log(`  usuario existente  ${email}`);
    return existente.id;
  }

  const { data: criado, error: erroCreate } = await db.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // sem isso o usuario nasce sem email confirmado e nao consegue logar
  });
  falhar(`createUser(${email})`, erroCreate);
  console.log(`  usuario criado     ${email}`);
  return criado.user!.id;
}

async function main(): Promise<void> {
  console.log('\n== usuarios (auth.users via Admin API) ==');
  const idPorChave = new Map<string, string>();
  for (const u of USUARIOS) {
    idPorChave.set(u.chave, await garantirUsuario(u.email, u.senha));
  }

  console.log('\n== limpando dados de dominio das duas organizacoes ==');
  // exames antes de pacientes so por clareza - a FK composta ja cascatearia.
  falhar('delete exames',    (await db.from('exames').delete().in('organizacao_id', ORGS)).error);
  falhar('delete pacientes', (await db.from('pacientes').delete().in('organizacao_id', ORGS)).error);
  falhar('delete membros',   (await db.from('membros').delete().in('organizacao_id', ORGS)).error);

  console.log('== inserindo organizacoes, membros, pacientes e exames ==');
  falhar('upsert organizacoes', (await db.from('organizacoes').upsert(ORGANIZACOES).select()).error);

  const membros = USUARIOS.map((u) => ({
    organizacao_id: u.organizacaoId,
    user_id: idPorChave.get(u.chave)!,
    papel: u.papel,
  }));
  falhar('insert membros', (await db.from('membros').insert(membros)).error);

  // criado_por: o medico da organizacao correspondente, so para o dado nao ficar orfao.
  const medicoDa = (orgId: string): string =>
    idPorChave.get(orgId === ORG_ALFA ? 'medicoAlfa' : 'medicoBeta')!;

  falhar(
    'insert pacientes',
    (await db.from('pacientes').insert(
      PACIENTES.map((p) => ({ ...p, criado_por: medicoDa(p.organizacao_id) })),
    )).error,
  );
  falhar(
    'insert exames',
    (await db.from('exames').insert(
      EXAMES.map((e) => ({ ...e, criado_por: medicoDa(e.organizacao_id) })),
    )).error,
  );

  console.log('\n== conferindo (contagens lidas com service_role, sem RLS) ==');
  for (const org of ORGANIZACOES) {
    const pacientes = await db.from('pacientes').select('id', { count: 'exact', head: true }).eq('organizacao_id', org.id);
    const exames    = await db.from('exames').select('id',    { count: 'exact', head: true }).eq('organizacao_id', org.id);
    const membrosOrg= await db.from('membros').select('id',   { count: 'exact', head: true }).eq('organizacao_id', org.id);
    console.log(`  ${org.nome.padEnd(14)} ${membrosOrg.count} membros, ${pacientes.count} pacientes, ${exames.count} exames`);
  }

  console.log('\nseed concluido. Rode `npm run test:rls` para provar o isolamento.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
