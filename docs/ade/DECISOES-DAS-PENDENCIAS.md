# Decisões das pendências do dono (regra: SEMPRE a opção mais completa)

**Autorização do dono (2026-10-01):** "decida essas coisas, sempre pela opção mais completa, nunca pela mais curta: a opção que
deixa nossos clientes mais confortáveis e dá mais possibilidades de uso." Este documento **substitui o "padrão adotado"** de cada
item de `PENDENCIAS-DO-DONO.md` e **vale como override** sobre qualquer plano (`fase-*.md`): **todo agente lê este arquivo antes de
implementar**.

**Como "mais completa" foi aplicada:** o recurso é construído **inteiro e disponível** (mais provedores, mais modos, mais formatos,
mais integração). **Segurança continua sendo o PADRÃO inicial** (consentimento, opt-in, cofre do SO, desligado até o usuário ligar
quando dados saem da máquina ou código é executado remotamente) — mas **nunca é o limite do que o cliente pode escolher**.
Onde a opção mais completa depende de algo que só o dono pode fornecer no mundo real (conta, certificado, chave, endpoint), o
sistema é construído completo e a validação real fica para quando o item existir (marcado **[depende do dono]**).

## Regras gerais novas (valem para a noite toda)
1. **Commits locais por fase fechada** (P-04): branch local `ade/principal`, um commit por fase/portão, com a mensagem padrão do
   projeto; **nunca push**. Feito pelo coordenador em momento tranquilo (sem agente editando a árvore).
2. **Instalação de dependências de `npm`** é permitida quando justificada em `01-DECISOES.md` (peso, startup e licença
   registrados) — ex.: runtime de embeddings (P-50), `uiohook-napi` opcional (P-35).
3. **Instalação de software no sistema** é permitida **uma vez, quando a task exigir validação real** e a ferramenta for de baixo
   risco e reversível (ex.: `brew install subversion` ao iniciar a 6D — P-11); registrar em `STATUS.md`; nunca `sudo`.
4. **Chamadas reais mínimas às CLIs** (P-37/P-58): permitidas para VALIDAR formatos headless — no máximo 5 prompts curtos por CLI,
   sem ferramentas/escrita (modo somente leitura), cota da assinatura do dono, registradas em log local; nunca em loop.
5. **Tudo que envia dado para fora** (RAG online, Telegram, STT remoto, OpenRouter, voz realtime) continua **exigindo consentimento
   explícito na UI** e credenciais **só no cofre do SO**; nunca durante testes automáticos (só stubs).

## Decisões por pendência

| # | Decisão (opção mais completa) | Efeito no plano / quem implementa |
|---|---|---|
| P-01 | Nome do produto permanece `ExpxV` como constante única; adicionar **"Nome do produto" configurável em build** (`produto.ts` + script `npm run renomear`) e instalador parametrizado | Fase 21 (distribuição) |
| P-02 | **Três perfis** de permissão por workspace: `seguro`, `equilibrado` (aprova só ações de risco) e `automatico`; escopo também **por Missão e por agente de squad**; padrão `seguro`, **assistente de escolha** na criação do workspace explicando cada perfil | Fases 14/16 (perfis), UI Workspaces |
| P-03 | Pipeline de **distribuição completa**: auto-update (reintroduz `electron-updater` com canais `stable`/`beta`), assinatura e notarização macOS, assinatura Windows, instaladores DMG/ZIP/NSIS, GitHub Releases, CI matrix; tudo parametrizado e **desligado até haver repositório/certificados [depende do dono]** | **Fase 21 · Distribuição e atualização** (nova) |
| P-04 | **Commitar localmente** por fase fechada em `ade/principal` (regra geral 1) | coordenador |
| P-05 | **Overdrive** (canvas único) como **modo experimental opcional**, desligado por padrão, só habilita após benchmark provar ganho em 32/64 painéis; rollback para o modo atual | **Fase 23 · Overdrive experimental** (nova, baixa prioridade) |
| P-06 | **Windows é alvo de primeira classe**: CI com matriz completa (suíte unitária + empacotamento), checklist de validação manual, `ConPTY`/wrappers/`taskkill` cobertos por testes; instalador NSIS | Fase 21 |
| P-07 | Licença **MIT** (igual ExpxMedia e expxdev) — arquivo `LICENSE` na raiz | coordenador (já) |
| P-08 | Manter `node:sqlite` atrás da interface **e** adicionar o adaptador opcional `better-sqlite3` com os mesmos testes de contrato (escolha por configuração de build) | Fase 21 / backlog |
| P-09 | Flag de confiança dos hooks do Codex: **alternância própria por workspace** ("Confiar em hooks do repositório no Codex"), padrão desligada em `seguro`, ligada só em `automatico`; explicação na UI; sinaleira estimada quando desligada | corretor AUD-02 + Fase 7 |
| P-10 | Token de atividade por **cabeçalho quando a CLI suporta** e por caminho de URL como fallback (dois transportes); sempre token por sessão em memória | backlog de segurança (Fase 7/8) |
| P-11 | **Instalar `subversion` via Homebrew ao iniciar a Fase 6D** para rodar os testes reais (`svnadmin create` + `file://`); mantém também as fixtures XML gravadas | Fase 6D |
| P-12 | **Forges**: GitHub (`gh`) **e GitLab (`glab`/REST)** na Fase 6C; **Bitbucket e Azure DevOps** por REST logo depois, todos atrás de `Forge` | Fase 6C estendida |
| P-13 | `--force-with-lease` **permitido** como ação manual: confirmação digitada, mostra o diff do que será sobrescrito, **nunca na branch padrão** nem por automação | Fase 6B-2 |
| P-14 | **RAG online: todos os provedores recomendados** na pesquisa (Qdrant, Supabase/pgvector, Upstash, Pinecone, Weaviate, Chroma, Milvus/Zilliz) + Postgres/pgvector genérico e Turso por driver opcional; credenciais no cofre do SO; testes só com stub/self-host local | Fase 15 (15H) |
| P-15 / P-50 | **Autorizado** o runtime de embeddings local (`@huggingface/transformers`/ONNX WASM) e o modelo `multilingual-e5-small` int8 (~118 MB): **download por botão na UI** ("Baixar modelo"), progresso, verificação de hash, cache em `<userData>`; **também Ollama** em loopback e o piso `hash-256-v1`; troca de modelo reembute em segundo plano | Fase 15 |
| P-16 | **Adaptador JEV configurável e genérico** (URL, nome do cabeçalho da chave, esquema de requisição/resposta tipado, ID do modelo) para **chamada direta** E **via OpenRouter**; desligado por padrão; regras determinísticas como fallback | Fase 9/16 |
| P-17 | **OpenRouter com todos os CLIs que aceitam endpoint compatível**: OpenCode, Aider, Goose, Codex (provider customizado), Kilo, Cline e Claude Code por gateway compatível; lista de modelos com a chave do usuário (rede só ao clicar); preços do OpenRouter importados | Fase 9 |
| P-18 | Skills `ev-*`: **botão "Instalar em <CLI>"** e opção **"manter sincronizadas"** por CLI (opt-in); por padrão só por Pane | Fase 7 |
| P-19 | CLIs sem bloqueio duro de skills **permitidas em Missões squad/agentico com selo "isolamento parcial"** + achado de saúde; opção por workspace de **exigir isolamento total** (só Claude) | Fase 7 |
| P-20 | Listar ferramentas de MCP do usuário **permitido**: confirmação por servidor com **"lembrar para este servidor"**, timeout 5 s | Fase 7 |
| P-21 | **Memória ligada por padrão em TODOS os modos** (livre/solo, squad, agêntico), com chave de desligar por workspace e por Missão | Fase 8 |
| P-22 | Retenção da memória **365 dias** (7 dias a "sem limite"), com teto de tamanho e aviso | Fase 8 |
| P-23 | **Anel 3 (preferências do usuário) existe e fica ativo**, até 50 itens, só por ação humana, entra no pacote do piloto | Fase 8 |
| P-24 | **Squad com memória própria** (anel da squad, isolada das demais); a spec RF-06.42 é substituída por esta decisão | Fase 8 / 14 |
| P-25 | Depois de cada Missão o ADE **roda `memox.py reindexar` sozinho** (script determinístico, sem modelo e sem rede) e mantém o botão manual | Fase 8 |
| P-26 | **Caminhos das CLIs configuráveis**: detecção automática + tela "Caminhos" para o usuário sobrescrever onde cada CLI guarda skills/MCP; erro nominal por CLI | Fase 7 |
| P-34 | **STT com os três motores**: executável local do usuário (whisper.cpp, etc.), endpoint HTTP compatível com `/audio/transcriptions` (com a chave dele, consentimento por host) **e** o reconhecimento nativo do SO quando existir; escolha na UI | Fase 11 |
| P-35 | **Hold-to-talk global** com módulo nativo opcional (`uiohook-napi`) + permissão de Input Monitoring/Acessibilidade, **opt-in** com explicação; sem ele, alternar global e segurar com o app em foco | Fase 11 |
| P-36 | Plist/entitlements completos para microfone, tela e acessibilidade; validação real **[depende do dono: assinatura/P-03]** | Fases 11/21 |
| P-37 | **Autorizada UMA validação real mínima** dos adaptadores do Bench (regra geral 4) e, depois, um bench real de custo baixo **com consentimento digitado do dono na UI** | Fase 12 |
| P-38 | **Bench no Windows permitido sem sandbox** com **consentimento reforçado digitado** e aviso de risco; macOS/Linux com sandbox | Fase 12 |
| P-39 | Tabela de preços **editável + importação do OpenRouter** (API pública de modelos) + semente só com preços confirmados; sem preço = "custo desconhecido" (nunca zero) | Fases 10/12 |
| P-40 | **Adaptadores reais de voz realtime** (Gemini Live, OpenAI Realtime) liberados **opt-in** com chave do usuário no cofre, aviso de custo e **timeout de sessão** | Fase 13 |
| P-41 | **Controle remoto local aceito** (riscos R1/R2 documentados na UI), desligado por padrão e a cada reinício, com aviso; revisão externa **recomendada** antes de uso fora de rede doméstica | Fase 13 |
| P-42 | **Relay cego + app móvel (PWA, sem Apple Developer) + VPS opcional (Docker)** liberados como fase própria, **começando por estudo de ameaças** (T-13.01 estendido) | **Fase 22 · Acesso remoto estendido** (nova) |
| P-18b | **Telegram: 'executar direto' permitido** como opção por workspace, respeitando a rigidez; padrão "aprovar antes" | Fase 20 |
| P-51 | **Importar o histórico das CLIs** para o RAG: assistente no onboarding por CLI, com prévia, redação de segredos e escolha de período; opt-in | Fase 15 |
| P-52 | Chat com **3 modos**: "confirmar sempre", "direto para ações reversíveis" (**padrão**) e "direto total" (opcional, respeita rigidez); destrutivo sempre confirma | Fase 15 |
| P-53 | Consulta ao RAG: **modos aviso (padrão) e bloqueio** configuráveis por workspace e por nível de rigidez | Fases 15/16 |
| P-54 | **Todos os 7 provedores** (P-14); teste real com free tier **[depende do dono: contas]**; até lá, stub/self-host | Fase 15 |
| P-55 | O que sobe para o RAG da equipe **configurável por tipo**: padrão = aprendizados, decisões, docs, relatórios, commits; **código e transcrições disponíveis como opt-in por tipo**, com redação e aviso de que outros verão | Fase 15 |
| P-56 | **Destilar aprendizados com IA ligado** (1 chamada por Missão, perfil mais barato do usuário), com chave de desligar e botão manual | Fase 15 |
| P-57 | **Incluir `sqlite-vec`** quando o spike passar (entitlement `disable-library-validation` ou dylib assinado [depende do P-03]); fallback exato permanece | Fase 15 / 21 |
| P-58 | Uma chamada real mínima por CLI headless para validar o formato (regra geral 4) | Fase 15 |
| P-59 | Retenção das transcrições **365 dias** e teto **5 GB** (aviso a 80 %), configuráveis | Fase 15 |
| P-27 | **Modo "Precisão máxima" opt-in por provedor**: usa **apenas** os arquivos de uso que a própria CLI grava e os endpoints **oficiais** que ela usa, com consentimento explícito; **token nunca é guardado nem logado**; padrão continua sem ler credencial | Fase 9 |
| P-28 | Trocas por consumo com **todos os modos** (automático / só sugerir / manual), nível por workspace; padrão derivado da permissão; gatilho 85% configurável; até 3 saltos; troca de provedor **permitida**; faixa mínima configurável | Fase 9 |
| P-29 | Linux sem keyring: **cofre em arquivo cifrado com senha-mestra** do usuário (scrypt + AES-GCM) como alternativa a recusar | Fase 9 (cofre) |
| P-30 | Aceito o risco de termos de uso; **aviso fixo na UI**, cooldown, e todos os modos de troca disponíveis; sem automação de login | Fase 9 |
| P-31 | Tabela de equivalência **editável e versionada**; Codex/Gemini/OpenRouter preenchidos a partir da documentação pública quando confirmada; **descer 1 faixa permitido** (com aviso) | Fase 9 |
| P-32 | Meta semanal 90 % (configurável) e **os três alertas ligados**, integrados ao Centro de Alertas (Fase 20) | Fases 9/20 |
| P-33 | **Adaptadores de endpoint customizado para `codex` e `goose`** implementados e validados contra as CLIs reais por `--help`/execução mínima (regra geral 4); `goose` entra no catálogo | Fase 9 / 16 |
| P-80 | Teto de custo por Missão: **alertar E, por opção, bloquear/abortar** ao passar do teto; padrão sem teto | Fase 10 |
| P-81 | Ler transcripts locais só para contar tokens/modelo — **mantido ligado** | Fase 10 |
| P-82 | **Adaptadores de uso para todas as CLIs** (Gemini, OpenCode, Aider, Qwen, Kilo), em ordem de uso; via OpenRouter já medido pelo proxy | Fase 10 |

## Loja de MCPs (Fase 7B; P-130..P-138) — opção mais completa

| # | Decisão (opção mais completa) | Efeito |
|---|---|---|
| P-130 | **Runtime próprio empacotado como opção**: o app diagnostica `npm`/`uv` do sistema e, se faltarem, oferece **"Instalar runtime gerenciado"** (Node LTS e `uv` baixados por botão para `<userData>/runtimes/`, com hash verificado, sem sudo) — assim o "um clique" funciona em máquina sem Node/Python; nada empacotado no instalador | Fase 7B T-07B.12/.13/.31 (+ task nova de runtime gerenciado) |
| P-131 | **Autorizado** rodar `scripts/gerar-lock-mcp.mjs` (rede só de leitura em npm/PyPI) para gerar locks/hashes de TODOS os servidores confirmados; resultado versionado no seed; nível `estrito` por padrão para os pré-instalados | Fase 7B T-07B.33 |
| P-132 | **Aceito**: remotos com chave de API **e** OAuth; OAuth feito pela CLI continua preferido; selo e aviso mantidos | Fase 7B |
| P-133 | **Gateway MCP interno LIBERADO** como fase seguinte (aglutina servidores, encerra ociosos, filtra tool a tool, guarda OAuth no cofre) — entra como **Fase 7C** logo após a 7B | Fase 7C (nova) |
| P-134 | **Sandbox aplicado** aos servidores stdio de risco médio/alto (`sandbox-exec` no macOS; Linux por `bubblewrap`/`firejail` se existir; Windows: Job Object + diretório isolado, com selo "isolamento parcial"); opção de **Docker** quando instalado | Fase 7B |
| P-135 | **Listar com selo de licença** (GPL/FSL/source-available) e nota; nunca empacotar nem redistribuir; instalação só por clique do usuário | seed |
| P-136 | **Kit mínimo ampliado e habilitado por padrão (instalação por clique no primeiro uso)**: `context7`, `deepwiki`, `sequential-thinking` + `git` e `filesystem` restritos ao workspace + `fetch`; todos desligáveis em Configurações; aviso claro sobre o que cada um envia a terceiros | Fase 7B |
| P-137 | **Descoberta no Registro Oficial incluída na primeira versão** (rede só por clique; metadados CC0; resultados marcados "não curado", instalação exige revisão do comando) | Fase 7B T-07B.32 |
| P-138 | Selo "plano grátis não confirmado" mantido; o app **nunca anuncia "grátis"** sem confirmação; link para o preço oficial | seed |

## Mapa lógico do código (Fase 17; P-270..P-279) — opção mais completa

| # | Decisão (opção mais completa) | Efeito |
|---|---|---|
| P-270 | **Autorizado** compilar as gramáticas extras (Kotlin, Swift, Scala, Dart, C puro, SQL e demais relevantes) no backlog B1: usa Docker se existir; senão `emsdk` LOCAL em pasta de cache do projeto (não global, reversível), `tree-sitter-cli` via npm; resultado `.wasm` versionado/hasheado | Fase 17 B1 |
| P-271 | Peso aceito para a Onda 1+2 no instalador **e** "pacotes de linguagem" **baixáveis por botão** para as extras (hash verificado, `<userData>/gramaticas/`); flag de build `…_MAPA_LINGUAGENS` para builds enxutos | Fase 17 T-17.02 |
| P-272 | Botão **"Instalar via Homebrew"** com confirmação digitada `INSTALAR`, lista fechada de fórmulas, sem `sudo`; sem `brew`, mostra o comando | Fase 17 T-17.37 |
| P-273 | **Indexadores SCIP oferecidos na UI**, opt-in com consentimento digitado, aviso de que rodam build/typecheck, sandbox quando existir | Fase 17 B4/T-17.36 |
| P-274 | Teto de 150 000 arquivos **configurável (inclusive sem limite)**, aviso a partir de 20 000, análise por subpasta e por pacote de monorepo | Fase 17 |
| P-275 | Camadas manuais em `<userData>/mapas/<ws>/camadas.json` **e** espelho em `.<produto>/mapa/camadas.json` (para as skills lerem); importar regras do dependency-cruiser/import-linter/deptrac | Fase 17 T-17.25 |
| P-276 | **Sim**: ler licenças das dependências do projeto analisado (somente leitura local) com selos informativos | Fase 17 T-17.28 |
| P-277 | **Aceito** o que o mapa guarda (nomes, assinaturas sanitizadas, `arquivo:linha`, 1ª linha de comentário redigida; nunca código); botão "Apagar mapa" digitando `APAGAR` | Fase 17 |
| P-278 | **Sim**: histórico SVN (`svn log --xml -v`) para churn/hotspots logo após o portão da 17 (depende de instalar o `svn`, P-11) | Fase 17 B5 |
| P-279 | Validar a economia de contexto no **primeiro projeto real** do usuário **e** criar um benchmark interno (projeto legado sintético grande + o próprio repositório) com métricas de tokens economizados; Windows via CI (Fase 21) | Fase 17 |

## Gestão ágil e documentação (Fases 18 e 19; P-60..P-67) — opção mais completa

| # | Decisão (opção mais completa) | Efeito |
|---|---|---|
| P-60 | Estimativa por IA **ligada**, heurística imediata sempre disponível; teto diário **configurável** (padrão 40 chamadas/dia, lote de 20) e **perfil de LLM escolhível** (inclusive o mais barato); só texto das tasks, nunca código; botão para desligar | Fase 18 |
| P-61 | Janela de retrabalho **configurável por workspace** (padrão 14 dias) e **por tipo de task** (feature/bug/refator) | Fase 18 |
| P-62 | Capacidade: **mediana de 3 velocidades** como padrão **e** valor fixo por pessoa/agente como opção; horas focadas e fator de foco por pessoa (padrão 6 h × 0,6), calendário de folgas | Fase 18 |
| P-63 | Fechar sprint: **manual (padrão)**, com **opção de fechamento automático** (todas `concluida` + QA `aprovado`) **e** de **fechamento agendado** (data/hora do fim da sprint); sempre gera o pacote de relatórios | Fase 18/19 |
| P-64 | Redação por IA em `auto` (usa a CLI quando houver), consentimento registrado, `template` sempre disponível; **também modo "revisão humana" que mostra o texto gerado com as fontes antes de salvar** | Fase 19 |
| P-65 | **Exportar para dentro de `docs/` LIBERADO** como opção (exceção D-04): subpastas fora das áreas do método, confirmação digitada, nunca sobrescreve artefatos do método; padrão continua fora de `docs/` | Fase 19 |
| P-66 | **Marca configurável completa**: nome, logo (arquivo local, embutido em base64 no HTML), cores, rodapé, contato, idioma (pt-BR/en/es), **vários perfis de marca** (um por cliente/projeto) e importar/exportar; padrão sem marca | Fase 19 |
| P-67 | **Adaptadores de publicação liberados** como extensão da Fase 20 (GitHub Release, e-mail SMTP, webhook genérico, Slack/Discord, Telegram), **sempre com aprovação por botão** antes de enviar e credenciais no cofre do SO; nunca publica sozinho | Fases 19/20 |

## Alertas e Telegram (Fase 20; P-70..P-79) — opção mais completa

| # | Decisão (opção mais completa) | Efeito |
|---|---|---|
| P-70 | Riscos residuais R1/R2/R3 **aceitos** com aviso fixo na tela do canal e consentimento versionado; mitigações do estudo (nível mínimo, política que manda risco ao desktop, PIN, validade curta) | Fase 20 |
| P-71 | **PIN**: disponível em 3 níveis por workspace — opcional, recomendado (padrão do assistente) e **obrigatório** (política da organização); só hash `scrypt` no banco | Fase 20 |
| P-72 | **"Executar direto" implementado e disponível** por workspace (digitar `DIRETO`); desligado por padrão; restrições do plano (rigidez ≤ 3, raio BAIXO, branch própria, ≤ 2 painéis, não destrutivo) **configuráveis** pelo usuário dentro de limites seguros fixos | Fase 20 |
| P-73 | Texto livre vira pedido em "aprovar antes" **e** em "executar direto"; em "só consultar" o bot dá dica | Fase 20 |
| P-74 | **Grupos e mídia como extensão opcional**: grupos (com allowlist de chat e de membros e aviso sobre admins), **voz** (transcrição pelo STT da Fase 11 com consentimento) e **anexos** (imagem/arquivo até limite, com varredura e redação) liberados **desligados**, cada um com estudo curto na própria task; padrão: chat privado e texto | Fase 20 (tasks extras) |
| P-75 | Mensagens com **título redigido, nome do projeto opcional e "ocultar títulos" em um clique**; conteúdo configurável por perfil (mínimo, padrão, detalhado) | Fase 20 |
| P-76 | **Resumo diário e de sprint disponíveis**, horário configurável (padrão 18:00), por canal; ligados quando o usuário ativa o canal (com pergunta no assistente) | Fase 20 |
| P-77 | **Canais extras todos construídos** como adaptadores: webhook genérico assinado, e-mail (SMTP), Slack e Discord (webhook de entrada), cada um com credencial no cofre do SO, aprovação/consentimento e testes só com servidor falso; ordem: webhook → Slack/Discord → e-mail | Fase 20 (tasks extras) |
| P-78 | **Autorizado** um teste real manual com um bot descartável do dono quando ele quiser (checklist); nada automático | Fase 20 |
| P-79 | Parâmetros de "atrasada" como no plano, **editáveis por workspace e por tipo de task** em Alertas › Config; `pane_aguardando` configurável | Fase 20 |

## Squads, Maestro e rigidez (Fases 14 e 16; P-230..P-233, P-310..P-320) — opção mais completa

| # | Decisão (opção mais completa) | Efeito |
|---|---|---|
| P-230 | Nomes de modelos por faixa e níveis de esforço: **tabela editável por CLI**, preenchida só com o que a documentação pública/`--help` confirmar; esforço **detectado por CLI** (flag real quando existe: `--effort`/equivalente; senão instrução no prompt como `indicativo`); o usuário completa na UI "Modelos por CLI" | Fases 9/14 |
| P-231 | **As 13 squads de fábrica aceitas e ampliadas** (o coordenador acrescenta as que fizerem sentido ao revisar: ex. API/contratos, Acessibilidade/UX, Dados/migrações, Observabilidade); MCPs padrão por squad escolhidos do seed da Loja (docs/context7 em todas as de código; playwright na de QA/frontend; git/filesystem restritos) | Fase 14 + 7B |
| P-232 | **Versionar `.expxv/squads/` e `.expxv/pipelines/` no repositório** por exportação explícita (botão "Exportar para o repositório") **e** modo "sincronizar" opt-in; o ADE nunca comita | Fase 14 |
| P-233 | Padrões das squads: **até 6 terminais paralelos** (configurável até o limite global), "plano antes" ligado, orçamentos de tempo/tokens soft **e opção de rígido (aborta)** | Fase 14 |
| P-310 | JEV: adaptador genérico e configurável (decidido em P-16); **validação real quando o dono fornecer o endpoint [depende do dono]** | Fase 16 |
| P-311 | Padrões de fábrica por etapa **aceitos** (tabela do plano), todos editáveis, com **perfis prontos nomeados** (Econômico, Equilibrado, Máxima qualidade) aplicáveis em um clique a todos os pipelines | Fase 16 |
| P-312 | **Texto de rigidez nas skills**: o ADE **não edita as skills**, mas **gera, sob ação do usuário, um arquivo de instruções por Missão** (já previsto) **e oferece "Exportar sugestão de patch para as skills"** (diff para o dono do expxdev aplicar) | Fase 16 |
| P-313 | **Hook que bloqueia o prompt** (zero token) em painel livre do Claude: **adotado** (confiança ≥ 0,75; `@direto` trata no painel); modo configurável (bloquear / só avisar / desligado); Codex/OpenCode notificam | Fase 16 |
| P-314 | 5 níveis **Relâmpago, Leve, Padrão, Rigoroso, Total**; padrão 3; **nomes e descrições editáveis** pelo usuário | Fase 16 |
| P-315 | **Exceção ao D-04 aceita**: ADE escreve `.expx/hooks.json` só por ação explícita, com backup/reversão; promoção a `bloqueio` nos níveis 4–5 | Fase 16 |
| P-316 | Branches protegidas **padrão do plano + lista editável por workspace** e opção de marcar workspace como "produção" | Fase 16 |
| P-317 | `mergex-pr`: confirmar push/PR em `seguro` e `equilibrado`; automático em `automatico` | Fase 16 |
| P-318 | **Executar o método em outras CLIs**: instalar o `expxdev` para Codex/Gemini/Goose **por botão** (copia comandos/skills ao local da CLI, opt-in) e habilitar o método nelas depois de uma verificação de contrato (tarefa de verificação por CLI); até lá `rapido`, squads e chat | Fases 7/16 |
| P-319 | OpenRouter no Pane: **três modos selecionáveis** — (a) o usuário autentica a CLI sozinho, (b) injeção do cofre no ambiente do Pane (`injetar_cofre_no_env`, opt-in com aviso de que desliga o login por assinatura do Claude) e (c) proxy local do app (`proxy-worker`) com chave só no app; padrão (a); rede só por clique | Fases 9/16 |
| P-320 | Canais remotos **só podem subir** a rigidez, nunca baixar nem sobrescrever trava (mantido; é regra de segurança, não de funcionalidade) | Fases 16/20 |

## Fases novas decorrentes (entram na fila, depois das prioritárias)
- **Fase 7C · Gateway MCP interno** (aglutinador de servidores, encerra ociosos, filtro por tool, OAuth no cofre) — logo após a 7B.
- **Fase 21 · Distribuição e atualização** (auto-update com canais, assinatura/notarização, instaladores macOS/Windows, CI completo, renomeação do produto, `better-sqlite3` opcional).
- **Fase 22 · Acesso remoto estendido** (relay cego, PWA móvel, VPS opcional em Docker; **estudo de ameaças primeiro**).
- **Fase 23 · Overdrive experimental** (canvas único para 32–64 painéis, só habilita com benchmark verde).
