# Piloto automático (execução contínua sem o dono)

**Autorização do dono (2026-09-30, antes de dormir):** terminar o MVP; depois, para CADA fase seguinte, montar o
plano (se ainda não houver), implementar do início ao fim, e passar para a seguinte, **sem perguntar nada**, até o dono
voltar e mandar parar. Se faltar decisão, decidir pelo padrão mais seguro e simples, registrar em `01-DECISOES.md` e,
se for do dono, em `PENDENCIAS-DO-DONO.md`. Para discutir o que fazer, usar agentes de planejamento/briefing em paralelo
(só leitura + docs) e consolidar.

## Regra do dono sobre decisões (2026-10-01)
Toda pendência/decisão que seria do dono é decidida pelo coordenador **sempre pela opção mais completa** (a que dá mais possibilidades e conforto
aos clientes), com **segurança como padrão inicial**, nunca como teto. Está tudo em `DECISOES-DAS-PENDENCIAS.md` (**override sobre os planos**; leitura
obrigatória para todo agente). Isso AJUSTA as "Regras que NÃO mudam" abaixo nos pontos que o documento lista (commits locais por fase em `ade/principal`
sem push; `npm install` de dependências justificadas; instalação pontual e reversível de software quando uma task exigir validação real; chamadas reais
mínimas às CLIs para validar formatos). Envio de dados para fora continua exigindo consentimento explícito na UI e cofre do SO.

## Como retomar (qualquer contexto novo)
1. Ler `00-LEIA-ME.md`, depois este arquivo, depois `STATUS.md` (seção "Fila do piloto automático").
2. Ver o que está em andamento (`ListAgents`/notificações) e o que é a próxima task `[ ]` da fase atual.
3. Manter o pipeline CHEIO: sempre que um agente terminar, lançar o próximo trabalho independente na mesma volta.

## Laço de cada fase
1. **Plano**: `docs/ade/fase-NN-*.md` com tasks (T-NN.MM), aceite binário, orçamentos, dependências. Se não existir, um agente
   de planejamento o escreve a partir de `base/` (specs do Overclock + resumos), do `AGENTS.md`, do ExpxMedia (somente leitura)
   e do método Expx instalado.
2. **Implementação** por agentes com áreas de arquivos DISJUNTAS (TDD, teste antes, `npm run verificar` verde).
3. **Portão da fase**: suíte unitária, e2e no Electron real, `npm run perf` (orçamentos), auditoria rápida de segurança.
4. **Registro**: `STATUS.md` (task `[x]` + uma linha), decisões novas, pendências do dono.
5. **Próxima fase** (ordem abaixo).

## Fila de fases (prioridade atualizada pelo dono em 2026-09-30)
MVP (0–5; falta a correção dos achados da auditoria T-05.07 e a reauditoria) → **PRIORIDADE ALTA DO DONO, nesta ordem:**
(1) **Fase 14 · Squads e agentes** (criar squads de agentes com instruções, CLI/LLM, modelo e nível de esforço por agente; modos livre/squad/agêntico);
(2) **Fase 9 · Limites, consumo e roteamento automático entre contas e modelos** (cotas no RODAPÉ de todas as páginas, cota geral no TOPO,
tela de análise de consumo, troca automática para outra conta do mesmo provedor com mais folga e, sem ela, para o modelo equivalente de outro
provedor; ver `fase-09-harness-limites.md`);
(3) **Fase 15 · RAG local, grafo de conhecimento e chat orquestrador** (índice local SQLite com busca vetorial/lexical alimentado por toda sessão e todo
trabalho; todo agente de todo modelo CONSULTA o RAG antes de implementar — já foi feito? houve correção? qual o contexto? — e o sistema aprende o tempo
todo; tela do GRAFO; CHAT com uma CLI/LLM do sistema que conversa com o RAG e também com o orquestrador principal: entende o pedido, consulta o RAG,
melhora o prompt, abre o terminal/Missão certo e já sai executando; ver `fase-15-rag-chat.md`)
(4) **Fase 16 · Maestro: intenção → pipeline do método → terminais por etapa** (planejar JUNTO com a Fase 14; usa os perfis de agente dela): de qualquer
CLI/terminal ou do chat, o usuário pede em linguagem natural ('conserte esse bug…'); o sistema classifica a intenção (bug, feature, pedido cru, projeto inteiro,
refatoração, entrega/PR, dúvida) e dispara o pipeline do método Expx correspondente (runx, sprintx, prodx, buildx, mergex…), abrindo UM TERMINAL POR ETAPA já
com o perfil configurado para aquela etapa (CLI/LLM + modelo + nível de esforço); tela de configuração por skill e por etapa; decisor opcional JEV (chave direta
'TypeSafe' OU via OpenRouter) com fallback determinístico; OpenRouter configurável como provedor (todos os modelos de lá); ver `fase-16-maestro.md`
(5) **Fase 17 · Mapa lógico do código (análise de projetos legados)**: o sistema analisa o código do projeto e monta o MAPA LÓGICO (grafo de dependências,
chamadas, fluxos/fluxogramas, entradas, acesso a dados, ciclos, pontos quentes) que ALIMENTA o stackx (convenções) e o legadox (perfil, zonas de risco, raio de
impacto); pesquisar ferramentas open source existentes (embutir se a licença permitir; senão estudar e reimplementar); ver `fase-17-mapa-codigo.md`
(6) **Fase 18 · Gestão ágil (Scrum/XP/Lean)**: backlog, planejamento e retrospectiva de sprint, daily, story points/risco/categoria/criticidade definidos pela IA e ajustáveis, índice de retrabalho, dashboards (burndown, burnup, velocidade, CFD, cycle/lead time, throughput, WIP); ver `fase-18-gestao-agil.md` e a entrada em `STATUS.md`.
(7) **Fase 19 · Documentação e relatórios de entrega**: ao fechar uma sprint, gera relatório TÉCNICO e relatório para o USUÁRIO em HTML, MD, CSV (e JSON/PDF), notas de versão, templates editáveis e branding; ver `fase-19-documentacao-relatorios.md` e a entrada em `STATUS.md` (planejar junto com a Fase 18).
(8) **Fase 20 · Alertas e comunicação (central de alertas + bot do Telegram)**: alertas de tarefa iniciada/concluída/atrasada com tempo, tokens e story points; Telegram de saída e de ENTRADA (pedir pelo bot → orquestrador → squad); começa por estudo de ameaças; aprovação por botão antes de executar; allowlist; cofre do SO; ver `fase-20-alertas-comunicacao.md` e `STATUS.md`.
**Loja de MCPs** (extensão da Fase 7: catálogo curado de MCPs de desenvolvimento, instalação em 1 clique isolada e com consentimento; `fase-07b-loja-mcps.md`) — implementar junto da Fase 7.
**Rigidez em 5 níveis** (seletor no cabeçalho; parte da Fase 16): ver o item correspondente em `STATUS.md`.
→ depois **6 Versionamento (Git/GitHub/SVN)** (a 6A de fundação já está em andamento) → 7 Catálogo de skills/MCPs/hooks (pré-requisito
parcial da Fase 14 para o `allow skills` por agente: faça o mínimo necessário dentro da 14 se a 7 ainda não existir) → 8 Memória →
10 Custo e board de cards → 11 Voz e captura → 12 Bench → 13 Jarvis e controle remoto (só estudo de segurança antes de qualquer relay)
→ **21 Distribuição e atualização** → **22 Acesso remoto estendido** (estudo de ameaças primeiro) → **23 Overdrive experimental** → melhorias contínuas (ver "Backlog de melhorias").

## Regras que NÃO mudam durante a noite
- **Nada sai da máquina**: sem `git push`, sem publicar, sem chamada paga; `gh` só leitura e só se um teste exigir; sem instalar
  software no sistema (nem `brew`); `npm install` só de dependências já justificadas em `01-DECISOES.md`.
- **Sem commits** (o dono não pediu). Tudo fica na árvore de trabalho.
- **Nunca ler nem escrever arquivo de ambiente (`.env`) de ninguém**; erros citam o nome da variável, nunca o valor.
- **Projetos de origem somente leitura**: `../ExpxMedia` e as specs do Overclock (cópias em `docs/ade/base/`).
- **Leveza e velocidade acima de tudo**: orçamentos P-01..P-22 não podem piorar; estourou, a task não fecha.
- **Não matar processos que não são seus**: o `npm run dev` do dono (hot reload) e o Electron dele ficam abertos.
- **Sem vazamento de processos de teste** (tests/limpeza.ts); conferir com `ps` ao fim de cada agente.
- **Segurança por padrão** (D-14, D-36): automação nunca comita na branch padrão nem força push; nenhuma operação destrutiva sem
  confirmação na UI; nenhum segredo em log, evento ou argv.
- Não relaxar teste, orçamento ou regra para "passar". Falhou de verdade → corrigir a causa ou registrar como pendência com o valor real.

## Limites de bom senso
- No máximo **5 agentes simultâneos**; nunca dois no mesmo arquivo.
- Cada agente recebe: leitura obrigatória, arquivos próprios, critérios mensuráveis, "o que NÃO tocar".
- Se um agente falhar ou voltar com testes vermelhos de verdade, o coordenador corrige ou reabre a task; nunca marca `[x]` sem rodar `npm run verificar`.
- Depois de cada fase: rodar a suíte completa uma vez com a máquina o mais ociosa possível e registrar o resultado.

## Backlog de melhorias (quando a fila de fases esgotar)
Refinar a experiência a partir do uso: telas de Início/Missões, atalhos, onboarding do método, paleta de comandos mais rica,
desempenho em repositórios enormes, a API para abrir arquivos do método, botão de alertas, e2e de menu/bandeja, `gate_pending`
com evento real, Overdrive (canvas único) apenas se medição provar ganho, relatório de uso (tokens/custo) por Missão.
