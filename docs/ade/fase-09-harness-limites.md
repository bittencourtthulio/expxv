# Fase 9 — Harness, limites, troca automática, consumo, OpenRouter e decisor

Objetivo: para cada tarefa que o dev (ou o piloto) manda executar, o ADE decide **qual CLI, qual conta, qual modelo e qual esforço** a
executam, usando o login que cada CLI já tem (e, opcionalmente, a chave OpenRouter do próprio dono) e lendo quanto resta de cota de cada
conta **sem tocar em credencial**; **troca de conta (e, se preciso, de provedor) sozinho quando o consumo passa de 85%**, preservando o
contexto da tarefa; mostra o consumo no rodapé de todas as páginas, a cota geral no topo e uma tela "Consumo" com análise; e oferece um
decisor externo opcional (JEV direto ou via OpenRouter), desligado por padrão, sempre subordinado à regra determinística.
Base: `base/C-…` (specs 03, 09, 14), `base/specs-overclock/spec-03` e `spec-09`, `05-CONTRATOS.md` §3, `fase-03-orquestracao-mcp.md` (MCP,
portas, hooks), `fase-02` (contas, Missões). Referência visual somente-leitura: `BarraUso`/`ResumoUsoGlobal` do ExpxMedia.

**Valor para o dev que usa o método Expx.** (1) Não queimar a cota cara em tarefa trivial: `bug-fix` vai para a faixa média, `auditar` para o
topo e de **outro provedor** que o do implementador (D-21). (2) Não perder cota que está para zerar: entre as contas livres, gasta-se primeiro
a que reseta antes. (3) Não parar no meio do dia: conta estourando (≥ 85%) passa o trabalho para outra conta do mesmo provedor; sem outra,
para o **modelo equivalente** de outro provedor (inclusive modelos do OpenRouter, por crédito). (4) Saber de relance quanto falta (rodapé em
toda página + cota geral no topo) e quando a cota zera (tela Consumo). (5) Tudo auditável: cada escolha e cada troca vira uma Decision com o
motivo em uma frase, e um log de trocas. (6) A Fase 16 (Maestro) ganha dois pontos de integração prontos: `classificarIntencao` e `resolverPerfil`.

**Portão da fase** (todos obrigatórios):
- `npm run verificar` verde (tipos, testes, regra de marca, orçamento de tamanho P-08, varredura de segredos e de rede T-09.38).
- `pickAccount` e `pickModel` com as tabelas de decisão (CT-9.01..CT-9.38) verdes; nenhuma outra função escolhe conta nem modelo.
- E2E no Electron real (T-09.39): delegação com `pane_spawn` sem provedor + recibo; conta ≥ 85% → troca automática com brief; sem conta com folga →
  modelo equivalente de outro provedor; modo "só sugerir" não troca; operação git em curso não é interrompida; **zero chamadas de rede** sem
  consentimento (stub de rede que falha o teste se tocado); OpenRouter contra upstream falso: lista de modelos só no clique, chave ausente do
  ambiente/argv/log, proxy recusa modelo não habilitado.
- `npm run perf`: P-100 a P-112 verdes e P-01..P-22 sem piora (rodapé, topo e chunks novos não estouram P-08).
- Auditoria de segredos: sentinelas de cofre/chave **ausentes** de logs, eventos, argv, ambiente de Pane, banco, Decisions, brief, saída de ações.
- Registro em `STATUS.md` e atualização de `05-CONTRATOS.md`, `04-UI-UX.md` e `AGENTS.md` pelo coordenador (faz parte do fechamento).

## Princípios

1. **Leveza e velocidade acima de tudo.** `Router.resolve` determinístico lê só cache e o banco quente (P-102); nada de rede no caminho;
   leitura de limites fora do event loop, no máximo **1 leitura por conta a cada 60 s**, só com foco (D-112); gráficos em SVG próprio; eventos coalescidos.
2. **O app não revende tokens e usa o login de cada CLI.** Cada conta é um config dir isolado (T-02.04). O ADE nunca faz login, nunca lê token,
   chave de API, keychain, `auth.json` nem `.credentials.json` das CLIs (D-57). Sem dado, o dado é **desconhecido** e a conta é rebaixada, nunca promovida.
   A chave OpenRouter é do dono, informada por ele e guardada só no cofre do SO.
3. **Custo/limite desconhecido NUNCA vira zero nem "folga".** `used_pct: null`, `custo_usd: null` e `fonte: "nenhuma"` existem; a UI escreve "sem dado".
4. **Segredos nunca em log/argv/ambiente de Pane.** Cofre com `safeStorage` (D-59); a chave OpenRouter **nunca** vai para o ambiente do Pane: o Pane recebe
   um **token próprio, revogável e de escopo único** e fala com um proxy loopback que injeta a chave real (D-113); toda saída que pode conter segredo
   passa por `scrubber`; erro cita o **nome** da entrada, nunca o valor; payloads de IPC com segredo nunca são logados.
5. **Nada sai da máquina sem consentimento explícito do dono.** Toda rede (decisor, OpenRouter: testar chave, listar modelos, saldo, proxy) passa pelo
   **único** módulo `src/nucleo/rede/`, que exige consentimento gravado, host em allowlist, https e limites de tempo/tamanho; sem consentimento = zero conexões (D-58, D-114).
6. **Decisor externo é opcional, desligado por padrão, com fallback determinístico.** Só classifica entre **opções fechadas** (tipo de tarefa, intenção,
   modelo/esforço); nunca gera código, nunca escolhe conta, nunca decide troca; timeout curto + circuit breaker; **a regra determinística sempre vence** e serve de fallback; custo por decisão contabilizado.
7. **Uma regra, um lugar.** Conta só é escolhida em `pickAccount`; modelo/provedor equivalente só em `pickModel` (que **chama** `pickAccount`). Router, `headline_pick`,
   "mover", troca automática, perfis de agente e o Maestro usam essas duas funções (D-55, D-102).
8. **Nomes de modelo são dado, não código.** Política, equivalência e modelos OpenRouter vivem em dados; o código só conhece **faixas** (`topo`, `alto`, `medio`, `rapido`).
   Nenhum nome de modelo que não se possa confirmar entra como padrão (D-102).
9. **Explícito vence.** `pane_spawn` com `provider` informado continua exatamente como no MVP; o harness só atua quando o provedor é omitido.
10. **Trocar sem estragar nada.** Troca só em ponto seguro, nunca no meio de operação que não se retoma sem aviso (git em curso, handoff em voo, pergunta ao humano pendente);
    sempre com brief + último checkpoint, aviso de "pensamento perdido" e recibo visível (D-101).
11. **Automação segura** (D-14, D-36): troca automática por workspace, com padrão derivado da `permissao` (automático só onde o dono já optou); nada de bypass;
    nunca alterar arquivo de configuração global de CLI: override de endpoint/variáveis **só no ambiente/argv do Pane**; a Decision nunca guarda prompt completo, só o resumo enviado e o hash.

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`)

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-100 | Ciclo de leitura de limites de 5 contas (Codex: 50 MB de rollouts; Claude: 5 arquivos de statusline) | ≤ 150 ms por conta, 100% fora do main; nenhuma tarefa do main > 50 ms durante o ciclo | `tests/perf/harness.perf.test.ts`: fixtures grandes + monitor de event loop (P-12) |
| P-101 | `pickAccount` com 50 contas e `pickModel` com 5 provedores × 12 contas, 10 000 chamadas | p95 ≤ 1 ms / ≤ 2 ms (funções puras) | microbenchmark Vitest com `performance.now()` |
| P-102 | `Router.resolve` determinístico (sem decisor): classificar + política + conta/modelo + Decision gravada; `resolverPerfil(skill, etapa)` | p95 ≤ 20 ms; com decisor ligado ≤ 2 100 ms (timeout 2 000 ms) e nunca trava a UI | unidade com banco real e servidor de decisor falso; marca no main |
| P-103 | Rodapé (medidor) e topo (cota geral): snapshot novo → pixel; abrir popover | ≤ 100 ms; só medidor e chip re-renderizam; estado ≤ 1 MB | contador de renders (Profiler no teste) + `performance.mark` |
| P-104 | Leituras de limite: ≤ 1 por conta a cada 60 s (borda de subida lê na hora, o resto coalesce); sem foco = 0; consulta de saldo OpenRouter ≤ 1 por conta a cada 5 min e só com Pane OpenRouter vivo; CPU ocioso com 5 contas, 60 s | ≤ 0,5% de um núcleo | contagem de leituras/chamadas com relógio acelerado + `process.cpuUsage()` |
| P-105 | Cofre: abrir e decifrar 1 entrada; listar 200 entradas (só metadados) | ≤ 20 ms; ≤ 5 ms | unidade com cifrador falso + e2e com `safeStorage` real |
| P-106 | Tela Harness (60 linhas de política): 1ª abertura / voltar; chunk | ≤ 150 ms / p95 ≤ 50 ms; chunk ≤ 30 KB gz; JS inicial não cresce (P-08) | `npm run perf` (Playwright) + script de tamanho |
| P-107 | `avaliarTroca` (20 Panes × 10 contas) e troca ponta a ponta (decisão → novo Pane visível, CLI falsa) | p95 ≤ 1 ms / ≤ 1 s (sem a CLI; P-03 mantido) | microbenchmark + e2e com marcas |
| P-108 | Tela Consumo: 1ª abertura / voltar; gráfico (≤ 300 pontos); chunk; dependências | ≤ 200 ms / p95 ≤ 50 ms; ≤ 16 ms por gráfico; chunk ≤ 35 KB gz; **0** dependências novas; DOM ≤ 600 nós | Playwright + `PerformanceObserver` + contagem de nós + `package.json` |
| P-109 | Histórico de amostras: gravar; consultar 30 dias por conta (decimado); prever | ≤ 2 ms por lote e ≤ 1 gravação/conta/60 s; ≤ 20 ms; previsão ≤ 1 ms | unidade com banco real (10 contas × 90 dias) |
| P-110 | Proxy OpenRouter por Pane (worker thread): latência somada ao 1º byte; memória com stream de 10 MB; subida | p95 ≤ 5 ms; ≤ 5 MB acima da base (sem bufferizar corpo); 0 ms no main; ≤ 100 ms para subir, só quando há Pane OpenRouter | upstream falso local + `process.memoryUsage` + monitor de event loop |
| P-111 | Atualizar lista de modelos OpenRouter (400 modelos, ~1 MB): parse + gravação; abrir a lista; buscar | ≤ 150 ms no total com bloqueio do main ≤ 50 ms (lotes); lista virtualizada abre ≤ 150 ms; busca ≤ 50 ms | upstream falso + `longtask` + Playwright |
| P-112 | `classificarIntencao` determinístico; com decisor | p95 ≤ 5 ms; ≤ 2 100 ms (timeout 2 000 ms) | unidade + servidor de decisor falso |

Regras herdadas: debounce de 300 ms nos observadores; `fs` sempre assíncrono; listas virtualizadas acima de 100 linhas; IPC em lotes (eventos de limites no máximo 1 a cada 500 ms por conta).

## Arquitetura

```
src/compartilhado/
  limites.ts           LimitSnapshot, AccountUsage, JanelaLimite, BaldeModelo, CotaGeral, AmostraLimite, EventoLimites (D-56)
  harness.ts           Faixa, Executor, Politica, PedidoDeRota, ResultadoDeRota, Decisao, ConfigHarness, ConfigDecisor, PerfilAgente, Troca,
                       ResultadoIntencao, ModeloOpenRouter, EstadoOpenRouter, EntradaCofre (sem valor)
  ipc.ts               + canais limites:* harness:* cofre:* provedores:openrouter_* (T-09.01; lista fechada + validadores)
src/nucleo/rede/       cliente-http.ts (ÚNICO uso de fetch; https; allowlist de host; consentimento; timeout; teto de bytes; sem redirect entre hosts; stream())
src/nucleo/limites/
  derivar.ts · agregar.ts · validar.ts · servico.ts (LimitsService) · historico.ts · padroes-limite.ts · scripts/statusline-claude.mjs
  adaptadores/         adaptador.ts · codex-rollout.ts · claude-statusline.ts · manual.ts · openrouter-saldo.ts
src/nucleo/harness/
  task-types.ts · classificar.ts · etapas.json (skill+etapa → task_type, avaliador?) · equivalencia.json · equivalencia.ts · semente.ts
  escolher-conta.ts (pickAccount) · escolher-modelo.ts (pickModel) · politica.ts · roteador.ts · perfil.ts (resolverPerfil)
  intencao.ts (classificarIntencao) · troca.ts · brief.ts · decisoes.ts · recibo.ts
  decisor/             cliente.ts · formatos.ts (probs_json, openai_chat) · prompts.ts (+ .md) · resumo.ts · breaker.ts
src/nucleo/cofre/      cofre.ts · cifrador.ts (porta) · scrubber.ts · placeholders.ts
src/nucleo/openrouter/
  servico.ts           contas/chave (via cofre), testar (com ou sem salvar), modelos, saldo, preço, consentimento
  proxy/               servidor.ts (worker thread) · tokens.ts (token por Pane, HMAC, aud "or") · medidor.ts (usage do stream) · allowlist.ts
  adaptadores/         opencode.ts · aider.ts · codex.ts (a verificar) · goose.ts (desligado até entrar no catálogo) · contrato.ts
src/nucleo/mcp/tools/{harness,limites,conta}.ts      tools novas (portas em portas.ts)
src/main/
  limites.ts · cofre.ts (Cifrador sobre safeStorage; recusa backend `basic_text`) · harness.ts · openrouter.ts · proxy-worker.ts
  ipc/{limites,harness,cofre,openrouter}.ts                          canais com validadores estritos (payloads sensíveis nunca logados)
src/renderer/
  casca/MedidorLimites.tsx (rodapé, todas as páginas) · casca/CotaGeralTopo.tsx (topo)
  estado/{limites,harness,openrouter}.ts
  telas/harness/       (lazy) index · Politica · Equivalencia · ContasLimites · Decisoes · Cofre · harness.css
  telas/provedores/OpenRouter.tsx   (seção da tela Provedores; só a T-09.33 a toca)
  telas/consumo/       (lazy) index · VisaoGeral · PrevisaoEficiencia · Trocas · graficos/{Linha,Barras,Sparkline}.tsx · consumo.css
tests/perf/harness.perf.test.ts · tests/harness.e2e.test.ts · tests/fixtures/{rollout-codex,statusline-claude,openrouter}/ · tests/fixtures/cli-openrouter.mjs
```

Fronteiras: `nucleo/**` não importa Electron (cifrador, relógio e notificação por injeção); `escolher-conta.ts` só importa tipos; `escolher-modelo.ts` só tipos e `escolher-conta.ts`;
**`fetch`/`http(s).request` só em `nucleo/rede/`** (o proxy usa `rede.stream()`); só `src/main/limites.ts` toca o disco das CLIs; o servidor MCP e o proxy rodam em **worker threads**
e falam com o main por RPC (padrão de `src/main/mcp-rpc.ts`; só dados clonáveis; a chave real só existe na memória do worker durante uma requisição).

## Modelo de dados e migration

Migration `harness` — `src/nucleo/banco/migracoes/NNNN-harness.ts` (NNNN = próximo número livre na hora da execução; hoje `0003`); em transação; **nunca duas migrations em paralelo**
(o coordenador serializa). Ids ULID com prefixo (`pol_`, `dec_`, `trc_`). Datas UTC ISO com ms. Booleano = `INTEGER 0/1`.

```sql
CREATE TABLE task_type (slug TEXT PRIMARY KEY, categoria TEXT NOT NULL, rotulo TEXT NOT NULL, descricao TEXT,
  embutido INTEGER NOT NULL DEFAULT 0 CHECK (embutido IN (0,1)), criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE politica (
  id TEXT PRIMARY KEY, workspace_id TEXT REFERENCES workspace(id) ON DELETE CASCADE,        -- NULL = global
  task_type TEXT NOT NULL REFERENCES task_type(slug) ON DELETE CASCADE,
  executor_json TEXT NOT NULL,           -- {provider, cli|null, model|null, effort|null, faixa|null}
  alternativas_json TEXT NOT NULL DEFAULT '[]',
  fallback_json TEXT NOT NULL CHECK (fallback_json <> '[]'),      -- nunca vazio
  skills_json TEXT NOT NULL DEFAULT '[]', agente TEXT,
  conta_fixa_id TEXT REFERENCES conta(id) ON DELETE SET NULL,
  evitar_reservadas INTEGER NOT NULL DEFAULT 1 CHECK (evitar_reservadas IN (0,1)),
  habilitada INTEGER NOT NULL DEFAULT 1 CHECK (habilitada IN (0,1)),
  atualizado_por TEXT NOT NULL CHECK (atualizado_por IN ('usuario','mcp','semente')),
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE UNIQUE INDEX ux_politica ON politica (COALESCE(workspace_id,''), task_type);
CREATE TABLE harness_workspace (
  workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  nivel INTEGER NOT NULL DEFAULT 4 CHECK (nivel BETWEEN 1 AND 4),
  modo_troca TEXT CHECK (modo_troca IN ('manual','so_sugerir','automatico')),   -- NULL = derivar de workspace.permissao (automatico→automatico, seguro→so_sugerir)
  limiar_troca_pct INTEGER NOT NULL DEFAULT 85 CHECK (limiar_troca_pct BETWEEN 50 AND 99),
  limiar_esgotamento_pct INTEGER NOT NULL DEFAULT 100 CHECK (limiar_esgotamento_pct BETWEEN 51 AND 100),
  margem_troca_pontos INTEGER NOT NULL DEFAULT 10 CHECK (margem_troca_pontos BETWEEN 0 AND 50),
  troca_entre_provedores INTEGER NOT NULL DEFAULT 1 CHECK (troca_entre_provedores IN (0,1)),
  faixa_minima_troca TEXT NOT NULL DEFAULT 'mesma' CHECK (faixa_minima_troca IN ('mesma','uma_abaixo','qualquer')),
  espera_ponto_seguro_s INTEGER NOT NULL DEFAULT 600 CHECK (espera_ponto_seguro_s BETWEEN 30 AND 3600),
  piloto_edita_politica INTEGER NOT NULL DEFAULT 0 CHECK (piloto_edita_politica IN (0,1)),
  injetar_cofre_no_env INTEGER NOT NULL DEFAULT 0 CHECK (injetar_cofre_no_env IN (0,1)),
  atualizado_em TEXT NOT NULL, CHECK (limiar_troca_pct < limiar_esgotamento_pct));
CREATE TABLE conta_roteamento (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  reservada_modelos_json TEXT NOT NULL DEFAULT '[]', reservada_papeis_json TEXT NOT NULL DEFAULT '[]',
  workspaces_fixados_json TEXT NOT NULL DEFAULT '[]',
  auth TEXT NOT NULL DEFAULT 'desconhecida' CHECK (auth IN ('ok','expirada','desconhecida')),
  em_cooldown_ate TEXT, teto_tokens_5h INTEGER, teto_tokens_semana INTEGER,   -- tetos só para a fonte "estimado" (fase 10)
  atualizado_em TEXT NOT NULL);
CREATE TABLE pane_rota (
  pane_id TEXT PRIMARY KEY REFERENCES pane(id) ON DELETE CASCADE,
  perfil_json TEXT NOT NULL,              -- PerfilAgente efetivo {provider, cli, modelo, esforco, faixa, agente_id|null}
  task_type TEXT, decisao_id TEXT, saltos INTEGER NOT NULL DEFAULT 0, ultima_troca_em TEXT, ignorar_sugestao_ate TEXT,
  atualizado_em TEXT NOT NULL);
CREATE TABLE troca_log (
  id TEXT PRIMARY KEY, criado_em TEXT NOT NULL, workspace_id TEXT NOT NULL, mission_id TEXT, task_ref TEXT,
  pane_antigo_id TEXT, pane_novo_id TEXT, de_conta_id TEXT, para_conta_id TEXT,
  de_provedor TEXT, para_provedor TEXT, de_modelo TEXT, para_modelo TEXT, faixa TEXT,
  motivo TEXT NOT NULL CHECK (motivo IN ('consumo_alto','limite_atingido','manual')),
  modo TEXT NOT NULL CHECK (modo IN ('manual','so_sugerir','automatico')),
  tipo_troca TEXT NOT NULL CHECK (tipo_troca IN ('outra_conta','outro_provedor','faixa_inferior')),
  consumo_origem_pct REAL, consumo_destino_pct REAL,
  status TEXT NOT NULL CHECK (status IN ('sugerida','feita','ignorada','adiada','falhou')),
  adiada_por TEXT,                        -- 'trabalhando'|'operacao_git'|'handoff_em_voo'|'pergunta_pendente'
  decisao_id TEXT, recibo TEXT NOT NULL);
CREATE INDEX ix_troca_log_criado ON troca_log (criado_em DESC);
CREATE TABLE limite_manual (conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  janela TEXT NOT NULL CHECK (janela IN ('five_hour','weekly','monthly')),
  usado_pct REAL NOT NULL CHECK (usado_pct BETWEEN 0 AND 100), reinicia_em TEXT, informado_em TEXT NOT NULL, PRIMARY KEY (conta_id, janela));
CREATE TABLE limite_amostra (             -- só mudanças; retenção 90 dias
  conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  janela TEXT NOT NULL CHECK (janela IN ('five_hour','weekly','monthly','credit','modelo')),
  balde TEXT NOT NULL DEFAULT '', ts TEXT NOT NULL,
  usado_pct REAL NOT NULL CHECK (usado_pct BETWEEN 0 AND 100), reinicia_em TEXT, fonte TEXT NOT NULL,
  PRIMARY KEY (conta_id, janela, balde, ts)) WITHOUT ROWID;
CREATE TABLE limite_semana (              -- permanente (eficiência)
  semana_inicio TEXT NOT NULL, conta_id TEXT NOT NULL REFERENCES conta(id) ON DELETE CASCADE,
  janela TEXT NOT NULL CHECK (janela IN ('five_hour','weekly')),
  pico_pct REAL NOT NULL, estourou INTEGER NOT NULL DEFAULT 0 CHECK (estourou IN (0,1)),
  estouro_precoce INTEGER NOT NULL DEFAULT 0 CHECK (estouro_precoce IN (0,1)),   -- 100% com > 12 h para o reset
  amostras INTEGER NOT NULL, PRIMARY KEY (semana_inicio, conta_id, janela));
CREATE TABLE decisao (
  id TEXT PRIMARY KEY, criado_em TEXT NOT NULL,
  proposito TEXT NOT NULL CHECK (proposito IN ('selecao_conta','task_type','modelo_esforco','troca','intencao')),
  workspace_id TEXT, mission_id TEXT, pane_id TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('choice','score','boolean')),
  opcoes_json TEXT NOT NULL, probs_json TEXT, escolhida TEXT NOT NULL, confianca REAL,
  fonte TEXT NOT NULL CHECK (fonte IN ('decisor','regra','politica','explicito','fallback')),
  escolha_regra TEXT, divergiu INTEGER NOT NULL DEFAULT 0 CHECK (divergiu IN (0,1)),
  latencia_ms INTEGER,
  custo_usd REAL,                         -- NULL = desconhecido (nunca 0 por omissão)
  custo_origem TEXT CHECK (custo_origem IN ('resposta','tabela','informado','desconhecido')),
  decisor_json TEXT,                      -- {modo, host, modelo} sem chave
  resumo_enviado TEXT, resumo_hash TEXT,  -- ≤ 500 chars já redigido; NULL se nada saiu da máquina
  skills_aplicadas INTEGER NOT NULL DEFAULT 0, recibo TEXT NOT NULL);
CREATE INDEX ix_decisao_criado ON decisao (criado_em DESC);
CREATE INDEX ix_decisao_proposito ON decisao (proposito, criado_em DESC);
CREATE TABLE decisao_agregado_dia (dia TEXT NOT NULL, proposito TEXT NOT NULL, consultas INTEGER NOT NULL DEFAULT 0,
  falhas INTEGER NOT NULL DEFAULT 0, divergencias INTEGER NOT NULL DEFAULT 0, custo_usd REAL, custo_desconhecido INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, proposito));
-- OpenRouter (D-113): a "conta" OpenRouter é uma linha de `conta` com provedor 'openrouter' (sem config dir) + esta extensão
CREATE TABLE conta_openrouter (
  conta_id TEXT PRIMARY KEY REFERENCES conta(id) ON DELETE CASCADE,
  cofre_entrada_id TEXT NOT NULL,         -- referência à entrada do cofre; a chave NUNCA está no banco
  ultimos4 TEXT NOT NULL,                 -- só para a máscara da UI
  tipo TEXT NOT NULL DEFAULT 'desconhecido' CHECK (tipo IN ('pago','gratuito','desconhecido')),
  limite_usd REAL, usado_usd REAL, saldo_usd REAL, saldo_em TEXT);          -- NULL = a API não informou
CREATE TABLE openrouter_modelo (
  id TEXT PRIMARY KEY,                    -- "vendor/modelo" como a API devolve
  nome TEXT NOT NULL, contexto INTEGER, suporta_tools INTEGER, modalidades_json TEXT,
  preco_entrada_por_mtok REAL, preco_saida_por_mtok REAL,                   -- NULL = a API não informou (nunca 0)
  habilitado INTEGER NOT NULL DEFAULT 0 CHECK (habilitado IN (0,1)),
  faixa TEXT CHECK (faixa IN ('topo','alto','medio','rapido')), ordem INTEGER NOT NULL DEFAULT 100,
  tipos_permitidos_json TEXT NOT NULL DEFAULT '[]',                        -- [] = todos
  visto_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE INDEX ix_or_modelo_habilitado ON openrouter_modelo (habilitado, faixa, ordem);
```

Fora do banco: `config` — `decisor` (`habilitado=false`, `modo: "jev_direto"|"jev_openrouter"|"openai_compat"`, `formato: "probs_json"|"openai_chat"`, `endpoint` (https; jev_direto/openai_compat), `modelo` (jev_openrouter/openai_compat),
`conta_openrouter_id`, `chave_ref` (nome da entrada do cofre; jev_direto/openai_compat), `usar_para{task_type,modelo_esforco,intencao}=false`, `confianca_minima=0.5`, `timeout_ms=2000`, `custo_por_decisao_usd|null`, `alerta_diario=1000`,
`consentimento{host, modo, em}|null`); `openrouter` (`habilitado=false`, `consentimento_em|null`, `clis_preferidas:["opencode","aider"]`, `atualizar_saldo=true`); `harness.provedores_preferidos` (ordem; `openrouter` por último por padrão);
`harness.equivalencia` (só as diferenças do usuário); `harness.meta_aproveitamento_pct=90`; `limites.claude_statusline=true`. Cofre em `<userData>/cofre.json` (0600, atômico; metadados em claro, valor cifrado por `safeStorage`);
statusline do Claude em `<userData>/limites/claude/<conta_id>.json` (0600); checkpoints em `.expxv/missoes/<mission_id>/checkpoints/<pane>.md`.

### `equivalencia.json` (versionado; o coordenador atualiza os nomes concretos)

```json
{ "versao": 1, "faixas": ["topo","alto","medio","rapido"], "ordem_de_descida": ["topo","alto","medio","rapido"],
  "provedores": {
    "claude": { "topo": [{"modelo":"opus","esforco":null}], "alto": [{"modelo":"sonnet","esforco":null}],
                "medio": [{"modelo":"sonnet","esforco":null}], "rapido": [{"modelo":"haiku","esforco":null}] },
    "codex":  { "topo": [{"modelo":"default","esforco":null}], "alto": [{"modelo":"default","esforco":null}],
                "medio": [{"modelo":"default","esforco":null}], "rapido": [{"modelo":"default","esforco":null}] },
    "gemini": {"...":"idem codex"}, "opencode": {"...":"idem"}, "aider": {"...":"idem"}, "qwen": {"...":"idem"}, "kilo": {"...":"idem"},
    "openrouter": { "topo": [], "alto": [], "medio": [], "rapido": [] } } }
```
Cada faixa é uma **lista ordenada** (o primeiro é o preferido). Só o que o catálogo já confirma tem nome concreto (`opus|sonnet|haiku` do Claude; `default` = "o que a CLI escolher"); o resto fica `default` até o
coordenador/dono preencher (P-101). Lista vazia = "este provedor não tem equivalente aqui" (é pulado). **`openrouter` nasce vazio**: suas faixas vêm dos modelos que o dono habilita e classifica
(`openrouter_modelo.faixa`/`ordem`) e entram na tabela efetiva em tempo de leitura. O usuário edita na aba **Equivalência**; só as diferenças vão para `config`; "restaurar padrão" apaga o override.

## Contratos novos (o coordenador os adiciona em `src/compartilhado/` e em `05-CONTRATOS.md`)

### Schema único de limites (D-56)

```ts
// src/compartilhado/limites.ts — snake_case em inglês: schema compartilhado com o MCP (sem mapeamento)
export type JanelaKind = "five_hour" | "weekly" | "monthly" | "credit";   // credit = saldo/limite em USD (OpenRouter); sem reset
export interface JanelaLimite { kind: JanelaKind; used_pct: number | null; resets_at: string | null }   // 0..100 ou null = desconhecido
export interface BaldeModelo  { used_pct: number | null; resets_at: string | null; kind: JanelaKind }
export type FonteLimite = "claude_statusline" | "codex_rollout" | "openrouter_api" | "manual" | "estimado" | "nenhuma";
export type ConfiancaLimite = "medido" | "manual" | "estimado" | "desconhecido";
export interface LimitSnapshot {
  account_id: string; provider: string;
  fetched_at: string;                 // quando o DADO foi observado (não quando o app leu)
  fonte: FonteLimite; confianca: ConfiancaLimite; status: "ok" | "unavailable" | "auth_error";
  windows: JanelaLimite[];
  model_buckets: Record<string, BaldeModelo>;
  credit?: { limit_usd: number | null; used_usd: number | null; remaining_usd: number | null };   // só contas de crédito
}
export interface AccountUsage extends LimitSnapshot {            // derivado por derivarUso(); nunca persistido
  bottleneck: JanelaKind | null; slack_pct: number | null; idade_s: number; vencidas: JanelaKind[];
}
export interface CotaGeral {
  pior: { conta_id: string; rotulo: string; kind: JanelaKind; used_pct: number } | null;
  folga_media_pct: number | null;     // média das slack_pct só das contas COM dado
  cobertura: { com_dado: number; total: number };   // "3/4": nunca esconder conta sem dado
  em_alerta: number; esgotadas: number;
}
export interface AmostraLimite { conta_id: string; janela: JanelaKind | "modelo"; balde: string; ts: string; usado_pct: number; reinicia_em: string | null }
export interface PrevisaoZerar { janela: JanelaKind; atual_pct: number | null; ritmo_pct_por_hora: number | null;
  zera_em: string | null; antes_do_reset: boolean; confianca: "insuficiente" | "baixa" | "media" | "alta" }
export interface EficienciaSemana { semana_inicio: string; conta_id: string; pico_pct: number; estourou: boolean; estouro_precoce: boolean; meta_atingida: boolean }
export type EventoLimites =
  | { tipo: "atualizado"; contas: string[] }                                                                   // coalescido (≤ 1 / 500 ms)
  | { tipo: "consumo_alto"; conta_id: string; janela: JanelaKind | "modelo"; used_pct: number }                // cruzou limiar_troca subindo
  | { tipo: "limite_atingido"; conta_id: string; janela: JanelaKind | "modelo"; pane_id: string | null; fonte: "medido" | "saida_do_pty" }
  | { tipo: "provedor_indisponivel"; provider: string; motivo: string };
```
Invariantes: `0 ≤ used_pct ≤ 100` ou `null`; `bottleneck`/`slack_pct` só de janelas **não vencidas e não nulas**; janela `credit` não tem `resets_at` (⇒ ordena **depois** das que resetam em `expires_first`:
assinatura que expira é gasta antes do crédito pago); `used_pct` de `credit` = `used/limit*100` só se há limite, senão `null`; `confianca` nunca é `medido` se `fonte ∈ {estimado, nenhuma}`; `fetched_at` nunca no futuro.

### Política, faixas, rota, troca, perfis e intenção

```ts
export type Faixa = "topo" | "alto" | "medio" | "rapido";
/** provider = id de ROTEAMENTO: um id de CLI do catálogo ou "openrouter". Com "openrouter", `cli` é a CLI que será lançada (opencode, aider, …). */
export interface Executor { provider: string; cli: string | null; model: string | null; effort: string | null; faixa: Faixa | null }
export interface Politica { id: string; workspace_id: string | null; task_type: string; executor: Executor; alternativas: Executor[]; fallback: Executor[] /* ≥ 1 */;
  skills: string[]; agente: string | null; conta_fixa_id: string | null; evitar_reservadas: boolean; habilitada: boolean;
  atualizado_por: "usuario" | "mcp" | "semente"; atualizado_em: string }
export type FonteDecisao = "decisor" | "regra" | "politica" | "explicito" | "fallback";
export interface PedidoDeRota { workspace_id: string; origem: "piloto" | "usuario" | "mcp" | "metodo"; descricao: string | null; task_type: string | null; modo_rota: "auto" | "nenhuma";
  explicito: { provider?: string; cli?: string; model?: string; effort?: string; account_id?: string; skills?: string[]; agent?: string };
  mission_id: string | null; pane_pai_id: string | null; papel: Papel; excluir_provedores?: string[] }
export interface ResultadoDeRota { executor: Executor; conta_id: string | null; task_type: string; decisoes: string[];
  fontes: { task_type: FonteDecisao; executor: FonteDecisao; conta: FonteDecisao }; recibo: string; avisos: string[]; skills_aplicadas: boolean }
export type ErroRoteamento = "executor_disabled" | "no_capacity" | "unknown_task_type" | "provider_unavailable" | "invalid_effort" | "no_compatible_cli" | "model_not_enabled" | "openrouter_not_consented";
export type ModoTroca = "manual" | "so_sugerir" | "automatico";
export interface PerfilAgente { agente_id: string | null; provider: string; cli: string | null; modelo: string | null; esforco: string | null; faixa: Faixa }   // Fase 14 cria; Fase 9 resolve
export interface Troca { id: string; criado_em: string; status: "sugerida" | "feita" | "ignorada" | "adiada" | "falhou"; motivo: "consumo_alto" | "limite_atingido" | "manual"; modo: ModoTroca;
  tipo_troca: "outra_conta" | "outro_provedor" | "faixa_inferior";
  de: { conta_id: string | null; provedor: string; modelo: string | null }; para: { conta_id: string | null; provedor: string; modelo: string | null };
  consumo_origem_pct: number | null; consumo_destino_pct: number | null; adiada_por: string | null; recibo: string }

// Pontos de integração (D-111, D-115) — única entrada que as Fases 14 (squads) e 16 (Maestro) precisam
export function resolverPerfil(perfil: PerfilAgente, ctx: ContextoPerfil): Promise<ResultadoDeRota>;                  // squads: agente → conta/modelo efetivos
export function resolverPerfil(skill: string, etapa: string, ctx: ContextoPerfil): Promise<ResultadoDeRota>;          // Maestro: (skill, etapa) → task_type (etapas.json) → Router
export interface ContextoPerfil { workspace_id: string; papel: Papel; mission_id: string | null; implementador_provedor?: string | null; excluir?: string[] }
export interface OpcaoIntencao { id: string; descricao: string; palavras?: string[] }       // lista FECHADA; o decisor nunca inventa opção
export interface ContextoIntencao { workspace_id: string; opcoes?: OpcaoIntencao[]; /* padrão: gestos do método */ trabalho_ativo?: { tipo: string; estagio: string } | null; resumo_projeto?: string | null }
export interface ResultadoIntencao { intencao: string; confianca: number; fonte: "decisor" | "regra" | "fallback"; decisao_id: string | null; alternativas: Array<{ id: string; p: number }> }
export function classificarIntencao(texto: string, contexto: ContextoIntencao): Promise<ResultadoIntencao>;
```
`classificarIntencao`: heurística de palavras (PT/EN, pesos em dado) + pistas do estado do método; decisor opcional (só se ligado, consentido e `usar_para.intencao`); `intencao ∈ opcoes` sempre; decisor ligado que falha ⇒ `fonte:"fallback"`;
decisor desligado ⇒ `fonte:"regra"`; confiança da regra = score normalizado; texto de entrada ≤ 2 000 chars; nunca lança.

### OpenRouter

```ts
export interface ModeloOpenRouter { id: string; nome: string; contexto: number | null; suporta_tools: boolean | null;
  preco_entrada_por_mtok: number | null; preco_saida_por_mtok: number | null;
  habilitado: boolean; faixa: Faixa | null; ordem: number; tipos_permitidos: string[] }
export type StatusAdaptadorCli = "verificado" | "a_verificar" | "desligado";
export interface EstadoOpenRouter { habilitado: boolean; consentimento_em: string | null;
  contas: Array<{ conta_id: string; rotulo: string; ultimos4: string; tipo: "pago" | "gratuito" | "desconhecido";
                  limite_usd: number | null; usado_usd: number | null; saldo_usd: number | null; saldo_em: string | null }>;
  modelos: { total: number; habilitados: number; atualizados_em: string | null };
  clis: Array<{ cli: string; instalada: boolean; status: StatusAdaptadorCli }>; proxy: { ativo: boolean } }
```
Adaptador de CLI (`nucleo/openrouter/adaptadores/*`): `montar({ modelo, baseUrl, tokenPane }) → { argumentos: string[]; ambiente: Record<string,string>; arquivo_temporario?: {nome, conteudo} }` — **só** argv/ambiente/arquivo 0600 do Pane
(nunca edita configuração global; teste compara o hash dos arquivos de configuração do usuário antes e depois); o "token" que a CLI usa como chave de API é o token do Pane, **não** a chave OpenRouter.

### Assinaturas de `pickAccount` e `pickModel` (D-55, D-102)

```ts
export interface CandidataConta { conta_id: string; provedor: string; habilitada: boolean; auth: "ok" | "expirada" | "desconhecida";
  reservada_modelos: string[]; reservada_papeis: Papel[]; fixada_em: string[]; cooldown_ate: string | null; uso: AccountUsage | null }
export interface OpcoesPick { modelo: string | null; papel: Papel; workspace_id: string; agora: number /*epoch ms*/;
  limiar_esgotamento_pct: number /*100*/; limiar_troca_pct: number /*85*/; estrategia: "expires_first" | "max_slack";
  janela: "five_hour" | "weekly" | "auto"; conta_fixa_id: string | null; evitar_reservadas: boolean; excluir: string[] }
export type MotivoDescarte = "desabilitada" | "auth" | "reservada" | "cooldown" | "esgotada" | "modelo_esgotado" | "fora_do_pin" | "excluida";
export interface ResultadoPick { escolhida: string | null;
  ranking: Array<{ conta_id: string; tier: 1 | 2 | 3 | 4; chave: Array<number | string>; motivo: string }>;
  descartadas: Array<{ conta_id: string; motivo: MotivoDescarte }> }
export function pickAccount(candidatas: readonly CandidataConta[], opcoes: OpcoesPick): ResultadoPick;

export interface ModeloEquivalente { modelo: string | null; esforco: string | null }
export interface EntradaEquivalencia { faixas: Faixa[]; ordem_de_descida: Faixa[]; provedores: Record<string, Partial<Record<Faixa, ModeloEquivalente[]>>> }
export interface OpcoesModelo extends Omit<OpcoesPick, "modelo" | "excluir" | "conta_fixa_id"> {
  atual: { provedor: string; conta_id: string | null; modelo: string | null; faixa: Faixa };
  provedores_viaveis: string[];            // habilitados e instalados (openrouter só com consentimento e ≥ 1 modelo habilitado), na ordem de preferência
  clis_openrouter: string[];               // CLIs instaladas com adaptador não "desligado", na ordem de `clis_preferidas`; vazio ⇒ openrouter é pulado ("sem_cli_compativel")
  task_type: string | null;                // modelos OpenRouter com `tipos_permitidos` não vazio só valem para esses tipos
  trocando: boolean;                       // true = já está numa conta (exige melhora pela margem); false = abertura de Pane
  permitir_outro_provedor: boolean; faixa_minima: "mesma" | "uma_abaixo" | "qualquer"; margem_troca_pontos: number;
  excluir_contas: string[]; conta_fixa_id: string | null }
export interface ResultadoModelo {
  escolhida: { provedor: string; cli: string; modelo: string | null; esforco: string | null; conta_id: string; faixa: Faixa } | null;
  motivo: "mesma_conta_ok" | "outra_conta" | "outro_provedor" | "faixa_inferior" | "sem_alternativa";
  ranking: Array<{ provedor: string; modelo: string | null; faixa: Faixa; conta_id: string; tier: 1 | 2 | 3 | 4 }>;
  picks: Record<string, ResultadoPick> }
export function pickModel(contasPorProvedor: Readonly<Record<string, readonly CandidataConta[]>>, equiv: EntradaEquivalencia, opcoes: OpcoesModelo): ResultadoModelo;
```

### Canais IPC (lista fechada; validador estrito por canal)

| Canal | Tipo | Entrada → saída |
|---|---|---|
| `limites:snapshot` | invoke | `{conta_ids?}` → `{contas: AccountUsage[], geral: CotaGeral}` (do cache; nunca espera I/O) |
| `limites:atualizar` | invoke | `{conta_id?}` → idem (≤ 1 leitura por conta a cada 5 s; botão do usuário) |
| `limites:manual_definir` / `limites:manual_limpar` | invoke | `{conta_id, janela, usado_pct 0..100, reinicia_em\|null}` / `{conta_id, janela?}` → `AccountUsage` |
| `limites:historico` / `limites:previsao` / `limites:eficiencia` / `limites:alertas` | invoke | `{conta_id, janela, desde, ate, max_pontos≤300}` → `AmostraLimite[]`; `{conta_id}` → `PrevisaoZerar[]`; `{conta_id?, semanas≤26}` → `EficienciaSemana[]`; `{}` → alertas `{tipo: consumo_alto\|vai_estourar\|cota_sobrando\|sem_dado, conta_id, texto, desde}` |
| `limites:evento` | evento | `EventoLimites` |
| `harness:config_ler` / `harness:config_gravar` | invoke | `{workspace_id}` ↔ colunas de `harness_workspace` |
| `harness:task_types_listar` / `_gravar` / `_apagar` | invoke | `{}` → `TaskType[]`; `{slug, categoria, rotulo, descricao}`; `{slug}` (só não embutidos) |
| `harness:politica_listar` / `_gravar` / `_restaurar_semente` | invoke | `{workspace_id\|null}` → `Politica[]` efetivas; `Politica` sem `id/atualizado_*` → `Politica` ou `executor_disabled`/`invalid_effort`/`no_compatible_cli`; `{workspace_id\|null, task_type?}` |
| `harness:equivalencia_ler` / `_gravar` / `_restaurar` | invoke | `{}` → `{padrao, efetiva, diferencas}`; `{provedores:{<id>:{<faixa>:ModeloEquivalente[]}}}`; `{}` |
| `harness:recomendar` | invoke | `{workspace_id, descricao}` → resumo de `ResultadoDeRota` (não cria Pane) |
| `harness:decisoes_listar` | invoke | `{desde?, proposito?, cursor?, limite≤200}` → `{itens: Decisao[], proximo, totais:{consultas, custo_usd\|null, custo_desconhecido}}` |
| `harness:contas_config_gravar` | invoke | `{conta_id, reservada_modelos, reservada_papeis, workspaces_fixados, teto_tokens_5h?, teto_tokens_semana?}` |
| `harness:trocas_listar` / `harness:troca_decidir` / `harness:mover_pane` | invoke | `{desde?, cursor?, limite≤200}` → `{itens: Troca[], proximo}`; `{troca_id, acao: aceitar\|ignorar\|adiar_30min}` → `Troca`; `{pane_id, conta_alvo_id?}` → `{novo_pane_id, de, para}` (botão "mover": manual, ignora o modo) |
| `harness:decisor_ler` / `harness:decisor_gravar` / `harness:decisor_testar` | invoke | config **sem chave** (`modo, formato, endpoint, modelo, conta_openrouter_id, chave_ref, usar_para, confianca_minima, timeout_ms, custo_por_decisao_usd, alerta_diario, consentimento`); `gravar` com `habilitado:true` exige `consentimento:{host, modo}` confirmado; `testar` `{chave?: string}` → `{ok, latencia_ms, motivo?}`: **única chamada de rede por botão**; com `chave` usa o valor uma vez e **não o grava** |
| `harness:classificar_intencao` / `harness:resolver_perfil` | invoke | `{texto, contexto}` → `ResultadoIntencao`; `{skill, etapa, ctx}` ou `{perfil, ctx}` → `ResultadoDeRota` (para a UI do Maestro; só leitura, não cria Pane) |
| `provedores:openrouter_estado` | invoke | `{}` → `EstadoOpenRouter` (nunca inclui chave) |
| `provedores:openrouter_consentir` / `provedores:openrouter_revogar` | invoke | `{consentimento:true, versao_texto}` / `{}` (revogar para o proxy, invalida tokens de Pane, mantém contas e modelos) |
| `provedores:openrouter_chave_gravar` / `provedores:openrouter_chave_apagar` | invoke | `{conta_id?, rotulo, chave}` → conta com `ultimos4` (a chave entra **uma vez**, vai direto ao cofre e nunca volta); `{conta_id}` |
| `provedores:openrouter_testar` | invoke | `{conta_id?: string, chave?: string}` → `{ok, tipo, limite_usd\|null, saldo_usd\|null, latencia_ms, motivo?}` — **testar sem salvar**: com `chave` no payload, usa uma vez, não persiste (cofre e banco intactos); exige consentimento e clique |
| `provedores:openrouter_modelos_atualizar` | invoke | `{conta_id?}` → `{total, novos, removidos}` — **só por clique** (nunca no boot nem periódico) |
| `provedores:openrouter_modelos_listar` / `provedores:openrouter_modelo_gravar` | invoke | `{busca?, so_habilitados?, cursor?, limite≤100}` → `{itens: ModeloOpenRouter[], proximo, total}`; `{id, habilitado, faixa\|null, tipos_permitidos[], ordem}` |
| `provedores:openrouter_saldo_atualizar` | invoke | `{conta_id?}` → `EstadoOpenRouter` (clique; ≤ 1 por conta a cada 5 s) |
| `cofre:disponivel` / `cofre:listar` / `cofre:gravar` / `cofre:apagar` | invoke | `{ok, motivo?}`; metadados `{id, nome, escopo, workspace_id, sensivel, ultimo_uso_em}`; `gravar` recebe o valor **uma vez** e nunca o devolve |

Canais que carregam segredo no payload (`openrouter_chave_gravar`, `openrouter_testar`, `decisor_testar`, `cofre:gravar`) são marcados `sensivel` no registro de IPC: o log do registro nunca imprime o payload (teste com sentinela).
O renderer nunca envia caminho, URL arbitrária (o host do decisor é validado contra o consentimento) nem `cwd`. Nenhum canal devolve o valor de uma chave.

### Eventos de domínio (barramento interno)
`limits.updated`, `limit.high`, `limit.reached`, `account.switched{pane_antigo, pane_novo, de, para, motivo, modo}`, `switch.suggested`, `decision.made`, `policy.changed{task_type, por}`, `vault.changed{entry_id}`,
`openrouter.models_updated`, `usage.observed{pane_id, provedor:"openrouter", modelo, tokens_in, tokens_out, usd|null, ts}` (do proxy; a Fase 10 ingere como fonte de uso medido).

### Tools MCP (nomes em inglês `snake_case`; identidade vem do token; filtradas por modo/papel)

| Tool | Entrada | Saída / erros |
|---|---|---|
| `harness_list` | `{category?}` | `{task_types:[{slug, category, label, executor, alternates[], fallback[], enabled}]}` só de provedores habilitados |
| `harness_recommend` | `{task_description}` | `{task_type, confidence, executor, account_id, source:"decider\|heuristic\|rule", receipt}`; não cria Pane |
| `harness_set` *(opt-in `piloto_edita_politica`)* | `{task_type, provider, cli?, model?, faixa?, effort?, fallback?[]}` | `{policy}`; erros `executor_disabled`, `invalid_effort`, `unknown_task_type`, `no_compatible_cli`, `forbidden_role` |
| `decisions_list` | `{since?, purpose?, limit?≤200}` | `{decisions[], totals:{count, cost_usd\|null}}` |
| `headline_limits` | `{provider?}` | `{accounts: AccountUsage[], overall: CotaGeral}` (inclui contas `openrouter` com janela `credit`; nunca caminho nem chave) |
| `headline_pick` | `{provider, window?:"five_hour\|weekly\|auto", strategy?:"expires_first\|max_slack", model?}` | `{account_id, slack_pct\|null, reason, strategy}`; erro `unavailable/no_account_available` |
| `account_switch` | `{pane_id, target_account_id?, reason?, force?}` | `{new_pane_id, from, to}`; erros `no_capacity`, `not_at_limit`, `provider_mismatch`, `forbidden_role`, `rule_violation/limit_reached` (2 saltos) |
| `model_list` (alterada) | `{provider}` | com `provider:"openrouter"`: só modelos **habilitados** `{model, faixa, effort_levels:[]}`; sem consentimento ⇒ `provider_disabled` |
| `pane_spawn` (alterada) | `provider` **opcional** com `route:"auto"`; + `route?:"auto\|none"`, `cli?` (com `provider:"openrouter"`), `task_type?`, `task_description?`, `faixa?` | `{pane_id, receipt?, decisions?[]}` (recibo ≤ 240 chars); `provider:"openrouter"` com modelo não habilitado ⇒ `rule_violation/model_not_enabled`; sem CLI compatível ⇒ `unavailable/no_compatible_cli` |

Subcodes novos: `no_capacity`, `executor_disabled`, `unknown_task_type`, `invalid_effort`, `not_at_limit`, `provider_mismatch`, `no_account_available`, `no_compatible_cli`, `model_not_enabled`, `openrouter_not_consented`.
Matriz (em `src/nucleo/mcp/catalogo.ts`): **livre** — nenhuma nova; **squad** — `harness_list`, `headline_limits`; **agêntico** — todas, exceto `harness_set` (só com o opt-in); **workers** — continuam só `handoff_submit`.
Nenhuma tool devolve segredo, caminho absoluto de dado das CLIs nem valor de cofre.

## Tarefas

Formato: `T-09.NN · título` — entrega · aceite binário · depende. Todas seguem TDD (no mínimo um teste de caminho feliz e um de borda/erro) e `npm run verificar` verde; as de UI herdam os orçamentos e o requisito D-32 (cromado mínimo). Áreas de arquivo disjuntas entre colchetes.

### 9A — Contratos e limites  [A: `src/nucleo/limites/**`, `src/main/limites.ts`, `src/main/ipc/limites.ts`]

- **T-09.01 · Contratos e tipos** — `src/compartilhado/{limites,harness}.ts`, canais novos em `src/compartilhado/ipc.ts`, validadores estritos em `src/main/ipc/{limites,harness,cofre,openrouter}.ts` (só validador), marca `sensivel` no registro de IPC, espelho inline no preload (D-30) + teste de paridade. Testes: cada validador recusa campo extra, tipo errado, `usado_pct` fora de 0..100, `limiar_troca_pct ≥ limiar_esgotamento_pct`, faixa desconhecida, URL/caminho no payload, `endpoint` não-https. Aceite: `npm run typecheck` e o teste de paridade preload↔`ipc.ts` verdes; nenhum canal sem validador; o log do registro de IPC não imprime payload de canal `sensivel` (sentinela). · F3.
- **T-09.02 · Migration `harness` e repositórios** — `NNNN-harness.ts` + `src/nucleo/banco/repos/{politica,task-type,decisao,harness-workspace,conta-roteamento,pane-rota,troca-log,limite-manual,limite-amostra,conta-openrouter,openrouter-modelo}.ts`. Aceite: aplica em banco vazio e em banco do MVP com dados; `fallback_json='[]'` e `limiar_troca ≥ limiar_esgotamento` rejeitados pelo CHECK; unicidade `(workspace, task_type)`; consulta quente ≤ 5 ms (P-14). · T-09.01.
- **T-09.03 · `derivarUso`, `agregarCotas` e normalização** — `limites/{derivar,agregar,validar}.ts`. `derivarUso(snapshot, agora)` marca janelas vencidas (`resets_at ≤ agora`) como desconhecidas e calcula `bottleneck`, `slack_pct`, `idade_s`; janela `credit`: `used_pct = used/limit*100` só com limite informado; `agregarCotas(usos)` → `CotaGeral` (pior caso; folga média **só das contas com dado**; `cobertura` sempre visível); `normalizarSnapshot(bruto, conta)` aceita chaves alternativas (`used_percentage|used_percent|utilization`, `resets_at` em epoch s/ms ou ISO, `resets_in_seconds`) e **nunca lança**.
  Aceite: tabela de 25 formatos (válidos, parciais, lixo, escala 0–1 × 0–100 ambígua → `desconhecido`, `NaN`, negativo, > 100); `agregarCotas` com 4 contas e 1 sem dado → `cobertura 3/4` e folga média das 3; conta de crédito sem limite → `used_pct:null`; nenhum caminho devolve `0` por omissão. · T-09.01.
- **T-09.04 · `LimitsService`** — `limites/servico.ts`, `adaptadores/adaptador.ts`. Cache por conta; `snapshot()` síncrono; **leitura de adaptador no máximo 1 a cada 60 s por conta** (a primeira mudança depois de 60 s de calma lê na hora; as seguintes coalescem numa leitura final aos 60 s; `atualizar()` do usuário no máximo a cada 5 s); adaptadores de **rede** (saldo OpenRouter) declaram `intervalo_min_s: 300` e só rodam com o backend consentido e Pane vivo; só com a janela em foco (sem foco = 0 leituras);
  merge: o dado **mais recente** vence, empate por `medido > manual > estimado`; breaker por adaptador (3 falhas → 5 min de silêncio + `provedor_indisponivel`); eventos coalescidos 500 ms; emite `consumo_alto` ao cruzar `limiar_troca_pct` subindo e `limite_atingido` ao cruzar `limiar_esgotamento_pct` (histerese de 5 pontos).
  Aceite: adaptador travado é abortado por `AbortSignal` em 2 s sem bloquear os outros; 100 `atualizar()` seguidos = 1 leitura; relógio acelerado confirma ≤ 1 leitura/conta/60 s e ≤ 1 consulta de saldo/conta/5 min (P-104); `parar()` limpa timers. · T-09.03.
- **T-09.05 · Adaptador Codex (rollout)** — `adaptadores/codex-rollout.ts`. Em `<CODEX_HOME da conta>/sessions/**`, lista datas em ordem decrescente, lê **só o final** (64 KB) dos 3 rollouts mais recentes e extrai o último `rate_limits` de evento `token_count` (`window_minutes`: 300→`five_hour`, 10080→`weekly`, 43200→`monthly`; outro valor ignora a janela; formato **a verificar na CLI instalada**, contrato por fixture). Nunca lê `auth.json`.
  Aceite: fixtures gravadas (com/sem `rate_limits`, linha final truncada, arquivo de 50 MB) → snapshot correto ou `null`; P-100; conta sem pasta → `null` (não erro). · T-09.04.
- **T-09.06 · Adaptador Claude (statusline por Pane)** — `adaptadores/claude-statusline.ts` + `scripts/statusline-claude.mjs` + gerador do trecho `statusLine` do settings por Pane (junta-se aos demais por `juntarSettingsDoClaude`). O script lê o JSON do stdin, grava **só** `{v:1, recebido_em, rate_limits, model}` em `<userData>/limites/claude/<conta_id>.json` (0600, atômico, caminho por variável de ambiente do Pane) e imprime uma linha curta (`5h 62% · 7d 31%`); sem rede e sem ler arquivo algum além do stdin.
  Mapeia `five_hour`, `seven_day`→`weekly` e `seven_day_<familia>`→`model_buckets[<familia>]` (formato **a verificar**; campo ausente → `null`). Opt-out em `config` (`limites.claude_statusline`). Aceite: caminho com espaços funciona; script sem `rate_limits` não quebra a CLI nem grava lixo; dois Panes da mesma conta não corrompem o arquivo; settings do usuário intactos. · T-09.04, F3 (hooks por Pane).
- **T-09.07 · Detecção de limite na saída do PTY** — `limites/padroes-limite.ts` (+ fixtures por CLI). Procura, no fluxo já lido pelo serviço de terminais (sem segundo parser), frases de limite atingido por CLI; gera `limite_atingido{fonte:"saida_do_pty"}` e marca a conta com `em_cooldown_ate` (hora da frase quando houver, senão +5 min).
  Aceite: frases reais gravadas (Claude, Codex) detectadas; a frase **no eco do próprio prompt/bloco de código** não dispara (só linhas de saída da CLI após o último envio); ≤ 0,2 ms por chunk de 64 KB. · T-09.04.
- **T-09.08 · Ligação no main, IPC `limites:*` e limite manual** — `src/main/limites.ts`, `src/main/ipc/limites.ts`, `adaptadores/manual.ts`. Boot na onda 2; watchers de arquivo só **marcam a conta como "suja"** (debounce 300 ms); a leitura obedece T-09.04; ciclo só com foco; mudança de conta/Pane reidrata; devolve `{contas, geral}`. Limite manual: o dono informa "usado X%, reinicia em Y" por janela (confiança `manual`, expira quando `resets_at` passa).
  Aceite: P-104; evento `atualizado` ≤ 600 ms depois de uma leitura; nenhuma tarefa > 50 ms (P-12); valor manual sobrevive a reinício e some do merge quando um medido mais novo chega; fechar a janela principal para o ciclo. · T-09.05, T-09.06, T-09.07.
- **T-09.09 · Histórico, previsão, eficiência e alertas** — `limites/historico.ts` + repositório. Grava `limite_amostra` **só quando muda ≥ 1 ponto ou passam 10 min** (≤ 1 gravação por conta/60 s, lote em uma transação); decimação em SQL (≤ 300 pontos); retenção 90 dias; ao encerrar a semana grava `limite_semana`. `preverZerar(amostras, janela, agora)`: só amostras do ciclo atual, regressão linear nos últimos 60 min (5 h) ou 24 h (semanal) misturada por média móvel exponencial (0,5) com o ritmo médio do ciclo; exige ≥ 3 amostras e ≥ 15 min (5 h) / 6 h (semanal), senão `insuficiente`; ritmo ≤ 0 ⇒ `zera_em:null`. Janela `credit`: previsão por gasto/dia.
  Alertas puros: `consumo_alto`, `vai_estourar` (`zera_em` antes do reset e em < 2 h na 5 h / < 24 h na semanal), `cota_sobrando` (semanal: fração do ciclo decorrida − `used_pct` > 30 pontos e faltam < 48 h; meta 90%, P-32), `sem_dado`. Aceite: série sintética a 10 pt/h → `zera_em` ± 1 min; `< 3` amostras → `insuficiente`; reset no meio do ciclo não contamina o ritmo; P-109; alertas não repetem (1 por tipo/conta/hora). · T-09.04, T-09.02.

### 9B — Política, equivalência e roteamento  [B: `src/nucleo/harness/**` (exceto `decisor/`, `troca.ts`, `brief.ts`, `intencao.ts`), `src/nucleo/mcp/tools/{harness,limites}.ts`]

- **T-09.10 · TaskTypes, semente e classificador** — `harness/{task-types,semente,classificar}.ts`. Embutidos: `desenvolvimento` (`implementar`, `bug-fix`, `bug-profundo`, `refatorar`, `front`), `revisao` (`auditar`, `qa`, `revisar-pr`), `planejamento` (`triar`, `planejar`, `descobrir`), `docs`, `seguranca` (`pentest`), `geral`. **Gesto do método → TaskType** (D-103): `nova_feature`→`planejar`, executar task→`implementar`, `sprintx-auditoria`→`auditar`, `runx-qa`→`qa`, `nova_ocorrencia`→`bug-fix`, `pedido_cru`→`triar`, `projeto`→`planejar`.
  `gerarSemente(catalogo, preferencia, equivalencia)` **por faixa** (`planejar`/`auditar`→`topo`; `implementar`/`bug-profundo`→`alto`; `bug-fix`/`refatorar`/`front`/`qa`→`medio`; `triar`/`docs`→`rapido`; ajustável em dado) e `fallback` = faixa `topo` do primeiro provedor habilitado na ordem de preferência. Classificador: palavras-chave PT/EN com peso (dado); `{task_type, confianca}`; sem acerto → `geral` (0,2); entrada ≤ 2 000 chars; nunca lança.
  Aceite: sem Claude instalado a semente usa o que existe; `fallback` nunca vazio; `auditar` escolhe provedor ≠ do `implementar` quando há ≥ 2; 30 frases-ouro; nenhum nome de modelo literal fora de `equivalencia.json`/`catalogo.ts`. · T-09.02.
- **T-09.11 · Tabela de equivalência por faixa** — `harness/equivalencia.{json,ts}`. Carrega o arquivo versionado, aplica o override de `config`, **incorpora os modelos OpenRouter habilitados** (`openrouter_modelo.faixa/ordem`, só se `openrouter.habilitado` e consentido) e valida (faixa conhecida; provedor do catálogo ou `openrouter`; `modelo` casa `MODELO_VALIDO` de `catalogo.ts` ou id `vendor/modelo` do OpenRouter, ou é `default`; `esforco` ⊂ `niveis_esforco` ou `null`); expõe `resolverFaixa(provedor, faixa)` e `faixaDe(provedor, modelo)`.
  Aceite: override do usuário vence o arquivo; override inválido recusado com o campo; faixa vazia ⇒ provedor pulado; arquivo corrompido ⇒ usa o embutido e avisa; "restaurar" apaga o override; modelo OpenRouter desabilitado some da tabela efetiva; teste de contrato do arquivo (todos os provedores do catálogo presentes). · T-09.10.
- **T-09.12 · `pickAccount`** — `harness/escolher-conta.ts`: o algoritmo da seção "Decisões [LAC] resolvidas". Puro, sem I/O, sem `Date.now()`. Aceite: tabela de 45 casos (CT-9.01, 9.02, 9.09, empates, janela vencida, balde de modelo, reserva, pin, cooldown, sem snapshot, `max_slack`, `janela:"weekly"`, ≥ 85% → nível 3, conta de crédito ordena depois das que resetam, todas esgotadas → `escolhida:null`); P-101; propriedade: permutar a ordem das candidatas nunca muda `escolhida`; o arquivo só importa tipos. · T-09.03.
- **T-09.13 · `pickModel`** — `harness/escolher-modelo.ts`: ordem **(1) mesma conta se ainda boa → (2) outra conta do mesmo provedor → (3) modelo da mesma faixa em outro provedor (ordem de preferência; faixa vazia pula; `openrouter` só se houver CLI compatível e, para modelo com `tipos_permitidos`, só no tipo permitido) → (4) faixa inferior conforme `faixa_minima` → (5) `sem_alternativa`**; sempre chamando `pickAccount` por provedor.
  Ao `trocando`, a candidata só vale se o `used_pct` do gargalo for menor que o da atual **em pelo menos `margem_troca_pontos`** e o nível ≤ 2; nível 3 em outro provedor só se a atual estiver esgotada; `permitir_outro_provedor=false` pula outros provedores; esforço só é levado se o alvo o aceita. Aceite: tabela de 45 casos (duas contas Claude, uma estourando → outra; sem outra → topo Codex; Codex sem conta → `faixa_inferior` só se permitido; faixa vazia; OpenRouter por último e só com CLI compatível; sem outro provedor → `sem_alternativa`; margem; ping-pong); P-101; só importa tipos e `escolher-conta.ts`. · T-09.12, T-09.11.
- **T-09.14 · Serviço de Política** — `harness/politica.ts`. CRUD com override por workspace sobre a global; `gravar` recusa `executor_disabled` (provedor ou conta desabilitados; `openrouter` sem consentimento ou modelo não habilitado ⇒ `model_not_enabled`), `invalid_effort` (hoje todos os `niveis_esforco` são vazios ⇒ gravado `null` com aviso) e `no_compatible_cli`; `fallback` obrigatório; aceita `faixa` no lugar de `model`; "restaurar semente"; evento `policy.changed`.
  Aceite: gravar executor de provedor desabilitado ⇒ erro nominal e nada gravado; política antiga com provedor depois desabilitado **resolve** pelo fallback; override do workspace vence a global; as tools não listam provedores desabilitados. · T-09.10, T-09.02.
- **T-09.15 · `Router.resolve`, Decision, recibo e retenção** — `harness/{roteador,recibo,decisoes}.ts`. Fluxo: (1) `modo_rota:"nenhuma"` ou `explicito.provider` ⇒ explícito vence, só resolve conta/faixa se faltar; (2) TaskType: dado ⇒ `explicito`; senão heurística (e decisor, T-09.25); (3) candidatos = `[executor, ...alternativas, ...fallback]` seguidos dos **equivalentes por faixa** (`pickModel`, `trocando:false`), sem provedor/conta desabilitados e respeitando `excluir_provedores`; (4) `pickModel`/`pickAccount` por candidato; nenhum ⇒ próximo; todos ⇒ `no_capacity`; (5) skills (T-09.16);
  (6) grava Decision(ões) e monta o recibo: `"Conta {rotulo} escolhida por regra ({detalhe}). Tipo {task_type} ({fonte}). Folga medida: {used_pct}% usado na janela {janela}."` — sem "confiança" quando a fonte é `regra`; dado `estimado`/`desconhecido` ⇒ "sem dado de limite" (nunca 0%). Retenção: job apaga `decisao` > 90 dias depois de somar em `decisao_agregado_dia`.
  Aceite: CT-9.01, 9.02, 9.06, 9.10; P-102; `nivel 1` nunca roteia (exige `provider`); toda chamada produz ≥ 1 Decision com `chosen ∈ options`; o job duas vezes não duplica agregados e 1 000 Decisions antigas somem em lotes sem bloquear o main. · T-09.12, T-09.13, T-09.10, T-09.14.
- **T-09.16 · `pane_spawn route:auto`, skills, Missão automática e `resolverPerfil(agente)`** — tool `pane_spawn` (`mcp/tools/pane.ts`), porta `PortaHarness` em `portas.ts`, `src/main/harness.ts`, `harness/perfil.ts`. `provider` opcional com `route:"auto"` (padrão se `nivel ≥ 3`); devolve `{pane_id, receipt, decisions}` e grava `pane_rota`; skills: `skills_aplicadas=false` + lista no prompt inicial (a restrição real por flag depende do catálogo da fase 7; ponto de extensão `aplicarSkills(cli, skills) → {enforced:false}` hoje).
  **Missão "Automático"** (backend): criar Missão com CLI "Automático" resolve pelo `Router` com o `task_type` do gesto (D-103), grava a Decision (`origem:"metodo"`) e `pane_rota`. **`resolverPerfil(perfil, ctx)`** (D-111): converte `PerfilAgente {provider, cli, modelo, esforco, faixa}` num pedido por faixa e devolve conta/modelo efetivos pelo mesmo `Router`; o roteamento **por agente** vale na troca (T-09.19 usa o perfil do Pane, não o da política).
  Aceite: `pane_spawn` sem provedor cria o Pane na conta certa ≤ 300 ms (P-03); com provedor explícito o MVP é idêntico (regressão T-03.02 intacta); `route:"none"` sem provedor → `invalid_argument`; Missão automática usa o provedor da política e mostra o recibo; CT-9.25 e CT-9.26 (perfil `topo` com a conta estourada → `topo` de outro provedor; perfil `rapido` não sobe de faixa; `cli` inexistente → erro nominal). · T-09.15, F2, F3, F4.
- **T-09.17 · Tools `harness_*`, `decisions_list`, `headline_*` e prompt do piloto** — `mcp/tools/{harness,limites}.ts`, catálogo/matriz, `orquestracao/prompts/harness.md` (versionado, editável), anexado ao piloto: "não escolha CLI à mão: omita `provider` e deixe o harness rotear; consulte `headline_limits`; nunca edite política". `headline_pick` **delega a `pickAccount`** com a `estrategia` do argumento (padrão `expires_first`).
  Aceite: matriz por modo conferida em `tools/list`; `harness_set` ausente sem o opt-in; `harness_recommend` não cria Pane; casos da spec-09 (folgas 5/30/12 + `max_slack` ⇒ 30; Codex 99/40 ⇒ gargalo `five_hour`, `slack 1`; nenhuma ok ⇒ `no_account_available`); respostas ≤ 4 KB; teste de import prova que não existe segunda implementação de escolha de conta. · T-09.15, T-09.04.

### 9C — Troca por consumo  [C: `src/nucleo/harness/{troca,brief}.ts`, `src/nucleo/mcp/tools/conta.ts`]

- **T-09.18 · Brief, checkpoint por turno e `moverPane`** — `harness/brief.ts`. **Checkpoint**: ao fim de cada turno de um Pane de Missão (evento da sinaleira), grava `.expxv/missoes/<mission_id>/checkpoints/<pane>.md` (task_ref + título, branch e `status --short` ≤ 40 linhas, últimas ≤ 60 linhas **redigidas pelo scrubber**; ≤ 16 KB; ≤ 1 gravação por 30 s; sobrescreve). **Brief** (porta `ProvedorDeBrief.gerar(pane_id) → {caminho_relativo}`): contrato do card + último checkpoint + instrução de retomada; a fase 8 trocará a implementação.
  **`moverPane`**: destino por `pickModel(trocando:true)`; cria **novo Pane** (mesmo papel e `task_id`, `respawn_de = antigo`; piloto: respawn mantém o mesmo `pane_id`, T-03.06) com o brief como prompt inicial; antigo fecha com `encerrado_motivo="superseded"` (D-101); conta origem em cooldown de 5 min ou até `resets_at`; `saltos` +1 (máx. 2 por task).
  Aceite: CT-9.08 e CT-9.10; o recibo do novo Pane diz **de onde veio, por quê, o consumo e que o "pensamento" da sessão anterior não foi preservado**; sem destino ⇒ `no_capacity` e Pane antigo **intacto**; brief e checkpoint nunca contêm valor do cofre; ≤ 1 checkpoint por 30 s. · T-09.13, T-09.22, F2, F3.
- **T-09.19 · `avaliarTroca` (puro) e ponto seguro** — `harness/troca.ts`. `avaliarTroca(panes, usos, config, estadoDoMundo, agora) → Proposta[]`: gatilho = gargalo da conta do Pane (ou balde do modelo) **≥ `limiar_troca_pct`** (padrão 85; 5 h **ou** semanal; crédito OpenRouter ≥ 85% do limite) ou `limite_atingido`; destino por `pickModel`; `urgencia: alta` quando ≥ `limiar_esgotamento` ou há texto de limite. **Ponto seguro**: `estado = pronto` (turno encerrado) **ou** CLI parada no limite; e **nenhum** bloqueio: operação git em curso no worktree
  (`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `index.lock` recente), handoff em voo, pergunta/aprovação pendente ao humano (`aguardando`), Pane `bloqueado`. `trabalhando` ⇒ `adiada_por` até o fim do turno (limite `espera_ponto_seguro_s`; vencido ⇒ vira sugestão visível). Anti-vai-e-volta: ≥ 10 min entre trocas do mesmo Pane, `saltos ≤ 2`, cooldown da origem, margem de 10 pontos, `ignorar_sugestao_ate`.
  Aceite: tabela de 35 casos (CT-9.18 a 9.22); determinística (estado do mundo por parâmetro); P-107; nenhum caso troca com operação git em curso, handoff em voo ou pergunta pendente; permutar a ordem dos Panes não muda o resultado. · T-09.13, T-09.04.
- **T-09.20 · Executor da troca: modos, log, notificação e `account_switch`** — `harness/troca.ts` (executor), `mcp/tools/conta.ts`, canais `harness:{trocas_listar,troca_decidir,mover_pane}`. Modo por workspace: **`manual`** (nada sugere; o botão "mover" existe sempre), **`so_sugerir`** (grava `troca_log` `sugerida`, mostra a faixa no Pane e notifica se a janela está sem foco; 1 clique executa no próximo ponto seguro), **`automatico`** (executa no ponto seguro, avisa por toast, registra `feita`). Padrão `NULL` ⇒ deriva de `workspace.permissao` (P-28).
  Toda troca grava `Decision(proposito:"troca")` com ranking e recibo; falha ⇒ `falhou`, Pane antigo intacto. `account_switch` (agêntico) = mesmo caminho do botão. O decisor **nunca** participa. Aceite: CT-9.18 (automático troca de conta), CT-9.19 (sem conta → modelo equivalente; `so_sugerir` só propõe), CT-9.20 (espera/bloqueio), CT-9.21 (sem alternativa: permanece + aviso), CT-9.22; `not_at_limit` sem `force`; `provider_mismatch`; log com consumo de origem/destino; sem loop (3 contas a 86–90%). · T-09.18, T-09.19.

### 9D — Rede, cofre, decisor e OpenRouter  [D: `src/nucleo/{rede,cofre}/**`, `src/nucleo/harness/decisor/**`, `intencao.ts`, `src/main/cofre.ts`]  [O: `src/nucleo/openrouter/**`, `src/main/{openrouter,proxy-worker}.ts`, `src/main/ipc/openrouter.ts`, `src/nucleo/provedores/{contas,servico}.ts`]

- **T-09.21 · Cofre** — `cofre/{cofre,cifrador}.ts`, `src/main/cofre.ts` (Cifrador sobre `safeStorage`; recusa backend `basic_text` no Linux ⇒ `cofre:disponivel` falso com instrução). `<userData>/cofre.json` 0600 atômico; entradas `{id, nome UPPER_SNAKE, escopo, workspace_id, sensivel, cifrado_b64, criado_em, ultimo_uso_em}`; **sem criptografia própria** (D-59).
  Aceite: P-105; metadados listados sem decifrar; valor só atravessa `obterValor()` **interno** ao main; arquivo adulterado → entrada ignorada com aviso; sem `safeStorage` → cofre desabilitado e o resto do app funciona. · T-09.01.
- **T-09.22 · Sensível fora do ambiente, scrubber e resumo para o decisor** — `cofre/{scrubber,placeholders}.ts`, `decisor/resumo.ts` + ponto de montagem do ambiente (`terminais/ambiente.ts`/lançamento). Entradas **não sensíveis** só viram variável de ambiente se o workspace habilitou `injetar_cofre_no_env` (padrão não); `sensivel` **nunca**. `scrubber(texto)` remove o valor literal e variantes (base64, URL-encode, aspas) e se aplica a brief, checkpoint, relatório exibido, diagnóstico e erros; `resolver("{{vault:NOME}}")` só para consumidores internos.
  `resumirParaDecisor(texto)` ≤ 500 chars: remove caminhos absolutos, e-mails, URLs com credencial, sequências com cara de token (≥ 20 chars/`sk-`/`sk-or-`/`ghp_`/JWT), valores de `.env`, blocos de código; **nunca** envia diff, saída de terminal nem conteúdo de arquivo.
  Aceite: CT-9.11; valor em 3 codificações sai como `«cofre:NOME»`; 40 amostras com segredo plantado → nenhuma sai no resumo; 100 KB → ≤ 500 chars em ≤ 5 ms. · T-09.21.
- **T-09.23 · Cliente HTTP único (`rede/`)** — `nucleo/rede/cliente-http.ts`: `requisitar({host, caminho, metodo, cabecalhos, corpo, consentimento, timeout_ms, max_bytes})` e `stream(...)`. **Único** módulo que usa `fetch`/`http(s)`: https obrigatório (loopback http só em teste), host em **allowlist** montada a partir de consentimentos gravados (`openrouter.ai`, host do decisor, nada mais), recusa redirecionamento para outro host, teto de bytes, timeout, nunca registra cabeçalhos nem corpo, sem cookies/`Referer`/telemetria (D-25).
  Sem consentimento correspondente ao host ⇒ erro `consent_required` **antes** de abrir socket. Aceite: stub de rede prova zero conexões sem consentimento; host fora da allowlist recusado; redirect cruzando host recusado; resposta acima do teto abortada; chave de `Authorization` ausente de qualquer log/erro (sentinela). · T-09.21, T-09.01.
- **T-09.24 · `DeciderClient`, formatos, configuração e consentimento** — `decisor/{cliente,formatos,prompts,breaker}.ts` + `config` `decisor` + canais `harness:decisor_*`. Três modos: **`jev_direto`** (endpoint tipado do JEV + chave do cofre; formato `probs_json`: `POST {kind, question, options:[{id,description}]}` → `{probs:{id:p}}` — o contrato real do JEV é **[LAC]**, o ADE define esse formato como padrão e a pendência P-16 pede a documentação), **`jev_openrouter`** (o mesmo decisor servido por um modelo OpenRouter configurável, formato `openai_chat`, usa a chave de uma conta OpenRouter) e **`openai_compat`** (endpoint genérico).
  Interface `ask({kind, purpose, question, options[{id, description}]}) → {probs, choice, confidence, latency_ms, cost_usd|null, custo_origem, raw_model}`; só opções fechadas, resposta validada por esquema (soma ∈ [0,99; 1,01], ids ⊂ opções) — inválida descartada, **1 retry** só em JSON inválido; timeout 2 s; breaker 5 min em 402/429/timeout/5xx/JSON inválido repetido; sempre via `rede/`. **Custo por decisão**: `usage.cost` da resposta (`resposta`) → senão tokens × preço do modelo OpenRouter (`tabela`) → senão `custo_por_decisao_usd` informado (`informado`) → senão `null` (`desconhecido`); nunca 0 por omissão.
  Ligar exige `consentimento:{host, modo}` e grava `consentimento{host, modo, em}`; o diálogo (T-09.32) mostra **exatamente** o que sai (resumo ≤ 500 chars redigido + nomes das opções) e para qual host; trocar host/modo exige novo consentimento; desligar apaga o consentimento; contador diário com alerta (não bloqueia). `harness:decisor_testar` com `chave` usa o valor uma vez e não grava.
  Aceite: servidor falso local cobre 200, 402, 429, timeout, JSON lixo, probabilidades inconsistentes, opção inventada, e os 3 modos; instalação nova ⇒ `habilitado:false`, `consentimento:null` e **zero** chamadas de rede (CT-9.04); `habilitado:true` sem consentimento ⇒ erro; chave ausente de log/erro/Decision/IPC de saída (sentinela); custo nunca `0` por omissão. · T-09.22, T-09.23.
- **T-09.25 · Decisor no Router, `classificarIntencao` e `resolverPerfil(skill, etapa)`** — `roteador.ts`, `harness/{intencao,perfil}.ts`, `harness/etapas.json`. O decisor só atua em `task_type` (aceita se `confianca ≥ minima`), `modelo_esforco` (entre candidatos viáveis) e `intencao`; **não existe** decisor de conta nem de troca (D-58); timeout/erro/inválido ⇒ regra com `fonte:"fallback"` e **sem erro ao usuário**; `diverged` e custo registrados.
  **`classificarIntencao(texto, contexto)`** (D-115): opções fechadas (padrão: gestos do método — `nova_feature, nova_ocorrencia, pedido_cru, projeto, retomar, auditar, qa, entregar, duvida`; o Maestro pode passar as suas); heurística + pistas do estado do método; `fonte: decisor|regra|fallback`. **`resolverPerfil(skill, etapa, ctx)`**: `etapas.json` mapeia `(skill, etapa)` → `{task_type, avaliador}` (sprintx F1–F3→`planejar`, F5→`auditar` avaliador, F6→`implementar`; runx E1→`bug-profundo`, E3→`bug-fix`, E4→`qa` avaliador; prodx P0→`triar`; mergex E2–E4→`revisar-pr` avaliador; buildx→`planejar`; designx→`front`; stackx/legadox→`descobrir`; memox→`docs`; desconhecido→`geral`) e chama o `Router` com `origem:"metodo"`; para `avaliador` exclui o provedor do implementador (`ctx.implementador_provedor`) quando há ≥ 2 viáveis.
  Aceite: CT-9.05, 9.03, 9.12, 9.37, 9.38; com o decisor desligado nada instancia o cliente (teste espiona); `intencao ∈ opcoes` sempre; opção inventada pelo decisor descartada; P-102 e P-112. · T-09.24, T-09.15.
- **T-09.26 · OpenRouter: contas, chave, teste, modelos, saldo e preço** — `nucleo/openrouter/servico.ts`, `adaptadores` de saldo (`limites/adaptadores/openrouter-saldo.ts`), `src/main/openrouter.ts`, `src/main/ipc/openrouter.ts`, `provedores/{contas,servico}.ts` (provedor virtual `openrouter`: conta sem config dir, entrada no cofre `OPENROUTER_KEY_<conta_id>` com `sensivel:true`). Fluxos, **todos por clique e todos via `rede/`**: **consentir** (texto explícito: "seus prompts e código irão ao OpenRouter e aos provedores dos modelos; nada é enviado até você usar"), **gravar chave** (vai direto ao cofre; UI guarda só `ultimos4`), **testar** — com `conta_id` (usa a chave do cofre) **ou com `chave` no payload sem salvar** (valor usado uma vez; cofre e banco intactos) via `GET /api/v1/key`, **atualizar modelos** (`GET /api/v1/models` com a chave do usuário; grava/atualiza `openrouter_modelo` em lotes; preços da API, `null` quando ausentes; **nada de rede no boot nem em segundo plano**), **habilitar/classificar** (`habilitado`, `faixa`, `ordem`, `tipos_permitidos`), **saldo** (`/api/v1/key` e `/api/v1/credits`) → `LimitSnapshot` com janela `credit` (`openrouter_api`), no máximo 1 consulta/conta a cada 5 min e só com Pane OpenRouter vivo ou por clique (P-104). Os preços atualizam a tabela de preços da Fase 10 (origem `openrouter`).
  Aceite: CT-9.27 a 9.30, 9.34; P-111; chave sentinela só em `cofre.json` cifrado (nunca em banco, log, IPC de saída, evento); "testar sem salvar" deixa `cofre.json` e banco byte a byte iguais; sem consentimento nenhuma tool/IPC abre socket; conta sem limite ⇒ `used_pct:null` (não 0). · T-09.23, T-09.21, T-09.04, T-09.02.
- **T-09.27 · OpenRouter: proxy local por Pane e adaptadores por CLI** — `nucleo/openrouter/proxy/*`, `nucleo/openrouter/adaptadores/*`, `src/main/proxy-worker.ts`. **Proxy** em **worker thread**, `127.0.0.1` porta efêmera, subido sob demanda (1º Pane OpenRouter com consentimento) e desligado após 5 min sem uso; rotas `POST /p/<token>/v1/chat/completions`, `POST /p/<token>/v1/responses`, `GET /p/<token>/v1/models` (allowlist; o resto 404); **token por Pane** (HMAC com `aud:"or"`, `{pane_id, workspace_id, exp}`, revogado ao fechar o Pane ou ao `openrouter_revogar` ≤ 1 s);
  recusa (`403 model_not_enabled`) qualquer modelo que não esteja **habilitado** e permitido para o `task_type` do Pane; corpo ≤ 8 MB, ≤ 4 streams por Pane; descarta `Authorization`/cookies do cliente e injeta a chave real **lida do cofre por requisição** (não retida); sem `Referer`/`X-Title`; encaminha por `rede.stream()` sem bufferizar o corpo; **medidor** lê só `usage` (varredura de linhas SSE contendo `"usage"`, cauda de 64 KB em JSON não-stream), descarta o resto e emite `usage.observed` (Fase 10); log só método, caminho, status, latência e bytes.
  **Adaptadores** (`montar({modelo, baseUrl, tokenPane}) → {argumentos, ambiente, arquivo_temporario?}`): `opencode` (config inline por variável de ambiente + `--model`), `aider` (`--model openai/<id>` + base URL e chave = token do Pane), `codex` (`-c` com provider customizado; **a verificar**, `status:"a_verificar"` e desligado até o dono/coordenador validar), `goose` (`desligado` até a CLI entrar no catálogo); o token do Pane é a "chave de API" da CLI, **nunca** a chave OpenRouter; nenhum arquivo de configuração global é lido ou escrito (hash antes/depois).
  Aceite: CT-9.30 a 9.32, 9.35; P-110; `cli-openrouter.mjs` (CLI falsa) chama o proxy com o token do Pane e a requisição chega ao upstream falso com a chave real, enquanto `env`/`argv` do Pane **não** a contêm; token de outro Pane/expirado ⇒ 401; fechar o Pane revoga em ≤ 1 s; chamada a modelo não habilitado ⇒ 403 e `usage.observed` não emitido; 10 MB de stream sem crescer a memória > 5 MB. · T-09.26, T-09.23, F1 (lançamento), F3 (tokens).
- **T-09.28 · OpenRouter no roteamento** — `provedores/{contas,servico}.ts` (lista de provedores aceita `openrouter` como backend), `harness/{escolher-modelo,equivalencia,roteador}.ts` (consumidores de `provedores_viaveis`/`clis_openrouter`), tools `provider_list`/`model_list`/`pane_spawn`, `lancamento` (monta o Pane com o adaptador). `provider_list` inclui `openrouter` (com `clis` compatíveis) só com consentimento e ≥ 1 modelo habilitado; `pane_spawn {provider:"openrouter", cli?, model}` valida modelo habilitado e CLI compatível e lança a CLI **com o adaptador**; `headline_limits` inclui as contas OpenRouter (janela `credit`).
  Aceite: CT-9.33, 9.35; contas Claude esgotadas → modelo OpenRouter habilitado da mesma faixa quando a preferência permite; OpenRouter é o **último** na ordem padrão; modelo com `tipos_permitidos` fora do tipo ⇒ pulado; sem CLI compatível ⇒ provedor pulado (`sem_cli_compativel`); regressão do `pane_spawn` nativo intacta. · T-09.26, T-09.27, T-09.13, T-09.11, T-09.16.

### 9E — Interface  [E: `src/renderer/**`]

- **T-09.29 · Rodapé de todas as páginas e cota geral no topo** — `casca/MedidorLimites.tsx`, `casca/CotaGeralTopo.tsx`, `estado/limites.ts`, CSS; encaixe em `Rodape.tsx` e `Topo.tsx` (única task que os toca). **Rodapé (26 px, uma linha, 10 px)**: por conta (até 4 inline; resto em `+N`) `ícone da CLI 10 px · rótulo curto (cl·2) · 5h 62% · sem 31%` (conta OpenRouter: `or·1 US$ 7,10 restantes`, ou `sem limite` — nunca 0%); **tempo até zerar no hover/foco**.
  **Topo (40 px, junto da busca e dos ícones)**: chip `pior cl·1 87% · folga 64% (3/4)` — pior caso, folga média das contas com dado e **cobertura**. Estados: ok (azul), ≥ 85% aviso + `▲`, ≥ 100% alerta + `!`, sem dado `—` ("sem dado"; barra tracejada), `estimado` `≈`, velho > 30 min em itálico (`title` com a idade), vencida `?`; cor nunca é o único sinal; `aria-label` completo. Clique/Enter abre o mesmo popover (`role="dialog"`, ≤ 100 ms): janelas, baldes por modelo (esgotado apagado), fonte e idade, "atualizar", "informar manualmente", "abrir Consumo".
  Aceite: P-103; visível em Início, Missões, Terminais, Método, Workspaces, Provedores, Harness, Consumo e Configurações (teste de renderização por tela); só medidor e chip re-renderizam (Profiler); cabe em 720 px (rolagem horizontal sem barra, sem quebra de linha); contraste AA nos dois temas; a média nunca mistura contas sem dado nem some a cobertura. · T-09.08, T-09.03.
- **T-09.30 · Tela Harness: casca, Política e Equivalência** — `telas/harness/{index,Politica,Equivalencia}.tsx`, item de menu "Harness" (lazy). **Uma linha de controles** (~28 px): abas `Política | Equivalência | Contas e limites | Decisões | Cofre`, escopo (Global/workspace), nível ▾ (1–4), **modo de troca ▾ (manual / só sugerir / automático / "padrão do workspace")**, limiar de troca (50–99, padrão 85), busca, `+ tipo`, restaurar semente (ícones 20–24 px).
  Política: tabela virtualizada agrupada por categoria (`Tipo · Provedor · Faixa/modelo · Esforço · Conta fixa · Fallback`), edição inline, linha com executor desativado destacada (borda + `!`) que **bloqueia salvar** com o motivo em texto. Equivalência: grade provedor × faixa com os modelos efetivos (select com `modelosDaFerramenta`, ids OpenRouter habilitados e "sem equivalente"), selo "padrão"/"alterado", "restaurar padrão", aviso "confira se são mesmo equivalentes em qualidade e custo (P-31)".
  Aceite: P-106; teclado completo (setas, Enter edita, Esc cancela); criar tipo novo aparece sem reiniciar; editar equivalência grava só a diferença e vale no próximo `pickModel` sem reiniciar; valor inválido recusado com o motivo; nenhum diálogo nativo. · T-09.14, T-09.11, T-09.01.
- **T-09.31 · Aba Contas e limites** — `ContasLimites.tsx`. Por conta: rótulo, auth, reserva de modelos/papéis, workspaces fixados, tetos de tokens (fonte "estimado" da fase 10), janela com barra, "informar manualmente", "atualizar", e o aviso fixo: "O ExpxV usa o login de cada CLI e nunca lê credenciais. Distribuir trabalho entre contas é decisão sua; confira os termos de cada provedor." (P-30). Contas OpenRouter aparecem com saldo/limite e levam à seção OpenRouter de Provedores.
  Aceite: reserva/pin gravam e valem na próxima `pickAccount`; conta sem dado mostra "sem dado" (não 0%); aviso de "contas parecem iguais" quando dois snapshots têm janelas idênticas ao mesmo tempo; navegável por teclado. · T-09.29, T-09.08.
- **T-09.32 · Abas Decisões e Cofre** — `Decisoes.tsx`, `Cofre.tsx`. **Decisões**: chave "Decisor externo" **desligada**; ao ligar abre o diálogo de consentimento (T-09.24) com **modo** (`JEV direto | JEV via OpenRouter | endpoint compatível`), endpoint/host, modelo, chave (campo `type=password` que grava direto no cofre; "testar sem salvar"), usos (`tipo de tarefa`, `modelo/esforço`, `intenção`) e o texto exato do que sai da máquina; contador "N consultas · US$ x (≥)"; lista virtualizada das últimas Decisions (fonte, confiança só se decisor, recibo, `diverged`, custo e sua origem); alerta de cota diária.
  **Cofre**: lista (nome, escopo, selo "sensível"), criar/editar/apagar; valor sempre `••••`; **sem** copiar nem revelar; o valor é descartado do estado do React ao gravar; `cofre:disponivel` falso mostra o motivo e o próximo passo.
  Aceite: ligar exige marcar o consentimento e confirmar; desligar apaga o consentimento; custo `null` renderiza "custo desconhecido", não "US$ 0,00"; o valor de chave não aparece no DOM nem no estado persistido (varredura de DOM e `localStorage`); apagar pede confirmação própria; 5 000 Decisions rolam a 60 fps (P-09). · T-09.24, T-09.21, T-09.15.
- **T-09.33 · Provedores › OpenRouter (UI)** — `telas/provedores/OpenRouter.tsx` (seção da tela Provedores; só esta task a toca). Estados: **desligado** (botão "Ativar OpenRouter" → diálogo de consentimento com o texto de T-09.26), **ativo sem conta** (campo de chave `type=password`, "Testar sem salvar", "Salvar no cofre"), **ativo com conta** (chave mascarada `sk-or-••••` + últimos 4, saldo/limite/tipo, "testar", "atualizar saldo", "apagar"). **Modelos**: botão "Atualizar lista" (só por clique, mostra "N novos, M removidos"), lista virtualizada com busca, colunas `habilitar · modelo · contexto · preço entrada/saída (ou "sem preço") · faixa ▾ · ordem · tipos`; CLIs compatíveis com o status do adaptador (`verificado`/`a verificar`/`desligado`) e a CLI preferida.
  Aceite: P-111; chave nunca no DOM depois de gravada; "testar sem salvar" não deixa rastro; sem consentimento nenhum botão de rede dispara; modelo habilitado aparece na aba Equivalência e em `model_list`; uma linha de controles, linhas de 24 px (D-32). · T-09.26, T-09.28.
- **T-09.34 · Tela Consumo: visão geral e contas** — `telas/consumo/{index,VisaoGeral}.tsx`, `graficos/{Linha,Barras,Sparkline}.tsx` (SVG próprio, `React.memo`, ≤ 300 pontos por série, sem biblioteca), item de menu "Consumo" (lazy). **Uma linha de controles**: período (24 h | 7 d | 30 d), agrupar por (conta | provedor | modelo | workspace | Missão | Pane), filtro, abas `Visão geral | Previsão e eficiência | Trocas | Detalhe por uso`.
  Visão geral: uma linha densa por conta com sparklines (5 h e semanal; crédito para OpenRouter), % atual, tempo até zerar, fonte/idade e selos de alerta. O agrupamento por **modelo/workspace/Missão/Pane usa o uso observado da Fase 10**: a aba "Detalhe por uso" mostra "disponível depois da ingestão de uso (fase 10)" enquanto `custo:*` não existir (ponto de extensão `FonteDeUso`).
  Aceite: P-108; 90 dias × 10 contas decimados rolam a 60 fps; sem dado mostra "sem dado" (nunca zero); `prefers-reduced-motion` respeitado; AA nos dois temas; série legível em escala de cinza (padrão de traço, não só cor). · T-09.09, T-09.29.
- **T-09.35 · Tela Consumo: previsão, eficiência, alertas e trocas** — `PrevisaoEficiencia.tsx`, `Trocas.tsx`. Previsão por conta/janela (`zera às 17:40, antes de resetar às 19:00` / `não zera neste ritmo` / `dados insuficientes`) com curva tracejada; **eficiência semanal** (barras por semana: pico, meta 90% marcada, selo "estourou cedo"); alertas (`consumo_alto`, `vai_estourar`, `cota_sobrando`, `sem_dado`) com ação ("abrir Harness", "informar manualmente"); aba **Trocas**: log virtual de `troca_log` (hora, de → para, tipo, motivo, consumo origem/destino, modo, status, recibo) com "aceitar/ignorar/adiar" nas sugestões pendentes.
  Aceite: CT-9.23; a meta vem de `config` (padrão 90, P-102); aceitar sugestão chama `harness:troca_decidir` e o status muda sem recarregar; log de 5 000 trocas rola a 60 fps; `insuficiente` é mostrado como tal (nunca previsão chutada). · T-09.34, T-09.20.
- **T-09.36 · Wizard "Automático", botão "mover" e faixa de sugestão no Pane** — `telas/missoes/Criar.tsx` (opção "Automático (harness)" no seletor de CLI, mostrando a rota prevista) e `telas/terminais/{ModoMissao,RotuloPane}.tsx` (recibo colapsável de 10 px no Pane filho; botão de ícone "mover" 20 px com menu das contas/modelos-alvo e o aviso de "pensamento perdido"; **faixa de sugestão de uma linha** `▲ conta 87% — sugerido: claude·2 [mover] [ignorar 30 min]`). Só esta task toca esses arquivos.
  Aceite: Missão automática exibe o recibo do Pane; "mover" cria o novo Pane sem salto de layout (T-03.07); sem destino mostra `no_capacity` em texto; a faixa some ao aceitar/ignorar e não reaparece antes de 30 min; nada cresce a altura do cabeçalho do Pane (D-32). · T-09.16, T-09.20, T-09.29.

### 9F — Fechamento

- **T-09.37 · Orçamentos P-100 a P-112** — `tests/perf/harness.perf.test.ts`, entradas em `npm run perf`/`verificar`. Aceite: todos verdes e gravados em `docs/ade/perf/ultimo.json`; P-01..P-22 sem piora. · T-09.08, T-09.15, T-09.20, T-09.27, T-09.29, T-09.34.
- **T-09.38 · Auditoria de segredos e de rede** — `tests/seguranca-harness.test.ts`. Planta sentinelas (valor de cofre, chave OpenRouter, chave do decisor, token-fake em `.env` do workspace) e roda os fluxos (rota, troca, mover, decisor, OpenRouter, proxy, brief, checkpoint, diagnóstico, erros, IPC, MCP) varrendo log, argv, **ambiente dos Panes**, eventos, banco, `cofre.json`, Decisions, brief e DOM. Aceite: 0 ocorrências do valor em claro fora do `cofre.json` cifrado e da memória do worker do proxy; `grep` por `auth.json|\.credentials|keychain|security find-` fora de testes e docs = 0; **`fetch`/`http(s).request`/`net.connect` só em `nucleo/rede/`**; instalação nova abre **zero** sockets; arquivos de configuração global das CLIs com hash idêntico antes/depois de lançar Pane OpenRouter. · T-09.24, T-09.27, T-09.22.
- **T-09.39 · E2E no Electron real** — `tests/harness.e2e.test.ts` + CLIs falsas (rollout Codex, statusline Claude, MCP, `cli-openrouter.mjs`) + upstream OpenRouter falso. Cenários: (1) 2 contas, `pane_spawn` sem provedor ⇒ conta que reseta antes + recibo; (2) conta esgotada ⇒ outra; (3) todas esgotadas ⇒ `no_capacity` sem Pane órfão; (4) conta em uso a 87% em modo `automatico` ⇒ novo Pane na outra conta com brief e recibo; (5) sem conta com folga ⇒ modelo equivalente do outro provedor; (6) `so_sugerir` ⇒ só faixa de sugestão; (7) `rebase-merge` em curso ⇒ não troca e avisa; (8) "mover" manual; (9) CT-9.04 zero rede; (10) decisor falso 402 ⇒ fallback + breaker;
  (11) cofre: sentinela fora do ambiente do Pane; (12) rodapé e topo mostram "sem dado" e atualizam ≤ 600 ms após a leitura; (13) tela Consumo mostra previsão e o log de trocas; (14) `headline_pick` ≡ roteador; (15) OpenRouter: consentir → gravar chave → "testar sem salvar" → atualizar modelos (só no clique) → habilitar → `pane_spawn` com a CLI falsa passando pelo proxy; chave real só no upstream; modelo não habilitado ⇒ 403; (16) contas Claude esgotadas → OpenRouter da mesma faixa. Aceite: todos verdes; `ps` sem processo de worker/CLI falsa vivo. · T-09.36, T-09.37, T-09.38, T-09.33, T-09.25.

## UI compacta (D-32)

- **Rodapé** (26 px) em **todas** as páginas: `[sinal] Pronto · N aguardando · Painéis · Missões · ‹medidor por conta› · vX`; o medidor ocupa o espaço restante e **rola horizontalmente sem barra** (nunca quebra linha, nunca cresce a altura). Fonte 10 px, ícones 10 px, mini-barras 28×4 px; tempo até zerar no hover/foco.
- **Topo** (40 px): o chip da **cota geral** fica ao lado da busca/paleta e dos ícones; uma linha, 11 px.
- **Telas Harness, Consumo e a seção OpenRouter**: uma linha de controles; abas pequenas (24–26 px, 11 px); linhas densas de 24 px; nada de cartões nem títulos de página; estados vazios explicam o próximo passo.
- **Pane**: sem moldura nova; recibo colapsável de 10 px; faixa de sugestão de uma linha; "mover" é botão de ícone 20 px.
- Destaque **azul** do tema; sinais de aviso/alerta pelos tokens existentes; nenhuma cor literal fora de `tokens.css`; gráficos distinguíveis sem cor (traço/marcador); chaves sempre mascaradas.

## Casos de teste de aceitação

| # | Cenário | Esperado |
|---|---|---|
| CT-9.01 | Conta 1 reseta em 5 d (40%), conta 2 reseta em 1 d (60%), ambas com folga | `pickAccount` ⇒ conta 2; Decision `fonte: regra` |
| CT-9.02 | Conta 2 a 100% numa janela relevante, conta 1 com folga | conta 1; conta 2 em `descartadas: esgotada` |
| CT-9.03 | `pane_spawn` sem provedor, "arrumar botão do front da home" | `task_type` por heurística (ou decisor se ligado), executor da política, recibo, Pane visível ≤ 300 ms |
| CT-9.04 | Instalação nova | `decisor.habilitado=false`; zero sockets abertos; painel "0 consultas" |
| CT-9.05 | Decisor ligado, servidor falso devolve 402/timeout | heurística usada, spawn conclui, breaker 5 min, aviso na UI |
| CT-9.06 | Política antiga com provedor depois desabilitado | resolve cai no `fallback`; `harness_set` com esse provedor ⇒ `executor_disabled` |
| CT-9.07 | Decisor sugere tipo com 0,38 (< 0,5) | usa heurística, `fonte: fallback`, `diverged` registrado |
| CT-9.08 | Pane no limite + "mover" | novo Pane com brief, antigo `superseded`, `account.switched(manual)`, origem em cooldown |
| CT-9.09 | Balde do modelo a 100% em todas as contas | modelo apagado no seletor; política usa alternativa/equivalente |
| CT-9.10 | Todas as contas e fallbacks esgotados | `no_capacity`, no máximo 2 saltos, Pane antigo intacto |
| CT-9.11 | Entrada `sensivel` no cofre | variável ausente do ambiente do Pane; nenhuma tool/IPC devolve o valor |
| CT-9.12 | 127 decisões a US$ 0,0002 | painel: 127 consultas, ≈ US$ 0,025; decisão sem custo conhecido não soma zero |
| CT-9.13 | Conta sem arquivo/dado de limite | medidor "sem dado"; último nível em `pickAccount`; recibo "sem dado de limite" |
| CT-9.14 | Statusline do Claude sem `rate_limits` | snapshot `desconhecido`; CLI não quebra; nada de lixo gravado |
| CT-9.15 | `headline_pick` com `max_slack`, folgas 5/30/12 | conta de folga 30; com `expires_first` (padrão) obedece o reset |
| CT-9.16 | "usage limit reached" no texto do usuário | não dispara `limite_atingido` |
| CT-9.17 | Sem foco da janela por 5 min | zero leituras de limites |
| CT-9.18 | Pane em conta Claude a 87% (5 h), outra Claude a 20%, modo `automatico`, Pane `pronto` | troca para a outra Claude, brief + checkpoint, recibo com "de/por quê/consumo/pensamento perdido" |
| CT-9.19 | Só uma conta Claude; Codex habilitado com folga | modelo da **mesma faixa** no Codex (faixa vazia pula); `so_sugerir` ⇒ só proposta; `automatico` ⇒ troca |
| CT-9.20 | Pane `trabalhando`; ou `rebase-merge/`; ou handoff em voo; ou pergunta pendente | adiada (`adiada_por`), nada é encerrado; reavalia no próximo evento; vencida a espera ⇒ vira sugestão |
| CT-9.21 | Nenhum outro provedor habilitado, conta ≥ 85% (não esgotada) | permanece; aviso "sem alternativa"; esgotada ⇒ `no_capacity` e Pane intacto |
| CT-9.22 | Depois da troca: antiga 90%, nova 86% | não volta (margem, cooldown, 10 min, `saltos ≤ 2`) |
| CT-9.23 | Série linear a 10 pt/h na janela de 5 h; < 3 amostras | `zera_em` correto ± 1 min / "dados insuficientes" |
| CT-9.24 | 4 contas, 1 sem dado | topo: `folga 64% (3/4)`; nunca média com a conta sem dado |
| CT-9.25 | Perfil de agente `topo` Claude com conta a 90%; sem outra conta | `resolverPerfil` ⇒ `topo` do outro provedor; perfil `rapido` não sobe de faixa |
| CT-9.26 | Override de equivalência do usuário | vence o arquivo; faixa vazia pula o provedor; override inválido recusado |
| CT-9.27 | OpenRouter sem consentimento | nenhum botão/tool/IPC abre socket; `provider_list` não lista `openrouter`; `pane_spawn provider:"openrouter"` ⇒ `openrouter_not_consented` |
| CT-9.28 | Abrir a tela / iniciar o app com conta OpenRouter configurada | nenhuma chamada de rede; "Atualizar lista" é a única que busca modelos |
| CT-9.29 | "Testar sem salvar" com chave digitada | upstream recebe a chave; `cofre.json` e banco byte a byte iguais; campo limpo; nada em log |
| CT-9.30 | Chave gravada | só `cofre.json` cifrado e `ultimos4`; ausente de env/argv do Pane, banco, log, IPC de saída, eventos; UI mascarada |
| CT-9.31 | CLI falsa no Pane OpenRouter chama o proxy com o token do Pane | upstream recebe a chave real; modelo não habilitado ⇒ 403; caminho fora da allowlist ⇒ 404; token alheio/expirado ⇒ 401; Pane fechado ⇒ 401 em ≤ 1 s |
| CT-9.32 | Lançar Pane OpenRouter com `opencode`/`aider` | argv/env só com base URL local e token do Pane; arquivos de configuração global com hash idêntico |
| CT-9.33 | Contas Claude esgotadas; OpenRouter com modelo habilitado na faixa `topo` | `pickModel` ⇒ modelo OpenRouter, por último na ordem; sem CLI compatível ⇒ pulado |
| CT-9.34 | Conta OpenRouter com limite US$ 10 e usado US$ 9 / sem limite informado | `used_pct 90` ⇒ nível 3 (quente) / `used_pct:null` ⇒ "sem dado" |
| CT-9.35 | Adaptador `codex` em `a_verificar`; `goose` fora do catálogo | não aparecem como CLIs utilizáveis; a UI explica o porquê |
| CT-9.36 | Decisor `jev_direto` (formato `probs_json`) e `jev_openrouter` | ambos classificam só entre opções fechadas; custo por decisão com `custo_origem`; opção inventada descartada |
| CT-9.37 | `classificarIntencao("quero uma feature de exportar CSV", ctx)` com decisor desligado | `intencao:"nova_feature"`, `fonte:"regra"`, ≤ 5 ms; decisor ligado que falha ⇒ `fonte:"fallback"` |
| CT-9.38 | `resolverPerfil("sprintx-auditoria","F5", ctx)` com 2 provedores | `task_type:auditar`, provedor ≠ do implementador, conta/modelo efetivos e recibo |

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| **Sem API oficial de limites** em nenhum provedor | % exato indisponível | só fontes locais que a CLI já grava (rollout do Codex, statusline do Claude) + `manual` + `estimado` (fase 10) + saldo OpenRouter por API do próprio dono; sem dado = rebaixada (D-57) |
| **Formatos mudam sem aviso** (`rate_limits`, janelas, baldes, API do OpenRouter) | leitura quebra | normalizador que nunca lança; fixtures + testes de contrato; `desconhecido` em vez de erro; `provedor_indisponivel` visível; adaptadores isolados |
| Statusline do Claude só atualiza com o Pane vivo | dado velho | `idade_s` visível, `vencida` tratada como desconhecida, `manual` como complemento; a troca só age com dado medido recente (≤ 30 min) ou `limite_atingido` |
| **Conta/credenciais**: ler token de CLI para % exato | vazamento, ToS | proibido (D-57), teste de varredura (T-09.38); P-27 |
| **Chave OpenRouter vaza** (ambiente do Pane, log, IPC, prompt injection do agente) | gasto na conta do dono | cofre `safeStorage`; chave só no worker do proxy por requisição; Pane recebe token revogável; log sem cabeçalhos; payloads `sensivel` não logados; sentinelas (T-09.38) |
| **Agente ou prompt injetado usa o proxy para modelo caro/exfiltrar** | custo e dados | allowlist de modelos habilitados **e** de tipos; allowlist de caminhos; token por Pane de curta vida; limite de streams/corpo; alerta de gasto (Fase 10) |
| Flags/config das CLIs para endpoint custom mudam (opencode, aider, codex, goose) | Pane OpenRouter não sobe | adaptador por CLI com `status` (`verificado`/`a_verificar`/`desligado`); contrato por CLI falsa; `codex` e `goose` desligados até validar; nunca toca config global |
| **Privacidade**: prompts/código vão ao OpenRouter e aos provedores dos modelos | exposição | opt-in com consentimento explícito e texto claro; revogável (para proxy e invalida tokens); modelos habilitados um a um; P-17 |
| **Ban de uso**: alternar contas do mesmo dono pode ferir termos do provedor | suspensão | login sempre da CLI; padrão derivado da `permissao` (seguro ⇒ só sugerir); cooldown, margem e teto de 2 saltos; aviso fixo na UI; P-30 |
| **Troca perde o "pensamento" da sessão** | retrabalho | só em ponto seguro; brief + checkpoint; aviso explícito no recibo; operação em curso nunca é interrompida |
| **Modelo "equivalente" de qualidade/custo diferente** | resultado pior ou cota cara | equivalência editável e **explícita** por faixa; faixa vazia pula; `faixa_minima_troca` padrão `mesma`; recibo cita o modelo; OpenRouter por último; P-31 |
| Troca automática em laço (ping-pong) | gasto e confusão | margem de 10 pontos, ≥ 10 min entre trocas, `saltos ≤ 2`, cooldown da origem, histerese de 5 pontos |
| Previsão ruim com poucos dados; excesso de notificação | alerta falso/cansaço | amostras mínimas; `insuficiente`; ritmo misto; 1 alerta por tipo/conta/hora; sugestão ignorada some por 30 min |
| **Custo estimado vs real** (assinatura não tem custo por token) | número enganoso | Fase 10 rotula "equivalente em API" e usa `null`/`≥`; aqui só custo do decisor (`usage.cost`, tabela ou informado) e preços do OpenRouter vindos da API |
| Contrato do **JEV** desconhecido [LAC] | decisor direto não funciona | formato `probs_json` do ADE como padrão + `openai_chat` via OpenRouter; modo escolhido pelo dono; P-16 pede a documentação; regra sempre vence |
| Decisor externo vaza prompt | privacidade | desligado; consentimento por host e modo; resumo redigido ≤ 500; chave só no cofre; teste de vazamento |
| Detecção de limite por texto é frágil | falso positivo/negativo | marcada `saida_do_pty`; botão manual sempre existe; não age sozinha fora do modo `automatico` |
| `safeStorage` indisponível (Linux sem keyring) | cofre/OpenRouter/decisor com chave não funcionam | recursos que exigem chave ficam desabilitados com instrução; app segue (P-29) |
| Fases 7/8/14/16 ainda não existem | skills, restore, squads e Maestro incompletos | pontos de extensão `aplicarSkills`, `ProvedorDeBrief`, `resolverPerfil` e `classificarIntencao` com implementação mínima testada |

## Ordem de execução e paralelismo

```
T-09.01 ─► T-09.02 ─► 9B (10→11→12→13→14→15→16→17)
   │            └────► 9A (03→04→05/06/07→08→09)
   ├────► 9D-núcleo (21→22→23→24 ; 25 após 15) ─► 9D-OpenRouter (26 após 23 e 04 → 27 → 28 após 13/16)
   └────► 9E (29 após 08; 30 após 14/11; 33 após 28; 34 após 09 e 29; 36 por último)
9C (18→19→20) após 13, 04 e 22 · 9F por último (37, 38 → 39)
```
Ondas (cada agente numa área de arquivos disjunta; o coordenador roda `npm run verificar` e atualiza `STATUS.md`; no máximo 5 agentes):
1. **Onda 1 (1 agente, sequencial):** T-09.01 e T-09.02 (tocam `ipc.ts`, `banco/`, preload).
2. **Onda 2 (3 agentes):** A = T-09.03→T-09.08 (`limites/`); B = T-09.10→T-09.14 (`harness/` núcleo puro); D = T-09.21→T-09.23 (`cofre/`, `rede/`).
3. **Onda 3 (4 agentes):** A2 = T-09.09; B = T-09.15→T-09.17; D = T-09.24→T-09.25 (decisor; T-09.25 após T-09.15); O = T-09.26 (após T-09.23 e T-09.04).
4. **Onda 4 (3 agentes):** C = T-09.18→T-09.20; O = T-09.27→T-09.28; E1 = T-09.29, depois T-09.34 e T-09.35.
5. **Onda 5 (2 agentes):** E2 = T-09.30→T-09.33 (telas Harness e OpenRouter); em seguida, sozinho, T-09.36 (toca `Criar.tsx`/`RotuloPane`).
6. **Onda 6 (em série):** T-09.37 → T-09.38 → T-09.39 (e2e não roda em paralelo com perf) → fechamento do coordenador.
Arquivos compartilhados que **só o coordenador** edita: `src/compartilhado/ipc.ts`, `src/preload/preload.ts`, `src/nucleo/mcp/{catalogo,portas}.ts`, migrations, `src/renderer/casca/{Rodape,Topo,telas}.tsx` (cedidos à T-09.29), `05-CONTRATOS.md`, `STATUS.md`.

## Decisões [LAC] resolvidas

| [LAC] | Resolução |
|---|---|
| **Algoritmo de roteamento de conta** (spec-03 "reseta primeiro" × spec-09 `headline_pick` "maior folga") | **[DEC] D-55: um único `pickAccount`, estratégia padrão `expires_first` (spec-03) com guardas e nível "quente" (≥ 85%); `max_slack` (spec-09) só como opção do `headline_pick`.** Detalhe abaixo. |
| Troca de conta/modelo por consumo (pedido do dono) | **[DEC] D-101/D-102:** gatilho ≥ 85% (5 h ou semanal), conta do mesmo provedor com folga ≥ margem → senão modelo equivalente por **faixa** de outro provedor (`pickModel`, que chama `pickAccount`); modos `manual/so_sugerir/automatico` por workspace; só em ponto seguro |
| Schema de limites divergente (`5h/weekly` × `five_hour`; sem `model_buckets` na spec-09) | **[DEC] D-56:** `LimitSnapshot`/`AccountUsage` únicos com `kind: five_hour|weekly|monthly|credit`, `model_buckets`, `fonte/confianca/idade_s`; usado por serviço, IPC e MCP sem mapeamento |
| Como ler limites de cada provedor (spec-09 Q-09.2) | **[DEC] D-57:** só arquivos que a CLI já grava (Codex rollout, Claude statusline por Pane) + manual + estimado (fase 10) + saldo OpenRouter pela API com a chave do dono; demais CLIs `desconhecido`; **nunca** token/keychain das CLIs |
| Qual janela define "termina primeiro" | **[DEC]** a janela gargalo **medida e não vencida** (maior `used_pct`; desempate: reseta antes); vencida = desconhecida; `credit` sem reset ordena por último |
| Decisor LLM na conta (bug do dia 80) | **[DEC] D-58:** removido; decisor só classifica tipo, intenção e (opcional) modelo/esforço; conta e troca são sempre regra |
| Modelo/endpoint do decisor (JEV/OpenRouter) | **[DEC] D-58/D-114:** três modos configuráveis (`jev_direto`, `jev_openrouter`, `openai_compat`), https, sem default, desligado; consentimento por host+modo; contrato do JEV [LAC] com formato padrão do ADE e P-16 |
| OpenRouter como provedor | **[DEC] D-113:** provedor virtual (`provider:"openrouter"` + CLI compatível); chave só no cofre; Pane fala com **proxy loopback** com token próprio; modelos habilitados um a um, com faixa; saldo vira janela `credit`; nada de rede sem consentimento e sem clique |
| Nomes de modelo por faixa (equivalência) | **[DEC] D-102:** `equivalencia.json` versionado em listas por faixa; só `opus|sonnet|haiku` (Claude) e `default` (CLI) são conhecidos; resto `default` até P-31; OpenRouter vem dos modelos habilitados; usuário edita, diferença vai em `config` |
| Entitlements `harness_auto` | **[DEC] D-100:** cortados (D-05); níveis 1–4 livres; padrão 4; explícito vence |
| `allow skills` fora do Claude Code | **[DEC]** `skills_aplicadas=false` + lista no prompt; enforcement real com a fase 7 (`aplicarSkills`) |
| Restore brief (spec-06) | **[DEC] D-101:** porta `ProvedorDeBrief` + checkpoint por turno; fase 8 substitui |
| Cofre `.overclock` AES-256 próprio | **[DEC] D-59:** `safeStorage`; broker interno (inclui o proxy do OpenRouter); sem MCP do cofre |
| Retrospect (spec-09) | **[DEC] D-110:** **mantido** como "eficiência semanal" da tela Consumo (`limite_semana`); ARR segue cortado |
| Cota geral, rodapé e tela Consumo | **[DEC] D-110:** rodapé em toda página, chip da cota geral no topo (pior caso + folga média + cobertura), tela Consumo com SVG próprio |
| Squads (Fase 14) e Maestro (Fase 16) | **[DEC] D-111/D-115:** `resolverPerfil` (agente e skill+etapa) e `classificarIntencao` são os pontos de integração; esta fase não cria squads nem pipeline |
| Frequência de leitura e de rede | **[DEC] D-112:** ≤ 1 leitura de arquivo por conta a cada 60 s (borda de subida lê na hora), só com foco; saldo OpenRouter ≤ 1 a cada 5 min e só com Pane vivo; lista de modelos só por clique |
| Arsenal/Receitas, browser do decisor, painel de bug, MCP do cofre | **[DEC] D-108:** fora do escopo; reabrir só a pedido |
| Semáforo (spec-03 §7.5) | já entregue em T-01.07; esta fase só consome `aguardando`/`pronto` |
| Bench alimentar a política (spec-14) | fase 12; `harness:politica_gravar` já aceita `atualizado_por:"semente"` para o rascunho do bench |

### O algoritmo único (D-55), em detalhe

`pickAccount(candidatas, opcoes)`:
1. **Filtrar** (cada descarte vira motivo em `descartadas`): `habilitada`, `auth ≠ expirada`, reserva de modelo/papel respeitada se `evitar_reservadas`, `cooldown_ate` no futuro, pin (da conta/workspace ou da política: **duro** — se a pinada não serve, nenhuma outra serve e o Router passa ao próximo executor), `excluir`.
2. **Janelas relevantes** = `uso.windows` filtradas por `opcoes.janela` (`auto` = todas) **mais** o balde do modelo (`model_buckets[modelo]`). Janela com `resets_at ≤ agora` é **vencida**; `used_pct: null` idem — ambas desconhecidas. As demais são **medidas**.
3. **Esgotada** = alguma janela medida com `used_pct ≥ limiar_esgotamento_pct` (100) ⇒ `esgotada`; se só o balde do modelo está esgotado ⇒ `modelo_esgotado` (a conta segue válida para outros modelos).
4. **Gargalo** = janela medida de maior `used_pct` (desempate: reseta antes). `folga = 100 − gargalo.used_pct`.
5. **Níveis**, do melhor ao pior: **1** medido/manual e `used_pct < limiar_troca_pct` (85); **2** `estimado`, ou todas as janelas vencidas/nulas (provável folga, sem prova); **3** medido e `used_pct ≥ limiar_troca_pct` (**quente**: não vale começar tarefa longa nela); **4** sem snapshot, `status ≠ ok` ou fonte `nenhuma`.
6. **Ordenação** no mesmo nível — `expires_first`: `(gargalo.resets_at ↑ [sem data, inclusive `credit` = +∞], gargalo.used_pct ↑, conta_id)`; `max_slack`: `(folga ↓, resets_at ↑, conta_id)`. A primeira do melhor nível não vazio é `escolhida`; `ranking` traz tudo (Decision e recalibração).

`pickModel` **não repete** nada disso: monta, para cada (provedor, modelo da faixa), as candidatas e chama `pickAccount`; só acrescenta a ordem de busca, o filtro de CLI compatível (OpenRouter) e a regra de melhora mínima (margem).

**Por que `expires_first` e não `max_slack`:** (a) é a regra literal do dono (spec-03 §8.4: "escolher o que termina primeiro; só escolher o outro se estiver 100% usado"); (b) cumpre a tese da própria spec-09 ("bata 100% da cota semanal e da janela de 5 h"): `max_slack` escolhe sempre a conta mais vazia e **deixa sobrar** cota que expira na mais cheia; (c) a crítica de "maçã com laranja" (5 h de uma conta × semanal de outra) é tratada comparando só a **janela que de fato trava a conta** (o gargalo) e mandando para o nível 3 quem está ≥ 85%;
(d) como o crédito do OpenRouter não expira, ele cai naturalmente **depois** de qualquer assinatura que está para resetar: gasta-se a cota que se perderia antes do dinheiro; (e) é pura e a escolha inteira fica registrada (ranking), então dá para recalibrar com dados reais sem mudar código. `max_slack` fica exposto **apenas** como opção de `headline_pick` ("a conta mais segura agora").

## Pendências do dono geradas nesta fase

Já existentes e usadas aqui: **P-16** (endpoint e formato do JEV; sem isso o adaptador roda contra stub) e **P-17** (OpenRouter: chave só no cofre, lista com a chave do dono, rede só por clique, CLIs prioritárias OpenCode e Aider); **P-39** (tabela de preços; vale também para a Fase 10).
Novas: **P-27** (ler credencial de CLI para obter % exato: não), **P-28** (padrões: nível 4, modo de troca derivado da permissão, limiar 85, margem 10, 2 saltos), **P-29** (cofre no Linux sem keyring), **P-30** (termos de uso ao distribuir trabalho entre contas),
**P-31** (nomes concretos por faixa na equivalência e política de descer de faixa), **P-32** (meta de aproveitamento semanal e alertas da tela Consumo), **P-33** (adaptadores de endpoint custom para `codex` e `goose`: validar e ligar). Texto e padrões adotados em `PENDENCIAS-DO-DONO.md`.
