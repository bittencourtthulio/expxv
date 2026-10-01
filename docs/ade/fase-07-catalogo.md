# Fase 7 — Catálogo de skills, MCPs, hooks e regras

Objetivo: o desenvolvedor vê, numa tela só, tudo o que as CLIs de IA da máquina têm instalado (skills, servidores MCP,
plugins, hooks, regras), instala uma skill em outra CLI com um clique (symlink), e cada Pane de Missão nasce com **só as
skills e os MCPs que a política permite** (deny-by-default). Valor para quem usa o método Expx: (1) menos tokens e menos
escolha errada, porque o agente do Pane enxerga 6 skills em vez de 60–200; (2) segurança verificável: o bloqueio vale em
código, inclusive sob `--dangerously-skip-permissions`; (3) o método (`expx:*`) aparece como camada própria, só leitura,
gerenciada pelo `expxdev` — o ADE não a toca (D-04). Base: `base/B-…` (specs 02 e 05), `base/specs-overclock/spec-05-…`,
`05-CONTRATOS.md` §1–§4, `fase-03-orquestracao-mcp.md` (token por Pane, hooks por Pane, `PortaGanchos`).

**Portão da fase**: `npm run verificar` verde · e2e no Electron real: varredura de uma casa de teste com 200 skills em
≤ 5 s sem tarefa > 50 ms no main, instalar por symlink + `already_installed`, Missão `squad` com 3 skills permitidas
bloqueando a 4ª pelo gate (CLI falsa que fala MCP e ganchos) · `npm run perf` com P-23..P-31 verdes em
`docs/ade/perf/ultimo.json` · auditoria rápida de segurança (T-07.36) sem achado aberto.

## Princípios (valem para as 36 tasks)

1. **Leveza e velocidade acima de tudo.** Nada de varredura no boot onda 1; a varredura roda em `worker_threads`, em
   lotes, cancelável, com cache por `mtime+size`; sem watcher contínuo em diretórios da casa do usuário (peso, ruído);
   tabela virtualizada; busca no renderer sobre cache (nenhum IPC por tecla). Chunk da tela é lazy.
2. **Segurança por padrão.** O scanner **não executa nada do usuário** (nem `tools/list` de MCP) a não ser sob confirmação
   explícita; configs de MCP são **redigidas na origem** (nunca se guarda `env`, `headers`, argumentos nem path de
   segredo); descrição de skill de terceiro é **dado** (saneada, truncada, nunca instrução).
3. **Nada sai da máquina.** Sem rede no scanner. Instalar é symlink/cópia local. Sem telemetria (D-25).
4. **O método continua dono do seu estado.** Skills/hooks do método são `origem=metodo`, somente leitura; o ADE mostra
   o comando (`expxdev update`, `/expx:…`) e nunca instala, remove nem edita `.claude/skills/<skill do método>` nem
   `.expx/hooks.json` (D-04, D-21).
5. **Deny-by-default por Pane.** Em Missão `squad`/`agentico`, Pane sem allow-list explícita recebe lista vazia (+ o
   mínimo do papel). Painel `livre` não tem filtro (RF-05.44). A interseção só estreita, nunca amplia (mesma regra do
   `tools_allow` do token).
6. **O ADE não escreve no repositório do usuário** fora de `.expxv/` (05-CONTRATOS §5). Diferença deliberada do
   ExpxMedia (`prepararHarnessProjeto` grava `.claude/`, `.agents/`, `.opencode/` do projeto): aqui tudo que o ADE
   materializa vai para `<userData>/panes/<pane_id>/` (efêmero) ou, por **ação explícita**, para o escopo global
   (`~/…`) do usuário.
7. **Honestidade sobre o isolamento.** Só o Claude Code tem bloqueio duro hoje. Nas demais CLIs o isolamento é parcial e a
   UI diz isso (selo `parcial`), em vez de prometer o que não existe.

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`; P-16..P-22 são da Fase 6)

Todos medidos por `npm run perf` (`tests/perf/catalogo.perf.ts`, fixtures geradas por `tests/fixtures/catalogo/gerar.ts`);
`EXPXV_PERF_FATOR` vale como nos demais. Estourou: a task não fecha.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-23 | Varredura completa: 200 skills (4 CLIs × global+projeto) + 20 MCPs + 30 hooks + regras | ≤ 5 s; UI nunca bloqueada; nenhuma tarefa > 50 ms no main (P-12); nenhum `longtask` > 50 ms no renderer | fixture em `HOME` isolado; monitor de event loop do main + `PerformanceObserver('longtask')` durante a varredura |
| P-24 | Re-varredura sem mudanças (cache `mtime+size`) | ≤ 400 ms para as mesmas 200 skills; 0 leituras de `SKILL.md` | contador de `readFile` injetado + marca |
| P-25 | Tela Catálogo com 2 000 itens | abre (clique → primeira pintura com dados do cache) ≤ 100 ms; rolagem a 60 fps; ≤ 80 linhas no DOM | contagem de nós + quadros (como P-09) |
| P-26 | Busca/filtro com 5 000 itens | ≤ 16 ms por tecla (1 quadro), nenhuma chamada IPC | `performance.now()` no filtro; spy no `window.ade` |
| P-27 | Tool MCP `catalog_list` (2 000 itens) | ≤ 20 ms p95 no servidor; resposta padrão ≤ 4 KB (`limit` 25) | teste de carga em loopback com banco real |
| P-28 | Gate de skill (`pre-skill`) ida e volta pelo `gancho.mjs`; `gerarSettingsDoPane` com allow-list de 200 e 500 regras `deny` | gate ≤ 80 ms p95; geração ≤ 10 ms; settings gerado ≤ 64 KB | CLI falsa que dispara o hook 200×; benchmark da função pura |
| P-29 | Instalar por symlink + atualizar a linha | ≤ 150 ms (atômico) | marca no handler IPC, disco real em `tmpdir` |
| P-30 | Chunk lazy da tela Catálogo; cache em memória de 2 000 itens | chunk ≤ 60 KB gzip e fora do JS inicial (P-08 intacto); cache ≤ 30 MB | `tamanho-bundle.mjs` + `process.getProcessMemoryInfo` |
| P-31 | Overhead do isolamento no spawn de um Pane de Missão (resolver política + snapshot + materializar plugin efêmero com 7 skills `ev-*`) | ≤ 30 ms além do spawn atual (P-15 não piora) | e2e de delegação 1+1 com/sem política |

## Arquitetura

```
src/compartilhado/catalogo.ts        tipos de IPC/eventos (T-07.01)
src/nucleo/catalogo/                 lógica pura, sem Electron
  tipos.ts normalizar.ts sanear.ts frontmatter.ts raizes.ts
  scanners/{claude,codex,opencode,gemini,portatil,metodo}.ts   interface ScannerCli
  varredura.ts                       orquestra scanners, upsert em lote, ausentes, cache mtime+size
  worker.ts                          corre a varredura em worker_threads (padrão de metodo/worker.ts; fora do asar)
  instalacao.ts                      symlink/cópia atômica, desinstalar, lixeira
  embarcadas/manifesto.ts            manifesto + hash + estado por CLI
  embarcadas/skills/ev-*/SKILL.md    7 skills do produto (empacotadas, T-07.16)
  politica.ts                        resolução PURA da allow-list de um Pane
  isolamento/{claude,parcial}.ts     por CLI: settings/args/env a partir da política resolvida
  gate.ts                            decisão pura do gate (skill e MCP)
  saude.ts                           health check
  mcp-verificar.ts                   tools/list sob demanda e confirmação
src/nucleo/banco/migracoes/0003-catalogo.ts      (número = próximo livre em MIGRACOES)
src/nucleo/banco/repos/catalogo.ts
src/main/catalogo.ts                 serviço (boot onda 2 ocioso, gatilhos, eventos) + src/main/ipc/catalogo.ts
src/renderer/estado/catalogo.ts      store (useSyncExternalStore), cache, filtro
src/renderer/telas/catalogo/         Catalogo.tsx TabelaCatalogo.tsx Gaveta.tsx Politica.tsx Embarcadas.tsx catalogo.css
resources/skills/                    manifesto.json + ev-*/ (copiado por scripts/copiar-ativos.mjs; asarUnpack)
```

Pontos de integração com o que já existe (não refazer): `src/nucleo/mcp/{catalogo,tools,tokens,portas}.ts`
(`catalog_list` hoje devolve `[]`), `src/nucleo/orquestracao/{hooks/claude.ts,piloto.ts,regras.ts}`,
`src/nucleo/missoes/panes.ts` (`PreparadorDePane` — é aqui que a política vira argumentos), `src/nucleo/terminais/catalogo.ts`
(`recursosDaFerramenta`, `configuracaoDeMcp`), `src/nucleo/metodo/{instalacao,hooks}.ts` (lock e modos do método),
`src/renderer/componentes/{VirtualLista,Virtualizada}.tsx` e `busca-fuzzy.ts` (reuso, não reescrita).

### Como o scanner enxerga cada CLI (caminhos `[DEC]`: convenções públicas das CLIs, travados por teste de contrato com fixture e confirmados na máquina do dono — P-26)

| CLI | Skills | MCP | Hooks | Regras | Plugins |
|---|---|---|---|---|---|
| `claude` | `~/.claude/skills/*/SKILL.md`; `<ws>/.claude/skills/*`; plugins: `~/.claude/plugins/installed_plugins.json` → `installPath/skills/*/SKILL.md` (só instalações `scope: user` ou `scope: project` com `projectPath` = workspace); estado `habilitada` vindo de `enabledPlugins` em `~/.claude/settings.json` e `<ws>/.claude/settings.json` | `<ws>/.mcp.json`; `~/.claude.json` (`mcpServers`, `projects[<ws>].mcpServers`); `.mcp.json` de plugins | `hooks` de `~/.claude/settings.json`, `<ws>/.claude/settings.json`, `settings.local.json`, `hooks/hooks.json` de plugins; marca `gerenciado_pelo_metodo` (nome do script casa `.claude/hooks/(expx|memox)-*`) | `~/.claude/CLAUDE.md`, `<ws>/CLAUDE.md` | `installed_plugins.json` |
| `codex` | `~/.codex/skills/**/SKILL.md` (profundidade ≤ 3; subpastas ocultas como `.system/` entram com `origem=nativa`) | `[mcp_servers.<nome>]` em `~/.codex/config.toml` (parser mínimo, só tabelas `mcp_servers`) | `[LAC]` sem contrato confirmado: aba mostra "não suportado pelo scanner" | `~/.codex/AGENTS.md`, `<ws>/AGENTS.md` | `[LAC]` |
| `opencode` | `~/.config/opencode/skills/*`, `<ws>/.opencode/skills/*` | chave `mcp` de `~/.config/opencode/opencode.json` e `<ws>/opencode.json` | plugins JS em `<ws>/.opencode/plugin(s)/` (só lista) | `<ws>/AGENTS.md` | — |
| `gemini` | `[LAC]` (extensões): lista só leitura quando houver `~/.gemini/extensions/*/gemini-extension.json` | `mcpServers` de `~/.gemini/settings.json` e `<ws>/.gemini/settings.json` | — | `~/.gemini/GEMINI.md`, `<ws>/GEMINI.md` | extensões (só lista) |
| `portatil` (`.agents`) | `~/.agents/skills/*`, `<ws>/.agents/skills/*` — formato portátil lido por Codex e outras (ExpxMedia grava aqui) | — | — | — | — |
| método (transversal) | skills do `.expx/expx-lock.json` presentes em `<ws>/.claude/skills/<nome>` → `origem=metodo`; comandos `.opencode/commands/*` não entram (kind `command` fora do escopo) | — | `.expx/hooks.json` (modos `aviso/bloqueio/desligado`, só leitura) | — | `expx@expx-local` |

## Modelo de dados

Migration `0003-catalogo` (aplicar no próximo número livre de `MIGRACOES`; nunca editar migration publicada). Datas UTC ISO com
ms; booleanos 0/1; ids ULID com prefixo (`cat_…`); caminhos **relativos a `base`** (`home` ou `workspace`) — nunca absolutos
(M9/AGENTS 12). Home resolvida em runtime (`os.homedir()`), com override só quando `EXPXV_E2E=1` (`EXPXV_E2E_HOME`).

```sql
CREATE TABLE catalogo_item (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('skill','mcp_server','mcp_tool','plugin','hook','rule')),
  nome TEXT NOT NULL,
  nome_normalizado TEXT NOT NULL,                 -- minúsculo, sem "-_ " e sem prefixo "plugin:"
  plugin TEXT, autor TEXT,
  origem TEXT NOT NULL CHECK (origem IN ('usuario','terceiro','embarcada','nativa','metodo')),
  descricao TEXT,                                 -- saneada, ≤ 600
  papel_sugerido TEXT CHECK (papel_sugerido IS NULL OR papel_sugerido IN ('explorador','executor','revisor')),
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_item ON catalogo_item (tipo, nome_normalizado);   -- 1 linha, N badges (RF-05.04)

CREATE TABLE catalogo_instalacao (
  item_id TEXT NOT NULL REFERENCES catalogo_item(id) ON DELETE CASCADE,
  cli TEXT NOT NULL CHECK (cli IN ('claude','codex','opencode','gemini','portatil')),
  escopo TEXT NOT NULL CHECK (escopo IN ('global','projeto')),
  workspace_id TEXT NOT NULL DEFAULT '',          -- '' = global (PK não admite NULL)
  base TEXT NOT NULL CHECK (base IN ('home','workspace')),
  caminho_rel TEXT NOT NULL,
  metodo TEXT NOT NULL CHECK (metodo IN ('nativo','symlink','copia')),
  estado TEXT NOT NULL CHECK (estado IN ('presente','ausente','quebrado')),
  habilitada INTEGER NOT NULL DEFAULT 1,          -- plugin desabilitado => 0
  criado_pelo_app INTEGER NOT NULL DEFAULT 0,     -- só o que o app criou pode ser removido sem lixeira
  hash_conteudo TEXT, tamanho INTEGER, mtime_ms INTEGER,
  detalhe_json TEXT NOT NULL DEFAULT '{}',        -- ≤ 2 KB, só campos saneados (ver redação do MCP)
  visto_em TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (item_id, cli, escopo, workspace_id)
) WITHOUT ROWID;
CREATE INDEX ix_catalogo_inst_estado ON catalogo_instalacao (estado);
CREATE INDEX ix_catalogo_inst_ws ON catalogo_instalacao (workspace_id, cli);

CREATE TABLE catalogo_mcp_tool (
  id TEXT PRIMARY KEY,
  servidor_id TEXT NOT NULL REFERENCES catalogo_item(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, descricao TEXT, verificado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_mcp_tool ON catalogo_mcp_tool (servidor_id, nome);

CREATE TABLE catalogo_politica (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  alvo_tipo TEXT NOT NULL CHECK (alvo_tipo IN ('papel','agente','missao')),
  alvo_valor TEXT NOT NULL,                       -- papel | agent_id | mission_id
  skills_json TEXT NOT NULL DEFAULT '[]',         -- nomes normalizados ou "grupo:<id>"
  mcp_do_usuario TEXT NOT NULL DEFAULT 'nenhum' CHECK (mcp_do_usuario IN ('nenhum','lista')),
  servidores_mcp_json TEXT NOT NULL DEFAULT '[]',
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_politica ON catalogo_politica (workspace_id, alvo_tipo, alvo_valor);

CREATE TABLE catalogo_pane_politica (             -- snapshot do que o Pane recebeu (auditoria + gate sem recalcular)
  pane_id TEXT PRIMARY KEY REFERENCES pane(id) ON DELETE CASCADE,
  cli TEXT NOT NULL, nivel_isolamento TEXT NOT NULL CHECK (nivel_isolamento IN ('duro','parcial','nenhum')),
  skills_json TEXT NOT NULL, mcp_do_usuario TEXT NOT NULL, servidores_mcp_json TEXT NOT NULL,
  resolvido_em TEXT NOT NULL
);

CREATE TABLE catalogo_embarcada (
  nome TEXT NOT NULL, cli TEXT NOT NULL,
  versao_instalada TEXT, hash_instalado TEXT,
  opt_out INTEGER NOT NULL DEFAULT 0,             -- persistente: resolve o [LAC] "voltam no boot"
  atualizado_em TEXT NOT NULL,
  PRIMARY KEY (nome, cli)
) WITHOUT ROWID;

CREATE TABLE catalogo_varredura (                 -- retenção: últimas 20
  id TEXT PRIMARY KEY, gatilho TEXT NOT NULL CHECK (gatilho IN ('boot','workspace','manual','tela')),
  iniciada_em TEXT NOT NULL, duracao_ms INTEGER, adicionados INTEGER, atualizados INTEGER, ausentes INTEGER, erros_json TEXT NOT NULL DEFAULT '[]'
);
```

Ciclos de vida: instalação `presente ⇄ ausente` (nunca apaga na varredura; só `limpar_ausentes` ou "remover do catálogo");
`quebrado` = symlink cujo alvo sumiu. Item sem nenhuma instalação `presente` e sem pedido de permanência é elegível a
"limpar ausentes". Embarcada: `empacotada → (opt-in) instalada → editada|atualizada` — **sem** reinstalação automática.

## Contratos

### IPC (renderer ↔ main) — `window.ade.catalogo`; o coordenador adiciona em `src/compartilhado/ipc.ts` (T-07.01)

Tipos em `src/compartilhado/catalogo.ts`:

```ts
export const CLIS_CATALOGO = ["claude", "codex", "opencode", "gemini", "portatil"] as const;
export type CliCatalogo = (typeof CLIS_CATALOGO)[number];
export const TIPOS_CATALOGO = ["skill", "mcp_server", "mcp_tool", "plugin", "hook", "rule"] as const;
export type TipoCatalogo = (typeof TIPOS_CATALOGO)[number];
export type OrigemCatalogo = "usuario" | "terceiro" | "embarcada" | "nativa" | "metodo";
export type EscopoCatalogo = "global" | "projeto";
export type MetodoInstalacao = "nativo" | "symlink" | "copia";
export type EstadoInstalacao = "presente" | "ausente" | "quebrado";
export type NivelIsolamento = "duro" | "parcial" | "nenhum";

export interface InstalacaoCatalogo {
  cli: CliCatalogo; escopo: EscopoCatalogo; workspace_id: string | null;
  base: "home" | "workspace"; caminho_rel: string; metodo: MetodoInstalacao; estado: EstadoInstalacao;
  habilitada: boolean; criado_pelo_app: boolean; hash_conteudo: string | null;
  detalhe: Readonly<Record<string, string | number | boolean | null>>;   // saneado; nunca env/headers/args
}
export interface ItemCatalogo {
  id: string; tipo: TipoCatalogo; nome: string; nome_normalizado: string; plugin: string | null; autor: string | null;
  origem: OrigemCatalogo; descricao: string | null /* ≤ 160 na lista; ≤ 600 no detalhe */;
  papel_sugerido: "explorador" | "executor" | "revisor" | null;
  instalacoes: InstalacaoCatalogo[]; variantes: number /* hashes distintos entre CLIs */;
  editavel: boolean /* origem === "usuario" */; atualizado_em: string;
}
export interface AchadoSaude { nivel: "erro" | "aviso"; codigo: "skill_inexistente" | "descricao_vazia" | "symlink_quebrado" | "politica_referencia_ausente" | "mcp_nao_verificado" | "variantes_divergentes" | "isolamento_parcial"; item: string | null; detalhe: string }
export interface PoliticaSkills {
  id: string; workspace_id: string; alvo_tipo: "papel" | "agente" | "missao"; alvo_valor: string;
  skills: string[]; mcp_do_usuario: "nenhum" | "lista"; servidores_mcp: string[]; atualizado_em: string;
}
export interface PoliticaResolvida { skills: string[]; faltando: string[]; mcp_do_usuario: "nenhum" | "lista"; servidores_mcp: string[]; isolamento: Record<CliCatalogo, NivelIsolamento> }
```

Canais `invoke` (entrada → saída):

| Canal | Entrada | Saída |
|---|---|---|
| `catalogo:varrer` | `{workspace_id: string\|null, tipos: TipoCatalogo[]\|null, clis: CliCatalogo[]\|null}` | `{varredura_id: string}` |
| `catalogo:listar` | `{tipo: TipoCatalogo, workspace_id: string\|null}` | `{itens: ItemCatalogo[], truncado: boolean, ultima_varredura_em: string\|null}` (todos até 5 000; busca é no renderer) |
| `catalogo:detalhe` | `{item_id: string}` | `ItemCatalogo \| null` (com `descricao` ≤ 600 e `ferramentas` de MCP) |
| `catalogo:instalar` | `{item_id, de_cli: CliCatalogo, para_cli: CliCatalogo, modo: "symlink"\|"copia"}` | `{estado: "instalado"\|"ja_instalado"\|"conflito"\|"erro", caminho_rel: string\|null, codigo: string\|null}` (sempre escopo global, D-41) |
| `catalogo:desinstalar` | `{item_id, cli, escopo, workspace_id: string\|null, modo: "remover_criado"\|"lixeira"}` | `{ok: boolean, codigo: string\|null}` |
| `catalogo:limpar_ausentes` | `{tipo: TipoCatalogo}` | `{removidos: number}` |
| `catalogo:remover_do_catalogo` | `{item_id}` | `{ok: boolean}` (só sem instalação `presente`) |
| `catalogo:revelar` | `{item_id, cli, escopo, workspace_id: string\|null}` | `boolean` (`shell.showItemInFolder`; o main resolve o caminho) |
| `catalogo:verificar_mcp` | `{item_id, confirmado: true}` | `{estado: "ok"\|"indisponivel", ferramentas: number, erro: string\|null}` |
| `catalogo:politica_ler` | `{workspace_id}` | `PoliticaSkills[]` |
| `catalogo:politica_gravar` | `{workspace_id, alvo_tipo, alvo_valor, skills: string[], mcp_do_usuario, servidores_mcp: string[]}` | `PoliticaSkills` |
| `catalogo:politica_previa` | `{workspace_id, modo: "livre"\|"squad"\|"agentico", papel, agente_id: string\|null, mission_id: string\|null, cli: CliCatalogo}` | `PoliticaResolvida` |
| `catalogo:saude` | `{workspace_id: string\|null}` | `AchadoSaude[]` |
| `catalogo:embarcadas_estado` | `undefined` | `Array<{nome, versao_pacote, descricao, clis: Array<{cli, instalada: boolean, versao: string\|null, editada: boolean, opt_out: boolean}>}>` |
| `catalogo:embarcadas_instalar` | `{nome: string\|null, cli: CliCatalogo}` (`null` = todas) | `{instaladas: string[], preservadas_editadas: string[]}` |
| `catalogo:embarcadas_opt_out` | `{nome, cli, valor: boolean}` | `{ok: true}` |

Eventos main → renderer (um canal por evento, envelope com `versao: 1`): `catalogo:progresso`
`{varredura_id, cli, tipo, feitos, total: number\|null}` (coalescido a ≤ 10/s); `catalogo:concluido`
`{varredura_id, adicionados, atualizados, ausentes, duracao_ms, erros: Array<{cli, tipo, codigo, mensagem}>}`;
`catalogo:mudou` `{tipos: TipoCatalogo[], item_ids: string[]}` (≤ 200 ids; acima disso, lista vazia = "recarregue").

Barramento de domínio (nomes com ponto): `catalog.scanned`, `catalog.changed`, `catalog.installed`, `catalog.isolation_applied`
`{pane_id, cli, nivel, n_skills}`, `catalog.isolation_partial` `{pane_id, cli}`, `skill.blocked` `{pane_id, skill}`.
Todos gravam em `evento_dominio` (retenção 30 dias).

### Tools MCP (contrato externo, inglês `snake_case`)

- **`catalog_list` (agora real)** — entrada `{kind: "skill"|"mcp_server"|"plugin"|"hook"|"rule", query?: string≤100, limit?: int=25 (≤100), cursor?: string}`;
  saída `{items: Array<{name, kind, origin, description≤200, clis: string[], allowed: boolean}>, next_cursor: string|null, truncated: boolean}`.
  Para token de Pane em Missão `squad`/`agentico`, `kind: "skill"` devolve **só as permitidas** (o snapshot do Pane) e
  `allowed` é sempre `true`; para `livre`, devolve todas (limite) com `allowed: true`. Nunca devolve caminho, `env`, URL
  completa nem argumentos. `description` é saneada e vai dentro de um envelope de dado (o campo é texto puro; o prompt do
  piloto diz que é dado). Erros: `unauthorized`, `invalid_argument`.
- **`pane_spawn`** ganha `skills?: string[]` (≤ 50): subconjunto da política do papel (interseção; nome fora → `skill_not_allowed`).
- **Erro `skill_not_allowed`** (já no contrato): `pane_spawn` com skill fora da política; resposta do gate (via hook) cita a skill.
- Matriz por modo: `catalog_list` fica em `agentico` e `squad` (leitura; é o que o piloto usa para escolher skills por card), e em
  `livre` **não** (livre não escolhe skills).

### Ganchos (`PortaGanchos.tratar`) — eventos novos

`pre-skill` (corpo do hook `PreToolUse` com `tool_name: "Skill"`, `tool_input: {skill: string}`) e `pre-mcp` (`tool_name`
começa com `mcp__`). Resposta de bloqueio (mesmo formato do guarda do piloto): `{hookSpecificOutput:{hookEventName:"PreToolUse",
permissionDecision:"deny", permissionDecisionReason:"skill_not_allowed: <nome>. Skills permitidas neste Pane: …"}}`.
**Falha fechada** nos dois (`gancho.mjs`: `FALHA_FECHADA` passa a valer para `pre-tool-use`, `pre-skill` e `pre-mcp`).

### Ajustes pedidos ao coordenador nos documentos de contrato (a task T-07.01 e T-07.36 fecham)

`05-CONTRATOS.md`: §1 tabelas `catalogo_*`; §2 canais `catalogo:*`; §3 `catalog_list` real + `pane_spawn.skills`; §5 nota
"o catálogo só escreve no escopo global do usuário e só por ação explícita (D-41)"; §7 eventos `catalog.*`, `skill.blocked`.

## Tarefas

Formato: `T-07.NN · título` — entrega · **Aceite** binário · **Testes** · Depende. Todas seguem TDD (teste antes, falhando
pelo motivo certo) e `npm run verificar` verde; as de UI herdam os orçamentos e o D-32 (cromado mínimo, uma linha de controles).

### 7A — Contratos, dados e parsing

- **T-07.01 · Contratos compartilhados (coordenador)** — `src/compartilhado/catalogo.ts` (tipos acima), canais e eventos em
  `src/compartilhado/ipc.ts` (`CanaisInvoke`/`CanaisEvento`, listas `CANAIS_*`), `window.ade.catalogo` em `src/preload/preload.ts`
  (`CHAVES_API_ADE` ganha `"catalogo"`), `PRODUTO.prefixoSkill = "ev-"` em `src/nucleo/produto.ts` (D-01: o literal só existe lá).
  **Aceite:** os testes de contrato existentes (canal ⇄ validador ⇄ preload, formato da API) falham sem os validadores e passam
  com eles; `npm run typecheck` verde. **Testes:** `src/main/ipc/registro.test.ts` e `src/preload/*.test.ts` estendidos;
  varredura de marca confirma `ev-` só via `PRODUTO`. **Depende:** MVP fechado (T-05.07).
- **T-07.02 · Migration `0003-catalogo` e repositório** — `src/nucleo/banco/migracoes/0003-catalogo.ts` (SQL acima, registrar em
  `index.ts`), `src/nucleo/banco/repos/catalogo.ts` (`criarRepoCatalogo(banco)`: `upsertLote(itens)`, `marcarAusentes(varreduraId, escopoWs)`,
  `listarPorTipo(tipo, ws)`, `obter`, `removerItem`, `limparAusentes(tipo)`, `registrarVarredura`, política CRUD, snapshot por Pane,
  `embarcada*`), exportado em `repos/index.ts`. **Aceite:** migrar 0002→0003 sem perda; upsert idempotente (rodar 2× não muda
  contagem nem `atualizado_em` de quem não mudou); `ON DELETE CASCADE` ao remover workspace/pane; consulta `listarPorTipo` com 5 000
  itens ≤ 5 ms (P-14). **Testes:** `migrar.test.ts` (caso 0003), `repos/catalogo.test.ts`, `repos/desempenho.test.ts`.
  **Depende:** T-07.01.
- **T-07.03 · Normalização, saneamento e frontmatter** — `src/nucleo/catalogo/{normalizar,sanear,frontmatter}.ts`.
  `normalizarNome(s)`: minúsculo, remove `-_ .` e espaços, descarta prefixo `plugin:`; `nomeValido(s)` = `^[a-z0-9][a-z0-9._-]{0,63}$`
  (usado por instalação e política); `sanearTexto(s, max)`: remove controles, ANSI, bidi/zero-width (U+200B–200F, U+202A–202E,
  U+2066–2069, U+FEFF), colapsa espaços, trunca em code points; `lerFrontmatterSkill(buffer≤8 KB)`: `name`, `description`, `author`
  (YAML tolerante via pacote `yaml` já presente; YAML inválido → `{}`; sem frontmatter, `description` = primeiro parágrafo após o
  `#`). **Aceite:** `frontend-design`, `Frontend_Design`, `frontend design` normalizam igual; descrição com bidi/ANSI sai limpa;
  frontmatter truncado/inválido nunca lança. **Testes:** tabela de 30 nomes; fuzz de 1 000 entradas aleatórias sem exceção;
  arquivo de 5 MB lê só 8 KB (spy em `fs`). **Depende:** T-07.01.
- **T-07.04 · Raízes, contexto e limites da varredura** — `src/nucleo/catalogo/raizes.ts`: `criarContexto({home, workspaces, abort,
  fs?})` com `home` injetável (override só com `EXPXV_E2E=1` e `EXPXV_E2E_HOME`), lista de raízes por CLI/escopo (tabela do
  plano), limites (profundidade ≤ 4, ≤ 2 000 entradas por raiz, `SKILL.md` ≤ 256 KB, symlink só seguido se o alvo resolvido ficar
  dentro de uma raiz conhecida ou da própria casa; ciclo detectado por `realpath` visitado), concorrência de leitura ≤ 16.
  **Aceite:** symlink para `/etc` ou para fora da casa é registrado como `quebrado` com `detalhe.motivo="fora_das_raizes"` e
  **não** é lido; ciclo A→B→A termina; raiz ausente não é erro. **Testes:** fixtures reais em `tmpdir`
  (`tests/fixtures/catalogo/gerar.ts` cria casa de teste com N skills/CLIs/plugins). **Depende:** T-07.03.

### 7B — Scanners e varredura

- **T-07.05 · Scanner Claude: skills** — `scanners/claude.ts#varrerSkills`: global, projeto, plugins (`installed_plugins.json` com
  `scope`/`projectPath`; formato `version: 2` visto na máquina; tolerante a campo novo), `habilitada` por `enabledPlugins`;
  `origem`: `usuario` (sem plugin/autor) | `terceiro` (plugin ou autor) | `metodo` (T-07.10 sobrepõe) | `embarcada` (nome em manifesto
  **e** hash conhecido). `papel_sugerido` por palavra-chave do nome/descrição (`scout|explor` → explorador, `review|audit` → revisor,
  `build|implement` → executor; `[DEC]` heurística só sugere). Hash = sha256 do `SKILL.md`. **Aceite:** skill de plugin `present`
  (não "missing falso", RF-05.05); plugin desabilitado → instalação `habilitada=false`; mesma skill em user e project = 1 item, 2
  instalações. **Testes:** fixture espelhando `installed_plugins.json` real (2 instalações do mesmo plugin com scopes diferentes).
  **Depende:** T-07.04.
- **T-07.06 · Scanner Claude: servidores MCP com redação na origem** — `scanners/claude.ts#varrerMcp` + `scanners/redacao-mcp.ts`.
  Lê `.mcp.json`, `~/.claude.json` (`mcpServers` e `projects[<ws>].mcpServers`), `.mcp.json` de plugins, **em memória, na thread do
  worker**, e produz só `{nome, transporte: stdio|http|sse, executavel_base (basename), n_args, origem_url (scheme+host, sem
  userinfo/path/query), chaves_env: string[] (só nomes), tem_segredo: boolean (algum header/env com nome KEY|TOKEN|SECRET|PASSWORD|AUTH|BEARER)}`;
  o objeto bruto é descartado e nunca é logado nem enviado ao renderer. `tools_status` nasce `nao_verificado`.
  **Aceite:** com fixture contendo `Authorization: Bearer sk-…` e `env.API_KEY=xyz`, nenhum byte desses valores aparece em
  `detalhe_json`, em log, em evento ou na resposta IPC (teste de varredura de strings sobre o banco inteiro e sobre os
  buffers dos eventos); `~/.claude.json` de 5 MB lê sem travar (> 50 ms só no worker). **Testes:** `redacao-mcp.test.ts` com
  corpus de segredos (reaproveita `src/nucleo/conhecimento/redacao.ts` (T-08.02) quando existir; aqui a regra é estrutural: valor nunca é copiado).
  **Depende:** T-07.04.
- **T-07.07 · Scanner Claude: hooks e regras** — `scanners/claude.ts#varrerHooks`/`#varrerRegras`. Hook vira item `tipo=hook`,
  nome `<evento>:<basename do comando>`, `detalhe`: `{evento, cli, escopo, executavel_base, n_args, gerenciado_pelo_app, gerenciado_pelo_metodo, modo}`
  (`modo` de `.expx/hooks.json` via `lerHooks` existente em `src/nucleo/metodo/hooks.ts`; **o texto do comando não é guardado**);
  `gerenciado_pelo_app` = arquivo de settings por Pane com `managed_by_<produto>` (aparece só no diagnóstico do Pane). Regra vira
  `tipo=rule` com `{tamanho, linhas}` (conteúdo nunca lido além de contar). **Aceite:** hooks do método (`expx-lembrete.sh`,
  `memox-injetar.sh`, `memox-reindexar.sh`) aparecem como `metodo`, somente leitura; settings do usuário nunca são alterados
  (hash do arquivo igual antes/depois). **Testes:** fixture espelhando `.claude/settings.json` deste repositório. **Depende:** T-07.04.
- **T-07.08 · Scanner Codex** — `scanners/codex.ts`: skills em `~/.codex/skills/**` (inclui ocultas, `.system` → `nativa`);
  MCP de `~/.codex/config.toml` por **parser mínimo** de tabelas `[mcp_servers.<nome>]` (chaves `command`, `args`, `url`,
  `bearer_token_env_var`, `env`; qualquer coisa fora disso é ignorada; sem dependência de TOML — D-03/regra de dependência),
  mesma redação de T-07.06; regras `AGENTS.md`; hooks `[LAC]` → `nao_suportado`. **Aceite:** `config.toml` malformado não derruba
  a varredura (erro por CLI/tipo no `concluido.erros`); nenhum valor de `env` persistido. **Testes:** 10 TOMLs reais e quebrados.
  **Depende:** T-07.04.
- **T-07.09 · Scanners OpenCode, Gemini e portátil** — `scanners/{opencode,gemini,portatil}.ts` conforme a tabela (somente leitura;
  Gemini: MCP e regras; `.agents/skills` como `cli=portatil`). **Aceite:** mesma skill em `.claude/skills` e `.agents/skills` = 1
  linha com 2 badges; ausência de uma CLI não gera erro. **Testes:** fixtures por CLI. **Depende:** T-07.04.
- **T-07.10 · Scanner do método** — `scanners/metodo.ts`: lê `<ws>/.expx/expx-lock.json` (via `src/nucleo/metodo/instalacao.ts`
  existente) e marca como `origem=metodo` as skills do lock presentes em `<ws>/.claude/skills/<nome>` e o plugin `expx@expx-local`;
  `.expx/hooks.json` alimenta `modo` dos hooks. Itens do método têm `editavel=false` e a UI esconde instalar/remover (T-07.29).
  **Aceite:** `sprintx`, `runx`, `mergex`, `memox`… aparecem como método; lock ausente = nenhum item (não é erro); o ADE nunca
  grava em `.expx/` nem em `.claude/` (varredura de escrita do teste: `fs` em modo somente leitura para esse scanner).
  **Testes:** usa o `.expx/expx-lock.json` real deste repo como fixture copiada. **Depende:** T-07.05, T-07.07.
- **T-07.11 · Orquestrador de varredura e worker** — `varredura.ts` + `worker.ts`: `executarVarredura({contexto, tipos, clis,
  onProgresso}) → ResultadoVarredura` (puro, sem Electron, cancelável por `AbortSignal`); no app roda em `worker_threads` (compilado
  para `dist/nucleo/catalogo/worker.js`, fora do asar — mesmo cuidado de `metodo/worker.ts`); cache `mtime+size` por arquivo (hash só
  se mudou); lotes de 100 itens por mensagem; o main faz o upsert em transação por lote (fatias ≤ 20 ms, `setImmediate` entre
  lotes); instalação não vista na varredura do seu escopo → `ausente` (nunca apaga); erro em um scanner vira erro nominal e os
  demais seguem. **Aceite:** P-23 e P-24 medidos (ver T-07.34); cancelar encerra o worker em ≤ 200 ms; uma CLI com permissão
  negada não aborta as outras. **Testes:** unidade com contexto falso + e2e do worker real. **Depende:** T-07.05..T-07.10, T-07.02.
- **T-07.12 · Serviço do catálogo no main, gatilhos e IPC** — `src/main/catalogo.ts` (cria worker, aplica upsert, emite
  `catalogo:progresso/concluido/mudou` e eventos `catalog.*`, mantém `catalogo_varredura` com retenção 20), `src/main/ipc/catalogo.ts`
  (um validador estrito por canal; o renderer **nunca** envia caminho: só `item_id`/`cli`/`escopo`). Gatilhos: onda 2 do boot em
  ocioso se a última varredura tem > 1 h ou nunca houve; ao abrir/trocar workspace (só escopo projeto desse workspace); ao abrir
  a tela se o cache tem > 5 min; botão manual. Sem watcher. **Aceite:** boot onda 1 não importa o módulo (P-01 intacto: teste de
  ordem de carga); duas varreduras simultâneas coalescem em uma; fechar o app cancela o worker sem segurar o `before-quit`
  (lição do PP-01). **Testes:** `src/main/catalogo.test.ts`, `src/main/ipc/catalogo.test.ts` (payload inválido recusado antes do
  manipulador; remetente não autorizado recusado). **Depende:** T-07.11, T-07.01.
- **T-07.13 · Verificação sob demanda de MCP (`tools/list`)** — `mcp-verificar.ts` + canal `catalogo:verificar_mcp`. Só com
  `confirmado: true` vindo do diálogo da UI (que mostra o comando/URL redigido). `stdio`: spawn **sem shell**, ambiente mínimo
  (PATH/HOME + o `env` declarado lido **na hora**, em memória, do arquivo de origem), timeout 5 s, mata a árvore, saída ≤ 256 KB,
  cliente MCP do SDK já presente; `http`: POST `tools/list` com os headers declarados (lidos na hora), timeout 5 s. Persiste só
  `nome` e `descricao` (saneada, ≤ 300) das tools e `tools_status`. **Aceite:** servidor offline → `indisponivel` sem derrubar nada;
  segredo lido na hora não é persistido nem logado; sem `confirmado` o canal recusa. **Testes:** servidor MCP falso stdio e http
  em loopback; teste que varre o banco e os logs atrás do valor do segredo. **Depende:** T-07.12.

### 7C — Portabilidade e skills embarcadas

- **T-07.14 · Instalação por symlink/cópia, atômica** — `instalacao.ts#instalar({fonte, destino, modo})`. Pré-condições:
  `nomeValido`, fonte contém `SKILL.md`, fonte resolvida dentro de uma raiz conhecida, destino = `<raiz global da CLI>/<nome>`
  (sempre global, D-41; projeto é só leitura); destino existente: symlink para a mesma fonte → `ja_instalado`; qualquer outro →
  `conflito` (sem sobrescrever). Atomicidade: cria `<nome>.tmp-<rand>` e `rename`; falha limpa o temporário. Windows sem
  privilégio de symlink → junction; sem junction → cópia (`metodo="copia"`, `criado_pelo_app=1`). Re-varre só a linha. Smoke
  pós-instalação (lição "primeiro teste em Codex falhou"): confirma que o `SKILL.md` do destino lê e que a próxima varredura da
  CLI lista a skill. **Aceite:** instalar 2× = `instalado` e depois `ja_instalado`; falha no meio não deixa link quebrado;
  nome com `../` recusado; P-29. **Testes:** unidade em `tmpdir` + simulação de EPERM do Windows (fs injetado). **Depende:** T-07.12.
- **T-07.15 · Desinstalar, lixeira, limpar ausentes, remover do catálogo, revelar** — `instalacao.ts#desinstalar`: `remover_criado`
  só para `criado_pelo_app=1` (unlink do symlink/remoção da cópia que o app criou, conferindo que o caminho resolve para o que
  registramos); instalação nativa só por `lixeira` (`shell.trashItem` no main) após diálogo da UI (D-36: recuperável); item
  `metodo` e plugin nunca (retorna `codigo="gerenciado_pelo_metodo"`/`"gerenciado_pelo_plugin"`); `limpar_ausentes(tipo)` só
  remove linhas sem nenhuma instalação `presente`; `remover_do_catalogo` idem; `revelar` abre o gerenciador de arquivos.
  **Aceite:** nunca remove diretório real do usuário sem lixeira; tentar remover skill do método recusa; "clear missing" só
  habilita com ausentes. **Testes:** tabela de casos por origem × método. **Depende:** T-07.14.
- **T-07.16 · Skills embarcadas `ev-*`: conteúdo, manifesto e empacotamento** — `src/nucleo/catalogo/embarcadas/skills/ev-*/SKILL.md`:
  `ev-guide` (como o ADE funciona e como pedir ajuda), `ev-mcp` (as tools do app e quando usar cada uma), `ev-pilot` (protocolo do
  piloto: intake, delegação, wake), `ev-builder`, `ev-scout`, `ev-reviewer`, `ev-evidence-before-done` (provar antes de declarar pronto).
  Nomes em inglês (spec), **corpo em PT-BR**, frontmatter `name`/`description` (≤ 200)/`author: expxv`, nenhum nome de produto
  literal (usa o `PRODUTO` na geração do manifesto). `scripts/gerar-manifesto-skills.mjs` calcula sha256 por arquivo e grava
  `resources/skills/manifesto.json` (`{manifest_version, skills:[{name, version, path, clis, sha256}]}`); `scripts/copiar-ativos.mjs`
  copia para `dist/`; `electron-builder.yml` coloca em `asarUnpack`. Nenhuma depende de skill de terceiros (RF-05.34).
  **Aceite:** manifesto confere hash de cada arquivo (teste falha se uma skill muda sem regerar); `npm run test:pacote` encontra
  `resources/skills/manifesto.json` no pacote; conteúdo não contém segredo nem caminho absoluto. **Testes:** `embarcadas/manifesto.test.ts`,
  `tests/scripts/ativos.test.ts` estendido. **Depende:** T-07.03.
- **T-07.17 · Materialização por Pane, instalação global opt-in e atualização por hash** — `embarcadas/manifesto.ts`:
  (a) **por Pane (padrão, D-43):** `materializarEmbarcadasDoPane({dirApp, pane_id, nomes})` copia as skills permitidas para
  `<dirApp>/panes/<pane_id>/plugin/skills/<nome>/` com `plugin.json` mínimo (plugin efêmero lido por `--plugin-dir`, só Claude Code;
  as demais CLIs recebem o texto resumido no arquivo de instruções); (b) **global opt-in:** `catalogo:embarcadas_instalar` copia
  (nunca symlink para dentro do pacote, que muda de lugar) para a raiz global da CLI e registra `catalogo_embarcada`
  (`versao_instalada`, `hash_instalado`); (c) **atualização (RF-05.33):** `manifest.version` maior e hash do arquivo instalado igual
  ao `hash_instalado` → sobrescreve; editado → preserva e devolve em `preservadas_editadas`; (d) `opt_out` persistente:
  nunca reinstala. Nada roda no boot onda 1; verificação de versões só em ocioso e só para CLIs onde o usuário já instalou.
  **Aceite:** sem ação do usuário, **nenhum** arquivo é criado em `~/.claude`, `~/.codex` etc. (teste de snapshot da casa);
  skill editada pelo usuário nunca é sobrescrita; `opt_out` sobrevive a reinício. **Testes:** `manifesto.test.ts` (matriz
  versão × edição × opt-out), snapshot da casa de teste. **Depende:** T-07.16, T-07.14.

### 7D — Política e isolamento por Pane

- **T-07.18 · Política: modelo, resolução pura e defaults** — `politica.ts#resolverPolitica(entrada) → PoliticaResolvida`
  (puro; entrada: modo, papel, agente, missão, política gravada por alvo, itens do catálogo, método instalado, CLI).
  Precedência `agente > missão > papel`; entradas são nomes normalizados ou grupos (`grupo:metodo` = todas as skills `origem=metodo`
  do workspace; `grupo:embarcadas` = `ev-*`; `grupo:plugin:<nome>`); interseção com o pedido do `pane_spawn` (nunca amplia);
  **defaults deny-by-default** para `squad`/`agentico`: piloto → `ev-pilot, ev-guide, ev-mcp` + `grupo:metodo` quando a Missão
  tem `origem ≠ livre` (o piloto é quem recebe os comandos `/expx:*` do `metodo:disparar`); explorador → `ev-scout,
  ev-evidence-before-done`; executor → `ev-builder, ev-evidence-before-done`; revisor → `ev-reviewer, ev-evidence-before-done`;
  `livre` → sem filtro (`skills: null` no snapshot). Nome inexistente no catálogo vai para `faltando` (não bloqueia). `isolamento`
  por CLI vem de `NIVEL_POR_CLI` (claude `duro`; codex/opencode/gemini `parcial`; confirmado por T-07.25).
  **Aceite:** tabela de 25 casos (modo × papel × política × pedido); resultado determinístico e ordenado; 200 skills ≤ 2 ms.
  **Testes:** `politica.test.ts` (tabela + propriedade "resultado ⊆ política"). **Depende:** T-07.02, T-07.03.
- **T-07.19 · Snapshot por Pane no spawn** — no `PreparadorDePane` (main, `src/main/orquestracao.ts`) e em `pane_spawn`
  (`src/nucleo/mcp/tools/pane.ts`): resolver a política, gravar `catalogo_pane_politica` (cli, nível, skills, servidores), emitir
  `catalog.isolation_applied` (ou `catalog.isolation_partial`), e passar o resultado a `montarComandoPiloto/Worker`
  (`EntradaComando` ganha `politica: PoliticaResolvida | null`). Respawn do mesmo Pane reaproveita/recalcula e substitui o
  snapshot. O snapshot — não o token — é a fonte do gate (token continua pequeno, < 4 KB). **Aceite:** Pane de Missão sempre
  tem snapshot; fechar o Pane apaga o snapshot (cascade); snapshot nunca contém caminho. **Testes:** `orquestracao.test.ts`
  estendido; `piloto.test.ts` (política nula = comportamento atual). **Depende:** T-07.18, T-07.12.
- **T-07.20 · `catalog_list` real e `pane_spawn.skills`** — `src/nucleo/mcp/catalogo.ts` (matriz: `catalog_list` em `squad`/`agentico`),
  `tools/provider.ts#catalogList` troca o `[]` por consulta paginada ao repositório pela porta nova `PortaCatalogo`
  (`listar({workspace_id, kind, query, limit, cursor, permitidas: string[]|null})`), `DEFINICOES.catalog_list` com o schema
  novo, `tools/pane.ts` valida `skills` contra o snapshot do papel. Descrição saneada (200). **Aceite:** squad com 3 skills
  permitidas lista 3; `livre` não vê a tool; P-27; resposta ≤ 4 KB no padrão; nenhum caminho/URL/`env` na saída; `skills` fora da
  política → `skill_not_allowed`. **Testes:** `tools.test.ts`, `catalogo.test.ts`, `integracao.test.ts` (MCP real em loopback).
  **Depende:** T-07.19.
- **T-07.21 · Isolamento duro no Claude Code** — `isolamento/claude.ts` e `gerarSettingsDoPane` (`orquestracao/hooks/claude.ts`):
  (1) `PreToolUse` matcher `Skill` → `gancho.mjs pre-skill`; (2) `PreToolUse` matcher `mcp__.*` → `pre-mcp`; (3) `permissions.deny`
  com `Skill(<nome>)` para toda skill conhecida do catálogo fora da allow-list e `mcp__<servidor>` para todo servidor de
  usuário fora da lista (cinto e suspensório; teto de 500 regras, o excedente fica só no gate); (4) `--strict-mcp-config` quando
  `mcp_do_usuario = "nenhum"` (padrão em Missão: só o MCP do app entra no Pane; `lista` = sem strict + deny/gate); (5) `--plugin-dir
  <dirApp>/panes/<pane_id>/plugin` com as `ev-*` permitidas (T-07.17). Subagentes da CLI **não** são bloqueados (o método usa
  agentes `auditor-*`, `revisor-*`; registrado como limite conhecido). Slash command digitado pelo humano não passa pelo gate
  (ação do usuário). **Aceite:** settings gerado é JSON válido, ≤ 64 KB, só dentro de `<dirApp>/panes/<pane_id>/`, marcado
  `managed_by_<produto>`, nunca toca `~/.claude` nem `.claude/` do projeto; P-28 (geração ≤ 10 ms); com política nula (livre) o
  settings não ganha nenhum gate de skill; `claude.test.ts` existente continua verde. **Testes:** snapshot do settings por
  papel/política, benchmark da função pura. **Depende:** T-07.19, T-07.17.
- **T-07.22 · Gate `pre-skill`/`pre-mcp` no `PortaGanchos`** — `gate.ts` (puro) + novos casos em `criarGanchosClaude.tratar`
  (`orquestracao/hooks/claude.ts`): lê o snapshot do Pane (cache em `Map`, invalidado por `catalog.changed` e por respawn),
  normaliza o nome (`plugin:skill` → último segmento normalizado), decide `permitido|negado`; negado → resposta `deny` do contrato
  acima, evento `skill.blocked` e linha em `evento_dominio`; Pane sem snapshot (livre) → libera; erro interno no gate → **nega**
  (falha fechada). `gancho.mjs`: `FALHA_FECHADA` para `pre-tool-use`, `pre-skill`, `pre-mcp`. **Aceite:** 3 skills permitidas, a
  4ª bloqueada, e o bloqueio vale mesmo com o Pane em modo automático (o gate roda como hook, não como permissão); app fora do ar
  = bloqueia; P-28 (≤ 80 ms p95). **Testes:** `gate.test.ts` (tabela), `hooks/claude.test.ts`, `gancho-e2e` com CLI falsa que
  dispara o hook. **Depende:** T-07.21.
- **T-07.23 · Isolamento parcial: Codex, OpenCode, Gemini** — `isolamento/parcial.ts`: (a) lista das skills permitidas no arquivo de
  instruções (`instrucoes.md`) como texto ("use somente estas skills"), (b) OpenCode: tenta `permission.skill` no
  `OPENCODE_CONFIG_CONTENT` **somente se** o teste de contrato (T-07.25) confirmar suporte na versão detectada; senão fica como
  texto, (c) gate no MCP (`catalog_list`/`pane_spawn`), (d) `nivel_isolamento = "parcial"`, evento `catalog.isolation_partial`,
  selo amarelo no Pane e na Política (T-07.32), `AchadoSaude.isolamento_parcial`. Nunca isolar por permissão de pasta/arquivo
  nem por `CODEX_HOME` efêmero (quebra login — pegadinha da spec; não se mexe em `auth.json`). **Aceite:** Missão `squad` num
  Pane Codex abre e funciona, com selo `parcial` visível e evento registrado; nenhuma pasta de config do usuário alterada.
  **Testes:** snapshot do `instrucoes.md` e do `OPENCODE_CONFIG_CONTENT`; teste de que `auth.json`/`CODEX_HOME` não são tocados.
  **Depende:** T-07.19.
- **T-07.24 · Saúde do catálogo** — `saude.ts#avaliarSaude({workspace_id, politicas, itens})` → `AchadoSaude[]`: `skill_inexistente`
  (política referencia nome que não existe), `descricao_vazia` (prejudica a escolha), `symlink_quebrado`, `variantes_divergentes`
  (hashes diferentes entre CLIs), `mcp_nao_verificado` (aviso discreto), `isolamento_parcial`. Chamado por `catalogo:saude` e por
  `missoes:criar` (a UI mostra os achados da Missão antes do intake; `erro` não bloqueia — vira aviso e o Pane ignora a skill
  ausente). **Aceite:** política com skill inexistente acusa **antes** do primeiro `pane_spawn`; máquina limpa sem política = zero
  erros. **Testes:** `saude.test.ts`. **Depende:** T-07.18, T-07.12.
- **T-07.25 · Testes de contrato por CLI (`smoke isolated`)** — `tests/contrato/catalogo-isolamento.test.ts` com **CLI falsa**
  (`tests/fixtures/cli-catalogo.mjs`: fala MCP, dispara os hooks do settings gerado e tenta usar a 4ª skill) e, opcionalmente,
  CLI real quando `EXPXV_TESTE_CLI_REAL=1` (nunca roda no piloto automático: sem custo, sem rede). Verifica por versão: `--plugin-dir`,
  `--strict-mcp-config`, `permissions.deny` com `Skill(x)`, `permission.skill` do OpenCode, caminhos de skills do Codex/OpenCode;
  falha com mensagem que diz qual premissa mudou. O resultado alimenta `NIVEL_POR_CLI`. **Aceite:** com a CLI falsa o ciclo
  settings → hook → gate bloqueia a 4ª skill; premissa quebrada = teste vermelho (não silêncio). **Depende:** T-07.22, T-07.23.

### 7E — UI (compacta, D-32; destaque azul)

- **T-07.26 · Estado do renderer** — `src/renderer/estado/catalogo.ts` (`useSyncExternalStore`): cache por tipo
  (`itens`, `ultima_varredura_em`), assinatura de `catalogo:progresso/concluido/mudou` (coalesce em 1 quadro), índice de busca
  pré-computado (reuso de `busca-fuzzy.ts`), seleção/gaveta, `varrendo`, `erros por CLI`. **Aceite:** trocar de aba de tipo não faz
  IPC se o cache é recente; `mudou` aplica diff (não recarrega tudo); P-26 (≤ 16 ms/tecla, zero IPC). **Testes:** `catalogo.test.ts`
  (estado) + teste de desempenho com 5 000 itens. **Depende:** T-07.12, T-07.01.
- **T-07.27 · Tela Catálogo: linha única e tabela virtualizada** — `telas/catalogo/{Catalogo,TabelaCatalogo}.tsx` (lazy; menu lateral
  "Catálogo", ícone próprio). Uma linha de controles de ≈ 28 px: abas de tipo pequenas (Skills · MCPs · Plugins · Hooks · Regras) ·
  busca · filtros por CLI (ícones 20–24 px, `title`/`aria-label`) · refresh · contador "N ausentes" (só se houver) · botão
  Política — tudo na MESMA linha, nada de títulos de página. Tabela com `VirtualLista` (linha 24 px, fonte 11–12 px): nome ·
  plugin/autor · colunas Claude | Codex | OpenCode | Gemini | .agents com badge 14 px (global/projeto/ausente/quebrado + símbolo,
  nunca só cor) · selo `método`/`embarcada`/`terceiro`. **Aceite:** P-25 e P-30; fração da área útil ocupada pela tabela ≥ 90%
  (mesmo teste do D-32); estados vazio ("nenhuma CLI detectada: como instalar"), carregando e erro por CLI (badge na coluna, não
  bloqueia). **Testes:** RTL + `tests/catalogo-ui.e2e.test.ts` com contagem de nós. **Depende:** T-07.26.
- **T-07.28 · Busca, filtros e agrupamento** — filtro por CLI/origem/estado (≤ 8 opções, ícones), ordenação por nome/CLI/origem,
  agrupar por plugin/autor (cabeçalho de grupo recolhível, virtualizado), "só ausentes", "só variantes divergentes". **Aceite:**
  filtros combinam; agrupar 2 000 itens mantém 60 fps; teclado completo. **Testes:** RTL + propriedade (filtro ⊆ conjunto).
  **Depende:** T-07.27.
- **T-07.29 · Gaveta de detalhe e ações** — `Gaveta.tsx`: painel lateral recolhível (320 px) sobre a tabela, nunca fixo: descrição
  (saneada), instalações (com `caminho_rel` e base), hash curto, variantes, ações **Instalar em <CLI>** (symlink; cópia se
  Windows sem privilégio), **Remover de <CLI>** (só criado pelo app ou "Mover para a lixeira" com diálogo da UI — nunca
  `window.confirm`), **Remover do catálogo**, **Revelar**. Itens `metodo`/plugin/terceiro: sem editar; botões de remover/instalar
  desabilitados com o motivo ("gerenciado pelo expxdev"). **Aceite:** `already_installed` aparece como estado, não como erro;
  conflito oferece "substituir" **só** se o destino for symlink criado pelo app; zero diálogos nativos. **Testes:** RTL +
  e2e do fluxo instalar/repetir. **Depende:** T-07.27, T-07.14, T-07.15.
- **T-07.30 · Abas MCPs, Hooks, Regras e Plugins** — MCPs: transporte, executável/origem redigidos, "tem segredo" (ícone), botão
  **Verificar ferramentas** (diálogo de confirmação com o comando/URL redigido; lista as tools verificadas); Hooks: evento,
  executável, modo do método (aviso/bloqueio/desligado, só leitura, com o comando sugerido `/expx:…` para promover — o ADE não
  edita `.expx/hooks.json`), selo `gerenciado`; Regras: arquivo, tamanho, linhas, "revelar"; Plugins: habilitado, origem, versão.
  **Aceite:** nada de conteúdo de arquivo/segredo aparece; Gemini/Codex sem hooks mostra "não suportado" (não vazio). **Testes:**
  RTL por aba. **Depende:** T-07.28, T-07.13.
- **T-07.31 · Seção "Skills do produto" (embarcadas)** — `Embarcadas.tsx`: lista das 7 `ev-*` com versão do pacote, por CLI
  instalada/editada/opt-out; botões **Instalar em <CLI>** (confirma que grava no escopo global da CLI), **Atualizar** (preserva
  editadas e avisa), **Não instalar** (opt-out persistente). Texto fixo: "Em Missões, o ExpxV entrega essas skills a cada Pane
  sem copiar nada para a sua casa; instalar aqui é opcional." **Aceite:** sem clique, nada é copiado; opt-out sobrevive a reinício.
  **Testes:** RTL + e2e com casa de teste. **Depende:** T-07.17, T-07.27.
- **T-07.32 · Editor de política e prévia** — `Politica.tsx` (gaveta ou diálogo a partir do botão Política): escolher alvo (papel /
  agente / Missão), marcar skills (lista virtualizada com busca + grupos `grupo:metodo`, `grupo:embarcadas`), `mcp_do_usuario`
  (`nenhum`/`lista` + servidores), **prévia por CLI** (`catalogo:politica_previa`: skills efetivas, `faltando`, selo `duro`/`parcial`
  em azul/âmbar com texto). **Aceite:** gravar → prévia muda; skill inexistente aparece em `faltando`; selo `parcial` nunca omitido.
  **Testes:** RTL + e2e (política → `pane_spawn` com CLI falsa → `catalog_list` devolve só as permitidas). **Depende:** T-07.18,
  T-07.27, T-07.20.
- **T-07.33 · Integração com a casca, paleta e acessibilidade** — entrada no menu lateral e na paleta (`Catálogo: abrir`,
  `Catálogo: atualizar`), badge de saúde no rodapé (só se houver `erro`), `role="grid"`/`aria-rowcount` na tabela virtualizada,
  foco visível, `prefers-reduced-motion`, contraste AA nos dois temas, nenhuma cor literal fora de `tokens.css` (varredura). **Aceite:**
  `a11y.e2e` sem violação nova; navegação 100% por teclado; troca de tela p95 ≤ 50 ms (P-02). **Testes:** estende `tests/a11y.e2e.test.ts`
  e `contraste.test.ts`. **Depende:** T-07.27..T-07.32.

### 7F — Fechamento

- **T-07.34 · Passe de desempenho** — `tests/perf/catalogo.perf.ts` + `tests/fixtures/catalogo/gerar.ts` (casa sintética: 200
  skills em 4 CLIs × global/projeto, 20 MCPs, 30 hooks, regras); mede P-23..P-31 e grava em `docs/ade/perf/ultimo.json`; corrige a
  causa se estourar (nunca o limite). **Aceite:** P-23..P-31 verdes; P-01, P-02, P-08, P-12, P-15 não pioraram. **Depende:** T-07.33.
- **T-07.35 · E2E no Electron real** — `tests/catalogo.e2e.test.ts` (`E2E=1`, `E2E_HOME` = casa de teste): (1) abrir Catálogo, varrer,
  ver 1 linha com 2 badges; (2) apagar skill da casa → refresh → `ausente`; "clear missing" remove; (3) instalar em Codex → symlink →
  repetir `ja_instalado`; (4) Missão `squad` com política de 3 skills, CLI falsa tenta a 4ª → `skill.blocked`; (5) `livre` vê tudo e
  a tool `catalog_list` não existe; (6) casa limpa: nada criado fora do `userData`; (7) zero diálogos nativos. **Aceite:** todos
  verdes; sem processo vivo (`tests/limpeza.ts`; conferir com `ps`). **Depende:** T-07.33.
- **T-07.36 · Auditoria de segurança e fechamento** — checklist executado e registrado no `STATUS.md` pelo coordenador:
  (a) varredura de strings sobre banco/logs/eventos atrás de segredos das fixtures; (b) path traversal e symlink de escape na
  instalação e no scanner; (c) prompt injection pelo campo `description` (fixture com "ignore as instruções anteriores…" aparece só
  como texto saneado e dentro de `catalog_list` não vira instrução); (d) gate falha fechado com app parado; (e) nenhum arquivo
  criado em `~/.claude`/`~/.codex`/`.claude/` sem ação do usuário; (f) `electron-builder.yml` com `asarUnpack` das skills;
  (g) atualizar `05-CONTRATOS.md`, `AGENTS.md` (decisões D-40..D-45), `06-FASES.md` (7 detalhada), `STATUS.md`. **Aceite:** checklist
  sem achado aberto; portão da fase verde. **Depende:** T-07.34, T-07.35.

## UI compacta (resumo do que vale para todas as telas desta fase)

Uma linha de controles de ≈ 28 px; abas de tipo de 24–26 px; botões de ícone 20–24 px com `title`/`aria-label`; tabela com
linha de 24 px e fonte 11–12 px; gaveta lateral de 320 px que cobre a tabela (não empurra); badges de CLI de 14 px com símbolo
(global ●, projeto ◐, ausente ○, quebrado !) — **cor nunca é o único sinal**; selo de isolamento com texto (`duro`/`parcial`);
destaque azul dos tokens; sem `backdrop-filter`; transições só de `transform`/`opacity`; todo texto em PT-BR.

## Casos de teste de aceitação das specs (AC) — todos viram teste automatizado

| AC | Cenário (spec-05 §12) | Task |
|---|---|---|
| AC-07.01 | `frontend-design` em Claude e Codex = 1 linha, 2 badges | T-07.05, T-07.08, T-07.27, e2e T-07.35 |
| AC-07.02 | skill removida do disco → `ausente`, nada apagado; "clear missing" remove | T-07.11, T-07.15, T-07.35 |
| AC-07.03 | instalar em Codex cria symlink; repetir = `ja_instalado` | T-07.14, T-07.35 |
| AC-07.04 | Pane com 3 skills em `squad`: a 4ª é bloqueada, inclusive em modo automático | T-07.21, T-07.22, T-07.25, T-07.35 |
| AC-07.05 | modo `livre`: todas as skills visíveis (sem filtro) | T-07.18, T-07.21, T-07.35 |
| AC-07.06 | máquina limpa: embarcadas disponíveis por Pane; opt-out persistente (versão ExpxV de "voltam no boot", D-43) | T-07.16, T-07.17, T-07.31 |
| AC-07.07 | worker que tenta encerrar sem handoff é barrado; wake só após persistir | já coberto na Fase 3 (T-03.04); regressão em T-07.22 (gate não interfere no stop hook) |
| AC-07.08 | `pane_read {last_n:100}` de 500 linhas = 100 | já coberto na Fase 3 (T-03.02); não regredir |
| AC-07.09 | `agent_invoke`/`pane_spawn` do piloto para si mesmo = `rule_violation` | já coberto na Fase 3 (T-03.05); não regredir |
| AC-07.10 | `squad` sem `memory_*` no `tools/list` | T-08.12 (Fase 8) |
| AC-07.11 | MCP offline → `tools_status` não quebra a varredura | T-07.06, T-07.13 |
| AC-07.12 | política com skill inexistente é acusada antes da Missão | T-07.24 |

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| **Isolamento só parcial fora do Claude Code** | skill vaza em Pane Codex/OpenCode/Gemini | selo `parcial` visível, evento e achado de saúde; texto de instruções + gate de MCP; teste de contrato por versão da CLI (T-07.25); P-19 do dono: bloquear ou aceitar |
| **Segredo em config de MCP** (`~/.claude.json`, `config.toml`) | vazamento para banco/log/UI | redação **na origem** (valor nunca copiado), varredura de strings nos testes (T-07.06/.36), objeto bruto descartado no worker |
| **Prompt injection via `description`/skill de terceiro** | agente executa instrução escondida | descrição saneada + truncada + tratada como dado; `catalog_list` não devolve corpo da skill; embarcadas são nossas e com hash |
| **Escrever na casa do usuário** (`~/.claude/skills`) | poluir/quebrar config | só por ação explícita; atômico; só remove o que o app criou; resto vai à lixeira (D-36) |
| **Executar MCP do usuário para listar tools** | efeito colateral, custo | só sob confirmação, ambiente mínimo, timeout 5 s, árvore morta; desligável (P-20 do dono) |
| **Varredura pesada/ruidosa** | quebra P-01/P-12 | worker, cache, lotes, sem watcher, onda 2 ociosa, orçamentos P-23/P-24 |
| **Caminhos das CLIs mudam** (Codex/OpenCode/Gemini) | scanner cego | `[DEC]` + teste de contrato + erro nominal por CLI (não aborta) + P-26 do dono para confirmar na máquina real |
| **Gate lento ou indisponível trava o agente** | Pane parado | `gancho.mjs` com timeout 8 s; falha fechada **só** para gate/guarda; orçamento P-28; mensagem acionável |
| **`--plugin-dir`/`--strict-mcp-config` mudam de nome** | embarcadas por Pane param de entrar | teste de contrato (T-07.25) + plano B: texto das skills no `--append-system-prompt`/instruções |
| **Skill do método bloqueada por engano** em Pane de Missão | fluxo sprintx/runx quebra | `grupo:metodo` no piloto por padrão; prévia de política; achado de saúde |
| **Windows sem symlink** | instalação falha | junction → cópia; testes de unidade simulando EPERM (D-26: sem validação real) |

## Ordem de execução e paralelismo

```
T-07.01 ─► T-07.02 ─┬► T-07.03 ─► T-07.04 ─┬► T-07.05 ─┐
                    │                      ├► T-07.06  │
                    │                      ├► T-07.07 ─┼► T-07.10 ─► T-07.11 ─► T-07.12 ─► T-07.13
                    │                      ├► T-07.08  │                    │
                    │                      └► T-07.09 ─┘                    ├► T-07.14 ─► T-07.15
                    │                                                       ├► T-07.24
                    └► T-07.16 (só depende de T-07.03) ─► T-07.17 (após T-07.14)
T-07.18 (após T-07.02/.03) ─► T-07.19 ─┬► T-07.20 ─┐
                                        ├► T-07.21 ─► T-07.22 ─┬► T-07.25
                                        └► T-07.23 ────────────┘
T-07.26 (após T-07.12) ─► T-07.27 ─► T-07.28 ─┬► T-07.29 ─┐
                                               ├► T-07.30  ├► T-07.33 ─► T-07.34 ─► T-07.35 ─► T-07.36
                                               ├► T-07.31  │
                                               └► T-07.32 ─┘
```

Áreas de arquivo disjuntas (≤ 5 agentes simultâneos; ninguém edita o mesmo arquivo):

| Agente | Tasks | Áreas que possui |
|---|---|---|
| **Coordenador** | T-07.01, T-07.12 (parte main), T-07.19 (`src/main/orquestracao.ts`), T-07.36 | `src/compartilhado/**`, `src/preload/**`, `src/main/**`, docs |
| **A — Scanners** | T-07.03..T-07.11 | `src/nucleo/catalogo/{normalizar,sanear,frontmatter,raizes,varredura,worker}.ts`, `scanners/**`, `tests/fixtures/catalogo/**` |
| **B — Dados e instalação** | T-07.02, T-07.13..T-07.17, T-07.24 | `src/nucleo/banco/**` (só `0003` e `repos/catalogo.ts`), `instalacao.ts`, `embarcadas/**`, `mcp-verificar.ts`, `saude.ts`, `scripts/gerar-manifesto-skills.mjs`, `resources/skills/**` |
| **C — Política e isolamento** | T-07.18, T-07.20..T-07.23, T-07.25 | `politica.ts`, `gate.ts`, `isolamento/**`, `src/nucleo/mcp/**`, `src/nucleo/orquestracao/**`, `tests/contrato/**` |
| **D — UI** | T-07.26..T-07.33 | `src/renderer/telas/catalogo/**`, `src/renderer/estado/catalogo.ts` (+ entrada de menu em `casca/`, acordada com o coordenador) |

Sequência recomendada: onda 1 = T-07.01, T-07.02, T-07.03 (coordenador + B + A); onda 2 = A (T-07.04..T-07.10), B
(T-07.16), C (T-07.18) em paralelo; onda 3 = T-07.11/.12 → B (T-07.13..T-07.15, T-07.17, T-07.24), C (T-07.19..T-07.23),
D (T-07.26..T-07.33); onda 4 = T-07.25, T-07.34..T-07.36. UI pode começar com dados falsos assim que T-07.01 e T-07.26 existirem.

## Decisões `[LAC]` das specs resolvidas (registradas como D-40..D-45 em `01-DECISOES.md`)

| `[LAC]` / ponto | Escolha | Onde |
|---|---|---|
| CLIs do catálogo (spec: Claude, Codex, Antigravity) | `claude`, `codex`, `opencode`, `gemini` + `.agents` portátil; sem Antigravity (D-05, fora do ExpxV) | D-40 |
| Tipos de item | `skill`, `mcp_server`, `mcp_tool`, `plugin`, `hook`, `rule`; `tool` nativa e `command` ficam fora; origem extra `metodo` | D-40 |
| Escrita do catálogo no disco | só escopo global, só por ação explícita, nunca no repositório; remove só o que o app criou, resto vai à lixeira | D-41 |
| `tools/list` de MCP no scan (RF-05.06 "deveria") | **nunca** no scan; sob demanda com confirmação; redação na origem | D-42 |
| 10 skills embarcadas e "voltam no boot" | 7 `ev-*`; **não** copiadas no boot; entregues por Pane em plugin efêmero; instalação global opt-in; `opt_out` persistente | D-43 |
| Allow-list por CLI | duro só no Claude Code (gate + `deny` + `--strict-mcp-config`); parcial nas demais com selo; nunca por pasta/`CODEX_HOME` | D-44 |
| Identidade da linha (`unique (kind, nome, plugin)` × "1 linha, N badges") | `(tipo, nome_normalizado)`; plugin/autor são atributo; `variantes` quando o hash diverge | D-45 |
| Formato de `convert` | fora (P2): só symlink/cópia | — |
| Hooks/regras no Codex/Antigravity | Codex: regras sim, hooks "não suportado"; sem Antigravity | T-07.08 |
| Proteção de built-in/marketplace, marketplace, meta-skill, vault | fora desta fase | — |
| Bloquear subagentes ocultos (RF-05.55) | não: o método depende de agentes; limite registrado | T-07.21 |
| Quem escolhe skills em modo agêntico | política por papel/agente/Missão (Fase 7); recomendação por tarefa vem do harness (Fase 9) | T-07.18 |
