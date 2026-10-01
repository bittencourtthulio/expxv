# Digest E — o "jeito da casa" do ExpxMedia para o ADE de desenvolvimento

Fonte (somente leitura): `/Users/thuliobittencourt/orca/projects/ExpxMedia` (HEAD `6362ad5`, desktop/central v0.1.30).
Todos os caminhos abaixo são relativos a essa raiz, salvo indicação. Idioma do projeto: PT-BR, identificadores em português sem acento.

---

## 1. Stack exata (versões conferidas em `node_modules` e `package.json`)

### desktop/ (`desktop/package.json`, pacote `expxmedia-desktop`, privado)
| Item | Versão | Observação |
|---|---|---|
| electron | **37.10.3** (exata) | devDependency; Node embutido >= 22 |
| electron-builder | **26.15.3** (exata) | DMG+ZIP universal no mac, NSIS x64 no Windows |
| electron-updater | ^6.3.9 | feed do GitHub Releases |
| @electron/rebuild | 4.2.0 | recompila `node-pty` para o Electron (`npm run test:pty:electron`) |
| node-pty | **1.1.0** (exata) | PTY real; `asarUnpack` obrigatório |
| @xterm/headless | 6.0.0 | só no main, para o leitor de tela do MCP de painéis (`assistentes/paineis/leitor.ts`) |
| @modelcontextprotocol/sdk | 1.31.0 | ponte MCP `assistentes/paineis/ponte-mcp.ts` |
| chokidar | ^5.0.0 | observador do rastro |
| expxmedia | `file:../central` | a Central como dependência local (ver item 2) |
| playwright | ^1.63.0 (1.63.0) | `_electron.launch` nos e2e |
| vitest | ^4.1.11 (4.1.11) | ambiente `node`, `testTimeout: 120000` |
| typescript | ^5.6.0 | `module: CommonJS`, `strict`, `noUncheckedIndexedAccess`, `target ES2022` |
| @resvg/resvg-js, png-to-ico | ^2.6.2 / ^3.0.2 | `scripts/gerar-icones.mjs` (svg -> icns/ico/png) |
| yaml | ^2.9.1 | |

### central/ (`central/package.json`, pacote `expxmedia`, ESM, `engines.node >= 20.19.0`)
| Item | Versão |
|---|---|
| react / react-dom | **19.3.0** (`^19.3.0`) |
| vite | **8.3.1** (Rolldown como empacotador; `codeSplitting.groups` no lugar de `manualChunks`) |
| @vitejs/plugin-react | ^6.1.1 |
| vitest | 4.1.11 (`environment: node`; UI usa `// @vitest-environment jsdom` por arquivo) |
| jsdom | ^30.1.1 |
| @testing-library/react / dom / jest-dom | ^16.3.3 / ^10.4.2 / ^7.0.1 |
| @xterm/xterm | **6.0.0** (exata) |
| @xterm/addon-fit | **0.11.0** (exata) |
| @xterm/addon-search | **0.16.0** (exata) |
| @xterm/addon-web-links | **0.12.0** (exata) |
| typescript | 5.9.3 instalado (`^5.6.0`), `module/moduleResolution: NodeNext`, `exactOptionalPropertyTypes: true`, `jsx: react-jsx` |
| ws | ^8.21.3 (websocket do estado) |
| zod | ^4.6.5 |
| ink / ink-testing-library | ^7.1.1 / ^4.0.0 (UI de terminal do CLI, não relevante) |
| @napi-rs/keyring | ^1.3.0 (cofre do SO para o token da nuvem) |
| chokidar, yaml, @inquirer/prompts | ^5.0.0, ^2.9.1, ^8.7.2 |

Padrões de versão: libs que tocam o terminal/PTY/Electron são **travadas em versão exata** (electron, electron-builder, node-pty, xterm e addons, MCP SDK); o resto usa `^`. A decisão está escrita em `docs/terminal-busca-links/SPEC.md` (tarefa 5: "dependências travadas em versão exata").
CI instala com `npm ci --no-audit --no-fund --legacy-peer-deps` (vitest 4 + npm 10.9 exigem o flag).
Sem framework de UI além de React puro: **sem react-router, sem Redux/Zustand, sem Tailwind, sem biblioteca de componentes**. CSS é um arquivo único (`central/ui/src/tokens.css`, 1579 linhas).

---

## 2. Arquitetura dos processos e reuso da Central

### Processos
1. **main** (`desktop/src/main.ts`, 645 linhas, CommonJS). Orquestra: instância única (`requestSingleInstanceLock`), protocolo `expxmedia://abrir?dir=`, scheme privilegiado `expxmedia-app://` (seletor), janela, menu, tray, atualização, rastro e todos os serviços de Assistentes. Lógica testável foi extraída para `desktop/src/logica/*.ts` (args, boot, bounds, janela, navegacao, instancia, protocolo, troca, painel, rastro, notificar, atualizacao, menu, tray, identidade, instalacoes). `main.ts` só cola; a regra fica em módulos puros com injeção de dependência (ex.: `criarJanela({BrowserWindow})`, `AutoUpdaterFalso`).
2. **preload** (`desktop/src/preload.ts`, 91 linhas). `contextBridge.exposeInMainWorld("expxmedia", {...})` com API enumerada: `versao`, `perf`, `atualizacao.*`, `seletor.*`, `instalacao.*`, `assistentes.*`, `ditado.*`. Padrão: `invoke` para pedido/resposta; `send` para o que não espera resposta (teclado `escrever`, `redimensionar`, `interromper`); eventos por `assinarEventos(cb)` que devolve função de cancelamento. `preload.test.ts` trava o formato.
3. **renderer** = a UI React da Central (`central/ui/`), carregada de `http://127.0.0.1:<porta aleatória>/`. O renderer **nunca** fala com Node; só com `window.expxmedia`. Fora do Electron `window.expxmedia` é `undefined` e a UI degrada (ex.: sem `api.anexar` nada é interceptado; sem `abrirLink` usa `window.open`).
4. **daemon de PTY** (processo separado, `desktop/src/assistentes/daemon/main-daemon.ts`): o **mesmo executável do app** com `ELECTRON_RUN_AS_NODE=1`, `detached`, `unref`, `stdio: ignore` (`daemon/lancador.ts`).
5. **ponte MCP** (`assistentes/paineis/ponte-mcp.ts`): outro filho em modo Node, stdio, para a CLI orquestradora falar com o app.

### Segurança de janela (copiar literalmente)
`webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false }` (`logica/janela.ts`). Permissões (`setPermissionRequestHandler/CheckHandler`) só para `media/audio` da origem do painel. `setWindowOpenHandler` + `will-navigate`: só 127.0.0.1 na porta do servidor e o scheme interno; todo o resto vira `shell.openExternal` ou é negado (`logica/navegacao.ts`). `backgroundColor: "#16181a"` evita flash branco; `janela.test.ts` **falha se divergir de `--expx-fundo`** em `tokens.css` (teste de contrato entre CSS e main).

### Como a Central é reusada NO processo
- `desktop/src/logica/painel.ts` importa `subirServidor` de `expxmedia/dist/servidor/http.js` e o sobe **dentro do processo main**, em porta livre de `127.0.0.1` (`porta: 0`). Serve `central/ui/dist` + API REST + websocket (`ws`) que transmite o **estado inteiro relido** quando algo muda (hash por cliente evita reenvio; `servidor/estado-hash.ts`, `coalescer.ts`). Servidor é read-only (não-GET = 405, exceto poucas rotas). Decisão D-02 (`docs/painel-desktop/00-DECISOES.md`): "sem duplicação e sem IPC para o estado".
- O main (CJS) importa módulos ESM da Central por `import ... from "expxmedia/dist/..."` (funciona porque Electron 37 tem `require(esm)`); `paths` no `tsconfig.json` do desktop ajusta o MCP SDK para o build CJS.
- Também reusa da Central: `prepararHarnessProjeto` (`central/src/harness/projeto.ts`: instala skills/commands/agents nos diretórios de cada CLI: `.claude/`, `.opencode/`, `.kilo/`, `.mimocode/`) e `iniciarMonitor` de perf.
- Estado de estudo: o worker de leitura de estado (`servidor/estado-worker.ts`) roda em `worker_threads` e por isso exige `asarUnpack` de `node_modules/expxmedia/dist/**/*.js` + `yaml` + `zod` (ver `electron-builder.yml`).
- Build encadeado: `desktop` `prepack:desktop` = `npm --prefix ../central run build && npm run build`. Central build = `tsc` (servidor) + `vite build ui` + `scripts/copiar-nucleo.mjs` (copia `nucleo/` e contratos para o pacote).
- Dev: `desktop/scripts/dev.mjs` (`npm run dev`) sobe 3 compiladores em watch (central tsc, vite da UI, tsc da casca), recarrega a janela quando a UI muda (porta de depuração 9333) e reinicia o app quando muda `central/src` ou `desktop/src`; aceita `--dir`.
- Boot desacoplado (`logica/boot.ts`): a janela nasce em `abrir()`; rastro, atualização, menu e tray começam depois, em paralelo, com erro isolado por serviço (regra R-08 do plano painel).

### Seletor de instalação
Página estática `desktop/src/seletor/` servida por `protocol.handle("expxmedia-app")` com lista fechada de recursos (`logica/seletor-scheme.ts`). Recentes em `<userData>` (`logica/instalacoes.ts`). Para o ADE o equivalente natural é "abrir projeto/workspace".

---

## 3. Terminal/PTY: o que já está resolvido e o que dá para extrair

Tudo em `desktop/src/assistentes/` (main) e `central/ui/src/assistentes/` + `central/ui/src/componentes/TerminalAssistente.tsx` (renderer). O contrato fica em `docs/contrato/CONTRATO-assistentes.md`.

### 3.1 Sessões (`sessoes.ts`, 572 linhas) — **extrair como está**
- `GerenciadorSessoes`: `abrir`, `escrever`, `redimensionar`, `encerrar`, `descartar`, `interromper`, `recuperar`, `desanexar`, `diagnostico`, `emitirSubagente/emitirEvento`, `prepararAnexos`, `encerrarTodasEAguardar` (3 s, depois SIGKILL).
- Interface `AdaptadorPty` (spawn/listar/anexar/historico/soltar/descartar + flag `persistente`) com duas implementações: `AdaptadorNodePty` (no processo) e `ClienteDaemon` (no daemon). O gerenciador não sabe qual usa.
- `prepararLancamento`: executável e argumentos passados **separados**, nunca shell; wrappers `.cmd/.bat` (`cmd /d /q /c call "..."` com escape `^` e `%%`) e `.ps1` (`powershell -NoProfile -ExecutionPolicy Bypass -File`) no Windows. `encerrarArvorePty`: `kill(-pid)` (grupo) no Unix, `taskkill /t /f` no Windows.
- `ambienteSeguro`: herda `process.env`, **remove variáveis de identidade de sessão do Claude Code** (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`...) para a CLI filha não se achar sessão-filha, e completa o `PATH` com `~/.local/bin`, volta, bun, nvm (todas as versões), homebrew. Crucial para app GUI (Dock não herda o PATH do shell).
- Backpressure: saída em pedaços de 64 KB; `bytes_pendentes > 256 KB` pausa o PTY; o renderer confirma consumo (`assistentes:confirmar_consumo`) **só depois que o xterm processou a escrita**; retoma abaixo de 128 KB.
- `sanitizarOsc`: **remove OSC 52 (clipboard) e OSC 8 (hyperlink)** da saída; mantém o resto do OSC. Trata sequência partida entre chunks (`osc_pendente`, teto 8 KB).
- Envelope de evento `{versao:1, sequencia, sessao_id, tipo, ...}` com `sequencia` monotônica por sessão; estados `iniciando|executando|encerrada|erro`; eventos `saida`, `estado`, `encerramento`, `atividade`, `conversa`, `subagente_*`, `painel_aberto`. Validação de eventos em `contrato.ts`.
- Limites (`contrato.ts` `LIMITES_ASSISTENTES`): 64 args de 4 KiB, escrita 64 KiB, 2–500 colunas, 1–300 linhas, **8 sessões por janela**, buffer de saída 2 MiB.
- Geração: `geracao` incrementa a cada contexto novo; `janela_id` amarra sessão à janela; IDs `sessao_<uuid>` e `exe_<uuid>` são opacos. O renderer **nunca envia `cwd`**: a raiz vem do main.

### 3.2 Daemon de PTY (`daemon/`, ~1100 linhas) — **extrair como está**
- Sessões sobrevivem ao fechamento do app. Protocolo NDJSON sobre socket Unix (`$TMPDIR/expxmedia-pty-<uid>/<sha1 de userData>.sock`, curto por causa do limite de ~100 chars) ou named pipe no Windows (`\\.\pipe\expxmedia-pty-<hash>`). `protocolo.ts`: pedidos `ola(protocolo, token)`, `listar`, `criar`, `anexar`, `soltar`, `historico`, `escrever`, `redimensionar`, `pausar`, `retomar`, `matar`, `descartar`, `encerrar_tudo`; respostas casadas por `n`/`re`; eventos `dados {fim}` e `saiu`. `PROTOCOLO_DAEMON = 1`: daemon de outra versão não é reaproveitado.
- Autenticação: token aleatório em `<userData>/sessoes-pty/token` (modo 0600), socket em pasta privada.
- Histórico em disco por sessão (`fd` + `cauda`, compactação quando o log passa de 4x o limite), retenção de 7 dias para sessões encerradas, daemon sai sozinho após 60 s sem cliente e sem processo vivo (`ociosoMs`).
- `ClienteDaemon`: fila de pedidos antes da conexão, sobe o daemon se o socket não responde, **cai na reserva `AdaptadorNodePty` se falhar** (sessões passam a morrer com o app; `persistente` vira false). `recuperar()` reproduz histórico e depois a saída retida sem duplicar (usa `fim` acumulado).
- Regras operacionais importantes: o daemon roda o mesmo executável do app, então **instalar atualização exige encerrar o daemon** antes (`main.ts`, handler `atualizacao:instalar` e `will-quit` com `encerrar_tudo`). `uncaughtException` no daemon só registra em `daemon.log`.
- Em e2e/dev o daemon usa pasta e socket próprios (`EXPEXP_E2E_DAEMON_DIR`), para não tocar nas sessões do app instalado; `EXPXMEDIA_SEM_DAEMON=1` desliga.

### 3.3 Guardião de transições (`guardiao.ts`, 41 linhas) — **copiar integralmente**
`GuardiaoTransicoes.transicionar({sessoes, confirmar, executar, publicar})`: fila serial de promessas; bloqueia admissão de sessões novas, pergunta confirmação se há sessões ativas, encerra e aguarda, executa a transição (trocar instalação/janela/recarregar/fechar), e **só libera a admissão se a transição não publicou**. Com daemon (`persistente`), trocar de projeto só solta as sessões (`desanexar`), sem confirmação.

### 3.4 Autorizador de remetente IPC (`autorizador.ts` + `ipc.ts` + `invalidacao.ts`) — **extrair**
Não é "autorizador de comandos" (não há allowlist de comandos shell); é autorização **por remetente + validação de payload**:
- `autorizarRemetente({url, url_painel, frame_principal, janela_id, janela_esperada})`: recusa subframe, janela diferente, origem diferente da do painel, path fora de `/` ou `/index.html`, `search`/`hash` presentes.
- `criarAutorizador`: cache do veredito por `(webContents.id, WeakMap<frame>, chave JSON da URL/contexto)`, limite de 16 URLs por frame; invalidado em `did-navigate`, `render-process-gone` e ao recriar o contexto (`ligarInvalidacao`).
- `ipc.ts`: um validador puro por canal (`validarEscrita`, `validarSessaoId`, `validarAnexos`, `validarRedimensionamento`, `validarSelecaoExecutavel`), canais `assistentes:*`; erros de `escrever/redimensionar` (sem resposta) voltam pelo canal interno `assistentes:falha`.
- Para o ADE, a "permissão de comando" (o que a IA pode rodar) é delegada às próprias CLIs via `argumentosAutomaticos` (ver 3.5). Não há um autorizador de comandos próprio para copiar; isso será responsabilidade nova do ADE (ver item 7).

### 3.5 Catálogo e detecção de CLIs (`catalogo.ts`, `deteccao.ts`) — **extrair, é o ativo mais valioso para o ADE**
- Catálogo explícito de 17 ferramentas: terminal, codex, claude, gemini, opencode, openclaude, deepseek_harness, mimo, pi, aider, qwen, mistral_vibe, goose, cline, kilo, openhands, chatgpt (não mapeada), mais `personalizado`. Cada uma: executáveis candidatos, `mapeada`, descrição.
- Por ferramenta: `argumentosAutomaticos` (Claude/OpenClaude `--dangerously-skip-permissions`; Codex `--approve-for-me`, com comentário explícito de **não** usar `--dangerously-bypass-approvals-and-sandbox`; Gemini `--approval-mode=yolo --skip-trust`; OpenCode `--auto`; Aider `--yes-always`; Qwen `--approval-mode=yolo`), `teclaDeInterrupcao` (ESC nas CLIs de IA, Ctrl+C no shell; "pausar" nunca mata o processo), `argumentosDeRetomada` (Claude `--resume <id>`, Codex `resume <id>`, validado por `ID_CONVERSA`), `argumentosDePromptInicial` (Claude/Codex posicional, OpenCode `--prompt`), `configuracaoDeMcp` (Claude `--mcp-config <arquivo 0600>`, Codex `-c mcp_servers.<nome>.*` com token por `env_vars`, OpenCode `OPENCODE_CONFIG_CONTENT`), `FERRAMENTAS_COM_HOOK = [claude, codex, opencode]`. `recursosDaFerramenta(id)` calcula o que a UI pode oferecer, **sem a UI conhecer flags**.
- `detectarFerramentas`: varre o `PATH` + diretórios convencionais (homebrew, `/usr/local/bin`, `~/.local/bin`, volta, bun, nvm; `LOCALAPPDATA\Programs`, `APPDATA\npm` no Windows), respeita `PATHEXT`, distingue `ausente | sem_permissao | nao_mapeado`, resolve `realpath`, classifica `modo_lancamento` (`direto | cmd_wrapper | powershell_wrapper`). Devolve `executavel_id` opaco guardado em `RegistroExecutaveis` (memória do main). Seleção manual de executável exige caminho absoluto, existente e com `X_OK`.
- `criarCacheDeteccao` (em `ipc.ts`): cache por registro do contexto; invalida ao escolher executável e **no foco da janela**; aquecido no boot com `setImmediate`. O preparo de harness é cacheado por contexto (WeakMap) e tolera falha (sai do cache para tentar de novo).
- Presença local não significa autenticação (comentário no catálogo): o app só lança a CLI; login é da CLI.

### 3.6 Atividade, subagentes, conversas (`subagentes/`, `conversas.ts`) — **extrair**
- `ServicoSubagentes`: endpoint HTTP em 127.0.0.1 (porta aleatória, corpo máx. 1 MiB) com **token por sessão em memória**; adaptadores por CLI (`claude.ts` via `--settings`, `codex.ts` via `-c hooks...`, `opencode.ts`) traduzem hooks em eventos genéricos `atividade` (`trabalhando|aguardando|pronto`), `conversa` e subagentes (linhas somente leitura; `SeguidorArquivo` segue transcript/arquivo). Atividade vem **dos hooks, nunca adivinhada pela saída do terminal**. É a única lista a editar para suportar outra CLI.
- `conversas.ts`: guarda `sessao_id -> conversa_id` por instalação em `<userData>/assistentes-retomada/`, fora do daemon, para "Retomar conversa".
- Notificação nativa quando o agente termina/pede aprovação e a janela não tem foco (`avisarAtividade` em `main.ts`, `logica/notificar.ts`).

### 3.7 MCP de painéis / orquestrador (`paineis/`) — **extrair como recurso opcional**
Um agente (Claude) coordena outros painéis: ferramentas `paineis_listar`, `painel_abrir`, `painel_escrever`, `painel_ler`, `painel_aguardar`, `painel_interromper`, `painel_fechar` (`paineis/contrato.ts`, nome do servidor `expxmedia-paineis`). Socket local próprio + token, `@xterm/headless` para ler o que está na tela, só abre filhas com hook de atividade, texto grande (> 20 KB) vira arquivo em `.expxmedia/entradas/`. Altamente alinhado a um ADE (agentes orquestrando agentes).

### 3.8 Anexos (`anexos.ts`) — **extrair**
Colar/arrastar arquivo no terminal: o main grava bytes ou copia o arquivo para `<raiz>/.expxmedia/entradas/<sessao>/` e devolve **caminho relativo formatado para o shell** (`formatarCaminhoParaPrompt`, aspas simples só quando preciso), sem Enter. Limites: 10 itens, 25 MB, nome <= 80, allowlist de extensões (png, jpg, webp, gif, svg, pdf, mp4, mov, mp3, wav, txt, md, json), recusa `.env*`, exige `realpath` e arquivo regular. O Electron 37 não expõe `File.path`: o renderer usa `webUtils.getPathForFile` exposto pelo preload (`caminhoDoArquivo`). Para dev a allowlist precisa ser ampliada.

### 3.9 Links (`links.ts`, duas cópias espelhadas)
`urlDeLinkPermitida`: só `http/https`, sem credenciais, sem caractere de controle, <= 2048. Existe no renderer (`central/ui/src/assistentes/links.ts`, com `urlNoTexto`) e no main (`desktop/src/assistentes/links.ts`); **o main revalida e é a fronteira**. Clique simples NÃO abre; **Cmd/Ctrl+clique** abre (inclusive com mouse-reporting do TUI ativo: o clique é interceptado antes do xterm). `@xterm/addon-web-links` só detecta por regex no texto visível; OSC 8 fica removido (texto do link poderia mentir).

### 3.10 Busca (`TerminalAssistente.tsx`)
`@xterm/addon-search` + barra própria (`role="search"`; campo, "Aa" sensível a maiúsculas, anterior/próximo, fechar; Enter/Shift+Enter, Esc devolve o foco). Atalho: **Cmd+F no macOS, Ctrl+Shift+F nos demais** (Ctrl+F puro é readline e vai ao processo). O handler devolve `false` ao xterm para o atalho não ir ao PTY.

### 3.11 Layout de painéis (`layout.ts` main + `central/ui/src/assistentes/layout.ts`)
Árvore binária `terminal | divisao{orientacao, primeiro, segundo}` dentro de cada aba; `LayoutAssistentes {versao:2, ativa, abas[{arvore}], fixadas[]}` (v1 é lido, gravação sempre v2). Persistido **no main**, por projeto, em `<userData>/assistentes-layout/<sha1(raiz)[0:16]>.json` (escrita atômica temp+rename; `localStorage` não serve porque a porta do painel muda a cada abertura e com ela a origem). `validarLayout` reconstrói campo a campo: profundidade <= 16, <= 64 nós, ids `[\w.-]{1,80}`, arquivo <= 64 KB; inválido é descartado. `restaurarLayout` é tolerante (sessão que não voltou sai da árvore e a divisão colapsa; sessão recuperada sem grupo vira aba solta). Só grava depois da recuperação terminar e nunca com sessão provisória. Atalhos (`atalhos.ts`): Cmd+D divide, Cmd+Shift+D divide na outra orientação (no Ctrl: Ctrl+Shift+D / Ctrl+Shift+Alt+D), Cmd+N nova aba (herda a CLI ativa), Cmd+W fecha, Cmd+J foca, Cmd+B enviar a várias, Cmd+1..9, Ctrl+Tab, Cmd+Shift+Enter expandir, Cmd+Alt+setas navegam painéis. Regra geral: **Cmd+tecla no mac; Ctrl+Shift+tecla nos outros (Ctrl+letra é do processo)**.

### 3.12 Terminal no renderer (`TerminalAssistente.tsx`, 423 linhas)
- xterm 6 + FitAddon + SearchAddon + WebLinksAddon; chunk de vite próprio para `xterm` e `react` (`vite.config.ts`), terminal carregado sob demanda e **pré-carregado** (`terminal-carga.ts`).
- **Armazém de saída fora do React** (`assistentes/armazem.ts`): lista de chunks por sessão, teto 2 MiB medido em `length` UTF-16, descarta pelo mais antigo, descarta evento com `sequencia <= ultima`; `assinar()` faz replay síncrono dos retidos e depois entrega cada chunk; o xterm recebe chunk a chunk (sem estado React, sem concatenar 2 MiB por evento).
- `deveAplicarDimensao`: resize ao PTY só quando colunas/linhas calculadas mudam (evita ciclo de redesenho em TUIs de tela cheia); escala visual do Canvas nunca envia resize. "Reajustar terminal" força resize + Ctrl+L.
- Colagem grande (`colagem.ts`): > 20 000 caracteres ou > 32 KB pede confirmação; escolhe enviar como arquivo (vai para anexos) ou em partes de 32 KB respeitando code points; normaliza `\n` para `\r`; remove marcadores `ESC[200~`/`ESC[201~` de dentro do texto; só envelopa em bracketed paste se o terminal está em modo 2004; Esc cancela.
- Semáforo (`semaforo.ts`): prioridade `aguardando > trabalhando > pronto` agregada por grupo; **cor nunca é o único sinal** (anel / "!" / "✓" + `aria-label`); contador "N aguardando você"; pulso desligado com `prefers-reduced-motion`.
- Canvas: visão alternativa das sessões como cartões movíveis com subagentes (ver `docs/contrato/CONTRATO-assistentes.md`, seção "Divisão e ditado local").
- Fixar aba, "Fechar encerradas", lote (`lote.ts`, abrir várias CLIs com prompt inicial e "cadeado" de CLI), diagnóstico copiável só com metadados (`diagnostico.ts`).

### 3.13 O que dá para COPIAR/extrair como pacote compartilhado
Proposta de corte (pacote `@expx/terminal-core` no main e `@expx/terminal-ui` no renderer), em ordem de valor/custo:
1. **Main, sem dependência de Electron** (só Node + node-pty): `sessoes.ts`, `daemon/*`, `catalogo.ts`, `deteccao.ts`, `layout.ts` (parametrizar o nome `.expxmedia`), `anexos.ts` (parametrizar `PASTA_ANEXOS` e allowlist), `links.ts`, `conversas.ts`, `contrato.ts`, `guardiao.ts`, `autorizador.ts` (+ validadores de `ipc.ts`), `diagnostico.ts`, `subagentes/*`, `paineis/*`. Em `ipc.ts` só `registrarIpcAssistentes` toca `ipcMain`/`BrowserWindow` (tipos).
2. **Renderer, sem dependência da Central**: `armazem.ts`, `atalhos.ts`, `colagem.ts`, `layout.ts`, `links.ts`, `semaforo.ts`, `humor.ts`, `lote.ts`, `tipos.ts`, `terminal-carga.ts`, `TerminalAssistente.tsx` (+ busca), `componentes/CorpoSubagente.tsx`. Acoplamentos a cortar: `abas/Assistentes.tsx` mistura abas/canvas/menus com estado e com o "personagem da Alma" (`personagem/`, `useHumor`); o CSS das classes `.assistentes-*`, `.terminal-*` está dentro do `tokens.css` monolítico (extrair ~900 linhas).
3. Fixtures de teste reutilizáveis: `src/assistentes/fixtures/cli-pty.mjs` (CLI falsa via readline: eco, `tamanho`, SIGINT) e `cli-interativa.mjs`.
4. Resolvido por convenção de nome: hoje as constantes têm prefixo de produto (`expxmedia-pty-...`, `expxmedia-paineis`, `.expxmedia/entradas`, `assistentes:*`, `expxmedia-subagentes`). Ao extrair, torná-las parâmetros para dois apps instalados lado a lado não colidirem (sockets, pastas de `userData`, protocolo `expxmedia://`).

Sem pacote compartilhado hoje: os dois apps copiariam os arquivos. O repo não tem workspace npm (desktop e central são pacotes independentes ligados por `file:`), então a extração exigiria decidir entre (a) publicar/`file:` de um terceiro pacote ou (b) monorepo com npm workspaces.

---

## 4. UI: abas, layout, design tokens, componentes, tema

### Abas/rotas
- **Sem roteador.** Navegação por estado: `const [aba, setAba] = useState<Aba>("inicio")` em `central/ui/src/App.tsx`; menu lateral de botões com `aria-current="page"`. Áreas: Início, Agenda, Automações, Fluxos (lazy), Configurações (grupo: Ambiente, Imagem, Plugins, Alma), Criativos/Peças (grupo: Peças, Soul ID, Imagens geradas), Escritório (grupo: Daily, Decisões, Reuniões), Explorer, Galeria, Grafos, **Assistentes**, e abas de packs instaladas dinamicamente (`abas-pack.ts` / `pontePack.ts`, entrada estática com os tokens da casca).
- Política de memória: `LIMITE_ABAS_MANTIDAS = 6` abas visitadas ficam montadas e ocultas (`registrarVisita`, `chaveDaAbaMantida` agrupa subabas); **Assistentes fica sempre montada e fora da conta** (senão os terminais reiniciam). Cada aba é `React.memo` com callbacks estáveis (T-04.04). Abas pesadas (Fluxos) em `React.lazy`.
- Estado do servidor: `estado/sincronizar.ts` aplica o JSON completo vindo do websocket; tipo `EstadoDaInstalacao` compartilhado de `central/src/servidor/estado.ts`. Uma única assinatura dos eventos dos terminais repartida entre a aba Assistentes e o personagem (`assistentes/compartilhar.ts`).

### Layout da casca (`tokens.css`)
Grid `.casca { grid-template-columns: var(--casca-lateral) minmax(0,1fr); min-width: 320px }`:
- **Menu lateral recolhido por padrão (76 px)**; expande para 232 px **por cima do conteúdo** com hover ou foco de teclado (sem empurrar), e "fixar" (`.menu-fixado`) o mantém aberto e empurra. `transition: width .18s` só com `prefers-reduced-motion: no-preference`.
- `.casca-principal`: `grid-template-rows: 64px minmax(0,1fr) 40px` (topo 64 px com aviso de atualização centralizado, uso global de LLMs, atalho Assistentes, notificações; rodapé/barra de uso 40 px). `height: 100dvh; overflow: hidden`.
- Rodapé lateral com versão do app e badge de atualização (`AvisoAtualizacao.tsx`, máquina de estados oculta/verificando/disponível/baixando/pronta/erro).
- Regra de desempenho testada: **sem `backdrop-filter` em barras fixas** (`.casca-topo`, `.barra-uso` têm fundo sólido `var(--expx-fundo|painel)`); só `.modal-fundo` usa `blur(7px)` (teste `tokens-css.test.ts`).
- Responsivo: breakpoints 560, 640, 1000, 1250 px; `@media (hover: none)` e `prefers-reduced-motion` tratados.

### Design tokens reais (`central/ui/src/tokens.css`, `:root`, linhas 8–36)
| Token | Valor |
|---|---|
| `color-scheme` | `dark` (**só tema escuro**) |
| `--expx-fundo` | `#16181a` (== `COR_FUNDO_JANELA`) |
| `--expx-painel` | `#1c1f21` |
| `--expx-superficie` | `#232729` |
| `--expx-superficie-2` | `#2b3033` |
| `--expx-texto` | `#f2f5f3` |
| `--expx-texto-suave` | `#a8b0ac` |
| `--expx-texto-discreto` | `#8f9994` |
| `--expx-borda` | `rgba(255,255,255,.10)` |
| `--expx-destaque` | `#8250df` (roxo) |
| `--expx-destaque-texto` | `color-mix(in srgb, var(--expx-destaque) 55%, white)` |
| `--expx-destaque-fundo` | `color-mix(... 12%, transparent)` |
| `--expx-destaque-borda` | `color-mix(destaque-texto 38%, transparent)` |
| `--expx-rosa` | `#e65ca8` (segunda cor do degradê) |
| `--expx-alerta` | `#ff7b9c` |
| `--expx-aviso` | `#f6c177` |
| `--expx-ok` | `= --expx-texto` (sucesso sem verde) |
| `--expx-fonte` | `"Chakra Petch", sans-serif` (400/600/700, TTF em `/assets/fontes/`, OFL) |
| `--expx-mono` | `"JetBrains Mono", monospace` (400) |
| `--expx-titulo` | `1.25rem` |
| `--expx-raio` | `14px` |
| `--casca-lateral` | `76px` (recolhido) / `232px` |
- Base: `body { font: 15px/1.6 var(--expx-fonte) }`, `:focus-visible { outline: 2px solid var(--expx-destaque); outline-offset: 4px }`, `* { box-sizing: border-box }`.
- Tipografia de UI é pequena e densa: rótulos `.rotulo` 10px mono, `letter-spacing .12em`, uppercase, `--expx-texto-discreto`; textos de controle 8–11 px; botões 11 px.
- Degradê de marca: `linear-gradient(135deg, var(--expx-destaque), var(--expx-rosa))` (botões de atualização, barras de progresso/uso).
- **Tema da casca é mecanicamente trocável pela Alma**: `central/ui/src/marca.ts` `aplicarMarca()` sobrescreve `--expx-destaque` e `--expx-rosa` em `document.documentElement.style` (nome da empresa no `document.title`); todos os demais tons derivam por `color-mix`. É o mecanismo a reaproveitar para tema/accent configurável.
- Tema do terminal (`TEMA_TERMINAL` em `TerminalAssistente.tsx`): `background #0c0f10`, `foreground #e7ece9`, `cursor #b89cff`, `selectionBackground #28563a`, `selectionForeground #f4fff7`; ANSI: black `#25302b`, red `#f87171`, green `#4ade80`, yellow `#facc15`, blue `#60a5fa`, magenta `#c084fc`, cyan `#22d3ee`, white `#d7ded9` (+ brights `#3d8a5b`, `#fca5a5`, `#86efac`, `#fde047`, `#93c5fd`, `#d8b4fe`, `#67e8f9`, `#ffffff`). Constante em TS, não em CSS variable.
- Cores literais espalhadas (contagem em `tokens.css`): `#0c0f10` x13 (fundo de terminal), `#0d100f`, `#101312`, `#0c1710` (texto do botão primário `.botao-primario`), `#ff6f91`/`#ef6b6b` (erro). O CSS **não é 100% tokenizado**.

### Componentes (todos próprios, sem biblioteca)
- `Icone.tsx`: sprite de paths SVG por nome (`viewBox 24`, `stroke currentColor`, `strokeWidth 1.6`, round caps; ícones: inicio, daily, pecas, agenda, galeria, explorer, configuracoes, assistentes, atividade, alerta, seta, menu, pack...). Para o ADE, adicionar nomes (git, arquivo, diff etc.) no mesmo `Record`.
- `Pagina.tsx` (cabeçalho de página), `EstadoVazio.tsx`, `BarraUso.tsx` (+ `ResumoUsoGlobal`, consumo de LLMs com popover), `AvisoAtualizacao.tsx`, `EspacoArquivosAssistente.tsx` (Explorer ao lado do terminal, editor à direita), `TerminalAssistente.tsx`.
- Padrões de CSS por classe BEM-ish em PT-BR: `.casca-*`, `.menu-*`, `.botao-primario` (fundo destaque, texto `#0c1710`, 11px/600, raio 8), `.botao-leve` (borda, transparente, hover com `destaque-fundo`; `.perigo` usa `--expx-alerta`), `.botao-adicionar`, `.modal-fundo` (overlay `rgba(5,7,6,.74)` + blur 7px), `.assistentes-barra` (30px, fundo `--expx-painel`), `.assistentes-abas` (scroll horizontal sem scrollbar), `.terminal-busca` (flutuante top 8px/right 18px, sombra `0 4px 18px rgba(0,0,0,.4)`).
- **Não há tema claro.** `color-scheme: dark` fixo, sem `prefers-color-scheme`. Para o ADE, claro/escuro exige criar a camada de tokens claros e tokenizar os literais.

### Acessibilidade e testes de UI
Roles reais (`role="search"`, `aria-pressed`, `aria-current="page"`, `role="tab"` nas abas de sessão, `role="dialog"` para encerrar com `aria-label`), confirmações por diálogo da UI (nunca `window.confirm`; o e2e afirma zero diálogos nativos). Testes em Testing Library + jsdom, mockando `TerminalAssistente` com um `<pre>` que assina o mesmo armazém.

---

## 5. Convenções de código, testes, CI e release

### Código
- **TypeScript estrito** em todo lugar (`strict`, `noUncheckedIndexedAccess`; central também `exactOptionalPropertyTypes`). Sem `any` visível nos módulos lidos; `unknown` + validação manual na borda.
- Nomes em **português sem acento** para identificadores de domínio (`GerenciadorSessoes`, `abrirSessao`, `executavel_id`, `sessao_id`), campos de contrato em `snake_case` (M3), enums minúsculos (M4). Mistura consciente: APIs de bibliotecas e tipos do Electron ficam em inglês.
- Estilo de módulo: **funções puras pequenas + classe/fábrica injetável**, comentário em PT-BR explicando o *porquê* e referenciando IDs do plano (`D-15`, `R-05`, `T-05.10`). Dependências externas injetadas (`AutoUpdaterFalso`, `Janela`, `detectar`, `criar_id`, `adaptador`) para teste sem Electron.
- Validação defensiva na fronteira (IPC, layout, anexos): reconstrói campo a campo e **descarta** o que não cabe no formato (nunca repassa o objeto recebido).
- Escrita atômica (temp na mesma pasta + `rename`) e JSONL com trava (M15); arquivos privados com modo `0600`/`0700`.
- Números calibrados: comentário `origem: <Projeto>/<arquivo>:<linha>` (AGENTS.md regra 5).
- Sem ESLint/Prettier configurados (não há `.eslintrc`/`.prettierrc`; a verificação é `tsc --noEmit`). O ADE pode adicionar, mas não há padrão herdado.

### Testes
- **TDD declarado** (AGENTS.md regra 4: teste antes do código, precisa falhar antes de passar; tasks com "dois testes" e critério binário). Testes ao lado do código (`x.ts` + `x.test.ts`).
- Três camadas no desktop: unitário (`src/**/*.test.ts`), **e2e com Playwright `_electron.launch`** (`desktop/tests/e2e.test.ts`, `daemon.e2e.test.ts`, `paineis.e2e.test.ts`, `onboarding.test.ts`, `pronto.test.ts`, `workflow.test.ts`) usando `EXPEXP_E2E=1`, `EXPEXP_E2E_EXECUTAVEL`, `EXPEXP_E2E_PASTA`, `EXPEXP_E2E_DAEMON_DIR` (ganchos de teste no main que substituem diálogos nativos e isolam o daemon) e fixtures (`tests/fixture.ts` cria instalações em `tmpdir`); **teste de PTY no Electron real** (`tests/pty-electron.cjs`, `npm run test:pty:electron`); **teste do pacote** (`scripts/verificar-pacote.mjs`, `npm run test:pacote`) que abre o `app.asar`/`.app` gerado e roda node-pty com `ELECTRON_RUN_AS_NODE=1`, resize, SIGINT e a ponte MCP de dentro do pacote; `verificar-worker-pacote.mjs` idem para o worker.
- Central: `vitest.global-setup.ts` compila o servidor uma vez por execução (testes usam `central/dist`). Testes de contrato cruzando camadas: `janela.test.ts` (cor == token CSS), `tokens-css.test.ts` (sem backdrop-filter), `contratos-sincronizados.test.ts`, `marca-varredura.test.ts` (M13), `readme-perf.test.ts`.
- Regras: nenhuma chamada paga ou publicação real em teste; provedores contra stub HTTP local; CLIs falsas (`cli-pty.mjs`) em vez de CLIs reais; Keychain real nunca em teste (`EXPXMEDIA_COFRE_TESTE_DIR`).
- Medição de perf como teste: `central/ui/src/medicao/*.test.tsx` (idle, troca de aba, terminal) e `EXPXMEDIA_PERF=1` liga `iniciarMonitor` do event loop do main.

### Processo de trabalho
Método **sprintx**: `docs/<slug>/` com `00-DECISOES.md` (D-NN, alternativa descartada, motivo, status), `00-BLOQUEIOS.md`, `00-AUDITORIA.md` (até `VEREDITO: SIM`), `ORQUESTRADOR.md`, `sprint-NN/{sprint,fases,tasks}.md`, `base/` (evidência com `arquivo:linha`) e `validacao/` (capturas e logs). Trabalhos pequenos saem "sem o sprintx, a pedido" com `SPEC.md` + `PLANO.md`. `AGENTS.md` na raiz é o contexto para qualquer agente.

### CI (`.github/workflows/`)
- `desktop-validacao.yml`: em PR (paths `central/**`, `desktop/**`) e `workflow_dispatch`; matriz `macos-15`, `macos-15-intel`, `windows-latest`; Node 20; `npm ci --legacy-peer-deps` nos dois pacotes; central `typecheck && build && test`; desktop `typecheck && build && test`; empacota sem publicar (`npm run dist:mac` com `CSC_IDENTITY_AUTO_DISCOVERY=false`, `npm run dist:win`); **`npm run test:pacote` exercita o PTY empacotado** em cada arquitetura.
- `desktop.yml`: release por **tag `desktop-v*`**; matriz macOS e Windows, Node 22, `uv` setup; testa central (só mac), testa desktop (mac completo excluindo 3 e2e; Windows só `sessoes.test.ts` e `atualizacao.test.ts` + typecheck); `electron-builder ... --publish never` e depois `gh release upload` (dmg, zip, blockmaps, `latest-mac.yml`; Windows `ExpxMedia-Setup.exe`, blockmap, `latest.yml`) com `--clobber`.
- `windows-installer.yml`: reconstrói só o instalador Windows e anexa a uma tag existente (`workflow_dispatch` com `release_tag`).
- `pages.yml`: publica `site/` (página de download) no GitHub Pages, validada por `node site/validar.mjs`.
- **Inconsistência a não copiar**: Node 20 na validação e 22 na release, e a release Windows roda poucos testes.

### Release, assinatura e auto-update (`desktop/electron-builder.yml`)
- `appId: com.expx.expxmedia`, `productName: ExpxMedia`, saída `dist-app/`. Arquivos: `dist/**/*`, `build/icone-32.png`, `package.json`, `!**/*.test.*`.
- **mac**: `dmg` + `zip`, `arch: [universal]`, `artifactName: ExpxMedia-universal.${ext}`, categoria `public.app-category.productivity`, `NSMicrophoneUsageDescription` em `extendInfo`, `x64ArchFiles` para o `@electron/universal` aceitar os prebuilds do node-pty. Comentário importante: o `@electron/universal` junta todos os arquivos desempacotados num único glob de até 65 536 caracteres e falha acima disso; por isso o `asarUnpack` lista só JS de runtime de `expxmedia`, `yaml`, `zod`.
- **win**: `nsis`, `x64`, `oneClick: false`, `perMachine: false`, `allowToChangeInstallationDirectory: true`, `ExpxMedia-Setup.${ext}`. Ícones `build/icon.icns` e `build/icon.ico` gerados por `scripts/gerar-icones.mjs`.
- `extraResources`: fixture de CLI (`assistentes-fixtures/cli-pty.mjs`), `../motor` -> `motor-base` (filtrando `.venv`, `node_modules`, caches), `central/{contratos,nucleo,camadas}` -> `central-base/`. (Coisas do produto de mídia, não do ADE.)
- **Assinatura/notarização por secrets opcionais**: macOS usa `MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD` (vira `CSC_LINK`/`CSC_KEY_PASSWORD`) e, se existirem `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, notariza; sem eles exporta `CSC_IDENTITY_AUTO_DISCOVERY=false` (build sem assinatura). Windows: `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`. Não há `hardenedRuntime`/entitlements explícitos no YAML.
- **Auto-update**: `publish: { provider: github, owner: bittencourtthulio, repo: ExpxMedia }`; `logica/atualizacao.ts` usa `autoDownload = false`, `autoInstallOnAppQuit = true`, consulta a cada 4 h (`setInterval` com `unref`) e manualmente; só roda quando `app.isPackaged`; estados publicados por IPC (`atualizacao:evento`); a UI decide baixar/instalar. Antes de `quitAndInstall` o main encerra o daemon (ele é o mesmo executável e travaria a troca) e confirma com o usuário se há sessões vivas. (Inferência: sem assinatura macOS o Squirrel.Mac não consegue aplicar o update; o repositório só declara isso indiretamente pelos secrets opcionais.)
- Versão única 0.1.30 nos dois `package.json`; tag `desktop-vX.Y.Z`.

---

## 6. Regras M1–M16 resumidas e aplicabilidade a um produto de dev

Fonte: `docs/contrato/CONVENCOES.md` (adaptação das R1–R14 do `expxdev`, prefixo `M` para nunca colidir com as regras `R` do expxdev, que o mesmo dev pode ter aberto ao lado). Contratos derivados citam por número ("regra M13") e não repetem o texto.

| # | Regra | Aplica-se ao ADE de dev? |
|---|---|---|
| M1 | JSON (`.json`/`.jsonl`) é formato de máquina; Markdown é formato de pessoa/modelo; nenhum programa extrai dado de Markdown | **Sim** |
| M2 | Chave de versão do contrato abre o JSON (`expxmedia_<x>: 1`); versão maior que a suportada é **rejeitada** | **Sim** (trocar prefixo, ex.: `expxdev_*`/`ade_*`) |
| M3 | Chaves `snake_case`, minúsculas, sem acento (exceção: `.env`) | **Sim** |
| M4 | Enums minúsculos sem acento; prosa livre com acento | **Sim** |
| M5 | Datas `AAAA-MM-DD`; momento ISO 8601 **com fuso** (`-03:00`); data vem do sistema, nunca de memória | **Adaptar**: em dev o padrão do `expxdev` é UTC; escolher e fixar uma (a motivação de fuso era "publicar às 07:00") |
| M6 | Booleanos `true/false` reais | **Sim** |
| M7 | Chave nunca omitida (`[]` vazio, `null` ausente); ausência de obrigatória é *violação* visível, não *rejeição*; leitor não preenche padrão em silêncio | **Sim** |
| M8 | Ausente é `null`, nunca `"n/a"`, `""`, `"-"` | **Sim** |
| M9 | Nenhum caminho absoluto em artefato gravado; relativo à raiz da instalação | **Sim**, com nuance: o ADE lida com muitos projetos; usar caminho relativo à raiz do *workspace* |
| M10 | `atualizado_em` reescrito a cada gravação | **Sim** |
| M11 | Formatos de id (peça `P-AAAAMMDD-XXXX` aleatório para evitar trava entre processos, template, vaga, daily `d<NNN>`, decisão `D-<NNN>`) | **Adaptar**: manter a lógica (id aleatório quando há escritores concorrentes), trocar os domínios (sessão, tarefa, workspace). IDs de sessão do terminal já são `sessao_<uuid>` |
| M12 | Segredos e provedores só no `.env` da raiz, `MAIUSCULA_COM_SUBLINHADO`, nomes do catálogo | **Adaptar**: o ADE roda dentro de projetos que já têm `.env` próprios: nunca ler/escrever `.env` do usuário (já é regra do AGENTS.md); catálogo de variáveis do próprio ADE em arquivo à parte |
| M13 | **Nada de marca no código**: nome, cor, voz, conta, domínio, CTA e público vêm da Alma/`.env` (teste: outro cliente = zero bytes mudados) | **Não se aplica como está** (o ADE não tem Alma/empresa cliente). O equivalente útil: **nada de caminho/usuário/projeto hard-coded**, e a marca do próprio ADE centralizada em tokens (`--expx-destaque`). O nome do produto nas constantes (sockets, `userData`, scheme) deve vir de uma única fonte |
| M14 | Segredo só no `.env`/cofre; nunca em JSON, Markdown, rastro, log ou erro; mensagens citam só o **nome** da variável | **Sim, fundamental** (chaves de LLM, tokens de git). Exceção de cofre do SO (`@napi-rs/keyring`) é o padrão a seguir; o ADE herda `ambienteSeguro` e `ServidorMcp.segredos` (token por `env_vars`, fora da linha de comando) |
| M15 | JSON com escrita atômica (temp na mesma pasta + rename); JSONL só-acréscimo com trava, nunca reescreve linha antiga | **Sim** (layout, conversas, rastro já seguem; `layout.ts` e `daemon/servidor.ts` são a implementação de referência) |
| M16 | Prosa PT-BR com acento; identificadores PT sem acento; UTF-8 sem BOM (leitor tolera BOM) | **Sim** (se o ADE mantiver PT-BR; decisão de produto) |

Outros contratos que valem como padrão: `CONTRATO-estado-eventos.md` (rastro `eventos/AAAA-MM.jsonl`, **12 chaves obrigatórias em ordem** `ts, expxmedia_eventos, pack, origem, evento, peca_id, agente, capacidade, provedor, resultado, detalhe, arquivos`; o validador checa que as 12 estão **contidas**, não igualdade exata, lição do expxdev; enums de `origem` = skill/agente/hook/rotina/painel/humano e `resultado` = ok/falha/aviso/bloqueado; estado responde "onde está", rastro responde "o que aconteceu", daily/decisões respondem "o que foi combinado"; estado sincronizável com a nuvem com versão e hash e `<arquivo>.conflito`); `CONTRATO-pack.md` (o que um pack/camada declara ao ser instalado, com requisitos, hooks, capacidades, `motor_min`); `CONTRATO-capacidades.md` (catálogo de capacidades e chaves do `.env`). Os de peça/template/alma/galeria/soul/nuvem são do domínio de mídia.
O rastro do desktop (`logica/rastro.ts`, `notificar.ts`) observa `eventos/` com chokidar e notifica só `publicacao_concluida`, `publicacao_falhou`, `geracao_falhou`, sem conteúdo sensível.

---

## 7. O que NÃO serve, ou deve mudar, no ADE de desenvolvimento

### Não copiar (é do domínio de mídia)
- Toda a camada Alma/peças/templates/galeria/packs/soul/fluxos: `central/ui/src/{alma,aceite-galeria,fluxos,soul,personagem}`, abas Peças/Galeria/Fluxos/Agenda/Automações/Soul ID/Imagens geradas, `central/src/{motor,fluxos,nuvem,plugin,servidor/{galeria,soul*,rss,alma*}}`, `motor/`, `nucleo/`, `templates/`, `desktop/src/{ditado,instalacao}`.
- O "personagem da Alma" (`AlmaViva`, `useHumor`, popover, esquiva) que reage à atividade dos terminais: é identidade de produto do ExpxMedia.
- `marca.ts` como está (puxa cor e nome da Alma do `alma.json`); reaproveitar só o mecanismo (`setProperty` de `--expx-destaque` e `--expx-rosa`).
- `extraResources` de `motor-base`, `central-base`; `@napi-rs/keyring` e a nuvem (Supabase), a menos que o ADE tenha login.
- Nome de produto embutido: scheme `expxmedia-app`, protocolo `expxmedia://`, sockets `expxmedia-pty-*`, `expxmedia-subagentes` (temp), `expxmedia-paineis`, `.expxmedia/entradas`, `EXPXMEDIA_*`/`EXPEXP_E2E_*`, appId `com.expx.expxmedia`, repo de publish `bittencourtthulio/ExpxMedia`.

### Precisa mudar para dev
1. **Instalação vs. workspace.** O ExpxMedia tem **uma instalação (pasta da empresa) por janela**, a raiz vem do main e cada sessão abre nela. Um ADE tem **vários repositórios/worktrees**, cada agente pode precisar do seu diretório. Mudar `GerenciadorSessoes({raiz})` para `cwd` por sessão **decidido pelo main** (nunca pelo renderer, manter o princípio), e o layout por workspace (hoje chaveado por `sha1(raiz)`).
2. **Missões com git worktree ficaram fora de escopo** no ExpxMedia (`docs/terminais-refinamentos/SPEC.md`: "a instalação é a pasta da empresa, não um repositório"). Para o ADE isso passa a ser central: worktree por agente/tarefa, branch, diff, commit. Nada existe para copiar; é nova superfície.
3. **Permissões/aprovação de comandos.** Hoje o app liga o modo automático das CLIs (`--dangerously-skip-permissions`, `--approval-mode=yolo`, `--yes-always`), porque o usuário de mídia não quer aprovar cada passo. Num ADE de software isso é decisão de segurança séria: tornar configurável por workspace/CLI, padrão mais seguro (Codex já evita o bypass de sandbox), e considerar sandbox/allowlist de comandos e de diretórios. O "autorizador" atual só autoriza *remetente IPC*, não comandos.
4. **Allowlist de anexos** (imagens, pdf, mídia, `.txt/.md/.json`) é estreita demais para dev (código, logs, zips, `.ts`, `.patch`); manter as defesas (`realpath`, recusa `.env*`, limite de tamanho, pasta de entrada por sessão) e ampliar a lista. Também mudar a pasta `.expxmedia/entradas` (não sujar o repo do usuário: usar `<userData>` ou pasta ignorada pelo git).
5. **Limites.** 8 sessões por janela e buffer de 2 MiB foram calibrados para "várias CLIs produzindo peças"; um ADE provavelmente quer mais painéis e scrollback configurável (o doc de refinamentos cita como fora de escopo "metas de 64 painéis"). Buffers maiores exigem rever o armazém (memória) e o histórico do daemon.
6. **Hooks por CLI** cobrem só Claude, Codex e OpenCode (`FERRAMENTAS_COM_HOOK`). Para o ADE (agente = produto) vale ampliar adaptadores de subagente e atividade, e expor "aguardando você" de forma mais rica (diff/aprovação). `argumentosDePromptInicial` não cobre Gemini ("não instalada para conferir a flag"), valide contra as CLIs reais.
7. **Servidor HTTP local em porta aleatória como fonte de UI.** No ExpxMedia isso existe porque a Central também funciona como CLI/painel em navegador (`expxmedia panel`) e o estado vem do disco por websocket. Um ADE só-Electron pode preferir carregar a UI direto do `file://`/scheme próprio com IPC tipado, evitando a origem variável (que já causou: layout precisou ir para o main porque `localStorage` muda de origem a cada abertura). Se mantiver o servidor local, replicar o bloqueio de não-GET e o filtro de navegação.
8. **Tema claro/escuro.** O ExpxMedia é só escuro. Um ADE de dev normalmente oferece os dois (e o xterm precisa de dois `ITheme`). Isso obriga a tokenizar os literais (`#0c0f10`, `#0c1710`, `#ff6f91`...), criar `:root[data-theme="light"]`, e o `COR_FUNDO_JANELA` do main passa a depender do tema (o teste de contrato CSS↔main precisa cobrir os dois).
9. **Estado como estado inteiro por websocket.** Adequado para o volume de uma instalação de mídia. Para repositórios grandes (árvore de arquivos, git status, diffs) o modelo "reler tudo e reenviar o hash" não escala; o Explorer atual (`servidor/explorer.ts`) é leitura/edição simples, sem LSP, sem indexação, sem editor de código (edição só de texto). Um ADE precisa de serviços próprios (git, busca, LSP/editor Monaco ou CodeMirror) que o ExpxMedia não tem.
10. **CSS monolítico** (`tokens.css` 1579 linhas, 176 KB) com classes globais: funciona para o time atual, mas ao extrair o terminal em pacote e acrescentar muitas telas de dev convém separar tokens (variáveis) de componentes (CSS por componente ou CSS modules).
11. **CI heterogêneo** (Node 20 vs 22; Windows testa quase nada): padronizar Node, rodar a suíte completa nas três plataformas, e manter o teste de pacote (`test:pacote`), que é o que de fato prova que `node-pty` e o daemon funcionam empacotados.
12. **Assinatura/notarização** hoje é opcional e silenciosamente desligada sem secrets; para um produto de dev distribuído (e com auto-update funcional no macOS) tornar obrigatória na release, com hardened runtime e entitlements para `node-pty` (JIT/`allow-unsigned-executable-memory` podem ser necessários; não configurado no repo).
13. **Idioma.** M16 fixa PT-BR também nos identificadores. Se o ADE tiver contribuidores ou APIs externas em inglês, decidir cedo; o digest assume que o novo app herda PT-BR.

### Riscos/armadilhas já resolvidos que vale herdar (não redescobrir)
- Variáveis de sessão do Claude Code vazando para CLIs filhas (removidas em `ambienteSeguro`).
- PATH do app GUI sem nvm/volta/bun/homebrew (completado).
- `File.path` inexistente no Electron 37 (usar `webUtils.getPathForFile` no preload).
- `@electron/universal` com glob > 65 536 chars (limitar `asarUnpack`).
- node-pty precisa de `asarUnpack` e `x64ArchFiles` no mac universal; daemon e ponte MCP rodam com `ELECTRON_RUN_AS_NODE=1` e dependem disso estar empacotado corretamente (teste `verificar-pacote.mjs`).
- Daemon impede substituição do executável na atualização (encerrar antes de `quitAndInstall`).
- Socket Unix > ~100 caracteres (usar pasta curta no `tmpdir` com hash).
- Replay do histórico duplicando saída ao recuperar (usar `fim` acumulado).
- Resize em cascata em TUIs (só enviar quando colunas/linhas mudam).
- OSC 52/8 na saída como vetor de clipboard/link enganoso (removidos no main).
- Colar texto grande quebrando o IPC de 64 KB (diálogo, arquivo ou partes) e marcadores de colagem dentro do texto colado.
- Ctrl+letra é do processo (Ctrl+F, Ctrl+D, Ctrl+W): usar Cmd no mac e Ctrl+Shift nos demais.
