# Decisões

Formato: `D-NN` · decisão · alternativa descartada · motivo. Status `fechada` salvo indicação.
Tudo aqui foi decidido pelo agente sob autonomia total; o que é do dono está em
`PENDENCIAS-DO-DONO.md`.

## Produto

**D-01 · Nome `ExpxV` em uma constante única.** `src/nucleo/produto.ts` exporta nome, id, scheme,
appId, pasta de dados, prefixos de socket e de variáveis de ambiente. Um teste de varredura proíbe
o nome literal fora desse arquivo. *Descartado:* espalhar o nome. *Motivo:* o dono ditou "XPEV" e a
grafia pode mudar; renomear tem de custar um arquivo.

**D-02 · App separado do ExpxMedia, só identidade visual compartilhada.** Sem pacote comum; tokens e
padrões são copiados e adaptados. Dois apps instalados lado a lado não podem colidir (socket,
`userData`, scheme, appId, protocolo). *Descartado:* pacote `@expx/terminal-core` compartilhado.

**D-03 · Escopo: todas as fases descritas, tasks detalhadas só até o MVP.** MVP = fases 0 a 5.
Pós-MVP (fases 6 a 12) fica resumido em `06-FASES.md` e será detalhado quando o MVP fechar.

**D-04 · O diferencial é o método Expx de primeira classe.** O ADE é um **observador de disco e
disparador de prompts**: lê `docs/**` e `docs/eventos/*.jsonl`, traduz em UI e digita comandos nos
terminais. Nunca grava artefato de estado do método (quem escreve é a skill). *Fonte:* `base/F-…`.

**D-05 · Funcionalidades cortadas do Overclock.** Fora: Zero, Overrunner, entitlements/planos/trial,
modo Legal, STT local, host mode, Reflexo do Jarvis, atalhos nativos do macOS, relay/VPS/app iOS
(Bot). Motivo: não cabem num ADE de dev com método Expx ou são produtos à parte (`base/D-…`).

## Stack

**D-06 · Electron 37.10.3, node-pty 1.1.0, xterm 6.0.0, React 19.3, Vite 8, Vitest 4, TypeScript
estrito, Playwright 1.63** — versões idênticas às do ExpxMedia. Libs de terminal/PTY/Electron em
versão **exata**. *Motivo:* já provadas no empacotamento e no PTY real.

**D-07 · Um único `package.json` na raiz, sem workspaces.** `src/main` (CJS), `src/preload`,
`src/renderer` (Vite, ESM), `src/nucleo` (lógica pura, sem Electron), `src/daemon`. *Descartado:*
monorepo. *Motivo:* menos peças, build mais rápido, menos fricção para o agente.

**D-08 · SQLite via `node:sqlite` (embutido no Node 22/Electron 37), sem módulo nativo extra.**
WAL, statements preparados, migrations versionadas, escrita multi-tabela em transação.
*Descartado:* better-sqlite3. *Motivo:* evita um segundo módulo nativo para reconstruir por
plataforma; menor peso de instalação. *Risco registrado:* API marcada experimental; isolada atrás
de `src/nucleo/banco/` para trocar sem tocar o resto. Verificar no Electron real na T-00.05.

**D-09 · O renderer carrega de um scheme privilegiado próprio (`<scheme>://app/`), sem servidor HTTP
local.** IPC tipado. *Descartado:* servidor local em porta aleatória como no ExpxMedia. *Motivo:*
uma porta a menos, origem estável (nada de `localStorage` perdido), menos um componente para
inicializar, nenhum caminho HTTP para proteger. O estado vem por IPC/eventos, não por WebSocket.

**D-10 · Sem roteador, sem Redux, sem Tailwind, sem biblioteca de componentes.** React puro,
navegação por estado, estado de domínio em stores mínimos (`useSyncExternalStore`). CSS em
arquivos por componente + um `tokens.css` só de variáveis. *Motivo:* peso e velocidade.

**D-11 · Terminal no renderer: um xterm por painel visível, WebGL só no painel em foco e nos demais
até 6 visíveis; o resto usa o renderer DOM.** O limite de contextos WebGL do Chromium (~16) nunca é
atingido. Painéis fora de vista ficam **desmontados** e são reidratados do armazém de saída.
*Descartado:* "Overdrive" (canvas único para todos os painéis) no MVP — alto risco técnico sem
ganho provado. Reavaliar no pós-MVP com medição.

**D-12 · PTY no daemon (processo separado), portado do ExpxMedia** (`sessoes`, `daemon/*`):
sessões sobrevivem ao fechamento do app, reload do renderer nunca mata painel, `AdaptadorNodePty`
como reserva. Protocolo NDJSON em socket Unix / named pipe, token 0600.

**D-13 · MCP do app: servidor HTTP em loopback dentro do main**, um token por Pane
(`{workspace_id, mission_id, pane_id, role, mode, tools_allow[]}`), `Authorization: Bearer`.
`tools/list` devolve só o permitido. *Descartado:* ponte stdio (um processo filho por CLI).
*Motivo:* menos processos, menos memória, startup da CLI mais rápido.

**D-14 · Permissões das CLIs: padrão seguro, automático por opt-in.** Painel livre abre a CLI com
as aprovações normais. Workers de Missão em worktree podem rodar em modo automático **se o
workspace habilitar** (`permissao: seguro|automatico`). Nunca usar o bypass total de sandbox do
Codex. *Motivo:* num ADE de dev isso é decisão de segurança; o ExpxMedia ligava sempre o automático.
Registrado também em `PENDENCIAS-DO-DONO.md`.

**D-15 · Temas claro e escuro desde o dia 1**, tokens como variáveis; dois temas de xterm.
Fundo da janela acompanha o tema (teste de contrato CSS ↔ main nos dois).

**D-16 · Identidade visual = a do ExpxMedia** (neutros escuros `#16181a…`, destaque **azul** `#2563eb`
(pedido do dono: o destaque do ExpxV é azul, não rosa nem roxo), segunda cor azul-ciano `#38bdf8`, Chakra Petch + JetBrains Mono embarcadas, menu lateral 76↔232 px, topo
64 px, rodapé 40 px). O destaque é sobrescrevível via configuração (mecanismo do `marca.ts`).

**D-17 · Idioma.** UI em PT-BR. Identificadores de domínio em PT sem acento (M16); nomes de
protocolo (tools MCP, eventos) em inglês porque são contratos externos das CLIs.

## Método Expx

**D-18 · Parser tolerante.** Frontmatter YAML com `expx_schema: 1`; chave extra é aceita, `kind`
desconhecido vira "desconhecido" (nunca erro), YAML truncado é ignorado até o próximo evento do
watcher, JSONL lê linha completa e tolera a última incompleta e a rotação `<id>.N.jsonl`. Drift de
contrato conhecido (prodx usa `schema: expx-schema-v1`/`pd_id`; legadox/stackx sem frontmatter)
tratado por leitores específicos. *Fonte:* `base/F-…` §6.

**D-19 · Mission ↔ trabalho.** Mission de feature = um trabalho sprintx
(`docs/sprintx/features/<slug>/` + worktree `feature/<slug>`); de ocorrência = runx
(`docs/manutencao/<OC-ID>-<slug>/`); de pedido cru = prodx (`PD-ID`); de projeto = buildx
(`projeto_id`, features `FT-NN`). Card = task `T-NN.MM`. Handoff de task = `task_concluida` no
rastro + `status: concluida`; **o disco vence o rastro em conflito**.

**D-20 · O ADE dispara `/expx:<nome> <argumento>` (Claude Code) ou `/<nome> <argumento>`
(OpenCode), sempre com argumento**, no stdin do Pane com `cwd` = worktree. Nunca mais de uma
entrada automática por vez; Pane `aguardando` não recebe reenvio.

**D-21 · Avaliador em Pane separado.** F5 (auditoria), E4 (QA) e E3 do mergex sugerem abrir Pane
novo, para manter "quem implementa não aprova". Assinatura do prodx, aprovação de raio ALTO,
`mergex-revisar` e merge são **sempre humanos**; o ADE só leva a pessoa ao arquivo.

**D-22 · Worktrees.** O ADE cria o worktree de Missões ad hoc com `git worktree add -b` e
`../<repo>--<slug>`, e descobre os criados pelas skills via `git worktree list`. Um watcher por
worktree. Uma Mission por árvore.

## Processo

**D-23 · Sem commits, sem push, sem publicação** (regra do dono). Sem CI remoto configurado; os
workflows ficam versionados no repo mas nada é disparado.

**D-24 · Auto-update configurado, desligado enquanto não houver repositório de releases.**
`electron-updater` com `publish` apontando para um placeholder; nenhuma chamada de rede sem
`app.isPackaged` e sem configuração explícita.

**D-25 · Telemetria: nenhuma.** Diagnóstico copiável só com metadados (padrão do ExpxMedia).

**D-26 · Windows.** Projetado e testado em unidade (ConPTY, wrappers `.cmd/.ps1`, `taskkill /t`,
`Ctrl+Shift+tecla`), sem validação em máquina Windows nesta execução. Registrado como risco.

**D-27 · Node 22 em tudo** (local, testes, CI versionado), corrigindo a inconsistência 20/22 do
ExpxMedia.

**D-28 · API do preload exposta como `window.ade`.** Nome neutro, sem o id do produto, para a
varredura de marca (D-01) valer também no IPC. *Descartado:* `window.<produto>`.

**D-29 · Preferências e tema fora do banco.** `preferencias.json` em `<userData>` (escrita atômica):
o tema precisa ser lido antes da janela, sem esperar o SQLite (P-01). Configurações simples
(`app:config_*`) usam o mesmo arquivo; chaves `tema_*` e `sistema_*` são reservadas.

**D-30 · Preload sem imports de runtime.** O preload roda com `sandbox: true` e só pode requerer
`electron`; os nomes de canal ficam inline e um teste confere que batem com `compartilhado/ipc.ts`.

**D-31 · Cor de destaque azul.** Pedido explícito do dono: o destaque do produto é **azul** (`#2563eb`,
texto sobre fundo escuro `#7fb0ff`, claro `#1d4ed8`), com segunda cor azul-ciano (`#38bdf8` / `#0284c7`)
no degradê; nada de rosa ou roxo. Token `--rosa` renomeado para `--destaque-2`. O restante da
identidade (neutros, fontes, casca) segue a família do ExpxMedia. Contraste do texto branco sobre o
destaque ≥ 4,5:1. *Descartado:* manter o roxo do ExpxMedia.

**D-32 · Área de trabalho dos terminais maximizada.** Pedido do dono: parecido com o ExpxMedia, mas com o
cromado mínimo — uma linha só de controles, abas e botões pequenos, fontes e ícones menores, casca mais
fina (topo 40 px, rodapé 26 px). Detalhes e medidas em `04-UI-UX.md` ("Área de trabalho máxima"). Um teste
mede a fração da altura da janela ocupada pelo terminal (≥ 90% da altura útil da tela Terminais).

## Versionamento (Fase 6; detalhes em `fase-06-versionamento.md`)

**D-33 · Git/GitHub/SVN pelos binários da máquina.** Sem isomorphic-git nem similares: fidelidade total ao `git`
do usuário (credenciais, hooks, config), zero peso no pacote. Leitura sempre com `GIT_OPTIONAL_LOCKS=0`.

**D-34 · GitHub só por `gh`.** O ADE nunca guarda nem lê token; GitHub Enterprise por hostname; GitLab e Bitbucket
como extensão futura atrás da interface `Forge`.

**D-35 · SVN sem worktree.** Missão = cópia de trabalho irmã `../<repo>--<slug>`; branch no servidor só por ação
explícita e confirmada; senha nunca em argv (`--non-interactive`; autenticar pelo terminal).

**D-36 · Guard rails de escrita.** Automação do ADE nunca comita na branch padrão nem força push; `--force-with-lease`
só manual, com confirmação digitada, fora da branch padrão; descartar vai para a lixeira/stash de segurança.

**D-31 (ajuste) · Azul do tema escuro `#2a6af0`.** A auditoria de contraste (T-05.05) reprovou o `#2563eb` sobre as superfícies
escuras (2,9:1). O destaque do tema escuro passou a `#2a6af0` (continua azul; texto branco sobre ele 4,75:1; o claro mantém
`#2563eb`, 5,17:1). Existe o teste `src/renderer/a11y/contraste.test.ts` que mede os pares de cor reais dos dois temas.

**D-37 · Teclado nos terminais.** Setas nas abas só movem o foco (Enter seleciona), para o terminal não roubar o foco a cada seta;
`Cmd+Shift+M` / `Ctrl+Shift+M` é a saída de teclado do terminal (WCAG 2.1.2).

**D-24 (ajuste) · Auto-update.** O módulo de atualização não foi criado no MVP e o `electron-updater` saiu das
dependências (nada em `src/` o usa; um teste confere). A atualização automática entra junto com o repositório de
releases e a assinatura (pendências P-03). Enquanto isso: nenhuma chamada de rede de versão.

**D-38 · Patch do node-pty no empacotamento.** O node-pty 1.1.0 troca `app.asar` por `app.asar.unpacked` sem checar se o
caminho já é o desempacotado (`.unpacked.unpacked`), o que quebrava todo PTY no app empacotado. O `afterPack` aplica um patch
idempotente e **o build falha** se o trecho do node-pty mudar e o patch deixar de casar (teste cobre). `dist:mac` universal usa
`mergeASARs: false` (o glob do `@electron/universal` estourava); plano B: `npm run dist:mac:arm64`.


## Catálogo e Memória (Fases 7 e 8; detalhes em `fase-07-catalogo.md` e `fase-08-memoria.md`)

**D-40 · Catálogo: CLIs e tipos de item.** CLIs: `claude`, `codex`, `opencode`, `gemini` e o formato portátil `.agents/skills`;
sem Antigravity (fora do ExpxV, D-05). Tipos: `skill`, `mcp_server`, `mcp_tool`, `plugin`, `hook`, `rule`; `tool` nativa e `command` ficam
fora. Origem extra `metodo` (skills/hooks vindos do `.expx/expx-lock.json`): somente leitura, gerenciada pelo `expxdev`.
*Descartado:* copiar a lista de 3 CLIs da spec. *Motivo:* o ADE detecta claude/codex/gemini/opencode (D-06) e o método vive no catálogo.

**D-41 · O catálogo só escreve no escopo global, por ação explícita, nunca no repositório.** Instalar = symlink (junction/cópia no
Windows) para `~/…` da CLI destino, atômico; escopo projeto é só leitura (05-CONTRATOS §5 continua valendo: o ADE só grava `.expxv/`).
Remover: só o que o app criou; skill nativa vai para a lixeira com confirmação (D-36). *Descartado:* instalar em `<repo>/.claude/skills`
como o ExpxMedia. *Motivo:* não poluir o repositório do usuário nem o `.claude/` do método.

**D-42 · O scanner não executa nada do usuário e redige configs de MCP na origem.** Nunca roda `tools/list` na varredura (só sob demanda,
com confirmação, timeout 5 s, ambiente mínimo); de `~/.claude.json`/`config.toml`/`.mcp.json` guarda só nome, transporte, executável
(basename), nº de argumentos, `scheme://host` e **nomes** de chaves de `env`/headers — nunca valores; hooks guardam executável + nº
de argumentos. *Motivo:* AGENTS regra 3 (segredo nunca lido/escrito) e prompt-injection por config de terceiros.

**D-43 · Skills embarcadas `ev-*` (7) não são copiadas no boot.** São entregues **por Pane** em plugin efêmero em
`<userData>/panes/<pane_id>/plugin/` (`--plugin-dir`, só Claude Code; as demais recebem o resumo no arquivo de instruções);
instalar no escopo global é opt-in; `opt_out` persistente; atualização por hash (instalada = registrada → sobrescreve; editada →
preserva e avisa). Prefixo em `PRODUTO.prefixoSkill`. *Descartado:* copiar no boot para cada CLI (spec RF-05.30) e "voltam sempre"
(RF-05.32). *Motivo:* leveza do boot, não mexer na casa do usuário, resolve o [LAC] do opt-out.

**D-44 · Isolamento de skills/MCPs por Pane: deny-by-default em Missão, duro só no Claude Code.** `squad`/`agentico`: lista vazia + mínimo do
papel (+ `grupo:metodo` no piloto de Missão com origem do método); `livre`: sem filtro. Mecanismo duro (Claude): hook `PreToolUse`
`Skill`/`mcp__*` (falha fechada, vale sob modo automático) + `permissions.deny` + `--strict-mcp-config`. Demais CLIs: parcial, com
selo visível, evento e achado de saúde; nunca por pasta/`CODEX_HOME` (quebra login). Precedência agente > Missão > papel; o
pedido do piloto só estreita. Subagentes da CLI não são bloqueados (o método depende deles). O gate lê um **snapshot por Pane**
(`catalogo_pane_politica`), não o token. *Descartado:* isolar por prompt ou por permissão de pasta.

**D-45 · Uma linha do catálogo por `(tipo, nome_normalizado)`.** Plugin/autor são atributos; `variantes` aparece quando o hash do
conteúdo diverge entre CLIs. *Descartado:* `unique (kind, nome, plugin)` da spec (contradiz "1 linha, N badges").

**D-46 · Memória: modos mapeados ao modelo do ExpxV.** Missão `agentico` = memória completa (ligada por padrão, local); `squad` =
nunca (RF-06.42); Pane `livre` = **solo opt-in** por workspace (desligado) e só em CLI com MCP; `shell` = nunca. Não se pergunta
"Missão ou Stand" ao abrir o workspace: o modo deriva de onde o Pane nasceu e muda em Configurações. Resolve o conflito spec-02 × spec-06.

**D-47 · A memória do ADE convive com o `memox`, não compete.** O ADE nunca escreve em `.expx/memoria/` nem `docs/`, nunca roda
`memox.py indexar`, nem copia conteúdo do índice: o brief traz uma linha apontando `/expx:memox-arquivo <caminho>`. Eventos do método
(`task_concluida`, `veredito_emitido`) viram, no máximo, uma entrada `evento` deduplicada. Reindexar é sempre ação do usuário (D-04, D-20).

**D-48 · Brief: função pura, nunca persistida, entregue como dado.** `buildBrief` sem I/O nem relógio (≤ 6 000 chars, checkpoint nunca
truncado); o comando do Pane é remontado do zero a cada abertura (não existe coluna de argv salvo); entregue como **prompt inicial de
usuário**, nunca system prompt; envelope fixo `<memoria_restaurada tipo="dados">` + aviso, uma linha por entrada, escape de tag/heading/cerca/bidi/ANSI;
retomada nativa de conversa (`--resume`) dispensa o brief. *Descartado:* abordagens A e C da spec. *Motivo:* mata por construção o
bug central do original (brief velho nos args salvos) e reduz a superfície de prompt-injection.

**D-49 · Memória por linhagem de Pane.** O respawn cria Pane novo com `respawn_de`; a memória é da **linhagem** (raiz da cadeia).
Leitura de outro Pane só com `pane_id` explícito no mesmo workspace e Missão (ou ambos solo). Restore idempotente garantido também pelo
banco (`ux_pane_respawn_vivo`: no máximo 1 filho vivo por Pane), além do lock.

**D-50 · Redação linear e tudo determinístico.** `redigirTexto` (regex de tempo linear + entropia + PEM inteiro) na escrita, no
brief, na busca e na exportação; compactação e destilação por concatenação truncada, **sem LLM** (nada sai da máquina, custo zero).
*Descartado:* resumir com agente barato (spec §7.4). Redação em `src/nucleo/conhecimento/redacao.ts`, reutilizável (Fase 15).

**D-51 · Anéis.** Anel 1 (Missão) expira 24 h após o fechamento; anel 2 (projeto/workspace) = destilação determinística (top 10
por Missão, teto 50 por workspace, dedupe por hash); anel 3 (usuário) só por ação humana na UI (≤ 20 entradas de ≤ 300 chars).
Retenção padrão 90 dias, configurável 7–365. Há tela de Memória (listar, esquecer, exportar): transparência e direito de apagar.

**D-52 · FTS5 detectado em runtime, fora da migration.** `memoria_fts` criada por `garantirFts()` com `try/catch` (a migration não pode
falhar por falta do módulo no `node:sqlite` do Electron); sem FTS5, `memory_search` usa `LIKE` com teto de varredura de 5 000 linhas.

**D-53 · Tools `memory_*` por papel.** Piloto agêntico: as 5 (`memory_write`, `memory_search`, `memory_checkpoint`, `memory_brief`,
`memory_forget`); worker agêntico: só `write` (decision/risk/fact) e `search`; livre-solo: as 5 no escopo `pane`; squad: nenhuma;
reconferido a cada chamada (`memory_disabled`); 30 gravações/min por Pane (`rule_violation/limit_reached`).

**D-54 · Fronteira Memória × RAG (Fase 15).** `MemoryEntry` é a unidade curta de continuidade por Pane/Missão; o RAG é a fonte de
verdade da busca semântica e do histórico longo. Redação, normalização e chunking vivem em `src/nucleo/conhecimento/{redacao,ingestao}.ts`
e são reutilizados pela Fase 15; a única ponte é `PortaConhecimento.registrar(evento)` (mão única, at-least-once, id determinístico, texto
já redigido, nunca bloqueia nem lança; porta nula até a Fase 15). `build_brief` nunca consulta o RAG; `memory_search` continua lexical e
escopado pelo token.

## Voz, captura, Bench, Jarvis e controle remoto (Fases 11 a 13; detalhes em `fase-11-*`, `fase-12-*`, `fase-13-*`)

**D-60 · Motor de STT por adaptador, nenhum embarcado, padrão sem motor.** O ditado só existe com um motor configurado:
`comando_local` (executável que a PESSOA já tem, argumentos em lista, sem shell) ou `http_compativel` (endpoint
`/audio/transcriptions` com URL e chave dela). O ExpxV **nunca baixa nem instala** runtime de voz (o ExpxMedia baixava instalador
remoto). Mantém o corte do STT embarcado de D-05; só abre a porta para o executável do usuário. *Descartado:* Whisper/Parakeet
embarcado ou auto-instalado; Groq fixo. *Motivo:* peso, rede no primeiro uso e privacidade.

**D-61 · Hold-to-talk dentro do app; alternar global opcional; hook nativo adiado.** O `globalShortcut` do Electron não detecta
key-up nem modificador isolado: segurar-para-falar usa `keydown`/`keyup` do documento (atalho `Cmd+Shift+Espaço`,
`Ctrl+Shift+Espaço` no Windows/Linux, D-37); fora do foco só o modo alternar (debounce 300 ms). A porta `TeclaGlobal` fica pronta com
adaptador `nativo` indisponível (P-35). *Descartado:* `uiohook-napi` agora (módulo nativo, Input Monitoring, peso). *Motivo:* o
destino é o terminal do próprio app, então a tecla segurada com o app em foco resolve o uso real.

**D-62 · Áudio capturado no renderer (AudioWorklet), microfone aberto só durante a fala, áudio nunca em disco.** PCM16 16 kHz mono em
memória (teto 120 s ≈ 3,84 MB); o único arquivo possível é o WAV temporário 0700 do motor local, apagado em `finally`. Permissão de
microfone pedida só no primeiro uso, com diálogo explicativo próprio; `setPermissionRequestHandler` passa a permitir **apenas** `media`
de áudio da origem do app. *Descartado:* captura no main/addon nativo; stream sempre aberto (pré-aquecido). *Motivo:* privacidade
(indicador do SO aceso só ao falar) e zero dependência.

**D-63 · Injeção direta no PTY do Pane em foco, sem Enter, sem clipboard, sem Acessibilidade.** O texto ditado é sanitizado (sem
controles/ESC/CR/LF, ≤ 4 000 caracteres) e a pessoa submete. Sem Pane em foco: vai ao histórico (copiável). *Descartado:* colar em
qualquer app com teclas sintéticas (spec 07). *Motivo:* elimina Acessibilidade/Input Monitoring e a corrida do clipboard.

**D-64 · Nenhum serviço remoto liga sem consentimento registrado; segredos só no `safeStorage`.** Infra comum das fases 11–13:
tabela `consentimento` por (serviço, host) — URL trocada invalida —, cofre `<userData>/segredos.bin` 0600 que nunca devolve valor ao
renderer e **não grava** se `safeStorage` não está disponível. Todo serviço remoto (STT, refino, qualquer provedor de voz) nasce
DESLIGADO. *Descartado:* chaves em `preferencias.json`; consentimento global único. *Motivo:* áudio e captura são dados pessoais.

**D-65 · Captura: janela do app (sem permissão) e tela (com permissão), imagem congelada por display, quadros sem ffmpeg, sem tocar nos
atalhos nativos, sem MCP de captura.** Capturar antes do overlay resolve Retina, multi-monitor e "overlay na foto". Gravação =
amostragem de 1 ou 2 fps (≤ 60 s, ≤ 120 quadros) em `.expxv/capturas/quadros/`. Atalhos próprios `Cmd/Ctrl+Shift+5` e `+6`; nunca
`defaults write` nos atalhos do macOS. Nenhuma tool MCP de captura ou de voz: agente não vê a tela nem ouve o microfone. *Descartado:*
ffmpeg embutido (~70 MB), troca de atalhos nativos, upload. *Motivo:* peso, fragilidade e privacidade.

**D-66 · Histórico de fala só em memória por padrão; persistir é opt-in (200 linhas, 7 dias).** Fala pode conter segredo. O dicionário
técnico persiste (não é fala). *Descartado:* 500 entradas persistidas por padrão (spec 07). *Motivo:* privacidade.

**D-67 · Bench executa em processos filhos headless, sem Pane, sempre em sandbox; sem sandbox a Run é recusada.** macOS: `sandbox-exec`
gerado por Run (escrita só no `workdir`, tmp e config da conta dedicada; leitura negada a credenciais); Codex usa o sandbox nativo da
CLI (nunca o bypass total, D-14; sandbox aninhado falharia). Windows: desabilitado por padrão (P-38). Env por **allowlist**, sem token
nem MCP do ExpxV, sem skills/hooks do app; alvos exigem **conta dedicada**. *Descartado:* Pane visível por execução; degradar para
"rodar sem sandbox". *Motivo:* `always-approve` executa código gerado por IA sem confirmação.

**D-68 · Nenhuma Run do Bench sem consentimento humano de uso único; agentes só leem.** Token de TTL 120 s, uso único, atrelado à
estimativa, obtido digitando `RODAR` na UI; vale para Run, re-run e julgamento. MCP expõe só `bench_list_tasks`, `bench_run_status`,
`bench_compare`, `bench_recommend`, `bench_export_policy` (piloto agêntico); **não existem** tools que iniciem, re-rodem, julguem ou
publiquem. *Descartado:* `bench_run_suite` por MCP (spec 14). *Motivo:* custo e execução de código não podem ser decididos por agente.

**D-69 · Score recalculado por conjunto a partir de métricas brutas; custo desconhecido ≠ 0; publicação cortada.** `composite = 0,6·Q +
0,2·S + 0,2·C` com portão (`Q < 4` ou checagem crítica falha zera S e C); custo `null` exclui C e renormaliza os pesos, com selo "sem
custo". Cortados: site/Nebula, `bench_publish`, `/prompts`, squads recomendados, importar histórico de prompts, Entitlement; fica
relatório local `.md/.json`. `bench_export_policy` é rascunho e nunca grava política. *Motivo:* normalização por mínimo muda quando um
alvo entra; nada pode sair da máquina (D-23).

**D-70 · Banco do Bench separado (`<userData>/bench/bench.db`), execuções fora de repositórios, screenshot por `BrowserWindow` offscreen
isolada.** Sem Chrome externo, sem rede, permissões negadas, janela sempre destruída; preços em arquivo de dados **vazio** por padrão
(P-39). *Descartado:* tabelas no `expxv.db`; Playwright/Chrome em produção. *Motivo:* volume de logs, apagar em bloco, zero dependência.

**D-71 · Jarvis em cascata local-first; realtime remoto é só contrato e falso.** Fala (tecla segurada) → STT da Fase 11 → gramática
PT-BR determinística (lista fechada, sem LLM) → piloto pelo MCP → TTS com **vozes locais** do SO (sem voz local: só legenda). Não há
sessão de voz remota aberta: o modo de falha nº 1 da spec 11 (R$ 83/dia de input reenviado) deixa de existir por desenho. A interface
`ProvedorVozRealtime` e a política de custo (T_idle 60 s, gate, só diferenças, resumo > 8 000, limite diário) ficam testadas com falso;
adaptador real só com P-40. *Descartado:* Gemini Live/OpenAI Realtime como padrão; wake word. *Motivo:* custo, privacidade e injeção.

**D-72 · Voz é entrada, não autoridade.** Microfone só com a tecla segurada (sem wake word); o Jarvis só **lê** e envia texto **ao
piloto** (ou a painel por `display_id`, dígito a dígito) e cria Missão `free`; toda escrita confirma a cada vez com `args_hash`;
conteúdo de painel/web/issue é dado e nunca autoriza escrita. Sem exec/`run_command`/`open_app`/calendário/host mode/Reflexo/
`view_screen` (D-05 confirmado), sem `auto_approve_voice` nem cache de aprovação. *Motivo:* prompt injection e eco.

**D-73 · Relay, app móvel e VPS (Bot) NÃO são implementados na Fase 13.** Decisão do portão G3 do estudo de ameaças (T-13.01): o
relay só reabre com a pendência P-42 respondida "sim" e novo estudo (app nativo, hospedagem, custo). Os requisitos mínimos (relay cego,
pareamento de uso único e TTL curto, E2E, sem estado, revogação derruba o canal) ficam só em documentação; T-13.22 bloqueada.
*Motivo:* quatro produtos em um, superfície de execução remota e custo de manutenção (`base/D-ecossistema.md`).

**D-74 · Controle remoto local: desligado por padrão e a cada reinício, só LAN, HTTPS autoassinado, pareamento com PSK + ECDH + SAS,
permissões graduadas.** Escuta apenas no IP privado escolhido (nunca `0.0.0.0`), `Host`/`Origin` exatos, 404 uniforme; dispositivo
nasce `leitura` (`mensagem_confirmada` confirma no desktop; `mensagem_direta` exige digitar `PERMITIR` e é suspensa ao bloquear a
tela); só chave pública do dispositivo no servidor; ações humanas do método (D-21) nunca. Residuais declarados (P-41): atacante
**ativo** na LAN que serve página adulterada (sem app nativo não há como provar a página) e composição criptográfica sem auditoria
externa. Certificado X.509 mínimo gerado sem dependência nova. *Descartado:* QR (biblioteca), Tailscale, porta pública.

**D-75 · Atores no MCP e confirmação pendente de uso único.** Claims do token ganham `ator: pane|jarvis|remoto` (padrão `pane`, nada
muda para o que existe); tokens de `jarvis` (≤ 60 min) e `remoto` (≤ 60 s por requisição) só em memória; matriz própria por ator
(nunca `role = piloto`); toda chamada de `ator ≠ pane` é auditada em `chamada_externa` com argumentos redigidos, retenção 30 dias.
`mission_create` por ator exige `client_request_id` idempotente. *Motivo:* uma única via de autorização e auditoria para tudo que não é um Pane.

## RAG, grafo e chat (Fase 15; detalhes em `fase-15-rag-chat.md`)

**D-80 · Conhecimento em arquivo SQLite próprio, dentro de um worker.** `<userData>/conhecimento.db` (WAL), aberto só na thread do worker; o `expxv.db` do domínio nunca habilita extensão. Consulta com timeout de 150 ms (nunca trava tarefa). *Descartado:* tabelas no `expxv.db`. *Motivo:* corpus grande não pode disputar lock nem memória com o domínio; isola `loadExtension` e permite apagar/reconstruir o índice sem risco.

**D-81 · Índice vetorial: exato em `Float32Array` é o padrão e o fallback obrigatório; `sqlite-vec` é aceleração opcional.** Atrás de `IndiceVetorial`. `sqlite-vec` só entra (`optionalDependencies`, `asarUnpack`) se o spike T-15.01 provar que carrega no `node:sqlite` do Electron real e o benchmark mostrar ganho. Regra de tamanho: `N×dim ≤ 25 M` exato f32; acima, `vec0` → int8 → pré-filtro lexical. FTS5 (detectado em runtime, como D-52) + RRF para a parte lexical. *Descartado:* depender do `sqlite-vec`. *Motivo:* extensão nativa por plataforma, notarização/universal mac incertos (R-05).

**D-82 · Embeddings: piso `hash-256-v1` determinístico; modelo real plugável por coleção.** Modelo e dimensão por coleção, vetores por `(chunk, modelo)`, reembutir em segundo plano, `modelo_ativo` só muda a 100 % de cobertura. 1º modelo real = Ollama em loopback; ONNX/transformers.js (WASM) com adaptador pronto mas **dependência não instalada** até a resposta do dono (P-50). *Motivo:* o plano funciona 100 % sem download; hash é idêntico em toda máquina (compartilhável).

**D-83 · Busca híbrida = RRF (k=60) entre BM25 e vetor, com fatores de tipo, feedback, tempo e Missão;** máx. 2 chunks por documento; piso de decaimento 0,3 (nada some por idade).

**D-84 · Consulta obrigatória em cinco camadas** (tools MCP `rag_*` em todo modo/papel; contexto prévio injetado pelo ADE em todo despacho; hook `SessionStart`/`UserPromptSubmit`; regra de orquestração aviso→bloqueio opcional; vazio/lento/fora = segue). **Emenda D-47:** o ADE pode registrar `UserPromptSubmit` no settings **por Pane** (soma aos hooks do usuário/projeto); continua proibido tocar no hook do memox. Consulta com estado vazio/lento/indisponível conta como feita.

**D-85 · Aprendizado: determinístico por padrão, assistido por IA opt-in.** Estados `candidato→ativo→arquivado|rejeitado`; fonte agente nasce `candidato`; agente sozinho nunca arquiva/rejeita; dedupe por hash e similaridade; feedback append-only; decaimento por tipo; consolidação em fatias de 20 ms.

**D-86 · Transcrições das CLIs: só sessões iniciadas pelo ExpxV por padrão;** importar histórico antigo exige consentimento; nunca saída de ferramenta nem raciocínio; incremental por offset; retenção 90 dias.

**D-87 · Grafo determinístico (sem LLM) e tela em canvas 2D** com layout de forças próprio (Barnes-Hut) em Worker, sprites de nós e posições persistidas; sem biblioteca de grafo; lista acessível equivalente.

**D-88 · Chat: CLI headless com a assinatura do usuário, nunca chave de API própria; ações só saem de código determinístico.** O LLM responde e, opcionalmente, reescreve o texto do prompt; nunca produz `Acao`. Padrão `direto` para ações reversíveis, confirmação para destrutivas, >3 Panes ou workspace `automatico`. O chat nunca assina prodx, aprova raio ALTO, roda `mergex-revisar` nem faz merge (D-21). Nunca `--bare` (quebra a assinatura), `--dangerously-*` nem `--auto`.

**D-89 · `src/nucleo/cli-headless/` compartilhado** (adaptador por CLI com `verificarFlags` por `--help`, `AdaptadorHeadless`); a Fase 12 (Bench) reaproveita em vez de criar o seu.

**D-90 · RAG online = replicação, com o local como cache quente de leitura.** Modos `local` (padrão) · `espelho` · `compartilhado`; a consulta contextual nunca vai à rede; consulta "equipe ao vivo" opcional (timeout 3 s); offline continua local. Adaptadores da 1ª onda só com `fetch`: Qdrant, Supabase/PostgREST, Upstash Vector, Pinecone (ordem de `base/G-provedores-vetoriais.md`). Interface `ArmazenamentoConhecimento` de G §4 + `obterPorIds` e `criado_em_ms`.

**D-91 · O que migra para o online por padrão:** aprendizados, decisões, docs, relatórios, causa-raiz/QA, commits, tasks, handoffs. **Código, transcrições e chat ficam desligados** e com aviso forte. Consentimento por (provedor, host, coleção, versão da política) com amostra redigida; migração em lotes retomável, verificada, com cópia local mantida e "voltar para local".

**D-92 · Identidade do projeto compartilhado** = `sha256(remote git origin normalizado)[:16]` (ou slug informado); nunca caminho absoluto; autor = rótulo pseudônimo escolhido; ids determinísticos (G §7) e feedback append-only para convergir sem duplicar.

**D-93 · Dependências novas da Fase 15:** nenhuma obrigatória. `sqlite-vec` em `optionalDependencies` só se o spike passar; ONNX/transformers.js só após P-50. Todo adaptador de backend usa apenas `fetch` (sem gRPC, sem driver TCP).

## Harness, limites, troca por consumo, OpenRouter, custo e board (Fases 9 e 10)

> Numeração: D-55 a D-59 e D-100 a D-117. Os números D-60 a D-75 já pertencem às Fases 11 a 13 (e D-40 a D-54 às Fases 7 e 8); a faixa D-100+ foi reservada
> a estas duas fases para não colidir com planos escritos em paralelo. Detalhes e testes em `fase-09-harness-limites.md` e `fase-10-custo-board.md`.

**D-55 · Roteamento de conta: UM algoritmo, `pickAccount`, estratégia `expires_first`.** A spec-03 manda escolher a conta que **reseta primeiro** entre as não esgotadas; a
spec-09 (`headline_pick`) manda a de **maior folga**. Adotado: função pura única `pickAccount(candidatas, opcoes)` (sem I/O nem relógio) com níveis (1 medido e < 85%; 2 estimado/janelas vencidas; 3 medido e ≥ 85%, "quente"; 4 sem dado),
janela **gargalo medida e não vencida**, ordenação `(resets_at ↑, used_pct ↑, conta_id)`; `max_slack` só como estratégia **opcional** do `headline_pick`. Conta de crédito (OpenRouter) não tem reset ⇒ ordena por último.
`pickModel` (conta → outra conta → modelo equivalente por faixa em outro provedor → faixa inferior) **chama** `pickAccount` e é o único outro lugar que decide. *Descartado:* `max_slack` como padrão (deixa sobrar cota que expira, contra a tese
"bata 100% da cota"); duas implementações. *Motivo:* regra literal do dono, determinismo testável por tabela e ranking registrado na Decision para recalibrar.

**D-56 · Schema único de limites.** `LimitSnapshot`/`AccountUsage` com `kind: five_hour|weekly|monthly|credit`, `model_buckets` (cota por modelo), `fonte`, `confianca`, `idade_s`, `credit?`; usado por serviço, IPC e MCP **sem mapeamento**
(snake_case em inglês, por ser contrato externo). Janela vencida (`resets_at` passou) e `used_pct: null` são **desconhecidas**, nunca "0". *Descartado:* manter `5h/weekly` (spec-03) e `five_hour` (spec-09) lado a lado.

**D-57 · Limites sem ler credencial de CLI.** Fontes: arquivos que a própria CLI grava (rollout do Codex; JSON do statusline do Claude por Pane, gravado por script do ADE), entrada **manual**, estimativa por tokens observados (Fase 10) e saldo
do OpenRouter pela API com a chave do dono. Nunca token, keychain, `auth.json` nem `.credentials.json`; sem dado = rebaixada. Leitura de arquivo ≤ 1 por conta a cada 60 s (borda de subida lê na hora), só com a janela em foco; saldo de rede ≤ 1 a cada 5 min e só com Pane OpenRouter vivo. Formato das CLIs **a verificar** (contrato por fixture).
*Descartado:* endpoint OAuth não oficial (ToS, risco de ban). Pendência P-27.

**D-58 · Decisor externo opcional, desligado, só em opções fechadas.** Modos `jev_direto`, `jev_openrouter`, `openai_compat`; consentimento por **host + modo** antes da primeira chamada; resumo redigido ≤ 500 chars; timeout 2 s, breaker 5 min,
**regra determinística sempre vence e é o fallback**; custo por decisão com origem (`resposta|tabela|informado|desconhecido`, nunca 0 por omissão). Classifica tipo de tarefa, intenção e (opcional) modelo/esforço; **nunca** escolhe conta nem decide troca (o único dado
observado foi ele errar a conta, 38% de confiança). Contrato do JEV é [LAC]: formato padrão `probs_json` definido pelo ADE (P-16).

**D-59 · Cofre e broker.** Cofre = `safeStorage` do Electron (Keychain/DPAPI; recusa backend `basic_text`), sem criptografia própria nem pasta `.overclock`; segue D-64 (segredos só no `safeStorage`). Entradas `sensivel` nunca vão ao ambiente de Pane; `scrubber` em brief, checkpoint, relatório e erros;
broker **interno** (resolve `{{vault:NOME}}` só no main); sem MCP do cofre; sem "revelar/copiar". Payload de IPC com segredo é marcado `sensivel` e nunca logado. Cofre indisponível desabilita só o que precisa de chave (P-29).

**D-100 · Níveis de harness 1–4 sem entitlements; padrão 4; explícito vence.** Entitlements foram cortados (D-05). `pane_spawn` com `provider` informado se comporta como no MVP; o harness só atua quando o provedor é omitido (`route:"auto"`). Nível 1 nunca roteia.

**D-101 · Troca por consumo: gatilho 85%, ponto seguro, três modos.** Quando a conta em uso passa de `limiar_troca_pct` (padrão 85; 5 h **ou** semanal), propõe/executa a troca: outra conta do mesmo provedor com folga ≥ margem (10 pontos) → senão modelo da **mesma faixa** de outro provedor.
Modos por workspace: `manual`, `so_sugerir`, `automatico` (padrão derivado: `permissao automatico` ⇒ automático; `seguro` ⇒ só sugerir). Só em **ponto seguro**: Pane `pronto` e sem operação git em curso, handoff em voo ou pergunta pendente. Novo Pane com brief + checkpoint do último turno;
antigo fecha com `encerrado_motivo="superseded"`; "pensamento perdido" avisado; máx. 2 saltos por task, ≥ 10 min entre trocas, cooldown da origem. Recibo no Pane filho e log de trocas na tela Consumo. *Descartado:* trocar sem ponto seguro; decisor externo na troca.

**D-102 · Política e equivalência por faixa, em dados.** O código só conhece faixas `topo|alto|medio|rapido`; `equivalencia.json` versionado (listas ordenadas por provedor; só `opus|sonnet|haiku` do Claude e `default` das CLIs são conhecidos), override do usuário em `config` (só diferenças), modelos OpenRouter habilitados entram por faixa.
Semente gerada por faixa a partir do catálogo detectado; `fallback` nunca vazio e nunca com nome fixo; `harness_set` não é exposto ao piloto sem opt-in por workspace. *Descartado:* nomes de modelo em código. Pendência P-31.

**D-103 · TaskTypes do método.** Embutidos (`implementar`, `bug-fix`, `bug-profundo`, `refatorar`, `front`, `auditar`, `qa`, `revisar-pr`, `triar`, `planejar`, `descobrir`, `docs`, `pentest`, `geral`); gestos do método e `(skill, etapa)` mapeiam para eles (`etapas.json`);
avaliadores (`auditar`, `qa`, `revisar-pr`) preferem provedor ≠ do implementador (D-21). Ponto de integração do Maestro: `resolverPerfil(skill, etapa)`.

**D-104 · Custo é observado, nunca autorrelato.** Fontes: transcript do Claude, rollout do Codex, eventos `usage.observed` do proxy OpenRouter do ADE, banco e rastro. Nenhuma tool MCP aceita campo de custo/tokens (`handoff_submit` ignora `cost`).
Custo desconhecido ≠ 0: `usd:null`, `incompleto` ("≥"), `aproximado` ("≈"). Linhas de conversa/código dos transcripts nunca são persistidas (só `{ts, modelo, tokens, chave}`).

**D-105 · Preços em dados, USD, "equivalente em API".** `preco_modelo` (embutido `confirmado:false`, usuário, OpenRouter exato); custo **congelado** no registro (preço novo só por `reprecificar` explícito); BRL só exibição com câmbio manual; entrada em dúvida é omitida. Pendência P-39.

**D-106 · Atribuição de custo por janela.** Janelas explícitas do banco (`reivindicada_em→entregue_em`) e do rastro (`task_iniciada→task_concluida`); uma janela ⇒ card; nenhuma ⇒ `sem_card`; ≥ 2 cards no mesmo Pane ⇒ `ambigua`; piloto ⇒ `orquestracao` da Missão.
Dois cards sequenciais no mesmo Pane recebem cada um só a sua janela (RF-12.5.05). `reatribuir` idempotente quando o rastro chega depois.

**D-107 · O board é visão, não um segundo sistema de tarefas.** Seis colunas (`backlog`, `a_fazer`, `em_andamento`, `em_revisao`, `concluido`, `validado`) derivadas das tasks `T-NN.MM` do disco + banco (**o disco vence**); verde = concluído, azul = validado (também por traço/glifo);
aba **Board** dentro de Missões; **sem arrastar**, sem claim próprio, sem servidor Overclick; ações: abrir arquivo (restrito a `docs/` do worktree), abrir Pane, copiar comando do método, **delegar a worker** (briefing + Pane pelo `Router`, só em Missão existente, com confirmação). Tools MCP só de leitura: `task_list`, `task_get`, `cost_report`.

**D-108 · Cortes das specs 03, 09, 12 e 14 nesta etapa.** Fora: ARR/Stripe, Arsenal e Receitas, browser controlado pelo decisor, painel de bug, MCP do cofre, entitlements, servidor Overclick (Tier A/B/C, tokens `admin|agent|worker`, cloud, Zero, Overrunner), site público do bench.
Mantido: Retrospect, como "eficiência semanal" da tela Consumo (D-110).

**D-109 · Fonte de uso por referência `base + relativo`.** `claude_config`, `codex_home` ou `proxy` + caminho relativo; caminho absoluto só em memória; `transcript_path` do hook é validado (absoluto, `.jsonl`, dentro da base da conta); sem varrer o home do usuário.
Registros brutos por 90 dias; agregados permanentes.

**D-110 · Consumo na interface.** Rodapé (26 px, todas as páginas): ícone + `5h %` + `sem %` por conta, tempo até zerar no hover; **cota geral no topo** (pior caso + folga média + cobertura "3/4", nunca escondendo conta sem dado); tela **Consumo** (Visão geral, Previsão e eficiência, Trocas,
Detalhe por uso, Fontes e preços) com SVG próprio, sem biblioteca; histórico de amostras (só mudanças, 90 dias) e `limite_semana` permanente; previsão com mínimo de amostras (`insuficiente` é mostrado como tal).

**D-111 · Perfis de agente (squads).** `PerfilAgente {provider, cli, modelo, esforco, faixa}` e `resolverPerfil(perfil, ctx)` devolvem conta/modelo efetivos pelo mesmo `Router`; a troca por consumo usa o perfil do Pane. A Fase 14 só consome essa função; a Fase 9 não cria squads.

**D-112 · Frequência de leitura.** ≤ 1 leitura de arquivo por conta a cada 60 s (a 1ª mudança depois de calma lê na hora; as seguintes coalescem), só com foco, 0 sem foco; "atualizar" do usuário ≤ 1 a cada 5 s; saldo OpenRouter ≤ 1 a cada 5 min e só com Pane OpenRouter vivo; lista de modelos só por clique.

**D-113 · OpenRouter como provedor virtual.** `provider:"openrouter"` + CLI compatível (`opencode`, `aider` primeiro; `codex` e `goose` `a_verificar`/desligados); chave só no cofre, mascarada, "testar sem salvar"; modelos listados **só por clique** com a chave do dono e habilitados um a um (faixa, ordem, tipos permitidos);
saldo vira janela `credit`; o Pane fala com um **proxy loopback** em worker thread com **token próprio por Pane** (HMAC, `aud:"or"`, revogado ao fechar o Pane) e a chave real nunca entra em ambiente/argv; o proxy só aceita modelos habilitados e caminhos em allowlist, mede `usage` sem guardar conteúdo.
Override de endpoint só no ambiente/argv do Pane (nunca em configuração global). Opt-in com consentimento explícito (P-17).

**D-114 · Rede num lugar só.** `src/nucleo/rede/` é o **único** módulo que usa `fetch`/`http(s)`: https, allowlist de host montada a partir de consentimentos gravados (`openrouter.ai`, host do decisor), sem redirect entre hosts, teto de bytes e de tempo, sem cabeçalhos no log, sem telemetria (D-25). Sem consentimento ⇒ erro antes de abrir socket; instalação nova abre **zero** sockets.

**D-115 · Pontos de integração para a Fase 16 (Maestro).** `classificarIntencao(texto, contexto) → {intencao, confianca, fonte}` (opções fechadas; regra por palavras + estado do método; decisor opcional) e `resolverPerfil(skill, etapa, ctx) → conta/modelo efetivos`; ambos puros em relação ao banco de rota e sem criar Pane.

**D-116 · CLI sem fonte de uso = "sem fonte", nunca zero.** `gemini`, `opencode` nativo, `aider`, `qwen`, `kilo` não têm leitor de uso; o custo desses Panes é `fontes_ausentes` (alerta uma vez). Via OpenRouter a fonte é o proxy (medida). Novos leitores entram em `leitores/` + `fontes.ts`. Pendência P-82.

**D-117 · Teto de custo por Missão é só alerta.** `custo_teto` por Missão (padrão sem teto); ao cruzar o `usd` conhecido, um aviso (notificação sem foco, no máximo 1 por tipo/alvo/hora); **nada bloqueia nem aborta Pane**. Pendência P-80.

## Loja de MCPs (Fase 7B)

> Numeração: **D-130 a D-139**. Os números D-100 a D-117 já pertencem às Fases 9 e 10 e D-76 a D-99 à Fase 15 (planos escritos em paralelo); a faixa D-130+ foi reservada à Loja de MCPs.
> Pesquisa em `base/I-catalogo-mcps.md`, seed em `base/catalogo-mcps.seed.json`, plano em `fase-07b-loja-mcps.md`.

**D-130 · Fonte de verdade do catálogo de MCPs = seed curado e versionado no app** (`resources/mcp/catalogo-mcps.json`, origem `base/catalogo-mcps.seed.json`, `schema_version: 1`). O Registro Oficial do MCP (`registry.modelcontextprotocol.io`, API v0.1, metadados CC0) é só descoberta opcional por clique (P2), resultado "não curado" e **não instalável**. *Descartado:* Smithery (termos dos metadados não confirmados; CLI AGPL-3.0), mcp.so (sem API), importar o registro inteiro. *Motivo:* o registro tem forks/spam e typosquatting; instalar exige curadoria.

**D-131 · Instalação pinada, isolada e verificada; `npx -y` proibido.** npm: `npm ci --ignore-scripts` com lock curado (nível `forte`) ou `npm install <pacote>@<versão exata> --ignore-scripts` + integridade do tarball raiz + assinatura ECDSA do registro (nível `padrao`); PyPI: `uv venv` + `uv pip install --require-hashes`; binário: sha256 por plataforma. Pasta `<userData>/mcp/<id>/`, sem sudo/global, atualização nunca automática, consentimento por instalação e por versão com o comando completo. *Descartado:* `npx -y pkg@latest` a cada início. *Motivo:* execução de código de terceiros sem pino.

**D-132 · Segredo de MCP nunca em argv, JSON, log nem no ambiente do Pane: lançador `mcp-run`** (Electron como Node) busca o segredo por loopback com o token do Pane e monta o ambiente por allowlist; servidor sem segredo roda direto. Remoto com chave: risco residual aceito e registrado (P-132). *Descartado:* segredo em `env` do Pane (vaza para o shell do agente), em arquivo, ou por `${VAR}` (o Claude Code lê variáveis de credencial como vazias em certos contextos). *Motivo:* prompt injection + exfiltração.

**D-133 · Remotos (HTTP/SSE):** OAuth fica na CLI (`claude mcp login`, `codex mcp login`, `opencode mcp auth`); o app nunca guarda token OAuth. Chave de API remota: Codex por `env_http_headers`/`bearer_token_env_var`; Claude/OpenCode por cabeçalho no arquivo temporário 0600 do Pane.

**D-134 · Kit mínimo habilitado por padrão = `context7`, `deepwiki`, `sequential-thinking`** (gratuitos, sem chave obrigatória, sem escrita em disco). "Habilitado" ≠ "instalado": o download é sob demanda, com um clique e sem empacotar nada. Filesystem/Git/Fetch/Memory/Time ficam `opcional` (redundantes). *Motivo:* valor × risco × peso (cada servidor stdio custa ~40–80 MB por Pane).

**D-135 · Gateway/agregador MCP interno do app fica fora da v1** (única forma de o app encerrar servidores ociosos; exige proxy de tools/notificações/OAuth). Servidor parado não custa memória porque a CLI do Pane inicia e encerra o stdio (P-133).

**D-136 · Gemini CLI sem injeção por Pane** (nenhum mecanismo por invocação confirmado; `configuracaoDeMcp` já devolve `null`). Só "instalar na minha CLI" por ação explícita (`gemini mcp add -s user`). Codex e OpenCode: isolamento parcial com selo (D-44).

**D-137 · Habilitação em `catalogo_mcp_habilitacao` (deny-by-default, sem linha = desabilitado)**; a política da Fase 7 lê esta tabela como fonte dos servidores da Loja; tool no gate: `mcp__ev_<id>__*` (`PRODUTO.prefixoMcp = "ev_"`); só `ev_*` é removível pelo app.

**D-138 · Agentes não instalam nem configuram MCP.** A tool `mcp_store_list` é só leitura e só mostra o que está habilitado e configurado para o token; instalar/habilitar/segredo é só UI (IPC do renderer).

**D-139 · Saúde ativa só sob demanda** (clique, fim da instalação, ao abrir o painel e 1× a cada 24 h ao abrir a Loja se habilitado em workspace aberto); o resto é passivo. Teste = `initialize` + `tools/list`, timeout duro 3 s, árvore morta ao fim.

## Decisão geral do dono sobre pendências (2026-10-01)

**D-140 · Pendências do dono são decididas SEMPRE pela opção mais completa.** Regra do dono: decidir pela opção que deixa os clientes
mais confortáveis e dá mais possibilidades de uso, nunca pela mais curta. Aplicação: recurso construído inteiro e disponível; segurança
permanece como PADRÃO inicial (consentimento, opt-in, cofre do SO), nunca como teto. Resultado completo em `DECISOES-DAS-PENDENCIAS.md`
(override sobre os planos). Cria as Fases 21 (Distribuição), 22 (Acesso remoto estendido) e 23 (Overdrive experimental). Emenda D-05
(relay/app móvel/VPS agora permitidos como Fase 22, com estudo de ameaças primeiro), D-24 (auto-update volta na Fase 21),
D-47 (memox reindexado automaticamente) e a política "sem instalar software" (agora: pontual, reversível e justificada).

## Mapa lógico do código (Fase 17; detalhes em `fase-17-mapa-codigo.md`, pesquisa em `base/H-ferramentas-mapa-codigo.md`)

> Numeração: os blocos D-90… e D-100… já estavam ocupados por outras fases; a Fase 17 usa **D-160 a D-170**.

**D-160 · Núcleo próprio sobre Tree-sitter em WASM; embutir só o parser.** `web-tree-sitter` **0.27.0** (MIT, 209 KB de `.wasm` + 168 KB de JS, 0 dependências)
e as gramáticas de `@vscode/tree-sitter-wasm` **0.3.1** (MIT; Onda 1+2 ≈ 18 MB em disco, ≈ 1,5 MB gz no `.dmg`), em **versão exata e juntas**. Medido em 2026-09-30 no Electron
37.10.3: 11 gramáticas carregam; 2,5 MB de TypeScript em 0,3–0,8 s com `worker_threads`; ≈ 20 MB por worker extra. As gramáticas de `tree-sitter-wasms` 0.1.13 **não carregam**
no runtime 0.27 (teste de carga e guarda de versão obrigatórios). Custo registrado: +1 dependência de runtime, +1 devDependency, `asarUnpack` de `dist/nucleo/mapa/**` e do
`web-tree-sitter`. *Descartado:* madge, skott, ts-morph/compilador TS embutido, `node-tree-sitter` (nativo), pydeps/pyan, jQAssistant, code-maat, CodeQL, Joern/Semgrep (nesta fase),
LSP. *Motivo:* uma só tecnologia multi-linguagem, sem runtime externo, leve e sem nativo; as ferramentas por ecossistema exigem Python/JVM/Node/toolchain na máquina do cliente.

**D-161 · Licenças.** Nada GPL/AGPL (nem LGPL/MPL/EPL, salvo necessidade) entra no pacote. `universal-ctags` (GPL-2.0) só como **binário externo opcional** em processo à parte.
Código GPL (pyan, jQAssistant, code-maat, cloc, Sourcetrail) **não é lido**: estuda-se só a documentação e as ideias (clean-room). Código MIT/Apache estudado (code2flow, aider) leva
atribuição no cabeçalho do módulo inspirado e em `THIRD-PARTY-LICENSES.md`. *Motivo:* regra do dono e segurança jurídica.

**D-162 · Por padrão, nunca executar o código analisado nem ferramentas de build do projeto.** Só ler e parsear; configs JS (`.dependency-cruiser.js`, `webpack.config.js`) não são
avaliadas; executáveis externos só de `PATH`/locais padrão (nunca `node_modules/.bin` do projeto), com argumentos em lista, sem shell, timeout e teto de saída; `index.scip` e
relatórios de cobertura **já gerados** são lidos. Conforme D-140 (segurança é padrão, não teto), rodar indexadores SCIP, o resolvedor TS exato e a instalação de ferramentas existem
como **opt-in com consentimento digitado** (backlog B2–B4, fora do portão). Teste "canário" e teste de arquivo de ambiente/symlink no portão. *Motivo:* o código do cliente pode ser hostil ou frágil.

**D-163 · Análise em worker pool, incremental por hash, nada no boot; armazém próprio.** `<userData>/mapas/<workspace_id>/mapa.db` (SQLite, `schema_version`, cache reconstruível), pool
de 1 worker em segundo plano (até 3 em "Analisar agora"), workers ociosos encerrados em 30 s, 0 handles após o boot (P-248), nenhuma tarefa > 50 ms no main (P-12). O mapa guarda nomes,
assinaturas sanitizadas, `arquivo:linha` e 1ª linha de comentário redigida (≤ 160); **nunca o código-fonte**. *Descartado:* guardar tudo em `.expxv/`; banco no repositório do usuário.

**D-164 · Confiança em cada aresta (`exata`/`heuristica`) e "candidato" em vez de veredito.** Imports resolvidos por regra da linguagem/manifesto/SCIP = `exata`; por nome, convenção ou
candidatos (≤ 5) = `heuristica` (+ `candidatos`). Contagens para o raio informam `min` (exatas) e `max` (com heurísticas); sinal não coletável ⇒ pior caso declarado; código morto é
sempre **candidato** com `confianca` (nunca "remover"; Camada 10 do legadox). *Motivo:* reflexão, DI e metaprogramação existem; omitir a incerteza seria desonesto.

**D-165 · Um só canvas e layout de grafo; formatos de diagrama só como texto.** O Mapa **estende** o `GrafoCanvas`/`GrafoWorker` da Fase 15 (T-15.43; canvas 2D + Barnes-Hut próprios,
sem biblioteca de grafo), movendo-os para `src/renderer/componentes/grafo/` e adicionando LOD, agrupamento colapsável, semente por árvore de pastas e arestas tracejadas; meta
**5 000 nós/15 000 arestas a 60 fps** (P-243). Mermaid, DOT, JSON, CSV e Markdown são **gerados como texto**; SVG estático próprio; `dot` do Graphviz só opcional. **Plano B** (só se
a meta falhar na medição): Sigma 3 + graphology (≈ 61 KB gz) ou `d3-force` (≈ 7 KB gz, só layout). *Descartado:* Cytoscape (136 KB gz), elkjs (467 KB gz, EPL/GPL), `@viz-js/viz`
(≈ 1,2 MB), Mermaid como renderizador (124 MB desempacotado), d2, PlantUML.

**D-166 · O ADE não escreve em `docs/**` (D-04); integra por pacote de contexto e disparo.** Grava `.expxv/mapa/<carimbo>/` (RESUMO.md ≤ 6 000 tokens, `inventario-stackx.json` com
FATO/EVIDÊNCIA/FORÇA, `perfil-provisorio.json`, `raio-<trabalho>.json`) e digita `/expx:stackx-detectar`, `/expx:legadox-perfil`, `/expx:legadox-raio` com o caminho **relativo**; quem
escreve `CONVENCOES.md`/`PERFIL.md`/`raio/*.md` é a skill. A faixa do raio do ADE é **provisória** e rotulada; aprovação ALTO continua humana (D-21). Importância dos arquivos por
**PageRank** sobre o grafo (ideia do repo-map do aider, Apache-2.0, reimplementada) e corte por orçamento de tokens. O export recusa destino em `<raiz>/docs/**`.

**D-167 · Tools MCP `map_status`, `map_query`, `map_impact`, `map_evidence`: só leitura, todos os modos, resposta ≤ 32 KB.** Erro novo `unavailable/map_not_ready`. Agentes **não**
iniciam análise nem disparam skills (só o humano, pela UI). *Motivo:* custo de CPU e D-21.

**D-168 · Contagem de chamadores para o raio.** Arquivos **distintos** (não ocorrências), sem testes e sem o próprio alvo, **diretos + um nível indireto** até a fronteira de entrada
(como em `legadox/references/02-raio-de-impacto.md`); faixa pelo `max` (com heurísticas) e `min` declarado; limiares do `PERFIL.md` quando existir (leitura tolerante), senão os padrão.

**D-169 · A Fase 15 consome o mapa por `ProvedorGrafoCodigo`, por referência.** Com o mapa pronto, a fonte `codigo` do RAG usa símbolos/arquivos do mapa (sem regex) e cria nós
`arquivo`/`simbolo` apontando para o `no_id`; arestas de código são consultadas ao vivo; **nenhuma cópia do grafo**. Sem mapa, o chunker por regex da Fase 15 segue como fallback.

**D-170 · Linguagens por onda e modo degradado.** Onda 1: TypeScript/JavaScript, PHP, Java, C#, Python; Onda 2: Go, Ruby, Rust, C/C++ (C pela gramática `cpp`). Sem gramática embarcada
(Kotlin, Swift, Scala, Dart, Perl, Delphi, VB, COBOL, SQL…): modo **degradado** (arquivo + LOC + imports por regex, tudo `heuristica`) + **ctags opcional**; gramáticas extras no backlog B1
(compilação offline). Regras de camada **importadas** de arquivos estáticos do projeto (deptrac, import-linter, dependency-cruiser `.json`, Packwerk).


## Gestão ágil e relatórios (Fases 18 e 19; detalhes em `fase-18-gestao-agil.md` e `fase-19-documentacao-relatorios.md`)

> Numeração: **D-180 a D-189** (Fase 18) e **D-190 a D-199** (Fase 19). Os blocos D-100..D-117 (Fases 9/10), D-130..D-140, D-150..D-159 (Fase 20), D-160..D-170 (Fase 17) e D-200..D-214 (Fase 14) já estavam ocupados por planos escritos em paralelo.

**D-180 · Dados ágeis em tabelas `agil_*` do `expxv.db`; ligação ao método só por ID** (`trabalho_id` + `task_ref` `T-NN.MM`; sprint do método = `sprint-NN`). Nada escrito em `docs/**`. Cada task do método vira **item espelho** automático (`origem='metodo'`, chave `(workspace_id, trabalho_id, task_ref)`), somente leitura quanto a estado/título. *Descartado:* Backlog em arquivos `docs/ágil/` — viola D-04 e cria 2ª fonte de verdade..

**D-181 · Sprint ágil (`agil_sprint`) ≠ `sprint-NN` do sprintx.** A sprint ágil é uma **iteração com datas, capacidade e meta**; contém itens de 0..N trabalhos do método. Fechar é **ação humana**; o ADE só **sugere** fechar quando todas as tasks de uma sprint ágil estão `concluida`. *Descartado:* Reaproveitar `sprint-NN` como sprint ágil — o método planeja por fase de implementação, não por cadência/capacidade..

**D-182 · Pontos = esforço relativo; escala configurável** (`fibonacci` 1-2-3-5-8-13-21 padrão; `camisetas` PP-P-M-G-GG; `horas`). Estimativa = `{valor, escala, origem, motor, confianca, fatores}` com **versões append-only**. A faixa `min–max h` do sprintx F3.5 é **insumo e comparação**, não é substituída. *Descartado:* Número único de horas — F3.5 proíbe número único e prazo..

**D-183 · "Feita de primeira" (definição operacional):** task `concluida` (disco) cuja **janela de observação** terminou **sem nenhum evento de retrabalho FORTE de natureza `defeito`**. Fortes: QA reprovado (achado alta/média) ligado à task; task reaberta (`concluida` → outro estado, ou `task_iniciada` após `task_concluida`); commit/PR de correção referenciando a task depois de `concluida_em`; regressão (ocorrência runx com `regressao_de` apontando o trabalho). Fraco (só sinaliza): `regra_violada` repetida (≥ 2, mesma regra, mesma task). Janela = de `concluida_em` até o maior entre (fechamento da sprint ágil, veredito do QA do trabalho), **teto `janela_retrabalho_dias` = 14**; antes disso `em_observacao`. Sem fonte alguma → `indeterminado`. Retrabalho de **escopo** (mudança de requisito) é registrado à parte e **não** entra no índice de defeito. *Descartado:* "Qualquer commit depois" — ruído enorme (typo, doc, escopo)..

**D-184 · Índice de retrabalho em faixa honesta:** `ir` = (tasks com ≥ 1 evento forte `defeito`, automático certo ou confirmado por humano) ÷ (tasks avaliáveis) e `ir_max` = `ir` + eventos `pendente` (natureza ambígua). `first_time_right = 1 − ir`. Tasks `em_observacao`/`indeterminado` ficam fora do denominador e aparecem em contador próprio. *Descartado:* Um número único — esconde ambiguidade..

**D-185 · Estimador em 3 camadas:** (1) **heurística determinística** instantânea (sempre disponível); (2) **similaridade** (RAG Fase 15, tarefas parecidas com pontos e duração observada) e **calibração** por mediana (sprintx `HISTORICO.md` + banco); (3) **IA** por `cli-headless` (D-89) com `PerfilAgente` resolvido por `resolverPerfil("agil","estimativa")` (faixa `rapido`), em lote ≤ 20 tasks, sem ferramentas, JSON validado por esquema. Falha/timeout/sem CLI → fica a heurística (`motor='heuristica'`). Pré-configurado **ligado** (`estimativa_modo='ia_sugere'`), conforme pedido e D-140. *Descartado:* IA obrigatória — quebra sem CLI e gasta cota..

**D-186 · Gráficos em SVG próprio** com **modelo de nós neutro** (`NoSvg`) e dois emissores: React (telas) e **string** (relatórios da Fase 19, sem React, no worker). Decimação para ≤ 600 elementos por série; tabela de dados equivalente (`<details>`) por gráfico; paleta por tokens `--grafico-1..6` + padrão (traço/marcador) além da cor. *Descartado:* Chart.js/D3/Recharts — peso (P-08) e dependência..

**D-187 · Portas** (`src/nucleo/agil/portas.ts`) para tudo que pertence a outras fases: `PortaMetodo`, `PortaCusto` (F10), `PortaBoard` (F10), `PortaRag` (F15), `PortaMapa` (F17), `PortaPerfil` (F9/14/16), `PortaHeadless` (F15/D-89), `PortaVcs`/`PortaForge` (F6), `PortaAlertas` (F20). Cada uma tem `Indisponivel` determinístico; a fase funciona e testa com elas. *Descartado:* Importar módulos futuros — acopla a ordem das fases..

**D-188 · Eventos de domínio em português do ponto de vista do ágil** para a Fase 20: `sprint.iniciada`, `sprint.fechada`, `sprint.em_risco`, `tarefa.atrasada`, `retrabalho.detectado`, `wip.excedido`, `acao_retro.vencida`; payload sempre com `pontos`, `duracao_observada_ms`, `tokens` (null quando desconhecido). "Atrasada" = `em_andamento` com idade acima do **P85 do ciclo** de tasks comparáveis (≥ 8 amostras; senão "sem base" e **não** dispara). *Descartado:* Prazo fixo por task — o método não tem data por task..

**D-189 · Membros** (`agil_membro`) são **rótulos** (pessoa ou agente) com *aliases* (nome de agente do rastro, `sessao`, e-mail de commit); capacidade em horas focadas/dia × fator de foco (humano) ou pontos/sprint = mediana das últimas 3 (agente). Não há login nem usuários no ADE. *Descartado:* Modelo de usuário/permissão — fora de escopo local..

**D-190 · Saída fora de `docs/**`:** `<userData>/relatorios/<workspace_slug>/<sprint_slug>/r<N>/` (`rN` imutável); espelho opcional em `<workspace>/.expxv/relatorios/…`; **"Exportar para…"** = ação humana com diálogo do SO (pasta ou ZIP), **nunca sobrescreve** (sufixo `-2`). Destino dentro de `<workspace>/docs/**` é **recusado**; exceção documentada à D-04 só com `exportar_docs_liberado=true` (desligado), em subpastas **fora** da lista fechada do método (`sprintx, manutencao, relatorios, entregas, eventos, produto, stack, legado, projeto, design-system`) e com confirmação digitada. *Descartado:* Gravar em `docs/relatorios/` — é área da skill runx (D-04)..

**D-191 · Pacote** = conjunto fixo de artefatos + `manifesto.json` (sha256, bytes, versão do gerador/template, `hash_fatos`, `modo_redacao`, perfil, avisos). Geração em worker, **idempotente** (`hash_fatos`+template+modo+ajustes), escrita **atômica** (pasta temporária + rename), cancelável. *Descartado:* Gerar na thread principal — trava a UI..

**D-192 · Redação por LLM só sobre fatos, com citações.** Bloco → `{id, afirmacoes:[{texto, fontes[]}]}`; **verificador** (V1..V7) rejeita fonte inexistente, número/data/URL/ID/SHA fora dos fatos citados, promessa de data, jargão (usuário), item oculto vazando, item visível esquecido; reprova → **template determinístico do bloco**; falha ainda → bloco `precisa_revisao` (lista o que falta; **não inventa**). `redacao_modo` = `auto` (LLM se houver CLI; senão template; padrão, D-140) · `llm` · `template`. *Descartado:* Texto livre sem checagem — alucinação..

**D-193 · Pendências do método são ofertas:** ocorrência concluída sem `docs/relatorios/*<OC>*` → botão que digita `/expx:runx-relatar <OC>` num Pane (humano clica); `disparar_runx_relatar='automatico'` opcional (1 por vez, só com QA `aprovado`, respeitando rigidez). `uso.md` existente entra como insumo **depois do lint**. Nada disso escreve em `docs/**` pelo ADE. *Descartado:* Reimplementar o E5 do runx — duplica e diverge..

**D-194 · Relatório do usuário e divulgação sem jargão:** lista de termos/estruturas **portada do hook** `sem-jargao-no-uso.py` (+ extras de `.expx/jargao.json`, só leitura); sem id interno (`T-NN.MM`, `OC-…`, `D-NN`), sem SHA, sem caminho. Citações vivem em `pacote.json` e em `data-fontes` (invisível), nunca no texto do cliente. `visibilidade_cliente` (Fase 18) decide quem aparece; `resumo_cliente` humano **vence** qualquer texto gerado. *Descartado:* Mesmo texto para dev e cliente — jargão vaza..

**D-195 · HTML:** um arquivo, **zero JS**, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`, SVG inline com `<title>/<desc>` e tabela equivalente, CSS de impressão (`@page`, quebras, URL após link no técnico). **PDF** por `webContents.printToPDF` em `BrowserWindow` oculta (sandbox, `javascript:false`, sem preload, destruída ao fim). **ZIP** com empacotador próprio (método *store*, CRC32) — **sem dependência nova**. *Descartado:* Puppeteer/wkhtmltopdf/JSZip — peso, nativo, rede..

**D-196 · Templates:** motor mínimo próprio (`{{x}}` escapado, `{{{x}}}` só fragmento já saneado, `{{#each}}`, `{{#if}}…{{else}}`, `{{> parcial}}`, filtros fechados); **sem código, sem helpers, sem acesso a protótipo**; limites (100 000 iterações, saída 20 MB, profundidade 8); versões **append-only** por tipo/formato, ativa por escopo (global/workspace). *Descartado:* Handlebars/EJS — execução de código no template..

**D-197 · CSV:** UTF-8 **com BOM** (Excel PT-BR), CRLF, RFC 4180, ponto decimal, datas ISO, **proteção contra injeção de fórmula** (`= + - @ TAB CR` → prefixo `'`); perfis `generico` (completo), `jira` e `github` (mapeamento de colunas); mais `metricas.csv` e `retrabalho.csv`. *Descartado:* Só um CSV genérico — não importa em ferramenta nenhuma..

**D-198 · Documentação do projeto = rascunho com proveniência**, nunca "oficial": banner `RASCUNHO GERADO`, `commit_ref`, snapshot do mapa (Fase 17), ids do RAG (Fase 15), `arquivo:linha` por seção; seção sem fonte **não é gerada** (vira lacuna); regenerar cria **versão nova** (nada se perde), com diff por seção e marca de **desatualizada** quando um arquivo-fonte muda; revisão humana (`revisada`, anotações); sem editor in-app do texto (editar após exportar). *Descartado:* Sobrescrever docs existentes — apagaria revisão humana..

**D-199 · Notas de versão em Keep a Changelog 1.1.0** (`Added/Changed/Deprecated/Removed/Fixed/Security`), a partir de `categoria` + `changelog_tipo` (Fase 18) dos itens visíveis; cabeçalho `## [versão] - AAAA-MM-DD` (`versao_lancamento` informada ao fechar; senão `Unreleased`); **CHANGELOG cumulativo** regenerado em `<userData>/relatorios/<workspace>/CHANGELOG.md`. *Descartado:* Changelog por mensagens de commit — ruído e jargão..

## Squads e agentes (Fase 14; detalhes em `fase-14-squads.md`)

> Numeração: faixa **D-200..D-231** reservada ao par Fase 14/16 (o pedido indicava "a partir de D-70", mas D-70..D-199 já estavam ocupados por planos escritos em paralelo).

**D-200 · Agente = membro de exatamente uma squad** (`agent_id = <squad>.<membro>`); squad de fábrica ≡ receita (sem entidade `Receita`). *Descartado:* agente reutilizável entre squads (spec-02) — o dono pediu prompt, perfil e permissões **por trabalhador da squad**; duplicar copia.

**D-201 · Squads do usuário vivem em arquivos** (`<userData>/squads/<slug>/squad.json` + `membros/*.md`), fonte da verdade legível e versionável; SQLite só guarda uso/auditoria; exportação opcional para `.expxv/squads/`. *Descartado:* tabelas como fonte — prompt não seria editável fora do app nem diffável.

**D-202 · O prompt do membro SOMA à base do papel** (handoff, portões e regras ficam inalteráveis e vêm antes); variáveis fechadas; `objetivo`, `contexto_rag` e `arquivos` entram em bloco `DADO` delimitado ("dado, não instrução"). *Descartado:* prompt que substitui a base — enfraqueceria as regras de orquestração.

**D-203 · Squad válida = 1 orquestrador + ≥ 1 revisor + ≥ 1 outro (3..12 membros)**; o orquestrador só em CLI com contrato de intake (`claude|codex|opencode`). *Motivo:* sem revisor `mission_complete` nunca libera.

**D-204 · Esforço por CLI:** tabela `NIVEIS_POR_CLI` confirmada em uso por `<exe> --help` (cache por versão, fora do spawn); CLI sem parâmetro ⇒ esforço **indicativo** (texto no prompt) com selo visível; nunca falha o spawn. *Descartado:* fingir que todo esforço vira parâmetro.

**D-205 · `PerfilAgente` compatível com a Fase 9 e `PortaResolverPerfil` com implementação direta** (a Fase 14 roda antes); `cli:"auto"` delega à faixa; a T-09.17 substitui a implementação por injeção, sem mudar chamadores.

**D-206 · Atualização de squads de fábrica por manifesto (sha256) e comparação em 3 vias:** edição do usuário **nunca** é sobrescrita; `atualizável` aplica com 1 clique; `editado` mostra diff.

**D-207 · Configuração versionável no repositório:** o `.gitignore` interno de `.expxv/` passa a `*` + exceções para `squads/` e `pipelines/` (contrato §5 ajustado); artefatos de Missão continuam ignorados; o ADE nunca comita (D-36).

**D-208 · Squad importada é não confiável:** prévia obrigatória com prompts visíveis, `mcps_permitidos` removidos, skills filtradas às conhecidas, nada executa sozinho, `origem: importada`.

**D-209 · "Mostrar o plano antes" é o padrão** (portão `build` pendente + `plano.md` + botão Aprovar); "executar direto" por opção ou rigidez ≤ 2; **revisor obrigatório sempre**.

**D-210 · Orçamentos de tempo/tokens por membro/squad são soft:** avisam e oferecem continuar/encerrar, nunca matam; tokens só com a Fase 10; desconhecido nunca vira 0.

**D-211 · Editar squad com Missão em andamento:** `mission_squad.squad_hash` registra o início; invocações seguintes leem o arquivo atual (o dono pediu ver o prompt novo); aviso "squad alterada após o início".

**D-212 · `hooks` por membro:** campo reservado e validado; sem efeito até a Fase 7 expor `PortaHooks`.

**D-213 · Rigidez por squad/membro:** campo inerte na Fase 14 + `politicaDePortoes`/`snippetDeRigor`; a Fase 16 injeta `PortaNivelRigidez`.

**D-214 · 13 squads de fábrica** (Feature Full-stack, Correção de Bug, Revisão de PR, Refatoração de Legado, Testes e QA, Auditoria de Segurança, Documentação, DevOps e CI, Migração de Dependências, Performance, Spike/Pesquisa, Onboarding de Projeto, Dupla Rápida); revisáveis pelo dono.

## Maestro e rigidez (Fase 16; detalhes em `fase-16-maestro.md`)

**D-215 · Maestro = serviço no main + núcleo puro; pipeline persistido e retomável; o disco vence** (D-19). *Descartado:* estado só em memória — perderia o andamento ao reiniciar.

**D-216 · Intenção por regras determinísticas (léxico PT-BR/EN com pesos e confiança) é a autoridade;** decisor externo opcional/desligado; tabela de combinação de 8 casos (a regra vence em conflito de baixa confiança do decisor); **o plano é sempre mostrado**, "executar direto" só por opção do workspace e nunca com confiança < 0,70.

**D-217 · Cinco vias de entrada** (tool `maestro_request`, hook `UserPromptSubmit`, "Pedir ao Maestro", chat, portas remotas); o hook **bloqueia** o prompt (zero token) só para intenção acionável com confiança ≥ 0,75 em painéis **livres**; `@direto` trata no painel; Codex/OpenCode só notificam; guardas anti-loop (idempotência 120 s, taxa, Panes do Maestro sem a tool/hook, eco do ADE).

**D-218 · Um terminal por etapa;** agrupamento só nos níveis 1–2; adoção do terminal quando a skill avança sozinha; limite de terminais por pipeline (4; 6 no nível 5); concluídos são fechados.

**D-219 · O método só executa em `claude` e `opencode`** (derivado de `harnessDaCli`): V2 recusa as demais CLIs em etapas do método; valem para `rapido`, squads e chat. OpenRouter entra no método por `opencode` (`--model openrouter/<id>`) e por `claude` via gateway (P-17).

**D-220 · Cadastro e lista de modelos do OpenRouter nascem na Fase 16** (a Fase 9 não os tem), sem editar a Fase 9; rede **só por clique**; "usar todos" ou allowlist; chave só no cofre; **nenhuma exceção nova** de injeção no ambiente (só o mecanismo `injetar_cofre_no_env` da Fase 9 com entrada não sensível); o usuário autentica o `opencode` por conta própria; `goose` entra no catálogo de CLIs (P-33) e o adaptador do JEV é genérico e configurável (P-16).

**D-221 · Exceção ao D-04:** o ADE escreve **somente** `.expx/hooks.json` (modos dos hooks por nível), só por **ação explícita do usuário**, com merge que preserva o do usuário, backup, escrita atômica, reversão e evento; **nunca** chaves de segurança; `escrever_hooks=0` desliga; sem `.expx/` não cria nada.

**D-222 · Rigidez em 5 níveis:** 1 Relâmpago, 2 Leve, 3 Padrão (padrão), 4 Rigoroso, 5 Total; escopos workspace/Missão/pedido; precedência pedido > Missão > squad > workspace > 3.

**D-223 · Canais remotos (Telegram, chat remoto) só podem SUBIR o nível;** nunca baixam nem sobrescrevem trava; aprovação por botão sempre.

**D-224 · Piso invariante I1..I10** (teste do comportamento alterado, suíte verde, varredura de segredo, sem git destrutivo, avaliador separado, ações humanas, escrita só onde permitido, hooks de segurança nunca rebaixados, efeito externo com consentimento, etapas de piso nunca omitidas); `nao_comprovado` nunca é tratado como `ok`.

**D-225 · Travas:** raio ALTO/zona de risco ⇒ nível mínimo 4 (override com justificativa ≥ 20 chars, registrada); branch protegida/produção ⇒ confirmação digitada ao baixar para ≤ 2; modo legado ⇒ `legadox.raio` é piso.

**D-226 · O ADE não "pula por dentro" nenhuma fase do método** (F5 é pré-requisito do F6; E4 do E5): nível 1 = pipeline `rapido` fora do método; 2–5 = método com redução/reforço **de despacho**, instruções em arquivo e modos de hook; [LAC] listados; texto proposto às skills como pendência.

**D-227 · buildx = condutor supervisionado** (1 terminal) com observação por disco e retomada; reciclar terminal por etapa fica fora desta fase.

**D-228 · Decisor do Maestro tem configuração própria** (`jev_direto` | `openrouter`), consentimento próprio, reaproveita cofre/breaker/resumo redigido da Fase 9; **não** é usado no hook por padrão.

**D-229 · Perfis de etapa são independentes do nível** (o nível escolhe etapas e profundidade); a independência do avaliador (V1) endurece com o nível.

**D-230 · `rapido` (nível 1) roda na árvore atual,** sem worktree; branch protegida ⇒ trava.

**D-231 · Modos de hook por nível valem a partir da próxima etapa** (agendados); `aplicar_hooks_ja` opcional.

## Alertas e comunicação: Centro de Alertas e Telegram (Fase 20; detalhes em `fase-20-alertas-comunicacao.md`)

> Numeração: **D-150 a D-159**. O dono pediu "a partir de D-130", mas D-130..D-139 já são da Loja de MCPs (Fase 7B) e D-140 é a regra das pendências; a faixa D-150+ foi reservada a esta fase. Pendências em `PENDENCIAS-DO-DONO.md` (P-70..P-79); orçamentos P-140..P-149 no plano da fase.

**D-150 · Telegram por long polling de SAÍDA é permitido (ajusta D-05; D-73 mantido).** O app só faz conexões de saída para `api.telegram.org` (`getUpdates` com `timeout=30`, `limit=20`, `allowed_updates=["message","callback_query"]`); **nenhuma porta aberta**, sem webhook, sem relay, sem VPS, sem app móvel (a Fase 22 os reabre, com estudo próprio). Desligado por padrão; só depois do estudo de ameaças aprovado (T-20.01), do consentimento versionado e do token no cofre. Host único na allowlist de `rede/` (D-114). *Descartado:* webhook (exige porta pública/relay); relay próprio. *Motivo:* o pedido do dono (alertas e pedidos pelo celular) sem superfície de rede de entrada.

**D-151 · Alertas são dados do ADE; "atrasada" tem definição operacional.** Tabelas próprias (`alerta`, `alerta_regra`, `alerta_entrega`, `canal`, …), nunca em `docs/**` (D-04). Atrasada = tempo de trabalho **ativo** (Pane `trabalhando`; esperar você não conta) > `max(1,5 × estimativa; estimativa + 10 min)`, com estimativa = mediana por story points (≥ 5 amostras do workspace) → tabela padrão (1→15, 2→30, 3→60, 5→120, 8→240, 13→480, 21→960 min) → mediana geral → `sem_base` (**nunca** chamada de atrasada); prazo da sprint e `sprint_em_risco` à parte; no máximo 2 alertas por task (1º cruzamento e 2 × limite); um único timer (menor vencimento), sem polling. Tokens sem fonte = "sem fonte", nunca 0 (D-116). *Descartado:* "atrasada" por relógio de parede; alerta periódico por varredura. *Motivo:* honestidade dos números e custo zero ocioso.

**D-152 · Entrada remota: o orquestrador propõe, o usuário aprova, o código executa.** Mensagem recebida é **dado não confiável**: normalizar → redigir → ≤ 2 000 caracteres → orquestrador principal (Fase 15 chat + Fase 16 Maestro + Fase 14 squad, por `PortaOrquestrador`; **a LLM nunca decide ação**) → plano montado por código com ações da lista fechada da Fase 15 → mensagem com [Aprovar] [Editar] [Cancelar] (nonce opaco de uso único atrelado a `args_hash`) → só então os **serviços reais** criam Missão/Pane. Modos por workspace: `consulta`, `aprovar` (padrão) e `direto` (implementado por D-140, **desligado**, digitando `DIRETO`; só com rigidez ≤ 3, raio BAIXO, branch própria, ≤ 2 painéis, não destrutivo). Política `desktop` (rigidez ≥ 4, raio ALTO, branch protegida, destrutivo, workspace automático, > 3 painéis, porta indisponível = falha segura) mostra o plano no chat mas **só aprova no app**. **Nunca** por esse canal: assinatura do prodx, aprovação de raio ALTO, `mergex-revisar`, merge, push forçado, descartar/apagar, encerrar/abortar Pane ou Missão (D-21, D-36). `chat_execucao='direto'` da Fase 15 não vale para origem Telegram.

**D-153 · Pareamento por código de uso único + confirmação no desktop + allowlist por `user_id`.** Código de 10 caracteres base32 (50 bits), TTL 5 min, 1 uso, ≤ 5 erradas na janela, só em memória; o desktop mostra nome e `id` e exige "Permitir". Autorização por `from.id` numérico + `chat.id` **privado** (nunca `username`/nome); validade deslizante de 30 dias de inatividade; workspaces permitidos explícitos (nenhum por padrão). Não autorizado = **silêncio** total (sem oráculo), contador sem texto, alerta ≤ 1/h. Grupos, canais, mídia, mensagens editadas/encaminhadas/`via_bot` ignorados. Limite de taxa: 20 msgs/min por usuário, `/pedir` ≤ 3/10 min, ≤ 3 planos pendentes. *Descartado:* autorizar por `username`; pareamento sem confirmação no desktop.

**D-154 · Token do bot só no cofre; a URL carrega o token.** `TELEGRAM_BOT_TOKEN_<canal_id>` no cofre da Fase 9 (`sensivel`, recusa `basic_text`/segue a decisão P-29), mascarado na UI (`1234…:AA…xyz`), validado por `getMe` **antes** de salvar, nunca em JSON/log/argv/evento/ambiente de Pane/DOM. Como a Bot API usa `/bot<token>/MÉTODO`, `rede/` ganha `caminho_template` + `segredos` e **nunca registra o caminho real**; erros trocam o token por `***`. PIN opcional de aprovação: só hash `scrypt`. Rotação guiada no BotFather (o comando exato, `/revoke` ou `/token`, não foi confirmado; a UI orienta o menu `/mybots`).

**D-155 · Poller conservador: offset depois do lote, descarte inicial, 409 para e exige "Retomar".** `proximo_offset` gravado só depois do lote processado (mesma transação); dedupe de `update_id` por 48 h; na 1ª ativação descarta tudo o que é anterior ao pareamento (sem offset negativo, não confirmado); filtro defensivo no cliente porque `allowed_updates` só vale para updates futuros; pedidos/callbacks com mais de 10 min viram "expirou, reenvie". Decide por **código** de erro (401 ⇒ `erro` sem laço; 429 ⇒ `retry_after`; 409 ⇒ 5 s, 15 s e no 3º `conflito` com `getWebhookInfo`; **nunca** `deleteWebhook` em operação). `suspend`/`resume` do SO abortam e retomam sem rajada. *Motivo:* dois pollers brigam; o pior caso é alguém com o token.

**D-156 · Conteúdo mínimo, redigido, em HTML, com templates editáveis sem lógica.** `parse_mode: "HTML"` (escape de `& < >`; MarkdownV2 exigiria 18), texto visível ≤ 4 096 (alvo 1 500; divide em 3 500), sem preview de link, sem emojis nos padrões. Templates `{{campo|formatador}}` com lista branca, validados ao salvar, níveis `minimo` (padrão) / `padrao` / `completo`, "ocultar títulos". Redação das Fases 8/9 na entrada do alerta **e** na saída; nunca código, diff, caminho absoluto, segredo ou terminal. O consentimento diz que o Telegram vê o conteúdo (conversas de bot não são ponta a ponta — **não confirmado** na documentação, tratado como verdadeiro).

**D-157 · Canais por adaptadores `CanalComunicacao`.** Registro lazy; nenhum canal externo envia sem consentimento válido (checado antes do I/O); fila persistente, 1 envio por vez por canal, retry com backoff, idempotência `UNIQUE (alerta, canal, regra)`. Canal SO integra `notificar.ts` (a sinaleira passa a emitir **alerta**; `criarNotificador` sai). Webhook genérico de saída assinado (HMAC) = T-20.39, P2 opcional; e-mail/Slack/Discord só documentados.

**D-158 · Segurança compartilhada com a Fase 13; agentes não usam o canal.** `ConfirmacaoPendente` (uso único, TTL, `args_hash`), matriz de risco, redação e a estrutura do estudo STRIDE são **as mesmas** (quem chegar primeiro cria com a assinatura canônica; a outra reusa). O Telegram **não** passa por MCP (serviços internos por porta). A única tool MCP é `alert_raise` (piloto, escrita leve, ≤ 3/h/Pane, redigida, **não vai ao Telegram por padrão**); nenhuma tool lê alertas, envia mensagem ou toca token/autorizados (D-138).

**D-159 · Eventos `alert.*`/`channel.*`/`telegram.*`, retenção e pânico.** Eventos em inglês com ponto (o dono escreveu `alerta.*`; vale a convenção do projeto), sem texto nem segredo. Retenção: alertas 90 d, entregas 30 d, entradas 30 d, `update_visto` 48 h, auditoria 90 d. Pânico (botão, bandeja, `/parar`): 0 sockets em ≤ 1 s, nonces/planos anulados, todos revogados, entrada e saída desligadas, execuções iniciadas pelo bot paradas (opcional, nunca apagando); reativar exige novo pareamento. `entrada_ligada` persiste entre reinícios (só há conexão de saída) com auto-desligamento em 30 dias sem uso e indicador no topo.

**D-232 · Permissão por agente (P-02, override do dono):** cada membro pode ter `permissao` própria (`seguro|equilibrado|automatico`, `null` = herda da Missão/workspace); mais permissiva que a do workspace ⇒ aviso e confirmação ao salvar, selo no Pane; nunca o bypass total de sandbox (D-14).

**D-233 · Squad com memória própria (P-24, override do dono):** quando a Fase 8 expõe o anel da squad, as tools `memory_*` entram na matriz dos membros **limitadas ao anel da squad** (isolado das demais); substitui a regra "squad nunca tem memória".

## Auditoria do MVP, rodada 1 (D-A1..D-A4)

**D-A1 · Cortes de spec-01 registrados (AUD-35).** Ficam fora do MVP, por decisão e não por esquecimento: SSH/tmux (RF 01.90-99), multi-janela (01.80-84), painel `browser` (01.02/01.11), limite e fila de paste (01.50-51) e shell padrão configurável (01.60). Motivo: nenhum é requisito de aceite das fases 0 a 5 e todos exigem superfície nova (rede, janelas, webview) contra a prioridade de leveza (D-05). Reabrir só com pedido do dono.

**D-A2 · Remoção de workspace é LÓGICA (AUD-11).** `workspace.removido_em` (migration 0004); listagens, `obter` e `obterPorRaiz` ocultam; `abrir` no mesmo caminho restaura workspace e histórico; `apagarHistorico` (cascata) é ação separada, ainda sem UI. *Descartado:* recusar a remoção com Missão ativa (esconde o problema, não protege o histórico).

**D-A3 · Wake persistido na mesma transação do handoff (AUD-05).** Tabela `wake_pendente` (migration 0003): linha criada junto com o handoff, apagada depois da entrega, reenfileirada no boot; descartada se o piloto terminou. Entrega "pelo menos uma vez" (P-AUD3). *Descartado:* coluna de entrega em `handoff` (acopla o handoff ao canal de aviso).

**D-A4 · Codex só recebe `--dangerously-bypass-hook-trust` em workspace `automatico` (AUD-02, P-09).** Em `seguro` nenhum hook por `-c`: a sinaleira usa a heurística de ociosidade (marcada "estimada") e o handoff de workers Codex já usa o vigia de ociosidade (`estrategia_handoff: "fallback"`), então a orquestração não perde nada: o "stop hook exato" nunca existiu para Codex.

