# Fase 5 — Acabamento do MVP

Objetivo: transformar as peças em um produto coeso, rápido e empacotável. Tudo aqui é medido.

**Portão da fase (= portão do MVP)**: `npm run verificar` verde · `npm run perf` com **todos** os
orçamentos P-01 a P-14 dentro do limite · `npm run dist` gera pacote local · `npm run test:pacote`
verde · `docs/ade/AUDITORIA-MVP.md` escrito.

### T-05.01 · Tela Início
- Arquivos: `src/renderer/telas/inicio/*` + testes.
- Missões ativas, o que aguarda você (Panes `aguardando`, vereditos sem assinatura, PRs abertos),
  bloqueios abertos, últimos eventos do método; cada item leva à tela certa; estado vazio guia o
  primeiro uso (abrir workspace → `Instalação do método` → criar Missão).
- Teste: RTL por cenário; nenhuma consulta bloqueante na abertura (dados por eventos).
- Aceite: primeira pintura com dados parciais em ≤ 100 ms após a tela montar.
- Depende: fases 2 e 4.

### T-05.02 · Paleta de comandos, menu do app, tray e notificações
- Arquivos: `src/renderer/componentes/PaletaComandos.tsx`, `src/main/{menu,tray,notificar}.ts` + testes.
- Paleta (⌘K): navegar, abrir workspace, nova Missão, novo terminal, trocar tema, buscar trabalho;
  busca fuzzy local sem dependência; menu nativo com atalhos; tray (abrir, pausar notificações,
  sair); notificação nativa quando um Pane precisa de você e a janela está sem foco; nenhuma com
  conteúdo sensível.
- Teste: ranking da busca; itens por contexto; notificação só sem foco.
- Aceite: paleta abre em ≤ 50 ms.
- Depende: T-05.01.

### T-05.03 · Configurações
- Arquivos: `src/renderer/telas/config/*`, `src/main/ipc/app.ts` + testes.
- Tema (claro/escuro/sistema), cor de destaque (sobrescreve `--destaque`/`--destaque-2`), atalhos
  (somente leitura no MVP), scrollback (teto 50 000), limite de painéis, permissão padrão de novos
  workspaces, diagnóstico copiável, sobre (versão, caminhos de dados).
- Teste: persistência; valores fora de faixa rejeitados; tema aplica sem recarregar.
- Aceite: alterar destaque reflete em toda a UI sem re-render global (medido).
- Depende: T-00.04, T-00.06.

### T-05.04 · Passe de desempenho
- Arquivos: `tests/perf/*`, correções onde os números pedirem.
- Medir P-01 a P-14 em cenário realista (workspace com 200 artefatos, 8 painéis, 1 000 cards);
  perfilar e corrigir estouros (chunks, memoização, virtualização, coalescência, debounce);
  conferir ausência de `longtask` > 50 ms após o boot.
- Aceite: `docs/ade/perf/ultimo.json` com todos os orçamentos verdes, sem relaxar limite.
- Depende: T-05.01 a T-05.03.

### T-05.05 · Acessibilidade e movimento
- Arquivos: testes `axe` leves (ou checagens de role/label) nas telas principais.
- Foco visível, ordem de tabulação, `aria-*` de abas/diálogos/sinaleira, contraste AA nos dois
  temas, `prefers-reduced-motion` desliga pulsos e transições de largura.
- Teste: varredura de roles obrigatórios; cor nunca é o único sinal.
- Aceite: zero diálogos nativos no e2e; navegação completa só por teclado.
- Depende: T-05.04.

### T-05.06 · Empacotamento e documentação
- Arquivos: `electron-builder.yml` (completar), `README.md`, `AGENTS.md`, `.github/workflows/*.yml`
  (versionados, **não disparados**), `scripts/verificar-pacote.mjs`.
- `npm run dist:mac`/`dist:win` (sem assinatura sem secrets); teste de pacote exercita node-pty,
  daemon e sidecar MCP de dentro do pacote; README com instalação, desenvolvimento e mapa;
  `AGENTS.md` no padrão do ExpxMedia (regras, como testar, decisões já tomadas).
- Teste: `test:pacote` verde no pacote gerado.
- Aceite: app empacotado abre, cria terminal e delega com a CLI falsa.
- Depende: T-05.04.

### T-05.07 · Auditoria do MVP
- Arquivos: `docs/ade/AUDITORIA-MVP.md`.
- Conferir cada RF "MVP" das specs 01, 02, 04, 05 (núcleo), 12 (cards) contra o que foi entregue;
  listar o que ficou fora e por quê; conferir as regras invioláveis do `00-LEIA-ME.md`; varredura de
  segredos e de caminhos absolutos gravados; revisão independente (agente de leitura) dos módulos de
  segurança (IPC, MCP, anexos, links, ambiente). Findings ALTA voltam para correção antes de fechar.
- Aceite: auditoria sem achado ALTA aberto.
- Depende: T-05.06.
