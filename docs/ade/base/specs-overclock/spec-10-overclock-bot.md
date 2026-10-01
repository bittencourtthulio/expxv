---
spec: "Overclock Bot — controle remoto, cloquinho, Arms, voz e Overclock em VPS 24h"
slug: "spec-10-overclock-bot"
modulo_fonte: ["10-overclock-bot"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-02-orquestracao-modo-agentico", "spec-03-harness-roteamento-decisor", "spec-04-providers-e-modelos", "spec-05-catalogo-skills-mcp-hooks", "spec-06-over-memory", "spec-09-overclock-headline"]
---
# Spec 10 — Overclock Bot

Legenda dos selos: [OBS] observado (fonte entre parênteses: módulo 10 + dia/arquivo); [DEC] decisão do autor da spec; [LAC] lacuna que exige decisão do dono do produto. Sem selo = definição estrutural derivada dos itens selados da mesma seção.

## 1. Resumo e objetivo

O Overclock Bot é o controle remoto e a "camada de assistente" do Overclock: um bot com interface de chat (app iPhone e desktop) que opera o Overclock como um assistente sentado diante do computador. O bot principal, o **cloquinho**, é um orquestrador com personalidade configurável, cujo "piloto" (o modelo que raciocina) é uma CLI de IA escolhida pelo usuário (padrão Claude Code). Ele controla Panes, Missions e outros bots/CLIs (Codex, Kimi, Grok, Antigravity) por um plugin MCP interno, o **Arms** (~54 tools), que fala com o sidecar do Overclock em vez de usar screenshot e clique. O Overclock pode rodar 24h numa VPS Linux barata, e o celular se pareia com essa instalação via um **relay** sem abrir portas. Uma **bridge de voz** liga um modelo realtime à conversa com o cloquinho. [OBS: mod. 10 Objetivo, Visão geral; Dias 67-71]

Problema resolvido: o "Grok Bot" da xAI exige a CLI do Grok e custa cerca de US$ 300/mês; o Overclock Bot entrega o equivalente sobre qualquer CLI, ao custo da VPS do próprio usuário (R$ 30-52/mês), e tira o vibe coding do computador pessoal. [OBS: mod. 10 Objetivo; Dia 70, arq. 21]

## 2. Escopo e não-escopo

Cobre (MVP e fase 1):
- Bot (entidade), wizard de criação, piloto com personalidade, memória do cloquinho.
- Arms (MCP interno), doutrina "braço antes do mouse", allowlist do piloto, paridade tela/braço.
- Provisionamento de VPS Linux e instalação de Overclock + CLIs, sessões persistentes, tela ao vivo, "assumir controle".
- Pareamento por código + relay + app móvel (cliente), chat texto e voz, bridge realtime.
- Segurança do pareamento e das credenciais; regra "nunca escreve em main".
- Entitlement de acesso (plano máximo).

Não cobre (remetido a outras specs): política de harness e decisor ([[spec-03-harness-roteamento-decisor]]); orquestração de squads ([[spec-02-orquestracao-modo-agentico]]); modelo de Pane/Workspace ([[spec-01-terminais-paineis-workspaces]]); Overclick/Zero/Overrunner (tickets, runner); Jarvis; planos e preços ([[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements)); notarização/builds ([[spec-00-visao-arquitetura-e-glossario]] §7 (requisitos transversais: build, assinatura, segurança)).

Fase 2 / só intenção no original (NÃO implementar no MVP):
- F2-1 Open source do cloquinho/bot condicionado a likes (300/500) [OBS: só promessa, Dia 70; não confirmado que ocorreu]. Trata-se de decisão de marketing, sem requisito técnico além de manter o repositório do bot separável [DEC].
- F2-2 Aprovação na App Store e distribuição pública iOS [OBS: em publicação, Dia 72-73; aprovação não confirmada]. MVP usa TestFlight interno/instalação via Xcode [DEC].
- F2-3 Lançamento no evento presencial (30/10 a 01/11, SP) [OBS: Dia 78]. Não afeta a spec.
- F2-4 "VM de 16 GB por usuário" hospedada pelo produto (modelo do Grok Bot) [OBS: só citada, Dia 73]. MVP: o usuário traz a própria VPS [DEC].
- F2-5 Bot de chat da live (YouTube + ElevenLabs): app interno do apresentador, "não será vendido" [OBS: Dia 71]. Fora de escopo.
- F2-6 Cliente Android, Windows como host, atualização automática no Linux [LAC].
- F2-7 Rotinas agendadas ("todo dia tal horário") e "Antigravity chicotear painéis": aparecem como botão/pedido sem desenho [OBS: Dias 70-71]; entram na fase 3 deste plano.
- F2-8 Skins do bot (vermelha, clara, cinza) e variação de cor do mascote por CLI [OBS: Dias 67-73]: cosmético.

## 3. Glossário e atores

- **Usuário (dono)**: assina o plano máximo, controla pelo app.
- **Cloquinho**: bot principal/orquestrador padrão. "Sou o clock orquestrador do seu overclock. Abro missões, panes, acompanho, te respondo curto." [OBS: Dia 70]
- **Bot**: instância de piloto com personalidade (nome, tom, o que sabe do dono, regras da casa) [OBS: Dia 70].
- **Worker**: CLI/bot controlado pelo cloquinho (Claude Code, Codex, Kimi, Grok, Antigravity) [OBS].
- **Piloto (pilot)**: o modelo/CLI que responde no chat do bot e chama as tools Arms.
- **Arms**: plugin MCP interno com ~54 tools; fala com o **sidecar** do Overclock (mesmo ator que desenha a UI) [OBS: Dia 69].
- **Host**: máquina onde o Overclock e o daemon do bot rodam (VPS ou desktop).
- **Relay**: serviço de rendezvous na nuvem que junta host e app móvel.
- **Bridge de voz**: componente que conecta um modelo realtime (OpenAI Realtime) ao piloto.
- **Tela ao vivo**: visão do display virtual do host; **assumir controle**: o usuário interage com a UI do host como se fosse local [OBS].
- Entidades canônicas usadas: Workspace, Pane, Session, Mission, Task, Provider, Account, Policy, Decision, Squad, Agent, Skill, McpTool, Hook, MemoryEntry, Plan, Entitlement.

## 4. Requisitos funcionais

### 4.1 Bot e wizard
- RF-10.01 O sistema DEVE permitir criar um Bot pelo wizard "Criar meu primeiro bot": nome → servidor → piloto → repositórios. Aceite: wizard só finaliza com os 4 passos válidos. [OBS: Dia 69, protótipo V3]
- RF-10.02 O passo "servidor" DEVE exigir mínimo de 2 GB de RAM, IP e credencial SSH (chave ou senha). Aceite: servidor com <2 GB é rejeitado com mensagem. [OBS: Dia 69]
- RF-10.03 O passo "piloto" DEVE listar os Providers instalados/instaláveis (Claude, Codex, Kimi, Grok, Antigravity) e permitir escolher o modelo do piloto; padrão Claude (Opus). Aceite: o piloto escolhido é o que responde no chat. [OBS: Dias 69-71; padrão Claude = [DEC]]
- RF-10.04 O passo "repositórios" DEVE registrar os repositórios permitidos e informar "eu nunca escrevo na main, só abro o PR". Aceite: ver RF-10.30. [OBS: Dia 69]
- RF-10.05 O Bot DEVE ter personalidade configurável: `persona` (quem é, como fala, o que sabe do dono, regras da casa). Aceite: persona injetada no prompt de sistema do piloto. [OBS: Dia 70]
- RF-10.06 O sistema DEVE permitir editar Bots e adicionar mais de um Bot ("editar bots", "adicionar mais um bot"). Aceite: 2 bots coexistem no mesmo host. [OBS: Dia 69-71]
- RF-10.07 O cloquinho DEVERIA ser o Bot padrão criado (nome sugerido "cloquinho"; usuário pode renomear). [OBS: Dia 70; "Virgulino" foi só exemplo do protótipo]
- RF-10.08 Após instalação, o bot DEVERIA oferecer tarefas de estreia (clonar repo e rodar testes; abrir PR de type check; só olhar o repo e dizer o que está quebrado, "no máximo cinco linhas"). [OBS: Dia 69-70]

### 4.2 Provisionamento de VPS e execução 24h
- RF-10.10 O sistema DEVE instalar o Overclock no host via SSH sem o usuário ver linha de comando; o instalador é motor interno atrás do botão "Instalar" (comando interno `overclock bot install`). [OBS: Dia 69; nome do comando "ideal citado"]
- RF-10.11 O instalador DEVE detectar hardware (CPU, RAM, disco livre, provedor) e recusar/alertar abaixo de 2 GB. [OBS: Dia 70; limiar de aviso = RF-10.02]
- RF-10.12 O instalador DEVE: confirmar/criar usuário `overclock`; habilitar acesso por chave SSH sem senha; instalar Node 22; criar swap de 2 GB; numa sessão root única. [OBS: Dia 69]
- RF-10.13 O instalador DEVE instalar as CLIs (Claude Code, Codex, Kimi, Grok, Antigravity) pelos instaladores oficiais e guiar o login de cada uma pelo app ("wizard indireto"); DEVE verificar login por prova ativa (comando real), nunca por flag local. Aceite: status "logado" só se o comando de verificação retorna sucesso na sessão. [OBS: instalação e login; bug de status "instalada e logada" sem persistir, Dia 70; verificação ativa = [DEC] para corrigir o bug]
- RF-10.14 O host DEVE rodar um display virtual para o Overclock (app desktop em Rust) headless e expor a tela ao vivo por túnel/VNC. [OBS: Dia 69 passo 9; tecnologia = [DEC] Xvfb + x11vnc via túnel SSH]
- RF-10.15 O Overclock e o daemon do bot DEVEM rodar como serviços que sobrevivem a logout e reboot (persistência 24h); sessões de terminal DEVEM ser persistentes (tmux) e fechar o Pane NÃO mata a Session. [OBS parcial: Dia 61 tmux via SSH, fechar pane não mata sessão; Dia 64 "futuro VPS 24h"; serviço systemd = [DEC]]
- RF-10.16 O app DEVE oferecer "abrir tela ao vivo", "assumir controle" e "conferir instalação" (revalida versão, CLIs, serviços e Arms). [OBS: Dia 69-70]
- RF-10.17 O sistema DEVE mostrar estado final "Tô online. Meu computador tá ligado. Overclock <versão> no ar e já enxergo a tela." apenas após health-check aprovado (sidecar responde, display ativo, Arms conectado). [OBS: texto Dia 69; health-check = [DEC]]
- RF-10.18 O provisionamento DEVE tolerar falhas parciais e ser idempotente (reexecutar não duplica). Aceite: rodar 2x produz o mesmo estado. [DEC: a demo do Dia 70 falhou em vários passos]
- RF-10.19 Credenciais (SSH, tokens das CLIs, GitHub) DEVEM ficar no host, nunca no Keychain/disco do computador do usuário, exceto a chave SSH de acesso do app desktop. [OBS: "nada no meu computador"; bug de chave no Keychain, Dia 71]
- RF-10.19a Senhas geradas para a VPS DEVEM passar por checagem de política do servidor; se recusada (ex.: senha vazada) o app DEVE regerar automaticamente. [OBS: recusa vista no Dia 70; regeração automática = [DEC]]
- RF-10.19b O produto DEVERIA recomendar provedores testados (Hostinger KVM1 Debian 13) e desaconselhar os que falharam (Contabo, Oracle Free, Magno Host). [OBS: Dia 69 e Dias 75-81]
- RF-10.19c O host Linux DEVERIA receber atualização do Overclock por reinstalação/`conferir instalação`, pois auto-update Linux não existe. [OBS: Dia 69; solução = [DEC]]

### 4.3 Arms (MCP interno)
- RF-10.20 O Overclock DEVE expor o Arms como servidor MCP (plugin interno) que se comunica diretamente com o sidecar e roda dentro do Overclock do host, não como programa à parte. [OBS: Dia 69]
- RF-10.21 As tools do Arms DEVEM ter o mesmo efeito na UI e no estado: controle via sidecar, UI só observa ("a tela é observação, o braço é controle"); proibido manter estado paralelo. Aceite: após `pane_spawn` o Pane aparece na UI sem ação adicional. [OBS: Dia 69]
- RF-10.22 O Arms DEVE oferecer cobertura de ~54 tools nas categorias do §6c (contagem "~54" é [OBS]; a lista nominal é [DEC]).
- RF-10.23 O piloto DEVE preferir Arms a screenshot/clique ("braço antes do mouse, sempre"); screenshot/clique só como último recurso. [OBS: Dia 69]
- RF-10.24 O piloto DEVE nascer com allowlist pré-aprovada das tools Arms seguras; cada tool nova não pode gerar prompt de permissão por padrão. Tools destrutivas ficam fora da allowlist (RF-10.31). [OBS: "o piloto tem que nascer com allowlist, senão ele para", Dia 69; exclusão de destrutivas = [DEC]]
- RF-10.25 Zero diálogos na tela: fluxos que exigiam diálogo (login Claude/Git/GitHub) DEVEM ser resolvidos por wizard indireto que cria a sessão e faz login guiado. [OBS: Dia 69]
- RF-10.26 O Arms DEVE ter heartbeat: se o wrapper morrer, o status DEVE mudar para "desconectado" em até 10 s e o daemon DEVE reiniciá-lo. [OBS: fragilidade "morre e continua dizendo conectado", Dia 69; 10 s = [DEC]]
- RF-10.27 O cloquinho DEVE monitorar a tela (`screen_snapshot`) para verificar paridade com o estado dos Arms durante missões longas. [OBS: missão Dia 70]
- RF-10.28 Antes de abrir um Pane, o cloquinho DEVERIA chamar `headline_pick_account` ([[spec-09-overclock-headline]]) e respeitar a Policy ([[spec-03-harness-roteamento-decisor]]). [OBS: mod. 10 Providers no bot]

### 4.4 Segurança de ação
- RF-10.30 O bot NUNCA DEVE escrever em `main`/branch protegida; só cria branch e abre PR. Aceite: `git push` a `main` bloqueado por hook no host; sem remote, reporta "não tem PR porque não existe remote configurado". [OBS: Dia 69; Dia 71 (sem remote); mecanismo hook = [DEC]]
- RF-10.31 Ações destrutivas (`pane_close` de Pane com trabalho não salvo, `session_kill`, apagar repositório, force-push) DEVEM exigir confirmação do usuário no app. [DEC: o material só mostra o cloquinho fechando painéis por pedido explícito, Dia 71]
- RF-10.32 Todas as chamadas de tool do piloto DEVEM ser registradas (`ArmsCallLog`) com ator, tool, args resumidos, resultado e duração. [DEC: observabilidade; Arms "mentiu" em testes, Dia 69]

### 4.5 Pareamento e relay
- RF-10.40 O host DEVE gerar um código de pareamento de uso único e curta duração que carrega `relay_url`, `channel_id` e `secret`. [OBS: "o código leva o bot, o segredo e o endereço do relay", Dia 70; uso único/TTL = [DEC]]
- RF-10.41 O app móvel DEVE aceitar o código digitado; leitura por QR DEVERIA ser suportada. [OBS: QR ainda não funcionava, código digitado sim, Dia 71]
- RF-10.42 O host DEVE manter conexão de saída persistente ao relay ("já está discado nele"); o relay só junta as duas pontas. Aceite: nenhuma porta de entrada aberta na VPS; sem conta e sem senha do usuário no relay. [OBS: Dia 70]
- RF-10.43 Após parear, o app DEVE ver o mesmo Bot/Workspace/Panes que o desktop (mesma interface do bot). [OBS: Dia 70-71]
- RF-10.44 O tráfego app<->host DEVERIA ser cifrado ponta a ponta usando o `secret` do código; o relay NÃO DEVE ler conteúdo. [LAC: criptografia do relay só por fala do agente sem código (Dia 70); proposta em §7/§13]
- RF-10.45 O usuário DEVE poder listar e revogar dispositivos pareados. Revogar DEVE encerrar o canal em ≤5 s. [DEC: exigência de segurança; não observado]
- RF-10.46 Alternativa Tailscale (rede privada) DEVE ser tratada como transporte opcional, não padrão. [OBS: sugerida pelo agente, rejeitada pelo dono que quer app próprio, Dia 70]
- RF-10.47 O app NÃO DEVE ser HTML/PWA; DEVE ser app nativo iOS, estático (sem zoom in/out), que reconhece a chave/config já existente no host sem pedir de novo. [OBS: Dia 70-71]

### 4.6 Chat, voz e cloquinho
- RF-10.50 O app DEVE oferecer chat texto com o cloquinho, com respostas curtas, e exibir Panes/Missions abertos. [OBS: Dia 71]
- RF-10.51 O cloquinho DEVE poder, por chat, abrir/fechar Panes ("fecha o pane 33"), criar Missions, abrir CLIs (ex.: Kimi K3) e orquestrar outros bots. Aceite: comando por texto muda estado no host em ≤5 s. [OBS: Dia 71; 5 s = [DEC]]
- RF-10.52 O cloquinho DEVE responder sozinho perguntas de orquestradores durante missões (ex.: CTA, direção visual) dentro dos limites da persona e da Policy, e registrar a Decision. [OBS: Dia 70; registro = [DEC]]
- RF-10.53 O cloquinho DEVE retomar contexto ao reabrir (camada de memória, [[spec-06-over-memory]]): salvar `MemoryEntry` do estado (o que estava fazendo, onde parou). [OBS: Dia 70]
- RF-10.54 A bridge de voz DEVE conectar um modelo realtime ao piloto: o usuário fala; a voz apenas repassa ao piloto e devolve retorno curto; o "cérebro" roda no host. Aceite: falar "abre um painel" abre; "quanto é um mais um" devolve 2 por voz; "fecha o painel" fecha. [OBS: Dia 71]
- RF-10.55 A voz NÃO DEVE decidir/executar tarefas por si; é interface. [OBS: "o cérebro roda no computador do dono", Dia 71]
- RF-10.56 A bridge DEVERIA permitir push-to-talk e barge-in (interromper a fala). [LAC]

### 4.7 Acesso e comercial
- RF-10.60 O acesso ao Bot DEVE ser controlado por Entitlement `bot_access` concedido ao plano máximo (Ultra). [OBS: Dias 70-71; nome do entitlement = [DEC]]
- RF-10.61 Sem entitlement, o app DEVE mostrar tela de upgrade e não gerar código de pareamento. [DEC]

## 5. Modelo de dados

Persistência: host guarda tudo em SQLite local `~/.overclock/bot/bot.db` + cofre de segredos com permissão 0600 [DEC, coerente com "tudo na VPS"]; relay guarda só canais efêmeros em memória (sem persistência de conteúdo) [DEC]. Celular guarda `PairedDevice.local` (channel_id, secret) no Keychain do iOS [DEC].

### Bot
| campo | tipo | obr. | default | notas |
|---|---|---|---|---|
| bot_id | uuid | s | gerado | |
| name | string | s | "cloquinho" | 1-40 chars |
| is_primary | bool | s | true no 1º | invariante: exatamente 1 primário por host |
| pilot_provider | enum(claude_code,codex,kimi,grok,antigravity,cursor,gemini) | s | claude_code | [[spec-04-providers-e-modelos]] |
| pilot_model | string | n | "opus" | |
| persona | text | n | prompt-base §8 | |
| allowed_repos | RepoRef[] | s | [] | invariante: push só em branch != protegida |
| host_id | uuid | s | | |
| status | enum(installing,online,degraded,offline) | s | installing | |
| created_at | timestamp | s | | |

### Host (VpsServer)
`host_id, kind(vps|desktop), address, ssh_user("overclock"), ssh_auth(key|password), provider_hint("hostinger"...), os("debian13"), cpu, ram_mb, disk_free_mb, swap_mb, node_version, overclock_version, display_ready:bool, arms_status(connected|disconnected), installed_clis[{provider, installed, logged_in, verified_at}]`. Invariante: `ram_mb>=2048` ou `status` != online. [OBS RF-10.02]

### PairingCode (efêmera)
```json
{"code":"K7Q2-9XJD-...","relay_url":"wss://relay.example/v1","channel_id":"c_8f3a","secret_b32":"...","expires_at":"2026-10-01T12:05:00Z","used":false,"bot_id":"..."}
```
TTL 5 min, uso único [DEC].

### PairedDevice
`device_id, bot_id, name, platform(ios), channel_id, paired_at, last_seen, revoked_at?`.

### ArmsCallLog
`id, ts, bot_id, tool, args_digest, result(ok|error|denied), error_code?, duration_ms`. Retenção 30 dias [DEC].

### Allowlist
`bot_id, tool, decision(allow|confirm|deny)`. Default: leitura e criação = allow; destrutivas = confirm.

### BotMessage
`msg_id, bot_id, channel(text|voice), role(user|pilot|system), text, ts, refs{pane_id?,mission_id?}`.

### VoiceSession
`voice_session_id, bot_id, model("openai-realtime"), started_at, ended_at, tokens_in, tokens_out`.

Ciclo de vida do Bot: `installing → online ⇄ degraded → offline`; exclusão apaga segredos no host (confirmar).

## 6. Interfaces

### 6a. UI/UX
Superfícies: app iOS e web/desktop do Overclock (mesmo modelo de telas; "4 superfícies, DS do Overclock, PT-BR") [OBS: Dia 69].
1. **Wizard** (Nome → Servidor → Piloto → Repositórios → Preparando). Tela "Preparando" mostra passos (instalar Overclock, ligar tela, acordar piloto, conectar braços) com log resumido e retry por passo. [OBS passos; retry = [DEC]]
2. **Painel "mãe"** do cloquinho: conversa, lista de Bots, Panes/Missions ativos. [OBS: painel "mãe" no protótipo V3]
3. **Chat** com barra de voz; botões "abrir tela ao vivo", "assumir controle", "conferir instalação", "editar bots", "adicionar mais um bot".
4. **Pareamento**: no host "Dar acesso ao meu celular" mostra código (+QR); no app "Digitar código".
5. **Dispositivos pareados** com revogar.
6. Estados: instalando, online, degradado (Arms desconectado), offline (host sem heartbeat), sem entitlement.
Textos: status final "Tô online…" (RF-10.17); mensagem de escrita em main: "Eu nunca escrevo na main, só abro o PR." [OBS]
Atalhos: [LAC] (não observados).
Logo: mesmo do site; cor por CLI [OBS: Dia 71].

### 6b. API interna / eventos
Transporte app<->host via relay: WebSocket, frames JSON cifrados [DEC].

Relay (HTTP/WS) [DEC de contrato; conceito OBS]:
- `WS /v1/host/{channel_id}` (host disca; header `X-Channel-Proof`= HMAC(secret, nonce)).
- `WS /v1/client/{channel_id}` (app conecta; mesma prova).
- Relay repassa frames opacos; encerra se o host não estiver conectado em 30 s; limite 1 cliente ativo por canal padrão, configurável (RF-10.45).

Mensagens (envelope `{v:1,type,id,ts,body}`):
- `chat.send` `{text, channel:"text"|"voice"}` → host.
- `chat.delta` `{msg_id, text_chunk, done}` → app.
- `state.snapshot` `{bot, panes[], missions[], host{ram,disk,arms_status}}`; `state.event` (`pane.opened|pane.closed|mission.created|arms.status|install.progress`).
- `control.action` `{action:"pane_close", pane_id}` (confirmação gera `confirm.request`/`confirm.reply`).
- `screen.subscribe` / `screen.frame` [LAC: transporte de vídeo do display para o app móvel não observado; MVP usa VNC via túnel só no desktop].
- `voice.audio.in|out` (PCM 24 kHz base64) [DEC].
- `pair.revoke`.
Erros: `error {code: unauthorized|host_offline|rate_limited|entitlement_missing|invalid_frame}`.

### 6c. Tools MCP do Arms
Nomes-alvo em snake_case. Observado: existência de `pane spawn` (→ `pane_spawn`), `pen list` (allowlist, → `allowlist_list`), `headline pick account` (→ `headline_pick_account`), ~54 tools no total. [OBS] Lista nominal abaixo é [DEC] agrupada por categoria; completar até ~54 na implementação:

| Categoria | Tools mínimas (MVP) |
|---|---|
| Workspace | `workspace_list`, `workspace_create`, `workspace_switch` |
| Pane | `pane_spawn`, `pane_close`, `pane_list`, `pane_send_text`, `pane_read_output`, `pane_focus` |
| Session | `session_list`, `session_attach`, `session_kill`(confirm) |
| Mission/Task | `mission_create`, `mission_list`, `mission_status`, `task_list` |
| Squad/Agent | `squad_list`, `squad_run`, `agent_list` |
| Provider/Account | `provider_list`, `headline_pick_account` |
| Repo/Git | `repo_clone`, `pr_open`, `branch_create` (nunca `push_main`) |
| Sistema | `screen_snapshot`, `health_check`, `allowlist_list`, `arms_version` |
| Memória | `memory_save`, `memory_search` |

Contrato genérico de cada tool: entrada JSON Schema; saída `{ok:bool, data, error?{code,message}}`. Exemplo:
```json
{"name":"pane_spawn","description":"Cria um Pane no Workspace e inicia a CLI do Provider indicado",
 "inputSchema":{"type":"object","required":["provider"],"properties":{"workspace_id":{"type":"string"},"provider":{"type":"string","enum":["claude_code","codex","kimi","grok","antigravity"]},"account_id":{"type":"string"},"cwd":{"type":"string"},"initial_prompt":{"type":"string"}}}}
```
Saída: `{"ok":true,"data":{"pane_id":"p34","session_id":"s..."}}`. Erros: `workspace_not_found`, `provider_not_logged_in`, `denied_by_policy`, `sidecar_unavailable`.

### 6d. CLI / protocolos externos
- `overclock bot install --host <addr> [--key <path>]` (motor do botão Instalar) [OBS nome citado; flags DEC].
- `overclock bot pair` (imprime código/QR), `overclock bot devices`, `overclock bot revoke <device_id>`, `overclock bot status` [DEC].
- SSH por chave (host); túnel `ssh -L` para tela ao vivo; OpenAI Realtime (WebSocket) para voz; instaladores oficiais das CLIs.
- Guia de 12 passos exportável (cada bloco indica "onde colar"; passo 1 = chave SSH; passo 9 = túnel) como alternativa manual [OBS: Dia 69].

## 7. Fluxos e algoritmos

### 7.1 Instalação (host)
1. Validar conexão SSH; senão erro `ssh_unreachable` (retry com backoff). 2. Detectar hardware (RF-10.11). 3. Criar usuário/chaves; desabilitar senha após chave OK. 4. Instalar Node 22, swap 2 GB, display virtual, tmux. 5. Baixar/instalar Overclock (versão estável) e registrar serviços. 6. Instalar CLIs; login guiado por CLI; verificar (RF-10.13). 7. Subir sidecar + Arms; health-check. 8. Gerar `Bot`, persona, allowlist. 9. Emitir `online`. Cada passo é idempotente e reportável (`install.progress`). [passos 3-9 OBS parcial Dias 69-70; ordem = DEC]

### 7.2 Máquina de estados do Host/Bot
| Estado | Evento | Novo estado |
|---|---|---|
| installing | health_ok | online |
| installing | step_failed | installing (passo em erro, retry manual) |
| online | arms_down | degraded |
| degraded | arms_restart_ok | online |
| degraded | arms_restart_fail ×3 | offline |
| online/degraded | relay_heartbeat_lost 60 s | offline |
| offline | host_reconnect + health_ok | online |
Heartbeat host→relay a cada 15 s [DEC].

### 7.3 Pareamento
1. Host: `secret=random(32B)`, `channel_id=random(16B)`; monta código; abre canal no relay com `HMAC`.
2. App: decodifica código, disca `client`, prova HMAC(secret,nonce).
3. Ambos derivam chave de sessão via handshake autenticado por `secret` (PAKE/Noise PSK) [DEC — RF-10.44 é LAC]. 4. Host marca `used=true`, cria `PairedDevice`, envia `state.snapshot`. 5. Reconexões usam par de chaves persistido no Keychain; código não é reutilizável. Erros: código expirado/usado → `pair_expired`; 5 tentativas erradas em 10 min bloqueiam o canal [DEC].

### 7.4 Pedido por chat/voz
1. App envia `chat.send`. 2. Daemon injeta persona + memória + estado (snapshot) no piloto. 3. Piloto decide e chama tools Arms (allowlist → executa; confirm → `confirm.request` ao app; deny → erro). 4. Arms age no sidecar; UI reflete. 5. Piloto responde curto; `chat.delta` para o app; se voz, texto vai à bridge para TTS. 6. Estado relevante vira `MemoryEntry`.

### 7.5 Bridge de voz
Modelo realtime tem uma única função `ask_pilot(text)`; ao receber fala transcrita ele fala "Vou repassar isso pro piloto e aguardar a resposta" e invoca a função; o resultado curto é lido. O daemon serializa: uma requisição de voz por vez ao piloto (fila FIFO). Se o piloto demorar >20 s, a voz avisa "ainda trabalhando" [DEC]. [OBS comportamento: Dia 71]

### 7.6 Regras de decisão do cloquinho
- Escolha de CLI/conta: Policy ([[spec-03-harness-roteamento-decisor]]) + `headline_pick_account`. [OBS]
- Perguntas de orquestrador: responder sozinho se a resposta cabe na persona/repositório; caso envolva custo, deploy, dado externo ou destrutivo, perguntar ao dono [DEC].
- Falha da missão: reportar exatamente o que aconteceu (ex.: "o build nunca rodou") e não afirmar sucesso sem prova (verificar arquivo/paridade de tela) [OBS: Dia 70; regra de prova = DEC].

### 7.7 Casos-limite
- VPS ociosa/sem swap: OOM → serviço reinicia; alerta no app [DEC].
- Sem remote git: sem PR; informar (Dia 71) [OBS].
- Piloto desconectado: bot `degraded`, fila de mensagens do app até 50 [DEC].
- Sessão do CLI expirada: estado `logged_in=false`, botão "entrar" (o bug do Dia 70 mostrava "entrar" mesmo logado).
- Missão criada no Workspace errado (bug Dia 69): `mission_create` DEVE exigir `workspace_id` explícito ou confirmar o ativo [DEC].

## 8. Prompts e textos embutidos

Persona-base do cloquinho [LAC: prompt real não registrado; base abaixo é DEC ancorada na frase observada "Sou o clock orquestrador do seu overclock. Abro missões, panes, acompanho, te respondo curto."]:
```
Você é {name}, orquestrador do Overclock deste usuário. {persona}
Regras: (1) use as ferramentas Arms; screenshot e clique só como último recurso. (2) Nunca escreva em main; abra branch e PR. (3) Respostas curtas, em pt-BR. (4) Antes de abrir um pane, consulte headline_pick_account e siga a política de harness. (5) Não afirme que algo funcionou sem verificar. (6) Ações destrutivas: peça confirmação.
```
Prompt de voz (realtime) [DEC]: "Você é a voz do {name}. Não execute nada. Repasse cada pedido ao piloto com ask_pilot e leia a resposta curta." Texto observado da voz: "Vou repassar isso pro piloto e aguardar a resposta"; "Sou a voz do Cloquinho, mas não tenho acesso contínuo ao mundo em tempo real; o cérebro roda no computador do dono." [OBS: Dia 71]

Prompts observados (uso como fixtures/tarefas; parafraseados da transcrição) [OBS]:
- Briefing que originou o Arms: "Me explica o que tu precisa para conseguir mexer no Overclock dentro do teu computador sem precisar ficar batendo print screen para aprender o que tem na tela?" (Dia 69)
- Inventário do host: "Preciso replicar o teu computador numa VPS minha. Faz o inventário completo da box onde tu roda e me devolve em markdown." (Dia 69)
- Estreia: "Clona o repositório em trabalho. Instala as dependências e roda verificação de tipos. Depois me diz, no máximo cinco linhas, o que está quebrado." (Dia 70)
- Missão do cloquinho: "...executar um site simples ... através do squad chamado cinema squad. Cada worker precisa ser um cara diferente, baseado no harness já existente ... 100% do processo tem que ser feito pelo cloquinho e você precisa ficar monitorando a tela para ter certeza de que há paridade..." (Dia 70)
- Pareamento: "Quero poder logar no cloquinho pelo meu celular ... o bot gera um código, o celular lê o código, entra na mesma VPS; nada no meu computador." (Dia 70)
- Voz: "Eu quero conversar com o cloquinho através do modelo realtime da OpenAI." (Dia 71)

## 9. Requisitos não-funcionais

- Desempenho: instalação completa em VPS nova ≤ 25 min [OBS: "em 25 minutos o Overclock rodava nela", Dia 69, como referência]; comando de chat → efeito ≤5 s [DEC]; abrir 32/64 painéis na VPS [OBS: Dia 68 testes de performance; meta em host de 4 GB = LAC]. Latência de voz alvo <1,5 s ao primeiro áudio [DEC].
- Portabilidade: host Linux Debian 13/Ubuntu 24.04 [OBS: Dia 69]; app cliente iOS; desktop macOS existente; Windows como host e Android = [LAC].
- Segurança: sem porta de entrada no host; SSH só por chave; segredos no host 0600; código de pareamento uso único; revogação; logs sem segredos; allowlist; nunca escrever em main [OBS/DEC conforme §4]. Alerta: no Dia 70 IP/senha foram expostos ao vivo, o produto não deve exibir senha após o setup [OBS incidente; regra DEC].
- Privacidade: relay não armazena conteúdo; telemetria opcional [DEC]. Voz enviada ao provedor realtime (OpenAI) — informar no questionário de privacidade da App Store [OBS: questionário exigido, Dia 72].
- Custo/tokens: sem API key, usa contas/assinaturas das CLIs [OBS: doutrina do produto, Dia 71]; a bridge de voz usa API Realtime paga [LAC: quem paga]. Custo de VPS R$ 30-52/mês [OBS]. Builds iOS via GitHub Actions ~R$ 500/mês [OBS: Dia 72].
- Observabilidade: `ArmsCallLog`, eventos `install.progress`, `arms.status`, health-check; exibir custo/tokens por painel via cockpit existente [OBS: cockpit]. 

## 10. Stack sugerida e restrições

Original [OBS]: Overclock desktop em Rust; Claude Code como piloto; Codex, Kimi K3, Grok CLI, Antigravity (e Cursor/Gemini) como providers; VPS Hostinger KVM1 Debian 13 (1 vCPU, ~4 GB, 46 GB livres), Node 22, swap 2 GB; SSH por chave; display virtual + túnel/VNC; Arms = plugin MCP + sidecar; app iOS com Xcode, TestFlight, GitHub Actions, Apple Developer Program; OpenAI Realtime; relay próprio.
Alternativas neutras [DEC]: relay em Cloudflare Workers/Durable Objects ou serviço Go/Rust com WebSocket; cifra Noise_XXpsk3 ou libsodium; app em Swift/SwiftUI ou React Native; display Xvfb+x11vnc/noVNC ou Wayland headless; SQLite; systemd + tmux; provedores VPS Hetzner/Netcup (citados pelo chat como estáveis, Dia 69 [OBS]).
Restrições: não construir sobre Hermes/OpenClaw (decisão de construir do zero) [OBS: Dia 69]; app nativo (não HTML) [OBS]; sem duas fontes de verdade (Arms vs tela) [OBS].

## 11. Plano de implementação em fases

- **Fase 0 (base)**: sidecar com API de controle estável ([[spec-01-terminais-paineis-workspaces]]); Arms MVP (~20 tools da §6c) + allowlist + log + heartbeat. Dependências: spec-01, spec-05.
- **Fase 1 (bot local)**: entidade Bot, persona, cloquinho no desktop, chat texto, regra "nunca main" (hook), memória ([[spec-06-over-memory]]), integração headline/Policy.
- **Fase 2 (VPS)**: instalador idempotente, display virtual, serviços 24h, tela ao vivo, "assumir controle", verificação ativa de login das CLIs, wizard.
- **Fase 3 (móvel)**: relay, pareamento, cifra E2E, app iOS (TestFlight interno), chat/estado, dispositivos/revogação, entitlement.
- **Fase 4 (voz)**: bridge realtime, fila, push-to-talk.
- **Fase 5 (completo)**: completar ~54 tools; rotinas agendadas; múltiplos bots; skin/cores.
- **Fase 6 (comercial/F2 do original)**: App Store, open source condicional, VM hospedada por usuário, Android.

## 12. Casos de teste de aceitação

1. **Wizard feliz**: Dado VPS Debian 13 com 4 GB e chave SSH válida; Quando completo o wizard com piloto Claude e 1 repo; Então bot fica `online` com a mensagem "Tô online…" e health-check ok (RF-10.01,10.17).
2. **RAM insuficiente**: Dado VPS com 1 GB; Quando informo no wizard; Então recusa com aviso de mínimo 2 GB (RF-10.02).
3. **Idempotência**: Dado instalação concluída; Quando rodo "conferir instalação"/install de novo; Então nada duplica (usuário, swap, serviços) (RF-10.18).
4. **Login falso**: Dado CLI com credencial expirada; Quando o app consulta status; Então `logged_in=false` (prova ativa falha) e botão "entrar" (RF-10.13).
5. **Arms sem diálogo**: Dado allowlist padrão; Quando o piloto chama `pane_spawn`; Então executa sem prompt de permissão e o Pane aparece na UI (RF-10.21,10.24).
6. **Arms cai**: Dado Arms online; Quando o processo wrapper é morto; Então estado `degraded` em ≤10 s e reinício automático (RF-10.26).
7. **Main protegida**: Dado repo com remote; Quando o piloto tenta `git push origin main`; Então bloqueado e alternativa é branch+PR (RF-10.30).
8. **Pareamento**: Dado código gerado; Quando o app digita o código em <5 min; Então conecta via relay, sem porta aberta na VPS, e vê o mesmo snapshot; segunda tentativa com mesmo código falha `pair_expired` (RF-10.40-10.43).
9. **Revogação**: Dado dispositivo pareado; Quando revogo no host; Então o app perde conexão em ≤5 s e não reconecta sem novo código (RF-10.45).
10. **Comando remoto**: Dado app pareado; Quando envio "fecha o pane 33"; Então (Pane sem trabalho pendente) fecha em ≤5 s; se houver trabalho, pede confirmação (RF-10.31,10.51).
11. **Voz**: Dado bridge ativa; Quando digo "quanto é um mais um"; Então a voz repassa ao piloto e devolve "dois" curto; a voz não executou nada por conta própria (RF-10.54-10.55).
12. **Sem entitlement**: Dado usuário fora do plano máximo; Quando abre o app; Então tela de upgrade e sem geração de código (RF-10.60-10.61).
13. **Sem remote**: Dado repo sem remote; Quando missão termina; Então cloquinho informa que não há PR por falta de remote (RF-10.30).

## 13. Questões em aberto e riscos

- [LAC-1] Criptografia e hospedagem do relay (E2E? quem hospeda?); proposta [DEC]: E2E por PSK, relay sem estado. (RF-10.44)
- [LAC-2] Lista nominal das ~54 tools do Arms (apenas `pane spawn`, `pen list`, `headline pick account` observados); risco alto de mismatch ao integrar com sidecar real.
- [LAC-3] Estado final de paridade tela/braço não foi fechado; Arms "mentiu" em testes (Dia 69). Risco: status falso; mitigado por heartbeat/health-check [DEC].
- [LAC-4] Transporte de tela ao vivo no celular; se é VNC/vídeo (RF §6b).
- [LAC-5] Como o iPhone recebeu o app antes da App Store (provável TestFlight/Xcode) e se houve aprovação Apple.
- [LAC-6] Quem paga a API Realtime da voz e se há alternativa sem API key.
- [LAC-7] Nome final do produto/bot ("Overclock Bot" venceu enquete; "Friends"/"Overbot" sem decisão); prompt real do cloquinho e da voz.
- [LAC-8] Números conflitantes: RAM 3,8 vs 4 GB; preço R$ 30 vs 50-52; tools Arms ~54 vs MCP do produto 52; versões 1.3.x vs "3.1.x".
- [LAC-9] Regras de rotinas agendadas, Windows/Android como host, atalhos, retenção de logs.
- Riscos: exposição de credenciais em demos [OBS]; custo ocioso de VPS [OBS]; dependência de provedores de VPS instáveis [OBS]; login de CLIs sem interface ("zero diálogo") frágil; bug de missão em Workspace errado.

## 14. Rastreabilidade

| Requisito | Fonte |
|---|---|
| RF-10.01-10.08 | mod. 10: Comportamento, Features 5; Dias 69-70 (arq. 22, 21) |
| RF-10.10-10.19c | mod. 10: Funcionamento (Instalação em VPS nova), Feature 3-4; Dias 61, 64, 69, 70 (arq. 30, 27, 22, 21); Dia 71 (Keychain, arq. 20) |
| RF-10.20-10.28 | mod. 10: Arms, Doutrina Dia 69 (arq. 22); Feature 6 Dia 70; Providers no bot |
| RF-10.30-10.32 | mod. 10: Segurança, Feature 6; Dias 69, 71 (arq. 22, 20); observabilidade DEC |
| RF-10.40-10.47 | mod. 10: Pareamento e relay (Dia 70, arq. 21); Dia 71 (arq. 20) |
| RF-10.50-10.56 | mod. 10: Comportamento 5-6, Feature 6-7; Dias 70-71 |
| RF-10.60-10.61 | mod. 10: Modelo de negócio (Dias 70-71); [[spec-00-visao-arquitetura-e-glossario]] §6 (planos e entitlements) |
| Fase 2 (F2-1..F2-8) | mod. 10: Features 8, 9, 11, 12; Dias 70-73, 78 (arq. 21, 20, 19, 18, 12) |
| Prompts §8 | mod. 10: Prompts, receitas, comandos e textos; Dias 69-71 |
| NFR §9 | mod. 10: Stack e ferramentas; Dias 69, 72 |
