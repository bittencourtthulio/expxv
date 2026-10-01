# Fase 4 — Método Expx de primeira classe

Objetivo: o ADE **enxerga** o que o `expxdev` grava e **dispara** as skills nos terminais, sem nunca
escrever estado do método. Base: `base/F-…` (inteiro), `05-CONTRATOS.md` §6, D-04, D-18 a D-22.

**Portão da fase**: `npm run verificar` verde · fixture de projeto Expx (sprintx + runx + prodx +
mergex + buildx, com YAML truncado e JSONL rotacionado) lida sem erro · e2e "tocar `tasks.md` →
card muda de coluna em ≤ 600 ms" verde · P-10 e P-11 medidos.

### T-04.01 · Parser tolerante
- Arquivos: `src/nucleo/metodo/parser/{frontmatter,kinds,veredito,jsonl,leitores}.ts` + testes com
  fixtures em `tests/fixtures/metodo/`.
- Frontmatter `expx_schema: 1` (+ leitores específicos: prodx `schema: expx-schema-v1`/`pd_id`;
  legadox/stackx por regex de `## FAIXA:`; `ENTREGA.md` com `expx_tool: runx`); chave extra aceita;
  `kind` desconhecido → `desconhecido`; YAML truncado → `null` (sem lançar); `VEREDITO:` por regex
  em `00-AUDITORIA.md`/`QA.md`; JSONL por offset de bytes, linha incompleta no fim adiada, leitura de
  `<id>.N.jsonl`; BOM tolerado; arquivo > 2 MB ignorado com aviso.
- Teste: um caso por kind do `F-…` §2; drift conhecido; arquivo truncado; JSONL com linha quebrada.
- Aceite: nunca lança exceção para entrada malformada.
- Depende: T-00.01.

### T-04.02 · Descoberta e worker de indexação
- Arquivos: `src/nucleo/metodo/{descoberta,indexador,worker}.ts`, `src/main/metodo.ts` + testes.
- Descobre trabalhos por **nome de arquivo** (lista do `F-…` §2.1) em `docs/sprintx/features/*`,
  `docs/<slug>/` (legado), `docs/manutencao/*`, `docs/produto/pedidos/*`, `docs/projeto/*`,
  `docs/entregas/*`, `docs/relatorios/*`; **um indexador por worktree** (`git worktree list`);
  roda em `worker_threads`; releitura total do projeto a cada mudança (as regras cruzam arquivos);
  ignora `node_modules`, `.git`, `dist`.
- Teste: 200 artefatos indexados em ≤ 300 ms (P-10); worktree novo entra no conjunto; arquivo
  removido some do modelo.
- Aceite: indexação nunca bloqueia o event loop do main (P-12).
- Depende: T-04.01, T-02.02.

### T-04.03 · Observador
- Arquivos: `src/nucleo/metodo/observador.ts` + testes.
- chokidar com debounce de 300 ms e `awaitWriteFinish`; observa `docs/**`, `docs/eventos/*.jsonl`,
  `.expx/hooks.json`, `.expx/expx-lock.json`, `.expx/memoria/indice.json`; tail de JSONL por offset;
  coalesce de rajadas; encerra ao fechar workspace.
- Teste: rajada de 50 toques vira 1 releitura; arquivo em escrita não é lido truncado; fechar
  workspace libera watchers (sem vazamento de handles).
- Aceite: mudança → `method.changed` em ≤ 600 ms (P-11).
- Depende: T-04.02.

### T-04.04 · Modelo derivado, violações e sinaleira
- Arquivos: `src/nucleo/metodo/{modelo,regras,sinaleira,grafo}.ts` + testes.
- `Trabalho → Sprint → Fase → Task` (`05-CONTRATOS.md` §6), estágio por disco (tabelas do `F-…`
  §1), violações (`teste_ausente`, `regressao_ausente`, `concluida_sem_verde`,
  `paralela_com_dependencia`, `sem_criterio_saida`, `dependencia_inexistente`, `ciclo_dependencia`,
  `estagio_incoerente`, `bloqueio_antigo`), sinaleira do trabalho (verde/amarelo/vermelho/cinza,
  regra do `F-…` §5.3), grafo do plano (`depende_de`, `paralelizavel`, caminho crítico CALCULADO,
  detecção de ciclo). O **disco vence o rastro**.
- Teste: tabela de cada violação; ciclo e dependência inexistente; sinaleira por cenário; caminho
  crítico em plano com 30 tasks.
- Aceite: modelo idêntico para fixture nova e para pasta legada `docs/<slug>/`.
- Depende: T-04.01.

### T-04.05 · UI do Método
- Arquivos: `src/renderer/telas/metodo/{Lista,Trabalho,Quadro,Grafo,Rastro,Violacoes}.tsx`,
  `src/renderer/estado/metodo.ts` + testes.
- Lista de trabalhos com estágio e sinaleira; detalhe com sprints/fases/tasks; **quadro de cards**
  por status (`pendente → em_andamento → concluida / bloqueada`) com `depende_de`; grafo em SVG
  leve (chunk lazy, sem biblioteca de grafos); rastro (JSONL) com filtro por agente/evento e
  virtualização; violações; tempo rotulado "duração observada" (nunca "esforço").
- Teste: RTL do quadro (colunas, bloqueio), grafo (ciclo destacado), rastro virtualizado (P-09).
- Aceite: 1 000 cards rolam a 60 fps com só os visíveis no DOM.
- Depende: T-04.04, T-00.04.

### T-04.06 · Disparo de comandos no Pane
- Arquivos: `src/nucleo/metodo/comandos.ts`, `src/main/ipc/metodo.ts` + testes.
- Mapa gesto → comando de `05-CONTRATOS.md` §6, **sempre com argumento**; prefixo por harness do
  Pane (`/expx:` no Claude Code; nenhum no OpenCode; CLI sem suporte → mensagem explicativa);
  `cwd` = worktree do trabalho; Pane `aguardando` não recebe reenvio; nunca dispara `mergex-revisar`,
  assinatura do prodx ou aprovação de raio ALTO (o botão leva ao arquivo).
- Teste: prefixo por harness; argumento obrigatório; ações humanas bloqueadas; reenvio negado.
- Aceite: "Avançar" em um trabalho digita `/expx:sprintx <slug>` no Pane certo.
- Depende: T-04.04, T-02.06.

### T-04.07 · Missão ↔ trabalho
- Arquivos: `src/nucleo/metodo/missao.ts`, integração com `missoes/servico.ts` + testes.
- Criar Missão "feature" → worktree + Pane + `/expx:sprintx <pedido>`; "ocorrência" →
  `/expx:runx <texto>`; "pedido" → `/expx:prodx-triar <texto>`; "projeto" →
  `/expx:buildx <descrição>`; descobrir depois o `trabalho_id` pelo disco e ligar à Missão;
  trabalho criado fora do ADE aparece como Missão "adotável". Avaliadores (F5/E4/mergex E3) abrem
  **Pane separado** (D-21).
- Teste: junção por `trabalho_id`; adoção de trabalho existente; avaliador em Pane distinto.
- Aceite: criar Missão de feature leva ao F1 do sprintx rodando no worktree.
- Depende: T-04.06, T-02.05.

### T-04.08 · Onboarding do projeto e hooks
- Arquivos: `src/nucleo/metodo/{instalacao,hooks}.ts`, `src/renderer/telas/metodo/Instalacao.tsx` + testes.
- Detecta `.expx/`, `expx-lock.json` (versões, `harness`), camadas instaladas, `docs/stack/
  CONVENCOES.md`, `docs/legado/PERFIL.md`, `docs/produto/PRODUTO.md`; mostra o que falta e o
  comando de cada camada (`/expx:onboarding`); lê `.expx/hooks.json` e mostra modos
  (`aviso|bloqueio|desligado`) **somente leitura**; alerta de incompatibilidade de `expx_schema`.
- Teste: projeto sem `.expx/` (estado da pasta desta instalação), com lock, com hooks.json ausente.
- Aceite: abrir este próprio repositório mostra as 9 skills do lock e o que falta (docs/, hooks.json).
- Depende: T-04.02.

### T-04.09 · Memória do método (leitura) e painel de saúde
- Arquivos: `src/nucleo/metodo/memox.ts`, `src/renderer/telas/metodo/Saude.tsx` + testes.
- Chama `python3 .claude/skills/memox/assets/memox.py estado|arquivo <caminho>` **se existir**
  (timeout 2 s, sem rede, sem escrita), exibe sinais por arquivo e a proporção de pedidos prodx que
  não viram trabalho; ausência do memox é estado normal, não erro.
- Teste: memox ausente; memox lento (timeout); saída inválida.
- Aceite: nunca trava a UI; erro vira aviso discreto.
- Depende: T-04.02.
