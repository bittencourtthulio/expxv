# Fase 18 · ONDA 1 (núcleo puro): pedidos ao coordenador

Escopo entregue: `src/nucleo/agil/**` (+ testes), `src/compartilhado/agil.ts` (tipos novos), `tests/fixtures/agil/**`, `tests/perf/agil.perf.ts`.
Nada de migration, IPC, main, preload, renderer, catálogo/portas do MCP nem biblioteca SVG. O núcleo fala com repositórios por **portas síncronas** (`Colecao<T>` em `repos.ts`,
implementação em memória em `memoria.ts`) e com as outras fases por **portas assíncronas** (`portas.ts`, todas com `Indisponivel*`).

## 1. Tabelas a especificar na migration (0009 ou a próxima livre; serializada pelo coordenador)

Valem as tabelas de `fase-18-gestao-agil.md` (§ Modelo de dados) **com os ajustes abaixo**, que o núcleo já assume. Tipos: ids ULID com prefixo; momentos UTC ISO; datas de sprint `AAAA-MM-DD`.

| Tabela | Ajuste em relação ao plano |
|---|---|
| `agil_item` | + `orfao INTEGER NOT NULL DEFAULT 0` (task sumiu do disco; histórico preservado); + `resumo_cliente_origem TEXT CHECK (resumo_cliente_origem = 'humano')` (NULL sem resumo); `origem_ref_json` guarda objeto (`{proposto_por:"agente"}`, `{oc_id}`, `{retro_acao_id}`) |
| `agil_fato_task` | + `titulo TEXT NOT NULL`, `fase TEXT`, `depende_de_json TEXT NOT NULL DEFAULT '[]'`, `criterio_aceite TEXT`, `tipo_task TEXT`, `reabertas_em_json TEXT NOT NULL DEFAULT '[]'`, `retrabalho_ms INTEGER`, `intervalos_json TEXT NOT NULL DEFAULT '[]'` (pares `[início, fim\|null]`, base do WIP), `primeiro_evento_em TEXT`, `declarados_json TEXT NOT NULL` (`{integracao,funcional,regressao}`); `concluida_ts_precisa`, `tdd_primeiro`, `vermelho_antes` aceitam NULL (desconhecido); `qa_reprovacoes` é derivado e regravado a cada sincronização |
| `agil_capacidade` | `pontos REAL` **NULL** (sem base nunca é 0) |
| `agil_retro_acao` | + `vencida_notificada INTEGER NOT NULL DEFAULT 0` (`acao_retro.vencida` uma vez) |
| `agil_retrabalho_task` | `situacao` aceita NULL (task ainda não concluída e sem evento); `eventos_defeito` já inclui a marcação manual `retrabalho` |
| `agil_erro_estimativa` | `razao` e `ref_ms_por_ponto` NULL permitidos (categoria < 5 amostras); `observado_ms` NULL permitido |
| **novas** `agil_demo` | `(sprint_id, item_id, resultado CHECK IN ('aceito','ajustar','rejeitado'), nota TEXT, em TEXT, PRIMARY KEY(sprint_id,item_id))` (resultado da demo no Review) |
| **novas** `agil_evento` | barramento persistido para idempotência: `(seq INTEGER PRIMARY KEY, tipo, workspace_id, sprint_id, trabalho_id, task_ref, pontos REAL, duracao_observada_ms INTEGER, tokens INTEGER, quando, dados_json)`; índice `(tipo, sprint_id)` (checagem "`sprint.fechada` já publicada") |
| **novas** `agil_auditoria` | `(seq INTEGER PRIMARY KEY, acao, ator CHECK IN ('humano','agente','sistema'), workspace_id, alvo, motivo TEXT, quando)`; só texto humano já **redigido** (`redigirSegredos`) |
| **novas** `agil_chamada_ia` | `(workspace_id, dia, n, PRIMARY KEY(workspace_id,dia))` (teto diário de chamadas do estimador) |
| `agil_versao_trabalho` | opcional: a `versao_origem` por `(workspace_id, trabalho_id)` pode ser derivada de `agil_fato_task.versao_origem` (todas as linhas de um trabalho carregam a mesma) |

Mapeamento `BancoAgil` (repos.ts) → tabela, 1:1 pelo nome: `configs`→`agil_config` (chave workspace), `itens`, `epicos`, `estimativas`, `classificacoes`, `sprints`, `sprintItens` (chave `sprint|item`), `membros` (+ aliases em `agil_membro_alias`),
`fatos` (chave `ws|trabalho|ref`), `versoes`, `eventosRetrabalho`, `retrabalhoTasks`, `cerimonias`, `retroItens`, `retroAcoes`, `erros`, `snapshots`, `dodResultados`, `demos`, `eventos`, `auditoria`, `chamadasIa`.
`transacao(fn)` = `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` (o núcleo é síncrono, como o `node:sqlite`). Tabela de checklists manuais (`agil_checklist`) segue o plano: o núcleo recebe as marcas manuais como `Map` em `avaliarChecklist`.
Valores nunca são mutados no lugar: o adaptador pode assumir `set` de objeto novo.

## 2. Ligação (main/IPC/MCP) que o coordenador deve fazer

1. **PortaMetodo** (main, sobre o índice do método): para cada trabalho, `montarFonte(workspaceId, trabalho, rastro, { qa?: Artefato, qaEmitidoEm?, entrega?: Artefato })` (`fatos/fonte.ts`) devolve a `FonteTrabalho` (calcula `versao_origem`). `qaDeArtefato`/`commitsDeEntrega` leem `achados[]` e `commits[]` do frontmatter de QA.md/ENTREGA.md de forma tolerante. Os `kind` `fechamento|entrega|estimativa|estimativa_historico` **já existem** em `parser/kinds.ts`. `historicoSprintx` = `dados` do `HISTORICO.md` (alimenta `lerHistoricoSprintx`). Ocorrências runx: `OcorrenciaRunx` (`regressao_de`, `tipo`, `aberta_em`).
2. **Onda 2 do boot:** `criarAgil({ portas, banco, relogio })` (`agil.ts`) sob demanda; nada roda no boot. `sincronizar` é assíncrona e pura sobre portas: **5 000 tasks levam ~75 ms de uma vez** (P-180a), acima dos 50 ms do main — rode em worker **ou** passe `fontes` em lotes de ≤ 25 trabalhos entre `setImmediate`. A reavaliação do retrabalho (`processarRetrabalho`) custa ~24 ms na varredura completa.
3. **Previsão Monte Carlo:** `preverTermino` é função pura (~30 ms para 10 000 × 500); chamar num worker e passar o resultado em `DepsPainel.previsao`. Sem ele o painel devolve `calculando`/`dados_insuficientes`. Não criei `previsao-worker.ts` (entrada de `worker_threads` é do coordenador).
4. **IPC `agil:*` → função do núcleo:** `painel`→`criarPainelComCache(...).obter` · `backlog_listar`→`listarBacklog` · `item_*`→`backlog/itens.ts` (`criarItem|atualizarItem|descartarItem`, épicos `gravarEpico|apagarEpico`) · `item_reordenar`→`reordenar` (devolve `ordem` e, raramente, `rebalanceados` para gravar em lote) · `item_promover`→`comandoDePromocao` (só gera o comando; `metodo:disparar` é do chamador) · `item_vincular`→`vincularItem` · `estimar`→`a.estimar` (retorna `job` com `concluido: Promise`) · `estimativa_gravar|classificacao_gravar|aceitar_lote`→`gravarEstimativaHumana|gravarClassificacaoHumana|aceitarEmLote` · `sprint_*`→`sprint/ciclo.ts` e `fecharSprint` · `planejamento_sugerir`→`candidatosDoBacklog`+`sugerirCompromisso` (+`capacidadeMembro`) · `daily_gerar`→`gerarDaily` · `review_*`→`montarReview|registrarDemo|devolverAoBacklog` · `retro_*`→`cerimonias/retro.ts` + `calcularInsights` · `retrabalho_listar`→`listarRetrabalho` · `retrabalho_marcar`→`marcarRetrabalho` (passar `ator:"humano"` só a partir do IPC; a tool MCP passa `"agente"` e recebe `human_only`) · `praticas`→`metricasXp`/`avaliarChecklist`/`desperdiciosLean` · `exportar`→`exportar` com `escrever` = gravação em `<userData>/agil/exportacoes/` (o núcleo só formata e escolhe nome seguro).
5. **MCP (`mcp/tools/agil.ts`, `mcp/erros.ts`):** `backlog_list`→`listarBacklog`; `backlog_get`→item+`historicoEstimativas`; `backlog_propose`→`criarItem({origem_ref:{proposto_por:"agente"}})`; `estimate_get`→`estimativaAtiva|classificacaoAtiva|historicoEstimativas`; `estimate_propose`→`proporEstimativa({motor:"agente"})` (nunca sobrescreve decisão humana; devolve `aplicada:false, motivo:"humano_prevalece"`); `sprint_status`→`statusDaSprint`; `rework_list`→`listarRetrabalho` (já sem o motivo humano nem código); `metrics_get`→`metricaPorNome`. Subcode novo `human_only` = `ErroAgil.subcode` (`code: "rule_violation"`).
6. **Eventos (Fase 19/20):** `criarPublicador(banco, PortaAlertas)`; `sprint.iniciada`/`sprint.fechada` já saem de `iniciarSprint`/`fecharSprint` quando o `pub` é injetado (a fábrica injeta). Falta o gancho periódico **depois de cada sincronização**: `detectarAtrasadas`+`eventosDeAtraso` (guardar `abertos` entre rodadas), `verificarWip`+`limitesWip(ws, config, PortaBoard)`, `sprintEmRisco` (série de cores do indicador `progresso` por dia útil) e `publicarAcoesVencidas`. `retrabalho.detectado`: publicar com os `novos` devolvidos por `processarRetrabalho`.
7. **Orçamentos** (`npx vitest run --config vitest.e2e.config.mts tests/perf/agil.perf.ts`; grava em `docs/ade/perf/ultimo.json` como os demais): P-180a/b, P-181a/b, P-185a/b/c/d, P-186a/b, P-187, P-188a/b, P-190a/b. **Não medidos aqui** (dependem de main/UI): P-182, P-183, P-184, P-189 e o "main nunca > 50 ms" em processo real. Contra SQLite real, P-181a e P-190 precisam ser remedidos (aqui o banco é em memória).

## 3. Decisões tomadas no núcleo (registrar em `01-DECISOES.md` se o coordenador concordar; numeração sugerida D-180a.. dentro da faixa da Fase 18)

- **Persistência por portas síncronas** (`Colecao<T>`, `transacao`), não por interfaces de repositório por tabela: o adaptador SQLite implementa 20 coleções com a mesma forma.
- **Ação humana = parâmetro `ator`**: `marcarRetrabalho`, `iniciarSprint`, `cancelarSprint`, `fecharSprint`, `registrarDemo` recusam `ator:"agente"` com `human_only`. O IPC/MCP decide o `ator`; o núcleo nunca presume humano.
- **Lead time**: início = entrada na sprint ágil; senão `criado_em` **só para item que não é espelho**; senão o primeiro evento do trabalho. O `criado_em` do espelho é o instante da sincronização e distorceria a métrica (o plano dizia `criado_em` genérico).
- **Janela de retrabalho**: referências (fechamento da sprint, veredito do QA) **anteriores a `concluida_em`** não encerram a janela (não observaram nada): vale o teto de 14 dias.
- **`ir_max`** soma só tasks `primeira` com evento **forte e pendente**; evento fraco (`regra_repetida`) nunca entra, nem no `ir_max`.
- **Escopo vira evento**: commit referenciando a task depois de concluída com prefixo `feat` é gravado como `natureza: "escopo"` (contador `escopo_eventos`, fora do índice de defeito), em vez de ignorado.
- **Concluído para o fechamento** = `concluida_em` não nulo nos fatos (o disco manda); `validada` = QA aprovado. Fechamento automático (`fechar_automatico`, padrão desligado) exige tudo `validada`.
- **Velocidade**: média móvel de 3 só existe a partir da 3ª sprint (antes, `null`); "de primeira" é `null` quando nenhuma entrega tem situação conhecida.
- **Planejamento**: guloso pela ordem do backlog, **pula** o que não cabe e continua (preenche melhor a capacidade); item com dependência na própria seleção é puxado em ordem topológica.
- **Atrasada** (`tarefa.atrasada`): P85 do ciclo da **mesma categoria** (≥ 8 amostras), senão do workspace (≥ 8), senão "sem base" e não dispara.
- **Dias em UTC**: buckets de burn/throughput/CFD usam o dia UTC do instante; a conversão para o fuso do usuário é da UI (decisão a revisitar se o fechamento de dia ficar visivelmente deslocado para o Brasil).
- **Risco**: o fator `tamanho_grande` (peso 1) entra quando a estimativa é ≥ 8 pontos (o plano o listava na tabela sem a condição de entrada).
- **Heurística**: degraus sobre a **escala** (não somas de pontos), base por `tipo_task`; teto 13 vale para escalas numéricas (não aplicado à escala `horas`).
- **Confiança heurística** limitada a 0,6; confiança final da IA = confiança do LLM × qualidade da evidência (0,4 a 1,0).
- **IA nunca é chamada** sem `PortaConsentimento.estimativaPorIa(ws) === true` (UI explica que o texto das tasks vai ao provedor da CLI), nem sem perfil resolvido, nem acima do teto diário; o texto da task é saneado (sem código, caminho absoluto, arquivo de ambiente, segredo) e entra só no envelope JSON.
- **Exportação**: proteção contra injeção de fórmula prefixa `'` em células iniciadas por `= + - @ TAB CR`; nome de arquivo restrito a `[A-Za-z0-9._-]`.

## 4. Pendências e riscos

- **Não feito (fora da minha área):** T-18.32/T-18.33 (biblioteca SVG e os 16 gráficos), T-18.01/02 (contratos IPC, migration, repos SQLite), T-18.37 (tools MCP), T-18.40..45 (UI, e2e, auditoria final).
  O núcleo já entrega os dados de todos os 16 gráficos em `montarPainel` (tipo `PainelAgil`).
- **Tipos de contrato novos** estão só em `src/compartilhado/agil.ts` (arquivo novo): `ipc.ts` e o preload continuam por conta do coordenador; `ItemResumo`, `FiltrosBacklog`, `PainelAgil`, `EventoAgil` já estão lá.
- **Ligações humanas de defeito escapado** (`ligacoesHumanas` em `calcularDefeitosEscapados`) precisam de um lugar para persistir (sugestão: `agil_retrabalho_evento` com `fonte='manual'` ou coluna em `agil_item`).
- `bloqueios_abertos` e `par_membro_id` (XP) entram como parâmetros (`DepsPainel.bloqueios_abertos`, `EntradaXp.com_par`): o main precisa ler `Trabalho.bloqueios` e os itens com par.
- Estimativa para item **sem fato** (origem `ade`) usa só título/descrição/critérios; `arquivos`/`depende_de` ficam vazios (confiança menor), nunca inventados.
- O teste de varredura de código acusa qualquer import de `fs`, rede, `child_process`, `worker_threads` ou `electron` em `src/nucleo/agil` (não-teste): manter assim; E/S é do chamador.
