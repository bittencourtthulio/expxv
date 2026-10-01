# Fase 2 — Workspaces, Provedores e Missões

Objetivo: abrir um projeto, ver as CLIs e contas, criar Missões com worktree git e Panes
persistidos. Base: `base/A-…` (spec 04), `base/B-…` (spec 02), `05-CONTRATOS.md` §1.

**Portão da fase**: `npm run verificar` verde · e2e "abrir repo de fixture → criar Missão →
worktree criado → Pane abre no worktree → reiniciar app restaura" verde · `perf` P-13 mantido.

### T-02.01 · Modelo de dados e repositórios
- Arquivos: `src/nucleo/dominio/*.ts`, `src/nucleo/banco/migracoes/0002-dominio.ts`,
  `src/nucleo/banco/repos/{workspace,mission,pane,task,handoff,conta,config}.ts` + testes.
- Tabelas de `05-CONTRATOS.md` §1; `display_id` com sequência persistida (nunca reutilizado);
  fechar Pane + atualizar Mission em transação; ULID com prefixo; FTS não entra.
- Teste: `display_id` não volta após fechar; transação reverte em falha injetada; invariante
  "1 piloto por Mission"; `validada` sem handoff de revisor é rejeitada.
- Aceite: todas as consultas quentes ≤ 5 ms (P-14).
- Depende: T-00.05.

### T-02.02 · Serviço de Git
- Arquivos: `src/nucleo/git/{git,worktree,status}.ts` + testes com repositórios temporários.
- `git` sempre em processo filho **assíncrono** com timeout, saída limitada, sem shell;
  `ehRepo`, `raiz`, `branchAtual`, `statusResumo`, `worktreeList`, `worktreeAdd(-b)` com nome
  `../<repo>--<slug>`, `worktreeRemove`, `diffStat`. Sanitiza slug (minúsculas, sem acento,
  hifens). Nunca `push`, nunca força.
- Teste: cria/remove worktree em repo temporário; slug colide → sufixo; repo sujo → erro nominal;
  timeout respeitado.
- Aceite: nenhuma chamada bloqueia o event loop do main (P-12).
- Depende: T-00.01.

### T-02.03 · Workspaces
- Arquivos: `src/main/ipc/workspaces.ts`, `src/nucleo/workspaces/servico.ts`,
  `src/renderer/telas/workspaces/*` + testes.
- Abrir pasta (diálogo nativo **só pelo main**; gancho de teste substitui), detectar git, recentes,
  `acesso_externo` e `permissao` (D-14) por workspace, remover da lista (nunca apaga disco),
  listar worktrees. Workspace atual no topo da casca.
- Teste: pasta inexistente/sem permissão → erro nominal; recentes limitados a 20; trocar de
  workspace solta sessões (daemon) sem confirmar e com confirmação se não persistente.
- Aceite: abrir workspace de fixture leva ≤ 200 ms até a UI atualizar.
- Depende: T-02.01, T-02.02, T-01.04.

### T-02.04 · Provedores e contas
- Arquivos: `src/nucleo/provedores/{servico,contas}.ts`, `src/main/ipc/provedores.ts`,
  `src/renderer/telas/provedores/*` + testes.
- Lista de CLIs detectadas com versão (`--version` com timeout e sem efeito), estado, executável
  manual, diagnóstico copiável. Contas: rótulo + **config dir isolado por conta**
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) guardado como referência, nunca segredo; habilitar/desabilitar.
  Presença local não significa autenticação (a CLI cuida do login).
- Teste: versão com timeout; conta desabilitada some de `provider_list`; config dir é criado com
  modo 0700.
- Aceite: tela mostra claude/codex reais desta máquina e "não instalada" com instrução para as demais.
- Depende: T-01.03, T-02.01.

### T-02.05 · Missões
- Arquivos: `src/nucleo/missoes/{servico,estados,worktree}.ts`, `src/main/ipc/missoes.ts` + testes.
- Criar Missão `livre|squad|agentico` com `origem`; Missão com trabalho cria worktree
  (`feature/<slug>`, `fix/<OC-ID>-<slug>`, `chore/<OC-ID>-<slug>`) quando o workspace é git, uma
  Missão por árvore; máquina de estados (`intake → planejando → executando → revisando →
  concluida|falhou|abortada`); encerrar não apaga worktree sem confirmação; `brief/briefing`
  em `.expxv/missoes/<id>/`.
- Teste: estados inválidos recusados; 2ª Missão na mesma árvore recusada; worktree criado com o
  nome certo; abortar mantém worktree e registra.
- Aceite: criar Missão de feature em repo de fixture gera worktree e abre Pane nele.
- Depende: T-02.01, T-02.02, T-02.03.

### T-02.06 · Panes de Missão persistidos
- Arquivos: `src/nucleo/missoes/panes.ts`, integração em `src/main/ipc/terminais.ts` + testes.
- `abrirPane({missao, cli, papel, ...})` resolve `cwd` (worktree da Missão ou raiz), grava `pane`
  + `sessao`, liga ao daemon, restaura ao reabrir o app (Panes `pronto/trabalhando` religam;
  `encerrado` não). `respawn_de` preserva a linhagem; `display_id` novo; rótulo
  `#<display_id> · <CLI> · <papel> · <missão>`.
- Teste: restauração de 8 Panes; Pane cuja sessão morreu vira `encerrado` e sai do layout;
  `respawn_de` preenchido.
- Aceite: P-13 (8 painéis em ≤ 1,5 s).
- Depende: T-02.05, T-01.06.

### T-02.07 · UI de Missões
- Arquivos: `src/renderer/telas/missoes/{Lista,Criar,Detalhe}.tsx`, `src/renderer/estado/missoes.ts` + testes.
- Lista e detalhe (Panes, tasks, handoffs), wizard de criação (modo, origem, CLI/modelo por papel,
  "cadeado" para aplicar a mesma CLI em todos os papéis), estados vazios explicativos, virtualização
  acima de 100 itens, atualização por evento coalescido.
- Teste: RTL do wizard (validações, cadeado), lista virtualizada (nós no DOM ≤ janela + margem).
- Aceite: criar e abrir Missão sem tela branca; troca para Terminais em ≤ 50 ms.
- Depende: T-02.05, T-02.06, T-00.04.
