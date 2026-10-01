# Digest F — O framework expxdev (método Expx) e como um ADE Electron pode integrá-lo

Fontes lidas (somente leitura): `/Users/thuliobittencourt/orca/projects/ExpxDev/` (`.claude/skills/*/SKILL.md` e references, `.claude/hooks/*.sh`, `.claude/settings.json`, `.expx/expx-lock.json`, `.expx/marketplace/plugins/expx/{hooks,commands,nucleo}`, `.opencode/commands`) e o repositório `bittencourtthulio/expxdev` (README, `docs/contrato/CONTRATO-expx-schema-v1.md`, `CONTRATO-expx-eventos.md`, `CONTRATO-expx-estado.md`, `src/servidor`, `src/parser`).

## 0. Panorama e estado da instalação local

**O que é.** expxdev é o CLI (`npx expxdev init|panel|add|remove|update|grafo|doctor`, v0.9.0, lock v1) que instala nove skills do método Expx como um plugin local do Claude Code (`expx@expx-local`, marketplace em `.expx/marketplace`) e como comandos do OpenCode. As skills são Markdown com instruções para o modelo. O painel (`expx panel`, porta 4000, somente leitura, só 127.0.0.1) lê o `docs/` e mostra o andamento.

**Skills no lock (`.expx/expx-lock.json`)**: sprintx, runx, legadox, stackx, mergex, memox, prodx, buildx, designx. Cada uma tem `repositorio`, `referencia: main`, `travado: false`, `commit` e sha256 de cada arquivo. O `modulex` existe no ambiente do usuário mas não está no lock.

**Estado observado em `/Users/thuliobittencourt/orca/projects/ExpxDev`** (útil como linha de base para o que o ADE deve tolerar):
- Existem `.claude/{settings.json,hooks,skills}`, `.opencode/commands` (48 comandos sem namespace), `.expx/{expx-lock.json,marketplace}`.
- NÃO existem: `docs/`, `.gitignore`, `.expx/hooks.json`, `.expx/estado.json`, `.expx/memoria/`, `.claude/agents/`, `plugin/agents/`. O `doctor` trata `.gitignore` sem `.expx/` como erro.
- **Não há agentes instalados** (nenhum `agents/` no plugin nem em `.claude/`). O README diz que hooks e agentes "vivem nos repositórios das skills"; o `init` hoje monta só skills, comandos, hooks e `nucleo`. Quando o agente falta, a skill roda a fase ela mesma, como sempre rodou (sprintx SKILL: "a skill nunca fica bloqueada por falta de agente").
- **`hooks.json` do plugin registra só um subconjunto** (ver seção 3). Hooks de sprintx, mergex, legadox, stackx e designx existem em disco em `hooks/<skill>/` mas não estão registrados neste `hooks.json`.
- Os comandos aparecem como `/expx:<nome>` no Claude Code (namespace do plugin) e `/<nome>` no OpenCode.

---

## 1. As skills, uma a uma

Convenções gerais válidas para todas:
- Raiz de trabalho = raiz do repositório git mais próxima (`.git/`, inclusive arquivo `.git` de worktree). `docs/` é ancorado nela.
- A fase é detectada pelo disco, nunca por `.expx/estado.json`.
- Toda gravação de estado tem frontmatter YAML `expx_schema: 1`. Datas ISO, enums minúsculos sem acento, chave nunca omitida (`null`/`[]`).
- Caminhos sempre relativos nos artefatos.
- Quase todos os comandos aceitam `$ARGUMENTS`. Sem argumento usam "o trabalho em andamento" e, se houver mais de um, **perguntam qual** (ponto a tratar no ADE: sempre passar o argumento).

### 1.1 sprintx (Build, feature nova) — F1..F6 (+F3.5)

Pasta do trabalho: `docs/sprintx/features/<slug-da-feature>/` (formato novo). Pastas antigas `docs/<slug>/` continuam válidas (a fase é deduzida pelo conteúdo). `<slug>` = minúsculas, sem acento, hifens, derivado do pedido; reutiliza slug existente compatível.

**Como detectar a fase atual (tabela literal do SKILL.md):**

| Estado do disco | Fase |
|---|---|
| `base/` não existe | F1 |
| `base/` existe, `00-DECISOES.md` não | F2 |
| `00-DECISOES.md` existe, `sprint-01/` não | F3 |
| `sprint-01/` existe, `ORQUESTRADOR.md` não | F4 |
| `ORQUESTRADOR.md` existe, sem auditoria aprovada | F5 |
| `00-AUDITORIA.md` contém `VEREDITO: SIM` | F6 |

F3.5 (estimativa) é opcional e não aparece na tabela: só quando o usuário pede (`/sprintx-estimar`), grava `00-ESTIMATIVA.md`, nunca bloqueia F4/F5.

| Fase | Comando | Entrada | Saída (arquivos exatos) |
|---|---|---|---|
| F1 Ingestão | `/expx:sprintx-base` | pedido do usuário; opcionalmente `BRIEFING.md` do prodx, `CONVENCOES.md` | Abre worktree (com git): `git worktree add -b feature/<slug> ../<repo>--<slug> <base>`, copia `.claude/settings.json`/`.env`, instala deps. Grava `base/00-INDICE.md` (`kind: base_indice`), `base/<recurso>.md` (sem frontmatter), `base/00-LACUNAS.md` (sem frontmatter), `00-BLOQUEIOS.md` (`kind: bloqueios`), garante `docs/eventos/` no `.gitignore`. Regra: nada de invenção, "NÃO DOCUMENTADO". Com git e outra feature aberta na árvore: worktree resolve; sem git pergunta. |
| F2 Descoberta | `/expx:sprintx-descoberta` | `base/` | `00-DECISOES.md` (`kind: decisoes`): D-00 (densidade `mvp/padrao/completo/profundo` + forma `entrevista/autonomo`), D-NN com `status: fechada\|pendente`, `bloqueante`, `alternativa_descartada`, `motivo` (em modo autônomo começa com `(HIPOTESE)`). Sete eixos obrigatórios, perguntas em blocos de no máx. 5. **Única fase que pergunta** (exceção: decisão nova detectada na F3). |
| F3 Plano | `/expx:sprintx-sprints` | `00-DECISOES.md` sem PENDENTE bloqueante | `sprint-NN/` com 3 arquivos (`sprint.md` `kind: sprint`, `fases.md` `kind: fases` com bloco Mermaid, `tasks.md` `kind: tasks`) OU, se a sprint tem uma fase só, `sprint-NN/tasks.md` com `kind: plano` (condensado). Deriva `modulo_afetado` e `palavras_chave`. Primeira sprint entrega capacidade de testar (config/client/harness/fixtures). |
| F3.5 | `/expx:sprintx-estimar` | plano pronto | `00-ESTIMATIVA.md` (`kind: estimativa`, faixa min/max, nunca número único, esforço não prazo); `docs/sprintx/estimativas/HISTORICO.md` (`kind: estimativa_historico`, append-only, calibração por mediana). |
| F4 Orquestrador | `/expx:sprintx-orquestrador` | `sprint-01/` | `ORQUESTRADOR.md` (`kind: orquestrador`, 8 seções: objetivo, mapa, rota, ferramentas, agentes, regras de autonomia, definição de pronto, como retomar). |
| F5 Auditoria | `/expx:sprintx-auditoria` | `ORQUESTRADOR.md` | `00-AUDITORIA.md` (**sem frontmatter**), tabela de achados ALTA/MEDIA/BAIXA e linha exata `VEREDITO: SIM` ou `VEREDITO: NÃO`. Existe achado ALTA → NÃO → volta à F3 (plano é REGERADO, nunca editado à mão). |
| F6 Execução | `/expx:sprintx-executar` | auditoria SIM | Task a task: `task_iniciada` → testes vermelhos → implementa → `suite: parcial` (subconjunto afetado) → `revisor-testes` (solido/fraco) → `status: concluida` + `concluida_em` + linha `real: X h`. Bloqueio vai para `00-BLOQUEIOS.md` e a task é pulada. Portão de sprint: suíte inteira, 0 failed, árvore limpa. Fecha com `ORQUESTRADOR.md` (`arquivos_alterados` preenchido, `estagio: f6`, `status: concluido`, `concluido_em`), `FECHAMENTO.md` (`kind: fechamento`), `HISTORICO.md`. Nunca pergunta. |

`/expx:sprintx` (sem sufixo) detecta a fase e continua. Observação: o plano é sempre (sprint → fase `F-NN.M` → task `T-NN.MM`).

**Regras de estado/status**
- Orquestrador: `estagio` f1..f6; `status` `nao_iniciado|em_andamento|bloqueado|concluido`.
- Task: `pendente|em_andamento|concluida|bloqueada`; `suite` `verde|vermelha|parcial|nao_executada`.
- Decisão: `fechada|pendente`.
- Regra 21: uma feature por árvore; `worktree` (caminho relativo) gravado no `ORQUESTRADOR.md`.

### 1.2 runx (Run, ocorrência em produção) — E1..E5

Pasta: `docs/manutencao/<OC-ID>-<slug>/` + histórico permanente `docs/relatorios/`. `OC-ID` = do ticket ou `OC-<AAAA>-<NNNN>` sequencial. slug até 6 palavras.

**Detecção do estágio (tabela do SKILL.md):** pasta não existe = E1; `base/` sem `01-CAUSA-RAIZ.md` = E1.b; causa raiz sem `sprint-01/` = E2; `sprint-01/` sem `ORQUESTRADOR.md` = E2 (concluir); `ORQUESTRADOR.md` com task pendente = E3; todas concluídas sem `QA.md` = E4; `QA.md` com `VEREDITO: APROVADO` = E5; `VEREDITO: REPROVADO` = volta ao E3. Único retorno invisível ao disco: teste de regressão passa antes do fix, volta ao E1 (registrado na causa raiz).

| Estágio | Comando | Saída |
|---|---|---|
| E1 Investigação | `/expx:runx-causa` (runx abre: texto, ticket ou arquivo) | Com git abre worktree (`../<repo>--<OC-ID>-<slug>`), cria `00-OCORRENCIA.md` (`kind: ocorrencia`, relato literal, `tem_reproducao`, `worktree`), `BLOQUEIOS.md` vazio, `base/00-INDICE.md`, `base/00-LACUNAS.md`, `base/<area>.md`, `01-CAUSA-RAIZ.md` (`kind: causa_raiz`, `modo: causa_raiz\|analise_impacto`, `comprovada`, `evidencia`, `arquivos_impactados`, `decisoes[]`). Tipo `bug` exige causa raiz comprovada. Única pergunta permitida: bug sem reprodução. |
| E2 Plano | `/expx:runx-plano` | `sprint-01/tasks.md` (`kind: plano`, condensado: 1 sprint e 1 fase) ou 3 arquivos se houver mais de uma; `ORQUESTRADOR.md`. Primeira task da primeira fase carrega `teste_regressao` (obrigatório em bug). |
| E3 Fix | `/expx:runx-fix` | TDD: regressão falha antes do fix. Sem perguntas; dúvida vai a `BLOQUEIOS.md`. `suite: parcial` por task. |
| E4 QA | `/expx:runx-qa` | `QA.md` (`kind: qa`, `veredito: aprovado\|reprovado`, `achados[]` com `severidade` alta/media/baixa) e a linha `VEREDITO: APROVADO|REPROVADO`. Roda a suíte inteira. "Quem implementa não aprova." Árvore contaminada adia o E4. |
| E5 Relatório | `/expx:runx-relatar` | `docs/relatorios/<AAAA-MM-DD>-<OC-ID>-<slug>/tecnico.md` (`kind: relatorio_tecnico`, 12 seções) e `uso.md` (`kind: relatorio_uso`, 4 seções, sem jargão), `docs/relatorios/INDICE.md` (`kind: relatorios_indice`, append-only, topo = mais recente), `ORQUESTRADOR.md` com `estagio: e5`, `status: concluido`. Dispara reindexação do memox. O deploy é externo. |

Tipos: `bug | melhoria-ui | melhoria-ux | novo-relatorio | regra-de-calculo | campo-novo | outro`. `/expx:runx` (sem sufixo) faz o roteamento.

### 1.3 prodx (produto: decide SE há trabalho) — P0..P5

Roda antes de sprintx/runx. Pasta: `docs/produto/` com `PRODUTO.md`, `LACUNAS.md`, `INDICE.md` (append-only, uma linha por pedido) e `pedidos/<PD-ID>-<slug>/` (só em avaliação completa; `PD-<AAAA>-<NNNN>`).

| Estágio | Comando | Saída |
|---|---|---|
| P0 Triagem | `/expx:prodx-triar` | linha no `INDICE.md`, sem pasta; oito gatilhos G1..G8; nenhum disparo = veredito direto |
| P1 Contexto | `/expx:prodx-produto` | `docs/produto/PRODUTO.md` (signatário nunca vazio; provisório aceito) |
| P2 | `/expx:prodx-avaliar` (P2..P5) | `01-pedido.md`; pergunta densidade e forma de construção |
| P3 | `/expx:prodx-existe` (isolada) | `02-existencia.md` (EXISTE / EXISTE PARCIAL, com evidência) |
| P4 | (dentro de avaliar) | `03-avaliacao.md` (sete perguntas, escopo mínimo) |
| P5 | (dentro de avaliar) / `/expx:prodx-briefing` | `VEREDITO.md`, `BRIEFING.md` (só `fazer`/`fazer_outra_coisa` com assinatura humana) |

Vereditos: `ja_existe | nao_fazer | fazer_outra_coisa | fazer`. Assinatura humana (`aprovado_por`, `aprovado_em`, iniciam `PENDENTE`) **nunca preenchida pela skill** (exceto buildx em modo autônomo). `BRIEFING.md` carrega `destino: sprintx|runx`, `densidade_sugerida`, `modo_construcao_sugerido`. **Pegadinha de formato:** os frontmatters do prodx usam `schema: expx-schema-v1` e `pd_id`, não `expx_schema: 1`/`trabalho_id`; um parser tem de tratar isso à parte. Kinds: `produto, pedido, existencia, avaliacao, veredito, briefing, produto_indice`.

Estado por disco: sem `PRODUTO.md` = P1; pedido novo = P0; `01-pedido.md` sem `02-existencia.md` = P3; existência diz EXISTE = P5; `03-avaliacao.md` sem `VEREDITO.md` = P5; `VEREDITO.md` sem assinatura = aguarda humano; assinado como `fazer` sem briefing = gera briefing. `/expx:prodx` (roteador) mostra pedidos abertos e a proporção triagem vs. avaliação completa (o indicador de saúde: taxa de pedidos que NÃO viram trabalho).

### 1.4 stackx (camada: dialeto técnico) — 5 etapas

Saída central: `docs/stack/CONVENCOES.md` (cada regra com `Evidência: arquivo:linha`; sem evidência = `PROPOSTA`, que nunca governa) e `docs/stack/LACUNAS.md`. Comandos: `/expx:stackx` (roteador), `/expx:stackx-detectar` (Etapas 1-2, agente `cartografo`), `/expx:stackx-check` (aderência de diff/pasta: tabela severidade/arquivo/convenção/correção), `/expx:stackx-atualizar` (diff, nunca sobrescreve em silêncio), `/expx:stackx-migracao` (cartuchos: migração segura, N+1 no ORM, teste instável). Diante de dialetos conflitantes, pergunta. Precedência: com `docs/legado/PERFIL.md`, o PERFIL manda na área tocada; stackx só em código novo em arquivo novo. Modo de detecção de fase: presença de `CONVENCOES.md` (sem ele os hooks que dependem dele ficam inativos).

### 1.5 legadox (camada: rigor para legado) — 11 camadas

Não acrescenta fase; muda o rigor. **Gatilho é um arquivo:** `docs/legado/PERFIL.md` existe = modo legado ativo. Estrutura: `docs/legado/{PERFIL.md, LACUNAS.md, DIVIDA.md (append-only), raio/<trabalho_id>.md, manual/<trabalho_id>.md, comparacao/<trabalho_id>.md}`; caracterização e reversão também têm templates. Comandos: `/expx:legadox` (roteador), `legadox-perfil`, `legadox-raio`, `legadox-caracterizar`, `legadox-divida`, `legadox-manual`.

Raio por sinais: BAIXO (≤3 chamadores, sem zona de risco/migração, com cobertura), MEDIO, ALTO (>15 chamadores, zona de risco, migração ou dado histórico). Orçamentos por task: BAIXO 5 arq/150 linhas, MEDIO 3/80, ALTO 2/40. ALTO exige aprovação humana registrada no arquivo de raio ("Aprovado por: ..."). **Os artefatos do legadox NÃO têm frontmatter `expx-schema`** (decisão DL-23), a faixa está em prosa (`## FAIXA: BAIXO|MEDIO|ALTO`). O painel não os lê; o ADE teria de parsear texto ou ler `estado.json.raio`.

### 1.6 memox (camada: memória)

Índice invertido local, derivado e descartável: `.expx/memoria/{indice.json, config.json, ultima-indexacao}` (gitignorados). Fontes: `docs/relatorios/*/tecnico.md`, `INDICE.md`, `docs/manutencao/*/01-CAUSA-RAIZ.md`, decisões, `DIVIDA.md`, `base/00-LACUNAS.md`, `QA.md`, `docs/entregas/*/ENTREGA.md`. Sinais: nº de trabalhos por arquivo, reprovações em QA, regressão (exige evidência causal), zona de risco, dívida, faixa de atenção. Limites de ruído: 3 entradas recentes por arquivo + regressões/QA/zona; >8 só a contagem.

CLI direto (Python, sem modelo, sem rede, determinístico): `python3 .claude/skills/memox/assets/memox.py {indexar|reindexar|estado|injetar|arquivo <caminho>|modulo <nome>|buscar <termo>|trabalho <id>} [--raiz R] [--formato F]`. Comandos de skill: `/expx:memox`, `memox-indexar`, `memox-arquivo`, `memox-modulo`, `memox-buscar`. Este é o **único componente do método que é API de verdade** (executável), por isso o ADE pode chamá-lo sem passar pelo modelo.

### 1.7 mergex (entrega) — E0..E9

Artefatos: `docs/entregas/<trabalho_id>/{ENTREGA.md (kind: entrega), QA-PACOTE.md, ATENCAO.md, PR.md}` (os três últimos sem frontmatter; `PR.md` é sempre gravado).

| Etapa | Comando | O que faz |
|---|---|---|
| E0 Abertura | `/expx:mergex-abrir` | Início da F6 (sprintx) ou do E3 (runx). Exige árvore limpa; escolhe base; cria branch: `feature/<slug>`, `fix/<OC-ID>-<slug>` (bug), `chore/<OC-ID>-<slug>` (demais); convenção do repositório/CONVENCOES vence. Branch existente é retomada. |
| E1 Commit por task | (automático) | um commit por task `concluida` com suíte verde; varredura de segredo. |
| E2 Portão | `/expx:mergex-check` | dez verificações; saída binária `RESULTADO: PRONTO` ou `BLOQUEADO`; grava `portao: pronto|bloqueado`. BLOQUEADO encerra. |
| E3 Atenção | `/expx:mergex-atencao` | três faixas: OLHO OBRIGATÓRIO / LEITURA RÁPIDA / DISPENSÁVEL por arquivo (tamanho de diff não é critério; histórico de regressão do memox sobe a faixa, nunca desce). Agente `revisor-diff`. |
| E4 PR / E5 Pacote de QA / E6 Push / E7 Abertura | `/expx:mergex-pr`, `/expx:mergex-qa` | Nunca push forçado, nunca na principal. PR via CLI do host; sem CLI grava `PR.md` e informa. |
| E8 Registro | (dentro de `mergex-pr`) | `ENTREGA.md`: `estado`, `versionado`, `branch`, `branch_base`, `commits[{task,commit}]`, `modulo_afetado`, `arquivos_alterados`, `faixa_atencao[{arquivo,faixa}]`, `raio`, `atencao{olho_obrigatorio,leitura_rapida,dispensavel}`, `portao`, `desvios`, `push_feito`, `pr_url`, `pr_estado`, `criado_em/atualizado_em/entregue_em`. |
| E9 Revisão e merge | `/expx:mergex-revisar` | **MANUAL, nunca encadeado**, nunca resolve conflito, nunca faz merge sem confirmação do PR específico. Agente `analista-de-conflito` (sem escrita nem execução). |

Posição no fluxo: sprintx: E0 no início da F6, E1 por task, E2-E8 ao fim. runx: E0 no início do E3, E2-E8 **entre o E4 e o E5** (a mergex entrega, a runx fecha). Atenção à colisão de nomes: E0..E9 da mergex ≠ E1..E5 da runx. `pr_estado`: `null|rascunho|aberto|merged|fechado`.

### 1.8 buildx (projeto inteiro) — B1..B6

`/expx:buildx <descrição>` faz **uma única pergunta** (modo `autonomo` ou `briefing`) e conduz prodx → stackx → sprintx → mergex por feature, recursivamente. Estado por disco em `docs/projeto/`:

| Etapa | Gatilho de disco | Saída |
|---|---|---|
| B1 Concepção | `PROJETO.md` não existe | `docs/produto/PRODUTO.md`, `docs/projeto/PROJETO.md` (`kind: projeto`, `etapa`, `total_features`, `features_entregues`, `features_bloqueadas`, `ciclos_recursao`), `PREMISSAS.md`, `VEREDITO.md` auto-assinado (`provisorio: true`, `aprovado_por: buildx (modo autonomo)`) |
| B2 Fundação | `CONVENCOES.md` não existe | `docs/stack/CONVENCOES.md` com `origem: decidido_pelo_buildx`; copia `template/` (Next.js + Prisma + auth + design system + 4 telas P-9, suíte verde, `FT-01` com `origem: template`) |
| B3 Decomposição | `MAPA.md` não existe | `docs/projeto/MAPA.md` (`kind: mapa`; features `FT-NN` com `slug`, `entrega`, `depende_de`, `paralelizavel`, `origem: descricao\|premissa\|recursao`, `status: pendente\|em_andamento\|entregue\|bloqueada`) |
| B4 Construção | há feature nem `entregue` nem `bloqueada` | laço por feature: `mergex-abrir` → sprintx F1 → F2 respondida pelo buildx (`respondido_por: buildx`) → F3-F5 → F6 → `mergex-check` → `mergex-pr`. Bloqueio nunca para o laço. |
| B5 Recursão | todas entregues/bloqueadas e `RECURSAO.md` desatualizado | `RECURSAO.md` (`ciclo_atual`, `teto_ciclos`, `pendencias_abertas/resolvidas`); classes `trabalho_novo\|replanejamento\|decisao_humana\|recurso_externo` |
| B6 Validação | `VALIDACAO.md` não existe | `VALIDACAO.md` (`veredito: aprovado\|aprovado_com_pendencia\|reprovado`), `RELATORIO.md` |

Comandos: `/expx:buildx`, `buildx-mapa`, `buildx-retomar`, `buildx-status`. Regra 8: **nunca invoca `mergex-revisar`**; merge é humano. Ponte entre níveis: todo artefato de trabalho sob buildx ganha `origem_buildx: <projeto_id>` e `feature_id: FT-NN` no frontmatter. Depende de prodx, stackx, sprintx e mergex (se faltar alguma, diz qual e para).

### 1.9 designx (camada: design)

Detecta/cartografa o design system e audita. Artefatos: `docs/design-system/{DESIGN-SYSTEM.md (kind: design_system, origem, consistente, drift_detectado), RESUMO.md, AUDIT.md (kind: design_audit, veredito aprovado|reprovado, violacoes, avisos, adocao_tokens), LOG.md (kind: design_log, rotação de tom/padrão), DIVIDA.md (kind: design_debt)}`. `expx_tool: designx` (fora do enum do schema v1 do contrato, que só aceita sprintx|runx|buildx). Integra com sprintx (F1 gera RESUMO, F3 tasks de UI ganham `design_refs` e `tom_estetico`, F5 gate `auditor-design`, F6 stamp na primeira linha do CSS `/* designx · padrao: ... */`) e runx (E1-E5). 18 regras (estrutura = bloqueio, estilo = alto, qualidade = médio) e 10 "tells de IA". Comandos: `/expx:designx`, `designx-cartography`, `designx-audit`, `designx-status`. Hook `designx-cartografa` nasce em bloqueio (exceção à regra de aviso).

### 1.10 `/expx:onboarding`

Comando do plugin (não é skill): varre quais camadas (prodx, stackx, designx, legadox, memox) estão instaladas e sem mapeamento (`PRODUTO.md`, `CONVENCOES.md`, `DESIGN-SYSTEM.md`, `PERFIL.md`, `.expx/memoria/indice.json`) e dispara o comando real de cada uma na ordem de dependência. Nunca sobrescreve mapeamento existente. É o ponto natural de "projeto novo no ADE".

---

## 2. Contratos compartilhados

### 2.1 `expx-schema` v1 (estado em Markdown+YAML)

Todo arquivo de estado: bloco `---` como primeira coisa; quatro chaves de cabeçalho `expx_schema: 1`, `expx_tool: sprintx|runx|buildx`, `kind`, `trabalho_id` (ou `projeto_id` nos kinds buildx). Regras R1..R14 no `CONVENCOES.md` do repositório do painel: snake_case, enums sem acento, data ISO via `date +%Y-%m-%d`, booleano sem aspas, chave nunca omitida, frontmatter é a única fonte para máquina, texto de uma linha, `atualizado_em` reescrito a cada gravação, sem caminhos absolutos. Chave obrigatória ausente é **violação** (o arquivo continua visível); frontmatter ilegível ou `kind` desconhecido ou versão maior é **rejeição**.

**Kinds do contrato:** `orquestrador, sprint, fases, tasks, plano, bloqueios, ocorrencia, causa_raiz, qa, base_indice, relatorio_tecnico, relatorio_uso, relatorios_indice` + buildx `projeto, premissas, mapa, recursao, validacao, relatorio`. As skills ainda gravam kinds que o contrato do painel não lista: `decisoes, estimativa, estimativa_historico, fechamento` (sprintx), `entrega` (mergex, com `expx_tool: runx`), kinds do prodx e do designx.

**Enums:** `estagio` sprintx f1..f6, runx e1..e5, buildx b1..b6. `status` (trabalho/sprint/fase) `nao_iniciado|em_andamento|bloqueado|concluido`. `status` (task) `pendente|em_andamento|concluida|bloqueada`. `suite` `verde|vermelha|parcial|nao_executada` (concluida+parcial NÃO é violação; vermelha e nao_executada são). `tipo_trabalho` `feature|ocorrencia`. `veredito` `aprovado|reprovado`. `severidade` `alta|media|baixa`.

**Frontmatter essenciais:**
- `orquestrador`: `trabalho_id, titulo, tipo_trabalho, tipo_ocorrencia, estagio, status, criado_em, atualizado_em, concluido_em, sprints[], caminho_critico[], modulo_afetado[], arquivos_alterados[], palavras_chave[], worktree`.
- `tasks`/`plano.tasks[]`: `id (T-NN.MM), titulo, fase (F-NN.M), status, objetivo, arquivos (lista, ou {cria,altera}), teste_regressao, teste_integracao, teste_funcional, criterio_aceite, depende_de[], paralelizavel, concluida_em, suite`.
- `fases.fases[]`: `id, titulo, status, criterio_saida, paralelizavel, paralela_com[], tasks[]`.
- `bloqueios.bloqueios[]`: `id (B-NN), task, aberto_em, resolvido_em, descricao`.

**Grafo do plano.** Não é um arquivo de dados: é derivado de `depende_de` (arestas `T-xx → T-yy`), `paralelizavel`/`paralela_com`, `fase`. O caminho crítico é CALCULADO (o campo `caminho_critico` do orquestrador é só declaração a conferir). Três formas partem da mesma topologia: bloco Mermaid `flowchart LR` em `fases.md` (classes `concluida/andamento/bloqueada/pendente/critico`, atualizado só em cor durante a F6), `docs/<id>/GRAFO.svg` (`npx expxdev grafo [trabalho] [--conferir]`, `--conferir` sai com código 1 em ciclo ou dependência inexistente) e `/grafo.svg?trabalho=<id>` do painel.

**Descoberta.** Trabalho = pasta com `ORQUESTRADOR.md` `kind: orquestrador`; também entra ocorrência (`00-OCORRENCIA.md`) ainda sem plano (estágio deduzido: e1, ou e2 se existir `01-CAUSA-RAIZ.md`). O painel varre por NOME de arquivo (não por `.md`): `ORQUESTRADOR.md, 00-BLOQUEIOS.md, BLOQUEIOS.md, 00-DECISOES.md, 00-OCORRENCIA.md, 01-CAUSA-RAIZ.md, QA.md, sprint.md, fases.md, tasks.md, INDICE.md, tecnico.md, uso.md` e `00-INDICE.md` só dentro de `base/`. Nunca lê `00-LACUNAS.md`/`00-AUDITORIA.md`. Também descobre trabalhos em **outras branches locais** via `git show`, sem checkout (`<branch>::<caminho>`), com a branch ativa vencendo.

### 2.2 `expx-eventos` v1 (rastro append-only)

Arquivo: `docs/eventos/<trabalho_id>.jsonl` (`trabalho_id` = slug da feature ou `<OC-ID>-<slug>`), uma linha JSON por evento, ignorado pelo git (a F1 garante no `.gitignore`), rotação acima de 5 MB para `<id>.1.jsonl`, `.2`... (o leitor deve ler todos). Ninguém edita; escrita por append.

**Doze chaves obrigatórias, nesta ordem:** `ts` (UTC ISO `...Z`), `expx_eventos` (=1), `trabalho_id`, `ferramenta`, `origem` (`skill|hook`), `evento`, `fase`, `task`, `agente`, `resultado` (`ok|falha|aviso|bloqueado`), `detalhe`, `arquivos[]`. Chaves extras vêm depois: `hook`, `faixa` (contrato) e, nas linhas gravadas pelo runtime atual, `sessao` (`<harness>@<id-da-sessão>`) e `harness` (vistos em `expx_rastro.py`; o contrato publicado ainda não os declara). Um validador deve checar contenção das doze, nunca igualdade estrita.

```json
{"ts":"2026-08-29T14:32:10Z","expx_eventos":1,"trabalho_id":"OC-2026-0142","ferramenta":"runx","origem":"hook","evento":"task_concluida","fase":"e3","task":"T-01.02","agente":"principal","resultado":"ok","detalhe":"suite verde, 14 testes","arquivos":["src/frete/calculo.ts"]}
```

**Vocabulário de `evento`:** `fase_iniciada, fase_concluida, task_iniciada, task_concluida, task_bloqueada` (skill); `suite_executada, arquivo_alterado` (hook PostToolUse); `regra_violada` (hook em aviso); `acao_bloqueada` (hook em bloqueio); `agente_iniciado, agente_concluido` (SubagentStop/skill); `veredito_emitido` (auditor/QA); `commit_criado, pr_aberto` (mergex). Também aparece `estado_nao_gravado` no runx. `ferramenta`: sprintx, runx, mergex, legadox, stackx, memox, prodx, buildx. `agente`: `principal, auditor-plano, revisor-testes, qa, investigador, cartografo, revisor-diff, analista-de-conflito, avaliador-de-raio`. Duração por task = `task_iniciada` → `task_concluida` (`duracao_observada`, tempo de parede, não esforço; usar mediana).

**Sem `regra_avaliada`:** passagem limpa de hook é silenciosa (lacuna declarada no contrato).

### 2.3 `expx-estado` v1 (`.expx/estado.json`)

Arquivo minúsculo para barra de status, somente exibição, derivado e descartável, gitignorado, < 1 KB, escrita atômica (tmp+rename). Campos: `expx_estado:1, atualizado_em, trabalho, ferramenta, titulo_curto (<=30), fase, task, tasks_concluidas, tasks_total, raio, orcamento_arquivos ("usadas/teto"), orcamento_linhas, branch, pr_estado, bloqueios`. Donos: sprintx/runx (trabalho, ferramenta, titulo_curto, fase, task, contagens), legadox (raio, orçamentos), mergex (branch, pr_estado), quem registrar bloqueio (bloqueios). Cada dono só altera seus campos (ler-alterar-gravar). Sem trabalho aberto, `trabalho/fase/task` = `null` (arquivo continua). **Só existe se `.expx/` já existe** (as skills não criam). Não há um único trabalho global: é "o trabalho atual" do checkout, o que é frágil com várias sessões/worktrees.

---

## 3. Hooks, modos e agentes

### 3.1 Registro no Claude Code (`.claude/settings.json`)

Hooks do projeto (raiz): `UserPromptSubmit` → `.claude/hooks/expx-lembrete.sh` e `memox-injetar.sh`; `Stop` → `memox-reindexar.sh`. E o plugin `expx@expx-local` habilitado (extraKnownMarketplaces aponta para `.expx/marketplace`, com caminho ABSOLUTO do checkout, o que não sobrevive a worktree/clone em outro caminho sem `init`).

- `expx-lembrete.sh`: casa o prompt (minúsculo, sem acento) contra padrões e injeta `additionalContext` mandando ler a skill (no máx. uma): memox (passado: "já aconteceu", "regressão"), stackx, mergex (PR/branch/commitar), prodx ("seria bom se", "vale a pena"), runx ("bug", "não funciona", "errado"...), sprintx ("implementar", "refatorar", "integrar com"). Só sugere skill instalada; falha aberta. Existe porque a descrição da skill sozinha não disparava.
- `memox-injetar.sh`: injeta o que o índice sabe dos arquivos/módulos citados (timeout 2 s, silencioso se sem artefato).
- `memox-reindexar.sh`: no Stop, reconstrói índice em background.

`hooks/hooks.json` do plugin (este é o registro efetivo hoje):
- `PreToolUse Write|Edit` → `despachante.py comum/segredo-no-commit runx/causa-antes-do-plano runx/regressao-antes-do-fix runx/task-so-fecha-verde runx/escopo-da-ocorrencia runx/uma-ocorrencia-por-arvore runx/task-reivindicada`.
- `PreToolUse Bash` → `runx/arvore-limpa-antes-da-suite`.
- `PostToolUse Write|Edit` → `comum/rastro-arquivo runx/sem-jargao-no-uso`.
- `PostToolUse Bash` → `comum/rastro-suite`.

Hooks presentes em disco mas NÃO registrados aqui: `hooks/sprintx/*` (arvore-limpa-antes-da-suite, escopo-da-task, sem-placeholder-no-plano, task-reivindicada, task-so-fecha-verde, tdd-teste-antes), `hooks/mergex/*` (arquivo-fora-do-plano, commit-por-task, pr-so-com-portao) e `comum/{sem-segredo, git-perigoso, branch-limpa, rastro-subagente}.sh`, `hooks/legadox/*` (7), `hooks/stackx/*` (aderencia, sem-convencoes), `hooks/designx/*` (3). Tratar como "disponíveis, não ativos" até rodar o doctor ou ler `hooks.json` efetivo.

### 3.2 Modos e `.expx/hooks.json`

Três modos obrigatórios: `aviso` (registra `regra_violada` no rastro, deixa passar), `bloqueio` (registra `acao_bloqueada`, exit 2, stderr volta ao modelo), `desligado` (nada, nem registra). Métodos nascem em `aviso`; segurança nasce em `bloqueio` e nunca é rebaixada por arquivo ausente, só por `desligado` explícito. Formato (contrato): `{"expx_hooks":1,"hooks":{"segredo":{"modo":"bloqueio","tipo":"seguranca"},...}}`. Formato real do plugin (`hooks.exemplo.json`): `{"hooks":{"segredo-no-commit":"bloqueio","causa-antes-do-plano":"aviso",...}}`; o runtime aceita string OU objeto `{modo}`; legadox traz `modos.padrao.json` aninhado por skill. Arquivo ausente (caso atual): valem os padrões de nascimento. Promoção aviso→bloqueio é decisão humana guiada pelas violações acumuladas no rastro.

**Tabela de hooks por skill (nome, evento, nascimento):**
- Comum: `segredo-no-commit`/`sem-segredo` (Pre escrita, **bloqueio**), `git-perigoso` (Pre Bash, **bloqueio**), `branch-limpa` (**bloqueio**), `rastro-arquivo` (Post, registra `arquivo_alterado`), `rastro-suite` (Post Bash, `suite_executada`, resultado pelo exit code).
- runx: `causa-antes-do-plano`, `regressao-antes-do-fix`, `task-so-fecha-verde`, `escopo-da-ocorrencia`, `sem-jargao-no-uso`, `uma-ocorrencia-por-arvore`, `task-reivindicada`, `arvore-limpa-antes-da-suite` (todos aviso).
- sprintx: `escopo-da-task`, `task-so-fecha-verde`, `sem-placeholder-no-plano`, `tdd-teste-antes` (inativo sem CONVENCOES.md), `task-reivindicada`, `arvore-limpa-antes-da-suite`, mais `segredo` e `git-perigoso` (bloqueio).
- mergex: `sem-segredo`, `git-perigoso`, `branch-limpa` (bloqueio), `commit-por-task`, `arquivo-fora-do-plano`, `pr-so-com-portao` (aviso).
- legadox: `zona-de-risco` e `aprovacao-em-raio-alto` (**bloqueio**), `raio-antes-do-plano`, `caracterizacao-antes`, `orcamento-de-mudanca`, `reversao-declarada`, `sem-colateral` (aviso). Nenhum hook de método roda em raio BAIXO.
- stackx: `aderencia` (Post escrita), `sem-convencoes` (SessionStart, injeta uma linha). `PROPOSTA` e `CONFLITO EM ABERTO` nunca geram violação.
- designx: `designx-cartografa` (**bloqueio**, exceção), `designx-audit` (aviso), `designx-token-check` (sob demanda).

Regras de todo hook: rápido (<200 ms), silencioso quando passa, falha aberta (segurança falha fechada), sem rede, mensagem acionável, sem estado próprio. No OpenCode: bloquear = lançar exceção em `tool.execute.before`; aviso = anexado ao resultado em `tool.execute.after` (ponte `runx-ponte.js`). No Claude Code em `PostToolUse`, **stderr não chega ao modelo**; só JSON `additionalContext` no stdout.

### 3.3 Agentes e ferramentas

Agentes de veredito são SOMENTE LEITURA (estrutural: "aponta, não corrige"); um agente sem `tools:` no Claude Code herda TODAS as ferramentas, por isso o campo é obrigatório.

| Agente | Usado por | Ferramentas |
|---|---|---|
| `auditor-plano` | sprintx F5 | leitura |
| `revisor-testes` | sprintx F5/F6, runx E3 | leitura (runx: leitura + rodar teste) |
| `qa` | runx E4 | leitura + rodar suíte |
| `investigador` | runx E1, sprintx F1, legadox | leitura + busca |
| `cartografo` | stackx, legadox | leitura + busca + histórico git; escreve só em `docs/stack/` (stackx) ou `docs/legado/` (legadox) |
| `revisor-diff` | mergex E3 | leitura |
| `analista-de-conflito` | mergex E9 (manual) | leitura, sem execução |
| `avaliador-de-raio` | legadox camada 2 | escreve só em `docs/legado/raio/` |
| `cartografo-visual`, `auditor-design` | designx | `Read, Glob, Grep` |

Nenhum agente grava o artefato: devolve o conteúdo e a sessão principal grava com o frontmatter. Arquivos: `.claude/agents/<nome>.md` e `.opencode/agent/<nome>.md` (OpenCode restringe por `permission:`, sem campo `tools:`). **Nesta instalação nenhum desses arquivos existe.**

---

## 4. O que o painel do expxdev lê e mostra

- `npx expxdev panel [--porta 4000] [--dir ./docs] [--no-open] [--dias-bloqueio 7]`. Servidor Node HTTP+WebSocket só em 127.0.0.1; qualquer método que não seja GET retorna `405 "o painel e somente leitura"`.
- Rotas: `/api/projeto` (estado inteiro), `/api/conformidade` (violações), `/api/rejeicoes`, `/api/historico`, `/api/memoria` (null se sem índice), `/api/saude`, `/grafo.svg?trabalho=<id>`, `/relatorio?oc=<id>&tipo=tecnico|uso` (+`.md`). Estado empurrado por websocket a cada mudança.
- Observação: chokidar em dois watchers, debounce 300 ms + `awaitWriteFinish` (evita ler YAML truncado): `docs/` ⇒ releitura TOTAL do projeto (as regras cruzam referências); `.expx/memoria/` ⇒ só o índice. Não observa `.expx/` inteiro nem `docs/eventos/` como fonte.
- **Lê o estado (expx-schema), não o rastro**: o README afirma que a leitura do rastro "está especificada e ainda não implementada". O `estado.json` também não é lido.
- Mostra: trabalhos (status, estágio, sprints, fases, tasks, bloqueios, causa raiz, QA, relatórios), histórico (`docs/relatorios/INDICE.md`), grafo do plano interativo (aberto por padrão se houver ciclo/dependência inexistente/paralelismo não sustentado), seção Memória (arquivos de risco ordenados por regressões → reprovações QA → nº trabalhos; regressões com evidência; coincidências; artefatos contaminados; ignora filtro de período), e trabalhos vindos de outras branches locais.
- Violações calculadas (`regras.ts`): `teste_ausente, regressao_ausente (só bug da runx), concluida_sem_verde, paralela_com_dependencia, sem_criterio_saida, dependencia_inexistente, ciclo_dependencia, estagio_incoerente, bloqueio_antigo`. Rejeições: sem frontmatter, YAML inválido, `kind` desconhecido, schema maior que o suportado.
- **Não lê** (na versão lida do repositório): `ENTREGA.md`, `FECHAMENTO.md`, estimativas, `docs/produto/*` (prodx), artefatos de legadox/stackx/designx (`00-DECISOES.md` é candidato da varredura, mas o kind `decisoes` não consta na lista de kinds do contrato), `docs/projeto/*` (a varredura por nome não inclui `PROJETO.md`/`MAPA.md` etc., embora o schema tenha os kinds). Lacunas de cobertura que um ADE de primeira classe pode preencher.

---

## 5. Integração de primeira classe: proposta para o ADE (Electron)

Princípio: o ADE é um **cliente observador + disparador de prompts**. O método continua sendo o modelo seguindo SKILL.md; o ADE (a) observa arquivos e o rastro, (b) traduz em UI, (c) digita slash commands nos terminais dos CLIs. Ele nunca escreve artefato de estado por conta própria (isso violaria "quem escreve é a skill").

### 5.1 O que observar (file watchers)

Por projeto/worktree (não só no checkout principal; cada worktree tem seu `docs/` e seu `.expx/` copiado):

| Alvo | Glob/caminho | O que extrair |
|---|---|---|
| Plano e estado do trabalho | `docs/sprintx/features/*/{ORQUESTRADOR.md,00-BLOQUEIOS.md,00-DECISOES.md,00-AUDITORIA.md,FECHAMENTO.md,sprint-*/{tasks,fases,sprint}.md}`, `docs/<slug>/...` (legado) | frontmatter YAML; `VEREDITO:` por regex em `00-AUDITORIA.md`/`QA.md` |
| Ocorrência | `docs/manutencao/*/{00-OCORRENCIA.md,01-CAUSA-RAIZ.md,ORQUESTRADOR.md,BLOQUEIOS.md,QA.md,sprint-*/tasks.md,base/00-INDICE.md}` | idem; estágio deduzido pelo disco |
| Relatórios | `docs/relatorios/INDICE.md`, `docs/relatorios/*/{tecnico,uso}.md` | fechamento, histórico |
| Entrega | `docs/entregas/*/ENTREGA.md` (+ `PR.md`, `QA-PACOTE.md`, `ATENCAO.md`) | branch, commits, `pr_url`, `pr_estado`, faixas |
| Produto | `docs/produto/{PRODUTO.md,INDICE.md,pedidos/*/{VEREDITO.md,BRIEFING.md}}` | vereditos e assinatura pendente |
| Projeto (buildx) | `docs/projeto/{PROJETO,MAPA,RECURSAO,VALIDACAO,RELATORIO}.md` | features FT-NN e status |
| Camadas | `docs/stack/CONVENCOES.md`, `docs/legado/{PERFIL.md,raio/*,DIVIDA.md}`, `docs/design-system/*` | existência + regex (legadox sem frontmatter) |
| Rastro | `docs/eventos/*.jsonl` (+ `*.N.jsonl`) | tail por offset de bytes, parse por linha, tolerar linha incompleta |
| Barra | `.expx/estado.json` | só como dica de UI (derivado, descartável; não é fonte de verdade) |
| Memória | `.expx/memoria/indice.json`, e/ou chamar `memox.py` | sinais por arquivo |
| Config | `.expx/hooks.json`, `.expx/expx-lock.json` | modos de hook, versões |
| Repo | `.git` HEAD/refs/worktrees | branch, worktree, PR |

Mecânica: watcher com debounce ~300 ms e "aguardar estabilização de escrita" (as skills gravam `tasks.md` a cada transição e YAML truncado aparece transitoriamente); releitura total do projeto a cada mudança (as regras cruzam arquivos); arquivo jsonl lido em modo append/tail. Ignorar `node_modules/.git/dist`.

Dica prática: como o painel oficial já existe, o ADE pode (1) reusar `expxdev` como biblioteca/processo (`/api/projeto` por worktree) ou (2) reimplementar o parser (é frontmatter + zod; o parser em `src/parser/` do repo é referência). Opção (2) é necessária para cobrir os kinds que o painel ignora.

### 5.2 Eventos do ADE

**Consumir (vindos do disco):**
- Linha JSONL nova ⇒ evento de domínio (`task_iniciada`, `task_concluida`, `task_bloqueada`, `fase_iniciada/concluida`, `veredito_emitido`, `commit_criado`, `pr_aberto`, `regra_violada`, `acao_bloqueada`, `suite_executada`, `agente_*`). É o canal mais fino (em tempo real, com `sessao`, `agente`, `task`).
- Mudança de frontmatter em `tasks.md`/`ORQUESTRADOR.md` ⇒ reconciliação (o disco é a verdade).
- Aparecimento de `00-AUDITORIA.md` com `VEREDITO: SIM|NÃO`, `QA.md` com `VEREDITO`, `VEREDITO.md` do prodx, `ENTREGA.md` com `portao`/`pr_estado`.

**Emitir (ADE → método):**
- Prompts/slash commands no terminal do CLI (ver 5.4). O ADE não emite eventos no JSONL (contrato: skills e hooks escrevem; ninguém edita à mão). Se o ADE quiser registrar algo próprio (ex.: "Mission atribuída a Pane 3"), usar um arquivo do próprio ADE fora de `docs/`, nunca `docs/eventos/`.
- Decisões humanas que o método espera por arquivo: a **assinatura do prodx** (`aprovado_por`, `aprovado_em` do `VEREDITO.md`) e a **aprovação em raio ALTO** do legadox são escritas por pessoa; o ADE pode abrir o arquivo no editor ou enviar um prompt ao agente "registre a aprovação de X" (a skill nunca deve assinar por conta própria, então a melhor UX é edição humana assistida).

### 5.3 Mapeamentos

| Conceito ADE | Conceito do método | Chave de junção |
|---|---|---|
| Mission (feature) | um trabalho sprintx: pasta `docs/sprintx/features/<slug>/` + worktree `feature/<slug>` (`../<repo>--<slug>`) | `trabalho_id = <slug>` |
| Mission (ocorrência) | um trabalho runx: `docs/manutencao/<OC-ID>-<slug>/` + branch `fix/` ou `chore/` | `trabalho_id = <OC-ID>-<slug>` |
| Mission de pedido cru | um `PD-ID` do prodx | `pd_id` (formato de frontmatter diferente) |
| Mission de projeto | buildx `projeto_id`, com N features `FT-NN` (cada uma um trabalho sprintx com `origem_buildx`/`feature_id`) | `projeto_id` |
| Pane (terminal/agente) | sessão de um CLI num worktree | `sessao` (`<harness>@<id>`) no rastro; worktree do trabalho |
| Card / Task | `tasks[]` do `tasks.md`/`plano` | `T-NN.MM` (+ `fase` `F-NN.M`, `sprint_id`) |
| Coluna do card | `status` da task | `pendente` → `em_andamento` → `concluida` / `bloqueada` |
| Dependência entre cards | `depende_de[]`, `paralelizavel`, `paralela_com[]` da fase | IDs de task/fase |
| Lane/coluna "Fase" da Mission | `estagio` do orquestrador (f1..f6 / e1..e5 / b1..b6) | `ORQUESTRADOR.md` |
| Handoff | conclusão de task: `task_concluida` no rastro + `status: concluida` + `concluida_em` + `suite` no `tasks.md`. Handoff de fase/etapa: `fase_concluida`, `VEREDITO: SIM/APROVADO`, `ENTREGA.md` | evento + frontmatter (redundantes; o disco vence em conflito) |
| Blocker | item em `00-BLOQUEIOS.md`/`BLOQUEIOS.md` com `resolvido_em: null`; evento `task_bloqueada` | `B-NN` |
| Review / PR | `ENTREGA.md` (`portao`, `pr_url`, `pr_estado`, `faixa_atencao`) | `trabalho_id` |
| Agente de revisão | `agente` no rastro (`auditor-plano`, `revisor-testes`, `qa`, `revisor-diff`) | campo `agente` |

**Sinaleira (semáforo) ← estado.** Sugestão de regra derivada só de dados observáveis:
- Verde: trabalho `em_andamento` com task `em_andamento` e última atividade (eventos/`atualizado_em`) recente; ou `concluido`.
- Amarelo: aguardando humano (F2 com pergunta pendente; `VEREDITO.md` do prodx sem assinatura; raio ALTO sem aprovação; `mergex` com `pr_estado: aberto` aguardando revisão; auditoria `NÃO`); `regra_violada` recente; `suite: vermelha`; task `em_andamento` por muito tempo sem evento (cuidado: tempo de parede não é esforço).
- Vermelho: bloqueio aberto (`resolvido_em: null`); `acao_bloqueada`; `portao: bloqueado`; `QA` `reprovado`; `ciclo_dependencia` ou `dependencia_inexistente`; `concluida_sem_verde`; `VEREDITO: NÃO` sem replanejamento; ocorrência que voltou ao E1.
- Cinza: `nao_iniciado`, ou Pane sem trabalho (`estado.json` com `trabalho: null`).

### 5.4 Quais comandos disparar em cada Pane

Regra geral: digitar o slash command (Claude Code: `/expx:<nome> <argumento>`; OpenCode: `/<nome> <argumento>`) no stdin do CLI do Pane, passando SEMPRE o identificador do trabalho como argumento (sem argumento, a skill pergunta qual, o que trava um Pane automatizado). O Pane deve rodar com `cwd` = worktree do trabalho (regras 21/16: a sessão trabalha de dentro dele).

| Gesto no ADE | Comando no Pane | Observação |
|---|---|---|
| Nova Mission "feature" | `/expx:sprintx <pedido>` (ou `/expx:sprintx-base <pedido>` para forçar F1) | F1 cria o worktree; o ADE pode pré-criar o worktree com as convenções (`feature/<slug>`, `../<repo>--<slug>`) ou deixar a skill criar e depois descobrir via `ORQUESTRADOR.md.worktree` |
| Nova Mission "bug/ajuste" | `/expx:runx <texto do chamado>` (E1 = `/expx:runx-causa`) | bug sem reprodução gera a única pergunta permitida |
| Mission "pedido cru" | `/expx:prodx-triar <texto>` e, se gatilho, `/expx:prodx-avaliar` | Assinatura é humana |
| Mission "projeto inteiro" | `/expx:buildx <descrição>` (1ª pergunta: modo) | `buildx-status`/`buildx-retomar` |
| Avançar/retomar | `/expx:sprintx <slug>` / `/expx:runx <OC-ID>` / `/expx:buildx-retomar` | detecta a fase pelo disco |
| Fase explícita | `sprintx-descoberta`, `sprintx-sprints`, `sprintx-orquestrador`, `sprintx-auditoria`, `sprintx-executar`, `sprintx-estimar`; `runx-plano`, `runx-fix`, `runx-qa`, `runx-relatar` | as skills recusam fase adiantada e executam a pendente |
| Card vira "em revisão" / QA | `/expx:runx-qa <OC-ID>` (runx) ou `/expx:sprintx-auditoria` (F5) | em Pane distinto do implementador (independência) |
| Preparar entrega | `/expx:mergex-check` → `/expx:mergex-atencao` → `/expx:mergex-qa` → `/expx:mergex-pr` | `mergex-abrir` no início da execução; `mergex-revisar` SÓ por ação explícita do humano |
| Onboarding do repo | `/expx:onboarding`, `stackx-detectar`, `legadox-perfil`, `designx-cartography`, `memox-indexar` | |
| Consulta | `/expx:memox-arquivo <caminho>`, `memox-buscar`, `stackx-check`, `designx-audit` ou direto `python3 .claude/skills/memox/assets/memox.py ...` | |

Padrões de orquestração sugeridos:
- **Um Pane implementador por Mission** (F6/E3) e **Panes avaliadores separados** (F5, E4, E3 do mergex) com novo contexto: reforça "quem implementa não aprova".
- Paralelismo: só o que o plano declara (`paralelizavel`/`paralela_com`). O ADE pode mapear tasks `paralelizavel: true` com `depende_de` satisfeitas para Panes paralelos, mas a regra 6 diz que a IA de execução nunca decide isso sozinha. Duas sessões na mesma feature dependem de `task-reivindicada` (aviso, não bloqueia) lendo o rastro.
- O ADE deve garantir `.expx/` e `.claude/settings.json` no worktree (a skill copia `hooks.json`/`settings.json` no worktree novo; conferir).

---

## 6. Limites e pegadinhas

1. **Skills não são API.** São instruções Markdown para o modelo; o "comando" é um prompt. Saída, formato e ordem podem variar; só os arquivos com frontmatter e o JSONL têm contrato. Única parte determinística executável: `memox.py`, hooks (`python3`/`bash`) e o CLI `expxdev` (`grafo --conferir`, `doctor`, `panel`). O ADE deve dirigir CLIs com prompts e confirmar pelo disco, nunca supor sucesso pelo texto.
2. **O disco é a verdade; `estado.json` e o diagrama Mermaid são derivados** e podem estar atrasados/ausentes (sessão morta entre gravar `tasks.md` e o estado). Reconciliar a partir de `tasks.md` + `00-BLOQUEIOS.md`. `.expx/estado.json` só existe se `.expx/` já existia, é um único "trabalho atual" e dois worktrees/sessões o disputam.
3. **Hooks só funcionam no que está registrado.** Aqui só runx+comum (segredo, rastro) estão em `hooks.json`; sprintx/mergex/legadox/stackx/designx não disparam. Logo, o rastro de eventos de sprintx (task_iniciada etc.) depende de a própria skill gravar (instrução ao modelo) e pode faltar. Ler o JSONL como melhor-esforço; a fonte confiável é o frontmatter.
4. **Agentes não instalados** neste projeto; fases de veredito rodam no mesmo contexto do implementador (perde-se a independência estrutural). O ADE pode compensar abrindo um Pane separado para auditoria/QA.
5. **Drift de contratos.** (a) sprintx grava em `docs/sprintx/features/<slug>/` (contrato e `mergex` SKILL ainda citam `docs/<slug>/`); (b) prodx usa `schema: expx-schema-v1`/`pd_id`; (c) legadox/stackx sem frontmatter; (d) designx usa `expx_tool: designx`, fora do enum; (e) `ENTREGA.md` usa `expx_tool: runx` mesmo para trabalho sprintx; (f) `decisoes`, `fechamento`, `entrega`, `estimativa*` não estão na lista de kinds do painel; (g) `sessao`/`harness` no rastro não estão no contrato; (h) README mostra 231 e 295 testes em pontos diferentes. O ADE deve parsear com tolerância (chaves extras, kinds novos viram "desconhecido", não erro) e fixar o `expx_schema` suportado.
6. **Perguntas que travam Panes.** Sem argumento os comandos perguntam qual trabalho. F2 (entrevista, blocos de até 5), prodx (densidade/forma), runx E1 (bug sem reprodução), buildx (modo) e sprintx F1/runx E1 sem git com árvore ocupada são pontos legítimos de pergunta. O ADE deve detectar "Pane aguardando resposta" (amarelo) em vez de reenviar prompt. Modo `autonomo` reduz, mas F2 ainda pergunta o que é genuinamente indecidível.
7. **Humano é parte do contrato.** Assinatura do prodx, aprovação em raio ALTO (legadox), `mergex-revisar`/merge, promoção de hook para bloqueio, escolha de modo do buildx. O ADE não deve automatizar nenhum desses. `buildx` (modo autônomo) é a exceção de assinatura, com `provisorio: true`.
8. **Escrita concorrente.** Skills reescrevem arquivos de estado inteiros e fazem append no JSONL; não há lock. Ler sem segurar arquivos, tolerar YAML truncado (debounce), linha JSON incompleta no fim e rotação `.N.jsonl`. O ADE nunca deve editar `docs/` durante uma sessão ativa.
9. **Tempo de parede ≠ esforço**; durações do rastro incluem pausas. Se o ADE mostrar duração por card, rotular como "duração observada".
10. **Worktrees.** Cada Mission com git tem seu worktree e seu `docs/` (inclusive `.expx/`, gitignorado, copiado). O observador precisa cobrir todos os worktrees listados por `git worktree list`; o painel oficial só descobre trabalhos de outras branches via `git show` (estado commitado), não vê o que está só no working tree de outro worktree. O `settings.json` desta instalação tem caminho absoluto do marketplace.
11. **Colisão de nomenclatura.** E0..E9 (mergex) vs E1..E5 (runx); `estagio` f/e/b; `status` de task no feminino (`concluida`) e de fase/sprint no masculino (`concluido`); `veredito` com três valores só no buildx.
12. **Segurança.** Hooks de segredo/git perigoso bloqueiam (exit 2). Se o ADE injetar comandos git (push, commit na main), pode ser barrado; preferir deixar a mergex operar. Nunca pedir credenciais: o CLI usa o git da máquina. O painel oficial é GET-only e local; um ADE não deve expor o estado na rede.
13. **`/expx:` vs sem namespace.** O ADE precisa conhecer o harness do Pane: Claude Code usa `/expx:sprintx`, OpenCode `/sprintx`. O lock informa `harness: [claude, opencode]`. Outros CLIs (MimoCode só tem ponte parcial para runx) não são suportados por sprintx.
14. **Lembrete de prompt.** O hook `UserPromptSubmit` injeta um lembrete por regex de palavras; prompts gerados pelo ADE com palavras como "bug" ou "implementar" acionam skill diferente da pretendida. Usar o slash command explícito e evitar texto livre que case outro gatilho.
15. **Atualização.** `expx update` muda skills (lock com sha256 por arquivo; o doctor avisa divergência local). O ADE deve ler `expx-lock.json` (`cli_version`, `commit` por skill) para versionar seu parser e alertar incompatibilidade de schema.
