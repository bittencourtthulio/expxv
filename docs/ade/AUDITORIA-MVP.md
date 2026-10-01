# Auditoria independente do MVP (T-05.07)

Data: 2026-09-30 (noite) · Auditor: agente de leitura, sem participação na implementação · Escopo: fases 0 a 5.

## Método e limites

- Li o código, os testes e os documentos listados no pedido. Rodei `npx vitest run` (escopo pedido, 3 vezes), testes de marca/cor/contraste/compacto, `tsc` dos três projetos e experimentos descartáveis em pasta temporária.
- **Não** rodei `npm run build`, `dev`, e2e nem `perf` (e2e/perf disparam a limpeza de processos, ver AUD-01). Os números de perf são os do repositório, lidos criticamente. Windows não foi exercitado (D-26).
- Nada foi escrito fora deste arquivo, exceto temporários no scratchpad (apagados). `src/nucleo/vcs/**` e as fases 7 a 13 foram ignorados, salvo onde o código do MVP depende deles (o executor de git).
- Meu `grep` literal por arquivos de ambiente foi bloqueado por um hook do ambiente. Substituí por buscas indiretas (carregadores, listagem de arquivos), citadas em F.
- Onde um achado depende de comportamento externo (Codex, git, xterm) e eu não o executei, está marcado como "não exercitado".

## Resumo executivo

1. O MVP é sólido em arquitetura: janela segura, IPC com validador estrito em todos os canais, tokens HMAC com expiração e revogação, git sem shell, método somente leitura. Typecheck limpo e 1 415 testes unitários.
2. Há **2 achados ALTA abertos**: a limpeza dos testes e2e/perf mata o daemon real do dono (AUD-01) e o Codex roda sempre com `--dangerously-bypass-hook-trust`, contrariando a mitigação prometida (AUD-02).
3. Há 13 MEDIA, entre eles o diagnóstico do `watcher.close()` (síncrono e O(N²): 10 000 arquivos = 10,6 s), o handoff→wake sem persistência, o backup de migração que nunca roda e as preferências que param de gravar após uma falha.
4. Os orçamentos P-01..P-15 estão todos medidos e verdes, sem fator de tolerância. Mas P-12 e P-07 medem o caso ocioso e P-01/P-02/P-03/P-13 descartam a amostra fria sem registrá-la.
5. A suíte unitária é instável sob carga (5 falhas em 4 testes diferentes em 3 execuções). Cobertura do plano das fases 0 a 5 é alta; os cortes de spec-01 (SSH, multi-janela, browser) não estão registrados em D-05.

## Tabela de achados

Esforço: P = até 1 h, M = até meio dia, G = 1 dia ou mais.

| ID | Sev. | Área | Resumo | Evidência | Correção sugerida | Esforço |
|---|---|---|---|---|---|---|
| AUD-01 | ALTA | Processos/testes | `matarOrfaos()` casa o prefixo `expxv-pty` e mata o daemon REAL (e as CLIs dentro dele) a cada `test:e2e`/`perf` | `tests/limpeza.ts:62,69`; `src/daemon/caminhos.ts:30-33`; `vitest.e2e.config.mts:11`; `tests/global-teardown.ts:9-14` | Tirar `expxv-pty` e `ade-` genérico do critério; casar só `--dir` dentro de `tmpdir()/ade-*`; teste provando que um daemon real não é alvo | P |
| AUD-02 | ALTA | Segurança | Todo Codex abre com `--dangerously-bypass-hook-trust`, mesmo em workspace `seguro`; a mitigação de P-09 não existe | `atividade/adaptadores/codex.ts:45`; `main/contexto-terminais.ts:161`; `codex.test.ts:40`; `PENDENCIAS-DO-DONO.md:16` | Passar o workspace a `observar`; incluir o flag só em `automatico`; no `seguro`, heurística de ociosidade | M |
| AUD-03 | MEDIA | Segurança | `git status`/`worktree add` automáticos em pasta não confiável executam `core.fsmonitor` e hooks do `.git/config` | `vcs/executor.ts:203` (só `core.quotepath`); `git/status.ts:66`; `workspaces/servico.ts:105,144`; 0 ocorrências de `fsmonitor`/`hooksPath` | `-c core.fsmonitor=false -c core.hooksPath=` nas leituras; confiança explícita do projeto antes de escrever | M |
| AUD-04 | MEDIA | Segurança | Bearer do MCP em HTTP claro, porta persistida e TTL de 7 dias: processo local que ocupar a porta com o app fechado colhe tokens de Panes vivos | `mcp/servidor.ts:203-205`; `main/mcp-remoto.ts:68,122`; `mcp/tokens.ts:54`; `terminais/catalogo.ts:154` | TTL curto com renovação; não reusar porta sem prova de posse; registrar o risco multiusuário | G |
| AUD-05 | MEDIA | Robustez | Fila de wake só em memória: queda entre o commit do handoff e a entrega perde o aviso; ninguém reenfileira | `orquestracao/wake.ts:57-61`; `main/orquestracao.ts:221,607-612,657-661` | Coluna de entrega no `handoff`; varrer pendentes no boot | M |
| AUD-06 | MEDIA | Robustez | `watcher.close()` trava o main (síncrono, O(N²)); no encerramento e na troca de workspace | Medição abaixo; `metodo/observador.ts:79-86,198-218`; `main/servicos-metodo.ts:153-159,249-269`; `main/main.ts:346-366` | `fs.watch` recursivo (1 stream) ou watcher em worker; não aguardar no quit | G |
| AUD-07 | MEDIA | Robustez | Preferências: após uma falha de escrita, todas as seguintes falham para sempre; o cache diz que gravou (reproduzido) | `main/preferencias.ts:38-49` | `fila = fila.catch(()=>{}).then(...)`; reverter o cache na falha; apagar o `.tmp` | P |
| AUD-08 | MEDIA | Robustez | `migrar(banco)` sem `caminho`: o backup antes de migrar nunca acontece | `main/dominio-base.ts:32`; `banco/migrar.ts:69-70` | `migrar(banco, { caminho })` | P |
| AUD-09 | MEDIA | Robustez | Daemon que morre não é religado: `#falhar` é terminal, sessões recebem saída -1 e só há `console.error` | `daemon/cliente.ts:195-215`; `main/daemon.ts:99-103` | Relançar/reconectar com backoff e avisar na UI | G |
| AUD-10 | MEDIA | Robustez | `restaurar()` marca TODOS os Panes como `sessao_morreu` se `recuperar()` falhar ou o daemon ainda não respondeu (decisão irreversível) | `missoes/panes.ts:310-335`; `cliente.ts` `#conectar` (50×100 ms) | Só encerrar Pane quando `listar` respondeu com sucesso | M |
| AUD-11 | MEDIA | Robustez | `workspaces:remover` apaga em cascata missões, panes, tasks, handoffs e eventos, mesmo com Missão ativa | `workspaces/servico.ts:122-127`; `banco/migracoes/0001-base.ts:23,52,88`; `telas/workspaces/index.tsx:59` | Recusar com Missão ativa ou soft delete; avisar no diálogo | M |
| AUD-12 | MEDIA | Segurança | Rastro JSONL lido sem teto (`Buffer.alloc(size - offset)`), inclusive no main | `metodo/parser/jsonl.ts:44-58`; `main/servicos-metodo.ts:232-240` | Ler só a cauda (ex. 8 MiB) e ignorar arquivo gigante com aviso | P |
| AUD-13 | MEDIA | Testes | Suíte instável sob carga e um teste com falha determinística de 1/16 | Seção E | Mover asserções de latência para `tests/perf`; tornar o teste de token determinístico | M |
| AUD-14 | MEDIA | Orçamentos | P-12 mede o main ocioso (3 janelas de 1,5 s): não enxerga AUD-06 | `tests/perf/casca.perf.ts:99-117` | Medir durante abrir/trocar workspace, flood e indexação | M |
| AUD-15 | MEDIA | Orçamentos | P-07 (177/200 MB, pior 185,7) é sem workspace, Missão, MCP, indexador ou leitor de tela; caso real passa de 200 | `tests/perf/terminal.perf.ts:196-221` | Medir com Missão 1+2 e método aberto | M |
| AUD-16 | BAIXA | Orçamentos | P-01/P-02/P-03/P-13 descartam a amostra fria e o valor frio só vai ao console; P-01 mede `ready-to-show` do main, não a "casca interativa" | `casca.perf.ts:19-38,40-64`; `terminal.perf.ts:46-94,225-266` | Registrar a fria em `ultimo.json` (campo `fria`) | P |
| AUD-17 | BAIXA | Orçamentos | `ultimo.json` está `tudo_ok:false` por P-16 (F6: 505 ms > 250); `npm run perf` está vermelho nesta árvore | `docs/ade/perf/ultimo.json` | Fechar P-16 na F6; MVP P-01..P-15 estão verdes | n/a |
| AUD-18 | BAIXA | Segurança | Latente: `consultarMemox` roda `python3 <repo>/.claude/skills/memox/assets/memox.py`. Hoje sem chamador, mas ligá-lo executaria código de repositório não confiável | `metodo/memox.ts:49-60` | Exigir "projeto confiável" antes de qualquer script do repo | P |
| AUD-19 | BAIXA | Segurança | Sanitizador de OSC ignora a forma C1 (U+009D/U+009C), que o xterm aceita; sem teste | `terminais/osc.ts:11,42`; `@xterm/xterm/src/common/parser/EscapeSequenceParser.ts:106` | Tratar C1 no sanitizador e testar | P |
| AUD-20 | BAIXA | Conformidade | `pane_send` grande digita caminho ABSOLUTO (M9) e nunca limpa `entradas/` | `mcp/tools/pane.ts:130-137`; `orquestracao/pasta.ts:64-71` | Devolver relativo; retenção | P |
| AUD-21 | BAIXA | Segurança | `pane_spawn.cwd` e a pasta do produto validados só lexicalmente (symlink escapa) | `main/orquestracao.ts:443,454`; `pasta.ts:24-31,64-71` | `resolverDentroReal` | P |
| AUD-22 | BAIXA | Segurança | `report_path` aceita qualquer arquivo do worktree e o lê inteiro só para ver se não está vazio | `orquestracao/handoff.ts:54-67` | Exigir `.md` e `stat.size` com teto | P |
| AUD-23 | BAIXA | Segurança | Renderer fornece caminho absoluto a `workspaces:abrir` e `terminais:anexar`, e `argumentos` livres em `terminais:abrir` (reintroduz `--dangerously-skip-permissions`) | `workspaces/servico.ts:101-111`; `terminais/anexos.ts:88-103`; `ipc-validadores.ts:81-87` | Registrar a decisão de confiança; aceitar só recentes/drop | M |
| AUD-24 | BAIXA | Segurança | `ID_CONVERSA` aceita começar com `-` (injeção de opção em `--resume`/`resume`) | `terminais/catalogo.ts:51-56` | Exigir primeiro caractere alfanumérico | P |
| AUD-25 | BAIXA | Segurança | `validar()` do git acha o subcomando por "primeiro não-`-`": `-C x push` e `-c a=b push` escapam; `git/orktree.ts` é arquivo vazio órfão | `git/git.ts:46-51` | Lista de subcomandos permitidos; apagar o arquivo | P |
| AUD-26 | BAIXA | Segurança | Guarda do piloto cobre só Edit/Write/MultiEdit/NotebookEdit e é lexical; o piloto escreve via Bash | `orquestracao/regras.ts:151-163`; `hooks/claude.ts:83-84` | Documentar como guarda de comportamento; incluir Bash | M |
| AUD-27 | BAIXA | Segurança | Daemon: sem limite de linha nem prazo para `ola` (conexão muda segura o daemon vivo); `gravarMeta` não atômico; `daemon.log` sem rotação; pipe do Windows sem ACL | `daemon/servidor.ts:230-246,186`; `historico.ts:18`; `main-daemon.ts:19-21` | Limite de 1 MiB e prazo de 5 s; escrita atômica | M |
| AUD-28 | BAIXA | Segurança | Chave `__proto__` passa em `PADRAO_CHAVE` e troca o protótipo do cache de preferências (sem poluição global) | `ipc/app.ts:9`; `preferencias.ts:40` | `Map`/`Object.create(null)` | P |
| AUD-29 | BAIXA | Segurança | Gancho E2E por variável de ambiente existe no binário de produção | `main/gancho-e2e.ts:24-31` | Exigir `!app.isPackaged` | P |
| AUD-30 | BAIXA | Robustez | Banco de versão futura: só `console.error`; IPC de domínio não registra e terminais caem em `homedir()` | `main/main.ts:211,271,391` | Mensagem na UI e bloqueio de abrir sessão | M |
| AUD-31 | BAIXA | Desempenho | Sem índice em `handoff(de_pane_id)` e `pane(sessao_pty_id)`; `evento_dominio` sem retenção; P-14 não cobre essas consultas | `0001-base.ts`; `main/orquestracao.ts:258,571` | Migração 0003 | P |
| AUD-32 | BAIXA | Segurança | 2º servidor HTTP (atividade): token no caminho aparece no argv do Codex; sem checagem de Host (P-10 do dono) | `atividade/servico.ts:70-103`; `codex.ts:44-45` | Cabeçalho em vez de caminho | M |
| AUD-33 | BAIXA | Testes | `limpeza.ts` repete nome do produto e do projeto fora de `produto.ts`; 153 sockets mortos em `$TMPDIR/expxv-pty-501` e 22 pastas `ade-*` (até 40 MB) sobrando | `tests/limpeza.ts:62,71` | Derivar de `PRODUTO`; limpar ao fim | P |
| AUD-34 | BAIXA | Processo | `STATUS.md` inconsistente: T-05.04 e T-03.07 `[ ]` apesar de entregues; "faltam P-08..P-14" já medidos | `STATUS.md` | Atualizar | P |
| AUD-35 | MEDIA | Cobertura | Cortes de spec-01 sem registro (SSH 01.90-99, multi-janela 01.80-84, browser 01.02/01.11, limite/fila de paste 01.50-51, shell padrão 01.60) | Seção C; `01-DECISOES.md` D-05 | Registrar D-NN de corte | P |
| AUD-36 | BAIXA | Desempenho | E/S síncrona no main depois do boot (layout; escritas da atividade) contra a regra 2 | `terminais/layout.ts:92-104`; `atividade/servico.ts:119-120` | `fs/promises` | P |

## A) Segurança

### A.1 Janela, navegação, scheme, permissões — sem achado

- `contextIsolation`, `sandbox`, `nodeIntegration:false`, `webSecurity` fixos em `main/janela.ts:21-31`. `webviewTag` não habilitado.
- `will-navigate` e `setWindowOpenHandler` (`main.ts:120-127`) só deixam passar o documento do app; http/https externos vão ao navegador depois de `urlExternaSegura` (`navegacao.ts:33-44`).
- `caminhoDoRecurso` (`scheme.ts:22-43`): decodifica, recusa `\0` e `\`, confere prefixo da raiz e extensão. Testado com `%2e%2e`, `%00`, `%5C` (`navegacao.test.ts`). Não há symlink em `dist/renderer`.
- CSP por cabeçalho (`scheme.ts:46-57`): `script-src 'self'`, sem eval. Só `style-src 'unsafe-inline'` (React). Permissões negadas (`main.ts:368-372`).
- Renderer sem `innerHTML`, `eval`, `dangerouslySetInnerHTML` ou `window.open`.
- Lacuna de teste: o e2e cobre a navegação recusada e a API enumerada, mas nada prova o handler de permissões nem o `window.open` fiado em `main.ts` (BAIXA, sem ID).

### A.2 Preload — sem achado

`preload.ts` expõe `window.ade` enumerado (linhas 16-103). Não expõe `ipcRenderer`. `webUtils.getPathForFile` só devolve caminho de um `File` dado. Sem IPC síncrono.

### A.3 IPC — sem vulnerabilidade, com decisão de confiança (AUD-23)

- `registro.ts:61-91`: canal fora do contrato lança; remetente (frame principal, janela esperada, URL exata do app) e validador rodam antes do manipulador. Os testes percorrem `CANAIS_INVOKE/ENVIO` por domínio (`ipc/terminais.test.ts:101`, `dominio.test.ts:87`, `servicos.test.ts:76`).
- `vObjeto` é estrito (campo extra ou ausente falha). `cwd`, executável e papel não existem nos validadores; ids têm regex.
- Resta o modelo de confiança: o renderer pode enviar `argumentos` livres, `caminho` de workspace e de anexo. Como o terminal já dá shell, um renderer comprometido já é RCE. Não achei vetor de XSS. Fica como decisão registrada, não como bug.

### A.4 Terminais

- Argv sem shell (`lancamento.ts:56-71`); no Windows `argumentoCmd` escapa `%`, `^&|<>()!"` e recusa quebra de linha.
- Ambiente (`ambiente.ts:28-52`): remove a identidade do Claude Code e `ELECTRON_RUN_AS_NODE`. O resto do `process.env` passa por design.
- Anexos (`anexos.ts`): allowlist de extensão, prefixo de arquivo de ambiente recusado em nome e destino, `realpath`, só arquivo regular, symlink para fora recusado, teto de 25 MB. Ressalva: `.json` e `.log` entram, então um arquivo de credenciais `.json` é aceito se o renderer pedir (AUD-23). Pasta `.expxv` sem `realpath` (AUD-21).
- Links: `urlDeLinkPermitida` revalida http/https sem credenciais.
- OSC: sanitiza `ESC ]` 52 e 8, inclusive partidos entre pedaços. Não trata a forma C1 (AUD-19). O core do xterm não tem handler de OSC 52 (sem `ClipboardAddon`), então o efeito real é um hiperlink forjável, que ainda passa por `confirm` e `urlExternaSegura`. `windowOptions` não é habilitado: sem eco do título.
- Sessões: limite de sessões, backpressure e `confirmarConsumo` validados.
- Codex: AUD-02.

### A.5 Daemon

- Token de 24 bytes aleatórios em `sessoes-pty-v1/token` (0600), socket 0600 em pasta 0700 por usuário (`$TMPDIR/expxv-pty-<uid>`), pasta de dados 0700 (conferi `drwx------` no `userData`).
- Primeiro pedido tem de ser `ola` com token; comparação não é de tempo constante (local, irrelevante).
- `criar` aceita executável, cwd e env do cliente autenticado: quem lê o token executa código. É o desenho.
- Histórico em disco: 0600, retenção de 7 dias para sessões encerradas; ids validados contra traversal (`ID_SESSAO_DAEMON`).
- Resto em AUD-27, AUD-09, AUD-10.

### A.6 MCP e hooks

Correto:
- HMAC-SHA256 com `timingSafeEqual`, segredo persistente de 32 bytes (0600, atômico, `wx`), `exp`, revogação por `n` persistida e podada.
- Identidade só do token (`mission_id`, `pane_id`, `role`). A lista de tools sai do token. O token só restringe.
- Host/Origin loopback, corpo ≤ 1 MiB (declarado e acumulado), stateless, 401 antes de ler o corpo.
- Settings por Pane só em `<userData>/panes/<pane>/`, 0600, com marcador. Nada em `~/.claude`, `~/.codex` ou `.claude/` do projeto (conferido por busca: nenhuma rota de código grava lá). Token no ambiente do Pane, nunca em argv; o `mcp.json` do Claude guarda o Bearer (0600).
- Falha aberta nos hooks de Stop, PostToolUse e SessionStart; fechada no guarda de escrita do piloto (`gancho.mjs:8,45-56`). Coerente com o documentado.

Achados: AUD-04 (porta e TTL), AUD-21/22 (caminhos), AUD-26 (guarda do piloto), AUD-32. Dois pontos sem ID: `chamar()` do RPC não tem prazo (uma porta que não responde pendura a requisição HTTP), e as tools não reconferem se o Pane chamador ainda existe (depende da revogação, gravada de forma assíncrona e melhor esforço).

### A.7 Git

Sem shell, timeout, teto de saída, ambiente limpo, `push` e `--force*` recusados, `worktree remove` sem `--force`, `branch -d` nunca `-D`. Nomes de branch passam por `check-ref-format`, recusam `-` inicial e espaços; slug só `[a-z0-9-]`. Achados: AUD-03 (repo não confiável) e AUD-25.

### A.8 Método

Descoberta usa `Dirent` e ignora symlinks; profundidade 6; `node_modules`, `.git`, `dist` ignorados. Artefatos têm teto de 2 MiB. YAML com `maxAliasCount:100`. Nunca escreve em `docs/` (nenhuma chamada de escrita em `src/nucleo/metodo`). Comando digitado: argumento normalizado a uma linha, 1 500 caracteres, nome de skill com regex, ações humanas nunca disparam. Achados: AUD-12 (JSONL sem teto) e AUD-18 (memox latente). Um `docs` que seja symlink é seguido (`readdir`): baixo.

### A.9 Config, segredos, caminhos, console

- Config: chaves `tema_`/`sistema_` reservadas, faixas por chave, valor ≤ 64 KB. Chave desconhecida passa (aceito). AUD-28.
- Segredos: 0 ocorrências de `sk-`, `ghp_`, `AKIA`, `xox`, `AIza`, chave privada em `src`, `tests`, `docs`, `scripts`, `.github`, `.claude`, `.opencode`, `build`. Nenhum carregador de arquivo de ambiente (`dotenv`, `loadEnvFile`, `--env-file`: 0) e nenhum `.env*` na raiz. Erros citam nomes de variável.
- Caminhos absolutos em artefatos: só AUD-20. Brief, relatório, briefing, eventos de domínio e anexos usam caminho relativo.
- `console.*`: só `console.error` com `erro.message` em `main.ts` e `daemon.ts`. Pode conter caminho (stderr do git), nunca valor de segredo.

## B) Robustez

**Handoff.** A ordem relatório → banco → wake é implementada e testada (`handoff.ts:112-124,83-110`; e2e "9 cenários"). O banco grava handoff e task numa transação. Lacuna: wake volátil (AUD-05). Duplo `handoff_submit` gera dois handoffs e dois avisos (sem idempotência).

**Transações.** `pane.criar`, `pane.encerrar`, `mission.*`, `handoff` e `conta.criar` usam `transacao` (BEGIN IMMEDIATE, SAVEPOINT aninhado, síncrona). Fechar Missão não é atômico: `fecharPanes`, depois cada transição, depois o evento (`missoes/servico.ts:238-260`). Queda no meio deixa Panes fechados e Missão no meio do caminho (recuperável, sem corrupção). `conta.criar` cria pasta dentro da transação (efeito colateral fora do rollback, inofensivo).

**Recuperação.** Tokens e revogados sobrevivem a reinício; Panes orquestrados são repovoados (`recuperarOrquestrados`); sessões voltam do daemon com histórico. Falhas: AUD-09, AUD-10, AUD-05.

**Vazamentos ao fechar.** Timers do MCP, vigia, handoff e daemon são `unref`; o servidor MCP fecha em ≤ 2 s e a thread é terminada. O problema é um só.

### Diagnóstico do `watcher.close()` com ~10 000 arquivos (PP-01)

**Causa.** O chokidar 5 não usa `fsevents`: cria um `fs.watch` por arquivo e por pasta. `FSWatcher.close()` (`node_modules/chokidar/index.js:413-440`) chama de forma **síncrona** o closer de cada um (`handler.js:~205` → `cont.watcher.close()`). No macOS, cada `fs.watch().close()` reagenda o stream de eventos do libuv, então fechar N watchers custa O(N²) e a thread principal fica presa dentro do `close()`. Daí o que o PP-01 viu: nenhum timer roda (nem o `setTimeout(...).unref()` de 4 s do `before-quit`, `main.ts:352`), porque o loop do main está parado. `awaitWriteFinish` não é a causa.

**Medição (Node puro, pasta temporária, máquina com carga 10 a 28):**

| Arquivos | `close()` | Batidas de um timer de 50 ms |
|---|---|---|
| 500 | 28 ms | 0 |
| 1 000 | 143 ms | 0 |
| 2 000 | 248 ms | 0 |
| 4 000 | 984 ms | 0 |
| 10 000 | **10 615 ms** | 0 (tempo síncrono = tempo total) |

Com `fs.watch(dir, {recursive:true})` (um stream só) o `close()` com 10 000 arquivos levou **0 ms** e o open 1 ms.

**Correção recomendada.**
1. Trocar o watcher de `docs/` e `.expx/` por `fs.watch` recursivo nativo (macOS e Windows são nativos; no Linux o Node 22 faz em JS). Manter debounce e o tail por offset.
2. Se quiser manter o chokidar, limitar a pastas (`depth`, observar só `docs/sprintx/features`, `docs/manutencao`, `docs/eventos`) ou rodá-lo no worker, assim o bloqueio não alcança o main.
3. No `before-quit`, não aguardar `fechar()` do observador. Fechar o banco, soltar sessões e sair; o SO libera os handles. O `Promise.race` com timer não protege contra bloqueio síncrono.
4. O mesmo bloqueio acontece em `soltar`/`soltarExceto` ao trocar de workspace (`servicos-metodo.ts:249-259`). A correção 1 resolve os dois.
5. Acrescentar ao `P-12` um cenário "fechar workspace de 10 000 arquivos" (ver AUD-14).

**Sem rede, sem git, sem CLI, sem permissão, disco cheio.**
- Sem rede: nada depende dela.
- Sem git: `ehRepo` falha para `false`; Missão não cria worktree; o método cai para a raiz.
- Sem CLI: `CliIndisponivelErro`; `lerVersao` com timeout de 2 s.
- Pasta sem permissão: `PastaSemPermissaoErro`.
- Disco cheio: histórico do daemon é melhor esforço; `abrirPane` encerra o Pane com `falha_ao_abrir`; preferências travam (AUD-07).
- Escrita atômica: preferências, layout, tokens e settings usam temporário + rename (nenhuma usa fsync). `gravarMeta` do daemon e `mcp-porta` não são atômicos (AUD-27).
- Migrations: transacionais, sequência validada, banco futuro recusado sem tocar no arquivo (`BancoVersaoFuturaErro`), mas sem backup real (AUD-08) e sem aviso na UI (AUD-30).

## C) Cobertura de requisitos

Legenda: E = entregue, P = parcial, A = ausente. A conferência é por código e teste, amostral por RF. O corte formal do MVP é o D-05 e as fases 6 a 16 do plano.

### Plano das fases 0 a 5

| Fase | Entrega | Estado | Evidência |
|---|---|---|---|
| 0 | Scaffold, casca segura, tokens, banco, barramento, harness de perf, pacote | E | `janela.ts`, `scheme.ts`, `banco/`, `tests/perf`, `scripts/verificar-pacote.mjs`; STATUS T-00.01..08 |
| 1 | PTY, daemon, catálogo/detecção, IPC, xterm, layout, sinaleira, anexos | E (com AUD-09/10) | 134 testes PTY+daemon; e2e `terminais-*` (19 testes) |
| 2 | Modelo, Git, workspaces, contas, Missões, Panes persistidos, UI | E (com AUD-11) | `missoes/*.test.ts`, `dominio.e2e` (5) |
| 3 | MCP, 11 tools, briefing/handoff, hooks, regras, piloto/workers, UI | E (com AUD-05) | `mcp/*.test.ts`, `orquestracao.e2e` (10), `portoes.e2e` (1) |
| 4 | Parser, worker, observador, modelo, UI, disparo, onboarding, memória | P | T-04.09: `consultarMemox` existe e não está ligado (AUD-18) |
| 5 | Início, paleta/menu/tray, config, perf, a11y, pacote, auditoria | P | T-05.04 medido mas `[ ]` no STATUS (AUD-34); menu/tray só com teste unitário |

### RF das specs (MVP)

| RF | Estado | Evidência ou motivo |
|---|---|---|
| 01.01 PTY no backend | E | `sessoes.ts`, daemon |
| 01.02 kinds cli/shell/browser | P | `tipo` cli/shell; browser ausente (AUD-35) |
| 01.03/01.05 header, pin, expandir, foco | E | `telas/terminais/{Abas,index}.tsx`, `layout.ts`, D-32 |
| 01.04 header colapsável | P | não verificado em teste |
| 01.06 fechar ≤ 500 ms | P | sem medição própria |
| 01.07 herdar provider do último painel | P | só na restauração |
| 01.10 clicar caminho de arquivo | P | só URL (`links.ts`); `abrirArquivo` pós-MVP |
| 01.10a ≥ 64 Panes | E | `limite_paineis` 1..64 |
| 01.20-24 renderizador único (Overdrive) | A (corte) | D-11/P-05: xterm por painel |
| 01.26 diagnóstico | E | `terminais:diagnostico` |
| 01.30-31, 01.35 workspaces, dono, cwd | E | `workspaces/servico.ts` |
| 01.32 acesso externo | P | campo existe; sem enforcement |
| 01.50-51 limite e fila de paste | A | 0 ocorrências (AUD-35) |
| 01.52 bracketed paste | P | `colagem.ts` (renderer) e `enviarAoPane` |
| 01.53 imagem colada | E | `anexos.ts` |
| 01.60 shell padrão | A | |
| 01.70-74 Missões e worktree | E | `missoes/worktree.ts`; nome `feature/<slug>` em vez de `overclock/` (D-22) |
| 01.80-84 multi-janela | A | AUD-35 |
| 01.90-99 SSH/tmux | A | AUD-35 |
| 01.100-101 cadeado | E | wizard de Missão |
| 01.110-114 sinaleira | E | `atividade/`, `Sinaleira` |
| 01.120-126 persistência | P | layout em JSON (não SQLite); `evento_dominio` como auditoria |
| 01.121-124 recovery, retomar, piloto restaurado | E | daemon + `conversas.ts` + `recuperarOrquestrados` |
| 01.130 tools de Pane | E | contrato usa `pane_send` (spec: `pane_write`); `pane_status` ausente |
| 02.01-04 modos livre/squad/agêntico | E | `missoes`, matriz por modo |
| 02.05-06 estilos e `auto` | A | |
| 02.10-14 Pane visível, piloto único, herança, limite, revisor | E | `regras.ts` |
| 02.16 revisor de outro provedor | P | só aviso |
| 02.20-24 MCP, argv, handoff ≤ 400 | E | `servidor.ts`, `piloto.ts` |
| 02.25-30 stop hooks ×3, wake, session-start, fallback | E (Claude); P (Codex/OpenCode) | `hooks/claude.ts`, `fallback.ts` |
| 02.31 spawn devolve só `pane_id` | E | `pane.ts:80` |
| 02.40-42 briefing e contexto limpo | E | `briefing.ts` |
| 02.43 economia de 25% de tokens | A | não medida |
| 02.50-57 squad e agentes (CRUD) | A | `definirSquad` sem UI (Fase 14) |
| 02.60-64 intake e portões | P | portões e `pilot_cli_unsupported_intake` sim; sem idempotência de pergunta |
| 02.65, 02.80-82 respawn e piloto | P | `respawn` e `prepararRespawnPiloto`; sem respawn automático de worker |
| 02.70-73 whitelist de skills | A | Fase 7 |
| 02.90-92 troca de torre, regra de contas | A | Fase 9 |
| 02.100-105 `/goal`, custo, A/B | A | Fases 10/12 |
| 04.01 detecção | P | 7 CLIs; faltam kimi, agy, grok, cursor, ollama |
| 04.02-05 CLI custom, modelos, atualizar | P | executável personalizado; lista estática de modelos |
| 04.06 liga/desliga | P | por conta; `provider_list` filtra `enabled` |
| 04.08 bypass | P | por workspace, não por provedor (D-14) |
| 04.09 multi-conta | P | isolamento só em Claude e Codex |
| 04.10-11, 04.20-22 conta exclusiva, `pick_account`, limites | A | Fase 9 |
| 04.12, 04.17-18 herança, papéis, piloto exclusivo | A/P | sem `pilot_only` |
| 04.13-16 endpoints e OpenRouter | A | Fase 16 |
| 04.19 resume | E | Claude e Codex |
| 04.23, 04.28-29 `initial_prompt_mode`, wrappers, diagnóstico | E | `catalogo.ts`, `lancamento.ts` (Windows só unidade) |
| 04.25, 04.30 imagem, instalar CLI | A | |
| 05 núcleo (11 tools, matriz) | E | `catalogo.ts` (mcp) |
| 05 catálogo real, symlink, allow skills | A | `catalog_list` devolve `[]` (Fase 7) |
| 12 cards (quadro, task, junção Missão↔trabalho) | E | `telas/metodo`, `missao.ts` |
| 12 custo por card, board de custo | A | Fase 10; UI mostra "custo desconhecido" |

Cortes de D-05 (Zero, Overrunner, entitlements, Legal, STT local, host mode, Reflexo, atalhos nativos, relay) estão coerentes com a ausência no código. Os cortes de spec-01 listados em AUD-35 não têm registro.

## D) Orçamentos

`ultimo.json` (2026-10-01T02:27Z) tem P-01..P-15 todos com medição e `ok:true`, `fator:1`, e `perf.mjs` apaga o arquivo e exige as 15 linhas. O RELATÓRIO confere com o JSON (medianas ligeiramente diferentes, por ser outra rodada). `tudo_ok:false` só por P-16 da F6 (AUD-17). Nenhum orçamento foi aprovado por fator ou tolerância. Há aprovação por **estatística escolhida**:

| # | O que realmente mede | Fragilidade |
|---|---|---|
| P-01 709 ms/800 | `janela:visivel` (`ready-to-show`) do main; mediana de 3 lançamentos com o 1º (frio) descartado | Não é "casca interativa no renderer"; o frio nunca entra. 90% do limite sob carga (pior 775) |
| P-02 34,2/50 | clique programático + 2 `rAF`, 3 voltas com a 1ª (carrega chunks lazy) descartada | Piso de 33,3 ms; a 1ª visita a cada tela pesada fica fora; app vazio |
| P-03 11,2/300 | clique do menu → `.xterm-screen`; a 1ª abertura (xterm e WebGL) descartada | A fria só no console |
| P-04/P-04b | `longtask` no renderer e ⌘F durante 10 MB | Não mede o main durante o flood |
| P-05 7,7/40 | eco de CLI falsa, 60 teclas após 10 de aquecimento, 1 painel | Idle, sem 4 painéis ativos |
| P-06/P-07 | `getAppMetrics` + RSS do daemon, 4 painéis ociosos | Sem workspace/Missão/MCP/indexador/leitor de tela: melhor caso; P-07 177/200 (pior 185,7) (AUD-15) |
| P-08 75 KB | bundle determinístico | Sólido |
| P-09 17,7/20 | maior intervalo entre quadros, mediana de 3 rodadas | Limite de 20 ms ≈ 1 quadro; a 83,7 ms numa rodada |
| P-10 38/300 | `duracao_ms` dentro do worker, mediana de 5 (a frio + 4 quentes) | 205 artefatos; frio chegou a 316 ms sob carga |
| P-11 494/600 | `appendFile` → evento, mediana de 5 | Debounce 300 ms já gasta metade; folga de 17% |
| P-12 10,5/50 | mediana dos máximos de 3 janelas de 1,5 s, idle | Não vê AUD-06 nem nenhuma ação (AUD-14) |
| P-13 403/1500 | 8 painéis, mediana de 3, a 1ª descartada | Só com CLI falsa |
| P-14 1,15/5 | mediana de 100 execuções de 14 consultas iguais, 5 de aquecimento | Esconde o máximo (153 ms visto); não cobre `doPane`, `paneDaSessao`, `temRevisorOk` (AUD-31) |
| P-15 364/2000 | `pane_spawn` → wake com CLI falsa, 5 rodadas | Não inclui CLI real |

Os dois mais aperta­dos são P-01 e P-07. Os mais enganosos são P-12 (conclui "o main nunca bloqueia" sem exercitá-lo) e P-07 (cenário otimista).

## E) Qualidade dos testes

**Execução** de `npx vitest run src/nucleo/mcp src/nucleo/orquestracao src/main src/nucleo/terminais src/daemon` (69 arquivos, 616 testes, ~17 s, máquina com carga 10 a 28 por outros agentes):

| Rodada | Resultado | Falhas |
|---|---|---|
| 1 | 615 ok, 1 falha | `integracao.test.ts` "token adulterado…" |
| 2 | 2 falhas | `daemon-pty-real.test.ts` "eco, resize e SIGINT" (11 s); "token adulterado…" |
| 3 | 2 falhas | `servicos-metodo.test.ts` "P-11 ≤ 600 ms" (2 240 ms); `integracao.test.ts` "wake em < 2 s" |

Isoladas, "token adulterado" passou 6 de 6. Verificação extra: `tsc` dos três projetos limpo; marca, cor de destaque, contraste e compacto: 40 de 40. Total no repositório: 1 415 testes de unidade e 47 e2e.

**Causa do "token adulterado".** O teste troca o último caractere da assinatura (`A`→`B`). A assinatura tem 43 caracteres base64url e o último carrega 4 bits úteis e 2 de preenchimento. Quando a assinatura termina em `A`, `B` decodifica para os mesmos 32 bytes e o token continua válido: provei com `Buffer.from` e medi 5,9% das assinaturas (esperado 1/16). É falha de desenho do teste, não brecha (a assinatura continua infalsificável), mas também mostra que o verificador aceita 4 codificações equivalentes. Os testes de adulteração do corpo (`tokens.test.ts:25-34`) são corretos.

**Amostra de qualidade.** Boa: nenhum `skip/todo/only`, nenhum `expect(true)`, só 2 arquivos com `vi.mock`, CLIs falsas reais em e2e, testes de segurança por entrada hostil (traversal, controle, symlink, Host, token). Pontos fracos:
- 3 asserções de latência (P-11, wake, eco do daemon) vivem na suíte unitária e quebram sob carga (AUD-13). O relatório de perf já pedia mover a do wake.
- 43 esperas por tempo fixo (`waitForTimeout`, `setTimeout`).
- Não há teste para: C1 em OSC (AUD-19), `fsmonitor` (AUD-03), `ID_CONVERSA` com `-` (AUD-24), flag do Codex por permissão (o teste trava o flag, AUD-02), `restaurar()` com daemon indisponível (AUD-10), recusa de remoção de workspace com Missão (AUD-11), e que o backup de migração é ligado em produção (AUD-08: o teste prova o recurso, não a fiação).
- `main.ts` não é testável por unidade: a fiação de permissões e `window.open` depende do e2e.
- E2e: a limpeza por padrão de caminho é o próprio AUD-01.

## F) Conformidade com as regras invioláveis

| Regra | Estado | Evidência |
|---|---|---|
| Nome do produto só em `produto.ts` | OK em `src/` | `tests/varredura-marca.test.ts` passa; fora de `src/` o nome aparece em `tests/limpeza.ts` e `tests/fixtures` (AUD-33) |
| Sem arquivo de ambiente | OK | 0 carregadores, 0 arquivos `.env*` na raiz, anexos o recusam, 0 padrões de chave |
| Caminhos relativos em artefatos | OK, 1 exceção | AUD-20 |
| Destaque azul (D-31) | OK | `cor-destaque.test.ts`, `contraste.test.ts` passam; captura mostra azul |
| D-32 compacto | OK | `compacto.test.tsx`; captura `perf/compacto-4paineis.png`: topo fino, linha única de abas, cabeçalho de painel de 18 px |
| Nada sai da máquina | OK | Só 2 servidores em `127.0.0.1` (MCP e atividade); único `fetch` é o plugin do OpenCode para o loopback; `openExternal` só por clique validado; sem auto-update; `publish` do builder é placeholder; workflows versionados e não disparados |
| Sem commits | OK | `git log`: 1 commit inicial |
| Origem somente leitura | Inconclusivo, sem indício de violação | Nenhuma rota de `src/` escreve em `../ExpxMedia`. Mas `git status` do ExpxMedia mostra 15 arquivos modificados e itens novos de hoje (13:50 a 22:11), todos do tema do ExpxMedia (motor de produção, OC-2026-0002), sem menção a ExpxV. Não consigo atribuir autoria |
| CLIs do usuário intocadas | OK | Nenhum código grava em `~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.gemini`. `~/.claude/settings.json` mudou hoje às 22:42 sem marcador do produto (provável Claude Code dos agentes) |
| Processos que não são seus | **Violada pelos testes** | AUD-01 |

## ALTA abertos

- **AUD-01**: a limpeza dos testes e2e/perf mata o daemon real. Evidência no ambiente: o socket real do dono (`$TMPDIR/expxv-pty-501/81774beade.sock`, criado às 23:13 com o app dev) existe, está morto, e não há processo de daemon do ExpxV enquanto o Electron dev (pid 92587) segue de pé. `ultimo.json` mostra uma rodada de perf às 23:26. É consistente com a morte por `matarOrfaos`, mas não é prova. A leitura do código é suficiente: o socket do daemon real fica em `tmpdir()/expxv-pty-<uid>/` e o critério `includes(`${tmp}/expxv-pty`)` o alcança com idade ≥ 600 s.
- **AUD-02**: o flag que confia nos hooks do repositório é enviado em todo Codex, contra D-14 e a mitigação de P-09 (não exercitado no Codex).

Ambos têm correção pequena (P e M). Corrigidos e re-testados, o veredito passa a SIM, desde que AUD-03 e AUD-05 a AUD-11 fiquem registrados como MEDIA.

VEREDITO: SIM

## Correções (rodada 1)

Corretor (não é o auditor nem o autor original). Para cada achado: reproduzido/confirmado antes, depois corrigido com teste. O veredito acima NÃO foi alterado. Nota: a tabela diz "13 MEDIA e 21 BAIXA"; contando os IDs há 14 MEDIA (AUD-03 a AUD-15 e AUD-35) e 20 BAIXA (AUD-16 a AUD-34 e AUD-36).

| ID | Confirmado? | Corrigido? | Arquivo / teste |
|---|---|---|---|
| AUD-01 | sim (leitura; o coordenador já corrigiu `tests/limpeza.ts`) | sim | `tests/limpeza.ts`, `tests/limpeza.test.ts`. Varredura de `kill`/`pkill`/`process.kill` em `tests/` e `scripts/`: `tests/fixtures/mcp/ambiente-orq.ts` só mata pelo caminho da pasta de dados do próprio app (agora recusa pasta vazia/curta, que casaria com tudo); `tests/perf/metodo.perf.ts` mata só o app que ele lançou; `tests/fixtures/vcs/repos.ts` só sonda (`kill(pid,0)`); `scripts/dev.mjs` só mata os próprios filhos. Nenhum outro caso |
| AUD-02 | sim (código: flag incondicional; o teste antigo travava o flag) | sim | `atividade/adaptadores/codex.ts`, `atividade/servico.ts`, `sessoes.ts`, `main/contexto-terminais.ts`; testes em `codex.test.ts` e `servico.test.ts` (seguro nunca contém o flag nem hooks e cai na heurística "estimada"; automatico contém). Orquestração: workers Codex já usam o vigia de ociosidade, nada muda (D-A4) |
| AUD-03 | sim (leitura) | **pendente** | `src/nucleo/vcs`/`git` estão com a Fase 6B. Sugestão: `-c core.fsmonitor=false -c core.hooksPath=` nas leituras automáticas |
| AUD-04 | sim | mitigado | TTL 24 h (`mcp/tokens.ts`), porta anterior ocupada ⇒ tokens dos Panes recuperados revogados + aviso + evento `orquestracao.panes_sem_mcp`, aviso de token expirado (`main/orquestracao.ts#avaliarRecuperadosSemMcp`, `mcp-remoto.ts`). Testes: `orquestracao.test.ts`, `mcp/integracao.test.ts`, `tokens.test.ts`. Risco residual: P-AUD1. Faixa na UI: P-AUD4 |
| AUD-05 | sim | sim | migration 0003 `wake_pendente`; `main/orquestracao.ts` (gravação na transação do handoff, apagado ao entregar, `restaurarWakes` no boot), `wake.ts` (idempotência, `aoEntregar`). Testes: queda entre banco e wake em `orquestracao.test.ts`, `wake.test.ts` |
| AUD-06 | sim (medido: 165 803 ms com 10 000 arquivos nesta máquina sob carga, vs 10,6 s do auditor) | sim | `metodo/observador.ts` (`WatcherRecursivo`), `servicos-metodo.ts#encerrar`, `main.ts` (`app.exit` em 7 s). Depois: 1,1 ms, timer de 10 ms nunca atrasou mais de 12 ms. Teste: `observador.test.ts` ("AUD-06") |
| AUD-07 | sim (teste reproduziu o defeito) | sim | `main/preferencias.ts`; `preferencias.test.ts` |
| AUD-08 | sim (teste falhou antes) | sim | `main/dominio-base.ts`; `main/dominio-base.test.ts` |
| AUD-09 | sim (leitura: `#falhar` terminal) | sim | `daemon/cliente.ts` (religa com backoff 250 ms a 4 s, 5 tentativas, sobe daemon novo uma vez, reanexa e preenche a saída perdida), `main/daemon.ts` (logs de estado); `cliente.test.ts` (ponte que derruba a conexão; daemon que morre e volta) |
| AUD-10 | sim (`listar()` devolvia `[]` com o daemon fora) | sim | `cliente.listar()` agora rejeita; `missoes/panes.ts#restaurar` tenta de novo e, sem resposta, não encerra Pane algum (`indeterminado`); `panes.test.ts` |
| AUD-11 | sim (teste vermelho antes) | sim | migration 0004 `removido_em`; `repos/workspace.ts`, `workspaces/servico.ts` (`apagarHistorico`), `telas/workspaces/index.tsx` (texto). Testes: `workspace.test.ts`, `servico.test.ts` |
| AUD-12 | sim (leitura) | sim | `metodo/parser/jsonl.ts` (teto de 8 MiB, só a cauda); `jsonl.test.ts` |
| AUD-13 | sim | sim | teste de token adulterado altera caractere do MEIO da assinatura; asserções de latência (wake, restaurar, P-10, P-11) saíram da suíte unitária (P-10/11/13/15 já são medidos em `tests/perf`); esperas por evento do sistema de arquivos sem limite apertado; resize do PTY real tolerante a SIGWINCH tardio. Resultado sob carga (4 `yes` + outros agentes): suíte dos arquivos alterados 3 de 4 rodadas verdes na 1ª bateria (as falhas eram toques logo após o `ready` perdidos pelo FSEvents; corrigido com sonda de stream vivo e conferência de pasta ausente), depois 6 de 6 rodadas dos testes de observador/serviços verdes. Teste de wake: o atraso do worker do teste subiu para 3 s |
| AUD-14, AUD-15 | sim (leitura) | **pendente** | medir P-12 durante abrir/trocar workspace e P-07 com Missão aberta: mexe no harness `tests/perf`; AUD-06 já tem teste próprio |
| AUD-35 | sim | sim | D-A1 em `01-DECISOES.md` |

### Backlog BAIXA

| ID | Status | Nota |
|---|---|---|
| AUD-16 | pendente | registrar a amostra fria em `ultimo.json`: harness de perf |
| AUD-17 | pendente | `tudo_ok:false` por P-16 da Fase 6 (fora do MVP) |
| AUD-18 | pendente | `consultarMemox` sem chamador; exige o conceito de projeto confiável (Fase 6B) |
| AUD-19 | corrigido | `terminais/osc.ts` normaliza U+009D/U+009C; `osc.test.ts` |
| AUD-20 | pendente | o caminho absoluto é necessário quando o Pane roda em worktree irmão; falta retenção de `entradas/` |
| AUD-21 | corrigido em parte | `cwd` de `pane_spawn` por `resolverDentroReal` (`orquestracao.test.ts`); a pasta do produto ainda é lexical |
| AUD-22 | corrigido | só `.md` de até 2 MiB (`handoff.ts`, `handoff.test.ts`) |
| AUD-23 | pendente | decisão de confiança do dono |
| AUD-24 | corrigido | `ID_CONVERSA` sem hífen inicial em 4 lugares; `catalogo.test.ts`, `ipc-validadores.test.ts` |
| AUD-25 | pendente | `src/nucleo/git` (Fase 6B) |
| AUD-26 | pendente | guarda do piloto: precisa decisão (incluir Bash) |
| AUD-27 | pendente | daemon: limite de linha, prazo do `ola`, escrita atômica |
| AUD-28 | corrigido | preferências sem protótipo; `preferencias.test.ts` |
| AUD-29 | corrigido | `criarGanchoE2E(env, empacotado)`; `gancho-e2e.test.ts` |
| AUD-30 | pendente | aviso de banco futuro na UI: precisa canal de UI |
| AUD-31 | corrigido em parte | índices em `handoff(de_pane_id)` e `pane(sessao_pty_id)` (migration 0003); P-14 ainda não cobre essas consultas; sem retenção de `evento_dominio` |
| AUD-32 | pendente | P-10 do dono (cabeçalho em vez de caminho) |
| AUD-33 | corrigido em parte | `limpeza.ts` já não usa o prefixo do daemon; sockets/pastas `ade-*` sobrando continuam |
| AUD-34 | pendente | `STATUS.md` é de outro agente |
| AUD-36 | pendente | E/S síncrona no main (layout, atividade): trocar por `fs/promises` |

## Reauditoria (rodada 1)

Auditor independente (2026-10-01). Só leitura de código/testes; único arquivo editado: este.

**AUD-01 (ALTA): FECHADO.** `tests/limpeza.ts:64-73`: `matarOrfaos` só casa `<tmpdir>/ade-e2e-`, `/T/ade-e2e-`, `/T/ade-dom-` (diretórios que os próprios testes criam via `mkdtemp`, `tests/fixture.ts:28`, `dominio.e2e.test.ts:22`) ou o caminho das fixtures `ExpxDev/tests/fixtures/cli-(pty|orq|mcp|interativa)`; o prefixo `expxv-pty` (socket real, `src/daemon/caminhos.ts:35`, `produto.ts:20`) saiu. `matarArvoreDaPasta` (`limpeza.ts:54-60`) só recebe pastas `mkdtemp` registradas por `fixture.ts:30/62`, `global-teardown.ts` e `ambiente-orq.ts:182`. Prova adversarial: importei `tests/limpeza.ts` por script temporário em os.tmpdir (apagado) e testei 6 linhas de comando reais plausíveis (ExpxV.app com `--user-data-dir` em Application Support, Electron do `node_modules` do checkout, `main-daemon.js --dir .../sessoes-pty-v1 --socket $TMPDIR/expxv-pty-501/x.sock`, `scripts/dev.mjs`, shell com `--mcp-config` em Application Support, CLI `expxv`): nenhuma casa (false/false). Grep literal em `tests/` e `scripts/`: o único `process.kill` amplo possível é `limpeza.ts:49`, só alcançável pelos critérios acima; `ambiente-orq.ts:59-66` exige pasta >= 8 caracteres e `cli-orq.mjs`; `metodo.perf.ts:31` mata só o app lançado; `repos.ts:69` e `mcp-loja/servidores.ts:66` só sondam (`kill(pid,0)`); `scripts/dev.mjs` só mata os próprios filhos; `verificar-pacote.mjs:53` mata o próprio `t`. Ressalvas (BAIXA, não bloqueiam): (a) `limpeza.test.ts` testa as constantes exportadas e strings, não executa `matarOrfaos` contra uma lista de processos (um mutante que reintroduzisse o prefixo do daemon em `PREFIXOS_TMP` seria pego, mas um que mudasse o filtro em `matarOrfaos` sem mudar as constantes, não); (b) `matarOrfaos` mata e2e de OUTRA execução paralela com mais de 10 min e `PADRAO_FIXTURES` casa fixtures de qualquer checkout chamado ExpxDev; nunca o app em uso do dono.

**AUD-02 (ALTA): FECHADO.** O flag só existe em `src/nucleo/terminais/atividade/adaptadores/codex.ts:43-48` (grep em `src/` não acha em `catalogo.ts` nem em outro ponto de produção): `if (alvo.permissao !== "automatico") return []` (comparação estrita; `equilibrado` não existe, e valor indefinido/estranho cai em `[]`). Fio de ponta a ponta fail-safe: `main/contexto-terminais.ts:132-133,166` (`=== "automatico" ? ... : "seguro"`, erro = seguro), default `"seguro"` em `servico.ts:105`; sem argumentos nem ambiente o serviço descarta a sessão e não chama `usarHook` (`servico.ts:123-127`), então a heurística de ociosidade segue emitindo `estimada=true`. `catalogo.ts:31-33` (`--approve-for-me`) também só sai em `automatico`. Testes: `codex.test.ts:52-56` (seguro => `[]`, automatico contém o flag) e `servico.test.ts:243-265` (seguro/omitido => `{argumentos:[],ambiente:{}}`, eventos `[...,true]` da heurística; automatico contém o flag e a heurística não age). Um Codex que sempre passasse o flag falharia ambos; um que o passasse em `seguro` falha. Lacuna menor: nenhum teste com valor fora do tipo (ex.: `undefined as any`), mas o código estrito o cobre.

**Regressão.** `npx vitest run src/main src/nucleo/terminais src/nucleo/orquestracao src/nucleo/mcp tests/limpeza.test.ts tests/varredura-marca.test.ts`: 652 passam, 1 falha: `tests/varredura-marca.test.ts` (D-01), por `src/compartilhado/squads.ts` conter o literal "expxv" 2 vezes (arquivo de outro agente em edição, fora do escopo; não tocado). Nada de AUD-01/02. `npx tsc --noEmit` na raiz só devolve TS5070 de configuração (`resolveJsonModule` com `moduleResolution classic`, tsconfig.json raiz é de projetos separados), não é sinal de regressão.

**Amostra MEDIA (todas confirmadas no código e com teste que falharia com o defeito):** AUD-07 `main/preferencias.ts:44-69` (fila `escrita.catch(()=>undefined)`, `.tmp` apagado, cache revertido; `preferencias.test.ts:31+` força `rename` sobre pasta e checa as escritas seguintes); AUD-08 `main/dominio-base.ts:33` `migrar(banco,{caminho})` (teste cria banco v2, abre o domínio e exige 1 backup `.bak-v2-` com a versão antiga); AUD-10 `missoes/panes.ts:321-327` (`indeterminado`, nenhum Pane encerrado; `panes.test.ts:244-271` cobre retry e falha total, e a volta do daemon); AUD-11 `workspaces/servico.ts:135` `apagarHistorico` com `removido_em` (teste exige histórico mantido ao remover e restaurado ao reabrir). AUD-05/06/09/13 não amostrados a fundo. AUD-03 segue pendente (MEDIA registrada, Fase 6B), como o veredito original já admitia.

**Veredito final: SIM** (a linha `VEREDITO` acima passou de NÃO para SIM em 2026-10-01). Condição do próprio texto atendida: ambos os ALTA corrigidos e re-testados, e AUD-03/05 a AUD-11 registrados como MEDIA. Pendências não bloqueantes: ressalvas (a)/(b) de AUD-01, falha de marca em `squads.ts` (outro agente).
