# Contratos

Fonte da verdade do que é gravado, trocado entre processos e exposto às CLIs. Mudar aqui antes de
mudar o código. Convenções: chaves `snake_case`, enums minúsculos sem acento, `null` para ausente
(nunca `""`/`"n/a"`), booleanos reais, momentos em UTC ISO 8601 com milissegundos
(`2026-09-30T12:00:00.000Z`), caminhos relativos à raiz do workspace, escrita atômica
(temp + rename), JSONL só-acréscimo, segredos nunca gravados.

## 1. Banco (`<userData>/expxv.db`, SQLite WAL)

`schema_version` em `PRAGMA user_version`. Migrations em `src/nucleo/banco/migracoes/NNNN-*.ts`,
cada uma em transação. Ids: ULID com prefixo de tipo (`ws_…`, `mis_…`, `pane_…`). Campos comuns:
`id`, `criado_em`, `atualizado_em`.

| Tabela | Campos-chave |
|---|---|
| `workspace` | `nome`, `raiz` (absoluto só aqui, é do usuário), `e_git`, `acesso_externo` (`nenhum\|leitura\|leitura_escrita`), `permissao` (`seguro\|automatico`), `ultimo_uso_em` |
| `mission` | `workspace_id`, `modo` (`livre\|squad\|agentico`), `origem` (`livre\|feature\|ocorrencia\|pedido\|projeto`), `trabalho_id` (nullable), `titulo`, `estado` (`intake\|planejando\|executando\|revisando\|concluida\|falhou\|abortada`), `worktree` (relativo à raiz do repo pai), `branch`, `piloto_pane_id`, `concluida_em` |
| `pane` | `mission_id` (nullable), `workspace_id`, `display_id` (inteiro, autoincremento persistido, **nunca reutilizado**), `tipo` (`cli\|shell`), `cli`, `executavel_id`, `conta_id`, `modelo`, `esforco`, `papel` (`piloto\|executor\|explorador\|revisor\|nenhum`), `eh_piloto`, `estado` (`iniciando\|pronto\|trabalhando\|aguardando\|bloqueado\|encerrado`), `sessao_pty_id`, `respawn_de`, `cwd` (relativo ao workspace), `encerrado_motivo` |
| `sessao` | `pane_id`, `cli_ref_conversa`, `ultimo_uso_em` (retomada de conversa) |
| `conta` | `provedor`, `rotulo`, `config_dir_ref`, `habilitada` (segredo nunca; só referência) |
| `task` | `mission_id`, `task_ref` (`T-NN.MM` ou `t-N`), `titulo`, `briefing_path`, `papel`, `estado` (`aberta\|reivindicada\|entregue\|validada\|descartada`), `pane_id`, `handoff_id` |
| `handoff` | `task_id`, `de_pane_id`, `para_pane_id`, `resumo` (≤ 400), `relatorio_path`, `status` (`ok\|parcial\|bloqueado\|falhou`) |
| `evento_dominio` | `tipo`, `payload_json`, `criado_em` (auditoria curta, retenção 30 dias) |
| `layout` | `workspace_id`, `json` (v2), validado na leitura |
| `config` | `chave`, `valor_json` |

Índices de paginação por cursor (`0002-dominio`: mission/pane/task por `(pai, id)`) não alteram colunas.

Invariantes: 1 piloto por Mission; `display_id` nunca volta; `task.estado = validada` exige handoff
`ok` de um Pane com papel `revisor`; `resumo` ≤ 400; fechar Pane e atualizar Mission são
transacionais.

## 2. IPC (main ↔ renderer)

API exposta: `window.ade` (enumerada em `src/preload/preload.ts`, travada por teste de formato).
Padrão: `invoke` (pedido/resposta) para comandos; `send` (sem resposta) para teclado/redimensionar;
eventos por `assinar(cb) → cancelar`. Canais com prefixo de domínio:

- `terminais:*` — `detectar`, `abrir`, `escrever`(send), `redimensionar`(send), `encerrar`,
  `interromper`, `recuperar`, `diagnostico`, `confirmar_consumo`(send), `anexar`, evento `saida`.
- `workspaces:*` — `listar`, `abrir`, `remover`, `definir_permissao`, `worktrees`.
- `missoes:*` — `listar`, `criar`, `detalhe`, `encerrar`, `abortar`.
- `provedores:*` — `listar`, `escolher_executavel`, `diagnostico`.
- `metodo:*` — `estado`, `trabalho`, `rastro`, `comando_sugerido`, `disparar`.
- `layout:*` — `ler`, `gravar`.
- `app:*` — `versao`, `perf`, `tema`, `config_ler`, `config_gravar`.
- `limites:*`, `harness:*`, `cofre:*`, `provedores:openrouter_*` — Fase 9, ver §8.

Envelope de evento de terminal: `{versao:1, sequencia, sessao_id, tipo, …}` (`saida`, `estado`,
`encerramento`, `atividade`, `conversa`). `sequencia` monotônica por sessão; evento com
`sequencia <= ultima` é descartado. Limites: 64 args de 4 KiB, escrita ≤ 64 KiB, 2–500 colunas,
1–300 linhas, **16 sessões por janela** (MVP; configurável), buffer de saída 2 MiB por sessão.
O renderer **nunca envia `cwd`**: o main resolve pelo workspace/missão.

## 3. MCP do app

Servidor HTTP em `127.0.0.1:<porta efêmera>`, transporte MCP streamable HTTP, sem CORS aberto.
`Authorization: Bearer <token>`; token de Pane `{workspace_id, mission_id|null, pane_id, role, mode,
tools_allow[], exp}` assinado com segredo aleatório do processo (HMAC-SHA256), relido a cada
chamada. `mission_id`, `pane_id` e `role` **vêm do token**, nunca do argumento.

Erro padrão `{code, subcode?, message}`; `code ∈ unauthorized|not_found|invalid_argument|
rule_violation|skill_not_allowed|conflict|unavailable|memory_disabled|too_large`;
`subcode` (de `rule_violation`/`unavailable`) ∈ `forbidden_role|gate_pending|reviewer_required|
limit_reached|provider_disabled|not_in_mission|handoff_missing|summary_too_long|
pilot_cli_unsupported_intake`.

Tools do **MVP** (catálogo consolidado em `base/B-…` §0.3):

| Tool | Entrada | Saída |
|---|---|---|
| `provider_list` | — | `[{provider, cli, accounts[], enabled}]` |
| `model_list` | `{provider}` | `[{model, effort_levels[]}]` |
| `pane_spawn` | `{provider, model?, account_id?, role?, agent_id?, briefing_path?, cwd?}` | `{pane_id}` |
| `pane_list` | `{mission_id?}` | `[{pane_id, provider, role, state, task_id}]` (sem conteúdo de tela) |
| `pane_read` | `{pane_id, last_n?=200, max_n=2000}` | `{lines[], state}` |
| `pane_send` | `{pane_id, text, submit?=true}` | `{accepted}` |
| `pane_close` | `{pane_id}` | `{ok}` |
| `handoff_submit` | `{task_id, summary≤400, report_path, artifacts?, status}` | `{handoff_id}` |
| `mission_list` | `{status?}` | `[Mission]` |
| `mission_complete` | `{}` | `{ok}` (exige revisor ok) |
| `catalog_list` | `{kind, query?}` | itens permitidos (pós-MVP: real) |

Matriz por modo: `livre` → provider_*, model_list, pane_*, handoff_submit; `squad` → + mission_complete,
task_*; `agentico` → tudo do MVP. Pós-MVP: `memory_*`, `harness_recommend`, `headline_pick`.

Ordem obrigatória do handoff: **relatório gravado e legível → banco → wake enfileirado**. Wake nunca
espera o chamador "ficar quieto"; entra na fila e é entregue no próximo ponto seguro.

## 4. Hooks por Pane (Claude Code) e fallback

Gerados **por Pane** em arquivo de settings temporário do app (nunca no settings global do
usuário), marcados `managed_by_expxv`: `Stop` ×2 (handoff registrado; relatório existe e não vazio;
`max_stop_retries = 3`), `PostToolUse` em `handoff_submit` (wake), `SessionStart` (briefing +
instruções). CLIs sem hook: prompt inicial por argv + watcher de ociosidade que reenvia lembrete
**uma vez** após `handoff_timeout` e ociosidade. Mensagem do stop hook: *"O worker tentou encerrar o
turno sem chamar handoff_submit. O orquestrador está bloqueado esperando. Chame handoff_submit com
o resumo do trabalho antes de encerrar."*

## 5. Arquivos gravados no repositório do usuário

Somente dentro de `.expxv/` (criado sob demanda, com `.gitignore` interno `*`):
`.expxv/missoes/<mission_id>/briefing-<task>.md` (seções `Contrato`, `Resultado`, `Executado_por`),
`.expxv/missoes/<mission_id>/relatorios/<task>.md`, `.expxv/entradas/<sessao>/…` (anexos). O ADE
**não** escreve em `docs/**` (D-04).

## 6. Método (leitura)

Parser e modelo derivado em `src/nucleo/metodo/`. Entradas e regras em `base/F-…` §2 e §5.
Modelo derivado: `Trabalho {id, tipo, origem_buildx?, titulo, estagio, status, worktree, sprints[]
→ fases[] → tasks[{id, titulo, fase, status, depende_de[], paralelizavel, suite, concluida_em}],
bloqueios[], veredito_auditoria?, veredito_qa?, entrega?}`. Violações: `teste_ausente`,
`regressao_ausente`, `concluida_sem_verde`, `paralela_com_dependencia`, `sem_criterio_saida`,
`dependencia_inexistente`, `ciclo_dependencia`, `estagio_incoerente`, `bloqueio_antigo`.
Sinaleira do trabalho: regra em `base/F-…` §5.3 (verde/amarelo/vermelho/cinza).

Mapa gesto → comando (sempre com argumento): nova feature `/expx:sprintx <pedido>`; nova
ocorrência `/expx:runx <texto>`; pedido cru `/expx:prodx-triar <texto>`; projeto
`/expx:buildx <descrição>`; retomar `/expx:sprintx <slug>` / `/expx:runx <OC-ID>`; auditoria
`/expx:sprintx-auditoria <slug>` (Pane separado); QA `/expx:runx-qa <OC-ID>` (Pane separado);
entrega `/expx:mergex-check` → `mergex-atencao` → `mergex-qa` → `mergex-pr`. No OpenCode, sem o
prefixo `expx:`.

## 7. Eventos de domínio (barramento interno, nomes com ponto)

`mission.created|gate_updated|closed`, `pane.spawned|state_changed|closed`, `handoff.submitted`,
`wake.queued|delivered`, `task.updated`, `method.changed`, `workspace.opened`,
`provider.detected`, `cost.updated` (pós-MVP). Canais IPC de UI usam o prefixo do domínio
(`terminais:`, `metodo:`…), não este barramento.

## 8. Limites, harness e roteamento (Fase 9)

Fonte: `docs/ade/fase-09-harness-limites.md` + overrides de `DECISOES-DAS-PENDENCIAS.md` (P-16, P-17, P-27..P-33).
Tipos em `src/compartilhado/{limites,harness}.ts`; canais em `src/compartilhado/ipc.ts`; validadores estritos em
`src/main/ipc/{limites,harness,cofre,openrouter}.ts` (chave do mapa = nome do canal). Manipuladores chegam nas ondas
seguintes (lista `CANAIS_SEM_MANIPULADOR_AINDA` em `src/main/ipc/registro.test.ts`, com a task de cada um).

### 8.1 Banco — migration `0005-harness` (versão 5)

`task_type`, `politica` (única por `(COALESCE(workspace_id,''), task_type)`; `fallback_json` nunca vazio: CHECK
`<> '[]'` + array com ≥ 1 item), `harness_workspace`, `conta_roteamento`, `pane_rota`, `troca_log`, `limite_manual`,
`limite_amostra` (WITHOUT ROWID; retenção 90 dias), `limite_semana` (permanente), `decisao`, `decisao_agregado_dia`,
`conta_openrouter` (só referência do cofre + `ultimos4`; a chave NUNCA está no banco), `openrouter_modelo`.
Ids: `pol_`, `dec_`, `trc_` (ULID). Custo/preço/saldo desconhecido é `NULL`, nunca 0.
Overrides aplicados em `harness_workspace`: `modo_troca ∈ {manual, so_sugerir, automatico}` (NULL = derivar de
`workspace.permissao`: automatico→automatico, seguro→so_sugerir); `max_saltos` (padrão **3**, 1..6);
`troca_entre_provedores` (padrão 1); `faixa_minima_troca ∈ {mesma, descer_1, qualquer}` (padrão `mesma`; `descer_1` =
descer UMA faixa com aviso, P-31); `limiar_troca_pct` 85 (50..99) `<` `limiar_esgotamento_pct` 100 (51..100, CHECK de tabela);
`margem_troca_pontos` 10; `nivel` 4; `injetar_cofre_no_env` 0; `piloto_edita_politica` 0.
Repositórios (`criarRepositorios`): `taskType`, `politica`, `harnessWorkspace`, `contaRoteamento`, `paneRota`,
`trocaLog`, `decisao`, `limiteManual`, `limiteAmostra`, `contaOpenrouter`, `openrouterModelo`.

### 8.2 Schema único de limites (D-56)

`LimitSnapshot`/`AccountUsage` (`kind: five_hour|weekly|monthly|credit`, `model_buckets`, `fonte`, `confianca`,
`fetched_at`, `bottleneck`, `slack_pct`, `idade_s`, `vencidas`), `CotaGeral` (pior caso, folga média só das contas com dado,
`cobertura {com_dado,total}`), `AmostraLimite`, `PrevisaoZerar`, `EficienciaSemana`, `AlertaLimite`, `EventoLimites`.
Invariantes: `used_pct ∈ [0,100]` ou `null`; janela vencida ou nula é desconhecida; `credit` não tem `resets_at`;
`confianca` nunca `medido` se `fonte ∈ {estimado, nenhuma}`. P-27: "Precisão máxima" é opt-in por provedor
(config `limites.precisao_maxima.<provedor>`, padrão desligado; token nunca guardado nem logado).

### 8.3 Harness, rota, troca, perfis, intenção

`Faixa` (`topo|alto|medio|rapido`), `Executor`, `Politica`/`PoliticaEntrada`, `TaskType`, `ConfigHarness`,
`ContaRoteamento`, `PedidoDeRota`/`ResultadoDeRota`, `ErroRoteamento`, `Decisao`, `ModoTroca`, `FaixaMinimaTroca`,
`Troca`, `PerfilAgente`, `ContextoPerfil`, `OpcaoIntencao`/`ContextoIntencao`/`ResultadoIntencao`,
`CandidataConta`/`OpcoesPick`/`ResultadoPick` (`pickAccount`), `EntradaEquivalencia`/`OpcoesModelo`/`ResultadoModelo`
(`pickModel`), `ConfigDecisor` (P-16: `cabecalho_chave`, `prefixo_chave`, `formato`, `modelo`; sem chave, só
`chave_ref` = NOME da entrada do cofre), `EntradaCofre`/`EstadoCofre` (P-29: `backend: safe_storage|senha_mestra|
indisponivel`, `bloqueado`), `ModeloOpenRouter`, `EstadoOpenRouter` (P-17: `clis[]` com `status` do adaptador).

### 8.4 Canais IPC (lista fechada; validador estrito por canal)

| Família | Invoke | Evento |
|---|---|---|
| `limites:` (8) | `snapshot`, `atualizar`, `manual_definir`, `manual_limpar`, `historico`, `previsao`, `eficiencia`, `alertas` | `limites:evento` |
| `harness:` (23) | `config_ler`, `config_gravar`, `task_types_listar\|_gravar\|_apagar`, `politica_listar\|_gravar\|_restaurar_semente`, `equivalencia_ler\|_gravar\|_restaurar`, `recomendar`, `decisoes_listar`, `contas_config_listar\|_gravar`, `trocas_listar`, `troca_decidir`, `mover_pane`, `decisor_ler\|_gravar\|_testar`, `classificar_intencao`, `resolver_perfil` | `harness:evento` |
| `provedores:openrouter_` (10) | `estado`, `consentir`, `revogar`, `chave_gravar`, `chave_apagar`, `testar`, `modelos_atualizar`, `modelos_listar`, `modelo_gravar`, `saldo_atualizar` | — |
| `cofre:` (7) | `disponivel`, `listar`, `gravar`, `apagar`, `senha_mestra_definir`, `desbloquear`, `bloquear` | — |

Chaves novas de `window.ade`: `limites`, `harness`, `openrouter` (canais `provedores:openrouter_*`), `cofre`. Entradas/saídas tipadas em `CanaisInvoke` (`src/compartilhado/ipc.ts`). Regras dos validadores: objeto estrito (campo
extra/ausente é erro); `usado_pct` finito em 0..100; `limiar_troca_pct < limiar_esgotamento_pct`; faixa, modo, propósito,
papel e janela só do conjunto fechado; `fallback` com ≥ 1 executor; `endpoint` do decisor **https**, sem credencial
embutida, e o `consentimento{host,modo}` precisa casar com o destino (host do endpoint, ou `openrouter.ai` no modo
`jev_openrouter`) e é obrigatório para `habilitado:true`; rótulos, slugs, buscas e nomes recusam URL e caminho;
`provedores:openrouter_testar` aceita `conta_id` OU `chave` (testar sem salvar), nunca os dois; `cofre:gravar` exige nome
UPPER_SNAKE e escopo coerente com `workspace_id`; `historico` exige `desde < ate`, `max_pontos ≤ 300` e `balde` só com
janela `modelo`. Nenhum canal recebe caminho, `cwd` nem URL arbitrária (exceto o `endpoint` https do decisor) e nenhum
devolve valor de chave.

**Canais `sensivel`** (`CANAIS_SENSIVEIS`): `provedores:openrouter_chave_gravar`, `provedores:openrouter_testar`,
`harness:decisor_testar`, `cofre:gravar`, `cofre:senha_mestra_definir`, `cofre:desbloquear`. O registro de IPC
(`criarRegistroIpc({ log, logarPayload })`) nunca imprime o payload destes canais (nem o motivo detalhado da recusa,
que poderia citar o nome de um campo enviado pelo renderer); nos demais, o payload só é logado com `logarPayload: true`.

### 8.5 Eventos de domínio e tools MCP

Barramento: `limits.updated`, `limit.high`, `limit.reached`, `account.switched`, `switch.suggested`, `decision.made`,
`policy.changed`, `vault.changed`, `openrouter.models_updated`, `usage.observed`. Tools MCP novas/alteradas (`harness_list`,
`harness_recommend`, `harness_set`, `decisions_list`, `headline_limits`, `headline_pick`, `account_switch`, `model_list`,
`pane_spawn` com `provider` opcional) e subcodes (`no_capacity`, `executor_disabled`, `unknown_task_type`, `invalid_effort`,
`not_at_limit`, `provider_mismatch`, `no_account_available`, `no_compatible_cli`, `model_not_enabled`,
`openrouter_not_consented`): conforme a Fase 9 (T-09.15..T-09.20, T-09.28); a matriz por modo mora em
`src/nucleo/mcp/catalogo.ts`. Nenhuma tool devolve segredo, caminho absoluto de dado das CLIs nem valor de cofre.
