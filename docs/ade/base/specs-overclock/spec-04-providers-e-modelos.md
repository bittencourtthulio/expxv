---
spec: "Providers e Modelos (camada de adapter para CLIs e APIs de IA)"
slug: "spec-04-providers-e-modelos"
modulo_fonte: ["04-providers-e-modelos", "09-overclock-headline (limites por conta)", "03-harness-roteamento-decisor (consumidor)"]
status_origem: construido
versao_spec: "0.1"
depende_de: ["spec-00-visao-arquitetura-e-glossario", "spec-01-terminais-paineis-workspaces", "spec-03-harness-roteamento-decisor", "spec-05-catalogo-skills-mcp-hooks", "spec-09-overclock-headline"]
---
# Spec 04 — Providers e Modelos

Legenda de selos: [OBS] observado (fonte entre parênteses; "mod04" = módulo 04-providers-e-modelos, "dNN" = dia NN das lives); [DEC] decisão do autor da spec; [LAC] lacuna que exige decisão do dono do produto.

## 1. Resumo e objetivo
O Overclock é "cockpit, não combustível" [OBS] (mod04, Modelo de negócio): não vende tokens; conecta ao app as IAs que o usuário já contratou (assinaturas de CLI, contas com login, bolsas de tokens, chaves de API) e as expõe como Panes ([[spec-01-terminais-paineis-workspaces]]) lado a lado. Esta spec define a camada de **Provider adapter**: (i) registro de providers e modelos; (ii) como lançar cada CLI num Pane; (iii) autenticação e multi-Account; (iv) override de endpoint compatível Anthropic/OpenAI para rodar modelos de terceiros dentro de Claude Code/Codex; (v) papel piloto vs worker; (vi) detecção de limite/erro; (vii) Watcher de modelos; (viii) checklist para adicionar provider novo.

Problema resolvido: fragmentação (cada CLI tem login, limites, formato de skills próprios), custo/limite de assinatura (orquestrar modelo caro no topo e baratos executando), e CLIs que escolhem modelo/subagente "por baixo do tapete" — o usuário deve decidir qual Provider/modelo/Account cada Pane usa [OBS] (mod04, Objetivo).

## 2. Escopo e não-escopo
**Cobre:** interface `ProviderAdapter`; registry (Claude Code, Codex, Gemini CLI, Antigravity `agy`, Grok, Kimi, GLM, MiMo, DeepSeek, Fireworks, OpenRouter, Ollama/local, Hermes, Command Code, Perplexity, Kiro, OpenCode, Cursor, GitHub Copilot); modelo Account por provider; detecção de CLIs e descoberta de modelos; configuração (liga/desliga provider e modelo, bypass permission); resume de sessão por provider; limites por Account (contrato com headline); Watcher de modelos; tools MCP de provider.

**Não cobre:** orquestração/roteamento por tarefa e o decisor (Jeev/Lia) → [[spec-03-harness-roteamento-decisor]] (consome esta spec); UI de Panes/PTY → [[spec-01-terminais-paineis-workspaces]]; sync/conversão de skills entre CLIs → [[spec-05-catalogo-skills-mcp-hooks]]; widget/menu bar de limites → [[spec-09-overclock-headline]]; planos/Entitlements → spec de planos; instalação em VPS → spec do Overclock Bot; assinatura/notarização/spawn Windows → [[spec-00-visao-arquitetura-e-glossario]] §7 (requisitos transversais: build, assinatura, segurança).

**Fase 2 (planejado ou incerto no original):** Headline embutido no app com fixar conta por workspace e troca de conta como tool MCP (planejado, backlog 1.4 — mod09, d75); instalar Ollama pelo app (só sugestão — mod04); Antigravity multi-conta (reprovado no d75, então fase 2); Pi/Droid/MiniMax como providers (só menções); "Union Alpha" como entrada de catálogo é dado de Watcher, não de código.

**Custo/qualidade por modelo:** apenas metadado sugerido (`ModelMeta`), nunca requisito nem critério de aceite [DEC] (as unidades e medições do material são ambíguas — mod04, Lacunas).

## 3. Glossário e atores
- **Provider**: origem de modelos + forma de autenticar + CLI/API que executa [OBS] (mod04, Visão geral).
- **Account**: credencial isolada de um Provider (login de assinatura, chave, OAuth). Contas "1" e "2" [OBS] (mod04, d44).
- **ProviderKind**: `cli_native` (CLI do próprio provider), `cli_hosted_model` (modelo de terceiro rodando dentro do Claude Code/Codex via override de endpoint), `api_aggregator` (OpenRouter), `local` (Ollama) [DEC — taxonomia do autor para organizar o registry].
- **Piloto/orquestrador** vs **worker/executor**, além de scout, reviewer, QA rápido, segurança [OBS] (mod04, Papéis).
- **Bypass permission** ("yolo" no Codex): CLI não pede aprovação de comandos [OBS].
- Atores: Usuário (configura providers/contas); Agente piloto (consulta providers via MCP e abre Panes); Sistema (detecção, watcher); Founder (único que vê a página de modelos) [OBS].

## 4. Requisitos funcionais
**RF-04.01 Detecção de CLIs.** O sistema DEVE, ao abrir o app, detectar CLIs instalados (claude, codex, gemini, kimi, agy, grok, cursor-agent/cursor, opencode, ollama, etc.) [OBS] (mod04, Comportamento). Binário do Antigravity é `agy`, não `antigravity` [OBS] (d28). Aceite: com `claude` no PATH, `Provider.claude-code.install_state=installed` em <2 s após o boot [DEC número].
**RF-04.02 Nome de CLI custom.** DEVE existir campo para digitar o nome de um CLI novo e refresh para redescobrir [OBS] (mod04, Comportamento). Aceite: digitar `hermes` e clicar refresh reclassifica `not_installed` -> `installed` se estiver no PATH. DEVERIA aceitar caminho absoluto quando fora do PATH [DEC].
**RF-04.03 Descoberta de modelos.** Cada adapter DEVE expor `discoverModels()`; o botão "refresh" a executa [OBS]. Quando não detectável sem login (Kimi), DEVE haver lista fallback estática (`source=hardcoded`) [OBS] (d23: Kimi 2.6/2.5 hardcoded). Aceite: Kimi sem login lista fallback marcada.
**RF-04.04 Modelo manual.** DEVE haver "adicionar modelo por nome" (ex.: digitar "claude opus 5.5" e adicionar) [OBS] (d81, arq. 08). Aceite: modelo aparece com `source=manual`, ligado.
**RF-04.05 Atualizar CLI.** O adapter Claude Code DEVE oferecer "atualizar latest" (executa o updater do CLI) [OBS] (d81); DEVE expor `min_cli_version` por modelo (Opus 5.5 exige CLI 2.1.280) e alertar quando a versão instalada for inferior [OBS versão / DEC alerta]. Aceite: CLI 2.1.270 + modelo Opus 5.5 -> aviso "atualize o CLI".
**RF-04.06 Liga/desliga.** DEVE ser possível ligar/desligar Provider e cada modelo individualmente [OBS]. Provider desligado DEVE sumir da UI de seleção e das respostas MCP (`list_providers`, `list_models`) [OBS] (d65: bug em que "Sol 5.6" aparecia com Codex desativado — comportamento correto é sumir). Aceite: desligar Codex -> `list_models` não retorna modelos Codex; painel novo não os oferece.
**RF-04.07 Custo de contexto do MCP.** A UI DEVERIA orientar a desligar providers não usados, pois cada provider ativo consome tokens (cache) a cada consulta do orquestrador [OBS] (d68).
**RF-04.08 Bypass permission.** DEVE haver flag `bypass_permission` por Provider, aplicada como argumento/config do CLI no spawn (Codex: "yolo") [OBS] (d76). Padrão `false` [DEC segurança]. Aceite: flag ligada -> spawn contém o argumento de bypass do adapter.
**RF-04.09 Multi-conta.** Claude Code, Codex, Grok e Gemini DEVEM suportar N Accounts [OBS] (mod04: setinha "adicionar conta"; d44, d49). Cada Account DEVE ter diretório/credencial isolados [OBS] (mod04, Funcionamento 5). Antigravity multi-conta NÃO DEVE ser exposto (reprovado) [OBS] (d75). Aceite: duas contas Claude com sessões distintas em Panes simultâneos.
**RF-04.10 Regra de designação de conta.** O usuário PODE atribuir regra "conta X exclusiva para modelo Y" (ex.: conta 2 só para Fable 5) [OBS] (d44). Aceite: pedido de worker Sonnet nunca é servido pela conta 2 sob essa regra.
**RF-04.11 Escolha automática de conta.** `pick_account` DEVE escolher a Account cuja janela decisiva reseta primeiro e só usar outra se essa estiver em 100% [OBS] (d81, regra desejada) ; janela decisiva = gargalo do maior percentual usado [OBS] (mod09, headline pick). Aceite: A=88%/reseta 1 h; B=68%/reseta 4 h -> A escolhida.
**RF-04.12 Herança no painel novo.** Novo Pane DEVE herdar provider/modelo/conta do último Pane focado [OBS] (d26).
**RF-04.13 Override de endpoint.** Para ProviderKind `cli_hosted_model`, o sistema DEVE configurar o CLI de origem (Claude Code para endpoints Anthropic-compat; Codex para OpenAI-compat) sem exigir edição manual de arquivos de pacote, preservando o modelo de topo (Opus/Fable) disponível em outro Pane [OBS] (mod04, Origem; Funcionamento 3). Ao adicionar um provider de API, DEVE criar as duas variantes (Anthropic-compat + OpenAI-compat) juntas [OBS] (d28, prompt 0.4.7). Variante sem endpoint funcional (ex.: MiMo via Codex, 404) DEVE poder ser omitida do catálogo [OBS] (d22). Mecanismo exato (env vars/arquivos) [LAC] -> ver §6d [DEC].
**RF-04.14 Rota/cluster por provider.** Provider com múltiplos clusters (MiMo) DEVE permitir escolher rota e digitar base URL manual [OBS] (d22: cluster SGP não universal). Aceite: base URL manual persiste e é usada no spawn.
**RF-04.15 Providers "manual/custom" genéricos.** NÃO DEVE existir provider custom livre; só OpenRouter cobre "o resto" [OBS] (d28: removidos na 0.4.7). Extensão futura por checklist (§8/§11) [DEC].
**RF-04.16 OpenRouter.** DEVE listar modelos do catálogo (≈647 no d28) de ambas famílias (OpenAI e Anthropic), com "marcar/desmarcar todos" [OBS] (d28 — bug: só listava OpenAI; requisito: modelos automáticos). Aceite: catálogo contém modelos de ≥2 famílias e ações em lote.
**RF-04.17 Papéis.** Cada `ProviderModel` DEVE poder carregar `roles_suggested[]` (pilot, worker, scout, reviewer, qa_fast, security, image) [OBS: papéis; DEC: campo]. A decisão final por tarefa é da Policy ([[spec-03-harness-roteamento-decisor]]). Regras observáveis DEVEM ser suportadas como restrições da Policy: `forbidden_as_executor` (ex.: Fable e GPT Astra) [OBS] (d79) e "nunca a mesma IA para código e revisão" [OBS] (mod04, Papéis). O adapter só expõe `capabilities`/`roles_suggested`; não decide.
**RF-04.18 Piloto exclusivo.** Modelo marcado `pilot_only=true` (Fable) DEVE ser recusado por `open_pane` com papel worker [OBS] (mod04: "Fable só orquestra"). Aceite: erro `role_not_allowed`.
**RF-04.19 Resume de sessão.** Cada adapter DEVE declarar `supports_resume`; Claude, Codex e Gemini têm resume, listado por última sessão usada [OBS] (0.3.5, d22). Aceite: reabrir workspace lista sessões ordenadas por `last_used_at` desc.
**RF-04.20 Mover sessão de Account.** Ao atingir limite, o sistema DEVERIA oferecer "mover sessão" para outra Account do mesmo Provider, reabrindo com o handoff/resume [OBS] (d44 migração de torre lendo handoff; d84 "move" não preservou o raciocínio). DEVE avisar que o pensamento interno pode não ser preservado [OBS/DEC aviso].
**RF-04.21 Limites por Account.** O adapter DEVE expor `getUsage(account)` -> janelas (5h, semanal, mensal p/ Cursor) com `used_pct` e `resets_at` [OBS] (mod09; d73). Fonte: consumo local por CLI/arquivos de credencial, 100% local [OBS] (mod09, d54). Aceite: retorno com ≥1 janela por Account com credencial válida.
**RF-04.22 Detecção de limite/erro em Pane.** O sistema DEVE classificar falhas do CLI em `rate_limited`, `auth_expired`, `model_unavailable`, `endpoint_error`, `cli_crashed`, `trust_required` e emitir evento [DEC — o material só cita limites esgotando ao vivo, perda de login do Kimi, 404 do MiMo/Codex, trust de diretório do Kimi]. Aceite: saída simulada com marcador de limite -> `account.limited`.
**RF-04.23 Trust/onboarding do CLI.** Adapters cujo CLI exige "trust" de diretório ou ignora o prompt inicial (Kimi) DEVEM declarar `initial_prompt_mode` (`argv` | `stdin_after_ready` | `unsupported`) [OBS problema (d65); DEC campo]. Aceite: Kimi usa `stdin_after_ready`, enviando o prompt só após detectar o prompt de entrada.
**RF-04.24 Painéis visíveis.** Nenhum adapter PODE executar modelo em background oculto; subagentes de CLIs (ex.: Antigravity) DEVEM ser desincentivados/desabilitados quando o CLI permitir, e o sistema DEVE registrar limitação quando não permitir [OBS] (mod04, Funcionamento; d28 "inaceitável"). O MCP "tenta impedir", sem garantia [OBS].
**RF-04.25 Geração de imagem.** Adapters com `image_generation` (Codex/GPT Images, Grok, Antigravity/Nano Banana) DEVEM ser invocáveis por tool interna usando a cota do plano do CLI, sem API [OBS] (d76). Detalhe em spec de mídia [fora de escopo].
**RF-04.26 Watcher de modelos.** Ver §7.4: worker diário; página restrita a founders [OBS] (d23).
**RF-04.27 Persistência de credenciais.** Credenciais de API key DEVEM ser guardadas no cofre do SO [DEC — [LAC] o material não diz como o original armazena]. Login de CLI permanece no diretório do CLI.
**RF-04.28 Windows spawn.** O adapter DEVE resolver wrappers (.cmd/.ps1) do Windows antes do spawn; o wrapper do Codex quebrava `spawn` [OBS] (d28).
**RF-04.29 Diagnóstico.** DEVE haver "painel de diagnóstico" por provider (versão CLI, caminho, estado de auth, último erro, endpoint efetivo com chave mascarada) [OBS: painel de diagnóstico (d22); DEC conteúdo].
**RF-04.30 Instalação assistida.** DEVERIA existir ação "instalar CLI" que roda o instalador oficial (Claude Code, Codex, Kimi, Grok) — usada pelo Overclock Bot em VPS Linux [OBS] (d70). No app desktop é [DEC] fase 2.

## 5. Modelo de dados
Persistência: `providers.json` (config do usuário) + `accounts.json` (metadados, nunca segredos) + cofre do SO para segredos; catálogo de modelos em cache com TTL [DEC]. Todos por usuário, não por Workspace, exceto `pinned_account` (por Workspace) [DEC; planejado em mod09].

### 5.1 Provider (registry + config)
| campo | tipo | obrig. | default | nota |
|---|---|---|---|---|
| id | slug | sim | — | `claude-code`, `codex`, `gemini-cli`, `antigravity`, `grok`, `kimi`, `glm`, `mimo`, `deepseek`, `fireworks`, `openrouter`, `ollama`, `hermes`, `command-code`, `perplexity`, `kiro`, `opencode`, `cursor`, `github-copilot` |
| kind | enum ProviderKind | sim | — | |
| display_name | string | sim | — | |
| cli_binary | string? | não | — | `agy`, `claude`... |
| auth_types | enum[] | sim | — | `cli_login`, `device_code`, `api_key`, `oauth`, `none` |
| protocol | enum[] | não | — | `anthropic_compat`, `openai_compat`, `native_cli` |
| host_cli | enum? | não | — | `claude-code`/`codex` para `cli_hosted_model` |
| enabled | bool | sim | `true` se instalado e configurado, senão `false` | invariante: `enabled` ⇒ install_state≠not_installed OU kind=api* |
| bypass_permission | bool | sim | false | |
| install_state | `not_installed`/`installed`/`broken` | sim | derivado | |
| cli_version | string? | não | derivado | |
| capabilities | Capability[] | sim | — | `resume`, `multi_account`, `vision`, `image_generation`, `mcp_client`, `skills`, `subagents_background`, `usage_probe` |
| initial_prompt_mode | enum | sim | `argv` | RF-04.23 |
| endpoint_overrides | EndpointOverride[] | não | [] | §5.4 |
Exemplo:
```json
{"id":"antigravity","kind":"cli_native","display_name":"Antigravity CLI","cli_binary":"agy",
 "auth_types":["cli_login"],"protocol":["native_cli"],"enabled":true,"bypass_permission":false,
 "capabilities":["subagents_background","image_generation","usage_probe"],"initial_prompt_mode":"argv"}
```

### 5.2 ProviderModel
`id` (slug `provider:model`), `provider_id`, `model_name` (string do CLI/API), `display_name`, `enabled` (bool, default true quando descoberto/manual), `source` (`detected`/`manual`/`hardcoded`/`catalog`), `roles_suggested` (enum[]), `pilot_only` (bool, false), `forbidden_as_executor` (bool, false), `min_cli_version?`, `context_tokens?`, `effort_levels?` (string[]; ex. high/ultra/extra high [OBS]), `quota_pool?` (string: modelos com cota separada compartilham pool, ex.: `codex-spark`, `codex-reserve` [OBS] mod04), `meta?` (ModelMeta), `first_seen_at`, `last_seen_at`. Invariante: `pilot_only` ⇒ `roles_suggested` contém `pilot` e não `worker`.
**ModelMeta (opcional, sugerido, [DEC] não-normativo):** `price_in_per_mtok?`, `price_out_per_mtok?`, `currency`, `tokens_per_sec?`, `aa_intelligence?`, `notes`, `measured_at`, `source_ref`. Exemplos observados: Gemini 3.5 Flash AA 55, ~289 tok/s, US$1,50/9; Opus 5.5 US$4/20 [OBS] (mod04, Resultados).

### 5.3 Account
| campo | tipo | obrig. | default | nota |
|---|---|---|---|---|
| id | uuid | sim | — | |
| provider_id | slug | sim | — | |
| label | string | sim | "conta N" | contas 1/2 [OBS] |
| auth_type | enum | sim | — | |
| plan_hint | string? | não | — | ex.: "Claude Max 20x", "ChatGPT Pro", "Super Grok Heavy" [OBS] planos citados |
| credential_ref | string | sim | — | ponteiro ao diretório de login do CLI (`config_dir`) ou ao segredo no cofre; nunca o segredo |
| status | `unauthenticated`/`ready`/`limited`/`expired`/`error` | sim | `unauthenticated` | máquina §7.2 |
| exclusive_models | string[] | não | [] | RF-04.10 |
| priority | int | não | ordem de criação | desempate |
| last_usage | UsageSnapshot? | não | — | |
| created_at, last_used_at | datetime | sim | | |
Invariantes: (provider_id,label) único; provider sem `multi_account` tem no máximo 1 Account (Antigravity: 1 [OBS]); `credential_ref` de duas Accounts nunca aponta ao mesmo diretório.
**UsageSnapshot:** `windows[]{name: five_hour|weekly|monthly, used_pct 0..100, resets_at}`, `captured_at`, `source` (`local_files`|`cli_command`|`api`), `stale` bool.
Matriz Account por provider:
| Provider | conta = | multi | plano-alvo/observação |
|---|---|---|---|
| claude-code | login da assinatura (config dir próprio) | sim [OBS] | Max 5x/20x; "uma 20x > duas 5x" |
| codex | login ChatGPT (home próprio) | sim [OBS] | Plus/Pro 5x/20x; Spark e Reserve com cota separada |
| gemini-cli | login Google | sim [OBS] "dez contas" | |
| antigravity | sessão Google | não [OBS reprovado] | |
| grok | device-code | sim [OBS] (1.2.x) | Super Grok |
| cursor | login Cursor | [LAC] | ciclo mensal; ganho com Super Grok Heavy |
| kimi / kiro / hermes / command-code / perplexity / github-copilot | login do CLI | [LAC] (assumir 1) [DEC] | |
| mimo, glm, deepseek, fireworks, openrouter | API key (+base URL/rota) | [DEC] N chaves permitidas (é trivial) | bolsa Xiaomi por chave [OBS] |
| ollama | nenhuma (local) | n/a | |
| opencode | nenhuma ou chaves | [LAC] | modelos free |

### 5.4 EndpointOverride
`{provider_id, family: anthropic_compat|openai_compat, base_url, auth_env, model_env?, extra_headers?, region?}` [DEC estrutura]. Exemplo:
```json
{"provider_id":"mimo","family":"anthropic_compat","base_url":"<console Xiaomi, rota/cluster escolhido>","auth_env":"ANTHROPIC_AUTH_TOKEN","region":"sgp"}
```
### 5.5 ProviderModelWatchEntry (Watcher)
`id`, `lab` (nvidia, deepseek, zai, minimax, moonshot, google, anthropic, openai, xai, xiaomi, perplexity...), `model_name`, `detected_at`, `kind` (`new_model`|`update`|`unknown`), `source_url`, `icon_color`, `notes`. Aviso de UI obrigatório: "não quer dizer que é a última; pode ser atualização do laboratório" [OBS] (d23).
### Ciclo de vida
Provider: `not_installed -> installed -> (enabled|disabled)`; Account: §7.2; ModelCache: descoberto no boot/refresh, expira em 24 h [DEC]; modelos `manual` nunca expiram.

## 6. Interfaces
### (a) UI/UX [OBS estrutura; DEC detalhes]
- **Configurações > Providers** (canto superior direito do app) [OBS]: lista de providers com toggle, scroll de modelos com toggle individual, botão refresh, campo "nome de CLI novo", ação "adicionar modelo".
- **Setinha do provider** -> "adicionar conta" (multi-conta) e, no Claude Code, "atualizar latest" [OBS].
- **Clicar no nome do provider** -> "bypass permission" [OBS].
- Seletor de provider/modelo/conta/esforço no cabeçalho do Pane; herda do último Pane [OBS].
- Barra de providers/headline no topo com Claude, Codex, Gemini, Antigravity, Cursor, Kimi, Groq [OBS] (d69/d73) — dados vêm de `getUsage` ([[spec-09-overclock-headline]]).
- OpenRouter: campo de chave; sugestão de limite de crédito de US$ 1 (o do fundador estourou; usou US$ 5) [OBS]; checkboxes em lote.
- MiMo: seletor de rota/cluster + base URL manual [OBS].
- Ollama: aviso na ativação, botão Check/Testar [OBS].
- Estados: `não instalado` (cinza, CTA de instalar), `pronto`, `limitado` (badge com `resets_at`), `login expirado` (CTA relogar), `erro`.
- Login device-code (Grok): mostrar código + URL + botão copiar; UX original considerada confusa [OBS d49] -> DEVE exibir passos numerados [DEC].
### (b) API interna / eventos
Interface do adapter [DEC — assinatura; o original não a documenta]:
```ts
interface ProviderAdapter {
  id: string; kind: ProviderKind; capabilities: Capability[];
  detect(): Promise<{installed:boolean; binary_path?:string; version?:string}>;
  discoverModels(ctx:{account?:Account}): Promise<ProviderModel[]>;
  listAccounts(): Account[];
  beginLogin(kind:'new_account', opts?):Promise<LoginFlow>;   // cli_login|device_code|api_key
  verifyAccount(a:Account): Promise<'ready'|'unauthenticated'|'expired'|'error'>;
  buildSpawn(req:SpawnRequest): SpawnSpec;    // {command,args[],env{},cwd,initial_prompt_mode}
  applyEndpoint?(o:EndpointOverride, req:SpawnRequest): Partial<SpawnSpec>;
  getUsage?(a:Account): Promise<UsageSnapshot>;
  classifyOutput(chunk:string): ProviderSignal|null;  // rate_limited|auth_expired|...
  listSessions?(cwd:string, a?:Account): SessionRef[]; // ordena por last_used_at
  resumeArgs?(s:SessionRef): string[];
  updateCli?(): Promise<{from:string;to:string}>;
  bypassArgs?(): string[];
}
type SpawnRequest = {model:ProviderModel; account:Account; role:'pilot'|'worker'|'scout'|'reviewer'|'qa_fast'|'security'; effort?:string; cwd:string; initial_prompt?:string; resume?:SessionRef; bypass:boolean; mcp_config?:object; allow_skills?:string[]};
```
`allow_skills` mapeia ao parâmetro "allow skills" do Claude Code usado pelo harness [OBS] (mod04, Claude Code).
O Pane (spec-01) recebe `SpawnSpec` e cria o PTY no main process; render pode recarregar sem matar o processo [OBS] (0.3.5).
Eventos (barramento interno, JSON) [DEC nomes]:
- `provider.detected {provider_id, installed, version}`
- `provider.toggled {provider_id, enabled}`; `model.toggled {model_id, enabled}`
- `models.refreshed {provider_id, added[], removed[]}`
- `account.added|removed {account_id}`; `account.status_changed {account_id, from, to, reason}`
- `account.limited {account_id, window, resets_at}`; `usage.updated {account_id, snapshot}`
- `pane.provider_signal {pane_id, signal, raw_excerpt}`
- `cli.update_available|updated {provider_id, from, to}`
- `watcher.entry_added {entry}`
### (c) Tools MCP
Servidor MCP interno do Overclock lista providers/modelos e abre painéis [OBS]; `headline pick` existe [OBS]. Nomes/schemas abaixo são [DEC] (o original não os publica); só respondem por providers/modelos/contas `enabled`.
1. `list_providers` — in: `{}`; out: `[{id, kind, enabled, accounts:[{id,label,status}], capabilities}]`. Erros: nenhum.
2. `list_models` — in: `{provider_id?: string, role?: string}`; out: `[{id, display_name, roles_suggested, pilot_only, quota_pool, meta?}]`. Filtra desabilitados.
3. `pick_account` — in: `{provider_id (req), model_id?, exclude_account_ids?: string[]}`; out: `{account_id, reason, window:{name,used_pct,resets_at}}`. Erros: `no_account_available` (todas 100% ou exclusivas), `unknown_provider`, `provider_disabled`.
4. `get_limits` — in: `{account_id?: string}`; out: `[{account_id, windows[], stale}]`. (equivale ao MCP de limites do Headline [OBS d73]; a spec-09 é a dona; aqui é contrato mínimo.)
5. `open_pane` (dona: spec-01/02; contrato mínimo exigido desta spec) — in: `{provider_id, model_id, account_id?, role, effort?, prompt?, cwd?}`; out: `{pane_id}`. Erros: `role_not_allowed` (RF-04.18/`forbidden_as_executor`), `provider_disabled`, `model_disabled`, `account_limited`, `cli_not_installed`, `cli_version_too_old`.
### (d) CLI/protocolos externos
**Override de endpoint [DEC — mecanismo]** (o original não documenta; o autor adota mecanismos públicos conhecidos, a validar por adapter):
- Claude Code + endpoint Anthropic-compat: variáveis de ambiente no spawn do Pane: `ANTHROPIC_BASE_URL=<base_url>`, `ANTHROPIC_AUTH_TOKEN=<key>` e, se necessário, `ANTHROPIC_MODEL`/`ANTHROPIC_DEFAULT_*_MODEL` = nome do modelo do provider. Escopo: só o processo do Pane (não altera ~/.claude nem afeta outros Panes) — é o que preserva o Opus no Pane piloto [OBS objetivo: não perder Opus; DEC solução].
- Codex + endpoint OpenAI-compat: `-c`/perfil temporário com `model_provider` customizado (base_url + env da chave) em CODEX_HOME do Pane [DEC].
- Diretório por Account: `CLAUDE_CONFIG_DIR` (Claude) e `CODEX_HOME` (Codex) por Account [DEC]; Grok/Gemini/Kimi [LAC].
Argumentos de bypass: Claude `--dangerously-skip-permissions`; Codex "yolo"; demais [LAC] por adapter [DEC/OBS misto: Codex nome observado; flags a verificar].
Nota: Codex `mcp add` não tem flag de header (bug d64) [OBS] -> MCPs autenticados por header exigem escrita direta de config [DEC].

## 7. Fluxos e algoritmos
### 7.1 Registry inicial (provider → auth → como spawnar → observações)
| Provider | Auth | Spawn / hospedagem | Obs / selos |
|---|---|---|---|
| claude-code | assinatura por conta (config dir) [OBS] | `claude` no PTY; resume; allow skills [OBS] | Piloto (Fable/Opus) e worker (Sonnet/Haiku) [OBS]; Fable pilot_only [OBS] |
| codex | login ChatGPT [OBS] | `codex` no PTY; bypass "yolo"; resume [OBS] | Sol/Astra piloto, Spark worker (cota separada), Luna reviewer (Reserve cota separada), Terra, Daybreak Blue segurança, GPT Images [OBS] |
| gemini-cli | login Google [OBS] | `gemini`; resume [OBS] | revisor cruzado/QA; Gemini 3.8 fraco em código [OBS] |
| antigravity | sessão Google [OBS] | binário `agy` [OBS]; multi-conta NÃO | subagentes em background = incompatível com "painéis visíveis" [OBS]; QA/executor rápido/imagem Nano Banana |
| grok | device-code (código+URL+aprovação) [OBS] | `grok` CLI; multi-conta [OBS] | worker backend/scout/imagem; contexto 500K [OBS] |
| cursor | login Cursor [OBS] | CLI do Cursor; fecha sozinho ao ser lançado via CLI (fica em background) [OBS bug] | Grok/Composer; modelo novo pode não aparecer no refresh [OBS]; DEVE detectar e matar/reciclar processo residual [DEC] |
| kimi | login do CLI [OBS] | `kimi`; prompt inicial não recebido [OBS] -> `stdin_after_ready` [DEC] | modelos fallback hardcoded; perdia login ao reabrir (corrigido) [OBS]; front/design |
| glm | chave/coding plan [OBS] | Claude Code (Anthropic-compat) e Codex (OpenAI-compat) + OpenCode [OBS/DEC mapeamento] | worker barato |
| mimo | bolsa/console Xiaomi, protocolo Anthropic [OBS] | Claude Code com override; "via Codex" removido (404) [OBS] | rota/cluster; 2.5 Pro sem visão; V2 Omni/Pro com visão; V2 Flash não suportado [OBS] |
| deepseek | API key [OBS] | Anthropic+OpenAI compat [OBS] | teste via Codex falhou na 0.4.7 [OBS]; adapter DEVE validar por `verifyAccount` [DEC] |
| fireworks | API key [OBS] | Anthropic+OpenAI compat; funcionou "de primeira" em Codex e Claude Code [OBS] | modelos Kimi/MiniMax/DeepSeek/GLM |
| openrouter | API key [OBS] | Claude Code + Codex [OBS] | catálogo ~647; uso paralelo: chave do decisor Jeev; Union Alpha [OBS] |
| ollama | nenhuma [OBS] | roda "via Codex" (provider local no Codex) [OBS]; detecta modelos instalados | experimental; MacBook 128GB "não roda modelo local bom" [OBS] |
| opencode | modelos free / chaves [OBS] | `opencode` | prospecção sem custo; endpoints free instáveis; desativar falhava [OBS bug] |
| kiro | conta Kiro [OBS] | CLI `kiro` [LAC nome do binário] | adicionado por pedido; sem teste [OBS] |
| hermes | login do CLI [OBS] | CLI Hermes Agent; "nem aparecia na detecção até atualizar" [OBS] -> lista de nomes de binário atualizável [DEC] | sem papel definido [OBS] |
| command-code | login do CLI [OBS] | CLI Command Code [LAC binário] | idem |
| perplexity | login do CLI [OBS] | CLI Perplexity [LAC binário] | idem |
| github-copilot | conta GitHub [OBS] | [LAC] | adicionado d32; sem teste |
Providers "Pi", "Droid", "MiniMax" apenas mencionados: fora do registry inicial [OBS/DEC].

### 7.2 Máquina de estado da Account
| estado \ evento | verify_ok | verify_fail_auth | limit_hit | limit_reset(t≥resets_at) | login_completed | logout/removed |
|---|---|---|---|---|---|---|
| unauthenticated | — | — | — | — | ready | (removida) |
| ready | ready | expired | limited | — | ready | (removida) |
| limited | limited (se ainda `used_pct=100`) | expired | limited | ready | — | (removida) |
| expired | ready | expired | — | — | ready | (removida) |
| error | ready | expired | — | — | ready | (removida) |
Transição para `error` em falha de verificação não-auth (rede/CLI). `limited` só se aplica à janela decisiva; uma Account `limited` PODE atender modelos de outra `quota_pool` (ex.: Spark/Luna Reserve fora da semanal principal) [OBS pools; DEC uso].

### 7.3 Spawn de Pane (algoritmo)
1. Validar: provider `enabled`, modelo `enabled`, `role` permitido (`pilot_only`/`forbidden_as_executor`), `cli_version >= min_cli_version`.
2. Resolver Account: explícita > herdada do último Pane > `pick_account` (RF-04.11), respeitando `exclusive_models`. Se `no_account_available` -> erro `account_limited` com `resets_at` mínimo.
3. `spawn = adapter.buildSpawn(req)`; se `kind=cli_hosted_model`, mesclar `applyEndpoint`.
4. Injetar `bypassArgs` se `bypass_permission`. Injetar MCP interno do Overclock e `allow_skills`.
5. Windows: resolver wrapper (RF-04.28). Criar PTY via spec-01.
6. Prompt inicial conforme `initial_prompt_mode`. `argv`: no comando; `stdin_after_ready`: aguardar padrão de prompt pronto (timeout 15 s [DEC]) e escrever.
7. Consumir saída em `classifyOutput`; sinais viram eventos e atualizam Account.
8. Ao encerrar, registrar `SessionRef` para resume.
Erros: CLI ausente -> `cli_not_installed` + CTA instalar; timeout do prompt -> aviso, o prompt fica no clipboard/campo de entrada do Pane [DEC].

### 7.4 Watcher de modelos [OBS d23; DEC detalhes]
1. Worker servidor agenda 1x/dia (cron) [OBS "monitora diariamente"].
2. Para cada laboratório, consulta fontes (blog/RSS/changelog/API de lista de modelos/HuggingFace/OpenRouter models) [LAC fontes reais; DEC começar com OpenRouter `/models` + páginas de release].
3. Deduplica por `(lab, model_name)`; grava `ProviderModelWatchEntry` em Supabase [OBS Supabase Auth do site].
4. Página "modelos": lista cronológica desc, filtro por laboratório, ícones nas cores reais do laboratório (Nvidia verde; Perplexity separado de Google) [OBS].
5. Acesso: apenas usuários com Entitlement de founder autenticados em overclock.sh [OBS decisão de votação]. Sem entitlement -> 403/redirect ao login.
6. O Watcher NÃO adiciona modelos ao app automaticamente [DEC]; usuário usa "adicionar modelo" (RF-04.04). Fase 2 [DEC]: botão "adicionar ao meu provider".
Nota: a intenção do fundador é acelerar testes de LLMs novas ao vivo [OBS].

### 7.5 Checklist para adicionar provider novo [DEC, derivado dos casos observados]
1. Classificar `kind`, `auth_types`, `protocol` (Anthropic-compat, OpenAI-compat, ou ambos — criar as duas variantes juntas [OBS d28]).
2. Descobrir binário e nome(s) alternativos (armadilha `agy`; Hermes não detectado) e adicionar ao detector; testar `detect()` com e sem PATH.
3. Login: mapear fluxo (CLI login / device-code / chave) e onde a credencial vive; garantir isolamento por Account e persistência após reabrir o app (armadilha Kimi).
4. Descoberta de modelos: automática se possível; senão fallback hardcoded + adicionar manual (Kimi).
5. Prompt inicial: testar `argv` vs `stdin_after_ready` e prompt de "trust" (Kimi).
6. Ciclo de vida do processo: o CLI fecha ou fica em background quando iniciado via CLI? (Cursor); desativar via toggle realmente encerra e some do MCP (OpenCode, Sol/Codex).
7. Suporte a resume/sessões; suporte a MCP no CLI e a forma de registrar (Codex sem header) e a skills (sync via [[spec-05-catalogo-skills-mcp-hooks]]).
8. Limites: existe fonte local de uso? (`getUsage`); janelas; se não, `usage_probe` ausente e provider fora do `pick_account`.
9. Subagentes ocultos: desabilitável? Se não, registrar limitação (Antigravity).
10. Plataformas: testar macOS, Windows (wrapper/spawn/`.cmd`) e Linux (VPS).
11. Papel sugerido e `pilot_only`/`forbidden_as_executor`; deixar `roles_suggested=[]` até haver teste [OBS Kiro/Hermes/Perplexity sem papel].
12. Testes de aceitação do adapter (§12 T-01..T-06) verdes; documentar em `verifyAccount` o teste de 404/endpoint (MiMo via Codex, DeepSeek via Codex).
13. Entrada no diagnóstico e nos textos de UI; `enabled=false` por padrão até configurar [DEC].

### 7.6 Regras de decisão de conta (`pick_account`)
```
candidatas = accounts(provider) filtradas: status in {ready}, sem exclusive_models conflitante, fora de exclude_account_ids
se model.quota_pool existe: usar a janela do pool (se conhecida), senão a decisiva
se vazio: erro no_account_available (retornar min(resets_at))
ordenar por: used_pct<100 primeiro; menor (resets_at - now) da janela decisiva; priority
retornar 1ª
```
Casos-limite: snapshot `stale` (>10 min [DEC]) -> reprobe antes de decidir; todas 100% -> erro com `resets_at`; empate -> `priority`.

## 8. Prompts e textos embutidos
O produto não embute prompt fixo de provider no original [LAC]; há prompts de desenvolvimento ditados ao agente (para implementar providers), úteis como briefings:
- Criar versão com provider nativo (d28, arq. 49): "Faz a criação de uma versão 0.4.6. Pega o branch atual, faz a criação de um novo branch baseado em cima do 0.4.5 para fazer a instalação de um novo Overclock 0.4.6 que ele já vem conseguindo detectar o CLI do Antigravity." [OBS]
- Briefing de provider de API (d28): "Faz um swarm para a gente conseguir realizar a leitura da API Docs da Fireworks. Eu quero cinco agentes Spark Codex 5.3. Nosso objetivo é conseguir criar um briefing para que esse agente ... consiga fazer a implementação rápida do Fireworks AI, porque estão pedindo." [OBS]
- Escopo 0.4.7 (d28): "tira esse custom provider ..., deixa somente com o OpenRouter. ... Quando vai adicionar um, já adiciona os dois juntos [Anthropic + OpenAI compat]. ... tem que ser totalmente removido." e "Não quero herdar nada do que está sendo implementado no 0.4.6.1." [OBS]
- Novos CLIs (d75): "Quero que você abra três Pens. Um para add o Command Code, um para add o Hermes CLI e outro para add o Perplexity CLI." [OBS]
- Regra de contas (d44): "Todas essas atividades que serão delegadas, você sempre vai usar a conta um e não a conta dois. A conta dois será exclusivamente para o Fable 5." [OBS] -> equivale a `exclusive_models` (RF-04.10).
- Regra de skill (d79): "Fable e GPT 6 Astra são proibidos como executores" [OBS] -> `forbidden_as_executor`.
**Prompt-base [DEC] de teste de adapter** (para o agente de QA do provider): "Abra um Pane com {provider}/{model} na conta {account}, envie 'responda apenas OK', confirme a resposta em até 60 s, encerre e reabra com resume, e reporte: versão do CLI, latência da 1ª resposta, sinais classificados."
Mensagens de UI [DEC]: "Limite atingido em {account}. Volta em {resets_at}. Mover sessão para {outra conta}?"; "Este modelo exige o CLI {min}. Atualizar agora?"; aviso Ollama: "Modelos locais consomem RAM/GPU; use só se o hardware aguentar."

## 9. Requisitos não-funcionais
- **Desempenho:** cada CLI ≈ 500 MB de RAM (10 Panes ≈ 5 GB) [OBS]; detecção no boot < 2 s, refresh de modelos < 10 s por provider [DEC]; consulta MCP `list_*` < 200 ms (cache) [DEC].
- **Portabilidade:** macOS, Windows, Linux (VPS). Windows: wrappers e SmartScreen (Cursor sem assinatura digital) [OBS]. `agy`/Grok/Cursor/Kimi instaláveis em Linux headless [OBS d70, com falhas iniciais].
- **Segurança:** credenciais nunca em log, em `accounts.json` ou nos eventos; chaves no cofre do SO [DEC]; leitura de uso apenas local [OBS mod09]; `bypass_permission` opt-in e sinalizado no Pane [DEC]. Ler arquivos de token para medir limites gera falso positivo de antivírus (Defender) [OBS mod09] -> documentar e assinar binários.
- **Privacidade:** nada é enviado ao backend Overclock salvo Watcher (leitura) e licença; Union Alpha-like "sem treino de dados" é atributo do provedor, não do produto [OBS/DEC].
- **Custo/tokens:** providers ativos consomem cache a cada consulta MCP [OBS]; responder MCP com payload mínimo [DEC]; o produto não revende tokens [OBS].
- **Observabilidade:** todos os eventos do §6b persistidos em log rotativo local; contador de tokens/custo soma providers (existe no original, 1.2.x) [OBS] — unidade/cálculo desconfiável [OBS lacuna]; expor como estimativa.
- **Resiliência:** reload do render não mata PTY; recovery de painéis após crash [OBS 0.3.5].

## 10. Stack sugerida e restrições
**Original [OBS]:** Electron + PTY (processos no main), MCP interno em Node, Supabase (auth/site do watcher), GitHub Releases, CLIs oficiais. **Alternativas neutras [DEC]:** Tauri/Rust + `portable-pty` ou Node `node-pty`; cofre via keychain do SO (`keytar` ou equivalente); Watcher como job agendado (cron/Edge Function) + Postgres; adapters como módulos plugáveis com um arquivo de manifesto (`provider.manifest.json`) + código opcional. Restrições: usar apenas login/CLI oficiais — sem scraping de sessão de terceiros [DEC]; um adapter não pode escrever nas configs globais do CLI se houver alternativa por env/flag (para não afetar sessões fora do Overclock) [DEC].

## 11. Plano de implementação em fases
1. **MVP (F1):** registry + `detect()` + Panes com Claude Code e Codex, 1 Account cada, liga/desliga provider/modelo, herança no Pane novo, `list_providers`/`list_models`.
2. **F2:** Gemini, Antigravity (`agy`), Grok, Kimi (com `stdin_after_ready`), Cursor; resume; bypass; refresh/adicionar modelo; classificação de sinais.
3. **F3:** multi-conta (isolamento de config dir), `exclusive_models`, `getUsage` e `pick_account`, mover sessão.
4. **F4:** override de endpoint: Anthropic-compat (MiMo, GLM, DeepSeek, Fireworks) e OpenAI-compat; OpenRouter (catálogo, lote); Ollama.
5. **F5:** CLIs de baixa maturidade (OpenCode, Kiro, Hermes, Command Code, Perplexity, Copilot); diagnóstico; atualizar CLI.
6. **F6:** Watcher de modelos (worker + página founders); ModelMeta.
Ordem de dependências: spec-01 (Pane/PTY) -> F1 -> F2/F3 -> F4; F3 alimenta spec-03 e spec-09; F6 depende de auth/Entitlement de founders (spec-16).

## 12. Casos de teste de aceitação
- **T-01 (detecção):** Dado `agy` no PATH e `antigravity` ausente; Quando o app inicia; Então provider `antigravity` = installed, com `cli_binary=agy`.
- **T-02 (feliz, spawn):** Dado Claude Code ready, modelo Sonnet habilitado; Quando `open_pane(role=worker)`; Então PTY inicia com env da Account correta e Pane responde a "OK" em ≤60 s.
- **T-03 (provider desligado):** Dado Codex desligado; Quando `list_models`; Então nenhum modelo Codex retorna e `open_pane` com Codex dá `provider_disabled`.
- **T-04 (piloto exclusivo):** Dado Fable `pilot_only`; Quando `open_pane(role=worker, model=fable)`; Então erro `role_not_allowed`.
- **T-05 (multi-conta e exclusividade):** Dado contas 1 e 2 do Claude e conta 2 exclusiva de Fable; Quando 3 workers Sonnet são abertos; Então todos na conta 1; e Fable na conta 2.
- **T-06 (limite e pick):** Dado A=88% (reseta em 1 h) e B=68% (reseta em 4 h); Quando `pick_account`; Então A. Dado A=100%; Então B. Dado ambas 100%; Então `no_account_available` com `resets_at`.
- **T-07 (limite em Pane):** Dado Pane rodando na Account A; Quando a saída contém sinal de limite; Então `account.limited` emitido, A=`limited`, UI oferece mover sessão.
- **T-08 (override de endpoint):** Dado provider MiMo com base URL manual e chave; Quando abrir Pane MiMo e outro Pane Opus; Então o env do Pane MiMo contém a base URL e o Pane Opus não; nenhum arquivo global do CLI foi alterado.
- **T-09 (variante sem endpoint):** Dado "MiMo via Codex" retornando 404 no `verifyAccount`; Então a variante não aparece como selecionável e há mensagem explicativa.
- **T-10 (Kimi prompt):** Dado Kimi com `stdin_after_ready`; Quando abrir Pane com prompt; Então o prompt é entregue só após o prompt de entrada e o Pane não fica sem instrução.
- **T-11 (modelo manual e versão):** Dado CLI 2.1.270 e "claude opus 5.5" adicionado; Quando abrir Pane; Então `cli_version_too_old` com CTA atualizar.
- **T-12 (watcher/acesso):** Dado usuário sem Entitlement founder; Quando abre a página modelos; Então bloqueado. Dado founder; Então lista cronológica com filtro por laboratório.
- **T-13 (OpenRouter):** Dado chave válida; Quando refresh; Então catálogo com modelos de ≥2 famílias e ações marcar/desmarcar todos.
- **T-14 (segredo):** Dado chave de API salva; Então não aparece em `accounts.json`, logs, eventos ou diagnóstico (mascarada).

## 13. Questões em aberto e riscos
- [LAC] Como o original aplica endpoints Anthropic/OpenAI (env, arquivo, proxy)? Spec adota env por Pane + perfil temporário do Codex [DEC] — validar por adapter.
- [LAC] Armazenamento de credenciais no original (nada dito). [DEC] cofre do SO.
- [LAC] Kimi: usa só o CLI ou também API? Multi-conta para Kimi/Cursor/Kiro/etc.
- [LAC] Nomes dos binários de Kiro, Command Code, Perplexity, Hermes, Copilot; flags de bypass por CLI (só "yolo" do Codex é observado).
- [LAC] Fontes e método reais do Watcher; frequência confirmada "diária" mas sem detalhe.
- [LAC] Formato de sinais de limite/erro de cada CLI (dependem de saída de terceiros; `classifyOutput` é heurístico e frágil a mudanças de CLI).
- [LAC] Se `pick_account` deve considerar `quota_pool` separado (Spark/Reserve) — [DEC] sim.
- [LAC] Numeração de versões/dias inconsistente entre lives; mapeamento dia→versão é inferência (mod04, Lacunas).
- [LAC] Como impedir de fato CLIs de abrirem subagentes/LLMs ocultos (o original admite "sem garantia").
- Riscos: dependência de CLIs de terceiros que mudam rápido (detecção, flags); ToS de multi-conta/uso de assinatura em wrappers; falso positivo de antivírus ao ler tokens; ~500 MB por CLI limita paralelismo; custos por modelo com unidade ambígua (por isso só metadado); "Cursor fecha sozinho" e "OpenCode não desativa" indicam ciclo de vida de processo como fonte recorrente de bugs.

## 14. Rastreabilidade
| Requisito | Fonte |
|---|---|
| RF-04.01/02 | mod04 Comportamento; d28 (agy) |
| RF-04.03/04 | mod04 Funcionamento 2; d23 (Kimi hardcoded); d81 arq. 08 |
| RF-04.05 | d81 arq. 08 |
| RF-04.06/07 | mod04 Funcionamento 4; d65 arq. 26; d68 arq. 23 |
| RF-04.08 | d76 arq. 14 |
| RF-04.09/10 | mod04 Comportamento; d44 arq. 43; d49 arq. 42; d75 arq. 16 |
| RF-04.11 | d81 (regra desejada); mod09 headline pick |
| RF-04.12 | d26 arq. 51 |
| RF-04.13/14/15/16 | d22 arq. 55; d23; d28 arq. 49 |
| RF-04.17/18 | mod04 Papéis; d79 arq. 11; mod04 Claude Code |
| RF-04.19 | 0.3.5 (d22) |
| RF-04.20 | d44; d84 arq. 04 |
| RF-04.21 | mod09; d73 arq. 18 |
| RF-04.22/23 | d65 arq. 26 (Kimi); d22/d28 (404); [DEC] classificação |
| RF-04.24 | mod04 Objetivo, Funcionamento; d28 |
| RF-04.25 | d76 arq. 14 |
| RF-04.26 e §7.4 | d23 arq. 54 |
| RF-04.27 | [DEC] (mod04 Lacunas) |
| RF-04.28 | d28 arq. 49 |
| RF-04.29 | d22 arq. 55 |
| RF-04.30 | d70 arq. 21 |
| §7.1 registry | mod04 tabela resumo e seção Features por provider |
| §7.5 checklist | derivado dos bugs em mod04 (Kimi, Cursor, OpenCode, Hermes, Antigravity, Codex header) [DEC] |
