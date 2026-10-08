# Arquitetura e raciocínio

O **porquê** de cada decisão: o desenho das policies, as armadilhas de RLS que
custaram tempo, e o que mudou em relação ao servidor MCP oficial da Supabase.
Para instalar e rodar, veja o [README](../README.md).

Os resultados de teste abaixo são da execução de referência, feita durante o
desenvolvimento. Rodando no seu projeto, você deve ver os mesmos números.

Isto foi construído em duas etapas:

1. **Etapa 1 — multitenant com RLS** (da seção [Schema](#schema) até
   [Estrutura](#estrutura)). **Não tem nada de MCP**: isola a dificuldade que realmente
   derruba o projeto — *multitenant com Row Level Security* — em um schema mínimo, com dois
   tenants de verdade e um teste que prova o isolamento.
2. **Etapa 2 — [servidor MCP como Supabase Edge Function](#etapa-2--servidor-mcp-como-edge-function)**.
   Um servidor MCP remoto, feito com o block oficial "MCP Server" da Supabase, em que cada
   tool roda **como o usuário logado** — e portanto sob as mesmas policies da etapa 1.

Por que nesta ordem: o objetivo final é um servidor MCP em que o médico pergunta
"quais exames a Ana fez?" e o assistente consulta o banco **como aquele médico**. Se a
RLS não estiver correta, o servidor MCP vira um vazamento de prontuário entre clínicas —
e depurar isso com o protocolo no meio é muito mais difícil do que aqui.

---

## Schema

Quatro tabelas. Toda a segurança se apoia em uma única cadeia de pertencimento:

```
  auth.users  ──<  membros  >──  organizacoes        (membros = quem pertence a quê,
                     │  papel        │                e com qual papel)
                     │               │
                     │               ├──<  pacientes
                     │               │         │
                     │               └──<  exames
                     │                     (organizacao_id denormalizado +
                     └── auth.uid()         FK composta com pacientes)
```

| Tabela | Papel no modelo |
|---|---|
| `organizacoes` | O tenant. Uma clínica. |
| `membros` | Liga `auth.users` a uma organização com um `papel` (`admin` \| `medico`). **Tabela-raiz de confiança**: todas as outras policies perguntam a ela. |
| `pacientes` | Pertence a uma organização. |
| `exames` | Pertence a um paciente e, transitivamente, a uma organização. |

Duas decisões de schema que existem por causa da RLS:

**1. `exames.organizacao_id` é denormalizado.** Sem essa coluna, a policy de `exames`
precisaria de um subselect em `pacientes` — que também tem RLS — para cada linha avaliada.
Com ela, a policy vira uma comparação direta que usa índice.

**2. A denormalização não pode divergir, então quem garante isso é o banco.**
`pacientes` tem `unique (id, organizacao_id)` e `exames` tem
`foreign key (paciente_id, organizacao_id) references pacientes (id, organizacao_id)`.
Um exame apontando para um paciente de outra organização é **impossível de inserir** —
inclusive por quem escreve com `service_role`. É garantia estrutural, não convenção.
O caso 7b do teste prova isso (erro `23503`).

---

## Policies e o raciocínio de cada uma

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `organizacoes` | `is_membro(id)` | — | — | — |
| `membros` | `is_membro(organizacao_id)` | `is_admin` | `is_admin` | `is_admin` |
| `pacientes` | `is_membro(organizacao_id)` | `is_membro` | `is_membro` (USING + WITH CHECK) | `is_admin` |
| `exames` | `is_membro(organizacao_id)` | `is_membro` | `is_membro` (USING + WITH CHECK) | `is_admin` |

Eixo de papel: **médico opera** (lê, cria e edita pacientes e exames), **admin gerencia**
(além disso, deleta e mexe em `membros`).

### Por que os helpers são `SECURITY DEFINER`

A policy de `SELECT` de `membros` precisa consultar `membros`. Escrita inline, o Postgres
reaplica a RLS dentro da subconsulta, que reaplica de novo, e o resultado é
`42P17 infinite recursion detected in policy for relation "membros"`.

`public.is_membro(uuid)` e `public.is_admin(uuid)` são `security definer`: rodam com os
privilégios do dono da tabela, que não está sujeito à RLS. Isso quebra o ciclo. Junto vêm
três cuidados registrados na migration:

- `set search_path = ''` e nomes qualificados — sem isso, uma função privilegiada pode ter
  a resolução de nomes sequestrada por uma tabela homônima em schema do atacante;
- `stable`, para o planner avaliar uma vez em vez de uma vez por linha;
- **nunca** `force row level security` em `membros` — com FORCE, até o dono é filtrado e o
  helper volta a não enxergar nada.

### `membros` é a tabela mais fechada do modelo

Se um médico pudesse inserir linha em `membros`, ele se adicionaria à outra clínica e todo
o isolamento das demais tabelas cairia junto — elas confiam nesta. Por isso escrita ali é
só de `admin`, e mesmo o admin não atravessa o tenant (caso 15 do teste).

### `USING` vs `WITH CHECK` no UPDATE — o que eu medi

O ataque em questão é o *contrabando de tenant*:

```sql
update pacientes set organizacao_id = '<org B>' where id = '<paciente da org A>';
```

A linha de origem é minha (passa no `USING`), mas o destino é outro tenant. A intuição
comum é "sem `WITH CHECK` isso passa". **Medi em `db/local-verify/` e não é bem assim** —
num UPDATE o Postgres valida o valor **novo** da linha em duas camadas:

1. o `WITH CHECK` da policy de UPDATE; se ele for **omitido**, o próprio `USING` é
   reaproveitado como check (não é "sem verificação nenhuma");
2. o `USING` das policies de **SELECT**, porque não se pode atualizar uma linha para um
   estado em que você não conseguiria mais lê-la.

Ou seja, o vazamento só acontece se as **duas** camadas estiverem frouxas. Comprovação:
com `with check (true)` na policy de UPDATE e a policy de SELECT intacta, o UPDATE
continua barrado; a linha só migrou de tenant quando a policy de SELECT também virou
`using (true)`.

Então por que escrever o `WITH CHECK` explícito? Para não depender do efeito colateral de
outra policy: se amanhã a leitura for afrouxada (um diretório compartilhado de pacientes,
digamos), a proteção da escrita não vai junto. E explícito documenta a intenção.

### RLS não substitui GRANT

São dois portões em série. Sem `GRANT`, o Postgres nem chega a avaliar a policy; sem RLS,
o `GRANT` libera a tabela inteira. As migrations fazem os dois: revogam tudo de `anon` e
concedem explicitamente a `authenticated`. É por isso que o caso 21 (sem login) falha já
no grant, antes de qualquer policy.

---

## Como rodar

### Supabase local (recomendado para iterar)

```bash
supabase start
supabase db reset          # aplica supabase/migrations/ + supabase/seed.sql
cp .env.example .env       # preencher com a saída de `supabase status`
npm install
npm run seed               # cria os 4 usuários (Admin API) e repopula os dados
npm run test:rls           # a prova de isolamento
```

### Projeto hosted, só pelo navegador (sem Docker e sem CLI)

Este é o caminho quando não dá para rodar o Supabase local. Nada aqui exige Node.

1. **Criar o projeto** em [supabase.com](https://supabase.com) → New project. Guarde a
   senha do banco (ela não é mostrada de novo).
2. **Criar o schema**: SQL Editor → New query → colar o conteúdo de
   [`db/hosted/schema-completo.sql`](db/hosted/schema-completo.sql) → Run. É a
   concatenação das três migrations na ordem certa, num arquivo só.
3. **Criar os usuários de teste**: Authentication → Users → Add user → Create new user,
   quatro vezes, com os e-mails da tabela acima, a senha `senha-de-teste-123` e a opção
   **Auto Confirm User** marcada. Sem a confirmação, o login falha depois.
4. **Popular os dados**: SQL Editor → colar `supabase/seed.sql` → Run. Ele insere as duas
   clínicas com seus pacientes e exames e liga os `membros` pelo e-mail dos usuários que
   você acabou de criar.
5. **Ver a RLS funcionando sem escrever código**: ainda no SQL Editor, use o seletor de
   role/usuário (o botão de *impersonate*, ao lado do Run) para se passar pelo médico da
   Alfa e rodar `select * from pacientes;`. Devem vir 2 linhas, só da Alfa. Trocando para o
   médico da Beta, as outras 2. Sem impersonar, como `postgres`, vêm as 4 — porque o dono
   da tabela não passa pela RLS. Esse contraste é a demonstração inteira.

Depois, quando tiver Node na máquina, os scripts automatizam exatamente isso:

```bash
# .env com a URL https://<ref>.supabase.co e as chaves de Project Settings > API
npm install && npm run seed && npm run test:rls
```

Se você usa o CLI, os passos 2 e 4 viram `supabase link --project-ref <ref> && supabase db push`.

> `supabase/config.toml` vale só para o `supabase start` local. No hosted, o equivalente
> fica no dashboard — e a confirmação de e-mail não atrapalha, porque tanto o
> "Auto Confirm User" quanto o `email_confirm: true` do seed já resolvem.

### GitHub Actions — o repositório falando com o Supabase

Se você não tem como rodar nada localmente, o CI faz o papel da sua máquina.
`.github/workflows/rls.yml` tem dois jobs:

- **`sql`** — não precisa de segredo nenhum. Sobe um Postgres 16, aplica o shim de `auth`,
  as migrations reais e as 24 asserções de isolamento, e confere que
  `db/hosted/schema-completo.sql` ainda reflete as migrations. Roda em todo push, e é o que
  impede uma policy de regredir sem ninguém notar.
- **`supabase`** — o caminho completo (`anon key` → login → JWT → PostgREST), rodando
  `npm run seed && npm run test:rls` contra o projeto hosted. Só executa se os secrets
  existirem; sem eles termina verde explicando o que falta, em vez de falhar.

Para ligar o segundo job, em **Settings → Secrets and variables → Actions → New repository
secret**:

| Secret | Onde achar |
|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` `secret` |

> A `service_role` key ignora a RLS por completo — é chave de administrador do projeto.
> Guardá-la como secret de repositório é aceitável **para este projeto de POC descartável**,
> e não é um hábito para levar a um projeto real. Se ela vazar, rotacione em
> Project Settings → API.

### Sem Docker: harness em PostgreSQL puro

```bash
npm run verify:local       # = bash db/local-verify/run.sh
```

Cria um banco descartável, aplica um **shim** do ambiente Supabase (roles `anon`/
`authenticated`, schema `auth`, `auth.uid()` lendo `request.jwt.claims` — que é o que o
PostgREST injeta), depois as **migrations reais sem nenhuma alteração**, o seed e a matriz
de isolamento. Os testes rodam dentro de uma transação com `rollback`, então são
reexecutáveis.

O que ele prova: a lógica das policies e o comportamento da RLS.
O que ele **não** prova: login real, emissão de JWT e o PostgREST — esse é o papel de
`npm run test:rls`.

### Usuários de teste

| E-mail | Organização | Papel |
|---|---|---|
| `admin.alfa@exemplo.test` | Clínica Alfa | admin |
| `medico.alfa@exemplo.test` | Clínica Alfa | medico |
| `admin.beta@exemplo.test` | Clínica Beta | admin |
| `medico.beta@exemplo.test` | Clínica Beta | medico |

Senha de todos: `senha-de-teste-123` (em `scripts/lib/fixtures.ts`). São dados de POC,
nunca de produção.

---

## Resultado dos testes

### `npm run verify:local` — executado, todos os casos passando

```
=== CONTROLE (dono da tabela, sem RLS) ===============================
Sem esta secao, "0 linhas" nao provaria nada: poderia ser tabela vazia.
  OK    existem 2 organizacoes no banco
  OK    existem 4 pacientes no banco (2 por org)
  OK    existem 5 exames no banco (3 Alfa + 2 Beta)

=== MEDICO DA CLINICA ALFA ===========================================
  OK    1. le 2 pacientes, todos da Alfa
  OK    2. le 3 exames, todos da Alfa
  OK    3. paciente da Beta buscado por id: 0 linhas (RLS filtra, nao da erro)
  OK    4. INSERT de paciente na Beta bloqueado (42501)
  OK    5. UPDATE em paciente da Beta afeta 0 linhas (USING)
  OK    6. UPDATE movendo paciente proprio para a Beta bloqueado (WITH CHECK)
  OK    7. INSERT de exame na Beta bloqueado (42501)
  OK    7b. exame apontando paciente da Beta com org propria barrado pela FK composta (23503)
  OK    8. DELETE de paciente proprio afeta 0 linhas (medico nao deleta)
  OK    9. INSERT de exame no proprio paciente FUNCIONA (controle positivo)
  OK    10. INSERT em membros bloqueado para medico (so admin gerencia)
  OK    11. enxerga 1 organizacao (a Alfa)

=== ADMIN DA CLINICA ALFA ============================================
  OK    12. DELETE de paciente pelo admin FUNCIONA (eixo papel confirmado)
  OK    13. admin adiciona membro na propria org
  OK    14. admin da Alfa NAO adiciona membro na Beta (papel nao atravessa tenant)

=== MEDICO DA CLINICA BETA (o isolamento e simetrico) =================
  OK    15. le 2 pacientes, todos da Beta
  OK    16. le 2 exames, todos da Beta (o exame criado na Alfa nao aparece)
  OK    17. paciente da Alfa buscado por id: 0 linhas
  OK    18. UPDATE em paciente da Alfa afeta 0 linhas
  OK    19. INSERT de paciente na Alfa bloqueado (42501)

=== SEM LOGIN (role anon) ============================================
  OK    20. anon nem chega na tabela (GRANT revogado, antes mesmo da policy)

=== TODOS OS CASOS PASSARAM ==========================================
```

Dois **controles negativos** confirmam que essa bateria de fato detecta uma policy fraca —
uma suíte que só diz "OK" não vale nada se ela não souber falhar:

- trocar a policy de DELETE de `pacientes` de `is_admin` para `is_membro` (ou seja, dar
  o delete ao médico) → o caso 8 falha, como esperado;
- afrouxar leitura **e** escrita ao mesmo tempo (`with check (true)` no UPDATE **e**
  `using (true)` no SELECT) → o paciente efetivamente migra de tenant. Foi assim que a
  seção sobre `USING`/`WITH CHECK` acima foi escrita: medindo, não supondo.

### Projeto hosted — leitura confirmada no SQL Editor

O schema e o seed foram aplicados num projeto Supabase hosted e o isolamento de **leitura**
foi verificado à mão, impersonando cada usuário no SQL Editor com
`select nome, organizacao_id from pacientes;`:

| Rodando como | Linhas devolvidas |
|---|---|
| `medico.alfa@exemplo.test` | 2 — Ana Alves (Alfa), Artur Braga (Alfa) |
| `medico.beta@exemplo.test` | 2 — Bruna Costa (Beta), Bento Dias (Beta) |
| `postgres` (dono da tabela, sem RLS) | 4 — as duas clínicas |

A terceira linha é o que dá sentido às outras duas: os quatro pacientes existem, então o
"2" não é tabela vazia, é a policy filtrando.

### `npm run test:rls` — executado no Supabase local, todos os casos passando

Executado na etapa 2, quando o ambiente passou a ter Docker: `supabase start` (CLI 2.120.0),
`npm run seed` e `npm run test:rls`, pelo caminho real (anon key → login → JWT ES256 →
PostgREST). Rodado duas vezes seguidas, para confirmar que o teste é reexecutável.

<details>
<summary>Saída completa — <code>TODOS OS 23 CASOS PASSARAM</code></summary>

```
=== CONTROLE (service_role - ignora a RLS) ============================
    Alfa: 2 pacientes, 3 exames
    Beta: 2 pacientes, 2 exames
  OK    0. as duas organizacoes tem dados no banco

=== MEDICO DA CLINICA ALFA ============================================
  OK    1. le pacientes: so os da Alfa
          -> recebeu 2 de 4 pacientes do banco; 0 de outra org.
  OK    2. le exames: so os da Alfa
          -> recebeu 3 de 5 exames do banco; 0 de outra org.
  OK    3. busca por id um paciente da Beta: 0 linhas, sem erro
  OK    4. INSERT de paciente na Beta e bloqueado
          -> 42501: new row violates row-level security policy for table "pacientes"
  OK    5. UPDATE em paciente da Beta afeta 0 linhas
  OK    6. UPDATE movendo um paciente PROPRIO para a Beta e bloqueado
          -> 42501: new row violates row-level security policy for table "pacientes"
  OK    7. INSERT de exame na Beta e bloqueado
          -> 42501: new row violates row-level security policy for table "exames"
  OK    7b. exame apontando paciente da Beta sob a org propria e barrado pela FK composta
          -> 23503: insert or update on table "exames" violates foreign key constraint "exames_paciente_id_organizacao_id_fkey"
  OK    8. DELETE de paciente proprio afeta 0 linhas (medico nao deleta)
  OK    9. INSERT de exame no proprio paciente FUNCIONA (controle positivo)
  OK    10. medico nao escreve em membros (nem na propria org)
          -> 42501: new row violates row-level security policy for table "membros"
  OK    11. enxerga 1 organizacao (a Alfa)

=== ADMIN DA CLINICA ALFA (o eixo papel) ==============================
  OK    12. DELETE de paciente pelo admin FUNCIONA (o que o medico nao pode no caso 8)
  OK    13. admin adiciona membro na PROPRIA org
  OK    14. admin remove membro da propria org
  OK    15. admin da Alfa NAO adiciona membro na Beta (papel nao atravessa o tenant)
          -> 42501: new row violates row-level security policy for table "membros"

=== MEDICO DA CLINICA BETA (o isolamento e simetrico) =================
  OK    16. le pacientes: so os da Beta
  OK    17. le exames: so os da Beta (o exame criado na Alfa nao aparece)
  OK    18. busca por id um paciente da Alfa: 0 linhas
  OK    19. UPDATE em paciente da Alfa afeta 0 linhas
  OK    20. INSERT de paciente na Alfa e bloqueado
          -> 42501: new row violates row-level security policy for table "pacientes"

=== SEM LOGIN (anon key crua) =========================================
  OK    21. sem autenticar nao se le nada
          -> 42501: permission denied for table pacientes

========================================================================
TODOS OS 23 CASOS PASSARAM - isolamento entre tenants confirmado.
```

(Parte das linhas de detalhe e das notas foi omitida para caber; nenhum caso foi removido.)

</details>

---

## Estrutura

```
supabase/migrations/   schema, helpers de RLS e policies (comentados com o porquê)
supabase/seed.sql      dados de domínio opcionais, aplicados por `supabase db reset`
supabase/functions/mcp/      [etapa 2] o servidor MCP (Edge Function, block oficial)
  index.ts                     pipeline: OAuth discovery → withSupabase (gate) → McpServer
  tools/                       whoami (do block), pacientes.ts, exames.ts, result.ts, types.ts
  database.types.ts            gerado por `npm run gen:types`
scripts/seed.ts        cria os usuários pela Admin API e repopula os dois tenants
scripts/test-isolamento.ts   a prova de isolamento ponta a ponta (PostgREST)
scripts/test-mcp.ts    [etapa 2] a mesma prova, através do servidor MCP
scripts/token.ts       [etapa 2] imprime um access token para curl / MCP Inspector
scripts/lib/           env, fixtures (UUIDs fixos), clients, runner de asserções, cliente MCP
db/local-verify/       harness em Postgres puro: shim de auth + migrations reais + testes
```

---

## Etapa 2 — servidor MCP como Edge Function

O servidor MCP roda como a Supabase Edge Function **`mcp`** (Deno), com URL remota
(`/functions/v1/mcp`). Qualquer cliente MCP conversa com ele por HTTP: hoje o agente embutido
do app; depois, Claude, ChatGPT e Codex. Ele é feito com o block oficial
[**MCP Server**](https://supabase.com/library/docs/headless/mcp) da Supabase.

A decisão que a etapa 1 já tinha deixado pronta: o **servidor MCP oficial do Supabase roda
com `service_role`** e ignora a RLS. Ele serve para o desenvolvedor operar o projeto, não
para o médico final. Este servidor faz o oposto: **toda tool roda como o usuário logado**,
com o JWT dele, e quem decide o que ele vê continua sendo a policy.

Nesta etapa a autenticação é só a do modo **"embedded product agent"**: quem chama manda o
access token do usuário Supabase em `Authorization: Bearer <token>`. Não há OAuth server nem
tela de consentimento (veja [Fora de escopo](#fora-de-escopo-nesta-etapa)).

### Arquitetura

```
 agente do app / cliente MCP
        │  POST /functions/v1/mcp      Authorization: Bearer <access token do usuário>
        ▼
 gateway (Kong)                        verify_jwt = false: só repassa (ver abaixo)
        ▼
 Edge Function `mcp`  ─ supabase/functions/mcp/index.ts
   pipeline(
     withOAuthProtectedResource()      metadados RFC 9728 + WWW-Authenticate no 401
     withSupabase<Database>({ auth: 'user' })
                                       verifica o JWT pela JWKS (ES256): assinatura,
                                       expiração, `sub`. Falhou → 401, nenhuma tool roda
     handleMcp → McpServer novo por request → tools/*
   )
        │  ctx.supabase = supabase-js com o JWT do usuário (nunca service_role)
        ▼
 PostgREST → auth.uid() → policies is_membro / is_admin → só linhas da org do usuário
```

A segurança fica em três camadas, e a de baixo é a que manda:

1. **Gate**: só passa JWT de usuário com assinatura válida contra a JWKS do projeto. Os
   casos 1 a 4 do teste mostram isso: sem token, token lixo, assinatura adulterada e anon
   key, tudo dá 401.
2. **Tool**: input validado por Zod e regra de negócio antes de escrever.
3. **Banco**: RLS e FK composta, exatamente as da etapa 1. As tools não filtram por
   organização; elas só dão forma à resposta e devolvem erros claros. Se uma tool tivesse
   um bug, a policy ainda barraria. O [controle negativo](#controle-negativo) mostra isso
   acontecendo.

**Por que `verify_jwt = false`** (em `supabase/config.toml`): a própria função verifica o
token com `withSupabase`, contra a JWKS. Ela devolve o 401 com o desafio `WWW-Authenticate`
que clientes MCP esperam e aceita tanto tokens de sessão do app quanto, no futuro, tokens
OAuth. Desligar a checagem no gateway **não** deixa a função aberta: os casos 1 a 4 provam
isso.

### Requisitos

| Requisito | Estado |
|---|---|
| Supabase CLI **≥ 2.117.0** | testado com **2.120.0**. Versões anteriores não fornecem chaves assimétricas no local nem injetam o slug da função. Confira com `supabase --version`. |
| JWT assinado com **chave assimétrica** (ES256/RS256) | **confirmado no local**: `/auth/v1/.well-known/jwks.json` traz uma chave `EC P-256` `ES256`, e o token do `medico.alfa` vem com `alg: ES256`. O block **rejeita HS256**. No projeto hosted, troque em Project Settings → JWT Keys antes de usar. |
| Deno 2.x | para `deno task check` (testado com 2.9.6) |
| Docker | para `supabase start` e `supabase functions serve` |

### Como rodar localmente

```bash
supabase start
supabase db reset                 # migrations + supabase/seed.sql
cp .env.example .env              # preencher com `supabase status -o env`
                                  #   (API_URL, ANON_KEY, SERVICE_ROLE_KEY)
npm install
npm run seed                      # usuários de teste + dados dos dois tenants

cp supabase/functions/mcp/.env.example supabase/functions/.env   # MCP_SERVER_NAME/DESCRIPTION
npm run check:mcp                 # = cd supabase/functions/mcp && deno task check
supabase functions serve mcp --env-file supabase/functions/.env  # deixe rodando

# em outro terminal
npm run test:rls                  # etapa 1 (regressão)
npm run test:mcp                  # etapa 2: isolamento através do servidor MCP
```

Depois de mudar o schema, rode `npm run gen:types` para regenerar
`supabase/functions/mcp/database.types.ts`. As tools usam `SupabaseClient<Database>`, então
coluna errada vira erro no `deno task check`, não em produção.

### Tools

| Tool | `readOnlyHint` | Input | Devolve | Regra além da RLS |
|---|---|---|---|---|
| `whoami` (do block) | `true` | — | `{ id, email, role, client_id }` do token verificado | `client_id` é `null` em sessão do app; vem preenchido em token OAuth |
| `listar_pacientes` | `true` | — | `{ pacientes, total }` | nenhuma, de propósito: sem filtro de org no código, a RLS decide o que existe |
| `buscar_exames` | `true` | `paciente_id` (uuid) | `{ paciente, exames, total }`, do mais recente ao mais antigo | o paciente precisa ser visível ao usuário; se não for, erro *"Paciente nao encontrado na sua organizacao"* |
| `criar_exame` | `false` | `paciente_id` (uuid), `tipo` (1–200 caracteres), `resultado?`, `realizado_em?` (ISO 8601) | `{ exame }` | mesma checagem do paciente **antes** do insert; `organizacao_id` vem da linha do paciente lida do banco; `criado_por` vem do `sub` verificado; campo extra no input é rejeitado |

O erro de paciente é **igual** para "não existe" e "é de outra clínica". Diferenciar os dois
deixaria quem chama sondar quais ids existem em outros tenants.

### Regras de segurança, e onde cada uma está

- **Só o client do usuário.** As tools recebem `supabase` do `ToolContext`, que é escopado
  pelo JWT. O tipo do contexto (`tools/types.ts`) não tem `supabaseAdmin`, e não há
  `service_role` em nenhum lugar de `supabase/functions/`.
- **Nada de SQL livre.** São três tools de domínio, com input `z.strictObject`, `z.uuid()` e
  limites de tamanho.
- **Escrita checa regra de negócio.** O `criar_exame` só escreve para paciente que o usuário
  enxerga. RLS de INSERT e FK composta continuam por baixo, como defesa em profundidade.
- **Nada editável pelo usuário decide autorização.** A organização vem do banco e o autor vem
  de `userClaims.id`. Nada vem de `user_metadata` nem do input.
- **Erros sem segredo.** O modelo recebe mensagem e código Postgres (`[42501] ...`), sem
  token, claims ou stack.
- **O token fica no backend.** No modo embedded, o access token fica no backend ou no
  orquestrador do agente, nunca no prompt nem exposto ao provedor do modelo.

### Resultado dos testes via MCP

`deno task check` passa sem erros. `npm run test:mcp` foi executado contra
`supabase functions serve mcp` (CLI 2.120.0, edge-runtime 1.77.4), duas vezes seguidas, e
**todos os casos passaram**. O banco volta às contagens do seed no fim. A saída completa:

```
=== CONTROLE (service_role - ignora a RLS) ============================
    As contagens reais. Sem elas, "lista vazia" ou "erro" nao provariam isolamento.
    Alfa: 2 pacientes, 3 exames
    Beta: 2 pacientes, 2 exames
  OK    0. as duas organizacoes tem dados no banco
          -> Alfa 2p/3e, Beta 2p/2e

=== SEM CREDENCIAL VALIDA (o gate barra antes de qualquer tool) =======
  OK    1. sem Authorization: 401
          -> HTTP 401
  OK    2. token invalido: 401
          -> HTTP 401
  OK    3. token do medico com assinatura adulterada: 401
          -> HTTP 401
  OK    4. anon key (credencial de projeto, nao de usuario) como Bearer: 401
          -> HTTP 401

=== MEDICO DA CLINICA ALFA, VIA MCP ===================================
    logado como medico.alfa@exemplo.test (auth.uid() = 0c4d73bc-59ad-4af6-9dde-b6edcdb47265)
  OK    5. initialize responde
          -> HTTP 200, servidor "prontuarios-poc", protocolo 2025-06-18
  OK    6. tools/list: as 4 tools, com readOnlyHint certo
          -> whoami(readOnly=true), listar_pacientes(readOnly=true), buscar_exames(readOnly=true), criar_exame(readOnly=false)
  OK    7. whoami: e o medico da Alfa, sessao de produto (sem client_id OAuth)
          -> {"id":"0c4d73bc-59ad-4af6-9dde-b6edcdb47265","email":"medico.alfa@exemplo.test","role":"authenticated","client_id":null}
  OK    8. listar_pacientes: so os da Alfa
          -> recebeu 2 de 4 pacientes do banco; 0 de outra org: Ana Alves (Alfa), Artur Braga (Alfa)
  OK    9. buscar_exames(paciente da Alfa): os exames dele, e so dele
          -> 2 exame(s) de Ana Alves (Alfa); 0 alheio(s)
  OK    10. buscar_exames(paciente da Beta): erro, nenhum dado
          -> Paciente nao encontrado na sua organizacao. Use listar_pacientes para ver os ids disponiveis.
  OK    11. criar_exame(paciente da Beta): erro, e a Beta continua com os mesmos exames
          -> Paciente nao encontrado na sua organizacao. Use listar_pacientes para ver os ids disponiveis. | exames da Beta no banco: 2 (antes: 2)
  OK    12. criar_exame com organizacao_id da Beta no input: rejeitado, nada escrito
          -> Input validation error: Invalid arguments for tool criar_exame: Unrecognized key: "organizacao_id" | exames Alfa/Beta no banco: 3/2
  OK    13. paciente_id que nao e uuid: erro de validacao (Zod)
          -> Input validation error: Invalid arguments for tool buscar_exames: paciente_id: Invalid UUID
  OK    14. criar_exame(paciente da Alfa) FUNCIONA: org vem do paciente, autor vem do token
          -> exame 91f1ec17-ed8a-4a45-882e-38a6adec320d: organizacao_id=Alfa, criado_por=0c4d73bc-59ad-4af6-9dde-b6edcdb47265

=== MEDICO DA CLINICA BETA, VIA MCP (o isolamento e simetrico) ========
    logado como medico.beta@exemplo.test (auth.uid() = b7349072-693e-41e4-8cea-67f22ee9b12d)
  OK    15. whoami: e o medico da Beta
          -> {"id":"b7349072-693e-41e4-8cea-67f22ee9b12d","email":"medico.beta@exemplo.test","role":"authenticated","client_id":null}
  OK    16. listar_pacientes: so os da Beta
          -> recebeu 2 paciente(s); 0 de outra org: Bento Dias (Beta), Bruna Costa (Beta)
  OK    17. buscar_exames(paciente da Beta): os exames dele
          -> 1 exame(s) de Bruna Costa (Beta); 0 de outra org
  OK    18. buscar_exames(paciente da Alfa): erro, nenhum dado (nem o exame do caso 14)
          -> Paciente nao encontrado na sua organizacao. Use listar_pacientes para ver os ids disponiveis.
  OK    19. criar_exame(paciente da Alfa): erro, e a Alfa continua com os mesmos exames
          -> Paciente nao encontrado na sua organizacao. Use listar_pacientes para ver os ids disponiveis. | exames da Alfa no banco: 4 (antes: 4)

========================================================================
TODOS OS 20 CASOS PASSARAM - isolamento entre tenants confirmado.
```

#### Controle negativo

Para saber se a suíte detecta um vazamento de verdade, a policy
`pacientes: le da propria org` foi trocada temporariamente para `using (true)` no banco
local, e o teste rodou de novo. Depois, a policy foi restaurada para
`is_membro(organizacao_id)`.

```
  FALHOU  8. listar_pacientes: so os da Alfa
          -> recebeu 4 de 4 pacientes do banco; 2 de outra org: Ana Alves (Alfa), Artur Braga (Alfa), Bento Dias (Beta), Bruna Costa (Beta)
  FALHOU  10. buscar_exames(paciente da Beta): erro, nenhum dado
          -> {"paciente":{"id":"bbbb0001-...","nome":"Bruna Costa (Beta)",...},"exames":[],"total":0}
  OK    11. criar_exame(paciente da Beta): erro, e a Beta continua com os mesmos exames
          -> [42501] new row violates row-level security policy for table "exames" | exames da Beta no banco: 2 (antes: 2)
  FALHOU  16. listar_pacientes: so os da Beta
  FALHOU  18. buscar_exames(paciente da Alfa): erro, nenhum dado (nem o exame do caso 14)
```

Dois pontos nessa saída:

- **O vazamento aparece pelo MCP.** O nome do paciente da Beta chega ao médico da Alfa, e
  os casos 8, 10, 16 e 18 pegam isso. Os exames continuam vazios porque a policy de `exames`
  ficou intacta: cada tabela se defende sozinha.
- **O caso 11 continua passando, e esse é o ponto.** Com a leitura afrouxada, a checagem
  de negócio da tool deixou passar, mas a policy de **INSERT** de `exames` barrou a escrita
  (`42501`). É a defesa em profundidade funcionando.

### Chamando à mão: curl e MCP Inspector

`npm run token` imprime um access token de um usuário de teste. Ele expira em 1 hora
(`jwt_expiry`); depois disso, gere outro.

```bash
TOKEN=$(npm run -s token -- medicoAlfa)      # ou medicoBeta, adminAlfa, adminBeta

curl -sS http://127.0.0.1:54321/functions/v1/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"listar_pacientes","arguments":{}}}'
```

A resposta vem como SSE (`event: message` / `data: {...}`). O servidor é stateless: não há
`Mcp-Session-Id`, e cada POST pode ser um `initialize`, `tools/list` ou `tools/call`
independente.

**MCP Inspector.** No modo CLI, verificado contra o servidor local:

```bash
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:54321/functions/v1/mcp \
  --transport http --header "Authorization: Bearer $TOKEN" --method tools/list
# ou: --method tools/call --tool-name listar_pacientes
```

Na interface (`npx @modelcontextprotocol/inspector`, que abre no navegador): transporte
**Streamable HTTP**, URL `http://127.0.0.1:54321/functions/v1/mcp` e, na parte de
autenticação/headers, `Authorization` com o valor `Bearer <token>`. Depois, Connect →
Tools. Só o modo CLI foi verificado aqui; a interface usa esses mesmos três dados.

### O block: procedência e o que mudou nele

O comando oficial é `npx shadcn@latest add @supabase/mcp`. Neste repositório os arquivos foram
copiados sem alteração de
[`supabase/supabase@5c68e24`](https://github.com/supabase/supabase/tree/5c68e24fafe4a049c8b349b71615c8ea2b951e41/apps/ui-library/registry/default/blocks/mcp/supabase/functions/mcp),
que é a fonte do mesmo registry, porque o ambiente de desenvolvimento bloqueava
`supabase.com`. **Não rode o comando de novo**: ele sobrescreveria os arquivos abaixo.

O que mudou em relação ao block original:

| Arquivo | Mudança | Por quê |
|---|---|---|
| `.env.example` | nome `prontuarios-poc` e descrição do domínio | a doc pede para customizar |
| `index.ts` | `withSupabase<Database>(...)` e `SupabaseContext<Database>` | client tipado, sem cast |
| `tools/types.ts` | `SupabaseClient<Database>` | recomendação da doc do block |
| `tools/index.ts` | registra `pacientes.ts` e `exames.ts` | o ponto único de composição |
| `tools/result.ts` | `runtimeErrorResult` lê `message` de erros que não são `Error` | o supabase-js devolve `{ error }` como objeto puro, e o `throw error` do exemplo da doc chegava ao modelo como `[object Object]` (achado pelo controle negativo) |
| `deno.lock` | `zod@4.4.3` | a versão do exemplo da doc |

O `withOAuthProtectedResource()` foi **mantido** como o block entrega. Ele só publica
`/functions/v1/mcp/oauth-protected-resource` e o header `WWW-Authenticate`. Sem
`[auth.oauth_server]` no `config.toml`, nenhum fluxo OAuth fica habilitado.

> Nota sobre o ambiente onde os testes rodaram: era um container Linux atrás de um proxy que
> intercepta TLS. O único ajuste fora do repositório foi fazer o edge-runtime confiar na CA
> desse proxy (`DENO_CERT`, via um env-file que não está no repo). Numa máquina normal o
> comando é só o de cima.

### Fora de escopo nesta etapa

- **OAuth e consentimento para clientes externos** (Claude, ChatGPT, Codex). O caminho é o
  OAuth Consent block da Supabase mais `[auth.oauth_server]` no `config.toml`. Tokens OAuth
  trazem `client_id` (o `whoami` já mostra); as policies vão precisar dizer o que vale em
  cada caso.
- **Deploy em produção** (`supabase functions deploy mcp`). O projeto hosted precisa estar
  com JWT Keys assimétricas.
- **CI do servidor MCP.** O job `sql` já faz o typecheck de `scripts/test-mcp.ts`, mas
  `deno task check` e `test:mcp` ainda não rodam no CI.
- Integração com um aplicativo real.
