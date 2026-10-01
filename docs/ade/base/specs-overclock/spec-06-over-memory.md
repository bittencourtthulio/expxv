---
spec: "Over Memory — memória local por Pane/Mission e brief de restore"
slug: "spec-06-over-memory"
modulo_fonte: ["06-over-memory"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-02-orquestracao-modo-agentico", "spec-05-catalogo-skills-mcp-hooks"]
---
# Spec 06 — Over Memory

## 1. Resumo e objetivo
Over Memory (Sprint M03 do roadmap) é a memória local do Overclock: durante o trabalho o sistema observa Workspace, Mission, Pane, Agent, Session, Task e eventos importantes e os converte em `MemoryEntry` curtas (não um dump do chat); agentes leem/gravam via tools MCP; ao reabrir um Pane, o app injeta um brief curto de restauração. Problema: "as pessoas fecham o painel, o terminal, e a memória se perde" [OBS: Dia 29]; metas: continuidade (nenhum Pane retoma "no escuro") e economia de tokens (o orquestrador recebe um pacote curto, não o histórico) [OBS: Dias 24, 29]. Estado do original: parcial — sprints 1-2 concluídos e 3 em andamento no Dia 28; o brief no restore ficou em plano/testes com erros nas versões 0.4.7-0.4.9 (Dia 29); a memória em anéis foi apenas descrita (Dia 49). Esta spec marca cada ponto.

## 2. Escopo e não-escopo
**Cobre:** MemoryEntry; três modos (mission com SDD, solo por Pane, off); captura, política de escrita/leitura/compactação; brief de restore; tools MCP de memória; toggle em Configurações; transações de escrita.
**Não cobre:** orquestração/SDD/planner em si ([[spec-02-orquestracao-modo-agentico]]); registro de tools MCP e hooks ([[spec-05-catalogo-skills-mcp-hooks]]); UI de terminais/restore visual ([[spec-01-terminais-paineis-workspaces]]); página de vendas do Over Memory (marketing, nunca concluída no original [OBS: Dia 29]).
**Fase 2:** memória em anéis (missão/projeto/usuário) exclusiva do modo agêntico [OBS: Dia 49, descrita, não verificada como construída]; destilação automática no fechamento da Mission; memória compartilhada/Jarvis (roadmap 1.0); RAG por hierarquia de resumos e metadados [OBS: Dia 24, só planejado]; camada de memória do piloto persistente [OBS: Dias 70/75, relacionada].

## 3. Glossário e atores
- **MemoryEntry**: unidade curta de memória. **Brief**: markdown injetado no início do Pane restaurado. **Check-in/checkpoint**: registro do estado de um Pane. **Modo de memória**: `mission`, `solo`, `off`. **Anel**: nível de escopo (fase 2).
- Atores: usuário (liga/desliga, escolhe modo); Agent (grava/consulta via MCP); orquestrador (grava aprendizado ao fim da Mission); sistema (coletor de eventos, montador de brief, compactador).

## 4. Requisitos funcionais
**Modos e escopo**
- RF-06.01 O Workspace DEVE oferecer os modos de trabalho `mission` e `standalone` (solo), coexistindo; o modo de memória de cada Pane deriva de onde nasceu. [OBS: Dia 29] Aceite: Workspace com 1 Mission e 2 Panes solo mostra ambos.
- RF-06.02 Modo `solo`: cada Pane tem memória própria (escopo por `pane_id`); outro Pane PODE lê-la sob demanda via `memory_search` com `pane_id` explícito. [OBS: Dia 29 "Por pane"] Aceite: entrada do Pane A não aparece nas leituras default do Pane B.
- RF-06.03 Modo `mission`: o primeiro Agent lançado DEVE ser o SDD orquestrador (conversa com o usuário, produz o SDD); a decomposição DEVE ser delegada a um Agent planner, liberando o orquestrador. [OBS: Dia 29] Aceite: orquestrador não executa a construção; usuário pode conversar com ele durante a decomposição.
- RF-06.04 O orquestrador NÃO DEVE bloquear o usuário ("idle waiting") nem "construir tudo" sozinho. [OBS: Dia 29, dia difícil] Aceite: prompt e gate proíbem; ver §8.
- RF-06.05 Modo `off`: toggle em Configurações desliga o Over Memory; então nenhum evento é coletado, nenhum brief injetado, tools `memory_*` NÃO são expostas. [OBS: Dia 29] Aceite: com off, restore devolve Pane sem brief e tabela de memória não cresce.
- RF-06.06 Mission DEVE ser tratada como unidade análoga a branch/worktree; memória de Mission é escopo próprio. [OBS: Dia 27-28]
- RF-06.07 Antigas "sessões por workspace" DEVEM sair da UI em favor de Missions e memórias por Pane. [OBS: Dia 29] [LAC: a entidade Session permanece internamente para retomada].
- RF-06.08 Compatível com Claude Code e Codex. [OBS: Dia 27] Aceite: brief e tools funcionam nos dois.

**Captura**
- RF-06.10 O sistema DEVE gerar MemoryEntry a partir de eventos relevantes: checkpoint de Pane, decisão, risco, handoff, conclusão de Task, fato verificado. [OBS: Dia 27, exemplos "usar pnpm e não npm"] Aceite: `handoff_submit` gera entrada `handoff`.
- RF-06.11 A entrada DEVE ser curta (limite `content` 1000 chars [DEC]) e NÃO DEVE conter dump de chat. [OBS: Dia 27; limite DEC]
- RF-06.12 Agents DEVEM poder gravar entradas explícitas via `memory_write`. [OBS: "tools MCP para agentes" Dia 27; nome DEC]
- RF-06.13 Toda escrita DEVE passar por redação de segredos antes de persistir. [OBS: brief "risca segredo", Dia 29; aplicar já na escrita = DEC]
- RF-06.14 `update mission` e `close pane` DEVEM ser transacionais (múltiplas escritas atômicas). [OBS: auditoria Dia 28] Aceite: falha injetada entre escritas não deixa Pane fechado sem registro de auditoria.

**Brief no restore**
- RF-06.20 Ao reabrir Pane (relançamento com sessão salva), o app DEVE montar brief novo e anexá-lo como prompt inicial, mesmo que os args salvos já contenham brief antigo. [OBS: Dia 29, causa do bug]
- RF-06.21 O montador DEVE ser função pura `build_brief(pane_id, budget) → markdown` sobre dados persistidos ("opção B"), extraída do spawn de Pane. [OBS: Dia 29; dívida do "cockpit" de ~520 linhas]
- RF-06.22 Conteúdo: último checkpoint, decisões, riscos anotados, linha do tempo curta dos últimos eventos; segredos removidos; corte no limite. [OBS: Dia 29]
- RF-06.23 O brief DEVE ser exclusivo do `pane_id` pedido (não vaza entradas de outros Panes). [OBS: "pega só o que é dele"]
- RF-06.24 Orçamento "médio"; só o último checkpoint (barato). [OBS] Números: default 6000 chars (~1500 tokens) [DEC].
- RF-06.25 Restore DEVE ser idempotente e criar exatamente um Pane (bug: botão restaurava ou criava dois). [OBS: Dia 29 "flick"; requisito derivado]
- RF-06.26 Fechar o Pane no meio da construção do brief NÃO DEVE corromper estado; brief parcial não é persistido. [OBS: pergunta Dia 27; DEC de comportamento]

**Leitura/compactação**
- RF-06.30 Ao abrir Mission, o app DEVE montar "pacote curto de contexto relevante" (não histórico completo). [OBS: Dia 27]
- RF-06.31 Ao fim da Mission, o orquestrador DEVE salvar o aprendizado principal (`kind=learning`). [OBS: Dia 27]
- RF-06.32 Compactação DEVERIA resumir entradas antigas de um escopo quando excederem limites (§7.4). [DEC: original só cita "hierarquia de resumos" como plano]
- RF-06.33 O orquestrador NÃO DEVE ler o histórico completo dos Panes; DEVE consumir memória/resumos e ser acordado só quando o Pane responde. [OBS: Dia 24]

**Fase 2 (anéis)**
- RF-06.40 `memory_search` DEVE federar três anéis (mission → project → user), do quente ao frio, filtrado pelo escopo do token. [OBS: Dia 49]
- RF-06.41 O worker DEVE receber o resultado no hook de session start. [OBS: Dia 49]
- RF-06.42 Squads (modo não agêntico) NÃO DEVEM receber tools de memória. [OBS: Dia 49]

## 5. Modelo de dados
Persistência: SQLite local do workspace do Overclock [OBS, "provavelmente no mesmo SQLite", incerto → DEC: mesmo banco, tabela própria]. Esquema de tabelas não foi descrito [OBS lacuna] → abaixo é [DEC].

**MemoryEntry**
| Campo | Tipo | Obrig. | Default/invariante |
|---|---|---|---|
| id | uuid | sim | |
| workspace_id | fk Workspace | sim | |
| mission_id | fk Mission | não | obrigatório se scope=mission |
| pane_id | fk Pane | não | obrigatório se scope=pane |
| scope | enum `pane|mission|workspace|project|user` | sim | `project`/`user` só fase 2 (ring 2/3) |
| ring | int 1..3 | não | 1=mission, 2=project, 3=user (fase 2) |
| kind | enum `checkpoint|decision|risk|event|fact|preference|handoff|learning|summary` | sim | |
| content | text | sim | ≤1000 chars, já redigido |
| source | enum `system|agent|user` | sim | |
| author_agent_id | fk Agent | não | |
| importance | int 1..5 | sim | default 3 |
| supersedes_id | fk MemoryEntry | não | checkpoint novo substitui anterior do mesmo pane |
| created_at | ts | sim | |
| expires_at | ts | não | ring 1 expira ao fechar a Mission |
| redacted | bool | sim | true se algo foi mascarado |
Índices: `(pane_id, kind, created_at desc)`, `(mission_id, kind)`, FTS opcional em `content` [DEC].
Também `MemorySettings {workspace_id, mode: "mission|solo|off", enabled: bool=true, brief_budget_chars: 6000, retention_days: 90}` [DEC].
Exemplo:
```json
{"id":"...","scope":"pane","pane_id":"p_5747","kind":"decision","content":"Usar pnpm, não npm, neste repositório.","source":"agent","importance":4,"created_at":"2026-01-10T12:00:00Z","redacted":false}
```
Ciclo de vida: `created → (superseded | summarized | expired) → deleted`. Invariante: entradas de Pane fechado permanecem por `retention_days` para restore. Exclusão do Pane a pedido do usuário apaga suas entradas (privacidade) [DEC].

## 6. Interfaces
### (a) UI/UX
- Configurações → Over Memory: toggle liga/desliga [OBS: Dia 29 "entro em configurações, clico ao lado"]; modo padrão do Workspace [DEC]; orçamento do brief (avançado) [DEC].
- Ao abrir Workspace: escolha "Missão" ou "Stand" (standalone) como modo de trabalho [OBS: Dia 29, ainda em discussão → [LAC] se pergunta ocorre ao selecionar pasta ou depois].
- Restore: botão "Restaurar" do Pane; indicação discreta "brief carregado" [DEC]. Sem duplicar Pane.
- Visualização de memória: [LAC] não descrita; [DEC] MVP sem tela, só via MCP e log de atividade.
### (b) Eventos internos [DEC]
`memory:entry_created {entry_id, scope, kind}`; `memory:brief_built {pane_id, chars, truncated}`; `pane:restore_requested {pane_id}`; `mission:closed {mission_id}` (dispara learning). Coletor assina eventos de spec-01/02: `pane_closed`, `handoff_submitted`, `task_updated`, `mission_updated`.
### (c) Tools MCP — nomes e schemas [DEC] (originais não foram ditos [OBS lacuna])
Erros: `memory_disabled`, `unauthorized`, `not_found`, `invalid_argument`, `too_large`. Todas exigem token com escopo; ausentes se modo `off` ou squad.
- `memory_write` — `{content:string(≤1000), kind:"decision|risk|fact|checkpoint|learning|preference", importance?:1-5, scope?:"pane|mission"}` → `{entry_id, redacted}`. Escopo default = Pane do token; `mission` só se o token tiver `mission_id`.
- `memory_search` — `{query?:string, scope?:"pane|mission|workspace|all_rings", pane_id?:string, kinds?:[...], limit?:int=10(≤50)}` → `{entries:[{id,kind,content,scope,created_at}], truncated:bool}`. Default: Pane do token + Mission do token. Leitura de outro `pane_id` só em modo solo/mission do mesmo Workspace.
- `memory_checkpoint` — `{summary:string, next_steps?:[string], risks?:[string]}` → `{entry_ids}`; grava `checkpoint` (substitui o anterior) + `risk`s.
- `memory_brief` — `{pane_id?:string, budget_chars?:int}` → `{markdown, truncated}`; usa `build_brief`.
- `memory_forget` — `{entry_id}` → `{ok}`; só entradas do próprio Pane/Mission. 
Regra: `memory_search` fase 2 retorna anéis ordenados por (anel, importance, recência).
### (d) Protocolos externos
Hook `session_start` de Claude Code/Codex injeta brief (ver [[spec-05-catalogo-skills-mcp-hooks]] RF-05.54). No relançamento, o brief entra como prompt inicial/argumento do spawn [OBS: Dia 29]. [LAC] mecanismo equivalente no Codex.

## 7. Fluxos e algoritmos
### 7.1 Restore de Pane (caso central)
1. Usuário aciona Restaurar (Pane p). 2. Sistema detecta `is_restore = pane.saved_launch_args != null` (o "astronauta voltando") vs. primeiro lançamento. 3. Se restore e modo ≠ off: `brief = build_brief(p, budget)`; substituir/remover brief velho dos args salvos; anexar `brief` como prompt inicial. 4. Se primeiro lançamento: comportamento atual (montar system prompt se não existe). 5. Spawn com lock por `pane_id` (evita 2 Panes). 6. Emitir `brief_built`.
Erro: falha no `build_brief` → lançar sem brief e registrar warning (não bloquear o restore) [DEC].
### 7.2 build_brief (pura)
```
build_brief(pane_id, budget):
  cp   = latest(entries, pane_id, kind=checkpoint)         # só o último (barato)
  decs = top(entries, pane_id, kind=decision, by importance,recency, n=8)
  risks= entries(pane_id, kind=risk, n=8)
  evts = last(entries, pane_id, kind=event, n=10)
  md = render(template, cp, decs, risks, evts)
  md = redact(md)
  if len(md) > budget: truncar em ordem: evts, decs, risks, (nunca cp); ao fim corta duro + "…[truncado]"
  return md
```
Template [DEC, estrutura observada]:
```
# Contexto restaurado do painel {pane_id}
## Onde parou (último checkpoint)
## Decisões
## Riscos e o que não pode esquecer
## Linha do tempo recente
```
Redação [DEC]: mascarar padrões `sk-…`, `AKIA…`, `ghp_…`, `Bearer …`, pares `KEY=valor` com nomes contendo KEY/TOKEN/SECRET/PASSWORD, JWTs; substituir por `[REDACTED]`.
### 7.3 Política de escrita/leitura
Escrita: evento → filtro de relevância (kind ∈ lista, importance≥2) → redação → truncar → dedupe (mesmo `content` normalizado no escopo em 24 h, atualiza `created_at`) → transação. Leitura: sempre filtrada por escopo do token; default só o próprio; nunca retornar entradas `off`. Ao gravar `checkpoint`, marcar o anterior `superseded`.
### 7.4 Compactação [DEC; original só planejou "hierarquia de resumos"]
Gatilhos: >200 entradas ativas no Pane, ou fechamento de Mission. Passos: agrupar `event`s antigos (>7 dias) por dia → 1 `summary` (gerado por Agent barato via [[spec-04-providers-e-modelos]] ou concatenação truncada se indisponível); manter `decision`/`risk` importance≥4; apagar `event`s resumidos. Fechamento de Mission: orquestrador grava `learning`; ring 1 expira; (fase 2) destilar em ring 2.
### 7.5 Máquina de estados do modo de memória por Pane
| Estado | Evento | Novo estado |
|---|---|---|
| `off` (global) | toggle on | `active` |
| `active` | toggle off | `off` (dados preservados, não coletados) |
| `active` | Pane fechado | `dormant` (entradas retidas) |
| `dormant` | restore | `active` (brief injetado) |
| `dormant` | retenção vencida | `expired` (apagado) |
### 7.6 Modo mission (SDD)
1. Usuário abre Mission → spawn do orquestrador SDD (prompt §8). 2. Conversa → SDD. 3. Orquestrador chama planner (`agent_invoke`) e volta a ficar disponível. 4. Planner decompõe em Tasks; workers herdam `mission_id`. 5. Cada handoff gera `MemoryEntry`. 6. Fechamento → `learning`.
### 7.7 Anéis (fase 2)
Ring 1 (mission): quente, expira com a Mission (decisões, handoffs, descobertas de workers). Ring 2 (project): destilado e permanente, gerado no fechamento. Ring 3 (user): preferências/regras de trabalho. Consulta: `memory_search(scope=all_rings)` percorre 1→2→3, aplicando escopo do token; hook de session start injeta o resultado no worker. Exclusivo do modo agêntico; "nunca promover ao registro público" [OBS: Dia 49]. Desconhecido: critérios de destilação, formato de ring 3 [LAC].

## 8. Prompts e textos embutidos
- Regra do orquestrador SDD (paráfrase de decisões do Dia 29, [OBS]); redação literal [DEC]:
```
Você é o orquestrador SDD desta Mission. Converse com o usuário e produza o SDD. Depois de aprovado,
chame o agente planner para decompor o SDD em atividades para os demais agentes e volte a ficar
disponível para o usuário. Nunca construa a solução completa você mesmo e nunca fique bloqueado
esperando: seu papel é especificar, delegar e acompanhar. Ao encerrar a Mission, registre o aprendizado
principal com memory_write(kind="learning").
```
- Instrução ao agente para usar memória [DEC]: "Antes de retomar, leia o brief. Grave decisões e riscos com `memory_write`. Não grave segredos nem trechos longos de conversa."
- Prompt de restore: o brief markdown (§7.2) [OBS conteúdo; template DEC].
- Texto de posicionamento (marketing): "não é lembrar tudo magicamente; é mais como uma caderneta organizada do projeto" (transcrição ruidosa, provável) [OBS: Dia 27]; "Over Memory é muito mais do que uma memória; é ter um projeto orientado a missão" [OBS: Dia 29].
- Texto dos anéis lido ao vivo (Dia 49, arq. 42) descreve os 3 anéis (ver §7.7) [OBS], usável como descrição da tool `memory_search` fase 2.

## 9. Requisitos não-funcionais
- Desempenho: sem números observados de memória [LAC]; [DEC] `build_brief` < 100 ms e < 6000 chars default; escrita síncrona < 20 ms. Do lado do MCP, latência de wake ~11 s → quase instantânea [OBS: Dia 51, spec-05].
- Tokens: brief e `memory_search` limitados (limit ≤50, `truncated`); orquestrador consome resumos, não histórico [OBS].
- Portabilidade: SQLite local; Claude Code e Codex obrigatórios; Antigravity [LAC].
- Segurança/privacidade: local first [OBS]; redação de segredos na escrita e no brief; nunca sair da máquina sem consentimento; exclusão sob demanda [DEC]; tokens MCP com escopo (não ler Panes de outra Mission) [DEC]; cofre de chaves é módulo separado [OBS: arq. 37].
- Robustez: transações em `update mission`/`close pane` [OBS]; restore idempotente.
- Observabilidade: log de atividade existente registra `memory:*` [OBS: log de atividade existe]; métrica: tamanho do brief, truncamentos [DEC].

## 10. Stack sugerida e restrições
[OBS] SQLite local, MCP interno, Electron main process (pty/spawn), hooks de session start, Claude Code e Codex. [DEC] Neutro: qualquer store local transacional (SQLite/DuckDB), FTS5 para busca, sem vetor no MVP (RAG só hierarquia de resumos e metadados, planejado [OBS: Dia 24]). Restrição: extrair `build_brief` do spawn monolítico antes de estender (dívida técnica [OBS]).

## 11. Plano de implementação
1. **MVP-0**: tabela `MemoryEntry`, transações em `close_pane`/`update_mission`, toggle off. 2. **MVP-1**: coletor de eventos → checkpoint/decision/risk; redação. 3. **MVP-2**: `build_brief` pura + restore idempotente (corrige o bug central). 4. Tools MCP `memory_write/search/checkpoint/brief` (depende de spec-05 MCP e tokens). 5. Modo mission com SDD + planner + `learning` de fim de Mission (depende de spec-02). 6. Compactação. 7. **Fase 2**: anéis, destilação, session start federado, memória compartilhada/Jarvis, RAG hierárquico, piloto persistente.

## 12. Casos de teste de aceitação
1. Dado Pane com checkpoint e 2 decisões, quando fechado e restaurado, então prompt inicial contém brief com checkpoint, decisões e eventos recentes, sem brief antigo duplicado.
2. Dado args salvos com brief velho, quando restore, então brief novo substitui (bug do Dia 29).
3. Dado log com `sk-abc123…` e `API_KEY=xyz`, quando build_brief, então saem `[REDACTED]`.
4. Dado brief > orçamento, então trunca eventos primeiro, mantém checkpoint, `truncated=true`.
5. Dado Pane A e B solo, quando B chama `memory_search` sem pane_id, então não vê A; com `pane_id=A` vê.
6. Dado modo off, então `memory_write` inexistente/`memory_disabled`, restore sem brief, nada gravado.
7. Dado falha simulada entre escritas de `close_pane`, então rollback completo e rastro de auditoria íntegro.
8. Dado duplo clique em Restaurar, então exatamente 1 Pane.
9. Dado Mission fechada, então existe `learning` e entradas ring 1 expiram; nova Mission recebe pacote curto (≤ orçamento), não o histórico.
10. Dado Squad, então tools `memory_*` ausentes.
11. Dado 250 entradas de evento antigas, quando compactar, então viram summary(s) e decisões importantes permanecem.
12. (Fase 2) Dado worker com token de Mission M, `memory_search all_rings` retorna ring1 de M, ring2 do projeto, ring3 do usuário, nunca ring1 de outra Mission.

## 13. Questões em aberto e riscos
- [LAC] Se o brief no restore foi concluído/liberado no original (Dia 29 termina em plano/testes, erros em 0.4.7-0.4.9).
- [LAC] Esquema real de tabelas e nomes reais das tools MCP de memória (todo o §5 e §6c é [DEC]).
- [LAC] Formato exato do brief (só campos conhecidos), orçamento numérico, limite de entradas.
- [LAC] Abordagens A e C do restore não descritas (só "B").
- [LAC] Quando perguntar missão×stand; destino da entidade Session; visualização de memória na UI.
- [LAC] Critérios de destilação/promoção entre anéis; ring 3; retenção; consentimento para dados do usuário.
- [LAC] Conflito de contagem de sprints (12/18 vs 18); slippage do roadmap (4.3 → 4.9).
- Risco: redação por regex deixa vazar segredos exóticos; brief injetado é vetor de prompt-injection (conteúdo de log gravado por agente) — [DEC] delimitar brief como dado e nunca executar instruções nele.
- Risco: duplicação de painel no restore; travamentos em versões 0.4.7-0.4.9 [OBS].

## 14. Rastreabilidade
| Requisito | Fonte |
|---|---|
| RF-06.01-.08 | 06 "Três modos", "Ao abrir um workspace", Dia 29 (arq. 48), Dia 27 (arq. 50) |
| RF-06.03-.04 | 06 "Regra de comportamento do orquestrador", "Agente SDD", Dia 29 |
| RF-06.10-.13 | 06 "Visão geral", Dia 27; Dia 29 (segredos) |
| RF-06.14 | 06 "Funcionamento/Banco", Dia 28 (arq. 49) |
| RF-06.20-.26 | 06 "Restauração de painel", "Funcionamento" (causa do bug), Dia 29; Dia 27 (fechar painel) |
| RF-06.30-.33 | 06 Dia 27, Dia 24 (arq. 53) |
| RF-06.40-.42 | 06 "Memória em anéis", Dia 49 (arq. 42); 05 "Skill gate por modo" |
| Tools MCP §6c | [DEC]; base: 06 "Acesso", Dia 27 |
