// Fonte das squads de FÁBRICA (Fase 14, T-14.08; P-231): 13 do plano + 4 extras (API/contratos, Acessibilidade/UX,
// Dados/migrações, Observabilidade). Os prompts-base por papel moram em `resources/squads/arquetipos/*.md` (editáveis);
// cada membro = arquétipo + foco da squad + foco do membro. `scripts/verificar-squads.mjs --gerar` materializa tudo em
// `resources/squads/` (squad.json + membros/*.md + rigor.json + manifesto.json); sem a flag, só VERIFICA que o disco
// está igual a esta fonte e que toda squad passa no validador. Nenhum nome de produto, caminho absoluto ou segredo aqui.

/** Versão do pacote de fábrica: sobe quando QUALQUER squad muda (a atualização de cópias compara por unidade). */
export const VERSAO_PACOTE = 1;

/**
 * Modelos concretos só os confirmados (aliases do Claude); a faixa orienta (P-230). O membro pode fixar `modelo` quando
 * a independência de revisão (revisor com modelo diferente do executor) exige.
 */
const MODELO_POR_FAIXA = { topo: "opus", alto: "opus", medio: "sonnet", rapido: "haiku" };

export const SKILLS_CONHECIDAS = [
  "ev-pilot", "ev-guide", "ev-mcp", "ev-scout", "ev-builder", "ev-reviewer", "ev-evidence-before-done",
  "grupo:metodo", "stackx-detectar", "legadox-perfil", "legadox-raio", "memox-buscar", "memox-indexar",
];

const SKILLS_POR_PAPEL = {
  orchestrator: ["ev-pilot", "ev-guide", "ev-mcp"],
  scout: ["ev-scout", "ev-evidence-before-done"],
  executor: ["ev-builder", "ev-evidence-before-done"],
  reviewer: ["ev-reviewer", "ev-evidence-before-done"],
};

/** Textos de rigor (Anexo B do plano): 1 Relâmpago .. 5 Total. A Fase 16 define o nível; `snippetDeRigor` lê daqui. */
export const RIGOR = [
  { nivel: 1, nome: "Relâmpago", texto: "Rigor mínimo: faça só o que foi pedido, com o menor caminho. Ainda assim: um teste para o comportamento alterado, suíte afetada verde, nenhum segredo, nenhuma operação git destrutiva. Não amplie o escopo." },
  { nivel: 2, nome: "Leve", texto: "Rigor leve: plano de uma linha; teste de regressão ou de integração do que mudou; revise o próprio diff antes de entregar. Evite explorar além do necessário." },
  { nivel: 3, nome: "Padrão", texto: "Rigor padrão: dois testes por card (integração e funcional), escopo travado no contrato, relatório com evidência, handoff completo." },
  { nivel: 4, nome: "Rigoroso", texto: "Rigor alto: teste antes do código (veja-o falhar), subconjunto e suíte verdes, revisão independente obrigatória, registre alternativas descartadas e riscos, nenhum 'depois eu vejo'." },
  { nivel: 5, nome: "Total", texto: "Rigor total: tudo do nível anterior, mais casos de borda e consequências de segunda ordem, verificação cruzada por outro agente, evidência anexada a cada critério de aceite e nenhuma pendência escondida." },
];

const ORQ = (faixa, esforco, extra = {}) => ({ slug: "orquestrador", papel: "orchestrator", arq: "orquestrador", rotulo: "Orquestrador", desc: "Planeja, delega aos agentes da squad e fecha a Missão com o revisor.", faixa, esforco, n: 1, ...extra });
const REV = (faixa = "alto", esforco = "alto", extra = {}) => ({ slug: "revisor", papel: "reviewer", arq: "revisor", rotulo: "Revisor", desc: "Revisão independente contra o contrato do card; só ele libera a conclusão.", faixa, esforco, n: 1, ...extra });

export const SQUADS = [
  {
    slug: "feature-fullstack", nome: "Feature Full-stack", escopo: "desenvolvimento",
    descricao: "Entrega uma feature ponta a ponta, por camada, com testes e revisão independente.",
    foco: "Divida por camada com o contrato de API primeiro; backend e frontend só rodam em paralelo depois do contrato fechado. O testador escreve os testes de integração e funcionais antes da implementação. Prefira um revisor de outro provedor quando houver.",
    membros: [
      ORQ("topo", "alto", { foco: "Fixe o contrato entre as camadas antes de delegar a implementação." }),
      { slug: "explorador-codigo", papel: "scout", arq: "explorador", rotulo: "Explorador de código", desc: "Mapeia o código, contratos e testes que a feature vai tocar.", faixa: "rapido", esforco: "baixo", n: 2, mcps: [], foco: "Mapeie separadamente backend, frontend e contratos existentes." },
      { slug: "implementador-backend", papel: "executor", arq: "implementador", rotulo: "Implementador backend", desc: "Implementa a camada de servidor, dados e contrato de API do card.", faixa: "medio", esforco: "medio", n: 2, mcps: ["context7"], foco: "Só a camada de servidor; respeite o contrato de API acordado e não altere o frontend." },
      { slug: "implementador-frontend", papel: "executor", arq: "implementador", rotulo: "Implementador frontend", desc: "Implementa a interface e o consumo do contrato de API do card.", faixa: "medio", esforco: "medio", n: 2, mcps: ["context7", "playwright-mcp"], foco: "Só a camada de interface; consuma o contrato, trate estados de erro, vazio e carregamento, e confira no navegador." },
      { slug: "testador", papel: "executor", arq: "testador", rotulo: "Testador", desc: "Escreve os testes de integração e funcionais antes da implementação.", faixa: "medio", esforco: "medio", n: 1, mcps: ["playwright-mcp"], foco: "Escreva os testes a partir do contrato, antes de a implementação existir." },
      REV("alto", "alto", { foco: "Confira cada critério de aceite da feature ponta a ponta, não só cada camada." }),
    ],
  },
  {
    slug: "correcao-de-bug", nome: "Correção de Bug", escopo: "desenvolvimento",
    descricao: "Prova a causa raiz, escreve o teste de regressão vermelho e só então corrige, no menor escopo.",
    foco: "A causa raiz precisa estar comprovada antes de qualquer correção. O teste de regressão é escrito e visto falhar antes do fix. O escopo fica travado no que a investigação provou; nada de refatoração de brinde.",
    membros: [
      ORQ("topo", "medio", { foco: "Não libere a correção enquanto a causa raiz não tiver evidência." }),
      { slug: "investigador", papel: "scout", arq: "investigador", rotulo: "Investigador", desc: "Reproduz o problema e prova a causa raiz com evidência.", faixa: "alto", esforco: "alto", n: 1, mcps: ["git"], foco: "Use o histórico do repositório para achar quando e por que o comportamento mudou." },
      { slug: "corretor", papel: "executor", arq: "implementador", rotulo: "Corretor", desc: "Aplica a menor correção que faz o teste de regressão passar.", faixa: "medio", esforco: "medio", n: 1, mcps: ["context7"], foco: "Corrija somente o que a investigação provou; qualquer outra melhoria vai para o relatório." },
      { slug: "testador-regressao", papel: "executor", arq: "testador", rotulo: "Testador de regressão", desc: "Escreve o teste que falha hoje e prova que a correção o faz passar.", faixa: "medio", esforco: "medio", n: 1, foco: "O teste de regressão deve ser visto falhando antes do fix; anexe a saída vermelha." },
      REV("alto", "alto", { foco: "Verifique que a causa raiz foi de fato eliminada e que nada fora do escopo mudou." }),
    ],
  },
  {
    slug: "revisao-de-pr", nome: "Revisão de PR e Qualidade", escopo: "qualidade",
    descricao: "Revisa um conjunto de mudanças por ângulos diferentes e consolida um único parecer, sem alterar código.",
    foco: "Esta squad não altera código: só produz achados por severidade, com arquivo e linha. Cada revisor olha um ângulo diferente; o orquestrador consolida tudo em um único parecer.",
    membros: [
      ORQ("alto", "medio", { foco: "Consolide os pareceres em um só, sem duplicar achados, ordenado por severidade." }),
      { slug: "leitor-de-diff", papel: "scout", arq: "explorador", rotulo: "Leitor de diff", desc: "Lê a mudança inteira e resume intenção, arquivos e áreas de risco.", faixa: "rapido", esforco: "baixo", n: 1, mcps: ["git"], foco: "Resuma o que mudou e por quê, e aponte onde os revisores devem olhar com mais cuidado." },
      { slug: "revisor-logica", papel: "reviewer", arq: "revisor", rotulo: "Revisor de lógica", desc: "Revisa corretude, casos de borda e regressões de comportamento.", faixa: "alto", esforco: "alto", n: 1, foco: "Seu ângulo é a lógica: corretude, casos de borda, concorrência e regressão de comportamento." },
      { slug: "revisor-seguranca", papel: "reviewer", arq: "revisor", rotulo: "Revisor de segurança", desc: "Revisa entradas não confiáveis, autorização, segredos e dependências.", faixa: "alto", esforco: "alto", n: 1, foco: "Seu ângulo é a segurança: entradas não confiáveis, autorização, segredos e dependências novas." },
      { slug: "revisor-testes-estilo", papel: "reviewer", arq: "revisor", rotulo: "Revisor de testes e estilo", desc: "Revisa a qualidade dos testes e a aderência às convenções.", faixa: "medio", esforco: "medio", n: 1, mcps: ["eslint"], foco: "Seu ângulo são os testes e o estilo: o teste passaria com a implementação errada? As convenções do repositório foram seguidas?" },
    ],
  },
  {
    slug: "refatoracao-legado", nome: "Refatoração de Legado", escopo: "desenvolvimento",
    descricao: "Refatora código legado em passos pequenos, protegido por testes de caracterização escritos antes.",
    foco: "O comportamento atual é o contrato, bugs inclusive. Escreva testes de caracterização antes de mexer, avance em passos pequenos, e mande qualquer melhoria colateral para a lista de dívida. Raio de impacto alto exige aprovação humana, nunca automatizada.",
    membros: [
      ORQ("topo", "alto", { foco: "Se o raio de impacto for alto, pare e peça a aprovação da pessoa antes de delegar a refatoração." }),
      { slug: "cartografo", papel: "scout", arq: "cartografo", rotulo: "Cartógrafo", desc: "Mapeia dependências, raio de impacto e zonas de risco do trecho legado.", faixa: "alto", esforco: "alto", n: 1, skills: ["legadox-raio", "memox-buscar"], foco: "Entregue o raio de impacto do trecho e quem depende dele; use o mapa do código quando existir." },
      { slug: "autor-caracterizacao", papel: "executor", arq: "testador", rotulo: "Autor de caracterização", desc: "Escreve testes que fixam o comportamento atual antes da refatoração.", faixa: "medio", esforco: "medio", n: 1, foco: "Fixe o comportamento ATUAL, mesmo que errado; não corrija nada, só caracterize." },
      { slug: "refatorador", papel: "executor", arq: "implementador", rotulo: "Refatorador", desc: "Refatora em passos pequenos mantendo todos os testes verdes.", faixa: "alto", modelo: "sonnet", esforco: "alto", n: 1, mcps: ["context7"], foco: "Um passo pequeno por vez, suíte verde a cada passo, zero mudança de comportamento e zero melhoria colateral." },
      REV("alto", "alto", { foco: "Confirme que o comportamento observável não mudou e que não houve mudança fora do escopo." }),
    ],
  },
  {
    slug: "testes-qa", nome: "Testes e QA", escopo: "qualidade",
    descricao: "Gera testes que falham com a implementação errada e mede a cobertura antes e depois.",
    foco: "Os testes gerados precisam falhar quando a implementação estiver errada. Rode a suíte e meça a cobertura antes e depois. O revisor aplica a pergunta: esse teste passaria com a implementação errada?",
    membros: [
      ORQ("alto", "medio", { foco: "Distribua os módulos entre os geradores sem sobreposição de arquivos." }),
      { slug: "gerador-de-testes", papel: "executor", arq: "testador", rotulo: "Gerador de testes", desc: "Escreve testes de integração e funcionais que discriminam.", faixa: "medio", esforco: "medio", n: 3, mcps: ["context7", "playwright-mcp"], foco: "Cada teste precisa falhar quando o comportamento estiver errado; evite asserções triviais." },
      { slug: "analista-de-cobertura", papel: "scout", arq: "explorador", rotulo: "Analista de cobertura", desc: "Mede a cobertura e aponta o que está sem teste e é arriscado.", faixa: "rapido", esforco: "baixo", n: 1, foco: "Meça a cobertura antes e depois e liste os trechos arriscados sem teste, por prioridade." },
      REV("alto", "alto", { slug: "revisor-de-testes", rotulo: "Revisor de testes", foco: "Para cada teste, responda: ele passaria com a implementação errada? Teste fraco é achado." }),
    ],
  },
  {
    slug: "auditoria-seguranca", nome: "Auditoria de Segurança", escopo: "seguranca",
    descricao: "Audita segurança em modo somente leitura, com achados por severidade e evidência.",
    foco: "A auditoria é somente leitura: nunca explore de verdade, nunca toque produção ou rede externa. Cada achado tem severidade, evidência com arquivo e linha e correção sugerida. O verificador reprova achado sem evidência. Nenhum segredo é copiado para o relatório.",
    membros: [
      ORQ("topo", "alto", { permissao: "seguro", foco: "Garanta que ninguém execute exploração; só leitura e análise." }),
      { slug: "modelador-de-ameacas", papel: "scout", arq: "auditor-seguranca", rotulo: "Modelador de ameaças", desc: "Levanta superfícies de ataque, fronteiras de confiança e ameaças prováveis.", faixa: "topo", esforco: "alto", n: 1, permissao: "seguro", foco: "Produza o modelo de ameaças que guiará os caçadores: entradas, fronteiras de confiança, ativos e abusos prováveis." },
      { slug: "cacador-de-vulnerabilidades", papel: "scout", arq: "auditor-seguranca", rotulo: "Caçador de vulnerabilidades", desc: "Procura vulnerabilidades no código e na configuração, só por leitura.", faixa: "alto", esforco: "alto", n: 2, permissao: "seguro", foco: "Caçe vulnerabilidades dentro do recorte recebido; cada achado com evidência e correção sugerida." },
      REV("alto", "alto", { slug: "verificador", rotulo: "Verificador", permissao: "seguro", foco: "Reprove todo achado sem evidência verificável e todo relatório que contenha valor de segredo." }),
    ],
  },
  {
    slug: "documentacao", nome: "Documentação", escopo: "documentacao",
    descricao: "Escreve documentação técnica e de uso a partir do código real, sem inventar.",
    foco: "A documentação nasce do código real: o que não estiver nele é marcado NÃO DOCUMENTADO. Exemplos devem ser executáveis. O revisor confere cada afirmação contra o código. Não escreva em docs/** do método sem o usuário escolher o destino.",
    membros: [
      ORQ("alto", "medio", { foco: "Pergunte ao usuário o público e o destino dos arquivos antes de delegar a escrita." }),
      { slug: "leitor-de-codigo", papel: "scout", arq: "explorador", rotulo: "Leitor de código", desc: "Lê o código e extrai o que a documentação precisa afirmar, com evidência.", faixa: "rapido", esforco: "baixo", n: 2, foco: "Extraia fatos verificáveis do código (entradas, saídas, comandos, limites) para o redator." },
      { slug: "redator", papel: "executor", arq: "redator", rotulo: "Redator", desc: "Escreve a documentação a partir dos fatos extraídos do código.", faixa: "medio", esforco: "medio", n: 2, mcps: ["filesystem"], foco: "Escreva só o que o código sustenta; marque o resto como NÃO DOCUMENTADO." },
      REV("alto", "medio", { foco: "Confira cada afirmação da documentação contra o código e rode os exemplos." }),
    ],
  },
  {
    slug: "devops-ci", nome: "DevOps e CI", escopo: "devops",
    descricao: "Escreve pipelines e containers como arquivos versionados, validados localmente e nunca disparados.",
    foco: "Pipelines e Dockerfiles são apenas arquivos versionados: nunca dispare, publique ou implante. Nenhum segredo em arquivo, nenhum push ou deploy. A validação é por lint ou dry-run local.",
    membros: [
      ORQ("alto", "medio", { foco: "Garanta que nada seja disparado; a entrega são arquivos versionados e validados localmente." }),
      { slug: "engenheiro-de-pipeline", papel: "executor", arq: "engenheiro-infra", rotulo: "Engenheiro de pipeline", desc: "Escreve e valida pipelines de integração e entrega como arquivos.", faixa: "medio", esforco: "medio", n: 1, mcps: ["context7"], foco: "Cuide só dos arquivos de pipeline; segredos entram por referência ao cofre do provedor, nunca no arquivo." },
      { slug: "engenheiro-de-containers", papel: "executor", arq: "engenheiro-infra", rotulo: "Engenheiro de containers", desc: "Escreve e valida Dockerfiles e composição de containers.", faixa: "medio", esforco: "medio", n: 1, mcps: ["context7"], foco: "Cuide só de containers: imagem mínima, usuário sem privilégio, versões fixas, sem segredo na imagem." },
      REV("alto", "alto", { foco: "Confira que não há segredo, que nada é disparado e que a validação local foi executada." }),
    ],
  },
  {
    slug: "migracao-dependencias", nome: "Migração e Atualização de Dependências", escopo: "desenvolvimento",
    descricao: "Atualiza dependências uma por vez, lendo os breaking changes e mantendo a suíte verde a cada passo.",
    foco: "Uma dependência, ou um grupo coeso, por card. Leia o changelog e os breaking changes antes de mexer. A suíte inteira precisa estar verde a cada passo. O lockfile só muda por comando oficial do gerenciador.",
    membros: [
      ORQ("alto", "medio", { foco: "Ordene as atualizações das menos para as mais arriscadas, um card por dependência." }),
      { slug: "analista-de-impacto", papel: "scout", arq: "investigador", rotulo: "Analista de impacto", desc: "Lê changelogs e aponta breaking changes e áreas do código afetadas.", faixa: "alto", esforco: "alto", n: 1, mcps: ["context7"], foco: "Para cada dependência: versão atual e alvo, breaking changes, trechos do código afetados e plano de teste." },
      { slug: "atualizador", papel: "executor", arq: "implementador", rotulo: "Atualizador", desc: "Atualiza a dependência e adapta o código aos breaking changes.", faixa: "medio", esforco: "medio", n: 1, mcps: ["context7"], foco: "Atualize só o card; lockfile por comando oficial, sem editar à mão, e suíte verde antes de entregar." },
      { slug: "testador", papel: "executor", arq: "testador", rotulo: "Testador", desc: "Roda a suíte inteira e cobre os pontos afetados pela atualização.", faixa: "medio", esforco: "medio", n: 1, foco: "Rode a suíte inteira a cada passo e adicione testes onde a atualização expôs lacuna." },
      REV("alto", "alto", { foco: "Confira que só a dependência do card mudou e que o lockfile é coerente com o manifesto." }),
    ],
  },
  {
    slug: "performance", nome: "Performance", escopo: "qualidade",
    descricao: "Mede antes de otimizar: uma otimização por card, validada pelos números, não por impressão.",
    foco: "Meça antes de mexer: baseline reproduzível. Uma otimização por card. O medidor repete o benchmark e reprova ganho que não aparece nos números ou que piora outra métrica.",
    membros: [
      ORQ("alto", "medio", { foco: "Priorize pelo maior custo medido, não por intuição; um card por otimização." }),
      { slug: "perfilador", papel: "scout", arq: "perfilador", rotulo: "Perfilador", desc: "Define cenário e métrica, mede a baseline e aponta os maiores custos.", faixa: "alto", esforco: "alto", n: 1, foco: "Entregue a baseline reproduzível e os maiores custos, com os números." },
      { slug: "otimizador", papel: "executor", arq: "implementador", rotulo: "Otimizador", desc: "Aplica uma otimização por card sem mudar o comportamento.", faixa: "medio", esforco: "medio", n: 1, mcps: ["context7"], foco: "Uma otimização por card, comportamento idêntico, e os números antes e depois no relatório." },
      { slug: "medidor", papel: "reviewer", arq: "perfilador", rotulo: "Medidor", desc: "Repete o benchmark e reprova ganho que os números não confirmam.", faixa: "alto", esforco: "alto", n: 1, foco: "Seu papel é o de medidor independente: repita o benchmark nas mesmas condições da baseline." },
    ],
  },
  {
    slug: "spike-pesquisa", nome: "Spike e Pesquisa Técnica", escopo: "pesquisa",
    descricao: "Compara alternativas técnicas com fontes e trade-offs e entrega uma recomendação de uma página.",
    foco: "A decisão técnica traz alternativas e trade-offs. Cada afirmação tem fonte. Protótipo é descartável e fica fora do código de produção. A conclusão e a recomendação cabem em uma página.",
    membros: [
      ORQ("alto", "medio", { foco: "Defina a pergunta de decisão e os critérios antes de distribuir a pesquisa." }),
      { slug: "pesquisador", papel: "scout", arq: "pesquisador", rotulo: "Pesquisador", desc: "Levanta alternativas com fontes, prós, contras e riscos.", faixa: "alto", esforco: "alto", n: 2, mcps: ["context7"], foco: "Cada pesquisador cobre um subconjunto de alternativas, com fonte e versão para cada afirmação." },
      { slug: "sintetizador", papel: "executor", arq: "redator", rotulo: "Sintetizador", desc: "Consolida as pesquisas em uma recomendação de uma página.", faixa: "medio", esforco: "medio", n: 1, foco: "Consolide sem inventar: só o que os relatórios dos pesquisadores sustentam, com as fontes." },
      REV("alto", "alto", { slug: "verificador-de-fontes", rotulo: "Verificador de fontes", foco: "Confira as fontes de cada afirmação e reprove a que não se sustenta ou não tem origem." }),
    ],
  },
  {
    slug: "onboarding-projeto", nome: "Onboarding de Projeto", escopo: "desenvolvimento",
    descricao: "Prepara o repositório para o método: convenções, perfil de legado e índice de memória.",
    foco: "Prepare o repositório para o método disparando as skills de convenções (stackx-detectar), perfil de legado (legadox-perfil) e, se pedido, o índice de memória (memox-indexar), com a saída do mapa do código quando existir. O aplicativo não escreve em docs/**: quem grava são as skills.",
    membros: [
      ORQ("alto", "medio", { foco: "Rode as etapas na ordem: mapa, convenções, perfil de legado, índice; confirme cada uma com o usuário." }),
      { slug: "cartografo", papel: "scout", arq: "cartografo", rotulo: "Cartógrafo", desc: "Mapeia o repositório e entrega a base para as convenções e o perfil.", faixa: "alto", esforco: "alto", n: 1, foco: "Entregue o mapa que alimenta as convenções e o perfil de legado." },
      { slug: "convencoes", papel: "executor", arq: "implementador", rotulo: "Convenções", desc: "Dispara o levantamento das convenções reais do repositório.", faixa: "medio", esforco: "medio", n: 1, skills: ["stackx-detectar"], foco: "Dispare a skill stackx-detectar; não escreva convenções à mão e não invente o que ela não encontrar." },
      { slug: "perfil-de-legado", papel: "executor", arq: "implementador", rotulo: "Perfil de legado", desc: "Dispara o perfil de legado e, se pedido, o índice de memória.", faixa: "medio", esforco: "medio", n: 1, skills: ["legadox-perfil", "memox-indexar"], foco: "Dispare a skill legadox-perfil (e memox-indexar se o card pedir); registre o que ela produziu." },
      REV("alto", "alto", { foco: "Confira que os artefatos gerados batem com o repositório real e que nada foi escrito fora do combinado." }),
    ],
  },
  {
    slug: "dupla-rapida", nome: "Dupla Rápida", escopo: "desenvolvimento", rigidez_padrao: 2, paralelas: 1,
    descricao: "Para mudança pontual: plano de uma linha, um implementador e o revisor obrigatório.",
    foco: "Mudança pontual: plano de uma linha, um implementador, uma revisão. O revisor continua obrigatório. Não use esta squad para mudança que atravesse camadas.",
    membros: [
      ORQ("medio", "baixo", { rotulo: "Orquestrador leve", foco: "Plano de uma linha e uma única delegação; nada de cards extras." }),
      { slug: "implementador", papel: "executor", arq: "implementador", rotulo: "Implementador", desc: "Implementa a mudança pontual com teste e entrega ao revisor.", faixa: "medio", esforco: "medio", n: 1, mcps: ["context7"], foco: "Faça a mudança pontual com um teste que a prove." },
      REV("alto", "alto", { foco: "Revisão enxuta e objetiva, mas com evidência: rode o teste e confira o diff." }),
    ],
  },
  {
    slug: "api-contratos", nome: "API e Contratos", escopo: "desenvolvimento",
    descricao: "Define o contrato da API primeiro, implementa e prova a compatibilidade com quem já consome.",
    foco: "O contrato vem antes da implementação (esquemas, tipos, erros padronizados). Nenhuma quebra de compatibilidade sem nova versão e plano de migração para os consumidores. Teste de contrato dos dois lados.",
    membros: [
      ORQ("topo", "alto", { foco: "Congele o contrato e a política de versão antes de liberar a implementação." }),
      { slug: "explorador-de-contratos", papel: "scout", arq: "explorador", rotulo: "Explorador de contratos", desc: "Mapeia endpoints, esquemas, versões e consumidores existentes.", faixa: "rapido", esforco: "baixo", n: 1, foco: "Mapeie os endpoints, esquemas, erros e consumidores atuais; marque o que já está em uso e não pode quebrar." },
      { slug: "projetista-de-contrato", papel: "executor", arq: "implementador", rotulo: "Projetista de contrato", desc: "Escreve o contrato (esquemas e tipos) antes da implementação.", faixa: "medio", esforco: "alto", n: 1, mcps: ["context7"], foco: "Escreva só o contrato: esquemas, tipos, códigos de erro e exemplos; não implemente a lógica." },
      { slug: "implementador-de-api", papel: "executor", arq: "implementador", rotulo: "Implementador de API", desc: "Implementa a API exatamente como o contrato definiu.", faixa: "medio", esforco: "medio", n: 2, mcps: ["context7"], foco: "Implemente exatamente o contrato; qualquer divergência vira pergunta ao orquestrador, não decisão sua." },
      { slug: "testador-de-contrato", papel: "executor", arq: "testador", rotulo: "Testador de contrato", desc: "Escreve testes de contrato e de compatibilidade com os consumidores.", faixa: "medio", esforco: "medio", n: 1, foco: "Teste de contrato dos dois lados e de compatibilidade retroativa com o que já existe." },
      REV("alto", "alto", { foco: "Procure quebra de compatibilidade, erro fora do padrão e divergência entre contrato e implementação." }),
    ],
  },
  {
    slug: "acessibilidade-ux", nome: "Acessibilidade e UX", escopo: "qualidade",
    descricao: "Audita e corrige acessibilidade e usabilidade da interface com base no WCAG 2.2 AA.",
    foco: "Critério de referência: WCAG 2.2 nível AA. Prioridade: operação só por teclado, foco visível, nomes acessíveis, contraste e estados de erro, vazio e carregamento. Corrija sem alterar o comportamento de negócio.",
    membros: [
      ORQ("alto", "medio", { foco: "Priorize os achados por severidade e impacto no usuário; um card por tela ou componente." }),
      { slug: "auditor-de-acessibilidade", papel: "scout", arq: "auditor-acessibilidade", rotulo: "Auditor de acessibilidade", desc: "Audita a interface contra o WCAG 2.2 AA e registra achados com evidência.", faixa: "alto", esforco: "alto", n: 1, mcps: ["playwright-mcp"], foco: "Audite as telas do recorte recebido, na interface rodando quando possível." },
      { slug: "explorador-de-telas", papel: "scout", arq: "explorador", rotulo: "Explorador de telas", desc: "Mapeia telas, componentes e fluxos de interação do recorte.", faixa: "rapido", esforco: "baixo", n: 1, foco: "Mapeie telas, componentes compartilhados e fluxos de teclado do recorte." },
      { slug: "implementador-de-correcoes", papel: "executor", arq: "implementador", rotulo: "Implementador de correções", desc: "Corrige os achados de acessibilidade sem mudar o comportamento.", faixa: "medio", esforco: "medio", n: 2, mcps: ["context7", "playwright-mcp"], foco: "Corrija só os achados do card; não altere o comportamento de negócio nem o visual além do necessário." },
      { slug: "testador", papel: "executor", arq: "testador", rotulo: "Testador", desc: "Escreve testes de acessibilidade e de navegação por teclado.", faixa: "medio", esforco: "medio", n: 1, mcps: ["playwright-mcp"], foco: "Teste a navegação por teclado, o foco e os nomes acessíveis; o teste deve falhar com a correção ausente." },
      REV("alto", "alto", { foco: "Reverifique cada achado corrigido na interface rodando, só por teclado, e procure regressão visual." }),
    ],
  },
  {
    slug: "dados-migracoes", nome: "Dados e Migrações", escopo: "desenvolvimento",
    descricao: "Planeja e implementa migrações de esquema e de dados reversíveis, testadas em cópia.",
    foco: "Toda migração é reversível (subir e descer) e testada em cópia com dados de amostra, nunca em dados reais. Prefira expandir e contrair a alterar de uma vez. Nenhuma operação destrutiva sem confirmação humana e plano de reversão; nunca toque banco de produção.",
    membros: [
      ORQ("topo", "alto", { foco: "Não libere nenhuma operação destrutiva sem a confirmação explícita do usuário." }),
      { slug: "cartografo-de-dados", papel: "scout", arq: "cartografo", rotulo: "Cartógrafo de dados", desc: "Mapeia esquema, relações, consultas quentes e quem depende de cada tabela.", faixa: "alto", esforco: "alto", n: 1, foco: "Mapeie esquema, índices, relações e todo código que lê ou escreve as tabelas afetadas." },
      { slug: "analista-de-impacto", papel: "scout", arq: "investigador", rotulo: "Analista de impacto", desc: "Avalia risco, volume de dados e estratégia de migração sem downtime.", faixa: "alto", esforco: "alto", n: 1, foco: "Avalie volume, bloqueios, risco de perda e a estratégia (expandir e contrair) para migrar sem indisponibilidade." },
      { slug: "implementador-de-migracao", papel: "executor", arq: "implementador", rotulo: "Implementador de migração", desc: "Escreve a migração com subir e descer e o plano de reversão.", faixa: "medio", esforco: "alto", n: 1, mcps: ["context7"], foco: "Escreva a migração idempotente, com descer funcional e o plano de reversão no relatório." },
      { slug: "testador-de-migracao", papel: "executor", arq: "testador", rotulo: "Testador de migração", desc: "Testa subir e descer em cópia com dados de amostra.", faixa: "medio", esforco: "medio", n: 1, foco: "Teste subir, descer e subir de novo em cópia, com dados de amostra e casos de borda (nulos, volume, duplicados)." },
      REV("alto", "alto", { foco: "Confira reversibilidade, idempotência, bloqueios e a ausência de operação destrutiva não confirmada." }),
    ],
  },
  {
    slug: "observabilidade", nome: "Observabilidade", escopo: "devops",
    descricao: "Instrumenta logs, métricas e traces e escreve alertas e painéis como arquivos versionados.",
    foco: "Instrumente o que responde perguntas reais de operação. Logs estruturados, sem dado pessoal nem segredo. Atenção ao custo: cardinalidade de métricas e volume de logs. Alertas e painéis são arquivos versionados, nunca aplicados.",
    membros: [
      ORQ("alto", "medio", { foco: "Defina com o usuário as perguntas de operação que a instrumentação precisa responder." }),
      { slug: "explorador-de-fluxos", papel: "scout", arq: "explorador", rotulo: "Explorador de fluxos", desc: "Mapeia fluxos críticos e a instrumentação que já existe.", faixa: "rapido", esforco: "baixo", n: 1, foco: "Mapeie os fluxos críticos e o que já é registrado (logs, métricas, traces), apontando lacunas." },
      { slug: "engenheiro-de-instrumentacao", papel: "executor", arq: "implementador", rotulo: "Engenheiro de instrumentação", desc: "Adiciona logs estruturados, métricas e traces nos fluxos críticos.", faixa: "medio", esforco: "medio", n: 2, mcps: ["context7"], foco: "Logs estruturados com identificador de correlação, sem dado pessoal nem segredo; métricas com cardinalidade controlada." },
      { slug: "engenheiro-de-alertas", papel: "executor", arq: "engenheiro-infra", rotulo: "Engenheiro de alertas", desc: "Escreve regras de alerta e painéis como arquivos versionados.", faixa: "medio", esforco: "medio", n: 1, foco: "Alertas acionáveis (cada um com ação esperada) e painéis como arquivo; nada é aplicado em ambiente algum." },
      REV("alto", "alto", { foco: "Procure dado pessoal ou segredo em log, cardinalidade explosiva, alerta sem ação e custo desproporcional." }),
    ],
  },
];

/** Squad completa (objeto no formato do contrato `Squad`) a partir da definição acima. */
export function squadDe(def) {
  const naoOrq = def.membros.filter((m) => m.papel !== "orchestrator").reduce((s, m) => s + m.n, 0);
  return {
    slug: def.slug,
    nome: def.nome,
    descricao: def.descricao,
    escopo: def.escopo,
    rigidez_padrao: def.rigidez_padrao ?? null,
    // P-233: até 6 terminais paralelos por padrão; nunca mais do que a soma das instâncias de quem executa.
    max_instancias_paralelas: def.paralelas ?? Math.max(1, Math.min(6, naoOrq)),
    orcamento: { tempo_min: null, tokens: null, modo: "soft" },
    portoes: null,
    fabrica: { id: def.slug, versao: VERSAO_PACOTE },
    origem: "fabrica",
    membros: def.membros.map((m) => ({
      slug: m.slug,
      papel: m.papel,
      rotulo: m.rotulo,
      descricao: m.desc,
      prompt: `membros/${m.slug}.md`,
      perfil: { cli: "claude", modelo: m.modelo ?? MODELO_POR_FAIXA[m.faixa], esforco: m.esforco, faixa: m.faixa },
      skills_permitidas: [...SKILLS_POR_PAPEL[m.papel], ...(m.skills ?? [])],
      mcps_permitidos: [...(m.mcps ?? [])],
      hooks: [],
      max_instancias: m.n,
      orcamento: { tempo_min: null, tokens: null, modo: "soft" },
      rigidez: null,
      permissao: m.permissao ?? null,
    })),
  };
}

/** Texto do prompt do membro: arquétipo com o marcador de foco substituído (em tempo de geração, não de execução). */
export function promptDe(def, membro, arquetipos) {
  const base = arquetipos[membro.arq];
  if (base === undefined) throw new Error(`arquétipo inexistente: ${membro.arq}`);
  const foco = `## Foco desta squad\n${def.foco}\n\n## Seu foco neste papel\n${membro.foco ?? "Siga o contrato do card."}`;
  if (!base.includes("<!-- FOCO -->")) throw new Error(`arquétipo sem marcador de foco: ${membro.arq}`);
  return base.replace("<!-- FOCO -->", `\n${foco}\n`);
}
