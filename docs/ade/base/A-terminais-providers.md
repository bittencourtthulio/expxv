# Digest A — Spec 01 (Terminais/Painéis/Workspaces) e Spec 04 (Providers/Modelos)

Base para plano de implementação de ADE em Electron. Selos: [OBS] observado, [DEC] decisão da spec, [LAC] lacuna. Prioridade: M = MUST (DEVE), S = SHOULD (DEVERIA). Prioridade inferida do verbo normativo da spec (a spec não usa P0/P1).

---
# PARTE 1 — SPEC 01: Terminais, Painéis, Workspaces

## 1.1 Requisitos funcionais (RF, prio, aceite)

**Pane/terminal**
- RF-01.01 M: PTY vive no main process, independente do renderer. Aceite: Cmd+R no renderer não mata processos; painéis religam aos mesmos PTYs.
- RF-01.02 M: `kind` ∈ cli|shell|browser. Aceite: três tipos criáveis pela UI.
- RF-01.03 M: header com ID, menu "…", pin, expandir, modo focado, destacar. Aceite: todos presentes e funcionais.
- RF-01.04 S: header colapsa para ID+"…" abaixo de 220 px [DEC].
- RF-01.05 M: pin em qualquer pane; pane fixado não é reordenado nem reciclado por "fechar terminados".
- RF-01.06 M: fechar pane mata PTY em ≤500 ms, sem IPC síncrono; X some em <200 ms.
- RF-01.07 M: novo pane herda provider/modelo do último pane do Workspace.
- RF-01.08 M: sub-agente sempre é Pane visível; nenhum worker oculto. `pane_spawn` sempre cria pane na grade.
- RF-01.09 M: pane guarda `provider_id`/`account_id`; header mostra provider e shell.
- RF-01.10 S: clicar `src/a.ts:10` abre arquivo; URL quebrada por wrap abre inteira. Default: visualizador de Files do Workspace [DEC].
- RF-01.10a M: ≥64 panes por janela.
- RF-01.11 M: região de terminais e região de browsers (direita) independentes; abrir 3 panes com browser a 400 px mantém 400 px.
- RF-01.12 M: pane novo não estica/encolhe vizinhos não adjacentes (algoritmo [LAC], ver 1.7).
- RF-01.13 M: fullscreen/expandir não cobre a top bar.
- RF-01.14 M: fechar/reabrir não some a grade; fechar 64 em ≤5 s com grade íntegra.
- RF-01.15 S: atalho Shift abre N panes em massa. Default Cmd/Ctrl+Shift+T, N=8 configurável [DEC].
- RF-01.20 M: um renderer/superfície por janela (canvas/WebGL), panes são regiões; proibido webview por pane.
- RF-01.21 M: só dirty rects; 24 panes ociosos = 0 redraws por ciclo de 2 s.
- RF-01.22 M: geometria orientada a evento, sem polling por pane [DEC].
- RF-01.23 M: custo de spawn ~1 ms/pane (antes ~72 ms); 32 panes em ≤0,4 s de trabalho de spawn.
- RF-01.24 M: `render_engine` overdrive|classic até checkpoint de remoção; alternar exige reinício da janela.
- RF-01.25 M: opções: cursor blink, hw accel, baixo uso CPU/GPU, iniciar com GPU off; persistem, GPU exige restart.
- RF-01.26 M: diagnóstico read-only + "copiar diagnóstico" (versão, SO, engine, panes, PIDs; sem conteúdo de buffer).

**Workspace/isolamento**
- RF-01.30 M: N workspaces; header minimalista (nome, cor, seta); fechar W1 não toca W2.
- RF-01.31 M: `workspace_owner_id` imutável + `execution_cwd`; Files só do Workspace ativo.
- RF-01.32 M: `external_access` por Workspace, default `read_write`; UI na setinha do Workspace > Configurações (não global). Com `read_only`, escrita fora do workspace → negada com mensagem.
- RF-01.33 M: mudar política não altera o rótulo dos panes abertos; enforcement em panes abertos [LAC].
- RF-01.34 M: temp de paste (`<app_tmp>/paste/`) sempre legível, mesmo em read_only.
- RF-01.35 M: `resolve_target_workspace(ctx)` único para Cmd+T, botão, MCP, restore. Nunca depende de "current workspace" global.

**Atalhos**
- RF-01.40 M: Cmd/Ctrl+T novo terminal na Mission ativa; Cmd/Ctrl+N nova janela.
- RF-01.41 M: Cmd/Ctrl+R e F5 contextuais (browser recarrega página; shell reinicia com confirmação); nunca recarregam o app.
- RF-01.42 S: demais atalhos [DEC]: Cmd/Ctrl+W fecha, Cmd/Ctrl+Alt+setas navegam, Cmd/Ctrl+1..9 missions, Cmd/Ctrl+Shift+F focar, F11 fullscreen do pane. Ctrl+C = SIGINT; copiar = Ctrl+Shift+C em Win/Linux.

**Paste/scroll**
- RF-01.50 M: `paste_soft_limit` (20.000 chars [DEC]); acima, diálogo (arquivo temp + referência | confirmar | cancelar). 100k mostra diálogo; 500k linhas não derruba conexão.
- RF-01.51 M: fila limitada (1 em voo + 4 pendentes), ESC cancela e esvazia.
- RF-01.52 M: bracketed paste se a app ativou modo 2004; sanitizar `ESC[201~` do conteúdo.
- RF-01.53 M: colar imagem grava temp e injeta o caminho; Windows aceita arrastar arquivo.
- RF-01.54 M: follow só se o usuário está no fim; rolou para cima, não é puxado.
- RF-01.55 M: seleção durante scroll funciona; resize não trunca TUIs (SIGWINCH correto).

**Shell**
- RF-01.60 M: `default_shell` bash|zsh|sh|dash (+SO); vale só para panes novos; nome aparece no pane.
- RF-01.61 M: shell remoto decidido pelo servidor; `remote.default_shell` separado [DEC].
- RF-01.62 S: PowerShell/cmd no Windows [DEC]; caminhos com espaço funcionam.

**Mission/worktree**
- RF-01.70 M: N Missions por Workspace em barra superior; worktree e grade próprios.
- RF-01.71 M: renomear/recolher/cor; trocar Mission não quebra layout; spawn MCP carrega `mission_id` explícito e abre na missão de origem.
- RF-01.72 M: limites via `entitlements.check("panes.max")`; Livre = 4 panes [DEC], sem limite = ilimitado.
- RF-01.73 M: `git worktree add <path> -b overclock/<mission_slug>`; path `<root>/../.overclock-worktrees/<ws_slug>/<mission_slug>`; sem git = diretório compartilhado + aviso; fechar Mission não apaga worktree sem confirmação.
- RF-01.74 M(mínimo): expor estado do worktree (branch, ahead/behind, sujo). Merge automático = fase 2.

**Multi-janelas**
- RF-01.80 M: arrastar nome do Workspace para fora abre janela; arrastar de volta une; sem janela vazia.
- RF-01.81 M: arrastar Pane abre janela só dele; devolver só ao workspace original; PTY é o mesmo, nada duplica.
- RF-01.82 M: feedback estilo aba do Chrome, sem flicker, janelas centralizadas.
- RF-01.83 M: estado por janela (`active_workspace_id`/`active_mission_id`); backend único, N janelas por IPC [DEC].
- RF-01.84 M: janela de pane destacado fecha ao devolver/fechar o último pane.

**SSH/tmux**
- RF-01.90 M: Workspace local|remote (SSH, ~/.ssh/config ou cadastrado); SSH só transporte.
- RF-01.91 M: testar conexão, checar pré-requisitos (CLI, Node), wizard se faltar; detectar CLIs remotas.
- RF-01.92 M: processo remoto em tmux (`oc-<ws_slug>-<pane_id>`), sobrevive a queda.
- RF-01.93 M: 1 pane = 1 sessão tmux; 2 panes = 2 shells distintos.
- RF-01.94 M: reabrir app reata `tmux attach`.
- RF-01.95 M: `tmux ls` pela conexão aberta, sem instalar nada; lista name, age, attached.
- RF-01.96 M: adoção só manual (never auto-attach); pane com selo "externo"; fechar só desanexa; NUNCA `kill-session`/`exit`/rename em externa.
- RF-01.97 M: sessão externa morta → 1 aviso "sessão encerrada no VPS" + botão; zero reconexão automática.
- RF-01.98 M: vínculos já adotados reatam sozinhos no restart [DEC].
- RF-01.99 M: sem tmux → avisar e permitir pane SSH direto, selo "sem persistência" [DEC/LAC].

**Cadeado**
- RF-01.100 M: dialog de squad com cadeado (inicia destravado); ativo = trocar CLI de um worker aplica a todos.
- RF-01.101 S: worker incompatível é sinalizado sem falhar o spawn; respawn reusa briefing, novo id com `respawn_of`.

**Semáforo**
- RF-01.110 M: `status` ready(verde)/working(amarelo)/needs_user(vermelho); Mission agrega vermelho>amarelo>verde.
- RF-01.111 M: needs_user quando o agente espera usuário; bypass-permission nunca fica vermelho. Critério de detecção [LAC].
- RF-01.112 M: pausa = SIGINT/ESC + descarta prompt pendente; volta a ready.
- RF-01.113 M: destaque visual (borda/pulso); ícone de modo (free/agentic/squad).
- RF-01.114 M: cor nunca é o único sinal (ícone/forma/tooltip) [DEC].

**Persistência**
- RF-01.120 M: layout em SQLite com debounce ≤500 ms; nunca localStorage (bug Windows).
- RF-01.121 M: pane recovery pós-reload inclui buffer recente.
- RF-01.122 M: prompt "restaurar terminais anteriores?" (por workspace ou todos); nunca restaurar os fechados pelo usuário.
- RF-01.123 M: `session_ref` por pane; resume por provider; injetar brief de memória (spec-06) no relançamento.
- RF-01.124 M: orquestrador restaurado volta com `role=orchestrator`.
- RF-01.125 M: escritas Mission/Pane/close_pane transacionais.
- RF-01.126 M: auditoria em `pane_events`.

**MCP**
- RF-01.130 M: tools `pane_spawn|read|write|close|list|status`; `pane_read` respeita `last_n` (40 padrão, máx 2000).
- RF-01.131 M: `BriefingBuilder` separado de `PtyService.spawn` [DEC].

## 1.2 Modelo de dados
SQLite único `overclock.db`, migrações versionadas; buffer = ring buffer em memória + snapshot `sessions/<pane_id>.log`.

- **Workspace**: id uuid, slug (kebab, único), name, color, kind local|remote, root_path, remote {host, port=22, user, identity_ref}|null, external_access read_only|read_write (default read_write), default_shell?, provider_default?, created_at, closed_at?. Invariante: remote≠null ⇔ kind=remote.
- **Mission**: id, workspace_id FK, slug, name, mode free|squad|agentic (default free), worktree_path? (único), branch?, base_branch, color, collapsed, layout json, status_agg (derivado), created_at, closed_at.
- **Pane**: id curto `p-014` (nunca reutilizado), workspace_owner_id (imutável), mission_id, window_id, kind, provider_id?, account_id?, model?, role worker|orchestrator|reviewer|free, execution_cwd, shell?, pinned, status ready|working|needs_user|exited|ended_remote, external, tmux_session?, pid?, respawn_of?, session_ref?, access_label (fixado no spawn), created_at, closed_at, closed_by user|agent|system.
- **WindowState**: id, kind main|workspace|pane, workspace_id, pane_id?, bounds {x,y,w,h}, active_mission_id.
- **PaneEvent**: id, pane_id, type, payload json, ts.
- **Settings (terminal)**: render_engine, cursor_blink, hw_accel=true, low_power=false, gpu_disabled_start=false, default_shell, paste_soft_limit=20000, restore_prompt=true, theme dark|light|gray|red (default dark).
- **Layout json**: `{terminal_region:{order[], sizes{}, pinned[]}, browser_region:{width_px:400, panes[]}, focused, fullscreen}`.
- Ciclo de vida: `spawning → ready ⇄ working ⇄ needs_user → exited → closed`; externo: `… → ended_remote → closed`.

## 1.3 Telas/UI e interações
- Janela: barra superior de Missions (renomear, recolher, cor; header preto); grade central; região de browsers à direita; lateral com diagnóstico/configurações/Discord.
- Header do Pane: ID, provider/shell, ícone de modo, semáforo, botões pin/focar/expandir/destacar/"…" (info, fechar, copiar ID).
- Workspace header: nome + cor + seta (Configurações [acesso externo + shell], Fechar workspace) e "+ terminal".
- Diálogos: restaurar sessão; paste grande ("Enviar como arquivo temporário / Enviar mesmo assim / Cancelar", ESC cancela); painel de sessões tmux (name, idade, anexada, selo "externo", ação Abrir; aviso "sessão encerrada no VPS" + Encerrar); dialog de squad (linha por worker + cadeado).
- Temas dark/light/gray/red, contraste AA, cores de workers legíveis no claro. UI diz "terminal"; "painel" só em docs.
- Semáforo: verde/amarelo/vermelho com ícone + tooltip; vermelho com borda pulsante; Mission agrega.
- Drag: elemento translúcido estilo aba Chrome, limiar 24 px.

## 1.4 Contratos
**IPC comandos**: `workspace.create|close|update_settings`, `mission.create|rename|close|switch`, `pane.spawn|close|write|resize|pin|move_window|restore`, `window.detach_workspace|detach_pane|reattach`, `remote.test_connection|list_tmux|adopt_tmux`, `settings.update`, `diagnostics.export`. Spawn em lote: um comando com N specs.
**Eventos (backend→UI)**, sempre com `pane_id` e `ts`: `pane.output {data b64}` (coalescido ≤60 Hz/pane), `pane.status_changed {from,to,reason}`, `pane.exited {code}`, `pane.ended_remote`, `pane.created`, `pane.closed {closed_by}`, `layout.changed {mission_id, layout}`, `mission.status_agg_changed`, `window.created|closed`.
**Input**: `pane.write {pane_id, data, bracketed, source: user|agent|paste}`.
**MCP `pane_*`**: spawn `{mission_id*, provider_id*, model?, account_id?, role?, cwd?, briefing?, name?}` → `{pane_id,status}` (erros mission_not_found, provider_unavailable, entitlement_exceeded, cwd_outside_workspace); read `{pane_id,last_n}` → `{lines,truncated,status}`; write `{pane_id,text,submit=true}` → `{accepted,queued}` (paste_too_large, access_denied); close (pane_pinned a menos de `force`); list; status `{status,since_ts,last_output_ts}`.
**Arquivos**: `overclock.db`, `sessions/<pane_id>.log`, `<app_tmp>/paste/<ts>.txt` (0600, limpeza ≤24 h).
**Protocolos**: `TERM=xterm-256color`, `COLORTERM=truecolor`, SIGWINCH no resize; SSH com multiplexação (conexão única por host); `tmux ls -F '#{session_name}|#{session_created}|#{session_attached}'`, `tmux new-session -A -s <name>`; `git worktree add|list|remove`.

## 1.5 Algoritmos não triviais
1. **resolve_target_workspace**: pane destacado → owner do pane; janela workspace/pane → workspace da janela; senão `active_workspace_id` da janela. Herdar provider/model/account do último pane criado no Workspace (conta reavaliada pela Policy).
2. **Grid**: `cols=ceil(sqrt(n*aspect))`, `rows=ceil(n/cols)`; pinned/focado ocupa slot maior; inserção recalcula só slot afetado e vizinhos; região de browser com largura constante; >16 panes colapsa headers e fonte reduzida.
3. **Spawn em massa**: um IPC com N specs; alocar ids e inserir em transação (status spawning); criar PTYs sem fork do processo gordo; um único `layout.changed`; boot das CLIs com `spawn_concurrency=8`; panes aparecem já em `spawning`.
4. **Paste**: `<=soft_limit` enfileira em chunks de 4 KB com backpressure do PTY, bracketed se modo 2004; acima, diálogo; temp injeta `@<path>` ou path conforme provider; ESC limpa fila e aborta o que está em voo.
5. **Semáforo (FSM)**: eventos prompt_submitted/output_started→working; permission_request/question→needs_user; task_done→ready; user_answers→working; pause→ready (descarta prompt); exit→exited. Fonte: hooks da CLI (spec-05), fallback heurístico (≥3 s sem bytes + cauda casa padrão de pergunta).
6. **Drag de janelas**: arrasto >24 px fora da janela cria WindowState; panes mudam `window_id` e PTYs ficam intactos (troca de "view"); reattach só na janela original (recria janela principal se já fechada).
7. **Restore**: lê `closed_at IS NULL`; se `restore_prompt`, pergunta; cli = relança com `session_ref` + brief; shell = novo shell no cwd; remote = tmux attach; externo = reatar só se a sessão existe, senão `ended_remote`; falha em um pane vira `exited` com "reiniciar", sem bloquear os demais.
8. **Fechamento em rajada**: marcar `closing` na UI, matar PTYs em paralelo (SIGHUP → 300 ms → SIGKILL), um repack, uma transação.
9. **Casos-limite**: cwd apagado → `cwd_missing` + oferecer `$HOME`; SSH cai → `disconnected`, backoff exponencial (máx 5), exceto externa encerrada; um pane pertence a exatamente uma janela.

## 1.6 Testes de aceitação relevantes (17 no original)
1 herança de provider (Gemini 3.1 → novo pane Gemini 3.1); 2 Cmd+T em janela destacada de W2 nasce em W2; 3 recovery com Cmd+R mantém PTYs e conteúdo; 4 browser a 400 px intacto com 3 panes novos; 5 paste 100k → diálogo, ESC não escreve, temp legível mesmo em read_only; 6 5 pastes de 3.500 + ESC → fila vazia, ≤1 chunk em voo; 7 bracketed paste 3 linhas não executa antes do Enter; 8 scroll não puxa viewport; 9 W1 read_only → `access_denied`, rótulo só muda em panes novos; 10 15 panes "1+1" em Codex, 64 panes em ≤5 s com 0 redraws de tela cheia por pane ocioso; 11 fechar 45 em rajada, UI responde; 12 tmux externo (lista sem abrir, selo, fechar não mata, morto = 1 aviso e 0 reconexões); 13 restore 3 de 4, orquestrador preservado; 14 cadeado com 4 workers; 15 semáforo (permissão→vermelho, responder→amarelo, concluir→verde, pausa→verde); 16 drag/devolver = 1 janela, mesmo PTY; 17 `default_shell=dash` → `echo $0`=dash.

## 1.7 [LAC] e recomendação
| [LAC] | Recomendação |
|---|---|
| Critério `needs_user` (hook vs heurística) | Híbrido: hooks do Claude Code (Notification/Stop) e equivalentes como fonte primária; heurística (≥3 s silêncio + regex de prompt) só fallback. Tornar regex por adapter (spec-04 `classifyOutput`). Testar contra bypass. |
| `paste_soft_limit`/fila/bracketed | Manter 20k chars, 1+4, e implementar bracketed real (xterm.js expõe `bracketedPasteMode`). Fixar baseline própria em teste. |
| N e atalho da abertura em massa | Cmd/Ctrl+Shift+T com N=8 configurável; confirmar dialog se N > limite do Plan. |
| Nível `none` de external_access e enforcement retroativo | Enum {read_only, read_write} no MVP; enforcement sempre pela política atual do Workspace (rótulo é só informativo). Enforcement real exige wrapper/hook nas tools da CLI ou sandbox; sem isso é só aviso, documentar. |
| Limites de panes por Plan | Hook `entitlements.check`; Livre=4 é default, ilimitado enquanto não houver billing. |
| Arquitetura multi-janela / Electron vs Tauri | Electron (já é a stack-alvo): um main process dono dos PTYs, N BrowserWindows. Não migrar. |
| Shell local vale para SSH? fallback sem tmux | Não vale (`remote.default_shell`); sem tmux = pane direto com selo "sem persistência". |
| Algoritmo de grade | Grid automático [DEC 7.2] no MVP; grids fixos 1-4 na fase 2. |
| Workspace sem git, limpeza de worktrees | Sem git: Mission compartilha diretório + aviso; limpeza sempre manual com confirmação, comando "podar worktrees órfãs". |

## 1.8 Pegadinhas técnicas
- **Electron específico**: PTYs só no main (ou utilityProcess dedicado); coalescer `pane.output` por pane a ≤60 Hz e mandar bytes, não strings (base64 custa ~33%: preferir MessagePort/transferable com ArrayBuffer em vez de base64 no `ipcRenderer`). Backpressure: pausar `pty.pause()` quando o renderer não consome (xterm `write` callback), senão estouro de memória com `yes`/500k linhas.
- **node-pty**: módulo nativo; rebuild por plataforma/versão do Electron (electron-rebuild, prebuilds), asar unpack; no Windows usa ConPTY (Win10 1809+, Win11 OK), atentar a wrappers `.cmd/.ps1` (resolver com `where`/PATHEXT) e caminhos com espaço (aspas/args array). Matar árvore de processos: no POSIX use grupo de processo (`kill(-pid)`), no Windows `taskkill /T`. Fechar com SIGHUP→300 ms→SIGKILL.
- **xterm.js "um renderer por janela"**: o xterm padrão tem 1 canvas/WebGL context por terminal; Chrome limita ~16 WebGL contexts por página. Para 32/64 panes o "Overdrive" exige (a) renderer customizado único (atlas de glifos compartilhado) ou (b) WebGL só nos panes visíveis/focados e DOM/canvas2D nos demais ou (c) OffscreenCanvas. É o item mais arriscado da spec; fazer spike antes de comprometer prazo. Buffers (`scrollback`) por pane multiplicam memória: limitar (ex. 5-10k linhas), manter o estado do terminal no backend (headless xterm ou serializer) para recovery pós-reload (`@xterm/addon-serialize`).
- **Dirty rects**: sem polling; ResizeObserver/eventos de layout → `pty.resize` com debounce (evitar tempestade de SIGWINCH ao arrastar divisores).
- **Windows**: Ctrl+C como SIGINT vs copiar; Ctrl+V de imagem não funciona direto (aceitar drag de arquivo / clipboard via `clipboard.readImage` no main e gravar temp); app na barra de tarefas (bug 1.3.5); sem assinatura dispara SmartScreen. Linux: Hyprland/Wayland é bug observado de janela/drag; testar.
- **Multi-janela**: mover pane = trocar a view que consome o stream do PTY; manter o buffer no backend senão o pane perde histórico ao mover. Uma janela de pane destacado precisa de ciclo de vida próprio (fecha no último pane).
- **SSH/tmux**: `tmux new-session -A` é idempotente e ajuda no reatar; nunca fazer `kill-session` em externo; parsear `tmux ls` com `-F` e separador seguro (nome pode conter `|`? tmux não permite `.`/`:` no nome, mas `|` sim: prefira separador de tab ou `\x1f`). Reaproveitar ControlMaster do OpenSSH em vez de N conexões; `ssh2` (Node) exige gestão de keep-alive e agent. Credenciais via ssh-agent/keychain.
- **Restore**: `session_ref` depende de cada CLI (spec-04 `listSessions/resumeArgs`); transação única evita missão sem panes (bug observado).
- **Memória**: ~300-500 MB por CLI Claude; 8 GB ≈ 4 terminais; avisar pressão de memória (`os.freemem` / `app.getAppMetrics`).
- **Segurança de paste**: sanitizar `ESC[201~`; temp 0600, TTL 24 h; nunca logar buffer em diagnóstico.

---
# PARTE 2 — SPEC 04: Providers e Modelos

## 2.1 Requisitos funcionais (RF, prio, aceite)
- RF-04.01 M: detectar CLIs no boot (claude, codex, gemini, kimi, agy, grok, cursor-agent/cursor, opencode, ollama…). Aceite: `claude` no PATH → `installed` em <2 s. `agy` é o binário do Antigravity.
- RF-04.02 M: campo "nome de CLI custom" + refresh; aceitar caminho absoluto [DEC S]. Aceite: `hermes` not_installed→installed se no PATH.
- RF-04.03 M: `discoverModels()` + refresh; fallback estático `source=hardcoded` (Kimi sem login).
- RF-04.04 M: adicionar modelo manual por nome, `source=manual`, ligado.
- RF-04.05 M: "atualizar latest" (Claude Code); `min_cli_version` por modelo (Opus 5.5 → CLI 2.1.280); alerta se versão menor.
- RF-04.06 M: ligar/desligar provider e modelo; desligado some da UI e de `list_providers/list_models`. Aceite: Codex off → sem modelos Codex.
- RF-04.07 S: UI orienta desligar providers não usados (custo de cache no MCP).
- RF-04.08 M: `bypass_permission` por provider (default false) → argumento no spawn (Codex "yolo").
- RF-04.09 M: multi-conta para Claude, Codex, Grok, Gemini; diretório/credencial isolados; Antigravity NÃO. Aceite: duas contas Claude em panes simultâneos.
- RF-04.10 M: regra "conta X exclusiva para modelo Y"; worker Sonnet nunca vai para a conta 2.
- RF-04.11 M: `pick_account` escolhe a conta cuja janela decisiva reseta primeiro; só usa outra se 100%. Aceite: A=88%/1 h vs B=68%/4 h → A.
- RF-04.12 M: pane novo herda provider/modelo/conta do último pane focado.
- RF-04.13 M: `cli_hosted_model` configura Claude Code (Anthropic-compat) ou Codex (OpenAI-compat) sem edição manual e sem perder Opus em outro pane; criar as duas variantes juntas; variante sem endpoint (MiMo via Codex, 404) pode ser omitida.
- RF-04.14 M: rota/cluster + base URL manual (MiMo).
- RF-04.15 M: sem provider custom livre; só OpenRouter cobre o resto.
- RF-04.16 M: OpenRouter lista catálogo (~647) de ≥2 famílias, marcar/desmarcar todos.
- RF-04.17 M: `roles_suggested[]` por modelo; Policy decide; suporta `forbidden_as_executor` e "nunca a mesma IA para código e revisão".
- RF-04.18 M: `pilot_only` recusado em `open_pane` com worker → `role_not_allowed`.
- RF-04.19 M: `supports_resume`; sessões por `last_used_at` desc.
- RF-04.20 S: mover sessão de Account ao bater limite (handoff/resume), avisando que o raciocínio interno pode não ser preservado.
- RF-04.21 M: `getUsage(account)` → janelas 5h/semanal/mensal, `used_pct`, `resets_at`, fonte 100% local.
- RF-04.22 M: classificar falhas `rate_limited|auth_expired|model_unavailable|endpoint_error|cli_crashed|trust_required` e emitir evento.
- RF-04.23 M: `initial_prompt_mode` argv|stdin_after_ready|unsupported (Kimi = stdin_after_ready).
- RF-04.24 M: nenhum modelo em background oculto; desincentivar/desabilitar subagentes de CLI, registrar limitação quando impossível.
- RF-04.25 M: geração de imagem via cota do plano da CLI (Codex, Grok, Antigravity).
- RF-04.26 M: Watcher diário, página só para founders.
- RF-04.27 M: API keys no cofre do SO.
- RF-04.28 M: resolver wrappers .cmd/.ps1 no Windows.
- RF-04.29 M: diagnóstico por provider (versão, caminho, auth, último erro, endpoint efetivo com chave mascarada).
- RF-04.30 S: "instalar CLI" (oficial); desktop = fase 2.

## 2.2 Modelo de dados
Persistência: `providers.json` (config), `accounts.json` (metadados, nunca segredos), cofre do SO (segredos), cache de modelos com TTL 24 h (manuais não expiram). Por usuário, exceto `pinned_account` (por Workspace, fase 2).

- **Provider**: id slug (claude-code, codex, gemini-cli, antigravity, grok, kimi, glm, mimo, deepseek, fireworks, openrouter, ollama, hermes, command-code, perplexity, kiro, opencode, cursor, github-copilot), kind (`cli_native|cli_hosted_model|api_aggregator|local`), display_name, cli_binary?, auth_types[] (cli_login|device_code|api_key|oauth|none), protocol[] (anthropic_compat|openai_compat|native_cli), host_cli?, enabled (true se instalado e configurado), bypass_permission=false, install_state not_installed|installed|broken, cli_version?, capabilities[] (resume, multi_account, vision, image_generation, mcp_client, skills, subagents_background, usage_probe), initial_prompt_mode=argv, endpoint_overrides[].
- **ProviderModel**: id `provider:model`, provider_id, model_name, display_name, enabled, source detected|manual|hardcoded|catalog, roles_suggested[] (pilot|worker|scout|reviewer|qa_fast|security|image), pilot_only, forbidden_as_executor, min_cli_version?, context_tokens?, effort_levels?[], quota_pool? (ex. codex-spark, codex-reserve), meta? (preço, tok/s, AA index; não normativo), first_seen_at, last_seen_at. Invariante: pilot_only ⇒ roles contém pilot e não worker.
- **Account**: id uuid, provider_id, label ("conta N"), auth_type, plan_hint?, credential_ref (ponteiro ao config_dir ou segredo; nunca o segredo), status unauthenticated|ready|limited|expired|error, exclusive_models[], priority, last_usage?, created_at, last_used_at. Invariantes: (provider_id,label) único; sem `multi_account` = máx 1 conta; duas contas nunca apontam ao mesmo diretório.
- **UsageSnapshot**: windows[{name five_hour|weekly|monthly, used_pct, resets_at}], captured_at, source local_files|cli_command|api, stale.
- **EndpointOverride**: {provider_id, family, base_url, auth_env, model_env?, extra_headers?, region?}.
- **ProviderModelWatchEntry**: id, lab, model_name, detected_at, kind new_model|update|unknown, source_url, icon_color, notes (Supabase).
- Matriz multi-conta: claude (sim), codex (sim), gemini (sim), grok (sim), antigravity (não), cursor/kimi/kiro/etc [LAC, assumir 1], APIs (N chaves), ollama n/a.

## 2.3 Telas/UI
- Configurações > Providers: lista com toggle, scroll de modelos com toggle, refresh, campo "nome de CLI novo", "adicionar modelo".
- Setinha do provider: "adicionar conta"; em Claude: "atualizar latest". Clicar no nome: "bypass permission".
- Seletor de provider/modelo/conta/esforço no header do Pane (herda do último).
- Barra de providers/headline no topo (Claude, Codex, Gemini, Antigravity, Cursor, Kimi, Groq) alimentada por `getUsage` (spec-09).
- OpenRouter: campo de chave + sugestão de teto de crédito US$1, checkboxes em lote. MiMo: seletor de rota + base URL manual. Ollama: aviso de RAM/GPU + botão Testar.
- Estados por provider: não instalado (cinza + CTA instalar), pronto, limitado (badge com `resets_at`), login expirado (CTA relogar), erro.
- Device-code (Grok): código + URL + copiar, passos numerados.
- Mensagens: "Limite atingido em {account}. Volta em {resets_at}. Mover sessão para {outra}?"; "Este modelo exige o CLI {min}. Atualizar agora?".
- Página web "modelos" do Watcher (founders): lista cronológica, filtro por lab, ícones nas cores do lab, aviso "pode ser atualização do laboratório".

## 2.4 Contratos
**`ProviderAdapter` (TS)**: `detect()`, `discoverModels(ctx)`, `listAccounts()`, `beginLogin()`, `verifyAccount()`, `buildSpawn(req)→{command,args,env,cwd,initial_prompt_mode}`, `applyEndpoint?`, `getUsage?`, `classifyOutput(chunk)→ProviderSignal|null`, `listSessions?`, `resumeArgs?`, `updateCli?`, `bypassArgs?`. `SpawnRequest {model, account, role, effort?, cwd, initial_prompt?, resume?, bypass, mcp_config?, allow_skills?}`.
**Eventos internos**: `provider.detected`, `provider.toggled`, `model.toggled`, `models.refreshed {added,removed}`, `account.added|removed`, `account.status_changed {from,to,reason}`, `account.limited {window,resets_at}`, `usage.updated`, `pane.provider_signal {signal, raw_excerpt}`, `cli.update_available|updated`, `watcher.entry_added`. Persistidos em log rotativo local.
**MCP**: `list_providers`, `list_models {provider_id?, role?}`, `pick_account {provider_id*, model_id?, exclude_account_ids?}` (erros no_account_available, unknown_provider, provider_disabled), `get_limits`, `open_pane {provider_id, model_id, account_id?, role, effort?, prompt?, cwd?}` (role_not_allowed, provider_disabled, model_disabled, account_limited, cli_not_installed, cli_version_too_old). Só retornam entidades `enabled`; payload mínimo.
**Env/flags [DEC]**: Claude hosted: `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`/`ANTHROPIC_DEFAULT_*_MODEL` só no ambiente do pane; Codex hosted: perfil temporário com `model_provider` custom em `CODEX_HOME` do pane; por conta: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`; bypass: Claude `--dangerously-skip-permissions`, Codex "yolo". Codex `mcp add` sem flag de header → escrever config direto. `provider.manifest.json` opcional para adapters plugáveis.

## 2.5 Algoritmos não triviais
1. **Detecção de CLIs**: para cada adapter, lista de nomes de binário alternativos (agy, hermes) + PATH do login shell (Electron no macOS herda PATH mínimo: resolver via `zsh -ilc 'echo $PATH'`/`shell-env`), `--version` com timeout, classificar `installed|broken|not_installed`; aceitar caminho absoluto; no Windows resolver PATHEXT/.cmd. Refresh manual.
2. **Spawn de Pane (8 passos)**: (1) validar provider/modelo enabled, role (`pilot_only`/`forbidden_as_executor`), `cli_version ≥ min_cli_version`; (2) resolver Account: explícita > herdada > `pick_account`, respeitando `exclusive_models`; sem conta → `account_limited` com menor `resets_at`; (3) `buildSpawn` + `applyEndpoint` se hosted; (4) injetar `bypassArgs`, MCP interno, `allow_skills`; (5) Windows wrapper, criar PTY via spec-01; (6) prompt inicial por modo (`stdin_after_ready`: aguardar padrão de prompt pronto, timeout 15 s, se falhar deixa no campo de entrada); (7) `classifyOutput` em cada chunk gera eventos e atualiza Account; (8) ao encerrar, gravar `SessionRef`.
3. **pick_account**: candidatas = status ready, sem conflito de `exclusive_models`, fora de `exclude`; se modelo tem `quota_pool`, usar janela do pool; vazio → `no_account_available` com min(resets_at); ordenar por used_pct<100 primeiro, menor (resets_at−now) da janela decisiva, depois `priority`. Snapshot stale >10 min → reprobe antes. Janela decisiva = a de maior % usado.
4. **Máquina de Account**: unauthenticated →(login)→ ready; ready →(verify_fail_auth)→ expired; →(limit_hit)→ limited; limited →(resets_at passou)→ ready; falha não-auth → error. `limited` vale só para a janela decisiva: conta limitada pode atender modelo de outro quota_pool.
5. **Multi-conta**: um config dir por Account (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), login via `beginLogin` dentro de PTY com env da conta; `verifyAccount` por comando leve da CLI; nunca compartilhar diretório.
6. **Uso/limites**: `getUsage` lê arquivos locais de credencial/consumo de cada CLI (100% local); falso positivo de antivírus (Defender) em leitura de tokens; snapshot com TTL.
7. **Override de endpoint**: só env/perfil do pane; nunca tocar `~/.claude`/`~/.codex`; validar endpoint no `verifyAccount` (404 → variante oculta).
8. **Mover sessão**: reabre em outra Account do mesmo provider usando resume/handoff; aviso de perda de raciocínio.
9. **Watcher**: cron 1x/dia, fontes (começar com OpenRouter `/models` + páginas de release), dedup `(lab, model_name)`, grava em Supabase, não adiciona modelos automaticamente.

## 2.6 Testes de aceitação relevantes
T-01 `agy` sem `antigravity` → provider installed; T-02 spawn Sonnet worker com env da conta certa responde "OK" ≤60 s; T-03 Codex desligado some do `list_models` e `open_pane` dá `provider_disabled`; T-04 Fable worker → `role_not_allowed`; T-05 conta 2 exclusiva de Fable (3 workers Sonnet na conta 1, Fable na 2); T-06 pick A/B/ambas 100%; T-07 sinal de limite → `account.limited` e oferta de mover; T-08 env do pane MiMo tem base URL, pane Opus não, nada global alterado; T-09 MiMo via Codex 404 some e explica; T-10 Kimi prompt só após prompt de entrada; T-11 CLI 2.1.270 + Opus 5.5 → `cli_version_too_old` com CTA; T-12 watcher bloqueado sem founder; T-13 OpenRouter ≥2 famílias + lote; T-14 chave nunca em accounts.json/log/evento/diagnóstico.

## 2.7 [LAC] e recomendação
| [LAC] | Recomendação |
|---|---|
| Como o original aplica endpoints | Adotar env por pane (Claude) + perfil/CODEX_HOME temporário (Codex); spike por adapter antes de F4; teste T-08 como gate. |
| Armazenamento de credenciais | `keytar`/`safeStorage` do Electron (Keychain/DPAPI/libsecret); nunca em JSON. `safeStorage` dispensa dependência nativa extra. |
| Kimi só CLI ou API; multi-conta Kimi/Cursor/Kiro | Assumir 1 conta e CLI-only no MVP; revisar em F5. |
| Binários e flags de bypass (Kiro, Command Code, Perplexity, Hermes, Copilot) | Lista de nomes alternativos atualizável via manifesto; `enabled=false` até testado; bypass só Claude/Codex no MVP. |
| Fontes do Watcher | Fase 2 do app: começar só com OpenRouter `/models`; fora do MVP do ADE (requer site + Supabase + Entitlement). |
| Formato de sinais de limite por CLI | `classifyOutput` heurístico por adapter com fixtures de saída real versionadas; nunca tratar como fonte de verdade: `getUsage` confirma. |
| `pick_account` considera `quota_pool` | Sim (DEC). |
| Impedir subagentes ocultos | Desabilitar por flag/config quando a CLI permitir; senão marcar capability `subagents_background` e badge de aviso no Pane; não prometer garantia. |
| Mapa dia→versão inconsistente | Ignorar: usar o registry atual como verdade. |

## 2.8 Pegadinhas técnicas
- **PATH no Electron (macOS/Linux)**: apps GUI não herdam PATH do shell; detecção falha sem resolver o login shell. No Windows wrappers `.cmd/.ps1` quebram `spawn` (Codex); usar `cross-spawn`/resolução própria.
- **Ciclo de vida do processo** (fonte recorrente de bugs): Cursor "fecha sozinho" e fica em background (detectar/matar residual); OpenCode não desativava; Codex "Sol" aparecia desligado → toggle deve encerrar e sumir do MCP. Sempre matar árvore.
- **Prompt inicial**: Kimi ignora prompt inicial e pede trust de diretório; implementar detecção de prompt pronto por regex por adapter e timeout 15 s; `trust_required` como sinal.
- **Credenciais**: Kimi perdia login ao reabrir (config dir não persistido); Codex MCP sem header; nada de segredo em log/diagnóstico (mascarar).
- **Multi-conta/ToS**: riscos de termos de uso com wrappers de assinatura; não fazer scraping de sessão de terceiros; isolar diretório por conta.
- **Memória**: ~500 MB por CLI (10 panes ≈ 5 GB); Ollama 128 GB de Mac "não roda modelo local bom" → aviso.
- **Custo de MCP**: cada provider ativo gasta cache a cada consulta do orquestrador; payloads mínimos, cache `list_*` <200 ms.
- **Compatibilidade**: CLIs mudam rápido (flags, saída); fixar versões testadas, `min_cli_version`, fixtures de `classifyOutput`; Antivírus pode sinalizar leitura de arquivos de token para `getUsage` (assinar binários).
- **Endpoint compat**: MiMo clusters não universais (SGP), DeepSeek via Codex falhou, Fireworks funcionou de primeira; `verifyAccount` deve testar chamada real (404/401).
- **Dependências cruzadas**: spec-01 (Pane/PTY/`session_ref`, herança), spec-03 (Policy/pick_account), spec-05 (hooks/skills, semáforo), spec-09 (headline/limites). O adapter `classifyOutput` e os hooks alimentam o semáforo da spec-01.

---
# PARTE 3 — Sugestão de ordem para o plano Electron (síntese)
1. Spike técnico antes de tudo: (a) PTY+xterm.js em 32/64 panes (limite de contextos WebGL, atlas compartilhado, backpressure); (b) detecção de CLIs com PATH do login shell; (c) `CLAUDE_CONFIG_DIR`/`CODEX_HOME` multi-conta.
2. Núcleo: SQLite + PtyService (main) + Workspace/Mission/Pane + grade (spec-01 F0/F1) em paralelo com registry/detect/adapters Claude+Codex (spec-04 F1).
3. Missions/worktree + MCP `pane_*` + `open_pane`/`list_*` (contrato para orquestração).
4. Overdrive só após baseline medida; manter `classic` como rollback.
5. Multi-janela, restore e SSH/tmux depois do núcleo estável; semáforo depende de hooks e `classifyOutput`.
6. Multi-conta/pick_account/limites e endpoints hosted; Watcher fica fora do MVP do app.
