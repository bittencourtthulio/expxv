---
spec: "Terminais, Painéis e Workspaces"
slug: "spec-01-terminais-paineis-workspaces"
modulo_fonte: ["01-terminais-paineis-workspaces"]
status_origem: construido
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-02-orquestracao-modo-agentico", "spec-03-harness-roteamento-decisor", "spec-04-providers-e-modelos", "spec-06-over-memory"]
---
# Spec 01 — Terminais, Painéis e Workspaces

Legenda de selos: [OBS] observado (fonte: módulo 01 + Dia/arquivo); [DEC] decisão do autor da spec; [LAC] lacuna que exige decisão do dono do produto. Abreviação de fonte: "M01" = módulo lógico 01-terminais-paineis-workspaces; "D22" = Dia 22 (arquivo 55) etc. (mapa Dia→arquivo na seção 14).

## 1. Resumo e objetivo

O Overclock é um ADE cujo "chassi" é esta camada: uma grade de **Panes** (cada um um terminal real com PTY, hospedando uma CLI de IA, um shell ou um browser interno), agrupados em **Missions** (cada uma com seu git worktree e sua grade) dentro de **Workspaces** (projeto base), com multi-janelas estilo Chrome, workspaces remotos via SSH/tmux, semáforo de status por painel e restauração de sessões [OBS: M01 "Visão geral"; D24, D22, D23]. O produto não é wrapper de API: o painel executa a própria CLI do usuário (equivale a abrir o terminal e digitar `claude`) e o app é apenas renderizador de terminal [OBS: M01, D55/arq.37]. Problemas resolvidos: terminais soltos e sessões perdidas no VS Code; "amnésia de aba"; falta de visibilidade do que os agentes fazem (regra "nada roda em background; todo sub-agente aparece como painel visível") [OBS: M01 "Objetivo"; D23-D28]; e escala (32/64 painéis abrindo em segundos) em macOS/Windows/Linux.

## 2. Escopo e não-escopo

**Cobre:** ciclo de vida de Pane (PTY, resize, scroll, paste, shell, provider por painel); grade e layout; motor de renderização "Overdrive" e metas de desempenho; Workspace (isolamento, política de acesso externo, header); Mission como worktree (aspectos de terminal/layout/worktree); multi-janelas e destaque de painel; atalhos; SSH remoto e sessões tmux externas; cadeado do dialog de spawn de squad; semáforo de status; persistência/restauração; opções de performance e diagnóstico; temas e acessibilidade do chassi.

**Não cobre (ver outras specs):** lógica de squads/orquestrador, MCP de spawn como contrato de orquestração ([[spec-02-orquestracao-modo-agentico]]; aqui só a superfície de painel que ele consome); escolha de conta/modelo e Policy ([[spec-03-harness-roteamento-decisor]]); catálogo de providers/CLIs ([[spec-04-providers-e-modelos]]); MemoryEntry/brief ([[spec-06-over-memory]]); builds, assinatura, segurança de VPS ([[spec-00-visao-arquitetura-e-glossario]] §7 (requisitos transversais: build, assinatura, segurança)); voz e captura de imagem (entrada para o painel; specs próprias); planos/Entitlements (apenas o gancho de limites, RF-01.72).

**Fase 2 (planejado no original, sem evidência de construção):** agente revisor de worktree/commit/deploy automático (planejado) [OBS: M01 "Missões por worktree"]; grids de tamanhos fixos 1/2/3/4 células (sugerido, sem evidência de implementação) [OBS: M01 "Performance"]; "missões visíveis a todos" (retirado por ora) [OBS: D24-25]; terminais Claude em tmux na VPS para loops de Vibe in Public [OBS: M01].

## 3. Glossário e atores

- **Pane** (painel/terminal; UI: "terminal", site: "painel"; botão "+ pain" virou "+ terminal" no D61 [OBS: M01]). Sinônimos ruidosos na transcrição (pen/pain/pênis) = o mesmo.
- **Workspace**: projeto base; **Mission**: item paralelo dentro do Workspace com worktree próprio e grade própria [OBS: D24 "Workspace é um projeto base. A missão, sprint item paralelo..."]; **Session**: instância de CLI/PTY (ou vínculo tmux) restaurável de um Pane.
- **Modos de missão** `mode`: `free` (painéis manuais), `squad`, `agentic` (harness) — orquestração em spec-02 [OBS: D44/D73/D76].
- **workspace_owner** (a quem o painel pertence) vs **execution_cwd** (onde o terminal roda) [OBS: M01 "Isolamento"].
- **Orchestrator pane**: painel que hospeda o agente orquestrador (fixável, como qualquer outro).
- Atores: usuário (cria/fecha/arrasta painéis, atalhos); agente orquestrador (usa MCP para spawn/leitura/escrita de painéis); CLIs (processos filhos do PTY); sistema (renderer, supervisor de status, persistência).

## 4. Requisitos funcionais

Critérios de aceite (CA) curtos após cada requisito.

### 4.1 Pane / terminal
- **RF-01.01** O sistema DEVE hospedar cada Pane como PTY real, com o processo vivendo no processo principal (backend), independente do estado do renderer [OBS: D22 "processos de painel vivem no main process, o render pode zerar"; D28 "PTY reais"]. CA: recarregar o renderer (Cmd+R) não mata processos; painéis voltam ligados aos mesmos PTYs.
- **RF-01.02** Cada Pane DEVE ter `kind` em {`cli`, `shell`, `browser`} [OBS: M01 "Painel = terminal real... ou browser interno, ou um shell"]. CA: os três tipos criáveis pela UI.
- **RF-01.03** O Pane DEVE mostrar ID no header (visível mesmo pequeno), menu "…" (ações/informações), fixar, expandir/tela cheia, modo focado e destaque para janela própria [OBS: D23, D66, D54-55]. CA: todos os controles presentes e funcionais.
- **RF-01.04** Quando muitos painéis ficam pequenos, o header DEVERIA colapsar controles em "…" [OBS: M01 "Comportamento"]. CA: abaixo de largura mínima só ID + "…" visíveis. Limiar em px [DEC]: 220 px (não observado).
- **RF-01.05** O usuário DEVE poder fixar (pin) qualquer painel, não só o orquestrador [OBS: D80-81]. CA: painel fixado não é reordenado nem reciclado por "fechar terminados".
- **RF-01.06** Ao fechar um Pane o sistema DEVE encerrar o PTY em ≤ 500 ms sem bloquear a UI; o fechamento NÃO PODE esperar IPC síncrono [OBS: D23 bug "IPC close esperava até 4,5 s"; 500 ms é [DEC] como meta]. CA: clique em X remove o painel visualmente em < 200 ms.
- **RF-01.07** Novo Pane DEVE herdar provider/modelo do último painel do mesmo Workspace (ex.: GPT 5.5 → GPT 5.5) [OBS: D26]. CA: com último painel Gemini 3.1, "+ terminal" abre Gemini 3.1.
- **RF-01.08** Sub-agentes DEVEM sempre aparecer como Pane visível; o sistema NÃO DEVE executar workers ocultos [OBS: D23-D28]. CA: toda chamada `pane_spawn` cria Pane na grade.
- **RF-01.09** Provider/CLI por painel: o Pane registra `provider_id` e `account_id` (resolução em spec-03/04) e exibe o nome do tipo de terminal/CLI [OBS: M01 Relações; D26]. CA: header mostra provider e shell.
- **RF-01.10** Clicar em caminho de arquivo no output DEVERIA abri-lo; link quebrado em duas linhas DEVERIA abrir a URL inteira [OBS: D56 (1.3.1), D30]. CA: caminho `src/a.ts:10` abre o arquivo; URL quebrada por wrap abre completa. Detalhe da UI de abertura (editor interno vs SO) [LAC]; default [DEC]: abrir no visualizador de Files do Workspace.

### 4.2 Grade e layout
- **RF-01.10a** A grade DEVE suportar ≥ 64 Panes simultâneos por janela [OBS: D55, D68]. CA: 64 panes abertos e utilizáveis (ver RNF-01.N1).
- **RF-01.11** A região de painéis (terminais) e a região auxiliar de browsers (à direita) DEVEM ser independentes: novo Pane ignora browsers e terminais laterais à direita e NÃO PODE alterar a largura da região de browsers [OBS: D22 pedidos literais]. CA: com 1 browser à direita a 400 px, abrir 3 panes mantém 400 px.
- **RF-01.12** Um painel novo NÃO DEVE esticar/encolher vizinhos além do necessário para o repacking [OBS: D56 "painel não estica vizinhos"]. CA: abrir/fechar um pane não altera dimensões de panes não adjacentes. Algoritmo exato de layout [LAC]; ver [DEC] no 7.2.
- **RF-01.13** Tela cheia/expandir NÃO DEVE sobrepor a top bar [OBS: D54 bug]. CA: pane expandido preenche apenas a área da grade.
- **RF-01.14** Fechar/reabrir painéis NÃO DEVE fazer a grade sumir; fechamento em rajada (≥ 45) DEVE reempacotar sem travar [OBS: D54-55 bugs; "fechamento em rajada de 32 com repacking limpo"]. CA: fechar 64 panes em ≤ 5 s, grade íntegra.
- **RF-01.15** Um único atalho com Shift DEVERIA abrir painéis em massa (N configurável) [OBS: D68 "atalho com Shift"]. Valor de N e combinação exata [LAC]; default [DEC]: Cmd/Ctrl+Shift+T abre N=8 com N ajustável nas configurações.

### 4.3 Overdrive (renderização)
- **RF-01.20** O renderizador DEVE ser único por janela: uma superfície (canvas/WebGL, [OBS]: "WebGL/canvas" D66/arq.25) do tamanho da janela, com cada Pane como região pintada; NÃO DEVE haver uma superfície/webview por pane [OBS: D66]. CA: inspeção mostra 1 superfície de render para N panes.
- **RF-01.21** O sistema DEVE redesenhar apenas as regiões sujas (dirty rects); NÃO DEVE redesenhar a janela inteira por pane ocioso [OBS: D66 diagnóstico: verificador a cada 2 s forçava um redraw de tela cheia por painel]. CA: com 24 panes ociosos, 0 redraws por ciclo de 2 s; GPU ocioso ≤ ~0,2 unidades do baseline observado (ver RNF).
- **RF-01.22** Verificação de mudança de geometria por pane DEVE ser orientada a evento (resize/reposicionamento) e não por polling de 2 s [DEC — remove a causa raiz observada em D66; original manteve polling mas parou de redesenhar quando "não mudou"] . CA: sem timer periódico por pane; redraw apenas com evento.
- **RF-01.23** O sistema DEVE criar Panes sem bifurcar um "processo gordo": custo de criação por pane alvo ~1 ms (observado: de ~72 ms para ~1 ms) [OBS: D54]. CA: criar 32 panes em ≤ 0,4 s de trabalho de spawn (excluindo boot da CLI).
- **RF-01.24** DEVE existir switch de motor `render_engine` em {`overdrive`, `classic`} até o checkpoint de remoção do motor antigo; o motor clássico é alternativa/rollback [OBS: D54-55 "manter motor clássico... depois remover após checkpoint com rollback"]. CA: alternar exige reinício da janela e preserva Workspaces.
- **RF-01.25** Opções de performance DEVEM incluir: cursor piscando on/off, aceleração de hardware on/off, modo baixo uso de CPU/GPU, iniciar com GPU desabilitada [OBS: D23/D30]. CA: cada opção persiste e é aplicada no próximo start (a de GPU exige reinício).
- **RF-01.26** Painel de diagnóstico somente leitura com botão "copiar diagnóstico" (IDs de panes, divergências vs processos em background) [OBS: D22, D30]. CA: copiar gera texto JSON/markdown com versão, SO, engine, lista de panes e PIDs.

### 4.4 Workspace e isolamento
- **RF-01.30** O sistema DEVE suportar N Workspaces; header minimalista (nome, cor, seta; sem ícone) com botão de fechar workspace; fechar um workspace NÃO PODE fechar painéis de outro [OBS: D26, D30]. CA: fechar W1 mantém W2 intacto.
- **RF-01.31** Cada Pane DEVE ter `workspace_owner_id` imutável e `execution_cwd`; operações de arquivos ("Files") DEVEM mostrar somente o projeto do Workspace ativo [OBS: M01 "Isolamento"; D26 "Files"]. CA: Files do W2 nunca lista arquivos do W1.
- **RF-01.32** Política de acesso externo por Workspace `external_access` em {`none`?, `read`, `read_write`}: **padrão `read_write`** ("editar qualquer arquivo, para não quebrar hábito"); UI: menu da setinha do Workspace > Configurações (modal igual ao atual), NÃO nas configurações globais [OBS: D26/D28 (dois níveis + padrão)]. O valor `none` (bloqueio total) [LAC]: o material cita "acesso externo bloqueado" no teste, mas lista apenas os dois níveis. Default [DEC]: enumerar {`read_only`, `read_write`} como observado e tratar "bloqueado" como ausência de autorização de leitura/escrita fora do `execution_cwd` no nível `read_only` para escrita. CA: com `read_only`, escrita fora do workspace é negada com mensagem explicativa.
- **RF-01.33** Ao mudar a política, o rótulo (leitura/escrita) dos painéis abertos NÃO muda; só painéis novos refletem [OBS: D28 decisão]. A política efetiva do painel aberto DEVERIA seguir a do Workspace no enforcement [DEC — evita rótulo enganoso ficar aplicando regra antiga; lacuna sobre enforcement em painéis abertos: [LAC]]. CA: rótulo antigo permanece; enforcement conforme decisão do dono.
- **RF-01.34** Arquivos temporários do sistema (paste grande) DEVEM ser sempre legíveis pelo painel, independentemente da política [OBS: D28 "leitura do arquivo temporário era bloqueada pela política"; regra formulada como [DEC]]. CA: painel em `read_only` lê o temp de paste em `<app_tmp>/paste/`.
- **RF-01.35** A função única `resolve_target_workspace(context)` DEVE ser usada por todos os fluxos que criam Pane (Cmd/Ctrl+T, botão, MCP, restauração) [OBS: D26 regra literal]. Ordem: (1) em painel destacado → workspace_owner do painel; (2) em janela destacada → workspace da janela; (3) workspace visualmente ativo. NÃO PODE depender de "current workspace" global. CA: teste com 2 janelas e 2 workspaces abre sempre no correto.

### 4.5 Atalhos
- **RF-01.40** Cmd/Ctrl+T = novo terminal na Mission ativa; Cmd/Ctrl+N = nova janela [OBS: D26 decisão final]. CA: como no Chrome.
- **RF-01.41** Cmd/Ctrl+R e F5 DEVEM ser contextuais: recarregam browser ou shell conforme o painel focado (nunca recarregam o app inteiro por acidente) [OBS: D22]. CA: com painel browser focado recarrega a página; com shell focado, reinicia o shell (com confirmação [DEC]).
- **RF-01.42** Demais atalhos (fechar pane, navegar entre panes, focar, fixar, alternar missão) [LAC]; defaults [DEC]: Cmd/Ctrl+W fecha pane focado; Cmd/Ctrl+Alt+setas navegam; Cmd/Ctrl+1..9 alternam Mission; Cmd/Ctrl+Shift+F focado; F11 tela cheia do pane. Windows/Linux usam Ctrl no lugar de Cmd; Ctrl+C DEVE continuar sendo SIGINT no terminal (copiar usa Ctrl+Shift+C) [DEC].

### 4.6 Paste, bracketed paste e scroll
- **RF-01.50** O sistema DEVE aplicar limite de tamanho no paste (`paste_soft_limit`); acima, NÃO DEVE despejar cegamente no PTY: DEVE oferecer (a) enviar como arquivo temporário e injetar referência, ou (b) confirmar antes de enviar tudo [OBS: D26 plano do agente]. Valor do limite [LAC]; default [DEC]: 20.000 caracteres (o bug ocorreu com ~3.500 chars repetidos, mas aquilo foi fila sem controle, não tamanho isolado). CA: colar 100.000 chars mostra diálogo; colar 500 mil linhas não derruba a conexão [OBS: D65 "500 mil linhas e 5.000 linhas"].
- **RF-01.51** O envio de paste DEVE usar fila limitada (`paste_queue_max` [DEC]: 1 item em voo + 4 pendentes) e ser cancelável com ESC, esvaziando a fila [OBS: D26 "ESC não cancelava"]. CA: colar 5x rápido 3.500 chars, ESC interrompe e nada mais é enviado.
- **RF-01.52** Paste multilinha DEVE usar bracketed paste (`ESC[200~ … ESC[201~`) quando a aplicação no PTY habilitou o modo 2004; caso contrário DEVE enviar sem marcadores [OBS: D28 revisão apontou ausência; se foi corrigido [LAC]; comportamento correto padrão de terminais é [DEC]]. CA: colar 3 linhas em CLI que ativa 2004 não executa linha a linha. Conteúdo colado DEVE ter `ESC[201~` sanitizado [DEC — segurança].
- **RF-01.53** Colar imagem (Ctrl/Cmd+V) DEVE salvar em arquivo temporário e injetar o caminho para a CLI; no Windows, "print" não cola direto: aceitar arrastar arquivo [OBS: D22 "Ctrl+C/Ctrl+V de imagem direto no chat"; Windows em M01 "Paste"]. Captura em si: spec do Overclock Shot.
- **RF-01.54** Scroll: se o usuário está no fim do buffer, o viewport DEVE acompanhar o output; se rolou para cima, NÃO DEVE ser puxado para baixo nem pular para o topo [OBS: D26 bug 4; D30]. CA: durante `yes | head -n 100000`, rolar para cima mantém posição; voltar ao fim retoma o follow.
- **RF-01.55** Seleção de texto durante scroll DEVE funcionar; redimensionar NÃO DEVE perder a diagramação nem cortar texto de TUIs (ex.: Claude) [OBS: D30, D54]. CA: resize com Claude Code aberto redesenha sem texto truncado (envia SIGWINCH com cols/rows corretos).

### 4.7 Shell padrão e tipo de terminal
- **RF-01.60** Configuração `default_shell` em {`bash`, `zsh`, `sh`, `dash`} (+ do SO conforme 6.d); trocar DEVE valer para novos Panes e o nome do shell DEVE aparecer no painel [OBS: D26 bug 6, verificado com bash/zsh/dash]. CA: trocar para dash abre `echo $0` = dash em novo pane; painéis existentes não mudam.
- **RF-01.61** Em Workspace SSH o shell remoto é escolhido pelo servidor (dash quando root, "mantém assim") [OBS: M01 "Tipo de terminal"]. Se a troca local vale para o remoto: [LAC]; default [DEC]: não vale; shell remoto configurável separadamente em `remote.default_shell`, padrão = shell de login do usuário no servidor.
- **RF-01.62** Windows/Linux: lista de shells DEVERIA incluir PowerShell/cmd (Windows) [DEC — o material só lista shells POSIX]. Caminhos com espaço DEVEM funcionar (bug Codex/Windows) [OBS: D24].

### 4.8 Mission e worktree
- **RF-01.70** O sistema DEVE permitir múltiplas Missions por Workspace, exibidas em **barra superior**; cada Mission tem git worktree próprio e grade própria [OBS: D24 decisão "missões ao topo"; barra lateral e "missões ao lado do workspace" rejeitadas]. CA: criar 2 missions cria 2 worktrees distintos e 2 grades independentes.
- **RF-01.71** Missão suporta renomear, recolher e cor distinta; trocar de Mission NÃO DEVE quebrar layout, nem abrir painéis pedidos por uma Mission dentro de outra [OBS: D24 bugs]. Spawns pedidos por MCP DEVEM carregar `mission_id` explícito e abrir nesta missão, mesmo que o usuário tenha trocado de missão depois [DEC — corrige bug observado "swarm abre na missão nova"]. CA: pedir swarm, trocar de missão, painéis aparecem na missão de origem.
- **RF-01.72** Limites por Plan (nº máx. de panes/missions/workspaces) DEVEM ser consultados via Entitlement; sem limites definidos = ilimitado [LAC: material diz que "terminais múltiplos" é do Boost+, mas não dá números; default [DEC]: hook `entitlements.check("panes.max")`, Livre ⇒ 4 panes (coerente com a observação "8 GB = ~4 terminais", apenas como default)].
- **RF-01.73** Criação do worktree: `git worktree add <path> -b overclock/<mission_slug>` a partir do HEAD da branch base do Workspace [DEC — fluxo git não descrito]. Diretório fora do repositório: `<workspace_root>/../.overclock-worktrees/<workspace_slug>/<mission_slug>` [DEC]. Workspace sem git: Mission compartilha o diretório (sem worktree) e o sistema avisa [DEC/LAC]. CA: fechar a Mission NÃO apaga o worktree sem confirmação.
- **RF-01.74** A unificação de worktrees (merge por agente revisor) é fase 2; o sistema DEVE apenas expor o estado de cada worktree (branch, ahead/behind, sujo) e permitir abrir painel do agente revisor via spec-02 [OBS: M01 "planejada"; DEC: escopo mínimo].

### 4.9 Multi-janelas
- **RF-01.80** Arrastar o nome do Workspace para fora da janela DEVE abrir nova janela mantendo o vínculo ao Workspace; arrastar de volta une; nome do Workspace no título/ícone da janela [OBS: D23]. CA: arrastar e devolver deixa 1 janela, Workspace correto, sem janela vazia sobrando.
- **RF-01.81** Arrastar um Pane para fora DEVE abrir janela contendo só aquele Pane, ainda no mesmo Workspace (com permissão de abrir mais panes nela); devolver só é permitido ao Workspace original e fecha a janela [OBS: D23]. CA: nenhum pane duplica; PTY é o mesmo (sem reiniciar CLI) durante o move.
- **RF-01.82** Feedback de arraste DEVE ser estilo aba do Chrome (elemento translúcido); NÃO DEVE haver flicker nem botão "popup" que salta tela [OBS: D23 pedidos]. Janelas novas DEVEM ser centralizadas (correção 0.3.5) [OBS: D22].
- **RF-01.83** Cada janela DEVE ter estado próprio `active_workspace_id`/`active_mission_id`; a arquitetura (1 processo backend, N janelas) [LAC: "ausência de detalhe de rede do multi-janela"]; default [DEC]: um backend único, N janelas de UI conectadas por IPC, PTYs pertencem ao backend (por isso mover pane entre janelas é troca de "view", não de processo).
- **RF-01.84** Uma janela DEVE fechar automaticamente quando seu último Pane é devolvido/fechado (se for janela de pane destacado) [OBS: D23 bug "não fechava"]. CA: janela de pane destacado some ao devolver.

### 4.10 SSH remoto e tmux
- **RF-01.90** Workspace pode ser `local` ou `remote` (SSH, host já existente em `~/.ssh/config` ou cadastrado); cockpit roda local, processos dos panes executam no host; SSH é só transporte [OBS: D23 texto do agente]. CA: `hostname` no pane remoto retorna o servidor.
- **RF-01.91** Ao abrir workspace remoto o sistema DEVE testar conexão, verificar pré-requisitos (CLI de IA instalada e logada, Node, etc.) e abrir wizard guiado se faltarem; DEVE detectar CLIs instaladas no host remoto [OBS: D23; D26 bug 7 "não detectava CLIs"]. CA: VPS sem CLI → wizard; VPS com Claude logado → abre direto.
- **RF-01.92** O processo remoto NÃO PODE ficar preso à conexão: DEVE rodar em sessão persistente (tmux) no servidor, sobrevivendo a queda de rede/fechamento do notebook [OBS: D23 texto do agente]. Nomeação das sessões criadas pelo Overclock: `oc-<workspace_slug>-<pane_id>` [DEC].
- **RF-01.93** Dois panes no mesmo host NÃO DEVEM duplicar o shell (bug observado); cada Pane mapeia 1:1 a uma sessão tmux [OBS: D26 bug; DEC: regra 1:1]. CA: 2 panes = 2 sessões distintas, cada uma com um shell.
- **RF-01.94** Ao reabrir o app, panes remotos DEVEM restaurar sessão (reatachar) [OBS: D26 "SSH não restaura sessão" como bug remanescente → requisito]. CA: reabrir reata `tmux attach` nas sessões vivas.
- **RF-01.95** Sessões tmux externas (D61): ao conectar, executar `tmux ls` pela conexão SSH aberta, sem instalar nada no servidor, e listar sessões do Overclock e externas com nome real, idade e se há cliente anexado ("alguém olhando") [OBS: D61]. CA: lista mostra name, age, attached.
- **RF-01.96** Adoção é sempre manual: identificar é automático, abrir nunca (`never auto-attach`); ao abrir, nasce Pane normal com selo permanente "externo"; fechar o Pane só desanexa (a sessão continua); o app NUNCA envia `kill-session`, `exit` nem renomeia sessões externas [OBS: D61]. CA: fechar pane externo → `tmux ls` no servidor ainda lista a sessão.
- **RF-01.97** Sessão externa encerrada no servidor DEVE mostrar aviso "sessão encerrada no VPS" com botão de encerrar; NUNCA reconecta/recria em loop [OBS: D61]. CA: matar a sessão no servidor gera 1 aviso, 0 tentativas automáticas.
- **RF-01.98** Ao reabrir o app, vínculos com sessões externas ainda existentes DEVEM reatar sozinhos (contradição aparente com "abrir é manual" resolvida: reatar é de vínculo já adotado pelo usuário) [OBS: D61 "vínculos reatam sozinhos"; interpretação = [DEC]]. CA: sessão adotada volta após restart; sessão não adotada continua só listada.
- **RF-01.99** Falta `tmux` no servidor: fallback [LAC]; default [DEC]: avisar e permitir pane SSH direto (sem persistência), com selo "sem persistência".

### 4.11 Cadeado
- **RF-01.100** O dialog de spawn de squad DEVE ter um botão cadeado (estado inicial: destravado/"livre" [OBS: D61]). Com cadeado ativo, mudar a CLI/provider de um worker aplica a mesma CLI a todos os workers do dialog [OBS: D61 "troquei aqui, já abre todos de uma vez"]. CA: ativar cadeado, mudar worker 1 para Codex → workers 2..N = Codex. Com cadeado inativo só o worker editado muda.
- **RF-01.101** Se um provider não está disponível/autenticado para algum worker, o cadeado DEVE manter os demais e sinalizar o worker incompatível em vez de falhar o spawn [DEC]. Também: o orquestrador que respawna worker fechado DEVE reutilizar o mesmo briefing e o Pane novo recebe novo ID (registrar vínculo `respawn_of`) [OBS: D61].

### 4.12 Semáforo (sinaleira)
- **RF-01.110** Cada Pane com CLI DEVE exibir `status` em {`ready` (verde), `working` (amarelo), `needs_user` (vermelho)}; a Mission na barra lateral/superior DEVE refletir a cor agregada [OBS: D81, arq.07/08]. Agregação [DEC]: prioridade vermelho > amarelo > verde.
- **RF-01.111** `needs_user` DEVE ocorrer quando o agente para e aguarda resposta/permissão do usuário; em modo bypass-permission a CLI não pergunta e, portanto, não ficará vermelho (bug/limite observado) [OBS: D80-81]. Critério de detecção (hook da CLI vs parsing do output) [LAC — "o critério exato foi ditado de formas diferentes"]. Default [DEC]: usar sinais de hook/evento da CLI quando disponíveis (Hook em spec-05), com fallback heurístico por inatividade de output + padrão de prompt.
- **RF-01.112** Botão de pausa DEVE interromper a tarefa (SIGINT/ESC ao PTY) e descartar o prompt pendente [OBS: D81]. CA: após pausa status volta a `ready`, prompt pendente removido.
- **RF-01.113** Painel aguardando interação DEVE ter destaque visual (borda/pulso) [OBS: D61]. A "bolinha azul fixa" anterior é removida [OBS: D80]. Ícone de modo no painel: `free`, `agentic`, squad ("pessoinhas") [OBS: D80-81].
- **RF-01.114** Acessibilidade: a cor NÃO DEVE ser o único sinal (adicionar ícone/forma/tooltip) [DEC — pauta M01 Soft: público 25-45, visão reduzida, padrões corporativos].

### 4.13 Persistência e restauração
- **RF-01.120** Estado de layout (Workspaces, Missions, ordem/tamanho/pin dos Panes, janelas) DEVE persistir em SQLite local a cada mudança (debounce ≤ 500 ms [DEC]); Windows não pode depender de localStorage do renderer [OBS: D22 bug "Windows perdia sessão (localStorage)"; SQLite em M01 "Stack"].
- **RF-01.121** Pane recovery: após reload do renderer, o sistema DEVE reconstruir a grade a partir do estado do backend, incluindo buffer recente [OBS: D22 teste: digitar "teste" em dois painéis, Cmd+R, voltam "100%"]. CA: mesmo conteúdo visível pós-reload.
- **RF-01.122** Reabrir o app DEVE oferecer prompt opcional "restaurar terminais anteriores?" (por Workspace ou todos); NÃO DEVE restaurar terminais já fechados pelo usuário [OBS: D61 bug]. CA: pane fechado explicitamente não aparece; panes abertos na saída aparecem se o usuário aceitar.
- **RF-01.123** Resume por provider: `session_ref` por Pane; Claude retoma sessão nativa; Codex e Gemini usam fallback/resume; lista de sessões ordenada por último uso [OBS: D22]. Mecanismo por CLI: spec-04. Ao relançar, o sistema DEVE injetar o brief de memória (spec-06) [OBS: D29].
- **RF-01.124** O orquestrador restaurado DEVE voltar como orquestrador (`role=orchestrator` persistido) [OBS: D66 "pendente" → requisito; falha observada em D65/roteiro 1.3.8].
- **RF-01.125** Escritas de Mission/Pane/close_pane DEVEM ser transacionais [OBS: M01 "revisão apontou falta de transação"]. CA: falha no meio não deixa missão sem panes/painéis órfãos.
- **RF-01.126** SQLite DEVE registrar auditoria de missões/painéis/sessões/eventos (tabela `pane_events`) [OBS: M01 "Fase 0.x"].

### 4.14 Interface MCP de painéis (consumida pela spec-02)
- **RF-01.130** O sistema DEVE expor tools MCP `pane_spawn`, `pane_read`, `pane_write`, `pane_close`, `pane_list`, `pane_status` (seção 6c) [OBS: M01 "MCP interno com tools de spawn/leitura/escrita"; `pane_read` limitado a 40 linhas ignorando `last_n` foi bug → requisito]. `pane_read` DEVE respeitar `last_n` (padrão 40, máximo 2.000 [DEC]).
- **RF-01.131** A montagem de briefing NÃO DEVE viver dentro da função de spawn de PTY (separar `PtyService.spawn` de `BriefingBuilder`) [OBS: D29 crítica: `spawn` de ~520 linhas; separação é [DEC]].

## 5. Modelo de dados

Persistência: SQLite único (`overclock.db`) no diretório de dados do app; migrações versionadas [DEC]. Buffers de terminal recentes: ring buffer em memória + snapshot em disco em `sessions/<pane_id>.log` (últimas N linhas) [DEC].

### 5.1 Entidades

**Workspace**: `id` (uuid, obrig.), `slug` (kebab-case, único), `name`, `color` (hex, default por paleta), `kind` (`local`|`remote`, default `local`), `root_path` (obrig.), `remote` (obj|null: `host`, `port`=22, `user`, `identity_ref`), `external_access` (`read_only`|`read_write`, default `read_write` [OBS]), `default_shell` (nullable → global), `provider_default` (nullable), `created_at`, `closed_at` (nullable). Invariante: `remote != null` ⇔ `kind=remote`.

**Mission**: `id`, `workspace_id` (FK), `slug`, `name` (renomeável), `mode` (`free`|`squad`|`agentic`, default `free`), `worktree_path` (nullable), `branch` (nullable), `base_branch`, `color`, `collapsed` (bool), `layout` (json, ver Layout), `status_agg` (derivado), `created_at`, `closed_at`. Invariante: `worktree_path` único por Mission.

**Pane**: `id` (curto legível exibido no header, ex.: `p-014` [DEC]; nunca reutilizado), `workspace_owner_id` (FK, imutável), `mission_id` (FK), `window_id`, `kind` (`cli`|`shell`|`browser`), `provider_id` (nullable), `account_id` (nullable), `model` (nullable), `role` (`worker`|`orchestrator`|`reviewer`|`free`, default `free`), `execution_cwd`, `shell` (nullable), `pinned` (bool), `status` (`ready`|`working`|`needs_user`|`exited`|`ended_remote`), `external` (bool, default false), `tmux_session` (nullable), `pid` (nullable), `respawn_of` (nullable pane_id), `session_ref` (nullable: id de sessão da CLI), `access_label` (`read_only`|`read_write`, fixado no spawn [OBS]), `created_at`, `closed_at`, `closed_by` (`user`|`agent`|`system`).

**WindowState**: `id`, `kind` (`main`|`workspace`|`pane`), `workspace_id`, `pane_id` (nullable), `bounds` {x,y,w,h}, `active_mission_id`.

**PaneEvent**: `id`, `pane_id`, `type` (enum 6.b), `payload` (json), `ts`.

**Settings (escopo terminal)**: `render_engine` (`overdrive`), `cursor_blink`, `hw_accel` (true), `low_power` (false), `gpu_disabled_start` (false), `default_shell`, `paste_soft_limit` (20000), `restore_prompt` (true), `theme` (`dark`|`light`|`gray`|`red`; default `dark` [OBS: audiência escolheu escuro D81]).

**Layout (json)**: `{ "terminal_region": { "order": ["p-001", ...], "sizes": {"p-001": 1.0}, "pinned": [...] }, "browser_region": { "width_px": 400, "panes": [...] }, "focused": "p-001"|null, "fullscreen": null }`.

### 5.2 Exemplo JSON
```json
{
  "pane": {
    "id": "p-014", "workspace_owner_id": "0b7c…", "mission_id": "5d1e…",
    "kind": "cli", "provider_id": "claude-code", "account_id": null, "model": "opus-4.7",
    "role": "worker", "execution_cwd": "/work/app/.overclock-worktrees/app/sprint-a",
    "status": "working", "pinned": false, "external": false,
    "tmux_session": null, "session_ref": "b3c1…", "access_label": "read_write"
  }
}
```

### 5.3 Ciclo de vida do Pane
`spawning → ready ⇄ working ⇄ needs_user → exited (processo terminou) → closed`; remoto externo: `… → ended_remote → closed`. Pane `closed` não é restaurado. O `id` nunca é reutilizado; respawn gera novo id com `respawn_of`.

## 6. Interfaces

### 6.a UI/UX
- **Layout da janela** [OBS: D24/M01]: barra superior de Missions (aprovada; renomear, recolher, cor); grade central; região auxiliar de browsers à direita; lateral com Discord/diagnóstico/configurações. Header preto na barra de missões [OBS: D24].
- **Header do Pane**: ID, provider/shell, ícone de modo (livre/agêntico/pessoinhas), semáforo, botões: fixar, focar, expandir, destacar, "…" (informações, fechar, copiar ID).
- **Workspace header**: nome, cor, seta (menu: Configurações [modal de política de acesso externo e shell], Fechar workspace). Botão "+ terminal".
- **Diálogo de restauração**: "Restaurar terminais da última sessão?" [texto DEC].
- **Diálogo de paste grande**: "Texto grande (N caracteres). Enviar como arquivo temporário / Enviar mesmo assim / Cancelar" [texto DEC]; ESC = cancelar.
- **Sessões tmux (VPS)**: painel listando `name`, `idade`, `anexada`, selo "externo"; ação "Abrir" (manual). Aviso: "sessão encerrada no VPS" + botão "Encerrar".
- **Dialog de spawn de squad** (parte terminais): linha por worker com seletor de CLI; cadeado.
- **Temas**: dark, light, gray, red; contraste mínimo WCAG AA [DEC]; cores dos workers legíveis no claro (bug 1.4.7 [OBS]).
- **Textos**: usar "terminal" na UI; "painel" permitido em site/docs [OBS: D61].

### 6.b IPC / eventos (backend ↔ renderer; nomes [DEC], semântica [OBS] quando indicado)
Comandos: `workspace.create|close|update_settings`, `mission.create|rename|close|switch`, `pane.spawn|close|write|resize|pin|move_window|restore`, `window.detach_workspace|detach_pane|reattach`, `remote.test_connection|list_tmux|adopt_tmux`, `settings.update`, `diagnostics.export`.
Eventos (backend → UI), payload sempre com `pane_id` e `ts`:
- `pane.output {pane_id, data(bytes b64)}` (coalescido a ≤ 60 Hz por pane [DEC]);
- `pane.status_changed {pane_id, from, to, reason}`;
- `pane.exited {pane_id, code}`; `pane.ended_remote {pane_id, tmux_session}`;
- `pane.created`, `pane.closed {closed_by}`; `layout.changed {mission_id, layout}`;
- `mission.status_agg_changed {mission_id, status}`; `window.created|closed {window_id}`.
Pane input: `pane.write {pane_id, data, bracketed:bool, source:"user"|"agent"|"paste"}`.

### 6.c Tools MCP (contrato consumido por spec-02; nomes com prefixo `pane_` [OBS: `pane_read` citado; demais [DEC]])
| Tool | Entrada (JSON schema resumido) | Saída | Erros |
|---|---|---|---|
| `pane_spawn` | `{mission_id:string, provider_id:string, model?:string, account_id?:string, role?:enum, cwd?:string, briefing?:string, name?:string}` (obrig.: `mission_id`,`provider_id`) | `{pane_id, status}` | `mission_not_found`, `provider_unavailable`, `entitlement_exceeded`, `cwd_outside_workspace` |
| `pane_read` | `{pane_id, last_n?:int=40 (1..2000)}` | `{lines:string[], truncated:bool, status}` | `pane_not_found`, `pane_closed` |
| `pane_write` | `{pane_id, text, submit?:bool=true}` | `{accepted:bool, queued:int}` | `pane_not_found`, `paste_too_large`, `access_denied` |
| `pane_close` | `{pane_id, reason?}` | `{closed:true}` | `pane_not_found`, `pane_pinned` (a menos que `force`) |
| `pane_list` | `{mission_id?, workspace_id?}` | `[{pane_id, role, provider_id, status, pinned, external}]` | — |
| `pane_status` | `{pane_id}` | `{status, since_ts, last_output_ts}` | `pane_not_found` |
Regras: `pane_spawn` cria sempre Pane visível (RF-01.08); `pane_write` de agente respeita `paste_soft_limit` (escreve arquivo temporário e envia referência).

### 6.d CLI / protocolos externos
- **PTY**: `openpty`/ConPTY (Windows) [DEC], `TERM=xterm-256color`, `COLORTERM=truecolor` [DEC]; SIGWINCH no resize.
- **SSH**: cliente OpenSSH do sistema ou libssh equivalente [DEC]; canais reaproveitados (conexão única por host e multiplexação) [OBS: "conexão SSH que já mantém"]; `tmux ls -F '#{session_name}|#{session_created}|#{session_attached}'` [DEC formato; comando `tmux ls` = OBS], `tmux new-session -A -s <name>`/`tmux attach -t <name>`.
- **git**: `git worktree add|list|remove`.
- **Shells**: bash, zsh, sh, dash [OBS]; PowerShell/cmd [DEC].

## 7. Fluxos e algoritmos

### 7.1 Resolver workspace de novo painel (RF-01.35)
```
resolve_target_workspace(ctx):
  if ctx.pane and ctx.pane.detached: return ctx.pane.workspace_owner_id
  if ctx.window.kind in (workspace,pane): return ctx.window.workspace_id
  return ctx.window.active_workspace_id   # "visualmente ativo"; nunca variável global
```
Provider/modelo: `last = último pane criado no Workspace`; herdar `provider_id/model/account_id` (conta pode ser reavaliada pela Policy em spec-03).

### 7.2 Layout de grade [DEC — algoritmo não descrito]
Região de terminais em grid automático: `cols = ceil(sqrt(n * aspect))`, `rows = ceil(n/cols)`; pane pinned/focado ocupa slot maior; na inserção, apenas o slot afetado e vizinhos imediatos recalculam; a largura da região de browsers é constante (RF-01.11). Acima de 16 panes, headers colapsam para "…" e o texto pode ser renderizado em fonte reduzida. Sugestão do original (células 1–4 fixas) é fase 2.

### 7.3 Spawn em massa (Overdrive)
1. UI envia `pane.spawn` em lote (N) — um único comando IPC com N specs [DEC].
2. Backend aloca `pane_id`s, insere em transação `Pane` (status `spawning`), atualiza layout uma vez.
3. Cria PTYs via `posix_spawn` direto ao shell/CLI (sem fork do processo principal) [OBS: "spawn sem fork do processo gordo"].
4. UI recebe `layout.changed` único e pinta todas as regiões num frame.
5. Boot das CLIs ocorre em paralelo com limite de concorrência `spawn_concurrency` (default 8 [DEC]) para não saturar CPU; painéis aparecem imediatamente com estado `spawning`.
Metas: ver seção 9.

### 7.4 Paste
```
on_paste(text):
  if len(text) <= soft_limit: enqueue(chunks(text, 4KB))  # bracketed se modo 2004
  else: show_dialog(temp_file | confirm | cancel)
  temp_file: escreve <app_tmp>/paste/<ts>.txt ; injeta "@<path>" ou path conforme provider [DEC]
enqueue: fila máx paste_queue_max; ESC => clear queue + abort in-flight
```
Envio em chunks de 4 KB com backpressure do PTY (respeita write readiness) [DEC].

### 7.5 Máquina de estados do semáforo
| Estado \ Evento | output_started / prompt_submitted | tool_permission_request / question_shown | task_done (idle) | user_answers | pause_clicked | process_exit |
|---|---|---|---|---|---|---|
| `ready` | `working` | `needs_user` | `ready` | `ready` | `ready` | `exited` |
| `working` | `working` | `needs_user` | `ready` | `working` | `ready` | `exited` |
| `needs_user` | `needs_user` | `needs_user` | `ready` | `working` | `ready` (descarta prompt) | `exited` |
Fonte dos eventos: [LAC] (7.5/RF-01.111). Default [DEC]: hooks de CLI → fallback heurístico (sem bytes por ≥ 3 s e cauda casa padrão de pergunta/confirmação). Bypass-permission ⇒ nunca `needs_user` por permissão [OBS].

### 7.6 Drag & drop de janelas
1. Iniciar arraste no nome do Workspace (ou header do Pane) fora da janela por > 24 px [DEC] → cria `WindowState(kind=workspace|pane)` referenciando `workspace_id`.
2. Painéis existentes mudam `window_id`; PTYs inalterados.
3. Soltar sobre a janela de origem (só ela aceita Workspace original) → `reattach`: painéis voltam a `window_id` de origem; janela criada é fechada; se janela de origem já foi fechada, criar nova janela principal [DEC].
4. Se o último pane de uma janela de pane é fechado, fechar janela.

### 7.7 Restauração
1. Ao iniciar: ler `Workspace/Mission/Pane` com `closed_at IS NULL`.
2. Se `restore_prompt`, perguntar; se sim, para cada pane `cli`: relançar com `session_ref` (resume) + brief de memória; `shell`: novo shell no `execution_cwd`; `remote`: `tmux attach`; `external`: reatar apenas se a sessão existe (senão marcar `ended_remote`, sem loop).
3. `role=orchestrator` restaurado como orquestrador.
4. Se a restauração falhar em um pane: estado `exited` com botão "reiniciar"; não bloquear os demais (evita o travamento observado em D61).

### 7.8 Fechamento em rajada
Marcar panes `closing` na UI imediatamente, matar PTYs em paralelo (SIGHUP → 300 ms → SIGKILL [DEC]), repack único do layout ao final; transação única em SQLite.

### 7.9 Casos-limite
Pane cujo `cwd` foi apagado → erro `cwd_missing`, oferecer `$HOME`; SSH cai durante uso → pane marca `disconnected` e reconecta com backoff exponencial (máx 5 tentativas, [DEC]) exceto sessão externa encerrada (RF-01.97); duas janelas apontando para o mesmo pane → proibido (um pane pertence a exatamente uma janela).

## 8. Prompts e textos embutidos

O produto usa principalmente prompts de testes/aceite e textos de UI. Verbatim/quase verbatim do material:

- **Teste de escala** [OBS: D66/D65]: `Abra 15 painéis nessa mesma missão e digite e pergunte para todos eles quanto é um mais um.` (deve ser executado com Codex).
- **Teste de isolamento** [OBS: D26]: `Workspace isolado. Abra um pane dentro deste workspace, liste o diretório atual e depois tente ler um arquivo fora deste workspace. Quando tiver autorização, explique o acesso externo. Explique o acesso externo está bloqueado.`
- **Teste do semáforo** [OBS: D80-81]: `Abre um pane novo [...] Cria um arquivo chamado teste semáforo com a palavra oi dentro.`
- **Teste do cadeado** [OBS: D61]: `Abre uma missão squad, piloto Claude ou Codex. Então vamos colocar tudo Codex. Quero fazer um site.`
- **Limpeza** [OBS: D61]: `Fecha os painéis que já terminaram seus serviços.`
- **Regra "novo painel"** [OBS: D26]: "Command T deve sempre usar o workspace visualmente ativo. Se estiver em janela destacada, usa o workspace daquela janela. Se estiver em pane destacada, usa o workspace dono daquele pane. Não deve depender de current workspace global."
- **Texto SSH** [OBS: D23] e **texto tmux** [OBS: D61]: transcritos em M01; devem ser usados como copy de onboarding do wizard remoto e do painel de sessões (idem: "Nunca autoabrimos sessão dos outros, seria invadir"; "O Overclock é janela, não dono").
- **Mensagens** [DEC, não observadas]: `access_denied`: "Acesso externo bloqueado neste workspace (somente leitura). Ajuste em Workspace > Configurações."; `ended_remote`: "sessão encerrada no VPS".
- **Prompt-base para wizard remoto** [LAC/DEC]: sem prompt original; usar checklist determinístico (ssh ok → tmux presente → CLI presente → login), sem LLM.

## 9. Requisitos não-funcionais

**Desempenho (observado, falado/ruidoso — usar como metas, não garantias [OBS: M01 "Incertezas"])**:
- RNF-01.P1 Abrir 32 panes em ≤ 2 s (meta ≤ 0,4 s de spawn/UI; alvo interno 0,3 s) [OBS: D54; ganho ~100x]; 64 panes em ≤ 5 s [OBS: D55]. Motor 1.2.4 anterior: 12 panes ≈ 9 s, 17 ≈ 20 s (baseline de regressão) [OBS: D54].
- RNF-01.P2 Custo de criação por pane ≈ 1 ms (antes ≈ 72 ms) [OBS: D54].
- RNF-01.P3 Painel ocioso ≈ 5% GPU no defeito original; alvo pós-correção: sem crescimento linear (24 ociosos não devem ≈ 84%) [OBS: D66]; tempo de pintura observado 93→33 ms/s.
- RNF-01.P4 Memória: ~300–500 MB por CLI Claude Code (dependente da CLI, não do app); 8 GB ≈ 4 terminais [OBS: D44/D55/D82]. O app DEVE reportar pressão de memória e sugerir fechar panes [DEC].
- RNF-01.P5 15 panes: ≤ 38 processos totais observados (referência de regressão) e sem travar [OBS: D66].
- RNF-01.P6 Fechar 45 panes em rajada não trava a UI (> 100 ms sem frame proibido) [OBS: bug D54; limite [DEC]].
- RNF-01.P7 Frame budget do renderer: 60 fps com 32 panes ativos sob saída moderada [DEC].

**Portabilidade**: macOS (ARM/x64), Windows 11 x64 e Linux x64 são alvos de primeira classe [OBS: D49/D66/D68]; Windows: ConPTY, caminhos com espaço, Ctrl+V/imagem, app na barra de tarefas (bug 1.3.5) [OBS]; Linux: bug Hyprland/Wayland [OBS: D24]. Teste em 3 SOs antes de release [OBS].

**Segurança**: isolamento por Workspace (RF-01.31/32); sessões tmux externas nunca são adotadas ou alteradas automaticamente [OBS]; credenciais SSH via agente/keychain, nunca persistidas em texto claro [DEC]; sanitização de `ESC[201~` no paste [DEC]; temp de paste com permissão 0600 e limpeza em ≤ 24 h [DEC]. Segurança de VPS: spec-18.

**Privacidade**: buffers/snapshots de terminal ficam locais; "copiar diagnóstico" NÃO DEVE incluir conteúdo de buffer, apenas metadados [DEC].

**Custo/tokens**: nada roda em background oculto = controle de tokens [OBS: D26]; o chassi não consome tokens próprios.

**Observabilidade**: `pane_events` (RF-01.126), painel de diagnóstico, logs por pane, métricas de spawn/paint em modo debug [DEC].

**Acessibilidade**: contraste AA, não depender só de cor, tamanhos escaláveis, foco por teclado [DEC; motivação OBS: M01 Soft D24].

## 10. Stack sugerida e restrições

**Original [OBS]:** fase 0.x Electron + PTY real, SQLite, MCP interno, GitHub Actions; fase 1.x Rust + Tauri (incerto: "tower/Tauri"), renderizador único WebGL/canvas (Overdrive), tmux via SSH, git worktree.
**Alternativas neutras [DEC]:** backend em Rust (`portable-pty`, `russh`/OpenSSH, `rusqlite`) ou Node (`node-pty`, `ssh2`); terminal emulation: xterm.js com WebGL addon ou `wezterm-term`/`alacritty_terminal` no backend com render em canvas; janela: Tauri ou Electron (Electron é mais simples para multi-janela; escolha pelo time). Restrições: PTYs no backend (RF-01.01); um renderer por janela (RF-01.20); nenhum requisito de instalar software no servidor remoto além de `tmux` e a CLI (RF-01.95).

## 11. Plano de implementação em fases

1. **F0 — Núcleo**: Workspace/Mission/Pane no SQLite; PTY no backend; um pane com shell; grade simples; resize/scroll correto (RF-01.01, .54, .55, .60).
2. **F1 — MVP local**: múltiplos panes e workspaces; Cmd/Ctrl+T/N/R; resolve_target_workspace; herança de provider; header e menu; pin/focus/expand; paste com limite/ESC/bracketed; persistência e pane recovery; diagnóstico.
3. **F2 — Missions**: barra superior, worktrees, isolamento `external_access`, MCP `pane_*` (contrato para spec-02).
4. **F3 — Overdrive**: renderer único, dirty rects, spawn em lote, benchmarks (32/64 panes), engine switch.
5. **F4 — Multi-janelas** e restauração com prompt, resume por provider.
6. **F5 — SSH/tmux**: workspace remoto, wizard, sessões persistentes, sessões externas.
7. **F6 — Semáforo, cadeado, temas, acessibilidade, opções de performance.**
8. **Fase 2 (pós-MVP)**: unificação automática de worktrees, grids fixos, missões compartilhadas.
Dependências: F2 precisa de F1; F3 pode iniciar após F1 com switch clássico; F5 depende de F1 e spec-18; F6 depende de spec-05 (hooks) para o semáforo confiável.

## 12. Casos de teste de aceitação

1. **Feliz — novo painel herdando provider.** Dado Workspace W1 com último pane Gemini 3.1, Quando Cmd/Ctrl+T, Então abre novo pane em W1 com Gemini 3.1.
2. **Workspace correto em janela destacada.** Dado W1 e W2 e janela destacada de W2 focada, Quando Cmd/Ctrl+T, Então o pane nasce em W2, nunca em W1.
3. **Recovery.** Dado 2 panes com "teste" digitado, Quando Cmd+R no renderer, Então PTYs permanecem, grade e conteúdo voltam iguais.
4. **Layout auxiliar.** Dado 1 browser à direita com 400 px, Quando abrir 3 panes, Então largura do browser permanece 400 px e panes ignoram o browser.
5. **Paste grande.** Dado paste de 100.000 caracteres, Quando colar, Então aparece diálogo; ESC cancela sem escrever no PTY; escolher "arquivo temporário" injeta referência legível mesmo em `read_only`.
6. **Paste em rajada.** Dado 5 pastes rápidos de 3.500 caracteres, Quando ESC durante o envio, Então a fila é esvaziada e nenhum byte adicional é enviado (limite: ≤ 1 chunk em voo).
7. **Bracketed paste.** Dado CLI com modo 2004 ativo, Quando colar 3 linhas, Então o PTY recebe `ESC[200~…ESC[201~` e nenhuma linha executa antes do Enter.
8. **Scroll.** Dado saída contínua, Quando o usuário rola para cima, Então viewport não é puxado; ao voltar ao fim, retoma o follow.
9. **Isolamento.** Dado W1 `read_only`, Quando o agente tenta escrever fora de W1, Então `access_denied`; mudar para `read_write` afeta apenas novos panes no rótulo.
10. **Escala.** Dado a instrução de teste 15 panes/"1+1" em Codex, Então 15 panes abrem sem travar e respondem; e 64 panes abrem em ≤ 5 s com 0 redraws de tela cheia por pane ocioso.
11. **Fechamento em rajada.** Dado 45 panes, Quando fechar todos, Então a UI responde e a grade está íntegra ao reabrir.
12. **tmux externo.** Dado VPS com sessão `deploy` externa, Quando conectar, Então `deploy` aparece na lista sem abrir pane; ao abrir, selo "externo"; fechar o pane não mata a sessão; matar no servidor mostra 1 aviso e 0 reconexões.
13. **Restore.** Dado 3 panes abertos e 1 fechado pelo usuário, Quando reabrir e aceitar, Então só 3 voltam; o orquestrador volta com `role=orchestrator`.
14. **Cadeado.** Dado dialog de squad com 4 workers e cadeado ativo, Quando mudar worker 1 para Codex, Então os 4 ficam Codex; com cadeado inativo só o 1.
15. **Semáforo.** Dado pane em modo normal, Quando o agente pede permissão, Então vermelho; ao responder, amarelo; ao concluir, verde; pause volta a verde e descarta prompt.
16. **Multi-janela.** Dado Workspace arrastado para fora e devolvido, Então 1 janela final, sem duplicatas e o mesmo PTY.
17. **Shell padrão.** Dado `default_shell=dash`, Quando novo pane, Então `echo $0` = dash.

## 13. Questões em aberto e riscos

- [LAC] Critério exato de `needs_user` (hook vs heurística; erro vs pergunta) (RF-01.111).
- [LAC] Valores de `paste_soft_limit` e fila; se bracketed paste foi corrigido no original (RF-01.50-.52).
- [LAC] Valor N e atalho exato de abertura em massa com Shift (RF-01.15); demais atalhos (RF-01.42).
- [LAC] Existência de nível `none` de `external_access` e enforcement em painéis abertos (RF-01.32-.33).
- [LAC] Limites de panes por Plan (RF-01.72).
- [LAC] Arquitetura multi-janela (processo único vs vários) e migração Electron→Tauri (RF-01.83, seção 10).
- [LAC] Se a troca de shell local vale para SSH (RF-01.61); fallback sem tmux (RF-01.99).
- [LAC] Algoritmo de grade e se grids 1-4 fixos foram implementados (7.2).
- [LAC] Workspace sem git (RF-01.73) e políticas de limpeza de worktrees.
- Riscos: números do Overdrive são falados/ruidosos (0,2 vs 0,4 s; "9000x"), portanto testes de aceitação devem fixar baseline própria; memória por CLI limita panes em máquinas fracas; regressões de estabilidade do motor (1.3.5) sugerem manter `classic` como rollback; Windows sem assinatura de código (fora de escopo, spec-18); [DEC] mais arriscadas: mover panes entre janelas trocando apenas "view" (exige backend único), heurística de semáforo, e enforcement retroativo de política.

## 14. Rastreabilidade

Mapa Dia→arquivo (M01): D22=55, D23=54, D24=53, D25=52, D26=51, D27=50, D28=49, D29=48, D30=47, D44=43, D49=42, D54=38, D55=37, D56=36, D58=34, D61=30, D62=29, D65=26, D66=25, D68=23, D73=18, D76=14, D80=10, D81=07/08, D82=06.

| Requisito | Fonte (módulo 01 / dia) |
|---|---|
| RF-01.01, .02 | Funcionamento; D22, D28 |
| RF-01.03-.05 | Comportamento; D23, D66, D54-55, D80-81 |
| RF-01.06 | Desempenho/acessibilidade; D23 |
| RF-01.07, .35 | Novo painel Cmd+T; D26 |
| RF-01.08 | Objetivo; D23-D28 |
| RF-01.10a-.15 | Grade; D22, D54-56, D68 |
| RF-01.20-.24 | Overdrive/Performance; D54, D55, D66 |
| RF-01.25, .26 | Desempenho para máquinas fracas; D22, D23, D30 |
| RF-01.30-.34 | Workspaces e isolamento; D26, D28, D30 |
| RF-01.40-.42 | Atalhos; D22, D26 |
| RF-01.50-.53 | Paste grande; D26, D28, D65, D22 |
| RF-01.54, .55 | Scroll; D26, D30, D54 |
| RF-01.60-.62 | Shell/tipo de terminal; D26, D24 |
| RF-01.70-.74 | Missões por worktree; D24, D25 |
| RF-01.80-.84 | Multi-janelas; D22, D23 |
| RF-01.90-.99 | SSH remoto e tmux; D23, D24, D26, D61 |
| RF-01.100, .101 | Cadeado; D61 |
| RF-01.110-.114 | Sinaleira; D80-81 (arq. 07/08) |
| RF-01.120-.126 | Persistência; D22, D29, D61, D66, revisão D28 |
| RF-01.130, .131 | MCP; D28, D29 |
| RNF-01.P1-.P6 | Overdrive, Performance; D44, D54, D55, D66, D82 |
