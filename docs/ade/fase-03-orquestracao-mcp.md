# Fase 3 — Orquestração e MCP

Objetivo: o piloto delega a workers por MCP, o handoff é garantido por hooks e as regras de
orquestração valem **em código**. Base: `base/B-…` (specs 02 e 05), `05-CONTRATOS.md` §3 e §4.

**Portão da fase**: `npm run verificar` verde · e2e de delegação "1+1" com CLI falsa que fala MCP
(abre Pane visível, handoff ok, wake, piloto continua) verde · `perf`: delegação p50 ≤ 12 s com CLI
falsa ≤ 2 s.

### T-03.01 · Sidecar MCP com token por Pane
- Arquivos: `src/nucleo/mcp/{servidor,tokens,erros,catalogo}.ts`, `src/main/mcp.ts` + testes.
- HTTP `127.0.0.1` porta efêmera (`@modelcontextprotocol/sdk` 1.31.0, exato), `Authorization:
  Bearer`, token HMAC com `{workspace_id, mission_id, pane_id, role, mode, tools_allow[], exp}`,
  relido a cada chamada; `tools/list` filtrado pelo token; erros `{code, subcode?, message}`;
  sem acesso a banco/chaves; loopback apenas; corpo ≤ 1 MiB.
- Teste: sem token → `unauthorized`; token adulterado/expirado → `unauthorized`; tool fora da
  lista nem aparece em `tools/list`; `mission_id`/`pane_id` do argumento são ignorados.
- Aceite: um cliente MCP de teste lista e chama tools com token de Pane.
- Depende: T-00.06, T-02.01.

### T-03.02 · Tools núcleo
- Arquivos: `src/nucleo/mcp/tools/{provider,pane,mission}.ts` + testes.
- `provider_list`, `model_list`, `pane_spawn` (valida gate → papel → limite → provider habilitado;
  retorna só `{pane_id}`), `pane_list` (sem conteúdo de tela), `pane_read` (`last_n` default 200,
  teto 2000; usa o armazém/`@xterm/headless` para ler a tela), `pane_send` (`submit` default true;
  texto > 20 KB vira arquivo em `.expxv/entradas/` e envia o caminho), `pane_close`,
  `mission_list`, `mission_complete` (exige handoff ok de revisor).
- Teste: matriz por modo (livre/squad/agentico) de `tools/list`; `limit_reached` sem crash;
  `provider_disabled`; `pane_read last_n:100` de 500 linhas devolve 100; `pane_send` grande vira arquivo.
- Aceite: `pane_spawn` cria Pane visível na UI em ≤ 300 ms.
- Depende: T-03.01, T-02.06, T-01.05.

### T-03.03 · Briefing e handoff
- Arquivos: `src/nucleo/orquestracao/{briefing,handoff,wake}.ts` + testes.
- Briefing `.md` com `Contrato`, `Resultado`, `Executado_por`; `handoff_submit` (`resumo ≤ 400`,
  `relatorio_path` existente e legível, status); ordem **relatório → banco → wake**; fila de wake
  entregue no próximo ponto seguro (Pane ocioso), nunca esperando "silêncio"; Pane do worker
  fechado pelo sistema ao concluir.
- Teste: resumo > 400 → `summary_too_long`; relatório ausente → `handoff_missing`; wake só depois
  de persistir; fila preserva ordem; 2 cards no mesmo Pane não somam orquestração.
- Aceite: worker chama `handoff_submit`, piloto recebe o wake em < 2 s.
- Depende: T-03.02.

### T-03.04 · Hooks por Pane
- Arquivos: `src/nucleo/orquestracao/hooks/{claude,fallback}.ts`, `scripts-hook/*.mjs` + testes.
- Claude Code: arquivo de settings **por Pane** em diretório do app (nunca o global),
  `managed_by_expxv`: `Stop` ×2 (handoff registrado; relatório existe e não vazio;
  `max_stop_retries = 3`, depois libera e marca `failed`), `PostToolUse` em `handoff_submit`,
  `SessionStart` (briefing + instruções). Outras CLIs: prompt por argv + watcher de ociosidade que
  reenvia lembrete **uma vez** após `handoff_timeout` e ociosidade; nunca por falso negativo.
- Teste: stop hook barra sem handoff e libera após 3; `PostToolUse` só acorda depois de persistir;
  settings do usuário intactos; fallback não reenvia duas vezes.
- Aceite: worker Claude Code de fixture (hooks simulados) não encerra sem handoff.
- Depende: T-03.03, T-01.07.

### T-03.05 · Regras de orquestração em código
- Arquivos: `src/nucleo/orquestracao/regras.ts` + testes.
- `rule_violation` com subcodes: piloto não invoca orquestrador nem a si mesmo; só agentes do
  squad; `gate_pending` até o intake liberar (`direction|content|build|qa`); `forbidden_role`;
  `reviewer_required`; `limit_reached` (`max_parallel_panes = 8`); revisor de provedor ≠ executor
  quando possível (política, aviso); **guarda anti-piloto-que-codifica**: piloto sem Edit/Write fora
  de `.expxv/` (via settings do Pane); workers herdam `mission_id` + papel.
- Teste: uma tabela de casos por regra; guarda do piloto bloqueia escrita em `src/`.
- Aceite: nenhuma regra depende só de prompt.
- Depende: T-03.02.

### T-03.06 · Piloto e workers
- Arquivos: `src/nucleo/orquestracao/{piloto,prompts}.ts`, `prompts/*.md` (versionados e editáveis) + testes.
- Spawn do piloto (Pane fixo à esquerda, `eh_piloto`) com prompt-base, config MCP (token) e canal
  de instruções (`--append-system-prompt` no Claude; arquivo + flag nas demais; se a CLI não tiver
  contrato de intake: `pilot_cli_unsupported_intake`); workers nascem com contexto limpo e prompt
  mínimo ("execute o card X e entregue pelo handoff"); respawn de piloto mantém o mesmo `pane_id`
  quando troca de conta.
- Teste: montagem de comando por CLI (argv, sem shell); piloto respawnado mantém `pane_id`;
  prompts carregados de arquivo.
- Aceite: piloto de fixture recebe só as tools do modo agêntico.
- Depende: T-03.05, T-01.03.

### T-03.07 · UI de Missão (piloto + workers)
- Arquivos: `src/renderer/telas/terminais/{ModoMissao,RotuloPane,PainelPiloto}.tsx` + testes.
- Piloto fixo à esquerda, grade de workers à direita, rótulo `#id · CLI · papel · missão`,
  realce de `aguardando`, contador de tokens/custo **quando conhecido** ("custo desconhecido" nunca
  vira zero), aviso amarelo quando o piloto reiniciou sem conteúdo persistido, botão "copiar prompt".
- Teste: RTL do rótulo e do aviso; custo desconhecido renderiza texto, não "0".
- Aceite: delegar cria o worker na grade sem reflow brusco (sem salto de layout medido).
- Depende: T-03.06, T-01.06.

### T-03.08 · E2E de delegação
- Arquivos: `tests/fixtures/cli-mcp.mjs` (CLI falsa que conecta ao MCP com o token do ambiente),
  `tests/orquestracao.e2e.test.ts`.
- Cenários: delegação 1+1 (Pane visível, handoff ok "2", wake, piloto livre); stop hook falha 3×
  → `failed`; `forbidden_role`; `gate_pending`; `reviewer_required`; provider desabilitado;
  `limit_reached`.
- Aceite: todos verdes; sem processo de worker sem Pane na UI.
- Depende: T-03.07, T-03.04.
