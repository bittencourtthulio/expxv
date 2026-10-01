---
spec: "Harness por tarefa, roteamento de contas e decisor (Policy, Decision engine, cofre, semáforo)"
slug: "spec-03-harness-roteamento-decisor"
modulo_fonte: ["03-harness-roteamento-decisor", "04-providers-e-modelos (contas)", "09-overclock-headline (limites)"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-02-orquestracao-modo-agentico", "spec-04-providers-e-modelos", "spec-05-catalogo-skills-mcp-hooks", "spec-06-over-memory", "spec-09-overclock-headline", "spec-14-bench"]
---
# Spec 03 — Harness por tarefa, roteamento de contas e decisor

Legenda de selos: [OBS] observado nas lives/módulos; [DEC] decisão da spec (implementar exige, material não diz); [LAC] lacuna que exige decisão do dono do produto. Fontes citadas como "mód.03 (dia N)" = `modulos-logicos/03-harness-roteamento-decisor.md`.

## 1. Resumo e objetivo

Esta spec define a "camada de inteligência de custo" do Overclock: para cada tarefa disparada pelo usuário ou pelo orquestrador, o sistema resolve **qual Provider, qual Account, qual modelo, qual esforço, quais Skills e qual Agent** executam o Pane. O conjunto é: (i) a **Policy** (tabela tipo-de-tarefa → executor, "harness por tarefa"); (ii) o **Decision engine** (decisor barato, "JEV/Jeev", que classifica a tarefa e/ou escolhe entre opções fechadas, com painel Decisões e custo visível); (iii) o **roteamento e failover entre Account/Provider** ao bater limite, com múltiplas contas por provider; (iv) o **monitor de limites** consumido do Headline; (v) o **cofre de tokens**; (vi) o **semáforo de status** do Pane. Problema resolvido: usar o modelo caro para tarefa trivial esgota a cota semanal, cota que reseta é perdida se a conta errada é usada, e o usuário não deve precisar saber "qual modelo serve para quê" [OBS] (mód.03, dias 43-44, 80-81). Tese: "o modelo não é o teto, o harness é" [OBS] (mód.03, dia 65).

## 2. Escopo e não-escopo

**Cobre:** TaskType e Policy (CRUD por UI e MCP), níveis de harness 1-4, resolução de rota (classificação → política → conta → spawn), Decision (registro, recibo, custo, painel), cliente do decisor (interface + prompt), failover/migração de sessão, cofre, semáforo, MCP `harness_*`.

**Não cobre (dono em outra spec):** ciclo de vida de Pane/PTY ([[spec-01-terminais-paineis-workspaces]]); Mission/piloto/torre/handoff ([[spec-02-orquestracao-modo-agentico]]); autenticação/CLI/catálogo de modelos ([[spec-04-providers-e-modelos]]); coleta de limites (widget/menu bar, MCP `headline`) ([[spec-09-overclock-headline]]); construção da tabela-semente a partir do bench ([[spec-14-bench]]); licenciamento e preços ([[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements)); resumo de restore ([[spec-06-over-memory]]).

**Fase 2 (planejado ou instável no original):** Arsenal + Receitas (v1.0, instável: "receita às vezes sugerida aleatória"); browser interno controlado pelo decisor (computer use); MCP do cofre; limite-como-evento e troca de conta como tool MCP (backlog 1.4, construção não confirmada); decisor local (Lia/Liquid, reprovado: 16/48); painel de bug dedicado (sem descrição no material, [LAC]).

## 3. Glossário e atores

- **Harness**: casamento LLM (motor) + CLI (carro) para a atividade; "o cara certo, com o carro certo, para a atividade certa" [OBS] (mód.03, dias 44/24). No produto = uma linha de Policy.
- **TaskType**: tipo de atividade (ex.: `bug-fix`). **Categoria** = agrupador de UI; o roteamento é por TaskType, nunca por categoria de domínio [OBS] (mód.03, "Categoria vs. tarefa", dia 04).
- **Policy**: mapa TaskType → ExecutorSpec. **Decision**: registro auditável de uma escolha. **Decider**: modelo pequeno que só escolhe entre opções fechadas. **Recibo**: texto curto exibido no Pane filho explicando quem escolheu a conta e com que confiança [OBS] (dia 80).
- **Atores:** usuário; piloto/orquestrador (agente que chama `pane_spawn`); Decider; Headline (fonte de limites); sistema (app).

## 4. Requisitos funcionais

### 4.1 TaskType e Policy
- **RF-03.01** O sistema DEVE manter uma tabela de TaskType agrupados por categoria e uma Policy que mapeia cada TaskType a um ExecutorSpec `{provider, model, effort, skills[], agent?, fallback[]}`. [OBS] (dias 80-81). *Aceite:* criar/editar linha na UI reflete-se em `harness_list`.
- **RF-03.02** A UI DEVE listar "Configurações > Harness por tarefa" com tipos e permitir criar categoria e tipo novos ao vivo (ex.: categoria `security`, tipo `pentest` em Codex GPT 6 Sol, esforço alto, com o modelo de segurança habilitado em Providers > Codex). [OBS] (dia 83). *Aceite:* categoria nova aparece sem reiniciar.
- **RF-03.03** A Policy DEVE ser editável por UI e por MCP (`harness_set`). [OBS] (dias 62-65, "harness list/recommend/set"). *Aceite:* mesma mutação via ambos gera o mesmo estado.
- **RF-03.04** O sistema DEVE fornecer Policy-semente derivada do bench e de benchmarks públicos, apenas como sugestão inicial editável. [OBS] (mód.03 "Origem da tabela"). A tabela completa NÃO é conhecida [LAC]; a semente da §5.5 é [DEC] e deve ser recalculada por [[spec-14-bench]].
- **RF-03.05** A Policy DEVERIA ter escopo global com override por Workspace (`workspace_id` opcional). [DEC] (o material cita "fixar conta por workspace", não policy por workspace; escolha mais simples e coerente).
- **RF-03.06** `harness_set` DEVE rejeitar (erro `executor_disabled`) executor cujo Provider/modelo esteja desativado na UI, e a resolução DEVE cair no `fallback` em vez de apenas avisar; fallback padrão = Opus 5. [OBS] (dia 65). Providers desativados NÃO DEVEM aparecer em `harness_list/recommend`. *Aceite:* CT-06.
- **RF-03.07** Modelos novos detectados por [[spec-04-providers-e-modelos]] (ex.: novo modelo Codex) DEVEM ficar disponíveis para a Policy sem ação manual, podendo ser desativados/ordenados. [OBS] (arquivo 01, pós-dia 84).
- **RF-03.08** O usuário PODE definir preferência ordenada por TaskType (1º modelo X, 2º Y), tratada como lista `[executor_principal, ...alternates]`. [OBS] (dia 73: "1º Sol, 2º Terra"). *Aceite:* se o 1º está esgotado o 2º é usado.

### 4.2 Níveis de harness
- **RF-03.10** O sistema DEVE expor `harness_level` (1-4) como configuração de Workspace, com o comportamento da §7.6; o produto DEVE implementar o nível 4 como alvo. [OBS] (dia 67); mecânica por nível [DEC].
- **RF-03.11** O harness automático (níveis 3-4 com decisor/roteamento) DEVE exigir Entitlement `harness_auto` (plano Ultra); sem ele, valem níveis 1-2 manuais. [OBS] ("harness automático exclusivo Ultra", dias 44/81); nome do entitlement [DEC].

### 4.3 Decision engine
- **RF-03.20** O sistema DEVE oferecer "Configurações > Decisões" com tudo **desligado por padrão**; controles: provider/chave (OpenRouter), habilitar decisor para (a) escolha de conta, (b) modelo/esforço por TaskType, (c) classificação de TaskType, (d) [fase 2] ações no browser interno; mostrar custo acumulado. [OBS] (dia 80). *Aceite:* instalação nova não faz nenhuma chamada ao decisor.
- **RF-03.21** Toda invocação do decisor DEVE gerar uma Decision persistida com opções, probabilidades, escolha, `source` e custo. [DEC] (necessário para "sempre mostrar o custo" [OBS] e para registrar divergências, motivadas pelo bug do dia 80).
- **RF-03.22** O decisor DEVE ser abstrato (`DeciderClient`, §6.b) com três tipos de pergunta: `choice`, `score`, `boolean`. [OBS] (mód.03, dia 80). Implementação padrão: modelo de decisão via OpenRouter [OBS]; identidade exata do modelo/endpoint [LAC].
- **RF-03.23** O decisor NÃO DEVE inventar opção fora do conjunto fornecido; resposta inválida é descartada e o fallback determinístico é usado. [OBS] ("JEV não inventa opção nova") + tratamento [DEC].
- **RF-03.24** A UI DEVE mostrar custo acumulado (moeda local + USD) e contagem de consultas; custo por decisão ~USD 0,0002 é referência. [OBS] (dia 80: R$ 0,59 no dia; "127 consultas, 5 centavos"). Câmbio e apresentação [DEC].
- **RF-03.25** O sistema DEVERIA contar consultas/dia e exibir alerta ao passar de um limiar configurável (default 1000/dia) sem bloquear. A cota grátis "~1000/dia" é fala de live não confirmada, com risco de cobrança automática no cartão via OpenRouter [OBS fraco] → [LAC]; comportamento de alerta [DEC].
- **RF-03.26** O decisor DEVE ter timeout (default 2 s [DEC]; latência observada < 1/3 s) e, ao falhar ou estar desligado, o sistema DEVE usar a regra determinística sem interromper a tarefa. [DEC]
- **RF-03.27** O sistema PODE oferecer `decider.provider = local` (modelo local); no original o local acertou 16/48 contra 45/48 do JEV e foi descartado. [OBS] (dia 82). Não recomendado como padrão.

### 4.4 Roteamento de contas e failover
- **RF-03.30** O sistema DEVE permitir N Accounts por Provider (observado 5-7; exemplo Antigravity com várias contas Gemini Pro), cada uma com diretório/login próprio. [OBS] (dias 55, 84; mód.04). Nota: multi-conta Antigravity foi reprovado no dia 75 (logou sempre na mesma conta) [OBS]; comportamento por Provider é responsabilidade de [[spec-04-providers-e-modelos]].
- **RF-03.31** Ao abrir Pane sem conta explícita, o sistema DEVE escolher a conta pela regra: entre as contas do provider **não esgotadas**, a que **termina (reseta) primeiro**; usar outra só se a melhor estiver com 100% da cota usada. [OBS] (dias 80-81; as duas formulações do fundador são compatíveis, ver §7.3). *Aceite:* CT-01, CT-02.
- **RF-03.32** Contas PODEM ser reservadas a modelos/papéis (ex.: conta 2 exclusiva para Fable 5; conta 2 dedicada ao bot de chat) e fixadas por Workspace. [OBS] (dias 44, 71, 75).
- **RF-03.33** Modelos esgotados (na conta escolhida ou em todas) DEVEM aparecer "apagados" e desabilitados nos seletores. [OBS] (dia 81: Fable 5.1 esgotado, Sonnet 5.5 ativo). *Aceite:* CT-09.
- **RF-03.34** Ao bater limite em Pane em execução, o sistema DEVE oferecer ação manual "mover" (migra a sessão para outra conta) e, com `auto_failover=true`, executá-la automaticamente. [OBS] (dias 55, 58 manual; 1.4 automático em beta). Padrão de `auto_failover`: `false` [DEC] (beta no original).
- **RF-03.35** A migração DEVE criar novo Pane na conta/provider-alvo com brief de restore de [[spec-06-over-memory]]; o "pensamento" da sessão NÃO é preservado (limitação declarada). [OBS] (dia 84); reler handoff completo e re-briefar workers (v1.0, dia 44).
- **RF-03.36** O failover DEVE seguir: outra conta do mesmo provider → próximo executor da lista `fallback` da Policy → erro `no_capacity` com mensagem à UI. Máx. 2 saltos por tarefa e cooldown para evitar ping-pong. [DEC]
- **RF-03.37** Limite atingido DEVERIA ser emitido como evento (`limit_reached`) e a troca de conta exposta como tool MCP (`account_switch`). [OBS como backlog 1.4, dia 75; construção não confirmada] → fase 2 aqui; contrato definido em §6.

### 4.5 Skills por tarefa e delegação
- **RF-03.40** O Pane aberto por resolução DEVE receber **somente** as Skills do ExecutorSpec via flag `allow skills` do Claude Code (ex.: `bug-fix` não vê skill de design). [OBS] (dias 81-82). Para CLIs sem equivalente, a restrição é [LAC] → [DEC]: injetar lista no prompt inicial e registrar `skills_enforced=false` na Decision.
- **RF-03.41** O modo agêntico DEVE rotear `pane_spawn` sem provider/modelo explícitos pelo fluxo da §7.1 e devolver o recibo. [OBS] (dias 80-81). *Aceite:* CT-03.

### 4.6 Cofre
- **RF-03.50** "Configurações > Cofre" DEVE guardar tokens/segredos criptografados (AES-256) em pasta oculta `.overclock` local, com escopo por Workspace ou global. [OBS] (dia 55).
- **RF-03.51** Entradas marcadas `sensitive` (modo broker) NÃO DEVEM entrar no ambiente de nenhum Pane; só o processo principal as usa. [OBS] (dia 55). Mecanismo de uso [DEC] (§7.7).
- **RF-03.52** A chave OpenRouter do decisor DEVERIA residir no cofre. [DEC] (coerência).
- **RF-03.53** MCP do cofre (agente descobre onde buscar credenciais) — fase 2 [OBS: planejado, dia 55]; NUNCA retornar valor de entrada `sensitive`. [DEC]

### 4.7 Semáforo
- **RF-03.60** Cada Pane DEVE exibir sinaleira: verde = pronto, amarelo = trabalhando, vermelho = aguardando o usuário; substitui a bolinha azul fixa. [OBS] (dias 80-81). Botão de pausa DEVE descartar o prompt pendente. [OBS]
- **RF-03.61** Com `bypass_permissions` ativo o Pane NÃO fica vermelho por permissão; perguntas forçadas o deixam vermelho. [OBS] (dia 80, teste "teste semáforo"). *Aceite:* CT-10.

### 4.8 Limites (consumo)
- **RF-03.70** O roteador DEVE consumir de [[spec-09-overclock-headline]] os limites por Account (`get_limits`) e exibi-los no topo do app (embutido; Mac no topo, Windows embaixo à direita). [OBS] (dia 75 backlog; dia 81 entregue como barra). Sem dado de limite para uma conta, ela entra com `unknown` e é rebaixada na ordenação (§7.3). [DEC]

## 5. Modelo de dados

Persistência: SQLite local do app [OBS "SQLite/IPC do app"]; cofre em arquivo cifrado separado. Datas ISO-8601 UTC.

### 5.1 TaskType
| campo | tipo | obrig. | default/invariante |
|---|---|---|---|
| slug | string kebab | sim | único |
| category | string kebab | sim | agrupador de UI |
| label | string | sim | |
| builtin | bool | sim | `false` para criados pelo usuário |
| description | string | não | usada no prompt do classificador |

### 5.2 Policy / ExecutorSpec
```json
{
  "task_type": "bug-fix",
  "workspace_id": null,
  "executor": {"provider": "claude-code", "model": "sonnet", "effort": "high",
               "skills": ["protocol"], "agent": null},
  "alternates": [{"provider": "codex", "model": "gpt-terra", "effort": "high"}],
  "fallback": [{"provider": "claude-code", "model": "opus-5", "effort": "high"}],
  "account_policy": {"pin_account_id": null, "avoid_reserved": true},
  "enabled": true, "updated_at": "2026-09-29T12:00:00Z", "updated_by": "user|mcp|seed"
}
```
Invariantes: `(task_type, workspace_id)` único; `executor.provider` habilitado (RF-03.06); `effort` ∈ enum do provider (spec-04); `skills` ⊂ catálogo instalado ([[spec-05-catalogo-skills-mcp-hooks]]); `fallback` nunca vazio (default `[opus-5]` [OBS dia 65]). Exemplo do dia 81: bug-fix = Claude Sonnet, esforço alto, skill de protocolo [OBS].

### 5.3 Account (extensão de [[spec-04-providers-e-modelos]])
Campos usados aqui: `account_id`, `provider`, `label`, `enabled`, `reserved_for?: {models[]|roles[]}`, `pinned_workspaces[]`, `auth_state ∈ {ok, expired, unknown}`, `vault_ref?`.

### 5.4 LimitSnapshot (vindo do Headline; não persistido além de cache de 60 s [DEC])
```json
{"account_id":"acc_claude_2","fetched_at":"...","windows":[
  {"name":"5h","used_pct":88,"resets_at":"2026-09-29T15:00:00Z"},
  {"name":"weekly","used_pct":68,"resets_at":"2026-10-03T00:00:00Z"}],
 "model_buckets":{"fable-5.1":{"used_pct":77}}}
```
Janelas observadas: 5 h, semanal, mensal (Cursor) [OBS] (mód.09). Baldes por modelo (Fable, Spark, Luna com cota separada) [OBS] (mód.04/03).

### 5.5 Decision
```json
{"decision_id":"dec_01","ts":"...","kind":"choice","purpose":"account_selection|task_type|model_effort|browser_action",
 "workspace_id":"ws_1","pane_id":"pane_9","options":[{"id":"acc_claude_1","features":{}},{"id":"acc_claude_2","features":{}}],
 "probs":{"acc_claude_1":0.38,"acc_claude_2":0.62},"chosen":"acc_claude_2","confidence":0.62,
 "source":"decider|rule|policy|explicit|fallback","rule_choice":"acc_claude_2","diverged":false,
 "latency_ms":280,"cost_usd":0.0002,"decider":{"provider":"openrouter","model":"<cfg>"},"receipt":"..."}
```
Invariantes: `chosen ∈ options`; `diverged = (source=="decider" && chosen != rule_choice)`; retenção 90 dias, agregados de custo permanentes [DEC].

### 5.6 DeciderSettings (singleton)
`enabled=false`, `provider ∈ {openrouter, local, off}` default `openrouter`, `model` (string, [LAC]), `use_for:{account:false, model_effort:false, task_type:false, browser:false}`, `min_confidence=0.5` [DEC], `timeout_ms=2000` [DEC], `daily_alert=1000`, `api_key_ref` (cofre).

### 5.7 WorkspaceRoutingSettings
`harness_level=4` (sujeito a entitlement), `auto_failover=false`, `account_selection_mode ∈ {rule, decider}` default `rule` [DEC: o decisor divergiu da regra em 1 caso, dia 80], `exhaustion_threshold_pct=100` [OBS "100% de cota usado"].

### 5.8 VaultEntry
`entry_id`, `name` (UPPER_SNAKE), `scope ∈ {global, workspace}`, `workspace_id?`, `sensitive: bool`, `ciphertext` (blob), `nonce`, `created_at`, `last_used_at`. Valor nunca é logado nem gravado em Decision. Cifra: AES-256 [OBS]; GCM + chave-mestra no keychain do SO [DEC].

### 5.9 Fase 2: ArsenalItem e Recipe
`ArsenalItem{kind ∈ {skill, agent, provider, media}, ref, role ∈ {scout, builder, reviewer}?}`; `Recipe{recipe_id, name, steps[{agent, skills[], task}], favorite_model?}`. [OBS] (dia 44: "enriquecer" categoriza scout/builder/reviewer; 37 agentes e 23 skills embutidos; receitas: landing premium, site cardápio, curta cinematográfica, reels a partir de YouTube, ebook lead magnet, squad de pesquisa de segurança, marketing full funnel). Detalhes de execução [LAC].

**Semente da Policy [DEC]** (valores voláteis; marcar `updated_by:"seed"`): `bug-fix`→Sonnet/high/skill protocolo [OBS ex. dia 81]; `bug-deep`→Fable 5.1 [OBS arq. 17]; `bug-normal`→GPT 5.6 [OBS arq. 17]; `front`→Kimi K3 [OBS dia 70]; `pentest`→Codex GPT 6 Sol/high [OBS dia 83]; `orchestration`→Fable [OBS]; `review`→Luna [OBS mód.04]; demais tipos observados (`feature`, `tooling`, `release`, `build`, `investigation`, `analysis`, `doc`, `process`, `design-dna-page`, `refactor`, `contract`, `fleet-triage`, `showcase`, `visual-fix`, `publication`, `page-copy`) sem valores → [LAC], default [DEC] = modelo intermediário do provider preferido do usuário.

## 6. Interfaces

### 6.a UI/UX
1. **Harness por tarefa** (Configurações, canto superior direito): tabela agrupada por categoria; colunas TaskType, Provider/modelo, Esforço, Skills (multi), Agente, Contas (pin), Fallback; botões "+ categoria", "+ tipo", "restaurar semente", "sugerir pelo bench". Linha com executor desativado fica destacada e bloqueia salvar (RF-03.06).
2. **Decisões**: toggles (todos off); campo de chave OpenRouter com atalho "ir para chaves"; toggles por uso; contador "N consultas · custo acumulado (R$ x / US$ y)"; lista das últimas Decisions com recibo, confiança, `diverged`; alerta de cota diária.
3. **Providers > contas**: seta "adicionar conta"; por conta: label, pin de Workspace, reserva de modelo, barra de limite.
4. **Barra de limites no topo**: por Account, janelas 5 h/semanal com % e tempo até zerar; modelos esgotados apagados (RF-03.33).
5. **Pane**: sinaleira (círculo verde/amarelo/vermelho); botão pausa; botão "mover" (menu de contas-alvo) ao bater limite; recibo colapsável na primeira mensagem do Pane filho. Quatro temas visuais testados; escuro escolhido [OBS dia 80].
6. **Cofre**: lista de entradas (nome, escopo, badge "sensível"), criar/editar/apagar; valor mascarado, "copiar" desabilitado para `sensitive`.
Textos: recibo `"Conta escolhida por {source} com {confidence}% de confiança. Folga medida pelo headline: {used_pct}% usado na janela {window}."` [OBS modelo de fala, dia 80; template exato [DEC]].

### 6.b API interna / eventos
**`Router.resolve(req) -> RouteResult`** (síncrono, < 3 s no pior caso)
```json
// req
{"workspace_id":"ws_1","origin":"pilot|user|mcp","prompt":"corrigir botão da home","task_type":null,
 "explicit":{"provider":null,"model":null,"effort":null,"account_id":null,"skills":null,"agent":null},
 "mission_id":null,"parent_pane_id":"pane_1"}
// RouteResult
{"executor":{"provider":"claude-code","model":"sonnet","effort":"high","skills":["protocol"],"agent":null},
 "account_id":"acc_claude_2","task_type":"bug-fix","decisions":["dec_01","dec_02"],
 "sources":{"task_type":"decider","executor":"policy","account":"rule"},"receipt":"...","warnings":[]}
```
Erros: `entitlement_required`, `executor_disabled`, `no_capacity`, `unknown_task_type`, `provider_unavailable`.

**`DeciderClient.ask(q) -> A`**
```json
// q (choice)
{"kind":"choice","purpose":"task_type","context":{...},"question":"...","options":[{"id":"bug-fix","description":"..."}]}
// q (score): {"kind":"score","rubric":["ruim","ok","bom"],"subject":"..."}
// q (boolean): {"kind":"boolean","question":"..."}
// A
{"probs":{"bug-fix":0.93,"feature":0.05},"choice":"bug-fix","confidence":0.93,"latency_ms":280,"cost_usd":0.0002,"raw_model":"..."}
```
**Eventos (barramento do app):** `decision_made{decision}`, `limit_reached{pane_id,account_id,window}`, `account_switched{pane_id,from,to,reason:"manual|auto"}`, `pane_status_changed{pane_id,status:"ready|working|waiting_user",cause}`, `policy_changed{task_type,by}`, `vault_entry_changed{entry_id}` (sem valor).

**Dependências consumidas:** `Headline.get_limits(account_id[]) -> LimitSnapshot[]` (spec-09); `Providers.list_accounts(provider)`, `Providers.list_models(provider, enabled_only)`, `Providers.launch(account_id, model, effort, allow_skills[])` (spec-04); `Panes.spawn(...)`, `Panes.status_hooks` (spec-01); `Memory.restore_brief(pane_id)` (spec-06); `Entitlements.has("harness_auto")` (spec-17).

### 6.c Tools MCP (servidor `overclock`)
Nomes observados: `harness list/recommend/set` [OBS dia 65]; forma snake_case e schemas [DEC].

**`harness_list`** — entrada `{workspace_id?: string, category?: string}`; saída `{task_types:[{slug,category,label,executor,alternates,fallback,enabled}]}`. Só providers habilitados. Erros: `not_found`.

**`harness_recommend`** — entrada `{task_description: string (req), workspace_id?: string}`; saída `{task_type, confidence, executor, account_id?, source:"decider|heuristic"}`. Não cria Pane. Se decisor off, usa heurística (§7.2 passo 3b).

**`harness_set`** — entrada
```json
{"type":"object","required":["task_type"],"properties":{"task_type":{"type":"string"},"category":{"type":"string"},
 "workspace_id":{"type":"string"},"provider":{"type":"string"},"model":{"type":"string"},
 "effort":{"type":"string"},"skills":{"type":"array","items":{"type":"string"}},"agent":{"type":"string"},
 "fallback":{"type":"array"}}}
```
Saída `{policy}`. Erros: `executor_disabled`, `unknown_skill`, `invalid_effort`, `entitlement_required`.

**`pane_spawn`** (definido em spec-01; aqui só o parâmetro adicional) `route:"auto"|"none"` default `auto` se `harness_level>=3`; retorna também `receipt` e `decisions[]`.

**`account_switch`** [fase 2] — `{pane_id:string, target_account_id?:string, reason?:string}` → `{new_pane_id, from, to}`; erros `no_capacity`, `not_at_limit` (se `force` ausente), `provider_mismatch`.

**`decisions_list`** — `{since?:iso, purpose?:string, limit?:int<=200}` → `{decisions[], totals:{count,cost_usd}}`.

**`vault_list`** [fase 2] — `{workspace_id?}` → `{entries:[{name,scope,sensitive}]}` (nunca valor); **`vault_get`** só para `sensitive=false`, erro `sensitive_denied`.

### 6.d CLI/protocolos externos
- Chamada do decisor: HTTP para OpenRouter (`chat/completions` compatível OpenAI) com chave do usuário [OBS: acesso via chave OpenRouter]; endpoint do modelo JEV específico [LAC].
- `allow skills`: flag do Claude Code para restringir skills [OBS] (nome literal da flag no CLI [LAC]; consultar CLI instalado).
- Sinais de status: hooks do Claude Code (`Notification`, `Stop`, `UserPromptSubmit`) e heurística de saída PTY para outros CLIs. [DEC] (o original não descreve o mecanismo).

## 7. Fluxos e algoritmos

### 7.1 Resolução de rota (delegação)
1. Checar Entitlement `harness_auto`; sem ele e `route=auto` → `entitlement_required` ou executar com `explicit`. [DEC]
2. **Explícito vence:** campos de `req.explicit` preenchidos nunca são sobrescritos. [DEC]
3. **Classificar TaskType:** se `req.task_type` dado, usar (`source=explicit`). Senão: (a) se decisor habilitado para `task_type` → `ask(choice)` sobre os TaskType habilitados (prompt §8.1); aceitar se `confidence >= min_confidence` [OBS: decisor classifica "por probabilidade", ex. 100% para fix de bug]. (b) Senão/falha → heurística por palavras-chave sobre `prompt` [DEC] → senão TaskType `general` (semente: executor intermediário) [DEC].
4. **Policy:** carregar `(task_type, workspace_id)` senão global. Montar candidatos `[executor, ...alternates, ...fallback]`. Descartar os com provider/modelo desativado ou modelo sem capacidade (§7.3). Se o decisor de modelo/esforço estiver habilitado e houver >1 candidato viável no nível "principal+alternates", `ask(choice)` (prompt §8.2) restrito a eles; senão o primeiro viável (`source=policy`).
5. **Conta:** §7.3 sobre contas do provider escolhido. Se nenhuma → próximo candidato; esgotados todos → `no_capacity`.
6. **Skills:** `skills = executor.skills ∩ instaladas`; aplicar `allow skills` (RF-03.40).
7. Persistir Decision(s), montar recibo, chamar `Panes.spawn`, emitir `decision_made`.

### 7.2 Classificação — regra de decisão
`chosen = argmax(probs)`; se `confidence < min_confidence` → heurística/`general`, registrando `source=fallback`.

### 7.3 Escolha de conta
Entrada: contas `A` do provider (habilitadas, `auth_state=ok`, não reservadas a outro papel, respeitando `pin_account_id`), snapshots de limite. Para cada conta:
```
def deciding_window(acc, model):
    ws = acc.windows (+ balde do modelo, se existir)
    return max(ws, key=lambda w: w.used_pct)          # gargalo = maior % usado  [OBS mód.09 "headline pick"]
def exhausted(acc, model): return deciding_window(acc, model).used_pct >= threshold   # threshold=100 [OBS]
def key(acc): w = deciding_window(acc, model); return (w.resets_at, w.used_pct)   # termina primeiro; desempate por menor uso [DEC]
candidatos = [a for a in A if not exhausted(a, model)]
se snapshot ausente: a entra com key=(+inf) (só usada se nenhuma outra) [DEC]
regra = min(candidatos, key=key)  # conta cuja janela decisiva reseta primeiro
```
Resultado `rule_choice`. Se `account_selection_mode=decider` e habilitado: `ask(choice)` com as features (used_pct, resets_in) de cada candidato (prompt §8.3); aceitar se `confidence >= min_confidence` **e** escolha ∈ candidatos não esgotados; caso contrário `rule_choice`. Registrar `diverged`. [DEC: regra é autoridade; recorda o bug do dia 80 em que o decisor escolheu a conta que terminava por último, 38% de confiança.]
Nota de reconciliação: dia 81 ("termina primeiro; se ambas têm crédito, a que terminar mais rápido") e dia 80 ("só escolher o outro se 100% usado") descrevem a mesma função [OBS]; qual janela vale como "termina" (5 h vs. semanal) não está definido [LAC] → default [DEC] = gargalo acima. Racional: gastar primeiro a cota que expira antes, evitando perda de cota [OBS mód.03].

### 7.4 Failover ao bater limite
1. Detectar `limit_reached` (Headline ≥ threshold para a conta do Pane, ou mensagem de limite na saída do CLI [DEC]).
2. Se `auto_failover=false`: Pane exibe botão "mover"; fim.
3. Senão: `hops+=1` (máx. 2); escolher conta por §7.3 excluindo a atual; se nenhuma → próximo executor de `fallback`; se nenhum → `no_capacity` + notificação.
4. Criar Pane novo no alvo com brief de restore; marcar Pane antigo `superseded`; emitir `account_switched`.
5. Cooldown: conta origem não é candidata por 5 min ou até `resets_at` [DEC].
Limitação: "pensamento" perdido [OBS]; a tarefa recomeça do brief.

### 7.5 Máquina de estados do semáforo
| estado | evento | novo estado |
|---|---|---|
| ready (verde) | prompt enviado | working (amarelo) |
| working | fim do turno (`Stop`/prompt idle) | ready |
| working | pergunta/permissão pendente e `bypass=false` | waiting_user (vermelho) |
| working | pergunta ao usuário mesmo com bypass (ferramenta de perguntas) | waiting_user |
| waiting_user | usuário responde | working |
| waiting_user | botão pausa | ready (prompt pendente descartado) |
| qualquer | processo encerrado | (spec-01) |
Regra observada: "quando ele para de te perguntar/está aguardando, a bolinha fica vermelha"; bypass não fica vermelho [OBS dia 80]. Mecanismo de detecção [DEC].

### 7.6 Níveis de harness (comportamento) [OBS: definição dia 67; mecânica DEC]
| nível | regra de resolução |
|---|---|
| 1 | 1 executor único configurado; todas as skills; sem Policy nem decisor |
| 2 | Policy por **categoria** numa conta; recomendar Codex a quem tem 1 assinatura [OBS] |
| 3 | Nível 2 + filtro de skills por Agent (cargo/ficha) |
| 4 | Policy por TaskType + N contas + roteamento + decisor (exige Entitlement) |
O produto usa 4 como padrão; downgrade automático se Entitlement ausente.

### 7.7 Cofre e modo broker [DEC]
- Leitura só no processo principal. Entradas normais: injetáveis como variável de ambiente no Pane (opt-in por Workspace). Entradas `sensitive`: nunca no env; uso via "ações" do app (ex.: chamada HTTP autenticada, deploy) que resolvem `{{vault:NAME}}` no processo principal; agente só enxerga o nome. Saída de ações passa por scrubber que remove o valor literal. Critério: cobrir a motivação observada (agente "guarda segredos expostos no repositório") [OBS dia 55].

### 7.8 Casos-limite
- Decisor off/timeout/JSON inválido → regra determinística, `source=fallback`, sem erro ao usuário.
- OpenRouter sem crédito (ocorreu no dia 80) → desligar temporariamente decisor (circuit breaker 5 min [DEC]) e avisar na UI.
- Todas as contas do provider esgotadas → tentar `alternates`/`fallback` de outro provider; senão `no_capacity`.
- Executor com provider desativado durante o voo → `executor_disabled` + fallback.
- Snapshot de limite obsoleto (> 60 s) → rebuscar; falha → `unknown` (§7.3).
- Modelos de cota separada (Spark/Luna) consultam balde próprio.

## 8. Prompts e textos embutidos

O JEV original **não gera texto**: recebe estado + pergunta tipada e devolve probabilidades em < 1/3 s [OBS]; o formato de API do JEV é [LAC]. Para o cliente genérico (LLM barato via OpenRouter) os prompts abaixo são [DEC], desenhados para saída JSON estrita.

### 8.0 System prompt-base do decisor [DEC]
```
Você é um DECISOR. Você não conversa e não executa nada. Você recebe uma pergunta
com opções fechadas e devolve APENAS um objeto JSON:
{"probs": {"<option_id>": <0..1>, ...}}
Regras: use somente os option_id fornecidos; as probabilidades somam 1; não invente
opções; não explique; sem texto fora do JSON. Se nenhuma opção for adequada, distribua
probabilidade uniforme.
```
### 8.1 Classificação de TaskType [DEC]
```
Pergunta: qual tipo de tarefa descreve melhor o pedido abaixo?
Pedido: """{prompt}"""
Contexto: {workspace_stack_resumo}
Opções (id: descrição):
{lista de task_type.slug: description}
```
### 8.2 Modelo/esforço [DEC]
```
Pergunta: para a tarefa do tipo {task_type} ("{prompt_resumido}"), qual executor
oferece melhor relação qualidade/custo? Não escale modelo caro para tarefa trivial.
Opções: {id: "provider/model/effort — custo_relativo, força"} 
```
### 8.3 Escolha de conta [DEC]
```
Pergunta: qual conta deve executar? Regra de preferência: gastar primeiro a cota que
expira antes; nunca escolher conta com uso >= 100%.
Opções: {account_id: "usado {used_pct}% na janela {window}; reseta em {resets_in}"}
```
### 8.4 Regras textuais observadas (verbatim)
- Regra de conta [OBS] (dias 80/81): "sempre escolher o que vai terminar o tempo primeiro. Só escolher o outro se estiver com 100% de cota usado."
- JEV vs LLM [OBS] (dia 80): "Gemini pensa e conversa. JEV só julga. Tudo que precisa de linguagem, contexto longo, argumento ou resposta falada fica no Gemini. Tudo que é uma decisão fechada com opções conhecidas de antemão e onde 300 microssegundos fazem diferença vai pro JEV."
- Roteiros de teste [OBS]: "Abra um ajudante Claude sem escolher conta, só para teste, e me mostra o recibo: quem escolheu a conta e com qual confiança." (dia 80); "Eu quero corrigir um bug dentro do meu site. Quero arrumar o botão do front end da primeira página que não está funcionando. Não use o overclick e apenas delegue." (dia 81); "Cria um arquivo chamado teste semáforo com a palavra oi dentro." (dia 80).
- Regra de conta ao orquestrador [OBS] (dia 44): "Todas essas atividades que serão delegadas, você sempre vai usar a conta um e não a conta dois. A conta dois será exclusivamente para o Fable 5."
- Quatro níveis (dia 67) — ver §7.6.

## 9. Requisitos não-funcionais
- **Desempenho:** decisão do decisor remoto < ~0,33 s observado [OBS]; orçamento total de `Router.resolve` ≤ 3 s p95 [DEC]; decisor local 24 ms [OBS] (inviável em precisão). Cache de limites 60 s [DEC].
- **Custo:** ~USD 0,0002/decisão [OBS]; painel sempre visível [OBS]; teto diário opcional [DEC]. Economia esperada: otimização do dia anterior reduziu custo em até 40% [OBS dia 81]; 8 panes paralelos sem passar de 25% do limite [OBS].
- **Portabilidade:** macOS/Windows/Linux; barra de limites no topo (Mac) / embaixo à direita (Windows) [OBS]; cofre usa keychain nativo de cada SO [DEC].
- **Segurança:** AES-256 [OBS]; segredos `sensitive` fora do env [OBS]; logs e Decisions sem valores de segredo [DEC]; prompt do usuário enviado ao decisor externo pode conter dados sensíveis → enviar apenas resumo truncado (≤ 500 caracteres) e permitir opt-out [DEC]; reconhecer que ler arquivos de token pode gerar falso positivo de antivírus (caso Headline) [OBS mód.09].
- **Privacidade:** decisor é dependência externa (OpenRouter) [OBS]; dados locais por padrão; decisor desligado por padrão [OBS].
- **Observabilidade:** tabela Decisions, eventos §6.b, métrica de divergência `diverged/total`, precisão em conjunto-ouro (meta ≥ 45/48 ≈ 94% a partir do observado JEV 45/48 vs Lia 16/48 [OBS]; meta [DEC]).

## 10. Stack sugerida e restrições
- **Original [OBS]:** app em Rust (Tauri; incerto vs Electron), SQLite/IPC, MCP do Overclock, `allow skills` do Claude Code, OpenRouter + JEV (Type Safe), Lia/Liquid local, Headline (Swift no Mac), cofre AES-256, bench.overclock.
- **Alternativas neutras [DEC]:** qualquer runtime com PTY e IPC; SQLite; cliente HTTP genérico compatível OpenAI para o decisor (trocável por modelo próprio/local); cofre com libsodium/AES-GCM + keychain.
- **Restrições:** não usa créditos do Overclock, opera sobre contas já logadas do usuário [OBS]; nomes de modelos são voláteis → nunca fixar em código, só em dados da Policy.

## 11. Plano de implementação em fases
1. **MVP (F1):** TaskType + Policy (UI + `harness_list/set`), resolução por Policy sem decisor, regra de conta §7.3 com limites do Headline, `allow skills`, recibo, tabela Decisions (`source=rule/policy`), semáforo básico.
2. **F2:** failover manual "mover" + brief de restore; modelos esgotados apagados; barra de limites; cofre (escopo, AES) sem broker.
3. **F3:** DeciderClient + painel Decisões (classificação e conta), custo, circuit breaker, divergência, `harness_recommend`.
4. **F4:** `auto_failover`, `account_switch`, evento `limit_reached`, modo broker do cofre, `decisions_list`, decisor para modelo/esforço.
5. **F5 (fase 2 do produto):** Arsenal/Receitas, browser controlado pelo decisor, MCP do cofre, decisor local.
Ordem de dependências: spec-04 (contas) e spec-09 (limites) antes de F1-conta; spec-01 (spawn/hooks) antes de F1; spec-06 antes de F2 failover.

## 12. Casos de teste de aceitação
- **CT-01 (feliz, regra de conta):** Dado 2 contas Claude, conta 1 janela decisiva reseta em 5 dias (40%), conta 2 reseta em 1 dia (60%), ambas com crédito; Quando `pane_spawn route=auto` sem conta; Então conta 2 escolhida, `source=rule`.
- **CT-02 (exaustão):** Dado conta 2 com 100% usado e conta 1 com crédito; Quando spawn; Então conta 1.
- **CT-03 (delegação completa):** Dado decisor habilitado e prompt "arrumar botão do front da home"; Quando piloto chama `pane_spawn`; Então TaskType classificado (`source=decider`), executor da Policy, recibo com confiança, Pane com apenas as skills do tipo.
- **CT-04 (decisor desligado):** Dado instalação nova; Quando qualquer spawn; Então zero chamadas ao decisor, heurística/Policy usada, painel mostra 0 consultas.
- **CT-05 (decisor falha):** Dado OpenRouter retornando 402/timeout; Quando classificação; Então fallback heurístico, spawn conclui, circuit breaker ativa aviso.
- **CT-06 (executor desativado):** Dado provider Codex desativado; Quando `harness_set` com Codex; Então erro `executor_disabled`; e `resolve` de policy antiga com Codex cai em Opus 5.
- **CT-07 (divergência):** Dado `account_selection_mode=decider` e decisor escolhendo conta que reseta por último com 38%; Então `confidence < min_confidence` → `rule_choice` aplicada, `diverged` registrado.
- **CT-08 (failover manual):** Dado Pane no limite; Quando "mover" para conta 2; Então novo Pane recebe brief de restore, antigo `superseded`, evento `account_switched(manual)`.
- **CT-09 (modelo esgotado):** Dado Fable 5.1 a 100% em todas as contas; Então opção desabilitada no seletor e Policy usa alternate.
- **CT-10 (semáforo):** Dado Pane com bypass e prompt "cria arquivo teste semáforo"; Então verde→amarelo→verde, nunca vermelho; com pergunta forçada fica vermelho e pausa descarta o prompt pendente.
- **CT-11 (limite de saltos):** Dado todas as contas do provider e fallback esgotados; Quando limite; Então `no_capacity`, no máximo 2 saltos.
- **CT-12 (cofre broker):** Dado entrada `sensitive`; Quando Pane é aberto; Então variável ausente no env do Pane e `vault_get` retorna `sensitive_denied`.
- **CT-13 (custo):** Dado 127 decisões a US$ 0,0002; Então painel mostra ~US$ 0,025 e 127 consultas.
- **CT-14 (entitlement):** Dado plano sem `harness_auto`; Então `route=auto` retorna `entitlement_required`.

## 13. Questões em aberto e riscos
1. [LAC] API/modelo exato do JEV e identificador no OpenRouter; formato de resposta; cota grátis (~1000/dia?) e cobrança automática. Default [DEC]: cliente genérico + prompts §8.
2. [LAC] Qual janela (5 h vs. semanal) define "termina primeiro"; algoritmo final e se o bug de roteamento (dia 80/81) foi corrigido. Default [DEC]: gargalo por maior % usado.
3. [LAC] Tabela de Policy completa (só exemplos observados); valores da semente são [DEC].
4. [LAC] Como restringir skills em CLIs além do Claude Code; nome literal da flag.
5. [LAC] Se `account_switch`, `limit_reached` e MCP do cofre foram construídos (backlog 1.4); "mover" perde o pensamento da sessão.
6. [LAC] Painel de bug dedicado, Arsenal/Receitas em detalhe, browser controlado (contrato de "olho" = lista de elementos clicáveis do DOM e "cérebro" LLM, apenas insinuado).
7. [LAC] Regras exatas de ligação plano ↔ nível de harness (números de preço inconsistentes; ver spec-17).
8. Riscos: decisor externo como dependência e vazamento de prompt; modelos voláteis quebrando a Policy; multi-conta por provider inconsistente (Antigravity reprovado); credenciais lidas de arquivos podem disparar antivírus; `[DEC]` mais arriscados: regra de conta como autoridade sobre o decisor, `auto_failover=false` por padrão, mecanismo de broker do cofre.

## 14. Rastreabilidade
| Requisito | Fonte |
|---|---|
| RF-03.01-.03 | mód.03 "Comportamento" 1, "Política de harness" (dias 63-73, 80-83) |
| RF-03.04 | mód.03 "Origem da tabela" (arq. 26/33); [[spec-14-bench]] |
| RF-03.06 | mód.03 "MCP do harness" (dia 65) |
| RF-03.07 | mód.03 Comportamento 7 (arq. 01) |
| RF-03.08 | mód.03 Política de harness (dias 70, 73; arq. 17) |
| RF-03.10-.11 | mód.03 "Quatro níveis" (dia 67), "Modelo de negócio" |
| RF-03.20-.27 | mód.03 "Decisor JEV e painel Decisões" (dias 80-84, arq. 04-06, 08) |
| RF-03.30-.37 | mód.03 "Roteamento entre contas", "Bug do roteamento" (dias 44, 55, 58, 75, 80-81, 84); mód.04 |
| RF-03.40-.41 | mód.03 "Funcionamento" 1-6, "Economia de tokens" (dias 81-82) |
| RF-03.50-.53 | mód.03 "Cofre de tokens" (dia 55) |
| RF-03.60-.61 | mód.03 "Sinaleira" (dia 80, arq. 08) |
| RF-03.70 | mód.09 (dias 73, 75, 79-81) |
| §7.3 | mód.03 regra verbatim (arq. 07, 08); mód.09 "headline pick" (dia 73) |
| §5.9 | mód.03 "Warners/Harness, Arsenal e Receitas" (dia 44, arq. 43) |
| §8 | mód.03 "Prompts, receitas, comandos e textos" (dias 44, 67, 80, 81) |
| §9 desempenho/custo | mód.03 (arq. 06, 10, 07): 24 ms, 16/48 vs 45/48, US$ 0,0002, 40% |
