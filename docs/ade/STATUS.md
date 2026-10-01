# Status da execução

> **Modo piloto automático ligado** (dono dormindo): seguir `PILOTO-AUTOMATICO.md` sem perguntar até ele mandar parar.

Fonte da verdade do andamento. Atualizar a cada task. Retomar: ler `00-LEIA-ME.md`, depois este
arquivo, e continuar da primeira task `[ ]` com dependências `[x]`.

**Início:** 2026-09-30 · **Fase atual:** 5 (acabamento) · **Task atual:** T-05.04 (perf completo), T-05.05 (a11y), T-05.06 (pacote+docs); depois T-05.07 (auditoria)

## Fase 0 — Fundação
- [x] T-00.01 Scaffold e toolchain — npm ci ok; typecheck estrito; vitest 4 + playwright
- [x] T-00.02 Constantes do produto e varredura — produto.ts + varredura (testes ignorados); API exposta como window.ade (neutra)
- [x] T-00.03 Casca Electron segura — scheme próprio, CSP, janela oculta até ready-to-show, e2e real ok
- [x] T-00.04 Casca do renderer, tokens e tema — agente; JS inicial 69,5 KB gz; temas claro/escuro
- [x] T-00.05 Persistência (SQLite) — agente; node:sqlite funciona no Electron 37.10.3 real; 47 testes
- [x] T-00.06 Barramento de eventos e IPC tipado — validadores estritos, registro tipado, barramento coalescido
- [x] T-00.07 Harness de performance — P-01 347 ms, P-02 p95 36 ms, P-12 12 ms (tests/perf, `npm run perf`)
- [x] T-00.08 Empacotamento local — dist:dir gera ExpxV.app; test:pacote prova node-pty empacotado; postinstall restaura +x do spawn-helper

## Fase 1 — Terminais
- [x] T-01.01 Núcleo do PTY — node-pty real no Node e no Electron; OSC/ambiente/backpressure; 134 testes (PTY+daemon)
- [x] T-01.02 Daemon de PTY — sessão sobrevive ao app sem duplicar saída; reserva AdaptadorNodePty
- [x] T-01.03 Catálogo e detecção de CLIs — PATH do shell de login, cache, versão com timeout; 'seguro' sem args automáticos
- [x] T-01.04 IPC de terminais e autorização — 17 canais ligados; daemon na onda 2; e2e real ok
- [x] T-01.05 Terminal no renderer — xterm lazy (98 KB gz em chunk), WebGL ≤ 6, armazém fora do React (P-03/P-05 em medição)
- [x] T-01.06 Layout e atalhos — árvore binária, persistência no main por workspace
- [x] T-01.07 Sinaleira e atividade — hooks por CLI + heurística 'estimada'; notificação sem foco
- [x] T-01.08 Anexos e retomada — arquivos de ambiente recusados, symlink para fora recusado, allowlist de dev
- [x] T-01.09 Fixtures e e2e — P-03 62 ms, P-04 sem tarefa longa, P-05 p95 17,8 ms, P-06 98 MB, P-07 170 MB, P-13 402 ms; 2 correções reais de lentidão

## Fase 2 — Workspaces, Provedores e Missões
- [x] T-02.01 Modelo de dados e repositórios — repos + migration 0002 (índices); consulta quente dentro de P-14
- [x] T-02.02 Serviço de Git — sem shell, timeout 5 s, recusa push/--force, worktree com sufixo em colisão
- [x] T-02.03 Workspaces — serviço + IPC + e2e (abrir repo git, atual, recentes)
- [x] T-02.04 Provedores e contas — config dir 0700 por conta; tela de CLIs e contas
- [x] T-02.05 Missões — worktree/branch certos; abortar nunca apaga (e2e real)
- [x] T-02.06 Panes de Missão persistidos — restauração e respawn_de
- [x] T-02.07 UI de Missões — lista virtualizada, wizard com cadeado, diálogos próprios

## Fase 3 — Orquestração e MCP
- [x] T-03.01 Sidecar MCP — servidor numa worker thread (SDK custa ~200 ms); token HMAC por Pane
- [x] T-03.02 Tools núcleo — 11 tools; matriz por modo
- [x] T-03.03 Briefing e handoff — relatório→banco→wake; fila preserva ordem
- [x] T-03.04 Hooks por Pane — settings por Pane, stop hook ×3, gancho HTTP
- [x] T-03.05 Regras de orquestração — em código, valem sob modo automático
- [x] T-03.06 Piloto e workers — prompts versionados em .md
- [ ] T-03.07 UI de Missão
- [x] T-03.08 E2E de delegação — 9 cenários no Electron real; P-15 283 ms

## Fase 4 — Método Expx
- [x] T-04.01 Parser tolerante — nunca lança; drift de contrato tratado
- [x] T-04.02 Descoberta e worker — P-10: 200 artefatos em 38 ms (mediana), fora da thread principal (ligação ao main pendente)
- [x] T-04.03 Observador — P-11 ≈ 420 ms; fecha sem vazar handles (ligação ao main pendente)
- [x] T-04.04 Modelo, violações e sinaleira — disco vence rastro; sinaleira com motivo em texto
- [x] T-04.05 UI do Método — quadro, grafo SVG lazy, rastro virtualizado, ações com Pane separado
- [x] T-04.06 Disparo de comandos — prefixo por harness, ações humanas nunca disparam
- [x] T-04.07 Missão ↔ trabalho — junção por trabalho_id; adotáveis no serviço
- [x] T-04.08 Onboarding e hooks — somente leitura
- [x] T-04.09 Memória do método e saúde — memox opcional com timeout

## Fase 5 — Acabamento
- [x] T-05.01 Início — derivado dos stores existentes; guia de primeiro uso em 3 passos
- [x] T-05.02 Paleta, menu, tray, notificações — busca fuzzy 5 000 itens < 10 ms; menu/bandeja na onda 2; paleta por eventos próprios
- [x] T-05.03 Configurações — cor de destaque por setProperty sem re-render global; modo automático com aviso
- [x] T-05.04 Passe de desempenho — P-01..P-15 medidos (RELATORIO-MVP.md); 8/10 rodadas completas verdes sob carga alta; corrigidos: VirtualLista (10 151→161 nós) e abertura da paleta (311→3–15 ms); flaky estabilizados
- [x] T-05.05 Acessibilidade — 23 achados corrigidos; contraste mínimo 4,55:1 nos dois temas (teste mede os pares); navegação só por teclado (e2e); sem dependência nova
- [x] T-05.06 Empacotamento e documentação — .app 216 MB (asar 3,6 MB); dist:mac universal OK (189 MB, mergeASARs:false); bug real do node-pty empacotado corrigido (D-38); README e AGENTS.md; dist:win não exercitado (D-26)
- [ ] T-05.07 Auditoria do MVP

## PRIORIDADE ALTA DO DONO (pedido em 2026-09-30, antes de dormir) — executar logo após o MVP, antes da Fase 6
- [ ] **Fase 14 · Squads e agentes** (reforço do dono: squads = agentes + skills + MCPs; TODA squad tem 1 ORQUESTRADOR; vem com squads de fábrica para desenvolvimento (≥ 10) + criação manual; área 'Squads' com CAIXA DE PROMPT que envia o objetivo direto a uma squad → orquestrador abre terminais paralelos; LLM/modelo/esforço POR MEMBRO; PROMPT EDITÁVEL por membro; duplicar/atualizar fábrica preserva edição): criar squads de agentes (instruções + CLI/LLM + modelo + nível de esforço + skills permitidas por agente); plano a escrever (agente de planejamento) e implementar.
- [ ] **Fase 9 · Limites, consumo e roteamento automático**: (a) troca automática para outra conta do MESMO provedor com menor consumo quando a atual passa do limiar; (b) se não houver, troca para o MODELO EQUIVALENTE de outro provedor (tabela de equivalência por faixa: topo/alto/médio/rápido); (c) COTAS no RODAPÉ de todas as páginas; (d) COTA GERAL no TOPO; (e) TELA de análise de consumo (como no ExpxMedia). Plano em andamento (agente a2d0548e…, já avisado dos requisitos).

- [ ] **Fase 15 · RAG local + grafo + chat orquestrador** (pedido do dono): (a) índice local SQLite com busca vetorial (sqlite-vec quando carregável; senão busca exata em Float32Array atrás de uma interface) + lexical (FTS5), híbrido; (b) TODA sessão/trabalho/handoff/relatório/commit/decisão/correção é embutida (com redação de segredos antes); (c) TODO agente de TODO modelo consulta o RAG ANTES de implementar (MCP `rag_search`/`rag_context`, contexto injetado no prompt pelo ADE e por hook): já foi implementado? houve correção? qual o contexto?; (d) o sistema aprende o tempo todo (aprendizados extraídos ao fim de cada tarefa, com proveniência, deduplicação e feedback); (e) tela do GRAFO do conhecimento; (f) CHAT com CLI/LLM do sistema (perfil configurável: CLI+modelo+esforço, usa as assinaturas do usuário, sem chaves de API próprias) que conversa com o RAG (respostas com citações) E com o orquestrador principal: entende o pedido, consulta o RAG, melhora o prompt, abre o terminal/Missão certos, joga o prompt e executa; mostra o plano antes quando o modo exigir. Embeddings: modelo local (nada sai da máquina; download do modelo só com consentimento do dono → pendência) com fallback lexical sempre disponível. Plano a escrever (agente de planejamento) e implementar logo após as Fases 14 e 9.
  **Extensão (pedido do dono): backend do RAG configurável.** Padrão = LOCAL em toda instalação. Opcional: o usuário configura um RAG ONLINE (URL, chave de API, usuário, senha, namespace/coleção) em um provedor de banco vetorial, aperta um botão para MIGRAR tudo e o sistema passa a usar o RAG online para COMPARTILHAR o 'cérebro' do projeto entre pessoas/máquinas. Requisitos: interface `ArmazenamentoConhecimento` com adaptadores por provedor (pesquisa dos principais provedores em `docs/ade/base/G-provedores-vetoriais.md`); credenciais SOMENTE em cofre do SO (Electron safeStorage/keychain), nunca em JSON/log/argv/evento; consentimento explícito na UI mostrando O QUE será enviado; redação de segredos antes de qualquer envio; testar conexão; migração em lote, retomável, verificada (contagens/checksums), com dry-run e cópia local mantida (reversível, 'voltar para local'); coerência de embeddings (modelo e dimensão gravados; reembutir se divergir); namespace por projeto/equipe, upsert idempotente por hash de conteúdo, resolução de conflito; testes SÓ contra stubs/servidores locais (nada vai para a rede durante a madrugada); padrão desligado.

- [ ] **Fase 16 · Maestro** (pedido do dono; planejar JUNTO com a Fase 14): (a) o usuário, de QUALQUER CLI/terminal (ou do chat da Fase 15), escreve 'corrige, tenho um problema em tal lugar'; o sistema IDENTIFICA a intenção (bug → runx; feature → sprintx; pedido cru → prodx; projeto inteiro → buildx; refatoração; entrega/PR → mergex; dúvida → RAG) — por regras determinísticas e, opcionalmente, pelo decisor JEV; (b) existe uma TELA de configuração onde, para cada skill do método (sprintx, runx, prodx, buildx, mergex, legadox, stackx, designx, memox) e para CADA ETAPA (F1–F6, E1–E5, P0–P5, mergex…), se define a CLI/LLM, o modelo e o nível de esforço (perfil de agente da Fase 14); (c) ao detectar, o ORQUESTRADOR abre um terminal novo já com o perfil configurado para a etapa e vai levantando os terminais das etapas seguintes seguindo a lógica da skill (avaliador/QA em terminal separado do implementador, humanos nas assinaturas); (d) o sistema alcança 'qualquer CLI' por: MCP `maestro_request` oferecido a todos os agentes + hook de prompt (UserPromptSubmit) nas CLIs que têm hook + comando 'Pedir ao Maestro' na paleta/atalho por painel + o chat; (e) DECISOR JEV opcional: chave direta (endpoint tipado do JEV) OU via OpenRouter; desligado por padrão; fallback determinístico sempre disponível; (f) OPENROUTER configurável como provedor (chave só no cofre do SO; lista de modelos; o usuário decide quais usar e como; CLIs que aceitam endpoint compatível com OpenAI — OpenCode, Aider, Goose, Codex com provider customizado — usam os modelos de lá). Credenciais em cofre do SO; nada sai da máquina sem a chave e o consentimento do dono; testes só contra stubs.

- [ ] **Fase 17 · Mapa lógico do código (análise de legado)** (pedido do dono — 'o cara vai usar muito software que já tem código'): o sistema roda uma ANÁLISE do código e monta o MAPA LÓGICO (grafo, fluxo/fluxograma…) com as DEPENDÊNCIAS, para ver o projeto e para ALIMENTAR a estrutura do stackx (convenções com evidência: camadas, padrões, onde ficam os testes, como erro é sinalizado) e do legadox (perfil do legado, zonas de risco, raio de impacto por arquivo = chamadores/dependentes, dívida, código sem testes). **Pesquisar no GitHub as ferramentas existentes** (dependency-cruiser, madge, ts-morph, Tree-sitter/ast-grep, stack-graphs, SCIP/LSIF indexers do Sourcegraph, universal-ctags, code2flow, pydeps, Semgrep/CodeQL, scc/cloc, jQAssistant, Structurizr, etc.): se a licença permitir e o peso for aceitável, EMBUTIR (web-tree-sitter/WASM é o candidato natural; ferramentas GPL só como binário externo opcional); se não puder, ESTUDAR o código e REIMPLEMENTAR aqui. Saídas: dados de grafo + Mermaid/DOT/SVG + visualizador interativo (reaproveitar o canvas do grafo da Fase 15) + export. **Princípio D-04 preservado**: o ADE NÃO escreve em `docs/**`; ele grava o mapa em arquivo próprio (`<userData>` ou `.<produto>/mapa/`), expõe tool MCP `mapa_consultar` e DISPARA `/expx:stackx-detectar` e `/expx:legadox-perfil` passando o caminho do mapa para o modelo usar (corta custo e aumenta evidência `arquivo:linha`); o raio de impacto é calculado deterministicamente (faixas do legadox: BAIXO ≤ 3 chamadores, ALTO > 15 ou zona de risco). Incremental (só arquivos mudados), em worker, nunca bloqueia a UI. Plano a escrever (agente de pesquisa+planejamento, assim que houver vaga) e implementar após as fases 14, 9, 15 e 16.

- [ ] **Rigidez em 5 níveis (parte da Fase 16 · Maestro; pedido do dono)**: seletor compacto (toggle/slider de 5 passos) no CABEÇALHO de todas as páginas; cada skill do método (sprintx, runx, prodx, buildx, mergex, legadox, stackx, designx, memox) tem 5 níveis de rigidez — do 1 (mínimo: desliga várias etapas do pipeline, só o básico do básico, desenvolvimento mais rápido) ao 5 (todas as etapas, nada passa). O usuário muda a qualquer momento (alteração rápida e pontual); a qualidade é garantida por um PISO invariante (teste do comportamento alterado + suíte verde, varredura de segredo, sem git destrutivo, QA separado, humanos continuam humanos). Travas: raio ALTO/zona de risco do legadox impõe nível mínimo; escopo por workspace com sobrescrita por Missão e 'só esta vez'; badge do nível na Missão; mudança vale a partir da próxima etapa; única escrita do ADE em área do método = `.expx/hooks.json` por ação explícita do usuário (exceção documentada ao D-04). Planejamento enviado ao agente da Fase 16.

- [ ] **Loja de MCPs (extensão da Fase 7 · Catálogo; pedido do dono, 'assim como no Overclock')**: área de configuração/habilitação de MCPs já PRÉ-CONFIGURADA; pesquisa de MCPs de DESENVOLVIMENTO (principalmente gratuitos); os gratuitos que fazem sentido vêm configurados; o usuário entra na área e clica em INSTALAR — o sistema instala, configura e já sai funcionando. Segurança: nada instala sem clique + consentimento; versão pinada e comando exato mostrados antes; instalação isolada em `<userData>/mcp/<id>/` sem sudo/global; segredos só no cofre do SO; deny-by-default por agente; servidores iniciam sob demanda. Pesquisa e plano: `base/I-catalogo-mcps.md`, `fase-07b-loja-mcps.md` e seed `base/catalogo-mcps.seed.json` (agente em andamento).

- [ ] **Fase 18 · Gestão ágil (Scrum, XP, Lean) para software house** (pedido do dono): o produto traz recursos e boas práticas de metodologias ágeis: **relatórios e dashboards**; estruturas para **daily** (gerada dos dados: ontem/hoje/bloqueios), **retrospectiva da sprint**, **montagem de sprint** (capacidade, compromisso), **gestão de backlog** (priorização, refinamento); **story points por tarefa** (escala configurável, ex. Fibonacci); **categorização, classificação, grau de risco e criticidade** de cada tarefa — com configuração do usuário, mas JÁ PRÉ-CONFIGURADO PARA IA: a IA, a cada tarefa/teste, define story points, classificação, categoria e risco (usando o histórico no RAG para tarefas parecidas) e o usuário revisa/ajusta; **marcar retrabalho**: se a tarefa foi feita de primeira ou teve retrabalho (derivado de QA reprovado, task reaberta, correção após 'concluída', regressão, commit de fix posterior) → **índice de retrabalho** e 'feito de primeira'; **gráficos básicos de entrega** de um time de desenvolvimento: burndown, burnup, velocidade por sprint, fluxo de caixa cumulativo (CFD), cycle time e lead time (dispersão + percentis), throughput, WIP, retrabalho, planejado × entregue, distribuição de risco/categoria. Integra com o método Expx (tasks T-NN.MM = cards; sprint-NN do sprintx; rastro task_iniciada/task_concluida; vereditos de QA; ENTREGA/PR do mergex), com o RAG (estimativa por similaridade), com o Maestro/rigidez e com a Fase 6 (commits/PR). Princípio D-04: o ADE NÃO escreve em `docs/**`; dados ágeis (backlog, estimativas, classificações, retros, métricas) vivem em tabelas do próprio ADE e em exportação opcional (Markdown/CSV/PDF) FORA de `docs/**`; ligam-se às tasks do método por ID. Práticas XP (TDD, integração contínua, programação em par/commits pequenos) e Lean (desperdício, eficiência de fluxo, limites de WIP, valor × esforço) como métricas e checklists. Plano a escrever (agente) e implementar após as fases 14, 9, 15, 16 e 17.

- [ ] **Fase 19 · Documentação e relatórios de entrega** (pedido do dono; planejar JUNTO com a Fase 18): o sistema traz uma estrutura de documentação boa e robusta. O método já gera documentação técnica e de uso por ocorrência (runx: `tecnico.md`/`uso.md` em docs/relatorios; sprintx: FECHAMENTO), mas o dono quer que, **ao FECHAR UMA SPRINT**, o sistema gere automaticamente o **relatório de tudo que foi feito**: (a) **relatório TÉCNICO** (o que mudou, tasks, decisões, riscos, testes, dívida, PRs/commits, métricas) e (b) **relatório para o USUÁRIO/cliente** (features em linguagem simples, sem jargão, valor entregue, o que vem a seguir) — para levar ao usuário e **divulgar as features**; em **HTML** (arquivo único, autocontido, tema/branding configuráveis, gráficos em SVG inline, CSS de impressão), **Markdown (MD)** e **CSV** (tabela de tasks com pontos, categoria, risco, status, retrabalho, tempos, links de PR, para importar em outra ferramenta) e também JSON e PDF (via impressão do Electron, sem dependência nova); mais notas de versão/CHANGELOG. Fonte da verdade = artefatos em disco + banco do ADE (tasks, rastro, ENTREGA/PR, métricas da Fase 18); a LLM (perfil configurado, headless) só REDIGE a narrativa a partir dos fatos com citações — nunca inventa. Saída FORA de `docs/**` por padrão (`<userData>/relatorios/` ou `.<produto>/relatorios/`), com 'Exportar para…' escolhido pelo usuário (ação explícita) — D-04 preservado; templates editáveis; histórico de relatórios por sprint; dispara as skills de relatório do método quando fizer sentido (`/expx:runx-relatar <OC>`) e as consome. Documentação de projeto: também gerar/atualizar docs técnicas e de uso do sistema (arquitetura, módulos, como usar) a partir do mapa do código (Fase 17) e do RAG (Fase 15), como rascunho para revisão humana. Plano a escrever (agente, junto com a Fase 18).

- [ ] **Fase 20 · Alertas e comunicação (central de alertas, notificações, bot do Telegram)** (pedido do dono): (a) **Centro de Alertas** no sistema (o botão 'Alertas' do topo hoje não faz nada) e comunicação de eventos: tarefa iniciada, concluída, bloqueada, **atrasada**, PR aberto/mesclado, checks falhando, QA reprovado, cota de consumo atingida/troca de conta, Pane aguardando você, sprint fechada, relatório pronto, erro do sistema; mensagens com **o que está sendo feito, o que foi concluído, o que está atrasado, TEMPO DE TRABALHO, TOKENS consumidos, STORY POINTS** e status; resumos periódicos (digest), horário de silêncio, regras por canal, templates editáveis; (b) **área de configuração do BOT DO TELEGRAM**: SAÍDA (alertas e resumos para o chat) e ENTRADA (o usuário PEDE algo pelo Telegram → o ORQUESTRADOR PRINCIPAL do chat identifica a intenção, aciona a squad/pipeline certa, levanta os terminais e executa; devolve o andamento e o resultado no Telegram). Sem relay/VPS: o app faz **long polling** (`getUpdates`, só conexões de SAÍDA para a API do Telegram; nenhuma porta aberta). **SEGURANÇA é requisito de primeira classe** (a entrada remota pode disparar execução de código na máquina): a fase COMEÇA por estudo de ameaças; token do bot só no cofre do SO; **allowlist de usuários/chats** com pareamento por código de uso único e expiração; limite de taxa; **o bot propõe o plano e exige APROVAÇÃO por botão no próprio chat antes de executar** (padrão), modo 'só consultar/status' e modo 'executar direto' só por opção explícita e respeitando a rigidez; nunca executa ações destrutivas/humanas (assinaturas, merge, push forçado); mensagens recebidas são DADO não confiável (prompt injection); nada de segredos nem trechos de código nas mensagens (redação), pois a API de bots do Telegram não é ponta a ponta — o conteúdo enviado é configurável e mínimo por padrão; consentimento explícito (dados saem da máquina) e DESLIGADO por padrão; testes só contra um servidor Telegram FALSO local. Outros canais pelo mesmo desenho (adaptadores): notificação do SO, e-mail/Slack/Discord/webhook genérico como extensão. Atualiza D-05/D-72: o corte do 'relay' continua, mas o Telegram por polling é permitido com o estudo de ameaças. Plano a escrever (agente) e implementar após a Fase 18/19.

## DECISÕES DAS PENDÊNCIAS (2026-10-01): todas decididas pela opção mais completa — `DECISOES-DAS-PENDENCIAS.md` (override)
Fases novas na fila: **21 Distribuição e atualização**, **22 Acesso remoto estendido** (estudo de ameaças primeiro), **23 Overdrive experimental**.
- [ ] Commit local por fase fechada em `ade/principal` (sem push) — coordenador, quando não houver agente editando a árvore.
- [ ] Atualizar planos já escritos quando o implementador começar cada fase: o `DECISOES-DAS-PENDENCIAS.md` manda sobre os "padrões adotados" dos planos.

## Fila do piloto automático (ver `PILOTO-AUTOMATICO.md`)
Autorizado pelo dono para rodar a madrugada sem aprovação: MVP → F6 Versionamento → F7 Catálogo → F8 Memória → F9 Harness/limites →
F10 Custo/board → F11 Voz/captura → F12 Bench → F13 Jarvis/controle remoto → melhorias contínuas.
- [x] MVP T-05.04 (perf completo)
- [ ] MVP T-05.07 auditoria: veredito **NÃO** (2 ALTA, 13 MEDIA, 21 BAIXA — docs/ade/AUDITORIA-MVP.md). AUD-01 corrigido (limpeza de testes matava o daemon real: agora só ade-e2e-/ade-dom-/fixtures); AUD-02 (Codex `--dangerously-bypass-hook-trust` também em modo seguro) e MEDIA em CORREÇÃO por agente corretor; depois REAUDITORIA curta das ALTA para fechar o portão do MVP
- [ ] Corrigir: fechar o app com ~10 000 arquivos em docs/ segura o processo por dezenas de segundos (watcher.close() do chokidar bloqueia; o limite de 4 s do before-quit não dispara) — ver docs/ade/perf/PENDENCIAS-PERF.md
- [x] F17 plano pronto (45 tasks, P-240..P-252, D-160..D-170; pendências P-270..P-279 DECIDIDAS pela opção mais completa)
- [ ] **F9 em execução (onda 1: contratos/migration/repos)** — ondas 2–6 conforme `fase-09-harness-limites.md` §Ordem
- [x] F18 (45 tasks, P-180..P-190) e F19 (42 tasks, P-290..P-302) planos prontos; pendências P-60..P-67 DECIDIDAS (opção mais completa); 'feita de primeira' = `concluida` sem QA reprovado alta/média, sem reabertura, sem commit/PR de correção e sem regressão numa janela de 14 dias
- [x] F20 plano pronto (43 tasks, P-140..P-149; estudo de ameaças AB-01..AB-30; T-20.01 é pré-requisito); pendências P-70..P-79 DECIDIDAS; 'atrasada' = tempo ativo > max(1,5×estimativa; estimativa+10 min)
- [x] F14 (28 tasks, 13 squads de fábrica, P-200..P-209) e F16 (40 tasks, P-210..P-224, rigidez em 5 níveis) planos PRONTOS; pendências P-230..P-233 e P-310..P-320 DECIDIDAS. **TODOS OS PLANOS (7, 7B, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20) EXISTEM.** Limitação das skills: recusam fase adiantada → nível 1 vira pipeline `rapido` de 1 terminal; níveis 2–5 reduzem o que o ADE despacha
- [ ] Planos detalhados (histórico): **prontos** F7 (36 tasks), F8 (35), F9 (39), F10 (31), F11 (23), F12 (26), F13 (22; T-13.01 estudo de ameaças; relay bloqueado), F15 (50 tasks, P-70..P-83); **prontos também** F07b (loja de MCPs, 74 MCPs/36 tasks, seed JSON); **em andamento** F14+F16 (squads+Maestro+rigidez), F17 (mapa do código), F18+F19 (ágil+documentação), F20 (alertas+Telegram)
- [x] F6A Versionamento: fundação (T-06.01–06.06) — detecção git/svn, executor robusto, observador, cache, status (parcial incremental ≈ 30 ms), diff parser; P-16 101 ms p95 / 247 ms ponta a ponta, P-17 394–500 ms, P-18 3 ms, P-21 4,6 MB
- [x] F6B-1 Git núcleo: stage/commit/branches/stash/worktrees (T-06.07/08/09/11/16) — P-20 44 ms mediana; cópia de segurança do descarte; guardas de branch padrão/amend/nomes
- [x] F6B-2 Git núcleo (T-06.10/12/13/14/15 + correção core.fsmonitor): 238 testes; P-19 28–40 ms (200 commits em repo de 100 000), paginação de 100 000 sem travar; rebase com 3 conflitos resolvido pela API, abortar restaura o estado exato; fsmonitor malicioso NÃO executa em pasta não confiável (controle positivo prova o teste)
- [ ] F6C Forges (GitHub gh + GitLab glab/REST; Bitbucket/Azure se couber) — em andamento
- [ ] F6D SVN (instalar `subversion` via brew ao iniciar; ver DECISOES P-11) — próxima
- [ ] F6E Integração/UX do versionamento (IPC, tela Versionamento, diff viewer, decorações, Missão↔VCS) — depende de contratos compartilhados (coordenar com Fase 9)

## Fase 6 — Versionamento total (Git, GitHub, SVN) — pós-MVP, plano pronto
Plano detalhado com 40 tasks em `fase-06-versionamento.md` (6A fundação, 6B git, 6C GitHub, 6D SVN, 6E integração).
Nenhuma task iniciada; começa depois do portão do MVP. Orçamentos novos P-16 a P-22.

## Integrações pendentes do MVP (fechar antes da auditoria T-05.07)
- [x] Ligar em `main.ts`: `criarMenu`, `criarTray`, `criarIconeTray`, `criarPreferenciaNotificacoes` (+ `ativo` no notificador) e encaminhar `EventoMenu` (abrir-projeto, paleta, tema, sobre) ao renderer.
- [x] Consumir as chaves de config: `terminal_scrollback` (terminal), `limite_paineis` (sessões), `permissao_padrao` (novos workspaces), `notificacoes` (notificador).
- [x] Paleta: Nova Missão e Novo terminal hoje clicam em botão por texto; trocar por evento próprio (`estado/navegacao`).
- [x] T-03.07 UI da Missão — piloto fixo à esquerda + workers à direita, rótulo, custo desconhecido como texto, aviso de piloto reiniciado (custo/tokens/prompt ainda não vêm do contrato).
- [x] Ligação real do MCP/hooks/prompts no main + e2e de delegação.
- [x] Endurecer o teste instável `src/main/servicos.test.ts` (15/15 em paralelo).
- [x] Portões de intake: IPC + UI + e2e e tokens MCP persistentes (segredo 0600, 7 dias, revogação por Pane).
- [x] `model_list` estático por CLI (claude: opus/sonnet/haiku; codex/gemini: padrão) + `--model`; era: lista vazia (o app não conhece os modelos de cada CLI): definir lista estática por CLI ou ler da CLI.
- [ ] Limpeza de processos de teste: tests/limpeza.ts + global-teardown (feito); conferir `ps` ao fim de cada suíte.
- [ ] Servidor MCP só sobe no 1º Pane orquestrado (economiza ~9 MB RSS) — otimização opcional.
- [x] Copiar `prompts/*.md` e `gancho.mjs` para o dist e asarUnpack (build:main chama scripts/copiar-ativos.mjs).
- [ ] API para abrir arquivo do método (hoje só 'Copiar caminho') — pós-MVP.
- [ ] `--destaque-texto` não muda com cor personalizada; Sobre sem caminhos reais de dados — pós-MVP.

- [x] **UI compacta dos terminais (D-32)** — topo 40 px, rodapé 26 px, linha única 28 px, abas 24–26 px, cabeçalho de painel 18 px; fração da altura: 0,881 (1 painel), ≥ 0,85 (2), ≥ 0,80 (4), 0,909 (foco). Capturas em docs/ade/perf/compacto-*.png.

- [x] Polimento visual: retângulo cinza (verificado na captura) no canto inferior direito dos painéis (resto de barra de rolagem do xterm) — estilizar/ocultar; `tsc -p tsconfig.test.json` com mocks sem `portoes/liberarPortao` em testes de missões (agente dos portões).

- [ ] Flaky sob carga a estabilizar (agente de perf): adaptador-node-pty, foco da paleta ≤ 50 ms, perf do terminal na 1ª rodada.
- [ ] Faltam no relatório de perf: P-08, P-09, P-10, P-11, P-14 (agente de perf).
- [ ] Menu/bandeja/notificação pausada só têm teste unitário (sem e2e).
- [ ] `gate_pending` na UI é informativo (não detecta a tentativa real de spawn: a tool precisa emitir evento).

- [ ] Pequenos: botão 'Alertas' do topo ainda não faz nada; × de fechar aba dentro do tablist (axe estrito pode apontar aria-required-children); divisor de painéis com alvo de ~8 px (D-32).

## Bloqueios
(nenhum)

## Log
- 2026-09-30 · Plano escrito (`docs/ade/`), base de conhecimento copiada para `docs/ade/base/`.
- 2026-09-30 · Fase 0 quase fechada: e2e real (5 testes) e perf verdes. T-00.08 (empacotamento) com agente. Fase 1 lançada em 3 frentes (PTY+daemon / detecção+anexos+atividade / terminal no renderer).
- Decisão D-28 (registrar): API exposta ao renderer chama-se `window.ade` (nome neutro) para a varredura de marca não vazar o nome do produto.
- 2026-09-30 · T-02.01 e T-02.02 concluídas (113 testes do domínio/banco/git). Cor de destaque trocada para azul (D-31). Em andamento: PTY+daemon, detecção+anexos+atividade, terminal no renderer, lógica do método (T-04.01–04.04).
- 2026-09-30 · Concluídos (lógica): PTY+daemon, detecção+anexos+atividade, terminal no renderer (T-01.05/06 lado UI), método (parser/modelo/observador). Em andamento: ligação dos terminais no main (T-01.04/07/08/09), serviços de domínio + IPC (T-02.03–06, T-04.06–09), UIs de Workspaces/Provedores/Missões (T-02.07) e do Método (T-04.05).
- 2026-09-30 · Domínio ligado no main (banco + workspaces + terminais + serviços). E2E real: 15 testes verdes (app, terminais, domínio). P-01 359 ms, P-02 36 ms, P-12 23 ms. Suíte: 1139 testes (falhas só em arquivos em andamento da Fase 3). Em andamento: MCP/orquestração, Início+Config, paleta+menu+tray, perf do terminal.
- Flake a endurecer: src/main/servicos.test.ts (coalescência de workspaces:mudou) falhou uma vez sob carga e passou isolado.
- 2026-09-30 · Fase 3 fechada (MCP real, hooks por Pane, e2e de delegação). Limpeza de processos de teste implementada após vazamento de ~222 processos. Requisito de UI compacta (D-32) e plano de versionamento (Fase 6) registrados. Em andamento: UI compacta dos terminais + UI da Missão; portões de intake.
- 2026-09-30 · UI compacta e UI da Missão prontas (verificadas por captura de tela). Nome do produto cortado no menu recolhido corrigido.
- 2026-09-30 · Integrações finais fechadas (menu/bandeja, config, descartar, paleta, model_list). verificar: 1414 testes; e2e+perf: 49 testes verdes. Em andamento: perf completo, a11y, pacote+docs. Depois: auditoria do MVP (T-05.07).
- 2026-09-30 · Empacotamento fechado: bug do daemon empacotado achado e corrigido; electron-updater removido das dependências. Falta: perf completo (agente em andamento) e T-05.07 (auditoria).
- 2026-09-30 · T-05.04 fechado. Auditoria independente (T-05.07) em andamento. Fase 6A (vcs: detecção/executor/observador/status/diff) e planos das fases 7–13 em andamento.
- 2026-10-01 · Auditoria do MVP: NÃO (AUD-01 e AUD-02 ALTA). AUD-01 corrigido pelo coordenador; corretor lançado para AUD-02 + 13 MEDIA. Planos F9/F10/F15 prontos. Fase 6B-1 (stage/commit/branches/stash/worktrees) em andamento.
