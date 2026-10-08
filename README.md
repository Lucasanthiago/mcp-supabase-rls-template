# Multitenant com RLS + servidor MCP, do zero

Template de uma fundação segura para um produto SaaS onde **vários clientes
compartilham o mesmo banco** e uma IA consulta esses dados.

Duas clínicas fictícias usam o mesmo Postgres. O médico de uma nunca alcança o
paciente da outra — e quem garante isso é o banco, não o código da aplicação.
Em cima disso existe um **servidor MCP**, que é como um assistente de IA usa
ferramentas: cada ferramenta roda como o usuário logado, sob as mesmas regras.

Ao terminar este guia você vai ter, no seu próprio Supabase:

| O quê | Como você vê |
|---|---|
| O banco com as regras de isolamento | `npm run test:rls` — 23 casos |
| O servidor MCP publicado | `npm run test:mcp` — 20 casos |
| Uma tela mostrando os dois lados | `npm run ui` no navegador |

**Leva cerca de 30 minutos.** Nada aqui custa dinheiro: o plano gratuito do
Supabase basta.

> Quer entender *por que* cada decisão foi tomada — o raciocínio de cada policy,
> as armadilhas de RLS, a procedência do servidor MCP? Está em
> [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Este arquivo é só o passo a passo.

---

## Antes de começar

### Contas que você precisa criar

| Serviço | Para quê | Obrigatório? |
|---|---|---|
| [supabase.com](https://supabase.com) | o banco, o login dos usuários e o servidor MCP | **sim** |
| [github.com](https://github.com) | guardar seu código | opcional |
| [vercel.com](https://vercel.com) | publicar a tela num link | opcional |

Todas têm plano gratuito e entram com login do GitHub ou Google.

### Programas na sua máquina

| Programa | Para quê | Como conferir |
|---|---|---|
| **Node.js 22 ou mais novo** | rodar os scripts e a tela | `node --version` |
| **Supabase CLI** | aplicar o schema e publicar o servidor | `npx supabase --version` |
| Docker | **só** se quiser rodar tudo offline | `docker --version` |

Node se instala em [nodejs.org](https://nodejs.org). A Supabase CLI não precisa
ser instalada: todo comando deste guia usa `npx supabase`, que baixa na hora.

**Docker é opcional.** O caminho principal deste guia usa o Supabase na nuvem.

---

## Passo a passo

### 1. Pegue o código e instale as dependências

```bash
npm install
```

### 2. Crie o projeto no Supabase

No [painel do Supabase](https://supabase.com/dashboard): **New project**.

- Dê um nome qualquer
- **Guarde a senha do banco** que ele gerar — ela não é mostrada de novo
- Escolha a região mais perto de você

Leva uns dois minutos para o projeto ficar pronto.

### 3. Troque as chaves de JWT para assimétricas

**Este passo é obrigatório e fácil de esquecer.** O servidor MCP valida o token
contra chaves públicas e **recusa** o formato antigo (HS256).

No painel: **Project Settings → JWT Keys** → migre para chave assimétrica
(ES256 ou RS256). Se o projeto for novo, provavelmente já está assim.

### 4. Copie as chaves para o arquivo `.env`

No painel: **Project Settings → API Keys**. Depois:

```bash
cp .env.example .env
```

Abra o `.env` e preencha três valores:

| Variável | Onde achar | O que é |
|---|---|---|
| `SUPABASE_URL` | Project URL | o endereço do seu projeto |
| `SUPABASE_ANON_KEY` | chave *publishable* (ou *anon*) | a chave pública, que vai no navegador |
| `SUPABASE_SERVICE_ROLE_KEY` | chave *secret* (ou *service_role*) | **ignora a RLS por completo** |

> A chave secreta é usada em exatamente dois lugares, e só neles: criar os
> usuários de teste e ler as contagens reais que servem de controle nos testes.
> Ela nunca entra no servidor MCP nem na tela. O `.env` está no `.gitignore` —
> não comite esse arquivo.

### 5. Crie as tabelas e as regras

Dois caminhos. **Pelo navegador** não exige instalar nada:

<details>
<summary><b>Caminho A — SQL Editor, sem instalar nada</b></summary>

No painel: **SQL Editor → New query**. Cole o conteúdo de
[`db/hosted/schema-completo.sql`](db/hosted/schema-completo.sql) e rode.
Depois, na mesma tela, cole o conteúdo de
[`supabase/seed.sql`](supabase/seed.sql) e rode também.

</details>

<details>
<summary><b>Caminho B — pela CLI</b></summary>

```bash
npx supabase login
npx supabase link --project-ref SEU-PROJECT-REF
npx supabase db push
```

O `project-ref` é aquele código no meio da URL do painel
(`supabase.com/dashboard/project/ESTE-AQUI`).

</details>

### 6. Crie os usuários de teste e popule os dados

```bash
npm run seed
```

Isso cria quatro usuários e os dados das duas clínicas. Pode rodar quantas
vezes quiser — ele limpa e repopula.

### 7. Primeira prova: o isolamento no banco

```bash
npm run test:rls
```

Esperado: **23 casos, todos passando**. Cada um faz login de verdade e tenta
uma operação: ler o paciente da outra clínica, mover um paciente para a outra
clínica, inserir exame onde não pode. Se algum falhar, pare aqui — não adianta
subir o servidor MCP sobre uma base que vaza.

### 8. Publique o servidor MCP

```bash
cp supabase/functions/mcp/.env.example supabase/functions/.env
npx supabase secrets set --env-file supabase/functions/.env --project-ref SEU-PROJECT-REF
npx supabase functions deploy mcp --project-ref SEU-PROJECT-REF --no-verify-jwt
```

O `--no-verify-jwt` não enfraquece nada: o gateway deixa de validar porque a
**própria função** valida, e assim ela consegue devolver o `401` com o desafio
que clientes MCP esperam.

### 9. Segunda prova: o isolamento através do servidor

```bash
npm run test:mcp
```

Esperado: **20 casos, todos passando**. Quatro deles tentam chamar sem
credencial válida — inclusive usando a chave pública do projeto como se fosse
credencial de usuário — e todos recebem `401` antes de qualquer ferramenta
rodar.

### 10. A tela

```bash
cp web/config.example.js web/config.js
```

Preencha `web/config.js` com a URL do projeto e a chave **publishable** (nunca
a secreta). Depois:

```bash
npm run ui
```

Abra `http://127.0.0.1:4321`. A tela entra como os dois médicos, mostra os
pacientes de cada um, e o botão **Ver as duas** coloca as clínicas lado a lado.
O botão vermelho tenta abrir um paciente da outra clínica e mostra o bloqueio
vindo do banco.

No rodapé: as ferramentas que o servidor oferece, lidas dele mesmo, e o registro
ao vivo de cada chamada.

---

## Opcional: conversar com os dados pelo Claude Code

```bash
npm run mcp:config
```

Isso escreve o `.mcp.json` com **dois** servidores, um por médico. Abra um chat
novo do Claude Code na pasta do projeto e pergunte:

> No clinica-alfa: quais são meus pacientes?

Depois faça a mesma pergunta no `clinica-beta`. As respostas são diferentes, e
nenhum dos dois alcança o paciente do outro.

Os tokens valem 1 hora; rode o comando de novo quando expirarem.

## Opcional: publicar a tela num link

```bash
npx vercel deploy web --prod
```

A pasta `web/` contém só arquivos estáticos, de propósito — qualquer
hospedagem de site estático serve.

Duas coisas que **não** funcionam, já testadas: servir esta tela por uma Edge
Function ou pelo Storage do Supabase (os dois devolvem `text/plain`, e o
navegador mostra o código em vez da página).

## Opcional: rodar tudo offline

Com Docker aberto:

```bash
npx supabase start
npx supabase db reset
# atualize o .env com a saída de: npx supabase status -o env
npm run seed
npx supabase functions serve mcp --env-file supabase/functions/.env
```

Sem Docker e sem Supabase, há um harness que roda as policies em PostgreSQL
puro: `npm run verify:local` (precisa de um Postgres local e `psql`).

---

## Os usuários de teste

Todos com a senha `senha-de-teste-123`:

| E-mail | Clínica | Papel |
|---|---|---|
| `admin.alfa@exemplo.test` | Alfa | admin |
| `medico.alfa@exemplo.test` | Alfa | médico |
| `admin.beta@exemplo.test` | Beta | admin |
| `medico.beta@exemplo.test` | Beta | médico |

Dados fictícios de prova de conceito. Nunca reutilize essas senhas em nada real.

## Todos os comandos

| Comando | O que faz |
|---|---|
| `npm run seed` | cria os usuários e repopula os dados |
| `npm run test:rls` | 23 casos de isolamento no banco |
| `npm run test:mcp` | 20 casos através do servidor MCP |
| `npm run ui` | a tela, em `http://127.0.0.1:4321` |
| `npm run demo` | a mesma pergunta como os dois médicos, no terminal |
| `npm run mcp:config` | gera o `.mcp.json` para o Claude Code |
| `npm run token -- medicoAlfa` | imprime um token, para `curl` ou MCP Inspector |
| `npm run typecheck` | checa os tipos dos scripts |
| `npm run verify:local` | roda as policies em PostgreSQL puro, sem Docker |

## Quando algo não funciona

| Sintoma | Causa provável |
|---|---|
| `falta a variavel SUPABASE_URL` | o `.env` não existe ou tem o valor de exemplo |
| Teste de RLS falha logo no caso 1 | o schema não foi aplicado, ou foi aplicado pela metade |
| `npm run test:mcp` dá `401` em tudo | as JWT Keys do projeto ainda são simétricas (passo 3) |
| A tela diz "Falta apontar para o seu projeto" | falta criar o `web/config.js` (passo 10) |
| A tela carrega vazia, sem pacientes | o `seed` não rodou, ou rodou em outro projeto |
| `Load failed` no navegador | a URL no `config.js` está errada ou o projeto está pausado |

## O que este template não cobre

- **OAuth** para clientes externos (Claude, ChatGPT) usarem o servidor
- **Interface de produto** — a tela aqui existe para provar o isolamento
- Qualquer coisa perto de dado de saúde real

O raciocínio completo, incluindo o que mudou em relação ao servidor MCP oficial
da Supabase e por quê, está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).
