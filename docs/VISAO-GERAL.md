# Multitenant com RLS + MCP: visão geral do projeto

## O que este projeto é

Uma prova de conceito que responde a uma pergunta de arquitetura, não a uma pergunta de produto: **é seguro deixar uma IA consultar o banco de um sistema multitenant de saúde?**

O projeto implementa, em escala mínima, duas clínicas fictícias compartilhando o mesmo Postgres, com:

- isolamento entre clientes feito por Row Level Security, dentro do banco;
- um servidor MCP que expõe esses dados a um assistente de IA;
- cada ferramenta do servidor rodando como o usuário logado, sob as mesmas regras;
- uma bateria de testes que prova o isolamento nas duas camadas.

Não é um produto, não tem interface de usuário final e os dados são fictícios. O entregável é a fundação e a evidência de que ela se sustenta.

## Por que ele existe

Dois movimentos comuns em produtos SaaS se cruzam num ponto de risco específico: atender várias organizações no mesmo banco, e oferecer recursos de IA sobre os dados dessas organizações.

O risco concreto:

- num sistema multitenant, o pior desfecho é o profissional de uma organização alcançar o prontuário de outra;
- o caminho mais comum para isso acontecer é alguém esquecer um filtro por organização em uma consulta;
- quando uma IA entra no circuito, o problema piora, porque o que ela pede não é previsível e pode ser influenciado pelo texto que ela lê.

A decisão de arquitetura testada aqui é tirar essa responsabilidade do código da aplicação:

- a regra de separação vive nas policies do banco, avaliada a partir do `auth.uid()` do token;
- uma consulta sem filtro não vaza nada, porque o filtro já aconteceu antes;
- a IA pede o que quiser, mas quem decide o que entregar é o Postgres.

A ordem do trabalho foi deliberada: primeiro o banco isolado, sem nenhum MCP, provado por teste; só depois o servidor MCP por cima. Depurar vazamento entre tenants com o protocolo e um modelo no meio do caminho é muito mais caro do que depurar policy direto no banco.

O domínio escolhido é clínicas, pacientes e exames, mas o desenho não tem nada de específico de saúde. Troque os nomes das tabelas e vale para qualquer produto onde organizações diferentes compartilham o mesmo banco.

## Stack e arquitetura geral

O projeto é um repositório Node/TypeScript que opera um projeto Supabase. Não há aplicação cliente.

Principais peças:

- `Supabase/Postgres`: tabelas, policies de RLS e autenticação dos usuários.
- `Supabase Edge Functions`: o servidor MCP, em Deno.
- `@supabase/mcp` (block oficial): base do servidor, instalada e customizada.
- `TypeScript + tsx`: scripts de seed, testes e utilitários.
- `HTML estático`: uma tela de demonstração, sem framework e sem dependência.

O caminho de uma consulta, ponta a ponta:

1. o usuário autentica no Supabase e recebe um JWT assinado com chave assimétrica;
2. o cliente envia esse JWT no `Authorization` de uma chamada MCP;
3. a Edge Function valida o token contra o JWKS do projeto e monta um client Supabase escopado nele;
4. a ferramenta executa a consulta sem nenhum filtro de organização;
5. a RLS decide quais linhas existem para aquele usuário.

## Organização do código

O repositório está dividido por responsabilidade, não por camada.

Pastas importantes:

- `supabase/migrations/`: schema, helpers de RLS e policies, em três arquivos separados por intenção.
- `supabase/functions/mcp/`: o servidor MCP, com as ferramentas em `tools/`.
- `scripts/`: seed, as duas baterias de teste e utilitários de demonstração.
- `scripts/lib/`: clientes do Supabase, cliente MCP e as fixtures dos usuários de teste.
- `db/local-verify/`: harness que roda as policies em PostgreSQL puro, sem Docker.
- `web/`: a tela de demonstração.

Arquivos-base para entender o projeto:

- `supabase/migrations/20260910120200_rls_policies.sql`: onde o isolamento de fato acontece.
- `supabase/functions/mcp/index.ts`: a composição do servidor.
- `supabase/functions/mcp/tools/exames.ts`: a ferramenta com mais regra de negócio.
- `scripts/test-isolamento.ts`: a prova no nível do banco.
- `scripts/test-mcp.ts`: a prova através do servidor.

## Como o isolamento funciona

### 1. A cadeia de pertencimento

Toda a segurança se apoia em uma única cadeia, com quatro tabelas:

- `organizacoes`: o tenant, uma clínica;
- `membros`: liga um usuário a uma organização com um papel (`admin` ou `medico`);
- `pacientes`: pertence a uma organização;
- `exames`: pertence a um paciente e, transitivamente, a uma organização.

`membros` é a tabela-raiz de confiança. Todas as outras policies perguntam a ela, e é por isso que ela é a mais fechada do modelo.

### 2. As policies

Os helpers que as policies usam são `SECURITY DEFINER`. Isso é necessário, não conveniência: sem isso, a policy de uma tabela consultaria outra tabela que também tem RLS, e a avaliação entraria em recursão.

Um ponto de desenho que vale registrar: em `UPDATE`, `USING` e `WITH CHECK` cumprem papéis diferentes. `USING` decide quais linhas a operação enxerga, então uma tentativa fora do escopo afeta zero linhas em vez de levantar erro. `WITH CHECK` valida o resultado, então mover um registro para outra organização é bloqueado com erro explícito.

### 3. As garantias estruturais

Duas decisões de schema existem só por causa da RLS.

A coluna `exames.organizacao_id` é desnormalizada. Sem ela, a policy de `exames` precisaria de um subselect em `pacientes` — que também tem RLS — para cada linha avaliada. Com ela, a policy vira uma comparação direta que usa índice.

Como uma desnormalização pode divergir, quem garante que não divirja é o próprio banco:

- `pacientes` tem `unique (id, organizacao_id)`;
- `exames` tem chave estrangeira composta `(paciente_id, organizacao_id)`.

O efeito prático é que um exame apontando para um paciente de outra organização é **impossível de inserir**, inclusive por quem escreve com `service_role`. Isso é garantia estrutural, não convenção — e é o tipo de barreira que sobrevive a pressa, a refactor e a permissão de administrador.

## O servidor MCP

MCP é o protocolo que permite a um assistente de IA usar ferramentas em vez de só conversar. O servidor aqui é uma Edge Function publicada no projeto Supabase.

### As ferramentas

São quatro, e essa é a superfície inteira:

- `whoami`: devolve o usuário do token verificado;
- `listar_pacientes`: os pacientes da organização do usuário;
- `buscar_exames`: os exames de um paciente, do mais recente ao mais antigo;
- `criar_exame`: registra um exame novo.

As três primeiras são marcadas como somente leitura nas annotations do protocolo, e o cliente consegue ler isso antes de chamar.

### Regras de segurança, e onde cada uma está

- **Só o client do usuário.** As ferramentas recebem um client escopado pelo JWT. Não existe `service_role` em nenhum lugar de `supabase/functions/`.
- **Nada de SQL livre.** São três ferramentas de domínio, com input validado por schema estrito, UUID tipado e limites de tamanho. Um agente não tem como pedir outra coisa.
- **Nada editável pelo usuário decide autorização.** Em `criar_exame`, a organização vem da linha do paciente lida do banco e o autor vem do token verificado. Campo extra no input é rejeitado, não ignorado.
- **Erro sem vazamento lateral.** A mensagem para "paciente não existe" e para "paciente é de outra organização" é idêntica. Diferenciar as duas deixaria quem chama sondar quais identificadores existem em outros tenants.
- **O gate vem antes das ferramentas.** Sem credencial válida, a resposta é `401` antes de qualquer ferramenta rodar. A chave pública do projeto não serve como credencial de usuário.

Um requisito de configuração que é fácil de esquecer: o servidor valida o token contra chaves assimétricas e recusa o formato simétrico antigo. Num projeto Supabase novo isso já é o padrão, mas num projeto antigo precisa ser migrado antes.

## Como provar que funciona

A evidência é a parte mais importante do entregável, porque "não vi vazamento" não é prova de isolamento.

São duas baterias, 43 casos no total:

- `npm run test:rls`: 23 casos no nível do banco, cada um fazendo login real e tentando uma operação proibida;
- `npm run test:mcp`: 20 casos atravessando o servidor MCP, incluindo quatro de credencial inválida.

As duas usam um controle lido com `service_role`, que ignora a RLS e informa as contagens reais. Sem esse controle, uma lista vazia não provaria isolamento — provaria apenas ausência de dado.

Os casos que vale citar numa conversa técnica:

- a chave estrangeira composta barrando exame que cruza tenant, com erro de violação de integridade, mesmo com `service_role`;
- o médico inserindo exame no próprio paciente, mas um `delete` dele afetando zero linhas, o que mostra o eixo de papel funcionando por `USING`;
- o administrador de uma clínica não conseguindo escrever em `membros` da outra, o que mostra que papel não atravessa tenant;
- a organização injetada no input sendo rejeitada antes de qualquer escrita;
- a chave pública do projeto usada como credencial de usuário recebendo `401`;
- a consulta sem autenticar recebendo erro de permissão, o que mostra que a RLS não substitui `GRANT` e que os dois estão no lugar.

As duas baterias foram executadas tanto no Supabase local quanto contra um projeto hospedado.

## Como rodar

O caminho curto, com um projeto Supabase já criado e o `.env` preenchido:

```
npm install
npm run seed
npm run test:rls
npm run test:mcp
npm run ui
```

Três formas de ver o resultado, em ordem de quanto convencem quem assiste:

- `npm run ui` abre uma tela que mostra as duas clínicas lado a lado, com a tentativa de acesso cruzado sendo barrada e o registro ao vivo de cada chamada ao servidor;
- `npm run mcp:config` conecta o servidor ao Claude Code com dois usuários diferentes, e aí a mesma pergunta em português devolve dados diferentes;
- `npm run demo` faz a mesma comparação no terminal, em texto.

O passo a passo completo, a partir da criação da conta no Supabase, está no [README](../README.md). O raciocínio técnico detalhado de cada decisão está em [docs/ARQUITETURA.md](ARQUITETURA.md).

## Onde este desenho se aplica

O padrão vale para qualquer produto em que organizações distintas compartilham um banco e alguém — pessoa ou agente — consulta esses dados em nome de um usuário.

O que se aproveita diretamente:

- o desenho da cadeia de pertencimento e o raciocínio de cada policy;
- a decisão de colocar a separação no banco em vez do código da aplicação;
- a forma do servidor MCP, com ferramentas de domínio em vez de acesso livre;
- a estratégia de teste com controle por `service_role`.

O que **não** se aproveita: o schema em si. São quatro tabelas mínimas, escolhidas para isolar o problema, não para representar um domínio real. Num sistema de verdade o número de policies cresce com o número de tabelas, e é aí que a consistência entre elas começa a custar.

Uma consequência de governança que vale registrar: neste desenho não existe credencial fixa no servidor, nenhuma chave que ignora RLS no caminho da consulta, e a autorização é derivada do token em vez de um valor enviado pelo cliente. Isso é o oposto do padrão comum de embutir URL e chave no código da aplicação.

## Pontos de atenção para a próxima etapa

### 1. OAuth para clientes externos

Hoje o servidor atende sessão de produto, com o token do usuário vindo do backend. Para Claude, ChatGPT ou Codex consumirem o servidor diretamente, falta o fluxo de OAuth e consentimento.

Impacto: sem isso, o servidor só é utilizável por um agente embutido no próprio produto.

Melhoria sugerida: avaliar o OAuth Consent block da Supabase. Tokens de OAuth trazem identificação do cliente, e as policies vão precisar dizer o que vale em cada caso.

### 2. Cobertura de CI incompleta

A bateria do banco roda a cada alteração. A bateria do servidor MCP e a checagem de tipos da Edge Function ainda são manuais.

Impacto: uma regressão no servidor passa despercebida até alguém rodar o teste na mão.

Melhoria sugerida: é a primeira coisa a fazer na próxima etapa, e é barata.

### 3. O schema é mínimo por escolha

Quatro tabelas bastam para provar o isolamento. Um produto real tem dezenas.

Impacto: o número de policies cresce, e com ele o custo de manter a consistência entre elas.

Melhoria sugerida: ao expandir, replicar o padrão em vez de inventar por tabela — a mesma cadeia de pertencimento, os mesmos helpers, e uma garantia estrutural onde houver desnormalização.

### 4. Validação com dado real ainda não aconteceu

Tudo aqui roda com quatro pacientes fictícios em duas clínicas controladas.

Impacto: o comportamento sob volume, com índices reais e consultas concorrentes, não foi medido.

Melhoria sugerida: antes de qualquer decisão de produção, rodar a bateria contra um volume representativo e observar o plano de execução das consultas com RLS ativa.

## Resumo direto

O projeto responde a uma pergunta e responde com evidência: dá para isolar clientes num banco compartilhado de forma que o isolamento não dependa da disciplina de quem escreve código, e dá para colocar uma IA em cima disso sem ampliar a superfície de risco. A separação vive nas policies, as garantias críticas são estruturais, o servidor MCP oferece quatro operações de domínio e nada mais, e 43 casos de teste sustentam a afirmação nas duas camadas. O que falta para virar produto não é arquitetura — é OAuth para clientes externos, CI completo e validação com dado e volume reais.
