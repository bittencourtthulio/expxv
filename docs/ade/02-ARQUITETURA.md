# Arquitetura

## Processos

```
┌─ main (Electron, CJS) ──────────────────────────────────────────────┐
│ boot em 2 ondas · janela segura · scheme próprio · menu · tray      │
│ serviços: banco · workspaces · missões · git · provedores · método  │
│           sidecar MCP (HTTP loopback) · orquestração · IPC tipado   │
└───────┬───────────────┬───────────────────────────┬─────────────────┘
        │ IPC tipado    │ NDJSON (socket/pipe)      │ worker_threads
┌───────▼───────┐ ┌─────▼──────────────┐     ┌──────▼──────────────┐
│ renderer      │ │ daemon de PTY      │     │ worker do método    │
│ React (Vite)  │ │ (mesmo executável, │     │ indexa docs/**,     │
│ lazy por tela │ │ ELECTRON_RUN_AS_   │     │ observa worktrees   │
│ xterm         │ │ NODE=1) node-pty   │     └─────────────────────┘
└───────────────┘ └────────────────────┘
```

- O renderer **nunca** fala com Node: só com `window.ade` (preload, API enumerada).
- O main **nunca** confia no payload do renderer: um validador puro por canal.
- O daemon guarda as sessões de PTY (sobrevivem ao app). O renderer recebe saída do main.
- O MCP do app roda no main (HTTP em `127.0.0.1`, porta efêmera, token por Pane).

## Pastas

```
src/
  nucleo/                lógica pura (sem Electron) — testável sem janela
    produto.ts           constantes do produto (D-01)
    banco/               node:sqlite, migrations, repositórios
    dominio/             tipos: Workspace, Mission, Pane, Task, Handoff, Provedor…
    terminais/           contrato, limites, sanitizarOsc, ambiente, lançamento, catálogo, detecção
    metodo/              parser, indexador, modelo derivado, regras, grafo
    orquestracao/        regras, briefing, handoff, wake, hooks por CLI
    mcp/                 catálogo de tools, erros, tokens
    git/                 worktree, status, diff
  daemon/                servidor de PTY (protocolo, histórico, cliente, lançador)
  main/                  casca Electron: main.ts, boot, janela, menu, tray, ipc/*
  preload/               preload.ts (API enumerada)
  renderer/              UI React
    casca/               menu lateral, topo, rodapé, navegação
    telas/               inicio, missoes, terminais, metodo, workspaces, provedores, config
    componentes/         Icone, Pagina, EstadoVazio, Terminal, PaletaComandos…
    estado/              stores mínimos por domínio
    tokens.css           só variáveis (claro/escuro); css por componente ao lado
  compartilhado/         tipos de IPC e eventos usados por main e renderer
tests/                   e2e (Playwright Electron) e perf
scripts/                 dev, build, verificar, perf, verificar-pacote
docs/ade/                este plano
```

## Fluxo de dados

1. **Estado durável** no SQLite (`<userData>/expxv.db`): workspaces, missões, panes, sessões,
   contas, cache do método. O que mora no repositório do usuário (`docs/**`, `.expxv/…`) é
   **lido**, não copiado como verdade.
2. **Eventos de domínio** (`pane.spawned`, `handoff.submitted`, `method.changed`…) passam por um
   barramento no main; o renderer assina por IPC com coalescência.
3. **Terminal**: daemon → main (validação, sanitização OSC) → renderer (armazém → xterm).
   Teclado: renderer → main → daemon (`send`, sem resposta).
4. **Orquestração**: CLI do piloto → MCP (HTTP) → regras → `pane_spawn` → main cria Pane no
   daemon → hooks do worker → `handoff_submit` → banco → wake ao piloto.
5. **Método**: worker observa `docs/**` e `docs/eventos/*.jsonl` por worktree → modelo derivado →
   evento `method.changed` → UI.

## Segurança (resumo; detalhes em `05-CONTRATOS.md`)

- Janela: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, permissões mínimas,
  navegação só para o scheme próprio; o resto vai a `shell.openExternal` (http/https) ou é negado.
- IPC: lista fechada de canais, validação campo a campo, autorização por remetente (frame
  principal, janela, origem).
- Processos: executável e argumentos **separados**, nunca shell; `ambienteSeguro` remove variáveis
  de identidade de sessão do Claude Code e completa o PATH.
- Segredos: nunca em log/erro/rastro; chaves de provedor ficam nas CLIs; o app só lança.
- MCP: token por Pane, ferramentas filtradas, sem acesso a banco/chaves, loopback apenas.
- Links: só http/https, sem credenciais; OSC 52 e OSC 8 removidos da saída.

## O que vem do ExpxMedia (adaptar, não importar)

Do `../ExpxMedia/desktop/src/assistentes/`: `contrato`, `sessoes`, `daemon/*`, `catalogo`,
`deteccao`, `guardiao`, `autorizador`, `ipc` (validadores), `layout`, `anexos`, `links`,
`conversas`, `diagnostico`, `subagentes/*`. Do `../ExpxMedia/central/ui/src/`: `armazem`,
`atalhos`, `colagem`, `layout`, `links`, `semaforo`, `TerminalAssistente` e os tokens CSS.
Do `desktop/src/logica/`: `boot`, `janela`, `navegacao`, `instancia`, `notificar`, `tray`, `menu`.
Regras da adaptação: parametrizar o nome do produto (D-01), trocar instalação por workspace
(cwd por sessão decidido pelo main), ampliar a allowlist de anexos, tirar tudo de mídia/Alma.
