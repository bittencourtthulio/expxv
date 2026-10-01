---
spec: "Orquestração multi-agente e modo agêntico"
slug: "spec-02-orquestracao-modo-agentico"
modulo_fonte: ["02-orquestracao-modo-agentico"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-03-harness-roteamento-decisor", "spec-04-providers-e-modelos", "spec-05-catalogo-skills-mcp-hooks", "spec-06-over-memory", "spec-12-overclick"]
---
# Spec 02 — Orquestração multi-agente e modo agêntico

Legenda de selos: [OBS] observado (fonte: módulo 02 + dia/arquivo); [DEC] decisão do autor da spec; [LAC] lacuna (dono do produto decide). Toda menção "dia N" refere-se às lives; "arq. N" ao arquivo de projeto-bruto.

## 1. Resumo e objetivo

O Overclock orquestra vários terminais reais (Pane), cada um rodando uma CLI de IA distinta, de modo que **um agente caro (piloto/orquestrador) só planeja e delega** e **workers mais baratos executam**, reportando por **handoff**. O sistema oferece três modos de uso — **livre**, **squad** e **agêntico** — e um **MCP interno** por meio do qual o piloto abre painéis, entrega prompts, lê respostas e recebe o retorno. [OBS] (mód. 02, "Objetivo"; dias 24, 33, 44, 49, 76)

Problemas resolvidos: (a) custo — modelo caro só no topo, baratos embaixo (dias 58, 73, 81); (b) contexto perdido e terminais soltos (dia 22); (c) alucinação/desperdício por excesso de skills visíveis (dias 33, 43, 82); (d) orquestrador bloqueado esperando workers, impedindo conversa com o usuário (dias 29, 30). [OBS]

Objetivo da spec: permitir implementar (1) o MCP de delegação + handoff + hooks; (2) Squad com SquadRole; (3) modo agêntico (piloto, chefes, torre de controle, intake gates); (4) enforcement de skills por permissão; (5) piloto persistente; (6) rastreio de custo por tarefa; (7) protocolo de teste A/B.

## 2. Escopo e não-escopo

**Construído no original (escopo de implementação, fases 1-3):** swarm de painéis via MCP (dia 22, v0.3.5); handoff + stop hooks + post-tool-use + session-start no Claude Code (dia 51, v1.2.2/1.2.3); passagem de prompt por argv (dia 51); squads com cargos fixos e agentes com skills/LLM próprios (dia 33, v0.6); enforcement hard por whitelist (dia 33); intake gates, respawn, "cadeado" (dia 61, v1.3.5); briefing em .md (dia 44); modo agêntico com piloto + chefes / torre de controle (dia 44, v1.0; "torre hoje só Claude", dia 66); piloto persistente (dia 75, v1.4); `/goal` e `/loop` como usos do produto (dias 51, 54, 58). [OBS]

**Somente desenho/planejado no original — FASE 2 nesta spec (não implementar no MVP):** sensores (agentes monitores; sensor 2 relança painel com modelo problemático) e Overtester (dia 49); handoff/migração automática quando o limite de conta bate (desejado no dia 75; migração de torre manual no dia 44); memória em anéis com escopo por token (desenho, dia 49; ver [[spec-06-over-memory]]); hub/quadro ao vivo unificando Tesques/missão/milestones (dia 49); MCP para criar squad, marketplace de squads/agentes, squad automático/mission wizard (planejados). [OBS] (mód. 02, "Incertezas")

**Não-escopo (outras specs):** política/decisor de modelo, headline pick ([[spec-03-harness-roteamento-decisor]]); catálogo de skills/MCP/hooks ([[spec-05-catalogo-skills-mcp-hooks]]); memória e SDD ([[spec-06-over-memory]]); board de cards ([[spec-12-overclick]]); voz/Jarvis; motor de renderização de painéis/Overdrive ([[spec-01-terminais-paineis-workspaces]]); planos/preços. Computer use: só o contrato de uso ("braço antes do mouse"); a implementação do Jarvis/browser interno fica fora.

## 3. Glossário e atores

- **Pane**: terminal real (PTY) de uma CLI de IA, com `pane_id` numérico descartável (dia 61). **Mission**: unidade de trabalho que agrupa workers; herda ID para os panes. **Task**: item de trabalho/atividade/card (transcrito "Tesque"; [OBS] dia 30/49). **Squad**: time de agentes por cargo; **SquadRole**: `orchestrator | executor | scout | reviewer` (+ `planner`, `builder` como vocabulário posterior). **Agent**: CLI + LLM + skills permitidas + tools + cargo. **Policy**/**Decision**: [[spec-03-harness-roteamento-decisor]].
- **Atores**: Usuário (piloto humano; responde intake e aprova portões); Piloto/Orquestrador (agente no pane fixo à esquerda); Chefes (scout, builder, reviewer — só na "cadeia de comando"); Workers; Torre de controle (orquestrador que cria Tasks e despacha); Sistema (Overclock: MCP sidecar, hooks, UI). O Overclock em si não gasta tokens; expõe o MCP. [OBS] dia 76
- Princípio: "as IAs não conversam entre si; quem conversa é o piloto que delega" [OBS] dia 76.

## 4. Requisitos funcionais

### 4.1 Modos de uso
- **RF-02.01** O sistema DEVE oferecer ao abrir atividade os modos `free`, `squad`, `agentic`. Aceite: seletor com 3 opções; cada uma abre o fluxo correspondente. [OBS] dias 44, 49, 65, 76
- **RF-02.02** `free`: N painéis (1,2,4,8,12) sem Mission; DEVE permitir marcar um Pane como piloto (fixo à esquerda) e DEVE NÃO expor Overclick nem memória de missão. Aceite: tools de board/memory ausentes no MCP do pane. [OBS] dia 75 (Overclick só no agêntico), dia 49 (memória)
- **RF-02.03** `squad`: DEVE iniciar Mission a partir de um Squad com receita, intake gate, delegação por cargo e handoff. Aceite: fluxo completo squad→missão concluída. [OBS] dias 33, 61
- **RF-02.04** `agentic`: usuário descreve o objetivo em uma frase; sistema DEVE abrir piloto, conduzir intake, abrir scouts em paralelo, planejar em ondas/épicos/cards e criar um worker por card; o usuário NÃO escolhe estilo/elenco/modelo/conta. Aceite: nenhum passo de seleção manual de worker no fluxo. [OBS] dia 75
- **RF-02.05** No modo agêntico DEVE haver dois estilos: `chain_of_command` (piloto → chefes scout/builder/reviewer → workers) e `control_tower` (orquestrador livre para conversar; ao "pode despachar isso" a torre cria Task .md e despacha). Aceite: `mission.style` define qual prompt/skill é carregada. [OBS] dias 44, 65; torre "só Claude" dia 66
- **RF-02.06** Existe ainda modo `auto` (sistema escolhe o estilo) — [LAC] algoritmo não documentado; [DEC] default: `control_tower` se o piloto for Claude, senão `chain_of_command`.

### 4.2 Painéis visíveis e regras do piloto
- **RF-02.10** Todo worker DEVE abrir como Pane visível; PROIBIDO worker oculto em background; Pane é fechado ao concluir. Aceite: nenhum processo de worker sem Pane na UI. [OBS] dias 24, 28
- **RF-02.11** Piloto único por Mission, sempre presente e fixo em cima/à esquerda; não pode invocar orquestrador nem a si mesmo; só invoca agentes da lista do Squad. Aceite: `agent_invoke` com role `orchestrator` retorna erro `forbidden_role`. [OBS] dia 33
- **RF-02.12** Workers DEVEM herdar `mission_id` e rótulo de cargo; painéis sem `mission_id` são defeito (bug observado dia 44). Aceite: todo Pane criado por MCP dentro de missão tem ambos. [OBS]
- **RF-02.13** Orquestrador NÃO DEVE iniciar com múltiplos terminais abertos e DEVERIA ter limite de paralelismo por Mission. [OBS] dia 33 (regra); dia 32 (26-28 painéis sem nome). Limite numérico: [DEC] `max_parallel_panes=8` configurável (o original não fixa; Overdrive suporta 64).
- **RF-02.14** O orquestrador NÃO DEVE declarar `done` sem passar pelo reviewer (último passo obrigatório). Aceite: `mission_complete` recusado se não existe handoff de role `reviewer` com status ok. [OBS] dia 33
- **RF-02.15** Após um worker reportar, o orquestrador DEVE continuar sem esperar todos; enquanto aguarda deve ficar ocioso sem ferramentas, podendo checar periodicamente, nunca "working" bloqueado. Aceite: orquestrador aguardando responde a mensagem do usuário. [OBS] dia 30
- **RF-02.16** "Nunca mesmo agente/IA para código e revisão" DEVERIA ser aplicado pela política (revisor de provider diferente do executor quando disponível). [OBS] dia 58 (regra dita); aplicação sistêmica [DEC].

### 4.3 MCP de delegação, handoff e hooks
- **RF-02.20** O sistema DEVE expor MCP interno (sidecar) a todo Pane de piloto com as tools da seção 6c. [OBS] (dias 49, 51, 65; lista exata [LAC], nomes = [DEC])
- **RF-02.21** Providers desativados NÃO DEVEM aparecer em `provider_list`/`model_list`. [OBS] dia 65
- **RF-02.22** Abrir Pane de worker DEVE passar o prompt inicial por **argv** da CLI (não abrir e digitar depois). Aceite: latência de delegação "1+1" ≤ 12 s (ver 9). [OBS] dia 51
- **RF-02.23** Para CLIs sem suporte a prompt de nascimento (ex.: Kimi) DEVE haver fallback: abrir vazio, aguardar prontidão (idle detectado) e injetar prompt + Enter. [OBS] dias 57, 65 (limitação); fallback [DEC]
- **RF-02.24** Worker DEVE entregar resultado via `handoff_submit`; resumo ≤ 400 caracteres e demais detalhes em arquivo de relatório apontado. Aceite: handoff com `summary.length ≤ 400` e `report_path` existente. [OBS] dia 61 (300-400 chars), dia 51 ("todo post-it aponta para relatório completo")
- **RF-02.25** Todo Pane criado pelo app (Claude Code) DEVE carregar **2 stop hooks**: se o worker tenta encerrar o turno sem `handoff_submit`, o hook DEVE devolver erro e forçar continuação. Aceite: worker que responde texto e para é reacionado até haver handoff (ou `max_stop_retries`). [OBS] dia 51; conteúdo exato dos hooks [LAC]; [DEC] 2 hooks = (1) checa handoff da tarefa, (2) checa que o relatório foi gravado.
- **RF-02.26** Hook **post-tool-use** ao concluir `handoff_submit` DEVE "acordar" (wake) o chamador, e só após o relatório estar persistido. Aceite: wake com relatório legível; nunca antes. [OBS] dia 51 (bug do post-it antes do relatório)
- **RF-02.27** Hook **session-start** DEVE entregar ao worker nascido a "comanda" (briefing + skills filtradas). [OBS] dia 51/49
- **RF-02.28** Para CLIs sem hooks (OpenCode, Codex, Grok, Kimi) DEVE haver equivalente: session-start emulado por subir o pane e enviar prompt; stop-enforcement por watcher do sistema que reenvia lembrete se pane fica idle sem handoff. [OBS] dia 51 (portar depois); watcher [DEC] — fase 3.
- **RF-02.29** O sistema NÃO DEVE reenviar prompt a worker por "falso negativo" (evitar resposta em dobro); reenvio só após `handoff_timeout` E pane idle. [OBS] dia 51 (bug); regra [DEC]
- **RF-02.30** O poke/wake NÃO DEVE esperar o chamador "ficar quieto" enquanto ele roda stop hook (bug de 8 s). Aceite: wake entregue na fila e consumido no próximo ponto seguro. [OBS] dia 51
- **RF-02.31** O retorno de spawn NÃO DEVERIA repetir eco (gasta token): resposta de `pane_spawn` contém só `pane_id`. [OBS] dia 51
- **RF-02.32** Worker de squad/agêntico reporta ao **piloto** com mensagem curta, não ao chefe (evita congestionar). [OBS] dia 44

### 4.4 Briefing e contexto
- **RF-02.40** Tarefa DEVE ser passada em arquivo `.md` (briefing) com contrato ("o que fazer, por que, como será confirmado"), e o worker DEVE devolver preenchendo o mesmo arquivo com quem executou. Aceite: arquivo contém seções `Contract`, `Result`, `Executed_by`. [OBS] dias 44, 63; nomes das seções [DEC]
- **RF-02.41** Worker DEVE nascer com contexto limpo (sem herdar conversa do piloto). [OBS] dia 44
- **RF-02.42** Detalhes ficam no card/briefing; a skill do executor DEVE ser mínima ("execute o card X" + `handoff_submit`). [OBS] dia 64
- **RF-02.43** Alvo de eficiência: ≥ 25% menos tokens e ≈ 20% menos contexto do chefe vs prompt em texto (medição observada, >50 testes). Critério de aceite como benchmark interno, não requisito de release. [OBS] dia 44

### 4.5 Squad e SquadRole
- **RF-02.50** Cargo (`role`) DEVE ser atribuído só no cadastro do Agent; o Squad referencia agentes existentes, um dropdown por cargo listando somente agentes daquele cargo, com logo da CLI e LLM. Aceite: agente sem cargo não pode entrar em squad. [OBS] dia 33
- **RF-02.51** Squad DEVE conter exatamente 1 `orchestrator` e ≥ 0 de cada outro cargo; squad com 1 só agente é inválido ("squad com só dois agentes" foi bug). [OBS] dia 33; validação de mínimos [DEC]
- **RF-02.52** CRUD de squad: criar, listar (incluindo criados pelo usuário ao abrir nova missão), duplicar, deletar; squad fechado NÃO PODE sumir. [OBS] dias 33, 66 (bugs)
- **RF-02.53** Agente DEVE poder ser duplicado para outra CLI (conversão sync/convert de agente/skill entre CLIs). [OBS] dia 33
- **RF-02.54** Wizard de missão de squad DEVE permitir trocar a CLI/LLM de cada worker; o "cadeado" DEVE trocar a CLI de todos de uma vez. [OBS] dias 53-55, 61
- **RF-02.55** Usuário sem Claude DEVE poder usar squad com orquestrador de outra CLI (Codex; workers Codex/Gemini/Copilot/Antigravity/Grok). [OBS] dia 75
- **RF-02.56** Receitas de fábrica (ex.: cinema site, SaaS 10K, App Factory, website, pentest, Corte Live) DEVEM ser carregáveis como Squad + receita. Conteúdo das receitas: [LAC]; fora desta spec.
- **RF-02.57** Agente DEVE ter: 1+ opções de LLM e nível de esforço (`effort`) por agente. [OBS] dia 33 (esforço declarado como faltando) → incluído por [DEC].

### 4.6 Intake gates
- **RF-02.60** Ao abrir Mission de squad, o piloto DEVE conduzir intake estruturado (perguntas clicáveis; AskUserQuestion no Claude e equivalentes em Codex/Grok) e NÃO delegar antes de todos os gates da receita estarem `approved`. Aceite: `task_create/agent_invoke` recusados com `gate_pending`. [OBS] dia 61
- **RF-02.61** Gates típicos: direção, conteúdo, build, QA aprovados. [OBS] dia 61 (teste "Quero fazer um site")
- **RF-02.62** Instruções de squad DEVEM ir por canal invisível (system prompt/append da CLI), não como texto visível no terminal. [OBS] dia 61 (bug); mecanismo por CLI [LAC]
- **RF-02.63** Pergunta de intake NÃO DEVE duplicar (bug Codex/`clarify` duplo). Aceite: idempotência por `question_id`. [OBS] dia 61
- **RF-02.64** Se a CLI do piloto não tem contrato de intake, o sistema DEVE recusar iniciar a missão (erro `pilot_cli_unsupported_intake`) em vez de executar solo. [OBS] dia 61 ("Grok sem contrato executa solo") ; recusa [DEC]
- **RF-02.65** Respawn: ao detectar worker fechado pelo usuário, o piloto DEVE respawnar com o mesmo briefing e **novo** `pane_id` (ID nunca volta). Aceite: `respawn_of` preenchido. [OBS] dia 61

### 4.7 Enforcement de skills por permissão
- **RF-02.70** Skills e tools visíveis a um worker DEVEM ser restritas por **whitelist do cargo/agente aplicada em código** (parâmetro de agente/permissão da CLI), NÃO por prompt, inclusive sob `--dangerously-skip-permissions`. Aceite: skill fora da whitelist é bloqueada mesmo com skip-permissions. [OBS] dia 33 (front-design bloqueado)
- **RF-02.71** No modo agêntico, o Harness DEVE "enriquecer" cada skill: ler, categorizar como scout/builder/reviewer, gerar resumo; o worker só enxerga as do seu tipo. [OBS] dias 65, 82 (mecanismo interno [LAC])
- **RF-02.72** Skills necessárias aos fluxos do produto (≈10 skills próprias) DEVEM ser embarcadas e copiadas no boot; a matriz NÃO DEVE referenciar skill de plugin que só exista na máquina do autor. [OBS] dia 75
- **RF-02.73** Squad DEVE NÃO receber tools de memória (skill gate). [OBS] dia 49

### 4.8 Piloto persistente
- **RF-02.80** A identidade do piloto pertence ao Pane (`pane.is_pilot`, `pane.pilot_successor`), não a pin de navegador. Trocar de conta faz respawn **no mesmo pane_id**; refresh nunca troca ID; sobrevive a refresh de sessão, troca de conta e mover sessão entre CLIs/contas. Aceite: após troca de conta o `pane_id` do piloto é idêntico. [OBS] dia 75
- **RF-02.81** Refresh de sessão sem conteúdo escrito (contexto não retomável) DEVE falhar com aviso amarelo e oferecer reiniciar com handoff. [OBS] dia 75 (limitação); oferta de reinício [DEC]
- **RF-02.82** Badge de piloto na lista lateral, nos cards e também no modo livre. [OBS] dia 75

### 4.9 Migração de torre e limite de conta
- **RF-02.90** (MVP) Torre nova em outra conta DEVE poder assumir lendo o handoff completo da missão e re-briefando workers; comando manual do usuário. [OBS] dia 44
- **RF-02.91** (Fase 2) Migração automática ao estourar limite de conta. [OBS como desejo, dia 75; não construído]
- **RF-02.92** Regra configurável de contas: contas de execução vs conta exclusiva do modelo topo (ex.: "conta 1 executores; conta 2 só Fable 5"). Enforced via Policy ([[spec-03-harness-roteamento-decisor]]). [OBS] dia 44

### 4.10 Goal/loop, custo, A/B, computer use
- **RF-02.100** O produto DEVE suportar sessão `/goal` (objetivo até concluir) e `/loop` (repetição em intervalo) nos Panes de CLIs que os têm; são distintos e combináveis. Não é feature própria do orquestrador além de poder ser disparado por ele. [OBS] dias 51, 54, 58
- **RF-02.101** Custo por Task e por Mission: tokens (entrada/saída), tempo, custo estimado, agente executor vs planejado; Task descartada mantém custo; custo do orquestrador registrado separadamente; dois cards no mesmo pane NÃO DEVEM somar custo da orquestração. [OBS] dias 63-64, 75
- **RF-02.102** O worker NÃO DEVE depender de autorrelato de custo: o sistema DEVE ler o consumo medido por pane/modelo do banco local e gravá-lo na Task ("app mede mas ninguém lê" era o gap). [OBS] dia 75 (gap); correção [DEC]
- **RF-02.103** Protocolo A/B: DEVE existir modo de comparação com o mesmo briefing sem instrução de uso do MCP, um lado sem orquestrador e outro com Squad; métricas: linhas/tokens, tempo, qualidade subjetiva, se o orquestrador usou o MCP sozinho. [OBS] dia 33
- **RF-02.104** Computer use: piloto DEVE preferir tools do MCP ("braço antes do mouse") e usar clique/print só como último recurso; com allowlist inicial para não interromper. [OBS] dia 69. Browser interno/Jarvis: fora de escopo.
- **RF-02.105** Impor "sempre mostrar a operação": logs do worker acessíveis no pane. [OBS] dia 28

## 5. Modelo de dados

Persistência: [DEC] SQLite local (o original grava tokens por pane/modelo em banco local [OBS] dia 75; briefing/relatórios em arquivos .md [OBS]). Ciclo de vida: Mission vive até `closed`; Pane é descartável; handoffs e Tasks persistem.

```
Mission { mission_id:string(req, "PN"-independente, ex. "m-0007"), workspace_id:string(req), squad_id:string|null,
  mode:enum(squad|agentic)(req), style:enum(chain_of_command|control_tower|auto)|null (só agentic),
  goal:string(req), status:enum(intake|planning|running|reviewing|done|failed|aborted)(def intake),
  pilot_pane_id:int(req), gates:[Gate], created_at, closed_at|null, cost:CostSummary }
Gate { gate_id, key:enum(direction|content|build|qa|custom), question_set:[Question], status:enum(pending|approved|rejected) }
Pane { pane_id:int(req, único, nunca reutilizado), mission_id|null, role:SquadRole|null, is_pilot:bool(def false),
  pilot_successor:pane_id|null, provider:string, account_id:string, model:string, effort:string|null,
  state:enum(spawning|idle|working|awaiting_user|blocked|closed), spawned_by:pane_id|null, respawn_of:pane_id|null,
  cli:string, tokens_in:int, tokens_out:int }
Task { task_id:string, mission_id, parent_task_id|null, title, briefing_path:string(req), role:SquadRole,
  status:enum(open|claimed|delivered|validated|discarded)(def open), assignee_pane_id|null, planned_agent, executed_agent|null,
  handoff_id|null, cost:CostSummary }
Handoff { handoff_id, task_id, from_pane_id, to_pane_id, summary:string(req,<=400), report_path:string(req),
  status:enum(ok|partial|failed), created_at }
Squad { squad_id, slug, name, roles:[SquadRoleSlot], recipe_id|null, factory:bool }
SquadRoleSlot { role:SquadRole, agent_id, min:int(def 1 p/ orchestrator; 0 demais), max:int|null }
Agent { agent_id, slug, name, role:SquadRole(req), cli_options:[{cli, model, effort}](>=1),
  skills_allow:[skill_slug], tools_allow:[tool_name], system_prompt_path|null }
CostSummary { tokens_in, tokens_out, wall_seconds, est_cost:number, currency:enum(BRL|USD)(LAC), executor_vs_planned_mismatch:bool }
```
SquadRole enum: `orchestrator | executor | scout | reviewer` [OBS dia 33]; `planner`, `builder` [OBS dias 24, 28, 44 como cargos posteriores] — [DEC] aceitos como valores válidos, mapeando `planner`→orquestração interna e `builder`→`executor` no squad de fábrica.

Invariantes: 1 piloto por Mission; `pane_id` nunca reutilizado; `Task.status=validated` exige Handoff `ok` de reviewer; `Handoff.summary ≤ 400`; `Task` descartada preserva `cost`. [OBS/DEC conforme RFs]

Exemplo Handoff:
```json
{"handoff_id":"h-42","task_id":"t-157.3","from_pane_id":351,"to_pane_id":325,
 "summary":"Hero animado implementado; build ok; 0 erros de console.","report_path":".overclock/missions/m-7/reports/t-157.3.md","status":"ok"}
```

## 6. Interfaces

### 6a. UI/UX
- **Seletor de modo** (livre / squad / agêntico) ao abrir atividade [OBS dia 49]. Botão "Iniciar missão" de squad no workspace [OBS dia 33].
- **Wizard de missão de squad**: lista cargos com dropdown de agente (só do cargo), LLM ao lado do cargo, logo da CLI, "cadeado" (troca todas as CLIs). [OBS]
- **Painel do piloto** fixo à esquerda; workers em grade à direita; ID do pane (ex.: "PN 325") + rótulo `missão · cargo`; contador de custo/tokens por painel; badge de piloto; realce de pane aguardando resposta do usuário; mascote por cargo. [OBS dias 33, 44, 61, 75]
- **Intake**: cartões de pergunta clicáveis (não texto solto). [OBS dia 61]
- **Aviso amarelo** de refresh de sessão do piloto. [OBS dia 75]
- Botão "copiar" no pane que copia o prompt inteiro. [OBS dia 51]
- Atalhos: [LAC] não documentados; [DEC] sem atalhos no MVP.

### 6b. API interna / eventos (IPC main↔render↔sidecar)
[DEC] barramento de eventos JSON; nomes snake_case.
- `mission.created {mission_id, mode, style}` · `mission.gate_updated {mission_id, gate_id, status}` · `mission.closed {mission_id, status}`
- `pane.spawned {pane_id, mission_id, role, provider, model, spawned_by}` · `pane.state_changed {pane_id, from, to}` · `pane.closed {pane_id, reason: done|user|error|limit}`
- `handoff.submitted {handoff_id, task_id, from_pane_id, to_pane_id}` · `wake.queued {to_pane_id, handoff_id}` · `wake.delivered {to_pane_id}`
- `task.updated {task_id, status}` · `cost.updated {scope: pane|task|mission, id, tokens_in, tokens_out, est_cost}`
- `pilot.respawned {pane_id, reason: account_switch|refresh|move_session}`
Erros comuns: `forbidden_role`, `gate_pending`, `not_in_mission`, `provider_disabled`, `pane_not_found`, `handoff_missing`, `limit_reached`.

### 6c. Tools MCP internas (piloto)
[LAC] O original tem ≈52-54 tools no sidecar sem lista completa (dias 69, 71); comandos citados: `agent invoke`, `handoff submit`, listar providers/models, abrir/ler painel, enviar prompt, listar painéis da missão, `headline pick`, `memory search`. Nomes/esquemas abaixo são [DEC], compatíveis com esses verbos.

| Tool | Entrada (JSON) | Saída | Erros |
|---|---|---|---|
| `provider_list` | `{}` | `[{provider, cli, accounts:[...], enabled}]` só habilitados [OBS 65] | — |
| `model_list` | `{provider}` | `[{model, effort_levels}]` | `provider_disabled` |
| `pane_spawn` | `{provider, model?, account_id?, role?, briefing_path, agent_id?}` (prompt via argv) | `{pane_id}` (sem eco) | `provider_disabled`, `gate_pending`, `forbidden_role`, `limit_reached` |
| `pane_send` | `{pane_id, text, submit:bool=true}` | `{ok}` | `pane_not_found` |
| `pane_read` | `{pane_id, last_lines?:int=200}` | `{text, state}` | `pane_not_found` |
| `pane_close` | `{pane_id}` | `{ok}` | — |
| `mission_panes_list` | `{mission_id?}` | `[{pane_id, role, state, task_id}]` [OBS 58-59] | `not_in_mission` |
| `agent_invoke` | `{agent_id, task_id}` (= pane_spawn com spec do agente lida a cada invocação [OBS catálogo]) | `{pane_id}` | idem `pane_spawn` |
| `handoff_submit` (tool do **worker**) | `{task_id, summary(<=400), report_path, status}` | `{handoff_id}` | `handoff_missing`, `summary_too_long` |
| `task_create/claim/update/get/list` | schemas por [[spec-12-overclick]] | — | — |
| `mission_complete` | `{mission_id}` | `{ok}` | `reviewer_required` |
| `headline_pick` | `{providers?}` | conta recomendada | [[spec-03-harness-roteamento-decisor]] |
| `memory_search` | só modo agêntico | [[spec-06-over-memory]] | ausente em free/squad |

Escopo por token: cada Pane recebe token MCP com `mission_id`, `role` e `tools_allow`; tools fora da lista não são listadas. [DEC] (o original filtra "pelo escopo do token do worker" — [OBS] dia 49 para memória).

### 6d. CLI/protocolos externos
- CLIs-worker: Claude Code, Codex, Gemini/Antigravity (`agy`), Grok, Kimi, OpenCode, Cursor CLI, Copilot etc.; sem API key (login/assinatura da CLI). [OBS] mód. 02 "Stack"
- Hooks Claude Code: `Stop` (x2), `PostToolUse`, `SessionStart`. [OBS] dia 51
- Briefing/relatórios: arquivos `.md` em `.overclock/missions/<mission_id>/` [DEC caminho].

## 7. Fluxos e algoritmos

### 7.1 Delegação (fluxo base)
1. Piloto chama `pane_spawn{provider, briefing_path}` → sistema valida gate/papel/limite; cria Pane com `mission_id`, `role`; monta comando da CLI com prompt em argv + hooks (stop×2, post-tool-use, session-start) + whitelist; emite `pane.spawned`.
2. Worker lê briefing (session-start), executa; grava relatório; chama `handoff_submit`.
3. Post-tool-use: confirma `report_path` existe → grava Handoff → enfileira `wake` ao piloto → entrega no próximo ponto seguro.
4. Stop hook: se o worker tenta parar sem handoff → devolve erro; repete até `max_stop_retries` ([DEC] 3) → então `pane.closed{reason:error}`, `Handoff.status=failed`.
5. Sistema fecha o Pane (a menos que o piloto peça manter); piloto lê resumo (≤400) e abre relatório só se preciso.
[OBS] dia 51 (passos 1-4); limite de retries [DEC].

### 7.2 Máquina de estados do Pane
| Estado \ Evento | spawn_ok | prompt_sent | worker_stop | handoff_ok | user_close | limit_hit |
|---|---|---|---|---|---|---|
| spawning | idle/working | working | — | — | closed | blocked |
| working | — | working | (stop hook) working se sem handoff | idle→closed | closed (respawn se piloto) | blocked |
| idle | — | working | — | closed | closed | blocked |
| blocked | — | — | — | — | closed | — |
| closed | terminal | | | | | |
[DEC] tabela; estados `awaiting_user` [OBS dia 61 realce].

### 7.3 Máquina de estados da Mission
`intake` —gates aprovados→ `planning` —plano aprovado→ `running` —todos cards delivered→ `reviewing` —reviewer ok→ `done`. Qualquer estado —falha irrecuperável→ `failed`; —usuário→ `aborted`. Reviewer reprova → `running` (novo ciclo). [DEC] (regra do reviewer obrigatório é [OBS] dia 33).

### 7.4 Modo agêntico (chain_of_command)
1. Usuário dá o objetivo. 2. Piloto faz intake (perguntas: para quem, dor, o que fica de fora). 3. Abre 2-4 scouts em paralelo. 4. Planeja em ondas (produto, arquitetura), corta em épicos e cards com contrato. 5. Por onda, cria um worker por card; workers usam skills filtradas do cargo. 6. Reviewer valida. 7. Aprovação de portões pelo usuário. [OBS] dia 75; chefes: scout explora repo, builder escreve, reviewer/executor testa [OBS dia 44].
**control_tower**: orquestrador conversa; a cada "pode despachar isso" a torre cria Task .md e despacha ao chefe/worker. [OBS dia 65]

### 7.5 Escolha de time / modelo
Delegada ao Decision de [[spec-03-harness-roteamento-decisor]]. Regra-guia observada: orquestrador = modelo mais caro; executores = faixa média; nunca executor = modelo topo (ex.: proibidos como executor: Fable/Astra, dia 79); revisor ≠ executor. Quatro níveis de harness (dia 67): 1 LLM p/ tudo; 1 LLM por categoria numa conta; idem com filtro de skills; 1 LLM por tipo de atividade em várias contas. [OBS]

### 7.6 Respawn e piloto persistente
Respawn de worker: novo `pane_id`, `respawn_of=antigo`, mesmo briefing. Piloto: `respawn_pilot(pane_id, new_account)` reinicia o processo mantendo `pane_id`, injeta handoff da missão; se sem conteúdo persistido → aviso amarelo (RF-02.81). [OBS dias 61, 75]

### 7.7 Casos-limite
- Worker morre/fecha sem handoff → `pane.closed{user|error}`; piloto decide respawn. - Dois workers editando o mesmo arquivo → contratos de fase 0 + um arquivo por sessão/painel ("colisão zero por construção", [OBS] dia 79); detecção automática [LAC]. - Provider sem hook → watcher (RF-02.28). - Orquestrador que constrói tudo sozinho (dia 29): DEVERIA existir guarda que bloqueia escrita de código do piloto em missão agêntica — [DEC] whitelist do piloto sem Edit/Write fora de `.overclock/`.

## 8. Prompts e textos embutidos

O material NÃO traz os prompts de sistema literais do piloto/skill "OC pilot" (só trechos falados). [LAC] Abaixo: trechos observados (verbatim/quase) e prompt-base [DEC].

**Observados:**
```
Abre um pen e pergunta para ele quanto é 1 mais 1.          # teste de latência, dia 51
Orchestrator não pode declarar done sem passar pelo reviewer, que é o último passo obrigatório.   # reforço, dia 33
Se o cara finalizou a atividade ... você precisa dar continuidade e não esperar o retorno de todos. Você não deve ficar em idle; ... não pode ficar working.   # dia 30
Para cada item uma subtask com um agente que resolve e outro que verifica.   # dia 30
Todas as atividades delegadas usam a conta um; a conta dois é exclusiva para o Fable 5.   # dia 44
Quero fazer um site  /  Sem gates, faz a criação de um site experimental qualquer, rápido  # testes de intake, dia 61
Vamos testar a plataforma com um teste AB ... sem instruções específicas de uso do MCP, porque ele precisa conseguir usar o MCP sozinho.  # dia 33
cria um site de página única pro overclock, app desktop que roda vários agentes em paralelo num só workspace, tema escuro, vermelho de destaque, responsivo, nível de produção, com hero, features, planos Boost e Pro e footer.   # briefing A/B, dia 33
```
Skill do executor (paráfrase): "execute o card X e chame handoff submit; instruções detalhadas estão no card" [OBS dia 64].

**Prompt-base do piloto [DEC]:**
```
Você é o PILOTO da missão {mission_id}. Você planeja e delega; NÃO escreve código do produto.
1) Faça o intake: pergunte (para quem, qual dor, o que fica de fora) e aguarde os gates aprovados.
2) Divida o trabalho em tasks com contrato (o que fazer, por que, como será confirmado) em arquivos .md.
3) Delegue com pane_spawn/agent_invoke apenas para agentes do squad; um worker por task.
4) Quando um worker entregar (handoff), continue sem esperar os demais. Enquanto aguarda, fique ocioso.
5) Nunca declare done sem handoff ok do reviewer. Nunca use o mesmo modelo para executar e revisar.
```
**Prompt-base do worker [DEC]:** "Leia {briefing_path}. Execute somente o contrato. Grave o relatório em {report_path}. Finalize SEMPRE chamando handoff_submit (resumo ≤ 400 caracteres). Não termine o turno sem isso."

## 9. Requisitos não-funcionais

- **Latência de delegação** (pane_spawn→resposta ao chamador, teste 1+1): observado 37-39 s (v1.2.2, com bug de wake) → 9-11 s (dev) → "quase instantâneo" sem número [OBS dia 51]. **Meta [DEC]:** p50 ≤ 12 s, aceito ≤ 39 s como regressão.
- Abertura de painéis: 64 terminais ≈ 5 s, 32 ≈ 2 s (Overdrive, [OBS] dias 53-54; responsabilidade de [[spec-01-terminais-paineis-workspaces]]).
- **Custo/tokens**: alvos observados: -25% tokens e -20% contexto do chefe com briefing .md; orquestrado US$ ≈15 vs ≈160 (build Grêmio Arena, simulação do autor, arq. 15); Fable sozinho ≈ R$18,25 e ~2% do limite numa landing simples (dia 44). Moeda/unidade [LAC].
- Contexto do orquestrador acima de ~300k tokens fica caro em Codex/Grok [OBS dia 63-64] → DEVERIA alertar.
- **Portabilidade**: macOS/Windows/Linux [OBS]; hooks completos só no Claude Code no início — demais CLIs via watcher [DEC].
- **Segurança**: whitelist em código (não prompt) [OBS]; token MCP por pane com escopo [DEC]; MCP de observabilidade/dogfooding só em dev local [OBS dia 30]; não usar API keys, só login da CLI [OBS].
- **Privacidade**: relatórios/briefings locais; nada enviado ao Overclock (ele não gasta tokens) [OBS dia 76].
- **Observabilidade**: eventos da seção 6b; log de decisão por delegação (qual agente/modelo/conta, por quê) [DEC]; sempre painel visível [OBS].
- **Confiabilidade**: pane recovery após Cmd+R (processo no main; render recuperável) [OBS dia 22].

## 10. Stack sugerida e restrições

Original [OBS]: Electron com PTY (main process), dia 44/66 menção a Tauri/Rust; MCP sidecar; hooks do Claude Code; handoff em .md; Overclick MCP. Alternativas neutras [DEC]: Tauri ou Electron; `node-pty`/ConPTY; MCP por stdio/HTTP local com token; SQLite; watcher de PTY por regex/idle timer para CLIs sem hooks. Restrições: CLIs devem aceitar prompt por argv (senão fallback RF-02.23); orquestrador Claude para `control_tower` no início.

## 11. Plano de implementação em fases

1. **Fase 1 (MVP)**: Pane + MCP (`provider_list`, `pane_spawn` com argv, `pane_send`, `pane_read`, `pane_close`) + `handoff_submit` + stop hooks/post-tool-use/session-start só Claude Code + modo livre com piloto fixo + eventos + latência ≤ 12 s.
2. **Fase 2**: Agent/Squad/SquadRole + whitelist por permissão + Mission com herança de ID + reviewer obrigatório + briefing .md + respawn + custo por Task (leitura do banco).
3. **Fase 3**: intake gates (Claude, depois Codex/Grok), modo agêntico `chain_of_command` e `control_tower`, piloto persistente, "cadeado", skills embarcadas, harness enriquecer, watcher para CLIs sem hooks, migração manual de torre.
4. **Fase 4 (planejado no original)**: migração automática por limite, sensores, Overtester, memória em anéis ([[spec-06-over-memory]]), hub de grafo, squad automático/MCP de criar squad, marketplace.
Dependências: [[spec-01-terminais-paineis-workspaces]] antes da 1; [[spec-05-catalogo-skills-mcp-hooks]] antes da 2; [[spec-03-harness-roteamento-decisor]] e [[spec-12-overclick]] antes da 3.

## 12. Casos de teste de aceitação

1. **Delegação feliz.** Dado piloto Claude em modo livre e Codex habilitado, quando pede "abre um pane e pergunta 1+1", então há Pane visível de Codex, handoff `ok` com "2", wake ao piloto e latência ≤ 12 s (medida).
2. **Stop hook.** Dado worker que responde texto e tenta parar sem handoff, então o hook devolve erro, o worker continua e só encerra após `handoff_submit`; após 3 falhas → handoff `failed`.
3. **Wake após relatório.** Dado handoff submetido, quando o wake dispara, então `report_path` já existe e é legível.
4. **Provider desativado.** Dado Kimi desativado, então `provider_list` não o inclui e `pane_spawn{provider:"kimi"}` retorna `provider_disabled`.
5. **Piloto único e cargos.** Quando o piloto chama `agent_invoke` de role `orchestrator` ou agente fora do Squad → `forbidden_role`.
6. **Reviewer obrigatório.** Dado missão sem handoff do reviewer, `mission_complete` → `reviewer_required`; com handoff ok → `done`.
7. **Intake gate.** Dado squad com gates pendentes, `pane_spawn` → `gate_pending`; após aprovar direção/conteúdo/build/QA, delegação liberada; pergunta não duplica.
8. **Whitelist hard.** Dado agente builder sem `front-design` em `skills_allow` e CLI com skip-permissions, quando tenta usar a skill, então é bloqueada em código.
9. **Respawn.** Dado usuário que fecha um worker, o piloto respawna com mesmo briefing e novo `pane_id`; `respawn_of` preenchido; ID antigo nunca reaparece.
10. **Piloto persistente.** Dado piloto no pane 325, quando troca de conta, então o pane continua 325, badge mantida, handoff reinjetado; refresh sem conteúdo → aviso amarelo.
11. **Herança de missão.** Todo worker criado tem `mission_id` e rótulo de cargo (limite: nenhum pane sem ID).
12. **Custo.** Dado worker que não autorrelata, ao concluir a Task o custo é lido do banco local; Task descartada preserva custo; dois cards no mesmo pane não somam custo do orquestrador.
13. **Limite (paralelismo).** Ao exceder `max_parallel_panes` → `limit_reached`, sem crash.
14. **A/B.** Rodar o briefing do site sem/com squad e registrar linhas, tokens, tempo e se o orquestrador usou MCP sozinho.

## 13. Questões em aberto e riscos

- [LAC] Lista completa/esquemas das tools MCP do sidecar (52-54?). Default [DEC]: tabela 6c.
- [LAC] Conteúdo exato dos 2 stop hooks. Default [DEC]: checagem de handoff + relatório.
- [LAC] Prompts de sistema literais do piloto (skill "OC pilot"), receitas de fábrica e manual de intake por CLI.
- [LAC] Algoritmo do modo `auto` e "squad automático".
- [LAC] Como saber se há relatório completo no handoff (dúvida deixada ao usuário, dia 51). Default: `report_path` obrigatório.
- [LAC] Mecanismo de canal invisível de instruções por CLI (system prompt) e paridade Codex/Grok/Kimi/OpenCode.
- [LAC] Unidade monetária de custo (US$/R$) e cálculo do custo estimado.
- [LAC] Unificação de Tesques/missão/milestones (três máquinas de estado separadas, dia 49).
- [LAC] Squads no plano Pro ou só Ultra (dias 44 vs 60-65) — spec de planos.
- Riscos: piloto que codifica em vez de delegar (dia 29); colisão de edição (dia 65); handoff perdido em CLIs sem hook; latência voltando a 39 s; Codex/Grok como piloto com falhas (dias 61, 77); dependência da CLI aceitar argv; memória em anéis não verificada.
- [DEC] mais arriscados: nomes/esquemas das tools MCP; `max_stop_retries=3` e `max_parallel_panes=8`; watcher de PTY para CLIs sem hooks.

## 14. Rastreabilidade

| Requisito | Fonte |
|---|---|
| RF-02.01-05 | mód. 02 Comportamento; dias 44, 49, 65, 66, 75, 76 |
| RF-02.10-16 | dias 24, 28, 30, 32, 33, 58 |
| RF-02.20-32 | dia 51 (arq. 41), 57, 61, 65; dia 44 (arq. 43) |
| RF-02.40-43 | dia 44 (arq. 43), 63, 64 |
| RF-02.50-57 | dia 33 (arq. 44), 53-55, 61, 66, 75 |
| RF-02.60-65 | dia 61 (arq. 30) |
| RF-02.70-73 | dia 33, 43, 49, 65, 75, 82; módulo 05 |
| RF-02.80-82 | dia 75 (arq. 16) |
| RF-02.90-92 | dia 44, 75 |
| RF-02.100-105 | dias 51, 54, 58, 63-64, 75, 69, 33, 28 |
| Modelo de dados | [DEC] baseado nas entidades observadas (dias 33, 44, 61, 63-64, 75) |
| Tools MCP | dias 49, 51, 58-59, 65, 69, 71; nomes [DEC] |
| Fases 4 | dias 49, 75; mód. 02 "Incertezas" |
