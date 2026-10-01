---
spec: "Overclick — board de cards para vibe coders (com integrações Zero e Overrunner)"
slug: "spec-12-overclick"
modulo_fonte: ["12-overclick", "13-zero-e-overrunner"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-02-orquestracao-modo-agentico", "spec-03-harness-roteamento-decisor", "spec-04-providers-e-modelos", "spec-05-catalogo-skills-mcp-hooks"]
---
# Spec 12 — Overclick (board de cards) + integrações Zero e Overrunner

Convenção de selos: [OBS] observado (módulo, dia); [DEC] decisão do autor da spec; [LAC] lacuna (vai para a seção 13). Módulos citados como m12 = 12-overclick e m13 = 13-zero-e-overrunner. "Dn" = dia n das lives.

## 1. Resumo e objetivo

Overclick é um board de cards (kanban) open source e self-hosted, com MCP nativo, para vibe coders e times híbridos humano+agente [OBS m12, D62-D63]. Componentes: interface web, banco e um servidor MCP remoto ("interface, banco e um MCP") [OBS m12, D62]. O card é um "contrato": diz o quê, o porquê e o "como confirmo" (definição de pronto); um modelo forte escreve o contrato e modelos baratos executam [OBS m12, D62]. O board recomenda uma Policy de harness por tipo de card, registra custo por card/missão e é o destino dos tickets de bug criados pelo bot Zero. Objetivo estratégico: funil para o Overclock (ADE) e cloud.overclock.sh; o board não é vendido, o motor de execução é [OBS m12, D62/D65].

Problema resolvido: vibe coders executam rápido mas não têm lista de atividades e perdem tarefas; agentes precisam de um lugar para "pegar o próximo card", entregar com custo e evidência, e o humano de um lugar para validar [OBS m12, D62-D63]. Para a comunidade: relatos de bug soltos e incompletos no Discord viram cards investigados que o executor resolve sem nova conversa [OBS m13, D64].

## 2. Escopo e não-escopo

Cobre (núcleo, fase 1 = "construído"): workspace/projetos/missões/cards; colunas e claim; Policy de harness e recomendação; custo/telemetria por card; servidor MCP e tokens; wizard de instalação; plugin (skill + MCP + hooks); contexto por projeto; campos para o Zero (`task_search`, `resolved_in`, comentário tipado); entitlement cloud; contrato de integração do Zero e do Overrunner.

Fase 2 / não provado no original [OBS m13 status parcial]:
- Overrunner (bug vira PR numa VPS): nunca mostrado ponta a ponta, "em criação" [OBS m13, D65].
- Cadência de follow-up do Zero: especificada e cardada (card 021 "pronto"), sem confirmação de produção [OBS m13, D65].
- Integração real com Git no board ("MVP por convenção; integração real na fase 2") [OBS m12, D62].
- Webhooks do board, triggers entre colunas ("arrastar para Desenvolvimento dispara desenvolver+review+teste") — pedidos/propostos, não construídos [OBS m12 D62; m13 D65].
- Gestão de equipe multiusuário (0.4.0, D82) e pairing code de 6 dígitos (relatado como não funcionando, D64) [OBS m12].
- "Volta" do Zero (avisar o usuário que o bug foi corrigido) [OBS m13, D65: "ainda só de ida"].

Não cobre: o Zero como gatekeeper de onboarding do Discord/Active Campaign (dia 7; produto anterior, ver módulo lógico 16-comunidade-founders-overlabs (fora do escopo das specs) se existir) [DEC: fora do domínio do board]; o motor de execução ([[spec-02-orquestracao-modo-agentico]]); o benchmark ([[spec-14-bench]]); cobrança ([[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements)); Overclock Bot ([[spec-10-overclock-bot]]).

## 3. Glossário e atores

- Workspace: unidade de tenancy do Overclick; o token MCP pertence a um Workspace ("workspace ID vem do token") [OBS m12]. Nota: é o Workspace do Overclick, distinto do Workspace de painéis do Overclock ([[spec-01-terminais-paineis-workspaces]]) [DEC: mesmo nome canônico, mas entidade separada; o vínculo é por `overclick_project_id` no Workspace do ADE].
- Project: repositório/produto; tem `key` (prefixo do ticket, ex.: OVK), contexto Markdown e Policy [OBS m12].
- Mission: agrupador de cards por período/objetivo; pode envolver mais de um Project [OBS m12, D63-D64].
- Card: unidade de trabalho. Sinônimo canônico de Task ("task" nas tools MCP) [DEC: nome de tabela `Card`, nome de tool `task_*` por ser o observado].
- Ticket: Card com `type=bug` e chave `KEY-nnn` (ex.: OVK-205) [OBS m12].
- Policy: tabela tipo de atividade → fila de (Provider, modelo, esforço) [OBS m12; ver [[spec-03-harness-roteamento-decisor]]].
- Decision: resultado de `harness_recommend` gravado no card [DEC].
- Atores: admin (cria conta/workspace, gerencia tokens); member (humano que cria/valida); creator/executor/reviewer (três papéis no card) [OBS m12 D62]; agente executor (Pane/Session do Overclock ou CLI externa); Zero (bot Discord, cliente MCP com worker token); Overrunner (runner headless, fase 2); Overclock (ADE) instalando hooks.

## 4. Requisitos funcionais

### RF-12.1 Estrutura e board
- RF-12.1.01 DEVE existir hierarquia Workspace → Project → Mission → Card, com Card pertencendo a exatamente 1 Project e 0..1 Mission [OBS m12 "workspace → projetos → missões → cards"]. Aceite: criar card sem project retorna erro de validação.
- RF-12.1.02 DEVE existir board kanban com colunas de estado e lista de atividades responsiva; mobile com "máximo de informação por linha, nenhuma informação com duas linhas" [OBS m12 D62-D63]. Aceite: em 375 px cada linha da lista tem 1 linha visual.
- RF-12.1.03 DEVE haver filtros por missão, projeto (seleção múltipla) e tipo (bug, feature...) [OBS m12 D63]. Aceite: filtro multi-projeto retorna união.
- RF-12.1.04 DEVE haver barra de progresso de missão: verde = concluído, azul = validado [OBS m12 D68]. Aceite: missão com 4 cards (2 done, 1 validated, 1 todo) mostra 50% verde e 25% azul [DEC: proporção sobre total não descartado].
- RF-12.1.05 DEVERIA haver subtasks (`parent_id`), pois o original nasceu "modo solo, sem subtask" e o dono exigiu implementar (D63) [OBS m12].
- RF-12.1.06 PODE haver ordenação/dependência entre cards (`depends_on`) para o orquestrador disparar dependentes após handoffs [OBS m12 D64 instrução "as dependentes eu disparo conforme os handoffs"] [DEC: modelar como `depends_on`].
- RF-12.1.07 Tickets: DEVE gerar chave `KEY-nnn` sequencial por Project, imutável, nunca reutilizada mesmo após descarte [OBS m12 OVK-xxx; sequência/imutabilidade DEC].

### RF-12.2 Card como contrato
- RF-12.2.01 DEVE exigir `what`, `why` e `how_to_confirm` para sair de `backlog` para `todo` [OBS m12 D62 "quê, porquê, como confirmo"; obrigatoriedade DEC]. Aceite: mover card sem `how_to_confirm` para todo retorna `contract_incomplete`.
- RF-12.2.02 DEVE registrar três papéis: `created_by`, `executor` (planejado e real) e `return_to` (quem revisa/recebe o feedback) [OBS m12 D62].
- RF-12.2.03 DEVE registrar `origin`: `solo` ou `team` (team pode gerar subtasks) [OBS m12].
- RF-12.2.04 DEVE ser possível executar "por ponteiro": o executor recebe só "execute o card X" e as instruções vêm do card; entrega via `handoff_submit` [OBS m12 D64-D65].
- RF-12.2.05 DEVE persistir `harness_at_creation` (Policy sugerida) e `harness_used` [OBS m12 "Harness na criação"].

### RF-12.3 Claim, estados e entrega
- RF-12.3.01 DEVE exigir `task_claim` antes de execução; segundo claim no mesmo card falha com `already_claimed` [OBS m12 "máquina de estados do claim"; erro DEC].
- RF-12.3.02 DEVERIA emitir aviso de colisão (gate de colisão) quando dois cards em execução declaram os mesmos `files_hint` ou a mesma branch [OBS m12 D65 "ideia de gate de colisão"] [DEC: aviso, não bloqueio].
- RF-12.3.03 DEVE registrar `branch` no card via `branch_register`; o board NÃO fala com o Git [OBS m12 D62].
- RF-12.3.04 `handoff_submit` DEVE mover o card para `review`, gravar sumário, evidência, custo e opcional `resolved_in` [OBS m12/m13 D64].
- RF-12.3.05 Humano DEVE poder mover `review → done → validated` ou devolver a `todo` com comentário [OBS m12 "Feito/Validado"; transições DEC].
- RF-12.3.06 Card descartado DEVE permanecer com estado `discarded` e preservar custo [OBS m12 bugs de custo].

### RF-12.4 Policy de harness e recomendação
- RF-12.4.01 DEVE existir Policy por Project (com default do Workspace) mapeando tipo de atividade (feature, adjust, contract, refactor, bug, deep_bug, ship...) → lista ordenada de executores [OBS m12 "Política de Harness", D67 "por projeto"].
- RF-12.4.02 No wizard o usuário DEVE declarar CLIs/executores e modelos que possui; a recomendação só considera os declarados/detectados [OBS m12 D62].
- RF-12.4.03 O formulário de card DEVE sugerir o harness (ex.: "Sonnet 5 medium") aceitável ou trocável [OBS m12].
- RF-12.4.04 Executor desativado/indisponível DEVE ser rejeitado (não só avisado) com fallback definido na Policy [OBS m12 D65, fallback Opus 5] [DEC: fallback = próximo da fila; se vazia, erro `no_executor`].
- RF-12.4.05 Providers desativados no Overclock NÃO DEVEM aparecer na resposta do MCP [OBS m12] (contrato com [[spec-04-providers-e-modelos]]).
- RF-12.4.06 DEVERIA suportar níveis de harness 1-4 (4 = por atividade, com contas) [OBS m12 D67] — semântica dos níveis 1-3 [LAC]; default [DEC]: 1 = um executor fixo; 2 = por Provider; 3 = por tipo de atividade; 4 = por tipo + Account.

### RF-12.5 Custo e telemetria
- RF-12.5.01 DEVE guardar por card: tokens (in/out estimados), tempo, custo, executor planejado vs real [OBS m12].
- RF-12.5.02 DEVE somar custo por missão e mostrá-lo (canto superior direito do board/missão) [OBS m12].
- RF-12.5.03 Tela Insights: gasto por modelo, por projeto, maiores cards [OBS m12] (fase 1.5).
- RF-12.5.04 Modelo sem preço cadastrado DEVE gerar custo `null` + alerta, nunca 0 silencioso [OBS m12 bug telemetria zerada Kimi/Codex Spark; regra DEC].
- RF-12.5.05 Dois cards no mesmo terminal NÃO DEVEM somar o custo de orquestração em ambos: atribuir custo por janela [claim, handoff] da Session [OBS m12 bug; regra DEC].
- RF-12.5.06 Zero coleta de telemetria de uso para o autor do produto [OBS m12].

### RF-12.6 MCP, tokens, conexão
- RF-12.6.01 DEVE expor servidor MCP remoto (URL + token) com o conjunto da seção 6c; listagem leve separada de leitura completa [OBS m12 D65].
- RF-12.6.02 Wizard de 3 passos: (1) projeto + repo URL opcional; (2) executores/modelos; (3) gera token e mostra "copy command" + indicador "aguardando primeira conexão" [OBS m12 D62].
- RF-12.6.03 Board novo DEVE nascer com card exemplo "valide seu setup" [OBS m12].
- RF-12.6.04 Cadastro admin sem verificação de e-mail no self-hosted [OBS m12].
- RF-12.6.05 DEVE haver tokens com escopo: `admin`, `agent` e `worker` (privilégio mínimo, usado pelo Zero) [OBS m13 "worker token" e "privilégio mínimo"; nomes de escopo DEC]. Token vazado DEVE ser revogável e a revogação DEVE valer em <= 5 s [OBS m13 tokens vazados revogados; 5 s DEC].
- RF-12.6.06 Pairing code de 6 dígitos PODE existir como alternativa (fase 2) [OBS m12 D64 "não funcionou"; LAC].
- RF-12.6.07 Após instalar o MCP a CLI precisa recarregar tools (`/rename`+`/resume` ou reabrir); o wizard DEVE exibir esta instrução [OBS m12].

### RF-12.7 Contexto do projeto e campos para o Zero
- RF-12.7.01 Project DEVE ter `context_md` (o que é, arquitetura/estrutura, como roda, versão), retornado por `project_get` e usável como system prompt de clientes [OBS m12/m13 D64].
- RF-12.7.02 Alimentar `context_md` a partir dos releases do GitHub (não CHANGELOG.md) PODE ser feito [OBS m12 D64 "ideia"; fase 2].
- RF-12.7.03 DEVE existir `task_search` (busca textual em título; e DEVERIA cobrir descrição) [OBS m13 "busca textual em títulos"].
- RF-12.7.04 `handoff_submit` DEVE aceitar `resolved_in` (string versão/tag) opcional [OBS m13].
- RF-12.7.05 DEVE existir comentário tipado (`comment_add` com `kind`) [OBS m13; enum de kinds DEC].
- RF-12.7.06 Overclick DEVE permanecer mínimo e genérico: nenhuma lógica específica do Zero no board [OBS m12/m13].

### RF-12.8 Plugin, hooks e skill
- RF-12.8.01 Plugin = skill + tools MCP + hooks [OBS m12 D65]; versionado independentemente (0.2.2 em D66) [OBS].
- RF-12.8.02 Hooks (pre-tool, post-tool, session start, stop, subagent, end session) instalados pelo Overclock associam terminal/Pane à Session transcrita e atualizam cards [OBS m12 D65-D67; ver [[spec-05-catalogo-skills-mcp-hooks]]].
- RF-12.8.03 Hook `session_start` DEVERIA sugerir "pegue uma task" ao agente [OBS m12 analogia D65] [DEC: sugestão, nunca claim automático].
- RF-12.8.04 Skill de execução: "Execute o card NN do Overclick e finalmente chame handoff submit" [OBS m12 D64]. Skill `top 10` (lista tasks leves, agente escolhe) [OBS m12 D65].
- RF-12.8.05 Tools DEVEM ter nomes completos e sem depender de prefixo adivinhado pelo harness ("vacina contra palpite de prefixo") [OBS m12 D65].

### RF-12.9 Cloud e entitlement
- RF-12.9.01 Instância hospedada (cloud.overclock.sh) DEVE ser liberada por Entitlement `overclick_cloud` ligado ao Plan Ultra ("Horners/Harness"), sem custo extra [OBS m12 D64/D68; ver [[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements)].
- RF-12.9.02 Modo livre e squad NÃO acessam o Overclick; só o modo agêntico [OBS m12 D75].
- RF-12.9.03 Trial gratuito temporário: uma pessoa por conta, sem multiusuário [OBS m12 D64]; duração [LAC].
- RF-12.9.04 O repo cloud DEVE ser reflexo do open source; divergências proibidas em regras de domínio [OBS m12] [DEC: cloud = mesmo código + módulo `billing/entitlements` fechado].
- RF-12.9.05 Self-hosted NÃO exige Entitlement [OBS m12: gratuito].

### RF-12.10 Integração Zero (fase 1 do bot; cliente do Overclick)
- RF-12.10.01 Zero DEVE falar com o Overclick só via MCP com worker token, sem acesso ao repositório [OBS m13].
- RF-12.10.02 Fluxo: post no fórum de bugs → thread → investigação conversacional → dedup → prompt de diagnóstico → card `bug` com origem, reportado por, versão, como confirmo, resultado do diagnóstico [OBS m13 D64].
- RF-12.10.03 Perguntas NÃO fixas; o agente conduz até concluir, sem fallback de formulário [OBS m13 D64 doutrina].
- RF-12.10.04 Dedup: `task_search`; duplicata com `resolved_in` <= versão do usuário → orientar atualização sem abrir card; duplicata aberta → comentar no card existente (nº de reportantes = nº de comentários do Zero) [OBS m13 D64; comparação de versão DEC semver].
- RF-12.10.05 O prompt de diagnóstico NÃO DEVE solicitar credenciais, IP ou caminhos e DEVE pedir redação desses dados [OBS m13 D64].
- RF-12.10.06 Cadência de follow-up para ticket incompleto: 10 min, 1 h, 24 h, card parcial/fechamento em 72 h; sessão persistida e retomável, nunca reinicia [OBS m13 D65; intervalos variam nas falas (LAC-4); "produção" não confirmada].
- RF-12.10.07 Missão dedicada "zero overclick" em 2 projetos (bot Zero + Overclick) e 2 sub-missões: "Zero investiga fundo e leva o problema pro board" e "correção automática" [OBS m13 D64].

### RF-12.11 Integração Overrunner (fase 2)
- RF-12.11.01 Runner headless em VPS DEVERIA observar cards elegíveis, executar em worktree/branch, exigir testes verdes, `handoff_submit` com uso medido e abrir PR; humano valida [OBS m13 D64-D65, planejado].
- RF-12.11.02 Elegibilidade: só cards `type=bug|feature`, `auto_fix=true`, com `how_to_confirm` [DEC].
- RF-12.11.03 Gatilho: polling por `task_next` (default) ou webhook assinado (URL + segredo) [OBS m13 proposta do agente; apresentador achou possivelmente desnecessário] [DEC: polling primeiro].
- RF-12.11.04 Retorno ao usuário: ao `validated`, Zero (que conhece seus cards) DEVERIA avisar o membro no thread [OBS m13 D65 sugestão; DEC].

## 5. Modelo de dados

Persistência [DEC]: PostgreSQL (SQLite aceitável para self-host mínimo), migrations + seed versionadas (o original tinha "schema completo, migration + seed" — [OBS m12 D62], SGBD [LAC-6]). Chaves `id` = UUID; timestamps UTC ISO-8601.

### 5.1 Entidades

Workspace `{id, name, slug, created_at}`; `Member {id, workspace_id, email, role: admin|member, locale='en'}` [OBS locale padrão inglês].

Project:
```json
{"id":"uuid","workspace_id":"uuid","name":"Overclock","key":"OVK","repo_url":null,
 "context_md":"# O que é ...","context_updated_at":"...","policy_id":"uuid",
 "next_seq":261,"archived":false}
```
`key` obrigatório, `^[A-Z]{2,5}$`, único no Workspace, imutável após o primeiro card.

Mission:
```json
{"id":"uuid","workspace_id":"uuid","name":"1.4","objective":"texto","project_ids":["uuid","uuid"],
 "period":{"start":"2026-09-21","end":"2026-09-25"},"status":"open|closed"}
```
Invariante: `project_ids` >= 1; cards da missão devem pertencer a um desses projetos.

Card:
```json
{"id":"uuid","project_id":"uuid","mission_id":"uuid|null","parent_id":null,"seq":205,"key":"OVK-205",
 "title":"Banner de pré-release espreme abas","type":"bug",
 "what":"...","why":"...","how_to_confirm":"...",
 "column":"todo","origin":"solo","created_by":"member:uuid|agent:name|worker:zero",
 "return_to":"member:uuid","executor_planned":{"provider":"anthropic","model":"opus-5","effort":"medium"},
 "executor_actual":null,"decision_id":"uuid|null","claimed_by":null,"claimed_at":null,
 "branch":null,"depends_on":[],"files_hint":[],"resolved_in":null,
 "reported_by":null,"source":{"kind":"discord","ref":"thread_id"},"reported_version":null,
 "cost":{"tokens_in":0,"tokens_out":0,"usd":null,"seconds":0},
 "auto_fix":false,"created_at":"...","updated_at":"...","discard_reason":null}
```
Enums: `type`: feature|adjust|contract|refactor|bug|deep_bug|ship|question|improvement [OBS m12 lista parcial; question/improvement DEC pois Zero deve detectar "melhorias e dúvidas" (m13)]. `origin`: solo|team. `column` ver 5.2. Invariantes: `key=project.key-seq`; `claimed_by` não nulo iff column in (in_progress); `how_to_confirm`, `what`, `why` não vazios para column != backlog; `parent_id` não forma ciclo.

Comment `{id, card_id, author, kind: note|zero_report|diagnostic|review|system, body, created_at}` [kinds DEC].

Policy:
```json
{"id":"uuid","project_id":"uuid|null","level":3,
 "declared_executors":[{"cli":"claude-code","models":["opus-5","sonnet-5"]}],
 "rules":{"bug":[{"provider":"openai","model":"codex-sol","effort":"high"},{"provider":"anthropic","model":"opus-5","effort":"high"}],
          "feature":[...]},
 "on_unavailable":"next"}
```
Compatível com a entidade canônica Policy de [[spec-03-harness-roteamento-decisor]]; o Overclick guarda uma cópia editável por Project e delega o cálculo do ranking à spec-03 quando embutido no Overclock [DEC].

Decision (registro da recomendação) `{id, card_id, type, candidates[], chosen, reason, created_at}` [DEC].

UsageRecord `{id, card_id, session_id, provider, model, tokens_in, tokens_out, usd|null, price_missing:boolean, started_at, ended_at}`; `card.cost` = agregação [DEC].

Token `{id, workspace_id, scope: admin|agent|worker, label, hash, created_at, last_used_at, revoked_at}`; armazenar apenas hash [DEC]; "aguardando primeira conexão" = nenhum token com `last_used_at`.

Entitlement (cloud) `{account_id, key:"overclick_cloud", source_plan:"ultra", expires_at, seats:1}` [DEC; seats=1 para trial OBS].

CardSession `{card_id, session_id, pane_id, linked_at}` preenchido pelos hooks [DEC].

### 5.2 Colunas e estado

Colunas [OBS parcial: Feito, Validado, Desenvolvimento; restante DEC]: `backlog → todo → in_progress → review → done → validated`, mais `discarded`.
Ciclo de vida: cards nunca são apagados fisicamente por padrão; `task_delete` exige tabela `discarded` + custo preservado (hard delete só admin e só sem UsageRecord) [DEC, por RF-12.3.06].

## 6. Interfaces

### 6a. UI/UX
Telas [OBS m12]: Wizard (3 passos); Board (kanban, estilo "glass" do Board V2 [OBS], custo no canto superior direito); Lista responsiva; Card (detalhe + formulário com campo "Harness sugerido"); Missões (progresso verde/azul, descrição/objetivo [OBS D64]); Insights; Settings (Policy de harness, custo aproximado por modelo, usage por sessão/CLI, tokens MCP, idioma, atualizações automáticas); Equipe (fase 2). Estados: vazio (card "valide seu setup"), carregando, erro de conexão MCP, executor indisponível (badge vermelho + fallback), card bloqueado por claim. Atalhos: [LAC/DEC] `c` novo card, `/` busca, `f` filtros — nenhum observado. Textos: idioma padrão inglês; landing "You write the contract. The agent does the work." e "Open source alternative to ClickUp where AI does the work" [OBS m12].

### 6b. API interna (REST/JSON) e eventos [DEC — o original só documenta MCP e UI]
`POST /api/auth/setup` (primeiro admin); `GET/POST /api/projects`; `PATCH /api/projects/:id` (inclui `context_md`); `GET/POST /api/missions`; `GET/POST /api/cards` (filtros `mission,project[],type,column,q`); `PATCH /api/cards/:id`; `POST /api/cards/:id/claim|release|handoff`; `GET/PUT /api/projects/:id/policy`; `POST /api/harness/recommend`; `GET /api/insights?group_by=model|project|card`; `POST/DELETE /api/tokens`; `POST /api/usage` (ingest de hooks). Erros: `{ "error": {"code": "...", "message": "..."} }`.
Eventos (SSE `/api/events` e webhooks fase 2): `card.created`, `card.moved {from,to}`, `card.claimed`, `card.handoff`, `card.validated`, `card.discarded`, `comment.added`, `mission.progress`. Webhook fase 2: POST assinado `X-Overclick-Signature: sha256=HMAC(secret, body)`.

Hooks → board: payload mínimo `{event: pre_tool|post_tool|session_start|stop|subagent|session_end, session_id, pane_id, cwd, tokens?, model?}`; o board resolve o card ativo por `CardSession` [DEC].

### 6c. Tools MCP (servidor `overclick`)
Reconciliação (LAC-1): o original citou 10 tools (D62), 20 em 6 famílias (D64) e 29 (D65, fala ruidosa, "antes só tinha cinco"; famílias não listadas). [DEC] Definir 3 níveis: Tier A = 14 tools (MVP), Tier B = +7 (21 ≈ "20"), Tier C = +8 (29). Tier A é o mínimo exigido por esta spec. "handoff submit" e "deliver" (listados separados em D64) [OBS] são unificados em `handoff_submit` [DEC]; `task_deliver` PODE existir como alias.

Convenções [DEC]: entrada JSON Schema; saída JSON; listagens retornam objetos leves (`id,key,title,type,column,executor_planned,cost.usd`) e paginam (`limit<=50`, `cursor`); `*_get` retorna completo. O workspace vem do token. Erros comuns: `unauthorized`, `forbidden_scope`, `not_found`, `validation_failed`, `rate_limited`.

Tier A (14):
| tool | entrada (campos; * = obrigatório) | saída / erros |
|---|---|---|
| project_list | `limit,cursor` | `[{id,key,name,repo_url,archived}]` (sem contexto) |
| project_get | `project*` (id ou key) | Project completo com `context_md`, Policy resumida |
| mission_list | `project?,status?,limit,cursor` | leve: `{id,name,progress,cost_usd}` |
| mission_get | `mission*` | Mission + contagens por coluna + custo |
| task_list | `project?,mission?,type?,column?,limit,cursor` | leve |
| task_search | `query*,project?,include_closed=true,limit=10` | `[{key,title,column,resolved_in,score}]` |
| task_get | `task*` (id ou key) | Card completo + comentários |
| task_create | `project*,title*,type*,what*,why*,how_to_confirm*,mission?,parent?,origin='solo',return_to?,reported_by?,source?,reported_version?,column='todo'` | Card + `decision` (harness sugerido). Erros: `contract_incomplete` |
| task_claim | `task*,agent*` | Card com `claimed_by`. Erros: `already_claimed`, `invalid_state`, `executor_unavailable`, `collision_warning` (não erro: campo `warnings`) |
| task_update | `task*,patch{title,what,why,how_to_confirm,column,executor_planned,files_hint,discard_reason}` | Card. Erros: `invalid_transition` |
| handoff_submit | `task*,summary*,evidence*[{kind:test|pr|log|screenshot,ref}],cost?{tokens_in,tokens_out,usd},resolved_in?` | Card em `review`. Erros: `not_claimed_by_caller` |
| branch_register | `task*,branch*,pr_url?` | Card |
| harness_list | `project?` | Policy efetiva filtrada por executores ativos |
| harness_recommend | `type*,project?,constraints?{no_providers[],max_effort}` | `{chosen,candidates[],reason}`; erro `no_executor` |

Tier B (+7): `project_create{name*,key*,repo_url?,context_md?}`, `project_update`, `project_delete{project*,confirm_key*}` (bloqueia se houver cards; original só liberou update/delete "no open source" em D63 [OBS]), `mission_create{name*,project_ids*,objective?,period?}`, `task_delete{task*,reason*}` (= discard), `harness_set{project*,type*,rules*}`, `comment_add{task*,body*,kind='note'}`.
Tier C (+8, fase 2): `mission_update`, `comment_list`, `task_release`, `project_context_set{project*,context_md*}`, `task_next{project?,type?,for_executor?}` (retorna 1 card elegível leve; usado por hook/skill/Overrunner), `cost_report{group_by*,from?,to?}`, `webhook_register{url*,secret*,events*}`, `task_link{task*,depends_on*}`.

Regra de contexto [OBS D65]: listar e obter são tools separadas para poupar tokens.

### 6d. CLI/protocolos externos
- MCP sobre HTTP com `Authorization: Bearer <token>`; copy command (ex.: `claude mcp add --transport http overclick <URL> --header "Authorization: Bearer <token>"`) [OBS: existe "copy command"; sintaxe exata por CLI DEC, depende de cada CLI].
- Docker Compose: serviços `web` (Next.js), `db`; `.env` com `DATABASE_URL`, `PUBLIC_URL`, `ADMIN_*` [OBS docker compose; variáveis DEC].
- Plugin: pacote com `skills/overclick-execute`, `skills/top10`, `mcp.json`, `hooks/*` [DEC estrutura; OBS composição].
- Discord (Zero): API do Discord, fórum de bugs, threads [OBS m13].
- Git/GitHub: apenas o agente e o runner; releases do GitHub como fonte de contexto (fase 2).

## 7. Fluxos e algoritmos

### 7.1 Instalação
1. `docker compose up` → 2. `/setup` cria admin+Workspace → 3. wizard (projeto, executores, token+copy command) → 4. usuário roda copy command na CLI, recarrega tools → 5. primeira chamada MCP marca token como conectado → 6. seed cria "valide seu setup" [OBS m12 D62]. Erro: token nunca usado após 10 min → dica de recarga [DEC].

### 7.2 Criação com harness
`task_create` → valida contrato → `harness_recommend(type)`: filtra Policy por executores declarados/ativos → escolhe o primeiro → grava Decision e `executor_planned` → se `origin=team` e agente pediu, cria subtasks [OBS m12 D62 fluxo canônico: identificar workspace, missão, solicitante; orientar solo/time; selecionar Harness].

### 7.3 Máquina de estados do Card
| estado \ evento | create | claim | handoff_submit | validate (humano) | reject | discard | release |
|---|---|---|---|---|---|---|---|
| (novo) | backlog ou todo | — | — | — | — | — | — |
| backlog | — | invalid | invalid | — | — | discarded | — |
| todo | — | in_progress | invalid | — | — | discarded | — |
| in_progress | — | already_claimed | review | — | — | discarded | todo |
| review | — | — | review (reenvio) | done | todo (comentário obrigatório) | discarded | — |
| done | — | — | — | validated | todo | discarded | — |
| validated | — | — | — | — | todo (reabrir) | — | — |
| discarded | — | — | — | — | — | — | — |
Transições: [DEC], baseadas em colunas observadas (Feito/Validado). Claim: atômico (`UPDATE ... WHERE claimed_by IS NULL`).

### 7.4 Execução paralela de missão [OBS m12 D64]
Orquestrador lista cards da missão → dispara independentes, cada Pane numa branch própria com prompt "executa o card KEY" → dependentes após `handoff_submit` de `depends_on`. Colisão de arquivos: `files_hint` cruzado gera warning.

### 7.5 Custo
Ao `handoff_submit` ou hook `stop`: `UsageRecord` do intervalo [claimed_at, agora] da Session do card; preço = tabela `model_price`; se ausente → `usd=null, price_missing=true`. Cards descartados mantêm registros. Cálculo por missão = soma; nulls exibidos como "≥" [DEC].

### 7.6 Zero — investigação e dedup
1. Evento thread criado no fórum. 2. Carregar `project_get(context_md)` (system prompt). 3. Loop do agente: perguntar/deduzir; se relato é vago, pedir prompt de diagnóstico ao usuário; usuário cola resultado. 4. Antes de abrir: `task_search(termos)`; LLM julga duplicata. 5a. Duplicata com `resolved_in` e `versão_usuário < resolved_in` → responder "atualize", sem card. 5b. Duplicata aberta → `comment_add(kind=zero_report)`. 5c. Nova → `task_create(type=bug, reported_by, source, reported_version, how_to_confirm, diagnostic)`. 6. Concluir sem dados suficientes no limite de follow-up → card parcial (7.7). Critério de "concluir" [LAC-8]; [DEC]: campos `what`, versão, passos de reprodução e resultado de ao menos 1 diagnóstico (ou recusa explícita do usuário).

### 7.7 Cadência de follow-up (fase 2 comprovada só em especificação)
Estados da sessão: `interviewing → waiting_user → nudge_10m → nudge_1h → nudge_24h → partial_closed`; `completed` a qualquer momento.
| estado × evento | user_reply | timer |
|---|---|---|
| waiting_user | interviewing (retoma no ponto exato) | +10 min: mensagem 1, sem menção |
| nudge_10m | interviewing | +1 h: mensagem 2 |
| nudge_1h | interviewing | +24 h: mensagem 3, com menção |
| nudge_24h | interviewing | +72 h: card parcial + mensagem 4 (ticket fechado) |
Regras: `/start` nunca reinicia [OBS]; estado persistido em store durável (o "brain") [OBS]; timers em relógio absoluto desde a última msg do usuário [DEC]; tom: personalizado ao problema, sem travessão, deixar claro que não entrou na fila de correção e a equipe não sabe [OBS D65]. Card parcial 72 h [OBS "card parcial"] vs "ticket fechado" [OBS texto]: [DEC] criar card `column=backlog, type=bug, labels=[partial]` com o que existe e fechar o thread; [LAC-4].

### 7.8 Overrunner (fase 2)
Loop: `task_next(auto_fix)` → `task_claim` → `git worktree add` → executor conforme Policy → testes → se verdes `branch_register`+PR+`handoff_submit`; se vermelhos após N=2 tentativas → `comment_add(kind=system)` + `task_release` [DEC]. Concorrência máx. configurável (default 1) [DEC]. Sem push em branch protegida; sem merge automático [DEC: humano valida; OBS "humano valida"].

## 8. Prompts e textos embutidos

8.1 Mensagens de follow-up do Zero [OBS m13 D65, quase verbatim; geradas por LLM por problema, sem travessão]:
```
10 min: Ficou faltando pouco. Com mais duas respostas eu consigo registrar teu problema direitinho pra equipe. Continua quando puder, tô aguardando.
1 h: Teu problema ainda não foi registrado. Sem as duas respostas que faltam, ele não entra na fila de correção e a equipe nem fica sabendo que existe. Continua daqui mesmo, no ponto onde paramos.
24 h: <nome>, teu relato continua fora da fila. Falta pouco para ele virar um ticket de verdade. O que tu já contaste tá guardado. Responde a última pergunta que eu fiz e registro na hora.
72 h: Não consegui registrar teu problema, não está na fila de correção, teu ticket foi fechado.
```
8.2 Doutrina do Zero [OBS m13 D64, resumida quase verbatim]: "O Zero conduz uma investigação até conseguir concluir. Não quero fallback. Quero investigações aprofundadas: o Zero mandando prompt, a pessoa rodando e devolvendo, a ponto de, na execução, bastar abrir o card e já ter toda a investigação."
8.3 System prompt base do Zero [LAC — prompt literal não capturado; [DEC] proposto]:
```
Você é o Zero, triador de bugs do projeto {project.name}. Contexto do projeto:
{project.context_md}
Objetivo: conduzir uma investigação até ter (a) sintoma, (b) versão, (c) passos para reproduzir, (d) resultado de diagnóstico rodado pelo usuário. Não use lista fixa de perguntas; adapte ao relato. Se o usuário só testa o bot, pergunte se há problema a reportar. Antes de criar card, chame task_search. Nunca peça senhas, tokens, IP ou caminhos; peça para redigir. Não use travessão. Responda no idioma do usuário.
```
8.4 Prompt de diagnóstico [LAC — não capturado; [DEC] base]:
```
Você é um assistente de diagnóstico. Investigue este problema no meu ambiente: "{resumo}". Reúna: versão do app, SO, passos executados, logs de erro recentes (redija segredos, IPs e caminhos de usuário), e o que mudou recentemente. Responda em Markdown curto com seções: Ambiente, Evidências, Hipótese. Não altere nada.
```
8.5 Skill de execução [OBS D64]: "Execute o card {NN} do Overclick e finalmente chame handoff_submit."
8.6 Textos de produto [OBS]: "You write the contract. The agent does the work." / card exemplo "valide seu setup".
8.7 Instrução de paralelismo [OBS m12 D64]: "Lança todos os pens, cada um consultando a sua atividade dentro do Overclick... Primeiro lança tudo que é independente, cada pen numa branch para não se atropelarem, e as dependentes eu disparo conforme os handoffs."

## 9. Requisitos não-funcionais

- Desempenho: `task_list` p95 < 300 ms com 10.000 cards; claim atômico [DEC; original sem números]. Números observados: missão de 13 cards executou em paralelo no D64; 72 cards em ~1 semana (D65) [OBS m12].
- Portabilidade: web (browser) em qualquer SO com Docker; decisão explícita "não aplicativo desktop" [OBS]. Self-host: macOS/Linux/Windows via Compose [DEC].
- Segurança: tokens com hash e escopo; worker sem acesso a repo [OBS]; Zero envia só o necessário; sanitizar Markdown (XSS) no `context_md` e comentários [DEC]; rate limit por token [DEC]; auditoria de mudanças de estado [DEC]. Tokens MCP vazados devem ser rotacionáveis [OBS m13].
- Privacidade: zero coleta pelo autor [OBS]; diagnósticos sem credenciais/IP/caminhos [OBS m13]; retenção de dados do Discord [LAC].
- Custo/tokens: listagem leve vs get completo; providers desativados omitidos do MCP; card carrega instruções para poupar saída do orquestrador [OBS m12].
- Observabilidade: log por chamada MCP (tool, token label, latência), contagem de erros, `last_used_at` de token [DEC].
- i18n: inglês padrão, PT-BR suportado [OBS/DEC].

## 10. Stack sugerida e restrições

Original [OBS m12]: monorepo pnpm; Next.js (admin/web); banco próprio com schema/migrations/seed; Docker Compose; MCP remoto (URL+token); GitHub Pages para landing; cloud.overclock.sh. Zero: Discord bot, LLM Grok (briefing) e Sonnet (investigação), MCP do Overclick, store persistente "brain", container [OBS m13].
Neutro [DEC]: qualquer framework web + PostgreSQL/SQLite + servidor MCP HTTP (SDK oficial MCP); fila/scheduler simples (cron em DB) para a cadência; Discord via biblioteca oficial. Restrições: licença open source permissiva [LAC-7: licença não citada]; separar código do board de `billing/entitlements` do cloud.

## 11. Plano de implementação

- F0: schema, auth admin, Project/Mission/Card, colunas, UI board+lista.
- F1 (MVP): tokens + MCP Tier A, claim/handoff, wizard+copy command, card exemplo, Policy + `harness_recommend`, custo por card/missão, Compose.
- F2: plugin (skill + hooks + CardSession), contexto por projeto, `task_search`/`resolved_in`/comentários tipados, Tier B, Insights, progresso de missão.
- F3: Zero bug triage (investigação, dedup, card) com worker token; missão "zero overclick".
- F4: cloud: Entitlement `overclick_cloud`, multi-tenant, trial; equipe (0.4.0).
- F5: cadência de follow-up; Tier C; webhooks; Overrunner (runner VPS, PR); "volta" ao usuário; integração Git real.
Ordem: F0 → F1 → F2 → (F3, F4 em paralelo) → F5.

## 12. Casos de teste de aceitação

1. Feliz: Dado um Workspace novo, Quando concluo o wizard e rodo o copy command, Então o indicador muda de "aguardando primeira conexão" para conectado e existe o card "valide seu setup".
2. Contrato: Dado `task_create` sem `how_to_confirm` com `column=todo`, Então erro `contract_incomplete` e nenhum card criado.
3. Claim concorrente: Dados 2 agentes chamando `task_claim` simultaneamente, Então exatamente um recebe sucesso e o outro `already_claimed`.
4. Handoff: Dado card em `in_progress` claimed por A, Quando B chama `handoff_submit`, Então `not_claimed_by_caller`; quando A chama com evidência e custo, card vai a `review`.
5. Harness: Dado executor Codex desativado na Policy, Quando `harness_recommend(type=bug)`, Então nunca retorna Codex e devolve o próximo da fila; com fila vazia, `no_executor`.
6. Custo: Dado modelo sem preço, Quando handoff, Então `usd=null`, alerta exibido e missão mostra "≥"; card descartado mantém custo na soma.
7. Custo em terminal compartilhado: Dados 2 cards sequenciais na mesma Session, Então cada um recebe só o uso da sua janela.
8. Escopo de token: Dado token `worker`, Quando chama `project_delete`, Então `forbidden_scope`; token revogado é rejeitado em <= 5 s.
9. Zero dedup: Dado card existente com `resolved_in=1.3.17` e usuário na 1.3.10, Quando o Zero investiga o mesmo bug, Então orienta atualizar e nenhum card/comentário novo é criado; com card aberto sem `resolved_in`, apenas `comment_add(kind=zero_report)`.
10. Cadência: Dada sessão abandonada, Então mensagens em 10 min/1 h/24 h e, em 72 h, card parcial + fechamento; se o usuário volta às 30 h, retoma na pergunta pendente sem reiniciar.
11. Cloud: Dado usuário sem Entitlement `overclick_cloud`, Quando acessa a instância cloud, Então bloqueio com CTA de upgrade; self-hosted não é afetado; modo livre/squad não vê o Overclick.
12. Contexto: Dado `context_md` preenchido, Quando `project_get`, Então retorna o Markdown; `project_list` não o inclui.
13. (Fase 2) Overrunner: Dado card `auto_fix=true` e testes que falham 2 vezes, Então `task_release` + comentário `system`, sem PR.

## 13. Questões em aberto e riscos

- LAC-1: número/família de tools MCP (10/20/29); adotado Tier A/B/C [DEC].
- LAC-2: numeração de versões (0.1.9, 1.0, V2.1, 0.4.0, plugin 0.2.2): possivelmente artefatos distintos; definir SemVer por artefato (board, plugin, cloud).
- LAC-3: unidade de custo (USD vs BRL vs tokens: "412", "367", "1,47"); default [DEC] `usd` + `tokens`.
- LAC-4: intervalos da cadência (variação nas falas) e semântica de "card parcial" vs "ticket fechado"; se entrou em produção.
- LAC-5: semântica dos níveis de harness 1-3; colunas exatas do kanban; enum de tipos.
- LAC-6: SGBD/schema real do original (não descrito).
- LAC-7: licença, nome/URL do repositório público.
- LAC-8: critério de "investigação concluída" do Zero; modelo de produção (Grok vs Sonnet).
- LAC-9: pairing code; trial duração; gestão de equipe (papéis, convites).
- LAC-10: gatilho e "volta" do Overrunner, e relação com Overclock Bot ([[spec-10-overclock-bot]]).
- LAC-11: política de retenção/LGPD de conversas do Discord.
Riscos: divergência cloud vs open source; vazamento de token (já ocorreu ao vivo); custos zerados enganosos; Overrunner executar código de relato não confiável (prompt injection em bug report) — mitigar com sandbox/VPS isolada e revisão humana [DEC]; dependência de ruído de transcrição em nomes.

## 14. Rastreabilidade

| Requisito | Fonte |
|---|---|
| RF-12.1.x | m12 Funcionamento/Comportamento (D62-D64, D68) |
| RF-12.2.x | m12 "Card como contrato", prompts D62 (arq. 29), D64-65 |
| RF-12.3.x | m12 Máquina de estados do claim, gate de colisão (D65), branch (D62) |
| RF-12.4.x | m12 Política de Harness (D62, D65, D67); [[spec-03]] |
| RF-12.5.x | m12 Custo por card, bugs de telemetria (D63, D64, D67, D68, D80) |
| RF-12.6.x | m12 Instalação (D62), pairing (D64); m13 worker token/revogação (D64) |
| RF-12.7.x | m12 contexto por projeto e campos para o Zero (D64); m13 arquitetura (arq. 27) |
| RF-12.8.x | m12 Plugin (D65-D67), catálogo m05 |
| RF-12.9.x | m12 Cloud (D64, D68, D75, D77); m17 |
| RF-12.10.x | m13 Zero bug (D64-D65), doutrina (arq. 27), cadência (arq. 26) |
| RF-12.11.x | m13 Overrunner (arq. 26-27, D64-D65), Overclock Bot (D69-70) |
| Tools MCP | m12 MCP (D62 10; D64 20; D65 29) |
| Seção 5-7 estados/schemas | [DEC] com base nos campos conceituais de m12 |
