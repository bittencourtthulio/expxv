# Digest C: specs 03 (Harness/Roteamento/Decisor), 09 (Headline), 14 (Bench)

Fonte: /Users/thuliobittencourt/Documents/Projetos/overclock-legendas/specs/. Selos: [OBS] observado, [DEC] decisão da spec, [LAC] lacuna. Prioridade: DEVE=P0, DEVERIA=P1, PODE=P2 (vocabulário das specs). Nomes de modelos são voláteis: só em dados, nunca em código.

Relação entre as três: spec-09 coleta limites por conta -> spec-03 consome (`get_limits`) para rotear conta/failover -> spec-14 gera a evidência (score por atividade) que semeia a Policy da spec-03. spec-03 depende de spec-01 (Panes/PTY/hooks), 02 (piloto/pane_spawn), 04 (providers/contas), 05 (skills/MCP), 06 (memória/restore brief), 17 (entitlements).

---
# SPEC-03: Harness por tarefa, roteamento de contas, decisor, cofre, semáforo

## 1. Requisitos funcionais (resumo, critério de aceite)
**Policy/TaskType**
- RF-03.01 (P0) Tabela TaskType (por categoria) + Policy TaskType -> ExecutorSpec `{provider, model, effort, skills[], agent?, fallback[]}`. Aceite: editar linha na UI aparece em `harness_list`.
- RF-03.02 (P0) UI "Configurações > Harness por tarefa"; criar categoria/tipo ao vivo sem reiniciar.
- RF-03.03 (P0) Policy editável por UI e MCP (`harness_set`); mesma mutação => mesmo estado.
- RF-03.04 (P1) Policy-semente derivada do bench, só sugestão editável (tabela real desconhecida [LAC]).
- RF-03.05 (P1) Escopo global + override por workspace (`workspace_id` opcional) [DEC].
- RF-03.06 (P0) `harness_set` rejeita `executor_disabled`; na resolução cai no `fallback` (default Opus 5); providers desativados não aparecem em list/recommend (CT-06).
- RF-03.07 (P1) Modelos novos detectados pela spec-04 ficam disponíveis na Policy sem ação manual.
- RF-03.08 (P1) Preferência ordenada por TaskType = `[principal, ...alternates]`; 1º esgotado => usa 2º.
**Níveis**
- RF-03.10 (P0) `harness_level` 1-4 por Workspace; alvo = 4. RF-03.11 (P0) níveis 3-4 exigem Entitlement `harness_auto` (Ultra); sem ele, níveis 1-2.
**Decisor**
- RF-03.20 (P0) "Configurações > Decisões" tudo DESLIGADO por padrão; toggles: conta, modelo/esforço, classificação de TaskType, (fase 2) browser; custo acumulado. Aceite: instalação nova faz zero chamadas.
- RF-03.21 (P0) Toda invocação gera Decision persistida (opções, probs, escolha, source, custo).
- RF-03.22 (P0) `DeciderClient` abstrato com perguntas `choice|score|boolean`; impl. padrão OpenRouter; modelo exato [LAC].
- RF-03.23 (P0) Decisor não inventa opção; resposta inválida descartada -> fallback determinístico.
- RF-03.24 (P1) Custo acumulado (BRL+USD) e contagem; ref. ~USD 0,0002/decisão.
- RF-03.25 (P1) Alerta (não bloqueia) acima de limiar diário (default 1000). Cota grátis "~1000/dia" não confirmada [LAC], risco de cobrança no cartão.
- RF-03.26 (P0) Timeout 2 s [DEC]; falha/desligado => regra determinística sem interromper.
- RF-03.27 (P2) `provider=local` possível, mas não recomendado (16/48 vs 45/48).
**Roteamento/failover**
- RF-03.30 (P0) N contas por provider, cada uma com diretório/login próprio (multi-conta Antigravity reprovado no dia 75, tarefa da spec-04).
- RF-03.31 (P0) Sem conta explícita: entre as NÃO esgotadas, a que reseta primeiro; outra só se a melhor estiver 100% usada (CT-01, CT-02).
- RF-03.32 (P1) Contas reservadas a modelos/papéis e fixadas por Workspace.
- RF-03.33 (P0) Modelos esgotados "apagados" e desabilitados nos seletores (CT-09).
- RF-03.34 (P0) Limite em Pane rodando: ação manual "mover"; com `auto_failover=true` automático (default false [DEC]).
- RF-03.35 (P0) Migração cria novo Pane na conta alvo com restore brief (spec-06); "pensamento" da sessão perdido.
- RF-03.36 (P0) Cadeia: outra conta do provider -> próximo `fallback` -> `no_capacity`; máx. 2 saltos; cooldown anti ping-pong [DEC].
- RF-03.37 (P2) Evento `limit_reached` e tool `account_switch` (fase 2).
**Skills/delegação**
- RF-03.40 (P0) Pane recebe SOMENTE skills do ExecutorSpec via flag `allow skills` do Claude Code; outros CLIs: injetar no prompt + `skills_enforced=false` na Decision [DEC].
- RF-03.41 (P0) `pane_spawn` sem provider/modelo explícitos passa pelo fluxo 7.1 e devolve recibo (CT-03).
**Cofre**
- RF-03.50 (P0) Cofre AES-256 em pasta oculta `.overclock`, escopo global/workspace. RF-03.51 (P0) entradas `sensitive` nunca no env de Pane (modo broker). RF-03.52 (P1) chave OpenRouter no cofre. RF-03.53 (P2, fase 2) MCP do cofre, nunca devolve `sensitive`.
**Semáforo**
- RF-03.60 (P0) Sinaleira por Pane: verde pronto, amarelo trabalhando, vermelho aguardando usuário; pausa descarta prompt pendente. RF-03.61 (P0) com `bypass_permissions` não fica vermelho por permissão; pergunta forçada fica (CT-10).
**Limites**
- RF-03.70 (P0) Consumir limites por Account da spec-09 e exibir barra no topo; conta sem dado = `unknown`, rebaixada.

## 2. Entidades e campos
- **TaskType**: slug (único), category, label, builtin, description (vai ao prompt do classificador).
- **Policy/ExecutorSpec**: task_type, workspace_id?, executor{provider, model, effort, skills[], agent?}, alternates[], fallback[] (nunca vazio), account_policy{pin_account_id, avoid_reserved}, enabled, updated_at, updated_by(user|mcp|seed). Único por (task_type, workspace_id). effort ∈ enum do provider; skills ⊂ catálogo instalado.
- **Account** (estende spec-04): account_id, provider, label, enabled, reserved_for{models[]|roles[]}, pinned_workspaces[], auth_state(ok|expired|unknown), vault_ref.
- **LimitSnapshot** (cache 60 s, não persistido): account_id, fetched_at, windows[{name 5h|weekly, used_pct, resets_at}], model_buckets{modelo:{used_pct}} (Fable/Spark/Luna têm cota separada).
- **Decision**: decision_id, ts, kind, purpose(account_selection|task_type|model_effort|browser_action), workspace_id, pane_id, options[{id, features}], probs, chosen, confidence, source(decider|rule|policy|explicit|fallback), rule_choice, diverged, latency_ms, cost_usd, decider{provider, model}, receipt. Invariantes: chosen ∈ options; diverged = (source==decider && chosen != rule_choice). Retenção 90 d; agregados de custo permanentes.
- **DeciderSettings** (singleton): enabled=false, provider(openrouter|local|off), model [LAC], use_for{account, model_effort, task_type, browser}=false, min_confidence=0.5, timeout_ms=2000, daily_alert=1000, api_key_ref.
- **WorkspaceRoutingSettings**: harness_level=4 (sujeito a entitlement), auto_failover=false, account_selection_mode(rule|decider, default rule), exhaustion_threshold_pct=100.
- **VaultEntry**: entry_id, name UPPER_SNAKE, scope, workspace_id?, sensitive, ciphertext, nonce, created_at, last_used_at. AES-256 (GCM + chave-mestra no keychain do SO [DEC]). Valor nunca em log/Decision.
- Fase 2: ArsenalItem{kind skill|agent|provider|media, ref, role scout|builder|reviewer}, Recipe{recipe_id, name, steps[{agent, skills, task}], favorite_model}.
- Persistência: SQLite local; cofre em arquivo cifrado separado. Datas ISO-8601 UTC.

## 3. Telas/UI
1. Harness por tarefa (tabela agrupada por categoria; colunas TaskType, Provider/modelo, Esforço, Skills, Agente, Contas(pin), Fallback; botões +categoria, +tipo, restaurar semente, sugerir pelo bench; linha com executor desativado destacada e bloqueia salvar).
2. Decisões (toggles off, chave OpenRouter, toggles por uso, contador "N consultas · R$/US$", últimas Decisions com recibo/confiança/diverged, alerta diário).
3. Providers > contas (adicionar conta, label, pin de Workspace, reserva de modelo, barra de limite).
4. Barra de limites no topo (5h/semanal, % e tempo até zerar; modelos esgotados apagados).
5. Pane: sinaleira, botão pausa, botão "mover" ao bater limite, recibo colapsável na 1a mensagem do Pane filho. Tema escuro.
6. Cofre: lista (nome, escopo, badge sensível), valor mascarado, "copiar" desabilitado em sensitive.
Recibo: "Conta escolhida por {source} com {confidence}% de confiança. Folga medida pelo headline: {used_pct}% usado na janela {window}."

## 4. Contratos
**Router.resolve(req) -> RouteResult** (síncrono, p95 <= 3 s). req: workspace_id, origin(pilot|user|mcp), prompt, task_type?, explicit{provider, model, effort, account_id, skills, agent}, mission_id, parent_pane_id. Result: executor, account_id, task_type, decisions[], sources{task_type, executor, account}, receipt, warnings. Erros: entitlement_required, executor_disabled, no_capacity, unknown_task_type, provider_unavailable.
**DeciderClient.ask(q)**: q = {kind choice|score|boolean, purpose, context, question, options[{id, description}]}; A = {probs, choice, confidence, latency_ms, cost_usd, raw_model}. HTTP para OpenRouter `chat/completions` (compatível OpenAI), com chave do usuário.
**Eventos**: decision_made, limit_reached{pane_id, account_id, window}, account_switched{pane_id, from, to, reason manual|auto}, pane_status_changed{pane_id, status ready|working|waiting_user, cause}, policy_changed{task_type, by}, vault_entry_changed{entry_id} (sem valor).
**Tools MCP (servidor `overclock`)**: `harness_list{workspace_id?, category?}`; `harness_recommend{task_description, workspace_id?}` -> {task_type, confidence, executor, account_id?, source decider|heuristic} (não cria Pane); `harness_set{task_type, category?, workspace_id?, provider, model, effort, skills[], agent, fallback[]}` (erros executor_disabled, unknown_skill, invalid_effort, entitlement_required); `pane_spawn` ganha `route: auto|none` (default auto se level>=3) e devolve receipt + decisions[]; `decisions_list{since, purpose, limit<=200}` -> {decisions, totals{count, cost_usd}}; fase 2: `account_switch{pane_id, target_account_id?, reason?}` (erros no_capacity, not_at_limit, provider_mismatch), `vault_list`, `vault_get` (só non-sensitive; erro sensitive_denied).
**Dependências consumidas**: Headline.get_limits(account_id[]); Providers.list_accounts/list_models(enabled_only)/launch(account_id, model, effort, allow_skills[]); Panes.spawn/status_hooks; Memory.restore_brief(pane_id); Entitlements.has("harness_auto").
**Sinais de status**: hooks do Claude Code (Notification, Stop, UserPromptSubmit) + heurística de saída PTY para outros CLIs [DEC].

## 5. Algoritmos
**5.1 Resolução de rota (7.1)**: (1) checar entitlement (sem ele + route=auto => erro ou usa explicit); (2) explicit vence sempre; (3) classificar TaskType: dado > decisor (argmax probs, aceita se confidence >= min_confidence) > heurística por palavras-chave > `general`; (4) carregar Policy (workspace senão global), candidatos `[executor, ...alternates, ...fallback]` filtrados por provider/modelo desativado ou sem capacidade; se decisor de modelo/esforço ligado e >1 viável em principal+alternates, ask(choice) restrito; senão o primeiro viável; (5) escolher conta (5.2); nenhuma => próximo candidato; todos => no_capacity; (6) skills = executor.skills ∩ instaladas + `allow skills`; (7) persistir Decisions, montar recibo, Panes.spawn, emitir decision_made.
**5.2 Escolha de conta (7.3), núcleo do produto** (pseudocódigo da spec):
```
deciding_window(acc, model) = max(acc.windows + balde_do_modelo, key=used_pct)   # gargalo
exhausted = deciding_window.used_pct >= threshold(100)
key(acc)  = (deciding_window.resets_at, deciding_window.used_pct)                # termina primeiro; desempate menor uso
candidatas = contas habilitadas, auth ok, não reservadas a outro papel, respeitando pin, não exauridas
snapshot ausente => key=+inf (só se não houver outra)
rule_choice = min(candidatas, key=key)
```
Se `account_selection_mode=decider`: ask(choice) com features (used_pct, resets_in); aceita só se confidence >= min_confidence E escolha ∈ candidatas não esgotadas; senão rule_choice. Registra `diverged`. Regra é autoridade (bug do dia 80: decisor escolheu a conta que terminava por último, 38% de confiança).
**5.3 Failover (7.4)**: detectar limit_reached (Headline >= threshold ou mensagem do CLI) -> se auto_failover=false só botão "mover" -> senão hops+=1 (máx 2), conta por 5.2 excluindo atual, senão próximo fallback, senão no_capacity + notificação -> novo Pane com restore brief, antigo `superseded`, evento account_switched -> cooldown da conta origem de 5 min ou até resets_at.
**5.4 Níveis (7.6)**: 1 executor único, todas skills; 2 Policy por categoria numa conta; 3 = 2 + filtro de skills por Agent; 4 = Policy por TaskType + N contas + roteamento + decisor (exige entitlement; downgrade automático).
**5.5 Semáforo (7.5)**: ready -prompt enviado-> working; working -Stop/idle-> ready; working -permissão/pergunta e bypass=false-> waiting_user; working -pergunta forçada mesmo com bypass-> waiting_user; waiting_user -resposta-> working; waiting_user -pausa-> ready (descarta prompt).
**5.6 Cofre/broker (7.7)**: leitura só no processo principal; entradas normais injetáveis como env (opt-in por Workspace); `sensitive` nunca em env: acesso via "ações" do app que resolvem `{{vault:NAME}}` no processo principal; saída passa por scrubber que remove o valor literal.
**5.7 Casos-limite**: decisor off/timeout/JSON inválido => regra, source=fallback, sem erro; OpenRouter sem crédito (ocorreu no dia 80) => circuit breaker 5 min + aviso; todas as contas esgotadas => alternates/fallback de outro provider; snapshot > 60 s => rebuscar, falha => unknown; modelos de cota separada consultam balde próprio.
**5.8 Semente da Policy [DEC]**: bug-fix->Sonnet/high/skill protocolo; bug-deep->Fable 5.1; bug-normal->GPT 5.6; front->Kimi K3; pentest->Codex GPT 6 Sol/high; orchestration->Fable; review->Luna; ~16 tipos sem valor [LAC] (default: modelo intermediário do provider preferido). Prompts do decisor: system base (JSON estrito `{"probs":{...}}`, soma 1, sem inventar) + templates 8.1 classificação, 8.2 modelo/esforço, 8.3 conta (textos completos na spec §8).

## 6. Casos de teste (CT-01..14)
01 regra de conta (conta reseta em 1 dia/60% vence a de 5 dias/40%); 02 exaustão (conta 100% pulada); 03 delegação completa via decisor + recibo + skills restritas; 04 instalação nova = zero chamadas ao decisor; 05 OpenRouter 402/timeout => fallback heurístico + breaker; 06 executor desativado (erro em set; resolve cai em Opus 5); 07 divergência (38% < min_confidence => rule_choice aplicada, diverged registrado); 08 "mover" manual (restore brief, antigo superseded, account_switched manual); 09 modelo esgotado em todas as contas (desabilitado, usa alternate); 10 semáforo com bypass (verde->amarelo->verde; pergunta forçada vermelho; pausa descarta); 11 máx 2 saltos => no_capacity; 12 cofre broker (env sem a variável; vault_get => sensitive_denied); 13 custo (127 decisões = ~US$0,025); 14 sem `harness_auto` => entitlement_required.

## 7. [LAC] e decisão recomendada
- **Algoritmo de roteamento (principal)**. A spec define `key = (resets_at, used_pct)` da janela GARGALO (maior % usado). Problemas: (a) "termina primeiro" usa o reset da janela de maior uso, que pode ser a de 5h de uma conta e a semanal de outra, comparando maçã com laranja; (b) o dia 80/81 tinha bug real de roteamento e não se sabe se foi corrigido; (c) a spec-09 `headline_pick` usa OUTRA regra (menor used_pct = maior folga), conflitante com a spec-03 (reseta primeiro). **Recomendação**: adotar o algoritmo da spec-03 como autoridade única, implementado num módulo puro `pickAccount(accounts, snapshots, model, opts)` (determinístico, testável por tabela, sem I/O), e `headline_pick` só delega a ele com uma flag de estratégia (`strategy: expires_first|max_slack`). Usar janela gargalo por conta (excluindo exauridas), desempate por menor uso, depois por account_id (estabilidade). Adicionar guarda [DEC minha]: não preferir conta cuja janela decisiva reseta em < N minutos e tem pouca coisa a gastar (ruído) e tratar a janela 5h como "termina primeiro" só se a semanal não for o gargalo; manter log de cada escolha (Decision com features) para calibrar depois. Decisor LLM em roteamento de conta: manter OFF por padrão e sempre subordinado à regra (o único dado observado é ele errar).
- Tabela de Policy completa [LAC]: aceitar semente curta + bench; nada hard-coded. Estratégia de skills fora do Claude Code: injetar no prompt + `skills_enforced=false`. Modelo/endpoint do decisor [LAC]: cliente genérico OpenAI-compatível configurável, default um modelo barato via OpenRouter escolhido pelo usuário. Janela "termina primeiro" [LAC]: gargalo. `account_switch`/`limit_reached` [LAC]: implementar (F4). Mapeamento plano<->nível [LAC]: flag de entitlement local, stub no MVP.

## 8. Pegadinhas e dependências externas
OpenRouter (dependência externa, risco de vazamento de prompt: enviar só resumo <= 500 chars, opt-out; cobrança; 402 sem crédito; breaker); multi-conta por provider inconsistente (Antigravity logou sempre na mesma conta); nome literal da flag `allow skills` a verificar no CLI instalado; snapshot de limites obsoleto; limite detectado por texto do CLI é frágil; migração perde contexto "pensado"; `bypass_permissions` interage com semáforo; ler arquivos de token pode acionar antivírus; nomes de modelo voláteis; 3 pontos de falha de tempo (resolve <= 3 s inclui decisor 2 s + fetch de limites); ping-pong entre contas sem cooldown; Electron: hooks/PTY via node-pty, cofre via `safeStorage`/keychain.

---
# SPEC-09: Overclock Headline (limites por conta), MCP `headline`, ARR

## 1. Requisitos funcionais
- RF-09.01 (P0) Listar todas as Accounts por Provider com used_pct e resets_in por janela (2 Claude + 3 Codex separadas).
- RF-09.02 (P0) Providers: Claude, Codex, Antigravity/Gemini, Kimi, Cursor, Grok/Groq; método de leitura de cada um [LAC].
- RF-09.03 (P0) Leitura 100% local (CLI/credenciais locais), nada enviado a servidor externo.
- RF-09.04 (P0) Tempo até reset por janela; ícone reflete a pior janela (bottleneck).
- RF-09.05 (P1) Aba Retrospect: histórico semanal, cada janela "bateu"/"não bateu" 100%.
- RF-09.06 (P1) Mostrar próxima sessão (queda da janela 5h).
- RF-09.07 (P0 no produto standalone; no ADE embutido vira irrelevante) Compartilhar login com o ADE; Entitlement Ultra; CTA upgrade/login.
- RF-09.08 (P0) MCP local com tools de limites. RF-09.09 (P0) `headline_pick`: conta com maior folga na janela gargalo antes de abrir Pane.
- RF-09.10 (P1) Auto-update (GitHub Releases), notarização macOS. RF-09.11 (P0) macOS/Windows/Linux.
- RF-09.12 (P1) Health-check/retry do MCP (falhou e foi religado no dia 73).
- RF-09.13 (P2, fase 2) Fixar conta Claude por Workspace e notificar limites.
- RF-09.14/.15 (P2) ARR Stripe na barra com seta up/down; polling >= 60 s com backoff exponencial; chave Stripe read-only.

## 2. Entidades
AccountUsage{account_id, provider, label, windows[{kind five_hour|weekly|monthly, used_pct, resets_at}], bottleneck, slack_pct, sampled_at, status ok|unavailable|auth_error}. RetrospectWeek{week_start, account_id, weekly_peak_pct, hit_100_weekly, five_hour_hit_rate} [DEC]. ArrSample{arr_cents, currency, delta, sampled_at}. EntitlementCache{plan, checked_at, expires_at}. Invariantes: 0<=used_pct<=100; bottleneck = janela com maior used_pct; slack_pct = 100 - used_pct(bottleneck). Amostragem ~60 s; agregação semanal em SQLite/JSON; credenciais nunca copiadas.

## 3. UI
Ícone de barra/bandeja com texto compacto ("99%"); popover (<300 ms) com cartões por Provider/Account, barra por janela, "zera em 1 h"; abas Limites e Retrospect; rodapé (versão, atualizar, sair); estado bloqueado com CTA. Exemplos: sessão zera 1 h (99%), semanal 21 h, Cursor 17 dias (mensal), Antigravity ~4-5 h. No Electron-ADE: barra de limites embutida no topo (já prevista na spec-03); Tray API do Electron para o modo bandeja.

## 4. Contratos
Eventos: usage_sampled, bottleneck_changed, window_reset, provider_unavailable, arr_sampled. MCP `headline` (stdio local): `headline_limits{provider?}` -> {accounts:[AccountUsage]} (erro unavailable); `headline_pick{provider, window five_hour|weekly|auto}` -> {account_id, slack_pct, reason} (erro no_account_available); fase 2 `headline_switch_account{workspace_id, account_id}`. Instrução ao agente: "Before opening a pane, call headline_pick for the target provider and use the returned account." Externos: backend Overclock (entitlement), GitHub Releases, Stripe. Interface consumida pela spec-03: `get_limits(account_id[]) -> LimitSnapshot[]` (note a diferença de forma: spec-09 usa `kind/five_hour`, spec-03 usa `name/5h`: normalizar num schema único).

## 5. Algoritmos
- **Amostragem**: a cada 60 s por adaptador de Provider -> AccountUsage -> recalcula bottleneck -> emite eventos.
- **headline_pick**: filtra status=ok; `used = window=='auto' ? max(used_pct das janelas) : used_pct(window)`; escolhe MENOR used (maior folga); empate = reseta antes; nenhuma => no_account_available.
- **Retrospect**: no `window_reset` semanal grava weekly_peak_pct; hit_100_weekly = peak >= 99 [DEC].
- **Leitura de limites por provider**: NÃO especificada [LAC, Q-09.2], só inferida (CLI/credenciais/arquivos locais; o original tinha Swift/Go e sofreu falso positivo de antivírus por ler arquivos de token). Precisa de adaptador por provider com interface estável `fetchUsage(account) -> windows[]`, isolado para trocar método. Observação: Cursor só tem janela mensal; Antigravity tem ciclo ~5 h; modelos como Fable/Spark/Luna têm cota separada (spec-03 pede `model_buckets`, que a spec-09 NÃO modela: lacuna de contrato entre specs).
- Widget: unauthenticated -> (login + Ultra) -> active; sem Ultra -> blocked; active + entitlement inválido -> blocked; provider falha -> conta `unavailable`.
- Casos-limite: conta sem credencial => `auth_error` sem derrubar as demais; janela sem dados => só `monthly`.

## 6. Casos de teste
1) 2 Claude (88%/68% semanal) listadas com % e reset; 2) Codex five_hour 99 / weekly 40 => bottleneck five_hour, slack 1; 3) folgas 5/30/12 => pick = 30; 4) nenhuma ok => no_account_available; 5) sem Ultra => bloqueado com CTA; 6) credencial expirada => só aquela em auth_error; 7) reset semanal => nova linha Retrospect correta; 8) MCP fora do ar => widget religa; 9) Defender não sinaliza binário assinado (manual); 10) Stripe rate limit => mantém último valor + backoff.

## 7. [LAC] e decisão recomendada
Q-09.1 SO: alvo final os três. Q-09.2 leitura por provider: **decisão**: no ADE Electron, não construir widget separado; implementar `LimitsService` no processo main com adaptadores por provider, começando por Claude e Codex (MVP), degradando para `unknown` (não quebrar roteamento). Q-09.3 formato Retrospect: usar o [DEC] da spec. Q-09.4 schemas MCP: usar os da spec e unificar com spec-03. Q-09.5/ARR: fora do escopo do ADE (P2, cortar). Q-09.6 versões: irrelevante.
- Conflito de algoritmo: spec-09 `pick` = menor used_pct; spec-03 = reseta primeiro. Recomendação: um único `pickAccount` (ver spec-03 item 7); `headline_pick` no MCP apenas expõe estratégia `max_slack` (spec-09) ou `expires_first` (spec-03, default do roteador). Em empate do max_slack usar reseta antes (já definido).

## 8. Pegadinhas
Formatos de credencial/uso dos providers mudam sem aviso; ToS ao ler credenciais locais; falso positivo de antivírus; ~R$500/mês de build (irrelevante em app novo); no Electron: `MCP` stdio pode ser subprocesso/embutido no main; polling de 60 s por conta multiplica chamadas (backoff, cache 60 s compartilhado com o roteador); `weekly_peak_pct >= 99` tem fragilidade (arredondamento); timezone/`resets_at` em UTC; Cursor mensal mistura escalas de tempo na UI.

---
# SPEC-14: Bench (bateria multi-modelo, score, juiz cego, publicação)

## 1. Requisitos funcionais (resumo)
**Biblioteca**: RF-14.1.1 (P0) catálogo BenchTask versionado (CRUD, version++ a cada mudança de prompt/checks); .1.2 (P0) seed de 9 tarefas; .1.3 (P1) categorias extensíveis (`activity_type` slug); .1.4 (P2) importar prompts do histórico e agrupar com modelo barato (Haiku), status=draft; .1.5 (P0) esforço NUNCA no texto do prompt (vai na flag), validação rejeita "extra high"/"effort:".
**Execução**: .2.1 (P0) Run = tarefas x alvos, um Pane por par, `max_parallel=5`; .2.2 (P0) diretório isolado `bench/standalone-<task>/<target>/`; .2.3 (P0) headless, single shot, always-approve, esforço máximo, sem orquestração/MCP/skills/harness; .2.4 (P0) prefixar prompt com cabeçalho headless (salvo em `effective_prompt`); .2.5 (P0) `HeadlessAdapter` por CLI (flags reais [LAC]); .2.6 (P1) timeout_s=1800 => status=timeout, artefato parcial mantido; .2.7 (P0) erro => failed, quality=0, sem retry; .2.8 (P1) re-run apaga pasta, attempt+1, anterior superseded; .2.9 (P0) conta sem limite => par `queued` + aviso, NUNCA troca conta silenciosamente.
**Métricas**: .3.1 (P0) custo USD, tempo de parede, tokens_out, tokens_total, revisions (tokens_in informativo, fora do score); .3.2 (P0) custo = relatório da CLI, senão tokens x ModelPrice; USD canônico; `cost_source`; .3.3 (P1) idas e vindas = rodadas de revisão (extração por CLI [LAC], null se indisponível); .3.4 (P0) assinatura => `cost_kind=api_equivalent`; .3.5 (P0) screenshot automático (Chrome headless) em tarefas web.
**Juiz/score**: .4.1 (P0) juiz cego, ordem aleatória, rótulos A/B/C; .4.2 (P0) juiz != executores (default: modelo do orquestrador se fora dos alvos, senão próximo de `judge_models`); .4.3 (P0) nota 0-10 por critério (functionality, visual, completeness, robustness) + overall + rationale; .4.4 (P0) evidência objetiva anexada (console errors, screenshots, checks); .4.5 (P0) score composto com pesos configuráveis e exibidos; .4.6 (P1) rejulgar sem re-executar; judge pending sem composite; .4.7 (P0) veredito considera custo, tokens, revisões.
**Banco/comparação**: .5.1 (P0) SQLite local `bench.db`; .5.2 (P0) `bench_compare(a,b)` por tarefa/categoria, deltas, placar; .5.3 (P0) só compara mesma task.version e esforço; .5.4 (P1) N>=2 alvos e relatório textual; .5.5 (P1) novo modelo roda só a própria bateria, reutilizando resultados antigos.
**Site**: .6.1-.6.9 (P1/P2) grade de modelos, `/compare/<a>/<b>`, `/prompts` com botão copiar, `/model/<slug>`, barra "squads recomendados", publicação por snapshot JSON estático com confirmação, só tarefas `public=true`, transparência (data, versão CLI, pesos).
**Harness**: .7.1 (P0) `bench_recommend(activity_type, constraints)` ordenado com evidence; .7.2 (P0) `bench_export_policy` só rascunho, nunca grava Policy; .7.3 (P2) consulta automática em tempo real atrás de entitlement `bench.harness_query`; .7.4 (P0) nunca recomendar provider desativado/sem conta; .7.5 (P0) `no_data` se < min_samples (default 1).
**Nebula**: .8.1-.8.3 (P2) design system dark, glass, fundo animado Three.js; tokens num arquivo único; hex [LAC].
Nota: para o ADE o site público é opcional/cortável; o núcleo é execução + juiz + score + recomendação.

## 2. Entidades e campos
- **BenchTask**: id(ULID), slug, version, title, activity_type, kind(web|code|analysis), prompt, reference_urls[], fixtures_path, checks[{type, path?}], judge_rubric, public, squad_hint, scope_hint, source(observed_verbatim|observed_paraphrase|authored), status(draft|active|retired). `active` exige prompt sem indicação de esforço.
- **BenchTarget**: id, slug=`<provider>-<model>-<effort>`, provider_id, model, effort, cli, cli_version, account_id?, label.
- **BenchRun**: id, name, task_ids (congeladas com version), target_ids, status(queued|running|judging|done|partial|cancelled), max_parallel=5, judge_model, weights{quality, speed, cost} congelados, created_by, started_at, finished_at, orchestrator_pane_id?.
- **BenchResult** (tarefa x alvo x tentativa): run_id, task_id, task_version, target_id, attempt, pane_id, session_id, workdir, effective_prompt, status(queued|running|done|failed|timeout|cancelled|superseded), started/finished/duration_s, cost_usd, cost_source(cli_report|price_table), cost_kind(metered|api_equivalent), tokens_in/out/total, revisions?, artifacts[{path, type, sha256}], checks_result[{type, pass, detail}], judge_status(pending|done|error), quality 0-10?, quality_detail, composite 0-100?, notes. Invariantes: composite só se judge_status=done; failed/timeout sem artefato => quality=0; no máx. um resultado não-superseded por (run, task, target).
- **JudgeVerdict**: task_id, task_version, run_id, judge_model, blind_map{A:result_id}, scores{result_id:{functionality, visual, completeness, robustness, overall, rationale}}, ranking. blind_map gravado mas nunca enviado ao juiz.
- **ModelPrice**: provider_id, model, price_in_per_mtok, price_out_per_mtok, cached_in_per_mtok?, valid_from (valores [LAC]).
- **BenchSnapshot**: version, generated_at, weights, targets, tasks[public], results[campos públicos], comparisons_index.
- Custo congelado no resultado (mudança de preço posterior não altera).

## 3. Telas/UI
App: tela Bench no Workspace de bench: seletor de tarefas (checkbox + filtro activity_type), seletor de alvos (provider/modelo/esforço das contas ativas), "Rodar bateria" (estimativa de custo + confirmação acima de `cost_confirm_usd`=10), grade tarefa x alvo (célula: estado, custo, tempo, nota), painel de detalhe (preview do artefato + screenshot), botões Julgar/Comparar/Publicar; Panes de execução visíveis na lateral (botão para ocultar); interface conversacional via MCP (frases da spec §8.5). Site (opcional): `/`, `/compare/<a>/<b>`, `/model/<slug>`, `/prompts`, barra lateral "Squads recomendados"; estados vazio/carregando/erro; tokens Nebula CSS.

## 4. Contratos
**HeadlessAdapter**: `cli`, `buildCommand({model, effort, workdir, prompt, always_approve:true}) -> {cmd[], env}`, `parseUsage(stdout, logs) -> {tokens_in?, tokens_out?, cost_usd?, revisions?}`.
**Eventos**: bench.run.created, bench.result.started{result_id, pane_id}, bench.result.finished{result_id, status, duration_s, cost_usd}, bench.judge.started, bench.judge.finished{task_id, verdict_id}, bench.run.finished, bench.snapshot.published{version, url}.
**Reuso de Pane** (spec-02): spawn com `mode=headless`, `mcp=none`, `skills=none`, `cwd=<workdir>`.
**Tools MCP (namespace overclock)**: `bench_list_tasks{activity_type?, status?}`; `bench_run_suite{name?, task_slugs[]|"all", targets[{provider, model, effort}], max_parallel?, skip_existing?}` -> {run_id, planned} (erros unknown_task, target_unavailable, account_limit_reached); `bench_run_status{run_id}` -> grid; `bench_rerun{run_id, task_slug, target}` (not_found, still_running); `bench_judge{run_id, task_slug?, judge_model?}` (judge_conflicts_with_executor, no_results); `bench_compare{targets>=2, task_slugs?, group_by task|activity_type}` -> {rows, scoreboard, verdict} (not_comparable); `bench_recommend{activity_type, constraints{max_cost_usd, max_duration_s, providers}}` -> ranking[{target, composite, cost, duration, samples, evidence[]}] ou {no_data:true}; `bench_export_policy{activity_types?}` -> draft_policies; `bench_publish{run_ids?, dry_run?}` -> {snapshot_version, url, diff} (judge_pending, not_confirmed; exige `confirm:true` na sessão).
**Arquivos**: SQLite `<workspace>/bench/bench.db`; artefatos `bench/standalone-*/`; público: `snapshot/latest.json`, `snapshot/<version>.json`, `artifacts/<task>/<target>/...`. Cabeçalho headless genérico sem a palavra "extra high" + segundo parágrafo por tarefa (`scope_hint`). Textos embutidos: prompt literal só do sistema-solar; Minecraft quase verbatim; demais são base [DEC] (9 tarefas: solar-system-3d, canvas-physics-lab, apple-site-clone, fps-dust2, debug-find-and-fix, css-responsive, code-review, refactor-existing-code, dirty-data); prompt do juiz (JSON estrito com scores por rótulo e ranking).

## 5. Algoritmos
**Score composto (7.2)**, por tarefa t, alvos A na mesma versão:
```
Q = quality/10;  S = min_dur(t,A)/dur;  C = min_cost(t,A)/cost
composite = 100*(wq*Q + ws*S + wc*C)     # default 0.6 / 0.2 / 0.2
portão: quality < 4 ou check crítico falha => S = C = 0
se revisions != null: composite *= max(0, 1 - 0.05*revisions)
alvo único => S=C=1, marcar "score não comparável"
agregado por alvo = média simples dos composite; por categoria = média dentro do activity_type
```
Risco: normalização por mínimo depende do conjunto de alvos (um novo modelo mais barato reduz o C dos demais); mitigação da spec: pesos congelados por Run e recomputar só no conjunto da comparação. Recomendação: armazenar métricas brutas e recalcular composite sob demanda por conjunto, nunca persistir como verdade absoluta.
**Veredito (7.3)**: vencedor = maior composite; empate |delta|<1,0 => menor custo, depois menos revisions; placar = tarefas vencidas; texto por template (reprodutível, sem LLM).
**Juiz cego / pacote (7.5)**: coletar artefatos finais; sanitizar metadados (nome de modelo, paths com slug do alvo, comentários "Grok/Claude" por busca simples); embaralhar e rotular; enviar prompt do juiz + prompt original + screenshots + resultado dos checks; validar JSON por schema; 1 retry; depois judge_status=error; artefato ausente => fora do julgamento e quality=0. Juiz diferente dos executores (default: modelo do orquestrador se não estiver nos alvos).
**Recomendação (7.4)**: resultados com activity_type X, status done, judge done; agrupar por alvo (avg composite, cost, duration, n); filtrar por constraints e providers ativos com conta; ranquear por composite; `expected_attempts = 1 + mean(revisions or 0)`; `expected_cost = avg_cost*attempts`; `expected_time = avg_dur*attempts`; estratégias `best_quality|cheapest_acceptable(min_quality)|fastest_acceptable(min_quality)`.
**Fluxo da Run (7.1)**: valida tarefas active e alvos com conta/limite -> cria workdir limpo (+fixtures) -> escalona pares com max_parallel -> Pane headless -> coleta duração/uso/custo/checks/screenshot -> quando todos os alvos da tarefa terminam, judging -> verdict -> composite -> Run done ou partial. Estado do resultado: queued->running->(done|failed|timeout|cancelled); done/failed/timeout -> rerun => superseded.
**Custo**: cli_report > tokens x ModelPrice; assinatura => api_equivalent. **Semente da Policy**: `bench_export_policy` transforma ranking por activity_type em rascunho `{task_type, executor, alternates}` (mapeamento activity_type -> TaskType da spec-03 é implícito, precisa tabela explícita).

## 6. Casos de teste (13)
1) 9 tarefas x 1 alvo, max 5 Panes simultâneos, todas `done` com métricas; 2) isolamento (workdir por alvo, sem MCP nem skills no config do adapter); 3) esforço no prompt rejeitado e passado como flag; 4) juiz cego (sem nomes, ordem aleatória, blind_map revelado depois, juiz != executor => judge_conflicts_with_executor); 5) JSON inválido 2x => judge_status=error, composite nulo, Run não vai a done; 6) portão de qualidade (barato que quebra < caro que funciona); 7) timeout preserva artefato parcial; 8) re-run (attempt=2, anterior superseded); 9) compare soma 9, versões diferentes => not_comparable; 10) novo modelo incremental com skip_existing; 11) publish bloqueado com judge_pending, `/prompts` só public=true; 12) recommend exclui provider desativado, `no_data` sem amostras; 13) conta sem limite => par queued sem troca silenciosa.

## 7. [LAC] e decisão recomendada
Pesos: usar 0,6/0,2/0,2 configuráveis por Run. Mapeamento ids 101-108 e prompts literais: criar prompts próprios, marcar `source=authored`. Modelo juiz [LAC]: configurável, default modelo forte fora dos alvos; para reduzir viés, rodar 2 juízes e tirar média em Fase 5. Flags de headless por CLI [LAC]: descobrir pelo `--help`/docs de cada CLI; MVP com Claude Code (`-p`, sem garantia) e Codex (`exec`); testar com adapter contract tests. Extração de revisions [LAC]: null no MVP. Banco: SQLite. Hospedagem do site: estático, opcional/cortar no MVP. Hex Nebula: irrelevante para o ADE. Consulta automática do Harness (fase 2): implementar `bench_recommend` interno (sem entitlement no MVP). Tabela de preços: arquivo de dados versionado, editável.

## 8. Pegadinhas e dependências
Always-approve executa código gerado sem confirmação: sandbox real de cwd, env mínimo, sem segredos do Cofre nem tokens do app, rede só com `reference_urls`; Chrome/Chromium instalado para screenshots (Playwright/CDP); modelos de assinatura não dão custo por token; cada CLI exige adapter próprio; custo de uma bateria completa multiplica por alvos (mostrar estimativa, confirmar > US$10); juiz LLM tem viés e pode ser gamificado; tarefa `apple-site-clone` depende de rede e de site que muda (não reprodutível); publicação exige filtrar prompts privados do histórico; bench roda em Pane do app mas NÃO pode usar roteamento de conta do harness (evita contaminar custo); paralelismo x limites de conta (respeitar teto por Provider); nomes de modelo/esforço mudam, guardar `cli_version`.

---
# Síntese para o plano (ordem de implementação sugerida)
1. `LimitsService` (spec-09) com adaptadores Claude/Codex + cache 60 s + schema único (inclui model_buckets).
2. Módulo puro `pickAccount` + Policy/TaskType + `Router.resolve` sem decisor (spec-03 F1), com recibo e tabela Decisions.
3. Semáforo via hooks (Claude) + heurística PTY; barra de limites; "mover" manual + restore brief; cofre simples.
4. Bench MVP (2 adapters, Run/Result/SQLite, grade, screenshot), depois juiz/score/compare, depois `bench_export_policy`.
5. DeciderClient (OpenRouter), circuit breaker, painel Decisões, auto_failover, broker do cofre, site público por último/opcional.
