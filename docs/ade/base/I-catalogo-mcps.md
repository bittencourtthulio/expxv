# Digest I — Loja de MCPs: fontes, curadoria de servidores de desenvolvimento, configuração por CLI e cadeia de suprimentos

Pesquisa **somente-leitura** feita em **2026-09-30** para a Fase 7B (`fase-07b-loja-mcps.md`). Nada foi instalado (nenhum `npm install`/`npx`/`uvx`/`docker`/`brew`), nenhuma conta
criada, nenhuma chave usada. Fontes: documentação oficial (WebFetch), API de leitura do GitHub (`gh api`), registros npm/PyPI (GET de leitura:
versão, licença, `dist.integrity`, hashes) e `--help` locais das CLIs. Onde não foi possível confirmar, está escrito **não confirmado**. Os dados por servidor
estão no seed `catalogo-mcps.seed.json` (74 entradas); as tabelas abaixo são **geradas a partir dele**.

## 0. Resumo executivo

- **74 servidores/variantes pesquisados** em 11 categorias; **43 confirmados** (versão exata + licença + comando/variáveis lidos na fonte) e **31 "não confirmados"** (entram no seed com
  `versao: null` e **não são instaláveis**). Por classificação: **3 PRÉ-INSTALADO E HABILITADO**, **18 PRÉ-CONFIGURADO** (1 clique, pede chave/OAuth), **45 OPCIONAL/COMUNIDADE**, **8 DESCARTADO**.
- **Conjunto mínimo sugerido (habilitado por padrão):** `context7` (docs de bibliotecas, chave opcional), `deepwiki` (remoto, repositórios públicos), `sequential-thinking` (raciocínio estruturado, sem I/O). Justificativa em `fase-07b` §Pré-instalados.
- **Fonte do catálogo = seed próprio curado.** O Registro Oficial do MCP tem API pública estável (v0.1) e metadados CC0, mas está cheio de forks/spam; serve só para *descobrir*.
- **`npx -y` deve ser abolido:** instalar em pasta do app com versão exata, integridade (sha512/sha256), assinatura ECDSA do registro npm, `--ignore-scripts` e lock.
- **Gemini CLI não tem caminho de configuração por invocação confirmado** → sem injeção por Pane (decisão D-136). Claude Code, Codex e OpenCode têm (seção 3).
- **Achado de segurança que muda o desenho:** segredo em `env` do Pane vaza para o shell do agente; em arquivo, vaza para disco. Por isso o **lançador `mcp-run`** (segredo por loopback, ambiente por allowlist). O Claude Code ainda lê como **vazias** variáveis de nomes tipo `*TOKEN*`/`*KEY*` na expansão `${VAR}` de `.mcp.json` (doc oficial) — então referenciar segredo por `${VAR}` não é caminho.

## 1. Fontes de descoberta

| Fonte | O que é | API pública estável? | Licença/termos dos metadados | Veredito |
|---|---|---|---|---|
| **Registro Oficial do MCP** — `https://registry.modelcontextprotocol.io` (repo `modelcontextprotocol/registry`) | Registro central de `server.json` (`$schema` `static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`; `packages[]` com `registryType`, `identifier`, `version`, `transport`, `environmentVariables`; `remotes[]` com `type`, `url`, `headers`) | **Sim, com ressalva.** README: *API freeze v0.1* desde 2025-10-24; "preview" e GA futuro (não confirmado se já saiu de preview). `GET /v0.1/servers?search=<q>&version=latest&limit=<n>&cursor=…` respondeu 200 em 2026-09-30 (e `/v0/servers`). Última release do registro: v1.8.1 (2026-08-06). | **Metadados dedicados ao domínio público (CC0 1.0)**, com permissão explícita de processar/crawlear (`docs/modelcontextprotocol-io/terms-of-service.mdx`). Código do registro: transição MIT → Apache-2.0 (GitHub SPDX = `NOASSERTION`). | **Fonte de DESCOBERTA opcional (T-07B.32)**, nunca de instalação: a busca "context7" devolveu forks (`ai.smithery/…`) e "paid remote MCP" de terceiros; "playwright" devolveu serviços pagos de terceiros. Só `io.github.<org>/…` com repositório conferido merece destaque. |
| **`modelcontextprotocol/servers`** | Só **7 servidores de referência** hoje: `everything`, `fetch`, `filesystem`, `git`, `memory`, `sequentialthinking`, `time` | n/a (repositório) | Arquivo `LICENSE` "Other": transição MIT → Apache-2.0 (pacotes publicados trazem "MIT AND Apache-2.0"). Aviso do README: *reference implementations, not production-ready*. | **Curar à mão.** Os outros (GitHub, GitLab, Postgres, SQLite, Redis, Puppeteer, Slack, Sentry, Brave, Google Drive/Maps, EverArt, AWS KB) estão em **`servers-archived`** (MIT, arquivado em 2025-05) — **não usar**. |
| **`punkpeye/awesome-mcp-servers`** (MIT, ~95 mil estrelas, push 2026-09-27) · `wong2/awesome-mcp-servers` (MIT) · `appcypher/awesome-mcp-servers` (**arquivado**) | Listas Markdown | Não (sem API) | MIT (texto das listas) | **Só pesquisa humana** de candidatos; nenhum dado é importado. |
| **Smithery** — `registry.smithery.ai/servers` | Registro e hospedagem de servidores | API respondeu 200 sem autenticação em 2026-09-30 (campos `qualifiedName`, `verified`, `useCount`, `remote`…) | **Termos de uso dos metadados: não confirmado** (a página de docs da API devolveu 404). CLI deles é **AGPL-3.0** (não embarcar). Hospedar/usar servidor via Smithery exige conta/chave. | **Descartado como fonte e canal.** |
| **Docker MCP Catalog / Toolkit** — `hub.docker.com/mcp`, repo `docker/mcp-registry` (MIT), `docker/mcp-gateway` (MIT) | >200 servidores (docs) empacotados como imagens; Docker afirma que **constrói e assina** os servidores locais, com proveniência e SBOM | Repositório público de definições; API: não confirmada | MIT (repositório) | **Método de instalação opcional (`docker`)**, só com Docker presente e imagem por digest. Peso/privilégio ≠ "leve": nunca no Kit. |
| **mcp.so** | Diretório comunitário | Sem API/licença de dados mencionada no site | Não confirmado | Só descoberta manual. |
| **GitHub MCP Registry** — `github.com/mcp` | Catálogo (339 servidores quando consultado) | Sem API/feed confirmado; relação com o Registro Oficial **não confirmada** | Não confirmado | Só descoberta manual. |

**Recomendação [DEC]:** o **seed versionado no app** é a fonte de verdade (D-130). Atualizações do seed vêm com releases do app (cada entrada com `fontes[]`+data). A busca no Registro
Oficial é um recurso P2, por clique, que apenas **sugere** candidatos "não curados" e não instaláveis.

## 2. Curadoria de MCPs de desenvolvimento (74 entradas)

Legenda das tabelas: 🔑 = variável secreta; `*` = obrigatória; "Conf." = `confirmado` do seed (versão exata + licença + comando/variáveis lidos na fonte; **não** = não instalável);
"Instalação (pino)" mostra o pacote e a **versão exata** (se não confirmada, "não pinado" e a versão vista fica só informativa). Classes: **PRÉ-INSTALADO E HABILITADO** · **PRÉ-CONFIGURADO**
(1 clique, pede chave/OAuth) · **OPCIONAL** · **DESCARTADO**. Integridade (sha512/sha256), tools principais, links, fontes e observações completas estão no seed. Datas: consulta em 2026-09-30.

Contagem por categoria: código e repositórios 8 · documentação e conhecimento 8 · web e pesquisa 5 · navegador e testes 4 · bancos de dados 12 · nuvem e infraestrutura 12 ·
observabilidade e qualidade 7 · gestão e comunicação 7 · raciocínio e memória 3 · execução e sandbox 3 · pagamentos e APIs 5.


### 2.1 Código e repositórios (8)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `filesystem` | oficial (modelcontextprotocol (servidores de referência)) · MIT AND Apache-2.0 | npm `@modelcontextprotocol/server-filesystem@2026.8.31` | stdio | — | grátis (open source) | acesso_disco | ativo | OPCIONAL | sim |
| `git` | oficial (modelcontextprotocol (servidores de referência)) · MIT | uvx `mcp-server-git@2026.8.18` | stdio | — | grátis (open source) | acesso_disco, execucao_codigo | ativo | OPCIONAL | sim |
| `github` | oficial (GitHub) · MIT | binario `github/github-mcp-server@1.12.2` | stdio | GITHUB_PERSONAL_ACCESS_TOKEN🔑*, GITHUB_TOOLSETS, GITHUB_READ_ONLY, GITHUB_HOST | grátis (open source) | rede_saida, segredos, escrita_remota, prompt_injection, dados_sensiveis | ativo | PRÉ-CONFIGURADO | sim |
| `github-remoto` | oficial (GitHub) · MIT | remoto `https://api.githubcopilot.com/mcp/` | HTTP | GITHUB_PERSONAL_ACCESS_TOKEN🔑 | plano grátis | rede_saida, segredos, escrita_remota, prompt_injection, dados_sensiveis | ativo | OPCIONAL | sim |
| `gitlab-remoto` | oficial (GitLab) · n/c | remoto `https://gitlab.com/api/v4/mcp` | HTTP | — | plano grátis | rede_saida, escrita_remota, prompt_injection, dados_sensiveis | ativo | OPCIONAL | **não** |
| `serena` | comunidade (Oraios AI (oraios/serena)) · GPL-3.0-or-later | uvx `serena-agent@1.7.0` (não pinado) | stdio | — | grátis (open source) | acesso_disco, execucao_codigo | ativo | OPCIONAL | **não** |
| `repomix` | comunidade (yamadashy (Repomix)) · MIT | npm `repomix@1.18.1` | stdio | — | grátis (open source) | acesso_disco, rede_saida | ativo | OPCIONAL | sim |
| `sourcegraph` | oficial (Sourcegraph) · n/c | remoto `https://<sua-instancia-sourcegraph>/.api/mcp` | HTTP | SRC_ACCESS_TOKEN🔑 | pago | rede_saida, dados_sensiveis, custo_externo | ativo | DESCARTADO | **não** |

### 2.2 Documentação e conhecimento (8)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `fetch` | oficial (modelcontextprotocol (servidores de referência)) · MIT | uvx `mcp-server-fetch@2026.8.18` | stdio | — | grátis (open source) | rede_saida, prompt_injection | ativo | OPCIONAL | sim |
| `deepwiki` | oficial (Cognition (Devin / DeepWiki)) · n/c | remoto `https://mcp.deepwiki.com/mcp` | HTTP | — | plano grátis | rede_saida, prompt_injection | ativo | PRÉ-INSTALADO E HABILITADO | sim |
| `context7` | oficial (Upstash) · MIT | npm `@upstash/context7-mcp@4.1.1` | stdio | CONTEXT7_API_KEY🔑 | plano grátis | rede_saida, segredos, prompt_injection | ativo | PRÉ-INSTALADO E HABILITADO | sim |
| `markitdown` | oficial (Microsoft (AutoGen team)) · MIT | uvx `markitdown-mcp@0.0.1a7` | stdio | — | grátis (open source) | acesso_disco, rede_saida, prompt_injection | ativo | OPCIONAL | sim |
| `cloudflare-docs` | oficial (Cloudflare) · Apache-2.0 | remoto `https://docs.mcp.cloudflare.com/mcp` | HTTP | — | grátis (open source) | rede_saida | ativo | PRÉ-CONFIGURADO | **não** |
| `aws-documentation-mcp` | oficial (AWS Labs) · Apache-2.0 | uvx `awslabs.aws-documentation-mcp-server@1.2.2` | stdio | AWS_DOCUMENTATION_PARTITION, FASTMCP_LOG_LEVEL | grátis (open source) | rede_saida, prompt_injection | ativo | OPCIONAL | sim |
| `notion-remoto` | oficial (Notion) · n/c | remoto `https://mcp.notion.com/mcp` | HTTP | — | não confirmado | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | PRÉ-CONFIGURADO | sim |
| `notion-local` | oficial (Notion (makenotion)) · MIT | npm `@notionhq/notion-mcp-server@2.5.2` (não pinado) | stdio | NOTION_TOKEN🔑* | plano grátis | rede_saida, segredos, dados_sensiveis, prompt_injection, escrita_remota | manutencao | OPCIONAL | **não** |

### 2.3 Web e pesquisa (5)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `exa-web-search` | oficial (Exa Labs) · MIT | remoto `https://mcp.exa.ai/mcp` | HTTP | EXA_API_KEY🔑 | plano grátis | rede_saida, prompt_injection, dados_sensiveis | ativo | PRÉ-CONFIGURADO | sim |
| `brave-search` | oficial (Brave Software) · MIT | npm `@brave/brave-search-mcp-server@2.1.4` | stdio | BRAVE_API_KEY🔑* | plano grátis | rede_saida, segredos, custo_externo, prompt_injection | ativo | PRÉ-CONFIGURADO | sim |
| `tavily` | oficial (Tavily) · MIT | npm `tavily-mcp@0.2.22` | stdio | TAVILY_API_KEY🔑*, DEFAULT_PARAMETERS | plano grátis | rede_saida, segredos, custo_externo, prompt_injection | ativo | PRÉ-CONFIGURADO | sim |
| `firecrawl` | oficial (Firecrawl) · MIT | npm `firecrawl-mcp@3.27.2` | stdio | FIRECRAWL_API_KEY🔑*, FIRECRAWL_API_URL | plano grátis | rede_saida, segredos, custo_externo, prompt_injection, escrita_remota | ativo | PRÉ-CONFIGURADO | sim |
| `mcp-server-fetch` | oficial (modelcontextprotocol) · MIT | uvx `mcp-server-fetch@2026.8.18` | stdio | — | grátis (open source) | rede_saida, prompt_injection, dados_sensiveis | ativo | OPCIONAL | sim |

### 2.4 Navegador e testes (4)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `playwright-mcp` | oficial (Microsoft) · Apache-2.0 | npm `@playwright/mcp@0.0.83` | stdio | — | grátis (open source) | execucao_codigo, rede_saida, prompt_injection, dados_sensiveis, segredos, acesso_disco, escrita_remota | ativo | PRÉ-CONFIGURADO | sim |
| `chrome-devtools-mcp` | oficial (Google (ChromeDevTools)) · Apache-2.0 | npm `chrome-devtools-mcp@1.10.1` | stdio | CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS, CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS | grátis (open source) | execucao_codigo, rede_saida, prompt_injection, dados_sensiveis, segredos, acesso_disco | ativo | PRÉ-CONFIGURADO | sim |
| `puppeteer-mcp-archived` | oficial (modelcontextprotocol) · MIT | npm `@modelcontextprotocol/server-puppeteer@2025.5.12` | stdio | — | grátis (open source) | execucao_codigo, rede_saida, prompt_injection | arquivado (arquivado) | DESCARTADO | sim |
| `selenium-mcp` | comunidade (Angie Jones (angiejones)) · MIT | npm `@angiejones/mcp-selenium@0.2.3` | stdio | — | grátis (open source) | execucao_codigo, rede_saida, prompt_injection, dados_sensiveis, acesso_disco | manutencao | OPCIONAL | sim |

### 2.5 Bancos de dados (12)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `postgres-mcp-pro` | comunidade (Crystal DBA) · MIT | uvx `postgres-mcp@0.3.0` | stdio | DATABASE_URI🔑* | grátis (open source) | segredos, dados_sensiveis, rede_saida, prompt_injection, escrita_remota | ativo | OPCIONAL | sim |
| `mcp-toolbox-databases` | oficial (Google (googleapis)) · Apache-2.0 | npm `@toolbox-sdk/server@1.13.1` (não pinado) | stdio | POSTGRES_HOST*, POSTGRES_PORT*, POSTGRES_DATABASE*, POSTGRES_USER*, POSTGRES_PASSWORD🔑* | grátis (open source) | segredos, dados_sensiveis, rede_saida, prompt_injection, escrita_remota | ativo | OPCIONAL | **não** |
| `sqlite-mcp-server-reference` | oficial (modelcontextprotocol) · MIT | uvx `mcp-server-sqlite@2025.4.25` (não pinado) | stdio | — | grátis (open source) | acesso_disco, escrita_remota, execucao_codigo | arquivado (arquivado) | DESCARTADO | **não** |
| `sqlite-mcp-jparkerweb` | comunidade (jparkerweb) · MIT | npm `mcp-sqlite@1.0.9` (não pinado) | stdio | — | grátis (open source) | acesso_disco, escrita_remota, execucao_codigo | ativo | OPCIONAL | **não** |
| `postgres-mcp-reference` | oficial (modelcontextprotocol) · MIT | npm `@modelcontextprotocol/server-postgres` (não pinado) | stdio | DATABASE_URL🔑* | grátis (open source) | segredos, dados_sensiveis | arquivado (arquivado) | DESCARTADO | **não** |
| `mysql-mcp-benborla` | comunidade (benborla) · MIT | npm `@benborla29/mcp-server-mysql@2.0.9` (não pinado) | stdio | MYSQL_HOST*, MYSQL_PORT, MYSQL_USER*, MYSQL_PASS🔑*, MYSQL_DB, ALLOW_INSERT_OPERATION, ALLOW_UPDATE_OPERATION, ALLOW_DELETE_OPERATION | grátis (open source) | segredos, dados_sensiveis, prompt_injection, escrita_remota | ativo | OPCIONAL | **não** |
| `supabase-mcp` | oficial (Supabase) · Apache-2.0 | remoto `https://mcp.supabase.com/mcp?project_ref={{VAR:SUPABASE_PROJECT_REF}}&read_only=true&features=database,docs` | HTTP | SUPABASE_PROJECT_REF*, SUPABASE_ACCESS_TOKEN🔑 | plano grátis | dados_sensiveis, escrita_remota, prompt_injection, segredos, custo_externo | ativo | PRÉ-CONFIGURADO | sim |
| `neon-mcp` | oficial (Neon (Databricks)) · MIT | remoto `https://mcp.neon.tech/mcp?readonly=true` | HTTP | NEON_API_KEY🔑 | plano grátis | dados_sensiveis, escrita_remota, prompt_injection, segredos, custo_externo | ativo | PRÉ-CONFIGURADO | sim |
| `mongodb-mcp` | oficial (MongoDB) · Apache-2.0 | npm `mongodb-mcp-server@3.0.4` | stdio | MDB_MCP_CONNECTION_STRING🔑, MDB_MCP_API_CLIENT_ID, MDB_MCP_API_CLIENT_SECRET🔑, MDB_MCP_READ_ONLY | grátis (open source) | dados_sensiveis, escrita_remota, segredos, prompt_injection, custo_externo | ativo | PRÉ-CONFIGURADO | sim |
| `redis-mcp` | oficial (Redis) · MIT | uvx `redis-mcp-server@0.5.1` | stdio | REDIS_URL🔑, REDIS_HOST, REDIS_PORT, REDIS_USERNAME, REDIS_PWD🔑, REDIS_SSL | grátis (open source) | dados_sensiveis, escrita_remota, segredos | ativo | OPCIONAL | sim |
| `qdrant-mcp` | oficial (Qdrant) · Apache-2.0 | uvx `mcp-server-qdrant@0.8.1` | stdio | QDRANT_URL, QDRANT_API_KEY🔑, QDRANT_LOCAL_PATH, COLLECTION_NAME, EMBEDDING_MODEL, QDRANT_READ_ONLY | grátis (open source) | rede_saida, escrita_remota, dados_sensiveis, segredos | ativo | OPCIONAL | sim |
| `chroma-mcp` | oficial (Chroma) · Apache-2.0 | uvx `chroma-mcp@0.2.6` | stdio | CHROMA_API_KEY🔑, CHROMA_CLIENT_TYPE, CHROMA_DATA_DIR, CHROMA_TENANT, CHROMA_DATABASE, CHROMA_HOST | grátis (open source) | acesso_disco, escrita_remota, segredos | manutencao | OPCIONAL | sim |

### 2.6 Nuvem e infraestrutura (12)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `cloudflare-code-mode` | oficial (Cloudflare) · Apache-2.0 | remoto `https://mcp.cloudflare.com/mcp` | HTTP | CLOUDFLARE_API_TOKEN🔑 | plano grátis | rede_saida, escrita_remota, segredos, dados_sensiveis, execucao_codigo, prompt_injection | ativo | PRÉ-CONFIGURADO | sim |
| `vercel-mcp` | oficial (Vercel) · n/c | remoto `https://mcp.vercel.com` | HTTP | — | plano grátis | escrita_remota, dados_sensiveis, custo_externo, prompt_injection, rede_saida | ativo | OPCIONAL | **não** |
| `docker-mcp-gateway` | oficial (Docker) · MIT | binario `` (não pinado) | stdio | — | grátis (open source) | execucao_codigo, segredos, acesso_disco, rede_saida | ativo | OPCIONAL | **não** |
| `docker-hub-mcp` | oficial (Docker) · Apache-2.0 | docker `mcp/dockerhub` (não pinado) | stdio | HUB_PAT_TOKEN🔑 | plano grátis | segredos, rede_saida, execucao_codigo | ativo | OPCIONAL | **não** |
| `kubernetes-mcp-server` | comunidade (containers (Red Hat / comunidade)) · Apache-2.0 | npm `kubernetes-mcp-server@0.0.67` (não pinado) | stdio | KUBECONFIG | grátis (open source) | segredos, escrita_remota, execucao_codigo, dados_sensiveis, rede_saida | ativo | OPCIONAL | **não** |
| `kubernetes-mcp-server-flux159` | comunidade (Flux159) · MIT | npm `mcp-server-kubernetes@4.1.8` (não pinado) | stdio | ALLOW_ONLY_READONLY_TOOLS, ALLOW_ONLY_NON_DESTRUCTIVE_TOOLS, KUBECONFIG | grátis (open source) | segredos, escrita_remota, execucao_codigo, dados_sensiveis | ativo | OPCIONAL | **não** |
| `terraform-mcp-server` | oficial (HashiCorp) · MPL-2.0 | docker `hashicorp/terraform-mcp-server@1.3.0` (não pinado) | stdio | TFE_TOKEN🔑, TFE_ADDRESS, ENABLE_TF_OPERATIONS | grátis (open source) | rede_saida, segredos, escrita_remota, execucao_codigo | ativo | OPCIONAL | **não** |
| `aws-iac-mcp` | oficial (AWS Labs) · Apache-2.0 | uvx `awslabs.aws-iac-mcp-server@1.0.26` (não pinado) | stdio | AWS_PROFILE, FASTMCP_LOG_LEVEL | grátis (open source) | segredos, rede_saida, dados_sensiveis | ativo | OPCIONAL | **não** |
| `aws-mcp-server-gerenciado` | oficial (AWS) · n/c | uvx `mcp-proxy-for-aws` (não pinado) | HTTP | AWS_PROFILE | não confirmado | segredos, escrita_remota, dados_sensiveis, custo_externo, rede_saida | ativo | OPCIONAL | **não** |
| `aws-cdk-mcp-server` | oficial (AWS Labs) · Apache-2.0 | uvx `awslabs.cdk-mcp-server@1.0.15` (não pinado) | stdio | — | grátis (open source) | rede_saida | manutencao | DESCARTADO | **não** |
| `gcloud-mcp` | oficial (Google (googleapis)) · Apache-2.0 | npm `@google-cloud/gcloud-mcp@0.5.3` | stdio | GCLOUD_MCP_CONFIG | plano grátis | segredos, escrita_remota, execucao_codigo, dados_sensiveis, custo_externo | ativo | OPCIONAL | sim |
| `azure-mcp-server` | oficial (Microsoft) · MIT | npm `@azure/mcp@3.0.0-beta.48` (não pinado) | stdio | AZURE_TENANT_ID | plano grátis | segredos, escrita_remota, dados_sensiveis, custo_externo, rede_saida | ativo | OPCIONAL | **não** |

### 2.7 Observabilidade e qualidade (7)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `sentry-remoto` | oficial (Sentry (getsentry)) · FSL-1.1-ALv2 | remoto `https://mcp.sentry.dev/mcp` | HTTP | — | plano grátis | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | PRÉ-CONFIGURADO | sim |
| `sentry-stdio` | oficial (Sentry (getsentry)) · FSL-1.1-ALv2 | npm `@sentry/mcp-server@0.42.0` | stdio | SENTRY_ACCESS_TOKEN🔑*, SENTRY_HOST | plano grátis | rede_saida, segredos, dados_sensiveis, prompt_injection, escrita_remota | ativo | OPCIONAL | sim |
| `datadog-remoto` | oficial (Datadog (datadog-labs)) · MIT | remoto `https://mcp.datadoghq.com/v1/mcp` | HTTP | DD_API_KEY🔑, DD_APPLICATION_KEY🔑 | pago | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | OPCIONAL | **não** |
| `semgrep` | oficial (Semgrep) · LGPL-2.1-or-later | binario `semgrep@1.178.0` (não pinado) | stdio | SEMGREP_APP_TOKEN🔑 | grátis (open source) | acesso_disco, execucao_codigo, rede_saida | ativo | OPCIONAL | **não** |
| `semgrep-mcp-standalone` | oficial (Semgrep) · MIT | uvx `semgrep-mcp@0.9.0` | stdio | — | grátis (open source) | acesso_disco, execucao_codigo | arquivado (arquivado) | DESCARTADO | sim |
| `sonarqube` | oficial (SonarSource) · n/c | docker `sonarsource/sonarqube-mcp@1.28.0.4397` (não pinado) | stdio | SONARQUBE_TOKEN🔑*, SONARQUBE_ORG, SONARQUBE_URL | plano grátis | rede_saida, segredos, dados_sensiveis, execucao_codigo | ativo | OPCIONAL | **não** |
| `eslint` | oficial (ESLint) · Apache-2.0 | npm `@eslint/mcp@0.3.13` | stdio | — | grátis (open source) | acesso_disco, execucao_codigo | ativo | OPCIONAL | sim |

### 2.8 Gestão e comunicação (7)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `linear-remoto` | oficial (Linear) · n/c | remoto `https://mcp.linear.app/mcp` | HTTP | — | não confirmado | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | PRÉ-CONFIGURADO | sim |
| `atlassian-rovo` | oficial (Atlassian) · n/c | remoto `https://mcp.atlassian.com/v2/mcp` | HTTP | — | não confirmado | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | PRÉ-CONFIGURADO | sim |
| `slack-oficial` | oficial (Slack (Salesforce)) · n/c | remoto `https://mcp.slack.com/mcp` | HTTP | — | não confirmado | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | OPCIONAL | **não** |
| `slack-korotovsky` | comunidade (korotovsky) · MIT | npm `slack-mcp-server@1.3.0` (não pinado) | stdio | SLACK_MCP_XOXP_TOKEN🔑* | grátis (open source) | rede_saida, segredos, dados_sensiveis, prompt_injection, escrita_remota | ativo | OPCIONAL | **não** |
| `slack-modelcontextprotocol` | oficial (modelcontextprotocol) · MIT | npm `@modelcontextprotocol/server-slack@2025.4.25` (não pinado) | stdio | SLACK_BOT_TOKEN🔑*, SLACK_TEAM_ID* | grátis (open source) | segredos, escrita_remota | arquivado (arquivado) | DESCARTADO | **não** |
| `figma-remoto` | oficial (Figma) · n/c | remoto `https://mcp.figma.com/mcp` | HTTP | — | não confirmado | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | OPCIONAL | **não** |
| `asana-remoto` | oficial (Asana) · n/c | remoto `https://mcp.asana.com/v2/mcp` | HTTP | — | não confirmado | rede_saida, dados_sensiveis, prompt_injection, escrita_remota | ativo | OPCIONAL | sim |

### 2.9 Raciocínio e memória (3)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `sequential-thinking` | oficial (modelcontextprotocol (servidores de referência)) · MIT AND Apache-2.0 | npm `@modelcontextprotocol/server-sequential-thinking@2026.8.31` | stdio | DISABLE_THOUGHT_LOGGING | grátis (open source) | — | ativo | PRÉ-INSTALADO E HABILITADO | sim |
| `memory` | oficial (modelcontextprotocol (servidores de referência)) · MIT AND Apache-2.0 | npm `@modelcontextprotocol/server-memory@2026.8.31` | stdio | MEMORY_FILE_PATH | grátis (open source) | acesso_disco, dados_sensiveis, prompt_injection | ativo | OPCIONAL | sim |
| `time` | oficial (modelcontextprotocol (servidores de referência)) · MIT | uvx `mcp-server-time@2026.8.18` | stdio | — | grátis (open source) | — | ativo | OPCIONAL | sim |

### 2.10 Execução e sandbox (3)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `e2b` | oficial (E2B) · Apache-2.0 | npm `@e2b/mcp-server@0.2.3` (não pinado) | stdio | E2B_API_KEY🔑* | não confirmado | execucao_codigo, rede_saida, segredos, custo_externo | arquivado (arquivado) | DESCARTADO | **não** |
| `desktop-commander` | comunidade (wonderwhy-er (Desktop Commander MCP)) · MIT | npm `@wonderwhy-er/desktop-commander@0.2.52` | stdio | — | grátis (open source) | execucao_codigo, acesso_disco, rede_saida, dados_sensiveis | ativo | OPCIONAL | sim |
| `mcp-shell-server` | comunidade (tumf (tumf/mcp-shell-server)) · MIT | uvx `mcp-shell-server@1.1.12` (não pinado) | stdio | ALLOW_COMMANDS* | grátis (open source) | execucao_codigo, acesso_disco, rede_saida | ativo | OPCIONAL | **não** |

### 2.11 Pagamentos e APIs (5)

| id | Mantenedor · licença | Instalação (pino) | Transp. | Variáveis | Custo | Riscos | Manutenção | Classe | Conf. |
|---|---|---|---|---|---|---|---|---|---|
| `stripe-remoto` | oficial (Stripe) · n/c | remoto `https://mcp.stripe.com` | HTTP | AGENT_API_KEY🔑 | plano grátis | rede_saida, dados_sensiveis, escrita_remota, custo_externo, prompt_injection | ativo | PRÉ-CONFIGURADO | sim |
| `stripe-npm` | oficial (Stripe) · MIT | npm `@stripe/mcp@0.3.3` (não pinado) | stdio | STRIPE_SECRET_KEY🔑* | plano grátis | segredos, rede_saida, dados_sensiveis, escrita_remota, custo_externo | manutencao | OPCIONAL | **não** |
| `openapi-ivotoby` | comunidade (ivo-toby) · MIT | npm `@ivotoby/openapi-mcp-server@1.16.1` | stdio | API_BASE_URL*, OPENAPI_SPEC_PATH*, API_HEADERS🔑 | grátis (open source) | rede_saida, segredos, escrita_remota, prompt_injection | ativo | OPCIONAL | sim |
| `postman-remoto` | oficial (Postman) · Apache-2.0 | remoto `https://mcp.postman.com/minimal` | HTTP | POSTMAN_API_KEY🔑 | não confirmado | rede_saida, dados_sensiveis, escrita_remota | ativo | PRÉ-CONFIGURADO | sim |
| `postman-npm` | oficial (Postman) · Apache-2.0 | npm `@postman/postman-mcp-server@2.13.0` (não pinado) | stdio | POSTMAN_API_KEY🔑* | não confirmado | segredos, rede_saida, dados_sensiveis, escrita_remota | ativo | OPCIONAL | **não** |

### 2.12 Classificação — o que cada classe significa e os destaques

- **PRÉ-INSTALADO E HABILITADO (3):** `context7` (`@upstash/context7-mcp@4.1.1`, MIT, Node ≥ 20.18.1, tools `resolve-library-id` e `query-docs`; `CONTEXT7_API_KEY` **opcional** — o código lê da
  variável de ambiente, preferível a `--api-key` por não expor o segredo em argv), `deepwiki` (`https://mcp.deepwiki.com/mcp`, sem autenticação, tools `read_wiki_structure`, `read_wiki_contents`, `ask_question`;
  a doc marca o transporte SSE `/sse` como descontinuado), `sequential-thinking` (`@modelcontextprotocol/server-sequential-thinking@2026.8.31`, tool `sequential_thinking`, sem disco/rede).
  "Habilitado" ≠ "instalado" (a Fase 7B baixa sob demanda, com um clique). Fonte: `registry.npmjs.org/<pacote>/latest`, READMEs oficiais, consulta 2026-09-30.
- **PRÉ-CONFIGURADO (18):** `github` (binário oficial `github/github-mcp-server@1.12.2`, MIT, `GITHUB_PERSONAL_ACCESS_TOKEN`, modo `--read-only` por padrão no seed; sha256 por plataforma lido dos *digests* dos assets do release),
  `exa-web-search` (remoto anônimo com limite de taxa não publicado), `brave-search` (`@brave/brave-search-mcp-server@2.1.4`, `BRAVE_API_KEY`; o plano grátis atual **não foi confirmado** na página oficial — só em terceiros),
  `tavily` (1 000 créditos/mês grátis), `firecrawl` (Node ≥ 22), `playwright-mcp` (`@playwright/mcp@0.0.83`, Apache-2.0, Microsoft), `chrome-devtools-mcp` (`1.10.1`, Apache-2.0, Google; args `--headless --isolated --no-usage-statistics`),
  `supabase-mcp` e `neon-mcp` (remotos OAuth; `read_only=true`/`readonly=true`), `mongodb-mcp` (`--readOnly`), `cloudflare-code-mode` e `cloudflare-docs`, `sentry-remoto` (FSL-1.1-ALv2, plano Developer grátis),
  `linear-remoto`, `atlassian-rovo`, `notion-remoto`, `stripe-remoto`, `postman-remoto` (todos remotos com OAuth feito pela própria CLI).
- **OPCIONAL/COMUNIDADE (45):** redundantes com as CLIs (Filesystem, Git, Fetch, Memory, Time), nicho (AWS, Kubernetes, Terraform, Azure, GCP, Docker, Qdrant, Chroma, Redis, MySQL…), risco médio/alto
  (Desktop Commander — **não é sandbox** e envia telemetria por padrão; shell com allowlist), exigem plano pago ou conta corporativa (Datadog, SonarQube, Sentry stdio), ou só aceitam clientes aprovados pelo vendor
  (Vercel, Figma, Slack oficial) — risco de **não funcionar** a partir do ExpxV.
- **DESCARTADO (8):** `puppeteer-mcp-archived`, `sqlite-mcp-server-reference`, `postgres-mcp-reference` (referências **arquivadas**; o SQLite arquivado tem injeção de SQL citada por terceiros — **não confirmada** aqui),
  `slack-modelcontextprotocol` (npm deprecado), `semgrep-mcp-standalone` (repo arquivado; usar `semgrep mcp`), `aws-cdk-mcp-server` (pasta removida do `awslabs/mcp`; o AWS IaC cobre CDK),
  `e2b` (repositório e npm arquivados), `sourcegraph` (só Enterprise; pacote npm citado **não existe**).
- **Licenças que exigem atenção:** `serena` (repo **GPL-3.0-or-later** × PyPI "MIT" — usei a do repositório; **não embarcar**, só instalar por escolha do usuário, e tratar como "uso como processo externo"), `sentry-*`
  (FSL-1.1-ALv2: *source-available*, não OSI), `sonarqube` (SONAR Source-Available License, sem SPDX), `terraform-mcp-server` (MPL-2.0), `semgrep` (LGPL-2.1-or-later). Instalar na máquina do usuário por clique **não redistribui** o código; ainda
  assim o app **não empacota** nenhum desses servidores.

### 2.13 O que NÃO foi confirmado (todos `confirmado:false`, não instaláveis, ou com ressalva em `observacoes`)

31 entradas não confirmadas (motivo resumido; detalhe no seed):

- `gitlab-remoto`: Para instâncias self-managed troque o host por https://<seu-gitlab>/api/v4/mcp.
- `serena`: DIVERGÊNCIA de licença: o README/LICENSE do repo declaram GPL-3.0-or-later para o aplicativo (SolidLSP em MIT), enquanto o metadado do PyPI diz MIT; usei a do repo.
- `sourcegraph`: Doc diz 'Supported on Enterprise plans'; endpoints /.api/mcp, /.api/mcp/all e /.api/mcp/deepsearch.
- `e2b`: Repo e2b-dev/mcp-server ARQUIVADO (README: 'Deprecated: no longer actively maintained'); npm marca o pacote como 'no longer supported'.
- `mcp-shell-server`: Incluído como alternativa mais segura ao shell do Desktop Commander (adicionada por mim).
- `mcp-toolbox-databases`: Repositório renomeado de genai-toolbox para mcp-toolbox.
- `sqlite-mcp-server-reference`: Arquivamento do repo confirmado via API.
- `sqlite-mcp-jparkerweb`: Licença diverge: GitHub diz MIT, npm diz ISC.
- `postgres-mcp-reference`: Arquivamento confirmado (src/postgres presente em servers-archived; ausente em modelcontextprotocol/servers).
- `mysql-mcp-benborla`: Nomes das variáveis extraídos do README por grep; exemplo exato de comando não lido integralmente (npx -y @benborla29/mcp-server-mysql).
- `cloudflare-docs`: URL e tool confirmadas no README.
- `vercel-mcp`: Doc confirma URL, OAuth, Streamable HTTP e que só clientes aprovados pela Vercel conseguem conectar (o app precisa ser um cliente aceito, risco de não funcionar).
- `docker-mcp-gateway`: README confirma o plugin 'docker mcp' e perfis; o subcomando exato 'gateway run' para stdio vem do conhecimento prévio e não foi lido no README.
- `docker-hub-mcp`: HUB_PAT_TOKEN e a licença Apache-2.0 confirmados.
- `kubernetes-mcp-server`: Versão, integridade, licença e flags read_only/disable_destructive (chaves de config TOML) confirmadas.
- `kubernetes-mcp-server-flux159`: Versão, licença MIT, integridade e as variáveis de modo seguro confirmadas.
- `terraform-mcp-server`: Licença MPL-2.0, versão v1.3.0, variáveis e comando docker confirmados.
- `aws-iac-mcp`: Versão, hash, licença e variável AWS_PROFILE confirmados.
- `aws-mcp-server-gerenciado`: Comando e URL vêm do README do awslabs/mcp.
- `aws-cdk-mcp-server`: Entrada descartada: pasta src/cdk-mcp-server não existe mais em awslabs/mcp (404) e o AWS IaC MCP Server cobre CDK.
- `azure-mcp-server`: Comando 'npx -y @azure/mcp@latest server start' e flag --read-only (junto de --mode namespace\|all\|single) confirmados na doc; versão, licença e integridade confirmadas.
- `datadog-remoto`: URL varia por site Datadog (ex.: mcp.datadoghq.eu para EU); toolsets via ?toolsets=core.
- `semgrep`: Comando 'semgrep mcp' confirmado no README oficial; integridade do wheel não coletada (binário/pip nativo, instalação fora do npm); nomes das tools (exceto semgrep_scan_remote) vêm do repo standalone antigo e podem ter m
- `sonarqube`: Licença SONAR Source-Available License v1.0 (não SPDX; GitHub retorna NOASSERTION), por isso licenca_spdx=null.
- `notion-local`: Tools não coletadas (geradas a partir do OpenAPI do Notion).
- `slack-oficial`: OAuth confidencial (user token); 'only directory-published apps or internal apps may use MCP' — um app desktop genérico precisaria de um Slack app interno próprio.
- `slack-korotovsky`: Flags de transporte do binário (--transport stdio) NÃO confirmadas; verificar no README.
- `slack-modelcontextprotocol`: Deprecação confirmada no npm; localização em servers-archived e variáveis SLACK_BOT_TOKEN/SLACK_TEAM_ID NÃO verificadas nesta consulta (conhecimento prévio).
- `figma-remoto`: Doc: 'Only MCP clients listed in the Figma MCP Catalog can connect' (Claude Code, Cursor, VS Code, Codex, Xcode).
- `stripe-npm`: README também aceita STRIPE_SECRET_KEY no ambiente.
- `postman-npm`: Pacote antigo 'postman-mcp-server' (1.2.0, 2025-08) ficou para trás; use o escopado @postman/.


Ressalvas **dentro** de entradas confirmadas: Firecrawl (versão 3.27.2 marcada pelo registro em 2026-10-01T02:14Z, mais nova que a data da consulta; usei 2026-09-30), Exa (limite anônimo não publicado; `license` do pacote npm
`exa-mcp-server` vazia — MIT só no GitHub), MongoDB (npm 3.0.4 × release GitHub v2.1.2: divergência de versionamento), Supabase (flags do modo stdio), Neon/Qdrant (plano grátis não conferido), Playwright (comportamento exato sem navegador instalado),
Stripe (a doc diz que o remoto deixa de aceitar chaves sem a tag *Agent* em **31/10/2026**; efeito no pacote local não verificado), ESLint (`@eslint/mcp@0.3.13`, Node `^20.19 || ^22.13 || >=24`; nome da tool `lint-files` não confirmado).
**Planos grátis** de Linear, Atlassian, Notion, Figma, Slack, Asana e Postman: nada na documentação oficial consultada → `gratuito: nao_confirmado`.

## 3. Como cada CLI configura MCP

Confirmado **localmente** (somente `--help`, em 2026-09-30): Claude Code **2.1.286**, Codex **0.157.1**, OpenCode **1.18.33**. **Gemini CLI não está instalado nesta máquina** (`gemini: not found`): tudo dele vem da documentação.

### 3.1 Claude Code (`code.claude.com/docs/en/mcp`, `claude mcp --help`, `claude --help`)

- **Escopos:** `local` (padrão; `~/.claude.json` → `projects["<caminho>"].mcpServers`), `project` (`.mcp.json` na raiz, versionável), `user` (`~/.claude.json` → `mcpServers`). Precedência: local > project > user > plugin > claude.ai > gerenciado; campos **não** são fundidos entre escopos.
- **CLI (confirmado no `--help`):** `claude mcp add [-s local|user|project] [-t stdio|sse|http] [-e K=V…] [-H "K: V"…] [--client-id] [--client-secret] [--callback-port] <nome> <comandoOuUrl> [args…]`, `add-json <nome> <json>`, `get`, `list`, `remove`,
  `add-from-claude-desktop`, `login`.
- **Formato (`.mcp.json` / `--mcp-config`):** `{"mcpServers":{"<nome>":{"type":"stdio","command":"…","args":[…],"env":{…}}}}` e `{"type":"http"|"sse","url":"…","headers":{…},"oauth":{…},"headersHelper":"…"}`. **Um `url` sem `type` é lido como stdio (erro comum).**
  Expansão `${VAR}` e `${VAR:-padrão}` em `command`, `args`, `env`, `url`, `headers`; variáveis de **credencial** (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*KEY*`, `*AUTH*`) são lidas como **vazias** em certos contextos (doc).
- **Por Pane (caminho do app):** `--mcp-config <arquivo|json…>` **adiciona** servidores; `--strict-mcp-config` usa **só** os passados (ignora usuário/projeto/plugin) — confirmado no `--help`. O app já grava `<userData>/panes/<pane_id>/mcp.json` (0600) para o MCP próprio (D-13);
  a Loja **funde** seus servidores nesse mesmo arquivo. Em Missão deny-by-default junta-se `--strict-mcp-config` (D-44) + hook `PreToolUse` para `mcp__*`. Nomes de tool: `mcp__<servidor>__<tool>`.
- **Aprovação:** `.mcp.json` de projeto pede aprovação em sessão interativa; a doc só cita o prompt para `.mcp.json` (que `--mcp-config` evita — **não confirmado** explicitamente); o app **não** escreve `.mcp.json` no repositório (D-41).
- **Variáveis úteis:** `MCP_TIMEOUT` (inicialização), `MCP_TOOL_TIMEOUT`, `MAX_MCP_OUTPUT_TOKENS` (padrão 25 000), `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`. **Gerenciado:** `managed-mcp.json` com `allowedMcpServers`/`deniedMcpServers` (v2.1.259+) — não usado pelo app.
- **OAuth remoto:** `claude mcp login <nome>` ou `/mcp`; token fica no armazenamento da CLI (fora do app).

### 3.2 Codex (`developers.openai.com/codex/mcp` → `learn.chatgpt.com/docs/extend/mcp`, `codex mcp --help`)

- **Arquivo:** `~/.codex/config.toml`, tabelas `[mcp_servers.<nome>]`. **stdio:** `command` (obrigatório), `args`, `env`, `env_vars` (encaminha **nomes** de variáveis do ambiente do próprio Codex), `cwd`. **HTTP streamable:** `url` (obrigatório), `bearer_token_env_var`, `http_headers`,
  `env_http_headers` (cabeçalho ← nome de variável), `http_headers_helper`, `auth`. **Comuns:** `startup_timeout_sec`, `tool_timeout_sec`, `enabled`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode`
  (`auto|prompt|writes|approve`). As chaves `env_vars`, `enabled_tools`, `disabled_tools`, `startup_timeout_sec`, `tool_timeout_sec`, `bearer_token_env_var`, `env_http_headers`, `http_headers` aparecem no binário local (0.157.1) — **confirmado**.
- **CLI (confirmado no `--help`):** `codex mcp list|get|add|remove|login|logout`; `codex mcp add <nome> (--url <URL> | -- <comando…>) [--env K=V]` (`--env` só stdio).
- **Por Pane (caminho do app):** `-c chave=valor` (TOML por caminho pontilhado; confirmado no `--help`) — o app já usa `-c mcp_servers.<nome>.url=…` e `.bearer_token_env_var=…`. Para stdio: `-c mcp_servers.<n>.command="…"`, `-c 'mcp_servers.<n>.args=["…"]'`,
  `-c 'mcp_servers.<n>.env_vars=["NOME"]'`. **Não confirmado:** se o Codex repassa o ambiente inteiro aos servidores stdio por padrão (por isso a Loja usa `env_vars` explícito e o lançador quando há segredo) e se `-c` aceita tabelas aninhadas além de `env`.
- **Projeto:** `.codex/config.toml` só para projetos confiáveis (doc) — **o app não escreve** nele. **OAuth:** `codex mcp login <nome>`.

### 3.3 OpenCode (`opencode.ai/docs/mcp-servers/`, `opencode mcp --help`)

- **Arquivo:** `opencode.json` (`~/.config/opencode/opencode.json` global; `opencode.json` do projeto), chave `mcp`: **local** `{"type":"local","command":["cmd","arg"…],"environment":{…},"enabled":true,"timeout":5000,"cwd":"…"}`; **remoto**
  `{"type":"remote","url":"…","headers":{…},"oauth":{},"enabled":true,"timeout":5000}`. Substituição `"{env:VAR}"`. `OPENCODE_CONFIG` (caminho) e **`OPENCODE_CONFIG_CONTENT`** (JSON inline) — o app já usa o segundo e funde com `combinarAmbientes`.
- **Por agente:** `tools: {"<mcp>*": false}` global e `agent.<nome>.tools: {"<mcp>*": true}` (glob `*`/`?`) — útil para a Fase 14. **CLI (confirmado):** `opencode mcp add|list|auth|logout|debug`.
- **Por Pane:** `OPENCODE_CONFIG_CONTENT` com `mcp.<nome>` (mesma via do MCP do app). Segredo em `environment` fica visível no ambiente do processo → lançador (D-132).

### 3.4 Gemini CLI (`google-gemini/gemini-cli` docs; **não instalado aqui**)

- **Arquivo:** `~/.gemini/settings.json` (usuário) e `.gemini/settings.json` (projeto), chave `mcpServers.<nome>`: `command`/`args`/`env`/`cwd` (stdio), `url` (SSE) ou `httpUrl` (HTTP streamable), `headers`, `timeout` (padrão 600 000 ms), `trust`, `includeTools`, `excludeTools`;
  global `mcp.allowed`/`mcp.excluded`. Expansão `$VAR`/`${VAR}`. O ambiente do host tem variáveis `*TOKEN*/*SECRET*/*KEY*…` **redigidas** por padrão (as declaradas em `env` são confiáveis).
- **CLI:** `gemini mcp add [-s user|project] [-t stdio|sse|http] [-e K=V] [-H …] <nome> <comandoOuUrl> [args…]`.
- **Por Pane:** **nenhum** mecanismo por invocação encontrado na documentação (nem variável tipo `GEMINI_CLI_SYSTEM_SETTINGS_PATH` — **não confirmado**). Escrever em `.gemini/settings.json` do repositório violaria D-41 → **sem injeção** (D-136); só "instalar na minha CLI" explícito.

### 3.5 Aider, Goose, Kilo

Não pesquisados em profundidade nesta rodada: **não confirmado** se suportam MCP nativamente e como configurar. Fora do escopo da Fase 7B (o app injeta MCP só em `claude`, `codex`, `opencode`).

### 3.6 Isolar por Pane sem poluir o global — resumo

| CLI | Mecanismo por Pane (o app já usa para o MCP próprio) | O que a Loja acrescenta | Isolamento de política (D-44) |
|---|---|---|---|
| Claude Code | `--mcp-config <arquivo 0600>` (+ `--strict-mcp-config` em Missão) | `mcpServers.ev_<id>` no mesmo arquivo | **duro** (strict + hook `mcp__*` + `permissions.deny`) |
| Codex | `-c mcp_servers.<n>.…` + variáveis no ambiente do Pane | `command`/`args`/`env_vars` ou `url` | parcial (selo) |
| OpenCode | `OPENCODE_CONFIG_CONTENT` | `mcp.ev_<id>` local/remote | parcial (selo; `tools` por agente ajuda) |
| Gemini | — | nada (só instalar na minha CLI) | nenhum |

## 4. Segurança da cadeia de suprimentos

Ameaça central: `npx -y pacote` (e `uvx pacote`) **baixa e executa código de terceiros a cada início**, sem pino, sem verificação e com o ambiente do usuário. Typosquatting e conta de mantenedor comprometida são vetores reais; o registro oficial
do MCP, inclusive, lista forks e serviços de terceiros com nomes parecidos. Controles adotados (cada um vira task/teste na Fase 7B):

1. **Pino exato.** Seed só com versão exata (inclusive calver, ex.: `2026.8.31`) e **integridade**: npm `dist.integrity` (sha512), PyPI sha256 do wheel, binário sha256 por plataforma. `@latest`, `^`, `~` e `npx -y` são rejeitados pelo validador. Atualizar é **ação explícita** com novo consentimento (D-131).
2. **Assinatura do registro npm.** O registro publica assinaturas ECDSA P-256 em `dist.signatures` e as chaves em `https://registry.npmjs.org/-/npm/v1/keys` (confirmado em 2026-09-30: `context7` 4.1.1 tem 2 assinaturas; uma das chaves já expirou — chave expirada é recusada).
   O app verifica com `crypto.verify` (sem instalar nada). **Atestados de proveniência** (`/-/npm/v1/attestations/…`) deram "Not found" para o pacote testado → **não dá para exigir proveniência**; PyPI: `provenance` nulo no `mcp-server-git` (e `/integrity/` 404) → idem.
3. **Instalação isolada.** `<userData>/mcp/<id>/` com `npm ci --ignore-scripts --omit=dev --no-audit --no-fund --prefix …` (lock curado: nível `forte`) ou `npm install … --save-exact` (nível `padrao`); cache/HOME/TMPDIR dentro da pasta temporária; `npm_config_userconfig` vazio;
   sem `sudo`, sem `-g`, sem tocar `PATH`/`~/.npmrc`/`~/.npm`. PyPI: `uv venv` + `uv pip install --require-hashes` (nunca `uv tool install` global). `--ignore-scripts` impede `postinstall` (pacotes que precisam de script aparecem com `scripts_permitidos`).
   Pré-requisito: `npm` (nesta máquina: 10.9.9, Node 22.23.3), `uv` (0.10.12) — o app **diagnostica** e orienta; **não** empacota o npm (pendência P-130).
4. **Mostrar o comando completo e as permissões antes de instalar**, com `comando_hash` (executável+args+nomes de env+hosts) gravado no consentimento; mudou o hash ⇒ novo consentimento. **Consentimento por instalação e por versão**; nenhum agente instala.
5. **Rodar sem herdar o ambiente inteiro:** allowlist (`PATH`, `HOME`, `LANG`, `TMPDIR`/`TEMP`, `SystemRoot` no Windows…) + variáveis declaradas. Servidor com segredo passa pelo lançador `mcp-run` (segredo por loopback); o filho não recebe o token do Pane.
6. **Sandbox/permissões:** não há sandbox portátil confiável para processos stdio; mitigações: pasta isolada, `--read-only`/`readonly` quando existir (GitHub `--read-only`, Supabase `read_only=true`, Neon `readonly=true`, MongoDB `--readOnly`, Qdrant `QDRANT_READ_ONLY`, MySQL somente-leitura por padrão, Azure `--read-only`,
   Kubernetes `read_only`/`disable_destructive`), escopos OAuth mínimos, e `deny-by-default` por agente. macOS `sandbox-exec` e Windows: **não confirmados** como caminho (o Bench usa `sandbox-exec`, D-67; aplicar a servidores MCP é pendência P-134).
7. **Lista de bloqueio** versionada no app (`resources/mcp/bloqueio.json`) consultada em instalar/atualizar/**habilitar**; entrada `descartado` nunca instala. Falha ao ler a lista **falha fechada**.
8. **Rede:** instalar exige rede e é **clique** (nunca segundo plano, nunca boot); `registry.npmjs.org`/`pypi.org`/`github.com/<dono>/<repo>/releases` são os únicos hosts de instalação, exibidos no consentimento. Servidores remotos exibem o host. Sem telemetria do app (D-25);
   alguns servidores têm telemetria própria (Desktop Commander; Chrome DevTools: `--no-usage-statistics`), anotada no risco.
9. **Prompt injection:** conteúdo de ferramentas (páginas, docs, issues, resultados de banco) é dado de terceiros; servidores que leem a web ou escrevem em sistemas externos nunca entram no Kit; descrições de tools são saneadas antes de aparecer na UI.
10. **Segredos:** `safeStorage` (D-64), nunca em argv/JSON/log/evento; valor não volta ao renderer. **Risco residual (P-132):** remoto com chave em cabeçalho no arquivo temporário 0600 (Claude/OpenCode) e na env do Pane (Codex `env_http_headers`).

## 5. Achados que moldaram o plano

- Servidores de referência foram **arquivados ou movidos** (GitHub, GitLab, Postgres, SQLite, Redis, Puppeteer, Slack, Sentry, Brave): copiar receitas antigas da internet instala pacotes **mortos ou vulneráveis**; por isso o seed registra `maturidade` e `arquivado`.
- Remotos com OAuth dominam gestão/observabilidade (Sentry, Linear, Atlassian, Notion, Stripe, Postman, Cloudflare, Supabase, Neon): **zero processo local**, mas o OAuth é da CLI (token fora do app) e alguns vendors só aceitam clientes aprovados (Vercel, Figma, Slack oficial).
- Pacotes de referência usam **calver** (`2026.8.31`/`2026.8.18`) — o validador de versão precisa aceitá-lo.
- A descrição das tools mudou entre versões (Context7: `get-library-docs` → `query-docs`): **nunca** codificar nomes de tool no app; ler de `tools/list` (e gravar só nome+descrição saneada).
- Serena (GPL-3.0-or-later no repo) e vários servidores de nuvem/DB têm modos somente-leitura **opcionais**: o seed usa o modo restrito quando existe (`--read-only`), e o usuário relaxa conscientemente.

## 6. Reprodução (somente leitura)

`curl -s https://registry.npmjs.org/<pacote>/latest`, `curl -s https://pypi.org/pypi/<pacote>/json`, `gh api repos/<dono>/<repo>[/releases/latest]`,
`curl -s 'https://registry.modelcontextprotocol.io/v0.1/servers?search=<q>&version=latest&limit=3'`, `claude mcp --help`, `codex mcp --help`, `opencode mcp --help`. Nenhum comando instala ou altera algo.
