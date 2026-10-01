---
spec: "Bench: bateria padronizada multi-modelo, score, comparação e publicação (bench.overclock.sh)"
slug: "spec-14-bench"
modulo_fonte: ["14-bench"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-02-orquestracao-modo-agentico", "spec-03-harness-roteamento-decisor", "spec-04-providers-e-modelos", "spec-08-overclock-shot"]
---
# Spec 14 — Bench

Convenção de selos: [OBS] observado (fonte entre parênteses: módulo 14-bench + Dia/arquivo); [DEC] decisão do autor da spec; [LAC] lacuna que exige decisão do dono do produto. Todo `[DEC]` traz justificativa de uma linha.

## 1. Resumo e objetivo

O Bench é o subsistema do Overclock que executa uma bateria de tarefas padronizadas (`BenchTask`) sobre vários alvos (`BenchTarget` = Provider + modelo + esforço) em paralelo, cada um em um Pane próprio em modo headless e isolado, mede custo, tempo, tokens e idas e vindas, obtém nota de qualidade de um juiz cego, calcula um score composto, armazena tudo num banco local ("banco Overclock bench"), permite comparar alvos par a par e publica os resultados no site público bench.overclock.sh, que também serve a biblioteca de prompts de teste. Problema resolvido: rankings públicos (Artificial Analysis, Arena AI) não refletem o trabalho real de vibe coding; o Bench responde, por TIPO DE ATIVIDADE, qual modelo entrega melhor, mais rápido e mais barato, e alimenta as Policy do Harness ([[spec-03-harness-roteamento-decisor]]) [OBS] (14-bench: Objetivo; Dias 49, 66).

## 2. Escopo e não-escopo

Cobre: (a) biblioteca de tarefas/prompts; (b) execução headless isolada e paralela; (c) coleta de métricas; (d) juiz cego e score; (e) banco local de resultados; (f) comparação par a par; (g) site bench.overclock.sh (comparativos, prompts copiáveis, veredito, squads recomendados); (h) exportação de recomendação por atividade para o Harness; (i) design system Nebula do front do site.

Não cobre: o roteamento em si (é do Harness), a abertura de Panes (spec-01/02), o catálogo de modelos e contas (spec-04), captura de frames/vídeo (spec-08; só citada como técnica para replicar efeitos do Nebula), cobrança de planos (spec-17).

Fase 2 (só planejado/parcial no original): consulta automática do Harness ao banco em tempo real ("planejada em 1.4"; recurso do plano Ultra) [OBS] (Dia 55, arq. 37); bench por atividade com 20+ atividades [OBS parcial] (Dia 82, arq. 06); métrica de "reference-based design" (crítica ao Arena AI) [OBS como ideia]; publicação de resultados brutos e método reprodutível público [LAC] (módulo: "não é público como método reprodutível").

## 3. Glossário e atores

- **Bench maxing**: testar os modelos sobre atividades reais do próprio histórico de prompts, em vez de olhar o benchmark do mercado [OBS] (Dia 49, Dia 82).
- **Teste seco**: execução com zero harness, sem skills, sem orquestração, sem MCP de orquestração [OBS] (Dia 61).
- **Idas e vindas (revisions)**: quantas rodadas de correção/revisão um agente precisou para chegar ao resultado [OBS] (Dia 49).
- **Juiz cego**: comando de modelo distinto dos executores que avalia entregas anonimizadas [OBS] (Dia 61).
- **Atores**: Usuário/apresentador (define a bateria, dispara e publica); Orquestrador (agente piloto que abre Panes e coleta métricas, Fable 5 na live) [OBS]; Executores (CLIs headless: Grok CLI, Claude Code, Codex, Kimi [OBS]); Juiz; Harness (consumidor); Visitante do site (leitor anônimo).

## 4. Requisitos funcionais

### RF-14.1 Biblioteca de tarefas
- RF-14.1.1 O sistema DEVE manter um catálogo de `BenchTask` com prompt versionado, categoria e critérios de julgamento. [DEC — implementar exige entidade persistida; o original mantinha prompts em pastas/site]. Aceite: CRUD de tarefa com versão incrementada a cada mudança de prompt.
- RF-14.1.2 O catálogo inicial DEVE conter as 9 tarefas da bateria do Dia 61 (seção 8.2) [OBS] (Dia 61, arq. 31). Aceite: `bench_list_tasks` retorna 9 tarefas seed.
- RF-14.1.3 As categorias de atividade DEVEM incluir ao menos: bug, feature, ajuste de CSS, revisão de código, dado sujo [OBS] (Dia 49) e as categorias criativas: 3D interativo, física/canvas, clone de site, jogo [OBS] (Dia 49/61). Categoria é campo livre extensível (`activity_type`, slug) para mapear às atividades do Harness [DEC — Harness tem 12+ tipos e 20+ atividades].
- RF-14.1.4 O sistema PODE importar prompts do histórico do usuário e agrupá-los por tipo de atividade com apoio de um modelo barato (Haiku) [OBS] (Dia 49: 6.345 prompts; Dia ~83: Haiku varrendo pasta) — algoritmo exato [LAC]. Aceite: comando de import gera candidatos `BenchTask` com `status=draft`.
- RF-14.1.5 O parâmetro de esforço NÃO DEVE ser escrito no texto do prompt; DEVE ir na configuração/flag da CLI [OBS] (Execução headless: correção do apresentador, Dia 61). Aceite: validação rejeita prompt contendo padrão de esforço (`extra high`, `effort:`) quando `effort_in_prompt_check=true`. [DEC — heurística de validação].

### RF-14.2 Execução
- RF-14.2.1 Uma `BenchRun` DEVE receber lista de tarefas × lista de alvos e disparar uma execução por par tarefa×alvo, cada uma em um Pane próprio, em paralelo até `max_parallel` [OBS: "Lança cinco agentes Grok 4.6 extra high para fazer os testes 101, 103, 104, 105 e 108" — Dia 61]. Default `max_parallel=5` [DEC — número observado na live]. Aceite: com 9 tarefas e 1 alvo, no máximo 5 Panes ativos simultâneos.
- RF-14.2.2 Cada execução DEVE rodar em diretório isolado `bench/standalone-<task_slug>/<target_slug>/` sem arquivos de outras execuções [OBS parcial: `bench/standalone-<jogo>` — Dia 61; subpasta por alvo é [DEC] para permitir vários alvos por tarefa]. Aceite: dois alvos na mesma tarefa não compartilham diretório.
- RF-14.2.3 A execução DEVE ser headless, single shot, always approve, esforço máximo (`extra high` ou equivalente do provider), sem orquestração, sem abrir Panes e sem MCP de orquestração, sem Harness/skills [OBS] (Dia 61). O esforço máximo é o default; PODE ser configurado por alvo [DEC]. Aceite: o processo iniciado não tem o MCP do Overclock em sua configuração e nenhuma skill carregada.
- RF-14.2.4 O sistema DEVE prefixar o prompt da tarefa com o cabeçalho headless (seção 8.3) [OBS] (Dia 61). Aceite: prompt efetivo salvo em `BenchResult.effective_prompt`.
- RF-14.2.5 Cada CLI DEVE ter um `HeadlessAdapter` que traduza (modelo, esforço, always-approve, workdir, prompt) para os flags da CLI; o adapter DEVE ser escrito a partir da documentação de headless da CLI [OBS: orquestrador precisou ler o guia headless do Grok — Dia 61]. Flags concretos [LAC — nunca ditos]. Aceite: adapter por provider implementa interface da seção 6b.
- RF-14.2.6 O sistema DEVE aplicar `timeout_s` por execução (default 1800) e marcar `status=timeout` sem descartar o artefato parcial [DEC — "se travar esperando, a entrega morre"; evita execução infinita; número inventado].
- RF-14.2.7 Uma execução em que o processo termina com erro DEVE ser registrada com `status=failed` e contada como `quality_score=0` no agregado, sem retentativa automática [DEC — single shot é a regra observada].
- RF-14.2.8 O usuário DEVERIA poder pedir "re-rodar" um par tarefa×alvo: apaga a pasta, recria e relança [OBS] (Dia 61: "deletar aquele trabalho... recriar aquela pasta e lançar o Grok 4.6 com extra high"). Cria novo `BenchResult` com `attempt+1`; o anterior fica `superseded`. [DEC — versionamento].
- RF-14.2.9 Se um Provider/conta estiver sem limite, o par DEVE ficar `queued` e o usuário notificado; o Bench NÃO DEVE trocar de conta silenciosamente [DEC — troca de conta muda a medição de custo; roteamento de contas é do Harness].

### RF-14.3 Métricas
- RF-14.3.1 Para cada resultado o sistema DEVE registrar: custo (USD), tempo de parede (s), tokens de saída, tokens totais, idas e vindas [OBS] (14-bench: Métricas). Tokens de entrada NÃO são usados no score ("todo mundo tem o mesmo token de entrada") [OBS]; DEVERIA ser gravado como dado informativo [DEC].
- RF-14.3.2 O custo DEVE ser obtido, em ordem de preferência: (1) relatório de uso da CLI; (2) tokens × tabela de preços do `ModelPrice` vigente na data. Moeda canônica USD; conversão BRL apenas na exibição [DEC — observado misturava R$/US$ e ficou ambíguo (Incertezas)]. Aceite: cada `BenchResult` tem `cost_source in {cli_report, price_table}`.
- RF-14.3.3 Idas e vindas DEVEM ser contadas como número de rodadas de revisão do agente executor após a primeira entrega (turnos adicionais de auto-correção). Como extrair dos logs de cada CLI [LAC]; default `revisions=null` quando indisponível [DEC].
- RF-14.3.4 Contas em assinatura (sem custo por token): o custo DEVE ser calculado por equivalente de API (tokens × preço) e sinalizado `cost_kind=api_equivalent` [DEC — plano assinatura não tem custo marginal; sem isso não há comparação].
- RF-14.3.5 O sistema DEVE tirar screenshot automático do artefato web (Chrome headless) e anexá-lo ao resultado para julgamento e vitrine [OBS] (Verificação automática; Dia 61: prints). Aceite: `artifacts[]` contém ao menos um PNG quando a tarefa é `kind=web`.

### RF-14.4 Juiz cego e score
- RF-14.4.1 O juiz DEVE receber as entregas de uma mesma tarefa sem identificação do alvo, em ordem aleatória (rótulos A, B, C…) [OBS: juiz cego não sabe quem fez — Dia 61; aleatoriedade [DEC] para evitar viés de posição].
- RF-14.4.2 O modelo juiz DEVE ser diferente dos modelos dos executores comparados [OBS: "comando de outro modelo"]. Qual modelo é o juiz [LAC — não nomeado]; default [DEC]: o modelo do Orquestrador, se não estiver entre os alvos, senão o próximo da lista `judge_models`.
- RF-14.4.3 O juiz DEVE devolver nota 0–10 por critério (`functionality`, `visual`, `completeness`, `robustness`) e nota geral, com justificativa curta (seção 8.4) [DEC — o observado só diz "score de qualidade"].
- RF-14.4.4 O juiz DEVE receber evidência objetiva anexada: resultado de execução do artefato (abre sem erro de console?), screenshots e, para tarefas com `checks[]`, o resultado de verificações automáticas [DEC — observou-se "quebrou com type error" e "rifle sem dano"; juiz sem rodar o artefato erra].
- RF-14.4.5 O score composto DEVE ser calculado pela fórmula da seção 7.2, com pesos configuráveis [DEC — pesos nunca ditos (Incertezas); fórmula simples e transparente]. O site DEVE exibir os pesos usados.
- RF-14.4.6 O sistema DEVE permitir "rejulgar" (rodar juiz de novo) sem re-executar; o julgamento cego que não roda de primeira deixa `judge_status=pending` e o resultado aparece sem score composto [OBS] (Dia 61: qualidade "pendente" até rodar).
- RF-14.4.7 O veredito por tarefa e o veredito geral DEVEM considerar custo, tokens de saída, tokens e idas e vindas ("quem realmente venceu") [OBS] (Dia 49). Regra em 7.3.

### RF-14.5 Banco e comparação
- RF-14.5.1 O sistema DEVE persistir `BenchRun`, `BenchResult`, `JudgeVerdict` num banco local do Workspace de bench [OBS: "banco Overclock bench"; formato [LAC]; SQLite [DEC]].
- RF-14.5.2 `bench_compare(a, b)` DEVE retornar, por tarefa/categoria, vencedor, deltas de custo/tempo/score e placar de categorias ("venceu em 7 categorias contra 2") [OBS] (Dia 58). Aceite: comparar dois alvos com 9 tarefas em comum devolve 9 linhas e placar somando 9 (empates contados à parte).
- RF-14.5.3 Comparação DEVE só usar resultados da mesma `task.version` e esforço declarado; resultados com versões diferentes aparecem sinalizados como não comparáveis [DEC].
- RF-14.5.4 O sistema DEVERIA gerar relatório textual de comparação a pedido, ex.: "Faz uma comparação entre o Grok 4.6 e o Fable 5 e também com o Sol 5.6" [OBS] (Dia 61). Aceite: `bench_compare` aceita N≥2 alvos.
- RF-14.5.5 Novo modelo DEVE poder ser adicionado à comparação rodando apenas a bateria dele e reutilizando resultados antigos dos demais (ex.: rodar Sonnet 5.5 com o prompt do clone da Apple já existente) [OBS] (Dia 84; Dia ~83). Aceite: `bench_run_suite` com um alvo novo não re-executa alvos existentes.

### RF-14.6 Site bench.overclock.sh
- RF-14.6.1 O site DEVE listar modelos comparáveis; clicar em dois abre o comparativo lado a lado [OBS] (Dia 58).
- RF-14.6.2 O comparativo DEVE mostrar: custo, tempo, tokens de saída, idas e vindas, score, categorias vencidas, veredito e, para tarefas web, a página gerada por cada modelo lado a lado (e o site original de referência quando houver) [OBS] (Dia 58 clone da Apple; Dia 49 veredito).
- RF-14.6.3 O site DEVE ter a rota `/prompts` com os prompts de teste copiáveis (botão copiar) [OBS] (Dia 56).
- RF-14.6.4 O site DEVE ter barra lateral "squads recomendados" sugerindo squads por ação/categoria [OBS] (Dia 49). Fonte dos dados: `squad_hint` da tarefa/categoria [DEC]; conteúdo real [LAC].
- RF-14.6.5 Cards DEVEM ter feedback de hover/foco e estados clicáveis claros [OBS: autor apontou falta de usabilidade, Dia 61].
- RF-14.6.6 Novo modelo DEVE poder ser publicado por comando (`bench_publish`) e aparecer no site sem redeploy manual de código [OBS: "já atualiza lá o site" — Dia 61; mecanismo [DEC]: snapshot JSON versionado].
- RF-14.6.7 Publicação DEVE exigir confirmação do usuário e NÃO DEVE incluir logs/prompts privados do histórico do usuário, apenas os prompts das tarefas marcadas `public=true` [DEC — privacidade; histórico pessoal é sensível].
- RF-14.6.8 O site DEVE deixar explícito que os números são de um teste próprio, com tarefas do autor, e exibir data e versão da CLI/modelo [DEC — credibilidade; o discurso do produto é contra benchmark opaco].
- RF-14.6.9 Seção "bench maxing" no site público overclock.sh com resumo da bateria e link para o vídeo [OBS] (Dia 49); fora do escopo de implementação além de expor `GET /summary.json` [DEC].

### RF-14.7 Integração com o Harness
- RF-14.7.1 O Bench DEVE expor `bench_recommend(activity_type, constraints)` que devolve lista ordenada de `BenchTarget` por score composto/decisão tentativas × tempo × custo [OBS fórmula conceitual — Dia 82; algoritmo [DEC] em 7.4]. Aceite: resposta ordenada e com `evidence` (ids de resultados).
- RF-14.7.2 O Harness DEVE poder importar o resultado como sugestão inicial de Policy, aceita/editada pelo usuário [OBS: tabela "derivada do site bench" e usuário define ordem de executores — Dia 66, 03-harness]. Aceite: `bench_export_policy` gera rascunho, nunca grava Policy sozinho.
- RF-14.7.3 A consulta automática em tempo real pelo Harness é fase 2 e DEVE estar atrás do Entitlement `bench.harness_query` (plano Ultra) [OBS] (Dia 55, arq. 37); nome do entitlement [DEC].
- RF-14.7.4 `bench_recommend` NÃO DEVE recomendar Provider desativado na UI nem sem Account ativa [OBS: diretiva do Dia 65, 03-harness].
- RF-14.7.5 Cobertura mínima: se não há ≥`min_samples` (default 1) resultados para a atividade, DEVE retornar `no_data` em vez de extrapolar [DEC].

### RF-14.8 Design system Nebula
- RF-14.8.1 O front do site DEVE usar o design system Nebula: tema dark, tokens nomeados (ex.: Solar Wind, Aurora Boreal), fundo animado em degradê/universo (Three.js), superfícies "glass" (blur) [OBS] (Dias 60/61; glass e degradê animado do X não foram reproduzidos por Grok nem Kimi na live).
- RF-14.8.2 Os tokens DEVEM viver num único arquivo (CSS custom properties + JSON) [DEC]. Valores hex [LAC].
- RF-14.8.3 O Nebula PODE ser usado como tarefa de teste de replicação de design (extração a partir de screenshots e recriação de componentes) [OBS] (Dia 61).

## 5. Modelo de dados

Persistência: SQLite local em `<workspace>/bench/bench.db` + artefatos em `<workspace>/bench/standalone-*/` [DEC]. Snapshot público: JSON estático (seção 6d). Ids: ULID string [DEC].

### 5.1 BenchTask
| campo | tipo | obrig. | default | notas |
|---|---|---|---|---|
| id | string | sim | | ULID |
| slug | string kebab | sim | | único; ex.: `solar-system-3d` |
| version | int | sim | 1 | +1 a cada mudança de `prompt` ou `checks` |
| title | string | sim | | |
| activity_type | string kebab | sim | | ex.: `feature`, `bug`, `css-fix`, `code-review`, `dirty-data`, `interactive-3d`, `canvas-physics`, `site-clone`, `game` |
| kind | enum `web`,`code`,`analysis` | sim | `web` | define captura de screenshot e checks |
| prompt | string | sim | | texto verbatim da tarefa |
| reference_urls | string[] | não | [] | ex.: apple.com/us |
| fixtures_path | string | não | null | repositório/arquivos de entrada (bugs, dados sujos, CSS) |
| checks | Check[] | não | [] | ex.: `{type:"opens_without_console_error"}`, `{type:"file_exists", path:"index.html"}` |
| judge_rubric | object | não | rubrica padrão | pesos por critério |
| public | bool | sim | true | publicável em `/prompts` |
| squad_hint | string | não | null | alimenta "squads recomendados" |
| source | enum `observed_verbatim`,`observed_paraphrase`,`authored` | sim | | rastreabilidade do prompt |
| status | enum `draft`,`active`,`retired` | sim | `draft` | |

Invariante: `active` exige `prompt` sem indicação de esforço (RF-14.1.5).

### 5.2 BenchTarget
`{ id, slug, provider_id (Provider), model, effort, cli, cli_version, account_id? (Account), label }`. Invariante: `slug = <provider>-<model>-<effort>`. Exemplo: `grok-4.6-extra-high`.

### 5.3 BenchRun
| campo | tipo | notas |
|---|---|---|
| id | string | |
| name | string | ex.: `grok-4.6-launch` |
| task_ids | string[] (com `version`) | congelado na criação |
| target_ids | string[] | |
| status | enum `queued`,`running`,`judging`,`done`,`partial`,`cancelled` | |
| max_parallel | int | default 5 |
| judge_model | string | |
| weights | `{quality,speed,cost}` | congelados na Run; default seção 7.2 |
| created_by, started_at, finished_at | | |
| orchestrator_pane_id | string? | Pane do orquestrador, se houver |

### 5.4 BenchResult (uma linha por tarefa × alvo × tentativa)
| campo | tipo | notas |
|---|---|---|
| id, run_id, task_id, task_version, target_id, attempt | | attempt default 1 |
| pane_id | string? | Pane usado |
| session_id | string? | Session do CLI |
| workdir | string | |
| effective_prompt | string | com cabeçalho headless |
| status | enum `queued`,`running`,`done`,`failed`,`timeout`,`cancelled`,`superseded` | |
| started_at, finished_at, duration_s | | |
| cost_usd | number | |
| cost_source | enum `cli_report`,`price_table` | |
| cost_kind | enum `metered`,`api_equivalent` | |
| tokens_in, tokens_out, tokens_total | int | `tokens_in` informativo |
| revisions | int? | idas e vindas |
| artifacts | `{path,type,sha256}[]` | HTML, PNG, pasta |
| checks_result | `{type,pass,detail}[]` | |
| judge_status | enum `pending`,`done`,`error` | |
| quality | number 0–10? | nota geral do juiz |
| quality_detail | object | por critério |
| composite | number 0–100? | 7.2 |
| notes | string | |

Invariantes: `composite` só existe se `judge_status=done`; `status=failed|timeout` sem artefato ⇒ `quality=0`; um par (run, task, target) tem no máximo um resultado não `superseded`.

Exemplo:
```json
{"id":"01J...","run_id":"01J...","task_id":"solar-system-3d","task_version":1,
 "target_id":"grok-4.6-extra-high","attempt":1,"status":"done","duration_s":102,
 "cost_usd":0.18,"cost_source":"cli_report","cost_kind":"metered","tokens_out":18234,
 "revisions":0,"quality":8.5,"judge_status":"done","composite":84.2}
```
(Valores do exemplo são ilustrativos, exceto US$ 0,18 / 1 min 42 s, observados no clone da Apple, Dia 61.)

### 5.5 JudgeVerdict
`{ id, task_id, task_version, run_id, judge_model, blind_map: {A:"result_id",...}, scores:{result_id:{functionality,visual,completeness,robustness,overall,rationale}}, ranking:[label], created_at }`. `blind_map` é gravado mas NÃO enviado ao juiz nem exposto antes da conclusão.

### 5.6 ModelPrice
`{ provider_id, model, price_in_per_mtok, price_out_per_mtok, cached_in_per_mtok?, valid_from }`. Valores [LAC] (dependem de tabela de preços vigente).

### 5.7 BenchSnapshot (publicação)
`{ version, generated_at, weights, targets[], tasks[public], results[public fields], comparisons_index }`. Publicado como arquivos JSON estáticos [DEC].

Ciclo de vida: Run `queued -> running -> judging -> done`; Resultados imutáveis após `done` exceto rejulgamento (recalcula `quality`/`composite`) e `superseded`. Retenção de artefatos: indefinida no local; snapshots públicos guardam somente screenshots e HTML das tarefas `public` [DEC].

## 6. Interfaces

### 6a. UI/UX

App (Overclock):
- Tela **Bench** no Workspace de bench: (1) seletor de tarefas (checkbox, filtro por `activity_type`), (2) seletor de alvos (lista de Provider/modelo/esforço dos Accounts ativos, spec-04), (3) botão "Rodar bateria", (4) grade de execuções (linha = tarefa, coluna = alvo; célula com estado, custo, tempo, nota), (5) painel de detalhe com preview do artefato e screenshot, (6) botão "Julgar", "Comparar", "Publicar" [DEC — o original era conduzido por conversa com o orquestrador; a tela é a forma mínima de tornar isso implementável].
- Interface conversacional [OBS]: o orquestrador PODE executar tudo via tools MCP da 6c a partir de frases como as da seção 8.5.
- Cada execução ocupa um Pane visível na lateral, como no original [OBS] (Dia 61); botão para ocultar Panes de bench [DEC].

Site bench.overclock.sh (Nebula):
- `/` grade de modelos (cards com hover e foco; seleção de dois habilita "Comparar"); resumo do placar.
- `/compare/<a>/<b>` comparativo lado a lado: cabeçalho com veredito, tabela por tarefa (custo, tempo, tokens de saída, idas e vindas, score), miniaturas com iframe/imagem do artefato, reference URL ao lado.
- `/model/<slug>` histórico do alvo.
- `/prompts` lista de tarefas públicas: título, categoria, texto do prompt, botão "Copiar".
- Barra lateral "Squads recomendados".
- Rotas são [DEC] exceto `/prompts` [OBS].
- Responsivo; tema dark único; estados vazio/carregando/erro definidos [DEC].

Nebula (tokens mínimos, [DEC] exceto nomes marcados [OBS]):
```css
:root{
  --nebula-bg:#05060a;             /* [LAC valor] fundo universo */
  --nebula-solar-wind:#ffb454;     /* [OBS nome Solar Wind; hex DEC] */
  --nebula-aurora-boreal:#3ef0c0;  /* [OBS nome Aurora Boreal; hex DEC] */
  --nebula-glass-bg:rgba(255,255,255,.06);
  --nebula-glass-blur:16px;        /* efeito glass exigido [OBS] */
  --nebula-text:#eaf0ff;
}
```

### 6b. API interna / eventos

Serviço `BenchService` (in-process do app; IPC para a UI) [DEC].
- `HeadlessAdapter` (por CLI):
```
interface HeadlessAdapter {
  cli: string
  buildCommand(o:{model,effort,workdir,prompt,always_approve:true}): {cmd:string[],env:Record<string,string>}
  parseUsage(stdout:string, logs:string[]): {tokens_in?,tokens_out?,cost_usd?,revisions?}
}
```
- Eventos (nome, payload): `bench.run.created {run_id}`; `bench.result.started {result_id,pane_id}`; `bench.result.finished {result_id,status,duration_s,cost_usd}`; `bench.judge.started {run_id,task_id}`; `bench.judge.finished {task_id,verdict_id}`; `bench.run.finished {run_id,status}`; `bench.snapshot.published {version,url}`. [DEC]
- Reuso de Panes: cada execução usa `pane spawn` da spec-02 com `mode=headless`, `mcp=none`, `skills=none`, `cwd=<workdir>` [DEC — contrato mínimo esperado, ver Dependências].

Dependências (contrato mínimo esperado de outras specs):
- spec-01/02: abrir Pane headless com cwd, comando arbitrário, capturar stdout, ser notificado de término, fechar Pane.
- spec-03: aceitar `bench_export_policy` como rascunho e chamar `bench_recommend` (fase 2).
- spec-04: listar Provider/Account/modelos disponíveis e limites; `ModelPrice`.
- spec-08: (opcional) gravação em frames para replicação de efeitos do Nebula.
- spec-17: Entitlement `bench.harness_query` no Plan Ultra.

### 6c. Tools MCP (namespace `overclock`; nomes [DEC])
| tool | entrada (JSON) | saída | erros |
|---|---|---|---|
| `bench_list_tasks` | `{activity_type?:string,status?:string}` | `{tasks:BenchTask[]}` | — |
| `bench_run_suite` | `{name?,task_slugs:string[]\|"all",targets:[{provider,model,effort}],max_parallel?:int,skip_existing?:bool}` | `{run_id,planned:int}` | `unknown_task`, `target_unavailable`, `account_limit_reached` |
| `bench_run_status` | `{run_id}` | `{status,grid:[{task,target,status,cost_usd,duration_s,quality}]}` | `not_found` |
| `bench_rerun` | `{run_id,task_slug,target}` | `{result_id}` | `not_found`, `still_running` |
| `bench_judge` | `{run_id,task_slug?,judge_model?}` | `{verdict_ids:string[]}` | `judge_conflicts_with_executor`, `no_results` |
| `bench_compare` | `{targets:string[≥2],task_slugs?,group_by?:"task"\|"activity_type"}` | `{rows,scoreboard:{[target]:wins},verdict}` | `not_comparable` |
| `bench_recommend` | `{activity_type,constraints?:{max_cost_usd?,max_duration_s?,providers?:string[]}}` | `{ranking:[{target,composite,cost,duration,samples,evidence:[result_id]}]}` ou `{no_data:true}` | `unknown_activity` |
| `bench_export_policy` | `{activity_types?:string[]}` | `{draft_policies:[...]}` | — |
| `bench_publish` | `{run_ids?:string[],dry_run?:bool}` | `{snapshot_version,url,diff}` | `judge_pending`, `not_confirmed` |
Regras: `bench_publish` sem `confirm:true` na sessão devolve `not_confirmed` [DEC].

### 6d. Protocolos externos
- Site: arquivos estáticos `snapshot/latest.json`, `snapshot/<version>.json`, `artifacts/<task>/<target>/...` [DEC]. Hospedagem [LAC] (Vercel/Cloudflare citados sem detalhe); qualquer host estático serve.
- CLIs dos providers via subprocesso headless; nenhum protocolo próprio.

## 7. Fluxos e algoritmos

### 7.1 Fluxo de uma Run
1. Usuário/orquestrador chama `bench_run_suite`; valida tarefas `active` e alvos com Account e limite disponível.
2. Para cada tarefa: cria `workdir` limpo, copia `fixtures_path` se houver (apaga qualquer conteúdo anterior) [OBS re-run, Dia 61].
3. Escalona pares respeitando `max_parallel`; cada par abre Pane headless (spec-02) e roda `HeadlessAdapter.buildCommand`.
4. Ao término: coleta `duration_s`, uso via `parseUsage`, calcula custo, executa `checks`, tira screenshot (Chrome headless) se `kind=web`.
5. Quando todos os alvos de uma tarefa terminam: `judging` — monta pacote cego (7.5), chama juiz, grava `JudgeVerdict`.
6. Calcula `composite` por tarefa (7.2) e agregados por alvo/categoria.
7. Run `done` (ou `partial` se algum par ficou `queued/cancelled`); emite eventos; abre a grade.
8. Opcional: `bench_compare`, `bench_publish`.

Máquina de estados de BenchResult:
| estado | evento | novo estado |
|---|---|---|
| queued | slot livre | running |
| queued | cancelar | cancelled |
| running | processo sai 0 | done |
| running | processo sai ≠0 | failed |
| running | estoura `timeout_s` | timeout |
| running | cancelar | cancelled |
| done/failed/timeout | rerun | superseded (novo result em queued) |
Estados de Run: queued -> running -> judging -> done; qualquer -> cancelled; done com pares pendentes -> partial.

### 7.2 Score composto [DEC — pesos nunca ditos; escolha simples e explicável]
Por tarefa t e conjunto de alvos A comparados na mesma tarefa/versão:
```
Q = quality/10                          # 0..1, do juiz
S = min_dur(t,A) / dur(target)          # 0..1, mais rápido = 1
C = min_cost(t,A) / cost(target)        # 0..1, mais barato = 1
composite = 100 * (wq*Q + ws*S + wc*C), default wq=0.6, ws=0.2, wc=0.2
```
- Justificativa dos pesos: qualidade domina porque "entrega quebrada" invalida velocidade e preço (Dia 61 tratou quebra como falha, mesmo com custo baixo) [DEC].
- Portão de qualidade: se `quality < 4` ou `checks` críticos falham, `S` e `C` são forçados a 0 (modelo barato que quebra não pontua por ser barato) [DEC].
- Se `revisions` disponível: `composite *= max(0, 1 - 0.05*revisions)` (penaliza idas e vindas; Sonnet 5 com ~15 idas [OBS, Dia 73] chegaria a 0.25 do valor) [DEC — coeficiente].
- Se a tarefa tem apenas um alvo, `S=C=1` e o score só reflete qualidade; a UI DEVE marcar "score não comparável" [DEC].
- Agregado por alvo = média simples dos `composite` por tarefa; por categoria = média dentro da `activity_type` [DEC].
- Pesos são por Run e exibidos no site.

### 7.3 Veredito
Vencedor da tarefa = maior `composite`; empate (|Δ|<1,0) ⇒ menor custo, depois menor `revisions` [DEC — a ordem custo → tentativas reflete "dinheiro, tokens, idas e vindas" do Dia 49]. Placar de categorias = contagem de tarefas vencidas ("7 contra 2") [OBS Dia 58]. Veredito geral em texto gerado por template com números (não por LLM) para ser reprodutível [DEC].

### 7.4 Recomendação por atividade
```
candidates = results where task.activity_type == X and status in (done) and judge_status == done
group by target; avg composite, avg cost, avg duration, n
filter by constraints and by active Provider/Account
rank by composite desc
attach expected_attempts = 1 + mean(revisions or 0)
expected_cost = avg_cost * expected_attempts    # tentativas x custo
expected_time = avg_duration * expected_attempts # tentativas x tempo
```
Modo `strategy` opcional: `best_quality` | `cheapest_acceptable(min_quality)` | `fastest_acceptable(min_quality)` [DEC — o usuário decide o limite de tolerância a falhas: OBS Dia 82].

### 7.5 Pacote cego
1. Coletar artefatos finais de cada resultado; remover metadados (nome do modelo, paths com slug do alvo, comentários com "Grok", "Claude" etc. via busca simples) [DEC].
2. Embaralhar e rotular A, B, C.
3. Enviar prompt do juiz (8.4) + prompt original da tarefa + screenshots + resultado de `checks`.
4. Validar resposta contra schema; em falha, 1 nova tentativa; depois `judge_status=error`.
Caso-limite: artefato ausente ⇒ resultado excluído do julgamento e `quality=0`.

### 7.6 Publicação
1. `bench_publish dry_run` gera diff do snapshot.
2. Usuário confirma; sistema gera JSON + artefatos públicos; sobe para o host; emite `bench.snapshot.published`.
3. Erros: `judge_pending` se algum resultado incluso não tem julgamento; bloqueia.

### 7.7 Casos-limite
- Grok 4.6 fora do site no dia do lançamento: publicar é ação manual explícita; modelos sem snapshot não aparecem [OBS Dia 61].
- Dois alvos do mesmo provider em contas diferentes: distintos apenas por `account_id` se `label` distinto [DEC].
- Modelo com `cost_kind=api_equivalent` misturado a `metered`: site mostra selo [DEC].
- Preço mudou depois da execução: custo permanece congelado no `BenchResult` [DEC].

## 8. Prompts e textos embutidos

### 8.1 Regra geral
Tarefas rodam com prompt curto e do usuário, sem instruções de skills. O prompt de bateria NÃO contém esforço (RF-14.1.5).

### 8.2 Biblioteca de prompts (bateria de 9 do Dia 61)
Mapeamento de ids 101–108 [LAC]: as falas citam os IDs 101, 103, 104, 105, 108 numa rodada e "101 a 108" no total, mas não dizem qual id é qual teste; a bateria tem 9 testes. Ordem aproximada [OBS parcial]. Prompts literais só existem para (1); os demais têm `source=authored` com prompt-base [DEC] (a ser substituído pelo original quando o dono o fornecer).

1. **solar-system-3d** — [OBS, lido da tela, paráfrase próxima] (Dia 61):
```
Crie um único arquivo HTML, sistema solar 3D interativo, o Sol no centro e os oito planetas orbitando em velocidades realistas.
(implementar em Three.js; HTML único e autocontido)
```
2. **canvas-physics-lab** (laboratório de física com bolinhas em Canvas) — prompt literal [LAC]. Base [DEC]: "Crie um único arquivo HTML com um laboratório de física em Canvas: bolinhas com gravidade, colisão entre si e com as paredes, e controles para adicionar bolinhas e alterar a gravidade."
3. **apple-site-clone** — clone do site da Apple; usou apple.com/us como referência; menu, logo, cards de iPad Air, MacBook, Apple Watch, AirPods Pro 3 [OBS] (Dia 61). Prompt literal [LAC]; o Dia 84 diz existir "prompt específico" e que o site da Apple "não é o site completo". Base [DEC]: "Clone a home de https://www.apple.com/us/ em HTML/CSS/JS: menu, logo, hero e cards de produtos. Fidelidade visual máxima."
4. **fps-dust2** — jogo FPS estilo Dust 2 [OBS]; prompt disponível em `bench.overclock.sh/prompts` [OBS Dia 56] mas nunca lido em voz alta [LAC]. Base [DEC]: "Crie um FPS jogável no browser (Three.js) ambientado em um mapa estilo Dust 2, com armas com dano real, inimigos que morrem, munição, HUD e efeitos sonoros."
5. **debug-find-and-fix** — encontrar e corrigir bug [OBS]; prompt e fixture [LAC]. Base [DEC]: repositório com bug conhecido + "Encontre e corrija o bug que faz X; explique a causa."
6. **css-responsive** — CSS responsivo [OBS]; [LAC]. Base [DEC]: página fornecida quebrando em mobile + "Torne responsiva sem alterar o conteúdo."
7. **code-review** — [OBS]; [LAC]. Base [DEC]: diff com defeitos plantados + "Revise e liste problemas por severidade."
8. **refactor-existing-code** ("fil código existente") — [OBS ruidoso]; [LAC] se é refactor ou preenchimento de código. Base [DEC]: função/módulo existente + "Refatore mantendo o comportamento e os testes."
9. **dirty-data** — dados sujos [OBS]; [LAC]. Base [DEC]: CSV sujo + "Normalize, deduplique e reporte o que foi corrigido."

Tarefas extras headless, fora da bateria [OBS] (Dia 61): GTA-like ("Costa Neon"/"Praia Rosa"), Minecraft-like ("Overcraft"), Project Zomboid-like, Need for Speed. Outras citadas em rodadas anteriores sem prompt: cidade GTA, Guitar Hero, galáxias, plano de evacuação, Doom jogável (Dia 51); jogo 3D com som (Dia 55); landing "igual da Apple" com design system (Dia 44) — todos [LAC] quanto ao texto.

Prompt Minecraft, headless [OBS, quase verbatim] (Dia 61). Nota: "Não dê like para overclock" é provável ruído de transcrição de "não dependa do Overclock" [DEC]; manter o texto original no registro e usar a versão corrigida na execução:
```
Você vai criar o jogo Minecraft com o máximo de esforço possível.
Trabalhe somente nesse diretório. Implemente você mesmo. Não dê like para overclock. Não abra painéis. Não chame MCP de orquestração. Não peça confirmação humana.
O que entregar: um clone jogável do Minecraft no browser, first person voxel, que abre com index.html (ou npm run dev se precisar de bundler; nesse caso deixe README).
Não use assets oficiais. Escopo máximo: não entregue um cubo e um chão.
```

### 8.3 Cabeçalho headless (prefixo) [OBS] (Dia 61, GTA)
```
Você está em modo headless, single shot, always approve, extra high. Ninguém vai responder pergunta, aprovar passo, nem continuar a sessão. Se travar esperando, a entrega morre. Trabalhe somente nesse diretório.
Escopo: não entregue um cubo, um chão e um carro que não entra. Deve ter jogador, veículo, combate e lei, missões...
```
Nota [DEC]: o produto DEVE gerar o cabeçalho genérico (primeiro parágrafo) sem a palavra "extra high" (esforço vai na flag, RF-14.1.5) e o segundo parágrafo é específico de cada tarefa (campo `scope_hint`).

### 8.4 Prompt do juiz cego [LAC — não observado]; base [DEC]
```
Você é um avaliador imparcial. Você receberá o pedido original e N entregas anônimas (A, B, C...). Você não sabe quem as produziu; não tente adivinhar.
Para cada entrega, avalie de 0 a 10: functionality (funciona sem erros e cumpre o pedido), visual (qualidade visual e fidelidade à referência), completeness (escopo entregue vs. pedido; penalize "um cubo e um chão"), robustness (bugs, erros de console).
Use as evidências fornecidas (screenshots, resultado dos checks). Se uma entrega quebra ao abrir, functionality <= 2.
Responda somente JSON: {"scores":{"A":{"functionality":0,"visual":0,"completeness":0,"robustness":0,"overall":0,"rationale":"..."}},"ranking":["A","B"]}
```

### 8.5 Frases de operação do orquestrador [OBS] (Dia 61 e ~83)
```
Lança cinco agentes Grok 4.6 extra high para fazer os testes 101, 103, 104, 105 e 108. Após isso, faz a mensuração dos custos, velocidade de entrega, tokens etc. e adiciona lá no nosso banco.
```
```
Faz agora uma comparação entre o Grok 4.6 e o Fable 5 e faz também uma comparação com o Sol 5.6.
```
```
Realiza a criação de um jogo do zero com o máximo de effort possível, no modo always approve, em background, via headless, e não roda isso por aqui (pela sessão principal).
```
```
Eu fiz diversos testes de benchmark entre GPT 6 Sol, Astra, Opus 5.5 e Fable 5.1. Eu quero que você identifique esses prompts dentro da pasta YouTube e traga uma atualização do nosso benchmark para a gente fazer as comparações de preços. Começa com uma versão do 5.5 e uma versão do GPT 6 Sol, testados hoje. Lança painéis high para encontrar rapidamente as informações, através do Haiku.
```
O texto "Antes de você continuar com esse teste, você vai deletar aquele trabalho... e você vai lançar o Grok 4.6 com extra high" [OBS] corresponde ao fluxo `bench_rerun`.

## 9. Requisitos não-funcionais

- Desempenho (observado, como ordem de grandeza): clone da Apple Grok 1 min 42 s / US$ 0,18; Fable 5 2 min 31 s / US$ 0,94; FPS Grok 6 min 53 s / US$ 0,66; debug 0,09 vs 0,11; CSS 0,10 vs 0,70; code review 0,11 vs 0,69; refactor 0,09 vs 0,49; dados 0,24 vs 0,83; sistema solar 0,20 vs 0,78 [OBS] (Dia 61). A bateria de 9 com 5 em paralelo DEVERIA terminar em menos de 20 min para um alvo rápido [DEC — derivado dos tempos]. Overhead do Bench (spawn+coleta) DEVE ser < 5 s por execução [DEC].
- Paralelismo: até 5 execuções simultâneas por padrão; teto por Provider respeitando limites de Account [DEC].
- Portabilidade: macOS/Windows/Linux; uso de Chrome headless para screenshots exige Chrome/Chromium instalado; caminhos com `path.join` [DEC].
- Segurança: execução always-approve roda código gerado por IA sem confirmação; DEVE rodar confinada ao `workdir` (sandbox de cwd, sem acesso a segredos do Cofre, variáveis de ambiente mínimas e sem tokens do Overclock) [DEC — risco real de always-approve]. Rede liberada apenas se a tarefa tiver `reference_urls` [DEC].
- Privacidade: prompts do histórico do usuário ficam locais; só `public=true` é publicado; anonimizar nomes de projetos [DEC].
- Custo: bateria completa multiplica por nº de alvos (referência: ~R$ 100 de tokens para 5 tarefas Opus 5 vs Fable 5, Dia 51 [OBS]); DEVE exibir estimativa antes de disparar e exigir confirmação acima de `cost_confirm_usd` (default 10) [DEC].
- Observabilidade: log estruturado por resultado (comando, exit code, stdout/stderr truncados), eventos da seção 6b; custo acumulado por Run [DEC].
- Reprodutibilidade: gravar `cli_version`, `model`, `effort`, `task.version`, data [DEC]; o original é "100% dependente do histórico do autor" [OBS].

## 10. Stack sugerida e restrições

Original [OBS]: site front próprio tema dark; Overclock com painéis paralelos e MCP interno; CLIs headless (Grok CLI, Claude Code, Codex, Kimi); juiz cego via comando de outro modelo; Three.js para testes 3D; Chrome headless/prints; Haiku para varrer prompts; Kimi K3 para o design system Nebula; hospedagem Vercel/Cloudflare sem detalhe.
Alternativas neutras [DEC]: SQLite (banco local); Playwright ou Chrome DevTools Protocol para screenshots; site estático (Astro/Vite/Next export) + JSON; qualquer host estático/CDN; fila em processo (sem broker) para o escalonador; schema validation com JSON Schema.
Restrições: cada CLI tem flags próprios (adapter obrigatório); modelos de assinatura não expõem custo por token; o juiz não pode estar entre os executores.

## 11. Plano de implementação em fases

- **Fase 0 (base)**: modelo de dados, `BenchTask` seed (9), `BenchTarget`, `ModelPrice`, banco SQLite.
- **Fase 1 (MVP)**: 1 adapter (Claude Code) + 1 (Codex); execução isolada headless em Panes; métricas de tempo/tokens/custo; screenshot; grade na UI; sem juiz (nota manual). Depende de spec-01/02/04.
- **Fase 2**: juiz cego (pacote 7.5, prompt 8.4), score composto, `bench_compare`, adapters Grok e Kimi, re-run, checks automáticos.
- **Fase 3**: `bench_publish` + site (/, /compare, /prompts, /model) com Nebula; snapshot estático.
- **Fase 4**: `bench_recommend` + `bench_export_policy` para o Harness (spec-03); importador de histórico + classificação por Haiku; squads recomendados.
- **Fase 5 (fase 2 do original)**: consulta automática do Harness em tempo real atrás de Entitlement Ultra; bench por atividade (20+); métrica de reference-based design; método reprodutível público.
Ordem de dependência: 0 -> 1 -> 2 -> (3 e 4 em paralelo) -> 5.

## 12. Casos de teste de aceitação

1. Caminho feliz — Dado 9 tarefas seed e 1 alvo `grok-4.6-extra-high` com Account ativa, Quando `bench_run_suite` com `max_parallel=5`, Então nunca há mais de 5 Panes em `running`, as 9 execuções terminam em `done`, cada uma com `cost_usd`, `duration_s`, `tokens_out` preenchidos.
2. Isolamento — Dado duas tarefas de jogo, Quando executam, Então cada uma roda em `bench/standalone-<slug>/<target>` e o processo não enxerga o MCP de orquestração nem skills (verificado pela config passada ao adapter).
3. Esforço fora do prompt — Dado tarefa cujo prompt contém "extra high", Quando ativada, Então a validação rejeita; e o adapter passa o esforço como flag.
4. Juiz cego — Dado 2 alvos na mesma tarefa, Quando `bench_judge`, Então o pacote enviado não contém nomes dos modelos, a ordem A/B é aleatória entre execuções, `blind_map` só é revelado após o veredito, e o juiz não é um dos executores (senão erro `judge_conflicts_with_executor`).
5. Falha do juiz — Dado juiz que devolve JSON inválido duas vezes, Então `judge_status=error`, `composite` fica nulo, resultado exibido como pendente e a Run não vai a `done` sem rejulgamento ou decisão do usuário.
6. Portão de qualidade — Dado alvo barato cujo artefato quebra ao abrir (quality<4), Então `S=C=0` e o composite fica abaixo de um alvo mais caro que funciona.
7. Timeout — Dado execução que passa de `timeout_s`, Então `status=timeout`, artefato parcial preservado, `quality` julgada se houver artefato, senão 0.
8. Re-run — Dado resultado `failed`, Quando `bench_rerun`, Então pasta apagada e recriada, novo resultado `attempt=2`, anterior `superseded`, e a comparação usa somente o novo.
9. Comparação — Dado dois alvos com 9 tarefas em comum, Quando `bench_compare`, Então placar soma 9 (vitórias A + vitórias B + empates) e deltas de custo/tempo estão corretos; tarefas de versões diferentes vão como `not_comparable`.
10. Novo modelo incremental — Dado banco com 3 alvos, Quando `bench_run_suite` com um 4º alvo e `skip_existing=true`, Então só o 4º roda e o comparativo inclui os 4.
11. Publicação — Dado resultados com `judge_pending`, Quando `bench_publish`, Então erro `judge_pending`; com tudo julgado e `confirm`, snapshot publicado e `/prompts` lista só tarefas `public=true` com botão copiar funcional.
12. Recomendação — Dado resultados para `activity_type=css-fix` de 3 alvos, Quando `bench_recommend` com `providers=[x]` onde x está desativado, Então x não aparece; sem dados para outra atividade retorna `no_data`.
13. Limite de conta — Dado Account sem limite, Quando a Run inclui esse alvo, Então os pares ficam `queued` com aviso e não há troca de conta silenciosa.

## 13. Questões em aberto e riscos

Todas as [LAC]:
1. Pesos do score composto (qualidade/velocidade/custo) [LAC — nunca ditos]; default [DEC] 0,6/0,2/0,2.
2. Mapeamento dos ids 101–108 aos 9 testes e prompts literais de 2–9, FPS e clone da Apple incluídos [LAC].
3. Modelo usado como juiz cego e seu prompt [LAC].
4. Flags de headless por CLI (Grok, Claude Code, Codex, Kimi) [LAC].
5. Como extrair "idas e vindas" dos logs de cada CLI [LAC].
6. Hierarquia dos números de prompts (6.345 / 460 / ~6.500 / 20+ atividades / 12+ políticas) e método de classificação [LAC].
7. Formato do banco e hospedagem/stack real do site; publicação de resultados brutos [LAC].
8. Valores hex dos tokens Nebula (Solar Wind, Aurora Boreal) e como obter glass/degradê animado [LAC].
9. Estado real da consulta automática do Harness ao banco (Ultra vs planejada 1.4) [LAC].
10. Conteúdo real da barra "squads recomendados" [LAC].
11. Tabela de preços/`ModelPrice` e tratamento de R$/US$ do original [LAC].
Riscos: [DEC] mais arriscadas: (a) fórmula normalizada por mínimo (S, C) muda quando um novo alvo entra, invalidando comparações antigas — mitigado por congelar pesos e recomputar apenas no conjunto da comparação; (b) juiz LLM tem viés e pode ser gamificado; (c) always-approve executando código gerado exige sandbox real; (d) custo equivalente de API para assinaturas não é custo real do usuário.

## 14. Rastreabilidade

| requisito | fonte |
|---|---|
| RF-14.1.1–1.3 | 14-bench: Bateria de 9 testes, categorias (Dia 49, Dia 61, arq. 42/31) |
| RF-14.1.4 | 14-bench: Dados-base (Dia 49, Dia ~83; arq. 42/08) |
| RF-14.1.5 | 14-bench: Execução headless isolada (Dia 61, arq. 31) |
| RF-14.2.1 | Prompts: "Lança cinco agentes..." (Dia 61) |
| RF-14.2.2–2.5 | Funcionamento: Isolamento; Execução headless (Dia 61) |
| RF-14.2.8 | Prompts: "deletar aquele trabalho..." (Dia 61) |
| RF-14.2.6, 2.7, 2.9 | [DEC] |
| RF-14.3.1, 3.5 | Funcionamento: Métricas; Verificação automática (Dia 61) |
| RF-14.3.2–3.4 | [DEC] / Incertezas (R$/US$) |
| RF-14.4.1–4.2, 4.6 | Juiz cego (Dia 61) |
| RF-14.4.3–4.5 | [DEC] / Incertezas (pesos) |
| RF-14.4.7 | Comportamento: veredito (Dia 49, arq. 42) |
| RF-14.5.1 | Banco "Overclock bench" (Dia 61) |
| RF-14.5.2, 5.4 | Dia 58 (arq. 34); Dia 61 |
| RF-14.5.5 | Dia 84 (arq. 03); Dia ~83 (arq. 08) |
| RF-14.6.1–6.3 | Dia 58 (arq. 34); Dia 56 (arq. 36); Dia 49 |
| RF-14.6.4, 6.9 | Dia 49 (arq. 42) |
| RF-14.6.5 | Dia 61 (feedback de UX) |
| RF-14.6.6 | Dia 61 ("já atualiza lá o site") |
| RF-14.7.1–7.4 | 14-bench: Ligação com o Harness (Dia 55, 65, 66, 82); 03-harness |
| RF-14.8.1–8.3 | Design system Nebula (Dia 60 arq. 32; Dia 61 arq. 31) |
| Seção 8.2–8.5 | Prompts, receitas, comandos e textos (Dia 61, ~83) |
| Seção 9 números | Bateria de 9 testes (Dia 61); Dia 51 |
