# Fase 8 (Memória) — onda 1, núcleo puro: o que foi feito, decisões e pedidos ao coordenador

Escopo entregue: `src/nucleo/memoria/**` (+ testes), `src/compartilhado/memoria.ts`, migration `0007-memoria`, `tests/fixtures/memoria/**`,
`tests/perf/memoria.perf.ts`. Nada em `main/`, `preload/`, `renderer/`, `ipc.ts`, `mcp/`, `package.json`, `STATUS.md`. Sem dependência nova.
Ajustes das `DECISOES-DAS-PENDENCIAS.md` aplicados (override): P-21 memória ligada em TODOS os modos (solo e squad ligados por padrão,
chave por workspace e por Missão), P-22 retenção 365 d (0 = sem limite) + `teto_mb` com aviso, P-23 anel 3 com até 50 itens, P-24 squad com
memória PRÓPRIA (escopo `squad`/modo `squad`; substitui RF-06.42), P-25 `reindexarMemox` pronto (executor injetado).

## Tasks do plano: situação

| Task | Situação |
|---|---|
| T-08.02 redação | feita: `memoria/redacao.ts` (`redigirTexto`, scrubber do cofre opcional); corpus 75 positivos / 46 negativos em `tests/fixtures/memoria/segredos.json` |
| T-08.03 saneamento/envelope | feita: `sanear-brief.ts` (`linhaSegura`, `envelope`, `substituirBrief`) |
| T-08.04 migration + repositório + FTS | feita: `0007-memoria`, `repo.ts` (em `memoria/`, não em `banco/repos/`, para não editar `repos/index.ts`), `fts.ts` |
| T-08.05 linhagem · T-08.06 modo | feitas: `linhagem.ts`, `modo.ts`, `contexto.ts` |
| T-08.07 escrita · T-08.08 coletor · T-08.10 ponte memox | feitas: `escrita.ts`, `coletor.ts` (coalescido, fatias de 15 ms), `ponte-memox.ts` |
| T-08.09 fechar Pane na mesma transação | NÚCLEO feito (`fechamento.ts#criarAoEncerrar`); FALTA o gancho em `repos/pane.ts` (ver pedido 3) |
| T-08.11 brief e pacote · T-08.13 leitura | feitas: `brief.ts`, `pacote.ts`, `leitura.ts` (FTS5 + LIKE) |
| T-08.12 tools MCP | NÚCLEO feito (`servico.ts#memory_*`, validação campo a campo, identidade só do token); FALTA registrar as tools (pedido 2) |
| T-08.14 restore | NÚCLEO feito (`restaurar.ts`: lock por Pane, índice único, `substituirBrief`, prévia); FALTA a porta `respawn` no main (pedido 4) |
| T-08.15/16 | núcleo pronto (`pacoteDaMissao`, `missaoTemAprendizado`, `ciclo.aoFecharMissao`); falta integrar em `piloto.ts`/hooks/`mission_complete` (pedido 5) |
| T-08.17/18/19/20 | feitas: `ciclo.ts`, `preferencias.ts`, `privacidade.ts`, `metricas.ts` |
| T-08.29/30/35 | feitas como testes de núcleo: `aceitacao.test.ts` (AC-08.01..12), `adversarial.test.ts`, `contrato-conhecimento.test.ts` (consumidor falso) |
| T-08.31 perf | feita no núcleo: `tests/perf/memoria.perf.ts` (P-32..P-39, P-41, P-42); P-36 round trip MCP, P-40 (tela) e e2e ficam para a integração |
| T-08.34 conhecimento reutilizável | feita DENTRO de `memoria/` (área exigida): `ingestao.ts`, `eventos-conhecimento.ts`. A Fase 15 pode importar daqui ou mover para `src/nucleo/conhecimento/` re-exportando |
| Vetorial / híbrida (pedido do coordenador) | feita: `memoria/vetorial/{embedding,indice,busca}.ts`, opcional e desligada por padrão (ver decisões) |
| Consulta antes de implementar | feita: `consulta-previa.ts` (`servico.consultaPrevia(paneId, descricao)`) |
| T-08.21..28 UI, T-08.32 e2e, T-08.33 auditoria | fora do núcleo (coordenador/UI) |

## Orçamentos medidos (`npx vitest run --config vitest.e2e.config.mts tests/perf/memoria.perf.ts`, 50 000 entradas, arquivo WAL)

P-32 brief completo p95 1,1 ms (≤ 50) · pacote 0,14 ms (≤ 20) · P-33 buildBrief puro p95 1,1 ms (≤ 5) · P-34 escrita p95 1,2 ms (≤ 5) ·
P-35 busca FTS5 p95 15,7 ms (≤ 30), LIKE p95 37 ms (≤ 80), resposta ≤ 8 048 B (≤ 8 192) · P-36 restore 2,8 ms · P-37 evento 0,11 ms (≤ 2),
maior fatia do coletor em rajada de 500 = 37 ms (≤ 50) · P-38 maior fatia do ciclo 13 ms (≤ 20), 5 000 compactadas em 222 ms (≤ 2 s) ·
P-39 1 000 chars 0,05 ms, 1 MB adversarial 44 ms (≤ 100) · P-41 banco 35,9 MB (≤ 40), memória adicional 0,9 MB (≤ 10) · P-42 chunk 1 MB
2,9 ms (≤ 100), relatório 20 KB 0,8 ms (≤ 5), `registrar` com consumidor travado ~0 ms (≤ 1). Causas corrigidas (nunca o limite): plano do SQLite
"FTS primeiro" (150-240 ms) → `rowid IN (subconsulta FTS)` com `+workspace_id`; `count(*)` do teto por workspace → contagem em cache;
varredura de 50 mil linhas no pacote → consulta por `anel` (índice); hash do conteúdo 32 hex em vez de 64 (−3,6 MB).
Observação: as asserções estritas de tempo (P-39) rodam no perf (sequencial); nos testes unitários há só teto de 1 s contra backtracking catastrófico.

## Decisões tomadas (propostas de D-NN para `01-DECISOES.md`; não editei o arquivo)

1. **Vetores na memória: opcional, desligado por padrão, sem dependência nativa.** `memoria_vetor` (BLOB Float32 por entrada e modelo) +
   varredura exata SÓ sobre o recorte escopado (linhagem/Missão/anel 2: ≤ milhares de linhas) + RRF (k = 60) com o braço lexical. Sem
   índice global em RAM (P-41 mede 0,9 MB). Provedor injetado por interface (`ProvedorEmbedding`); piso `hash-256-v1` determinístico e
   offline (≤ 1 ms); provedor remoto só roda dentro de `exigirConsentimento(...)` (falha ANTES de qualquer saída de dado). `sqlite-vec`/ONNX
   ficam com a Fase 15 (`conhecimento.db`, worker): D-54 preservado, `build_brief` nunca consulta vetor.
2. **Squad com memória própria (P-24):** escopo `squad` (anel 2, por `squad_slug`), destilação da Missão squad vai para o anel da squad,
   isolada das outras squads e do projeto; modo efetivo `squad`; migration com CHECKs (`escopo='squad'` ⇒ `squad_slug`; `anel=2` ⇔ workspace|squad).
3. **Pacote/brief só de dados:** envelopes `<memoria_restaurada>` e `<contexto_projeto>`/`<conhecimento_previo>` com `tipo="dados"`; cada entrada é UMA linha
   saneada (`<`/`>` viram entidades, cercas e `---` neutralizados, ANSI/bidi/zero-width removidos).
4. **Hash de dedupe = 32 hex** (128 bits do sha256); CHECK aceita 32..64.
5. **Teto do workspace é "mole"** (contagem em cache, recontada a cada 200 escritas ou ao tocar o teto).
6. **Compactação em lotes de 200 por fatia** (um grupo por dia por vez); `substituida` é purgada após 30 dias (o plano só falava de resumida/expirada).
7. **`mission.closed` ao conhecimento:** o ciclo emite UM evento `mission.closed` (id = sha(mission)) com aprendizado + decisões; `memory.learning` sai a cada escrita de aprendizado.
   O contrato T-08.35(6) "off/squad → nenhum evento" vira "só off" por causa de P-24.
8. **Coletor em fatias de ≤ 15 ms** (uma transação por fatia), para a rajada de 500 eventos não gerar tarefa > 50 ms (P-37).
9. Redação: palavras-chave de segredo em fronteira de palavra (`author`, `tokens`, `keyboard`, `monkey` não casam; `apiKey`, `APIKEY`, `API_KEY`, `Authorization: Bearer x` casam).

## Pedidos ao coordenador (o que ligar)

1. **Contratos/IPC:** adicionar em `ipc.ts` os canais `memoria:*` da fase-08 (`estado`, `config_gravar`, `listar`, `esquecer`, `esquecer_pane`, `purgar`, `exportar`,
   `brief_previa`, `restaurar`, `preferencias_listar|gravar|remover`) e mais: `memoria:missao_config` `{mission_id, ativa: boolean|null}` (chave por Missão, P-21) e
   `config_gravar` com `squad`, `teto_mb`, `embedding_modelo`. Tipos prontos em `src/compartilhado/memoria.ts` (escopo `squad`, modo `squad`, `EstadoMemoriaApp`). Todos os
   handlers são `servico.*` (`listar`, `estado`, `gravarConfig`, `esquecer`, `esquecerPane`, `purgar`, `exportar`, `briefPrevia`, `preferencias.*`, `restaurador(portas).restaurarPane`);
   `exportar` devolve o objeto — o main abre `dialog.showSaveDialog` e grava atômico. `05-CONTRATOS.md`: tabelas `memoria_*`/`ux_pane_respawn_vivo`, eventos `memory.*`, nota "a memória não grava no repositório".
2. **MCP:** registrar `memory_write|memory_search|memory_checkpoint|memory_brief|memory_forget` chamando `servico.memory_*(paneIdDoToken, argsCrus)` (async só o `memory_search`); erros
   `MemoriaErro.codigo` mapeiam 1:1 (`memory_disabled`, `too_large`, `invalid_argument`, `unauthorized`, `not_found`; `limit_reached`/`rate_limited` → `rule_violation`). Matriz em
   `catalogo.ts`: piloto = 5; worker = `memory_write` + `memory_search`; Pane livre/solo = 5; **squad passa a TER memória (P-24)**: piloto 5, workers 2 (a regra "squad sem `memory_*`" cai);
   `off` = nenhuma. O token continua só com `pane_id`; o núcleo re-resolve modo/Missão/linhagem a cada chamada.
3. **Fechar Pane:** em `repos/pane.ts#encerrar(id, motivo, aoEncerrar?)` chamar `aoEncerrar(tx, pane)` dentro da transação, depois do `UPDATE pane`;
   no main: `const aoEncerrar = criarAoEncerrar({ porta, scrubber })` (de `memoria/fechamento.ts`) e passá-lo.
4. **Restore:** `servicoPanes.respawn(paneId, { contexto: { brief }, prompt_inicial })` + `restaurador({ respawn, podeRetomar, memoxInstalado, promptAnterior, aviso, emitir })`.
   Nunca persistir argv/prompt. O índice único `ux_pane_respawn_vivo` já protege contra duplicata (o restaurador trata a violação).
5. **Piloto/hooks:** `EntradaComando.brief`/`pacote` ← `servico.briefPrevia`/`servico.pacoteDaMissao(paneId, "piloto"|"worker")` (`markdown`, `vazio`); `{{CONTEXTO_MEMORIA}}` nos prompts v2;
   `mission_complete` devolve `aviso: "no_learning_recorded"` se `!servico.missaoTemAprendizado(missionId)`; no fechamento da Missão o coletor já chama `ciclo.aoFecharMissao`
   (passe `servico.coletor(barramento)` — assina `handoff.submitted`, `pane.closed`, `task.updated`, `method.changed`, `mission.closed`); P-25: depois dela chame `reindexarMemox(raiz)`.
6. **Boot (onda 2):** `garantirFts(banco)`; `servico.ciclo.executarEmOcioso({ ocioso })` em ocioso (sem flood de PTY e 2 s sem digitação); `servico.indexarVetoresPendentes()` só se houver provedor;
   `porta: conhecimentoNulo` até a Fase 15 (ela injeta `criarPortaEnfileirada(consumidorReal)`; `TABELA_EVENTOS` tem tipo → chave natural → tags).
7. **Regra da Fase 15 (consultar antes de implementar):** `servico.consultaPrevia(paneId, descricao)` devolve `{estado, sinais, markdown}` (envelope de dado, ≤ 2 000 chars, sempre utilizável);
   a Fase 15 pode somá-la ao briefing enquanto não tem o RAG.
8. **Diagnóstico (T-08.20):** `servico.metricas.instantaneo()` (só contadores).
9. `AGENTS.md`/`06-FASES.md`: registrar D-46..D-54 + os ajustes P-21..P-25; `package.json` intacto.
