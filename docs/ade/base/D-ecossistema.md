# Digest D — Módulos de ecossistema (specs 07, 08, 10, 11, 12)

Fonte: /Users/thuliobittencourt/Documents/Projetos/overclock-legendas/specs/. Selos herdados das specs: [OBS] observado, [DEC] decisão do autor da spec, [LAC] lacuna. Spec-00 não foi lida (não foi necessária). Prioridade: M = MUST (DEVE), S = SHOULD (DEVERIA), C = COULD (PODE). Nomes "Overclock" = produto original; o ADE novo é Electron, focado em software com método Expx.

Observação transversal: os 5 módulos são satélites ou extensões do ADE original. Quase todos dependem de (a) sessão/Entitlement do backend do ADE (login + plano Ultra), (b) uma API de controle do ADE (sidecar/MCP) e (c) mecanismos de permissão do SO. Nenhum é núcleo do ciclo "especificar, planejar, implementar, revisar".

---

## SPEC-07 — Overclock Voice (ditado por voz PT→EN)

### 1. Requisitos funcionais
| RF | Prio | Resumo | Aceite |
|---|---|---|---|
| 07.01 | M | Gravar enquanto a tecla está pressionada (hold) | soltar dispara STT em <200 ms |
| 07.02 | S | Modo toggle opcional, debounce 300 ms (original tinha bug: desligava em 2 s) | toggle não desliga sozinho |
| 07.03 | M | Atalho único configurável, com "teste de tecla" que valida captura real | tecla inválida não é salva |
| 07.04 | M | Modo ativo (Chat/Code/Legal) visível e alternável | botão fixo/menu |
| 07.05 | M | Chat: 1 chamada STT sem tradução (`whisper-large-v3-turbo`) | texto fiel no idioma falado |
| 07.06 | M | Code: STT `whisper-large-v3` + LLM que traduz p/ inglês, remove muletas, preserva identificadores | `config.json`, `Supabase` literais |
| 07.07 | S | Legal: reescrita em linguagem simples (leitor de 12 anos) | parcial no original |
| 07.08 | M | Injetar só ao fim do pipeline; ESC cancela em qualquer etapa | ESC: nada injetado |
| 07.09 | M | Sem duplicação ao colar; espaço entre injeções | duas falas = "A B" |
| 07.10 | M | Buffer em falha, 1 retry, erros distintos (sem rede, chave recusada, rate limit) | texto não perdido |
| 07.11 | M | Histórico (DEC: 500 entradas, local) | copiável |
| 07.12 | M | Dictionary enviado como `prompt` ao STT e glossário ao LLM | termo preservado |
| 07.13 | M | Idioma explícito (`language`) — bug de detecção gerou caracteres russos | pt/en fixos |
| 07.14 | S | ppm da última fala + teste de digitação no onboarding | — |
| 07.15 | M | Login reutilizando sessão do ADE + Entitlement (Pro/Ultra; trial 30 d da 1ª fala) | `no_entitlement` |
| 07.16 | M | Chave Groq do usuário no cofre do SO | não em JSON |
| 07.17 | M (fase 2) | Motor nuvem vs local (whisper.cpp + Qwen) | original "com bugs" |
| 07.18-21 | M/S | Ícone animado; versão + auto-update (GitHub Releases); ADE liga/muta/oculta o mic; defaults: Option direita (mac), F8 (Win/Linux) | — |

### 2. Entidades
- Settings: `hotkey{key,mode}`, `active_mode`, `language`, `engine`, `groq_key_ref` (keychain), `stt_models{chat,code}`, `llm_model`, `active_profile_id`, `mic_device_id`, `typing_test_wpm`, `auto_update`.
- HistoryEntry: `id, ts, mode, raw_text, final_text, duration_ms, wpm, target_app, status(injected|cancelled|failed), error`.
- DictionaryTerm `{term,hint}`; Profile `{id,name,mode,system_prompt,temperature}`; EntitlementCache `{plan,trial_started_at,checked_at,expires_at}` (TTL ≤24 h).
- Invariantes: `final_text` só se `injected`; áudio bruto nunca persistido; `groq_key_ref` obrigatório se cloud.

### 3. Telas/UI
Ícone de bandeja (idle, recording animado, processing, error); janela de preferências com menu lateral (Geral, Atalho, Microfone, Idioma, Modo/Perfis, Dicionário, Histórico, Conta); botão de modo fixo; onboarding de 6 passos (login por código, chave Groq grátis, atalho, microfone, idioma, dicionário + teste de digitação). Sem janela principal.

### 4. Contratos
- Eventos: `dictation_started{mode}`, `audio_captured`, `stt_done`, `refine_done`, `text_injected{chars,target_app}`, `dictation_cancelled{stage}`, `dictation_failed{stage,code}`. Códigos: `no_network, key_rejected, rate_limited, mic_denied, accessibility_denied, no_entitlement`.
- Externo: Groq `POST /openai/v1/audio/transcriptions` e `/chat/completions` (OpenAI-compatível); backend de sessão/Entitlement; GitHub Releases. Sem MCP, sem IPC com Pane (injeta por colar/teclas sintéticas no app em foco).

### 5. Algoritmos não triviais
Pipeline: tecla down (checa entitlement + mic) → PCM 16 kHz mono → tecla up (descarta <300 ms) → STT (turbo p/ chat; large-v3 p/ code/legal, pois turbo não traduz; `language` fixo; `prompt`=dicionário) → LLM (system prompt do Profile, temp 0,2) → injeção (salva clipboard → cola → restaura; fallback teclas sintéticas) → histórico/ppm. Máquina: idle→recording→transcribing→(refining)→injecting→idle; `llm_fail` após retry injeta STT bruto + aviso; erro_stt → error → idle em 3 s. Fala vazia não injeta; sem campo em foco copia ao clipboard e notifica.

### 6. Testes
Chat injeta uma vez; Code mantém identificadores; ESC cancela; sem internet = 1 retry + `no_network`; 401→`key_rejected`, 429→`rate_limited`; Pro/Ultra sem aviso de trial; duas falas sem duplicação; atalho inválido não salva; LLM fora injeta bruto + aviso; mic negado guia para permissão; mic interno desligado pelo ADE some o widget.

### 7. [LAC] e decisão recomendada
- Toggle vs hold: adotar hold default, toggle opcional.
- Modelo LLM de refino desconhecido: parametrizar (provider OpenAI-compatível; usar o provider já configurado no ADE).
- Regras de gratuidade conflitantes (datas/likes): Entitlement vindo do backend, nunca hardcoded. No ADE novo: sem trial, sem paywall no MVP.
- Prompt de refino real ausente: usar prompt-base da spec (seção 8 da spec) com saída "só texto final".
- Atalho final, nome "Legal/Leigo", estado do Linux: decidir por plataforma (Option direita/F8).

### 8. Pegadinhas técnicas
- macOS: duas permissões distintas, Microfone (TCC) e Acessibilidade/Input Monitoring (hotkey global e keystroke sintético). Em Electron, `globalShortcut` NÃO detecta key-up nem teclas modificadoras isoladas (Option direita); hold-to-talk exige hook nativo (módulo nativo tipo `uiohook-napi`/CGEventTap) ou addon próprio. Permissão de mic em dev (Electron sem assinatura) é atribuída ao Terminal; em build precisa `NSMicrophoneUsageDescription` + entitlement `com.apple.security.device.audio-input` com hardened runtime.
- Injeção via clipboard: janela de corrida com restauração; apps protegidos (senhas, secure input) e Wayland bloqueiam teclas sintéticas.
- Windows: sem assinatura = SmartScreen; hook global pode exigir elevação em apps elevados (UIPI).
- Privacidade: áudio vai a terceiro (Groq); logs sem conteúdo de fala; avisar no onboarding.
- Captura em Electron: `getUserMedia` no renderer + AudioWorklet para PCM 16 kHz; processo de captura deve ficar vivo fora da janela principal (janela oculta ou utility process).
- Para um ADE, o destino natural da injeção é o terminal/prompt do próprio app: dá para injetar via IPC direto no xterm (sem clipboard, sem Acessibilidade) — elimina 80% dos riscos.

---

## SPEC-08 — Overclock Shot (captura de tela para agentes)

### 1. Requisitos funcionais
| RF | Prio | Resumo | Aceite |
|---|---|---|---|
| 08.01 | M | Captura de região por atalho com mira (crosshair + readout de pixel) | PNG só da região |
| 08.02 | M | Salvar imediatamente em `~/Pictures/Overclock Shot/` (nunca temp) | existe após 5 min |
| 08.03 | S | Arquivos ~100–800 KB (PNG otimizado ou WebP/JPEG q≥85 se >800 KB) | — |
| 08.04 | M | Abrir editor logo após capturar (seta, caneta vermelha, texto) | — |
| 08.05 | M | Autosave de edições (~10 s), ao copiar e ao fechar | — |
| 08.06 | M | Botão Copiar: clipboard recebe caminho absoluto (texto) | Cmd+V num Pane insere o caminho |
| 08.07 | S | Arrastar miniatura para Pane cola o caminho | — |
| 08.08 | M | Gravar trecho de tela; ao parar, escolher FPS (1/2/10) e extrair frames em `moves/<ts>/` | 5 s a 2 fps = 10 frames |
| 08.09 | M | Copiar caminho da pasta de frames | — |
| 08.10 | M | Atalhos próprios XOR nativos do macOS, restaurando os nativos ao desativar | nunca ambos |
| 08.11-12 | M | Login por sessão do ADE; Entitlement Ultra | `entitlement_denied` |
| 08.13 | M | Pedir permissão de gravação de tela e guiar se negada | sem crash |
| 08.14-15 | M/S | Auto-update; tela de configurações que abre sempre | — |

### 2. Entidades
Settings `{capture_hotkey, record_hotkey, use_native_hotkeys, output_dir, default_fps, autosave_interval_s, copy_format:"path", auto_update}`; Capture `{id, kind(image|moves), path, created_at, size_bytes, annotated, fps, frame_count}`; EntitlementCache. Invariantes: path sob `output_dir`; `frame_count = ceil(duração_s × fps)`; original preservado como `*.orig.png`; app nunca apaga arquivos.

### 3. Telas/UI
Menu de bandeja (Capturar, Gravar, Abrir galeria, Configurações, Sair); overlay fullscreen com região e readout de pixel; janela de galeria/editor (seta, caneta, texto, desfazer, botão Copiar); diálogo pós-gravação com seletor de FPS.

### 4. Contratos
Eventos: `capture_started, capture_saved{path,size_bytes}, edit_autosaved, path_copied, recording_started, recording_stopped{duration_s}, frames_extracted{dir,fps,frame_count}, entitlement_denied`. Sem MCP; integração com o Pane é só por clipboard/caminho. Prompt sugerido para frames: "The folder <path> contains N frames sampled at F fps...".

### 5. Algoritmos
Fluxo captura: hotkey → overlay → seleção (região <5×5 px cancela; ESC cancela) → grava → editor → autosave → Copiar. Gravação: ScreenCaptureKit (ou `scap`) → parar → FPS → `ffmpeg -vf fps=N` → `frame_%04d.png`. Estados: idle/selecting/editing/recording/fps_dialog/extracting/blocked. Economia: 1–2 fps em vez de ~30 fps.

### 6. Testes
Região correta; arquivo persiste; seta + Copiar (clipboard = caminho, arquivo contém seta); 5 s@2fps=10 frames; 1 fps = duração em s; ESC não salva; sem Ultra bloqueia; atalhos próprios↔nativos exclusivos; permissão de tela negada guia; diretório sem escrita = erro claro.

### 7. [LAC]
Atalhos finais (DEC: captura Ctrl+Shift+4, gravação Cmd+Shift+6); "90 dias grátis" vs Ultra (Entitlement por backend); formato do arquivo/"link" (caminho absoluto); release Windows/Linux; Swift vs Tauri (irrelevante no Electron).

### 8. Pegadinhas técnicas
- macOS: permissão "Screen Recording" (TCC) exige relançar o app após conceder; em Electron, `desktopCapturer` + `getDisplayMedia` (macOS 13+ usa ScreenCaptureKit). Sem API pública para "região" nativa: overlay é uma BrowserWindow transparente, fullscreen, `alwaysOnTop: 'screen-saver'`, por monitor, com scale factor (Retina) e multi-display; o bug de "overlay invisível" (dia 63) é típico de janela transparente sem `hasShadow:false`/Spaces. Captura do próprio overlay deve ser evitada (capturar ANTES de mostrar ou excluir a janela).
- Substituir atalhos nativos do macOS (Cmd+Shift+4) exige desativar via `defaults` do sistema — frágil e invasivo; melhor nunca tocar nos nativos e usar atalho próprio.
- Windows: DPI scaling por monitor; gravação via `desktopCapturer` + MediaRecorder (WebM) e ffmpeg embutido (licença/tamanho do binário, ~70 MB; usar `ffmpeg-static`).
- Clipboard só-texto: caminho absoluto funciona porque agentes CLI leem arquivo local; dentro de um ADE, dá para pular o clipboard e anexar a imagem direto ao Pane (melhor UX).
- Privacidade: capturas podem conter segredos; manter local, sem upload.

---

## SPEC-10 — Overclock Bot (controle remoto, Arms, relay, VPS 24h, voz)

### 1. Requisitos funcionais (agrupados)
| RF | Prio | Resumo | Aceite |
|---|---|---|---|
| 10.01-08 | M/S | Wizard: nome → servidor → piloto → repositórios; persona configurável; múltiplos bots; bot padrão "cloquinho"; tarefas de estreia | wizard só finaliza com 4 passos válidos |
| 10.02 | M | Servidor ≥2 GB RAM, IP, credencial SSH | <2 GB rejeitado |
| 10.10-19c | M | Instalação por SSH idempotente (usuário `overclock`, chave SSH, Node 22, swap 2 GB, tmux, display virtual, CLIs, serviços systemd); login de CLI verificado por PROVA ATIVA (comando real); credenciais só no host; regenerar senha recusada; Linux sem auto-update (reinstalar/"conferir instalação") | rodar 2x = mesmo estado |
| 10.20-28 | M | Arms = servidor MCP interno (~54 tools) falando com o sidecar; UI só observa; "braço antes do mouse"; allowlist pré-aprovada (destrutivas fora); zero diálogos; heartbeat ≤10 s com restart; paridade tela/braço; `headline_pick_account` antes de abrir Pane | Pane aparece na UI após `pane_spawn` |
| 10.30-32 | M | NUNCA escrever em main (hook no host); destrutivas pedem confirmação; `ArmsCallLog` | push a main bloqueado |
| 10.40-47 | M/S | Código de pareamento uso único/TTL 5 min (`relay_url`, `channel_id`, `secret`); host mantém conexão de SAÍDA ao relay (nenhuma porta aberta); E2E com o secret (relay não lê conteúdo); listar/revogar dispositivos (≤5 s); Tailscale opcional; app iOS nativo | segundo uso do código = `pair_expired` |
| 10.50-56 | M/S | Chat curto; comandos por chat (fechar pane, criar missão) em ≤5 s; cloquinho responde perguntas de orquestradores e registra Decision; memória retomável; bridge de voz realtime (voz só repassa ao piloto via `ask_pilot`); push-to-talk/barge-in [LAC] | "fecha o painel" fecha |
| 10.60-61 | M | Entitlement `bot_access` (Ultra); sem ele, tela de upgrade e sem código | — |

### 2. Entidades
- Bot `{bot_id, name, is_primary, pilot_provider(claude_code|codex|kimi|grok|antigravity|cursor|gemini), pilot_model, persona, allowed_repos[], host_id, status(installing|online|degraded|offline)}`.
- Host `{host_id, kind(vps|desktop), address, ssh_user, ssh_auth, provider_hint, os, cpu, ram_mb, disk_free_mb, swap_mb, node_version, overclock_version, display_ready, arms_status, installed_clis[{provider,installed,logged_in,verified_at}]}`.
- PairingCode `{code, relay_url, channel_id, secret_b32, expires_at, used, bot_id}`; PairedDevice `{device_id, bot_id, name, platform, channel_id, paired_at, last_seen, revoked_at}`.
- ArmsCallLog `{id, ts, bot_id, tool, args_digest, result(ok|error|denied), error_code, duration_ms}` (30 d); Allowlist `{bot_id, tool, decision(allow|confirm|deny)}`; BotMessage; VoiceSession `{model, tokens_in, tokens_out}`.
- Armazenamento: SQLite `~/.overclock/bot/bot.db` + cofre 0600 no host; relay só em memória; celular no Keychain iOS.

### 3. Telas/UI
Wizard de 5 etapas (a última "Preparando" com passos e retry por passo); painel "mãe" (conversa, bots, Panes/Missions); chat com barra de voz e botões (tela ao vivo, assumir controle, conferir instalação, editar/adicionar bot); pareamento (host mostra código + QR; app digita código); dispositivos pareados com revogar; estados instalando/online/degradado/offline/sem entitlement.

### 4. Contratos
- Relay: `WS /v1/host/{channel_id}` e `WS /v1/client/{channel_id}`; prova `X-Channel-Proof = HMAC(secret, nonce)`; relay repassa frames opacos, encerra se host ausente 30 s; 1 cliente ativo por canal.
- Envelope `{v:1,type,id,ts,body}`; tipos: `chat.send{text,channel}`, `chat.delta{msg_id,text_chunk,done}`, `state.snapshot{bot,panes[],missions[],host}`, `state.event(pane.opened|pane.closed|mission.created|arms.status|install.progress)`, `control.action`, `confirm.request/reply`, `screen.subscribe/frame` [LAC], `voice.audio.in|out` (PCM 24 kHz base64), `pair.revoke`. Erros: `unauthorized|host_offline|rate_limited|entitlement_missing|invalid_frame`.
- Arms MCP (snake_case, saída `{ok,data,error{code,message}}`): mínimo MVP por categoria — Workspace (`workspace_list/create/switch`), Pane (`pane_spawn/close/list/send_text/read_output/focus`), Session (`session_list/attach/kill[confirm]`), Mission (`mission_create/list/status`, `task_list`), Squad (`squad_list/run`, `agent_list`), Provider (`provider_list`, `headline_pick_account`), Git (`repo_clone`, `pr_open`, `branch_create`; NUNCA `push_main`), Sistema (`screen_snapshot`, `health_check`, `allowlist_list`, `arms_version`), Memória (`memory_save/search`). Erros de tool: `workspace_not_found, provider_not_logged_in, denied_by_policy, sidecar_unavailable`.
- CLI: `overclock bot install|pair|devices|revoke|status`.

### 5. Algoritmos
- Instalação idempotente de 9 passos com evento `install.progress` (validar SSH com backoff → hardware → usuário/chave → Node/swap/display/tmux → Overclock → CLIs + login com prova ativa → sidecar + Arms + health-check → Bot/persona/allowlist → `online`).
- Máquina do host: installing→online (health_ok); online→degraded (arms_down); degraded→offline após 3 restarts falhos; offline se relay heartbeat perdido 60 s (heartbeat 15 s).
- Pareamento: `secret` 32 B, `channel_id` 16 B; handshake PAKE/Noise PSK autenticado pelo secret; 5 tentativas erradas/10 min bloqueiam; reconexão com par de chaves persistido.
- Voz: modelo realtime só tem `ask_pilot(text)`; fila FIFO (1 pedido por vez ao piloto); se >20 s, voz avisa "ainda trabalhando".
- Regras do cloquinho: responde sozinho se cabe na persona/repo; pergunta ao dono se envolver custo, deploy, dado externo ou destrutivo; nunca afirma sucesso sem prova.

### 6. Testes
Wizard feliz (4 GB, chave válida → "Tô online…"); 1 GB recusado; instalação idempotente; "login falso" (credencial expirada → `logged_in=false`); `pane_spawn` sem prompt de permissão; Arms morto → `degraded` ≤10 s + restart; push a main bloqueado; pareamento (sem porta aberta, segunda tentativa `pair_expired`); revogação ≤5 s; "fecha o pane 33" (confirma se houver trabalho); voz repassa "quanto é 1+1" sem executar; sem entitlement = upgrade; repo sem remote informa ausência de PR.

### 7. [LAC] e decisão
- Criptografia/hospedagem do relay: E2E por PSK (Noise) + relay sem estado; hospedar em Cloudflare Workers/Durable Objects. Só entra se houver app móvel.
- Lista nominal das ~54 tools Arms: definir a partir do sidecar real do ADE novo; começar com ~20.
- Paridade tela/braço e transporte de tela ao vivo no celular: MVP só desktop (VNC via túnel SSH).
- Quem paga a API Realtime: fora do MVP.
- Números conflitantes (RAM 3,8 vs 4 GB, preços): irrelevantes para o ADE novo.

### 8. Pegadinhas técnicas
- Segurança do relay: código de pareamento carrega o `secret`; entropia baixa + TTL longo = brute force; relay DEVE ser cego (frames opacos) e com rate limit; revogação precisa derrubar o canal no relay; MITM no handshake se o código for lido por voz/exibido em demo (incidente real: IP/senha expostos ao vivo).
- Arms é superfície de execução remota de código: allowlist + `ArmsCallLog` + confirmação de destrutivas + hook que impede push em main; o piloto é um LLM (prompt injection via conteúdo de repositório/issue pode disparar tools); nunca deixar `exec` livre.
- Login de CLIs "sem diálogo" é frágil (OAuth de navegador em host headless); verificação ativa obrigatória.
- Display virtual (Xvfb + x11vnc) sem autenticação exposto = RCE visual; só via túnel SSH.
- Sem porta de entrada: conexão de saída do host; firewall deny-all inbound; SSH só chave.
- iOS: app nativo, Apple Developer Program, TestFlight, privacidade de voz no questionário; build CI ~R$500/mês.
- Escopo enorme: VPS provisioning + relay + app iOS + voz são quatro produtos em um.

---

## SPEC-11 — Jarvis / Open Jarvis BR (assistente de voz + cliente MCP)

### 1. Requisitos funcionais (grupos)
| RF | Prio | Resumo | Aceite |
|---|---|---|---|
| 11.1.01-02 | M | Captura PCM mono; saída na config nativa do dispositivo (não forçar 4 canais); reamostrar 24 kHz | sem chunks perdidos em 5 min |
| 11.1.03 | M | Anti-eco: mic gated enquanto fala; barge-in só por VAD acima do limiar | 10 respostas sem autointerrupção |
| 11.1.04 | M | Sessão sob demanda (wake/hotkey/clique); fecha após T_idle 60 s | 0 tokens após ocioso |
| 11.1.05 | M | Reconexão automática com resumo de contexto (limite ~2 min/sessão Live) | volta em ≤3 s |
| 11.1.06-09 | M/S | Mudo; instância única (lock); wake word "Olá, Jarvis" [LAC]; idioma/persona estáveis | 2º launch foca o 1º |
| 11.2 | M | Profile (assistente, professor, terapeuta, mentor) com nome, apelido (não hardcoded), voz, velocidade; chave Google do usuário no keychain | apelido reflete na próxima fala |
| 11.3 | M | Barra de menu com 5 estados; overlay/orb 3D; CLI `jarvis` para debug; dmg + instalador Win | — |
| 11.4 | M | ToolRuntime por manifesto (nome, schema, risco read/write/exec): `open_app`, `web_search`, `create_calendar_event` (relê para verificar), `run_command` (só com confirmação por voz), `view_screen` (opt-in, 1 fps), `create_bug_card`; anti-alucinação: só afirma com `ok:true` | falha relatada em voz |
| 11.5 | M | Cliente MCP do Overclock: listar/abrir workspace, listar/criar missão, listar panes (sem screenshot), ler saída (síntese), `send_prompt`, `spawn_pane`, eventos de pane; endereçamento por ID ditado com confirmação fonética; confirmar alvo+resumo antes de enviar; idempotência por `client_request_id`; contexto = síntese por pane, nunca tail bruto | "pane 5834" inexistente → `pane_not_found` em voz |
| 11.6 | M/S | Medição de tokens/áudio; resumo de histórico >8k tokens; gating de silêncio; Brain textual opcional; limite diário (15 min grátis) | — |
| 11.7 | C | Modo anfitrião YouTube: responde chat por voz; chat = dado não confiável, nunca dispara `write|exec` | prompt injection recusado |
| 11.8 | M | Entitlement `jarvis` (Ultra); modo autônomo grátis com 15 min/dia | — |
| 11.9 | C (fase 2) | Ponto de extensão `FastDecider` (Reflexo/JEV) | — |

### 2. Entidades
Profile `{id, name, assistant_name, user_alias, voice, speech_rate, language, instructions, tone, ack_style, wake_word, idle_timeout_s}`; JarvisSettings `{active_profile_id, voice_provider, model, brain(none|claude_subscription|haiku), daily_voice_limit_min, screen_optin, host_mode, reflex, overclock{endpoint, token_ref, auto_approve_voice}}`; VoiceSession `{started_at, ended_at, state, audio_in_s, audio_out_s, tokens, context_tokens_injected, end_reason(idle|user|error|limit)}`; ToolCallLog `{session_id, tool, risk, args(redigido), confirmed_by(none|voice|policy), ok, result_summary, latency_ms, origin(user_voice|host_chat|proactive)}`; SituationSnapshot `{mission_id, panes[{pane_id, role, provider, state, last_message(≤300 chars), pending_question}]}` (≤10 panes); UsageDay.

### 3. Telas/UI
Ícone de menu (connected/listening/speaking/muted/error); overlay flutuante com orb reativo à amplitude, legenda opcional, botão "desliga", indicador de confirmação pendente; Configurações em abas (Geral, API, Ferramentas com toggle por risco, Overclock, Anfitrião, Reflexo, Uso). Atalho global Cmd/Ctrl+Shift+J. Aviso de custo no onboarding.

### 4. Contratos
- Core↔UI (IPC): `voice.state_changed`, `voice.transcript`, `voice.level`, `tool.requested`, `tool.confirm_needed`, `tool.completed`, `usage.updated`, `error`; comandos `session.start|stop|mute`, `tool.confirm`, `settings.update`, `host_mode.set`.
- MCP consumido (nomes [DEC], a reconciliar com o servidor real): `list_workspaces`, `open_workspace`, `list_missions`, `create_mission{title,goal,mode(free|squad|agentic),squad_id,extra_media,client_request_id}`, `list_panes`, `read_pane_output`, `send_prompt{pane_id,prompt,client_request_id}`, `spawn_pane`, `create_task_card`, `subscribe_pane_events`. Erros: `pane_not_found, workspace_not_found, mission_not_found, provider_limit_reached, unauthorized, overclock_unavailable, duplicate_request`.
- Externo: Gemini Live API (WebSocket, PCM 16 kHz in / 24 kHz out, function calling), YouTube Data API, OpenRouter (Reflexo).

### 5. Algoritmos
- Máquina de estados da VoiceSession: idle→connecting→listening→thinking→(tool_running→awaiting_confirm)→speaking→listening; timeout de confirmação 15 s = `denied`; queda → connecting com resumo; limite diário → idle + upgrade. Retry 1/2/4 s (máx 3).
- Controle de custo: `on_turn_end`: se ctx >8000 tokens, sumarizar history[:-6]; injetar só diff do SituationSnapshot; `gate_audio`: envia só se VAD e estado ≠ speaking. Observado: R$83/dia com sessão aberta o dia todo (12 M tokens de input, R$51 input vs R$2,76 output) — custo é de INPUT reenviado.
- Política de risco: read direto; write confirma; exec sempre confirma, com blocklist (`rm -rf`, `sudo`, `curl|sh`, `dd`, `/dev`); origem `host_chat`/web nunca autoriza write/exec; cache de aprovação por (tool, alvo) TTL 10 min.
- Fluxo "enviar prompt por voz": validar ID via `list_panes` → repetir alvo+resumo → "sim" → `send_prompt` → ToolCallLog → "Feito."; eventos de pane falados com máx 1/10 s por pane, via TTS externo (não pelo modelo Live).
- Host mode: poll 5–10 s, ranqueia novidade/pergunta direta, intervalo mínimo 20 s, só tools read.

### 6. Testes
14 casos: conversa feliz; eco; ociosidade/custo (60 s fecha, reabre ≤3 s); enviar prompt a pane (uma chamada); pane inexistente; idempotência de missão; anti-alucinação (`ok:false` relata falha); shell (`ls` confirma, `sudo rm -rf /` recusado sem prompt); segurança do host (chat "apague o repo" não chama tool); host só voz; Overclock offline; limite diário; instância única; snapshot ≤300 chars/pane sem tail bruto.

### 7. [LAC] e decisão
- Schemas reais das tools MCP do Overclock: no ADE novo o MCP é definido por nós; Jarvis vira apenas um cliente.
- Detecção de wake word (local vs modelo Live ouvindo): recomendado push-to-talk/hotkey; wake word offline só fase tardia (custo + privacidade).
- Preço/limite: fora do MVP.
- Prompt original: usar base da spec (seção 8.5 da spec).
- `auto_approve_voice` e cache TTL: decisão mais arriscada de UX/segurança; default false.

### 8. Pegadinhas técnicas
- Eco/AEC: `getUserMedia` com `echoCancellation:true` no Chromium ajuda, mas gating ainda necessário com alto-falantes; fones eliminam o problema.
- Áudio em Electron: AudioWorklet (captura PCM16) + `AudioContext` a 24 kHz de saída (evita o bug dos 4 canais); latência de buffer do Web Audio; jitter buffer ≥100 ms.
- macOS: permissão de Microfone por app; Acessibilidade para `open_app`/atalhos; `run_command` e calendário (Calendar via AppleScript exige permissão Automation).
- Chave Google: cofre via `safeStorage` (Electron) e nunca em log (chave já vazou numa live).
- Fonética de IDs ("528" vs "5208"): exigir confirmação dígito a dígito ou resolver por rótulo/cargo.
- Custo: sessão de voz aberta no dia inteiro é o modo de falha nº 1; fechar por ociosidade é requisito, não otimização.
- Prompt injection: texto de pane/Web/chat é dado; ação write/exec exige origem `user_voice`.
- Limite de duração de sessão do provedor (~2 min de áudio no Flash Live): reconexão com resumo é obrigatória.
- Dependência direta do MCP do ADE: sem ele, Jarvis é só um assistente genérico concorrente.

---

## SPEC-12 — Overclick (board de cards + Zero + Overrunner)

### 1. Requisitos funcionais (grupos)
| RF | Prio | Resumo | Aceite |
|---|---|---|---|
| 12.1.01-07 | M/S | Hierarquia Workspace→Project→Mission→Card; kanban + lista responsiva (uma linha por item no mobile); filtros; barra de progresso de missão (verde=concluído, azul=validado); subtasks; `depends_on`; chave `KEY-nnn` sequencial imutável | criar card sem project = erro |
| 12.2.01-05 | M | Card como contrato: `what`, `why`, `how_to_confirm` obrigatórios para sair de backlog; papéis `created_by`/`executor`/`return_to`; `origin` solo/team; execução por ponteiro; `harness_at_creation` e `harness_used` | `contract_incomplete` |
| 12.3.01-06 | M | `task_claim` atômico; aviso de colisão por `files_hint`/branch; `branch_register` (board não fala com Git); `handoff_submit` → review com sumário, evidência, custo, `resolved_in`; humano move review→done→validated ou devolve | `already_claimed` |
| 12.4.01-06 | M/S | Policy por projeto (tipo → fila de executor/modelo/esforço); recomendação só entre executores declarados; executor desativado rejeitado com fallback; níveis 1–4 | `no_executor` |
| 12.5.01-06 | M | Custo por card/missão; Insights; preço ausente = `null` + alerta (nunca 0); custo por janela [claim, handoff] da Session; zero telemetria ao autor | "≥" na missão com null |
| 12.6.01-07 | M | Servidor MCP HTTP remoto (URL + token); wizard de 3 passos; card exemplo "valide seu setup"; tokens `admin|agent|worker`, revogação ≤5 s | "aguardando 1ª conexão" |
| 12.7.01-07 | M/S | `context_md` por projeto; `task_search`; `resolved_in`; comentário tipado; board genérico (sem lógica do Zero) | `project_list` sem contexto |
| 12.8.01-05 | S | Plugin = skill + MCP + hooks; hooks associam Pane à Session; `session_start` sugere pegar task (nunca claim automático); nomes de tool completos | — |
| 12.9.01-05 | M (cloud) | Entitlement `overclick_cloud` (Ultra); só modo agêntico acessa; self-host sem entitlement | — |
| 12.10.01-07 | C | Zero (bot Discord): investigação conversacional, dedup por `task_search`, prompt de diagnóstico sem credenciais, cadência 10 min/1 h/24 h/72 h | — |
| 12.11.01-04 | C (fase 2) | Overrunner: runner headless que pega card `auto_fix`, worktree, testes verdes, PR | não provado no original |

### 2. Entidades
- Workspace, Member `{role: admin|member, locale}`; Project `{key ^[A-Z]{2,5}$ imutável, repo_url, context_md, policy_id, next_seq, archived}`; Mission `{project_ids[], period, status}`.
- Card `{project_id, mission_id, parent_id, seq, key, title, type(feature|adjust|contract|refactor|bug|deep_bug|ship|question|improvement), what, why, how_to_confirm, column, origin, created_by, return_to, executor_planned{provider,model,effort}, executor_actual, decision_id, claimed_by, claimed_at, branch, depends_on[], files_hint[], resolved_in, reported_by, source{kind,ref}, reported_version, cost{tokens_in,tokens_out,usd,seconds}, auto_fix, discard_reason}`.
- Comment `{kind: note|zero_report|diagnostic|review|system}`; Policy `{level, declared_executors[], rules{type→[executor]}, on_unavailable}`; Decision `{candidates, chosen, reason}`; UsageRecord `{session_id, model, tokens, usd|null, price_missing}`; Token `{scope, hash, last_used_at, revoked_at}` (só hash); CardSession `{card_id, session_id, pane_id}`; Entitlement cloud.
- Colunas: `backlog→todo→in_progress→review→done→validated` + `discarded`. Invariantes: `claimed_by` ≠ null sse `in_progress`; `parent_id` sem ciclo; nunca apagar fisicamente (só admin sem UsageRecord).

### 3. Telas/UI
Wizard 3 passos; Board kanban (estilo "glass", custo no canto superior direito); Lista responsiva; Card (detalhe + "Harness sugerido"); Missões (progresso verde/azul, objetivo); Insights (gasto por modelo/projeto/maiores cards); Settings (Policy, preço por modelo, tokens MCP, idioma); Equipe (fase 2). Estados vazio, erro de conexão MCP, executor indisponível (badge vermelho + fallback), card bloqueado por claim. Atalhos sugeridos: `c`, `/`, `f`.

### 4. Contratos
- MCP HTTP `Authorization: Bearer`, servidor `overclick`; workspace vem do token; listas leves (`limit≤50`, `cursor`) vs `*_get` completo (poupa tokens). Tier A (14, MVP): `project_list, project_get, mission_list, mission_get, task_list, task_search, task_get, task_create, task_claim, task_update, handoff_submit, branch_register, harness_list, harness_recommend`. Tier B (+7): `project_create/update/delete, mission_create, task_delete, harness_set, comment_add`. Tier C (+8, fase 2): `mission_update, comment_list, task_release, project_context_set, task_next, cost_report, webhook_register, task_link`.
- Erros: `unauthorized, forbidden_scope, not_found, validation_failed, rate_limited, contract_incomplete, already_claimed, invalid_transition, not_claimed_by_caller, executor_unavailable, no_executor`; `collision_warning` é campo `warnings`, não erro.
- REST interno (DEC): `/api/projects|missions|cards`, `POST /api/cards/:id/claim|release|handoff`, `PUT /api/projects/:id/policy`, `POST /api/harness/recommend`, `/api/insights`, `/api/tokens`, `POST /api/usage`; SSE `/api/events` (`card.created|moved|claimed|handoff|validated|discarded`, `comment.added`, `mission.progress`); webhook `X-Overclick-Signature: sha256=HMAC`.
- Hooks → board: `{event: pre_tool|post_tool|session_start|stop|subagent|session_end, session_id, pane_id, cwd, tokens?, model?}`.
- Stack original: pnpm monorepo, Next.js, Docker Compose (`web` + `db`), MCP remoto.

### 5. Algoritmos
- Claim atômico: `UPDATE ... WHERE claimed_by IS NULL`.
- Criação com harness: valida contrato → `harness_recommend(type)` filtra Policy por executores declarados/ativos → grava Decision + `executor_planned`.
- Custo: por janela [claimed_at, agora] da Session do card; preço da tabela `model_price`; ausente → `usd=null`; soma de missão exibe "≥".
- Execução paralela: independentes em Panes com branch própria, dependentes após `handoff_submit` de `depends_on`; `files_hint` cruzado gera warning.
- Zero: `project_get.context_md` como system prompt → investigar → `task_search` → julga duplicata → se `resolved_in` ≥ versão do usuário, orientar atualização sem card; se duplicata aberta, `comment_add(zero_report)`; se nova, `task_create(bug)`.
- Cadência (estados `interviewing→waiting_user→nudge_10m→nudge_1h→nudge_24h→partial_closed`, timers em relógio absoluto, sessão persistida; `/start` nunca reinicia).
- Overrunner: `task_next(auto_fix)` → claim → `git worktree add` → executor pela Policy → testes → PR ou (2 falhas) `comment_add(system)` + `task_release`; sem merge automático.

### 6. Testes
13 casos: wizard/primeira conexão; contrato incompleto; claim concorrente (um vence); handoff por outro caller (`not_claimed_by_caller`); harness respeita executor desativado/`no_executor`; custo null e descartado preservado; custo por janela em terminal compartilhado; escopo de token worker vs `project_delete` e revogação ≤5 s; dedup do Zero por `resolved_in`; cadência com retomada às 30 h; cloud sem entitlement bloqueia; contexto só em `project_get`; Overrunner com 2 falhas libera sem PR.

### 7. [LAC] e decisão
- Nº de tools (10/20/29): adotar Tier A/B/C.
- Níveis de harness 1–3 e colunas/tipos: adotar defaults da spec (1 fixo, 2 por provider, 3 por tipo, 4 por tipo + conta).
- SGBD: SQLite embutido (ADE desktop), sem Postgres.
- Licença/repo público, critério de "investigação concluída" do Zero, intervalos de cadência, LGPD de Discord: fora do ADE.
- "Volta" do Overrunner e relação com o Bot: adiado.

### 8. Pegadinhas técnicas
- Dois "Workspace" com significados distintos (board vs painéis do ADE); usar nomes separados no ADE novo.
- Tokens MCP: só hash, escopo mínimo, revogação rápida (já vazou ao vivo); no desktop, servidor MCP em loopback + token em arquivo 0600.
- Overrunner executa código de relato não confiável (prompt injection em bug report): sandbox/VPS isolada + revisão humana.
- Custo zerado enganoso (modelos sem preço); custo duplicado em terminal compartilhado; métrica sem janela correta é pior do que sem métrica.
- Sanitizar Markdown (XSS) em `context_md`/comentários (renderer Electron com `nodeIntegration` off, CSP).
- Claim atômico em SQLite: usar transação `BEGIN IMMEDIATE`.
- CLIs precisam recarregar tools após instalar MCP (`/resume` ou reabrir); wizard deve avisar.
- Acoplar cloud ao open source cria divergência; desktop-only evita o problema.

---

## RECOMENDAÇÃO — o que vira fase pós-MVP num ADE Expx

Critério: aderência ao ciclo de desenvolvimento de software com método Expx (prodx→stackx→sprintx→runx→mergex), custo/risco de construção em Electron, dependências e superfície de segurança.

| Módulo | Decisão | Justificativa curta |
|---|---|---|
| **Spec-12 Overclick (board + MCP, SEM Zero/Overrunner)** | **Pós-MVP, fase P1 (prioritária)** | É o único que encaixa diretamente no método: card-contrato (`what/why/how_to_confirm`) = tasks do sprintx/runx; claim/handoff/custo por card = rastreabilidade de execução; Policy de harness já é núcleo de outra spec. Reescrever como módulo INTERNO do ADE (SQLite + MCP loopback, Tier A de 14 tools), sem Next.js/Docker/cloud/entitlement. Risco baixo, valor alto. |
| **Spec-11 Jarvis (somente cliente MCP + voz básica)** | **Pós-MVP, fase P3, recorte mínimo** | Só vale o núcleo: voz → `send_prompt`/`create_mission` com confirmação, anti-eco, sessão sob demanda, gating de risco. Cortar host mode, Reflexo, tools locais (calendário, shell, open_app), wake word, brain. Depende do MCP do ADE estar estável (P1/P2). Custo de voz e segurança (prompt injection) exigem cuidado; diferenciação baixa para um ADE. |
| **Spec-07 Voice (ditado)** | **Pós-MVP, fase P2, barato e útil** | Ganho de produtividade real (ditar prompts) e custo de construção moderado. No Electron: hold-to-talk dentro do app injetando direto no terminal/prompt (sem clipboard/Acessibilidade), STT via provider configurável, dicionário técnico. Cortar trial/entitlement, modo Legal, STT local, satélite de bandeja, Linux. Entregar só Chat + Code (PT→EN) dentro do ADE. |
| **Spec-08 Shot (captura + frames)** | **Pós-MVP, fase P2, recorte mínimo** | Útil para depuração visual (screenshot anotado colado no prompt do agente, frames de gravação a 1–2 fps). Atenção às permissões de tela e ao overlay multi-monitor. Implementar captura de região + anotação simples + "anexar ao Pane"; gravação com frames só depois. Cortar troca de atalhos nativos do macOS. Pode usar `desktopCapturer`. |
| **Spec-10 Bot (VPS + relay + iOS + Arms)** | **Adiar/cortar do plano; aproveitar só o conceito de Arms** | Quatro produtos em um (provisionamento de VPS, relay seguro, app iOS, voz realtime), alta superfície de segurança (execução remota, pareamento, E2E), status "parcial" no original, e custo de manutenção alto. O que vale: a doutrina Arms (API de controle do ADE exposta como MCP, allowlist, log, regra "nunca main", heartbeat) — isso deve nascer no núcleo/P1 porque Overclick, Jarvis e qualquer agente dependem dele. Relay/iOS/VPS: pós-v1, só com demanda comprovada de "vibe coding remoto". |
| **Zero e Overrunner (dentro da spec-12)** | **Cortar** | Zero é produto de comunidade/Discord (suporte), fora do escopo de um ADE; Overrunner nunca foi provado ponta a ponta e executa código de entrada não confiável. Se um dia houver, é o fluxo runx (bug → card → PR) com sandbox. |

Ordem sugerida: P0 (núcleo, não opcional) API de controle + MCP interno tipo Arms mínimo (allowlist, log, confirmação) → P1 Overclick interno → P2 Voice (dentro do app) e Shot (captura+anexo) → P3 Jarvis recortado (voz → MCP) → Bot remoto só se sobrar demanda.

Decisões transversais recomendadas: (1) nenhum Entitlement/plano/trial no MVP (remover toda lógica de Ultra/Pro das specs); (2) permissões do SO (mic, tela, acessibilidade) centralizadas em uma única tela de "Permissões" com diagnóstico e atalho para Ajustes; (3) todo segredo (chaves Groq/Google/OpenAI, tokens MCP) no `safeStorage`/keychain, nunca em JSON; (4) toda ação write/exec originada de voz ou de texto externo passa por confirmação e log; (5) custo e telemetria só onde há preço cadastrado, nunca 0 silencioso.
