---
spec: "Catálogo unificado de Skills, MCPs, Hooks e Regras"
slug: "spec-05-catalogo-skills-mcp-hooks"
modulo_fonte: ["05-catalogo-skills-mcp-hooks"]
status_origem: parcial
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-02-orquestracao-modo-agentico", "spec-03-harness-roteamento-decisor", "spec-04-providers-e-modelos", "spec-06-over-memory"]
---
# Spec 05 — Catálogo unificado de Skills, MCPs, Hooks e Regras

## 1. Resumo e objetivo
O catálogo é a base da pirâmide tool → McpTool → Skill → Agent → SquadRole → Squad → Mission [OBS: módulo 05, Dia 24]. Ele (a) descobre o que o usuário já tem instalado em cada CLI (Claude Code, Codex, Antigravity), (b) exibe tudo numa tela única por tipo, com uma linha por item e uma coluna por CLI, (c) permite portar Skills entre CLIs (symlink/conversão), (d) instala/atualiza as Skills embarcadas do produto, (e) aplica isolamento por Agent (allow-list de Skills e tools, por código e não por prompt) e (f) expõe o próprio Overclock como servidor MCP, com Hooks que garantem o protocolo de handoff.
Problemas resolvidos [OBS: módulo 05, "Objetivo"]: o usuário não sabe o que tem instalado em cada CLI; todo agente carrega todas as Skills (mais tokens, escolha errada de Skill, "alucinação"); orquestração exige primeiro tools/MCPs/Skills bem definidos; em máquina limpa o harness quebrava por depender de Skills que só existiam na máquina do autor (Dia 75).

## 2. Escopo e não-escopo
**Cobre:** varredura e persistência do catálogo; tela de Catálogo; portabilidade de Skill; Skills embarcadas (boot); allow-list por Agent/Pane; MCP interno do Overclock (contrato); Hooks injetados por Pane; Regras (listagem e regras de orquestração do produto).
**Não cobre:** roteamento de Skill por tipo de tarefa (tabela de harness) → [[spec-03-harness-roteamento-decisor]]; ciclo de vida de Mission/Squad → [[spec-02-orquestracao-modo-agentico]]; escolha de conta/modelo → [[spec-04-providers-e-modelos]]; tools de memória → [[spec-06-over-memory]] (aqui só o gate); planos/cobrança → spec de planos.
**Fase 2 (planejado/parcial no original):** marketplace de "1000+ agentes e Skills" com espaço para negócios de terceiros [OBS: Dias 32, 76, só planejado]; meta-skill que agrupa pacote de Skills por autor (levantada, não concluída) [OBS: Dia 32]; Arsenal/"enriquecer"/receitas [OBS: Dia 44, parcial]; cofre (vault) AES-256 com MCP próprio [OBS: arquivo 37, previsto]; Skills built-in premium não exportáveis (proteção, ver spec de infra); CLIs além das três (Kimi, Grok, Open Code) [OBS: menções].

## 3. Glossário e atores
- **Item de catálogo**: registro de `kind` ∈ {skill, mcp_server, mcp_tool, tool, plugin, hook, rule}.
- **CLI alvo**: `claude_code`, `codex`, `antigravity` (comando `agy`) [OBS]. Gemini foi removido do catálogo [OBS: Dia 32].
- **Scope de instalação**: `global` (home do usuário) ou `project` (pasta do Workspace).
- **Allow-list**: lista de Skills/McpTools permitidas a um Agent/Pane; aplicada no spawn do Pane.
- **Atores**: usuário (Configurações → Catálogo); Agent (consome Skills/tools; chama o MCP do Overclock); sistema (scanner, instalador, gerador de config de Pane).

## 4. Requisitos funcionais
**Descoberta**
- RF-05.01 O scan DEVE rodar no processo principal, expor resultado ao renderer por IPC e persistir no banco local. [OBS: opção "B", Dia 32] Aceite: renderer não lê disco de CLI diretamente.
- RF-05.02 O scan DEVE cobrir skills, MCP servers, tools nativas, plugins, hooks e regras das 3 CLIs, em scope global e project. [OBS: Dia 32; plugins/hooks entraram depois] Aceite: item presente em `~/.claude/skills` aparece com badge Claude/global.
- RF-05.03 Refresh DEVE ser upsert; item que sumiu do disco DEVE virar `status=missing`, nunca ser apagado; botão "clear missing" só visível se houver missing. [OBS: Dia 32] Aceite: refresh sem mudanças não altera contagem.
- RF-05.04 Itens de mesmo nome, ignorando caixa/pontuação, DEVEM cair na mesma linha (colunas por CLI). [OBS: Dia 32, bug de duplicatas] Aceite: `frontend-design` em 3 CLIs = 1 linha, 3 badges.
- RF-05.05 Skills de plugin e skills oficiais do Codex DEVEM ser detectadas (não "missing" falso). [OBS: bug Dia 32] [DEC: scanner segue os manifestos de plugin de cada CLI]. Aceite: skill de plugin instalado aparece `present`.
- RF-05.06 Tools de um McpServer DEVERIAM ser listadas apenas se o servidor responder (`tools/list`); caso contrário `tools_status=unavailable` sem erro fatal. [OBS: tools só aparecem com servidor logado/rodando] Aceite: servidor offline não quebra o scan.
- RF-05.07 Skill sem autor/plugin DEVE ser marcada `origin=user`. [OBS: Dia 32] Aceite: campo preenchido.

**Tela**
- RF-05.10 Configurações DEVE ter a tela Catálogo com seção por tipo, tabela de largura total, detalhe em painel lateral recolhível sobre a tabela (não fixo). [OBS: Dia 32]
- RF-05.11 DEVE haver busca, filtros compactos (ícones, máx. 8 categorias/temas), ordenação por nome/CLI, logos de CLI no lugar de texto (também em hooks e regras), agrupamento por plugin/autor. [OBS: Dia 32]
- RF-05.12 Deletar DEVE ser por CLI (remove só a instalação daquela CLI); "remover do catálogo" é ação separada. [OBS: bug/pedido Dia 32]
- RF-05.13 Skills de terceiros (`origin != user` e não embarcada) NÃO DEVEM ser editáveis pela UI nem por Agent. [OBS: regra de produto, Dia 32]

**Portabilidade**
- RF-05.20 DEVE existir ação "Instalar em <CLI>" que cria symlink da pasta da Skill (com `SKILL.md`) do diretório de skills da CLI de origem para o da CLI destino. [OBS: Dias 32/28]
- RF-05.21 Se a Skill exigir formato diferente, DEVE existir modo `convert` (gera cópia adaptada) [OBS: "sync/convert", arquivos 44-45; formato exato desconhecido → ver 7.3]. 
- RF-05.22 A UI DEVE detectar "já existe no destino" (evitar `target already exists` sem feedback) e marcar a linha corretamente. [OBS: bug Dia 32] Aceite: instalar duas vezes retorna `already_installed`, não erro.
- RF-05.23 A instalação DEVE ser atômica: falha não deixa link quebrado. [DEC: evitar estado inconsistente]

**Skills embarcadas**
- RF-05.30 No boot, o app DEVE copiar as Skills embarcadas (manifesto versionado) para o diretório de cada CLI detectada. [OBS: 10 skills, Dia 75]
- RF-05.31 Nomes DEVEM ser em inglês com prefixo `oc` (ex.: `oc-guide`). [OBS: Dia 75]
- RF-05.32 O usuário DEVE poder remover as embarcadas em Configurações; elas DEVEM voltar no boot seguinte. [OBS: Dia 75] [LAC] não há opt-out permanente; ver Questões.
- RF-05.33 Atualização: no boot, se `manifest.version` > versão instalada e o arquivo não foi editado (hash igual ao instalado anterior), DEVE sobrescrever; se editado, DEVE preservar e avisar. [DEC: o original não descreve atualização]
- RF-05.34 O produto NÃO DEVE depender de Skill de terceiros no harness/squad; toda Skill referenciada por Policy/SquadRole DEVE existir no catálogo canônico. [OBS: bug Dia 75 Superpowers] Aceite: em máquina limpa, nenhuma referência pendente (RF-05.62).

**Catálogo canônico e isolamento**
- RF-05.40 DEVE existir um único catálogo canônico de Skills usado por modo livre, squad e harness ("não pode ser a mesma skill para duas coisas iguais"). [OBS: Dia 75]
- RF-05.41 Agent = SquadRole + `allowed_skills` + `allowed_tools` + Provider/modelo; o MCP do Overclock DEVE reler a especificação do Agent a cada invocação. [OBS: Dias 32-33]
- RF-05.42 O bloqueio DEVE ser hard, por permissão em código (white list, inclusive tools), não por prompt, mesmo com `--dangerously-skip-permissions`. [OBS: Dia 33]
- RF-05.43 O isolamento NÃO DEVE ser feito por permissão de pasta/arquivo (quebrou login; revertido). [OBS: Dia 32]
- RF-05.44 Em modo livre não há filtro; em modo squad, filtro = skills do Agent; em modo agêntico, filtro = skills da Policy/tarefa. [OBS: módulo 05 "Modelos de uso"]
- RF-05.45 Um Pane sem allow-list explícita no modo squad/agêntico DEVE receber lista vazia de Skills (deny by default). [DEC: coerente com "squad sem tools de memória"]
- RF-05.46 Squad NÃO DEVE receber nenhuma tool de memória (gate de Skill/tool reaproveitado). [OBS: Dia 49, arquivo 42]
- RF-05.47 Codex como piloto DEVE carregar as Skills do Agent em modo squad/agêntico. [OBS: bug Dia 77 — requisito derivado do bug]

**MCP e Hooks**
- RF-05.50 O Overclock DEVE expor um servidor MCP local com as tools da seção 6(c). [OBS: "na raiz, o Overclock é um MCP", Dia 32/62]
- RF-05.51 `pane_read` DEVE respeitar `last_n` (bug: limitava a 40 linhas). [OBS: auditoria Dia 28]
- RF-05.52 Todo Pane criado pelo app DEVE carregar dois stop hooks que barram o fim do turno sem `handoff_submit`. [OBS: Dia 51]
- RF-05.53 DEVE haver hook pós-tool que acorda o chamador com o resultado, escrito somente após o resultado estar persistido. [OBS: Dia 51, bug do "post-it"]
- RF-05.54 DEVE haver hook de session start que injeta contexto (comanda + memória) no Pane. [OBS: Dia 49; conteúdo → [[spec-06-over-memory]]]
- RF-05.55 O MCP DEVERIA tentar impedir subagentes ocultos da CLI (background sem visibilidade), sem garantia. [OBS: Dia 28]
- RF-05.56 Autenticação do MCP por token com escopo (workspace/mission/pane/role); o MCP NÃO DEVE dar acesso a banco nem chaves. [OBS: arquivo 37; token: Dia 49] [DEC: formato do token]

**Regras**
- RF-05.60 O catálogo DEVE listar Regras (CLAUDE.md, AGENTS.md, SOUL.md) por CLI/scope, somente leitura em V1. [DEC: original só listava; dúvida sobre o local, Dia 32]
- RF-05.61 O produto DEVE impor regras de orquestração no MCP (não só no prompt): orquestrador não invoca a si mesmo nem outro orquestrador; só chama Agents do Squad; não declara done sem passar pelo reviewer; workers herdam mission_id e rótulo de cargo. [OBS: Dia 33] Aceite: `agent_invoke` violando regra retorna erro `rule_violation`.
- RF-05.62 Skill referenciada e ausente DEVE ser reportada no "health check" do catálogo (antes de missão). [DEC: previne bug Dia 75]

## 5. Modelo de dados
Persistência: SQLite local do Overclock [OBS], migração versionada. `CatalogItem` é upsert por `(kind, normalized_name, owner_key)`.

**CatalogItem** — `id` (uuid, obrig.), `kind` (enum, obrig.), `name` (obrig.), `normalized_name` (lower, sem `-_ ` ; obrig.), `plugin` (str|null), `author` (str|null), `origin` (`user|third_party|embedded|builtin`, default `user`), `description` (str|null; vazio prejudica escolha [OBS: Dia 44]), `category` (str|null; usado pelo "enriquecer" fase 2), `role_hint` (`scout|builder|reviewer|null`), `created_at`, `updated_at`. Invariante: único por `(kind, normalized_name, plugin)`.
**CatalogInstall** — `item_id`, `cli` (enum), `scope` (`global|project`), `workspace_id` (null se global), `path` (abs), `method` (`native|symlink|converted`), `status` (`present|missing`), `content_hash`, `last_seen_at`. Invariante: PK `(item_id, cli, scope, workspace_id)`.
**Skill** (extensão de CatalogItem kind=skill) — `entry_file` (`SKILL.md`), `version`, `embedded_manifest_id` (null).
**McpServer/McpTool** — `server_name`, `transport` (`stdio|http`), `command_or_url`, `tools_status` (`ok|unavailable`); `McpTool`: `server_name`, `tool_name`, `input_schema` (json), `description`.
**Hook** — `event` (`session_start|pre_tool|post_tool|stop|subagent|end_session` [OBS: Dia 65]), `command`, `cli`, `scope`, `managed_by_overclock` (bool).
**Rule** — `file_path`, `cli`, `scope`, `size_bytes`.
**AgentAllowlist** — `agent_id`, `allowed_skills[]` (nomes normalizados), `allowed_mcp_tools[]`, `updated_at`. Vive no Agent ([[spec-02-orquestracao-modo-agentico]]); catálogo valida referências.
**EmbeddedSkillManifest** (arquivo empacotado no app):
```json
{"manifest_version":"1.0.0","skills":[{"name":"oc-guide","version":"1.0.0","path":"skills/oc-guide","clis":["claude_code","codex","antigravity"],"sha256":"..."}]}
```
Exemplo de item:
```json
{"kind":"skill","name":"frontend-design","origin":"third_party","plugin":"anthropic","installs":[{"cli":"claude_code","scope":"global","method":"native","status":"present"},{"cli":"codex","scope":"global","method":"symlink","status":"present"}]}
```
Ciclo de vida: `discovered → present ⇄ missing → removed` (clear missing ou remoção manual). Embarcadas: `packaged → installed_at_boot → removed_by_user → reinstalled_next_boot`.

## 6. Interfaces
### (a) UI/UX
Configurações → Catálogo → abas: Skills, MCPs, Tools, Plugins, Hooks, Regras [OBS]. Cada aba: botão refresh (ícone), busca, filtro (ícone, canto superior direito), tabela [nome | plugin/autor | colunas com logo Claude/Codex/Antigravity com badge global/projeto/missing/ausente]. Clique na linha abre drawer direito recolhível com descrição, caminhos, ações "Instalar em…", "Remover de <CLI>", "Remover do catálogo". Ação por CLI ausente: "Instalar" (symlink). Botão "Clear missing" condicional. Ação de editar oculta para `origin != user`. Seção "Skills embarcadas" com botão "Remover embarcadas" e aviso "voltam no próximo boot" [OBS: Dia 75]. Estados: loading, vazio, erro por CLI (scan parcial mostra badge de erro na coluna, não bloqueia).
### (b) IPC/eventos (renderer↔main) [DEC nomes]
- `catalog:scan {kinds?:[], clis?:[]} → {scan_id}`; evento `catalog:scan_progress {scan_id, cli, kind, done, total}`; `catalog:scan_done {scan_id, added, updated, missing, errors:[{cli,kind,message}]}`.
- `catalog:list {kind, query?, filters?} → CatalogItem[]`; `catalog:install {item_id, from_cli, to_cli, mode:"symlink"|"convert", scope} → {status:"installed"|"already_installed"|"error", path}`; `catalog:uninstall {item_id, cli, scope}`; `catalog:clear_missing {kind}`; `catalog:embedded_remove`.
- Evento `catalog:changed {kind, item_ids[]}`.
### (c) Tools MCP do Overclock
Convenções [DEC]: nome snake_case; entrada JSON Schema; erros `{code, message}` com `code` ∈ {`unauthorized`,`not_found`,`invalid_argument`,`rule_violation`,`skill_not_allowed`,`conflict`,`unavailable`}. Tools observadas: abrir painel de provider/modelo, listar painéis sem print, enviar prompt a painel, `agent invoke`, `handoff submit`, listar missões, `pane read` com `last n` [OBS: Dia 28, 32, 62]; nomes/schemas abaixo são [DEC].
| Tool | Entrada | Saída | Erros |
|---|---|---|---|
| `pane_spawn` | `{provider_id, model?, account_id?, role?, mission_id?, cwd?, agent_id?}` | `{pane_id}` | `rule_violation`, `unavailable` |
| `pane_list` | `{mission_id?}` | `[{pane_id,provider_id,role,state}]` (sem conteúdo de tela) | — |
| `pane_read` | `{pane_id, last_n?:int=40, max_n=2000}` | `{lines:[str]}` (respeita `last_n`) | `not_found`,`unauthorized` |
| `pane_send` | `{pane_id, prompt}` | `{accepted:true}` | `not_found`,`unauthorized` |
| `agent_invoke` | `{agent_id, prompt, mission_id}` | `{pane_id, invocation_id}`; resultado volta via handoff+wake | `rule_violation`,`skill_not_allowed` |
| `handoff_submit` | `{mission_id, pane_id, task_id?, summary, artifacts?:[str], status:"done"\|"blocked"\|"failed"}` | `{ok}` | `invalid_argument` |
| `mission_list` | `{status?}` | `[Mission]` | — |
| `catalog_list` | `{kind, query?}` | itens do catálogo permitidos ao token | — |
Tools de Harness/Overclick/Headline são de outras specs (`harness_recommend` [[spec-03-harness-roteamento-decisor]]; `headline_pick` [[spec-04-providers-e-modelos]] [OBS: Dias 62-73]); memória em [[spec-06-over-memory]].
### (d) CLI/protocolos externos — instalação por CLI
| CLI | Skills | MCP | Hooks | Regras |
|---|---|---|---|---|
| claude_code | `~/.claude/skills/<n>/SKILL.md`, `<proj>/.claude/skills` [DEC: caminhos convencionais da CLI] | `.mcp.json`/settings | settings `hooks` (session_start, pre/post tool, stop, subagent) | `CLAUDE.md` |
| codex | `~/.codex/skills` [DEC; confirmar] | `~/.codex/config.toml` | mecanismo próprio; original mandou investigar [OBS: Dia 32] → [LAC] | `AGENTS.md` |
| antigravity (`agy`) | pasta de skills própria [LAC caminho] | config própria [LAC] | [LAC] | [LAC] |
Registro do MCP do Overclock em cada CLI: no spawn do Pane, injetar config apontando para o servidor local com token de escopo [DEC]; token relido a cada invocação [OBS].

## 7. Fluxos e algoritmos
### 7.1 Scan
1. `catalog:scan` → main enumera CLIs instaladas (via Providers, [[spec-04-providers-e-modelos]]). 2. Para cada CLI×kind×scope, parser lê diretório/config; normaliza nome; extrai `description` do frontmatter de `SKILL.md`. 3. Upsert de Item+Install (`last_seen_at=now`). 4. Installs não vistos neste scan → `missing`. 5. Emite `scan_done`. Erro em uma CLI não aborta as demais.
### 7.2 Isolamento por Pane [DEC: mecanismo técnico; original só cita "allow skills", parâmetro do Claude Code]
```
spawn_pane(agent, mode):
  if mode == "free": no filter
  skills = agent.allowed_skills if mode != free (vazio se indefinido)
  tools  = agent.allowed_mcp_tools ∪ {handoff_submit, pane_read,...core do papel}
  if squad: tools -= memory_*            # RF-05.46
  claude_code: gerar settings/flags por Pane que liberam apenas Skill(x) para x∈skills e negam o resto,
               + lista de MCP tools permitidas; NÃO alterar arquivos de skills nem permissões de pasta
  codex/antigravity: [LAC] sem equivalente confirmado → montar diretório de skills efêmero por Pane
               contendo só symlinks das permitidas e apontar a CLI para ele (se suportado); senão degradar
               para gate no MCP (skill_not_allowed) e registrar warning
  token_mcp = sign({workspace,mission,pane,role,allowed_tools})
```
Verificação em teste "smoke isolated": Agent com 3 Skills; `/skill` fora da lista deve responder inexistente/bloqueada [OBS: Dias 32-33]. Bug conhecido a evitar: mecanismo só-prompt deixa Skill vazar [OBS: Dia 33].
### 7.3 Portabilidade
`install(item, from, to, mode)`: (1) resolve pasta-fonte; (2) se destino existe: se symlink para a mesma fonte → `already_installed`; senão erro `conflict` com opção "substituir" [DEC]; (3) `symlink`: criar link; Windows sem privilégio → fallback para cópia [DEC]; (4) `convert`: copiar e adaptar frontmatter/paths para o destino [LAC: formato exigido por Codex/Antigravity não descrito]; (5) re-scan da linha; (6) verificar que a CLI destino lista a Skill (smoke) — o primeiro teste em Codex falhou antes de funcionar [OBS].
### 7.4 Boot das embarcadas
Para cada CLI detectada: comparar `manifest` × instalado; instalar ausentes; atualizar conforme RF-05.33; ignorar CLI não instalada; registrar `origin=embedded`.
### 7.5 Stop hook (máquina de estados do turno do worker)
| Estado | Evento | Novo estado |
|---|---|---|
| working | worker tenta encerrar sem handoff | blocked_by_stop_hook (hook devolve erro, CLI força continuar) |
| blocked_by_stop_hook | `handoff_submit` ok | handed_off |
| working | `handoff_submit` | handed_off |
| handed_off | pós-tool hook grava wake após persistir | orchestrator_woken |
Casos-limite: hook deve ter `max_retries` [DEC: 3, depois libera e marca `failed` para não loopar]; escrita do wake só após handoff persistido (bug "post-it") [OBS].

## 8. Prompts e textos embutidos
- Skill `oc-copywriting` (OC copywriting): texto lido no Dia 65 (arquivo 26) — trecho verbatim: "Use quando alguém pedir um pitch de vendas, VSL, script de venda... Um pitch que vende tem sempre a mesma espinha: promessa, história, jeito errado, jeito certo, oferta. Nessa ordem, sem pular, sem inverter. Você entrega duas versões do mesmo pitch: a de 60 segundos e a de 5 minutos." [OBS] (skill de conteúdo, não requisito do catálogo).
- Mensagem do stop hook (Dia 51, arquivo 41): 
```
O worker tentou encerrar o turno sem chamar handoff_submit. O orquestrador está bloqueado esperando.
Chame handoff_submit com o resumo do trabalho antes de encerrar.
```
[OBS: sentido; texto literal do hook não é ditado → redação [DEC]].
- Regras injetadas em prompt de orquestrador (Dia 33): "não invocar orquestrador nem a si mesmo; só chamar agentes da lista do squad; não declarar done sem reviewer" [OBS, paráfrase]; e "Sempre consulte o índice primeiro" [OBS, Dia 32].
- Lista das 10 Skills embarcadas: [LAC]. Nomes citados: guide (`overclock guide`, perguntas por nível), overclock MCP, papéis piloto/builder/scout, roteamento harness, plano de implementação a partir de specs, regras UI/UX, evidência antes de concluir, protocolos find/fix de bug, bateria de testes, `stream go`, gerador de UTM [OBS: Dia 75/76]. [DEC] Set mínimo do MVP: `oc-guide`, `oc-mcp`, `oc-pilot`, `oc-builder`, `oc-scout`, `oc-evidence-before-done`.
- Skill Fable Design (Dia 79, fonte 11): apresentação lida — receita em 4 fases, orquestrador = modelo mais capaz, executores de faixa média, um arquivo de sessão por Pane; texto integral não foi lido [LAC]; bug: instruir "execute tudo aqui" para o orquestrador não delegar [OBS]. Fase 2/conteúdo opcional.

## 9. Requisitos não-funcionais
- Desempenho: nenhuma meta numérica no original para scan [LAC]; [DEC] scan completo < 5 s com 200 Skills, tabela virtualizada (original relatou "tabela travando") [OBS: Dia 32]. Latência de delegação via MCP: ~39 s → ~11 s → quase instantânea após corrigir wake [OBS: Dia 51]; meta: wake < 2 s [DEC].
- Tokens: allow-list é a principal alavanca ("60 a 200 skills gastam contexto"); `catalog_list`/task list devem ter variantes de um item para economizar tokens [OBS: Dia 65].
- Portabilidade: macOS/Linux symlink nativo; Windows requer fallback de cópia [DEC]; Antigravity via `agy`.
- Segurança: MCP sem acesso a banco/chaves; tokens com escopo; nunca exibir chaves em regras/logs; built-in não exportáveis [OBS: Dias 44, 33, arquivo 37]; validar path traversal em instalação [DEC].
- Observabilidade: log de cada `catalog:*`, `skill_not_allowed`, `rule_violation`, disparo de stop hook [DEC].

## 10. Stack sugerida e restrições
[OBS] Electron (main+IPC+renderer), SQLite, symlinks, MCP, hooks do Claude Code, parâmetro "allow skills". [DEC] alternativas neutras: qualquer runtime desktop com processo privilegiado + UI; SDK MCP oficial em TypeScript; parser de frontmatter YAML. Restrição: não depender de comportamento privado das CLIs sem teste de contrato por CLI (versões mudam).

## 11. Plano de implementação
1. **MVP**: schema + scanner Claude Code/Codex/Antigravity (skills, MCP) + tela por tipo + upsert/missing. 2. Normalização de nomes/agrupamento, filtros. 3. Instalação por symlink + detecção `already_installed`. 4. MCP do Overclock (`pane_*`, `handoff_submit`, `mission_list`, `agent_invoke`) + tokens. 5. Hooks stop/pós-tool/session start. 6. Allow-list por Pane (Claude Code primeiro) + gate MCP. 7. Skills embarcadas + manifesto + atualização. 8. Plugins, hooks, regras na tela; convert. 9. Fase 2: enriquecer/arsenal/receitas, marketplace, meta-skill, vault.
Dependências: 4 antes de 5-6; 6 depende de spec-02 (Agent/Squad).

## 12. Casos de teste de aceitação
1. Dado Skill `frontend-design` em Claude e Codex, quando scan roda, então 1 linha com 2 badges.
2. Dado Skill removida do disco, quando refresh, então `missing` e nenhum item apagado; "clear missing" remove.
3. Dado Skill só em Claude, quando "Instalar em Codex", então symlink criado e badge Codex aparece; repetir retorna `already_installed`.
4. Dado Agent com 3 Skills em modo squad, quando o Pane usa uma quarta, então bloqueio mesmo com `--dangerously-skip-permissions`.
5. Dado modo livre, então todas as Skills da CLI visíveis.
6. Dado boot em máquina limpa, então 10 embarcadas instaladas em cada CLI detectada; após "remover", voltam no boot seguinte.
7. Dado worker que tenta encerrar sem handoff, então stop hook barra; após `handoff_submit`, orquestrador é acordado e o resultado já está persistido.
8. Dado `pane_read {last_n:100}` em Pane com 500 linhas, então retorna 100 linhas.
9. Dado `agent_invoke` do orquestrador para si mesmo, então `rule_violation`.
10. Dado squad, então tools `memory_*` ausentes de `tools/list` do token.
11. Dado servidor MCP offline, quando scan, então `tools_status=unavailable` e scan conclui.
12. Dado Policy referenciando Skill inexistente, então health check acusa antes da missão.

## 13. Questões em aberto e riscos
- [LAC] Mecanismo exato de allow-list em Codex e Antigravity; risco: isolamento parcial (só gate MCP).
- [LAC] Formato de `convert` entre CLIs e caminhos de hooks/regras no Codex/Antigravity.
- [LAC] Lista das 10 Skills embarcadas; política de opt-out permanente; política de atualização.
- [LAC] Número real de tools do MCP do Overclick (10/20/29) — fora desta spec; nomes de tools deste MCP são [DEC].
- [LAC] Conclusão da tela com hooks/regras e do isolamento no original (só há relato até o Dia 82).
- [LAC] Proteção de built-in não exportáveis e marketplace (modelo de licença).
- Risco: Skills de terceiros mudam de formato; symlink quebrado se origem for removida.

## 14. Rastreabilidade
| Requisito | Fonte |
|---|---|
| RF-05.01-.07 | 05 "Detecção", Dia 32 (arq. 45) |
| RF-05.10-.13 | 05 "Tela de Catálogo", Dia 32 |
| RF-05.20-.23 | 05 "Portabilidade", Dias 28/32 (arq. 49, 45) |
| RF-05.30-.34 | 05 "Skills embarcadas", Dia 75 (arq. 16) |
| RF-05.40-.47 | 05 "Isolamento", Dias 32-33, 44, 49, 77, 82 |
| RF-05.50-.56 | 05 "MCP do Overclock", Dias 28, 51, 62, arq. 37 |
| RF-05.52-.54 | 05 "Hooks", Dias 49, 51, 65 |
| RF-05.60-.62 | 05 "Regras", Dias 29, 32, 33 |
