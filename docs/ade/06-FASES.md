# Fases

MVP = fases 0 a 5 (detalhadas em `fase-NN-*.md`). Pós-MVP (6 a 12) resumido; será detalhado em
tasks quando o MVP fechar. Ordem de dependência herdada de `base/specs-overclock/spec-00` §8.

| Fase | Nome | Entrega | Specs de origem |
|---|---|---|---|
| **0** | Fundação | repo, toolchain, casca Electron segura, tokens claro/escuro, banco, barramento, harness de performance, empacotamento local | — / ExpxMedia |
| **1** | Terminais | PTY + daemon portados, detecção de CLIs, xterm leve, layout em árvore, sinaleira, anexos | 01, 04 |
| **2** | Workspaces, Provedores e Missões | modelo de dados, abrir projeto, git/worktree, contas, Missões, Panes persistidos | 01, 02, 04 |
| **3** | Orquestração e MCP | sidecar MCP, tools núcleo, handoff, hooks, piloto/workers, regras | 02, 05 |
| **4** | Método Expx | parser, worker de indexação, Trabalhos/Cards/grafo, sinaleira, disparo de comandos, rastro | F (método) + 12 (cards) |
| **5** | Acabamento do MVP | Início, paleta, tray, notificações, configurações, performance final, a11y, pacote, auditoria | — |
| **18** | **Gestão ágil Scrum/XP/Lean (PRIORIDADE ALTA do dono)** | backlog, sprint (planejamento/daily/review/retro), story points e classificação/risco/criticidade por IA com ajuste do usuário, índice de retrabalho e 'feito de primeira', dashboards e gráficos de entrega (burndown, burnup, velocidade, CFD, cycle/lead time, throughput, WIP), práticas XP/Lean como métricas | pedido do dono; usa tasks do método, rastro, RAG, Fase 6 |
| 23 | **Overdrive experimental** (baixa prioridade) | canvas único para 32–64 painéis, modo opcional desligado por padrão, só habilita se o benchmark provar ganho | P-05 |
| 22 | **Acesso remoto estendido** | relay cego + PWA móvel + VPS opcional em Docker; estudo de ameaças primeiro | P-42, Fase 13 |
| 21 | **Distribuição e atualização** | auto-update com canais, assinatura/notarização, instaladores macOS/Windows, CI completo, renomeação do produto | P-01, P-03, P-06, P-08 |
| **20** | **Alertas e comunicação: central de alertas + bot do Telegram (PRIORIDADE ALTA do dono)** | eventos (tarefa iniciada/concluída/atrasada, PR, QA, cota, Pane aguardando, sprint fechada) com tempo, tokens e story points; Telegram de saída e de entrada via long polling (pedir pelo bot → orquestrador → squad), pareamento, allowlist, aprovação por botão, cofre do SO; estudo de ameaças primeiro | pedido do dono; usa Fases 14, 15, 16, 18 |
| **19** | **Documentação e relatórios de entrega (PRIORIDADE ALTA do dono)** | ao fechar a sprint: relatório técnico + relatório para o usuário (features em linguagem simples) em HTML autocontido, Markdown, CSV (+ JSON/PDF), notas de versão/CHANGELOG, templates e branding editáveis, redação assistida por LLM com citações, exportação fora de `docs/**`; documentação do projeto a partir do mapa do código e do RAG | pedido do dono; depende da Fase 18 |
| **17** | **Mapa lógico do código / análise de legado (PRIORIDADE ALTA do dono)** | análise estática multi-linguagem (Tree-sitter/ferramentas existentes) → grafo de dependências, chamadas, entradas/rotas, acesso a dados, ciclos, hotspots (churn × complexidade), código morto, cobertura de teste por código; diagramas (grafo/fluxograma/Mermaid/DOT/SVG) e visualizador interativo; alimenta stackx (convenções) e legadox (perfil, zonas de risco, raio) | pedido do dono; usa grafo da Fase 15 e a Fase 6 (histórico git) |
| **16** | **Maestro (PRIORIDADE ALTA do dono)**: classificação de intenção (bug/feature/pedido/projeto/refator/entrega/dúvida) → pipeline do método Expx (runx, sprintx, prodx, buildx, mergex) → um terminal por etapa com o perfil configurado (CLI/LLM, modelo, esforço); configuração por skill e por etapa; decisor JEV opcional (chave direta ou OpenRouter) com fallback determinístico; OpenRouter como provedor configurável | pedido do dono; usa Fases 14 (perfis), 9 (provedores/limites) e 15 (RAG/chat) |
| **15** | **RAG local, grafo e chat orquestrador (PRIORIDADE ALTA do dono)** | índice local (SQLite + busca vetorial/lexical híbrida) alimentado por toda sessão/trabalho/commit/decisão/correção; consulta obrigatória antes de implementar (via MCP `rag_*`, injeção no prompt e hook); aprendizado contínuo; tela do GRAFO; CHAT com CLI/LLM do sistema que conversa com o RAG e com o orquestrador (delega, melhora o prompt, abre terminal/Missão e executa) | pedido do dono; complementa a Fase 8 (memória por Pane) |
| **14** | **Squads e agentes (PRIORIDADE ALTA do dono)** | CRUD de squads e agentes (instruções, CLI/LLM, modelo, nível de esforço, skills permitidas), modos livre/squad/agêntico, perfis por agente integrados ao roteamento (Fase 9), receitas de fábrica editáveis | pedido do dono; spec-02 RF-02.50..57, spec-05 |
| **6** | **Versionamento total (Git, GitHub, SVN)** | interface `Vcs`, Git completo (status incremental, diff, stage por hunk, commit, branches, histórico, blame, stash, remotos, merge/rebase/conflitos), GitHub por `gh` (PRs, checks, issues → Missão), SVN completo, integração com Missões e método — **plano detalhado em `fase-06-versionamento.md` (40 tasks)** | pedido do dono; F2, método |
| 7 | Catálogo de skills/MCPs/hooks | scan, tela, symlink, `allow skills` por Pane, skills embarcadas `ev-*` | 05 |
| 8 | Memória | `build_brief` puro, restore idempotente, redação, `memory_*`, anéis | 06 |
| **9** | **Limites, consumo e roteamento automático (PRIORIDADE ALTA do dono)**: cotas no rodapé de todas as páginas, cota geral no topo, tela de análise de consumo, troca automática de conta (mesmo provedor) e de modelo equivalente (outro provedor) | pedido do dono; política por tarefa, roteamento de conta (`pickAccount` puro), `LimitsService`, cofre/broker | política por tarefa, roteamento de conta (`pickAccount` puro), `LimitsService`, cofre/broker | 03, 09, 04 |
| 10 | Custo e board de cards | custo por card/missão lido do banco local, quadro no estilo Overclick ligado às tasks do método | 12, 02 |
| 11 | Voz e captura | ditado direto no terminal (hold-to-talk nativo), captura de tela anexada ao Pane | 07, 08 |
| 12 | Bench | bateria local multi-modelo alimentando a política do harness | 14 |
| 13 | Jarvis e controle remoto | cliente de voz sobre o MCP; relay/app móvel só com estudo de segurança | 11, 10 |

## Critério para entrar no MVP

Entra o que é necessário para o ciclo "abrir projeto → abrir Missão → terminais com CLIs reais →
piloto delega a workers → ver o método andando (trabalhos, cards, sinaleira) → entregar". O resto
espera. Leveza e velocidade valem para tudo que entra.

## Ordem de execução do MVP

```
F0 ─► F1 ─► F2 ─► F3 ─► F4 ─► F5
       └──────────────┘ (F4 pode começar após F2 em paralelo com F3: só depende de workspace/worktree)
```

Paralelismo permitido: F4.01–F4.03 (parser/worker/modelo) após F0; UI de F4 após F2; F3 e F4
compartilham só o serviço de workspaces/worktrees.
