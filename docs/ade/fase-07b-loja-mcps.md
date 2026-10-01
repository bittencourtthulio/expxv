# Fase 7B — Loja de MCPs (extensão da Fase 7 · Catálogo)

Objetivo: uma tela **Loja de MCPs** onde o desenvolvedor vê um catálogo **curado** de servidores MCP ligados a
desenvolvimento (documentação, código, navegador, bancos, nuvem, qualidade, gestão), clica **Instalar**, confere o comando
exato e as permissões, informa a chave só quando o servidor pede, e o servidor **já sai funcionando** nos Panes das CLIs que
suportam injeção (Claude Code, Codex, OpenCode) — sem tocar na configuração global da CLI do usuário, sem segredo em arquivo
solto, sem nada rodando enquanto ninguém usa. Pedido literal do dono (2026-09-30): *"…tenha uma área de configuração e
habilitação de MCPs já pré-configurada no sistema. Os que forem gratuitos e fizerem sentido já vêm configurados… o usuário
entra na área de MCP e só clica em INSTALAR, o sistema instala, pega, e já sai usando."*

Valor: (1) mobilidade — o agente ganha docs atualizadas, navegador, banco, issue tracker sem o usuário editar JSON/TOML;
(2) segurança verificável — a cadeia de suprimentos de `npx -y` é trocada por instalação **pinada, verificada e isolada**;
(3) economia — só entra no Pane o que a política permite (deny-by-default, D-44), então o agente não carrega 40 servidores;
(4) base para as Fases 14/15/16/17 escolherem MCPs por agente/etapa.

Base de conhecimento (leia antes de executar): `base/I-catalogo-mcps.md` (pesquisa: fontes, 74 servidores, como cada CLI
configura MCP, cadeia de suprimentos), `base/catalogo-mcps.seed.json` (o seed que o app embarca), `fase-07-catalogo.md`
(esta fase **estende**; não duplica scanner, política, gate nem `catalogo_*`), `fase-03-orquestracao-mcp.md` (token por Pane,
hooks), `05-CONTRATOS.md`, `04-UI-UX.md` (D-32), decisões D-13, D-14, D-40..D-45, D-64 e **D-130..D-139** (esta fase).

**Portão da fase**: `npm run verificar` verde · e2e no Electron real com **servidores MCP falsos** (`tests/fixtures/mcp-loja/`):
instalar (registro e tarball locais falsos) → configurar variável no cofre → teste de saúde `initialize`+`tools/list` ≤ 3 s →
habilitar para um workspace → Pane de CLI falsa recebe o servidor por flag/variável **sem** alterar nenhum arquivo da casa do
usuário (hash antes = depois) e **sem** o valor do segredo em argv, em arquivo ou em log → desinstalar sem resíduo ·
`npm run perf` com P-90..P-99 verdes em `docs/ade/perf/ultimo.json` · **nenhum pacote real instalado em nenhum teste** ·
auditoria de segurança (T-07B.35) sem achado aberto.

## Princípios (valem para as 36 tasks)

1. **Leveza e velocidade acima de tudo.** Abrir a Loja lê o seed em memória (≤ 100 entradas hoje; escala a 2 000); busca no
   renderer sobre cache, sem IPC por tecla; o chunk da tela é lazy; **nenhum servidor MCP é iniciado pelo app** fora de teste
   de saúde explícito e fora de um Pane. Servidor parado não custa memória: quem inicia e encerra o processo stdio é a CLI do
   Pane (vive e morre com o Pane); o app só inicia processo em **teste de saúde** (efêmero, ≤ 3 s, árvore morta ao fim).
2. **Nada instala sem clique e sem consentimento.** Instalar exige rede e é **ação explícita** (botão), nunca em segundo plano,
   nunca no boot, nunca por pedido de agente. Não existe tool MCP de instalar: agente **não** instala (anti prompt injection).
   Consentimento por instalação e por **versão**: mostra o comando completo, a pasta, os hosts de rede, as variáveis e os riscos.
3. **Segredos só no cofre do SO** (Electron `safeStorage`, D-64) — nunca em JSON do catálogo, banco, log, evento, argv nem em
   arquivo de configuração de CLI. O valor nunca volta ao renderer (só `definida: boolean`).
4. **Deny-by-default por agente** (D-44): servidor instalado ≠ servidor habilitado; habilitar é por workspace/Missão/agente;
   sem linha = desabilitado; a interseção só estreita.
5. **Instalar em pasta isolada do app** `<userData>/mcp/<id>/` (sem sudo, sem global, sem tocar `PATH`/`~/.npmrc`);
   desinstalar = apagar a pasta + linhas do banco + segredos do servidor (a pedido).
6. **Pino exato.** Versão exata + integridade (sha512 do tarball npm / sha256 PyPI e de binário) + lock de dependências quando
   houver; atualizar é ação explícita com novo consentimento (nunca automática, D-131). `npx -y pkg@latest` é **proibido**.
7. **O ADE não escreve na casa do usuário** (D-41): a Loja injeta por Pane (flags/arquivo temporário/variável de ambiente do
   Pane). Instalar na CLI global do usuário é opção **explícita** "também instalar na minha CLI", com prévia do comando.
8. **Honestidade sobre o isolamento:** Gemini CLI sem injeção por Pane; Codex/OpenCode com isolamento parcial (selo, D-44).
   O catálogo diz o que NÃO foi confirmado; entrada `confirmado:false` **não é instalável**.
9. **Dado de terceiro é dado:** descrição/tools de servidor são saneadas e nunca viram instrução (reuso de `sanear.ts`).

## [DEC] Decisões desta fase (registradas como D-130..D-139 em `01-DECISOES.md`)

| ID | Decisão | Justificativa / descartado |
|---|---|---|
| D-130 | **Fonte de verdade = seed curado versionado no app** (`resources/mcp/catalogo-mcps.json`, copiado de `docs/ade/base/catalogo-mcps.seed.json`), não registro externo. O Registro Oficial do MCP é só fonte de **descoberta** opcional (ação manual, T-07B.32), e o que vem dele fica "não curado" e **não instalável**. | O registro oficial tem spam/typosquatting (busca por "context7" devolve forks e "paid remote MCP"); Smithery/mcp.so sem termos de uso de dados confirmados. |
| D-131 | **Instalação pinada, isolada e verificada:** npm → `npm ci --ignore-scripts` com `package-lock.json` curado (nível `forte`) ou `npm install <pacote>@<versão> --ignore-scripts` + checagem do `integrity` do tarball raiz e da assinatura ECDSA do registro (nível `padrao`); PyPI → venv próprio + `uv pip install --require-hashes`; binário → sha256 do release. **Atualização nunca automática.** | `npx -y` executa código de terceiros a cada start; `--ignore-scripts` bloqueia `postinstall`. Pacote que precisa de script marca `scripts_permitidos:true` (aparece no consentimento). |
| D-132 | **Lançador `mcp-run`** (`resources/mcp/mcp-run.mjs`, roda com `ELECTRON_RUN_AS_NODE=1`) para servidor **stdio com variável secreta**: o Pane recebe só `command=<execPath> args=[mcp-run.mjs, --servidor, <id>]`; o lançador busca os segredos **por loopback** (`POST /loja/segredos`, Bearer do token do Pane, só servidores permitidos ao Pane), monta o ambiente por **allowlist** e dá `spawn` no servidor real com `stdio: inherit`. Servidor sem segredo roda **direto** (sem processo extra). | Segredo em `env` do Pane vaza para o Bash do agente; em arquivo, para disco. Custo: 1 processo Node extra só para servidores com chave. |
| D-133 | **Remotos (HTTP/SSE):** OAuth fica a cargo da CLI (`claude mcp login`, `codex mcp login`, `opencode mcp auth`); chave de API remota: Codex por `env_http_headers`/`bearer_token_env_var` (nome da variável, valor na env do Pane); Claude/OpenCode por cabeçalho no arquivo temporário 0600 do Pane (apagado ao fechar, varrido no boot). Risco residual registrado (P-132). | Não há `headersHelper` confiável em `--mcp-config` (doc: helpers de projeto não leem variáveis de credencial). |
| D-134 | **Kit mínimo habilitado por padrão = 3 servidores** (`context7` npm/stdio com chave opcional, `deepwiki` remoto, `sequential-thinking` npm/stdio): gratuitos, sem chave obrigatória, sem escrita em disco, valor alto × peso baixo. "Habilitado" = permitido por padrão nos Panes **livres** do workspace e **na allow-list sugerida** de Missão; o **download** (`context7`, `sequential-thinking`) acontece sob demanda no primeiro uso, com **um** clique. Nada é empacotado no instalador. | Cada servidor stdio custa ~40–80 MB por Pane (só enquanto o Pane o usa); remoto custa zero local. Ver §Pré-instalados. |
| D-135 | **Gateway/agregador interno (proxy MCP do app)** fica **fora da v1**: seria o único jeito de "encerrar ocioso" com o app dono do processo, mas exige proxy de tools/notificações/OAuth. Registrado como evolução (P-133). | Complexidade e risco > ganho; a CLI já encerra o stdio com o Pane. |
| D-136 | **Gemini CLI sem injeção por Pane** (não há caminho de configuração por invocação confirmado; `configuracaoDeMcp` já devolve `null`). Só "instalar na minha CLI" explícito (`gemini mcp add -s user`). | Escrever `.gemini/settings.json` no repositório viola D-41. |
| D-137 | **Habilitação própria** em `catalogo_mcp_habilitacao`; a Fase 7 (`catalogo_politica.servidores_mcp_json`) passa a **ler** esta tabela como fonte dos servidores da Loja, sem duplicar UI. Nomes de tool no gate: `mcp__<nome_na_cli>__*`, `nome_na_cli = "ev_" + id.replace(/-/g,"_")` (prefixo `PRODUTO.prefixoSkill`-análogo em `PRODUTO.prefixoMcp = "ev_"`). | Uma via de política (D-44); prefixo identifica o que a Loja criou (remoção segura). |
| D-138 | **Agentes não instalam nem configuram.** A tool `mcp_store_list` (leitura) mostra só os servidores **habilitados para o token**; instalar/habilitar/segredo é só UI (IPC do renderer). | Prompt injection não pode ampliar superfície. |
| D-139 | **Saúde é ativa só sob demanda** (clique "Testar", ao abrir o painel de um servidor, ao terminar a instalação e 1× ao abrir a Loja se o último teste tem > 24 h e o servidor está habilitado em algum workspace aberto); o resto é **passivo** (existência de arquivos, versão, `comando_hash`). | "Health contínuo leve" sem manter processo. |

## Formato do catálogo de curadoria (`catalogo-mcps.json`, `schema_version: 1`)

Arquivo único: `{ "schema_version": 1, "gerado_em": "YYYY-MM-DD", "fonte": "…", "entradas": [Entrada, …] }`. O seed em
`docs/ade/base/catalogo-mcps.seed.json` é a primeira versão; `T-07B.03` o copia para `resources/mcp/` no build.
Validador estrito em `src/nucleo/loja-mcp/esquema.ts` (sem dependência nova; rejeita campo desconhecido de segurança).

```ts
// src/compartilhado/loja-mcp.ts  (T-07B.01)
export const CATEGORIAS_MCP = ["codigo_repositorios","documentacao_conhecimento","web_pesquisa","navegador_testes","bancos_dados",
  "nuvem_infra","observabilidade_qualidade","gestao_comunicacao","raciocinio_memoria","execucao_sandbox","pagamentos_apis"] as const;
export type CategoriaMcp = (typeof CATEGORIAS_MCP)[number];
export type ClassificacaoMcp = "pre_instalado_habilitado" | "pre_configurado" | "opcional" | "descartado";
export type MetodoInstalacaoMcp = "npm" | "uvx" | "binario" | "docker" | "remoto";
export type TransporteMcp = "stdio" | "streamable_http" | "sse";
export type AutenticacaoMcp = "nenhuma" | "chave_api" | "oauth" | "token";
export type RiscoMcp = "acesso_disco" | "rede_saida" | "segredos" | "execucao_codigo" | "prompt_injection" | "escrita_remota" | "dados_sensiveis" | "custo_externo";
export type NivelVerificacao = "forte" | "padrao" | "remoto";   // forte = lock + integridade; padrao = integridade raiz + assinatura; remoto = sem pacote

export interface VariavelMcp { nome: string /* ^[A-Z][A-Z0-9_]{1,63}$ */; obrigatoria: boolean; secreta: boolean; ajuda: string; onde_conseguir: string | null }
export interface EntradaMcp {
  id: string;                         // ^[a-z0-9][a-z0-9-]{0,47}$, único
  nome: string; descricao_pt: string; categoria: CategoriaMcp; classificacao: ClassificacaoMcp; motivo_classificacao: string;
  mantenedor: "oficial" | "comunidade"; mantenedor_nome: string;
  licenca_spdx: string | null; gratuito: "gratis_open_source" | "plano_gratis" | "pago" | "nao_confirmado"; plano_gratis_detalhe: string | null;
  instalacao: { metodo: MetodoInstalacaoMcp; pacote: string | null; versao: string | null /* exata, sem ^ ~ latest */;
                integridade: string | null /* sha512-… (npm) | sha256:<hex> (PyPI) */; data_versao: string | null; lock_sha256?: string | null; scripts_permitidos?: boolean;
                artefatos?: Record<string /* "darwin-arm64"|"darwin-x64"|"linux-arm64"|"linux-x64"|"win32-arm64"|"win32-x64" */, { url: string; sha256: string }>; // só `binario`
                versao_observada?: string | null; integridade_observada?: string | null /* entrada não confirmada: informativo, NUNCA usado para instalar */ };
  transporte: TransporteMcp;
  comando: string | null;             // stdio: "node" | "uvx"… (o app resolve o binário instalado; ver montarComando)
  bin: string | null;                 // nome do executável do pacote (campo `bin` do npm / console_script)
  args: string[];                     // SEM o pacote; placeholders {{WORKSPACE}} {{SERVIDOR_DIR}} {{SEGREDO:NOME}} {{VAR:NOME}}
  url: string | null;                 // remoto
  autenticacao: AutenticacaoMcp; variaveis: VariavelMcp[];
  tools_principais: string[]; riscos: RiscoMcp[]; riscos_texto: string;
  maturidade: { ultima_release: string | null; status: "ativo" | "manutencao" | "arquivado" | "desconhecido"; arquivado: boolean };
  escopos_recomendados: Array<"workspace" | "missao" | "agente">;
  links: { repo: string | null; docs: string | null };
  fontes: Array<{ url: string; consultado_em: string; para: string }>;
  confirmado: boolean;                // false => NÃO instalável (a UI mostra "não confirmado")
  observacoes: string | null;
}
```

Regras de validação (viram testes de `esquema.test.ts`): `confirmado=true` exige fonte com data e `licenca_spdx`≠null (**exceto** `metodo="remoto"`: serviço hospedado, licença "n/c") e —
se `metodo ∈ {npm,uvx}` — `versao` exata (regex `^\d+(\.\d+){1,2}([-+.][0-9A-Za-z.-]+)?$`, inclui calver `2026.8.31`) e `integridade`≠null; `metodo="binario"` exige `artefatos` com `sha256` e URL
`https://github.com/<dono>/<repo>/releases/download/…`; `metodo="docker"` exige digest `@sha256:`; `confirmado=false` ⇒ `versao`/`integridade` nulas (os valores vistos ficam em `*_observada`) e **não instalável**;
`metodo="remoto"` exige `url` `https://` e `versao=null`; `{{SEGREDO:X}}` só com `X` presente em `variaveis` com `secreta=true`;
`args` sem `;|&$\`` fora de placeholders; `classificacao="pre_instalado_habilitado"` exige `autenticacao="nenhuma"` e
`confirmado=true`; `descartado` nunca instalável; ids únicos; nenhum campo contém valor que pareça segredo (varredura por padrão
`sk-`, `ghp_`, `AKIA`, `xox`).

`montarComando(entrada, ctx)` (puro, `src/nucleo/loja-mcp/comando.ts`) devolve `{executavel, args, env_nomes, env_valores_do_cofre_por_nome, hosts_rede, pasta}`: `npm` → `executavel = <pasta>/node_modules/.bin/<bin>` (ou `process.execPath` + script quando `bin` é `.js`);
`uvx` → `<pasta>/venv/bin/<bin>`; `binario` → `<pasta>/bin/<bin>`; `docker` → `docker run --rm -i --pull never …` (só com a imagem
já baixada por ação explícita; sem `--privileged`, sem `-v /`); `remoto` → `url`. Placeholders desconhecidos lançam erro.

## UI "Loja de MCPs" (compacta, D-32; destaque azul)

Tela própria no menu lateral (ícone loja; atalho na paleta `Loja de MCPs: abrir`) e atalho a partir da aba MCPs do Catálogo.
Chunk lazy ≤ 40 KB gzip.

- **Uma linha de controles** (≈ 28 px): busca (fuzzy, `busca-fuzzy.ts`), filtros em ícones (categoria ▾, classificação ▾,
  "gratuitos", "instalados", "pedem chave"), contador, botão **Kit de desenvolvimento** e atualizar. Nunca duas linhas.
- **Cartão curto** (grade responsiva, virtualizada acima de 100): nome, 1 linha de descrição PT-BR, selos (`oficial`/`comunidade`,
  `grátis`/`plano grátis`/`pago`, `pede chave`/`OAuth`, risco máximo em cor), estado (`Instalar` | `Instalando…` | `Configurar` |
  `Habilitar` | `Atualizar` | `Remover` — um único botão primário por estado) e `⋯` (testar, logs, abrir repositório).
- **Painel lateral recolhível (360 px)** ao clicar no cartão: **comando exato** (monoespaçado, copiável, com placeholders
  resolvidos e segredos como `••••`), pasta de instalação, hosts de rede, variáveis (obrigatória/secreta/onde conseguir),
  riscos (texto + ícones), nível de verificação (`forte`/`padrão`/`remoto`), versão/integridade, fontes e data da consulta,
  **ferramentas** (depois do teste), e a matriz "Habilitado em" (workspace/Missão/agente) com selos de isolamento por CLI.
- **Assistente de credenciais** (diálogo): uma linha por variável com `onde conseguir` (link que abre no navegador padrão),
  campo mascarado, **Salvar no cofre** (nunca ecoa) e **Testar** (handshake com timeout 3 s; mostra `ok · N ferramentas · 420 ms`
  ou erro nominal sem valor de segredo). Se `safeStorage` indisponível: bloqueia salvar e explica (D-64).
- **Consentimento** (diálogo de instalar): lista o que vai acontecer — baixar `pacote@versão` de `registry.npmjs.org`, pasta,
  `--ignore-scripts`, verificação, nível, riscos, hosts de rede em uso — com checkbox "Entendi" e botão **Instalar**; botão
  secundário **Copiar comando** para quem quer instalar à mão.
- Estados vazios e de erro sempre com ação (`Tentar de novo`, `Ver log`). Teclado: setas navegam cartões, Enter abre o painel.
- Aba **Instalados**: saúde (ícone), versão, última verificação, tamanho em disco, **Atualizar** (mostra diff de comando,
  variáveis e riscos e exige novo consentimento), **Remover** (apaga pasta; pergunta se apaga os segredos).

## O fluxo "um clique" (estados e passos)

```
[não instalado] --Instalar--> consentimento --aceito--> [instalando]
   passo 1  verificar entrada (confirmado, não bloqueada, versão exata)              (puro, ms)
   passo 2  checar pré-requisito (npm / uv / docker presente; versão mínima de Node)  (diagnóstico acionável)
   passo 3  rede: baixar para <userData>/mcp/.tmp/<id>-<ulid>/ (npm ci/uv/https)      (cancelável; progresso)
   passo 4  verificar integridade (+ assinatura ECDSA do registro npm; + lock_sha256)  (falha => apaga tudo)
   passo 5  mover atômico para <userData>/mcp/<id>/ ; gravar `catalogo_mcp_instalado` + consentimento (comando_hash)
   passo 6  upsert `catalogo_item(tipo=mcp_server)` p/ a Fase 7 enxergar
 --> [instalado] --(se há variável obrigatória)--> [configurar] --cofre--> [configurado]
 --> teste de saúde: initialize + notifications/initialized + tools/list (timeout 3 s)  --> [saudável | doente(erro)]
 --> Habilitar (workspace | Missão | agente)  --> injeção por Pane (T-07B.20) --> uso
```

Habilitação: ao concluir o teste, a UI oferece `Habilitar neste workspace`; para o Kit, `habilitado` já é o padrão sugerido.
Injeção por Pane (resumo; detalhe em `I-catalogo-mcps.md` §3): Claude `--mcp-config <arquivo 0600 do Pane>` (+ `--strict-mcp-config`
em Missão deny-by-default); Codex `-c mcp_servers.<nome>.command=…`/`.args=[…]`/`.env_vars=[…]` ou `.url=`; OpenCode
`OPENCODE_CONFIG_CONTENT` fundido por `combinarAmbientes`; Gemini: nada. Fechar o Pane apaga o arquivo temporário e encerra o
servidor (a CLI mata o filho; o app confere e mata a árvore órfã).
Desinstalação limpa: `rm -r <userData>/mcp/<id>/`, linhas do banco (`ON DELETE CASCADE`), segredos opcionais, `catalogo_item`,
instalações "na minha CLI" que o app criou (por `nome_na_cli` com prefixo `ev_`); verifica 0 resíduos e 0 processos.

## Pré-instalados e habilitados (conjunto mínimo) — valor × risco × peso

| Servidor | Valor | Risco | Peso local | Veredito |
|---|---|---|---|---|
| `context7` (`@upstash/context7-mcp@4.1.1`, stdio; `CONTEXT7_API_KEY` opcional) | Alto: documentação atual de bibliotecas no prompt; reduz alucinação de API | Rede de saída com o **nome da biblioteca** + consulta; prompt injection via doc | ~60 MB só enquanto o Pane o usa | **HABILITADO** (a chave opcional só aumenta o limite; sem chave roda **direto**, sem lançador) |
| `deepwiki` (remoto `https://mcp.deepwiki.com/mcp`) | Alto para entender repositórios públicos | Rede; só repositórios públicos; envia nome do repo e perguntas a um terceiro | 0 MB | **HABILITADO** |
| `sequential-thinking` (npm, referência do MCP) | Médio: estrutura raciocínio longo; sem I/O | Mínimo (puro, sem rede/disco) | ~50 MB só quando o Pane o usa | **HABILITADO** (baixa sob demanda, 1 clique) |
| Filesystem, Git, Fetch, Memory, Time | Redundantes com as CLIs/Fase 6/Fase 8; escrita em disco (Filesystem) | — | 50–80 MB cada | **Não** habilitados (ficam no catálogo como `opcional`) |
| Exa (anônimo), Playwright, GitHub, Sentry, Supabase… | Alto, mas pedem chave/OAuth ou controlam navegador/escrita remota | Médio–alto | variável | `pre_configurado`: 1 clique, **nunca** habilitados sem configuração concluída |

Regras do Kit: (a) "habilitado" nunca significa "instalado": antes do primeiro uso o cartão mostra `Instalar` e a política
sugerida já o inclui; (b) o botão **Kit de desenvolvimento** instala os 2 pacotes locais (os remotos só registram) de uma vez com **um** consentimento que lista os
3 comandos; (c) tudo é desligável em Configurações → Loja de MCPs → "Kit mínimo" (`catalogo_mcp_kit.opt_out`); (d) Missão
`squad`/`agentico` continua deny-by-default: o Kit entra só na **allow-list sugerida** do papel `explorador`/`executor`
(editável); (e) servidores `pre_configurado` (Playwright, GitHub, Sentry, Supabase, Linear…) pedem uma chave/OAuth e **nunca**
são habilitados sem configuração concluída.

## Orçamentos novos (P-90 em diante; somam-se a `03-ORCAMENTOS-DESEMPENHO.md`, Fase 7 e Fase 6)

Medidos por `npm run perf` (`tests/perf/loja-mcp.perf.ts`); `EXPXV_PERF_FATOR` vale como nos demais. Estourou: a task não fecha.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-90 | Abrir a Loja com 100 entradas (clique → primeira pintura com dados do cache) | ≤ 100 ms; ≤ 60 nós de cartão no DOM; troca de tela p95 ≤ 50 ms (P-02) | marca no clique + `requestAnimationFrame`; contagem de nós |
| P-91 | Busca/filtro com 100 entradas (e 2 000 sintéticas) | ≤ 10 ms por tecla (100) / ≤ 16 ms (2 000); zero IPC | `performance.now()` no filtro; spy em `window.ade` |
| P-92 | Instalação (npm/uv falsos, tarball de 5 MB) | UI nunca bloqueada: nenhuma tarefa > 50 ms no main (P-12) e nenhum `longtask` > 50 ms no renderer durante a instalação; progresso ≤ 10 eventos/s | monitor de event loop + `PerformanceObserver` |
| P-93 | Handshake de saúde (`initialize` + `tools/list`) contra o servidor falso | ≤ 3 s no pior caso (timeout duro); ≤ 300 ms no servidor falso rápido; árvore de processos morta ≤ 500 ms após o fim | cronômetro no `saude-mcp.ts`; `ps` pós-teste |
| P-94 | Memória de servidores ociosos | **0**: sem Pane ativo, 0 processos MCP filhos do app (fora de teste de saúde em curso); RSS do main não cresce > 5 MB após abrir/fechar a Loja 20× | contagem de filhos + `process.getProcessMemoryInfo` |
| P-95 | Carregar e validar o seed (100 entradas; 2 000 sintéticas) | ≤ 20 ms (100) / ≤ 150 ms (2 000), fora da thread da UI no boot (onda 2 ociosa, lazy na primeira abertura) | marca no carregador |
| P-96 | Chunk lazy da Loja | ≤ 40 KB gzip, fora do JS inicial (P-08 intacto); cache em memória ≤ 5 MB | `tamanho-bundle.mjs` |
| P-97 | Gerar a configuração por Pane com 10 servidores habilitados (3 CLIs) | ≤ 5 ms; arquivo ≤ 16 KB | benchmark da função pura |
| P-98 | Overhead do lançador `mcp-run` (spawn → servidor real pronto, com busca de segredo por loopback) | ≤ 150 ms além do spawn direto do servidor falso | e2e com servidor falso |
| P-99 | Desinstalar (pasta de 5 MB com 2 000 arquivos) | ≤ 500 ms, 0 resíduos, UI não bloqueia | medição + varredura de resíduos |

## Arquitetura e arquivos

```
src/compartilhado/loja-mcp.ts                 tipos de IPC/eventos/entrada (T-07B.01)
src/nucleo/loja-mcp/                          lógica pura, sem Electron
  esquema.ts catalogo.ts bloqueio.ts          validador estrito, carregador do seed, lista de bloqueio
  comando.ts plano.ts                         montarComando, planejarInstalacao (consentimento)
  verificacao.ts                              integridade sha512/sha256 + assinatura ECDSA do registro npm
  instalar/{npm,python,binario,remoto,docker}.ts   executores injetáveis (porta `Executor`), pasta isolada
  saude-mcp.ts                                cliente MCP mínimo (stdio e HTTP streamable), timeout, kill tree
  ciclo.ts                                    máquina de estados, atualizar, desinstalar
  ambiente.ts                                 allowlist de variáveis (PATH, HOME, LANG, TMPDIR, TEMP, SystemRoot… + declaradas)
  injecao.ts                                  configuração por CLI/Pane (usa terminais/catalogo.ts)
  cli-usuario.ts                              "também instalar na minha CLI" (claude/codex/opencode/gemini mcp add)
src/nucleo/banco/migracoes/0004-catalogo-mcp.ts   (número = próximo livre) + repos/catalogo-mcp.ts
src/main/loja-mcp.ts + src/main/ipc/loja-mcp.ts   serviço (boot onda 2 ocioso) e IPC
src/main/cofre-mcp.ts                         porta `CofreSegredos` sobre safeStorage (reusa o cofre de D-64 se já existir)
resources/mcp/{catalogo-mcps.json,catalogo-mcps.schema.json,mcp-run.mjs,locks/<id>.package-lock.json}
src/renderer/estado/loja-mcp.ts               store (useSyncExternalStore)
src/renderer/telas/loja-mcp/                  LojaMcp.tsx CartaoMcp.tsx PainelMcp.tsx Credenciais.tsx Consentimento.tsx Instalados.tsx loja-mcp.css
tests/fixtures/mcp-loja/                      servidores MCP FALSOS (stdio, protocolo real) + registro npm falso
scripts/gerar-lock-mcp.mjs                    (manual, com rede e consentimento do dono: gera locks e hashes do seed)
```

Pontos de integração (não refazer): `src/nucleo/terminais/catalogo.ts` (`configuracaoDeMcp`, `combinarAmbientes`, hoje só o MCP do
app), `src/nucleo/orquestracao/piloto.ts` (usa `configuracaoDeMcp` com o token), `src/nucleo/mcp/{servidor,catalogo,tools}.ts`
(rota `/loja/segredos` e tool `mcp_store_list`), `fase-07` (`catalogo_item`, `catalogo_politica`, `catalogo_pane_politica`, gate
`pre-mcp`), `src/nucleo/orquestracao/hooks/claude.ts`.

## Modelo de dados — migration `0004-catalogo-mcp` (próximo número livre; ids ULID com prefixo; datas UTC ISO; caminhos relativos a `userData`)

```sql
CREATE TABLE catalogo_mcp_instalado (
  servidor_id TEXT PRIMARY KEY,                    -- id da entrada do seed
  versao TEXT NOT NULL, metodo TEXT NOT NULL CHECK (metodo IN ('npm','uvx','binario','docker','remoto')),
  estado TEXT NOT NULL CHECK (estado IN ('instalando','instalado','falhou','removendo')),
  nivel_verificacao TEXT NOT NULL CHECK (nivel_verificacao IN ('forte','padrao','remoto')),
  integridade TEXT, pasta_rel TEXT,                -- 'mcp/<id>' (NULL em remoto)
  comando_hash TEXT NOT NULL,                      -- sha256(executavel+args+nomes de env+hosts) consentido
  seed_versao TEXT NOT NULL, erro_codigo TEXT,
  instalado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_consentimento (          -- auditoria; nunca guarda segredo
  id TEXT PRIMARY KEY, servidor_id TEXT NOT NULL, versao TEXT NOT NULL, comando_hash TEXT NOT NULL,
  permissoes_json TEXT NOT NULL,                   -- riscos, hosts, variáveis (só nomes), pasta, nível
  origem TEXT NOT NULL CHECK (origem IN ('loja','kit','atualizacao','cli_usuario')), aceito_em TEXT NOT NULL
);
CREATE INDEX ix_catalogo_mcp_cons ON catalogo_mcp_consentimento (servidor_id, aceito_em);

CREATE TABLE catalogo_mcp_variavel (               -- só metadado; o valor está no cofre
  servidor_id TEXT NOT NULL, nome TEXT NOT NULL, definida INTEGER NOT NULL DEFAULT 0, atualizada_em TEXT,
  PRIMARY KEY (servidor_id, nome)
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_habilitacao (            -- deny-by-default: sem linha = desabilitado
  id TEXT PRIMARY KEY, servidor_id TEXT NOT NULL,
  alvo_tipo TEXT NOT NULL CHECK (alvo_tipo IN ('workspace','missao','agente')), alvo_valor TEXT NOT NULL,
  habilitado INTEGER NOT NULL, atualizado_em TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_catalogo_mcp_hab ON catalogo_mcp_habilitacao (servidor_id, alvo_tipo, alvo_valor);

CREATE TABLE catalogo_mcp_saude (
  servidor_id TEXT PRIMARY KEY, estado TEXT NOT NULL CHECK (estado IN ('ok','indisponivel','nao_testado')),
  testado_em TEXT, latencia_ms INTEGER, n_ferramentas INTEGER, erro_codigo TEXT
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_ferramenta (             -- nomes e descrições SANEADAS (≤ 300), nunca schema completo
  servidor_id TEXT NOT NULL, nome TEXT NOT NULL, descricao TEXT, visto_em TEXT NOT NULL, PRIMARY KEY (servidor_id, nome)
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_cli_instalacao (         -- "também instalar na minha CLI": só o que o app criou
  servidor_id TEXT NOT NULL, cli TEXT NOT NULL CHECK (cli IN ('claude','codex','opencode','gemini')),
  nome_na_cli TEXT NOT NULL, escopo TEXT NOT NULL, criado_em TEXT NOT NULL, PRIMARY KEY (servidor_id, cli)
) WITHOUT ROWID;

CREATE TABLE catalogo_mcp_log (                    -- retenção: 200 por servidor e 30 dias; detalhe redigido ≤ 1 KB
  id TEXT PRIMARY KEY, servidor_id TEXT NOT NULL, nivel TEXT NOT NULL, evento TEXT NOT NULL, detalhe_json TEXT NOT NULL DEFAULT '{}', em TEXT NOT NULL
);
CREATE TABLE catalogo_mcp_kit (opt_out INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL);   -- 1 linha
```

Segredos: **não** há tabela. Cofre `<userData>/segredos.bin` (D-64), chave `mcp/<servidor_id>/<NOME>`. Se a Fase 11 ainda não criou o
cofre, T-07B.06 cria a mesma porta `CofreSegredos` (mesmo arquivo e formato) — uma implementação só.

## Contratos

### IPC — `window.ade.lojaMcp` (T-07B.01 adiciona em `src/compartilhado/ipc.ts`; todo payload validado na borda do main)

| Canal | Entrada | Saída |
|---|---|---|
| `loja_mcp:listar` | `{}` | `{entradas: CartaoMcp[], seed_versao: string, gerado_em: string}` (cartão = campos curtos + estado local) |
| `loja_mcp:detalhe` | `{id}` | `DetalheMcp \| null` (comando resolvido com segredos mascarados, hosts, riscos, fontes, ferramentas vistas) |
| `loja_mcp:plano_instalacao` | `{ids: string[]}` | `{planos: PlanoInstalacao[], bloqueios: Array<{id, motivo}>}` (texto do consentimento; sem efeito) |
| `loja_mcp:instalar` | `{ids: string[], consentimento: {aceito: true, comando_hashes: Record<string,string>}}` | `{instalacao_id: string}` (progresso por evento) |
| `loja_mcp:cancelar` | `{instalacao_id}` | `{ok: boolean}` |
| `loja_mcp:desinstalar` | `{id, apagar_segredos: boolean}` | `{ok: boolean, residuos: string[]}` |
| `loja_mcp:plano_atualizacao` / `loja_mcp:atualizar` | `{id}` / `{id, consentimento}` | diff de comando/variáveis/riscos / `{instalacao_id}` |
| `loja_mcp:variaveis_estado` | `{id}` | `Array<{nome, obrigatoria, secreta, definida: boolean}>` |
| `loja_mcp:variavel_gravar` | `{id, nome, valor: string}` | `{ok: boolean, codigo: string\|null}` (valor ≤ 4 KB; nunca devolvido) |
| `loja_mcp:variavel_apagar` | `{id, nome}` | `{ok: true}` |
| `loja_mcp:testar` | `{id}` | `{estado: "ok"\|"indisponivel", n_ferramentas: number, latencia_ms: number, erro: string\|null}` |
| `loja_mcp:habilitar` | `{id, alvo_tipo, alvo_valor, habilitado: boolean}` | `{ok: boolean, codigo: string\|null}` (`codigo: "nao_configurado"` se faltar variável obrigatória) |
| `loja_mcp:habilitacoes` | `{workspace_id}` | `Array<{id, alvo_tipo, alvo_valor, habilitado, isolamento: Record<CliCatalogo, NivelIsolamento>}>` |
| `loja_mcp:previa_cli_usuario` / `loja_mcp:instalar_na_cli` / `loja_mcp:remover_da_cli` | `{id, cli}` | `{comando: string}` / `{ok}` / `{ok}` (confirmação digitada; só escopo `user`) |
| `loja_mcp:logs` | `{id, limite?: number}` | `Array<{em, nivel, evento, detalhe}>` |
| `loja_mcp:kit` | `{}` / `{acao: "instalar"\|"opt_out", valor?: boolean}` | estado do Kit / `{instalacao_id}` |
| `loja_mcp:diagnostico` | `{}` | `{npm: {ok, versao}, node: {ok, versao}, uv: {ok, versao}, docker: {ok}, cofre: {disponivel: boolean}}` |
| `loja_mcp:descobrir` (P2, T-07B.32) | `{consulta: string}` | candidatos do Registro Oficial, `curado: false`, `instalavel: false` |

Eventos main → renderer (envelope `versao: 1`): `loja_mcp:progresso` `{instalacao_id, id, passo: 1..6, rotulo, bytes?, total?}` (≤ 10/s);
`loja_mcp:estado` `{id, estado, nivel_verificacao?, erro_codigo?}`; `loja_mcp:saude` `{id, estado, n_ferramentas, latencia_ms}`.
Barramento de domínio (`evento_dominio`, retenção 30 dias): `mcp_store.install_started|install_finished|install_failed`,
`mcp_store.consent_recorded`, `mcp_store.enabled|disabled` `{id, alvo}`, `mcp_store.health` `{id, estado}`, `mcp_store.removed`,
`mcp_store.injected` `{pane_id, cli, ids[]}`. Nunca com valor de segredo.

### Tool MCP do app (inglês `snake_case`) e rota interna

- **`mcp_store_list`** — `{query?: string≤100, category?: string, limit?: int=25 (≤100)}` → `{servers: Array<{id, name, category,
  transport, tools: string[]≤20, enabled_for_you: true}>}`. Só devolve servidores **habilitados e configurados para o token**; nunca
  URL com credencial, argumentos nem variáveis. Matriz: `agentico` e `squad` (leitura); `livre` não. Erros: `unauthorized`.
  Não existe tool de instalar/configurar (D-138).
- Rota loopback **`POST /loja/segredos`** (corpo `{servidor: string}`; `Authorization: Bearer <token do Pane>`; só `127.0.0.1`):
  devolve `{env: Record<string,string>}` **apenas** das variáveis declaradas do servidor **se** o servidor está na política resolvida do Pane
  (`catalogo_pane_politica`); caso contrário 403 `server_not_allowed`. Resposta `Cache-Control: no-store`, nada logado, limite 5 chamadas/min/Pane.

### Ganchos

Estende `pre-mcp` da Fase 7 (T-07.22): nomes `mcp__ev_<id>__*` são permitidos só se o `id` está no snapshot do Pane; falha fechada.

## Tarefas

Formato: `T-07B.NN · título` — entrega · **Aceite** binário · **Testes** · Depende. TDD (teste antes, falhando pelo motivo certo),
`npm run verificar` verde; as de UI herdam P-90.., P-02, P-08 e D-32. **Nenhum teste instala pacote real nem acessa rede**:
registro, tarball e servidores são falsos e locais.

### 7B-A — Contratos, esquema e dados

- **T-07B.01 · Contratos compartilhados (coordenador)** — `src/compartilhado/loja-mcp.ts` (tipos acima), canais/eventos em `ipc.ts`, `window.ade.lojaMcp` no preload
  (`CHAVES_API_ADE`), `PRODUTO.prefixoMcp = "ev_"` em `produto.ts` (D-01). **Aceite:** testes de contrato (canal ⇄ validador ⇄ preload) falham sem os validadores
  e passam com eles; `typecheck` verde; varredura de marca confirma o literal só em `PRODUTO`. **Testes:** `registro.test.ts`/`preload` estendidos. **Depende:** MVP fechado (T-05.07).
- **T-07B.02 · Esquema e validador do catálogo** — `esquema.ts` + `resources/mcp/catalogo-mcps.schema.json` (JSON Schema documental) + `esquema.test.ts`. **Aceite:** o seed
  atual valida; 12 entradas inválidas fabricadas (versão `latest`, `confirmado` sem integridade, segredo em `args`, `{{SEGREDO:X}}` não declarado, `url` http, id duplicado, campo
  com padrão `ghp_…` etc.) são todas recusadas com erro nominal; fuzz de 1 000 JSONs sem exceção. **Depende:** T-07B.01.
- **T-07B.03 · Seed embarcado e carregador** — `catalogo.ts#carregarCatalogo(caminho)` (cache em memória, `Object.freeze`), `scripts/copiar-ativos.mjs` copia
  `docs/ade/base/catalogo-mcps.seed.json` → `resources/mcp/catalogo-mcps.json` (asarUnpack não necessário; lido por `fs`). **Aceite:** ≥ 40 entradas; `confirmado:false` e `descartado` são `instalavel:false`;
  P-95; mudar uma byte do arquivo empacotado invalida (hash do seed no manifesto do build → "catálogo adulterado", Loja abre só-leitura). **Testes:** unidade + P-95. **Depende:** T-07B.02.
- **T-07B.04 · Migration `0004-catalogo-mcp` e repositório** — SQL acima em `migracoes/0004-catalogo-mcp.ts` (registrar em `index.ts`), `repos/catalogo-mcp.ts` (`criarRepoCatalogoMcp(banco)`: `gravarInstalado`,
  `listarInstalados`, `gravarConsentimento`, `habilitar`, `habilitacoesDe`, `salvarSaude`, `substituirFerramentas`, `registrarLog` com retenção, `cliInstalacao*`, `kit*`). **Aceite:** migrar 0003→0004 sem perda;
  upsert idempotente; retenção de log (201º evento descarta o mais antigo); consulta quente ≤ 5 ms (P-14). **Testes:** `migrar.test.ts`, `repos/catalogo-mcp.test.ts`. **Depende:** T-07B.01, T-07.02.
- **T-07B.05 · Cofre de segredos por servidor** — `src/main/cofre-mcp.ts`: porta `CofreSegredos {gravar(chave, valor), existe(chave), ler(chave) /* só main */, apagar(chave), apagarPrefixo(prefixo), disponivel()}`
  sobre `safeStorage` (reusa D-64; **não grava** se indisponível); `ler` nunca é exposto por IPC. **Aceite:** valor nunca aparece em `definida`/IPC/log (varredura de strings no banco e nos buffers de evento);
  indisponível → `codigo:"cofre_indisponivel"`; apagar por prefixo remove só `mcp/<id>/`. **Testes:** cofre falso em memória + um teste com `safeStorage` simulado. **Depende:** T-07B.01.
- **T-07B.06 · Servidores MCP FALSOS (fixtures)** — `tests/fixtures/mcp-loja/{ok,lento,lixo,crash,eco-ambiente,segredo-no-stderr,http}.mjs`: falam o protocolo **de verdade** por stdio
  (`initialize` → resultado com `protocolVersion`/`serverInfo`; `notifications/initialized`; `tools/list` com 2–3 tools; `tools/call` eco) e um `http.mjs` (streamable HTTP em `127.0.0.1` porta efêmera);
  `registro-falso.mjs` (HTTP local que serve `package.json` + tarball de 5 MB gerado com `tar`/`zlib` do Node e assinaturas ECDSA de uma chave de teste); `pacote-falso/` com `bin`. **Aceite:** cada modo
  produz o comportamento descrito (lento > 3 s, lixo = linha não-JSON, crash = sai com 1 após `initialize`, eco-ambiente lista `Object.keys(process.env)`); nenhum acessa a rede externa. **Depende:** T-07B.01.

### 7B-B — Comando, plano e verificação (puros)

- **T-07B.07 · `montarComando` e ambiente por allowlist** — `comando.ts`, `ambiente.ts`. **Aceite:** placeholders resolvidos; desconhecido lança; `npm`/`uvx`/`binario`/`docker`/`remoto` produzem a forma da seção "Formato"; `docker`
  recusa `--privileged`, `-v /`, `--network host`; ambiente = allowlist ∩ presente + variáveis declaradas (nunca `*TOKEN*`/`*KEY*` do usuário não declarados); `{{WORKSPACE}}` = raiz absoluta validada (existe, é diretório, sem `..`). **Testes:** tabela de 40 casos + fuzz de args.
  **Depende:** T-07B.02.
- **T-07B.08 · Plano de instalação e texto do consentimento** — `plano.ts#planejarInstalacao(entrada, diagnostico)` → `PlanoInstalacao {passos, comando_exato, pasta, hosts_rede, variaveis, riscos, nivel_verificacao, comando_hash,
  avisos[]}`; recusa `confirmado:false`, `descartado`, lista de bloqueio e pré-requisito ausente (com instrução acionável: "instale o Node/npm…"). **Aceite:** o `comando_hash` muda se qualquer arg/versão/host mudar; entrada sem lock mostra o aviso
  "dependências transitivas não travadas"; `scripts_permitidos:true` aparece em destaque. **Testes:** unidade. **Depende:** T-07B.07.
- **T-07B.09 · Verificação de integridade e assinatura** — `verificacao.ts`: `sha512`/`sha256` em stream; `verificarAssinaturaNpm({pacote, versao, integridade, assinaturas, chaves})` com `crypto.verify` ECDSA P-256 sobre `"<pacote>@<versao>:<integridade>"`
  (chaves de `https://registry.npmjs.org/-/npm/v1/keys`, embutidas em `resources/mcp/chaves-npm.json` com data e `expires`; chave expirada é recusada); `lock_sha256`. **Aceite:** tarball adulterado (1 byte) falha; assinatura inválida/chave expirada falha;
  integridade do seed ≠ do registro falha com `integridade_divergente`. **Testes:** vetores gerados pelo registro falso (T-07B.06). **Depende:** T-07B.06.
- **T-07B.10 · Lista de bloqueio** — `bloqueio.ts` + `resources/mcp/bloqueio.json` (`{id|pacote, versoes?, motivo, desde}`; seed vazio + `descartado` do catálogo) consultada em plano, instalação, atualização e **habilitação** (bloqueado depois de instalado → desabilita e avisa).
  **Aceite:** entrada bloqueada não instala nem habilita; carregar bloqueio malformado falha fechado (nada instala). **Testes:** unidade. **Depende:** T-07B.08.

### 7B-C — Instaladores isolados (rede só por clique)

- **T-07B.11 · Porta `Executor` e pasta isolada** — `instalar/base.ts`: `Executor.rodar({exe,args,cwd,env,timeoutMs,abort})` (spawn sem shell, saída limitada a 1 MB, árvore morta no cancelamento); preparo de
  `<userData>/mcp/.tmp/<id>-<ulid>/` e `mover atômico` para `<userData>/mcp/<id>/`; **recusa** `id` fora de `^[a-z0-9-]+$` e caminho que escape de `userData/mcp` (`realpath`). **Aceite:** cancelar apaga o `.tmp`; falha de disco no meio não deixa pasta
  parcial; varredura de `.tmp` órfãos no boot ocioso (> 1 h). **Testes:** executor falso + tmpdir real. **Depende:** T-07B.07.
- **T-07B.12 · Instalador npm** — `instalar/npm.ts`: nível `forte` → copia `resources/mcp/locks/<id>.package-lock.json` (checa `lock_sha256`) e roda `npm ci --ignore-scripts --omit=dev --no-audit --no-fund --prefix <tmp>`; nível `padrao` → `npm install --prefix <tmp> --ignore-scripts
  --omit=dev --no-audit --no-fund --save-exact <pacote>@<versao>`; sempre com `npm_config_registry` fixo (o oficial; o teste aponta para o registro falso), `npm_config_userconfig=<tmp>/.npmrc-vazio`, `HOME`/`TMPDIR` dentro do `.tmp`, **ambiente por allowlist**, sem herdar `NPM_TOKEN`.
  Depois: confere `integrity` do tarball raiz em `package-lock.json`/`node_modules/.package-lock.json` contra o seed e o binário `bin` existe. **Aceite:** com o registro falso instala o `pacote-falso` e o servidor falso inicia; integridade divergente aborta e apaga; `postinstall` do pacote
  falso **não** roda; nada fora da pasta do app é criado (hash da casa antes = depois, incluindo `~/.npm`: `npm_config_cache` dentro do `.tmp`); P-92. **Testes:** registro falso + `npm` real do Node de teste **ou** executor falso (sem rede; escolher o falso se `npm` não estiver no CI). **Depende:** T-07B.09, T-07B.11.
- **T-07B.13 · Instalador PyPI (`uv`)** — `instalar/python.ts`: `uv venv <tmp>/venv` + `uv pip install --require-hashes -r <tmp>/requirements.txt --python <tmp>/venv/bin/python` (arquivo gerado a partir de `lock_sha256`/hashes do seed; sem hash → só `padrao`
  com `--no-deps` **proibido** → exige lock); `UV_CACHE_DIR`/`UV_PYTHON_INSTALL_DIR` dentro do `.tmp`; recusa `uvx pkg` sem pino. **Aceite:** com executor falso gera a linha exata do comando; sem `uv` → pré-requisito ausente acionável; nenhum `uv tool install` global. **Testes:** executor falso. **Depende:** T-07B.09, T-07B.11.
- **T-07B.14 · Instalador de binário/GitHub release e Docker (opt-in)** — `instalar/binario.ts` (download HTTPS só de `github.com/<dono>/<repo>/releases/download/<tag>/…`, sha256 do seed, `chmod 0755`, nunca `curl | sh`) e `instalar/docker.ts` (**só** com Docker presente e **ação separada** "Baixar imagem": `docker pull <imagem>@sha256:<digest>`;
  execução `docker run --rm -i --pull never`). **Aceite:** digest ausente → não instalável; Windows: binário `.exe`; imagem sem digest recusada. **Testes:** executor falso + servidor HTTP local. **Depende:** T-07B.09, T-07B.11.
- **T-07B.15 · Registro de servidor remoto** — `instalar/remoto.ts`: "instalar" = validar `https://`, gravar `catalogo_mcp_instalado(metodo='remoto', nivel='remoto')` e consentimento (host e riscos); **sem rede** nessa etapa; OAuth fica para a CLI (primeira chamada do Pane abre o fluxo da CLI). **Aceite:** URL `http://`
  recusada; trocar a URL no seed invalida o consentimento (novo `comando_hash`); P-92 trivial. **Testes:** unidade. **Depende:** T-07B.08.

### 7B-D — Ciclo de vida, saúde e segredos

- **T-07B.16 · Cliente MCP de saúde** — `saude-mcp.ts#testarServidor({alvo, timeoutMs=3000})`: stdio (spawn por `Executor` com ambiente mínimo + segredos do cofre), `initialize` (versão do protocolo, `clientInfo`), `notifications/initialized`, `tools/list` (paginação até 200), fecha e **mata a árvore**; HTTP streamable
  com `Accept: application/json, text/event-stream`. Saída: `{estado, latencia_ms, n_ferramentas, ferramentas: Array<{nome, descricao saneada}>, erro_codigo}`; erros nominais: `timeout`, `saida_invalida`, `processo_encerrou`, `nao_autorizado`, `protocolo_incompativel`. Stderr do servidor nunca vai ao renderer (só 2 KB redigidos ao log).
  **Aceite:** `ok` ≤ 300 ms, `lento` → `timeout` em 3 s e processo morto ≤ 500 ms, `lixo`/`crash` → erro nominal, `segredo-no-stderr` → log redigido; P-93. **Testes:** fixtures T-07B.06. **Depende:** T-07B.06, T-07B.07.
- **T-07B.17 · Máquina de estados, atualizar e desinstalar** — `ciclo.ts`: instalar (passos 1–6) com eventos de progresso, `atualizar` (compara `comando_hash`/riscos/variáveis; mudou → novo consentimento; instala em `.tmp`, **troca atômica** e mantém a pasta antiga até o teste de saúde passar; falhou → restaura),
  `desinstalar` (pasta, linhas, `catalogo_item`, opcionalmente segredos, instalações na CLI que o app criou). **Aceite:** falha em qualquer passo deixa o estado anterior intacto; desinstalar com Pane ativo recusa ("servidor em uso"); 0 resíduos; P-99; atualização nunca automática (teste: nenhuma chamada sem ação). **Testes:** executor falso + disco real em tmpdir. **Depende:** T-07B.04, T-07B.12, T-07B.15, T-07B.16.
- **T-07B.18 · Variáveis, assistente de credenciais e teste** — serviço `variaveis`: valida nome ∈ declaradas, valor não vazio ≤ 4 KB, sem quebra de linha; grava no cofre; `definida` no banco; `testar` usa T-07B.16 com os segredos. **Aceite:** variável obrigatória faltando → `habilitar` retorna `nao_configurado`; valor nunca em IPC/log/evento (varredura); `Testar` com chave inválida → `nao_autorizado` sem eco do valor. **Testes:** unidade + varredura. **Depende:** T-07B.05, T-07B.16, T-07B.04.
- **T-07B.19 · Saúde passiva e logs** — verificação passiva (pasta existe, binário executável, `comando_hash` do seed = consentido, versão do seed mais nova → badge "atualização disponível"), logs com retenção, `loja_mcp:logs`; "ao abrir a Loja, 1× por 24 h" (D-139) limitado a 2 testes simultâneos. **Aceite:** abrir a Loja não inicia processo se nada está habilitado; P-94. **Testes:** contagem de filhos. **Depende:** T-07B.17.

### 7B-E — Habilitação e injeção por Pane

- **T-07B.20 · Injeção por CLI/Pane** — `injecao.ts` + extensão compatível de `terminais/catalogo.ts`: `configuracaoDeMcpLoja(cli, servidores[], ctx) → ConfiguracaoMcp` (mesma forma de `configuracaoDeMcp`: `argumentos`, `ambiente`, `arquivo`), fundida com a do MCP do app por `combinarAmbientes` e por fusão do JSON do arquivo `--mcp-config`.
  Claude: um **único** arquivo `<userData>/panes/<pane_id>/mcp.json` (0600) com `mcpServers`; Codex: `-c mcp_servers.<nome>.command="…"`, `.args=[…]`, `.env_vars=[…]` (stdio direto) ou `.url=…`/`.bearer_token_env_var`/`.env_http_headers`; OpenCode: `mcp.<nome> {type:"local",command:[…],environment:{…},enabled:true}` ou `remote`, no `OPENCODE_CONFIG_CONTENT`;
  Gemini: `null`. Servidor stdio **com segredo** usa o lançador (T-07B.21). Nome `ev_<id com _>` ≤ 40, `[a-z0-9_]`. **Aceite:** teste de contrato por CLI contra `--help` gravado e CLI falsa; **hash de `~/.claude.json`, `~/.codex/config.toml`, `~/.config/opencode/` antes = depois**; argv sem segredo; P-97; a configuração do MCP do app (D-13) continua idêntica. **Testes:** unidade + contrato. **Depende:** T-07B.18, T-07B.21, T-07.19.
- **T-07B.21 · Lançador `mcp-run` e rota `/loja/segredos`** — `resources/mcp/mcp-run.mjs` (ESM, sem dependências): lê `--servidor <id>` e a porta/token do ambiente do Pane (`EXPXV_LOJA_URL`, `EXPXV_LOJA_TOKEN`, **fora** do ambiente repassado ao filho), chama `POST /loja/segredos`, monta ambiente por allowlist + variáveis devolvidas, `spawn(executavel, args, {stdio:'inherit'})`, propaga sinais e código de saída; falha → stderr claro e `exit 70`. Rota em `src/nucleo/mcp/servidor.ts` com a regra do contrato. **Aceite:** o servidor `eco-ambiente` lista **só** a allowlist + declaradas (sem `ANTHROPIC_API_KEY`, sem `EXPXV_LOJA_TOKEN`); Pane sem permissão recebe 403; resposta `no-store`; 6ª chamada/min → 429; P-98. **Testes:** e2e com servidor falso + servidor MCP do app real. **Depende:** T-07B.16, T-07.19.
- **T-07B.22 · Habilitação e política** — serviço `habilitar`: grava `catalogo_mcp_habilitacao`; `resolverServidoresLoja({workspace, missao, agente, papel})` puro (precedência agente > Missão > workspace; interseção só estreita; sem linha = fora); integra em `politica.ts` (T-07.18) como fonte de `servidores_mcp`; snapshot em `catalogo_pane_politica` e gate `pre-mcp` para `mcp__ev_<id>__*`. **Aceite:** Missão `squad` sem allow-list → 0 servidores da Loja; habilitar sem configurar recusa; bloqueado/desinstalado sai da política na hora; selo de isolamento por CLI correto (Claude duro; Codex/OpenCode parcial; Gemini `nenhum`). **Testes:** tabela de 30 cenários. **Depende:** T-07B.04, T-07.18, T-07.22.
- **T-07B.23 · "Também instalar na minha CLI"** — `cli-usuario.ts`: **prévia** do comando (`claude mcp add --scope user --transport … ev_<id> -- <executavel> <args>`; `codex mcp add ev_<id> --env … -- <cmd>`; `opencode mcp add`/edição guiada; `gemini mcp add -s user`), confirmação **digitada**, execução com `Executor` (sem shell), registro em `catalogo_mcp_cli_instalacao`, remoção só do que o app criou (`mcp remove ev_<id>`). Segredos **não** vão: variável secreta → o usuário é orientado a usar a variável de ambiente dele (o app não grava segredo na CLI global). **Aceite:** sem clique/confirmação nada roda; servidor com segredo mostra aviso e **não** copia o valor; remover não toca servidor de nome diferente de `ev_*`; teste com CLI falsa que registra argv. **Testes:** CLI falsa. **Depende:** T-07B.20.
- **T-07B.24 · Kit mínimo e primeiro uso** — `kit.ts`: lista fixa (ids do seed com `classificacao=pre_instalado_habilitado`), instalação conjunta com **um** consentimento, `opt_out`, e "instalar no primeiro uso": quando um Pane `livre` abre e o Kit está habilitado mas `sequential-thinking` não instalado, **não instala sozinho**: mostra um aviso discreto no Pane/cabeçalho "Kit pronto — instalar 1 servidor (clique)"; remotos já funcionam sem instalar. **Aceite:** 0 downloads sem clique (teste com rede espiada); remotos entram na configuração do Pane sem instalação; `opt_out` remove o Kit da allow-list sugerida. **Testes:** e2e. **Depende:** T-07B.20, T-07B.22.
- **T-07B.25 · Tool `mcp_store_list` (Fases 14/15/16)** — `src/nucleo/mcp/tools/mcp-store.ts` + matriz (`agentico`, `squad`), saída conforme contrato; Fase 14: o editor de agente lê `loja_mcp:habilitacoes` e grava `alvo_tipo=agente`; Fase 16: o Maestro consulta para escolher MCP por etapa (só leitura). **Aceite:** token de Pane devolve só os habilitados/configurados dele; nunca URL/args/variáveis; p95 ≤ 20 ms (P-27 análogo). **Testes:** carga em loopback. **Depende:** T-07B.22.

### 7B-F — UI (compacta, D-32; destaque azul)

- **T-07B.26 · Estado do renderer** — `estado/loja-mcp.ts`: cache do catálogo + estado local por servidor, filtro/ordenação puros (testáveis), assinatura de eventos `loja_mcp:*`, sem IPC por tecla. **Aceite:** P-91; um evento de progresso não re-renderiza a grade inteira. **Testes:** unidade do filtro (tabela de 30 buscas) + spy. **Depende:** T-07B.01.
- **T-07B.27 · Tela e grade de cartões** — `LojaMcp.tsx`, `CartaoMcp.tsx`, linha única de controles, virtualização (`VirtualLista`) acima de 100, estados do botão primário, entrada no menu lateral e na paleta, `React.lazy`. **Aceite:** P-90, P-96; uma linha de controles (teste de altura); a11y (foco, `aria-label`, contraste D-31). **Depende:** T-07B.26.
- **T-07B.28 · Painel lateral e consentimento** — `PainelMcp.tsx`, `Consentimento.tsx`: comando exato copiável, riscos, hosts, nível, fontes/data, ferramentas, matriz "Habilitado em" com selos; consentimento com checkbox. **Aceite:** o comando exibido é **byte a byte** o que o instalador executa (teste compara com `planejarInstalacao`); botão Instalar desabilitado sem "Entendi"; `confirmado:false` mostra "não confirmado" e sem botão. **Depende:** T-07B.27, T-07B.08.
- **T-07B.29 · Assistente de credenciais** — `Credenciais.tsx`: campos mascarados, links `onde_conseguir` pelo navegador padrão (`shell.openExternal` só `https:`), Salvar/Testar, estados de erro nominais, bloqueio se `cofre_indisponivel`. **Aceite:** o valor nunca aparece no DOM após salvar (campo limpo), nem em `localStorage`/logs do renderer (teste); Testar mostra latência e nº de ferramentas. **Depende:** T-07B.28, T-07B.18.
- **T-07B.30 · Aba Instalados, saúde, atualizar e remover** — `Instalados.tsx`: lista com ícone de saúde, versão, tamanho, "atualização disponível", Atualizar (diff + consentimento), Remover (pergunta sobre segredos), logs recolhíveis; "Também na minha CLI" por servidor. **Aceite:** Remover mostra "N resíduos: 0"; Atualizar nunca roda sem consentimento; logs redigidos. **Depende:** T-07B.28, T-07B.17, T-07B.23.
- **T-07B.31 · Integração com a casca, Configurações e diagnóstico** — menu lateral/paleta/atalhos, Configurações → "Loja de MCPs" (kit, opt-out, diagnóstico `npm/uv/docker/cofre`, abrir pasta `mcp/`), aviso persistente quando `npm`/`uv` ausentes (com instrução), e **link na aba MCPs do Catálogo** (Fase 7). **Aceite:** diagnóstico acionável por ausência; foco/atalhos; D-32. **Depende:** T-07B.30.

### 7B-G — Descoberta (P2), fechamento e auditoria

- **T-07B.32 · (P2) Descobrir no Registro Oficial** — `loja_mcp:descobrir`: `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=<q>&version=latest&limit=20` **só por clique**, timeout 8 s, metadados CC0 (confirmado), resultado marcado `curado:false`/`instalavel:false`, namespace verificado (`io.github.<org>/…`) destacado, spam
  filtrado por heurística, nenhum comando exibido como instalável; botão "Sugerir ao catálogo" gera um rascunho de entrada para curadoria humana (arquivo local, nada enviado). **Aceite:** sem clique nenhuma chamada; resposta malformada não quebra a tela; item descoberto não habilita nada. **Testes:** servidor HTTP falso com respostas gravadas do registro. **Depende:** T-07B.27.
- **T-07B.33 · Script de lock e hashes (manual, com consentimento do dono)** — `scripts/gerar-lock-mcp.mjs`: para cada entrada npm/PyPI do seed, **com rede e só quando o dono mandar rodar** (P-131), gera `locks/<id>.package-lock.json`/`requirements.txt` com hashes, preenche `lock_sha256`, confere `integridade` com o registro e escreve um relatório `docs/ade/perf/…`-like (`docs/ade/base/catalogo-mcps.relatorio-lock.md`). Fora do `npm run verificar`. **Aceite:** `--dry-run` não faz rede e lista o que faria; rodar duas vezes dá hashes idênticos. **Depende:** T-07B.03.
- **T-07B.34 · Passe de desempenho** — `tests/perf/loja-mcp.perf.ts` (P-90..P-99) + gerador de seed sintético (100 e 2 000 entradas) em `tests/fixtures/mcp-loja/gerar.ts`; grava em `docs/ade/perf/ultimo.json`. **Aceite:** todos verdes; resultado registrado no STATUS. **Depende:** T-07B.31, T-07B.25.
- **T-07B.35 · Auditoria de segurança e fechamento** — checklist executado pelo coordenador: (1) varredura de strings por segredo de teste no banco, logs, eventos, argv, arquivos `panes/*` e dump do renderer; (2) hash da casa do usuário antes/depois de instalar+habilitar+injetar+desinstalar; (3) nenhuma chamada de rede sem clique (espião de `net`/`fetch`/`child_process`); (4) `npx`, `@latest`,
  `curl | sh`, `--force`, `sudo` ausentes do código (`grep` no teste); (5) lançador não repassa `ANTHROPIC_*`/tokens; (6) zero processo MCP órfão (`ps`); (7) bloqueio e `confirmado:false` respeitados; (8) 403 na rota de segredos fora da política; ajustes em `05-CONTRATOS.md` (§1 tabelas `catalogo_mcp_*`, §2 canais `loja_mcp:*`, §3 `mcp_store_list`, §7 eventos `mcp_store.*`) e `STATUS.md`. **Aceite:** checklist
  sem item aberto. **Depende:** T-07B.34.
- **T-07B.36 · E2E no Electron real** — `tests/loja-mcp.e2e.test.ts` (`E2E=1`, `E2E_HOME`, registro falso por `EXPXV_E2E_REGISTRO_NPM`): (1) abrir a Loja (P-90); (2) Kit: instalar `sequential-thinking` falso → saudável; (3) servidor com chave: configurar no cofre, Testar (`ok`, `nao_autorizado` com chave errada); (4) habilitar no workspace e abrir Pane com CLI falsa: ela lista `mcp__ev_*`
  e **não** enxerga o segredo no ambiente; (5) Missão `squad` sem allow-list: nenhum servidor; (6) atualizar com diff; (7) desinstalar sem resíduos; (8) nada escreveu na casa. **Aceite:** verde, sem processos órfãos (`tests/limpeza.ts`). **Depende:** T-07B.35 (roda em paralelo à auditoria; fecha por último).

## Casos de aceitação principais (todos viram teste automatizado)

| AC | Cenário | Resultado |
|---|---|---|
| AC-1 | Instalar entrada `confirmado:false` | recusa `nao_confirmado`; botão ausente |
| AC-2 | Registro devolve tarball com 1 byte alterado | aborta, apaga `.tmp`, `integridade_divergente`, nada em `mcp/<id>/` |
| AC-3 | Pacote com `postinstall` | script **não** executa (`--ignore-scripts`); se `scripts_permitidos`, aparece no consentimento |
| AC-4 | Servidor exige `API_KEY` e o usuário não configurou | `habilitar` → `nao_configurado`; Pane não recebe o servidor |
| AC-5 | Chave inválida | `Testar` → `nao_autorizado`, sem eco do valor |
| AC-6 | Pane de Missão `squad` sem allow-list | 0 servidores da Loja; gate nega `mcp__ev_x__*` |
| AC-7 | Pane Claude com Loja habilitada | `--mcp-config <arquivo 0600>`; `~/.claude.json` inalterado; arquivo apagado ao fechar o Pane |
| AC-8 | Pane Codex | `-c mcp_servers.ev_x.command=…` sem segredo no argv; `env_vars` só com nomes |
| AC-9 | Gemini | selo "sem injeção por Pane"; só "Instalar na minha CLI" |
| AC-10 | Atualização com novo comando/risco | novo consentimento; falha mantém a versão anterior |
| AC-11 | `eco-ambiente` via lançador | lista só allowlist + declaradas |
| AC-12 | App fechado/aberto sem Pane | 0 processos MCP |
| AC-13 | Desinstalar com Pane usando | recusa; depois do Pane, 0 resíduos |
| AC-14 | Seed adulterado no pacote | Loja só-leitura com aviso |
| AC-15 | Sem rede | instalar falha com `rede_indisponivel` acionável; Loja continua navegável (catálogo local) |

## Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| **Cadeia de suprimentos npm/PyPI** (typosquatting, conta comprometida, dependência transitiva) | execução de código de terceiros na máquina | pino exato + integridade + assinatura ECDSA + lock (`forte`) + `--ignore-scripts` + pasta isolada + consentimento por versão + lista de bloqueio + atualização manual |
| **Segredo vaza** para o agente (env/Bash), disco, log | credencial exposta | cofre `safeStorage`; lançador busca por loopback e não repassa ao filho além do declarado; arquivo temporário só para remoto Claude/OpenCode (0600, apagado); varredura de strings nos testes (T-07B.35); P-132 documenta o risco residual |
| **Prompt injection** por resultado de tool (páginas, docs, issues) | agente executa instrução hostil | agentes não instalam/configuram; deny-by-default; descrição saneada; servidores de risco alto só `pre_configurado`/`opcional` e nunca no Kit; navegador/escrita remota exigem habilitação explícita por agente |
| **Servidor stdio pesa memória** | viola leveza | só vive com o Pane; 0 ocioso (P-94); remotos para o Kit; sem health contínuo |
| **Escrever na CLI do usuário** | quebrar/poluir | só por Pane; "minha CLI" é opção explícita com prévia; só `ev_*` removível |
| **Catálogo envelhece** (versões/links mudam) | instalação falha | `data_versao` e fonte por entrada; atualização do seed por release do app; teste de ids únicos; `confirmado:false` honesto; descoberta P2 do Registro Oficial |
| **`npm`/`uv`/Docker ausentes** | "um clique" não funciona | diagnóstico acionável; remotos funcionam sem nada; pendência P-130 (empacotar `npm` ou exigir Node) |
| **OAuth remoto** (CLI abre navegador; token fica no armazenamento da CLI) | fluxo fora do app | documentado; app não toca no token; selo "autenticação pela CLI" |
| **Flags das CLIs mudam** (`--mcp-config`, `-c mcp_servers`, `OPENCODE_CONFIG_CONTENT`) | injeção para de funcionar | teste de contrato contra `--help` gravado por versão (T-07B.20) + erro nominal por CLI |
| **Windows** (symlink, `.cmd` do npm, caminhos) | instalação falha | `npm.cmd` via `Executor` sem shell, caminhos com `path`, testes de unidade simulando; sem validação real (D-26) |
| **Docker** (peso, privilégios) | superfície grande | método `docker` opcional, imagem por digest, sem `--privileged`, ação separada de baixar |
| **Licença/termos de dados de diretórios** | uso indevido de metadados | só curadoria própria; Registro Oficial = CC0 (confirmado); Smithery/mcp.so não usados como fonte (termos não confirmados) |

## Ordem de execução e paralelismo

```
T-07B.01 ─► T-07B.02 ─┬► T-07B.03 ─► T-07B.33
                      ├► T-07B.07 ─► T-07B.08 ─┬► T-07B.10
                      │                         └► T-07B.15
T-07B.01 ─┬► T-07B.04 ─────────────────────────────────────┐
          ├► T-07B.05                                       │
          └► T-07B.06 ─► T-07B.09 ─► T-07B.12 ─┐            │
                    └──► T-07B.16 ─────────────┤            │
T-07B.07 ─► T-07B.11 ─┬► T-07B.12/.13/.14 ─────┴► T-07B.17 ─► T-07B.18 ─► T-07B.19
T-07B.18 + T-07B.21 + T-07.19 ─► T-07B.20 ─► T-07B.22 ─► T-07B.23 ─► T-07B.24 ─► T-07B.25
T-07B.01 ─► T-07B.26 ─► T-07B.27 ─► T-07B.28 ─► T-07B.29 ─► T-07B.30 ─► T-07B.31 ─► T-07B.34 ─► T-07B.35 ─► T-07B.36
                                   └► T-07B.32 (P2)
```

**O que pode ir ANTES da Fase 7 completa** (só dependem do MVP + Fase 3): T-07B.01–T-07B.19 (contratos, esquema, seed, cofre, instaladores, saúde, ciclo de vida) e a UI T-07B.26–T-07B.31 (a Loja funciona **sozinha**, habilitando por workspace e
mostrando "isolamento: aguardando Catálogo" até a Fase 7 existir). **Dependem da Fase 7:** T-07B.20 (precisa do snapshot por Pane, T-07.19), T-07B.22 (política e gate, T-07.18/.22), T-07B.23–T-07B.25. Se a Fase 7 ainda não existir quando a Fase 14 precisar
de MCP por agente: fazer o mínimo — `catalogo_mcp_habilitacao` + `configuracaoDeMcpLoja` sem gate — e marcar "parcial" (D-44).

Áreas de arquivo disjuntas (≤ 5 agentes simultâneos; ninguém edita o mesmo arquivo):

| Agente | Tasks | Áreas que possui |
|---|---|---|
| **Coordenador** | T-07B.01, T-07B.20 (junção em `terminais/catalogo.ts`), T-07B.22 (política), T-07B.31, T-07B.35, T-07B.36 | `src/compartilhado/**`, `src/preload/**`, `src/main/**`, `src/nucleo/terminais/catalogo.ts`, docs |
| **A — Esquema, comando, verificação** | T-07B.02, .03, .07, .08, .09, .10, .33 | `src/nucleo/loja-mcp/{esquema,catalogo,comando,plano,verificacao,bloqueio,ambiente}.ts`, `resources/mcp/{*.json}`, `scripts/gerar-lock-mcp.mjs` |
| **B — Dados, cofre e ciclo** | T-07B.04, .05, .11–.19 | `src/nucleo/banco/**` (só `0004` e `repos/catalogo-mcp.ts`), `src/main/cofre-mcp.ts`, `src/nucleo/loja-mcp/{instalar,saude-mcp,ciclo}.ts` |
| **C — Fixtures, lançador e injeção** | T-07B.06, .21, .23, .24, .25 | `tests/fixtures/mcp-loja/**`, `resources/mcp/mcp-run.mjs`, `src/nucleo/loja-mcp/{injecao,cli-usuario,kit}.ts`, `src/nucleo/mcp/{servidor.ts (rota),tools/mcp-store.ts}` |
| **D — UI** | T-07B.26–T-07B.30, .32 | `src/renderer/telas/loja-mcp/**`, `src/renderer/estado/loja-mcp.ts` (+ entrada de menu acordada com o coordenador) |

Sequência recomendada: onda 1 = T-07B.01 (coordenador), T-07B.02 (A), T-07B.06 (C), T-07B.04/.05 (B); onda 2 = A (.03,.07–.10), B (.11–.16), D (.26–.27), C aguarda; onda 3 = B (.17–.19), C (.21), D (.28–.30), junção T-07B.20/.22 pelo
coordenador (após Fase 7 ou em modo parcial); onda 4 = T-07B.23–.25, .31–.34; onda 5 = T-07B.35 e T-07B.36.

## Integração com outras fases

- **Fase 14 (squads):** o editor de agente ganha o seletor "MCPs permitidos" lendo `loja_mcp:habilitacoes` e gravando `catalogo_mcp_habilitacao(alvo_tipo='agente')`; as squads de fábrica declaram MCPs sugeridos por papel (docs → `context7`; QA → `playwright-mcp`;
  infra → `kubernetes-mcp-server`…), **sempre como sugestão** que o usuário habilita.
- **Fase 16 (Maestro/pipelines):** cada etapa do pipeline pode declarar `mcps: string[]`; o Maestro só **seleciona entre os habilitados** (`mcp_store_list`); faltando um, abre a Loja no servidor (nunca instala sozinho).
- **Fase 15 (RAG):** MCPs de docs/web (`context7`, `deepwiki`, `exa-web-search`, `brave-search`) alimentam o RAG como **fontes opcionais** (resultado vira nota local redigida; nada de rede sem a Loja habilitada para o agente).
- **Fase 17 (mapa do código):** `serena` (LSP) e `repomix` são candidatos de apoio ao mapa; a integração só consome o que o usuário habilitou.
- **Rigidez em 5 níveis:** nos níveis altos, a Loja recusa `habilitar` de servidores com risco `escrita_remota`/`execucao_codigo` para agentes `executor`/`explorador` sem confirmação; no nível máximo, Missão só aceita servidores do Kit.
- **Fase 9/10:** servidores com `custo_externo` (Tavily/Exa/Firecrawl/Brave com plano pago) mostram selo e entram no relatório de custo como "externo, não medido".

## Decisões `[LAC]` resolvidas aqui

| Ponto | Escolha |
|---|---|
| Fonte do catálogo | seed próprio curado (D-130); Registro Oficial opcional/CC0; sem Smithery/mcp.so |
| `npx -y` | proibido; instalação pinada em pasta do app (D-131) |
| Segredo | cofre + lançador por loopback (D-132); remoto com chave: risco residual (D-133/P-132) |
| Gemini | sem injeção por Pane (D-136) |
| Gateway interno | adiado (D-135/P-133) |
| Kit habilitado | `context7` (npm, chave opcional), `deepwiki` (remoto), `sequential-thinking` (npm) (D-134) |
| Quem instala | só o humano na UI (D-138) |
