# Fase 18 — Gestão ágil (Scrum, XP, Lean) para software house

**Pedido do dono (literal):** *"o foco do projeto é a área de desenvolvimento, software house: o sistema traz recursos e habilidades de estruturas de metodologias ágeis —
Scrum, XP, Lean e tudo mais, boas práticas — relatórios, dashboards, estruturas para a daily, para a retrospectiva da sprint, montagem de sprint, gestão de backlog.
STORY POINTS: configuração de story points por tarefa; categorização, classificação, grau de risco e criticidade de cada atividade — a gente tem configurações para determinar,
mas já vem pré-configurado para IA: ela pega cada tarefa e define story points, classificação, categorização e grau de risco; marcar se teve RETRABALHO ou não dentro de uma
tarefa, se foi feita de primeira, para medir o ÍNDICE DE RETRABALHO; mostrar os gráficos básicos de entrega de um time de desenvolvimento, alguns gráficos que fazem parte da
estrutura ágil."* Prioridade ALTA. Planejada junto com a Fase 19 (relatórios), que **consome** o que esta fase produz (métricas, retrabalho, resumo para o cliente).

**Valor para uma software house.** (1) Planejar sprint com capacidade real por pessoa **e por agente**, não por chute. (2) Estimar sem fricção: toda task do método já chega com
pontos, categoria, risco e criticidade **sugeridos** (heurística na hora, IA em segundo plano) e o humano só ajusta. (3) Medir qualidade com um número honesto — **índice de
retrabalho** e *first-time-right* derivados do rastro, do QA e do git, nunca de autorrelato. (4) Daily e retrospectiva prontas dos fatos (ontem/hoje/bloqueios/atrasos; retrabalho,
QA reprovado, estimativas erradas), copiáveis. (5) Dashboards padrão da indústria (burndown, burnup, velocidade, CFD, cycle/lead time, throughput, WIP, previsão) em SVG leve.
(6) Prestação de contas ao cliente: ao fechar a sprint, a Fase 19 gera os relatórios a partir do que aqui já está medido.

**Base lida:** `00-LEIA-ME.md`, `PILOTO-AUTOMATICO.md`, `06-FASES.md`, `01-DECISOES.md` (D-04, D-19, D-21, D-32, D-88, D-89, D-140), `03-ORCAMENTOS-DESEMPENHO.md`, `05-CONTRATOS.md`,
`04-UI-UX.md`, `base/F-metodo-expxdev.md` (tasks, rastro, vereditos, ENTREGA, HISTORICO), `fase-03`, `fase-06`, `fase-08`, `fase-09` (`resolverPerfil`, `PerfilAgente`), `fase-10`
(custo por card, `montarBoard`, Kanban/WIP vive no board), `fase-15` (RAG, `cli-headless`), skills reais `sprintx` (F3.5 estimativa, `HISTORICO.md`, `FECHAMENTO.md`), `runx`, `mergex`
(`ENTREGA.md`), e o código: `src/nucleo/{metodo,missoes,banco,mcp,orquestracao,vcs}`, `src/renderer/telas/{metodo,missoes,inicio}`, `tests/fixtures/metodo/gerar.ts`.
Planos 14, 16, 17 e 20 ainda não existem em disco: esta fase fala com eles **por portas** (ver Arquitetura) com implementação nula, então roda e testa sozinha.

**Portão da fase** (todos obrigatórios):
- `npm run verificar` verde (tipos, testes, regra de marca, P-08, varredura de cor literal fora de `tokens.css`, varredura de privacidade T-18.45).
- **Fixture sintética** de projeto Expx com 40 sprints de histórico (`tests/fixtures/agil/gerar.ts`, sobre `tests/fixtures/metodo/gerar.ts`): todas as métricas batem com os
  valores esperados **calculados à mão** no teste (burndown, velocidade, percentis, FTR, IR, erro de estimativa).
- E2E no Electron real (T-18.45): abrir Ágil → sincronizar → backlog com 3 itens → estimativa heurística imediata → LLM falso responde e **não sobrescreve** ajuste humano → planejar sprint →
  daily gerada e copiada → marcar retrabalho → fechar sprint (evento `sprint.fechada` observado) → retro com ação virando item → painel com os 16 gráficos sem erro de console.
- `npm run perf`: P-180 a P-190 verdes e P-01..P-22/P-100..P-117 sem piora.
- Auditoria (T-18.45): **zero escrita em `docs/**`** (teste com `fs` espionado), nenhuma métrica lê campo de autorrelato, nenhum conteúdo de código em prompt de IA nem em log, tools MCP
  não conseguem confirmar/descartar retrabalho nem travar estimativa humana.
- Registro em `STATUS.md`, `05-CONTRATOS.md`, `04-UI-UX.md`, `AGENTS.md` pelo coordenador.

## Princípios

1. **Leveza e velocidade.** Fatos do método são **materializados** (`agil_fato_task`) em worker, de forma incremental; métricas saem de consulta/snapshot, não de recomputar tudo; gráficos
   decimam pontos; nada síncrono no main depois do boot; IA **fora do caminho crítico** (a UI sempre mostra a heurística na hora).
2. **A IA SUGERE, o humano decide.** Toda estimativa/classificação automática é **editável**, tem **origem** (`ia|humano`), **confiança** (0..1) e fatores explicados. Humano nunca é
   sobrescrito; reestimar gera **nova versão** (append-only) e só vale se a atual não for `travada`/`humano`.
3. **Fatos, nunca autorrelato.** Métricas vêm do rastro (`docs/eventos/*.jsonl`), do estado em disco (`tasks.md`, `QA.md`, `ENTREGA.md`), do git (Fase 6) e do banco. Nenhuma tool MCP
   recebe campo de pontos reais, custo ou "feito de primeira" vindo de agente. O que o humano marca é **origem `humano`** e fica auditável.
4. **Desconhecido nunca vira zero.** Sem duração → `null` ("—"); sem custo → "custo desconhecido"/"≥"; item sem pontos → entra em "não estimados", fora da soma; task sem fonte de
   retrabalho → `indeterminado`, fora do denominador e contada à parte; sem histórico → "sem base" (nunca um valor inventado).
5. **Duração observada ≠ esforço.** Tempo de parede entre `task_iniciada` e `task_concluida` inclui pausas (F-§9). Rótulo fixo "duração observada"; **pontos medem esforço relativo**, horas do
   `HISTORICO.md` (`real`) são outra grandeza; a UI nunca converte ponto em prazo sem mostrar a base e a faixa.
6. **O método é dono do estado (D-04, D-19).** O ADE **lê** `docs/**` e o rastro e **não escreve** neles. Dados ágeis vivem em tabelas `agil_*` do `expxv.db`; exportação vai para
   `<userData>/agil/exportacoes/` (ou "Exportar para…" explícito, Fase 19). O disco vence o ADE em conflito de estado de task.
7. **Humanos continuam humanos (D-21).** Fechar sprint, confirmar/descartar retrabalho, aceitar estimativa em lote, assinar review: ações humanas. Agentes só **propõem** (`*_propose`).
8. **Nada sai da máquina** além do que a CLI do usuário já envia ao provedor dele (D-88): a IA recebe **texto estruturado da task e metadados** (nunca código), por CLI headless
   sem ferramentas; envelope e saneamento (Fase 15 `sanearFonte`); sem chamada em testes (CLI falsa).
9. **Compacto (D-32).** Uma linha de controles, tabelas densas, gráficos pequenos expansíveis; destaque azul; cor nunca é o único sinal.

## [DEC] Decisões desta fase (registrar em `01-DECISOES.md` como D-180..D-189)

> Numeração: o pedido indicava D-110 e P-100/P-120, mas **D-110..D-117 são da Fase 9, D-130..D-140 da Loja/regra geral, D-150..D-159 da Fase 20, D-160..D-170 da Fase 17, D-200..D-214 da Fase 14; P-100..P-117 são das Fases 9 e 10, P-140..P-149 da Fase 20, P-200..P-209 e P-230..P-233 da Fase 14, P-240..P-252 e P-270..P-279 da Fase 17** (planos escritos em paralelo). Usei **D-180..D-189** (Fase 18) e **D-190..D-199** (Fase 19), orçamentos **P-180..P-190** (Fase 18) e **P-290..P-302** (Fase 19), pendências **P-60..P-63** (Fase 18) e **P-64..P-67** (Fase 19).

| D | Decisão | Alternativa descartada · motivo |
|---|---|---|
| D-180 | **Dados ágeis em tabelas `agil_*` do `expxv.db`; ligação ao método só por ID** (`trabalho_id` + `task_ref` `T-NN.MM`; sprint do método = `sprint-NN`). Nada escrito em `docs/**`. Cada task do método vira **item espelho** automático (`origem='metodo'`, chave `(workspace_id, trabalho_id, task_ref)`), somente leitura quanto a estado/título. | Backlog em arquivos `docs/ágil/` · viola D-04 e cria 2ª fonte de verdade. |
| D-181 | **Sprint ágil (`agil_sprint`) ≠ `sprint-NN` do sprintx.** A sprint ágil é uma **iteração com datas, capacidade e meta**; contém itens de 0..N trabalhos do método. Fechar é **ação humana**; o ADE só **sugere** fechar quando todas as tasks de uma sprint ágil estão `concluida`. | Reaproveitar `sprint-NN` como sprint ágil · o método planeja por fase de implementação, não por cadência/capacidade. |
| D-182 | **Pontos = esforço relativo; escala configurável** (`fibonacci` 1-2-3-5-8-13-21 padrão; `camisetas` PP-P-M-G-GG; `horas`). Estimativa = `{valor, escala, origem, motor, confianca, fatores}` com **versões append-only**. A faixa `min–max h` do sprintx F3.5 é **insumo e comparação**, não é substituída. | Número único de horas · F3.5 proíbe número único e prazo. |
| D-183 | **"Feita de primeira" (definição operacional):** task `concluida` (disco) cuja **janela de observação** terminou **sem nenhum evento de retrabalho FORTE de natureza `defeito`**. Fortes: QA reprovado (achado alta/média) ligado à task; task reaberta (`concluida` → outro estado, ou `task_iniciada` após `task_concluida`); commit/PR de correção referenciando a task depois de `concluida_em`; regressão (ocorrência runx com `regressao_de` apontando o trabalho). Fraco (só sinaliza): `regra_violada` repetida (≥ 2, mesma regra, mesma task). Janela = de `concluida_em` até o maior entre (fechamento da sprint ágil, veredito do QA do trabalho), **teto `janela_retrabalho_dias` = 14**; antes disso `em_observacao`. Sem fonte alguma → `indeterminado`. Retrabalho de **escopo** (mudança de requisito) é registrado à parte e **não** entra no índice de defeito. | "Qualquer commit depois" · ruído enorme (typo, doc, escopo). |
| D-184 | **Índice de retrabalho em faixa honesta:** `ir` = (tasks com ≥ 1 evento forte `defeito`, automático certo ou confirmado por humano) ÷ (tasks avaliáveis) e `ir_max` = `ir` + eventos `pendente` (natureza ambígua). `first_time_right = 1 − ir`. Tasks `em_observacao`/`indeterminado` ficam fora do denominador e aparecem em contador próprio. | Um número único · esconde ambiguidade. |
| D-185 | **Estimador em 3 camadas:** (1) **heurística determinística** instantânea (sempre disponível); (2) **similaridade** (RAG Fase 15, tarefas parecidas com pontos e duração observada) e **calibração** por mediana (sprintx `HISTORICO.md` + banco); (3) **IA** por `cli-headless` (D-89) com `PerfilAgente` resolvido por `resolverPerfil("agil","estimativa")` (faixa `rapido`), em lote ≤ 20 tasks, sem ferramentas, JSON validado por esquema. Falha/timeout/sem CLI → fica a heurística (`motor='heuristica'`). Pré-configurado **ligado** (`estimativa_modo='ia_sugere'`), conforme pedido e D-140. | IA obrigatória · quebra sem CLI e gasta cota. |
| D-186 | **Gráficos em SVG próprio** com **modelo de nós neutro** (`NoSvg`) e dois emissores: React (telas) e **string** (relatórios da Fase 19, sem React, no worker). Decimação para ≤ 600 elementos por série; tabela de dados equivalente (`<details>`) por gráfico; paleta por tokens `--grafico-1..6` + padrão (traço/marcador) além da cor. | Chart.js/D3/Recharts · peso (P-08) e dependência. |
| D-187 | **Portas** (`src/nucleo/agil/portas.ts`) para tudo que pertence a outras fases: `PortaMetodo`, `PortaCusto` (F10), `PortaBoard` (F10), `PortaRag` (F15), `PortaMapa` (F17), `PortaPerfil` (F9/14/16), `PortaHeadless` (F15/D-89), `PortaVcs`/`PortaForge` (F6), `PortaAlertas` (F20). Cada uma tem `Indisponivel` determinístico; a fase funciona e testa com elas. | Importar módulos futuros · acopla a ordem das fases. |
| D-188 | **Eventos de domínio em português do ponto de vista do ágil** para a Fase 20: `sprint.iniciada`, `sprint.fechada`, `sprint.em_risco`, `tarefa.atrasada`, `retrabalho.detectado`, `wip.excedido`, `acao_retro.vencida`; payload sempre com `pontos`, `duracao_observada_ms`, `tokens` (null quando desconhecido). "Atrasada" = `em_andamento` com idade acima do **P85 do ciclo** de tasks comparáveis (≥ 8 amostras; senão "sem base" e **não** dispara). | Prazo fixo por task · o método não tem data por task. |
| D-189 | **Membros** (`agil_membro`) são **rótulos** (pessoa ou agente) com *aliases* (nome de agente do rastro, `sessao`, e-mail de commit); capacidade em horas focadas/dia × fator de foco (humano) ou pontos/sprint = mediana das últimas 3 (agente). Não há login nem usuários no ADE. | Modelo de usuário/permissão · fora de escopo local. |

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`; P-100..P-117 são das Fases 9 e 10)

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-180 | Sincronização dos fatos (`agil_fato_task`) com 5 000 tasks em 200 trabalhos: inicial; incremental de 1 trabalho alterado | ≤ 1,5 s em worker (main nunca > 50 ms); ≤ 80 ms | `tests/perf/agil.perf.test.ts` + `gerarVolumeAgil` + monitor de event loop (P-12) |
| P-181 | **Dashboards** (`agil:painel`, todas as métricas) com 5 000 tasks e 40 sprints | **≤ 150 ms** com snapshot válido; ≤ 400 ms recomputando dos fatos (worker) | unidade com banco real (padrão P-14) + marca no main |
| P-182 | Tela Painel (16 gráficos): 1ª abertura; voltar à aba; DOM por gráfico/total; tooltip | ≤ 250 ms; p95 ≤ 50 ms (P-02); ≤ 1 500 / ≤ 8 000 nós; hover sem re-render | Playwright + `PerformanceObserver` + contagem de nós + contador de renders |
| P-183 | Chunk da tela Ágil e dos gráficos | ≤ 60 KB gz (gráficos em sub-chunk lazy ≤ 25 KB); JS inicial intacto (P-08) | script de tamanho no build |
| P-184 | Backlog com 5 000 itens: 1ª abertura; rolagem; reordenar (arrastar); persistir ordem | ≤ 200 ms; 60 fps com DOM ≤ 200 nós; reflexo ≤ 50 ms; gravação ≤ 20 ms | Playwright + contagem de nós + unidade com banco |
| P-185 | Estimador heurístico: 1 item; lote de 500 itens; **IA fora do caminho crítico** | ≤ 5 ms; ≤ 300 ms (worker); nenhuma ação de UI espera o LLM (job com timeout 90 s por lote de ≤ 20; main nunca > 50 ms) | unidade + CLI headless falsa lenta (3 s) com afirmação "UI responde em ≤ 50 ms" |
| P-186 | Retrabalho: reavaliar 1 task após evento; varredura completa de 5 000 tasks | ≤ 20 ms; ≤ 400 ms em worker | unidade com banco real |
| P-187 | Previsão Monte Carlo (10 000 simulações, 500 itens restantes) | ≤ 250 ms em worker; UI nunca bloqueia | worker + `longtask` |
| P-188 | Daily gerada dos fatos (sprint de 200 tasks) e planejamento sugerido | ≤ 100 ms | unidade |
| P-189 | Memória: caches do agil no main com 5 000 tasks; renderer da tela | ≤ 25 MB; ≤ 15 MB | `process.getProcessMemoryInfo` |
| P-190 | Snapshot diário (gravação) e consulta de série de 40 sprints | ≤ 30 ms; ≤ 10 ms | unidade com banco real |

Regras herdadas: `fs` assíncrono; listas virtualizadas acima de 100 itens; IPC coalescido (≤ 1 evento/300 ms); boot em duas ondas (agil sobe na onda 2, ocioso); observadores com debounce 300 ms.

## Arquitetura e pastas

```
src/compartilhado/
  agil.ts                    tipos de contrato (Item, Estimativa, Classificacao, Sprint, Cerimonia, Retro, EventoRetrabalho, Metricas*, PainelAgil, Filtros…)
  svg/{modelo.ts,emitir-string.ts,Svg.tsx,escalas.ts,decimar.ts}   NoSvg + emissores (React e string) + escalas/decimação puras (usado também pela Fase 19)
  ipc.ts                     + canais agil:* (T-18.01; só o coordenador edita)
src/nucleo/agil/
  portas.ts                  PortaMetodo, PortaCusto, PortaBoard, PortaRag, PortaMapa, PortaPerfil, PortaHeadless, PortaVcs, PortaForge, PortaAlertas + Indisponivel*
  agil.ts                    fábrica criarAgil(portas, banco, relogio) → serviços; relógio injetado em tudo
  config/{padroes.ts,validar.ts,escalas.ts}
  fatos/{extrair.ts,sincronizar.ts,tipos.ts,worker.ts}   FatoTask a partir de Trabalho+rastro (puro); cache incremental
  backlog/{itens.ts,epicos.ts,priorizar.ts,refinar.ts,promover.ts,dod.ts}
  estimativa/{escala.ts,heuristica.ts,calibracao.ts,similares.ts,ia.ts,prompt.ts,esquema.ts,revisao.ts,erro.ts}
  retrabalho/{detectores.ts,natureza.ts,janela.ts,estado.ts,agregar.ts,marcar.ts}
  sprint/{ciclo.ts,planejamento.ts,capacidade.ts,fechar.ts,membros.ts}
  cerimonias/{daily.ts,review.ts,retro.ts,insights.ts,refinamento.ts}
  metricas/{serie.ts,burn.ts,velocidade.ts,fluxo.ts,percentis.ts,cfd.ts,wip.ts,planejado.ts,defeitos.ts,saude.ts,previsao.ts,previsao-worker.ts,snapshots.ts,painel.ts}
  praticas/{xp.ts,lean.ts,kanban.ts,checklists.ts}
  eventos.ts                 publica sprint.*, tarefa.atrasada, retrabalho.detectado… no barramento (F20 consome)
  exportar.ts                CSV/MD/JSON em <userData>/agil/exportacoes/
src/nucleo/banco/migracoes/NNNN-agil.ts     (próximo número livre depois de custo/conhecimento; serializada pelo coordenador)
src/nucleo/banco/repos/agil-*.ts            item, epico, estimativa, classificacao, sprint, membro, cerimonia, retro, retrabalho, fato, snapshot, config
src/nucleo/mcp/tools/agil.ts                backlog_list, backlog_get, backlog_propose, estimate_get, estimate_propose, sprint_status, rework_list, metrics_get
src/main/agil.ts, src/main/ipc/agil.ts      serviço (onda 2), IPC com validadores estritos, ligação ao barramento
src/renderer/telas/agil/
  index.tsx  Filtros.tsx  Painel.tsx  Backlog.tsx  ItemPainel.tsx  Estimativa.tsx  Planejamento.tsx  Daily.tsx  Review.tsx  Retro.tsx  Qualidade.tsx  Config.tsx  agil.css
  graficos/{Burndown,Burnup,Velocidade,Cfd,CycleTime,LeadTime,Throughput,Wip,Retrabalho,PlanejadoEntregue,Defeitos,Distribuicao,Previsao,Saude,ErroEstimativa,ValorEsforco}.tsx
tests/fixtures/agil/{gerar.ts,historico-esperado.ts}   histórico sintético + valores esperados calculados à mão; gerarVolumeAgil
tests/perf/agil.perf.test.ts
```

Integração com o que existe: `PortaMetodo` é implementada sobre `src/nucleo/metodo` (modelo derivado `Trabalho` + rastro; **nenhuma alteração** em `parser/` além de, se faltar,
os `kind` `fechamento|entrega|estimativa|estimativa_historico` na lista de leitura — T-18.06, coordenador); `PortaCusto`/`PortaBoard` sobre as Fases 10; sem elas, custo = `null`.

## Modelo de dados e ligação ao método

Migration única `NNNN-agil` (transação; nunca em paralelo com outra). Ids ULID com prefixo (`it_`, `epi_`, `spr_`, `mbr_`, `est_`, `cls_`, `rtb_`, `cer_`, `rti_`, `rta_`). Momentos UTC ISO com ms.

```sql
CREATE TABLE agil_config (workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  json TEXT NOT NULL,          -- ConfigAgil validada: escala_id, escalas[], categorias[], risco_pesos, risco_faixas, criticidade_regras, dod[], dor[], limites (wip por coluna),
  atualizado_em TEXT NOT NULL);-- estimativa_modo ('ia_sugere'|'so_heuristica'|'manual'), perfil_estimador, janela_retrabalho_dias, dias_uteis, feriados[], limiares de saude, padroes_teste[]
CREATE TABLE agil_membro (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('humano','agente')), rotulo TEXT NOT NULL, agente_id TEXT, squad_id TEXT,
  horas_dia REAL, fator_foco REAL NOT NULL DEFAULT 0.6, pontos_sprint_fixo REAL, ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE agil_membro_alias (membro_id TEXT NOT NULL REFERENCES agil_membro(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('agente','sessao','email','login')), valor TEXT NOT NULL, PRIMARY KEY (tipo, valor));
CREATE TABLE agil_epico (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, titulo TEXT NOT NULL, descricao TEXT,
  cor_token TEXT, estado TEXT NOT NULL DEFAULT 'aberto' CHECK (estado IN ('aberto','concluido','arquivado')), ordem REAL NOT NULL, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE agil_item (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  origem TEXT NOT NULL CHECK (origem IN ('ade','metodo','issue','retro','ocorrencia')),
  trabalho_id TEXT, task_ref TEXT, epico_id TEXT REFERENCES agil_epico(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL, descricao TEXT, criterios_json TEXT NOT NULL DEFAULT '[]',
  estado_ade TEXT NOT NULL DEFAULT 'backlog' CHECK (estado_ade IN ('backlog','refinado','pronto','descartado')),   -- itens do método: o estado de execução vem do disco, não daqui
  valor INTEGER, urgencia INTEGER, reducao_risco INTEGER, moscow TEXT CHECK (moscow IN ('must','should','could','wont')),  -- 1..10
  ordem REAL NOT NULL,                           -- índice fracionário (reordenar = 1 UPDATE)
  dono_membro_id TEXT REFERENCES agil_membro(id) ON DELETE SET NULL, par_membro_id TEXT REFERENCES agil_membro(id) ON DELETE SET NULL,
  visibilidade_cliente TEXT NOT NULL DEFAULT 'auto' CHECK (visibilidade_cliente IN ('auto','sim','nao')),   -- Fase 19 consome
  resumo_cliente TEXT,                           -- texto humano em linguagem simples (Fase 19; origem sempre humano)
  changelog_tipo TEXT CHECK (changelog_tipo IN ('added','changed','deprecated','removed','fixed','security')),  -- Fase 19 consome
  origem_ref_json TEXT,                          -- {issue:'#123'} | {oc_id} | {retro_acao_id} | {pd_id}
  descartado_motivo TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE UNIQUE INDEX agil_item_task ON agil_item(workspace_id, trabalho_id, task_ref) WHERE task_ref IS NOT NULL;
CREATE INDEX agil_item_ordem ON agil_item(workspace_id, estado_ade, ordem);
CREATE TABLE agil_estimativa (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE, versao INTEGER NOT NULL,
  pontos REAL, escala_id TEXT NOT NULL, rotulo TEXT,          -- rotulo p/ camisetas ("M"); pontos = valor numérico normalizado da escala
  min_h REAL, max_h REAL,                                     -- só quando a fonte for F3.5 (faixa) ou horas da escala 'horas'
  origem TEXT NOT NULL CHECK (origem IN ('ia','humano')), motor TEXT NOT NULL CHECK (motor IN ('heuristica','similaridade','llm','agente','manual','f35')),
  confianca REAL, fatores_json TEXT NOT NULL DEFAULT '[]', perfil_json TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('sugerida','aceita','ajustada','travada')), ativa INTEGER NOT NULL DEFAULT 1, nota TEXT, criado_em TEXT NOT NULL,
  UNIQUE (item_id, versao));
CREATE TABLE agil_classificacao (id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE, versao INTEGER NOT NULL,
  categoria TEXT NOT NULL, risco TEXT NOT NULL CHECK (risco IN ('baixo','medio','alto','critico')),
  criticidade TEXT NOT NULL CHECK (criticidade IN ('baixa','media','alta','critica')),
  tipo_task TEXT,                                             -- taxonomia do sprintx (config|client|dominio|persistencia|api|ui|integracao_externa|teste|infra|refatoracao) p/ calibração
  risco_fatores_json TEXT NOT NULL DEFAULT '[]',              -- [{fator, peso, direcao, evidencia}]
  origem TEXT NOT NULL CHECK (origem IN ('ia','humano')), motor TEXT NOT NULL, confianca REAL,
  estado TEXT NOT NULL CHECK (estado IN ('sugerida','aceita','ajustada','travada')), ativa INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL, UNIQUE (item_id, versao));
CREATE TABLE agil_sprint (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, nome TEXT NOT NULL, meta TEXT,
  inicio TEXT NOT NULL, fim TEXT NOT NULL,                    -- datas AAAA-MM-DD
  estado TEXT NOT NULL DEFAULT 'planejada' CHECK (estado IN ('planejada','ativa','fechada','cancelada')),
  capacidade_pontos REAL, compromisso_pontos REAL, iniciada_em TEXT, fechada_em TEXT, versao_lancamento TEXT,
  resumo_fechamento_json TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE agil_sprint_item (sprint_id TEXT NOT NULL REFERENCES agil_sprint(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE,
  adicionado_em TEXT NOT NULL, removido_em TEXT, pontos_compromisso REAL, no_compromisso_inicial INTEGER NOT NULL DEFAULT 0, motivo TEXT,
  resultado TEXT CHECK (resultado IN ('concluido','carregado','devolvido','descartado')), PRIMARY KEY (sprint_id, item_id));
CREATE TABLE agil_capacidade (sprint_id TEXT NOT NULL REFERENCES agil_sprint(id) ON DELETE CASCADE, membro_id TEXT NOT NULL REFERENCES agil_membro(id) ON DELETE CASCADE,
  dias_uteis REAL NOT NULL, ausencias_dias REAL NOT NULL DEFAULT 0, pontos REAL NOT NULL, base TEXT NOT NULL CHECK (base IN ('horas','mediana_3','fixo','sem_base')), PRIMARY KEY (sprint_id, membro_id));
CREATE TABLE agil_cerimonia (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, sprint_id TEXT REFERENCES agil_sprint(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('planejamento','daily','review','retro','refinamento')), data TEXT NOT NULL,
  formato TEXT, conteudo_json TEXT NOT NULL, gerada_de_fatos_em TEXT, editada INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE agil_retro_item (id TEXT PRIMARY KEY, cerimonia_id TEXT NOT NULL REFERENCES agil_cerimonia(id) ON DELETE CASCADE,
  coluna TEXT NOT NULL, texto TEXT NOT NULL, votos INTEGER NOT NULL DEFAULT 0, dado_json TEXT, autor_membro_id TEXT, criado_em TEXT NOT NULL);
CREATE TABLE agil_retro_acao (id TEXT PRIMARY KEY, cerimonia_id TEXT NOT NULL REFERENCES agil_cerimonia(id) ON DELETE CASCADE, texto TEXT NOT NULL,
  dono_membro_id TEXT REFERENCES agil_membro(id) ON DELETE SET NULL, prazo TEXT, estado TEXT NOT NULL DEFAULT 'aberta' CHECK (estado IN ('aberta','feita','cancelada')),
  item_id TEXT REFERENCES agil_item(id) ON DELETE SET NULL, concluida_em TEXT, criado_em TEXT NOT NULL);
CREATE TABLE agil_fato_task (workspace_id TEXT NOT NULL, trabalho_id TEXT NOT NULL, task_ref TEXT NOT NULL,   -- cache derivado e descartável (reindexável)
  status_visto TEXT NOT NULL, iniciada_em TEXT, concluida_em TEXT, concluida_ts_precisa INTEGER NOT NULL DEFAULT 0, duracao_obs_ms INTEGER, bloqueada_ms INTEGER,
  reaberturas INTEGER NOT NULL DEFAULT 0, qa_reprovacoes INTEGER NOT NULL DEFAULT 0, suite_final TEXT, agente TEXT, membro_id TEXT, arquivos_json TEXT NOT NULL DEFAULT '[]',
  tdd_primeiro INTEGER, vermelho_antes INTEGER, commits_json TEXT NOT NULL DEFAULT '[]', validada_em TEXT, tem_rastro INTEGER NOT NULL DEFAULT 0,
  versao_origem TEXT NOT NULL, atualizado_em TEXT NOT NULL, PRIMARY KEY (workspace_id, trabalho_id, task_ref));
CREATE TABLE agil_retrabalho_evento (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, trabalho_id TEXT NOT NULL, task_ref TEXT, item_id TEXT,
  fonte TEXT NOT NULL CHECK (fonte IN ('qa_reprovado','task_reaberta','commit_fix','regressao','regra_repetida','manual')),
  forca TEXT NOT NULL CHECK (forca IN ('forte','fraca')), natureza TEXT NOT NULL CHECK (natureza IN ('defeito','escopo','ruido','pendente')),
  evidencia_json TEXT NOT NULL, chave_dedupe TEXT NOT NULL UNIQUE, ocorrido_em TEXT, detectado_em TEXT NOT NULL,
  confirmado_por TEXT CHECK (confirmado_por IN ('automatico','humano')), motivo TEXT, ativo INTEGER NOT NULL DEFAULT 1);
CREATE TABLE agil_retrabalho_task (workspace_id TEXT NOT NULL, trabalho_id TEXT NOT NULL, task_ref TEXT NOT NULL,
  situacao TEXT NOT NULL CHECK (situacao IN ('primeira','retrabalho','em_observacao','indeterminado')), eventos_defeito INTEGER NOT NULL DEFAULT 0, eventos_pendentes INTEGER NOT NULL DEFAULT 0,
  janela_ate TEXT, calculado_em TEXT NOT NULL, PRIMARY KEY (workspace_id, trabalho_id, task_ref));
CREATE TABLE agil_erro_estimativa (item_id TEXT PRIMARY KEY REFERENCES agil_item(id) ON DELETE CASCADE, estimativa_id TEXT NOT NULL, pontos_previstos REAL NOT NULL, categoria TEXT,
  observado_ms INTEGER, real_h REAL, ref_ms_por_ponto REAL, razao REAL, registrado_em TEXT NOT NULL);   -- razao = observado_ms / (pontos × ref_ms_por_ponto)
CREATE TABLE agil_metrica_snapshot (workspace_id TEXT NOT NULL, escopo TEXT NOT NULL CHECK (escopo IN ('workspace','sprint','membro','squad')), chave TEXT NOT NULL,
  dia TEXT NOT NULL, metrica TEXT NOT NULL, valor REAL, extra_json TEXT, PRIMARY KEY (workspace_id, escopo, chave, dia, metrica));
CREATE TABLE agil_checklist (sprint_id TEXT NOT NULL REFERENCES agil_sprint(id) ON DELETE CASCADE, codigo TEXT NOT NULL, grupo TEXT NOT NULL CHECK (grupo IN ('xp','lean','dod','dor')),
  estado TEXT NOT NULL CHECK (estado IN ('ok','atencao','falha','na','indeterminado')), fonte TEXT NOT NULL CHECK (fonte IN ('auto','manual')), valor_json TEXT, nota TEXT, PRIMARY KEY (sprint_id, codigo));
CREATE TABLE agil_dod_resultado (item_id TEXT NOT NULL REFERENCES agil_item(id) ON DELETE CASCADE, criterio TEXT NOT NULL, estado TEXT NOT NULL CHECK (estado IN ('ok','falha','na','indeterminado')),
  fonte TEXT NOT NULL CHECK (fonte IN ('auto','manual')), em TEXT NOT NULL, PRIMARY KEY (item_id, criterio));
```

**Como se liga ao método sem escrevê-lo.** O sincronizador (`fatos/sincronizar.ts`) lê o modelo derivado de `src/nucleo/metodo` (já em memória/worker) e faz *upsert*: (a) um `agil_item`
`origem='metodo'` por task (`titulo`, `criterios_json` ← `criterio_aceite`; estado de execução **nunca** copiado para `estado_ade`); (b) uma linha `agil_fato_task` com tudo que é
derivável (iniciada/concluída pelo rastro; `duracao_obs_ms`; reaberturas; QA; commits da `ENTREGA.md`; `validada_em` = veredito QA aprovado do trabalho ou `portao` da entrega);
(c) `versao_origem` = hash (mtime+tamanho) dos arquivos do trabalho, para pular o que não mudou. Task que some do disco **não** apaga o item: fica `orfao` na UI (histórico preservado).
Item `origem='ade'` pode ser **promovido** (T-18.11): o ADE só **sugere/dispara** o comando do método (`/expx:prodx-triar` ou `/expx:sprintx <pedido>`) e, quando o trabalho aparece no disco,
oferece vincular (`trabalho_id`) — vínculo humano, nunca por adivinhação silenciosa.

## Definições operacionais (valem para código, testes e UI)

- **Estados derivados do fluxo (CFD):** `backlog` (sem sprint e sem trabalho) · `pronto` (`estado_ade='pronto'` ou task `pendente` com `depende_de` satisfeitas) · `em_andamento` (task `em_andamento`)
  · `concluida` (task `concluida`) · `validada` (trabalho com QA `aprovado`/portão da entrega). Se a Fase 10 existir, `PortaBoard.colunas()` manda; este é o fallback.
- **Cycle time** = `task_iniciada` (último antes de `task_concluida`) → `task_concluida`. **Lead time** = entrada na sprint ágil (`adicionado_em`) — ou, sem sprint, `criado_em` do item;
  para task do método sem ambos, o primeiro evento do trabalho — → `task_concluida`. Rótulos "duração observada". Percentis **P50/P85/P95** por interpolação linear (`percentis.ts`), amostra mínima 5 (senão "poucos dados").
  Data sem hora (`concluida_em` do frontmatter sem rastro) conta como fim do dia e marca `concluida_ts_precisa=0` (asterisco na UI).
- **Burndown/burnup:** escopo vigente por dia = Σ pontos dos itens ativos na sprint naquele dia (adições/remoções vêm de `adicionado_em`/`removido_em`); concluído por dia = Σ pontos de tasks
  `concluida_em ≤ dia`. Linha ideal = do **compromisso inicial** ao zero em dias úteis (`dias_uteis`, `feriados`). Alternância **pontos | itens**. Item sem pontos: fora da soma, contador "N sem estimativa".
- **Velocidade** = Σ pontos de itens concluídos dentro da janela da sprint; **média móvel** de 3 sprints fechadas; **velocidade de primeira** = só os de `situacao='primeira'`.
- **Throughput** = tasks concluídas por dia/semana. **WIP** = `em_andamento` por dia (reconstruído do rastro); **idade do WIP** = agora − última `task_iniciada`.
- **Atrasada (`tarefa.atrasada`):** ver D-188. **Em risco (`sprint.em_risco`):** indicador de saúde vermelho por ≥ 1 dia útil seguido.
- **Planejado × entregue:** compromisso inicial vs. concluído, separando adicionado no meio, carregado e removido. **Defeitos escapados:** ocorrência runx tipo `bug` aberta **depois** do fechamento da
  sprint com `regressao_de` apontando um trabalho da sprint (ou ligação humana); por sprint e por categoria.
- **Erro de estimativa:** `razao = observado_ms / (pontos × ref_ms_por_ponto)`, `ref_ms_por_ponto` = **mediana** de `duracao_obs_ms/pontos` das tasks concluídas **da mesma categoria** (mín. 5 amostras; senão do workspace; senão `null`
  → sem razão). Viés = mediana das razões; **MdAPE** = mediana de `|razao − 1|`. Se `HISTORICO.md` trouxer `real` (h), guarda-se `real_h` ao lado, **sem misturar**.
- **Risco** (probabilidade de dar errado) ≠ **criticidade** (impacto de negócio se der errado). **Risco** = soma ponderada de fatores com evidência (tabela abaixo); **criticidade** = função de
  categoria + `valor`/`urgencia` do item + palavras de domínio sensível, editável.

| Fator de risco (id) | Peso padrão | Evidência |
|---|---|---|
| `raio_alto` | 3 | `PortaMapa.raio(arquivos)` faixa ALTO (> 15 chamadores) ou legadox zona de risco |
| `zona_risco_historica` | 2 | memox: arquivos com regressão/reprovação QA nos últimos 90 dias |
| `sem_cobertura` | 2 | legadox/stackx: arquivo sem teste |
| `integracao_externa` | 2 | `tipo_task = integracao_externa` ou sinal do plano |
| `migracao_schema` | 2 | task `persistencia` com migration |
| `sensivel_dominio` | 3 | termos configuráveis (auth, pagamento, LGPD, permissão, fiscal…) no texto/arquivos |
| `contrato_publico` | 2 | muda IPC/MCP/API pública |
| `dependencias_muitas` | 1 | `depende_de` ≥ 3 |
| `tamanho_grande` | 1 | pontos ≥ 8 |
| `historico_retrabalho_area` | 2 | FTR da área < 70 % com n ≥ 5 |
| `lacuna_aberta` | 1 | `00-LACUNAS.md`/bloqueio aberto na área |
| `sem_criterio_aceite` | 1 | critério vazio |

Faixas padrão: soma 0–2 baixo · 3–5 médio · 6–8 alto · ≥ 9 crítico (editáveis). Fatores são **explicados** (id + evidência de ≤ 160 caracteres) na UI e no CSV.

## Estimativa por IA (pipeline)

1. **Gatilho:** sincronização cria item sem estimativa ativa → enfileira `estimar` (debounce 2 s, lote ≤ 20). Também "Estimar tudo sem estimativa", "Reestimar selecionados" e `estimate_propose` (agente).
2. **Heurística imediata** (`heuristica.ts`, ≤ 5 ms): pontos-base por `tipo_task` do plano (`config 2, client 3, dominio 3, persistencia 3, api 3, ui 3, integracao_externa 5, teste 2, infra 3, refatoracao 3`,
   editáveis) ± degraus por sinal (+1: ≥ 5 arquivos prováveis, raio ALTO, sem cobertura, integração externa, ≥ 3 dependências, > 4 critérios, texto > 600 caracteres; −1: ≤ 1 arquivo, tipo `teste`/doc, similar
   de FTR sem retrabalho); *snap* à escala; teto 13 com **sugestão de quebra**. Categoria por tipo + palavras-chave PT/EN + origem (ocorrência `bug` → `bug`). Risco/criticidade pelas tabelas acima.
   Grava `motor='heuristica'`, `estado='sugerida'`, `confianca` baixa/média por qualidade do texto.
3. **Contexto** (`similares.ts`, `calibracao.ts`): `PortaRag.buscar(texto, {tipos:['task','relatorio','fechamento']})` (≤ 5 similares com pontos, categoria, duração observada, FTR, retrabalho); `PortaMapa.raio`; calibração
   lida de `docs/sprintx/estimativas/HISTORICO.md` (`entradas`, `calibracao`) **somente leitura** + `agil_erro_estimativa`; `00-ESTIMATIVA.md` do trabalho (faixa `min–max h` por task) como insumo.
4. **IA** (`ia.ts`): perfil = `PortaPerfil.resolver("agil","estimativa")`; `PortaHeadless.executar({perfil, entrada, tools:[], timeoutMs:90000})`; entrada = JSON em envelope delimitado
   (`<tarefas>…</tarefas>`; texto de task é **dado não confiável**); **nunca** código, `.env` ou caminho absoluto.
5. **Saída validada** (`esquema.ts`): `[{ref, pontos, categoria, risco, criticidade, confianca, fatores:[{fator, direcao:"sobe"|"desce", evidencia}], justificativa, similar_ref|null, duvidas[]}]`;
   `ref ∈ lote`; `pontos ∈ escala`; enums fechados; `fatores ≤ 6`; textos truncados; campos extras descartados; JSON inválido → 1 nova tentativa com a mensagem de erro; depois fica a heurística.
6. **Confiança final** = `confianca_llm × qualidade_evidencia` (critério de aceite presente, nº de similares, n da calibração); rótulos baixa < 0,4 ≤ média < 0,7 ≤ alta.
7. **Regras de revisão** (`revisao.ts`): nova estimativa só vira `ativa` se a atual for `sugerida`; `aceita`/`ajustada`/`travada` (humano) nunca são sobrescritas; "aceitar em lote" aceita as `sugerida` com confiança ≥ limiar (padrão 0,6)
   e **mostra** quantas ficam para revisão; histórico de versões sempre visível.
8. **Custo:** a chamada fica registrada pela Fase 10 (tokens/cota); teto diário de chamadas `agil_config.estimativa_max_chamadas_dia` (padrão 40); estourou → heurística.
9. **Erro de estimativa** (`erro.ts`): ao detectar `concluida`, grava `agil_erro_estimativa`; painel mostra dispersão previsto × observado e viés/MdAPE por categoria; a calibração usa isso na próxima estimativa.

## Cerimônias e artefatos (conteúdo mínimo)

- **Backlog:** épico → item; priorização **WSJF** `(valor + urgência + redução de risco) ÷ pontos` (item sem pontos = "sem WSJF"), **MoSCoW**, **valor × esforço** (matriz 2×2); ordem manual por arrastar (`ordem` fracionária) **manda** sobre
  qualquer cálculo; **refinamento** = fila "precisa de refino" pela **Definição de Pronto-para-começar (DoR)** padrão (critério de aceite, estimativa, risco classificado, dependências satisfeitas, ≤ 13 pontos, sem lacuna aberta), com quebra sugerida e
  duplicados prováveis (similaridade RAG). **Definição de Pronto (DoD)** padrão por task: suíte `verde`, ≥ 2 testes (integração+funcional) e regressão se bug (regras do método), QA `aprovado`, sem segredo no diff, PR aberto/commit por task (mergex),
  sem `regra_violada` aberta; itens automáticos via fatos, os demais manuais; resultado por item em `agil_dod_resultado`.
- **Planejamento:** capacidade por membro (`humano`: `horas_dia × dias_úteis − ausências` × `fator_foco` ÷ `horas_por_ponto` calibrado; `agente`: mediana das 3 últimas velocidades ou fixo), **sugestão** de compromisso (guloso por ordem do backlog até
  capacidade × (1 − buffer 20 %), respeitando `depende_de`), meta da sprint (texto), avisos (excede capacidade, itens sem estimativa, risco crítico > N, dependência fora da sprint) — **avisa, nunca bloqueia**.
- **Daily** (gerada dos fatos de [último dia útil → agora], por membro/agente/squad): **Ontem** (`task_concluida`, `commit_criado`, `pr_aberto`, `veredito_emitido`), **Hoje** (`em_andamento` + próximas `pronto` por dependência),
  **Bloqueios** (`00-BLOQUEIOS.md` abertos, `bloqueio_antigo`, tasks `bloqueada`), **Atrasos** (acima de P85) e **Riscos**; campo de **observação humana** por linha; botões **Copiar texto** (curto, sem formatação, para chat) e **Copiar Markdown**; salva
  `agil_cerimonia(tipo='daily')` com `gerada_de_fatos_em`.
- **Review (demo):** itens concluídos da sprint com critérios, link do PR/commits (`ENTREGA.md`), DoD, **resultado da demo** por item (`aceito|ajustar|rejeitado`) e notas; alimenta a Fase 19.
- **Retrospectiva:** formatos **começar/parar/continuar** (padrão) e **4Ls** (gostei/aprendi/faltou/desejei); **assistida por dados** (`insights.ts`, determinístico): top tasks por retrabalho, QA reprovado, atrasos, maiores erros de estimativa, WIP médio vs. limite, bloqueios mais longos,
  FTR da sprint vs. média móvel, **ações da retro anterior não cumpridas**; itens com votos; **ações** com dono, prazo e estado; "criar item no backlog" a partir de ação (`origem='retro'`).
- **Kanban opcional (limites de WIP):** este plano só **define e mede** `limites.wip` por coluna e emite `wip.excedido`; o **desenho do quadro e o bloqueio visual vivem no board da Fase 10** (`PortaBoard.limiteWip()`); sem Fase 10, o limite aparece apenas como indicador na Saúde.
- **XP** (métricas + checklists, `praticas/xp.ts`): `tdd_primeiro` (1º arquivo de teste alterado antes do 1º de produção, por `arquivo_alterado` no rastro, padrões de teste em `padroes_teste`), `vermelho_antes_do_verde` (`suite_executada` falha → ok), `commits_pequenos`
  (mediana de linhas por commit via `PortaVcs.numstat`; alerta > 400, configurável), `commit_por_task` (ENTREGA), `ci_verde` (checks do PR via `PortaForge`), `revisao_independente` (veredito/QA por agente ≠ implementador **e** reviews de PR), `refatoracao` (pontos de categoria `refator` ÷ total),
  `par` (campo `par_membro_id`; % de tasks com par/revisão). Sem rastro/VCS → `indeterminado`, nunca 0 %. Checklist XP da sprint editável (testes primeiro, integração contínua, commits pequenos, refatoração contínua, par/revisão, propriedade coletiva, ritmo sustentável).
- **Lean** (`praticas/lean.ts`): desperdícios medidos — **espera** (tempo bloqueado + idade parada sem atividade), **retrabalho**, **trabalho parcial** (WIP), **troca de contexto** (tasks `em_andamento` simultâneas por membro/agente), **descartes após início**, **defeitos escapados**;
  **eficiência de fluxo** = tempo com atividade observada (`PortaCusto.janelas` — tokens/atividade por task) ÷ lead time (sem fonte → `null`); **valor × esforço**; **valor entregue por ponto**.

## Dashboards (16 gráficos; SVG próprio; filtros: sprint, pessoa, agente, squad, período)

1. **Burndown** (pontos|itens, ideal, escopo adicionado) · 2. **Burnup** (escopo e concluído) · 3. **Velocidade** por sprint + média móvel + "de primeira" · 4. **CFD** (5 estados) · 5. **Cycle time** (dispersão + P50/P85/P95) · 6. **Lead time** (idem)
· 7. **Throughput** (dia/semana) · 8. **WIP** (série + limite) e **idade do WIP** (barras por task) · 9. **Retrabalho / first-time-right** por sprint e por categoria · 10. **Planejado × entregue** · 11. **Defeitos escapados**
· 12. **Distribuição** por risco/categoria/criticidade (barras empilhadas) · 13. **Previsão de término** (Monte Carlo: P50/P85/P95, probabilidade de fechar na sprint) · 14. **Saúde da sprint** (indicadores com texto) · 15. **Erro de estimativa**
(dispersão previsto × observado, viés/MdAPE) · 16. **Valor × esforço** (matriz). Cada gráfico: título, unidade, "n = …", tabela de dados em `<details>`, expandir, exportar CSV da série, estado vazio explicando o que falta.

**Saúde da sprint** — indicadores (verde/amarelo/vermelho + frase), limiares padrão editáveis: progresso vs. ideal (> 20 % atrás amarelo, > 35 % vermelho), escopo adicionado (> 20 %), WIP acima do limite, bloqueios abertos, itens sem estimativa, FTR abaixo da média móvel − 10 pontos,
tarefas atrasadas, QA reprovado pendente, compromisso > 100 % da capacidade. **Sem nota única**: lista de alertas com o fato que a sustenta.

## Contratos novos

**Tipos** (`src/compartilhado/agil.ts`; resumo):
```ts
type OrigemAgil = "ia" | "humano"; type MotorAgil = "heuristica" | "similaridade" | "llm" | "agente" | "manual" | "f35";
type EstadoSugestao = "sugerida" | "aceita" | "ajustada" | "travada";
interface Estimativa { id: string; versao: number; pontos: number | null; rotulo: string | null; escala_id: string; min_h: number | null; max_h: number | null;
  origem: OrigemAgil; motor: MotorAgil; confianca: number | null; fatores: FatorEstimativa[]; estado: EstadoSugestao; ativa: boolean; criado_em: string }
interface Classificacao { categoria: string; risco: "baixo"|"medio"|"alto"|"critico"; criticidade: "baixa"|"media"|"alta"|"critica"; tipo_task: string | null;
  risco_fatores: FatorRisco[]; origem: OrigemAgil; motor: MotorAgil; confianca: number | null; estado: EstadoSugestao }
interface ItemResumo { id; origem; trabalho_id: string | null; task_ref: string | null; titulo; epico_id: string | null; estado_ade; estado_fluxo: "backlog"|"pronto"|"em_andamento"|"concluida"|"validada"|"orfao";
  pontos: number | null; categoria: string | null; risco: string | null; criticidade: string | null; ordem: number; wsjf: number | null; situacao_retrabalho: "primeira"|"retrabalho"|"em_observacao"|"indeterminado"|null;
  duracao_obs_ms: number | null; sprint_id: string | null; dono: string | null; estimativa_origem: OrigemAgil | null; estimativa_confianca: number | null }
interface SituacaoRetrabalho { ir: number | null; ir_max: number | null; first_time_right: number | null; avaliaveis: number; em_observacao: number; indeterminado: number; escopo_eventos: number }
interface PainelAgil { filtros: FiltrosAgil; gerado_em: string; base: { tasks: number; itens: number; sprints: number; sem_estimativa: number; sem_rastro: number };
  burndown: SerieBurn; burnup: SerieBurn; velocidade: PontoVelocidade[]; cfd: SerieCfd; cycle: DispersaoTempo; lead: DispersaoTempo; throughput: SerieDia[]; wip: SerieWip; retrabalho: SituacaoRetrabalho & { por_sprint: …; por_categoria: … };
  planejado_entregue: …; defeitos_escapados: …; distribuicao: …; previsao: PrevisaoMC | { estado: "dados_insuficientes" | "calculando" }; saude: IndicadorSaude[]; erro_estimativa: …; valor_esforco: … }
```
Todos os campos numéricos desconhecidos são `null` (nunca 0); duração em **ms**; datas de sprint `AAAA-MM-DD`; momentos UTC ISO.

**Canais IPC** (`agil:*`; validadores estritos na borda; o renderer **nunca** envia caminho; erros `{code, subcode?, message}`):

| Canal | Tipo | Entrada → saída |
|---|---|---|
| `agil:config_ler` / `config_gravar` | invoke | `{workspace_id}` ↔ `ConfigAgil` (validada; padrões mesclados) |
| `agil:sincronizar` | invoke | `{workspace_id, forcar?}` → `{iniciado}` (worker; progresso por evento) |
| `agil:backlog_listar` | invoke | `{workspace_id, filtros?:{texto, epico_id, estado_fluxo, categoria, risco, criticidade, sprint_id, sem_estimativa?}, ordenar?:"ordem"\|"wsjf"\|"valor_esforco", cursor?, limite≤200}` → `{itens: ItemResumo[], proximo, total, contagens}` |
| `agil:item_ler` | invoke | `{item_id}` → `ItemDetalhe` (estimativas e classificações com histórico, DoD, retrabalho, erro, fatos, links) |
| `agil:item_criar` / `item_atualizar` / `item_descartar` | invoke | campos editáveis (`titulo, descricao, criterios, epico_id, valor, urgencia, reducao_risco, moscow, dono, par, visibilidade_cliente, resumo_cliente, changelog_tipo`); itens `origem='metodo'` só aceitam campos ágeis |
| `agil:item_reordenar` | invoke | `{item_id, antes_id\|null}` → `{ordem}` |
| `agil:item_promover` | invoke | `{item_id, destino:"prodx"\|"sprintx"\|"runx"}` → `{comando}` (para `metodo:disparar`) |
| `agil:item_vincular` | invoke | `{item_id, trabalho_id, task_ref?}` → `ItemResumo` |
| `agil:epico_listar` / `epico_gravar` / `epico_apagar` | invoke | CRUD |
| `agil:estimar` | invoke | `{item_ids≤50\|"sem_estimativa", modo:"rapido"\|"completo"}` → `{job_id}`; evento `estimativa_pronta` |
| `agil:estimativa_gravar` | invoke | `{item_id, pontos\|rotulo, estado?:"aceita"\|"ajustada"\|"travada", nota?}` → `Estimativa` (origem `humano`) |
| `agil:classificacao_gravar` | invoke | `{item_id, categoria?, risco?, criticidade?, estado?}` → `Classificacao` |
| `agil:estimativa_aceitar_lote` | invoke | `{item_ids, confianca_min?}` → `{aceitas, restantes}` |
| `agil:sprint_listar` / `sprint_criar` / `sprint_atualizar` / `sprint_iniciar` / `sprint_cancelar` | invoke | ciclo de vida |
| `agil:sprint_item_mover` | invoke | `{sprint_id, item_id, acao:"adicionar"\|"remover", motivo?}` |
| `agil:capacidade_ler` / `capacidade_gravar` | invoke | por membro |
| `agil:planejamento_sugerir` | invoke | `{sprint_id, buffer?}` → `{itens, pontos, capacidade, avisos[]}` |
| `agil:sprint_fechar` | invoke | `{sprint_id, destino_pendentes:"backlog"\|"proxima"\|"descartar", versao_lancamento?}` → `{resumo}` (transação; publica `sprint.fechada`) |
| `agil:daily_gerar` / `daily_salvar` | invoke | `{sprint_id?, data?}` → `Daily`; `{id, observacoes}` |
| `agil:review_ler` / `review_gravar` | invoke | resultado por item |
| `agil:retro_ler` / `retro_gravar` / `retro_item_gravar` / `retro_acao_gravar` / `retro_acao_para_item` | invoke | retro e ações |
| `agil:retrabalho_listar` | invoke | `{workspace_id, filtros}` → eventos + situação por task |
| `agil:retrabalho_marcar` | invoke | `{trabalho_id, task_ref, acao:"marcar_retrabalho"\|"marcar_primeira"\|"confirmar"\|"descartar"\|"natureza", evento_id?, natureza?, motivo}` (**humano**, `motivo` ≥ 5 caracteres) |
| `agil:painel` | invoke | `{workspace_id, filtros: FiltrosAgil}` → `PainelAgil` |
| `agil:previsao` | invoke | `{workspace_id, filtros, iteracoes?≤50000}` → `{job_id}` |
| `agil:praticas` | invoke | `{workspace_id, sprint_id?}` → `{xp, lean, checklists}` |
| `agil:checklist_gravar` | invoke | `{sprint_id, codigo, estado, nota?}` |
| `agil:exportar` | invoke | `{tipo:"backlog"\|"metricas"\|"retro"\|"daily", formato:"csv"\|"md"\|"json", escopo}` → `{caminho_ref}` (em `<userData>/agil/exportacoes/`) |
| `agil:evento` | evento | `{tipo:"sincronizado"\|"estimativa_pronta"\|"retrabalho_detectado"\|"metricas_atualizadas"\|"sprint_mudou"\|"previsao_pronta", …}` coalescido ≤ 1/300 ms |

**Eventos de domínio** (barramento; consumidos pela Fase 20 e pela Fase 19): `sprint.iniciada`, `sprint.fechada`, `sprint.em_risco`, `tarefa.atrasada`, `retrabalho.detectado`, `wip.excedido`, `acao_retro.vencida`, `agil.estimativa_pronta`.
Payload comum `{workspace_id, sprint_id?, trabalho_id?, task_ref?, pontos: number|null, duracao_observada_ms: number|null, tokens: number|null, quando}`; `sprint.fechada` leva também `resumo_fechamento` e `versao_lancamento`.

**Tools MCP** (inglês `snake_case`; token do Pane; `workspace_id` vem do token): **leitura** em todos os modos; **escrita só proposta**, nunca sobrescreve humano, nunca confirma retrabalho.

| Tool | Entrada | Saída | Matriz |
|---|---|---|---|
| `backlog_list` | `{status?, epic_id?, limit≤100, cursor?}` | `{items:[{id, title, status, points, category, risk, criticality, priority_rank}], next}` | todos |
| `backlog_get` | `{item_id}` | item completo (sem conteúdo de tela) | todos |
| `backlog_propose` | `{title, description?, criteria[]≤10, epic_id?}` | `{item_id, state:"backlog"}` (origem `ade`, `estado_ade='backlog'`, marcado "proposto por agente") | piloto em `squad`/`agentico` |
| `estimate_get` | `{item_ref}` | estimativa/classificação ativas + histórico | todos |
| `estimate_propose` | `{item_ref, points, category?, risk?, criticality?, rationale≤400}` | `{estimate_id, state:"sugerida"}` (`origem='ia'`, `motor='agente'`) | piloto em `squad`/`agentico` |
| `sprint_status` | `{sprint_id?}` | `{sprint, committed, done, remaining, health:[…]}` | todos |
| `rework_list` | `{sprint_id?, limit≤100}` | eventos e situação (somente leitura) | todos |
| `metrics_get` | `{metric, sprint_id?}` | série numérica de uma métrica | todos |

Erros: `invalid_argument`, `not_found`, `rule_violation` com subcode novo `human_only` (tentativa de agente em ação humana).

## UI (compacta, D-32)

Menu lateral **Ágil** (ícone próprio; tela lazy). Uma linha de controles (≈ 28 px): abas **Painel · Backlog · Sprint · Daily · Retro · Qualidade · Config** + chips de filtro (sprint, pessoa/agente, squad, período) + busca + ações; sem cabeçalho de página.
**Painel** = grade densa de 16 cartões pequenos (expandir/tabela/CSV), estado vazio com próximo passo ("sem rastro: rode a sprintx"). **Backlog** = tabela virtualizada (ordem, título, pontos, categoria, risco, criticidade, WSJF, origem/confiança como
ícone pequeno, situação de retrabalho) com edição inline, arrastar, painel lateral do item (estimativa com **origem, confiança, fatores explicados, versões**, DoD, retrabalho com ações "marcar retrabalho"/"marcar feita de primeira"). **Sprint** = capacidade (linhas por membro) + compromisso
+ saúde + fechar (diálogo da UI com destino dos pendentes, nunca `window.confirm`). **Daily** = 4 blocos copiáveis. **Retro** = colunas com itens/votos + painel "dados da sprint" + ações. **Qualidade** = Retrabalho (por task/sprint/pessoa/agente), XP, Lean, checklists.
Atalhos (mac / Win): ⌘⇧A abre Ágil; ⌘⌥D gera daily; ⌘⌥R retro. Acessibilidade: `role="tablist"`, tabela com `aria-rowcount`, gráficos com `<title>/<desc>` e tabela equivalente, foco visível, `prefers-reduced-motion`, cor + padrão. Cores via `--grafico-1..6` em `tokens.css` (T-18.32).

## Tarefas

Formato: `T-18.NN · título` — arquivos · o que entrega · **aceite binário** · testes · depende. Todas em TDD (teste vermelho antes) e `npm run verificar` verde; as de UI herdam os orçamentos e D-32. Arquivos compartilhados que **só o coordenador** edita:
`src/compartilhado/ipc.ts`, `src/preload/preload.ts`, `src/nucleo/mcp/{catalogo,portas}.ts`, migrations, `src/nucleo/metodo/parser/kinds.ts`, `src/renderer/tokens.css`, `05-CONTRATOS.md`, `STATUS.md`.

### A — Fundação
- **T-18.01 · Contratos compartilhados (coordenador)** — `src/compartilhado/agil.ts`, canais/eventos em `ipc.ts`, validadores estritos em `src/main/ipc/agil.ts` (esqueleto que recusa até a task dona implementar), `window.ade.agil` no preload (`CHAVES_API_ADE`), `human_only` em `mcp/erros.ts`. **Aceite:** typecheck verde; todo canal tem validador; nenhum aceita caminho absoluto. **Testes:** `ipc-agil.test.ts` (tabela de payloads inválidos), `preload.test.ts`. **Depende:** —.
- **T-18.02 · Migration `agil` e repositórios (coordenador)** — `migracoes/NNNN-agil.ts`, `repos/agil-*.ts`. **Aceite:** aplica em banco vazio e sobre o banco da Fase 10; CASCADE por workspace; consultas quentes ≤ 5 ms (P-14); ordem fracionária reordena com 1 UPDATE. **Testes:** `migrar-agil.test.ts`, `agil-repos.test.ts`. **Depende:** T-18.01.
- **T-18.03 · Portas e fábrica** — `agil/portas.ts`, `agil/agil.ts`. **Aceite:** `criarAgil` funciona só com `Indisponivel*`; relógio injetado em toda a lógica; porta ausente nunca lança, devolve `null`/vazio. **Testes:** `portas.test.ts`, `fabrica.test.ts`. **Depende:** T-18.01.
- **T-18.04 · Configuração ágil e padrões** — `config/{padroes,validar,escalas}.ts`. Escalas (`fibonacci`, `camisetas`, `horas`), categorias (`feature, bug, refator, infra, doc, spike, teste, divida`), pesos/faixas de risco, DoD/DoR, `janela_retrabalho_dias=14`, limiares de saúde, `padroes_teste`, `estimativa_modo='ia_sugere'`. **Aceite:** config inválida é recusada com a lista de erros; padrões mesclam sem perder chave do usuário; escala custom válida. **Testes:** `config.test.ts` (propriedade: mesclar é idempotente). **Depende:** T-18.02.
- **T-18.05 · Membros, aliases e atribuição** — `sprint/membros.ts`. Resolve `agente`/`sessao`/e-mail de commit → `membro_id`; sem alias → "sem dono" (nunca adivinha). **Aceite:** rastro com `agente: "qa"` e alias casa; ambíguo vira "sem dono" com aviso. **Testes:** `membros.test.ts`. **Depende:** T-18.02.

### B — Fatos do método
- **T-18.06 · Extrator de fatos (puro)** — `fatos/{tipos,extrair}.ts`; leitura dos `kind` `fechamento|entrega|estimativa|estimativa_historico` (coordenador acrescenta em `parser/kinds.ts`). De `Trabalho` + rastro → `FatoTask` (iniciada/concluída, duração, bloqueios, reaberturas, QA, commits da `ENTREGA.md`, `tdd_primeiro`, `vermelho_antes`, arquivos por task). **Aceite:** rastro com linha incompleta/rotacionado (`.1.jsonl`)/fora de ordem não lança; disco vence o rastro em status; `duracao_obs_ms` só com `task_iniciada` anterior; sem rastro → `tem_rastro=0` e campos `null`. **Testes:** `extrair.test.ts` sobre a fixture. **Depende:** T-18.03.
- **T-18.07 · Sincronizador incremental em worker** — `fatos/{sincronizar,worker}.ts`, `main/agil.ts`. Upsert de itens espelho + `agil_fato_task` por `versao_origem`; transição `concluida` → outro status detectada (alimenta `task_reaberta`); evento coalescido. **Aceite:** P-180; trabalho removido do disco vira `orfao` sem apagar histórico; nunca escreve em `docs/**` (teste com `fs` espionado). **Testes:** `sincronizar.test.ts`, `agil.perf.test.ts` (parcial). **Depende:** T-18.06, T-18.02.
- **T-18.08 · Fixtures de histórico e volume** — `tests/fixtures/agil/{gerar,historico-esperado}.ts` (usa `gerarProjetoExpx` de `tests/fixtures/metodo/gerar.ts`, sem editá-lo): 40 sprints, 6 membros (2 agentes), tasks com retrabalho de cada fonte, escopo vs defeito, bloqueios, QA reprovado, commits de fix, `HISTORICO.md`/`00-ESTIMATIVA.md`; `gerarVolumeAgil(raiz,{trabalhos:200, tasksPorTrabalho:25})`. **Aceite:** determinístico (semente fixa); `historico-esperado.ts` com burndown, velocidade, P50/P85/P95, FTR e IR **calculados à mão**. **Testes:** `gerar.test.ts`. **Depende:** T-18.03.

### C — Backlog
- **T-18.09 · Itens, épicos e campos para a Fase 19** — `backlog/{itens,epicos}.ts`: CRUD, itens espelho só-leitura quanto a estado/título, `visibilidade_cliente`, `resumo_cliente`, `changelog_tipo`, `par_membro_id`. **Aceite:** editar item `origem='metodo'` só altera campos ágeis; descartar exige motivo; `resumo_cliente` sempre `origem humano`. **Testes:** `itens.test.ts`. **Depende:** T-18.07.
- **T-18.10 · Priorização** — `backlog/priorizar.ts`: WSJF, MoSCoW, valor×esforço, ordem fracionária (rebalanceia quando a lacuna < 1e-9). **Aceite:** WSJF = `(v+u+r)/pontos` com `null` sem pontos; ordem manual vence; 5 000 reordenações seguidas não degradam. **Testes:** `priorizar.test.ts` (propriedade: ordem total estável). **Depende:** T-18.09.
- **T-18.11 · Promoção para o método** — `backlog/promover.ts`: gera o comando correto (`/expx:prodx-triar`, `/expx:sprintx`, `/expx:runx`) para `metodo:disparar`; depois **sugere** vínculo quando um trabalho novo aparece (título similar); vínculo só por ação humana. **Aceite:** nunca dispara sozinho; vínculo errado desfaz sem perder histórico. **Testes:** `promover.test.ts`. **Depende:** T-18.09.
- **T-18.12 · Refinamento e DoR/DoD** — `backlog/{refinar,dod}.ts`, `cerimonias/refinamento.ts`: fila de refino, quebra sugerida (> 13), duplicados por `PortaRag`, DoD automática por fatos. **Aceite:** DoR/DoD da config aplicadas; item concluído sem QA aprovado mostra DoD "falha" com motivo; sem RAG, duplicados = vazio. **Testes:** `refinar.test.ts`, `dod.test.ts`. **Depende:** T-18.09, T-18.07.

### D — Estimativa
- **T-18.13 · Escalas e conversão** — `estimativa/escala.ts`: *snap* à escala, camisetas ↔ valor numérico, escala `horas`. **Aceite:** valor fora da escala é ajustado ao mais próximo **e** sinalizado; trocar de escala preserva o histórico (versão nova). **Testes:** `escala.test.ts`. **Depende:** T-18.04.
- **T-18.14 · Heurística determinística** — `estimativa/heuristica.ts`: pontos, categoria, risco com fatores explicados, criticidade (tabelas deste plano). **Aceite:** P-185 (1 item ≤ 5 ms; 500 ≤ 300 ms); mesma entrada → mesma saída; cada fator tem evidência ≤ 160 caracteres; > 13 sugere quebra. **Testes:** `heuristica.test.ts` (tabela de casos + propriedade de monotonicidade: mais sinais de alta nunca reduzem risco). **Depende:** T-18.13, T-18.06.
- **T-18.15 · Calibração e similares** — `estimativa/{calibracao,similares}.ts`: lê `HISTORICO.md`/`00-ESTIMATIVA.md` (somente leitura) e `agil_erro_estimativa`; mediana de ms/ponto por categoria (≥ 5 amostras); similares por `PortaRag`. **Aceite:** sem histórico → `null` e texto "sem base"; `HISTORICO.md` corrompido não lança; `real` (h) e `duracao observada` nunca são somados. **Testes:** `calibracao.test.ts`, `similares.test.ts`. **Depende:** T-18.14, T-18.08.
- **T-18.16 · Estimador por IA** — `estimativa/{prompt,esquema,ia}.ts`: perfil por `PortaPerfil`, lote ≤ 20, sem ferramentas, envelope saneado, esquema estrito, 1 retentativa, teto diário, job em worker com timeout 90 s, `agil:estimar`. **Aceite:** CLI headless falsa lenta (3 s) → UI responde em ≤ 50 ms (P-185); JSON inválido/enum fora/ref alheio → descartado, fica heurística; texto de task com "ignore as instruções" não altera a saída; prompt **não contém** código nem caminho absoluto (varredura). **Testes:** `ia.test.ts`, `esquema.test.ts` (adversarial), `prompt.test.ts`. **Depende:** T-18.15, T-18.03.
- **T-18.17 · Revisão humana e versões** — `estimativa/revisao.ts`, IPC `estimativa_gravar|aceitar_lote`, `classificacao_gravar`. **Aceite:** IA nunca sobrescreve `aceita|ajustada|travada`; aceitar em lote respeita confiança mínima e devolve quantas sobraram; versões append-only; `estimate_propose` (agente) entra como `sugerida`. **Testes:** `revisao.test.ts`. **Depende:** T-18.16.
- **T-18.18 · Erro de estimativa** — `estimativa/erro.ts`. Ao concluir, grava razão, viés e MdAPE por categoria. **Aceite:** valores batem com `historico-esperado.ts`; categoria com < 5 amostras → `razao=null`; reabertura não duplica linha. **Testes:** `erro.test.ts`. **Depende:** T-18.15.

### E — Retrabalho
- **T-18.19 · Detectores por fonte (puros)** — `retrabalho/detectores.ts`: `qa_reprovado` (achado alta/média; atribuição por task citada → interseção de arquivos → trabalho), `task_reaberta` (rastro e transição observada), `commit_fix` (mensagem/trailer `T-NN.MM` após `concluida_em`, `fix|hotfix|bugfix|revert|corrige`; PR com label), `regressao` (`regressao_de` da ocorrência runx + memox), `regra_repetida` (fraco). **Aceite:** cada fonte tem teste com caso verdadeiro, falso (typo/doc) e ambíguo; `chave_dedupe` estável (reprocessar não duplica). **Testes:** `detectores.test.ts` sobre a fixture. **Depende:** T-18.06, T-18.08.
- **T-18.20 · Natureza e ruído** — `retrabalho/natureza.ts`: `defeito|escopo|ruido|pendente` por regras (verbos, tipo de commit, severidade, categoria da ocorrência); `pendente` aparece na faixa `ir_max`. **Aceite:** commit `feat(T-03.04)` → `escopo`; `docs:`/`chore:` → `ruido`; mensagem ambígua → `pendente`; regra configurável. **Testes:** `natureza.test.ts`. **Depende:** T-18.19.
- **T-18.21 · Janela e situação por task** — `retrabalho/{janela,estado}.ts`: `primeira|retrabalho|em_observacao|indeterminado` (D-183). **Aceite:** task concluída ontem = `em_observacao`; após janela sem evento = `primeira`; sem rastro e sem QA = `indeterminado`; evento forte `defeito` = `retrabalho`; escopo não derruba. **Testes:** `estado.test.ts` (tabela por cenário). **Depende:** T-18.20.
- **T-18.22 · Agregação e índice** — `retrabalho/agregar.ts`: `ir`, `ir_max`, `first_time_right` por task/sprint/categoria/membro/agente/squad; "pontos retrabalhados"; "horas observadas de retrabalho (≥)" a partir de ciclos pós-reabertura; recálculo incremental. **Aceite:** P-186; números idênticos a `historico-esperado.ts`; denominador exclui `em_observacao`/`indeterminado` e os mostra; atribuição ao **autor original**. **Testes:** `agregar.test.ts`, `agil.perf.test.ts` (parcial). **Depende:** T-18.21, T-18.05.
- **T-18.23 · Marcação manual, confirmação e auditoria** — `retrabalho/marcar.ts` + IPC. Humano marca "teve retrabalho"/"feita de primeira", confirma/descarta evento, muda natureza (motivo ≥ 5 caracteres); tudo em `evento_dominio` (sem segredo). **Aceite:** agente (MCP) recebendo `human_only`; override humano persiste ao reprocessar; descartar evento não o reabre na próxima varredura. **Testes:** `marcar.test.ts`, `mcp-agil.test.ts` (parcial). **Depende:** T-18.22.

### F — Cerimônias
- **T-18.24 · Ciclo de vida da sprint** — `sprint/ciclo.ts`: planejada → ativa → fechada/cancelada, itens, compromisso inicial congelado ao iniciar, adições/remoções com `motivo`. **Aceite:** não inicia duas sprints ativas no workspace; remover item mantém histórico; compromisso inicial imutável. **Testes:** `ciclo.test.ts`. **Depende:** T-18.09.
- **T-18.25 · Capacidade e planejamento** — `sprint/{capacidade,planejamento}.ts`. **Aceite:** capacidade humana = `horas_dia × dias_úteis − ausências`, × foco ÷ horas/ponto calibrado (sem base → `sem_base` e aviso, nunca 0); sugestão respeita `depende_de` e buffer; avisos listados; ≤ 100 ms (P-188). **Testes:** `planejamento.test.ts`. **Depende:** T-18.24, T-18.15.
- **T-18.26 · Daily dos fatos** — `cerimonias/daily.ts`. **Aceite:** daily da fixture bate com o esperado (ontem/hoje/bloqueios/atrasos por membro); sem rastro mostra "sem atividade registrada", não inventa; saída "texto curto" e Markdown; ≤ 100 ms. **Testes:** `daily.test.ts`. **Depende:** T-18.07, T-18.05.
- **T-18.27 · Review e DoD por item** — `cerimonias/review.ts`. **Aceite:** só itens concluídos da sprint; resultado `aceito|ajustar|rejeitado` persiste; `ajustar/rejeitar` pode gerar item devolvido ao backlog por ação humana. **Testes:** `review.test.ts`. **Depende:** T-18.24, T-18.12.
- **T-18.28 · Retrospectiva assistida por dados** — `cerimonias/{retro,insights}.ts`. **Aceite:** insights determinísticos da fixture (top retrabalho, QA reprovado, atrasos, maiores erros, ações vencidas) idênticos ao esperado; formatos começar/parar/continuar e 4Ls; ação vira item `origem='retro'`; ação vencida publica `acao_retro.vencida`. **Testes:** `retro.test.ts`, `insights.test.ts`. **Depende:** T-18.22, T-18.18, T-18.24.
- **T-18.29 · Fechar sprint** — `sprint/fechar.ts`, `eventos.ts`. Transação: resultado por item (`concluido|carregado|devolvido|descartado`), snapshot final de métricas, `resumo_fechamento_json`, `versao_lancamento` opcional, publica `sprint.fechada`; **sugere** fechar quando tudo está concluído. **Aceite:** atômico (falha no meio não deixa metade); idempotente (fechar 2× não duplica evento); pendentes vão ao destino escolhido; nada em `docs/**`. **Testes:** `fechar.test.ts`. **Depende:** T-18.24, T-18.28, T-18.31.

### G — Métricas e gráficos
- **T-18.30 · Motor de séries e percentis** — `metricas/{serie,percentis,burn,velocidade,fluxo,cfd,wip}.ts`. **Aceite:** burndown/burnup/velocidade/CFD/cycle/lead/throughput/WIP batem com `historico-esperado.ts`; percentis por interpolação linear; amostra < 5 → `poucos_dados`; dias úteis com feriados. **Testes:** `metricas-*.test.ts` (propriedades: burnup monotônico; CFD não-decrescente em `concluida`). **Depende:** T-18.07, T-18.08.
- **T-18.31 · Planejado×entregue, defeitos escapados, distribuição, saúde, previsão** — `metricas/{planejado,defeitos,saude,previsao,previsao-worker}.ts`. Monte Carlo por bootstrap do throughput diário (≥ 10 dias e ≥ 5 conclusões, senão `dados_insuficientes`), 10 000 iterações em worker. **Aceite:** P-187; semente fixa reproduz resultado; P50 ≤ P85 ≤ P95; indicadores de saúde com fato de suporte; `tarefa.atrasada` só com ≥ 8 amostras comparáveis. **Testes:** `previsao.test.ts`, `saude.test.ts`, `defeitos.test.ts`. **Depende:** T-18.30, T-18.22.
- **T-18.32 · Biblioteca SVG própria** — `src/compartilhado/svg/**`, `--grafico-1..6` em `tokens.css` (coordenador), padrões de traço/marcador. **Aceite:** o mesmo `NoSvg` emite React **e** string idênticos (snapshot); decimação ≤ 600 elementos por série; zero cor literal fora de `tokens.css` (varredura); sem dependência nova. **Testes:** `svg.test.ts`, `decimar.test.ts`, `tokens-css.test.ts`. **Depende:** T-18.01.
- **T-18.33 · Os 16 gráficos** — `telas/agil/graficos/*.tsx` + tabela de dados em `<details>`, tooltip por *event delegation*. **Aceite:** cada gráfico renderiza a série da fixture e o estado vazio; P-182 (DOM ≤ 1 500 nós/gráfico; hover sem re-render); acessível (`<title>/<desc>`, tabela equivalente). **Testes:** `graficos.test.tsx` (snapshot + contagem de nós), `a11y`. **Depende:** T-18.32, T-18.30, T-18.31.
- **T-18.34 · Snapshots, materialização e serviço de painel** — `metricas/{snapshots,painel}.ts`. Snapshot diário e ao fechar; `agil:painel` com cache por versão de fatos; filtros sprint/pessoa/agente/squad/período. **Aceite:** P-181 (≤ 150 ms com snapshot, ≤ 400 ms recomputando) e P-190; filtro por agente muda só o que deve; invalida ao mudar fato. **Testes:** `painel.test.ts`, `snapshots.test.ts`, `agil.perf.test.ts` (parcial). **Depende:** T-18.31.

### H — XP, Lean, Kanban
- **T-18.35 · Práticas XP** — `praticas/{xp,checklists}.ts`. **Aceite:** `tdd_primeiro` e `vermelho_antes_do_verde` da fixture batem; sem rastro/VCS → `indeterminado`; checklist XP editável com itens `auto`/`manual`. **Testes:** `xp.test.ts`. **Depende:** T-18.06, T-18.08.
- **T-18.36 · Lean e limites de WIP** — `praticas/{lean,kanban}.ts`. Desperdícios, eficiência de fluxo (`null` sem fonte), valor×esforço, `limites.wip` por coluna e `wip.excedido`; `PortaBoard.limiteWip()`. **Aceite:** eficiência de fluxo `null` quando `PortaCusto` ausente; excedeu o limite → evento uma vez por episódio; sem Fase 10 aparece só na Saúde. **Testes:** `lean.test.ts`, `kanban.test.ts`. **Depende:** T-18.30.

### I — Integrações
- **T-18.37 · Tools MCP** — `mcp/tools/agil.ts`, registro no catálogo (coordenador). **Aceite:** matriz por modo/papel respeitada; `backlog_propose`/`estimate_propose` só pilot em `squad|agentico` e nunca sobrescrevem humano; agente tentando confirmar retrabalho → `human_only`; `rework_list` sem conteúdo de código. **Testes:** `mcp-agil.test.ts`. **Depende:** T-18.17, T-18.23.
- **T-18.38 · Eventos para Alertas e Documentação** — `agil/eventos.ts`, detector de atraso e de saúde. **Aceite:** `tarefa.atrasada` uma vez por episódio com `pontos`, `duracao_observada_ms`, `tokens` (null se desconhecido); `sprint.fechada` observável por assinante de teste; sem `PortaAlertas` nada quebra. **Testes:** `eventos.test.ts`. **Depende:** T-18.29, T-18.31.
- **T-18.39 · Exportação** — `agil/exportar.ts`. CSV (RFC 4180, UTF-8 BOM opcional, **proteção contra injeção de fórmula**: célula iniciada em `= + - @` recebe `'`), Markdown e JSON de backlog/métricas/daily/retro em `<userData>/agil/exportacoes/`. **Aceite:** nunca grava em `docs/**` nem fora de `<userData>`; CSV abre limpo (acentos, vírgulas, aspas, quebras); colunas documentadas no contrato. **Testes:** `exportar.test.ts`. **Depende:** T-18.34.

### J — Interface
- **T-18.40 · Casca da tela Ágil** — `telas/agil/{index,Filtros,agil.css}.tsx`, item de menu, atalhos, paleta. **Aceite:** uma única linha de controles; P-02 (troca p95 ≤ 50 ms); chunk ≤ 60 KB gz (P-183); estados vazios explicam o próximo passo. **Testes:** `Tela.test.tsx`, e2e de navegação. **Depende:** T-18.01, T-18.34.
- **T-18.41 · Backlog e painel do item** — `Backlog.tsx`, `ItemPainel.tsx`, `Estimativa.tsx`. **Aceite:** P-184 (5 000 itens; DOM ≤ 200 nós; arrastar ≤ 50 ms); estimativa mostra origem/confiança/fatores/versões; "aceitar sugestão" e "ajustar" funcionam por teclado; marcar retrabalho/primeira com motivo. **Testes:** `Backlog.test.tsx`, `Estimativa.test.tsx`. **Depende:** T-18.40, T-18.17, T-18.23.
- **T-18.42 · Sprint, Daily e Review** — `Planejamento.tsx`, `Daily.tsx`, `Review.tsx`. **Aceite:** planejar uma sprint e fechá-la só com teclado; "Copiar texto" coloca a daily na área de transferência; diálogo de fechamento é da UI (zero diálogo nativo). **Testes:** `Planejamento.test.tsx`, `Daily.test.tsx`. **Depende:** T-18.40, T-18.25, T-18.26, T-18.27, T-18.29.
- **T-18.43 · Retro e Qualidade** — `Retro.tsx`, `Qualidade.tsx`. **Aceite:** retro com painel de dados da sprint e ações com dono/prazo; Qualidade mostra IR (com faixa `ir_max`), FTR, contadores `em_observacao`/`indeterminado`, XP, Lean, checklists. **Testes:** `Retro.test.tsx`, `Qualidade.test.tsx`. **Depende:** T-18.40, T-18.28, T-18.35, T-18.36.
- **T-18.44 · Painel, Config e Início** — `Painel.tsx`, `Config.tsx`, cartão "Sprint ativa" no Início. **Aceite:** P-182; filtros afetam todos os gráficos; Config edita escalas, categorias, pesos de risco, DoD/DoR, perfil do estimador (com estado de cada CLI) e janela de retrabalho, com defaults restauráveis. **Testes:** `Painel.test.tsx`, `Config.test.tsx`. **Depende:** T-18.40, T-18.33, T-18.04.

### K — Fechamento da fase
- **T-18.45 · Desempenho, E2E, auditoria e registro** — `tests/perf/agil.perf.test.ts`, `tests/agil.e2e.test.ts`, `docs/ade/AUDITORIA-AGIL.md`. Medir P-180..P-190 (corrige-se a causa, nunca o limite); e2e do portão; auditoria (zero escrita em `docs/**`, nenhum campo de autorrelato, nenhum código em prompt/log, MCP sem poder humano); `docs/ade/perf/ultimo.json` verde; coordenador atualiza `STATUS.md`/`05-CONTRATOS.md`/`04-UI-UX.md`/`AGENTS.md`. **Aceite:** portão da fase inteiro verde; sem achado ALTA aberto. **Depende:** todas.

## Ordem de execução e paralelismo (áreas de arquivo disjuntas; ≤ 5 agentes)

```
Coordenador (sequencial, arquivos compartilhados): T-18.01 → T-18.02 → T-18.03 ─┐
Faixa 1 fatos+fixtures  (nucleo/agil/fatos, tests/fixtures/agil)    T-18.06 → T-18.07, T-18.08   │ após 18.03
Faixa 2 backlog+config  (nucleo/agil/{backlog,config,sprint/membros}) T-18.04, 18.05 → 18.09 → 18.10, 18.11, 18.12
Faixa 3 estimativa      (nucleo/agil/estimativa)                    T-18.13 → 18.14 → 18.15 → 18.16 → 18.17, 18.18   │ após 18.04, 18.06, 18.08
Faixa 4 retrabalho      (nucleo/agil/retrabalho)                    T-18.19 → 18.20 → 18.21 → 18.22 → 18.23           │ após 18.06, 18.08
Faixa 5 métricas+svg    (nucleo/agil/metricas, compartilhado/svg)   T-18.30 → 18.31 → 18.34 ; T-18.32 (independente) → 18.33
Depois: sprint/cerimônias (18.24–18.29), práticas (18.35–18.36), integrações (18.37–18.39; coordenador edita catálogo/portas),
        UI (18.40 → 18.41–18.44 em paralelo por arquivo de tela), fechamento (18.45).
```
Caminho crítico: 18.01 → 18.02 → 18.03 → 18.06 → 18.07 → 18.30 → 18.31 → 18.34 → 18.40 → 18.44 → 18.45. Dependência de **fases anteriores** (14, 9, 15, 16, 17): nenhuma é bloqueante, porque tudo entra por portas
(D-187); quando a fase existir, só se troca `Indisponivel*` pela implementação real (uma task de ligação no `main/agil.ts`, feita pelo coordenador, sem mudar contratos).

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Rastro ausente/incompleto (hooks do sprintx não registrados na instalação; contrato do `F §9`) | Tudo é melhor-esforço: `indeterminado`/`null` nunca zero; o frontmatter em disco vence; Painel mostra "N tasks sem rastro" e como habilitar |
| Retrabalho com falsos positivos (typo, escopo) | Natureza `defeito/escopo/ruido/pendente`, faixa `ir`–`ir_max`, janela de observação, confirmação humana com auditoria |
| Estimativa por IA cara ou enganosa | Heurística imediata, lote ≤ 20, teto diário de chamadas, humano nunca sobrescrito, confiança e fatores sempre visíveis, calibração por mediana |
| Pontos lidos como prazo | Rótulos "esforço relativo"/"duração observada"; previsão sempre em faixa P50/P85/P95 com amostra e aviso; nada de data única |
| Dashboards pesados com milhares de tasks | Fatos materializados, snapshots, decimação, DOM limitado, cálculo em worker, orçamentos P-181/P-182 medidos |
| Duplicar o board/custo da Fase 10 | Portas; WIP/Kanban vivem no board; custo só por `PortaCusto`; esta fase não cria quadro nem lê transcript |
| Atribuição errada a pessoa/agente | Aliases explícitos; ambíguo = "sem dono"; atribuição do retrabalho ao autor original |
| Prompt injection pelo texto de task | Envelope, saneamento, IA sem ferramentas, saída por esquema e enum fechado, nunca vira ação |
| Planos 14/16/17/20 ainda não existem | Portas com `Indisponivel*`; contratos de evento e perfis já definidos aqui |

## Pendências do dono desta fase (registrar em `PENDENCIAS-DO-DONO.md` como P-60..P-63; padrão já adotado pela regra D-140)

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-60 | **Estimativa por IA ligada por padrão** consome cota da sua assinatura (≤ 40 chamadas/dia, lote de 20 tasks) e envia o **texto das tasks** ao provedor da CLI escolhida (nunca código). Mantém ligado? | ligado, com heurística imediata, teto diário e botão para desligar (D-185) | `agil_config.estimativa_modo`, `estimativa_max_chamadas_dia` |
| P-61 | **Janela de observação do retrabalho**: 14 dias após `concluida_em` (ou até o fechamento da sprint/QA). Outro valor? | 14 dias (D-183) | `agil_config.janela_retrabalho_dias` |
| P-62 | **Capacidade de agentes**: usar a mediana das 3 últimas velocidades (padrão) ou um valor fixo por agente? Horas focadas por dia e fator de foco humanos (padrão 6 h × 0,6)? | mediana de 3; fator 0,6 (D-189) | `agil_membro`, `agil_capacidade` |
| P-63 | **Fechar a sprint** é sempre manual (o ADE só sugere). Quer a opção de fechar automaticamente quando todas as tasks estiverem `concluida` e o QA `aprovado`? | manual; opção automática disponível e desligada (D-181) | `agil_config.fechar_automatico` |
