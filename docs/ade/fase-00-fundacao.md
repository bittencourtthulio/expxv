# Fase 0 — Fundação

Objetivo: um app Electron **seguro, rápido e testável** com casca, tokens claro/escuro, banco,
barramento de eventos, harness de performance e empacotamento local. Sem terminais ainda.

**Portão da fase**: `npm run verificar` verde · `npm run dev` abre a janela · `npm run perf`
mede P-01, P-02, P-08, P-12, P-14 dentro do orçamento · `npm run dist:dir` gera o app local.

Formato: `T-NN.MM · título` — arquivos · teste (dois no mínimo) · aceite (binário) · depende.

### T-00.01 · Scaffold e toolchain
- Arquivos: `package.json`, `tsconfig.json` (base), `tsconfig.main.json` (CJS), `tsconfig.renderer.json`,
  `vitest.config.ts`, `vite.config.ts`, `.gitignore`, `.editorconfig`, `scripts/verificar.mjs`.
- Versões: D-06 (exatas para electron/electron-builder/node-pty/xterm/playwright). `engines.node >= 22`.
- Scripts: `typecheck`, `build`, `test`, `verificar`, `dev`, `perf`, `dist:dir`, `test:pacote`.
- Teste: `src/nucleo/smoke.test.ts` (vitest roda TS); teste que `verificar` falha com erro de tipo
  injetado (fixture).
- Aceite: `npm ci && npm run verificar` verde em máquina limpa; typecheck estrito
  (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Depende: —.

### T-00.02 · Constantes do produto e varredura
- Arquivos: `src/nucleo/produto.ts`, `src/nucleo/produto.test.ts`, `tests/varredura-marca.test.ts`.
- `produto.ts`: `nome`, `id`, `scheme`, `appId`, `pastaDados`, `prefixoSocket`, `prefixoEnv`,
  `protocoloUrl`, `repositorioReleases` (placeholder).
- Teste 1: nenhum arquivo em `src/` (exceto `produto.ts` e testes) contém o nome literal nem ids
  derivados. Teste 2: todas as constantes derivam de `id` e mudam juntas (renomear em 1 lugar).
- Aceite: trocar `id` em um arquivo e rodar typecheck+testes mantém tudo verde.
- Depende: T-00.01.

### T-00.03 · Casca Electron segura
- Arquivos: `src/main/main.ts`, `src/main/janela.ts`, `src/main/navegacao.ts`, `src/main/boot.ts`,
  `src/main/instancia.ts`, `src/main/scheme.ts`, `src/preload/preload.ts`, `src/compartilhado/ipc.ts`.
- Comportamento: instância única; scheme privilegiado `<scheme>://app/` servindo `dist/renderer`
  (lista fechada de recursos, sem path traversal); `webPreferences` seguras;
  `setPermissionRequestHandler` nega tudo; `will-navigate`/`setWindowOpenHandler` só aceitam o
  scheme próprio, http/https vão a `shell.openExternal`; `backgroundColor` = token de fundo do tema;
  boot em 2 ondas com erro isolado por serviço; preload com API **enumerada**.
- Teste: `janela.test.ts` (opções de segurança exatas, cor == token), `navegacao.test.ts`
  (urls permitidas/negadas, traversal), `preload.test.ts` (formato travado), `boot.test.ts`
  (serviço que falha não derruba os outros).
- Aceite: janela abre em `npm run dev`; nenhuma forma de o renderer acessar Node.
- Depende: T-00.01, T-00.02.

### T-00.04 · Casca do renderer, tokens e tema
- Arquivos: `src/renderer/index.html`, `main.tsx`, `App.tsx`, `casca/{Menu,Topo,Rodape,Navegacao}.tsx`,
  `componentes/{Icone,Pagina,EstadoVazio}.tsx`, `tokens.css`, `casca/casca.css`, fontes em
  `src/renderer/assets/fontes/` (Chakra Petch 400/600/700, JetBrains Mono 400; OFL).
- Comportamento: layout de `04-UI-UX.md`; tokens claro/escuro (`:root[data-theme]`), tema inicial
  por `prefers-color-scheme` + preferência salva no main; telas placeholder em `React.lazy`;
  as 4 últimas telas ficam montadas; menu recolhido 76 px → 232 px por cima; foco por teclado.
- Teste: `tokens-css.test.ts` (sem `backdrop-filter` em barras, sem cor literal fora de tokens e dos
  temas xterm, os dois temas definem os mesmos tokens), `Navegacao.test.tsx` (RTL + jsdom:
  troca de tela, `aria-current`, lazy), `tema.test.ts` (fundo da janela == `--fundo` nos dois).
- Aceite: alternar tema sem recarregar; troca de tela pinta em ≤ 50 ms (medido em T-00.07).
- Depende: T-00.03.

### T-00.05 · Persistência (SQLite)
- Arquivos: `src/nucleo/banco/{banco.ts,migracoes/0001-base.ts,migrar.ts}`, `src/nucleo/banco/*.test.ts`.
- `node:sqlite` (D-08), WAL, `busy_timeout`, statements preparados, `transacao(fn)` com
  `BEGIN IMMEDIATE`, migrations versionadas por `PRAGMA user_version`, recusa banco de versão maior,
  backup antes de migrar.
- Teste: migração do zero cria schema de `05-CONTRATOS.md` §1; rollback em falha no meio; banco
  de versão futura é recusado com erro nominal; consulta quente ≤ 5 ms (P-14) com 10 000 linhas.
- Aceite: funciona **dentro do Electron real** (teste `tests/banco-electron.cjs` via
  `ELECTRON_RUN_AS_NODE=1`). Se `node:sqlite` falhar no Electron 37, registrar em `STATUS.md`
  e trocar a implementação atrás da interface (nada fora de `banco/` muda).
- Depende: T-00.01.

### T-00.06 · Barramento de eventos e IPC tipado
- Arquivos: `src/compartilhado/{ipc.ts,eventos.ts}`, `src/main/ipc/registro.ts`,
  `src/main/ipc/validar.ts`, `src/main/barramento.ts`, `src/preload/preload.ts`.
- Comportamento: mapa de canais tipado (entrada/saída) compartilhado; `registrar(canal, validador,
  manipulador)` recusa payload inválido e remetente não autorizado (frame principal, janela,
  origem do scheme próprio); barramento de domínio com `assinar/emitir` e coalescência por tipo;
  eventos ao renderer em lote.
- Teste: validador rejeita campo extra/ausente/tipo errado; remetente de subframe é negado;
  coalescência mantém o último por chave; ordem por sequência.
- Aceite: canal não registrado não existe no preload; adicionar canal exige tipo + validador
  (teste de contrato falha sem).
- Depende: T-00.03.

### T-00.07 · Harness de performance e testes de UI
- Arquivos: `tests/fixture.ts` (Playwright `_electron.launch` com `EXPXV_E2E=1`, userData em
  `tmpdir`), `tests/perf/*.perf.ts`, `scripts/perf.mjs`, `scripts/tamanho-bundle.mjs`,
  `docs/ade/perf/` (saída).
- Mede P-01, P-02, P-08, P-12 (e prepara P-03–P-07, P-13 para a Fase 1). Grava
  `docs/ade/perf/ultimo.json` com valores, limites e veredito; `EXPXV_PERF_FATOR`.
- Teste: o próprio harness falha quando um limite é estourado (teste com limite artificialmente
  baixo); `tamanho-bundle` falha acima de 350 KB gzip inicial.
- Aceite: `npm run perf` produz o JSON e sai com código ≠ 0 se algum orçamento falhar.
- Depende: T-00.04.

### T-00.08 · Empacotamento local
- Arquivos: `electron-builder.yml`, `build/` (ícones provisórios gerados), `scripts/verificar-pacote.mjs`,
  `scripts/dev.mjs`.
- Comportamento: mac `dmg`+`zip` universal, win `nsis` x64; `asarUnpack` de `node-pty` (e `x64ArchFiles`
  no mac universal, limitando o glob < 65 536 caracteres); `ELECTRON_RUN_AS_NODE` para o daemon;
  `NSMicrophoneUsageDescription` **não** entra no MVP; assinatura/notarização por secrets opcionais
  (desligadas sem eles); `publish` placeholder (D-24).
- Teste: `verificar-pacote.mjs` abre o `.app` gerado em `dist-app/mac-*/` e roda node-pty empacotado
  (spawn, resize, SIGINT).
- Aceite: `npm run dist:dir` gera o app; `npm run test:pacote` verde. (DMG/NSIS completos ficam
  para a T-05.06; aqui basta `--dir`.)
- Depende: T-00.03, T-00.05.
