# Casa de Leilões

Casa de leilões online: um **leiloeiro** monta lotes a partir de itens buscados numa API pública; **licitantes** depositam saldo simulado, disputam cada lote com lances ao vivo e, se vencerem, recebem um comprovante compartilhável. Qualquer pessoa, sem login, pode **auditar** o histórico de lances de um lote e verificar que ele não foi adulterado.

- **Deploy:** **https://casa-de-leiloes-6fvbszivya-rj.a.run.app** (Google Cloud Run + Cloud SQL, região São Paulo)
- **Front-end:** React 18 + Vite (SPA), ícones [Lucide](https://lucide.dev), tipografia Cormorant Garamond + Inter (embutidas no build, sem chamadas externas)
- **Back-end:** Node.js 22 + Express (JavaScript, ESM)
- **Banco:** PostgreSQL 16
- **API externa:** [Cleveland Museum of Art Open Access](https://openaccess-api.clevelandart.org/) (obras de arte, CC0, sem chave)
- **Tempo real:** Server-Sent Events (SSE)


## Início rápido

```bash
docker compose up --build        # requer apenas Docker
```

Abra **http://localhost:3001** e entre com `ana@teste.com` / `senha123` (licitante) ou `leiloeiro@teste.com` / `senha123` (leiloeiro).

## Índice

1. [Contas de teste](#contas-de-teste-seed-automático)
2. [Como executar](#como-executar) · [Testes](#testes-automatizados) · [Variáveis de ambiente](#variáveis-de-ambiente)
3. [Qualidade de código e CI/CD](#qualidade-de-código-e-cicd)
4. [Deploy](#deploy)
5. [Arquitetura](#arquitetura)
6. [Decisões de projeto e regras de negócio](#decisões-de-projeto-e-regras-de-negócio)
7. [Comportamentos que podem parecer inesperados](#comportamentos-que-podem-parecer-inesperados)
8. [Principais endpoints](#principais-endpoints)
9. [Uso de IA](#uso-de-ia)

---

## Contas de teste (seed automático)

Todas com senha **`senha123`**.

| Perfil    | E-mail               | Saldo inicial |
| --------- | -------------------- | ------------- |
| Leiloeiro | `leiloeiro@teste.com`| —             |
| Licitante | `ana@teste.com`      | R$ 500.000,00 |
| Licitante | `bruno@teste.com`    | R$ 500.000,00 |

O seed cria também **um lote ao vivo com 2 lances** (Ana R$ 1.000 → Bruno R$ 1.100, termina em 30 dias) e um lote agendado. O seed roda na subida do servidor e é idempotente (não duplica contas nem lotes). A cada subida ele confere se ainda há um lote do leiloeiro demo **ao vivo, com lances e com pelo menos 1 dia pela frente**; se não houver (ex.: um deploy antigo cujo lote já encerrou), cria um novo com os mesmos 2 lances. Para desativá-lo: `AUTO_SEED=false`.

> Dica para testar com duas pessoas: abra uma janela anônima, entre como `ana` numa e como `bruno` na outra, e disputem o mesmo lote — a tela das duas atualiza sem recarregar.

---

## Como executar

### Pré-requisitos

| Ferramenta | Para quê | Versão |
| --- | --- | --- |
| **Docker** (com Compose) | Opção A (tudo em contêineres) e para o banco da Opção B | qualquer recente |
| **Node.js** | só na Opção B (e para rodar testes/lint) | **22** (testado nesta versão) |
| Internet | a busca de itens usa a API pública do museu e as imagens vêm do CDN dele | — |

Sem internet a aplicação sobe normalmente, mas a busca do leiloeiro cai no cache local e as imagens aparecem como "sem imagem".

### Opção A — Docker Compose (recomendado: um comando)

```bash
git clone https://github.com/Giovanni-Rossi/casa-de-leiloes.git && cd casa-de-leiloes
docker compose up --build
```

Na primeira vez leva alguns minutos (baixa as imagens e compila o front-end). Quando aparecer `servidor iniciado` nos logs, acesse **http://localhost:3001**.

O Compose sobe o PostgreSQL 16 e a aplicação (back-end + front-end já compilado, na mesma porta). As tabelas e os dados de teste são criados sozinhos na primeira subida.

| Quero… | Comando |
| --- | --- |
| Rodar em segundo plano | `docker compose up -d --build` |
| Ver os logs | `docker compose logs -f app` |
| Parar (mantém os dados) | `docker compose down` |
| **Apagar tudo e recomeçar** (banco zerado + seed novo) | `docker compose down -v` |
| Trocar os segredos | `JWT_SECRET=... HASH_SECRET=... docker compose up --build` |

### Opção B — Desenvolvimento local (com recarga automática)

Use quando for alterar o código. São **três terminais**: banco, back-end e front-end.

**1. Banco de dados** — um PostgreSQL na porta 5432:

```bash
docker run -d --name leilao-pg -p 5432:5432 \
  -e POSTGRES_USER=leilao -e POSTGRES_PASSWORD=leilao -e POSTGRES_DB=leilao \
  postgres:16-alpine
```

**2. Back-end** — porta 3001, recarrega ao salvar:

```bash
cd backend
npm install
npm run dev
```

Procure por `servidor iniciado` na saída. As tabelas (migração) e o seed rodam sozinhos. A conexão padrão (`postgres://leilao:leilao@localhost:5432/leilao`) já bate com o comando do passo 1; para usar outro banco, defina `DATABASE_URL`.

**3. Front-end** — porta 5173, com *proxy* de `/api` para o back-end:

```bash
cd frontend
npm install
npm run dev
```

Acesse **http://localhost:5173** (não a 3001: nesse modo a 3001 só serve a API).

> O esquema do banco está em [`backend/src/schema.sql`](backend/src/schema.sql) e é aplicado automaticamente (`CREATE ... IF NOT EXISTS`) a cada subida. Não há passo manual de migração.

**Resetar o banco de desenvolvimento** (apaga todos os dados e refaz o seed na próxima subida):

```bash
docker exec leilao-pg psql -U leilao -d leilao -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
# reinicie o back-end (Ctrl+C e npm run dev)
```

### Conferindo que está funcionando

```bash
curl http://localhost:3001/api/health          # {"ok":true}
curl "http://localhost:3001/api/lots?phase=live"   # lista com o lote ao vivo do seed
```

### Roteiro de teste manual (≈ 3 minutos)

1. Abra a aplicação: a **vitrine** mostra um lote **ao vivo** (_The Red Kerchief_), já com 2 lances.
2. Entre como **`ana@teste.com`** / `senha123` e abra o lote. Dê um lance abaixo do mínimo (veja a mensagem de recusa) e depois um válido: o status vira **"Você está ganhando"**.
3. Numa **janela anônima**, entre como **`bruno@teste.com`** e cubra o lance da Ana: na tela da Ana aparece **"Você foi superado"**, sem recarregar.
4. Em **Carteira**, veja saldo total, comprometido e disponível; faça um depósito simulado.
5. Entre como **`leiloeiro@teste.com`** → **Painel do leiloeiro**: busque um item (ex.: `vase`), crie um lote com início **agora** e fim em **poucos minutos**.
6. Dê lances nesse lote com a Ana e o Bruno. Um lance nos **últimos 2 minutos** prorroga o fim (anti-sniping).
7. Quando o lote encerrar, o vencedor vê o lote em **Meus arremates** com o **comprovante** e o link de compartilhamento; o leiloeiro vê o resultado e o total recebido.
8. Em qualquer lote, **"Auditar integridade do histórico"** abre a página pública (sem login) com a cadeia de hashes.

### Problemas comuns

| Sintoma | Causa e solução |
| --- | --- |
| `EADDRINUSE` / porta em uso | já há algo na 3001 (ou 5173/5432). Pare o outro processo (`docker compose down`, `docker rm -f leilao-pg`) ou use `PORT=3002 npm run dev` |
| `ECONNREFUSED 5432` no back-end | o PostgreSQL não está rodando: confira com `docker ps` e refaça o passo 1 |
| `password authentication failed` | o banco foi criado com outra senha: apague o contêiner/volume (`docker rm -f leilao-pg` ou `docker compose down -v`) e suba de novo |
| Tela em branco em `localhost:5173` | o back-end não está no ar (o front só faz proxy). Confira o terminal do back-end |
| Não há lote ao vivo com lances na vitrine | o lote do seed dura **30 dias** e é recriado na subida quando falta menos de 1 dia. Reinicie o servidor ou crie outro pelo painel do leiloeiro |
| Auditoria acusa adulteração em **todos** os lotes antigos | banco criado antes da assinatura da âncora: suba **uma vez** com `SIGN_LEGACY_ANCHORS=true` (veja [Histórico à prova de adulteração](#histórico-à-prova-de-adulteração-backendsrcdomainchainjs)) |
| Busca do leiloeiro mostra "API externa indisponível" | sem internet ou API do museu fora do ar: a busca usa o cache local (itens já vistos) |

### Testes automatizados

**Cobertura: 100% de linhas, branches e funções** no back-end e no front-end — e os comandos de cobertura **falham** se ela cair abaixo disso.

| Camada | Tipo | Comando | O que cobre |
| --- | --- | --- | --- |
| Back-end | **Unitários** (sem banco) | `cd backend && npm run test:unit` | regras puras (fases, lance mínimo, anti-sniping, filtros, validações), cadeia de hashes/pseudônimos, middlewares, SSE, job, config |
| Back-end | **Integração** (PostgreSQL real) | `cd backend && npm test` | lances, saldo comprometido, concorrência, liquidação, cancelamento, auditoria/adulteração, catálogo (API ok/fora do ar), auth, **API HTTP de ponta a ponta**, seed e subida do servidor |
| Back-end | Cobertura (gate 100%) | `cd backend && npm run test:coverage` | tudo acima + relatório |
| Front-end | Componentes (Vitest + Testing Library) | `cd frontend && npm run test:coverage` | todas as páginas, hooks, fluxo de lance e mensagens de recusa, painel, carteira, tema, rotas protegidas |

Os testes de integração usam um banco **separado** (`leilao_test`), porque **apagam as tabelas** a cada teste:

```bash
docker exec leilao-pg psql -U leilao -c "CREATE DATABASE leilao_test"   # uma vez
cd backend && npm run test:coverage
```

Outro banco: `TEST_DATABASE_URL=postgres://... npm test`.

Os testes de adulteração desativam o trigger do banco de propósito e confirmam que a cadeia de hashes detecta edição, remoção (meio e último lance) e inserção forjada.

**Fora da cobertura (de propósito):** `backend/src/index.js` e `seed-cli.js` (só chamam `start()`/`seed()`, que são testados) e `frontend/src/main.jsx` (apenas monta o `<App/>`). Um teste-guarda (`coverage-guard.test.js`) importa todo o resto de `src/` para que nenhum arquivo fique “invisível” ao relatório. Cobertura de linhas/branches mede *execução*, não qualidade das asserções — por isso os testes verificam comportamento (códigos de erro, saldos, hashes), e não só passam pelo código.

### Variáveis de ambiente

| Variável       | Padrão (dev)                                         | Descrição |
| -------------- | ---------------------------------------------------- | --------- |
| `DATABASE_URL` | `postgres://leilao:leilao@localhost:5432/leilao`     | Conexão PostgreSQL |
| `PORT`         | `3001`                                               | Porta HTTP |
| `JWT_SECRET`   | valor de dev                                         | Assina os tokens de login. **Obrigatório em produção** |
| `HASH_SECRET`  | valor de dev                                         | Chave do HMAC da cadeia de lances. **Obrigatório em produção** |
| `AUTO_SEED`    | `true`                                               | `false` desativa os dados de teste |
| `SIGN_LEGACY_ANCHORS` | `false`                                       | `true` assina, na subida, a âncora dos lotes criados antes dela existir. **Use uma única vez** ao atualizar um banco antigo e depois remova |
| `LOG_LEVEL`    | `info` (`silent` nos testes)                         | `trace`, `debug`, `info`, `warn`, `error`, `fatal` ou `silent` |
| `LOG_PRETTY`   | `true` fora de produção                              | `false` força JSON mesmo em desenvolvimento |

Em `NODE_ENV=production` o servidor **recusa subir** sem `JWT_SECRET` e `HASH_SECRET`.

---

## Qualidade de código e CI/CD

**Local** (na raiz do projeto):

```bash
npm run install:all   # instala back-end e front-end
npm run check         # o MESMO que o CI roda: lint + formatação + testes com cobertura 100% + build
npm run format        # formata tudo (Prettier)
npm run lint          # ESLint
```

- **ESLint** (`eslint.config.js` em cada pacote): regras recomendadas + `eqeqeq`, `no-var`, `prefer-const`, variáveis sem uso; no front, `react` e as regras clássicas de hooks (`rules-of-hooks`, `exhaustive-deps`).
- **Prettier** (`.prettierrc.json`, 100 colunas) e **EditorConfig**: o código é formatado automaticamente; não há discussão de estilo.
- **Pré-commit** (Husky): `lint` + `format:check` antes de cada commit. Ativado sozinho pelo `npm install` da raiz quando houver um repositório git. Os testes ficam para o CI para o commit ser rápido.

**GitHub Actions** (`.github/workflows/`):

| Workflow | Quando | O que faz |
| --- | --- | --- |
| `ci.yml` | push na `main` e todo pull request | **back-end** (PostgreSQL 16 como serviço: lint, formato, testes e gate de cobertura 100%), **front-end** (lint, formato, testes, cobertura 100%, build) e **Docker** (sobe o Compose e testa `/api/health`, o front-end e a vitrine) |
| `deploy.yml` | CI verde na `main` (ou manual) | publica no **Cloud Run**. Fica **inativo** enquanto a variável `GCP_PROJECT_ID` não existir, então forks e repositórios sem GCP não falham |
| `dependabot.yml` | semanal | PRs de atualização de dependências (npm e Actions) |

**Ativando o deploy automático** (depois do primeiro `./deploy/gcp-deploy.sh`):

```bash
./deploy/gcp-github-setup.sh SEU_PROJECT_ID OWNER/REPO
```

O script autoriza o GitHub a publicar via **OIDC/Workload Identity** (sem chave de serviço guardada no GitHub; a confiança é restrita ao seu repositório) e imprime as 4 variáveis para cadastrar em *Settings → Secrets and variables → Actions → Variables*. Depois disso, todo merge na `main` com CI verde vira deploy.

---

## Deploy

O `Dockerfile` da raiz gera uma imagem única (front compilado + back-end), então basta **um serviço web + um PostgreSQL**.

### Google Cloud (Cloud Run + Cloud SQL) — usado na entrega

Pré-requisitos: [`gcloud`](https://cloud.google.com/sdk/docs/install) instalado, um projeto com faturamento ativo (os créditos gratuitos servem) e `gcloud auth login` feito.

```bash
./deploy/gcp-deploy.sh SEU_PROJECT_ID            # região padrão: southamerica-east1 (São Paulo)
```

O script cria o Cloud SQL (PostgreSQL 16), guarda `DATABASE_URL`, `JWT_SECRET` e `HASH_SECRET` no Secret Manager, faz o build e publica no Cloud Run, e imprime a URL pública. É seguro rodar de novo para atualizar o app. Para apagar tudo e parar de gastar: `./deploy/gcp-destroy.sh SEU_PROJECT_ID`.

Escolhas de configuração que importam (e por quê):

| Flag | Motivo |
| --- | --- |
| `--no-cpu-throttling` + `--min-instances=1` | o job que **liquida os leilões** roda em segundo plano; por padrão o Cloud Run só dá CPU durante requisições e os lotes não fechariam no horário |
| `--max-instances=1` | o barramento de eventos em tempo real (SSE) é em memória |
| `--timeout=3600` | conexões SSE longas (o navegador reconecta sozinho) |
| conexão via socket `/cloudsql/...` | o Cloud Run acessa o Cloud SQL sem expor o banco à internet |

> **Atenção:** não troque o `HASH_SECRET` depois de haver lances gravados: isso faria a auditoria marcar os históricos antigos como adulterados.
> **Custo:** instância sempre ligada + Cloud SQL consomem créditos continuamente (da ordem de dezenas de dólares por mês — confira na [calculadora de preços](https://cloud.google.com/products/calculator)). Rode o `gcp-destroy.sh` quando a avaliação terminar.

### Outras plataformas

Qualquer plataforma que rode Docker + Postgres serve: defina `DATABASE_URL`, `JWT_SECRET` e `HASH_SECRET`, e mantenha **uma única instância** do back-end.

---

## Arquitetura

Camadas com dependência em **uma direção** (HTTP → serviços → repositórios → banco; o domínio é puro e fica de lado), para que a regra de negócio seja testável sem rede nem banco:

```
backend/src/
  domain/        # funções PURAS (sem I/O): fases do lote, lance mínimo, anti-sniping,
                 #   filtros, validações, cadeia de hashes e pseudônimos, normalização do catálogo
  repositories/  # ÚNICO lugar com SQL: users, lots, bids, transactions, receipts, catalogItems
  services/      # casos de uso e transações: bidding, settlement, lots, wallet, audit,
                 #   catalog, auth, broadcast (eventos SSE) — regra de negócio, sem SQL
  http/          # Express: app.js (composição), middleware.js, routes/ (auth, lots, wallet, audit)
  jobs/          # settlementJob: liquida lotes vencidos, sem sobreposição
  events.js      # barramento SSE em memória
  db.js          # pool, transação (tx), executor padrão (db) e migração
  schema.sql     # tabelas + trigger append-only
  server.js      # start(): migra, semeia, sobe HTTP e job   (index.js só chama start())
  seed.js        # dados de teste
backend/test/
  unit/          # sem banco (inclui testes que protegem a arquitetura)
  integration/   # com PostgreSQL
frontend/src/
  pages/         # Vitrine, Sala ao vivo, Carteira, Meus arremates, Painel, Auditoria, Comprovante
  api.js, auth.jsx, util.js, components.jsx, App.jsx
frontend/test/   # Vitest + Testing Library
Dockerfile, docker-compose.yml
```

**Repositórios e transações:** cada função de repositório recebe o executor como primeiro argumento — `db` (fora de transação) ou o `client` entregue por `tx(...)`. Assim a transação é sempre explícita no serviço (que decide *o que* trava e em que ordem), e o repositório só sabe *como* consultar. Não há ORM: o SQL é escrito à mão para manter visíveis os `SELECT … FOR UPDATE`, o saldo comprometido derivado e o trigger append-only. Um teste (`architecture.test.js`) falha se aparecer SQL fora de `repositories/`, se o domínio importar banco/serviços, ou se a camada HTTP acessar repositórios sem passar pelos serviços.

---

## Decisões de projeto e regras de negócio

### Valores monetários
Tudo é armazenado e calculado em **centavos inteiros** (`BIGINT`), nunca em ponto flutuante.

### Regras de lance (`backend/src/services/bidding.js → placeBid`)
Cada lance roda numa **transação** que trava a linha do licitante e depois a do lote (`SELECT … FOR UPDATE`), o que serializa lances concorrentes. Recusas, com o motivo mostrado ao usuário:

| Motivo | Código |
| --- | --- |
| Lote cancelado / encerrado / ainda não iniciado | `lot_cancelled` / `lot_ended` / `lot_not_started` |
| Você já é o líder (não pode cobrir o próprio lance) | `already_leading` |
| Abaixo do mínimo: 1º lance ≥ lance inicial; demais ≥ atual + incremento | `below_minimum` |
| Valor maior que o saldo disponível | `insufficient_funds` |
| Leiloeiro tentando dar lance | 403 |

### Saldo comprometido
`disponível = total − comprometido`, onde **comprometido = soma dos lances atuais dos lotes não liquidados em que o usuário lidera**. É um valor **derivado** (não é uma coluna que precisa ser mantida em sincronia): quando alguém é superado, o valor volta ao disponível na hora; e quando um lote é cancelado, o estorno acontece automaticamente. Como o líder não pode rebater o próprio lance, não há risco de contar duas vezes o mesmo lote.

### Anti-sniping
Lance aceito quando faltam **≤ 2 minutos** → o fim do lote passa a ser **agora + 2 minutos**. *(Interpretação: “estende o fim para +2 minutos” = sempre restam 2 minutos após o lance.)* Lances fora dessa janela não alteram o prazo. A tela mostra o aviso “prorrogado”.

### Liquidação
Um agendador no próprio processo (a cada 1 s) fecha os lotes vencidos. Numa única transação: debita o vencedor, credita o leiloeiro, registra as movimentações e emite o comprovante. É **idempotente** e segura contra concorrência (trava usuários e lote, e reconfere o estado). Lotes sem lances fecham **sem vencedor** e sem comprovante. Lotes cuja data de término já passou mas ainda não foram liquidados aparecem como “Encerrando…” e já recusam lances.

### Cancelamento
O leiloeiro cancela lotes agendados ou ao vivo. **Comportamento além do mínimo pedido:** o enunciado base fala em cancelar “lote que ainda não recebeu lances”; implementei também o opcional de **cancelamento com estorno**, então é possível cancelar um lote *com* lances (a UI pede confirmação) e o saldo do líder é liberado automaticamente. Lotes cancelados somem da vitrine e da auditoria pública. Lotes já encerrados não podem ser cancelados.

### Histórico à prova de adulteração (`backend/src/domain/chain.js`)
Técnica: **cadeia de hashes com HMAC-SHA256** (estilo blockchain, mas centralizada) + âncora no lote + trigger no banco.

1. Cada lance guarda `hash = HMAC(segredo, lote | seq | licitante | valor | timestamp | hash_do_lance_anterior)`. O primeiro lance parte de um hash “gênese” fixo.
2. A linha do lote guarda a **âncora**: `head_hash` (hash do último lance), `bid_count`, `current_bid_cents` e `leader_id`, atualizados **na mesma transação** do lance.
3. A âncora é **assinada**: `anchor_mac = HMAC(segredo, lote | bid_count | head_hash)`, gravado junto (inclusive na criação do lote, com 0 lances). Sem isso, quem tem acesso ao banco poderia apagar os últimos lances e "rebobinar" a linha do lote para o lance anterior — usando só dados que já estão no banco — e a cadeia restante pareceria íntegra.
4. A auditoria recalcula toda a cadeia, compara com a âncora e confere a assinatura. Detecta:
   - **edição** de qualquer campo de um lance → o hash não bate;
   - **remoção no meio** → buraco na sequência e elo anterior quebrado;
   - **remoção do último lance** → contagem, `head_hash` e lance atual divergem da âncora; e se a linha do lote também for "rebobinada", a **assinatura da âncora** não confere;
   - **inserção posterior** → sequência/contagem divergem; e como o hash exige o **segredo (`HASH_SECRET`), que não está no banco**, quem só tem acesso ao banco não consegue fabricar um hash válido.
5. Defesa extra: um **trigger** bloqueia `UPDATE`/`DELETE` em `bids`. Ele não é a garantia (um superusuário pode desativá-lo); a garantia é a cadeia — os testes automatizados desativam o trigger de propósito e confirmam que a adulteração é detectada.

**Limites conhecidos:**
- quem tiver acesso ao banco **e** ao `HASH_SECRET` poderia refazer a cadeia inteira;
- quem guardar uma cópia antiga da linha do lote (ex.: um backup) poderia restaurá-la junto com o truncamento, porque a assinatura antiga continua válida.

Para fechar os dois, seria preciso ancorar o `head_hash` em um sistema externo (log imutável, carimbo de tempo de terceiros).

**Bancos criados antes da assinatura da âncora:** os lotes antigos ficam sem `anchor_mac` e a auditoria os acusa. Suba **uma vez** com `SIGN_LEGACY_ANCHORS=true`: o servidor assina só os lotes cuja cadeia está íntegra (os inconsistentes continuam acusados e aparecem no log). Isso confia no estado atual do banco — por isso não é automático: se fosse, bastaria apagar a assinatura de um lote adulterado para ela ser refeita. No Cloud Run: `gcloud run services update casa-de-leiloes --region southamerica-east1 --update-env-vars SIGN_LEGACY_ANCHORS=true` e, depois da subida, `--remove-env-vars SIGN_LEGACY_ANCHORS`.

O comprovante também revalida o histórico ao ser aberto e informa se o lote ainda aponta para o hash emitido.

### Segurança
- **SQL injection:** todo SQL fica em `repositories/` e usa **consultas parametrizadas** (`$1`, `$2`…); dado do usuário nunca entra no texto da query. Os curingas `%`, `_` e `\` da busca no cache são escapados (tratados como texto literal). Um teste (`architecture.test.js`) falha se aparecer interpolação ou concatenação em SQL.
- **XSS armazenado:** `imageUrl` e `sourceUrl` de um lote só são aceitas se forem `http(s)` (rejeita `javascript:` e `data:`); o React escapa o restante do texto.
- **Senhas:** `bcrypt` (custo 10). **Sessão:** JWT de 7 dias, assinado com `JWT_SECRET`, enviado em `Authorization: Bearer`.
- **Autorização** no servidor, por papel (leiloeiro × licitante) e por dono do lote; a UI apenas esconde o que o servidor já recusa.
- **Não implementado (fora do escopo pedido):** limite de tentativas de login (*rate limiting*), CORS restrito a uma origem e cabeçalhos de segurança (ex.: `helmet`). Em produção valeria adicioná-los.

### Logs
Logger estruturado com **[Pino](https://getpino.io)** (`backend/src/logger.js`); não há `console.*` no código (um teste garante).

- **Formato:** em produção, **uma linha JSON por evento** em stdout, com `severity`, `message`, `time` (ISO 8601) e campos de contexto (`lotId`, `userId`, `req.id`…). O Cloud Logging do GCP indexa esses campos sem agente nem configuração: no console do GCP, filtre por `jsonPayload.lotId=12` ou `severity>=WARNING`. Em desenvolvimento a saída é legível e colorida (`pino-pretty`).
- **Requisições** (`pino-http`): cada chamada à API gera um log com método, URL, status e tempo, em nível `info` (2xx/3xx), `warn` (4xx) ou `error` (5xx). Cada requisição tem um **ID de correlação** (`x-request-id`, reaproveitado do cliente/proxy ou gerado) devolvido no cabeçalho da resposta, para ligar uma reclamação do usuário à linha do log. O health check e os arquivos estáticos não são logados.
- **Eventos de negócio:** lance aceito, lote criado/cancelado/liquidado, usuário cadastrado, login recusado e falhas da liquidação ou da API externa.
- **Dados sensíveis:** `Authorization`, cookies e campos `password*` são redigidos; e-mails e senhas não são registrados.
- **Por que stdout e não uma tabela no banco:** gravar logs no mesmo PostgreSQL da aplicação faz o log competir com os lances por conexões e I/O, e se o banco cair o log cai junto, justamente quando ele mais importa. O padrão é emitir em stdout e deixar a plataforma (Cloud Logging) guardar, pesquisar e alertar. O que precisa ser **dado do negócio** (histórico de lances) já fica no banco, na cadeia de hashes.

### Privacidade
Auditoria, histórico e comprovante **nunca expõem nome, e-mail ou ID** de ninguém: os participantes aparecem como `Licitante A1B2C3` / `Leiloeiro D4E5F6`, um pseudônimo derivado por HMAC e **diferente em cada lote** (não dá para correlacionar a mesma pessoa entre lotes). Só o próprio usuário recebe a marcação “(você)” no histórico.

### API externa fora do ar
- Ao criar um lote, **todos os dados do item são copiados** (título, imagem, atributos, descrição) para o banco. Vitrine, sala, auditoria e comprovante **não dependem da API** em tempo de execução.
- Itens vistos em buscas ficam num **cache local** (`catalog_items`). Se a API falhar ou estourar o tempo (6 s), a busca do leiloeiro cai no cache e a tela avisa. O seed também deixa um item em cache.
- **Limitação:** a *imagem* continua sendo carregada da URL do museu (não é copiada). Se o CDN deles cair, o lote continua funcionando e a tela mostra um placeholder “sem imagem”.

### Tempo real
Cada lote tem um canal SSE (`/api/lots/:id/stream`) e a vitrine tem um canal global. O cliente, ao receber um evento, rebusca o estado (assim `myStatus`, saldo e posição vêm sempre calculados no servidor para o usuário certo). Há ainda *polling* de segurança a cada 5–15 s caso a conexão caia. A contagem regressiva usa o relógio do **servidor** (offset calculado a cada resposta), então não depende do relógio do navegador.

> O barramento de eventos é em memória: funciona com **uma instância** do back-end (suficiente aqui). Com várias instâncias seria preciso trocar por Redis pub/sub / `LISTEN/NOTIFY`. O mesmo vale para o agendador de liquidação — porém ele já é seguro contra execução concorrente.

### Funcionalidades opcionais entregues
- Busca e filtro de lotes (texto e faixa de preço, por situação)
- Cancelamento de lote com estorno automático
- Docker Compose
- Testes automatizados
- Dark mode (segue o sistema; alternável no cabeçalho)

---

## Comportamentos que podem parecer inesperados

- **Datas dos lotes** usam o fuso do navegador na criação; o servidor guarda tudo em UTC.
- **Saldo “comprometido”** inclui lotes que já passaram do horário mas ainda não foram liquidados (até 1–2 s).
- O leiloeiro também tem carteira (recebe os créditos das vendas), mas a UI mostra só o “Total recebido”; a tela de carteira com depósito é do licitante, e a API recusa depósito de leiloeiro (403).
- Não há recuperação de senha, nota fiscal nem revenda (fora do escopo pedido).
- Os dados de busca vêm do acervo de um museu, então os termos funcionam melhor em **inglês** (`monet`, `vase`, `samurai`, `egypt`…).

---

## Principais endpoints

| Método | Rota | Acesso |
| --- | --- | --- |
| `POST` | `/api/auth/register`, `/api/auth/login` | público |
| `GET` | `/api/lots?phase=live\|scheduled\|ended&q=&minCents=&maxCents=` | público |
| `GET` | `/api/lots/:id`, `/api/lots/:id/bids`, `/api/lots/:id/stream` (SSE) | público |
| `POST` | `/api/lots/:id/bids` | licitante |
| `GET` | `/api/wallet` | logado |
| `POST` | `/api/wallet/deposit` | licitante |
| `GET` | `/api/my/bids` | licitante |
| `GET` | `/api/catalog/search?q=` | leiloeiro |
| `POST` | `/api/lots`, `/api/lots/:id/cancel`; `GET /api/seller/lots` | leiloeiro |
| `GET` | `/api/audit/:id`, `/api/receipts/:token` | **público** |

---

## Uso de IA

Usei o **Claude Code** (IA da Anthropic) durante o desenvolvimento. A divisão foi simples: as decisões e as lógicas de negócio ficaram comigo, e a IA escreveu boa parte do código mais braçal em volta delas.

### O que foi meu

- A estrutura do projeto em camadas (`domain`, `repositories`, `services`, `http`), com o SQL só nos repositórios e sem ORM, para a regra de negócio poder ser testada sem banco.
- As lógicas de validação e de decisão: quando um lance é aceito ou recusado, o que compromete saldo, quando um lote pode ser cancelado.
- O saldo comprometido calculado na hora (soma dos lotes em que o licitante lidera), e não guardado numa coluna. Assim ele nunca fica dessincronizado, e o estorno no cancelamento sai de graça.
- A auditoria com cadeia de hashes HMAC e o segredo fora do banco: quem só tem acesso ao banco não consegue refazer os hashes depois de adulterar.
- SSE para o tempo real, com polling de segurança caso a conexão caia.
- A troca da API do Art Institute of Chicago (minha primeira escolha, mas ela bloqueia chamadas automatizadas) pela do Cleveland Museum of Art.
- O deploy no Google Cloud (Cloud Run + Cloud SQL).
- Todos os commits: fiz eu mesmo, em pacotes pequenos e lógicos, revisando arquivo por arquivo antes de entrar no histórico.

### O que a IA fez

Rotas, repositórios, telas do front, os testes automatizados e boa parte deste README. Revisei tudo antes de commitar.

### Erros da IA que os testes pegaram

- O `SUM()` de `BIGINT` volta como texto no driver `pg`, o que quebrava o cálculo do saldo comprometido. Corrigido com um cast explícito.
- O `wrap` não pegava exceções síncronas, uma conexão cortada do `pg` derrubava o processo (faltava o listener de erro), JSON inválido no corpo devolvia 500 e o front inteiro quebrava com o `localStorage` bloqueado. Todos corrigidos.
- Um `JOIN` no comprovante tinha colisão de colunas (`head_hash` nas duas tabelas). Reescrito.

### Validação final

Antes de enviar, pedi para a IA validar cada requisito do desafio contra a aplicação rodando: Docker Compose, roteiro de ponta a ponta pela API e adulteração direta no banco. Ela encontrou os problemas abaixo e implementou as correções com testes; revisei tudo antes de publicar.

- Um `GET /api/lots/<id inválido>/stream` derrubava o servidor, porque o handler SSE assíncrono não passava pelo `wrap`. Agora o canal é resolvido antes de abrir o stream, e o Compose ganhou `restart: unless-stopped`.
- Dava para apagar o último lance e "rebobinar" a linha do lote sem a auditoria perceber. Agora a âncora do lote também é assinada com HMAC (`anchor_mac`).
- O lote demo do seed durava 6 h e nunca era recriado num banco persistente. Agora dura 30 dias e é recriado na subida.
- O leiloeiro conseguia depositar pela API, o depósito não rodava numa transação e a mensagem de lance mínimo vinha em centavos. Corrigidos.

Na conferência do deploy, a vitrine estava sem nenhum lote ao vivo, justamente por causa do problema do seed. Republiquei com a correção.

Os testes de integração rodam num banco separado (`leilao_test`) para não apagar os dados de desenvolvimento.
