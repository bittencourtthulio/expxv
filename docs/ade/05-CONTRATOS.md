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
`encerramento` (com `solicitado: true` quando o app pediu), `fechada` (D-520: o app fechou a sessão; o painel sai da grade), `atividade`, `conversa`). `sequencia` monotônica por sessão; evento com
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
| `pane_list` | `{mission_id?}` | `[{pane_id, provider, role, state, task_id}]` (sem conteúdo de tela); + workers fechados nos últimos ~10 min: `{…, state: done\|closed\|failed, closed_by, closed_at, exit_code?, last_output?}` (§20, D-520) |
| `pane_read` | `{pane_id, last_n?=200, max_n=2000}` | `{lines[], state}`; de worker fechado há pouco: a cauda guardada + `{state: done\|closed\|failed, closed_by, exit_code?}` (§20) |
| `pane_send` | `{pane_id, text, submit?=true}` | `{accepted}` |
| `pane_close` | `{pane_id}` | `{ok}` (só o orquestrador dono do worker; o painel some da grade na hora, §20) |
| `handoff_submit` | `{task_id, summary≤400, report_path, artifacts?, status}` | `{handoff_id}` |
| `handoff_read` | `{pane_id}` | `{pane_id, task_ref, status, summary, report_path, report (≤ 32 KB, redigido), truncated}` — o que o worker entregou (piloto/orquestrador; `not_found` sem handoff) |
| `mission_list` | `{status?}` | `[Mission]` |
| `mission_complete` | `{}` | `{ok}` (exige revisor ok) |
| `catalog_list` | `{kind, query?}` | itens permitidos (pós-MVP: real) |

Matriz por modo: `livre` → provider_*, model_list, pane_*, handoff_submit, handoff_read; `squad` → + mission_complete,
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

### 8.6 Roteador e resolução de perfil (tipos internos do núcleo; contrato entre Fases 9, 14 e 16)

Em `src/nucleo/harness/{roteador,perfil}.ts` (puros; dados entram por `DepsRoteador`: política global e do workspace, usos, contas, equivalência
efetiva, `ConfigHarness`, `agora` em epoch ms, provedores viáveis; o relógio e o banco NUNCA são lidos lá dentro). `rotear(pedido, deps) → Rota` é o ÚNICO
ponto de decisão de rota; ele chama `pickModel`, que chama `pickAccount` (nenhuma regra de conta/modelo é repetida).

```ts
interface PedidoRoteador {            // entrada de `rotear` (o IPC/MCP traduzem `PedidoDeRota` para ele)
  taskType: string | null;            // null = classificar `descricao` (função injetada) ou `geral`
  workspace: string; papel?: Papel; descricao?: string | null;   // `descricao` nunca entra no recibo nem no banco
  origem?: "piloto" | "usuario" | "mcp" | "metodo"; mission_id?: string | null; pane_id?: string | null;
  modoRota?: "auto" | "nenhuma";      // "nenhuma": o explícito vence, sem política
  explicito?: { provider?; cli?; model?; effort?; account_id?; skills?; agent? };
  perfil?: { cli: string; modelo: string | null; esforco: string | null; faixa: Faixa };   // cli "auto" = a faixa escolhe provedor e conta
  faixa?: Faixa; cliPreferida?: string; contaPreferida?: string | null;
  excluirProvedores?: readonly string[]; excluirContas?: readonly string[];
  atual?: { provedor; conta_id; modelo; faixa };   // Pane em curso: a decisão vira TROCA (margem, saltos, intervalo, ponto seguro)
  saltos?: number; ultimaTrocaEm?: number | null; operacaoNaoRetomavel?: boolean; confirmouRisco?: boolean; acaoDoUsuario?: boolean;
}
interface Rota {                      // saída de `rotear`; nunca lança
  ok: boolean; erro: ErroRoteamento | null; task_type: string; executor: Executor | null; cli: string | null; conta_id: string | null; faixa: Faixa | null;
  modo: ModoTroca; requer_aprovacao: boolean;   // so_sugerir: há sugestão que só vale com o aceite do usuário
  aplicada: boolean; mudou: boolean; confianca: "alta" | "media" | "baixa";
  motivo: string; recibo: string;               // uma frase (≤ 480 chars), sem segredo; dado desconhecido vira "sem dado de limite" (nunca 0%)
  avisos: string[]; decisoes: string[]; fontes: { task_type; executor; conta: FonteDecisao };
  skills: string[]; skills_aplicadas: false;    // enforcement real só com a Fase 7 (`aplicarSkills`)
  tentativas: Array<{ provedor; modelo: string | null; resultado: string }>; sugestao: SugestaoRota | null;
}
interface ResolucaoPerfilHarness extends ResolucaoPerfil {   // saída de `ResolvedorHarness.resolverPerfil(perfil, ctx)` (a `PortaResolverPerfil` da Fase 14)
  conta: string | null; modelo: string | null; cli: string; motivo: string; ambiente?: Record<string, string>;   // ambiente da CONTA (config dir); nunca segredo
  requer_aprovacao: boolean; aplicada: boolean; faixa: Faixa | null; esforco: string | null; avisos: string[]; confianca: Rota["confianca"]; task_type: string;
}
```

`resolverPerfilDeEtapa(skill, etapa, ctx)` (Maestro, Fase 16) devolve `Rota & { skill, etapa, avaliador }`: `(skill, etapa)` → `{task_type, avaliador}` pelo mapa `ETAPAS_PADRAO`
(editável); para `avaliador` exclui o provedor do implementador quando há ≥ 2 viáveis (D-21). `RotaIndisponivelErro`/`CliDesconhecidaErro` são os erros
nominais de `resolverPerfil`. O canal `harness:resolver_perfil` devolve `ResultadoDeRota` (`paraResultadoDeRota(rota)`); sem rota o manipulador lança
`ErroHarness` (`<codigo>: <recibo>`). Só leitura: nenhum desses caminhos cria Pane.

**Tools MCP da Fase 9 (T-09.17)** — matriz por modo em `catalogo.ts` (workers continuam só `handoff_submit`): **livre** nenhuma; **squad** `harness_list`, `headline_limits`;
**agêntico** `harness_list`, `harness_recommend`, `decisions_list`, `headline_limits`, `headline_pick` e, **só com `harness_workspace.piloto_edita_politica`** (decidido na emissão
do token do piloto e reconferido a cada chamada), `harness_set`. Toda resposta ≤ 4 KB (lista cortada e marcada `truncated: true`); dado desconhecido é `null`, nunca 0.
`headline_pick` delega a `pickAccount` (`expires_first` por padrão; `max_slack` só aqui) e responde `{account_id, slack_pct|null, reason, strategy}`; sem conta
disponível: `unavailable/no_account_available`. `harness_set` grava um override do **workspace** (`atualizado_por: "mcp"`), nunca a política global; erros nominais
`rule_violation` com `executor_disabled`, `invalid_effort`, `unknown_task_type`, `no_compatible_cli`, `model_not_enabled`, `forbidden_role`.

## 9. Squads e agentes (Fase 14)

Fonte: `docs/ade/fase-14-squads.md` + overrides de `DECISOES-DAS-PENDENCIAS.md` (P-02, P-24, P-230..P-233). Tipos e conjuntos fechados em
`src/compartilhado/squads.ts`; canais em `src/compartilhado/ipc.ts`; validadores estritos em `src/main/ipc/squads.ts` (chave do mapa = nome do
canal; `squads:*` e `agentes:*` no mesmo arquivo). Manipuladores chegam nas ondas seguintes (lista `CANAIS_SQUADS_SEM_MANIPULADOR_AINDA` em
`src/main/ipc/squads.test.ts`, com a task de cada um).

### 9.1 Modelo (arquivos são a fonte da verdade, D-201)

`Squad` (`slug`, `nome`, `descricao`, `escopo`, `rigidez_padrao`, `max_instancias_paralelas` 1..8 [padrão **6**, P-233], `orcamento`, `portoes`, `fabrica`,
`origem` `fabrica|usuario|importada`, `membros` 3..12) e `Membro` (`slug`, `papel` `orchestrator|scout|executor|reviewer` com rótulo livre, `prompt` =
**caminho relativo** `membros/<slug>.md`, `perfil {cli|"auto", modelo|null, esforco|null, faixa}`, `skills_permitidas` deny-by-default, `mcps_permitidos`,
`hooks` reservado, `max_instancias` 1..8 [orquestrador sempre 1], `orcamento`, `rigidez` 1..5|null, `permissao` `seguro|equilibrado|automatico`|null = herda,
P-02/D-232). `OrcamentoSquad = {tempo_min, tokens, modo: "soft"|"rigido"}` (P-233: soft avisa; rígido aborta). `agent_id = "<squad>.<membro>"` (≤ 80).
Papel externo → interno: `orchestrator→piloto`, `scout→explorador`, `executor→executor`, `reviewer→revisor` (`PAPEL_INTERNO`). Proveniência de cópia de
fábrica (`origem.json`): `ProvenienciaFabrica {fabrica_id, versao, arquivos: caminho relativo → sha256 do original}` (3 vias, D-206).
Prompt: ≤ 16 KiB; variáveis FECHADAS `{{objetivo}} {{contexto_rag}} {{arquivos}} {{squad}} {{membro}} {{rotulo}} {{missao}} {{card}} {{pasta}} {{rigor}}`
(as três primeiras são não confiáveis: bloco `DADO`, D-202). O texto do prompt só atravessa por `agentes:prompt_*`; `Squad` nunca o carrega.
`Achado {severidade, codigo, caminho, mensagem}` com 24 códigos fechados (`CODIGOS_ACHADO`). Esforço aceito: neutro (`baixo|medio|alto`) ou nativo
(`minimal|low|medium|high|xhigh|max`); `ModoEsforco = flag|config|indicativo|nenhum`.

### 9.2 Banco — migration `0006-squads` (versão 6)

`ALTER mission ADD squad_id`, `ALTER pane ADD agente_id` (NULL = sem squad/agente; `Mission`/`Pane` ganham o campo opcional), e as tabelas (SÓ execução e
auditoria): `mission_squad` (PK `mission_id`, CASCADE; `squad_hash` sha256 64 hex; `portoes_pendentes_json` array; `nivel_rigidez` 1..5|NULL; `plano_antes`
0/1), `invocacao_agente` (`inv_…`; `mission_id` nulo = modo livre; `pane_id` SET NULL; `perfil_json` efetivo; `prompt_hash`; `recibo` ≤ 240;
`encerrada_em ≥ criado_em`; índice parcial `(mission_id, agente_id) WHERE encerrada_em IS NULL`), `squad_execucao` (`sqx_…`; `objetivo` 1..4000 já redigido;
`mission_id` SET NULL com UNIQUE parcial: 1 execução por Missão; índices `(criado_em DESC)` e `(workspace_id, id DESC)`). Nenhuma coluna guarda texto de prompt de
membro nem segredo. Repositórios (`criarRepositorios`): `missionSquad` (`gravar` também grava `mission.squad_id`; `emUso`/`slugsEmUso` = Missão ativa),
`invocacaoAgente` (`abrir`, `fechar`, `fecharPorPane`, `contarVivas`, `vivasPorAgente`), `squadExecucao` (`criar`, `vincularMissao`, `listarPorWorkspace` com
`missao_estado`). `NovaMissao.squad_id` e `NovoPane.agente_id` opcionais (sem eles: comportamento do MVP).

### 9.3 Canais IPC (lista fechada; validador estrito por canal; 25 invoke + 1 evento; onda 6 acrescentou 4, aditivos)

| Família | Invoke | Evento |
|---|---|---|
| `squads:` (18) | `listar`, `obter`, `gravar`, `validar`, `duplicar`, `apagar`, `fabrica_atualizacao`, `fabrica_aplicar`, `fabrica_diff`, `lixeira_listar`, `lixeira_restaurar`, `execucao_arquivo`, `preflight`, `enviar_prompt`, `execucoes_listar`, `exportar`, `importar_previa`, `importar_confirmar` | `squads:evento` `{slug, tipo: gravada\|apagada\|externa}` |
| `agentes:` (7) | `listar`, `prompt_ler`, `prompt_gravar`, `prompt_previa`, `prompt_restaurar`, `perfil_opcoes`, `abrir_pane` | — |

Chaves novas de `window.ade`: `squads`, `agentes`. Regras dos validadores: objeto estrito (campo extra/ausente é erro); slugs `^[a-z0-9][a-z0-9-]{0,39}$`; `agent_id`
`<squad>.<membro>`; `membro.prompt` precisa ser exatamente `membros/<slug>.md`; nome, rótulo, skills, MCPs, hooks, modelo e CLI recusam caminho e URL; `faixa`, `escopo`,
`papel`, `origem`, `permissao` e esforço só de conjuntos fechados; `max_instancias` 1..8 (orquestrador 1); rigidez 1..5; `objetivo` ≤ 4 000 e não vazio; prompt ≤ 16 KiB
(bytes), sem NUL/controle e só variáveis fechadas; `squads:gravar` exige EXATAMENTE 1 orquestrador (a composição restante — revisor, 3..12, CLI com intake — é achado de
`validarSquad`, e `squads:validar` aceita rascunho sem orquestrador para devolvê-lo como achado); `squads:apagar` exige `confirmar_slug === slug`; `exportar`/`importar_previa`
com `repo` exigem `workspace_id` (e `nome`), com `arquivo` usam só o seletor nativo do main. Nenhum canal recebe caminho absoluto, `cwd`, `userData` nem URL.
Eventos de domínio (barramento): `squad.saved|deleted|exported|imported`, `squad.prompt_sent`, `agent.invoked|closed`, `agent.budget_exceeded`, `squad.factory_update_available`.
Onda 6 (aditivo): `squads:fabrica_diff {slug, membro|@squad}` → `{membro, estado, atual, fabrica}` (texto do prompt + configuração dos dois lados; o caminho do prompt não entra);
`squads:fabrica_aplicar` aceita `sobrescrever_editados?: string[]` (subconjunto de `membros`; sem isto `editado` nunca é tocado e `removido` jamais); `squads:lixeira_listar {}` →
`[{nome, slug, apagada_em}]` e `squads:lixeira_restaurar {nome}` → `Squad` (nome de pasta `^[a-z0-9][a-z0-9-]{0,99}$`; slug existente é recusado, nunca sobrescreve);
`squads:execucao_arquivo {execucao_id, arquivo: plano|resultado}` → `{existe, texto, truncado}` (somente leitura, dentro da pasta do produto da árvore da Missão, ≤ 256 KiB, sem
controle/ANSI, segredos redigidos, link simbólico para fora recusado; a UI mostra como texto, nunca HTML). `PedidoCriarMissao` ganha `squad_id?` (modos squad/agêntico; recusado no
livre) e `squad_cli?` (cadeado do wizard: CLI imposta a todos os membros SÓ nessa Missão; exige `squad_id`): o main as roteia pelo fluxo de squads (`execucao.criarMissaoComSquad`), o
serviço de Missões as recusa se chegarem a ele. Tools MCP `agent_list`/`agent_invoke` e a matriz por modo: conforme a Fase 14 (T-14.13); `.expxv/squads/` e `.expxv/pipelines/` só por exportação explícita (P-232, D-207).

## 10. Versionamento (Fase 6E) — canais `vcs:*` (aditivo; tipos em `src/compartilhado/vcs.ts`, `vcs-tipos.ts`, `src/nucleo/vcs/tipos.ts`)

**14 invoke + 1 evento**, validador estrito por canal e por `op` (campo extra/ausente é erro; `null` explícito). O renderer envia só `workspace_id` + `mission_id` (`null` = árvore do workspace; senão o worktree irmão/cópia de trabalho da Missão, resolvido NO MAIN) e caminhos RELATIVOS não confiáveis (AUD-23: sem NUL, sem `/` ou `X:` inicial, sem `..`); nunca caminho absoluto, `cwd`, executável nem `origem` (o IPC é sempre `usuario`).

| Canal | Conteúdo |
|---|---|
| `vcs:estado` | `EstadoVcs` (tipo, `local` relativo, capabilities, status com arquivos, resumo, operação em curso, ramo padrão/protegido, `svn_binario`, `mensagem`) |
| `vcs:observar` | liga/desliga o observador por árvore (contado por referência); devolve `ResumoVcs` e passa a emitir `vcs:mudou` |
| `vcs:diff` | `Diff` (staged, base, palavra, contexto, não rastreado, teto de bytes) |
| `vcs:estagio` | `estagiar`, `desestagiar`, `hunk` (linhas opcionais), `ignorar`, `descartar` (simular livre; executar exige `confirmar`), `desfazer_descarte`, `descartes_listar` |
| `vcs:commit` | `criar` (amend, pular hooks só `true` explícito, coautores), `modelo`, `ultimo_publicado` |
| `vcs:ramos` | listar/criar/trocar/renomear/apagar (forçar exige `confirmacao` = nome digitado)/upstream/padrão/tags/worktrees |
| `vcs:stash` | listar/criar/aplicar/pop/apagar/restaurar_apagado/diff |
| `vcs:historico` | `log` (cursor), `arquivo`, `detalhe`, `blame`, `reflog`, `desfazer_ultima` (com simulação) |
| `vcs:remoto` | listar/`fetch`/`pull`/`push`/`lease` (única via de push forçado: manual, `confirmacao` = nome do ramo, nunca na padrão)/preferência de pull |
| `vcs:operacao` | estado/mesclar/cherry_pick/reverter/rebase/rebase_interativo/continuar/abortar/pular |
| `vcs:conflitos` | listar/ler/resolver_hunks/resolver_arquivo/marcar_resolvido |
| `vcs:svn` | info/status_servidor/atualizar/commit/adicionar/remover/reverter/resolver/limpar/log/blame/conflitos/ramos/trocar/mesclar/`ramo_criar` (grava no servidor: `confirmado_servidor`)/auth |
| `vcs:forge` | estado/prs_listar/pr_ver/pr_criar/checks_do_pr/issues_listar (SEM merge de PR: humano) |
| `vcs:missao` | resumo (branch, worktree relativo, base, existe, resumo, PR opt-in)/commits (de `ENTREGA.md`, lido, nunca escrito)/diff_base/comparar |
| evento `vcs:mudou` | `{workspace_id, mission_id, resumo}` coalescido, só de árvores observadas; sem varredura periódica |

Nenhuma operação de rede roda sem ação do usuário (fetch/pull/push/lease/forge); nenhum fetch em segundo plano nesta fase. Toda escrita grava `evento_dominio` (`vcs.commit|descartar|ramo|stash|remoto|operacao|conflito|svn|forge`, com `ok`, assunto ≤ 120 caracteres, hashes, refs, caminhos relativos, contagens; nunca mensagem completa, segredo nem caminho absoluto). Erros chegam como `[codigo] mensagem` sem caminho absoluto nem credencial.

## 11. Memória local (Fase 8) — aditivo (tipos em `src/compartilhado/memoria.ts`; plano em `fase-08-memoria.md`; decisões D-46..D-54 e D-260..D-269)

**Banco (migration `0007-memoria`):** `memoria_entrada` (+ FTS5 criada em runtime por `garantirFts`, com fallback `LIKE`), `memoria_config` (por workspace), `memoria_missao_config` (chave por Missão, P-21), `memoria_vetor` (opcional) e o índice único `ux_pane_respawn_vivo` (no máximo 1 filho vivo por Pane). A memória **não grava no repositório do usuário**: só `<userData>` (banco) e o arquivo que o usuário escolhe ao exportar; `.expxv/` continua sendo a única pasta escrita no projeto.

**IPC (14 invoke + 4 eventos; validador estrito por canal em `src/main/ipc/memoria.ts`):** `memoria:estado` (devolve `EstadoMemoriaApp`: `config`, `missoes?: Record<mission_id, boolean>` com só as Missões que têm chave explícita, `contagens`, `tamanho_bytes`, `aviso_teto`, `fts5`, `memox`, `metricas?`), `memoria:config_gravar` (`{workspace_id, global_ativa?, ativa?, solo?, squad?, orcamento_brief_chars?, retencao_dias? (0 = sem limite, ou 7..3650), teto_mb?, pacote_workers?, embedding_modelo?}`), `memoria:missao_config` (`{mission_id, ativa: boolean|null}`), `memoria:listar`, `memoria:atualizar` (`{entrada_id, conteudo? (1..1000), importancia?}`; edição/fixação HUMANA de uma entrada, nunca por tool MCP; devolve a `EntradaMemoria`), `memoria:esquecer`, `memoria:esquecer_pane`, `memoria:purgar` (confirmação = nome do workspace), `memoria:exportar` (o main abre o diálogo de salvar; `{caminho_salvo|null}`), `memoria:brief_previa`, `memoria:restaurar` (`auto|retomar|brief`), `memoria:preferencias_listar|gravar|remover`. Eventos main → renderer (envelope `versao: 1`, coalescidos, sem `conteudo`): `memoria:entrada_criada`, `memoria:brief_montado`, `memoria:restauracao_pedida`, `memoria:aviso`. `window.ade.memoria` (`ApiMemoria`).

**MCP:** `memory_write`, `memory_search`, `memory_checkpoint`, `memory_brief`, `memory_forget` (campos no plano da Fase 8). Exposição pelo modo efetivo da memória no token: `off` = nenhuma; piloto e Pane livre/solo = as 5; workers = `memory_write` + `memory_search`; squad passa a ter memória própria (D-261). Erros: `memory_disabled`, `too_large`, `invalid_argument`, `unauthorized`, `not_found`; limite/taxa = `rule_violation` com subcode `limit_reached`. Respostas ≤ 4 KB. `mission_complete` devolve `{ok: true, aviso?: "no_learning_recorded"}`.

**Eventos de domínio (só metadados, nunca `conteudo`; auditoria em `evento_dominio` com retenção de 30 dias):** `memory.entry_created`, `memory.brief_built`, `pane.restore_requested`, `memory.forgotten`, `memory.purged`, `memory.compacted`; `mission.closed` (já existia) dispara o aprendizado de sistema e a destilação.

## 12. Loja de MCPs (Fase 7B, onda C) — aditivo (tipos em `src/compartilhado/loja-mcp.ts`; plano em `fase-07b-loja-mcps.md`; decisões D-130..D-139)

**Banco (migration `0008-loja-mcp`):** `catalogo_mcp_instalado`, `_consentimento` (auditoria: sobrevive à remoção do servidor), `_variavel` (só `definida`; o valor está no cofre), `_habilitacao` (deny-by-default; único por servidor+alvo), `_saude`, `_ferramenta`, `_cli_instalacao`, `_log` (200 por servidor, 30 dias, detalhe ≤ 1 KB) e `_kit` (opt-out). Repositório SQLite `criarRepoCatalogoMcp` implementa a porta `RepoLojaMcp` (mesmo contrato do `criarRepoMemoria`).

**IPC (23 invoke + 1 evento; validador estrito em `src/main/ipc/loja-mcp.ts`; serviço em `src/main/loja-mcp.ts`):** `loja_mcp:listar|detalhe|plano_instalacao|instalar|cancelar|desinstalar|plano_atualizacao|atualizar|variaveis_estado|variavel_gravar|variavel_apagar|testar|habilitar|habilitacoes|previa_cli_usuario|instalar_na_cli|remover_da_cli|logs|kit_estado|kit_plano|kit_instalar|kit_opt_out|diagnostico`. Diferenças em relação ao plano: o Kit tem um canal por ação (em vez de `loja_mcp:kit` com `acao`); `detalhe`, `plano_*`, `testar` e `*_cli*` recebem `workspace_id|null` (resolve `{{WORKSPACE}}` no main; o renderer nunca envia caminho); um único evento `loja_mcp:evento` (`progresso` ≤ 10/s | `estado` | `saude`) no lugar de três canais. `instalar`/`atualizar`/`kit_instalar` devolvem `{instalacao_id}` na hora e o andamento sai pelo evento. Só `loja_mcp:variavel_gravar` é sensível (o valor atravessa uma vez e nunca volta; o log do registro não imprime o payload). `window.ade.lojaMcp` (`ApiLojaMcp`). `loja_mcp:descobrir` (T-07B.32, P2) fica para depois.

**Injeção por Pane:** `servidoresDoPane` → `configuracaoDeMcpLoja` → `combinarConfiguracoesMcp` (Pane orquestrado: o MESMO `--mcp-config`/`OPENCODE_CONFIG_CONTENT` do MCP do app) ou, em Pane sem orquestração (livre, ou terminal avulso numa Missão), só a Loja (`--mcp-config`/`-c`/`OPENCODE_CONFIG_CONTENT` + `--settings` só com o gate no Claude). Ambiente do Pane ganha `<PREFIXO>_LOJA_URL` (`http://127.0.0.1:<porta>/loja/segredos`) e `<PREFIXO>_LOJA_TOKEN` (o token do Pane); segredo nunca em argv, arquivo ou ambiente do Pane. Sem servidor habilitado nada muda e o servidor MCP do app nem é pedido. O snapshot por Pane (ids permitidos + raiz) vive no main e alimenta o gate e a rota de segredos; some quando o Pane acaba (`pane.closed`).

**Rota `POST /loja/segredos`** (servidor MCP do app, loopback, Bearer = token do Pane; corpo `{servidor}`): identidade só do token; 401/403/400/404/429 (5 por minuto por Pane)/500 `command_unavailable`; resposta `{comando: {executavel, args, env, cwd}}` (comando EXATO do servidor com o ambiente por allowlist e os segredos do cofre), `Cache-Control: no-store`, nada logado. O lançador `resources/mcp/mcp-run.mjs` (`--servidor <id>`, exit 70 em falha) faz `spawn` desse comando com stdio herdado e não repassa o ambiente do Pane.

**Gate `pre-mcp`** (hook `PreToolUse`, matcher `mcp__ev_.*`, falha fechada no `gancho.mjs`): `mcp__ev_<id>__*` só passa se o `id` está no snapshot do Pane. Permitido = o hook devolve vazio (a aprovação normal da CLI continua valendo); negado = `permissionDecision: "deny"`. Eventos de domínio: `mcp_store.install_started|install_finished|install_failed|consent_recorded|enabled|disabled|health|removed` (do ciclo) e `mcp_store.injected {pane_id, cli, ids[]}` (do main); só nomes, nunca valor.

**Onda D (UI e pendências):** `loja_mcp:descobrir` `{consulta: texto 2..100}` → `{candidatos: CandidatoMcpDto[], descartados, aviso}` (24º canal invoke; só por clique; GET único ao Registro Oficial, timeout 8 s, resposta ≤ 1 MB; `curado:false`, `instalavel:false`, sem comando; `window.ade.lojaMcp.descobrir`). Tool MCP **`mcp_store_list`** `{query?≤100, category?, limit?=25 (1..100)}` → `{servers: [{id, name, category, transport, tools[≤20], enabled_for_you: true}]}` (≤ 4 KB, `truncated` quando corta): só leitura, só o snapshot do próprio Pane, nunca URL/args/variáveis/descrição; matriz `agentico` e `squad` (piloto), nunca `livre` nem workers; `PortaLoja.listar` (RPC `loja.listar` pela thread do MCP). A política exclui servidor cujo `comando_hash` consentido difere do catálogo atual (`reconsentimento_pendente`, D-141 e AUDITORIA-LOJA-MCP A-1); `hashDoComando` inclui `riscos` e `autenticacao`. Manifesto `resources/mcp/catalogo-mcps.json.sha256` (build:main).

## 13. Gestão ágil (Fase 18, onda 2) — aditivo (tipos em `src/compartilhado/agil.ts`; plano em `fase-18-gestao-agil.md`; auditoria em `AUDITORIA-AGIL.md`)

**Banco — migration `0011-agil` (versão 11).** Tabelas `agil_*` do plano com os ajustes do pedido da onda 1: `agil_config`, `agil_membro` (+ `agil_membro_alias`, único por membro), `agil_epico`, `agil_item`
(`orfao`, `resumo_cliente_origem = 'humano'`), `agil_estimativa`, `agil_classificacao`, `agil_sprint`, `agil_sprint_item`, `agil_capacidade` (`pontos` NULL = sem base), `agil_cerimonia`, `agil_retro_item`,
`agil_retro_acao` (`vencida_notificada`), `agil_fato_task` e `agil_versao_trabalho` (cache derivado), `agil_retrabalho_evento` (`UNIQUE (workspace_id, chave_dedupe)`), `agil_retrabalho_task`, `agil_erro_estimativa`,
`agil_metrica_snapshot`, `agil_checklist`, `agil_dod_resultado`, `agil_demo`, `agil_evento`, `agil_auditoria`, `agil_chamada_ia`. CASCADE por workspace nas tabelas-raiz. Repositórios: `nucleo/banco/repos/agil.ts`
(cada coleção do `BancoAgil` com cache write-through; `transacao` descarta o cache se lançar).

**IPC (lista fechada, 47 invoke + 1 evento; todo pedido leva `workspace_id` e o main confere o dono de cada id).** `agil:{estado, config_ler, config_gravar, consentimento_ia, sincronizar, membro_listar, membro_gravar,
backlog_listar, item_ler, item_criar, item_atualizar, item_descartar, item_reordenar, item_promover, item_vincular, epico_listar, epico_gravar, epico_apagar, estimar, estimativa_gravar, classificacao_gravar,
estimativa_aceitar_lote, sprint_listar, sprint_criar, sprint_atualizar, sprint_iniciar, sprint_cancelar, sprint_item_mover, sprint_fechar, capacidade_ler, capacidade_gravar, planejamento_sugerir, daily_gerar,
daily_salvar, review_ler, review_gravar, retro_ler, retro_item_gravar, retro_acao_gravar, retro_acao_para_item, retrabalho_listar, retrabalho_marcar, painel, previsao, praticas, checklist_gravar, exportar}`
e o evento `agil:evento` (coalescido ≤ 1/300 ms). Estes canais SÃO a ação humana: o main grava `ator: "humano"`; nenhum aceita `ator`, caminho ou `userData`. Erro de regra = `Error` com a mensagem
`[codigo/subcodigo] texto` (`invalid_argument`, `not_found`, `rule_violation` com `human_only`, `conflict`); o resto vira `[unavailable]` genérico.

**MCP (opt-in do token: `opcoes.agil`, decidido pelo main).** `backlog_list`, `backlog_get`, `estimate_get`, `sprint_status`, `rework_list`, `metrics_get` (leitura; todo papel que não seja worker, todo modo) e
`backlog_propose`, `estimate_propose` (só o piloto em `squad`/`agentico`). O agente PROPÕE: estimativa humana prevalece (`applied:false, reason:"humano_prevalece"`), decidir é `rule_violation/human_only`, item
concluído/de sprint encerrada não é reestimado, e há tetos (30 versões por item, 30 propostas/h, 300 abertas). Subcode novo em `mcp/erros.ts`: `human_only`. Porta: `PortaAgilMcp` (RPC `agil.chamar`).

**Eventos de domínio (barramento, nomes com ponto; consumidos pelas Fases 19 e 20).** `sprint.iniciada`, `sprint.fechada`, `sprint.em_risco`, `tarefa.atrasada`, `retrabalho.detectado`, `wip.excedido`,
`acao_retro.vencida`, `agil.estimativa_pronta`; payload `EventoAgil` (`workspace_id`, `sprint_id?`, `trabalho_id?`, `task_ref?`, `pontos`, `duracao_observada_ms`, `tokens`, `quando`, `dados`).

## 14. Custo e board (Fase 10, onda 1: núcleo, dados e IPC) — aditivo (tipos em `src/compartilhado/custo.ts`; plano em `fase-10-custo-board.md`; decisões D-104..D-117 do plano)

**Banco — migration `0012-custo` (versão 12; a 0011 é a da gestão ágil).** `preco_modelo` (padrão glob/exato, US$/Mtok, `origem` embutido|usuario|openrouter, `confirmado`, `valido_desde`, `fonte`, `coletado_em`),
`uso_fonte` (`base`+`relativo`, nunca caminho absoluto; `base` aceita também `nenhuma` = CLI sem leitor, `estado='sem_fonte'`), `uso_registro` (bruto, 90 dias; `UNIQUE (fonte_id, chave)`; `usd` NULL = desconhecido),
`janela_task`, `custo_agregado` (permanente; escopos card|missao|trabalho|workspace|conta|pane; chave de card `ws|trabalho|task`, de trabalho `ws|trabalho`), `custo_teto`, `custo_alerta` (deduplica alertas entre
reinícios). `task.reivindicada_em`/`entregue_em` são gravados por TRIGGER na transição de `estado` (o repositório de `task` não mudou). `config`: chave `custo` (`ConfigCusto`) e `board.<workspace_id>` (`ConfigBoard`, WIP).

**Núcleo (puro, sem rede/Electron).** `nucleo/custo/`: `precos` (casamento por padrão mais específico, depois origem usuário > OpenRouter > embutido, depois `valido_desde`), `calcular` (`registroParaUsd`: modelo sem preço ⇒ `usd:null`;
`0` só com tokens 0; valor medido da fonte vence; tarifa de cache derivada ⇒ `aproximado`), `atribuicao` (D-106: piloto ⇒ `orquestracao`; 1 janela ⇒ `card`; 0 ⇒ `sem_card`; ≥ 2 cards ⇒ `ambigua`; tolerância de 5 s só no fim),
`agregar` (resumo/Missão/estimativa/previsões/sprint), `orcamento`, `repos`, `servico` (`ingerir(fonteId, RegistroExtraido[])` idempotente; `ingerirProxy`; `reatribuirPane`; `reindexar`; `reprecificar({simular})`; teto/alertas;
`diagnostico`). `nucleo/board/`: `montarBoard` (puro; colunas D-107; selos; progresso; WIP; ordenação determinística), `movimentosDoCard` (regras de movimento DERIVADAS do método: `grava_no_metodo` é sempre `false`;
validação é humana), `montarDetalhe`, `resolverArquivoAbrivel`, `delegarCard` (por portas), `PortaBoardAgil` (colunas/WIP para a Fase 18).

**Canais IPC (lista fechada; 22 invoke + 2 eventos; validador estrito por canal em `src/main/ipc/custo.ts`; erros `<codigo[.subcodigo]>: <mensagem>`).** `custo:resumo`, `custo:relatorio`, `custo:estimativa`, `custo:previsao_missao`,
`custo:previsao_periodo`, `custo:sprint`, `custo:fontes`, `custo:precos_listar`, `custo:preco_gravar`, `custo:preco_apagar`, `custo:reprecificar` (`simular:true` só conta), `custo:config_ler`, `custo:config_gravar`,
`custo:teto_gravar`, `custo:reindexar`, `custo:diagnostico`; `board:snapshot`, `board:card_detalhe`, `board:abrir_arquivo`, `board:delegar_card`, `board:config_ler`, `board:config_gravar`; eventos `custo:evento`
(`atualizado`|`teto`|`aviso_teto`|`fonte_ausente`|`preco_ausente`, coalescido ≤ 1/300 ms) e `board:evento` (`{versao}`, coalescido). O renderer nunca envia caminho, custo nem tokens; `board:snapshot` exige `workspace_id`.

**Eventos de domínio (barramento).** `cost.updated{escopos}`, `cost.ceiling_reached`, `cost.ceiling_warning` (aviso em `aviso_teto_pct`, padrão 80), `cost.price_missing{modelo}`, `usage.source_missing{pane_id,cli}`, `board.changed{versao}`;
entrada: `usage.observed{pane_id, modelo, tokens_in, tokens_out, usd|null, ts, id?}` (proxy OpenRouter, medido). Cada alerta sai UMA vez (por teto/modelo/Pane) e nunca bloqueia nem aborta Pane (P-80).

**Decisões de implementação (refinam D-104..D-117; sem D-NN novo).** (1) Preços embutidos só com fonte e data, todos `confirmado:false` (custo sai com "≈"); Opus novo/modelo sem entrada ⇒ `usd:null` (P-39). (2) "Validado" por veredito usa só
`veredito_qa` (o veredito de auditoria do plano não valida tasks). (3) Progresso = % da coluna `concluido` e % da `validado` sobre o total NÃO descartado do escopo (workspace/trabalho/Missão); filtros de visão não mudam o progresso.
(4) WIP só informa (`excedido`) e bloqueia a SUGESTÃO de iniciar/delegar (`wip_exceeded`); o quadro nunca grava. (5) Sprint: custo = soma dos cards dos itens vinculados (`agil_sprint_item`→`agil_item.trabalho_id/task_ref`); item sem
vínculo/custo torna a soma incompleta, nunca 0. (6) `reindexar` reconstrói o agregado inteiro a partir dos brutos retidos (dias fora da retenção ficam); reler arquivos de transcript é papel do ingestor de arquivos (próxima onda).
(7) `board:delegar_card` está registrado e testado por portas, mas responde `unavailable.no_router` até a porta do roteador existir (o `spawn` da orquestração cria a task com ref próprio `t-N`; delegar um card `T-NN.MM` exige
um `task_ref` explícito no `PedidoSpawn`, arquivo da coordenação). (8) Sem leitor de transcript/rollout ainda (T-10.04..07): o custo hoje entra por `usage.observed` (proxy) e por `ServicoCusto.ingerir`.

## 15. Alertas e Telegram (Fase 20, onda 2) — aditivo (tipos em `src/compartilhado/alertas.ts`; plano em `fase-20-alertas-comunicacao.md`; estudo `AMEACAS-TELEGRAM.md`; auditoria `AUDITORIA-ALERTAS.md`; decisões D-150..D-159 e D-270..D-277)

- **Banco:** migration `0013-alertas` (14 tabelas do plano + deltas do `pedidos/20-pedidos.md` §1: `canal.tipo` inclui `toast`; `alerta_regra.chat_ref`; `alerta_entrega.nivel/chat_ref`; `telegram_aprovacao.acao` ampliada e coluna `extra`; `mensagem_entrada.texto_hash/edicoes`). A unicidade da entrega é um índice único sobre `COALESCE(regra_id,'')` (em SQLite `NULL` não colide em `UNIQUE`). Repositórios SQL em `src/nucleo/banco/repos/{alertas,telegram}.ts`, provados contra a versão em memória pela MESMA suíte (`alertas.contrato.test.ts`). `consumirAprovacao`/`consumirAprovacaoPorPlano` são `UPDATE … RETURNING` atômicos.
- **IPC** (lista fechada em `compartilhado/ipc.ts`, validadores estritos em `main/ipc/{alertas,telegram}.ts`): `alertas:{catalogo,listar,contar,marcar_lido,silenciar,regras_listar,regra_gravar,regra_apagar,regra_preset,silencio_ler,silencio_gravar,modelos_listar,modelo_gravar,modelo_restaurar,modelo_prever,config_ler,config_gravar,abrir_entidade}`, `canais:{listar,consentir,ligar_saida,desligar_saida,teste_envio}`, `telegram:{estado,token_testar*,token_salvar*,token_remover,webhook_limpar,comandos_configurar,parear_iniciar,parear_cancelar,parear_decidir,autorizado_config*,autorizado_revogar,nao_autorizado_listar,nao_autorizado_bloquear,entrada_ligar,retomar,panico,plano_decidir_desktop,auditoria_listar,auditoria_exportar}` (`*` = canal sensível: o log do registro nunca imprime o payload nem o motivo da recusa). Eventos: `alertas:novo|contagem|mudou`, `canais:estado`, `telegram:pareamento|evento|plano_pendente_desktop`. `window.ade.alertas` (e `.canais`, `.telegram`) no preload, com paridade conferida por `preload.test.ts`.
- **Campos que o renderer nunca define:** `efemera_ate`, `chat_ref` e `origem = pedido_remoto` de uma regra (a regra efêmera de pedido remoto é criada pelo main e só é apagável); destino de exportação da auditoria (diálogo do main, nunca em `docs/**`); PIN e token só entram, nunca voltam (só `token_mascarado` e `com_pin`).
- **Barramento:** novo `task.updated {task_id, task_ref, mission_id, workspace_id, estado, pane_id}` (emitido pela orquestração); consumidos `pane.state_changed`, `pane.closed`, `mission.closed`, `limit.reached`, `limit.high`, `account.switched`, `sprint.iniciada|fechada|em_risco`, `method.changed`; publicados `alert.created|read|muted|delivery_succeeded|delivery_failed` e `channel.state_changed`.
- **MCP:** `alert_raise {kind: info|attention|blocked|done, title ≤ 80, detail? ≤ 280, task_id?}` -> `{alert_id, queued}`. Opt-in do token (`opcoes.alertas`: `piloto` ou `todos`), identidade só do token, ≤ 3/h/Pane (`rule_violation/limit_reached`), texto redigido, gera só `agente_mensagem` (fora de canal externo por curinga). RPC `alertas.levantar`.
- **Rede:** `PedidoRede.sinal` (aditivo) e `src/main/alertas-rede.ts` (D-273).
- **Config (banco kv, sem segredo):** `alertas.config` (`ligado`, `retencao_dias`, `atraso`, `pane_aguardando_min`, `digest`, `ocultar_titulos_externos`), `alertas.silencio_global`, `telegram.config` (`rigidez_max_remota`, `max_pedidos_10min`, `max_planos_pendentes`, `msg_por_min`, `plano_ttl_min`, `pareamento_ttl_min`, `autorizacao_inatividade_dias`, `idade_max_pedido_s`, `rajada_msg`).
- **Segredos:** `TELEGRAM_BOT_TOKEN_<CANAL>` no cofre (`sensivel`, escopo global); PIN só como hash `scrypt` em `telegram_autorizado.pin_hash`.


## 16. Documentação e relatórios de entrega (Fase 19) — aditivo (tipos em `src/compartilhado/relatorios.ts`; plano em `fase-19-documentacao-relatorios.md`; auditoria em `AUDITORIA-RELATORIOS.md`; decisões D-312 e D-314)

**Banco — migration `0014-relatorios` (versão 14).** `relatorio_config` (por workspace), `relatorio_pacote` (metadados, `hash_fatos`, `hash_geracao`, `modo_redacao`, `estado` `gerando|pronto|falhou|obsoleto`, `revisao_usuario` `rascunho|aprovado`), `relatorio_arquivo`, `relatorio_ajuste` (decisão humana por bloco), `relatorio_exportacao` (`destino` = pasta que a PESSOA escolheu no diálogo) e `relatorio_divulgacao` (fila de envio). O conteúdo NÃO mora no banco: fica em arquivos sob `<raiz>/<pasta do produto>/relatorios/` (caminho relativo em `pasta_ref`); nunca em `docs/**` (D-04).

**IPC (19 invoke + 1 evento; lista fechada; todo pedido leva `workspace_id` e o main confere que o workspace existe):** `relatorios:config_ler|config_gravar|consentimento_llm`, `relatorios:sprints`, `relatorios:listar|ler|gerar|regenerar|previa|ajuste_gravar|aprovar|exportar`, `relatorios:divulgacao_estado|divulgacao_consentimento|divulgacao_fila|divulgacao_enfileirar|divulgacao_aprovar|divulgacao_enviar|divulgacao_cancelar` e o evento `relatorios:evento` (`EventoRelatoriosIpc`: `gerando|pronto|falhou|aprovado|divulgacao_mudou`, coalescido). `window.ade.relatorios` (`ApiRelatorios`); erros chegam como `[codigo] texto`. Aprovar, consentir, exportar e enviar só entram por estes canais (ação humana); nenhum canal aceita nem devolve caminho absoluto.

**Eventos de domínio (barramento; só metadados):** `relatorio.gerando`, `relatorio.pronto {workspace_id, sprint_id, pacote_id, versao, pontos_entregues, itens, avisos_qtd}`, `relatorio.falhou`, `relatorio.aprovado`; consumido: `sprint.fechada` (gera o pacote local em modo template, sem IA e sem rede) e, na Fase 20, `relatorio.pronto` vira o alerta `relatorio_pronto`.

**Portas do main (`src/main/relatorios.ts`):** `agil` (sprint fechada + itens), `versionamento` (PR do `ENTREGA.md`, zero rede), `custo` (`criarPortaCustoMain` sobre `LigacaoCusto.custoDeCards`: `null` se nada medido; `estado` `exato|minimo|desconhecido`), `canais` (`criarPortaCanaisMain` sobre `LigacaoAlertas.canalSaidaPronta/canalEnviarTexto`), `perfil`/`headless` (CLI do usuário sem ferramentas, só com consentimento do workspace) e `mapa` (indisponível até a Fase 17 ter serviço no main).

## 17. Maestro (Fase 16) — aditivo (tipos em `src/compartilhado/maestro.ts`; plano em `fase-16-maestro.md`; auditoria em `AUDITORIA-MAESTRO.md`; decisões D-300..D-307)

**Banco — migration `0010-maestro` (versão 10).** `maestro_pipeline` (`plano_json`, `mission_id` com `ON DELETE SET NULL`), `maestro_etapa_exec`, `maestro_etapa_config` (único por `COALESCE(workspace_id,'')` + `etapa_id`), `maestro_rigidez` (por workspace/Missão), `maestro_rigidez_log` (365 dias) e `maestro_recibo` (90 dias). O texto do pedido NÃO vai ao banco: `<pasta do produto>/maestro/<id>/pedido.md` (já redigido).

**IPC (25 invoke + 2 eventos; validador estrito por canal em `src/main/ipc/maestro.ts`):** `maestro:{pedir, confirmar, cancelar, pipeline_acao, pipeline_detalhe, pipelines_listar, recibos_listar, config_ler, config_gravar}`; `pipelines:{catalogo, config_listar, config_gravar, config_restaurar, validar, perfis_prontos, aplicar_pronto, exportar, importar_previa, importar_confirmar}`; `rigidez:{ler, definir, matriz, previa_plano, hooks_estado, hooks_reverter}`; eventos `maestro:evento` (sem o texto do pedido) e `rigidez:evento`. Erros nominais `<codigo>: <mensagem>` (`abaixo_do_minimo`, `confirmacao_necessaria`, `loop_guard`, `plano_inexistente`, `perfil_invalido`, `taxa_excedida`, `ignorado`).

**MCP:** `maestro_request {text ≤ 4000, context?: {files ≤ 20 relativos, excerpt ≤ 2000}, level?: 1..5}` e `maestro_status` — piloto e **painel livre elegível** (hoje o do Claude; token com SÓ estas duas tools, D-307); ausentes de workers e de Panes de etapa (`rule_violation/loop_guard`). Hook `UserPromptSubmit` só em painel livre do Claude, nunca no piloto, em worker nem em Pane de etapa.

**Eventos de domínio:** `maestro.notification {pipeline_id, motivo, etapa_id}` (consumido pelos alertas) e os de ciclo do pipeline; consumidos: `method.changed`/`metodo:mudou`, `pane.state_changed` (debounce 300 ms) e `account.switched`. **Panes de etapa:** abertos com `contexto.maestro_etapa = true` (+ `pipeline_id`, `etapa_id`) dentro da Missão do pipeline (D-306); no Claude levam `permissions.deny = DENY_GIT` (D-307).

## 18. Integração cruzada (D-308 a D-316) — aditivo

- **`metodo:disparar`:** nenhum campo novo no canal; gestos de texto livre ganham ` — Contexto prévio: <pasta do produto>/contexto/<id>-<gesto>.md` quando o RAG responde em ≤ 150 ms (D-308). `PortaConhecimentoPrevio.contextoPrevio(texto, arquivos, workspace_id)` (3º argumento obrigatório).
- **`board:delegar_card`:** novo erro `rule_violation/rag_consult_required` (só no modo `bloqueio` com a injeção desligada) (D-309).
- **MCP `pane_spawn`:** com `agent_id` e sem `provider` não há `receipt` nem `decisions` (resposta `{pane_id}`), salvo `route:"auto"` explícito (D-310).
- **`LigacaoCusto.custoDeCards(workspaceId, cards[{trabalho_id, task_ref}])`** → `CustoSprint` (soma dos agregados `card`, `itens_sem_custo` e `incompleto` quando falta medição).
- **`LigacaoAlertas.canalSaidaPronta(canal_id): boolean`** e **`canalEnviarTexto(canal_id, titulo, texto): Promise<{ok, erro|null}>`** (sem lançar; recusa sem I/O quando a saída está desligada ou o consentimento do canal não é vigente; texto e título passam pelo `scrub`).
- **`limites:historico|previsao|eficiencia|alertas`:** passam a ter manipulador (`src/main/limites-historico.ts`) sobre `limite_amostra`/`limite_semana` da `0005-harness`; sem migration nova. Config opcional `limites.meta_semanal_pct` (1..100, padrão 90) lida pelo main (a UI ainda usa 90 por constante, `META_PADRAO_PCT`). Semântica em D-315.
- **Alertas:** `relatorio_pronto` deixa de ser `fonte_indisponivel` (D-314); `pr_aberto`, `pr_mesclado` e `checks_falhando` seguem sem fonte.

## 19. Mapa lógico do código (Fase 17, onda 3) — aditivo (tipos em `src/compartilhado/mapa.ts`; plano em `fase-17-mapa-codigo.md`; auditoria em `AUDITORIA-MAPA.md`; decisões D-160..D-174 e D-330..D-338)

**Armazém (§1b da Fase 17).** `<userData>/mapas/<workspace_id>/mapa.db` (SQLite WAL, `PRAGMA user_version` = `SCHEMA_VERSION` = 1; DDL em `src/nucleo/mapa/esquema.ts`). Cache reconstruível: banco de versão maior ou corrompido é **renomeado** (`mapa.db.corrompido-<carimbo>`) e recriado, nunca apagado em silêncio. **Não usa a migration do banco principal** (nenhuma migration nova). Guarda nomes, assinaturas sanitizadas, `arquivo:linha` e a 1ª linha de comentário redigida (≤ 160); nunca o código-fonte. `meta`: `versao_mapa`, `estado` (`vazio|parcial|pronto`), `analisado_em`, `historia`, `config` (JSON), `derivada_versao`, `manifestos`, `locks`, `pacote_carimbo`. `analise_cache` (válido só para a `versao_mapa` corrente): `analise:<tipo>` (formato de `DadosAnaliseMapa`), `grafo_modulo`, `saida:{inventario,perfil,resumo_md,importantes,entradas}`, `padroes`, `resolucao`, `tipos_teste`. `versao_mapa` sobe **no fim da fase derivada**.

**Arquivos gravados.** `<userData>/mapas/<ws>/{mapa.db, exportacoes/}` e, no repositório do usuário, SÓ `<pasta do produto>/mapa/<carimbo>/{RESUMO.md, inventario-stackx.json, perfil-provisorio.json, entradas.json, arquivos.jsonl, mudancas-desde-ultimo.json, raio-<trabalho>.json}` (carimbo `YYYYMMDDTHHMMSSZ`, gravação atômica, no máximo 3 pacotes, `.gitignore` interno `*`, recusa symlink, só caminhos relativos). `docs/**` **nunca**.

**IPC `mapa:*` (18 canais de invoke, lista fechada em `src/compartilhado/ipc.ts`, validador estrito por canal em `src/main/ipc/mapa.ts`; todo pedido leva `workspace_id`; o renderer NUNCA envia caminho absoluto, `cwd` nem destino).** `mapa:resumo {workspace_id}` → `ResumoMapaIpc` (não abre banco se nunca analisado) · `mapa:analisar {workspace_id, modo:"completo"|"incremental", historia?}` → `{execucao_id}` (volta na hora; no máximo 1 análise esperando) · `mapa:cancelar` → `{ok}` · `mapa:apagar {confirmacao:"APAGAR"}` → `{ok}` (apaga `mapa.db` e a pasta de pacotes; mantém a configuração) · `mapa:grafo {nivel:"modulo"|"arquivo"|"simbolo", filtro?, limite≤20 000}` → `GrafoMapaIpc` (nós `{id,r,t,g,w,l?,c?,k?,p?}`, arestas `[de,para,tipo,exata,peso]` por índice, `truncado`) · `mapa:vizinhos {no_id, direcao?, profundidade≤3, limite≤500}` · `mapa:no {no_id}` → `NoDetalheMapa | null` · `mapa:fluxo {entrada_id, profundidade≤10, min_confianca?}` (≤ 300 nós) · `mapa:analise {tipo: ciclos|camadas|hotspots|mortos|sem_teste|externas|duplicacao|dialetos|zonas|entradas|dados, parametros?{limite,pasta,tabela}}` → `ResultadoAnaliseMapa` · `mapa:raio {arquivos[≤50], simbolos?[≤50]}` → `RaioMapaIpc` (provisório; 8 sinais, `faixa`, `faixa_pior_caso`, `nota`) · `mapa:perfil` → `PerfilProvisorioMapa` (nota fixa "não é o PERFIL.md") · `mapa:buscar {texto, tipos?, limite≤50}` · `mapa:exportar {formato: mermaid|dot|svg|json|csv|md, vista, destino?:"padrao"|"escolher"}` → `{caminho, formato, bytes}` (recusa `<raiz>/docs/**`) · `mapa:disparar {acao: stackx_detectar|stackx_atualizar|legadox_perfil|legadox_raio|legadox_divida, pane_id, trabalho_id?, arquivos?[≤50]}` → `{comando, carimbo, pacote}` (Pane do workspace, `pronto`, CLI Claude Code/OpenCode; grava o pacote ANTES só se o comando seria aceito; nunca ação humana, D-21) · `mapa:config_ler`/`mapa:config_gravar` (chaves de `ConfigMapa`; `expor_agentes` e `auto_atualizar` começam **desligados**) · `mapa:layout_ler`/`mapa:layout_gravar {chave, nivel, posicoes[≤40 000]}` (cache dos 20 mais recentes). **Evento único** `mapa:evento` `{tipo: progresso|mudou|terminou|falhou, workspace_id, progresso?, versao_mapa?, nos_alterados_n?, erro?}` (progresso coalescido a 250 ms; D-332). Erro: `Error("[codigo] texto")` com `codigo` ∈ `argumento_invalido|nao_encontrado|mapa_nao_pronto|erro_interno`.

**Eventos de domínio (barramento).** `map.analysis_progress`, `map.updated {workspace_id, versao_mapa, nos_alterados_n}`, `map.analysis_finished`, `map.analysis_failed`; o main também publica `vcs:mudou` no barramento (o mapa só marca "desatualizado").

**Tools MCP (somente leitura; só com `mapa.habilitado` e opt-in `mapa.expor_agentes`; token com `mapa:true`; respostas ≤ 4 KB com `truncated`).** `map_status`, `map_query {kind: search|neighbors|callers|callees|dependents|cycles|entrypoints|tables|hotspots|layers|unused|externals, target?, depth?≤5, limit?≤100, min_confidence?}`, `map_impact {files[≤50], symbols?[≤50]}` (faixas `LOW|MEDIUM|HIGH`), `map_evidence {topic: tests|layers|errors|config|dialects|entrypoints|data_access|commands, scope?, limit?}`. Erros: `unavailable/map_not_ready` (sem análise, desligado ou sem opt-in), `invalid_argument` (caminho absoluto, `..`, NUL, arquivo de ambiente/chave), `too_large`. Porta: `PortaMapaMcp` (`src/nucleo/mcp/portas.ts`), adaptador em `src/main/mapa-mcp.ts`; RPC `mapa.{disponivel,status,query,impact,evidence}`.

**Portas das outras fases (revisa D-312).** `PortaMapa.raio` da gestão ágil `{faixa: baixo|medio|alto, sem_cobertura, zona_risco}` e `PortaMapa.alteracoes` dos relatórios `{modulos[{nome,arquivos}], ciclos, pontos_quentes[]}`: reais, lazy, `null` sem mapa (nunca zero). Fase 15: a fonte `mapa` do RAG lê só `MapaLeitura` (`resumo`, `no`, `vizinhos`, `buscar`), que o `Armazem` satisfaz.

**Configuração (`ConfigMapa`, no `meta.config` do `mapa.db`).** `habilitado` (true), `auto_atualizar` (false), `arquivo_max_bytes` (1 000 000; 1 000..5 000 000), `total_max` (150 000; 100..1 000 000), `workers` (0 = automático; 0..3), `historia_janela_dias` (730), `historia_max_commits` (20 000), `duplicacao` (false), `ignorar` (globs relativos, sem `..` nem caminho absoluto), `expor_agentes` (false).

## 20. Painel livre que orquestra (D-420 a D-428; orquestrador de verdade e layout D-510 a D-517) — aditivo (tipos em `src/compartilhado/painel-livre.ts` e `src/compartilhado/orquestrador.ts`; núcleo em `src/nucleo/orquestracao/avulso.ts`, `canal-orquestrador.ts` e `ponte-grok.ts`; main em `src/main/painel-livre.ts` e `src/main/orquestracao.ts`; auditoria em `AUDITORIA-PANE-LIVRE.md`)

**Canais (`painel_livre:*`, validadores estritos em `src/main/ipc/painel-livre.ts`; o renderer manda só ids do app e booleanos: nunca `cwd`, executável, token nem texto livre).**
- `painel_livre:preferencia {workspace_id, ativa?, orquestrador_edita?, fechar_workers?}` → `{workspace_id, ativa, orquestrador_edita, fechar_workers}` (`fechar_workers`: D-520, booleano estrito, padrão `true`, ver "Ciclo de vida do painel do worker" abaixo): sem os opcionais lê; com `ativa` grava a preferência do workspace (padrão `false`); com `orquestrador_edita` grava o opt-out "orquestrador pode editar" (D-512; padrão `false`; vale para o PRÓXIMO orquestrador aberto). Booleanos estritos.
- `painel_livre:ponte_grok {workspace_id, acao: 'estado'|'aplicar'|'remover'}` → `{estado: 'ausente'|'ativa'|'bloqueada', arquivo, conteudo, detalhe}` (D-514): `arquivo` é SEMPRE o caminho relativo `.grok/config.toml`; `conteudo` é o texto exato que será gravado (sem segredo: só `${VARIÁVEL}`); `aplicar` cria o arquivo com `wx` (nunca sobrescreve: `bloqueada` quando já existe outro `.grok/config.toml`, link simbólico ou pasta fora do projeto) e só é chamado depois do diálogo de autorização; `remover` apaga só o arquivo com a marca do app. O renderer não manda caminho nem conteúdo (campo extra é recusado). Erro nominal novo em `painel_livre:abrir`/`orquestrar`: `ponte_necessaria` (Grok sem a ponte).
- `painel_livre:abrir {workspace_id, ferramenta_id, orquestrar}` → `{sessao_id, pane_id, missao_id|null, orquestrando, aviso|null}`: `orquestrar:true` exige a preferência ligada (`preferencia_desligada`), CLI com MCP (`cli_sem_mcp`) e cria a Missão avulsa; `false` abre um Pane livre comum.
- `painel_livre:orquestrar {workspace_id, sessao_id, ligar}` → `{sessao_id, pane_id|null, missao_id|null, orquestrando, retomado, aviso|null}`: reabre a CLI no lugar do painel (sessão NOVA; a antiga é encerrada e descartada antes). `painel_de_missao` para Pane de Missão real; no estado pedido já, devolve a MESMA sessão.
Erros nominais (`ErroPainelLivre`: `codigo` + mensagem PT-BR); infraestrutura vira "Não foi possível alterar a orquestração deste painel." sem caminho de máquina.

**Orquestrador de verdade (D-510 a D-513, aditivo; nenhum canal além dos acima).** O comando de lançamento de um painel que orquestra ganha, POR SESSÃO e só com "Orquestrar" ligado: (1) o prompt de orquestrador (`prompts/orquestrador.md`, `orquestrador.en.md`, versionados, editáveis, `{{SERVIDOR}}`/`{{LIMITE_PAINEL}}`/`{{LIMITE_WORKSPACE}}`) no canal de sistema da CLI; (2) a proibição técnica dos subagentes internos; (3) a negação de edição de arquivos (opt-out por workspace). Tabela (função `canalDoOrquestrador`):

| CLI | instrução | subagentes internos | edição | observação |
|---|---|---|---|---|
| claude | `--append-system-prompt` (ou `-file` > 3 000 bytes) | `permissions.deny` `Agent`, `Task` (`--settings` do Pane) | deny `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | shell com aprovações normais; selo completo |
| codex | `-c developer_instructions=<JSON>` | `--disable multi_agent` | `-s read-only` (não no modo automático) | selo completo |
| opencode | `instructions: [arquivo efêmero]` em `OPENCODE_CONFIG_CONTENT` | `permission.task=deny`, `tools.task=false` | `permission.edit=deny` | selo completo |
| grok | `--rules` | `--no-subagents` | `--deny Edit` | só com a ponte (D-514); selo parcial |
| gemini, aider, qwen, kilo | nenhuma | nenhuma | nenhuma | `cli_sem_mcp`; selo "não orquestra" |

Garantias servidas à UI por `garantiasDaCli(cli, {orquestradorEdita, permissao, ponteGrok})` em `src/compartilhado/orquestrador.ts` (`selo: completo|parcial|nao_orquestra`; colunas `instrucao`, `subagentes_internos`, `edicao` em `garantido|parcial|nenhum`; `limites[]`; `alternativa`). Nenhum canal usa `--always-approve`/`--yolo`/bypass; nenhum grava configuração global do usuário nem o repositório (instruções efêmeras só na pasta do app, `panes/<pane_id>/`; a única exceção é a ponte do Grok, com autorização explícita).

**Layout (D-515/D-516, aditivo).** `NoLayout` divisão ganha `proporcao?: number` (0,05 a 0,95; fatia do primeiro filho; ausente = 0,5); o validador de `terminais:gravar_layout` a aceita e recusa fora da faixa; `versao` segue 2. Regra do layout "orquestrador + workers" em `src/renderer/telas/terminais/layout-orquestrador.ts` (ver 04-UI-UX).

**Token e matriz.** `PedidoToken.avulso = true` (só o main decide): matriz = `TOOLS_AVULSO` (10 tools, ver D-421) para `role: piloto` + `mode: agentico`; qualquer outra combinação = nenhuma tool. `tools_allow` continua só restringindo. Claims não mudam (`aud` padrão `mcp`+`hooks`).

**`pane_spawn` (acréscimos, valem em qualquer Missão).** `prompt` (≤ 4000; vira o briefing do card quando não há `briefing_path`; os dois juntos = `invalid_argument`), `title` (≤ 60; título do card), `isolate` (booleano; worktree por worker em workspace git). Novos subcódigos: `rule_violation/orchestration_disabled` (preferência desligada ou Missão avulsa encerrada) e `rule_violation/cost_ceiling` (teto de custo estourado com bloqueio opt-in). `limit_reached` também para 16 por workspace e 12/minuto por painel.

**Missão avulsa.** `mission` com `modo=agentico`, `origem=livre`, título `Missão avulsa · <rótulo>`, estado `executando`, `piloto_pane_id` = painel, portões liberados, chave de config `orquestracao.avulsa.<mission_id>` = `{pane_id, permissao}`. Não ocupa a árvore (`criarServicoMissoes`). Encerra (aborta) quando o painel termina; os workers são Panes da MESMA Missão (papéis executor/explorador/revisor) e o `titulo` do card nomeia o painel.

**Eventos de sessão novos no renderer.** Nenhum canal novo: o store passa a ADOTAR sessões desconhecidas (`terminais:evento` de sessão fora do store → `terminais:listar_sessoes`) e contar `subagente_iniciado`/`subagente_concluido` por sessão (somente leitura).

**Permissão herdada.** Worker de painel avulso = `min(permissão do painel, permissão do workspace)` na ordem `seguro < equilibrado < automatico`.

**Ciclo de vida do painel do worker e cauda da saída (D-520 a D-527, aditivo; tipos em `src/compartilhado/terminais.ts`; regras puras em `src/nucleo/orquestracao/ciclo-worker.ts`; main em `src/main/orquestracao.ts`; sessões em `src/nucleo/terminais/sessoes.ts`; interface em `src/renderer/telas/terminais/ciclo-worker.ts` e `Grade.tsx`).**
- **Quem fechou e como terminou.** `FechadoPor = orquestrador | dono | auto | erro`; `EstadoFechado = concluido | fechado | falhou`. Contrato externo (inglês): `closed_by = orchestrator | owner | auto | error` e `state = done | closed | failed`. `classificarFechamento`: erro não pedido = `falhou`; handoff `falhou` = `falhou`; handoff `ok|parcial` ou saída limpa = `concluido`; o resto (fechado antes de entregar, `bloqueado`) = `fechado`.
- **Fechamento pedido pelo app some da grade NA HORA.** `ServicoPanes.encerrarPane(id, motivo, {fechar_painel})` chama `GerenciadorSessoes.fecharPelaApp(sessao)`: emite `{tipo:"fechada"}` (evento novo de `terminais:evento`, ANTES do fim do processo; o store do renderer esquece a sessão, a árvore a tira e a grade reflui, D-516), manda SIGINT (0,8 s) → SIGTERM (2 s) → SIGKILL (1 s) e só então descarta a sessão (histórico do daemon incluído). O `encerramento` desse processo leva `solicitado: true`: o 143 (ou o sinal) NÃO é falha e o renderer zera o código. Quem pede: `pane_close` (`pilot_request` → `orquestrador`), handoff concluído (`handoff_done` → `auto`), fechar/desligar o orquestrador (`dono`), X do painel (`terminais:descartar` → `dono`).
- **"Fechar workers ao terminar" (padrão LIGADO, por workspace).** Config `orquestracao.painel_livre.fechar_workers.<ws>` (ausente = ligado). Entregue e PERSISTIDO o handoff (`ok|parcial|bloqueado`), o painel do worker fecha sozinho depois de 3 s (`atrasoFechamentoMs`). Se o worker ainda está no meio do turno (`trabalhando`, CLI com sinal de atividade), o app espera o fim do turno por no máximo 20 s (`gracaTurnoMs`) antes de fechar; CLI sem sinal (Grok) fecha no prazo normal. O fechamento é do APP e não depende do orquestrador: CLI viva e ociosa depois do handoff é encerrada por SIGINT→SIGTERM→SIGKILL (`solicitado`, sem 143). Handoff `falhou` NUNCA fecha. CLI que sai com código 0 sem pedido = `concluido` e o painel fecha em 3 s; sem handoff o orquestrador recebe o aviso "encerrou sem entregar handoff". Desligada (só Missão avulsa), o painel fica aberto para inspeção ("Concluído") e o orquestrador o fecha com `pane_close`. Missão comum sempre fecha.
- **Falha que ninguém pediu (código ≠ 0 ou sinal sem `solicitado`).** O painel FICA com "Falhou (código N)" e botão "Fechar"; o orquestrador ganha um chip "N agente(s) falhou(aram)" e "limpar encerrados (N)"; o aviso chega pelo mesmo canal do wake (`[wake] Worker … (falhou): o processo terminou com erro (código N)…`) e `pane_list` traz `state: failed`, `closed_by: error`, `exit_code` e `last_output` (final da saída, ≤ 1 500 caracteres, redigido). Sem interação (ponteiro, clique, teclado ou foco) o painel fecha sozinho em 60 s (renderer; `PRAZO_FALHA_PAINEL_MS`). Evento de domínio `worker.falhou {pane_id, workspace_id, mission_id, codigo}`.
- **Cauda da saída (só memória do main, nunca em disco).** Ao fechar por qualquer caminho, o main lê a tela do leitor (`@xterm/headless`), limpa ANSI/OSC/controles, passa pelo scrubber do cofre (se já aberto) e por `redigirSegredos`, corta nos últimos 16 KB em início de linha e guarda por 10 min (`ttlCaudaMs`), no máximo 64 workers. `pane_read` de worker `encerrado` devolve essa cauda com `state`/`closed_by`/`exit_code`; depois do prazo devolve `lines: []`. `pane_list` lista os fechados por 10 min. Encerrar a orquestração apaga tudo. Evento `worker.fechado {pane_id, workspace_id, mission_id, estado, fechado_por}`.
- **`handoff_read {pane_id}`** (orquestrador; escopo da Missão): status, resumo e relatório lido da pasta do produto (dentro da raiz real, ≤ 32 KB, redigido); sem handoff = `not_found` orientando `pane_read`. Entrou em `TOOLS_AVULSO` (agora 11 tools) e na matriz `livre`/`squad`/`agentico`.
- **`pane_close` só do dono.** `verificarFechamento`: worker (executor, explorador, revisor) nunca fecha; piloto não fecha piloto nem a si mesmo; outro orquestrador não alcança o worker (escopo da Missão do token = `unauthorized`).
- **Prompt do orquestrador** (`orquestrador.md`/`.en.md` e a reserva): esperar o handoff (`handoff_read`/`pane_read`) ANTES de fechar; fechar com `pane_close` só quando o worker terminou; NUNCA fechar painel que ainda trabalha; fechado não é falha; falhou (`failed`) = ler a cauda e decidir.
- **Aprovações dos workers (D-640 a D-646).** Dois canais novos, tipos em `src/compartilhado/aprovacao-workers.ts` e `AprovacaoDoPane` em `painel-livre.ts`:
  - `painel_livre:aprovacao {workspace_id: string|null, nivel?, confirmacao?, permitir_raiz?, confiavel?, herdar?}` → `{workspace_id, nivel, proprio, permitir_raiz, confiavel, padrao_global}`. Sem os opcionais lê; `workspace_id: null` = padrão global (só aceita `nivel`). `nivel ∈ perguntar | automatico_seguro | total`; `total` exige `confirmacao: "liberar tudo"` (sem ela, erro nominal `confirmacao_necessaria` e nada é gravado). `herdar: true` (só workspace) apaga o nível próprio. Campo extra, nível inventado e `workspace_id` fora do padrão são recusados. Chaves de `config`: `orquestracao.aprovacao_workers.global` e `orquestracao.aprovacao_workers.ws.<id>`; ausente = `automatico_seguro` (workspaces existentes e novos).
  - `painel_livre:aprovacao_pane {pane_id}` → `{nivel, nivel_pedido, selo: garantido|parcial|pergunta, avisos[]} | null`: o que o app aplicou ao lançar o worker (memória do main; `null` = piloto, painel comum ou já esquecido). Alimenta o chip do cabeçalho.
  - `pane_spawn.aprovacao?: "perguntar" | "automatico_seguro"` só ABAIXA o nível configurado; `total` e qualquer outro valor são `invalid_argument`.
  - Lançamento do worker (`montarComandoWorker`, `EntradaComando.aprovacao`, só worker): Claude soma `--permission-mode acceptEdits` e funde `permissions.allow/deny` no `claude-settings.json` do Pane (allow em `//<cwd>/**`, MCP do app só com as tools do papel, deny rígido, `Agent`/`Task` negados); Codex soma `-s workspace-write -a never -c sandbox_workspace_write.network_access=false`; OpenCode funde `permission` em `OPENCODE_CONFIG_CONTENT`; Grok `--permission-mode acceptEdits --allow/--deny`. Ambiente: `GIT_CONFIG_COUNT=2` (`core.hooksPath` neutro, `core.fsmonitor=false`), `GIT_TERMINAL_PROMPT=0`. Nunca `--dangerously-skip-permissions` fora de `total`+Claude+worktree+confirmação; nunca `--always-approve`, `bypassPermissions` nem `--dangerously-bypass-approvals-and-sandbox`. O Pane do worker abre com `permissao: "seguro"` para as flags do workspace (D-14) não se somarem. Auditoria: `AUDITORIA-APROVACAO-WORKERS.md`.

## 21. Executar projeto (D-430 a D-437) — aditivo (tipos em `src/compartilhado/executar.ts`; núcleo em `src/nucleo/executar/**`; main em `src/main/executar.ts` e `src/main/ipc/executar.ts`; auditoria em `AUDITORIA-EXECUTAR.md`)

Canais (todos `invoke`, todos com `workspace_id`; o renderer NUNCA envia `cwd`, caminho de executável nem URL; campo extra é recusado):

| Canal | Entrada | Saída |
|---|---|---|
| `executar:listar` | `{ workspace_id }` | `ListaExecucao` (configurações detectadas + do usuário, padrão, confiança, armazenamento `arquivo`/`app`/`nenhum`, `vazio`) |
| `executar:estado` | `{ workspace_id }` | `EstadoExecucao` (fase `ocioso`/`preparando`/`rodando`/`parando`/`concluida`/`falhou`/`parada`, passo, porta, url, código, mensagem) |
| `executar:iniciar` | `{ workspace_id, config_id?, confirmar_hash? }` | `ResultadoIniciar`: `iniciado`, `confirmar` (pedido com comando exato e `hash`) ou `configurar` |
| `executar:parar` | `{ workspace_id, config_id? }` | `{ ok }` |
| `executar:reiniciar` | `{ workspace_id, config_id? }` | `ResultadoIniciar` |
| `executar:config_gravar` (**sensível**) | `{ workspace_id, config: ConfigExecucaoIpc, confirmou_shell }` | `ListaExecucao` |
| `executar:config_remover` | `{ workspace_id, config_id }` | `ListaExecucao` |
| `executar:definir_padrao` | `{ workspace_id, config_id }` | `ListaExecucao` |
| `executar:revogar_confianca` | `{ workspace_id, config_id? }` | `ListaExecucao` |
| `executar:historico` | `{ workspace_id }` | `EntradaHistoricoExecutar[]` (últimas 20) |
| `executar:abrir_url` | `{ workspace_id }` | `{ ok }` (abre a URL loopback detectada; o main revalida) |

Evento: `executar:evento` → `{ tipo: "estado", estado }`, `{ tipo: "sessao", workspace_id, sessao_id, anterior, focar, nome }` (painel "Execução": a sessão nova entra no lugar de `anterior`) ou `{ tipo: "configuracoes", workspace_id }`.

`ConfigExecucao`: `id` (slug), `nome`, `tipo` (`rodar`/`build`/`teste`/`outro`), `executavel` (nome no PATH ou caminho RELATIVO à raiz; nunca absoluto, sem espaço, sem `-` inicial), `argumentos[]` (separados; nunca shell), `cwd` (relativo), `ambiente` (só não sensível; segredo = `{{vault:NOME}}`), `pre_passos[]`, `porta`, `url` (loopback), `abrir_navegador`, `reiniciar_ao_salvar`, `grupo` (`null` = exclusiva), `shell` (linha para `sh -c`/`cmd /c`; opt-in; com ela `executavel` vira rótulo e `argumentos` fica vazio), `origem` (carimbada pelo main). Validação campo a campo em `src/nucleo/executar/validacao.ts`.

Arquivo do usuário: `<pasta do produto no projeto>/executar.json` → `{ "versao": 1, "padrao": "<id>|null", "configuracoes": [ConfigExecucao sem origem] }` (relativo, versionável). Fallback: `userData/executar/config-<workspace>.json`. Confiança: `userData/executar/confianca.json` (`{ workspace: { config_id: hash } }`; hash = sha256 truncado de comando, argumentos, cwd, ambiente, pré-passos, shell e corpo do script do repositório). Histórico: `userData/executar/historico.json`. Preferências (`app:config_gravar`): `executar_focar`, `executar_manter_ao_fechar`, `executar_notificar` (booleanos).

Barramento (§7, aditivo): `run.started`, `run.stopped`, `run.failed` com `{ workspace_id, config_id, nome, execucao_id, ... }` (nunca ambiente nem segredo).



## 21.1 Assistente de execução com IA (D-580 a D-589) — aditivo (tipos em `src/compartilhado/executar-assistente.ts`; núcleo em `src/nucleo/executar/assistente/**` e `monorepo.ts`/`prechecagens.ts`; main em `src/main/executar-assistente*.ts`; auditoria em `AUDITORIA-EXECUTAR.md`)

Canais (todos `invoke`; o renderer NUNCA envia caminho, cwd, dossiê, prompt nem argumento de CLI; campo extra é recusado):

| Canal | Entrada | Saída |
|---|---|---|
| `executar:assistente_previa` | `{ workspace_id, cli? }` (`cli` ∈ `claude`/`codex`/`opencode`) | `PreviaAssistente`: `dossie_hash`, `arquivos[]` (os que têm trecho), `itens_arvore`, `bytes`, `tokens_estimados`, `omitidos_sensiveis` (só o número), `clis[]`, `cli`, `modelo`, `pistas`, `limite_tempo_s`. Não envia nada à CLI |
| `executar:assistente_propor` | `{ workspace_id, cli, dossie_hash, consentimento: true }` | `{ assistente_id }`; recusa sem consentimento, com hash que não é o do dossiê atual (projeto mudou), com CLI fora da lista e com outro assistente em curso no workspace. O resultado vem por evento |
| `executar:assistente_cancelar` | `{ workspace_id }` | `{ ok }` (aborta e mata a árvore de processos da CLI) |
| `executar:assistente_salvar` (**sensível**) | `{ workspace_id, assistente_id, configs: ConfigExecucaoIpc[] (≤ 12), padrao_id \| null }` | `ListaExecucao`; vale só para a última proposta concluída (uma vez), recusa shell, revalida com `validarConfig`, confere o `cwd`, renomeia id colidente |

Evento: `executar:assistente_evento` → `{ tipo: "progresso", workspace_id, assistente_id, fase: "preparando"|"consultando"|"validando"|"retentando", decorrido_ms }`, `{ tipo: "concluido", …, resultado: ResultadoAssistente }`, `{ tipo: "erro", …, erro: { codigo: "cli_ausente"|"sem_login"|"limite"|"cli_erro"|"indisponivel"…, mensagem, sugestao } }` ou `{ tipo: "cancelado", … }`.

`ResultadoAssistente`: `fonte` (`ia`|`deterministico`), `aviso_fonte` (por que a IA não valeu), `itens[]` (`config` sem `origem`, `justificativa`, `confianca` 0–1, `novo`, `padrao`, `comando`), `avisos[]` (pré-requisitos em linguagem simples), `descartados[]` (`nome`, `motivo`), `cli`, `tentativas`, `duracao_ms`, `deteccao_total`.

**Aditivo em `executar:listar`:** `ItemConfigExecucao.avisos?: { codigo: "sem_node_modules"|"sem_venv"|"sem_docker"|"sem_programa", mensagem, pre_passo: { executavel, argumentos } | null }[]` (D-581).

**Esquema que a IA devolve** (SOMENTE JSON): `{ "configuracoes": [{ nome, tipo, executavel, argumentos[], cwd, pre_passos[{executavel,argumentos[]}], ambiente{}, porta, url, abrir_navegador, justificativa, confianca, padrao }], "avisos": [texto] }`. Campos que a IA não controla (id, grupo, reiniciar_ao_salvar, origem, shell) são descartados/ignorados. Validação: D-585.

**Dossiê (D-583):** árvore ≤ 300 itens e ≤ 3 níveis; ≤ 12 manifestos (≤ 6 KB cada, ≤ 40 KB no total); README ≤ 3 KB; teto 64 KB; redigido; nunca arquivo de ambiente, chave, credencial, `.git`, lockfile nem binário (nem o nome). O consentimento vale só para o `dossie_hash` mostrado.

Barramento / `evento_dominio` (§1 e §7, aditivo, SÓ contagens e códigos): `run.assistant.requested`, `run.assistant.proposed`, `run.assistant.failed`, `run.assistant.cancelled`, `run.assistant.saved` com `{ workspace_id, cli?, arquivos?, bytes?, tokens_estimados?, fonte?, itens?, descartados?, tentativas?, codigo?, quantidade?, duracao_ms }`; nunca nome de arquivo, comando, trecho do projeto nem resposta da IA.

Processo: a CLI roda SEM ferramentas (D-587), `cwd` em `userData/executar/assistente-cwd`, prompt por stdin (OpenCode: arquivo 0600 na pasta neutra, apagado ao fim), timeout de 150 s por tentativa (1 retentativa só para resposta inválida), nenhum comando é executado pela análise e a IA nunca concede confiança (a primeira execução pede a confirmação normal).


## 22. Painel de workspaces (D-450 a D-455) — aditivo (tipos em `src/compartilhado/workspaces-resumo.ts`; núcleo em `src/nucleo/workspaces/resumo.ts` e `ramo-git.ts`; main em `src/main/workspaces-resumo.ts` e `src/main/ipc/workspaces-resumo.ts`)

Canais (todos `invoke`; o renderer só envia ids e um booleano, NUNCA caminho, cwd nem pid; campo extra é recusado):

| Canal | Entrada | Saída |
|---|---|---|
| `workspaces:resumo` | — | `ResumoWorkspaces` (`versao: 1`, `gerado_em`, `itens: ItemWorkspaceResumo[]`) |
| `workspaces:resumo_ativar` | `{ ativo: boolean }` | `boolean` (estado efetivo); ligado, o main assina sessões e domínio; desligado, custo zero |
| `workspaces:encerrar_agente` | `{ workspace_id, sessao_id }` | `{ ok, motivo: "encerrado" \| "desconhecido" \| "outro_workspace" \| "falhou" }` |
| `workspaces:revelar` | `{ workspace_id }` | `boolean` (`shell.showItemInFolder`; o main resolve a pasta pelo id) |
| `workspaces:copiar_caminho` | `{ workspace_id }` | `boolean` (o main copia o caminho completo; o renderer só conhece o mascarado) |

Evento: `workspaces:resumo_mudou` → `ResumoWorkspaces` completo, coalescido (≥ 300 ms) e só quando o conteúdo mudou; só enquanto `resumo_ativar(true)`.

`ItemWorkspaceResumo`: `{ id, nome, pasta_mascarada (início `~`), branch, sujo (null = não medido), atual, missao ({ id, titulo, modo, estado, piloto_sessao_id } | null), missoes_ativas (além da exibida), agentes, execucao ({ fase, nome, porta, sessao_id, iniciado_em } | null), contagens { agentes, trabalhando, aguardando, erro, subagentes, terminais } }`.
`AgenteResumo`: `{ sessao_id, pane_id, mission_id, pai_sessao_id, profundidade (0 raiz, 1 worker), ferramenta_id, titulo, papel, piloto, estado (iniciando/trabalhando/aguardando/pronto/ocioso/erro), sessao_estado, atividade, desde, atividade_em, linha (≤ 80 car., limpa e redigida), subagentes ({ total, ativos } | null) }`. Sem `cwd`, sem argumentos, sem ambiente, sem caminho absoluto.

Regras: agente = sessão viva (≠ `encerrada`) que não é a sessão de Execução do projeto nem shell comum (esse vira só `contagens.terminais`); workspace da sessão = o do Pane, senão o da sessão, senão o atual. `ramo` lê `.git/HEAD`; `sujo` só vem de `vcs:mudou`. Encerrar prova que a sessão é agente daquele workspace antes de agir. Nenhuma migration; nenhuma escrita em disco além da preferência de interface do renderer.


## 23. Bichinho do workspace (D-460 a D-469, esforço D-500 a D-504) — aditivo (tipos em `src/compartilhado/bichinho.ts`; núcleo em `src/nucleo/bichinho/**`; main em `src/main/bichinho.ts` e `src/main/ipc/bichinho.ts`; renderer em `src/renderer/bichinho/**`)

**Canais de invocação** (todos sem payload sensível; o renderer envia só ids, espécie do catálogo e apelido):
- `bichinho:listar { workspace_ids: string[≤64] }` → `BichinhoVisao[]` (ids desconhecidos são omitidos)
- `bichinho:obter { workspace_id }` → `BichinhoVisao`
- `bichinho:trocar_especie { workspace_id, especie: EspecieId | null }` → `BichinhoVisao` (`null` = voltar ao automático)
- `bichinho:renomear { workspace_id, apelido: string(1–24) | null }` → `BichinhoVisao`
- `bichinho:atencao { workspace_id }` → `BichinhoVisao` (clique/foco: acorda e fica curioso por 2,5 s)
- `bichinho:usos` (sem payload) → `UsoEspecie[]` (D-674)

**Evento** `bichinho:mudou` → `{ workspace_id, visao: BichinhoVisao, estagio_novo: boolean }`, coalescido por workspace (120 ms; `estagio_novo` nunca se perde na junção). Emitido só quando espécie, apelido, estágio, maturidade, humor ou saúde mudaram.

`BichinhoVisao`: `workspace_id`, `especie` (efetiva) e `especie_automatica` (`caranguejo|piton|esquilo|raposa|camaleao|lontra|tucano|elefante|ourico|coruja|polvo|gato|sapo|urso`), `manual`, `motivo[]` (linhas legíveis da escolha automática), `apelido|null`, `estagio` (`ovo|filhote|jovem|adulto|veterano|lendario`), `maturidade` (0–100, nunca regride), `componentes { tokens, conhecimento }` (0–100), `tokens_total`, `conhecimento_itens { memoria, chunks|null, total }`, `humor` (`ocioso|dormindo|curioso|trabalhando|pensando|aguardando|comemorando|preocupado`), `doente` (cota ≥ 85%), `em`.

**Aditivo D-670 a D-674 (100 espécies, ovo, atribuição):**
- `EspecieId` = 100 ids (lista fechada em `ESPECIES`; `GRUPOS_ESPECIE`, `ESPECIES_LEGADAS` = as 14 primeiras, `VARIANTES_MAX = 4`). Validador do canal `bichinho:trocar_especie` = `vEnum(ESPECIES)`.
- Canal novo `bichinho:usos` (sem payload) → `UsoEspecie[] { especie, workspace_id, workspace_nome }` (quem usa cada espécie nos workspaces com bichinho; só nome de workspace, que o renderer já conhece).
- `BichinhoVisao` ganha, todos OPCIONAIS (compatibilidade com o main antigo e com os testes do passeio): `variante?: number` (0..3; > 0 só em repetição depois das 100), `ovo?: OvoVisao | null` (`{ tarefas, meta_tarefas, tokens, piso_tokens, progresso 0..100 }`; `null` fora do ovo) e `reatribuido?: { de: EspecieId } | null` (aviso único da correção dos repetidos).
- `EventoBichinhoMudou` ganha `nasceu?: boolean` (o ovo acabou de chocar; vem junto com `estagio_novo: true`; o coalescimento nunca o perde).
- `especie` passa a ser a espécie GUARDADA (não é mais recalculada a cada leitura); `especie_automatica` = a que a atribuição automática daria agora ao workspace (para "Automático (X)" e "voltar ao automático").
- Preferências (mesmo canal `app:config_*`, validadas em `FAIXAS_CONFIG`): `bichinho_sem_repetir` (boolean, padrão `true`) e `bichinho_meta_ovo` (inteiro 2–6, padrão `4`).
- Banco, migration `0021-bichinho-especies` (aditiva; a tabela é reconstruída porque o SQLite não altera CHECK): CHECK de espécie com as 100; colunas novas `variante INTEGER 0..3 DEFAULT 0`, `tarefas_concluidas INTEGER >= 0 DEFAULT 0` (monotônico, `MAX` no UPSERT) e `reatribuido_de TEXT NULL` (espécie anterior até o aviso único ser entregue); `especie_manual` (já existia; 0 = automática) é a marca que protege a escolha do dono. Linhas copiadas na ordem do `rowid` (ordem da primeira atribuição: desempata "o mais antigo mantém"). O estágio nunca volta a `ovo` (garantido no UPSERT).
- Fontes novas lidas do banco, só contagem de ids: `task` (estado `entregue`/`validada`, via `mission.workspace_id`), `mission` (`concluida`) e `maestro_pipeline` (`concluido`). Barramento: passa a assinar também `task.updated` (só `entregue`/`validada`) e `cost.updated` agenda o recálculo do ovo.

**Preferências globais** (canal genérico `app:config_ler/gravar`): `bichinho_mostrar` (boolean, padrão `true`) e `bichinho_silenciar` (boolean, padrão `false`).

**Preferências do passeio (D-650 a D-654, mesmo canal, validadas em `FAIXAS_CONFIG`):** `bichinho_passear` (boolean, padrão `true`: "Bichinhos passeiam quando ociosos"), `bichinho_ociosidade_min` (inteiro 1–30, padrão `3`: minutos sem mouse, teclado nem foco antes do passeio) e `bichinho_travessuras` (boolean, padrão `true`: só vale com `bichinho_passear` ligado e sem `prefers-reduced-motion`). Nenhum canal IPC novo: o passeio é inteiramente do renderer. Atributo de opt-out de UI: `data-sem-travessura` em qualquer elemento (ele e tudo dentro dele nunca são movidos).

**Banco:** migration `0020-bichinho`: `workspace_bichinho (workspace_id PK → workspace ON DELETE CASCADE, especie, especie_manual 0|1, apelido ≤ 24, maturidade_max 0..100, estagio, atualizado_em)`. `maturidade_max` só sobe (`MAX` no `UPSERT`). Fontes dos contadores: `custo_agregado` (escopo `workspace`, soma de `tokens_entrada + tokens_saida`), `memoria_entrada` (estado `ativa`) e, com o conhecimento ligado no workspace, o `chunks` de `conhecimento:estado`.

**Barramento consumido (§7, sem novos eventos):** `pane.state_changed`, `pane.closed`, `mission.closed`, `run.started|failed|stopped`, `limit.high`, `limit.reached`, `alert.created` (crítico). **Segurança:** nenhum conteúdo de conversa, de arquivo ou de segredo; leitor de disco confinado à raiz (sem `..`, sem symlink, ≤ 128 KB, nunca arquivo de ambiente/chave/credencial); caminhos sempre relativos; nada sai da máquina; sem telemetria.


**Esforço (aditivo, D-500 a D-504; nenhum canal novo).** `BichinhoVisao.esforco: EsforcoVisao` = `{ nivel: 0|1|2|3|4, origem: 'medido'|'estimado'|'estado'|'nenhuma', tokens_por_min: number|null, bytes_por_s: number, sessoes_fluindo: number }` (só números agregados; `tokens_por_min` só com fonte medida nos últimos 5 min). Viaja no mesmo evento `bichinho:mudou`, que agora também dispara quando nível, origem, faixa de tokens/min (passos de ≈19%), sessões fluindo ou humor mudam. O renderer exibe `dormindo` = 0 e `trabalhando` ≥ 2. Limiares, histerese (sobe na hora, desce 1 nível a cada 6 s, piso 1 por 20 s de atividade) e sono em 5 min: ver D-502. **Entradas no main (sem canal para o renderer):** saída do PTY por sessão (`dados.length` e contagem de quebras de linha, nunca o texto), `terminais:escrever` (só o id da sessão), `cost.updated` do escopo `workspace` (delta do total persistido) e, só para sessões `grok`, a leitura incremental de `<GROK_HOME ou ~/.grok>/sessions/<cwd codificado>/<id>/usage.json` (somente `session.inputTokens` e `session.outputTokens`, ≤ 64 KB, 8 sessões mais recentes, mtime). **Segurança:** nada de conteúdo de conversa, arquivo ou segredo atravessa; o leitor do Grok não abre nenhum outro arquivo (testado) e as chaves de `auth` nunca são lidas.

## 24. Suíte ExpxDev: instalar e módulos (D-470 a D-484) — aditivo (tipos em `src/compartilhado/suite.ts`; núcleo em `src/nucleo/suite/**`; main em `src/main/suite.ts`, `src/main/suite-modulos.ts` e `src/main/ipc/suite.ts`; renderer em `src/renderer/telas/suite/**`, `casca/BotaoInstalarSuite.tsx`, `telas/metodo/ModulosSuite.tsx`)

**Canais `suite:*` (10 invoke + 2 eventos; validador estrito por canal; nenhum caminho, versão, registro ou argumento vem do renderer; `workspace_id` precisa existir):**

| Canal | Entrada | Saída |
|---|---|---|
| `suite:estado` | `{ workspace_id }` | `EstadoSuite` (`estado`: `ausente\|completa\|incompleta\|desatualizada\|indisponivel`, `motivo`, `versao_instalada`, `versao_pedida`, `skills_presentes/faltando`, `dispensado`, `instalando`, `instalacao_id`) |
| `suite:requisitos` | `{ workspace_id }` | `PlanoSuite` (modo `instalar\|reparar\|atualizar`, versão fixada, nove skills com o papel, comando exato, pasta alvo com `~`, arquivos existentes por pasta, requisitos ✓/✗/○/ℹ com correção, `pode_instalar`, `rede`, `efeitos_fora`). **Nenhuma rede**: "Internet" fica `pendente` |
| `suite:instalar` | `{ workspace_id, modo }` (`modo` em lista fechada) | `{ instalacao_id }` (devolve na hora; o progresso vem pelo evento) |
| `suite:cancelar` | `{ workspace_id }` | `{ ok }` |
| `suite:dispensar` | `{ workspace_id, dispensar: boolean }` | `EstadoSuite` ("Agora não" por workspace, preferência `suite_dispensada_<id>`) |
| `suite:modulos_estado` | `{ workspace_id }` | `EstadoModulosSuite` (nove `ModuloInfo` com `ligado`, `exige`, `recomenda`, `dependentes`, `fonte`; `origem`: `arquivo\|app\|padrao`; `avisos`; `isolamento` por CLI) |
| `suite:modulos_definir` | `{ workspace_id, modulo (um dos nove), ligado, confirmar_cascata }` | `{ ok:true, estado, mudou }` ou `{ ok:false, precisa_confirmar:{ tipo:'desligar_dependentes'\|'ligar_requisitos', modulos }, estado }` |
| `suite:modulos_restaurar` | `{ workspace_id }` | `EstadoModulosSuite` (volta ao padrão global e grava) |
| `suite:modulos_padrao` | `{}` | `{ modulos, fabrica }` |
| `suite:modulos_padrao_definir` | `{ modulos: { <os nove>: boolean } }` (exatamente os nove) | `{ modulos, fabrica }` (recusa combinação incoerente) |

**Eventos (main → renderer):** `suite:progresso` = `ProgressoSuite` (`tipo:'progresso'`: `instalacao_id`, `fase`, `etapas[5]` com `pendente|ativa|ok|falhou|pulada`, `percentual`, `log` (cauda ≤ 150 linhas), `resumo` (versão, skills, criados/alterados/removidos, `fora_do_esperado`, `doctor`, `backup`, `como_restaurar`, `restaurados`), `falha` (`causa`, `mensagem`, `sugestao`, `codigo`, `etapa`), `limpeza`, `situacao_projeto`, `diagnostico`) **ou** `{ tipo:'estado', estado }`, coalescido em 120 ms (terminal sai na hora); `suite:modulos_mudou` = `{ workspace_id \| null }` (`null` = o padrão global mudou).

**Barramento (§7) e `evento_dominio`:** `suite.instalada`, `suite.falhou`, `suite.cancelada`, `suite.modulos_mudou`. Payload sem segredo, sem log e com caminhos relativos. **Nenhuma tool MCP** inicia instalação (varredura em teste). `maestro_request` recusa com `rule_violation/module_disabled` (novo subcódigo); `MaestroErro('module_disabled')`; `PlanoMaestro.modulos_desligados?: string[]`.

**Arquivo `.expxv/modulos.json`** (relativo ao workspace; só na pasta do produto): `{ "versao": 1, "modulos": { "sprintx": true, "runx": true, "legadox": false, "stackx": true, "mergex": true, "memox": true, "prodx": true, "buildx": true, "designx": true } }` — exatamente estas chaves, todas booleanas; qualquer desvio é "inválido" (padrão + aviso; o arquivo ruim é preservado como `modulos.json.invalido` antes de ser substituído). Padrão de fábrica: tudo ligado, exceto `legadox`. A pasta do produto ganha `!modulos.json` no `.gitignore` DELA para o arquivo ser versionável.

**Comando do instalador (fixo, testado):** `npm install --prefix <tmp> --no-save --no-package-lock --no-audit --no-fund --ignore-scripts --progress=false --registry <https> expxdev@<semver>` (cwd = `<tmp>`), depois `node <bin> init --yes --skills <lista do catálogo da versão> --harness claude,opencode` e `node <bin> doctor` (cwd = raiz do workspace); `atualizar` = `update --yes`. Preferências lidas (todas validadas): `suite_versao` (semver), `suite_registro` (https sem credencial), `suite_init_args` (≤ 4 flags `--palavra`, nunca `--yes|--skills|--harness|--check`), `suite_harness` (`claude`/`opencode`), `suite_modulos_padrao` (objeto parcial de booleanos).

- **`metodo:disparar` / `metodo:comando_sugerido` (D-495):** `GestoMetodo` ganha `gerar_convencoes`, `gerar_produto`, `gerar_memoria`, `gerar_design_system`, `gerar_perfil_legado` (comando sem argumento: `/expx:stackx-detectar`, `prodx-produto`, `memox-indexar`, `designx-cartography`, `legadox-perfil`; `argumento` ignorado). `IndiceProjeto.camadas_mtime?` (aditivo, D-496). Nenhum canal novo.

## 25. Medidor de CPU e memória da máquina (D-530 a D-535) — aditivo (tipos em `src/compartilhado/sistema.ts`; núcleo em `src/nucleo/sistema/**`; main em `src/main/sistema.ts` e `src/main/ipc/sistema.ts`; renderer em `src/renderer/estado/sistema*.ts` e `casca/MedidorSistema.tsx`, `PopoverSistema.tsx`, `sistema.css`)

Canais (todos sem dado sensível; o renderer só envia booleanos; **nunca** argumento de processo, caminho completo nem variável de ambiente cruza o IPC):

| Canal | Tipo | Entrada | Saída |
|---|---|---|---|
| `sistema:amostra_assinar` | invoke | `{ ativo: boolean }` | `{ ativo }` — liga/desliga a amostragem no main (sem assinante = zero timers) |
| `sistema:detalhe` | invoke | `{ aberto: boolean }` | `DetalheSistema` só com `aberto: true` (popover aberto); `null` com `false` |
| `sistema:amostra` | evento | — | `{ cpu: int 0–100, ram: int 0–100 }`, coalescido: no máximo 1 por 2 s |

`DetalheSistema`: `cpu_total`, `nucleos[]`, `ram { pct, usada_mb, total_mb, disponivel_mb }`, `swap { usado_mb, total_mb } | null`, `app { cpu, mem_mb, processos[] }`, `agentes { cpu, mem_mb, sessoes[] { rotulo, processos, cpu, mem_mb } }`, `top_cpu[5]` e `top_mem[5]` (`ProcessoVisto { nome, origem: 'app'|'agente', sessao, cpu, mem_mb }`). `nome` é SEMPRE o nome-base do executável (ou um rótulo fixo do processo do app); o tipo não tem campo para argumentos.

- **Validadores:** `vObjeto({ ativo: vBooleano })` e `vObjeto({ aberto: vBooleano })` (campo extra = recusa). Nenhum canal é sensível. O serviço nasce na primeira chamada (nada no boot, nada na onda 1).
- **Preferências** (`app:config_*`, faixas booleanas em `FAIXAS_CONFIG`): `medidor_sistema_mostrar` (padrão **ligado**) e `medidor_sistema_alerta` (padrão **desligado**). O prefixo `sistema_` é reservado pelo main, por isso `medidor_`.
- **Evento de domínio opcional** `sistema.carga_alta` (barramento, `{ cpu, ram, motivo: 'cpu'|'ram' }`): só com `medidor_sistema_alerta` ligado; dispara na subida (CPU ≥ 90% por 30 s contínuos ou RAM ≥ 92%) e rearma ao normalizar. Nenhuma notificação por padrão (a Fase 20 pode assinar o evento).
- **Fontes do SO** (binário de caminho absoluto, argumentos fixos e separados, nunca shell, ambiente mínimo sem variáveis do usuário, timeout curto): amostra periódica = `os.cpus()` (delta) + memória (macOS: `/usr/bin/vm_stat`; Linux: `/proc/meminfo` `MemAvailable`; Windows: `os.totalmem/freemem`). Só com o popover aberto: `/bin/ps -axo pid=,ppid=,rss=,pcpu=,comm=` (macOS/Linux) ou `powershell Get-CimInstance Win32_Process` com `ProcessId,ParentProcessId,WorkingSetSize,tempo de CPU,Name` (Windows; sem `CommandLine`), mais `sysctl -n vm.swapusage` (macOS) para o swap. Processos do app vêm de `app.getAppMetrics()`; as sessões vêm do daemon (`pid` de cada sessão) e as árvores são montadas por `ppid`.

**Layout por workspace (D-570, aditivo, sem canal novo).** `LayoutTerminais` ganha `expandido?: string | null` (painel que ocupava a aba inteira) e `foco_unico?: boolean` (modo foco de um painel só); `versao` segue 2. `terminais:layout_ler`/`layout_gravar` já eram por `workspace_id`; `null` agora é o grupo "Sem projeto" (D-571). `MetadadosSessao.workspace_id` (já existente) é a fonte de verdade de a qual workspace a sessão pertence. Validadores (IPC e leitura em disco) aceitam os campos novos, descartam o que não vale e preservam `proporcao` (0,05 a 0,95).

- **`metodo:disparar`, entrega confirmada (D-620):** `ResultadoDisparo` ganha `estado: "entregue" | "falhou"` e `entrega: "prompt_inicial" | "escrita" | null` (aditivos; `ok` segue valendo: `ok === (estado === "entregue")`). Pane novo: o comando vai como prompt inicial da CLI (sem corrida de prontidão) e o main espera até 700 ms para ver se a CLI saiu; se saiu, `ok: false`, `estado: "falhou"`, `motivo` em linguagem simples (com `pane_id`/`sessao_id` do Pane encerrado). Pane existente: só escreve se `pronto`; `entrega: "escrita"` só depois de `escrever` retornar verdadeiro. `PreparoDaSessao.prompt_embutido?: true` é o único modo de um preparo substituir o `prompt_inicial` do pedido.
- **`metodo:disparar`, foco do painel (D-610):** `ResultadoDisparo.sessao_id?: string | null` (aditivo): sessão do Pane que recebeu o comando; a UI usa para focar o painel. Chave de ajuste `metodo_ir_ao_terminal` (booleana, `app:config_*`).

## 26. Voz local embutida (D-540 a D-549) — aditivo (tipos em `src/compartilhado/voz-local.ts` e `captura.ts`; núcleo em `src/nucleo/voz/local/**` e `nucleo/voz/motores/local-embutido.ts`; main em `src/main/voz-modelos.ts`, `voz-modelos-ipc.ts`, `voz-modelos-boot.ts`; renderer em `src/renderer/telas/config/VozLocal.tsx` e `renderer/voz/modelos.ts`; auditoria em `AUDITORIA-VOZ-LOCAL.md`)

**Catálogo (`resources/voz/modelos.json`, versão 1).** `{ versao, runtime, hosts_origem[], hosts_arquivos[] (exatos ou "*.sufixo"), modelos[], amostras{} }`. Modelo: `id` (`^[a-z0-9][a-z0-9.-]{0,63}$`), `nome`, `descricao`, `idiomas[]` (ISO), `familia`
(`nemo_transducer`|`whisper`|`moonshine`), `perfil`, `recomendado` (no máximo um), `velocidade`, `qualidade`, `ram_estimada_mb`, `trecho_max_s`, `amostra`, `licenca { id, url, atribuicao }`, `origem { host, caminho_base }` (revisão por commit),
`arquivos[] { nome (simples), papel, bytes, sha256 (64 hex minúsculos ou "a_verificar") }`. `a_verificar` ⇒ o app recusa baixar. O catálogo é a ÚNICA fonte de URL/host/checksum.

**Configuração (`ConfigVoz`, aditivo).** `motor` ganha `"local_embutido"`; novos `modelo_local: string | null` e `ociosidade_s` (15 a 3600; padrão 120). `EstadoVoz` os herda. Códigos de erro de voz novos: `modelo_ausente`, `modelo_corrompido`, `runtime_indisponivel`.
`voz:config_gravar` aceita `modelo_local` (só id do catálogo) e `ociosidade_s`.

**Canais (invoke; nenhum sensível; o renderer só envia `modelo_id` do catálogo, nunca caminho nem URL).**

| Canal | Entrada | Saída |
|---|---|---|
| `voz:modelos_listar` | — | `ListaModelosVoz { modelos[] (ModeloVozInfo), espaco_livre_bytes, runtime_disponivel, motivo_runtime, pasta_exibicao, versao_consentimento, ociosidade_s, carregado, ram_mb, modelo_ativo }` |
| `voz:modelo_baixar` | `{ modelo_id, aceite_versao, ativar }` | `{ modelo_id }` (inicia; o progresso vem por evento) |
| `voz:modelo_pausar` / `voz:modelo_retomar` / `voz:modelo_cancelar` / `voz:modelo_apagar` | `{ modelo_id }` | `{ ok }` |
| `voz:modelo_ativar` | `{ modelo_id }` | `{ ok, codigo, instrucao }` |
| `voz:modelo_autoteste` | `{ modelo_id }` | `ResultadoAutoteste { ok, acertos, esperadas, carregamento_ms, transcricao_ms, rtf, codigo, instrucao }` |
| `voz:modelo_progresso` (evento) | — | `ProgressoModelo { modelo_id, fase, bytes, total, velocidade_bps, restante_s, arquivo_atual, codigo, instrucao, sequencia }`, coalescido (≥ 250 ms; a mudança de fase sai na hora) |

- **Validadores:** `vIdModelo` (`^[a-z0-9][a-z0-9.-]{0,63}$`), `aceite_versao` (≤ 40, `[0-9A-Za-z.-]`), `ativar` booleano; objeto estrito (campo extra, como `url`, é recusa). O serviço nasce na primeira chamada de `voz:*` (nada no boot, P-48).
- **Fases:** `nao_instalado`, `baixando`, `pausado`, `verificando`, `autoteste`, `instalado`, `erro`. Códigos: `sem_internet`, `servidor_recusou`, `disco_cheio`, `checksum_invalido`, `tamanho_invalido`, `redirect_recusado`,
  `runtime_indisponivel`, `modelo_corrompido`, `autoteste_falhou`, `consentimento_ausente`, `sem_checksum`, `modelo_desconhecido`, `ja_baixando`, `nao_instalado`, `cancelado`, `indisponivel`. O texto acionável em português vai pronto em `instrucao`.
- **Consentimento:** `aceite_versao` precisa ser igual a `VERSAO_CONSENTIMENTO_MODELO` (mudar o texto invalida os aceites). O aceite fica gravado (serviço `voz_modelo:<id>`); retomar exige aceite vigente.
- **Rede (aditivo em `nucleo/rede`):** `PedidoRede.redirecionar_para?: string[]` (≤ 8; exato ou `*.sufixo` de ≥ 2 rótulos; só https, porta padrão, sem credencial, sem IP literal; padrão inválido ⇒ `requisicao_invalida` antes de abrir socket). A varredura de rede do empacotamento segue exigindo SÓ `cliente-http.ts`.
- **Pastas:** modelos em `<userData>/voz/modelos/<id>/` (0700; arquivos 0600) com `.integridade.json`; parciais em `.parcial/<id>/`. Nunca caminho absoluto no IPC.
- **Processo de reconhecimento:** protocolo `MensagemParaWorker`/`MensagemDoWorker` (`carregar`, `transcrever`, `sair` / `pronto`, `carregado`, `resultado`, `erro` com código fixo); PCM16 16 kHz mono por mensagem; nunca arquivo.

## 27. Adicionar workspace (D-600 a D-609, D-613 a D-615) — aditivo (tipos em `src/compartilhado/workspaces-adicionar.ts`; núcleo em `src/nucleo/workspaces/adicionar/**`; main em `src/main/workspaces-adicionar.ts` e `src/main/ipc/workspaces-adicionar.ts`; renderer em `src/renderer/telas/adicionar-workspace/**`, `estado/adicionar-workspace*.ts`, `estado/adicionar-login.ts`, `casca/HostAdicionarWorkspace.tsx`; auditoria em `AUDITORIA-WORKSPACES-ADICIONAR.md`)

Nasce sob demanda (nada no boot). O renderer **nunca envia caminho**: só tokens de pasta pai (`DestinoPai.token`, `d_…`) emitidos pelo main e ids de achados (`ach_…`); a URL é texto livre validado de verdade no main (`analisarOrigemGit`); caminhos voltam sempre mascarados (`~/…`).

| Canal (invoke) | Entrada | Saída |
|---|---|---|
| `workspaces:adicionar_destino_padrao` | — | `DestinoPai` (pasta de projetos) |
| `workspaces:adicionar_escolher_pasta` | `{ lembrar }` | `DestinoPai \| null` (diálogo nativo; `lembrar` grava a preferência `pasta_projetos`) |
| `workspaces:adicionar_avaliar_destino` | `{ destino_token, nome }` | `AvaliacaoDestino` (livre, vazio, ocupado + sugestão, inválido; ja_workspace) |
| `workspaces:adicionar_abrir_destino` | `{ destino_token, nome }` | `Workspace \| null` ("abrir a existente") |
| `workspaces:adicionar_clonar_iniciar` | `PedidoClonar` (entrada, permitir_local, destino_token, nome, branch, raso, submodulos, **consentimento: true**) | `{ ok, clone_id } \| { ok: false, erro }` |
| `workspaces:adicionar_clonar_cancelar` | `{ clone_id }` | `boolean` |
| `workspaces:adicionar_projetos_buscar` | — | `{ busca_id }` |
| `workspaces:adicionar_projetos_cancelar` | `{ busca_id }` | `boolean` |
| `workspaces:adicionar_projeto_achado` | `{ achado_id }` | `Workspace \| null` (adiciona e troca) |
| `workspaces:adicionar_gh_estado` | `{ forcar }` | `{ instalado, autenticado, usuario }` (local, sem rede) |
| `workspaces:adicionar_repos_listar` | `{ consentimento: true }` | `{ ok, repos, truncado } \| { ok: false, erro }` (rede) |
| `workspaces:adicionar_novo_criar` | `PedidoNovoProjeto` | `{ ok, workspace, avisos, instalar_suite } \| { ok: false, erro }` |

Eventos (main → renderer, coalescidos ≥ 250 ms): `workspaces:adicionar_progresso` (`EventoClone`: fase, percentual, bytes, velocidade, `workspace` no `concluido`, `erro`, `destino_exibicao`, `nao_confiavel`) e `workspaces:adicionar_projetos_lote` (`LoteProjetos`: itens, visitados, fim, cancelada, limite_atingido). `AcaoMenu` ganhou `adicionar-workspace` (o antigo `abrir-projeto` segue direto ao diálogo). Validadores estritos (campo a campo, nada extra; token `^d_…`, ids com prefixo; `template` em lista fechada); remetente autorizado antes do validador; erro nominal vira texto, o resto vira "Não foi possível concluir a ação.". Eventos de domínio (`evento_dominio`, sem URL com credencial e sem caminho absoluto): `clone_iniciado`, `clone_concluido`, `clone_cancelado`, `clone_falhou`, `workspace_adicionado`, `projeto_criado`, `repos_listados`. O serviço de workspaces ganhou `avisarWorkspaces()` na interface de domínio para o modal emitir `workspaces:mudou`.

## 28. Commit e push / Enviar PR / Atualizar (D-630 a D-639, D-690 a D-693) — aditivo (tipos em `src/compartilhado/vcs-publicar.ts`; núcleo em `src/nucleo/vcs/publicar/**` e modelos em `src/nucleo/vcs/prompts/`; main em `src/main/vcs-publicar.ts` e `src/main/ipc/vcs-publicar.ts`; renderer em `src/renderer/casca/BotoesPublicar.tsx`, `DialogoPublicar.tsx`, `publicar.css` e `estado/vcs-publicar.ts`; auditoria em `AUDITORIA-COMMIT-PUSH-PR.md`)

Dez canais `invoke` aditivos (os cinco originais e, a partir do D-692/D-693, `buscar_remoto`, `preparar_atualizar`, `atualizar`, `pedir_merge` e `ignorar_suite`) (preload em `window.ade.vcsPublicar`, nomes inline, paridade conferida por `preload.test.ts`). O renderer manda só ids do app, texto de formulário e escolhas: nunca caminho, URL, cwd, remoto, comando nem argumento de git; nomes de branch passam por `validarNomeRamo` no validador e de novo ao montar a instrução. Nenhum canal executa `git commit`/`git push`/`gh pr create`: o main prepara e ENTREGA uma instrução ao agente (CLI de IA).

| Canal | Entrada | Saída |
|---|---|---|
| `vcs:publicar_estado` | `{ workspace_id, consultar_pr }` | `EstadoPublicacao` (git?, remoto GitHub?, `owner/repo`, `gh` ok/ausente/nao_autenticado/desconhecido, branch, branch padrão, `no_padrao`, `alteradas` (sem segredos nem pasta do produto), `a_frente` (upstream), `a_frente_base`, `tem_upstream`, `operacao_em_curso`, `oid`, `pr`). Leitura local; `consultar_pr: true` faz UMA consulta ao `gh` (só o acompanhamento pede, depois do push) |
| `vcs:publicar_preparar_commit_push` | `{ workspace_id, sessao_foco }` | `PreparoPublicacao` (rota, `total_arquivos`, +A/−R, os 8 primeiros NOMES, `mais`, `sensiveis`, sugestão de branch, CLIs instaladas, CLI padrão e a do painel em foco). Nunca conteúdo |
| `vcs:publicar_preparar_pr` | `{ workspace_id, sessao_foco }` | `PreparoPublicacao` |
| `vcs:publicar_enviar_instrucao` | `PedidoEnviarInstrucao` (`tipo`, `opcoes`: `criar_ramo`, `nome_ramo`, `incluir_nao_rastreados`, `mensagem`/título/descrição `agente\|manual`, `rascunho`, `base`, `revisores`, `confirmar_padrao`; `sessao_foco`, `cli`, `modo_painel: auto\|novo`) | `ResultadoEnviarInstrucao` (`estado: entregue\|falhou\|ocupado`, `motivo`, `pane_id`, `sessao_id`, `entrega: prompt_inicial\|escrita\|null`, `instrucao_rel`). Confere tudo de novo no main (git, GitHub, gh, branch padrão e frase `push na <branch>`, nome do branch, merge em curso, nada para commitar) |
| `vcs:publicar_abrir_url` | `{ workspace_id, url }` | `boolean` (só `https://github.com/...` sem credencial) |
| `vcs:publicar_buscar_remoto` | `{ workspace_id, forcar }` | `ResultadoBuscaRemoto { buscou, atras, erro }`. `git fetch --prune` silencioso, só com remoto github.com, no máximo a cada 60 s por workspace (`forcar` = clique do dono); nunca lança |
| `vcs:publicar_preparar_atualizar` | `{ workspace_id, sessao_foco }` | `PreparoAtualizar` (`upstream`, `commits`, `a_frente`, `arquivos_tocados` + 8 nomes + `mais`, até 5 `assuntos`, `conflita` (alteração local no mesmo arquivo que o upstream mudou), `divergiu`, `operacao_em_curso`, CLIs). Nunca conteúdo |
| `vcs:publicar_atualizar` | `{ workspace_id }` | `ResultadoAtualizar { estado: ok\|ja_atualizado\|recusado\|divergiu\|falhou, motivo, trouxe, sugerir_commitar }`. `git pull --ff-only` pelo executor do VCS (D-36: nunca merge/rebase/force; recusa antes de rodar com conflito local, merge em curso, sem upstream) |
| `vcs:publicar_pedir_merge` | `{ workspace_id, sessao_foco, cli, modo_painel }` | `ResultadoEnviarInstrucao` (instrução `merge.md` entregue ao agente como no Commit e push) |
| `vcs:publicar_ignorar_suite` | `{ workspace_id }` | `ResultadoIgnorarSuite { estado: ok\|nada, linhas }`. Acrescenta as pastas da suíte não rastreadas em `.git/info/exclude` (local; nunca `.gitignore`) |

**Contagem (D-691).** `EstadoPublicacao` ganhou `alteradas` (só RASTREADOS), `novas` (arquivos/pastas novos no nível do `git status`; uma pasta vale 1), `suite { itens, caminhos≤12 }` (não rastreados da suíte/app: fora do badge), `atras` e `upstream`. `PreparoPublicacao` ganhou `novos` e `suite { itens, caminhos, incluiveis }`. `OpcoesPublicacao.incluir_suite` (booleano obrigatório, padrão da UI `false`).

Auditoria: `evento_dominio` `vcs.publicar` com contagens e flags (sem nome de branch, arquivo, mensagem, título ou URL). Sem evento novo main → renderer: o acompanhamento reaproveita `vcs:mudou`.

## 27. Painel de progresso da pipeline (D-660 a D-665) — aditivo (tipos em `src/compartilhado/progresso.ts`; núcleo em `src/nucleo/progresso/**`; main em `src/main/progresso.ts` e `src/main/ipc/progresso.ts`; renderer em `src/renderer/estado/progresso.ts`, `telas/terminais/PainelProgresso.tsx` e `progresso.css`, `telas/config/SecaoProgresso.tsx`)

**Modelo.** `Progresso { id, origem: "maestro"|"sprintx"|"skill", titulo, itens: ItemProgresso[], concluido, workspace_id, resultado: "em_andamento"|"aguardando"|"concluido"|"falhou"|"cancelado", previsto, iniciado_em, fim_em, pedido?, fixado?, dispensado? }`; `ItemProgresso { id, rotulo (≤ 60), estado: "pendente"|"em_andamento"|"aguardando"|"concluido"|"falhou"|"pulado", detalhe?, desde?, fim_em?, grupo?, sessao_id? }`. Ids: `pl:<pipeline>`, `sx:<trabalho>`, `sk:<skill>:<chave>`. No máximo 60 itens e 12 progressos por publicação. Sem conteúdo de conversa: `pedido` é o resumo já redigido pelo scrubber do Maestro, cortado em 60.

**Canais (invocação).** `progresso:estado` (sem payload; devolve `{ progressos }`), `progresso:dispensar` `{ id }` e `progresso:fixar` `{ id, fixado }` (ambos devolvem `{ ok: true }`). Validadores estritos (`vObjeto`, id por padrão `^(pl|sx|sk):…`, campo extra recusado). **Evento:** `progresso:mudou` `{ progressos }` (estado agregado de todos os workspaces, coalescido em ≥ 250 ms, só quando muda). Preload com nomes inline e paridade conferida por `preload.test.ts`. Preferência `progresso_painel_mostrar` (booleana, padrão ligada) pelo `app:config_*`.

**Fontes.** (a) pipeline do Maestro: `PipelineEstado` lido do banco (`servico.estado`), nunca o `detalhe` (que calcula o piso); (b) tasks do plano ativo do observador do método (`Trabalho.sprints/fases/tasks`; ativo = task reivindicada ou plano começado e não terminado, com atividade nos últimos 15 min); (c) `/expx:<skill>` visto pelo hook `UserPromptSubmit` (`PortaDoGanchoMaestro.skillDetectada`, opcional, aditivo) ou atividade nova no rastro; fim pelo sinal de atividade da sessão. Nada é gravado em `docs/` nem no repositório do usuário (D-04): o estado de acompanhamento vive só em memória.

## 29. Decisor local laya (Fase 25, D-695 a D-708) — aditivo (tipos em `src/compartilhado/laya.ts`; plano em `fase-25-laya-local.md`; estudo em `seguranca/AMEACAS-FASE-25.md`; pesquisa em `base/L-laya-local.md`)

Motor opcional de decisões tipadas (`choice`/`score`/`noul`) em processo próprio, pesos ONNX baixados por
consentimento no molde da voz (D-540/D-542). **O laya sugere, nunca decide** (D-698): só devolve `DecisaoLaya`
(atrás da fila com taxa/timeout/coalescência); a ação é sempre da regra determinística. O texto que entra é dado
não confiável: teto de 8 KB por chamada, truncagem mantendo o fim com contagem, redação na entrada e **nunca
persistido** — eventos e saídas carregam só métricas agregadas (D-699).

**Canais (invocação; preload em `window.ade.laya`).** O renderer manda só `modelo_id` do catálogo versionado,
`aceite_versao` do consentimento e patches de `ConfigLaya` — nunca caminho, URL nem texto de pergunta.

| Canal | Entrada | Saída |
|---|---|---|
| `laya:estado` | — | `EstadoServicoLaya` (`estado: indisponivel\|desligado\|pronto\|carregando\|ativo\|falhou`, `config`, `modelo_ativo`, `carregado`, `ram_mb`, `latencia_p50_ms/p95_ms` (`null` = sem medida, D-704), `metricas` por consumidor (`decisoes/abstencoes/erros/descartes`), `codigo`, `instrucao`) |
| `laya:consentir` | `{ host, aceitar }` | `{ ok: true }` (consentimento de rede do host do catálogo, D-114) |
| `laya:modelos_listar` | — | `ListaModelosLaya` (modelos com `baixavel=false` quando falta sha256 — recusa `sem_checksum`, D-697; `runtime_disponivel`/`motivo_runtime`; `pasta_exibicao`) |
| `laya:modelo_baixar` | `{ modelo_id, aceite_versao, ativar }` | `{ modelo_id }` |
| `laya:modelo_pausar`/`_retomar`/`_cancelar`/`_apagar`/`_ativar` | `{ modelo_id }` | `{ ok: boolean }` (+`codigo`/`instrucao` no ativar) |
| `laya:testar` | — | `ResultadoTesteLaya` (`carga_ms`, `latencia_p50_ms/p95_ms`, `ram_mb`, `decisao_amostra: DecisaoLaya`, `null` = «não medido») |
| `laya:config_gravar` | `{ patch: Partial<ConfigLaya> }` | `EstadoServicoLaya` |

**Eventos (main → renderer):** `laya:modelo_progresso` (`ProgressoModeloLaya`, coalescido ≥ 250 ms, P-706) e
`laya:estado_mudou` (`EstadoServicoLaya`). **Eventos de domínio (barramento):** `laya.decisao` (só métricas:
tipo, confiança, latência, `absteve`, hash curto) e `laya_falhou`/`laya.encerrado` (D-707). Nenhum payload de
evento carrega texto de entrada (AP-04).

**Decisão tipada.** `DecisaoLaya { tipo, escolha, pontuacao, probabilidade, distribuicao, confianca, limiar,
latencia_ms, modelo_id, absteve }` — `absteve: true` quando `confianca < confianca_minima`; o consumidor segue no
fallback determinístico (T-25.08). Mapeia 1:1 para `RespostaAsk { probs, choice, confidence }` do decisor do
Maestro (fonte `laya_local`, T-25.12).

**Config e limites.** `ConfigLaya { habilitado, modelo_id, confianca_minima, taxa_maxima_minuto, ociosidade_s,
usar_no_maestro, ordenar_roteamento, sinais_terminal, classificar_erros, urgencia_alertas }` — TUDO desligado por
padrão (D-695/D-708). `LIMITES_LAYA`: timeout 500 ms, taxa padrão 60/min, teto de entrada 8 192 bytes, progresso
250 ms, 1 retentativa de crash (depois desliga até clique). Runtime: processo próprio, protocolo NDJSON
versionado com `pedido_id` (resposta casada por id, AP-17), `nice` baixo, ociosidade encerra, sha256 re-verificado
a cada carga (AP-03). Agentes e testes NUNCA baixam pesos: suíte com stub ONNX local; medição real é do dono
(`LAYA_MODELO_DIR`, P-702..P-704 provisórios, D-704). Tool MCP `laya_decide` (T-25.19): desligada por padrão em
todos os modos, opt-in por Pane, resposta tipada sem eco de texto (D-702).
