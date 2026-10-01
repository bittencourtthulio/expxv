# Fase 10 — Custo e board de cards

Objetivo: mostrar ao dev **quanto cada card, cada Missão, cada conta e cada modelo custaram**, lido do que as CLIs realmente gravaram (nunca do que o agente diz) e do
rastro do método, e dar a ele um **board de cards no estilo Overclick** que é a visão das tasks `T-NN.MM` do método com o custo observado ao lado. O board **não é um
servidor de tarefas**: o método continua dono do estado (D-04); o ADE lê o disco, cruza com o banco local e desenha. Base: `base/D-ecossistema.md` e `spec-12-overclick`
(card-contrato, custo por card, claim/handoff), `base/F-metodo-expxdev.md` (tasks e rastro), `base/C-…` (spec-14: custo congelado, `cost_kind`), `fase-04-metodo-expx.md` (modelo
derivado, rastro), `fase-02`/`fase-03` (Missões, tasks, handoff) e a **Fase 9** (tabelas de decisão, `LimitsService`, proxy OpenRouter, tela Consumo).

**Valor para o dev que usa o método Expx.** (1) Saber, por task do plano, quanto custou e com qual modelo ("a T-03.04 custou ≥ US$ 1,80 em 2 modelos"), sem confiar em autorrelato.
(2) Ver o trabalho inteiro num quadro: o que está pronto para começar, em andamento, em revisão, concluído e **validado** (verde = concluído, azul = validado), por Missão ou por trabalho.
(3) Planejar com histórico: "cards parecidos custaram em mediana US$ x" antes de delegar. (4) Delegar um card a um worker num clique, roteado pelo harness. (5) Ver o consumo por modelo,
workspace, Missão e Pane na tela Consumo e receber alerta quando uma Missão passa do teto que o dono definiu.

**Portão da fase** (todos obrigatórios):
- `npm run verificar` verde (tipos, testes, regra de marca, P-08, varredura de privacidade T-10.28).
- E2E no Electron real (T-10.31): CLIs falsas gravam transcript no formato do Claude e rollout no do Codex + proxy OpenRouter falso → o card mostra o custo certo; dois cards **sequenciais**
  no mesmo Pane recebem cada um só a sua janela; modelo sem preço ⇒ "≥"; card descartado preserva o custo; `handoff_submit` com um campo de custo inventado **não muda nada**.
- `npm run perf`: P-113 a P-117 verdes e P-01..P-22 e P-100..P-112 sem piora (board e chunk novo não estouram P-08).
- Auditoria de privacidade: nenhum **conteúdo** de transcript/rollout (texto de conversa, código, caminhos de arquivo do usuário) em banco, log, evento, argv ou IPC de saída; só tokens, modelo, instantes e ids.
- Registro em `STATUS.md` e `05-CONTRATOS.md`/`04-UI-UX.md`/`AGENTS.md` atualizados pelo coordenador (faz parte do fechamento).

## Princípios

1. **Leveza e velocidade acima de tudo.** Leitura de transcript em **worker thread**, incremental por *offset*, só de linhas novas; gravação em lotes curtos; custo **materializado** (agregados), nunca somado na hora
   sobre registros brutos; board montado por função pura, lista virtualizada, atualização por evento coalescido (P-113 a P-117).
2. **O app NÃO revende tokens e usa o login de cada CLI.** O custo mostrado é **"equivalente em API"** (estimativa por tabela de preços ou, quando a própria fonte o informa, o valor medido); numa assinatura
   ninguém é cobrado por token, e a UI diz isso. O ADE nunca cobra nem repassa nada.
3. **Custo desconhecido NUNCA vira zero.** `usd: null` (nenhum registro com preço), `incompleto: true` (algum sem preço ou sem fonte ⇒ "≥ US$ x") e `aproximado: true` (preço não confirmado ⇒ "≈") existem desde o contrato.
   "Custo desconhecido" é um texto da UI; `0` só aparece quando a soma medida é de fato zero.
4. **Nunca autorrelato (D-104).** Custo e tokens vêm **só** de: transcript/rollout que a CLI gravou, eventos `usage.observed` do proxy OpenRouter do ADE, banco local e rastro do método. Nenhuma tool MCP aceita
   campo de custo/tokens; o que o agente escrever no relatório não entra na conta.
5. **Segredos e conteúdo nunca em log.** Os transcripts contêm conversa e código: o leitor extrai **apenas** `modelo`, `timestamp`, `usage` e ids e descarta o resto na mesma linha; linha > 8 MB é pulada e contada;
   nada de conteúdo em erro, evento ou diagnóstico. Referência de arquivo é `base + relativo` (D-109), nunca caminho absoluto no banco.
6. **O método é dono do estado (D-04).** O board **lê** `docs/**` e `docs/eventos/*.jsonl` e **não escreve nada** neles; mover card não existe (o disco vence o rastro, D-19); ações do board são: abrir arquivo, abrir Pane,
   copiar comando do método e **delegar a worker** (que usa o mecanismo de tasks/handoff da Fase 3, no `.expxv/`). Aprovação, validação e merge continuam humanos (D-21).
7. **Nada sai da máquina.** Esta fase não faz rede. As fontes de uso são arquivos locais e eventos do proxy local; preços do OpenRouter já chegaram pela Fase 9 (por clique, com consentimento).
8. **Atribuição conservadora.** Uso que não se prova de um card vai para "sem card"; uso de janelas sobrepostas no mesmo Pane vai para "ambíguo"; o orquestrador (piloto) é custo da Missão, não de card (D-106).

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md` e aos P-100..P-112 da Fase 9)

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-113 | Ingestão inicial de 50 MB de transcript (~100 000 linhas) | ≤ 1,5 s no worker; main nunca > 50 ms (escrita em lotes ≤ 500 linhas/≤ 5 ms por transação); worker ≤ 60 MB acima da base (leitura por linha, sem carregar o arquivo) | `tests/perf/custo.perf.test.ts`: fixture gerada + monitor de event loop (P-12) + `process.memoryUsage` |
| P-114 | Linha nova no transcript/rollout → custo do card atualizado na UI | ≤ 700 ms (debounce 300 ms incluso); no máximo 1 releitura por fonte a cada 2 s | toque no arquivo falso + espera da UI (padrão P-11) |
| P-115 | Consulta materializada (card, Missão, trabalho, conta) e relatório agrupado de 30 dias sobre 100 000 registros | ≤ 5 ms / ≤ 30 ms | unidade com banco real (padrão P-14) |
| P-116 | Board com 1 000 cards: `montarBoard`; 1ª abertura; voltar à aba; rolagem; atualização de 1 card | ≤ 15 ms; ≤ 200 ms; p95 ≤ 50 ms (P-02); 60 fps; só o card alterado re-renderiza; DOM ≤ 200 nós; chunk ≤ 35 KB gz | Playwright + `PerformanceObserver` + contador de renders + contagem de nós + script de tamanho |
| P-117 | Memória do estado de custo e reindexação | renderer ≤ 5 MB; caches do main ≤ 20 MB com 100 000 registros (brutos só no SQLite); reindexar 30 dias ≤ 10 s em worker sem travar a UI | `process.getProcessMemoryInfo` + `longtask` |

Regras herdadas: `fs` assíncrono; nada síncrono no main depois do boot; debounce de 300 ms nos observadores; listas virtualizadas acima de 100 itens; IPC em lotes/coalescido; boot em duas ondas
(serviço de custo sobe na onda 2, em ocioso, e nunca antes da primeira pintura).

## Arquitetura

```
src/compartilhado/
  custo.ts             Tokens, CustoResumo, CustoMissao, EscopoCusto, LinhaRelatorio, Estimativa, FonteDeUsoEstado, Preco
  board.ts             ColunaBoard, CardBoard, CardDetalhe, BoardModelo, ProgressoBoard, FiltrosBoard
  ipc.ts               + canais custo:* e board:* (T-10.01)
src/nucleo/custo/
  precos.ts            tabela de preços: arquivo embutido + override do usuário + preços da API do OpenRouter; casamento por padrão (glob) e por data
  precos-padrao.json   entradas {padrao, familia, entrada_por_mtok, saida_por_mtok, cache_escrita_por_mtok?, cache_leitura_por_mtok?, moeda:"USD", confirmado:false, valido_desde}
  calcular.ts          registroParaUsd(tokens, modelo, ts, tabela) → {usd|null, origem, preco_id, aproximado} — puro
  leitores/            claude.ts (transcript JSONL) · codex.ts (rollout JSONL) · proxy.ts (eventos usage.observed) · leitor.ts (interface)
  fontes.ts            localiza as fontes de cada Pane (base+relativo), estado por fonte, offsets, rotação/truncamento
  ingestao.ts          orquestra: watchers → worker de leitura → lote de registros → transação curta → agregados
  worker.ts            worker thread: lê por offset, extrai só {ts, modelo, tokens, chave}, devolve lotes de ≤ 500 registros
  atribuicao.ts        atribuir(registros, janelas) — puro (D-106) + reatribuir(pane, desde)
  janelas.ts           janelas de task (banco: reivindicada→entregue; rastro: task_iniciada→task_concluida) — cache `janela_task`
  agregar.ts           agregados materializados e consultas (CustoResumo, relatório agrupado, estimativa histórica)
  servico.ts           ServicoCusto: eventos coalescidos, retenção, reprecificar, reindexar, diagnóstico, teto/alertas
src/nucleo/board/
  modelo.ts            montarBoard(entrada) → BoardModelo — puro (colunas, selos, progresso, agrupamento)
  coluna.ts            colunaDoCard(...) — a tabela de mapeamento (D-107), pura
  delegar.ts           delegarCard(...) — briefing a partir da task do método + spawn pelo Router (Fase 9)
  detalhe.ts           montarDetalhe(...) — contrato, dependências, janela, custo por modelo, Panes, handoff, rastro da task
src/nucleo/limites/adaptadores/estimado.ts     fonte "estimado" (tokens observados ÷ teto configurado por conta)
src/nucleo/mcp/tools/{task,custo}.ts           task_list, task_get, cost_report (somente leitura)
src/main/
  custo.ts             ligação: onda 2, ocioso; watchers com foco; worker; eventos → barramento/IPC
  board.ts             serviço do board (cache por versão; snapshot coalescido 300 ms; abrir arquivo restrito)
  ipc/{custo,board}.ts canais com validadores estritos
src/renderer/
  estado/{custo,board}.ts          stores mínimos (useSyncExternalStore), compartilhamento estrutural por chave de card
  telas/board/         (lazy) index.tsx · Colunas.tsx · CardLinha.tsx · Detalhe.tsx · Filtros.tsx · Progresso.tsx · Insights.tsx · Delegar.tsx · board.css
  telas/consumo/DetalhePorUso.tsx · FontesPrecos.tsx            (abas da tela Consumo da Fase 9)
  telas/missoes/Custo.tsx          (existente: passa a receber `CustoResumo`; "custo desconhecido" e "≥"/"≈")
tests/perf/custo.perf.test.ts · tests/custo.e2e.test.ts · tests/fixtures/{transcript-claude,rollout-codex,proxy-eventos}/
```

Fronteiras: `nucleo/custo/**` e `nucleo/board/**` não importam Electron (relógio, sistema de arquivos e notificação por injeção); `calcular.ts` e `atribuicao.ts` e `board/modelo.ts` são puros; **só** `leitores/` abre arquivos de CLI,
e só por `fontes.ts`; o worker só devolve `{ts, modelo, tokens, chave}` (teste confere que nenhum campo de conteúdo atravessa); o renderer nunca recebe caminho absoluto.

## Modelo de dados e migration

Migration `custo` — `src/nucleo/banco/migracoes/NNNN-custo.ts` (próximo número livre **depois** da migration `harness` da Fase 9; hoje `0004`); em transação; nunca em paralelo com outra migration.
Ids ULID com prefixo (`uf_`, `ur_`). Datas UTC ISO com ms. Booleano = `INTEGER 0/1`. Moeda canônica: **USD**.

```sql
ALTER TABLE task ADD COLUMN reivindicada_em TEXT;           -- preenchidas pelo repositório ao mudar `estado` (T-10.02)
ALTER TABLE task ADD COLUMN entregue_em TEXT;
CREATE TABLE preco_modelo (
  id TEXT PRIMARY KEY, padrao TEXT NOT NULL,                -- glob ("claude-opus-*") ou id exato ("vendor/modelo")
  familia TEXT, entrada_por_mtok REAL NOT NULL, saida_por_mtok REAL NOT NULL,
  cache_escrita_por_mtok REAL, cache_leitura_por_mtok REAL, -- NULL ⇒ derivado por razão documentada e marcado `aproximado`
  moeda TEXT NOT NULL DEFAULT 'USD' CHECK (moeda = 'USD'),
  origem TEXT NOT NULL CHECK (origem IN ('embutido','usuario','openrouter')),
  confirmado INTEGER NOT NULL DEFAULT 0 CHECK (confirmado IN (0,1)),
  valido_desde TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE INDEX ix_preco_padrao ON preco_modelo (padrao, valido_desde DESC);
CREATE TABLE uso_fonte (
  id TEXT PRIMARY KEY, cli TEXT NOT NULL, conta_id TEXT REFERENCES conta(id) ON DELETE SET NULL,
  pane_id TEXT REFERENCES pane(id) ON DELETE SET NULL, mission_id TEXT, workspace_id TEXT,
  base TEXT NOT NULL CHECK (base IN ('claude_config','codex_home','proxy')),    -- referência, nunca caminho absoluto (D-109)
  relativo TEXT NOT NULL,                                                       -- relativo à base; vazio para proxy
  offset INTEGER NOT NULL DEFAULT 0, tamanho INTEGER NOT NULL DEFAULT 0, mtime_ms INTEGER, inode TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('lendo','sem_fonte','erro','encerrada')), erro_codigo TEXT,
  linhas_puladas INTEGER NOT NULL DEFAULT 0, ultima_leitura_em TEXT, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE UNIQUE INDEX ux_uso_fonte ON uso_fonte (base, COALESCE(conta_id,''), relativo) WHERE relativo <> '';
CREATE INDEX ix_uso_fonte_pane ON uso_fonte (pane_id);
CREATE TABLE uso_registro (                                 -- bruto: retenção 90 dias; o agregado é permanente
  id TEXT PRIMARY KEY, fonte_id TEXT NOT NULL REFERENCES uso_fonte(id) ON DELETE CASCADE,
  chave TEXT NOT NULL,                                      -- id da mensagem (Claude) ou ordinal+instante (Codex) ⇒ idempotência
  ts TEXT NOT NULL, modelo TEXT,                            -- NULL ⇒ sem preço (nunca chute)
  tokens_entrada INTEGER NOT NULL DEFAULT 0, tokens_cache_escrita INTEGER NOT NULL DEFAULT 0,
  tokens_cache_leitura INTEGER NOT NULL DEFAULT 0, tokens_saida INTEGER NOT NULL DEFAULT 0,
  usd REAL,                                                 -- NULL = desconhecido (sem preço); congelado na ingestão
  usd_origem TEXT NOT NULL CHECK (usd_origem IN ('cli','proxy','tabela','desconhecido')),
  preco_id TEXT, aproximado INTEGER NOT NULL DEFAULT 0 CHECK (aproximado IN (0,1)),
  pane_id TEXT, mission_id TEXT, workspace_id TEXT, conta_id TEXT, trabalho_id TEXT, task_id TEXT,
  atribuicao TEXT NOT NULL CHECK (atribuicao IN ('card','orquestracao','sem_card','ambigua')),
  UNIQUE (fonte_id, chave));
CREATE INDEX ix_uso_ts ON uso_registro (ts);
CREATE INDEX ix_uso_pane_ts ON uso_registro (pane_id, ts);
CREATE INDEX ix_uso_card ON uso_registro (workspace_id, trabalho_id, task_id);
CREATE TABLE janela_task (                                  -- cache das janelas [início, fim] de cada task (banco e rastro)
  workspace_id TEXT NOT NULL, trabalho_id TEXT NOT NULL, task_id TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('banco','rastro')), pane_id TEXT, cwd_rel TEXT,
  inicio TEXT NOT NULL, fim TEXT,                           -- fim NULL = em andamento
  PRIMARY KEY (workspace_id, trabalho_id, task_id, origem, inicio));
CREATE TABLE custo_agregado (                               -- permanente; atualizado na mesma transação da ingestão
  escopo TEXT NOT NULL CHECK (escopo IN ('card','missao','trabalho','workspace','conta','pane')),
  chave TEXT NOT NULL,                                      -- card: "<workspace>|<trabalho>|<task>"; demais: id
  dia TEXT NOT NULL, modelo TEXT NOT NULL DEFAULT '',       -- '' = modelo desconhecido
  atribuicao TEXT NOT NULL DEFAULT 'card',
  registros INTEGER NOT NULL DEFAULT 0, registros_sem_preco INTEGER NOT NULL DEFAULT 0, registros_aproximados INTEGER NOT NULL DEFAULT 0,
  tokens_entrada INTEGER NOT NULL DEFAULT 0, tokens_cache_escrita INTEGER NOT NULL DEFAULT 0,
  tokens_cache_leitura INTEGER NOT NULL DEFAULT 0, tokens_saida INTEGER NOT NULL DEFAULT 0,
  usd_conhecido REAL NOT NULL DEFAULT 0,                    -- soma só do que tem preço
  PRIMARY KEY (escopo, chave, dia, modelo, atribuicao)) WITHOUT ROWID;
CREATE TABLE custo_teto (mission_id TEXT PRIMARY KEY REFERENCES mission(id) ON DELETE CASCADE,
  teto_usd REAL NOT NULL CHECK (teto_usd > 0), alertado_em TEXT);
```
Fora do banco: `config` — `custo` (`cambio_brl: number|null` (manual; só para exibição "≈ R$"), `alertar_preco_ausente: true`, `teto_padrao_missao_usd: null`, `ler_transcripts: true`, `retencao_bruta_dias: 90`).
`task.reivindicada_em`/`entregue_em` são escritos pelo repositório de `task` na transição de `estado` (`aberta→reivindicada`, `→entregue`); linhas antigas ficam `NULL` (sem janela ⇒ uso vai para "sem card").
`preco_modelo` recebe, sem rede, as entradas de `precos-padrao.json` (origem `embutido`, `confirmado:false`) e, quando a Fase 9 atualiza a lista do OpenRouter, uma entrada por modelo com preço informado pela API (origem `openrouter`, `confirmado:true`, **exata**: custo por token × 1e6).
**Em dúvida sobre um preço, a entrada é omitida:** `null` é honesto, número inventado não (P-39).

## Contratos novos (o coordenador os adiciona em `src/compartilhado/` e em `05-CONTRATOS.md`)

```ts
// src/compartilhado/custo.ts — identificadores de domínio em PT (UI/IPC internos); a tradução para o MCP (inglês) é feita nas tools
export interface Tokens { entrada: number; cache_escrita: number; cache_leitura: number; saida: number }
export interface CustoResumo {
  usd: number | null;                // soma do que tem preço (limite inferior); null = nenhum registro tem preço
  incompleto: boolean;               // há registro sem preço ou Pane sem fonte ⇒ exibir "≥ US$ x"
  aproximado: boolean;               // algum preço não confirmado/derivado ⇒ exibir "≈"
  tokens: Tokens; registros: number; modelos: string[];
  fontes_ausentes: string[];         // ex.: "sem_fonte:gemini" — CLI sem leitor de uso (nunca vira 0)
  atualizado_em: string | null;
}
export interface CustoMissao extends CustoResumo { orquestracao: CustoResumo; cards: CustoResumo; sem_card: CustoResumo; ambiguo: CustoResumo }
export type EscopoCusto = "card" | "missao" | "trabalho" | "workspace" | "conta" | "pane";
export type AgruparCusto = "card" | "missao" | "trabalho" | "workspace" | "conta" | "modelo" | "pane" | "dia";
export interface LinhaRelatorio { chave: string; rotulo: string; custo: CustoResumo }
export interface Estimativa { mediana_usd: number | null; p25_usd: number | null; p75_usd: number | null; amostras: number; confianca: "sem_historico" | "baixa" | "media" | "alta" }
export interface FonteDeUsoEstado { pane_id: string | null; cli: string; estado: "lendo" | "sem_fonte" | "erro" | "encerrada"; erro_codigo: string | null; atraso_s: number | null; linhas_puladas: number }
export interface Preco { id: string; padrao: string; familia: string | null; entrada_por_mtok: number; saida_por_mtok: number; cache_escrita_por_mtok: number | null; cache_leitura_por_mtok: number | null;
  origem: "embutido" | "usuario" | "openrouter"; confirmado: boolean; valido_desde: string }

// src/compartilhado/board.ts
export type ColunaBoard = "backlog" | "a_fazer" | "em_andamento" | "em_revisao" | "concluido" | "validado";
export type SeloCard = "pronta" | "bloqueada" | "violacao" | "descartada" | "delegada";
export interface CardBoard {
  chave: string;                     // "<workspace_id>|<trabalho_id>|<task_id>"
  task_id: string;                   // T-NN.MM
  trabalho_id: string; trabalho_titulo: string; workspace_id: string; fase: string | null; titulo: string;
  coluna: ColunaBoard; selos: SeloCard[]; depende_de: string[]; suite: "verde" | "vermelha" | "parcial" | "nao_executada";
  mission_id: string | null;
  executor: { pane_id: string; cli: string; modelo: string | null; conta_rotulo: string | null } | null;
  handoff_status: "ok" | "parcial" | "bloqueado" | "falhou" | null;
  duracao_observada_ms: number | null;
  custo: { usd: number | null; incompleto: boolean; aproximado: boolean };      // resumo leve (o completo vem no detalhe)
}
export interface ProgressoBoard { total: number; descartado: number; concluido: number; validado: number; pct_concluido: number; pct_validado: number }
export interface BoardModelo { versao: number; gerado_em: string; colunas: Record<ColunaBoard, CardBoard[]>; progresso: ProgressoBoard;
  trabalhos: Array<{ trabalho_id: string; titulo: string; mission_id: string | null; progresso: ProgressoBoard; custo: CustoResumo }>; custo: CustoResumo }
export interface FiltrosBoard { workspace_id: string | null; trabalho_ids?: string[]; mission_id?: string; colunas?: ColunaBoard[]; selos?: SeloCard[];
  modelo?: string; com_custo?: boolean; busca?: string; agrupar?: "nenhum" | "trabalho" | "fase" }
export interface CardDetalhe { card: CardBoard; contrato: { objetivo: string | null; criterio_aceite: string | null; teste_integracao: string | null; teste_funcional: string | null; teste_regressao: string | null };
  janela: { inicio: string; fim: string | null; origem: "banco" | "rastro" } | null; violacoes: string[];
  custo: CustoResumo; custo_por_modelo: Array<{ modelo: string | null; tokens: Tokens; usd: number | null; origem: "cli" | "proxy" | "tabela" | "desconhecido"; aproximado: boolean }>;
  panes: Array<{ pane_id: string; cli: string; modelo: string | null; conta_rotulo: string | null; papel: string }>;
  handoffs: Array<{ id: string; status: string; resumo: string; criado_em: string }>; rastro: Array<{ ts: string; evento: string; detalhe: string }>;
  arquivo_task: string | null /* relativo ao worktree; só para board:abrir_arquivo */ }
```
**Mapeamento de coluna (D-107; primeira regra que casa — o disco vence o banco):**

| # | Condição | Coluna | Observação |
|---|---|---|---|
| 1 | task `descartada` no banco | (oculta; selo `descartada`) | só aparece no filtro "descartados"; **custo preservado** |
| 2 | banco `validada` **ou** (task `concluida` no disco e o trabalho tem veredito de QA/auditoria `aprovado\|sim`) | `validado` (azul) | validação é humana/avaliador (D-21); o ADE só reflete |
| 3 | task `concluida` no disco **e** banco `entregue` sem revisor | `em_revisao` | handoff ok esperando `revisor` |
| 4 | task `concluida` no disco | `concluido` (verde) | |
| 5 | task `em_andamento` no disco **ou** banco `reivindicada` | `em_andamento` | |
| 6 | task `bloqueada` | `backlog` + selo `bloqueada` | com o texto do bloqueio no detalhe |
| 7 | task `pendente` e todas as `depende_de` concluídas | `a_fazer` + selo `pronta` | |
| 8 | task `pendente` com dependência aberta | `backlog` | |
Selos extras: `violacao` (a task tem violação do modelo do método), `delegada` (existe linha em `task` do banco aberta/reivindicada).

### Canais IPC (lista fechada; validador estrito por canal; o renderer nunca envia caminho absoluto)

| Canal | Tipo | Entrada → saída |
|---|---|---|
| `custo:resumo` | invoke | `{escopo: EscopoCusto, chave}` → `CustoResumo` (escopo `missao` devolve `CustoMissao`) |
| `custo:relatorio` | invoke | `{agrupar: AgruparCusto, desde, ate, filtros?:{workspace_id?, mission_id?, trabalho_id?, conta_id?, modelo?}, cursor?, limite≤200}` → `{linhas: LinhaRelatorio[], total: CustoResumo, proximo}` |
| `custo:estimativa` | invoke | `{task_type?, trabalho_id?, task_id?}` → `Estimativa` |
| `custo:fontes` | invoke | `{workspace_id?}` → `FonteDeUsoEstado[]` |
| `custo:precos_listar` / `custo:preco_gravar` / `custo:preco_apagar` / `custo:reprecificar` | invoke | `{}` → `Preco[]`; `{padrao, entrada_por_mtok, saida_por_mtok, cache_*?}` (origem `usuario`); `{id}` (só `usuario`); `{desde?}` → `{registros_reprecificados}` (explícito; nunca automático) |
| `custo:config_ler` / `custo:config_gravar` | invoke | `{}` ↔ `{cambio_brl, alertar_preco_ausente, teto_padrao_missao_usd, ler_transcripts, retencao_bruta_dias}` ; `custo:teto_gravar` `{mission_id, teto_usd\|null}` |
| `custo:reindexar` / `custo:diagnostico` | invoke | `{workspace_id?}` → `{iniciado}` (job em worker; progresso por evento); `{}` → `{texto}` copiável **sem conteúdo** |
| `custo:evento` | evento | `{tipo: "atualizado", escopos: Array<{escopo, chave}>}` (coalescido ≤ 1 / 300 ms) · `{tipo: "teto", mission_id, usd, teto_usd}` · `{tipo: "fonte_ausente", pane_id, cli}` |
| `board:snapshot` | invoke | `{filtros: FiltrosBoard}` → `BoardModelo` (função pura no main; cache por `versao`) |
| `board:card_detalhe` | invoke | `{workspace_id, trabalho_id, task_id}` → `CardDetalhe` |
| `board:abrir_arquivo` | invoke | `{workspace_id, trabalho_id, task_id}` → `{ok}` — abre o arquivo da task no editor padrão; o main resolve o caminho; só `.md\|.json\|.jsonl\|.yaml` sob `docs/` do worktree do trabalho |
| `board:delegar_card` | invoke | `{workspace_id, mission_id, trabalho_id, task_id, confirmar: true}` → `{pane_id, task_ref, recibo}`; erros `rule_violation` (`not_in_mission`, `limit_reached`), `conflict` (já delegada), `not_found` |
| `board:evento` | evento | `{versao}` (coalescido ≤ 1 / 300 ms; o renderer chama `board:snapshot` e troca só as colunas cujos cards mudaram) |

### Eventos de domínio (barramento interno)
`cost.updated{escopos}` (já previsto em `05-CONTRATOS.md` §7 como pós-MVP: passa a existir), `cost.ceiling_reached{mission_id}`, `usage.source_missing{pane_id, cli}`, `board.changed{versao}`.
Entrada da Fase 9: `usage.observed{pane_id, provedor:"openrouter", modelo, tokens_in, tokens_out, usd|null, ts}` (proxy) — fonte de uso `proxy`, **medida**.

### Tools MCP (somente leitura; nomes em inglês `snake_case`; identidade e escopo vêm do token — a Missão do token, nunca outra)

| Tool | Entrada | Saída / erros |
|---|---|---|
| `task_list` | `{project?: string /*trabalho_id*/, status?: "backlog\|todo\|in_progress\|review\|done\|validated", limit?≤50, cursor?}` | lista **leve** `{task_id, title, column, ready, cost:{usd\|null, incomplete}}` do trabalho da Missão (ou do pedido, dentro do workspace do token) |
| `task_get` | `{task: "T-NN.MM", project?}` | completo: contrato (objective, acceptance, tests), `depends_on`, `window`, `cost` por modelo, panes, handoffs; erro `not_found` |
| `cost_report` | `{group_by: "task\|model\|account\|pane\|day", from?, to?}` | `{rows:[{key, usd\|null, incomplete, approximate, tokens_in, tokens_out}], total}` **da Missão do token**; sem campo para escrever custo |

Listar e obter são tools separadas para poupar contexto (spec-12 RF "listagem leve"). Matriz (em `src/nucleo/mcp/catalogo.ts`): **livre** — nenhuma; **squad** — `task_list`, `task_get`, `cost_report`; **agêntico** — as três; **workers** — continuam só `handoff_submit`.
**`handoff_submit` não ganha campo de custo**: se o agente enviar `cost`/`tokens`, o campo é ignorado (teste), e a conta continua sendo a da fonte.

## Tarefas

Formato: `T-10.NN · título` — entrega · aceite binário · depende. Todas seguem TDD (no mínimo um teste de caminho feliz e um de borda/erro) e `npm run verificar` verde; as de UI herdam os orçamentos e o requisito D-32 (cromado mínimo). Áreas de arquivo disjuntas entre colchetes.

### 10A — Fundação do custo  [A: `src/nucleo/custo/**` (exceto leitores/ingestão), `src/nucleo/banco/repos/{preco,uso,custo-agregado}.ts`] [B: `leitores/`, `fontes.ts`, `ingestao.ts`, `worker.ts`] [M: `src/main/{custo,ipc/custo}.ts`]

- **T-10.01 · Contratos e tipos** — `src/compartilhado/{custo,board}.ts`, canais `custo:*`/`board:*` em `ipc.ts`, validadores estritos em `src/main/ipc/{custo,board}.ts` (só validador), espelho inline no preload (D-30) + teste de paridade. Testes: cada validador recusa campo extra, tipo errado, escopo desconhecido, caminho absoluto, `limite > 200`, `teto_usd ≤ 0`, `confirmar` ausente. Aceite: `npm run typecheck` e a paridade preload↔`ipc.ts` verdes; nenhum canal sem validador; nenhum tipo exporta campo de conteúdo de conversa. · F3, T-09.01.
- **T-10.02 · Migration `custo` e repositórios** — `NNNN-custo.ts` + repos `{preco,uso-fonte,uso-registro,janela-task,custo-agregado,custo-teto}.ts` + ajuste de `repos/task.ts` (grava `reivindicada_em`/`entregue_em` na transição de `estado`, sem mudar a API). Aceite: aplica em banco vazio e em banco da Fase 9 com dados; unicidade `(fonte_id, chave)` e `UNIQUE` de fonte cobertas; inserção idempotente (2× o mesmo lote = 1 linha); transição de task grava os instantes; consulta quente ≤ 5 ms (P-14). · T-10.01, T-09.02.
- **T-10.03 · Tabela de preços** — `custo/{precos,calcular}.ts` + `precos-padrao.json`. Casamento do modelo por **padrão mais específico** (glob, depois exato) e por `valido_desde ≤ ts`; override do usuário vence o embutido; preços do OpenRouter (Fase 9) entram como `openrouter/confirmado`; `registroParaUsd(tokens, modelo, ts, tabela)` → `{usd|null, origem, preco_id, aproximado}`: modelo desconhecido ⇒ `usd:null`; preço sem tarifa de cache ⇒ derivado por razão documentada no arquivo **e** `aproximado:true`; entrada omitida em caso de dúvida (P-39).
  Aceite: tabela de 30 casos (família com versão nova casa pelo glob; modelo sem entrada ⇒ `null`; override do usuário; preço mudou depois do registro ⇒ custo **congelado** não muda sem `reprecificar`; cache derivado ⇒ `aproximado`); nenhum caminho devolve `0` por omissão; `0` só se os tokens são 0. · T-10.01.
- **T-10.04 · Leitor de transcript do Claude** — `leitores/claude.ts`. JSONL por linha: aceita `type:"assistant"` com `message.usage` (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`), `message.model`, `timestamp`; **deduplica por `message.id`** (o Claude Code grava uma linha por bloco de conteúdo com o mesmo id e o mesmo `usage`: conta **uma vez**, o maior valor); usa `costUSD` da linha **quando existir** (`usd_origem:"cli"`); inclui `subagents/agent-*.jsonl` (mesmo Pane); extrai **só** `{ts, modelo, tokens, chave, usd?}` e descarta o resto; linha > 8 MB é pulada e contada; última linha incompleta é ignorada até o próximo ciclo; formato **a verificar na CLI instalada** (contrato por fixture; campo ausente ⇒ registro sem modelo ⇒ `usd:null`).
  Aceite: fixtures reais gravadas (mensagem repetida por bloco, sidechain/subagente, linha truncada, linha gigante, sem `usage`) ⇒ contagem correta e idempotente; nenhum campo de conteúdo no retorno (teste de forma); 50 MB lidos em ≤ 1,5 s com memória estável (P-113). · T-10.01.
- **T-10.05 · Leitor de rollout do Codex** — `leitores/codex.ts`. Evento `token_count`: usa o **delta** de `total_token_usage` (robusto a eventos repetidos com o mesmo total; reinício de contagem ⇒ novo marco), `cached_input_tokens` como cache de leitura, `reasoning_output_tokens` somado à saída; modelo do `turn_context`; mesma disciplina de extração, deduplicação, linha gigante e truncamento; formato **a verificar**. Aceite: fixtures (total repetido, reinício, sem modelo, truncado) ⇒ deltas corretos e idempotentes; modelo ausente ⇒ `usd:null`; P-113. · T-10.01.
- **T-10.06 · Fontes de uso por Pane** — `custo/fontes.ts` + ligação ao serviço de atividade (hooks). Para cada Pane de CLI localiza a fonte **sem varrer o home**: Claude — `transcript_path` do evento de hook (validado: absoluto, termina em `.jsonl`, dentro do `CLAUDE_CONFIG_DIR` da conta ou do padrão) → grava `base:"claude_config"` + `relativo`; Codex — pasta `sessions/` do `CODEX_HOME` da conta, arquivo cujo id casa com `cli_ref_conversa`; **OpenRouter** — fonte `proxy` (eventos `usage.observed`); demais CLIs (`gemini`, `opencode` nativo, `aider`, `qwen`, `kilo`): `estado:"sem_fonte"` e evento `usage.source_missing` (o custo desses Panes é `fontes_ausentes`, **nunca 0**; P-82).
  Detecta rotação/truncamento (inode/tamanho menor ⇒ relê do início com deduplicação), `/clear` (nova conversa ⇒ nova fonte do mesmo Pane), Pane encerrado (`encerrada` depois de drenar). Aceite: caminho fora da base ⇒ recusado; `/clear` cria 2ª fonte; arquivo truncado não duplica registros; CLI sem leitor ⇒ `sem_fonte` visível em `custo:fontes`; nenhuma varredura de diretório do usuário (teste espia o `fs`). · T-10.02, T-01.07, F2.
- **T-10.07 · Ingestão incremental** — `custo/{ingestao,worker}.ts`. Watchers por fonte (debounce 300 ms, **só com a janela em foco**; sem foco o backlog é drenado na volta, em ≤ 1 releitura por fonte a cada 2 s); o **worker** lê do `offset` salvo, extrai e devolve lotes de ≤ 500 registros; o main grava cada lote numa transação curta (≤ 5 ms), calcula `usd` (T-10.03), atribui (T-10.08) e atualiza `custo_agregado` **na mesma transação**; retomada após crash pelo `offset` (idempotente por `(fonte_id, chave)`); backpressure: no máximo 1 lote em voo.
  Aceite: P-113 e P-114; matar o worker no meio e religar não duplica nem perde registros; arquivo de 50 MB não trava a UI (`longtask`); `ler_transcripts:false` desliga a leitura e mantém o que já existe; nenhum conteúdo no que o worker devolve. · T-10.03, T-10.04, T-10.05, T-10.06.
- **T-10.08 · Atribuição por janela** — `custo/{atribuicao,janelas}.ts`. `atribuir(registro, janelasDoPane, pane)` puro: piloto ⇒ `orquestracao`; **uma** janela contém o instante ⇒ `card`; nenhuma ⇒ `sem_card`; ≥ 2 de cards distintos no mesmo Pane ⇒ `ambigua` (D-106). Janelas: (a) banco — `task.reivindicada_em → entregue_em` (aberta ⇒ fim `NULL`), por `pane_id`; (b) rastro — pares **explícitos** `task_iniciada → task_concluida` do `trabalho_id`, ligados ao Pane cujo `cwd` está no worktree do trabalho; sem `task_iniciada` explícito **não se infere janela**. Tolerância de 5 s no fim (mensagem final do handoff).
  `reatribuir(pane_id, desde)`: quando uma janela muda (evento do método/`task.updated`), recalcula os registros brutos do Pane dos últimos 7 dias e ajusta os agregados pela diferença, em lotes. Aceite: 2 cards sequenciais no mesmo Pane ⇒ cada um só o seu (CT-10.06); janelas sobrepostas ⇒ `ambigua`; piloto nunca soma em card; `task_concluida` que chega depois do uso reatribui corretamente; reatribuir duas vezes não muda nada. · T-10.02, F2, F4.
- **T-10.09 · Agregação e consultas** — `custo/agregar.ts` + repositório. `resumo(escopo, chave)` e `relatorio(agrupar, desde, ate, filtros)` leem **só** `custo_agregado` (sem somar bruto): `usd = soma(usd_conhecido)` se `registros > registros_sem_preco` senão `null`; `incompleto = registros_sem_preco > 0 ∨ fontes_ausentes ≠ []`; `aproximado = registros_aproximados > 0`; `CustoMissao` separa `orquestracao/cards/sem_card/ambiguo`; **card descartado mantém custo**; relatório paginado por cursor. Aceite: P-115; missão com 1 registro sem preço ⇒ `incompleto:true` e `usd` = soma do resto; todos sem preço ⇒ `usd:null`; Σ cards + orquestração + sem card + ambíguo = total da Missão; sem registros ⇒ `usd:null` com `registros:0` (não "0"). · T-10.02, T-10.08.
- **T-10.10 · Serviço de Custo** — `custo/servico.ts`. Eventos `cost.updated` coalescidos (≤ 1/300 ms); retenção (brutos > 90 dias saem, agregados ficam; job em lotes); `reprecificar(desde?)` **só por pedido** (recalcula `usd` dos brutos com a tabela vigente e ajusta agregados); `reindexar(workspace?)` apaga brutos/agregados do escopo e relê as fontes do início, em worker, com progresso; `diagnostico()` texto copiável **sem conteúdo** (fontes, estados, offsets, contagens); teto de Missão: ao cruzar `custo_teto.teto_usd` (usando o `usd` conhecido) emite `cost.ceiling_reached` **uma vez** (alerta, nunca bloqueia; P-80).
  Aceite: reindexar produz agregados idênticos aos incrementais (teste de igualdade); reprecificar não roda sozinho; retenção duas vezes é idempotente; teto avisa uma vez; P-117. · T-10.07, T-10.09.
- **T-10.11 · IPC `custo:*` e ligação no main** — `src/main/custo.ts`, `src/main/ipc/custo.ts`. Boot na onda 2, em ocioso (nunca antes da primeira pintura); worker com erro isolado (falha do serviço de custo não derruba o app); encaminha `usage.observed` do proxy (Fase 9) ao leitor `proxy`. Aceite: P-01 e P-12 sem piora; falha do worker mostra `fonte_ausente`/erro nominal e o resto do app segue; `custo:resumo` ≤ 5 ms (P-115); nenhum canal devolve caminho absoluto. · T-10.10, T-09.27.

### 10B — Board  [C: `src/nucleo/board/**`, `src/main/{board,ipc/board}.ts`, `src/nucleo/mcp/tools/{task,custo}.ts`] [E: `src/renderer/telas/board/**`, `src/renderer/estado/{custo,board}.ts`]

- **T-10.12 · Modelo do Board (puro)** — `board/{modelo,coluna}.ts`. `montarBoard({trabalhos, tasksBanco, panes, custos, violacoes, filtros, agora})` → `BoardModelo`: aplica a tabela de mapeamento (D-107), selos, progresso (`pct_concluido`/`pct_validado` sobre o total **não descartado**), agrupamento, custo leve por card. Determinístico, sem I/O.
  Aceite: tabela de 40 casos cobrindo as 8 regras de coluna (disco × banco em conflito: **o disco vence**), dependência aberta vs fechada, bloqueio, descartada (oculta com custo preservado no total), validação por veredito do trabalho; missão com 4 cards (2 concluídos, 1 validado, 1 a fazer) ⇒ `50%`/`25%`; 1 000 cards em ≤ 15 ms (P-116); permutar a ordem de entrada não muda a saída. · T-10.01.
- **T-10.13 · Serviço e IPC do Board** — `src/main/{board,ipc/board}.ts`, `board/detalhe.ts`. `board:snapshot` (cache por `versao`; invalida em `method.changed`, `task.updated`, `cost.updated`), `board:card_detalhe`, `board:abrir_arquivo` (o main resolve o caminho: dentro do worktree do trabalho, sob `docs/`, extensões permitidas, sem symlink para fora), `board:evento` coalescido (≤ 1/300 ms). Aceite: abrir arquivo fora de `docs/`, de outra extensão ou por symlink ⇒ recusado; snapshot repetido sem mudança devolve a mesma `versao` (sem recomputar); evento de 500 toques no disco = 1 `board:evento`; P-116 (`montarBoard`). · T-10.12, T-10.11, F4.
- **T-10.14 · Estado do renderer** — `estado/{custo,board}.ts`. Stores mínimos (`useSyncExternalStore`); ao `board:evento`, busca o snapshot e aplica **compartilhamento estrutural por `chave`** (mesma referência para card que não mudou); assina `custo:evento` só para os escopos visíveis; limpa ao trocar de workspace. Aceite: atualizar 1 card re-renderiza só esse card (contador de renders); trocar de workspace descarta o estado anterior; memória ≤ 5 MB com 1 000 cards (P-117). · T-10.13.
- **T-10.15 · Tela Board (aba em Missões)** — `telas/board/{index,Colunas,CardLinha}.tsx`; aba **Board** ao lado de **Lista** em `telas/missoes/index.tsx` (única task que o toca nesta fase), `React.lazy`. **Uma linha de controles** (~28 px): seletor de trabalho/Missão ▾, filtros, busca, agrupar ▾, progresso e custo total à direita. **Seis colunas** (`Backlog | A fazer | Em andamento | Em revisão | Concluído | Validado`), cada uma virtualizada; **card em uma linha** (24–26 px): `glifo de estado · T-NN.MM · título (elipse) · custo ("≥ US$ 0,42" / "custo desconhecido") · ícone da CLI 12 px`; selos `pronta`/`bloqueada`/`violação` por glifo e texto (cor nunca é o único sinal); hover/foco mostra o resumo; clique/Enter abre o detalhe. **Sem arrastar**: nenhum card muda de coluna por gesto (D-107).
  Aceite: P-116 (1 000 cards: 1ª abertura ≤ 200 ms, DOM ≤ 200 nós, 60 fps); cabe em 720 px (colunas rolam na horizontal sem barra); estados vazios explicam o próximo passo ("nenhum plano do método neste workspace: abra `/expx:sprintx`"); nenhum diálogo nativo; custo desconhecido renderiza texto, não "0". · T-10.14, T-10.13.
- **T-10.16 · Detalhe do card** — `telas/board/Detalhe.tsx` (painel lateral `role="complementary"`, 320 px, fecha com Esc). Mostra: contrato (objetivo, critério de aceite, testes de integração/funcional/regressão), dependências (clicáveis, rolam até o card), fase, violações, **janela** (início–fim, origem banco/rastro, duração observada), **custo por modelo** (tokens, USD, origem `cli|proxy|tabela|desconhecido`, "≈" quando aproximado), Panes envolvidos (CLI, modelo, conta, papel), handoffs (status + resumo), **rastro da task**; botões: `Abrir arquivo`, `Abrir Pane`, `Copiar comando do método` (`metodo:comando_sugerido`), `Delegar` (T-10.19).
  Aceite: custo sem preço mostra "custo desconhecido" por modelo e o total com "≥"; descartada mostra custo preservado; nenhum caminho absoluto no DOM; navegável por teclado; abre ≤ 100 ms. · T-10.15, T-10.13.
- **T-10.17 · Filtros, busca e agrupamento** — `telas/board/Filtros.tsx`. Filtros por trabalho (multi), Missão, coluna, selo, modelo, "com custo / sem custo" e busca textual por id/título; agrupar por trabalho ou fase (faixas recolhíveis); estado dos filtros por workspace em `localStorage` (com `try/catch`; a tela funciona sem). Aceite: filtro multi-trabalho devolve a união; busca ≤ 50 ms sobre 1 000 cards; limpar filtros restaura o quadro; teclado completo. · T-10.15.
- **T-10.18 · Progresso e custo da Missão/trabalho** — `telas/board/Progresso.tsx`, `missoes/Custo.tsx`. Barra de progresso: **verde = concluído, azul = validado** (azul do destaque do tema), com **padrão de traço** além da cor; custo da Missão no canto: `≥ US$ x` com o detalhe (cards · orquestração · sem card · ambíguo) e a nota "equivalente em API"; `Custo.tsx` passa a receber `CustoResumo` (mantém "custo desconhecido" e acrescenta "≥"/"≈").
  Aceite: Missão com 1 registro sem preço mostra "≥"; nenhum 0 fantasma; contraste AA e legível em escala de cinza; o cabeçalho continua em uma linha. · T-10.15, T-10.09.
- **T-10.19 · Delegar card a um worker** — `board/delegar.ts`, `telas/board/Delegar.tsx`, canal `board:delegar_card`. Só para card `a_fazer`+`pronta` de uma Missão `squad|agentico` com worktree do trabalho (nunca cria Missão): gera o **briefing** a partir dos campos da task do método (objetivo, critério, testes) com as seções `Contrato`/`Resultado`/`Executado_por` (`orquestracao/briefing.ts`), cria a linha de `task` no banco, e abre o Pane pelo `Router` da Fase 9 (`task_type: implementar`, `origem:"usuario"`), mostrando antes um diálogo próprio com **rota prevista, recibo e estimativa de custo** (T-10.25; "sem histórico" quando < 3 amostras) e o botão **Confirmar**.
  Aceite: card já delegado ⇒ `conflict` (índice `ux_task_ref`); card não pronto ⇒ recusa com o motivo; o Pane aparece na UI ≤ 300 ms; handoff do worker leva a `em_revisao`; o ADE não escreve nada em `docs/**`; sem confirmar não há efeito. · T-10.16, T-10.25, T-09.16, F3.
- **T-10.20 · Tools `task_list`, `task_get`, `cost_report`** — `mcp/tools/{task,custo}.ts`, portas `PortaBoard`/`PortaCusto` em `portas.ts`, catálogo/matriz. Somente leitura; escopo = Missão/workspace do token; `task_list` **leve** (≤ 4 KB por página), `task_get` completo; `cost_report` sem campo de escrita. Aceite: matriz por modo conferida em `tools/list`; worker não vê nenhuma; `handoff_submit` com `cost`/`tokens` extra **não altera** nenhum agregado (CT-10.10); token de uma Missão não lê outra; respostas ≤ 8 KB. · T-10.09, T-10.12, F3.
- **T-10.21 · Alertas de custo** — `custo/servico.ts` (regras) + notificação (`notificar.ts`) + selo no card/cabeçalho. Alertas: **teto da Missão** (`cost.ceiling_reached`, uma vez), **modelo sem preço** (uma vez por modelo, com atalho "cadastrar preço"), **Pane sem fonte de uso** (CLI sem leitor). Notifica só com a janela sem foco e no máximo 1 por tipo/alvo/hora; **nada bloqueia nem aborta Pane** (P-80).
  Aceite: ao cruzar o teto, 1 aviso (não repete ao recarregar); modelo sem preço avisa uma vez; alerta nunca cancela trabalho; aviso some ao cadastrar o preço. · T-10.10, T-10.15.

### 10C — Consumo e insights  [M2: `src/nucleo/limites/adaptadores/estimado.ts`] [E2: `src/renderer/telas/consumo/{DetalhePorUso,FontesPrecos}.tsx`, `telas/board/Insights.tsx`, `casca/MedidorLimites.tsx` (só o popover)]

- **T-10.22 · Fonte "estimado" de limites** — `limites/adaptadores/estimado.ts`. Para contas com `teto_tokens_5h`/`teto_tokens_semana` configurados (Fase 9, aba Contas e limites), converte os tokens **observados** na janela (soma de `uso_registro` desde o início do ciclo) em `used_pct = tokens/teto`, com `fonte:"estimado"`, `confianca:"estimado"` (nunca `medido`); sem teto configurado ⇒ não produz nada (`null`, "sem dado"); ciclo inferido do último `resets_at` conhecido, senão `null`.
  Aceite: sem teto ⇒ `null`; com teto ⇒ `≈ x%` marcado `estimado` e rebaixado pelo `pickAccount` (nível 2); dado medido mais novo vence o estimado no merge; a leitura usa o agregado, não o bruto (≤ 5 ms). · T-10.09, T-09.04.
- **T-10.23 · Tela Consumo: aba "Detalhe por uso"** — `telas/consumo/DetalhePorUso.tsx` (liga o ponto de extensão `FonteDeUso` da T-09.34). Agrupar por **modelo, workspace, Missão, Pane, conta ou dia** (e card), em janelas de 24 h/7 d/30 d; tabela densa virtualizada (`rotulo · tokens in/out/cache · USD (≥/≈) · participação`) e barras de participação em SVG próprio (reuso de `graficos/Barras`); "sem fonte" listado como linha própria (nunca soma 0); exporta **copiável** (texto) sem conteúdo.
  Aceite: P-115/P-108; Pane de CLI sem fonte aparece como "sem fonte de uso" com o próximo passo; Σ das linhas = total do período; troca de agrupamento ≤ 50 ms; AA e escala de cinza. · T-09.34, T-10.09.
- **T-10.24 · Insights compactos** — `telas/board/Insights.tsx` (faixa recolhível abaixo da linha de controles do Board, 1 linha por insight): gasto por modelo, **maiores cards** (top 5), custo por **TaskType** do harness e **custo do decisor** (soma de `decisao_agregado_dia`, sempre separado dos cards), tendência da semana. Aceite: insights somem quando não há dado (estado vazio claro); custo do decisor nunca entra nos cards; recolher não custa re-render do quadro. · T-10.15, T-10.09, T-09.15.
- **T-10.25 · Estimativa histórica** — `custo/agregar.ts` (`estimar`) + canal `custo:estimativa`. Mediana/p25/p75 do custo de cards **concluídos** do mesmo `task_type` (e, quando há ≥ 5, do mesmo modelo); só usa cards com `incompleto:false`; `< 3` amostras ⇒ `sem_historico` (nunca chuta); `confianca` por nº de amostras. Aceite: 2 amostras ⇒ `sem_historico`; cards incompletos excluídos; resultado ≤ 20 ms; a estimativa **não** aparece como custo do card. · T-10.09.
- **T-10.26 · Popover de consumo ampliado** — `casca/MedidorLimites.tsx` (**só o conteúdo do popover**; o rodapé de 26 px não cresce) — acrescenta por conta "hoje · 7 d: ≥ US$ x" (do agregado por conta) e "abrir Consumo › Detalhe por uso". Aceite: P-103 sem piora; rodapé e topo inalterados em altura; custo sem dado mostra "—"; só o popover re-renderiza. · T-09.29, T-10.09.

### 10D — Fechamento  [F: `tests/**`, `src/renderer/telas/consumo/FontesPrecos.tsx`]

- **T-10.27 · Aba "Fontes e preços" (Configurações de custo)** — `telas/consumo/FontesPrecos.tsx`. Estado das fontes por Pane (`lendo`/`sem_fonte`/`erro`, atraso, linhas puladas), tabela de **preços** (embutidos, do OpenRouter e do usuário; selo `confirmado`/`aproximado`; editar/cadastrar `usuario`; **"reprecificar"** explícito com confirmação), câmbio manual BRL (só exibição "≈ R$"), teto padrão de Missão, `ler_transcripts`, **reindexar** e **copiar diagnóstico**. Aceite: sem preço cadastrado o modelo aparece em "sem preço"; reprecificar pede confirmação própria e mostra quantos registros mudam; reindexar mostra progresso e não trava a UI; diagnóstico sem conteúdo. · T-10.10, T-09.34.
- **T-10.28 · Privacidade e "nunca autorrelato"** — `tests/privacidade-custo.test.ts`. Planta **sentinelas de conteúdo** (frase de conversa, trecho de código, caminho de arquivo do usuário) nos transcripts/rollouts de fixture e roda ingestão, board, relatório, diagnóstico, eventos, IPC e MCP varrendo banco, log, argv, eventos e DOM; planta também `cost`/`tokens` falsos no `handoff_submit`. Aceite: 0 ocorrências de conteúdo fora dos arquivos da própria CLI; o worker devolve só `{ts, modelo, tokens, chave, usd?}`; `handoff_submit` com custo inventado não altera agregados; `grep` por `fetch|http.request|net.connect` em `nucleo/custo` e `nucleo/board` = 0 (esta fase não faz rede). · T-10.11, T-10.20.
- **T-10.29 · Orçamentos P-113 a P-117** — `tests/perf/custo.perf.test.ts`, entradas em `npm run perf`/`verificar`. Aceite: todos verdes e gravados em `docs/ade/perf/ultimo.json`; P-01..P-22 e P-100..P-112 sem piora. · T-10.07, T-10.09, T-10.15, T-10.10.
- **T-10.30 · Acessibilidade e teclado do Board** — `role="region"` por coluna com `aria-label` e contagem, cards `role="article"`, setas movem o foco entre cards/colunas (Enter abre, Esc fecha o detalhe; sem roubar o foco do terminal, D-37), `aria-live` educado para "custo atualizado" (no máximo 1 por 10 s), contraste AA dos dois temas e legibilidade em escala de cinza (suíte de T-05.05 estendida), `prefers-reduced-motion` respeitado. Aceite: a suíte a11y do Playwright passa na aba Board; zero armadilha de foco; leitor de tela anuncia "T-03.04, em andamento, pronta, ≥ US$ 1,80". · T-10.15, T-10.16, T-10.18.
- **T-10.31 · E2E no Electron real** — `tests/custo.e2e.test.ts` + CLIs falsas (`cli-claude-transcript.mjs`, `cli-codex-rollout.mjs`, `cli-openrouter.mjs` da Fase 9) + proxy OpenRouter falso. Cenários: (1) Pane Claude falso grava transcript ⇒ card mostra custo ≤ 700 ms depois; (2) **dois cards sequenciais** no mesmo Pane ⇒ cada um só a sua janela; (3) modelo sem preço ⇒ "≥" no card e na Missão; (4) card descartado preserva o custo; (5) Pane do piloto ⇒ custo vai a "orquestração", não a card; (6) Pane com CLI sem leitor ⇒ "sem fonte", nunca 0; (7) Pane OpenRouter ⇒ custo `proxy` medido via `usage.observed`; (8) `handoff_submit` com `cost` falso não altera nada; (9) delegar card: briefing gerado, Pane abre, handoff leva a "Em revisão", `docs/**` intacto; (10) teto da Missão avisa uma vez; (11) reindexar reproduz os mesmos números; (12) reiniciar o app no meio da ingestão não duplica; (13) aba Board com 1 000 cards fixture rola a 60 fps.
  Aceite: todos verdes; `ps` sem worker/CLI falsa vivo; nenhum arquivo do método modificado (hash antes/depois). · T-10.19, T-10.21, T-10.27, T-10.28, T-10.29, T-10.30.

## UI compacta (D-32)

- **Board**: uma linha de controles (~28 px) com seletor de trabalho/Missão, filtros, busca, agrupar, progresso e custo total à direita; seis colunas; **card em uma linha** de 24–26 px (fonte 11 px, ícones 12 px); o detalhe é um painel lateral de 320 px (não um modal); insights em faixa recolhível de 1 linha por item. Nada de cartões grandes nem título de página.
- **Cores**: **verde** (token de sinal "pronto" da sinaleira) = concluído; **azul** (destaque do tema) = validado; os selos e a barra têm **glifo/traço** além da cor. Nenhuma cor literal fora de `tokens.css`.
- **Custo**: sempre com a marca de incerteza — `≥ US$ 0,42` (incompleto), `≈ US$ 0,42` (aproximado), `custo desconhecido` (nenhum preço) — e a legenda "equivalente em API". Tela Consumo e popover do rodapé usam o mesmo formatador (`formatarCusto`).
- **Estados vazios** explicam o próximo passo (sem plano do método, sem fonte de uso, sem preço).

## Casos de teste de aceitação

| # | Cenário | Esperado |
|---|---|---|
| CT-10.01 | Transcript do Claude com a mesma `message.id` em 3 linhas (blocos) | contado **uma** vez; idempotente ao reler |
| CT-10.02 | Rollout do Codex com `token_count` repetido e reinício de contagem | deltas corretos; sem dupla contagem |
| CT-10.03 | Modelo sem preço na tabela | `usd:null` no registro; card/Missão `≥ US$ x` (soma do resto); todos sem preço ⇒ "custo desconhecido" |
| CT-10.04 | Preço aproximado (cache derivado ou `confirmado:false`) | `≈` no valor; `aproximado:true` |
| CT-10.05 | Preço muda depois | custo já registrado não muda; só `reprecificar` (confirmado) recalcula |
| CT-10.06 | Dois cards sequenciais no mesmo Pane | cada um recebe só o uso da sua janela; Σ = total do Pane |
| CT-10.07 | Duas janelas de cards diferentes sobrepostas no mesmo Pane | uso vai a `ambigua`; aparece no resumo da Missão, não em card |
| CT-10.08 | Pane do piloto gasta tokens | `orquestracao` da Missão; nenhum card cresce |
| CT-10.09 | Pane de CLI sem leitor (ex.: `gemini`) | `sem_fonte`; `fontes_ausentes`; custo **nunca 0**; alerta uma vez |
| CT-10.10 | `handoff_submit` com `cost: {usd: 0.01}` inventado | ignorado; agregados idênticos |
| CT-10.11 | Card descartado | some do quadro (filtro "descartados" o mostra); custo preservado no total |
| CT-10.12 | `task_concluida` chega ao rastro depois do uso | `reatribuir` move o uso de `sem_card` para o card; idempotente |
| CT-10.13 | Disco diz `concluida`, banco diz `reivindicada` | coluna `concluido` (o disco vence) |
| CT-10.14 | Missão com 4 cards (2 concluídos, 1 validado, 1 a fazer) | progresso 50% verde / 25% azul sobre o total não descartado |
| CT-10.15 | Card `pendente` com dependência aberta / fechada | `backlog` / `a_fazer` + selo `pronta` |
| CT-10.16 | Delegar card já delegado | `conflict`; nada criado |
| CT-10.17 | Delegar card pronto | briefing + Pane + recibo + estimativa ("sem histórico" com < 3 amostras); `docs/**` intacto |
| CT-10.18 | Teto de Missão cruzado | 1 aviso; nada é interrompido; não repete ao recarregar |
| CT-10.19 | Reindexar | agregados idênticos aos incrementais |
| CT-10.20 | Ingestão de 50 MB | ≤ 1,5 s no worker; main sem tarefa > 50 ms |
| CT-10.21 | Linha nova no transcript | custo do card atualizado ≤ 700 ms |
| CT-10.22 | Fonte "estimado" sem teto configurado | nenhum dado; "sem dado" (não 0%) |
| CT-10.23 | Pane OpenRouter via proxy | registro `usd_origem:"proxy"` (medido) com os tokens do `usage` |
| CT-10.24 | Sentinelas de conteúdo nos transcripts | ausentes de banco, log, evento, IPC, DOM |
| CT-10.25 | Board com 1 000 cards | 1ª abertura ≤ 200 ms; 60 fps; atualizar 1 card re-renderiza só ele |
| CT-10.26 | `board:abrir_arquivo` fora de `docs/`, extensão proibida ou symlink para fora | recusado |

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| **Formatos de transcript/rollout mudam** (campos de `usage`, nomes, estrutura) | custo para de aparecer ou erra | leitores tolerantes que nunca lançam; fixtures reais + testes de contrato; campo ausente ⇒ registro sem modelo/`usd:null`; `custo:fontes` mostra erro/atraso; diagnóstico copiável |
| **Custo estimado ≠ real** (assinatura não cobra por token; preços mudam; cache muda a conta) | número enganoso | rotulado "equivalente em API"; `≈` quando aproximado; preço **congelado** no registro; tabela editável e `reprecificar` explícito; entrada omitida em dúvida (P-39) |
| **Dupla contagem** (blocos do Claude, eventos repetidos do Codex, releitura após rotação) | custo inflado | deduplicação por `message.id`/delta; `UNIQUE(fonte_id, chave)`; reler do início é idempotente; teste de igualdade com reindexar |
| **Atribuição errada** (sessão reaproveitada, paralelismo, rastro tardio) | custo no card errado | janelas explícitas apenas; sobreposição ⇒ `ambigua`; piloto ⇒ Missão; `reatribuir` idempotente; "sem card" visível em vez de chute (D-106) |
| **Privacidade**: transcripts têm conversa e código | vazamento local | extração só de `{ts, modelo, tokens, chave}` no worker; varredura com sentinelas (T-10.28); sem caminho absoluto no banco; `ler_transcripts` desligável; P-81 |
| **Leitura de arquivos fora do workspace** | segurança | só pelas bases (`claude_config`, `codex_home`) e por `transcript_path` validado; sem varredura do home; nada de symlink para fora |
| **CLI sem fonte de uso** (gemini, opencode nativo, aider, qwen, kilo) | custo ausente | `sem_fonte` explícito, `fontes_ausentes`, nunca 0; via OpenRouter a fonte é o proxy (medida); P-82 |
| **Desempenho**: transcripts de centenas de MB, 1 000 cards | UI trava | worker por offset, lotes curtos, agregados materializados, snapshot coalescido, virtualização, orçamentos P-113..P-117 medidos |
| **Board vira "segundo sistema de tarefas"** e diverge do método | conflito de verdade | o board **só lê**; o disco vence; sem arrastar, sem claim próprio; delegar usa a tabela `task` da Fase 3 e não escreve em `docs/**` (D-107) |
| **Custo da orquestração distorce o card** | cards parecem caros/baratos | piloto separado em `orquestracao`; 2 cards no mesmo Pane não somam orquestração (RF-12.5.05) |
| Teto de Missão vira bloqueio sem querer | trabalho interrompido | só alerta, uma vez; nada aborta Pane (P-80) |
| Estimativa histórica enganosa com pouca amostra | planejamento errado | `< 3` amostras ⇒ `sem_historico`; só cards completos; nunca aparece como custo |

## Ordem de execução e paralelismo

```
T-10.01 ─► T-10.02 ─► 10A (03 ∥ 04 ∥ 05 → 06 → 07 → 08 → 09 → 10 → 11)
   │                         └────────────────────────────► 10C (22 após 09 · 25 após 09 · 23/26/27 após 09/10)
   └────► 10B (12 após 01 ; 13 após 11 ; 14 → 15 → 16/17/18 ; 19 após 16 e 25 ; 20 após 09 e 12 ; 21 após 10 e 15)
10D por último (28, 29, 30 → 31)
```
Ondas (cada agente numa área de arquivos disjunta; o coordenador roda `npm run verificar` e atualiza `STATUS.md`; no máximo 5 agentes; **a Fase 9 já deve estar fechada**):
1. **Onda 1 (1 agente, sequencial):** T-10.01 e T-10.02 (tocam `ipc.ts`, `banco/`, preload).
2. **Onda 2 (3 agentes):** A = T-10.03; B = T-10.04, T-10.05 (leitores) e depois T-10.06; C = T-10.12 (board puro).
3. **Onda 3 (3 agentes):** B = T-10.07; A = T-10.08, T-10.09 (após T-10.03); C = T-10.13 depois que T-10.11 existir (começa por T-10.12).
4. **Onda 4 (3 agentes):** A = T-10.10, T-10.11, T-10.25; E = T-10.14 → T-10.15 → T-10.16/T-10.17/T-10.18; M2 = T-10.22.
5. **Onda 5 (3 agentes):** E = T-10.19 (após T-10.25); C = T-10.20, T-10.21; E2 = T-10.23, T-10.24, T-10.26, T-10.27.
6. **Onda 6 (em série):** T-10.28 → T-10.29 → T-10.30 → T-10.31 (e2e não roda junto de perf) → fechamento do coordenador.
Arquivos compartilhados que **só o coordenador** edita: `src/compartilhado/ipc.ts`, `src/preload/preload.ts`, `src/nucleo/mcp/{catalogo,portas}.ts`, migrations, `05-CONTRATOS.md`, `STATUS.md`; `telas/missoes/index.tsx` é cedido à T-10.15 e `casca/MedidorLimites.tsx` à T-10.26.

## Decisões [LAC] resolvidas

| [LAC] | Resolução |
|---|---|
| **Unidade de custo** (spec-12 LAC-3: USD × BRL × tokens) | **[DEC] D-105:** USD canônico + tokens por registro; BRL só como exibição "≈ R$" com câmbio **manual** (`config`); nada de conversão automática (sem rede) |
| De onde vem o custo (spec-12 RF-12.5: UsageRecord por hooks/Session) | **[DEC] D-104:** só de transcript/rollout das CLIs, do proxy OpenRouter do ADE, do banco e do rastro; **nunca** do agente; `handoff_submit` não tem campo de custo |
| Custo por janela [claim, handoff] (RF-12.5.05) | **[DEC] D-106:** janelas explícitas do banco (`reivindicada_em→entregue_em`) e do rastro (`task_iniciada→task_concluida`); sobreposição ⇒ `ambigua`; piloto ⇒ `orquestracao`; sem janela ⇒ `sem_card` |
| Modelo sem preço (RF-12.5.04) | **[DEC] D-105:** `usd:null` + alerta; "≥" na soma; preço editável pelo dono; entrada omitida em dúvida |
| Custo medido × estimado (spec-14 `cost_kind`) | **[DEC] D-105:** `usd_origem ∈ {cli, proxy, tabela, desconhecido}`; `cli`/`proxy` = medido; `tabela` = equivalente em API; congelado na ingestão |
| Colunas do kanban (spec-12 LAC-5: só "Feito/Validado/Desenvolvimento" observadas) | **[DEC] D-107:** `backlog → a_fazer → em_andamento → em_revisao → concluido → validado` mapeadas das tasks do método + banco (tabela acima); progresso verde = concluído, azul = validado |
| Board com claim, tokens de acesso, servidor MCP próprio, Zero/Overrunner, cloud/entitlement (spec-12) | **[DEC] D-107/D-108:** **não implementado**: o ADE já tem Missões, `task`/`handoff` e MCP por Pane (Fase 3); o board é visão. Tier A/B/C de tools do Overclick não existe aqui; só `task_list`, `task_get` (leitura) e `cost_report` |
| Mover card (arrastar) | **[DEC] D-107:** não existe; o disco vence o rastro (D-19); ações = abrir arquivo, abrir Pane, copiar comando, **delegar a worker** |
| Onde mora o board no menu | **[DEC] D-107:** aba **Board** dentro de Missões (Lista \| Board); sem novo item de menu |
| Referência de arquivo de transcript (caminho absoluto fora do workspace) | **[DEC] D-109:** `base + relativo` (`claude_config`, `codex_home`, `proxy`); caminho absoluto só em memória; brutos por 90 dias, agregados permanentes |
| CLIs sem leitor de uso | **[DEC] D-116:** `sem_fonte` explícito, nunca 0; via OpenRouter a fonte é o proxy; adaptadores novos entram por `leitores/` + `fontes.ts` |
| Teto de custo por Missão | **[DEC] D-117:** só alerta (uma vez), nunca bloqueia; padrão `null` (sem teto) |
| Estimativa por TaskType | **[DEC]:** mediana de cards concluídos completos; `< 3` amostras ⇒ `sem_historico` |
| Consumo por modelo/workspace/Missão/Pane (pedido do dono, tela Consumo da Fase 9) | **[DEC]:** aba "Detalhe por uso" (T-10.23) sobre os agregados; a Fase 9 já deixa o ponto de extensão `FonteDeUso` |
| Insights (spec-12 RF-12.5.03: fase 1.5) | **[DEC]:** faixa compacta no Board + aba da tela Consumo; sem tela nova |
| Custo do decisor externo | **[DEC]:** vem da Decision (Fase 9), separado dos cards e exibido à parte nos insights |

## Pendências do dono geradas nesta fase

Já existente e usada aqui: **P-39** (tabela de preços dos modelos: a tabela embarcada pode ficar vazia; entrada em dúvida é omitida e o custo aparece como "desconhecido"). Novas: **P-80** (teto de custo por Missão: alerta × bloqueio), **P-81** (ler os transcripts locais das CLIs só para contar tokens: aceite e desligamento), **P-82** (CLIs sem fonte de uso: priorizar adaptadores). Texto e padrões adotados em `PENDENCIAS-DO-DONO.md`.
