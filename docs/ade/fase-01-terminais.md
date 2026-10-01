# Fase 1 — Terminais

Objetivo: terminais reais, rápidos e que sobrevivem, portados do ExpxMedia e enxugados.
Fonte de código a adaptar: `../ExpxMedia/desktop/src/assistentes/**` e
`../ExpxMedia/central/ui/src/{assistentes,componentes/TerminalAssistente.tsx}` (somente leitura).
Base: `base/A-…` (specs 01 e 04) e `base/E-…` §3.

**Portão da fase**: `npm run verificar` verde · e2e de terminal verde (abrir, digitar, resize,
sobreviver a reload do renderer, flood) · `npm run perf` mede P-03, P-04, P-05, P-06, P-07.

### T-01.01 · Núcleo do PTY (contrato, lançamento, ambiente, sanitização)
- Arquivos: `src/nucleo/terminais/{contrato,lancamento,ambiente,osc,sessoes}.ts` + testes.
- Portar: limites (`LIMITES`), `prepararLancamento` (argv separado; `.cmd/.bat` e `.ps1` no
  Windows), `encerrarArvorePty`, `ambienteSeguro` (remove variáveis de sessão do Claude Code,
  completa PATH: `~/.local/bin`, volta, bun, nvm, homebrew), backpressure (64 KB; pausa > 256 KB;
  retoma < 128 KB), `sanitizarOsc` (remove OSC 52 e OSC 8; trata sequência partida entre chunks),
  `GerenciadorSessoes` com `AdaptadorPty`.
- Teste: OSC 52/8 removidos inclusive partidos; wrappers Windows escapam `^` e `%%`; ambiente sem
  variáveis de identidade; backpressure pausa/retoma; `sequencia` monotônica; 16 sessões máx.
- Aceite: suíte do módulo verde com `AdaptadorPty` falso (sem PTY real).
- Depende: T-00.01.

### T-01.02 · Daemon de PTY
- Arquivos: `src/daemon/{protocolo,servidor,cliente,lancador,historico,main-daemon}.ts` + testes.
- Portar protocolo NDJSON (`ola` com token, `listar`, `criar`, `anexar`, `soltar`, `historico`,
  `escrever`, `redimensionar`, `pausar`, `retomar`, `matar`, `descartar`, `encerrar_tudo`),
  `PROTOCOLO_DAEMON = 1`, socket em pasta curta no `tmpdir` com hash (limite ~100 caracteres) /
  named pipe, token 0600, histórico em disco com compactação (4×) e retenção de 7 dias, saída
  automática após 60 s ocioso, `ClienteDaemon` com fila pré-conexão e **reserva** para
  `AdaptadorNodePty`, `recuperar()` sem duplicar (usa `fim` acumulado).
- Nomes derivam de `produto.ts` (dois apps lado a lado não colidem).
- Teste: e2e de protocolo com node-pty real (`eco`, resize, SIGINT); daemon de outra versão não é
  reaproveitado; cliente cai na reserva quando o daemon não sobe; recuperar não duplica saída.
- Aceite: fechar e reabrir o app mantém as sessões vivas e reidrata a saída.
- Depende: T-01.01, T-00.08.

### T-01.03 · Catálogo e detecção de CLIs
- Arquivos: `src/nucleo/terminais/{catalogo,deteccao}.ts` + testes.
- Catálogo enxuto: `terminal`, `claude`, `codex`, `gemini`, `opencode`, `aider`, `qwen`, `kilo`,
  `personalizado` (as demais do ExpxMedia ficam atrás de flag). Por CLI: executáveis candidatos,
  `argumentosAutomaticos` (só se o workspace permitir, D-14), `teclaDeInterrupcao`,
  `argumentosDeRetomada`, `argumentosDePromptInicial`, `configuracaoDeMcp`, `temHook`.
- Detecção: varre PATH + diretórios convencionais (homebrew, `/usr/local/bin`, `~/.local/bin`,
  volta, bun, nvm; `LOCALAPPDATA\Programs`, `APPDATA\npm`), respeita `PATHEXT`, distingue
  `ausente|sem_permissao|nao_mapeado`, `realpath`, `modo_lancamento`, `executavel_id` opaco.
  Seleção manual exige caminho absoluto, existente e `X_OK`. Cache invalidado no foco da janela.
  **PATH do shell de login resolvido no boot** (apps GUI do macOS não herdam o PATH).
- Teste: fixtures com executáveis falsos em `tmpdir`; ordem de candidatos; wrappers; cache.
- Aceite: detecta `claude`/`codex` reais desta máquina sem executá-los com efeito (só `--version`).
- Depende: T-01.01.

### T-01.04 · IPC de terminais e autorização
- Arquivos: `src/main/ipc/terminais.ts`, `src/nucleo/terminais/ipc-validadores.ts`,
  `src/main/autorizador.ts`, `src/main/guardiao.ts` + testes.
- Canais `terminais:*` de `05-CONTRATOS.md` §2; um validador puro por canal; `autorizarRemetente`
  (recusa subframe, janela ou origem diferente, path fora de `/`, `search`/`hash`); cache de
  veredito por `(webContents.id, frame, url)` com invalidação em `did-navigate`/`render-process-gone`;
  `GuardiaoTransicoes` (fila serial, confirmação se há sessões ativas, só libera admissão se a
  transição não publicou). Com daemon, trocar de workspace só **solta** as sessões.
- Teste: cada validador rejeita payload inválido; remetente indevido negado; guardião serializa.
- Aceite: renderer não consegue enviar `cwd` nem executável que não veio da detecção.
- Depende: T-01.02, T-01.03, T-00.06.

### T-01.05 · Terminal no renderer (leve)
- Arquivos: `src/renderer/componentes/Terminal/{Terminal.tsx,armazem.ts,colagem.ts,links.ts,busca.tsx,tema.ts,carga.ts}` + testes.
- xterm 6 + FitAddon + SearchAddon + WebLinksAddon; **armazém de saída fora do React** (chunks,
  teto 2 MiB em UTF-16, descarta pelo mais antigo, descarta `sequencia <= ultima`, `assinar` com
  replay síncrono); `deveAplicarDimensao` (resize ao PTY só quando colunas/linhas mudam);
  WebGL só no painel em foco e até 6 visíveis (D-11), DOM no resto; painel fora de vista
  **desmontado** e reidratado do armazém; colagem grande (confirmação; arquivo ou partes de 32 KB
  respeitando code points; remove marcadores de bracketed paste; só envelopa em modo 2004);
  links só com Cmd/Ctrl+clique (main revalida); busca com `role="search"`; dois temas xterm;
  chunk carregado em ocioso após a primeira pintura.
- Teste: armazém (teto, descarte, replay); colagem (limites, code points, marcadores);
  `deveAplicarDimensao`; links (`http/https`, sem credencial, ≤ 2048, sem controle); contagem de
  contextos WebGL nunca passa de 6; Testing Library com `Terminal` simulado por `<pre>`.
- Aceite: P-03 (abrir ≤ 300 ms) e P-05 (eco p95 ≤ 40 ms) medidos no e2e.
- Depende: T-01.04, T-00.04.

### T-01.06 · Layout de painéis e atalhos
- Arquivos: `src/nucleo/terminais/layout.ts`, `src/renderer/telas/terminais/{Grade,Abas,Divisor}.tsx`,
  `src/renderer/telas/terminais/atalhos.ts` + testes.
- Árvore binária `terminal | divisao{orientacao, primeiro, segundo}` por aba; `LayoutV2`
  `{versao:2, ativa, abas[{arvore}], fixadas[]}` persistido **no main** por workspace (escrita
  atômica), `validarLayout` reconstrói campo a campo (profundidade ≤ 16, ≤ 64 nós, id
  `[\w.-]{1,80}`, ≤ 64 KB; inválido é descartado), `restaurarLayout` tolerante (sessão que não
  voltou sai da árvore e a divisão colapsa). Só grava depois da recuperação e nunca com sessão
  provisória. Atalhos de `04-UI-UX.md` (Cmd no mac; Ctrl+Shift nos demais).
- Teste: validar/restaurar (casos de borda), divisão/fechamento/expansão, atalhos por plataforma.
- Aceite: dividir/fechar painel em ≤ 50 ms; layout volta igual após reiniciar o app.
- Depende: T-01.05.

### T-01.07 · Sinaleira e atividade
- Arquivos: `src/nucleo/terminais/atividade/{servico,adaptadores/{claude,codex,opencode}}.ts`,
  `src/renderer/telas/terminais/semaforo.ts` + testes.
- Endpoint HTTP em `127.0.0.1` (porta efêmera, corpo ≤ 1 MiB, token por sessão em memória);
  adaptadores traduzem hooks em `atividade` (`trabalhando|aguardando|pronto`), `conversa` e
  subagentes; sem hook, heurística de ociosidade marcada "estimado". Semáforo agrega por grupo com
  prioridade `aguardando > trabalhando > pronto`; cor nunca é o único sinal; notificação nativa
  quando termina/pede aprovação e a janela não tem foco.
- Teste: adaptadores com payloads reais gravados em fixtures; token inválido → 401; agregação.
- Aceite: Pane do Claude Code com hook mostra amarelo enquanto trabalha e verde ao terminar.
- Depende: T-01.04.

### T-01.08 · Anexos e retomada de conversa
- Arquivos: `src/nucleo/terminais/{anexos,conversas,diagnostico}.ts` + testes.
- Colar/arrastar arquivo: o main copia para `.expxv/entradas/<sessao>/` do workspace e devolve
  caminho relativo formatado para shell (aspas só quando preciso), **sem Enter**. Limites: 10 itens,
  25 MB, nome ≤ 80; allowlist de dev (imagens, pdf, txt, md, json, código, logs, patch, zip);
  recusa `.env*`; exige `realpath` e arquivo regular. `webUtils.getPathForFile` no preload.
  `conversas`: guarda `sessao_id → conversa_id` fora do daemon para "Retomar conversa".
  `diagnostico`: texto copiável só com metadados.
- Teste: `.env` recusado; symlink para fora recusado; nome longo truncado; formatação de caminho.
- Aceite: arrastar uma imagem para o painel cola o caminho relativo no prompt.
- Depende: T-01.04.

### T-01.09 · Fixtures e e2e de terminal
- Arquivos: `tests/fixtures/cli-pty.mjs` (eco, `tamanho`, SIGINT), `tests/fixtures/cli-interativa.mjs`,
  `tests/terminal.e2e.test.ts`, `tests/perf/terminal.perf.ts`.
- Cenários: abrir → digitar → eco; resize propaga; Ctrl+C; **recarregar o renderer não mata o
  painel**; fechar o app e reabrir recupera; flood de 10 MB sem quadro > 50 ms (P-04); 4 painéis
  ociosos dentro de P-06/P-07; 8 painéis restaurados em ≤ 1,5 s (P-13).
- Aceite: todos verdes; `docs/ade/perf/ultimo.json` com P-03 a P-07 e P-13 dentro do orçamento.
- Depende: T-01.05, T-01.06, T-01.07, T-01.08.
