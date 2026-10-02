# Pendências do dono

> **TODAS as pendências abaixo foram DECIDIDAS pelo dono-delegado em 2026-10-01 pela regra "sempre a opção mais completa"**
> — veja **`DECISOES-DAS-PENDENCIAS.md`**, que SUBSTITUI o "padrão adotado" de cada linha e vale como override sobre os planos.
> A tabela abaixo fica como histórico das perguntas originais. Só restam como **[depende do dono]** coisas que exigem algo do mundo
> real (contas, certificados, chaves, endpoint do JEV) — o sistema é construído completo e a validação real vem quando existirem.

Decisões que só o dono pode tomar. Cada uma já tem um **padrão adotado** para a execução não
parar. Responda quando voltar; ajusto em um passo.

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-01 | **Nome do produto**: "XPEV" foi ditado. Quer `ExpxV`, `ExpxDev` ou outro? | `ExpxV` | `src/nucleo/produto.ts` (uma constante) |
| P-02 | **Permissão das CLIs**: o ExpxMedia liga sempre o modo automático. Num ADE de dev, quer automático por padrão? | seguro por padrão; automático por opt-in por workspace (D-14) | `permissao` do workspace |
| P-03 | **Repositório de releases** e assinatura/notarização (Apple Developer, certificado Windows) | sem publicar; build sem assinatura | `electron-builder.yml`, secrets |
| P-04 | **Commits**: trabalhei sem commitar, tudo na árvore da `main`. Quer que eu commite em uma branch? | não commitar | — |
| P-05 | **Overdrive** (canvas único para 32–64 painéis): vale o risco após o MVP? | não; xterm por painel com WebGL limitado (D-11) | fase pós-MVP |
| P-06 | **Windows**: sem máquina Windows aqui, só teste de unidade | risco registrado (D-26) | validação manual |
| P-07 | **Licença** do produto (MIT como o ExpxMedia?) | sem arquivo de licença ainda | raiz |
| P-08 | **`node:sqlite`** é experimental no Node 22/Electron 37; aceita esse risco ou prefere `better-sqlite3`? | `node:sqlite` atrás de interface (D-08) | `src/nucleo/banco/` |
| P-09 | **Hooks do Codex**: para injetar hooks por `-c`, o Codex exige `--dangerously-bypass-hook-trust`, o que também confia em hooks do repositório. Aceita? | usar o flag só em workspace com permissão `automatico`; em `seguro` a sinaleira do Codex cai na heurística de ociosidade | `catalogo.ts` (configuração de hook do Codex) |
| P-10 | **Token de hook na URL**: o token de atividade vai no caminho (`/atividade/<sessao>/<token>`) e aparece nos argumentos do Codex e no arquivo 0600 do Claude. Aceita, ou prefere cabeçalho? | caminho (por ora); token só vale para a sessão, em memória | `atividade/servico.ts` |
| P-11 | **SVN nesta máquina**: `svn`/`svnadmin` não estão instalados, então os testes reais de SVN só rodam depois de `brew install subversion`. Posso instalar (altera a sua máquina) ou prefere manter só os testes por XML gravado? | não instalei nada; testes determinísticos por XML gravado + `svn` falso | `fase-06` T-06.29 |
| P-12 | **Outros provedores de forge** além do GitHub (GitLab, Bitbucket, Azure DevOps): quer no escopo? | só GitHub agora; interface `Forge` pronta para estender | `fase-06` T-06.22 |
| P-13 | **`--force-with-lease`**: permitir como ação manual confirmada, ou proibir de vez no ADE? | permitir manual, confirmação digitada, nunca na branch padrão | D-36 |
| P-14 | **RAG online**: quais provedores de banco vetorial quer suportar primeiro (pesquisa em `base/G-provedores-vetoriais.md`)? Onde guardar credenciais (padrão: cofre do SO via safeStorage)? | adaptadores na ordem de menor atrito; cofre do SO; tudo desligado por padrão; testes só com stub local | Fase 15 |
| P-15 | **Modelo de embeddings local**: baixar um modelo (dezenas a centenas de MB) exige rede uma vez. Autoriza? Alternativa: só busca lexical (FTS5) até você liberar. | só lexical até haver consentimento; modelo plugável | Fase 15 |
| P-16 | **JEV**: qual o endpoint e o formato da chave ('TypeSafe') do JEV para a chamada direta, e o ID do modelo no OpenRouter? Sem isso o adaptador do JEV fica contra um stub. | decisor desligado por padrão; regras determinísticas; adaptador por interface com stub | Fase 16 / 9 |
| P-17 | **OpenRouter**: o app só guarda a chave no cofre do SO e lista os modelos com a SUA chave (rede, só ao clicar). Aceita? Quais CLIs priorizar para usar modelos do OpenRouter (OpenCode e Aider primeiro)? | rede só por ação explícita do usuário; OpenCode e Aider primeiro | Fase 9 / 16 |
| P-18 | **Skills do produto (`ev-*`) na sua casa**: copiar também para `~/.claude/skills`, `~/.codex/skills`… (opt-in no Catálogo)? Por padrão elas só entram por Pane, em pasta efêmera. | não copiar; só por Pane; botão opcional "Instalar em <CLI>" (D-43) | `catalogo:embarcadas_instalar` |
| P-19 | **Isolamento parcial fora do Claude Code**: Codex, OpenCode e Gemini não têm bloqueio duro de skills. Aceita rodar Missões `squad`/`agentico` neles com selo "parcial", ou prefere bloquear essas CLIs em Missão? | permitir com selo amarelo, evento e achado de saúde (D-44) | `isolamento/parcial.ts`, `NIVEL_POR_CLI` |
| P-20 | **Listar ferramentas de MCP do usuário** exige iniciar o servidor dele (stdio) ou chamá-lo (http). Aceita, sempre sob confirmação por servidor, ou prefere desligar de vez? | disponível, só sob confirmação, timeout 5 s, nada persiste além de nome/descrição (D-42) | `catalogo:verificar_mcp` |
| P-21 | **Memória ligada por padrão** em Missão agêntica (grava notas locais redigidas no banco do app; nada sai da máquina)? E em painéis livres (solo)? | Missão agêntica ligada; painel livre desligado (D-46) | `memoria_config` |
| P-22 | **Retenção da memória**: 90 dias por padrão (7–365 configurável). Quer outro padrão? | 90 dias (D-51) | `memoria_config.retencao_dias` |
| P-23 | **Preferências do usuário (anel 3)**: quer essa camada (valem para todos os projetos, só você escreve, entram no pacote do piloto)? | existe, vazia, só por ação humana, máx. 20 (D-51) | `memoria:preferencias_*` |
| P-24 | **Squad sem memória** (a spec manda): quer memória também nas Missões `squad`? | não (RF-06.42, D-46) | `modo.ts#resolverModo` |
| P-25 | **memox**: depois de uma Missão, o ADE pode digitar sozinho `/expx:memox-indexar` no Pane do piloto? | não; só sugere (botão Reindexar na tela Memória) (D-47) | `CartaoMemox.tsx` |
| P-26 | **Caminhos das CLIs**: confirmar na sua máquina onde Codex, OpenCode e Gemini guardam skills e MCP (usei convenções públicas, travadas por teste de fixture). | convenções documentadas em `fase-07-catalogo.md`; erro nominal por CLI se não casar | `scanners/{codex,opencode,gemini}.ts` |
| P-34 | **Motor de ditado (Fase 11)**: qual STT usar? O ExpxV não embarca nem baixa nenhum (D-60). Opções: um executável local que você já tenha (whisper.cpp, nemo-speech…) ou um endpoint HTTP compatível com `/audio/transcriptions` com a SUA chave (o áudio sairia da máquina, só com seu aceite por host). | nenhum motor: o ditado fica desligado até você configurar um | `fase-11` T-11.06/T-11.07 |
| P-35 | **Hold-to-talk fora da janela** (tecla segurada com o ExpxV em segundo plano, ou modificador isolado como Option direita) exige um módulo nativo (`uiohook-napi`) e permissão Input Monitoring/Acessibilidade. Aceita o peso e a permissão? | não; segurar só com o app em foco, alternar global opcional | `fase-11` T-11.11, D-61 |
| P-36 | **Permissões do SO e assinatura**: microfone e gravação de tela só aparecem como "ExpxV" em app assinado com entitlements (hoje sem assinatura, P-03); em dev o macOS atribui o pedido ao Terminal. | plist e entitlements prontos e testados por configuração; validação real manual depois da assinatura | `fase-11` T-11.01 |
| P-37 | **Rodar UM bench real** (1 tarefa barata, 1–2 alvos, conta dedicada, custo estimado de alguns dólares) para validar os adaptadores de Claude Code e Codex? Os flags reais de modo headless são [LAC] e só foram testados contra saídas gravadas e `--help` simulado. | não rodei nada pago; só CLI falsa | `fase-12` T-12.08/T-12.09 |
| P-38 | **Bench no Windows**: não há sandbox equivalente ao `sandbox-exec`; manter desabilitado (Run recusada) ou aceitar rodar sem sandbox com consentimento reforçado? | desabilitado | `fase-12` T-12.06, D-67 |
| P-39 | **Tabela de preços dos modelos** (para o custo do Bench): você fornece/atualiza? Sem ela o custo aparece como "custo desconhecido" (nunca zero) e o score ignora o custo. | tabela vazia | `fase-12` T-12.04 |
| P-40 | **Provedor de voz realtime remoto** (Gemini Live, OpenAI Realtime) para o Jarvis: liberar um adaptador real? Custo alto de input se a sessão ficar aberta; o áudio sairia da máquina. O Jarvis em cascata (STT + gramática + TTS local) já funciona sem isso. | não; só interface e provedor falso | `fase-13` T-13.10, D-71 |
| P-41 | **Controle remoto local**: aceita os riscos residuais R1 (atacante ativo na sua rede pode servir página adulterada ao celular; sem app nativo não há como provar a página) e R2 (composição criptográfica própria, só com primitivas padrão, sem revisão externa)? Recomendo revisão externa antes de usar fora de rede doméstica. | implementado, DESLIGADO por padrão, a cada reinício, com aviso e permissão `leitura` | `fase-13` T-13.01/T-13.15, D-74 |
| P-42 | **Relay, app móvel iOS e VPS 24h (Overclock Bot)**: liberar? Exigiria novo estudo de ameaças, app nativo, hospedagem e custo (Apple Developer, build, relay cego). | não implementar | `fase-13` T-13.22, D-73 |
| P-18b | **Telegram (entrada remota)**: o bot pode disparar execução de código na sua máquina a partir de mensagens. Padrão adotado: DESLIGADO; só com seu pareamento (código de uso único), allowlist, e APROVAÇÃO por botão antes de executar. Quer permitir 'executar direto' como opção? | só aprovar-antes; 'direto' opcional por workspace | Fase 20 |

## Fase 15 — RAG, grafo e chat (P-50..P-59; os números P-30..P-42 já foram usados pelas Fases 9, 11, 12 e 13)

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-50 | **Modelo de embeddings local** (refina a P-15): autoriza baixar um modelo (ex.: `multilingual-e5-small` int8, ≈ 118 MB, 1 download) e instalar o runtime WASM (`@huggingface/transformers`)? Ou prefere usar o Ollama que você já tem? | só `hash-256-v1` + FTS5 + grafo; Ollama em loopback se existir; ONNX não instalado (D-82) | `conhecimento/embeddings/` |
| P-51 | **Importar o histórico antigo das CLIs** (transcrições de `~/.claude`, `~/.codex`, OpenCode) para o RAG? Contém dados sensíveis | desligado; só sessões iniciadas pelo ExpxV (D-86) | `conhecimento:importar_historico` |
| P-52 | **Chat executa direto?** "Preciso implementar X" cria Missão/Pane e envia o prompt melhorado sem pedir confirmação (com botão Parar)? | direto para ações reversíveis; confirma se destrutivo, >3 Panes ou workspace automático (D-88) | `conhecimento_config.chat_execucao` |
| P-53 | **Consulta obrigatória:** só avisar quando um agente começa sem consultar o RAG, ou bloquear? | aviso (o ADE já injeta o contexto no despacho, então raramente falta) (D-84) | `conhecimento_config.consulta_obrigatoria` |
| P-54 | **Provedores online e teste real:** Qdrant, Supabase, Upstash e Pinecone entram primeiro. Quer outro? Faz um teste real com um free tier seu (nada foi enviado à rede na construção)? | 4 adaptadores testados só contra stub local (D-90) | `conhecimento/backend/adaptadores/` |
| P-55 | **O que sobe para o RAG da equipe:** aprendizados, decisões, docs, relatórios, commits. Código, transcrições e chat ficam de fora. Confirma? (outras pessoas verão o que subir) | só os tipos seguros (D-91) | `rag_backend.tipos` |
| P-56 | **Destilar aprendizados com IA** gasta cota da sua assinatura (1 chamada por Missão). Ligar? | desligado; botão manual por Missão (D-85) | `conhecimento_config.aprendizado_modo` |
| P-57 | **`sqlite-vec` no pacote:** carregar o binário no app notarizado exige assinar o dylib (ou o entitlement `disable-library-validation`) — depende da P-03. Aceita só o fallback exato até a assinatura? | fallback exato; `vec0` só se o spike passar (D-81) | `electron-builder.yml`, `afterSign` |
| P-58 | **Uma chamada real e barata por CLI headless** (`claude -p`, `codex exec`, `opencode run`) para confirmar o formato de saída; `gemini` não está instalado nesta máquina. Autoriza? | contratos por CLI falsa, marcados "forma presumida" (D-88) | `cli-headless/*` |
| P-59 | **Retenção e teto do índice:** transcrições 90 dias e teto de 1 GB. Outro padrão? | 90 dias / 1 GB, aviso a 80 % (D-86) | `conhecimento_config`, `conhecimento_teto_mb` |
| P-27 | **Ler credencial das CLIs para obter o % exato de cota** (Claude/Codex): o ExpxV **não** lê token, keychain nem `auth.json`; usa só o que a CLI grava (rollout do Codex, statusline do Claude por Pane), entrada manual e estimativa. Aceita ficar assim? Ler credencial daria precisão, mas arrisca termos de uso e vazamento. | não ler credencial; sem dado = "sem dado" e conta rebaixada | `fase-09` T-09.05/T-09.06, D-57 |
| P-28 | **Padrões da troca por consumo**: nível de harness 4; modo de troca **derivado da permissão do workspace** (automático onde você já optou por automático; "só sugerir" onde é seguro); gatilho 85% (5 h ou semanal); margem de 10 pontos; no máximo 2 saltos por task; troca de provedor permitida; faixa mínima "mesma". Quer outro padrão? | os da frase ao lado | `harness_workspace`, D-100, D-101 |
| P-29 | **Cofre no Linux sem keyring** (`safeStorage` em `basic_text`): recusar (recursos que precisam de chave — OpenRouter, decisor externo — ficam desligados com instrução) ou aceitar cifra fraca? | recusar | `src/main/cofre.ts`, D-59 |
| P-30 | **Termos de uso ao distribuir trabalho entre várias contas** (e ao usar OpenRouter): alternar entre contas do mesmo dono pode ferir termos de um provedor. O app usa só o login de cada CLI, troca automática vem desligada onde a permissão é "seguro", tem cooldown e aviso fixo na UI. Aceita o risco, ou prefere manter só "sugerir"? | aviso fixo + padrão por permissão; sem automação de login | `fase-09` T-09.31, D-101 |
| P-31 | **Nomes concretos por faixa** (topo, alto, médio, rápido) na tabela de equivalência: só `opus/sonnet/haiku` (Claude) e `default` (CLI) estão confirmados; Codex, Gemini e demais usam `default` até você ou o coordenador preencher. E **descer de faixa** ao trocar de provedor (ex.: topo → alto) é aceitável? | preencher depois; `faixa_minima_troca = mesma` | `equivalencia.json`, D-102 |
| P-32 | **Meta de aproveitamento semanal** da cota (padrão 90%) e quais alertas quer (`consumo_alto`, `vai_estourar`, `cota_sobrando`)? | meta 90%; os três ligados; 1 alerta por tipo/conta/hora, só sem foco | tela Consumo, `config harness.meta_aproveitamento_pct` |
| P-33 | **Adaptadores de endpoint customizado** para `codex` (provider customizado por `-c`) e `goose` (ainda fora do catálogo): validar contra as CLIs reais e liberar? Até lá ficam `a_verificar`/desligados; OpenCode e Aider saem verificados por CLI falsa. | desligados | `src/nucleo/openrouter/adaptadores/`, D-113 |
| P-80 | **Teto de custo por Missão**: só alertar (padrão) ou também bloquear/abortar ao passar do teto? | só alerta, uma vez; padrão sem teto | `custo_teto`, D-117 |
| P-81 | **Ler os transcripts locais das CLIs** (Claude e Codex) apenas para contar tokens e modelo — o conteúdo da conversa nunca é guardado. Aceita? Dá para desligar em `config custo.ler_transcripts`. | aceito e ligado; só `{instante, modelo, tokens}` | `fase-10` T-10.04..T-10.07, D-104 |
| P-82 | **CLIs sem fonte de uso** (Gemini, OpenCode nativo, Aider, Qwen, Kilo): o custo delas aparece como "sem fonte" (nunca zero). Quer priorizar algum adaptador? Via OpenRouter já é medido pelo proxy. | "sem fonte"; adaptadores depois | `leitores/`, D-116 |

## Loja de MCPs (Fase 7B; P-130..P-138 — os números P-50..P-59 e P-80..P-82 já foram usados pelas Fases 15 e 10)

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-130 | **`npm` e `uv` na máquina do usuário**: a Loja usa o `npm`/`uv` do sistema (diagnostica e orienta se faltar); remotos funcionam sem nada. Quer que o app **empacote** um `npm`/runtime próprio (dezenas de MB) para o "um clique" funcionar em máquina sem Node? | não empacotar; exigir `npm` (e `uv` para servidores Python) com diagnóstico acionável | `fase-07b` T-07B.12/.13/.31 |
| P-131 | **Gerar os locks e hashes** dos servidores (`scripts/gerar-lock-mcp.mjs`) exige rede (só leitura nos registros npm/PyPI). Autoriza rodar uma vez, com você presente? Sem isso a instalação fica no nível `padrao` (sem lock das dependências transitivas). | não rodei nada; nível `padrao` com aviso no consentimento | `fase-07b` T-07B.33 |
| P-132 | **Risco residual de remoto com chave de API** (cabeçalho no arquivo temporário 0600 do Pane em Claude/OpenCode; variável no ambiente do Pane em Codex). Aceita, ou prefere permitir só remotos com OAuth feito pela CLI? | aceito, com aviso e selo; OAuth preferido | D-132/D-133 |
| P-133 | **Gateway MCP interno** (o app aglutina e encerra servidores ociosos, filtra tool a tool e guarda o OAuth): vale a Fase pós-7B? | adiado (D-135) | futuro |
| P-134 | **Sandbox para servidores stdio** (`sandbox-exec` no macOS; sem equivalente confirmado no Windows): aplicar aos servidores de risco médio/alto como o Bench faz? | não aplicado; pasta isolada + política + somente-leitura quando existir | `fase-07b` |
| P-135 | **Licenças restritivas no catálogo:** Serena é GPL-3.0-or-later; Sentry (FSL), SonarQube (SONAR Source-Available), Terraform (MPL-2.0). O app só **instala por clique do usuário** e não redistribui. Aceita listar? | listar com selo de licença; nunca empacotar | seed |
| P-136 | **Kit mínimo**: `context7` e `deepwiki` enviam nomes de biblioteca/repositório e perguntas a terceiros (Upstash, Cognition). Mantém os 3 habilitados por padrão ou prefere começar vazio (só sugerido)? | 3 habilitados (instalação por clique), desligável em Configurações | D-134 |
| P-137 | **Descoberta no Registro Oficial do MCP** (rede só por clique, metadados CC0, resultado não instalável) entra na primeira versão? | P2, desligada por padrão | `fase-07b` T-07B.32 |
| P-138 | **Planos grátis não confirmados** (Brave, Exa, Linear, Atlassian, Notion, Figma, Slack, Asana, Postman): confirme na sua conta antes de o app anunciar "grátis". | selo "plano grátis não confirmado" | seed |

## Mapa lógico do código (Fase 17; numeração P-270..P-279 porque P-40.. e P-80.. já estavam ocupados)

| # | Pergunta | Padrão adotado (D-140: opção mais completa, segurança como padrão inicial) | Onde mexer |
|---|---|---|---|
| P-270 | **Gramáticas fora do pacote** (Kotlin, Swift, Scala, Dart, C puro, SQL): compilar os `.wasm` exige `tree-sitter-cli` + emscripten/Docker. Autoriza instalar isso uma vez? | até lá: modo degradado + ctags opcional; no backlog B1 a compilação roda com a instalação pontual e reversível da regra geral 3 **[depende do dono: confirmar na hora]** | `fase-17` §12b B1 |
| P-271 | **Peso das gramáticas no instalador**: Onda 1+2 = ≈ 18 MB em disco (≈ 1,5 MB gz no `.dmg`); as extras somam mais. Aceita? | aceito; flag de build `EXPXV_MAPA_LINGUAGENS` para reduzir | `fase-17` T-17.02, P-245 |
| P-272 | **Ferramentas externas opcionais** (ctags, scc/tokei, Graphviz `dot`): botão "Instalar via Homebrew" com confirmação digitada, ou só mostrar o comando? | botão com confirmação digitada `INSTALAR`, lista fechada de fórmulas, sem `sudo`; sem `brew`, só o comando | `fase-17` T-17.37 |
| P-273 | **Indexadores SCIP** (compilam/typecheckam o projeto e podem rodar ferramentas de build): oferecer "Gerar índice SCIP" na UI? | sim, **opt-in**, consentimento digitado, aviso, sandbox quando existir; desligado por padrão; a leitura de `index.scip` pronto já vale | `fase-17` B4, T-17.36 |
| P-274 | **Projetos gigantes**: teto de 150 000 arquivos e aviso a partir de 20 000; análise por subpasta. Quer outro limite? | 150 000 (configurável), seleção por subpasta | `mapa.total_max` |
| P-275 | **Camadas manuais** (quando o projeto não tem regras estáticas): onde guardar? | editáveis na UI, salvas em `<userData>/mapas/<ws>/camadas.json` **e** espelhadas em `.expxv/mapa/camadas.json` para as skills lerem | `fase-17` T-17.25 |
| P-276 | **Licença das dependências do projeto analisado**: ler `node_modules/*/package.json`, `vendor/composer/installed.json`, `*.dist-info/METADATA` (somente leitura local, sem rede)? | sim; selo "copyleft" é informativo, não parecer jurídico | `fase-17` T-17.28 |
| P-277 | **O que o mapa guarda**: nomes, assinaturas sanitizadas, `arquivo:linha` e a 1ª linha de comentário (≤ 160, redigida); nunca o código. O RAG (Fase 15) lê isso por `ProvedorGrafoCodigo`. Aceita? | sim; botão "Apagar mapa" digitando `APAGAR` | D-163 |
| P-278 | **Histórico para SVN**: o churn/hotspots hoje é só git. Implementar `svn log --xml -v` (backlog B5, depende de P-11)? | sim, logo após o portão da Fase 17; até lá, histórico "indisponível" e sinais de churn viram pior caso | `fase-17` B5 |
| P-279 | **Validar a economia de contexto** do stackx/legadox com o mapa em um projeto legado real seu (a fase só garante o que o mapa entrega, não o ganho medido em tokens), e **Windows** (sem máquina aqui, risco P-06). Aceita validar no seu uso? | hipótese registrada; validação manual no primeiro projeto real | `fase-17` §1 |

## Gestão ágil (Fase 18; P-60..P-63) e Documentação/relatórios (Fase 19; P-64..P-67)

> Numeração: P-60..P-67 (pedido do dono). Pela regra D-140 (opção mais completa; segurança como padrão inicial), o padrão adotado de cada linha já vale.

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-60 | **Estimativa por IA ligada por padrão** consome cota da sua assinatura (≤ 40 chamadas/dia, lote de 20 tasks) e envia o **texto das tasks** ao provedor da CLI escolhida (nunca código). Mantém ligado? | ligado, com heurística imediata, teto diário e botão para desligar (D-185) | `agil_config.estimativa_modo`, `estimativa_max_chamadas_dia` |
| P-61 | **Janela de observação do retrabalho**: 14 dias após `concluida_em` (ou até o fechamento da sprint/QA). Outro valor? | 14 dias (D-183) | `agil_config.janela_retrabalho_dias` |
| P-62 | **Capacidade de agentes**: usar a mediana das 3 últimas velocidades (padrão) ou um valor fixo por agente? Horas focadas por dia e fator de foco humanos (padrão 6 h × 0,6)? | mediana de 3; fator 0,6 (D-189) | `agil_membro`, `agil_capacidade` |
| P-63 | **Fechar a sprint** é sempre manual (o ADE só sugere). Quer a opção de fechar automaticamente quando todas as tasks estiverem `concluida` e o QA `aprovado`? | manual; opção automática disponível e desligada (D-181) | `agil_config.fechar_automatico` |
| P-64 | **Redação por IA** envia **fatos estruturados** (títulos, resumos, contagens; nunca código) ao provedor da CLI escolhida e gasta cota (≈ 1 chamada por bloco, até 12 por pacote). Manter `auto` (usa IA quando houver CLI)? | `auto`, com consentimento registrado na 1ª vez, botão para desligar e modo `template` sempre disponível (D-192) | `relatorio_config.redacao_modo`, `consentimento_llm_em` |
| P-65 | **Exportar para dentro de `docs/` do projeto** (exceção à D-04): permitido só por opção, em subpastas fora das áreas do método e com confirmação digitada. Liberar a opção? | opção existe e vem **desligada** (D-190) | `relatorio_config.exportar_docs_liberado` |
| P-66 | **Marca padrão** dos relatórios (nome, logo, cores, rodapé, contato) e idioma: você fornece o logo e os textos? | sem marca (nome do workspace, cor de destaque azul, rodapé vazio), `pt-BR`; "gerado com o produto" desligado (D-195) | `relatorio_marca` (`*`) |
| P-67 | **Publicação automática** (GitHub Release, e-mail, webhook, redes): o ADE só gera e copia. Quer adaptadores de publicação como extensão da Fase 20, sempre com aprovação por botão? | só gerar/copiar/exportar; adaptadores ficam como extensão futura, desligados (princípio 6) | Fase 20 (canais) |

## Fase 20 — Alertas e comunicação (P-70..P-79; os números P-50..P-59, P-80..P-82 e P-130..P-138 já foram usados por outras fases)

> Pela regra D-140 (opção mais completa; segurança como PADRÃO inicial, nunca como teto), o "padrão adotado" abaixo já deixa o recurso **construído inteiro**, com o que amplia risco **desligado até você ligar**.

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-70 | **Riscos residuais do Telegram** (texto exato no estudo T-20.01): **R1** o Telegram (empresa) pode ler as mensagens do bot (não são ponta a ponta); **R2** quem controlar sua conta Telegram (ex.: troca de chip) consegue pedir e aprovar, pelo chat, planos de baixo risco nos workspaces liberados; **R3** quem roubar o token do bot pode enviar mensagens falsas a você (sem executar nada) até você rotacionar o token. Aceita? | aceitos, com aviso fixo na tela do canal e consentimento versionado; mitigações: nível mínimo, política que manda risco para o desktop, PIN opcional, validade de 30 dias, pânico | `fase-20` T-20.01, `canais/telegram/*` |
| P-71 | **PIN de aprovação** (segunda barreira contra conta sequestrada): obrigatório, recomendado ou opcional? | **opcional, recomendado** no assistente (aprovar exige `/aprovar <id> <PIN>`); só hash `scrypt` no banco | `telegram_autorizado.pin_hash`, T-20.30/37 |
| P-72 | **Modo "executar direto"** (sem tocar [Aprovar]) disponível por workspace? | **implementado e desligado**; exige digitar `DIRETO`; só com rigidez ≤ 3, raio BAIXO, branch própria, ≤ 2 painéis, não destrutivo; senão cai para "aprovar antes" | `telegram_workspace.modo`, T-20.28/30 |
| P-73 | **Texto livre vira pedido** (sem digitar `/pedir`)? | ligado **só no modo "aprovar antes"**; em "só consultar" o bot responde com dica | `telegram_autorizado.texto_livre` |
| P-74 | **Grupos, canais, mídia (foto, voz, arquivo)**: o bot os aceita? | **não**: só chat privado e só texto (grupos têm admin que lê tudo e vários usuários); futuro com estudo próprio | `autorizacao.ts`, G4 |
| P-75 | **O que sai nas mensagens**: nível mínimo mostra ID, título curto (≤ 60, redigido), tempo de trabalho, tokens e story points. Quer **ocultar títulos** (só IDs) por padrão (títulos podem ter nome de cliente)? Mostrar nome do projeto/repositório? | títulos **mostrados** (redigidos), sem nome de repositório nem caminho; "ocultar títulos" em um clique | `alertas:modelos`, T-20.12/36 |
| P-76 | **Resumo diário no Telegram**: ligar? Horário? | **desligado**; ao ligar, 18:00 local; resumo de sprint ligado ao fechar a sprint; dia sem atividade não envia | `config.alertas.digest` |
| P-77 | **Outros canais**: webhook genérico de saída (assinado), e-mail, Slack, Discord. | webhook genérico de saída construído como **P2 opcional** (T-20.39); e-mail/Slack/Discord só documentados (cada um exige credencial no cofre e estudo próprio) | `canais/webhook/*`, `fase-20` "Canais" |
| P-78 | **Teste real com um bot descartável seu** (nada disso roda de madrugada nem automático): `getMe`, envio, `/start`, o texto/código **reais** do 409 e do `getUpdates` com webhook, limite de 4096, `callback_data`, rotação do token. Autoriza fazer uma vez, manualmente, quando quiser? | só o servidor Telegram **falso** no build; checklist manual em `fase-20` ("Validação real"); o que divergir corrige o falso | `tests/fixtures/telegram/*`, `STATUS.md` |
| P-79 | **Parâmetros de "atrasada"**: fator 1,5 × estimativa, folga mínima de 10 min, mínimo de 5 amostras, tabela de story points → minutos (1→15, 2→30, 3→60, 5→120, 8→240, 13→480, 21→960), `pane_aguardando` após 10 min. Ajusta algum? | os da frase ao lado, editáveis em Alertas › Config | `config.alertas.atraso`, `atraso.ts` |

## Squads e agentes (Fase 14; P-230..P-233 — P-20..P-69 já estavam ocupados por outras fases)

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-230 | **Nomes concretos de modelos por faixa e níveis de esforço por CLI**: só `opus\|sonnet\|haiku` (Claude) e `default` são confirmados; quais modelos/níveis de esforço de Codex, Gemini, OpenCode entram nas faixas? | `default` fora do Claude; esforço `indicativo` onde a CLI não tem parâmetro; flags confirmadas por `--help` em uso | `equivalencia.json` (Fase 9), `terminais/esforco.ts` |
| P-231 | **Revisar as 13 squads de fábrica e seus prompts** (e dizer quais MCPs da Loja entram por padrão em cada uma) | 13 squads de `fase-14-squads.md`; `mcps_permitidos` vazio até o seed da Loja (7b) | `resources/squads/`, `fabrica/fonte/` |
| P-232 | **Versionar `.expxv/squads/` e `.expxv/pipelines/` no repositório** (muda o `.gitignore` interno de `.expxv/`): aceita? | sim, **só** por exportação explícita; o ADE nunca comita (D-207) | `.expxv/.gitignore` interno |
| P-233 | **Padrões das squads**: 4 terminais paralelos por squad, "plano antes" ligado, orçamentos de tempo/tokens soft | 4; ligado; soft (D-209, D-210) | `config` `squads.*` |

## Maestro e rigidez (Fase 16; P-310..P-320)

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-310 | **JEV**: formato **real** do endpoint da chamada direta (chave 'TypeSafe') — o adaptador genérico configurável (URL, cabeçalho da chave, esquema tipado, ID do modelo) já está decidido em P-16 | decisor desligado; adaptador `jev.ts` genérico contra stub (`jev-falso.mjs`); regras determinísticas valem | `nucleo/maestro/rede/jev.ts` |
| P-311 | **Padrões de fábrica por etapa** (faixa/esforço de cada etapa do runx/sprintx/prodx/mergex…) e nomes concretos de modelos | tabela [DEC] de `fase-16-maestro.md` (E1 topo/alto; fix médio; QA outro provedor; mergex rápido), todos editáveis | `perfis/padroes.ts` |
| P-312 | **Texto de rigidez nas skills do método** (auditoria/QA enxutos, pré-confirmação de densidade/forma): adotar na `SKILL.md`? | não aplicado pelo ADE; o ADE instrui por arquivo e só despacha/omite etapas; o nível 1 sai do método (`rapido`) | skills `sprintx`, `runx`, `prodx`, `buildx`, `mergex` |
| P-313 | **Hook que bloqueia o prompt** (zero token) quando detecta bug/feature etc. em painel livre do Claude: aceita como padrão, ou só notificar? | bloqueia só intenção acionável com confiança ≥ 0,75, `@direto` trata no painel; Codex/OpenCode só notificam | `config` `maestro.hook_modo` |
| P-314 | **Nomes e semântica dos 5 níveis** e padrão 3 | 1 Relâmpago, 2 Leve, 3 Padrão, 4 Rigoroso, 5 Total; padrão 3 | `rigidez/niveis.ts` |
| P-315 | **Exceção ao D-04**: o ADE escrever `.expx/hooks.json` (só por ação explícita, com backup e reversão) e promover hooks a `bloqueio` nos níveis 4–5 | aceita (D-221); `escrever_hooks=0` desliga | `rigidez/hooks.ts` |
| P-316 | **Branches protegidas / "produção"** que exigem confirmação ao baixar a rigidez | `main, master, develop, release/*, prod*, production, hotfix/*`; produção desligado | `config` `maestro.branches_protegidas` |
| P-317 | **`mergex-pr`**: confirmar push/PR em modo `seguro`; automático só em workspace `automatico` | confirma em `seguro` (I9) | etapa `mergex.pr` |
| P-318 | **Executar o método em outras CLIs** (Codex/Gemini): instalar o expxdev para elas? (Goose já entra no catálogo por P-33) | só `claude` e `opencode` executam etapas do método (D-219); demais para `rapido`, squads e chat | catálogo de CLIs, `expxdev` |
| P-319 | **OpenRouter**: a chave chega ao Pane (Claude Code por gateway, Aider…) só pelo mecanismo existente — entrada **não sensível** + `injetar_cofre_no_env` do workspace — ou o usuário autentica o `opencode` por conta própria? | sem injeção por padrão; o usuário autentica o `opencode`; o gateway do `claude` só com a injeção opt-in e aviso de que desliga o login por assinatura; rede só por clique (D-220) | cofre (Fase 9), `maestro.openrouter` |
| P-320 | **Canais remotos** (Telegram/chat remoto) só poderem **subir** o nível de rigidez, nunca baixar nem sobrescrever trava | só sobe (D-223) | `rigidez/travas.ts` |

## Auditoria do MVP, rodada 1 (P-AUD1..P-AUD4)

| # | Pergunta / risco | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-AUD1 | **Risco residual do MCP em HTTP claro no loopback (AUD-04).** O Bearer viaja sem TLS em `127.0.0.1` e a porta é reaproveitada entre inícios. Mitigado: TTL de 24 h (era 7 dias), porta anterior ocupada por outro processo ⇒ tokens dos Panes recuperados revogados e aviso "sem MCP". **Resta:** outro usuário/processo local que ocupe a porta com o app aberto não consegue (a porta é nossa), mas com o app fechado pode colher o token de um Pane vivo até ele expirar (≤ 24 h); a variável de ambiente de uma CLI já iniciada não muda, então ao expirar o Pane precisa ser recriado. Aceita? Alternativa: socket Unix/pipe nomeado com 0600 (exige o cliente MCP das CLIs falar por socket; nenhuma delas fala hoje). | aceito (máquina de um usuário só; D-14) | `mcp/tokens.ts#TTL_PADRAO_MS`, `main/mcp-remoto.ts` |
| P-AUD2 | **Remover workspace agora é lógico (AUD-11).** O histórico de Missões fica no banco e volta ao reabrir a pasta. "Apagar histórico" existe só como função (`servico.apagarHistorico`), **sem botão**. Quer o botão (com confirmação digitada) na tela de Workspaces? | sem UI ainda | `workspaces/servico.ts`, `telas/workspaces` |
| P-AUD3 | **Wake persistido é "pelo menos uma vez" (AUD-05).** O aviso ao piloto é gravado com o handoff e só some depois de entregue; uma queda exatamente entre o envio ao terminal e a remoção do registro reentrega o aviso (texto idempotente: "Worker X entregou o card T"). Aceita? | aceito | `main/orquestracao.ts#restaurarWakes` |
| P-AUD4 | **Aviso de token expirado na UI (AUD-04).** O app já emite `orquestracao.panes_sem_mcp` (motivos `porta_ocupada`, `token_expirado`) e um aviso de orquestração, mas não há canal no preload/contrato para uma faixa na tela de Missões (`src/compartilhado` e `src/preload` não foram tocados). Liberar o canal? | só aviso de orquestração por enquanto | `compartilhado/ipc.ts`, `preload` |


## Fases 21, 22 e 23 (planos escritos em 2026-10-01; P-330..P-354 — os números P-30.. e P-300.. já estavam ocupados). Regra do dono: opção mais completa construída, segurança como padrão inicial

### Fase 21 — Distribuição e atualização (P-330..P-339)

| # | Pergunta / risco | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-330 | **Residuais da distribuição** (texto em `AMEACAS-FASE-21.md`): R1 sem assinatura real o SO avisa e a integridade depende só da nossa camada; R2 repositório de releases comprometido publica versão maliciosa assinada com a chave que o CI guarda; R3 primeira instalação baixada de fonte adulterada não é protegida pelo atualizador. Aceita? | aceitos com aviso fixo na tela do atualizador; backend manual sem assinatura; `SHA256SUMS`; release sempre rascunho | `fase-21` T-21.01 |
| P-331 | **Repositório de releases** (`owner/repo` reais) e **ligar o auto-update no build** (`atualizacao.habilitada`). Quer ligar? **[depende do dono]** | `false`; `repositorioReleases` placeholder; pacote padrão sem `electron-updater` | `build/distribuicao.json`, `produto.ts` |
| P-332 | **Apple Developer** (assinatura + notarização) e variáveis do CI (`CSC_*`, `APPLE_*`). **[depende do dono]** | tudo pronto e testado com dublês; build local sem assinar | secrets do CI, `electron-builder.yml` |
| P-333 | **Certificado de assinatura do Windows** (OV/EV ou Azure Trusted Signing) e validação do SmartScreen. **[depende do dono]** | NSIS sem assinar; verificação estática e CI Windows versionado | secrets do CI |
| P-334 | **Par Ed25519 do manifesto de atualização** (privada só no cofre do CI do dono; pública em `build/distribuicao.json`; duas chaves aceitas para rotação). **[depende do dono]** | só chaves de teste; `release` recusa chave de teste | `build/distribuicao.json` |
| P-335 | **Renomear o produto antes do primeiro release?** Depois dele custa continuidade de `appId`, identidade de assinatura, feed e instaladores antigos. | `ExpxV` mantido; `npm run renomear` e checklist prontos; `idDados` estável | `produto.ts`, `CHECKLIST-RENOMEACAO.md` |
| P-336 | **Fixar as ações do CI por SHA** (exige rede/GitHub, fora desta execução). **[depende do dono]** | `@vN` com marcador `# TODO-SHA`; teste estrito no perfil `release` | `.github/workflows/*.yml` |
| P-337 | **`better-sqlite3` opcional** (P-08): adotar se o custo medido não violar P-01/P-08/P-159? | P2; `node:sqlite` segue o padrão | `fase-21` T-21.12 |
| P-338 | **Ativar o `electron-updater`** (só se P-331 for sim): instalar a versão exata em `optionalDependencies`, registrar o custo medido em `01-DECISOES.md` e rodar `dist:dir --perfil=com-atualizacao`. Hoje o perfil falha fechado de propósito (D-383). **[depende do dono]** | não instalado; backend manual como padrão (R1) | `package.json`, `scripts/lib/config-builder.mjs` |
| P-339 | **Medir o pacote endurecido** (fuses do perfil `release`, P-150 e `test:pacote`) numa janela em que o `npm run dev` possa parar: `dist:dir` reconstrói `dist/`. Também fiar `migrarDadosLegados` no boot (`main.ts`) e o `import()` do atualizador (onda W3). | fuses `release` só configurados e conferidos por script (D-385) | `scripts/dist-dir.mjs`, `src/main/main.ts` |

### Fase 22 — Acesso remoto estendido (P-340..P-347)

| # | Pergunta / risco | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-340 | **Residuais do relay/PWA** (texto em `AMEACAS-FASE-22.md`): **R-A** primeira instalação do PWA a partir de origem adulterada (só app nativo elimina); **R-B** o relay vê metadados (IP, horário, tamanho aproximado, canal do dia); **R-C** relay malicioso pode negar serviço, nunca ler nem forjar; **R-D** criptografia própria sem auditoria externa; **R-E** celular roubado e desbloqueado age até a revogação; **R-F** Service Worker trocado pela origem depois do 1º install exige comparação humana do hash. Aceita? | aceitos com aviso fixo, reconhecimento "experimental" obrigatório e consentimento versionado; nasce desligado e a cada reinício | `fase-22` T-22.01 |
| P-341 | **Revisão externa da criptografia** (pré-requisito de habilitar por padrão): contratar um revisor com o pacote `REVISAO-EXTERNA-CRIPTO.md`. **[depende do dono]** | pacote pronto e não enviado; `habilitado:false` invariante | `fase-22` T-22.27 |
| P-342 | **App nativo** (iOS/Android; Apple Developer, Play Console) para eliminar R-A/R-F, e validação do PWA em iPhone e Android reais. **[depende do dono]** | só PWA; checklist manual | `fase-22` |
| P-343 | **Hospedagem do relay** (VPS pequena, domínio, TLS) e custo recorrente (ordem de grandeza no guia). Não é feito por esta fase. **[depende do dono]** | arquivos versionados e nunca implantados; custo zero com relay desligado | `deploy/relay/` |
| P-344 | **Par Ed25519 do manifesto do PWA** (privada fora do repositório; reaproveita o da Fase 21 se existir). **[depende do dono]** | só chaves de teste | `scripts/assinar-pwa.mjs` |
| P-345 | **PIN local do PWA**: opcional, recomendado ou obrigatório (política) | recomendado no assistente; obrigatório por política da organização | `src/pwa/trava.ts` |
| P-346 | **Relay em Cloudflare Workers/Durable Objects** (P2, gratuito/limitado) | não; Docker/VPS | `fase-22` T-22.32 |
| P-347 | **Notificação push** (Web Push; metadado sai para Apple/Google/Mozilla) | desligada; só com estudo próprio e payload vazio | `fase-22` T-22.33 |

### Fase 23 — Overdrive experimental (P-350..P-354)

| # | Pergunta / risco | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-350 | **Resultado da medição** (go ou no-go) e o que fazer: se no-go, o código do *spike* é removido e o baseline fica como regressão de 32+ painéis; se go, o modo entra **desligado**. Quer revisar os números antes de qualquer produto? | decisão por critério escrito antes de medir (D-360..D-362) | `docs/ade/perf/overdrive-resultado.json` |
| P-351 | Modo **`sugerido`** (oferecer ligar acima do limiar medido) deve existir? | existe só se go; nunca liga sozinho | `Experimental.tsx` |
| P-352 | **Validar em sua máquina/monitores e no Windows** (sem máquina Windows aqui, D-26) | harness rodável (`perf.mjs --overdrive`); checklist manual | `fase-23` |
| P-353 | **Acessibilidade real** (VoiceOver) e **IME real** (japonês/chinês) antes de oferecer o modo | sem a11y verde o modo não é oferecido | `fase-23` T-23.11 |
| P-354 | **Revisar D-11** (um xterm por painel, WebGL só no foco e nos 6 primeiros) **se** go | D-11 mantido; só revisado com D-NN após go | `01-DECISOES.md` |
| P-360 | **Digest real da imagem do relay**: `deploy/relay/Dockerfile` traz marcadores (64 zeros) nos `FROM` (`node:22-slim` e `gcr.io/distroless/nodejs22`) e `compose.yaml` na imagem do Caddy (`caddy:2-alpine`); troque pelo digest real (consulte com `docker buildx imagetools inspect`) antes do primeiro build na sua VPS; P-168 só é medido com Docker e a base em cache local | marcador falha o build de propósito | `deploy/relay/LEIA-ME.md` |

### Fase 24 — MCP externo / Portal de entrada (P-410..P-419; plano escrito em 2026-10-01; só planejado, nada implementado). Regra do dono: opção mais completa construída, segurança como padrão inicial, nunca teto

| # | Pergunta / risco | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-410 | **Residuais do Portal** (texto final em `AMEACAS-FASE-24.md`): R-A injeção de prompt nunca é eliminável por software (só reduzida: envelope, agente reduzido, humano no meio); R-B credencial de API do help desk (polling/saída) é poderosa e vive no cofre; R-C quem tem a credencial de integração pode encher a fila até a cota; R-D metadados do ticket ficam no disco local por `retencao_dias`; R-E sistema de origem pode ser comprometido e mandar tickets "legítimos" maliciosos; R-F exposição por túnel é responsabilidade do dono; R-G adaptadores validados só por documentação (sem conta real). **[depende do dono]** | aceitos como declarados; Portal desligado e `somente_fila` | `fase-24` T-24.01 |
| P-411 | **Lembrar o Portal ligado entre reinícios?** | **não**: desligado a cada reinício (D-403); opção `persistir_ligado` com consentimento versionado | `portal_config` |
| P-412 | **Quais sistemas de ticket/help desk você usa de verdade** (Zendesk, Freshdesk, Jira Service Management, GLPI, Zoho Desk, Intercom, Movidesk, Octadesk, Linear, outro) e contas de teste para validar o adaptador | genérico REST/webhook + lote 1 (Zendesk, Freshdesk, JSM, GLPI) por polling; lote 2 só após a escolha | `fase-24` T-24.21/T-24.46 |
| P-413 | **Teto de autonomia por origem**: algum sistema pode passar de `somente_fila`? Quais classes de baixo risco permitem `automatico_restrito`? | todas as integrações em `somente_fila`; `automatico_restrito` desligado; D-21 sempre | `portal_integracao.autonomia` |
| P-414 | **Responder ao sistema de origem sozinho** (`auto_status`/`auto_total`) ou sempre com liberação humana? Resposta ao cliente final pode sair? | `manual` (liberação humana); só comentário interno, nunca mensagem ao cliente final | `portal_integracao.responder` |
| P-415 | **Antivírus de anexos**: usar `clamscan` se existir? Anexos de imagem/PDF podem ser liberados a agentes? | só tipos da allowlist; quarentena até a pessoa liberar; antivírus só se já instalado (nada é instalado) | `anexos.ts` |
| P-416 | **Revisão externa de segurança do Portal** antes de expor fora da máquina (LAN/túnel/ingress). **[depende do dono]** | exposição fora da máquina fica desligada e atrás de consentimento até a revisão | `fase-24` T-24.42 |
| P-417 | **Hospedagem do ingress próprio** (VPS, domínio, TLS), **mTLS/OAuth** como credencial primária e custo recorrente. **[depende do dono]** | arquivos versionados e nunca implantados (P2) | `fase-24` T-24.45/T-24.47 |
| P-418 | **LGPD**: base legal, papel de controlador/operador, retenção, DPA com clientes, "esquecer ticket". **[depende do dono / jurídico]** | retenção 90 dias, mascaramento na cópia do agente, contato nunca sai do ADE | D-411 |
| P-419 | **Tetos padrão de custo e SLA por severidade/origem** (USD/dia, tickets/dia, fila máxima, prazos) | 200 tickets/dia, fila 500, 10 s de teto de saída; teto de custo vazio (execução só com aprovação); SLA sugerido por severidade na UI | `portal_integracao`, `sla.ts` |
| P-430 | **Painel livre que orquestra** ("Orquestrar neste painel"): ligar por padrão em algum workspace? Limites 8 por painel / 16 por workspace / 12 por minuto? Worktree por worker para `executor` em repositório git? Aprovação automática das tools de abrir/ler no Claude? | tudo DESLIGADO por padrão (preferência por workspace); limites 8/16/12; worktree só para executor em git; `allow` só de abrir/ler (nunca `pane_send`/`pane_close`) | D-420 a D-428 |

## Voz local embutida (D-540 a D-549)

1. **Medir o Parakeet TDT v3 de verdade** (670 MB não foi baixado no desenvolvimento): baixar pelo assistente em Configurações › Voz e captura e conferir carga, RAM (estimada em ~1,5 GB) e velocidade; rodar `npm run perf` com `VOZ_LOCAL_MODELO_DIR` para P-540..P-542 se quiser números no `ultimo.json`.
2. **Amostras do autoteste** (`resources/voz/amostra-pt.wav` e `amostra-en.wav`) são vozes do sistema macOS (Luciana e Samantha) sintetizadas localmente. Se a licença do áudio sintetizado do macOS for um problema para distribuir o app, regrave com voz própria (mesmas frases, WAV 16 kHz mono).
3. **Empacotamento:** rodar `npm run dist:mac` / `dist:win` (já preparam os pacotes nativos do alvo) e `npm run test:pacote` para provar o addon dentro do `.app`; o `.app` universal leva as duas arquiteturas do addon (~72 MB). O Windows foi validado só por teste de configuração (D-26).
4. **Atribuição CC-BY-4.0** do Parakeet: o texto está no consentimento e em `THIRD-PARTY-LICENSES.md`; confirmar que atende ao que o dono quer exibir na tela "Sobre".
5. **Sem resultados parciais ao vivo** (modelos offline): a fala é transcrita ao soltar a tecla. Streaming por pausas (VAD) fica como evolução.

## Aprovações dos workers (D-640 a D-646)

1. **"Permitir esta ação nesta orquestração"** (ampliar a allowlist da sessão): não implementado. Hoje o painel mostra "Worker aguardando sua aprovação" + "Ir para o painel" e o dono aprova no terminal da CLI. Para ampliar a lista é preciso identificar o motivo da espera e regravar o settings de um Pane vivo (o Claude só relê o settings na próxima abertura).
2. **Contrato real de OpenCode e Grok**: as regras `permission` (OpenCode, `OPENCODE_CONFIG_CONTENT`) e `--allow/--deny` (Grok) seguem a ajuda e a documentação, mas não foram executadas contra as CLIs reais (sem CLI real nos testes, D-23). Por isso o selo é `parcial`. Rodar um worker de cada CLI no automático seguro e conferir que as negativas barram `git push` e a leitura de arquivo de ambiente.
3. **Symlink para fora do worktree**: depende de a CLI resolver o caminho real antes de aplicar `Edit(//<cwd>/**)` e as negativas (o Codex aplica no sandbox do sistema). O app não varre o repositório atrás de links. Conferir no Claude real e, se preciso, checar links ao criar o worktree.
4. **`git show`/`git log -p` leem conteúdo já commitado**: um arquivo de ambiente commitado por engano continua legível pelo histórico. Risco aceito: o segredo já está no repositório.
5. **Hooks do git desligados nos workers** (`core.hooksPath` neutro): um `pre-commit` do projeto não roda no commit do worker; o dono (ou o `mergex`) roda a suíte ao revisar. Se preferir hooks ligados, é uma opção por projeto a acrescentar.
6. **Workspaces existentes passam a herdar `automatico_seguro`** (D-641). Quem quiser o comportamento anterior escolhe "Perguntar sempre" em Configurações › Terminais › Aprovações dos workers.

## Decisor local laya (D-695 a D-708; estudo `seguranca/AMEACAS-FASE-25.md`)

1. **Residuais aceitos** (texto em `AMEACAS-FASE-25.md` §8): R1 fraqueza zero-shot declarada (sugestões ruins são esperadas sem fine-tune; o consentimento avisa); R2 host curinga do download (integridade = sha256 do catálogo no pacote); R3 verificação rápida por tamanho+mtime na carga (completa no "Testar"); R4 Windows só unidade/config; R6 injeção em sugestão reduzida, não zerada (a ação continua da regra).
2. **Exportar e publicar os `.onnx` do laya** (ressalva do portão T-25.02): o repositório oficial publica só `safetensors`; a exportação é `python scripts/export_onnx.py --quantize` (uma vez, na sua máquina; gera `encoder.onnx`+`head.onnx`+`tokenizer.json`+`rl_agent_config.json`). Enquanto não houver host público com sha256, o download no app recusa (`sem_checksum`) e o modo de verificação é a pasta local exportada (`LAYA_MODELO_DIR`); publicado o host, o download libera para todos.
3. **Mac Intel (darwin/x64) fica sem laya**: `onnxruntime-node@1.30.0` não publica addon para darwin/x64; nesses Macs o app mostra "runtime indisponível" e o custo continua zero (padrão da voz, A15).
4. **Medir o modelo real** (agente nunca baixa pesos): baixar pelo assistente em Configurações › Decisor local (ou apontar `LAYA_MODELO_DIR` para a pasta exportada) e conferir carga (P-702), latência p95 (P-703) e RAM (P-704) — os tetos atuais são provisórios; rodar `npm run perf` com `LAYA_MODELO_DIR` para gravar os números reais no `docs/ade/perf/ultimo.json`.
5. **Fine-tune local** (treinar com o histórico da própria máquina) é fase futura por decisão do dono (D-705); a telemetria de aceitação da ordenação de roteamento é o insumo.
6. **Elevar a taxa padrão de decisões** (60/min) ou o teto de entrada (8 KB), se o uso pedir, é escolha sua em Configurações; os padrões valem até lá.
7. **Ligar `laya_decide` por Pane** (tool MCP para as CLIs) é opt-in por painel; nenhum modo de fábrica liga.
