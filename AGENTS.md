# AGENTS.md — ExpxV

Contexto para qualquer agente (OpenCode, Claude Code ou outro) que trabalhe neste repositório.
Leia inteiro antes da primeira ação. Idioma do projeto: **português do Brasil** (prosa com acento;
identificadores de domínio sem acento; nomes de protocolo externo, como tools MCP e eventos, em
inglês `snake_case`).

## O que é

O ExpxV é um **ADE** (Agentic Development Environment) para macOS e Windows, construído em Electron:
terminais reais de CLIs de IA (Claude Code, Codex, Gemini, OpenCode…), orquestração piloto/workers
por MCP, Missões com worktree git e integração de primeira classe com o que o método Expx grava em
`docs/` (sprintx, runx, prodx, mergex…). É um **app separado do ExpxMedia**: só compartilha
identidade visual e padrões (PTY, segurança de janela). Prioridade número um: **leveza e velocidade**.

## Mapa do repositório

| Pasta | O que é | Estado |
|---|---|---|
| `docs/ade/` | o plano: `00-LEIA-ME.md` (protocolo), `STATUS.md` (andamento), `01-DECISOES.md`, `02-ARQUITETURA.md`, `03-ORCAMENTOS-DESEMPENHO.md`, `04-UI-UX.md`, `05-CONTRATOS.md`, `06-FASES.md`, `fase-NN-*.md`, `PENDENCIAS-DO-DONO.md`, `base/` | fonte da verdade |
| `src/nucleo/` | lógica pura, sem Electron: `produto.ts`, `banco/` (node:sqlite), `dominio/`, `terminais/`, `metodo/`, `orquestracao/`, `mcp/`, `git/`, `missoes/`, `provedores/` | pronto |
| `src/daemon/` | daemon de PTY (processo separado; protocolo NDJSON em socket/pipe) | pronto |
| `src/main/` | casca Electron: boot em duas ondas, janela segura, scheme próprio, menu, bandeja, `ipc/*`, MCP, orquestração | pronto |
| `src/preload/` | `preload.ts`: API enumerada exposta como `window.ade` | pronto |
| `src/renderer/` | UI React (Vite): `casca/`, `telas/`, `componentes/`, `estado/`, `tokens.css` | pronto |
| `src/compartilhado/` | tipos de IPC e eventos usados por main e renderer | pronto |
| `tests/` | e2e (Playwright sobre o Electron real), `perf/`, `scripts/` (empacotamento e CI), varredura de marca | pronto |
| `scripts/` | `dev`, `verificar`, `perf`, `dist-dir`, `verificar-pacote`, ganchos de empacotamento, ativos | pronto |
| `build/` | ícones (`icon.icns`, `icon.ico`, PNGs) | pronto |
| `.github/workflows/` | `validacao.yml` e `release.yml`: versionados, **não disparados** | pronto |
| `../ExpxMedia/` e as specs do Overclock | origem de padrões e funcionalidades | **somente leitura** |

A ordem das fases e o que ficou para depois estão em `docs/ade/06-FASES.md`.

## Regras que valem em todo trabalho

1. **Contratos primeiro.** Tudo que é gravado, trocado entre processos ou exposto às CLIs segue
   `docs/ade/05-CONTRATOS.md`. Divergir exige mudar o contrato, nunca contorná-lo no código.
2. **O nome do produto só existe em `src/nucleo/produto.ts` (D-01).** Id, scheme, appId, prefixos de
   socket e de variável de ambiente derivam de lá. Um teste de varredura (`tests/varredura-marca.test.ts`)
   proíbe o nome literal no resto de `src/`; `package.json` e `electron-builder.yml` são conferidos por teste.
3. **Segredo e arquivo de ambiente nunca são lidos nem escritos.** `.env` de ninguém. Erros citam o
   nome da variável, nunca o valor. Chaves de provedor ficam nas CLIs; o ADE só lança. Token de GitHub:
   nunca (D-34, só `gh`).
4. **TDD.** O teste vem antes do código e precisa falhar pelo motivo certo antes de passar. Suíte verde
   (`npm run verificar`) ao fim de cada task.
5. **Leveza e velocidade são requisito de aceite**, não intenção. Os orçamentos de
   `docs/ade/03-ORCAMENTOS-DESEMPENHO.md` (P-01…P-14 e os da fase 6) são medidos por `npm run perf` e
   falham quando estouram: corrige-se a causa, nunca o limite. Dependência nova só com custo medido
   (tamanho, startup, nativo) registrado em `01-DECISOES.md`.
6. **Nada sai da máquina (D-23).** Sem `git push`, sem publicar, sem notarização com credencial real,
   sem chamada paga, sem telemetria (D-25). Testes usam CLIs falsas e stubs locais. O auto-update está
   desligado (D-24): nenhum módulo de `src/` importa `electron-updater`, e um teste barra isso.
7. **Sem commit sem pedido do dono.** O trabalho fica na árvore de trabalho da `main`. Quando houver
   commit, a automação do ADE nunca comita na branch padrão nem força push (D-36).
8. **Projetos de origem são somente leitura:** `../ExpxMedia` e as specs do Overclock só se lê. Código
   do ExpxMedia pode ser **adaptado** (parametrizando o produto), nunca editado lá.
9. **IPC com validador estrito.** Lista fechada de canais (`src/compartilhado/ipc.ts`), um validador
   puro por canal que checa campo a campo, autorização por remetente (frame principal, janela, origem).
   O renderer nunca fala com Node: só com `window.ade`. O preload não tem imports de runtime (D-30).
10. **Terminal e PTY, endurecimentos que não se removem:** executável e argumentos **separados**, nunca
    shell; `ambienteSeguro` retira as variáveis de identidade de sessão do Claude Code e completa o
    PATH; OSC 52 e OSC 8 são removidos da saída; links só `http/https` sem credenciais; colar grande
    (> 20 000 caracteres ou > 32 KB) pede confirmação; anexos recusam arquivos de ambiente e symlink para
    fora; daemon com token `0600` no socket/pipe e protocolo versionado; token do MCP por Pane, HMAC,
    `tools/list` filtrado, só loopback. Painel livre abre a CLI com aprovações normais; modo automático
    só por opt-in do workspace (D-14); nunca o bypass total de sandbox do Codex.
11. **O método Expx é lido, não escrito (D-04).** O ADE observa `docs/**` e `docs/eventos/*.jsonl` e
    digita `/expx:<nome> <argumento>` nos terminais (D-20). Nunca grava artefato de estado do método;
    o que grava fica em `.expxv/` do repositório do usuário. Assinatura do prodx, aprovação de raio
    ALTO, `mergex-revisar` e merge são sempre humanos (D-21).
12. **Caminhos relativos** em qualquer artefato gravado pelo app (relativos à raiz do workspace).
13. **Janela segura:** `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, permissões
    mínimas, navegação só para o scheme próprio; o resto vai a `shell.openExternal` (http/https) ou é negado.
14. **Não apague `dist/` com o `npm run dev` do dono rodando:** ele usa `dist/main` e `dist/renderer`. O
    pacote local sai em `dist-app/`.

## Como testar

```bash
npm ci --legacy-peer-deps      # primeira vez (Node 22)
npm run typecheck              # main, renderer e testes
npm test                       # Vitest: unidade e integração (sem rede, sem Electron)
npm run verificar              # typecheck + testes + orçamento de tamanho do bundle: o portão de toda task
npm run test:e2e               # Playwright sobre o Electron real (precisa de `npm run build`)
npm run perf                   # orçamentos dinâmicos; grava docs/ade/perf/ultimo.json (~1–2 min)
npx vitest run tests/scripts   # empacotamento, workflows e auto-update desligado
npm run dist:dir               # build + pacote local em dist-app/ (arquitetura da máquina)
npm run test:pacote            # prova DENTRO do pacote: janela, node-pty, daemon, MCP, worker, ícone, fonte
```

`test:pacote` exige `npm run dist:dir` antes. `dist:mac` (dmg + zip universais, sem assinatura sem
secrets) e `dist:win` existem para o CI e para uma máquina própria; o caminho oficial local é `dist:dir`
(veja o README para as limitações do universal). Windows foi validado só por teste de configuração e
de unidade (D-26).

Teste que abre processo tem de limpá-lo: confira com `ps` que nada ficou vivo ao fim da suíte
(`tests/limpeza.ts` e `tests/global-teardown.ts`).

## Como trabalhar

O plano está em `docs/ade/` e **não usa sprintx nem runx**: é executável por agente sem perguntas.
Retomar: leia `docs/ade/00-LEIA-ME.md` (protocolo e regras invioláveis), depois `docs/ade/STATUS.md`, e
continue da primeira task `[ ]` com dependências `[x]`. Laço por task: ler a task em `fase-NN-*.md` e o
que ela cita; escrever o teste e vê-lo falhar; implementar o mínimo; `npm run verificar` verde; marcar em
`STATUS.md`. Decisão nova que não está nos documentos: escolher o padrão mais seguro e simples, registrar
como `D-NN` em `01-DECISOES.md` e, se for do dono, em `PENDENCIAS-DO-DONO.md`. Bloqueio real: registrar
em `STATUS.md` e seguir com a próxima task independente. Trabalho paralelo só em arquivos disjuntos.

## Decisões já tomadas (não reabrir sem o dono; texto completo em `docs/ade/01-DECISOES.md`)

- **Produto e escopo:** D-01 nome em uma constante; D-02 app separado do ExpxMedia; D-03 MVP = fases 0 a 5;
  D-04 método Expx de primeira classe (observador e disparador); D-05 cortes do Overclock (sem Zero,
  planos/trial, voz local, host mode, relay/app iOS).
- **Stack:** D-06 Electron 37.10.3, node-pty 1.1.0, xterm 6, React 19.3, Vite 8, Vitest 4 (versões exatas
  nas libs de terminal/PTY/Electron); D-07 um só `package.json`; D-08 `node:sqlite` atrás de `src/nucleo/banco/`;
  D-09 renderer por scheme próprio, sem servidor HTTP; D-10 sem roteador, Redux, Tailwind nem biblioteca
  de componentes.
- **Terminais e MCP:** D-11 xterm por painel visível, WebGL só no foco e nos primeiros 6; D-12 PTY num
  daemon que sobrevive ao app; D-13 MCP em HTTP loopback, token por Pane; D-14 permissões das CLIs: seguro
  por padrão, automático por opt-in.
- **Visual e idioma:** D-15 temas claro e escuro; D-16 identidade do ExpxMedia; D-31 destaque azul
  `#2563eb`; D-32 área de trabalho dos terminais maximizada (topo 40 px, rodapé 26 px); D-17 PT-BR.
- **Método:** D-18 parser tolerante; D-19 Missão ↔ trabalho; D-20 disparo de comandos com argumento;
  D-21 avaliador em Pane separado; D-22 worktrees ad hoc.
- **Processo:** D-23 sem commit, push nem CI disparado; D-24 auto-update desligado; D-25 sem telemetria;
  D-26 Windows só em unidade; D-27 Node 22 em tudo.
- **Detalhes de implementação:** D-28 `window.ade`; D-29 preferências e tema fora do banco; D-30 preload sem
  imports de runtime.
- **Versionamento (fase 6, pós-MVP):** D-33 git/gh/svn pelos binários da máquina; D-34 GitHub só por `gh`;
  D-35 SVN sem worktree; D-36 guard rails de escrita.

Pendências do dono (nome do produto, repositório de releases e assinatura, licença, commits, `node:sqlite`,
hooks do Codex, SVN): `docs/ade/PENDENCIAS-DO-DONO.md`.
