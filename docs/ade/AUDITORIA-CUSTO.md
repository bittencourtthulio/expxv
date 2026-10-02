# Auditoria da Fase 10 (custo e board), onda 2

Escopo: vazamento de conteúdo de transcript, preço desatualizado apresentado como certo, delegar card burlando WIP/permissão.

## Achados e correções

| # | Achado | Gravidade | Estado | Prova |
|---|---|---|---|---|
| A-01 | `board:delegar_card` burlava o WIP: `excedido` era `total > limite`, então o último card passava no limite exato | alta | corrigido (`wipAtingido`, `total >= limite`, em `board/delegar.ts` e `movimento.ts`); o teto de 8 workers também vale na delegação | `src/nucleo/board/acoes.test.ts`, `src/main/custo-delegar.test.ts` |
| A-02 | Delegar fora de Missão squad/agêntico, sem worktree ou com Missão encerrada | média | já recusado em `delegarCard` (`not_in_mission`, `mission_closed`); mantido e coberto na porta real | `acoes.test.ts`, `custo-delegar.test.ts` |
| A-03 | Preço embutido tratado como certo | média | mitigado desde o desenho: toda entrada nasce `confirmado:false` e o registro sai `aproximado:true` ("≈"); tarifa de cache derivada também é "≈"; modelo sem entrada vira `usd:null` ("≥"/"custo desconhecido"); o valor é congelado na ingestão e só `reprecificar` (explícito) muda | `calcular.test.ts`, `custo-formato` (UI) |
| A-04 | Conteúdo de conversa em banco, log, evento, IPC, MCP, argv ou DOM | alta | sem ocorrência: o leitor extrai só `{ts, modelo, tokens, chave, usd?}`; teste de forma no worker; sentinelas varridas | `tests/privacidade-custo.test.ts`, `custo-ingestao.test.ts`, `ingestao.test.ts` |
| A-05 | `handoff_submit` com `cost`/`tokens` inventados | alta | campo ignorado; agregados idênticos | `src/nucleo/mcp/tools-custo.test.ts` |
| A-06 | Tools MCP de custo lendo outra Missão | alta | `project` fora da Missão do token devolve `not_found` | `tools-custo.test.ts`, `custo-mcp.test.ts` |
| A-07 | Fontes por caminho: leitura fora da base, symlink para fora, varredura do home | média | recusados; só `base + relativo`; sem varredura | `fontes.test.ts` |
| A-08 | Codex: `cached_input_tokens` e `reasoning_output_tokens` já estão dentro de `input`/`output` nos arquivos reais; somá-los de novo inflaria o custo | média | o leitor não soma o raciocínio à saída e separa o cache da entrada (desvio consciente do texto do plano) | testes do leitor Codex |

## Pendências e limites conhecidos

- OpenCode (P-82): fonte completa. `opencode.db` (SQLite, 23 GB nesta máquina) é lido SOMENTE em leitura no worker (`node:sqlite`, cache de 8 MiB, sem mmap, só pelo índice `session_id,time_created,id`, lotes de 500, cursor em ms que fica na resposta ainda em andamento), a sessão do Pane é achada por chave primária ou pelas 200 últimas sessões do mesmo diretório, e a base `opencode_data` entrou pela migration 0015 (`uso_fonte` recriada preservando `uso_registro`). Medido em base sintética de ~180 MB: localizar 0,7 ms, 1º lote 2,9 ms, incremental 0,3 ms, RSS +0,3 MB (P-82a a P-82d). Limite conhecido: sessões filhas (subagentes) do OpenCode ainda não viram fonte própria. Gemini, Qwen, Kilo e Aider não têm formato legível aqui: ficam `sem_fonte` (nunca 0).
- Delegar card sem o roteador do harness devolve `unavailable/no_router`; com ele, o worker abre com o `task_ref` do card.
- P-80 (alertar e, por opção, bloquear): implementado. `bloquear_ao_estourar_teto` em `ConfigBoard`, por workspace, padrão desligado (só alerta; ligar em Consumo › Fontes e preços). Ligado e com o teto da Missão estourado, `board:delegar_card` recusa com `rule_violation.ceiling_reached`; nada em andamento é interrompido. Testes: `acoes.test.ts`, `custo-delegar.test.ts`, `ipc/custo.test.ts`, `consumo/Uso.test.tsx`, `board/Delegar.test.tsx`. O recibo da delegação agora leva `estimativa` (nunca apresentada como custo do card).
- P-116, "DOM ≤ 200 elementos" (unidade decidida pelo coordenador: elementos do DOM): corrigido pela causa. Card = 1 elemento (glifo, id, selos, custo e CLI por pseudo-elementos), coluna = 3 elementos, lista virtualizada própria (sem wrappers, margem 1) e menus só montam o painel aberto. Em jsdom, 1 000 cards: 1 030 -> 117 elementos (66 cards) e 1ª abertura de 14 ms; com coluna medida de 560 px fica em ≤ 200 (teste). Falta medir no Electron real (Playwright).
- E2E T-10.31: cenários 1 a 13 escritos em `tests/custo-fluxo.e2e.test.ts` (o de UI segue em `tests/custo.e2e.test.ts`), type-checados e NÃO executados (exigem `npm run build`; há `npm run dev` do dono). O cenário 9 se auto-ignora sem roteador do harness; 6 e 7 verificam a regra pelo banco, sem abrir Pane de gemini nem proxy real.
- `ingestao.test.ts` "matar o worker no meio" era instável sob carga (o vigia de arquivo pede nova leitura logo após a queda): causa no teste, que assumia o estado intermediário; agora só afirma o estado final (sem perda nem duplicação), estável com 8 processos de CPU concorrentes.
