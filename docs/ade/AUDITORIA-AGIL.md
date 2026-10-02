# Auditoria da gestão ágil (Fase 18, T-18.45) — onda 2 (ligação + UI)

Auditoria própria, feita com os testes na mão: `src/main/agil-auditoria.test.ts` (15), `src/nucleo/agil/auditoria.test.ts` (18), `src/main/ipc/agil.test.ts` (7),
`src/nucleo/mcp/tools-agil.test.ts` (13), `src/main/agil-servico.test.ts` (20), `src/main/agil-ia.test.ts` (6), `src/main/agil-metodo.test.ts` (9) e
`src/nucleo/banco/repos/agil.test.ts` (12). Escopo pedido: IA recebendo dado sensível, ação humana forjada por agente, cálculo manipulável e vazamento entre workspaces.
Cada achado tem um teste que o prende (e os de vazamento foram provados vermelhos com a correção revertida).

## Achados e correções

| # | Gravidade | Achado | Correção | Teste |
|---|---|---|---|---|
| G-01 | **alta** | **Retrabalho de um workspace sumia por causa de outro:** a `chave_dedupe` (`qa:<trabalho>:<task>:<id>`) não levava o workspace e a deduplicação olhava a tabela inteira. Dois clones do mesmo repositório (mesmos nomes de trabalho e task) faziam o segundo workspace perder eventos e o índice IR/FTR dele sair errado. | `registrarDeteccoes` dedupe por `workspace_id + chave`; na migration, `UNIQUE (workspace_id, chave_dedupe)` no lugar do `UNIQUE (chave_dedupe)`. | auditoria (vazamento 1) |
| G-02 | **alta** | **Painel de A somava o erro de estimativa de B:** `erro_estimativa` agregava `banco.erros.valores()` de todos os workspaces (vazamento de métrica e de ids de item). | `montarPainel` filtra as linhas pelos itens do workspace. | auditoria (vazamento 2) |
| G-03 | **alta** | **IA recebia segredo que o saneamento não via:** JWT, chave privada PEM, URL com `usuário:senha@`, `github_pat_`, `glpat-`, `AIza…`, `ya29…`, `sk_live_`; e caminhos absolutos fora de `/Users` e `/home` (`/workspace`, `/srv`, `/Documents`…). | `redigirSegredos` e `sanearTexto` ampliados (também protegem a auditoria e as notas); lista de raízes absolutas ampliada. | `auditoria.test.ts` (15 segredos, caminhos, envelope), `agil-servico.test.ts` (prompt capturado) |
| G-04 | média | **Calibração misturava workspaces:** a confiança da IA (`n_calibracao`) e `recalcularErros` usavam todas as linhas de erro do banco; e, em produção, nada gravava a linha de erro (T-18.18 sem ligação). | `recalcularErros(banco, minimo, escopo)` só mexe nas linhas do workspace e só regrava o que mudou; o serviço grava a linha de cada task concluída e recalcula em fatias depois de cada sincronização. | auditoria (vazamento 2), `agil-volume.test.ts` |
| G-05 | média | **Alias de agente único no banco inteiro** (`PRIMARY KEY (tipo, valor)`): o mesmo nome de agente em dois workspaces colidia (e a atribuição de dono do retrabalho poderia cruzar). | `PRIMARY KEY (membro_id, tipo, valor)`; atribuição é por workspace. | `repos/agil.test.ts`, auditoria (alias) |
| G-06 | média | **O dono do dado vinha da porta:** `FonteTrabalho.workspace_id` mandava na gravação. Um adaptador com erro gravaria fatos no workspace errado (e eles sumiriam do painel certo). | A sincronização força `workspace_id` do pedido em toda fonte. | `agil.test.ts`, auditoria |
| G-07 | média | **Agente podia reescrever o passado:** reestimar item já concluído/descartado/de sprint encerrada mudava o "concluído em pontos" e a calibração; versões e propostas sem teto (poluição do backlog e do banco). | `estimate_propose` recusa item concluído, órfão, descartado ou de sprint encerrada (`rule_violation`); proposta idêntica não cria versão; teto de 30 versões por item, 30 propostas de item por hora e 300 abertas por workspace (`limit_reached`). | auditoria (cálculo 1 a 3) |
| G-08 | média | **Escrita pela metade:** `estimate_propose` gravava a estimativa antes de validar categoria/risco; recusa deixava versão órfã. | Valida tudo antes e grava estimativa + classificação numa transação. | `agil-servico.test.ts` |
| G-09 | baixa | **Defesa em profundidade:** o serviço aceitava `pontos` NaN, negativo ou enorme (só o validador do IPC barrava). | O serviço valida também (finito, > 0, ≤ 1000). | auditoria (cálculo 4) |
| G-10 | baixa | **`state` forjado:** `estimate_propose` com `state: "aceita"` poderia ser lido como decisão. | Recusado como `rule_violation/human_only` na tool e na porta; qualquer `estado/ator/origem/motor` nos argumentos é descartado. | `tools-agil.test.ts`, `agil-servico.test.ts` |

## Checklist (sem achado ALTA aberto)

| Item | Resultado | Onde está provado |
|---|---|---|
| IA só com consentimento explícito do workspace; revogável; por workspace; auditado | ok (`agil.consentimento_ia.<ws>` em `config`; linhas `ia.consentir/ia.revogar` em `agil_auditoria`) | `agil-servico.test.ts`, `agil-ia.test.ts`, auditoria |
| Prompt sem código, caminho absoluto, arquivo de ambiente nem segredo; texto da task só dentro do envelope de dado; saída por esquema; falha = fica a heurística | ok | `auditoria.test.ts`, `agil-servico.test.ts` (prompt capturado, injeção, saída inválida) |
| CLI da IA: argv separado, sem shell, sem ferramentas, pasta neutra, ambiente seguro, saída ≤ 1 MB, timeout com kill, assinatura do usuário | ok | `agil-ia.test.ts` |
| Ação humana só pelos canais `agil:*` (grava `ator: "humano"`); a porta do MCP nunca passa ator, nem importa o núcleo ágil | ok (varredura de fonte) | auditoria (humano 1 e 2) |
| Núcleo recusa iniciar/cancelar/fechar sprint, marcar retrabalho e registrar demo por ator agente, sem alterar o banco | ok | auditoria (humano 3) |
| O agente não escreve resumo para o cliente, WSJF, dono, visibilidade, estado do item nem changelog | ok | auditoria (humano 4) |
| Todo id citado (item, sprint, épico, membro, cerimônia, ação) é conferido contra o `workspace_id` do pedido; a porta do MCP só enxerga o workspace do token | ok (mais de 20 chamadas cruzadas recusadas, no serviço e na porta do MCP) | `agil.test.ts` (isolamento), `agil-servico.test.ts`, `tools-agil.test.ts` |
| Dados de A idênticos com ou sem B sincronizado (mesmos nomes de trabalho): painel, backlog, retrabalho, práticas, exportação | ok | auditoria (vazamento 1) |
| Nenhum canal aceita caminho absoluto, URL, campo extra, `ator`, `caminho`, `userData`; config só com chaves conhecidas, sem controle, ≤ 64 KB | ok | `ipc/agil.test.ts` |
| Erro ao renderer: só `[codigo/subcodigo] mensagem` do núcleo; qualquer outro vira texto genérico (detalhe só no log do main) | ok | `ipc/agil.test.ts` |
| Zero escrita em `docs/**`: o adaptador do método só LÊ; a única escrita é a exportação em `<userData>/agil/exportacoes/` (nome seguro, atômica, 0600, referência relativa) | ok | auditoria (escrita), `agil-metodo.test.ts` |
| Exportação CSV com proteção contra fórmula; só do próprio workspace | ok | `agil-servico.test.ts`, auditoria |
| SQLite: cache coerente após erro (rollback descarta o cache); reabrir recompõe tudo; painel idêntico ao da memória (40 sprints) | ok | `repos/agil.test.ts` |
| Nome do produto nunca literal; varredura de código e de marca | ok | `tests/varredura-marca.test.ts` |

## Orçamentos medidos (SQLite real em memória, 200 trabalhos × 25 tasks = 5 000 tasks)

| Medida | Resultado | Orçamento |
|---|---|---|
| Sincronização completa (13 lotes de ≤ 25 trabalhos / ≤ 400 tasks, `setImmediate` entre eles) | ~2,1 a 3,2 s no total; **maior lote 27 a 48 ms** (sync 24 a 37, retrabalho 8 a 11) | main nunca > 50 ms por trecho |
| Heurística imediata dos itens sem estimativa (lotes de 25) | maior lote 26 a 52 ms (máquina carregada) | idem |
| Painel completo recalculado (5 000 tasks) | ~25 ms morno; ~50 a 56 ms na primeira chamada fria (JIT); cache ~1 ms | P-181b ≤ 400 ms |
| Lista do backlog (página de 100) | 10 a 14 ms | P-184 |
| Sincronização sem mudança | 11 a 13 ms (nenhum lote) | P-180 |

As medidas vêm de `src/main/agil-volume.test.ts` (limites folgados para CI); `metricas()` do serviço expõe o maior trecho de cada etapa para o diagnóstico copiável.

## Risco residual e decisões para o coordenador

- **Autorrelato do rastro:** os fatos vêm do rastro (`docs/eventos/*.jsonl`) e de `QA.md`/`ENTREGA.md`, que os agentes escrevem. É a premissa da fase (o disco vence o rastro em status), mas um agente que forje evento pode mexer em duração e em reabertura. Mitigações existentes: `tem_rastro` explícito, `indeterminado` sem fonte, retrabalho confirmado por humano. Fora do alcance desta fase.
- **Painel no main:** o recálculo do painel (e do snapshot do dia) roda no thread do main (~25 ms morno, ~56 ms frio com 5 000 tasks) e o Monte Carlo roda inline até 20 000 iterações (~3 ms para amostras típicas). O worker dedicado pedido no plano exige novo arquivo em `electron-builder.yml` (asarUnpack) e teste de pacote; ficou como evolução se o orçamento de 50 ms for medido acima em máquina de usuário.
- **Ligação da Fase 19/20:** os eventos de domínio saem no barramento com o nome do tipo (`sprint.iniciada`, `sprint.fechada`, `sprint.em_risco`, `tarefa.atrasada`, `retrabalho.detectado`, `wip.excedido`, `acao_retro.vencida`, `agil.estimativa_pronta`) e também ficam em `agil_evento` (idempotência de `sprint.fechada`). `retrabalho.detectado` só sai para evento forte, não-ruído e dos últimos 3 dias (o histórico da primeira sincronização não inunda o canal). Depois de reiniciar, o que já estava atrasado é semeado sem republicar.
- **Pendências para `STATUS.md`, `01-DECISOES.md` e `PENDENCIAS-DO-DONO.md` (coordenador):** T-18.01/02/07/32..34/37..45 entregues nesta onda; numerar as decisões D-180a.. do pedido da onda 1; a ordem das migrations ficou `0010-maestro`, `0011-agil`.
- **E2E:** `tests/agil.e2e.test.ts` está escrito e type-checado, mas não foi executado (exige `npm run build`; há `npm run dev` do dono ativo).
