# ExpxV

**O ambiente de desenvolvimento agêntico do método Expx.**
Terminais reais de CLIs de IA, um piloto que delega a workers, Missões com worktree git e o
método Expx andando na tela — num app leve para macOS e Windows.

> Estado: **MVP em fechamento** (fases 0 a 5 do plano em [`docs/ade/`](docs/ade/)).
> Distribuição: release privada no GitHub, assinada e notarizada para macOS.

---

## Download

Os instaladores notarizados para macOS ficam na [última release privada do GitHub](https://github.com/bittencourtthulio/expxv/releases/latest):

- [Baixar DMG universal (Intel + Apple Silicon)](https://github.com/bittencourtthulio/expxv/releases/download/v0.1.3/ExpxV-universal.dmg)
- [Baixar ZIP universal (Intel + Apple Silicon)](https://github.com/bittencourtthulio/expxv/releases/download/v0.1.3/ExpxV-universal.zip)
- [Baixar instalador Windows x64](https://github.com/bittencourtthulio/expxv/releases/download/v0.1.3/ExpxV-Setup.exe)

O repositório é privado; é necessário ter acesso ao GitHub para baixar os arquivos.

---

## O que é

O ExpxV é um **ADE** (Agentic Development Environment). Em vez de abrir cinco janelas de terminal e
decorar em qual delas cada agente está, você abre um projeto e trabalha num lugar só:

- **Terminais de verdade** (PTY real, xterm) com Claude Code, Codex, Gemini, OpenCode, Grok (xAI) ou o shell.
  Os painéis moram num **daemon** separado: fechar o app **não mata** a sessão, e recarregar a
  interface nunca derruba um painel.
- **Missões**: uma tarefa de ponta a ponta num worktree git próprio, com um **piloto** e vários
  **workers**. O piloto delega pelo servidor **MCP** do app (`pane_spawn`, `handoff_submit`…); cada
  worker devolve um relatório e o piloto é acordado.
- **O método Expx de primeira classe**: o app lê o que o `expxdev` grava em `docs/` (sprintx, runx,
  prodx, mergex…), mostra trabalhos, cards e grafo, acende a **sinaleira** de cada painel (verde
  pronto, amarelo trabalhando, vermelho aguardando você) e dispara os comandos do método no terminal certo.
- **Leve e rápido por exigência**: a primeira prioridade do dono. Os números estão abaixo e um teste
  falha quando estouram.

É um app **separado do ExpxMedia**: só compartilha a identidade visual e alguns padrões (PTY, segurança de janela).

## Requisitos

| Preciso de | Para quê | Obrigatório |
|---|---|---|
| **Node 22** | desenvolvimento, testes, build (`engines: >=22`; o app usa `node:sqlite`) | sim, para desenvolver |
| **git** | worktrees e status das Missões | sim |
| uma CLI de IA (`claude`, `codex`, `gemini`, `opencode`, `grok`) | o que roda dentro dos painéis | pelo menos uma, para delegar |
| **Python 3** | só o `memox` opcional do método (`.claude/skills/memox/assets/memox.py`) | não: sem ele a saúde do método fica sem a memória, sem erro |
| **gh** (GitHub CLI) | fase 6 (PRs, checks, issues); o app nunca guarda nem lê token | não |

Quem só **usa** o app instalado precisa apenas do git e das CLIs de IA.

## Instalação e desenvolvimento

```bash
npm ci --legacy-peer-deps   # instala; o postinstall prepara o node-pty (bit de execução do spawn-helper)
npm run dev                 # tsc --watch + vite --watch: reinicia o app quando o main muda, recarrega a janela quando o renderer muda
npm run inicio              # build uma vez e abre o app (sem hot reload)
npm run verificar           # o portão: typecheck + testes + orçamento de tamanho do bundle
npm test                    # só os testes de unidade e integração (Vitest, sem rede)
npm run test:e2e            # Playwright sobre o Electron real (rode `npm run build` antes)
npm run perf                # orçamentos dinâmicos de velocidade; grava docs/ade/perf/ultimo.json (~1–2 min)
```

Todos os testes usam CLIs falsas e stubs locais: nenhum chama rede, serviço pago ou conta real.

### Empacotar

```bash
npm run dist:dir     # build + app local em dist-app/mac-arm64/ExpxV.app (arquitetura da máquina, sem assinatura)
npm run test:pacote  # prova DENTRO do pacote (veja abaixo)
npm run dist:mac     # dmg + zip universais (arm64 + x64), sem assinatura se não houver secrets
npm run dist:win     # instalador NSIS x64 (só roda no Windows; não foi validado em máquina Windows, D-26)
npm run icones       # regera build/icon.icns, icon.ico e os PNGs
```

O caminho oficial local é `dist:dir`. O pacote sai em `dist-app/` (nunca em `dist/`, que é do `npm run dev`).
`test:pacote` abre o app empacotado e prova: a janela abre (smoke); o `node-pty` empacotado cria PTY, ecoa,
redimensiona e entende `SIGINT`; o **daemon** de PTY sobe, cria sessão, **sobrevive** ao cliente e encerra a
pedido; o **servidor MCP** empacotado lista as tools com um token de teste e recusa token adulterado; o worker do
método carrega com `yaml`; `prompts/*.md` e `gancho.mjs` existem fora do asar; o ícone da bandeja e as fontes
locais estão no pacote; não há mapa, teste, typings nem fixtures no `app.asar`; e o tamanho do app cabe no teto.
Ao final ele lista os 10 maiores itens do `app.asar`.

**Peso do pacote** (macOS arm64): o `.app` tem ~216 MB, dos quais o Electron é quase tudo; o `app.asar`
tem ~3,6 MB e ~3,5 MB ficam fora dele (`app.asar.unpacked`: node-pty, daemon, servidor MCP e suas dependências,
worker do método). O dmg universal tem ~189 MB.

**Assinatura e notarização** são opcionais e só por secrets do CI (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`). Sem eles o build sai **sem assinar**; o macOS vai pedir
"abrir mesmo assim" na primeira execução. O app **não** se atualiza sozinho (D-24).

### CI (versionado, não disparado)

[`.github/workflows/validacao.yml`](.github/workflows/validacao.yml) roda em PR, em `main` e sob demanda: Node 22,
`npm ci --legacy-peer-deps`, `typecheck`, `test`, `build`, `dist:dir` e `test:pacote`, em `macos-15`,
`macos-15-intel` e `windows-latest`. [`release.yml`](.github/workflows/release.yml) roda só por tag `v*`,
gera os instaladores com `--publish never` e os sobe como rascunho de release. Nada é disparado enquanto
não houver repositório remoto (D-23); a sintaxe e as regras acima são conferidas por teste
(`tests/scripts/empacotamento.test.ts`).

## Mapa das pastas

```
src/
  nucleo/        lógica pura (sem Electron): produto, banco (node:sqlite), domínio, terminais, método,
                 orquestração, MCP, git, missões, provedores
  daemon/        servidor de PTY (processo separado; NDJSON em socket Unix / named pipe)
  main/          casca Electron: boot em 2 ondas, janela segura, scheme próprio, menu, bandeja, ipc/*
  preload/       API enumerada exposta como window.ade
  renderer/      UI React (Vite): casca, telas, componentes, estado, tokens.css
  compartilhado/ tipos de IPC e eventos usados por main e renderer
tests/           e2e (Playwright), perf, scripts (empacotamento/CI), varredura de marca
scripts/         dev, verificar, perf, dist-dir, verificar-pacote, ganchos de empacotamento
build/           ícones
docs/ade/        o plano: decisões, arquitetura, orçamentos, UI/UX, contratos, fases, status
```

A arquitetura (processos, fluxo de dados) está em [`docs/ade/02-ARQUITETURA.md`](docs/ade/02-ARQUITETURA.md).

## Leveza e velocidade: os orçamentos

Requisito de aceite. Cada linha é medida pelo `npm run perf` (Playwright sobre o Electron real) e
**falha quando estoura**; corrige-se a causa, nunca o limite. Referência: Mac Apple Silicon; em CI lento,
`EXPXV_PERF_FATOR` multiplica os limites.

| O que | Orçamento |
|---|---|
| Processo iniciado até a casca interativa | ≤ 800 ms |
| Troca de tela pelo menu lateral | p95 ≤ 50 ms até o primeiro quadro |
| Abrir terminal (clique até o cursor) | ≤ 300 ms |
| Flood de 10 MB em um PTY | nenhum quadro > 50 ms; a UI segue respondendo |
| Latência de digitação (tecla até o eco) | p95 ≤ 40 ms |
| Memória do renderer com 4 painéis ociosos | ≤ 250 MB |
| Memória do main + daemon com 4 painéis | ≤ 200 MB |
| JavaScript inicial do renderer | ≤ 350 KB gzip (xterm, grafo e telas pesadas em chunks lazy) |
| Lista grande (1 000 cartões / 5 000 linhas) | 60 fps, só os nós visíveis no DOM |
| Indexação do projeto (200 artefatos) | ≤ 300 ms, fora da thread principal |
| Arquivo observado mudou até a UI atualizar | ≤ 600 ms |
| Bloqueio do event loop do main após o boot | nenhuma tarefa > 50 ms |
| Restaurar 8 painéis ao abrir | ≤ 1,5 s |
| Consulta ao banco (caminho quente) | ≤ 5 ms |

Tabela completa, regras de arquitetura que sustentam os números e a forma de medir:
[`docs/ade/03-ORCAMENTOS-DESEMPENHO.md`](docs/ade/03-ORCAMENTOS-DESEMPENHO.md). O `npm run verificar` cobre os
orçamentos estáticos (tamanho do bundle).

## O método Expx dentro do app

O ExpxV é um **observador de disco e disparador de prompts** (D-04). Nada mais.

| | |
|---|---|
| **O que lê** | `docs/**` do projeto (frontmatter YAML com `expx_schema: 1` e o drift conhecido de prodx, legadox e stackx) e `docs/eventos/*.jsonl` (rastro, com rotação). Um worker observa cada worktree e reindexa fora da thread principal. Leitura tolerante: chave extra é aceita, `kind` desconhecido vira "desconhecido", YAML truncado espera o próximo evento; o disco vence o rastro em conflito. |
| **O que dispara** | Comandos do método digitados no terminal do Pane certo, com argumento: `/expx:<nome> <argumento>` no Claude Code e `/<nome> <argumento>` no OpenCode. Nunca mais de uma entrada automática por vez e nunca em Pane `aguardando`. Avaliações (auditoria F5, QA E4, mergex E3) sugerem abrir um Pane **separado**: quem implementa não aprova. |
| **O que NUNCA escreve** | Nenhum artefato de estado do método em `docs/**`: quem escreve é a skill. O que o app grava (briefings, relatórios e anexos) fica em `.expxv/` do repositório do usuário, com `.gitignore` interno. Assinatura do prodx, aprovação de raio ALTO, `mergex-revisar` e merge são **sempre humanos**; o app só leva a pessoa ao arquivo. |

Uma Missão de feature corresponde a um trabalho sprintx (worktree `feature/<slug>`); de ocorrência, a um
runx; de pedido cru, a um prodx; de projeto, a um buildx. Cada task `T-NN.MM` vira um card.

## Segurança

- **Janela:** `contextIsolation`, `sandbox` e sem `nodeIntegration`; permissões mínimas; o renderer carrega de
  um scheme próprio (sem servidor HTTP local); a navegação só vai ao scheme do app, e `http/https` abrem no
  navegador do sistema.
- **IPC:** lista fechada de canais, validador estrito por canal no main (campo a campo), autorização por
  remetente (frame principal, janela e origem). O renderer só enxerga `window.ade`.
- **Terminal e PTY:** executável e argumentos separados, nunca shell; ambiente saneado (variáveis de identidade
  da sessão do Claude Code removidas, PATH completado); OSC 52 e OSC 8 removidos da saída; links só
  `http/https` sem credenciais; colar texto grande pede confirmação.
- **MCP:** servidor HTTP só em loopback, num worker thread; um token por Pane (HMAC, 7 dias, revogável),
  `tools/list` filtrado pelo papel e pelo modo, sem acesso a banco nem a chaves.
- **Daemon:** socket Unix / named pipe com token `0600` e protocolo versionado; só quem lê a pasta de dados do
  usuário fala com ele.
- **Anexos:** arquivos de ambiente (`.env`) são recusados, symlink para fora do projeto também; só entram os
  tipos da allowlist.
- **Segredos e rede:** nunca se lê `.env`; chaves ficam nas CLIs; erros citam o nome da variável, nunca o valor.
  **Sem telemetria** e **sem auto-update**: o app não faz chamada de rede por conta própria.
- **Permissões das CLIs:** painel livre abre a CLI com as aprovações normais. Workers de Missão só rodam em
  modo automático se o workspace habilitar. O bypass total de sandbox do Codex nunca é usado.

## Atalhos

Regra: `Cmd+tecla` no macOS; `Ctrl+Shift+tecla` no Windows e Linux (`Ctrl+letra` pertence ao processo no terminal).

| Ação | macOS | Windows / Linux |
|---|---|---|
| Paleta de comandos | `⌘K` | `Ctrl+Shift+P` |
| Novo terminal | `⌘N` | `Ctrl+Shift+N` |
| Dividir / dividir na outra orientação | `⌘D` / `⌘⇧D` | `Ctrl+Shift+D` / `Ctrl+Shift+Alt+D` |
| Fechar painel | `⌘W` | `Ctrl+Shift+W` |
| Foco na paleta de painéis | `⌘J` | `Ctrl+Shift+J` |
| Ir para a aba 1–9 | `⌘1…9` | `Ctrl+1…9` |
| Navegar entre painéis | `⌘⌥ setas` | `Ctrl+Alt setas` |
| Expandir painel (modo foco) | `⌘⇧Enter` | `Ctrl+Shift+Enter` |
| Buscar no terminal | `⌘F` | `Ctrl+Shift+F` |
| Trocar tema | `⌘⇧L` | `Ctrl+Shift+L` |

Links no terminal abrem com `Cmd/Ctrl+clique`.

## Estado e o que vem depois

**MVP (fases 0 a 5):** fundação, terminais com daemon, workspaces e Missões, orquestração por MCP, método Expx,
acabamento (início, paleta, bandeja, notificações, configurações, acessibilidade), empacotamento e documentação.
Falta, antes de fechar o MVP, o passe de desempenho final e a **auditoria** (task T-05.07, registrada em
`docs/ade/AUDITORIA-MVP.md` quando existir). O andamento exato está em [`docs/ade/STATUS.md`](docs/ade/STATUS.md).

**Windows:** projetado e testado em unidade (ConPTY, wrappers `.cmd/.ps1`, `taskkill /t`), sem validação em máquina
Windows (D-26). O CI versionado cobre `windows-latest` quando for disparado.

**Pós-MVP** (resumo em [`docs/ade/06-FASES.md`](docs/ade/06-FASES.md)):

- **Fase 6 (plano pronto, 40 tasks):** versionamento total — Git completo (status incremental, diff, stage por
  hunk, commit, branches, histórico, blame, stash, merge e rebase), GitHub por `gh`, SVN, integração com Missões.
- Fases 7 a 13: catálogo de skills/MCPs/hooks, memória, harness e limites, custo e board de cards, voz e captura,
  bench, controle remoto. Detalhadas quando o MVP fechar.

## Decisões que são do dono

Nome do produto (`ExpxV` é o padrão adotado), permissão das CLIs, repositório de releases e
assinatura/notarização, licença, commits, `node:sqlite` experimental, hooks do Codex, SVN e outras forges:
cada uma com a decisão já adotada para a execução não parar, em
[`docs/ade/PENDENCIAS-DO-DONO.md`](docs/ade/PENDENCIAS-DO-DONO.md). Ainda **não há arquivo de licença**.

## Para quem vai mexer no código

Leia o [`AGENTS.md`](AGENTS.md) (regras que valem em todo trabalho, como testar, decisões já tomadas) e o
[`docs/ade/00-LEIA-ME.md`](docs/ade/00-LEIA-ME.md) (protocolo de execução autônoma). Em resumo: contratos
primeiro, teste antes do código, orçamentos de leveza e velocidade valem para tudo, o nome do produto só existe em
`src/nucleo/produto.ts`, e nada sai da máquina.
