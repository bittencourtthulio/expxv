# Fase 6 — Versionamento total (Git, GitHub e SVN)

Pedido do dono: o foco do produto é desenvolvimento, então a integração com **Git, GitHub e SVN tem de
ser total**: o ADE precisa trabalhar muito bem com o versionamento do projeto. Esta fase é o **plano
detalhado**; a implementação vem logo depois do MVP (fases 0 a 5), nesta ordem: 6A → 6B → 6E parcial →
6C → 6D → 6E final. O que já existe do MVP (serviço de Git com worktrees, Missões com branch/worktree)
é a base e não é refeito.

**Princípios** (valem para as 40 tasks):
1. **Delegar ao que o usuário já tem configurado.** Usar os binários `git`, `gh` e `svn` da máquina e as
   credenciais que eles já guardam (credential helper, ssh-agent, `gh auth`, cache do svn). O ADE **nunca
   guarda, lê nem repassa token ou senha** (M14); nunca passa senha em argv.
2. **Nunca atrapalhar o usuário.** Comandos de leitura com `GIT_OPTIONAL_LOCKS=0` (`--no-optional-locks`)
   para não disputar `index.lock` com o git do próprio usuário; nada de hooks/config globais alterados;
   `GIT_TERMINAL_PROMPT=0` para nunca travar esperando senha.
3. **Seguro por padrão.** Nunca `push --force` automatizado; `--force-with-lease` só por ação manual com
   confirmação digitada e nunca na branch padrão; nunca `reset --hard`/`clean -fd`/`checkout .` sem
   confirmação e sem rede de segurança (descartar arquivo vai para a lixeira do sistema/`stash` de
   segurança, não apaga); automação do ADE nunca comita na branch padrão.
4. **Leveza e velocidade** (orçamentos P-16 a P-22 abaixo): tudo assíncrono, cancelável, em lote,
   virtualizado; status incremental por observador, nunca por varredura periódica ingênua.
5. **Um contrato, vários provedores.** Git e SVN atrás da mesma interface `Vcs` com *capabilities*; a UI
   pergunta "esta operação existe aqui?" e degrada com clareza (SVN não tem stage, stash nem worktree).
6. **O método continua dono do seu estado.** O ADE lê `docs/**` e dispara skills (D-04): PR da entrega
   passa preferencialmente pela mergex (`/expx:mergex-pr`); o ADE só abre PR nativamente quando a mergex não
   está instalada e nunca escreve em `docs/**`.

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`)

| # | O que | Orçamento |
|---|---|---|
| P-16 | Status incremental após mudar um arquivo (repo de 20 000 arquivos) | UI atualizada ≤ 600 ms (debounce incluso); comando de status ≤ 250 ms p95 |
| P-17 | Primeiro status de repo de 50 000 arquivos | não bloqueia a UI (estado "calculando"); ≤ 1 s; degrada para `-uno` acima de 2 s |
| P-18 | Diff de 10 000 linhas | primeiro quadro ≤ 100 ms; rolagem a 60 fps (só linhas visíveis no DOM) |
| P-19 | Histórico | 200 commits em ≤ 150 ms; 100 000 commits paginados sem travar |
| P-20 | Stage/unstage de hunk ou linha | ≤ 100 ms até a UI refletir |
| P-21 | Memória do estado VCS (repo de 50 000 arquivos) | ≤ 50 MB |
| P-22 | Fetch em segundo plano | no máximo 1 por vez, prioridade baixa, pausado com a janela sem foco, nunca > 50 ms de bloqueio do main |

## Arquitetura

```
src/nucleo/vcs/
  vcs.ts               interface Vcs + Capabilities + tipos comuns (Status, Mudanca, Diff, Commit, Ramo…)
  detectar.ts          git | svn | git-svn | nenhum; raiz; aninhados; worktrees; submódulos
  executor.ts          fila com concorrência, AbortSignal, timeout, streaming, limites, env limpo
  observador.ts        observa .git/{index,HEAD,refs,…} e a árvore (ignora .git, node_modules, dist)
  git/                 status (porcelain v2 -z), diff (stream + parser), stage/hunk, commit, ramos,
                       log/grafo, blame, stash, remotos, merge/rebase/cherry-pick, conflitos, reflog,
                       submódulos, LFS, worktrees
  svn/                 info, status --xml, diff, add/rm/mv/revert/resolve, commit, update, log --xml,
                       blame --xml, ramos/tags, switch, merge, isolamento de Missão, autenticação
  forge/
    forge.ts           interface Forge (PRs, checks, issues, reviews) — provedor plugável
    github.ts          implementação por `gh` (auth reaproveitada; GHE por hostname)
src/main/ipc/vcs.ts    canais vcs:* (validadores estritos; o renderer nunca envia caminho fora do workspace)
src/renderer/telas/versionamento/   tela compacta (Mudanças | Branches | Histórico | PRs | Conflitos)
```

Regras do executor (T-06.02): `execFile`/`spawn` sem shell; argumentos separados; `LC_ALL=C.UTF-8` e
`-c core.quotepath=false`; saída sempre com `-z` quando há caminhos; teto de saída com truncamento
explícito; timeout por tipo de comando; cancelamento ao trocar de workspace/fechar a tela; no máximo 4
processos simultâneos por workspace, 1 por operação que escreve; toda escrita em série (fila por repo).

## Tarefas

Formato: `T-06.NN · título` — entrega · aceite binário · depende. Todas seguem TDD (dois testes no mínimo)
e `npm run verificar` verde; as de UI herdam os orçamentos e o requisito D-32 (cromado mínimo).

### 6A — Fundação
- **T-06.01 · Interface `Vcs`, capabilities e detecção** — `vcs.ts`, `detectar.ts`. Detecta git, svn (`svn info --xml`), git-svn
  (`.git/svn`), repositório dentro de outro, worktrees e submódulos, sem executar nada fora do workspace.
  Aceite: fixtures de cada tipo detectadas; `capabilities` de SVN nega stage/stash/worktree; pasta sem VCS vira `nenhum`. · F2.
- **T-06.02 · Executor robusto** — `executor.ts`. Fila com concorrência, abort, timeout, streaming, limite de saída, env limpo.
  Aceite: cancelar mata o processo e a árvore dele; `index.lock` de outro processo vira erro nominal com nova tentativa;
  nenhuma chamada bloqueia o event loop (P-12). · —.
- **T-06.03 · Observador incremental** — `observador.ts`. Observa `.git/index`, `HEAD`, `refs/**`, `MERGE_HEAD`,
  `rebase-merge/`, e a árvore de trabalho com debounce de 200 ms; `.svn/wc.db` no SVN.
  Aceite: rajada de 500 toques = 1 atualização; mudar 1 arquivo em repo de 20 000 atualiza em ≤ 600 ms (P-16). · T-06.01.
- **T-06.04 · Cache e multi-worktree** — estado por (workspace, worktree); invalida por evento; libera ao fechar.
  Aceite: 3 worktrees do mesmo repo mostram estados independentes; memória dentro de P-21. · T-06.03.

### 6B — Git núcleo
- **T-06.05 · Status** — `status --porcelain=v2 --branch -z` (ahead/behind, renomeados, conflitos, não rastreados, ignorados
  opcionais); degrada para `-uno` em repo enorme. Aceite: P-17; todos os códigos XY de conflito mapeados. · T-06.02.
- **T-06.06 · Diff: parser e stream** — unified/`--word-diff`, renomeação/cópia, binário, modo de arquivo, fim de linha,
  submódulo; modelo de hunks. Aceite: parser tolerante (diff truncado nunca lança); P-18 no modelo. · T-06.02.
- **T-06.07 · Stage/unstage/descartar** — arquivo, hunk e linha (`git apply --cached` com patch gerado), ignorar, desfazer.
  Descartar vai para a lixeira/stash de segurança. Aceite: P-20; hunk parcial correto em arquivo com CRLF; descartar é recuperável. · T-06.05, T-06.06.
- **T-06.08 · Commit** — mensagem (modelo do repo, *conventional commits* opcional), amend só se não publicado, assinatura herdada,
  hooks com saída em streaming, `--no-verify` só com opt-in explícito e aviso, trailer de coautoria configurável.
  Aceite: hook que falha mostra a saída e não perde a mensagem; amend de commit já enviado é recusado. · T-06.07.
- **T-06.09 · Branches e tags** — listar (local/remoto, ahead/behind), criar, trocar (árvore suja: levar, stash ou cancelar),
  renomear, apagar (não mesclado pede confirmação), rastrear upstream, tags leves/anotadas.
  Aceite: trocar com mudanças conflitantes não perde nada; branch padrão detectada (`origin/HEAD`). · T-06.05.
- **T-06.10 · Histórico, grafo, blame** — `log` paginado com algoritmo de pistas (lanes), busca por texto/autor/caminho/`-S`,
  histórico de arquivo (`--follow`), `blame --porcelain -w`, detalhe do commit. Aceite: P-19; grafo correto em merge octopus. · T-06.02.
- **T-06.11 · Stash** — criar (com não rastreados opcional), listar, aplicar, pop, apagar, diff do stash. Aceite: pop com conflito não apaga o stash. · T-06.07.
- **T-06.12 · Remotos** — fetch (segundo plano, P-22), pull (`--ff-only` padrão; merge/rebase por escolha do repo), push
  (nunca `--force`; upstream automático; `--force-with-lease` só manual, confirmação digitada, nunca na padrão),
  múltiplos remotos, `GIT_TERMINAL_PROMPT=0`, erro de autenticação com instrução clara.
  Aceite: sem rede vira erro nominal sem travar; push rejeitado mostra o porquê e as opções seguras. · T-06.09.
- **T-06.13 · Merge, rebase, cherry-pick, revert e conflitos** — executar, estado da operação em curso
  (`MERGE_HEAD`, `rebase-merge`, `CHERRY_PICK_HEAD`), continuar/abortar/pular, parser de marcadores (diff3), resolução por hunk
  (nossa/deles/ambas/editar), marcar resolvido. Aceite: rebase com 3 conflitos em sequência resolvido só pela UI; abortar restaura o estado exato. · T-06.09.
- **T-06.14 · Reflog e desfazer** — visualizar reflog e "desfazer a última operação" só quando seguro.
  Aceite: desfazer um commit/merge recente volta ao ponto exato, sem perder mudanças não comitadas. · T-06.10.
- **T-06.15 · Submódulos, LFS, sparse, árvores parciais** — detectar e degradar com aviso claro (status/diff de submódulo,
  ponteiros LFS sem baixar objetos, sparse-checkout respeitado). Aceite: repo com submódulo e LFS não quebra nenhuma tela. · T-06.05.
- **T-06.16 · Worktrees avançado** — listar, criar, remover, `prune`, `repair`, `lock`, comparar com a base; ligado às Missões.
  Aceite: worktree órfão detectado e reparável; remover recusa árvore suja. · T-06.09.

### 6C — GitHub (via `gh`)
- **T-06.17 · Detecção e autenticação** — `gh` instalado?, `gh auth status` (conta ativa, hosts), remoto → `owner/repo`, GitHub
  Enterprise por hostname; sem `gh`: instrução de instalação e funcionamento degradado (só git). **Nunca lê o token.**
  Aceite: `gh` ausente ou deslogado vira estado claro com o próximo passo; múltiplas contas respeitam a ativa. · T-06.01.
- **T-06.18 · Pull requests** — listar (filtros), ver (corpo, arquivos, comentários, reviews, checks), criar (da Missão/branch,
  rascunho, revisores, labels, corpo a partir do `PR.md` do mergex quando existir), fazer checkout, atualizar branch,
  mesclar (merge/squash/rebase conforme o repo), fechar, marcar pronto, revisar, comentar (inclusive em linha).
  Aceite: ciclo completo contra um stub de `gh` com saídas JSON gravadas; erros de permissão/protegida explicam a causa. · T-06.17.
- **T-06.19 · Checks e Actions** — status dos checks do PR, execuções do workflow e logs em streaming (`gh run view --log`),
  re-executar falhos. Aceite: log de 50 MB exibido sem travar (paginado/virtualizado). · T-06.18.
- **T-06.20 · Issues e ponte com o método** — listar/ver/criar/comentar; **issue → Missão**: abrir um pedido (prodx) ou ocorrência
  (runx) com o texto da issue e o número como referência (`OC-…` ↔ `#123`); PR fecha a issue. Aceite: um clique cria a Missão certa e o comando do método correto. · T-06.18.
- **T-06.21 · Atualização inteligente** — polling só dos PRs de Missões ativas e dos abertos do usuário, somente com a janela em foco,
  backoff e respeito ao rate limit (`gh api rate_limit`), ETag quando possível. Aceite: nunca passa de 1 chamada por PR a cada 60 s; pausa sem foco. · T-06.18.
- **T-06.22 · Interface `Forge` e provedores futuros** — GitHub atrás da interface; GitLab (`glab`) e Bitbucket ficam como extensão
  documentada, sem implementar agora. Aceite: nenhuma tela importa `github.ts` diretamente. · T-06.18.

- **T-06.22b · Forges (P-12) — entregue na 6C** — `forge/` com GitHub (`gh`), GitLab (`glab api`), Bitbucket e Azure DevOps (REST, credencial do cofre injetada). **Pendências registradas:** (a) Bitbucket sem paginação e filtros de autor/branch/busca só no cliente; (b) Azure: arquivos do PR sem adições/remoções e issues (work items) fora; (c) ETag só no GitHub; (d) fiação main/IPC/UI (`abrirForge`, `AtualizadorPrs`, `issueParaPedido`) fica para 6E; (e) validação com `gh`/`glab` reais só por botão do usuário.

### 6D — SVN (via `svn`)
- **T-06.23 · Detecção, info e layout** — `svn info --xml`, raiz do working copy, URL do repositório, revisão, layout padrão
  (`trunk/branches/tags`) por `svn ls ^/`, externals. Aceite: saídas XML reais gravadas em `tests/fixtures/svn/` parseadas; `svn` ausente vira instrução (`brew install subversion`). · T-06.01.
- **T-06.24 · Status, diff e manutenção** — `status --xml` (`-u` opcional), `diff` unificado, add/rm/mv/copy, revert, resolve,
  cleanup, changelists, propriedades (`svn:ignore`, `needs-lock`). Aceite: P-16 em working copy de 20 000 arquivos; diff de propriedade exibido. · T-06.23.
- **T-06.25 · Commit, update, log, blame** — `commit -F <arquivo>` (mensagem UTF-8 por arquivo, não por argv), update com
  `--accept postpone` e fila de conflitos, `log --xml -v` paginado por `-r`, `blame --xml`. Aceite: commit de múltiplos arquivos e conflito de árvore tratados. · T-06.24.
- **T-06.26 · Branches, tags, switch e merge** — criar branch/tag por `svn copy` (**grava no servidor: pede confirmação**),
  `switch`, `merge` com `mergeinfo`, reintegração. Aceite: merge de branch para trunk com mergeinfo atualizado. · T-06.25.
- **T-06.27 · Isolamento de Missão sem worktree** — Missão de SVN = **cópia de trabalho irmã** `../<repo>--<slug>` (checkout do trunk/branch),
  sem branch no servidor por padrão; "criar branch no servidor" é ação explícita. Aceite: duas Missões trabalham em paralelo sem se tocar; remover a cópia nunca mexe no repositório. · T-06.26, F2.
- **T-06.28 · Autenticação segura** — `--non-interactive` sempre; credenciais do cache do svn; quando faltarem, abrir um Pane de terminal para
  o usuário se autenticar (nunca pedir senha na UI, nunca em argv; `--password-from-stdin` só se o usuário optar). Aceite: falha de auth não trava e explica o caminho. · T-06.25.
- **T-06.29 · Testes SVN sem `svn` instalado** — fixtures XML gravadas + executável `svn` falso; testes de integração REAIS (`svnadmin create`,
  `file://`) **só rodam se `svnadmin` existir** (pulam com aviso; CI instala). Aceite: suíte determinística sem svn; integração verde quando há svn. · T-06.23.
- **T-06.30 · git-svn** — detectar repositórios `git svn` e tratá-los como git, com `git svn rebase`/`dcommit` como ações explícitas e avisos. Aceite: detecção correta; nada de `dcommit` sem confirmação. · T-06.01.

### 6E — Integração e experiência
- **T-06.31 · Tela Versionamento** — compacta (D-32): uma linha de controles; abas Mudanças | Branches | Histórico | PRs | Conflitos;
  lista de mudanças agrupada (staged/não staged/não rastreados/conflitos) virtualizada; ações por ícone; atalhos (⌘Enter comita, ⌘⇧U desfaz stage…).
  Aceite: 5 000 arquivos alterados rolam a 60 fps; nenhuma ação de 1 clique destrói dados. · T-06.05, T-06.07.
- **T-06.32 · Visualizador de diff** — unified e lado a lado, ações por hunk/linha, binário/imagem (antes/depois), renomeação, alternar espaços em
  branco, palavra a palavra, realce de sintaxe em chunk lazy (tokenizador leve próprio; sem dependência pesada sem medir), 3-way para conflitos.
  Aceite: P-18; diff de 1 MB sem travar; teclado completo. · T-06.06.
- **T-06.33 · Decorações** — branch + sujo + ahead/behind no rótulo do painel, na aba do terminal, no seletor de workspace e no rodapé
  (texto curto, ícone pequeno). Aceite: troca de branch no terminal reflete na UI ≤ 600 ms. · T-06.03.
- **T-06.34 · Missão ↔ VCS** — emblema (branch/cópia de trabalho, sujo, ahead/behind, PR e checks), **commits por task** a partir do
  `ENTREGA.md` da mergex (clicar abre o diff do commit), diff da Missão contra a base, PR da Missão, isolamento por VCS (worktree no git,
  cópia de trabalho no SVN). Aceite: Missão de feature mostra exatamente os commits que a mergex registrou. · T-06.10, T-06.18, T-06.27.
- **T-06.35 · GitHub no método e no Início** — PRs abertos e checks falhando no Início; checks vermelhos tornam a sinaleira do trabalho
  amarela com o motivo em texto; "Abrir PR" dispara `/expx:mergex-pr <id>` no Pane (ou PR nativo quando não há mergex).
  Aceite: estado de PR consistente entre `ENTREGA.md` (disco) e GitHub; em conflito o disco é sinalizado como desatualizado, nunca reescrito. · T-06.18, T-06.34.
- **T-06.36 · Paleta e atalhos** — todos os comandos de versionamento na paleta (commit, trocar branch, fetch, pull, push, abrir PR, stash…). Aceite: cada comando disponível só quando faz sentido. · T-06.31.
- **T-06.37 · Guard rails e auditoria** — branch padrão protegida contra automação, confirmação por tipo de risco (digitar o nome da branch para
  ações destrutivas), registro de toda ação que escreve em `evento_dominio` (sem segredos), desfazer onde existir. Aceite: automação nunca comita na padrão; tabela de risco coberta por teste. · T-06.08, T-06.12, T-06.13.
- **T-06.38 · Passe de desempenho** — medir P-16 a P-22 em repositórios sintéticos grandes (gerador em `tests/fixtures/vcs/`), corrigir sem relaxar limite.
  Aceite: `docs/ade/perf/ultimo.json` com P-16..P-22 verdes. · 6B e 6E.
- **T-06.39 · E2E** — Electron real com repo git real: editar → stage por hunk → commit → branch → merge com conflito real resolvido pela UI →
  fetch/pull/push contra um remoto `file://` local; `gh` por stub; SVN por fake (e real se houver). Aceite: fluxo completo verde; zero diálogos nativos. · 6B, 6E.
- **T-06.40 · Auditoria da fase** — checklist de segurança (nada de token/senha em argv, log ou evento; nenhum comando destrutivo sem confirmação;
  nenhuma leitura com lock), revisão independente dos módulos de execução e de conflito; registrar em `docs/ade/AUDITORIA-VCS.md`. Aceite: sem achado ALTA aberto. · todas.

## Decisões específicas (registradas em `01-DECISOES.md`, D-33 a D-36)

- **D-33** Git/GitHub/SVN por binários da máquina, sem bibliotecas de Git em JS (isomorphic-git etc.): fidelidade total ao comportamento do `git` do
  usuário, credenciais e hooks dele, e zero peso extra no pacote.
- **D-34** GitHub só por `gh` (nunca por token próprio do ADE); GitHub Enterprise por hostname; GitLab/Bitbucket como extensão futura atrás de `Forge`.
- **D-35** SVN sem worktree: Missão = cópia de trabalho irmã; branch no servidor só por ação explícita e confirmada.
- **D-36** Nenhuma operação de escrita remota destrutiva pelo ADE sem confirmação digitada; automação nunca comita na branch padrão nem força push.

## Riscos e dependências externas

- `svn` não está instalado nesta máquina: testes determinísticos por XML gravado e executável falso; integração real só com `svn`/`svnadmin`.
- `gh` depende de o usuário ter rodado `gh auth login`; o ADE só orienta.
- Repositórios gigantes (monorepos): mitigados por `-uno`, fsmonitor do próprio git se o usuário já o habilitou (o ADE não altera config) e paginação.
- Windows: caminhos longos, CRLF e `taskkill /t`; cobertos em testes de unidade, sem máquina Windows nesta execução (D-26).
