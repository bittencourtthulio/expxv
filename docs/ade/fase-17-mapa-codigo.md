# Fase 17 — Mapa lógico do código (análise de projetos legados)

Pedido do dono (literal): *"o cara vai usar muito software que já tem um código legal. O sistema, até na estrutura do stackx, tem um recurso de fazer uma análise do
código: roda uma análise do sistema e monta um mapa lógico do código — mapa em grafo, em fluxo, fluxograma, não sei — para ver as dependências e tudo mais. Já existem
no GitHub várias ferramentas que fazem isso: pesquise para encontrar uma ferramenta que faz isso e, se puder embutir no sistema, ótimo; se não puder, analise como é o
código dela para trazer para cá e implementar aqui. Essa estrutura de analisar o projeto legado e montar todo o mapa lógico já alimenta toda a estrutura do stackx — já
ter todas as dependências, tudo que o legadox também precisa para enrijecer as estruturas em projetos legados."*

Base de conhecimento: `base/H-ferramentas-mapa-codigo.md` (67 entradas avaliadas — cerca de 75 ferramentas e pacotes contando os grupos —, com licença, linguagens, peso, manutenção e decisão; **medições próprias** de
viabilidade no Electron 37.10.3). Método consumidor: `base/F-metodo-expxdev.md` e os `SKILL.md`/`references` reais de `stackx` e `legadox` em `.claude/skills/`.
Prioridade alta do dono (ver `PILOTO-AUTOMATICO.md`, item 5 da fila); implementar **depois** das fases 14, 9, 15 e 16 (a 15 fornece o canvas de grafo e consome o mapa).

**Portão da fase** (todos, nesta ordem):
1. `npm run verificar` verde (typecheck + unidade + marca + orçamentos estáticos, incluindo P-245 e P-248 desta fase).
2. **Fixtures por linguagem** (`tests/fixtures/mapa/<linguagem>/`, Onda 1 e 2) com gabarito `esperado.json`: todas as suítes de extrator e resolvedor verdes.
3. **Teste contra o próprio ExpxDev** (T-17.43): resolução de imports concorda ≥ 95% com o compilador TypeScript (oráculo só de teste); ≥ 500 arquivos; raio de arquivos
   conhecidos coerente com a busca textual; `docs/**` do repositório **idêntico** antes e depois.
4. `npm run perf`: **P-240 a P-252 verdes**; P-01, P-08 e P-12 sem piorar; `docs/ade/perf/ultimo.json` gravado.
5. E2E no Electron real (T-17.45): abrir workspace de fixture → Analisar → grafo → fluxo → exportar → disparar `/expx:stackx-detectar` num Pane de CLI falsa; o texto digitado
   é o esperado; **nenhum arquivo criado ou alterado em `docs/**`**.
6. `npm run test:pacote`: o app **empacotado** carrega todas as gramáticas e analisa uma fixture (prova do `asarUnpack` + `worker_threads`).
7. Auditoria de segurança (T-17.45, `docs/ade/AUDITORIA-MAPA.md`): nenhum código do projeto analisado executado (teste "canário"), nenhuma leitura de `.env`/chaves, nenhum
   symlink fora da raiz seguido, zero rede, zero processo órfão. Sem achado ALTA aberto.

---

## 1. Objetivo e valor

O desenvolvedor que recebe (ou herda) um sistema com anos de mercado precisa de três respostas **rápidas e verificáveis**: *como isso está organizado?* (entender), *se eu mexer
aqui, o que quebra?* (medir risco) e *por onde começo sem estragar?* (planejar a mudança). Hoje, quem responde é o modelo de IA lendo arquivo por arquivo: caro em contexto,
lento e sem garantia. A Fase 17 faz o **ADE calcular, de forma determinística e local**, o que é contável — arquivos, símbolos, dependências, chamadas, entradas, tabelas, ciclos,
camadas, churn, complexidade, testes — e entrega isso de duas formas:

1. **Para a pessoa**: tela **Mapa** (grafo interativo, fluxograma a partir de uma entrada, matriz de camadas, hotspots, entradas e dados) e exportações (Mermaid, DOT, SVG, JSON,
   CSV, relatório Markdown **fora de `docs/**`**).
2. **Para o método e os agentes**: pacote de contexto em `.expxv/mapa/<carimbo>/`, tools MCP `map_*` e disparo de `/expx:stackx-detectar`, `/expx:legadox-perfil`,
   `/expx:legadox-raio` já com o caminho do mapa. O stackx recebe **inventário FATO/EVIDÊNCIA/FORÇA** pré-calculado; o legadox recebe **sinais do raio de impacto** calculados e as
   **faixas BAIXO/MEDIO/ALTO** aplicadas com os limiares dele. As skills continuam donas dos artefatos (`docs/stack/**`, `docs/legado/**`): o ADE só observa e dispara (D-04, D-21).

Valor mensurável: o `cartografo` do stackx/legadox deixa de varrer o repositório inteiro para descobrir contagens (que o mapa já deu) e passa a **confirmar por amostragem** as
evidências `arquivo:linha`. A economia real de contexto é uma **hipótese a validar no uso** (pendência P-279); o que a fase garante e testa é o que o mapa entrega (conteúdo, tamanho
e determinismo).

## 2. Princípios (valem para as 45 tasks)

1. **Leveza e velocidade** (prioridade nº 1 do dono): análise **incremental**, em **`worker_threads`**, **nunca bloqueia a UI nem o main** (P-12); cache **por hash de arquivo**;
   nada da Fase 17 carrega no boot (P-248); 0 worker e 0 handle quando o mapa está ocioso.
2. **Nada sai da máquina** (D-23): zero rede, zero telemetria, zero upload. Licenças e versões de dependências do projeto analisado vêm de arquivos locais (somente leitura).
3. **O ADE não escreve em `docs/**` (D-04).** O armazém vive em `<userData>/mapas/<workspace_id>/mapa.db`; o que as skills precisam ler vai para `.expxv/mapa/<carimbo>/` (permitido
   pelo contrato §5; o `.gitignore` interno `*` de `.expxv/` já o protege). O ADE **dispara** as skills passando o caminho **relativo**; quem grava `CONVENCOES.md`/`PERFIL.md`/`raio/*.md`
   é a skill. A faixa de raio do ADE é **provisória** (rotulada); a aprovação de raio ALTO continua humana (D-21).
4. **Por padrão, nunca executar o código analisado** (D-162; a regra D-140 do dono diz que segurança é o PADRÃO, não o teto — por isso, mais adiante, indexadores SCIP e instalação de ferramentas existem como **opt-in com consentimento digitado**, B3/B4, fora do portão): só ler e parsear. Nenhum `npm`/`npx`/`gradle`/`mvn`/`composer`/`cmake`/`make`/script do projeto; configs em JS (`.dependency-cruiser.js`,
   `webpack.config.js`) **não** são avaliadas. Ferramentas externas opcionais só de `PATH`/locais padrão do sistema (**nunca** de `node_modules/.bin` do projeto), com argumentos em
   lista, sem shell, timeout e teto de saída.
5. **Respeita `.gitignore`** (via `git ls-files -z -co --exclude-standard` quando há git; analisador próprio de `.gitignore` caso contrário); **limites**: 1 MB por arquivo (configurável até
   5 MB), detecção de minificado/binário/gerado, teto de 150 000 arquivos, aviso acima de 20 000; **nunca** lê `.env*`, `*.pem`, `id_rsa*`, `*.key` (regra inviolável 2 do projeto).
6. **Confiança em cada aresta** (D-164): `exata` (resolvida por regra da linguagem/manifesto/SCIP) ou `heuristica` (por nome, convenção, candidatos). Tudo que a UI, o MCP e o
   pacote mostram carrega a confiança; contagens para o raio informam **mínimo (só exatas)** e **máximo (com heurísticas)**; sinal não coletável com confiança vira **pior caso**
   declarado (regra 3 do legadox).
7. **O mapa guarda nomes e posições, não o código**: nós, assinaturas sanitizadas (literais de texto viram `"…"`), 1ª linha de comentário de documentação (≤ 160 caracteres,
   redigida), `arquivo:linha`. O código-fonte não é copiado para o banco.
8. **Reaproveitar, não duplicar**: executor de processos e observador do VCS (Fase 6), worker/cliente do método (`src/nucleo/metodo/worker.ts` como molde), `comandoDeSkill` e
   `normalizarArgumento` (Fase 4), canvas e grafo de conhecimento (Fase 15), `yaml` (já dependência). Dependência nova só as de D-160 (parser WASM), com custo registrado; **nenhuma biblioteca de grafo** (o layout e o canvas são os da Fase 15, D-165).
9. **UI compacta (D-32)**: uma linha de controles (≈ 28 px), destaque azul, sem cartões nem títulos de página; estados vazios dizem o próximo passo; D-30 e a11y herdados.
10. **Verdade em nove casas**: o que o mapa não sabe (reflexão, DI por convenção, SQL montado em runtime, rotas em banco) aparece como **limite declarado**, nunca como silêncio.

## 3. Arquitetura

```
src/nucleo/mapa/                       (puro; sem Electron; testável sem thread)
  tipos.ts  esquema.ts  contrato.ts    modelo, DDL (schema_version), interface ServicoMapa/MapaLeitura
  gramaticas.ts                        web-tree-sitter 0.27.0: init, Language por demanda, cache
  linguagens.ts  varredura.ts  gitignore.ts   tabela de linguagens, lista de arquivos, limites, hash (cache por mtime+tamanho)
  armazem.ts                           node:sqlite (WAL): lotes, migrações, consultas preparadas
  pool.ts  worker-extracao.ts          pool de worker_threads (compilado CJS, FORA do asar)
  extratores/{registro,comum,typescript,python,java,php,csharp,go,rust,ruby,cpp,generico}.ts   + consultas por linguagem
  metricas.ts  redacao.ts  manifestos.ts  toml-minimo.ts
  resolucao/{ts,python,java,csharp,php,go,ruby,rust,cpp}.ts   imports → arquivo/pacote (confiança)
  chamadas.ts                          resolução de chamadas, herança, instanciação, DI
  grafo/{memoria,ciclos,pagerank,alcance,camadas,metricas-grafo}.ts
  analises/{entradas,dados,camadas,testes,hotspots,morto,duplicacao,externas,padroes,zonas}.ts
  regras-fronteira.ts  cobertura.ts  git-historia.ts  raio.ts
  analisador.ts  incremental.ts        orquestração completa/incremental, cancelamento, eventos
  inventario.ts  perfil-provisorio.ts  pacote-contexto.ts  disparo.ts
  exportar/{mermaid,dot,svg,json,csv,markdown}.ts
  scip.ts  adaptadores/{detectar,ctags,scc,dot}.ts
  provedor-grafo.ts  servico.ts  index.ts
src/nucleo/mcp/tools/mapa.ts           map_status · map_query · map_impact · map_evidence
src/main/ipc/mapa.ts  src/main/servicos-mapa.ts     canais mapa:* (validadores estritos), ligação na onda 2 do boot
src/renderer/telas/mapa/               tela Mapa (lazy): barra, canvas, visões, painel, lista virtual, worker de layout
tests/fixtures/mapa/<linguagem>/       projetos sintéticos com esperado.json; tests/mapa/**; tests/perf/mapa.perf.ts
```

Fluxo de dados (uma análise completa):
`varredura` (lotes de 500 caminhos) → diff por hash/mtime → `pool` extrai (cada worker lê o arquivo, faz hash, parseia, roda as consultas e devolve `Extracao`) → `armazem` grava
`arquivo`+`extracao` → **resolvedores** transformam imports em arestas `importa` → `chamadas.ts` resolve chamadas/herança/instanciação → `git-historia` (processo filho) preenche
churn/autores/acoplamento → análises derivadas (ciclos, camadas, PageRank, entradas, dados, testes, hotspots…) em memória (CSR) e `analise_cache` → evento `map.updated`.
Incremental: só os arquivos cujo hash mudou são re-extraídos; só as arestas **afetadas** são recalculadas (seção T-17.21).

## 4. O modelo do mapa

### 4.1 Nós (`no`)

| Tipo | Subtipos | Id (estável, relativo à raiz) | Atributos principais |
|---|---|---|---|
| `arquivo` | — | `arq:<caminho>` | linguagem, LOC (total/código/comentário), complexidade (total/máx.), `e_teste`, `e_gerado`, `e_migracao`, churn, autores, `criado_git`, `ultima_alt`, cobertura (estimada/medida), `camada`, `ciclo_id`, `pagerank`, `modulo` |
| `modulo` | pasta, pacote, namespace, crate, projeto `.csproj` | `mod:<pasta>` | agregados (arquivos, LOC), `ca`, `ce`, instabilidade, camada |
| `simbolo` | `funcao`, `classe`, `metodo`, `interface`, `enum`, `tipo`, `constante`, `struct`, `trait` | `sim:<caminho>#<qualificado>` (`~2` em duplicata) | linha ini/fim, exportado, visibilidade, complexidade, assinatura sanitizada, decoradores, `doc` (≤ 160) |
| `entrada` | `main`, `rota`, `cli`, `job`, `handler`, `fila`, `webhook`, `evento` | `ent:<caminho>#<chave>` (ex.: `GET /users/:id`) | framework, handler (`aciona`), confiança |
| `tabela` | — | `tab:<nome_minusculo>` | definida em (migração/modelo/DDL), colunas (n) |
| `externo` | `npm`, `pip`, `composer`, `maven`, `nuget`, `go`, `cargo`, `gem`, `sistema`, `stdlib`, `builtin` | `ext:<eco>:<nome>` | versão (lock), licença (SPDX), declarado/usado, dev/prod |

### 4.2 Arestas (`aresta`)

| Tipo | De → Para | Como é obtida | Confiança típica |
|---|---|---|---|
| `importa` | arquivo → arquivo \| externo | resolvedor da linguagem (caminho, `tsconfig paths`, PSR-4, `go.mod`, pacote Java…) | `exata`; `heuristica` para C# `using`, Ruby `require` de load path, Zeitwerk, include de sistema |
| `reexporta` | arquivo → arquivo | `export … from`, `__init__`, `pub use` | `exata` |
| `chama` | símbolo → símbolo \| externo | binding de import, escopo de classe, tipo local simples, nome único, candidatos (≤ 5) | `exata` ou `heuristica` (+ `candidatos`) |
| `instancia` | símbolo → classe | `new X`, `X()`, `X.new` | idem |
| `herda` / `implementa` | classe → classe/interface | `extends`, `implements`, base list, `impl Trait for T`, `include` (Ruby) | `exata` quando resolvida; C# base list ambígua resolvida pelo índice de tipos |
| `referencia` | símbolo → símbolo | uso de tipo/constante/componente JSX sem chamada | `heuristica` por padrão |
| `aciona` | entrada → símbolo | handler declarado na rota/anotação | `exata` se resolvido, senão `heuristica` |
| `le_tabela` / `escreve_tabela` | símbolo \| arquivo → tabela | literal SQL, modelo ORM, query builder, migração | `exata` (literal estático/modelo) ou `heuristica` (interpolado) |
| `testa` | arquivo de teste → arquivo | import do teste (exata) ou convenção de nome (heurística) | idem |

Estrutural `contém` (módulo → arquivo → símbolo) **não** é aresta: é a coluna `modulo`/`arquivo_id`. Atributos de aresta: `peso` (ocorrências), `candidatos`, `fonte`
(`extracao`/`scip`/`regra`), até 5 evidências `arquivo:linha` (JSON), `linha` da primeira.

### 4.3 Atributos calculados

LOC (total/código/comentário/branco), **complexidade ciclomática** (McCabe: 1 + nós de decisão por função; tabela por linguagem, inspirada nos tokens do lizard/radon, reimplementada),
**churn** (alterações na janela e no total), **autores distintos**, **idade** (`criado_git`, `ultima_alt`), **commits de correção** (mensagem com `fix|bug|corrige|hotfix`),
**cobertura mapeada por convenção de teste** (`existente|parcial|ausente`, `estimada`; `medida` quando há lcov/Cobertura/JaCoCo/`go cover`), **ciclo** (`ciclo_id` do SCC), **camada**
(declarada por regra ou inferida), **PageRank** (importância; ideia do repo-map do aider, D-166), fan-in/fan-out/instabilidade.

### 4.4 Formato de arquivo versionado

SQLite local (`node:sqlite`, D-08), **`PRAGMA user_version` = `schema_version`** (começa em 1), WAL, transação por lote. É **cache reconstruível**: versão **maior** que a do app ou banco corrompido →
renomeia para `mapa.db.corrompido-<carimbo>` e recomeça (nunca apaga em silêncio). `Extracao` (JSON por arquivo) carrega `versao_extrator`: mudar o extrator invalida só as
extrações antigas. Intercâmbio: `mapa-export.json` (`{schema_version, nos[], arestas[], metricas}`) e CSV; **JSONL** só para `arquivos.jsonl` do pacote de contexto.

DDL (T-17.01 cria; replicar em `05-CONTRATOS.md` §1b ao implementar):

```sql
CREATE TABLE meta(chave TEXT PRIMARY KEY, valor TEXT NOT NULL);  -- versao_mapa, estado(vazio|parcial|pronto), raiz_hash, analisado_em, historia(ok|parcial|indisponivel)
CREATE TABLE arquivo(
  id INTEGER PRIMARY KEY, caminho TEXT NOT NULL UNIQUE, linguagem TEXT NOT NULL, hash TEXT NOT NULL, tamanho INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
  loc INTEGER, loc_codigo INTEGER, loc_comentario INTEGER, complexidade_total INTEGER, complexidade_max INTEGER,
  e_teste INTEGER NOT NULL DEFAULT 0, e_gerado INTEGER NOT NULL DEFAULT 0, e_migracao INTEGER NOT NULL DEFAULT 0,
  erros_parse INTEGER NOT NULL DEFAULT 0, degradado INTEGER NOT NULL DEFAULT 0, modulo TEXT NOT NULL,
  camada INTEGER, ciclo_id INTEGER, pagerank REAL,
  churn_total INTEGER, churn_janela INTEGER, autores_n INTEGER, criado_git TEXT, ultima_alt TEXT, commits_correcao INTEGER,
  cobertura_estado TEXT, cobertura_pct REAL, cobertura_fonte TEXT, analisado_em TEXT NOT NULL);
CREATE TABLE extracao(arquivo_id INTEGER PRIMARY KEY REFERENCES arquivo(id) ON DELETE CASCADE, versao_extrator INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE no(id TEXT PRIMARY KEY, tipo TEXT NOT NULL, subtipo TEXT, rotulo TEXT NOT NULL,
  arquivo_id INTEGER REFERENCES arquivo(id) ON DELETE CASCADE, linha_ini INTEGER, linha_fim INTEGER, exportado INTEGER, atributos TEXT);
CREATE TABLE aresta(id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, de TEXT NOT NULL, para TEXT NOT NULL,
  confianca TEXT NOT NULL CHECK(confianca IN ('exata','heuristica')), peso INTEGER NOT NULL DEFAULT 1, candidatos INTEGER,
  fonte TEXT NOT NULL DEFAULT 'extracao', arquivo_id INTEGER REFERENCES arquivo(id) ON DELETE CASCADE, linha INTEGER, evidencias TEXT);
CREATE INDEX no_arquivo ON no(arquivo_id); CREATE INDEX no_tipo ON no(tipo, subtipo);
CREATE INDEX aresta_de ON aresta(de, tipo); CREATE INDEX aresta_para ON aresta(para, tipo); CREATE INDEX aresta_arq ON aresta(arquivo_id);
CREATE TABLE externo(id TEXT PRIMARY KEY, ecossistema TEXT, nome TEXT, versao TEXT, declarado INTEGER, dev INTEGER, licenca TEXT, licenca_fonte TEXT);
CREATE TABLE acoplamento_temporal(a INTEGER, b INTEGER, co_alteracoes INTEGER, grau REAL, PRIMARY KEY(a,b));
CREATE TABLE regra_fronteira(id INTEGER PRIMARY KEY, origem TEXT, destino TEXT, tipo TEXT, fonte_arquivo TEXT, fonte_linha INTEGER, ferramenta TEXT);
CREATE TABLE layout_cache(chave TEXT PRIMARY KEY, nivel TEXT, posicoes BLOB, criado_em TEXT);
CREATE TABLE analise_cache(chave TEXT PRIMARY KEY, versao_mapa INTEGER, json TEXT);
CREATE TABLE execucao(id INTEGER PRIMARY KEY, tipo TEXT, iniciada_em TEXT, terminada_em TEXT, estado TEXT, arquivos_total INTEGER, arquivos_extraidos INTEGER, erros INTEGER);
```

Tipos TypeScript centrais (T-17.01): `Linguagem = "typescript"|"javascript"|"tsx"|"jsx"|"python"|"java"|"php"|"csharp"|"go"|"ruby"|"rust"|"c"|"cpp"|"outra"`;
`Confianca = "exata"|"heuristica"`; `Extracao { versao_extrator, linguagem, hash, loc, loc_codigo, loc_comentario, complexidade_total, complexidade_max, erros_parse, e_teste, e_gerado,
simbolos: SimboloBruto[], imports: ImportBruto[], chamadas: ChamadaBruta[], herancas: HerancaBruta[], entradas: EntradaBruta[], dados: AcessoDadoBruto[], padroes: PadraoBruto[],
dinamicos: DinamicoBruto[], shingles?: [number, number][] }` — cada `*Bruto` carrega `linha`; `chamadas[].de` é o qualificado do símbolo contenedor (`null` = topo do arquivo).

### 4.5 Linguagens e profundidade

| Onda | Linguagens (gramática embarcada) | Profundidade |
|---|---|---|
| **1** (legado mais comum) | TypeScript/JavaScript (+TSX/JSX), PHP, Java, C#, Python | símbolos, imports, chamadas, herança, entradas, dados, complexidade, padrões |
| **2** | Go, Ruby, Rust, C/C++ (C pela gramática `cpp`) | idem (Ruby/C++ com mais heurística) |
| **Degradado** (sem gramática: Kotlin, Swift, Scala, Dart, Perl, Delphi/Pascal, VB, COBOL, SQL…) | arquivo + LOC próprio + imports por regex configurável; símbolos via **ctags** se existir | tudo `heuristica`; banner na UI (P-270) |

## 5. As análises (todas puras sobre o grafo em memória; cacheadas em `analise_cache` por `versao_mapa`)

| Análise | Definição e saída | Task |
|---|---|---|
| Dependências e **ciclos** | SCC (Tarjan iterativo) no grafo de `importa` (e opcionalmente `chama`); lista de ciclos, tamanho, arestas de menor peso sugeridas para quebrar | T-17.20 |
| **Camadas e violações** | regras estáticas importadas (deptrac, import-linter, dependency-cruiser `.json`, Packwerk) + camadas **inferidas** (níveis da condensação do DAG de módulos) + camadas manuais; violações com `arquivo:linha`; matriz DSM | T-17.25 |
| **Fan-in/fan-out**, instabilidade, PageRank | distintos por arquivo/módulo/símbolo; `I = Ce/(Ca+Ce)` | T-17.20 |
| **Pontos de entrada e fluxos** | `entrada` por framework/arquivo; fluxo = BFS em `chama`/`instancia` até profundidade 6 (≤ 300 nós) com tabelas tocadas e externos nas folhas | T-17.23 |
| **Acesso a dados** | tabelas (literais SQL, ORMs, migrações, `schema.prisma`/`schema.rb`/DDL); "quem toca a tabela X" e "tabelas de cada entrada" | T-17.24 |
| **Código morto candidato** | fan-in 0 (exata) excluindo entradas, API pública do pacote, testes, decorados por framework, arquivos referenciados por configuração, linguagens/frameworks com dinâmicos; `confianca: alta|media|baixa`; **sempre "candidato"**, nunca "remover" (Camada 10 do legadox) | T-17.27 |
| **Hotspots** | `score = rank_pct(churn_janela) × rank_pct(complexidade_max)` (ideia de Tornhill, reimplementada); + autores, idade, commits de correção, parceiros de acoplamento temporal | T-17.22, T-17.27 |
| **Arquivos sem teste** | `testa` por import (exata) e convenção de nome (heurística) → `existente|parcial|ausente` estimado; `medida` com cobertura importada | T-17.26 |
| **Dependências externas e licenças** | declaradas × usadas, versão do lock, licença lida **localmente** (`node_modules/*/package.json`, `vendor/composer/installed.json`, `*.dist-info/METADATA`), selo de copyleft forte (informativo) | T-17.28 |
| **Duplicação grosseira** | winnowing (k = 25 tokens, janela 4) sobre tokens normalizados (identificadores e literais abstraídos); pares/classes de clones ≥ ~50 tokens; **desligada por padrão** (`mapa.duplicacao`) | T-17.27 |
| **Dialetos e padrões** | por eixo (erro, config, DI, acesso a dados, data/hora, dinheiro, idioma dos nomes, estilo de teste): contagens por pasta e por data de criação (recência) | T-17.29 |
| **Zonas de risco candidatas** | dicionário PT/EN (fiscal, folha, financeiro, autenticação, pagamento/boleto/PIX, auditoria, LGPD…) sobre caminhos, símbolos e tabelas; sempre "candidata", "quem valida: NÃO DETERMINADO" | T-17.29 |
| **Raio provisório** | os 8 sinais do legadox + faixa pelos limiares do `PERFIL.md` (se existir) ou padrão; mín./máx. e pior caso | T-17.30 |

## 6. Saídas

### 6.1 Tela Mapa (menu **Mapa**, chunk lazy; ver `04-UI-UX.md`)

**Uma linha de controles de ≈ 28 px, nunca duas** (D-32): `[● estado · 4 812 arq · há 3 min]` `[Analisar ▸ | ↻ | ⏹]` `[Grafo · Camadas · Fluxo · Hotspots · Entradas · Dados]` `[busca]`
`[Filtros ▾ (linguagem, pasta, tipo de nó, confiança, só ciclos)]` `[Agrupar ▾ (módulo · pasta · arquivo)]` `[Exportar ▾]` `[Método ▾ (stackx · legadox)]`; painel de detalhe recolhível à
direita (280 px). Destaque azul (`--destaque`) para seleção e entradas; ciclo em `--alerta`; heurística **tracejada**; cores lidas de variáveis CSS (nenhuma cor literal fora de `tokens.css`).

| Visão | O que mostra | Como (sem travar) |
|---|---|---|
| **Grafo** | nós = módulos/arquivos/símbolos conforme o zoom; arestas agregadas com espessura = peso; ciclos destacados | canvas 2D, layout de forças (Barnes-Hut) **no worker da Fase 15 (`GrafoWorker`)** semeado pela árvore de pastas, **agrupamento colapsável + LOD**, hit-test espacial; **reaproveita `GrafoCanvas`/`GrafoWorker` da Fase 15 (T-15.43)** estendendo-os (T-17.40) |
| **Camadas** | matriz DSM módulo × módulo, células de violação/ciclo realçadas, clique lista as arestas com `arquivo:linha` | canvas, rolagem virtual |
| **Fluxo** (fluxograma) | a partir de uma entrada (rota, main, job): árvore esquerda → direita de chamadas até tabelas e externos; tracejado = heurística | layout em camadas próprio (≤ 300 nós, SVG), expansão sob demanda |
| **Hotspots** | dispersão churn × complexidade + tabela ordenada | canvas + lista virtual |
| **Entradas** | lista por categoria; seleção abre o Fluxo | lista virtual (> 100 itens) |
| **Dados** | tabelas e quem as toca; entradas → tabelas | lista virtual |

### 6.2 Exportações (T-17.38)

Mermaid (`flowchart LR`/`graph LR`, ≤ 300 nós; acima disso agrupa por módulo), **DOT** (`digraph`, `rankdir=LR`, `subgraph cluster_*` por módulo), **SVG** estático próprio (cores
resolvidas do tema no momento), JSON (`mapa-export.json`), CSV (`nos.csv`, `arestas.csv`) e **relatório Markdown** (`relatorio-<carimbo>.md`). Destino: diálogo nativo do main (padrão
`<userData>/mapas/<ws>/exportacoes/`). **O main recusa qualquer destino dentro de `<raiz>/docs/`** (D-04 é absoluto; mensagem: "o ADE não escreve em docs/; escolha outra pasta"). Se o
`dot` existir no PATH, oferece "SVG via Graphviz" (adaptador opcional).

## 7. Integração com stackx e legadox

### 7.1 O que as skills esperam e o que o mapa entrega

**stackx** (`cartografo`, Etapa 1 → inventário `FATO / EVIDÊNCIA / FORÇA` com `UNÂNIME | MAJORITÁRIO n/m | CONFLITO | ÚNICO CASO | AUSENTE`; regra de evidência `arquivo:linha`; PROPOSTA ≠ convenção):

| Pergunta do stackx | O que o mapa calcula (`inventario-stackx.json`) | Evidência |
|---|---|---|
| Onde o teste mora (co-localizado × pasta própria) e como se chama (`x.test.ts`, `test_x.py`, `XTest.java`…) | contagem dos dois grupos, formas de nome, testes **mortos** (não casados pelo padrão do runner quando a config é estática) | até 5 `arquivo:linha` por grupo |
| Runner, fixture/factory/mock | imports nos testes (jest/vitest/pytest/junit/xunit/phpunit/rspec/`testing`…), uso de `fixture`/`factory`/`mock` | linhas |
| Camadas e **quem pode chamar quem** | direção de dependência entre módulos com contagens + regras de fronteira **estáticas** do projeto (deptrac, import-linter, dependency-cruiser `.json`, Packwerk) = "a melhor evidência possível" (01-deteccao §2) | `arquivo:linha` da regra e de arestas |
| Como erro é sinalizado | contagens por pasta e data de criação de `throw/raise`, `try/catch` vazio, `Result/Either`, `err != nil`, `?` (Rust) | linhas |
| Como configuração é lida | `process.env`/`os.environ`/`getenv`/`ENV[...]` (**só nomes** das variáveis), arquivos de config | linhas |
| Aliases de import | `tsconfig paths`, PSR-4, `go.mod` module path | linha da config |
| Comandos reais | `scripts` do `package.json`, alvos do `Makefile`, `composer scripts`, `run:` do CI (`.github/workflows`) — **declarados**, nunca inferidos | linha do manifesto/CI |
| Dialeto mais **recente** | data do `criado_git` por dialeto (desempate de CONFLITO) | datas |

`classificarForca(n, m, minoria, recente)` aplica a regra do stackx (minoria < 10% e sem sinal de recência → MAJORITÁRIO com nota; senão CONFLITO). O mapa **não decide convenção**: entrega fatos
com contagem; o `cartografo` confirma por amostragem e escreve `CONVENCOES.md`/`LACUNAS.md`. Etapa 4 (aderência): `map_evidence {topic:"layers"}` dá a direção permitida para checar um diff.
Etapa 5 (atualização): `mudancas-desde-ultimo.json` compara o inventário atual com o do carimbo anterior (alimenta `/expx:stackx-atualizar`).

**legadox**:

| Camada | O que o mapa entrega |
|---|---|
| 1 · Perfil | `perfil-provisorio.json`: stack real (manifestos + locks), **entradas por categoria com caminho** (rotas, CLI, jobs, filas, webhooks), camadas que **existem** (e onde não são respeitadas), comandos reais, **cobertura** (medida se há relatório; senão estimativa grosseira por pasta com o método declarado — exatamente o fallback que o `01-perfil.md` prevê), **dialetos conflitantes** por eixo (acesso a dados, erro, validação, DI, data/hora, **dinheiro** `float` × `Decimal`, idioma dos nomes, estilo de teste), **zonas de risco candidatas**, suspeitas de código morto |
| 2 · Raio | os **8 sinais** (§7.3) e a faixa provisória com os limiares do `PERFIL.md` |
| 3 · Caracterização | superfície a caracterizar: símbolos exportados do alvo **sem teste** + entradas que os alcançam (fluxo), ordenados por nº de chamadores |
| 4 · Ponto de costura | candidatos: símbolos por onde **passam todos os caminhos** entrada → alvo (interseção nos caminhos mínimos) e interfaces na fronteira |
| 7 · Reversão | efeitos que o versionador não desfaz: tabelas tocadas, migrações, jobs/filas/webhooks que consomem |
| 8 · Teste manual | telas/rotas dependentes (entradas alcançáveis) e vizinhos de colateral |
| 10 · Prova de vida | in-arestas com `arquivo:linha` (chamadores reais) — e o aviso "evidência de código morto não autoriza remoção" |
| 11 · Zonas | zonas candidatas com pastas/arquivos; **"Quem valida: NÃO DETERMINADO"** (só o humano preenche) |

### 7.2 Como o ADE aciona (nunca escreve os artefatos deles)

1. **Pacote de contexto** `.expxv/mapa/<carimbo>/` (T-17.31), escrito atomicamente (pasta temporária + `rename`), mantém os 3 últimos: `RESUMO.md` (≤ 6 000 tokens estimados, P-247),
   `inventario-stackx.json`, `perfil-provisorio.json`, `entradas.json`, `arquivos.jsonl` (top por PageRank), `raio-<trabalho>.json`, `mudancas-desde-ultimo.json`. Só caminhos **relativos**.
2. **Disparo** (T-17.34, IPC `mapa:disparar`; botões em "Método ▾"): digita no Pane de CLI escolhido (Claude Code/OpenCode) via `comandoDeSkill`:
   - `/expx:stackx-detectar mapa em .expxv/mapa/<carimbo>/ — leia RESUMO.md e inventario-stackx.json antes; as contagens e evidências arquivo:linha já são determinísticas: confirme por amostragem em vez de varrer tudo; use a tool MCP map_evidence para o resto`
   - `/expx:legadox-perfil mapa em .expxv/mapa/<carimbo>/ — use perfil-provisorio.json como ponto de partida; o que o mapa marca como estimado ou candidato continua exigindo sua verificação`
   - `/expx:legadox-raio <trabalho_id> mapa em .expxv/mapa/<carimbo>/ — arquivos alvo: <lista>; raio-<trabalho_id>.json traz os 8 sinais com método declarado e a faixa provisória; a classificação final e a aprovação ALTO são suas e humanas`
   - `/expx:stackx-atualizar …` e `/expx:legadox-divida …` (esta com candidatos de código morto, hotspots e ciclos). Argumento ≤ 1 500 caracteres, uma linha (`normalizarArgumento`).
3. O ADE **observa o disco** (método, Fase 4) e mostra "aguardando `docs/stack/CONVENCOES.md`"; nunca supõe sucesso pelo texto do terminal e nunca escreve em `docs/**`.
4. **Tools MCP** (T-17.32, somente leitura, `map_*`): o agente consulta sob demanda em vez de ler arquivos.
5. **Perfil provisório na UI** (T-17.42): zonas candidatas, raio por arquivo, dívida candidata (ciclos, mortos, hotspots) — **só para a pessoa revisar** ("não é o PERFIL.md").

### 7.3 Raio de impacto provisório (T-17.30) — fiel ao `02-raio-de-impacto.md`

| Sinal do legadox | Como o mapa calcula | Método declarado no JSON |
|---|---|---|
| 1 Chamadores | **arquivos distintos** (não ocorrências), excluindo testes e o próprio alvo, diretos + **um nível indireto** acima, parando em ponto de entrada (D-168); informa `min` (só exatas) e `max` (com heurísticas) e o alcance transitivo | "grafo de chamadas Tree-sitter v<extrator>; consulta `map_impact`" |
| 2 Telas e rotas | entradas alcançáveis para cima a partir dos chamadores (`rota`, componente de UI) | idem |
| 3 Consumo assíncrono | entradas `job/fila/webhook/cli` alcançáveis; relatórios/exportações por nome de tabela lida | idem |
| 4 Cobertura | `existente|parcial|ausente` (só `existente` conta para BAIXO); `medida` se há relatório | convenção de teste/relatório + data |
| 5 Zona de risco | zonas **declaradas** no `docs/legado/PERFIL.md` (leitura tolerante; se ausente, usa as candidatas e marca `candidata`); casa por pasta **e** por tabela/arquivo lido | "PERFIL.md §Zonas" ou "dicionário v1" |
| 6 Churn e idade | `git log` (alterações na vida, última, criação); leitura qualitativa | comando de `git` usado |
| 7 Migração | arquivo é migração, ou toca tabela cuja definição está em migração do trabalho | detecção por pasta/DDL |
| 8 Dado histórico | **não coletável** pelo mapa → **pior caso** declarado (a pessoa/skill responde) | "pior caso: …" |

`pior_caso`: lista os sinais assumidos no pior caso e **por quê** (aresta dinâmica possível: reflexão/`eval`/`$$var`/DI por convenção/`method_missing`; sem histórico git; nome
genérico ambíguo). A faixa usa os **limiares do `PERFIL.md`** se ele existir (leitura tolerante da seção de limiares) ou o padrão do `SKILL.md` (BAIXO ≤ 3 chamadores, sem zona,
sem migração, com cobertura; MEDIO 4–15 ou cobertura ausente ou consumo por job; ALTO > 15 ou zona ou migração ou dado histórico); "na dúvida entre duas faixas vale a maior". Saída
carrega `nota: "provisório — quem classifica é o avaliador-de-raio do legadox; aprovação ALTO é humana"`.

## 8. Contratos novos (replicar em `05-CONTRATOS.md` ao implementar; T-17.01/32/33)

### 8.1 IPC `mapa:*` (lista fechada em `src/compartilhado/ipc.ts`; validador estrito por canal; o renderer **nunca** envia caminho absoluto nem `cwd`)

| Canal | Payload → resposta |
|---|---|
| `mapa:resumo` | `{workspace_id}` → `{estado, versao_mapa, analisado_em, arquivos, linguagens[{linguagem,arquivos,loc}], arestas{exata,heuristica}, historia, ferramentas{ctags,scc,dot}, desatualizado, configuracao}` |
| `mapa:analisar` | `{workspace_id, modo:"completo"\|"incremental", historia?}` → `{execucao_id}` |
| `mapa:cancelar` | `{workspace_id}` → `{ok}` |
| `mapa:apagar` | `{workspace_id, confirmacao:"APAGAR"}` → `{ok}` (apaga `mapa.db` e `.expxv/mapa/`) |
| `mapa:grafo` | `{workspace_id, nivel:"modulo"\|"arquivo"\|"simbolo", filtro, limite≤20000}` → `{nos[], arestas[], truncado}` (arrays compactos) |
| `mapa:vizinhos` | `{workspace_id, no_id, direcao, profundidade≤3, limite≤500}` |
| `mapa:no` | `{workspace_id, no_id}` → detalhe (atributos, chamadores, evidências) |
| `mapa:fluxo` | `{workspace_id, entrada_id, profundidade≤10, min_confianca}` → `{nos[], arestas[], truncado}` |
| `mapa:analise` | `{workspace_id, tipo:"ciclos"\|"camadas"\|"hotspots"\|"mortos"\|"sem_teste"\|"externas"\|"duplicacao"\|"dialetos"\|"zonas"\|"entradas"\|"dados", parametros?}` |
| `mapa:raio` | `{workspace_id, arquivos[≤50], simbolos?[]}` → `RaioProvisorio` |
| `mapa:buscar` | `{workspace_id, texto, tipos?, limite≤50}` |
| `mapa:exportar` | `{workspace_id, formato:"mermaid"\|"dot"\|"svg"\|"json"\|"csv"\|"md", vista, destino?:null}` → `{caminho}` (recusa `<raiz>/docs/**`) |
| `mapa:disparar` | `{workspace_id, acao:"stackx_detectar"\|"stackx_atualizar"\|"legadox_perfil"\|"legadox_raio"\|"legadox_divida", pane_id, trabalho_id?, arquivos?[]}` → `{comando, carimbo}` |
| `mapa:config_ler` / `mapa:config_gravar` | chaves `mapa.*` (§8.4) |
| `mapa:layout_ler` / `mapa:layout_gravar` | cache de posições `{chave, nivel, posicoes}` |
| evento `mapa:progresso` | `{execucao_id, fase:"varrendo"\|"extraindo"\|"resolvendo"\|"historia"\|"analises", feito, total}` (coalescido a 250 ms) |
| evento `mapa:mudou` | `{versao_mapa, nos_alterados_n}` |

Eventos de domínio (barramento): `map.analysis_started|progress|finished|failed`, `map.updated` (`{workspace_id, versao_mapa, nos_alterados[], nos_removidos[]}`).

### 8.2 Tools MCP (nomes em inglês `snake_case`; **somente leitura**; todos os modos `livre|squad|agentico`; resposta ≤ 32 KB com `truncated:true`; agentes **não** disparam análise)

| Tool | Entrada | Saída |
|---|---|---|
| `map_status` | — | `{state, generated_at, files, languages[], edges:{exact,heuristic}, stale, history}` |
| `map_query` | `{kind:"search"\|"neighbors"\|"callers"\|"callees"\|"dependents"\|"cycles"\|"entrypoints"\|"tables"\|"hotspots"\|"layers"\|"unused"\|"externals", target?, depth?≤5, limit?≤100, min_confidence?}` | `{items[{id,kind,label,path,line,confidence,metrics?}], truncated}` |
| `map_impact` | `{files[≤50], symbols?[≤50]}` | `RaioProvisorio` (§7.3; `signals`, `band`, `band_worst_case`, `worst_case[]`, `seam_candidates[]`, `note`) |
| `map_evidence` | `{topic:"tests"\|"layers"\|"errors"\|"config"\|"dialects"\|"entrypoints"\|"data_access"\|"commands", scope?, limit?}` | `{facts[{fact, evidence[≤5 "path:line"], strength, counts}]}` |

Erros: `unavailable` com subcode novo **`map_not_ready`** (sem análise ou em andamento); `invalid_argument` para caminho absoluto/`..`; `too_large` para resposta que não cabe mesmo truncada. Argumentos
`path` são **relativos à raiz do workspace** (vêm do token, nunca do argumento).

### 8.3 Arquivos gravados

`<userData>/mapas/<workspace_id>/{mapa.db, exportacoes/, relatorios/, camadas.json}` e, **no repositório do usuário**, só `.expxv/mapa/<carimbo>/…` e `.expxv/mapa/camadas.json` (carimbo = `YYYYMMDDTHHMMSSZ`, no máximo 3 pastas). `docs/**` **nunca**.

### 8.4 Configuração (`config`, chaves `mapa.*`)

`mapa.habilitado` (true), `mapa.auto_atualizar` (true após a 1ª análise), `mapa.arquivo_max_bytes` (1 000 000), `mapa.total_max` (150 000), `mapa.workers` (auto: 1 em segundo plano, até 3 em "Analisar agora"),
`mapa.historia.janela_dias` (730), `mapa.historia.max_commits` (20 000), `mapa.duplicacao` (false), `mapa.ignorar` (globs extras), `mapa.camadas_manual` (referência a `camadas.json`).

## 9. Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`, P-01…P-14, e aos da Fase 6, P-16…P-22; `npm run perf` falha ao estourar)

> **Numeração:** o pedido era "P-80 em diante", mas P-60…P-117 já estão ocupados por outras fases (a Fase 15 usa P-70…P-83) e P-80…P-82 são pendências da Fase 10. Estes orçamentos usam o bloco livre **P-240…P-252** (equivale a P-80…P-92 do pedido: P-240 = análise inicial … P-252 = qualidade). Decisões em **D-160…D-170**; pendências em **P-270…P-279**.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| **P-240** | Análise inicial de **5 000 arquivos TS** (≈ 25–40 MB) | **≤ 30 s** em worker; nenhuma `longtask` > 50 ms no renderer, nenhuma tarefa > 50 ms no main (P-12) durante a análise | gerador sintético determinístico (T-17.44) + monitor de event loop + `PerformanceObserver` |
| **P-241** | Atualização incremental | **≤ 200 ms por arquivo alterado** (do evento do observador, já depurado, até `mapa.db` e `map.updated`); UI refletida ≤ 600 ms (como P-11) | toque num arquivo do repo sintético + marcas |
| **P-242** | Abrir a tela Mapa | **≤ 100 ms** até o primeiro quadro (só o resumo do banco; o grafo carrega depois, lazy) | marca no clique e no 1º quadro (como P-02) |
| **P-243** | Grafo de **5 000 nós / 15 000 arestas** | **60 fps** em pan/zoom (p95 do quadro ≤ 16,7 ms; só nós visíveis desenhados; LOD/agrupamento); 1ª imagem ≤ 1 s; layout estabilizado ≤ 5 s em worker | script de pan/zoom no Electron + deltas de `requestAnimationFrame` |
| **P-244** | Memória | pico **adicional ≤ 150 MB** (main + workers) na análise inicial de 5 000 arquivos; em repouso (workers encerrados) ≤ 30 MB de grafo em memória; renderer da tela ≤ 80 MB | `process.getProcessMemoryInfo` + `/usr/bin/time -l`. Base medida: ≈ 20 MB por worker extra, 112 MB com 1 e 175 MB com 4 workers num corpus pequeno (`base/H`, §2.3) |
| **P-245** | Peso no pacote e no JS inicial | gramáticas Onda 1+2 + runtime **≤ 18 MB em disco** (≤ 1,6 MB gz no `.dmg`); JS inicial do renderer **não cresce** (P-08); chunk lazy da tela ≤ 120 KB gz; worker de layout ≤ 20 KB gz; `web-tree-sitter` e `@vscode/tree-sitter-wasm` em **versão exata** | script de tamanho no `verificar` |
| **P-246** | Consulta (`map_query`, `map_impact`, `mapa:*`) | **≤ 50 ms p95** com mapa de 5 000 arquivos; Tarjan 5 000/15 000 ≤ 30 ms; PageRank ≤ 100 ms | teste de unidade com banco real |
| **P-247** | Pacote de contexto | `RESUMO.md` **≤ 6 000 tokens** estimados (≈ 24 KB; estimador caracteres/4); `raio-*.json` ≤ 2 000 tokens; gerar o pacote ≤ 2 s | teste de unidade |
| **P-248** | Boot | **0 ms** na onda 1; registro ≤ 5 ms na onda 2; após o boot sem mapa aberto: **0 workers e 0 handles** da Fase 17; nenhum módulo de `src/nucleo/mapa` no grafo estático de imports de `main.ts` além do registro lazy | teste estático + contagem de handles |
| **P-249** | História git | janela padrão (2 anos / 20 000 commits) **≤ 3 s**; 50 000 commits ≤ 8 s; em processo filho, cancelável | repo sintético (gerador do VCS) |
| **P-250** | Reanálise sem mudanças | 5 000 arquivos **≤ 2 s** (varredura + `stat` + cache `mtime+tamanho`) | repo sintético |
| **P-251** | Exportações | Mermaid/DOT/SVG de 500 nós **≤ 300 ms**, em worker | teste de unidade |
| **P-252** | Qualidade do mapa (não é velocidade) | no ExpxDev real: ≥ 95% de concordância das arestas `importa` com o oráculo do compilador TS; ≥ 85% das arestas `importa` com confiança `exata` | T-17.43 |

## 10. Tarefas

Formato: `T-17.NN · título` — arquivos · entrega · teste · aceite · depende. Todas seguem TDD (teste antes, falhando pelo motivo certo) e `npm run verificar` verde; as de UI herdam
D-32 e os orçamentos. Caminhos relativos à raiz do repositório. **Nenhuma task escreve em `docs/**` em tempo de execução** (as de documentação — `05-CONTRATOS.md`, `STATUS.md` — são do coordenador).

### 10.1 Fundação

### T-17.01 · Modelo, esquema e contratos
- Arquivos: `src/nucleo/mapa/{tipos,esquema,contrato,index}.ts` + testes.
- Tipos do §4 (`Extracao`, `*Bruto`, `No`, `Aresta`, `RaioProvisorio`, `Limiares`), DDL do §4.4 com `migrar(db)` (`PRAGMA user_version`), interface `ServicoMapa` (estado, analisar, cancelar, consultar,
  raio, exportar) e `MapaLeitura` (a parte somente leitura que o MCP e a Fase 15 consomem), `validarExtracao()` (campo a campo; rejeita JSON malformado/excedente), `limiaresPadrao` (legadox).
- Teste: DDL cria todas as tabelas e índices; `user_version = 1`; versão maior → sinaliza `reconstruir`; `validarExtracao` rejeita tipo errado, linha negativa, listas acima do teto (5 000 símbolos); ida e volta.
- Aceite: tipos exportados por `index.ts`; nenhuma importação de Electron; contratos do §8 replicados em comentário de topo para o coordenador copiar para `05-CONTRATOS.md`.
- Depende: T-00.06 (banco/`node_modules` base).

### T-17.02 · Gramáticas WASM e carregador
- Arquivos: `src/nucleo/mapa/{gramaticas,linguagens}.ts`, `scripts/copiar-ativos.mjs` (copia os `.wasm` escolhidos para `dist/nucleo/mapa/gramaticas/`), `package.json`, `electron-builder.yml`, `scripts/verificar.mjs` (orçamento P-245), `THIRD-PARTY-LICENSES.md`, testes.
- `web-tree-sitter` **0.27.0** (dependência exata) + `@vscode/tree-sitter-wasm` **0.3.1** (devDependency exata). `iniciarRuntime({pastaWasm})` (`Parser.init({locateFile})` com caminho absoluto fora do asar),
  `carregarGramatica(linguagem)` (cache; `Language.load` por demanda), mapa extensão → linguagem → arquivo `.wasm` (`tsx`, `typescript`, `javascript`, `python`, `java`, `php`, `c-sharp`, `go`, `ruby`, `rust`, `cpp`);
  `asarUnpack: dist/nucleo/mapa/**/*` e `node_modules/web-tree-sitter/**/*`; custo registrado em D-160.
- Teste: carrega **todas** as gramáticas embarcadas e parseia um "olá" de cada; **guarda de versão**: falha se `web-tree-sitter` ≠ `0.27.0` ou `@vscode/tree-sitter-wasm` ≠ `0.3.1` ou se as ABIs não forem aceitas (o achado de `base/H` §2.1: `tree-sitter-wasms` 0.1.13 falha no runtime 0.27); soma dos `.wasm` ≤ 18 MB; licenças das gramáticas presentes em `THIRD-PARTY`.
- Aceite: `Language.load` de cada gramática ≤ 15 ms; o worker carrega no Electron 37.10.3 (`ELECTRON_RUN_AS_NODE`); `npm run verificar` inclui P-245.
- Depende: T-17.01.

### T-17.03 · Varredura de arquivos
- Arquivos: `src/nucleo/mapa/{varredura,gitignore}.ts` + testes.
- `varrer(raiz, op) → AsyncGenerator<LoteArquivos>` (lotes de 500): com git, `git ls-files -z -co --exclude-standard` via `ExecutorVcs` (leitura, `GIT_OPTIONAL_LOCKS=0`); sem git, caminhada própria com analisador de `.gitignore` (raiz e aninhados, negações, âncoras); ignora por padrão
  `node_modules`, `vendor`, `.git`, `dist`, `build`, `target`, `bin/obj` (par .NET), `__pycache__`, `.venv`, `.expxv`; **nunca** abre `.env*`, `*.pem`, `id_rsa*`, `*.key`; pula symlink que sai da raiz, submódulo (`.git` arquivo), binário (NUL nos 8 KB), minificado (linha média > 500), > 1 MB; detecta linguagem por extensão e `shebang`; hash SHA-1 com cache `mtime+tamanho`; caminhos normalizados para `/`; `truncado:true` acima de `total_max`.
- Teste (com `fs` injetado): `.gitignore` respeitado (inclusive negação); `.env` e chave **nunca abertos** (espião no `open`); symlink para fora ignorado; arquivo de 2 MB ignorado com motivo; minificado ignorado; repositório com 20 000 arquivos listado sem bloquear o event loop; CRLF/BOM não alteram o hash do conteúdo lido.
- Aceite: P-250 (varredura sem mudanças ≤ 2 s em 5 000 arquivos) no teste de unidade com `ExecutorVcs` real em repo sintético.
- Depende: T-17.01, T-06.02.

### T-17.04 · Armazém SQLite
- Arquivos: `src/nucleo/mapa/armazem.ts` + testes.
- Abre `<userData>/mapas/<workspace_id>/mapa.db` (WAL), `gravarLote(extracoes)` (transação por ≤ 500 arquivos), `removerArquivos`, `lerHashes()`, `substituirArestas(escopo)`, consultas preparadas
  (vizinhos, nó, busca por prefixo/nome), `analise_cache` por `versao_mapa`; banco corrompido ou de `schema_version` maior → renomeia `mapa.db.corrompido-<carimbo>` e recria (aviso, não apaga); `compactar()` sob demanda.
- Teste: 5 000 arquivos inseridos ≤ 1,5 s; consulta quente ≤ 5 ms (P-14); corrupção simulada recria sem lançar; `ON DELETE CASCADE` remove nós/arestas do arquivo; duas escritas concorrentes serializam.
- Aceite: nenhuma consulta bloqueia > 50 ms o event loop do **worker/serviço** (medido); fechar o serviço libera o handle.
- Depende: T-17.01.

### T-17.05 · Pool de workers de extração
- Arquivos: `src/nucleo/mapa/{pool,worker-extracao}.ts` + testes (molde: `src/nucleo/metodo/worker.ts`).
- `criarPool({caminhoWorker, tamanho})`: mensagens `{id, tipo:"extrair", caminho_abs, linguagem, versao_extrator}` → `Extracao` | `{erro}`; concorrência `clamp(floor(ncpu/4),1,3)` (1 em segundo plano), **backpressure** (≤ 2×N em voo), **timeout de 5 s por arquivo** (mata e recria o worker; arquivo marcado `erros_parse`), reinício após queda, **encerra workers ociosos em 30 s**, `AbortSignal`; o worker lê o arquivo, faz hash e roda o extrator; compilado para CJS em `dist/nucleo/mapa/worker-extracao.js`, **fora do asar**.
- Teste (extrator falso): ordem de resultados por id; timeout mata o worker e o pool segue; queda é recuperada; abort cancela a fila; após `encerrar()` não restam `Worker` vivos (`threadId` saiu); 0 handles com o pool ocioso (P-248).
- Aceite: com extrator falso de 1 ms, 5 000 arquivos passam pelo pool em ≤ 3 s (overhead de IPC medido).
- Depende: T-17.01, T-17.02.

### 10.2 Extração (um arquivo por linguagem; fixtures em `tests/fixtures/mapa/<linguagem>/` com `esperado.json`)

### T-17.06 · Núcleo de extração, métricas e redação
- Arquivos: `src/nucleo/mapa/extratores/{registro,comum}.ts`, `src/nucleo/mapa/{metricas,redacao}.ts`, **stubs** `extratores/{typescript,python,java,php,csharp,go,rust,ruby,cpp,generico}.ts` (lançam `nao_implementado`) + testes.
- `extrairArquivo(texto, linguagem, caminho): Extracao` despacha por `registro.ts` (carga lazy por linguagem; assim os extratores vivem em arquivos disjuntos); helper `compilarConsulta(lang, fonte)` com cache (compilar 2 consultas ≈ 47 ms medido); `metricas.ts`: LOC (código/comentário/branco pelos nós de comentário), **complexidade ciclomática** por função (tabela de nós de decisão por linguagem), `e_teste` (caminho/nome/cabeçalho), `e_gerado` (`@generated`, `.min.`, cabeçalhos de gerador); `redacao.ts`: assinatura sanitizada (literais de texto → `"…"`), comentário ≤ 160 caracteres com redação de padrões de segredo (`AKIA…`, `ghp_…`, `sk-…`, `-----BEGIN`, `password\s*[:=]`); nomes qualificados estáveis; teto de 5 000 símbolos por arquivo (`truncado`).
- Teste: LOC e complexidade em trechos pequenos de 3 linguagens; redação remove segredo plantado; qualificados estáveis entre execuções; arquivo com erros de sintaxe devolve `erros_parse > 0` sem lançar.
- Aceite: parse + consulta de 12,7 KB em ≤ 5 ms (base medida: ≈ 2,3 ms); nenhum extrator depende de outro.
- Depende: T-17.02.

### T-17.07 · Extrator TypeScript/JavaScript/TSX/JSX
- Arquivos: `src/nucleo/mapa/extratores/typescript.ts` (+ `consultas`), `tests/fixtures/mapa/{typescript,javascript}/**`, testes.
- Imports (`import`, `import type` → `so_tipo`, `import()` dinâmico, `require`, `export … from`), símbolos (função, classe, método, `const f = () =>`, interface, tipo, enum; `exportado` por `export`/`module.exports`), chamadas (identificador, membro, `new`, componente JSX como `referencia`), herança (`extends`/`implements`), **entradas** (Express/Koa/Fastify `app|router.<verbo>('/x', h)`, NestJS `@Controller/@Get…` com prefixo, Next.js por arquivo `pages/**` e `app/**/(page|route).*`, Electron `ipcMain.handle|on('canal', h)`, `bin`/`main` do manifesto, `commander`/`yargs`, `node-cron`, handlers `export const handler`), **dados** (literais SQL, Prisma `prisma.<modelo>.<op>`, TypeORM `@Entity('t')`, Sequelize `define('t'`, Mongoose `model('N'`, knex `knex('t')`), **dinâmicos** (`eval`, `new Function`, `require(expr)`, `import(expr)`, `obj[expr]()`), **padrões** (`throw`, `catch` vazio, `process.env.NOME`).
- Teste: gabarito `esperado.json` (subconjunto exigido de símbolos/imports/chamadas/entradas com confiança); casos de borda (re-export em cadeia, `export default`, classe anônima, decorators, TSX).
- Aceite: 100% do gabarito; sem falso positivo nos casos "armadilha" da fixture (nome genérico `get`, string que parece rota).
- Depende: T-17.06.

### T-17.08 · Extrator Python
- Arquivos: `extratores/python.ts`, `tests/fixtures/mapa/python/**`, testes.
- Imports (absolutos, relativos por nível, `from x import y as z`, `importlib.import_module`/`__import__` como dinâmico), símbolos (def/async def/classe/método/aninhado, decoradores), chamadas, herança (bases), **entradas** (Flask `@app.route|bp.route`, FastAPI `@app|router.<verbo>`, Django `urls.py` `path/re_path`, Celery `@task|@shared_task`, `click`/`typer`/`argparse`, `management/commands/*`, `if __name__ == "__main__"`), **dados** (SQL, `models.Model` + `Meta.db_table`, SQLAlchemy `__tablename__`, `CreateModel` em migrações), **dinâmicos** (`getattr`, `eval/exec`, `__getattr__`, `importlib`), padrões (`raise`, `except:` vazio, `os.environ`).
- Teste/Aceite: como T-17.07, com a fixture Python.
- Depende: T-17.06.

### T-17.09 · Extrator Java
- Arquivos: `extratores/java.ts`, `tests/fixtures/mapa/java/**`, testes.
- `package`/`import` (estático, curinga), classe/interface/enum/record/anotação/método, chamadas (`method_invocation`, `object_creation`), `extends`/`implements`, **entradas** (Spring `@RestController|@Controller|@RequestMapping|@GetMapping…` com prefixo, `@Scheduled`, `@KafkaListener|@RabbitListener|@JmsListener`, `@EventListener`, JAX-RS `@Path`+`@GET`, `HttpServlet.doGet`, `public static void main`), **dados** (JPA `@Entity/@Table(name)`, `@Query("…")`, SQL JDBC, repositórios `extends JpaRepository<E,…>` → tabela da entidade, `heuristica`), **dinâmicos** (`Class.forName`, reflexão `invoke`, `@Autowired` → marca DI de contêiner), padrões (`throw`, `catch` vazio, `System.getenv`).
- Teste/Aceite: gabarito da fixture Java; Maven multi-módulo mínimo.
- Depende: T-17.06.

### T-17.10 · Extrator PHP
- Arquivos: `extratores/php.ts`, `tests/fixtures/mapa/php/**`, testes.
- `namespace`/`use` (grupo, função, constante), classe/trait/interface/enum/função/método, chamadas (`f()`, `->m()`, `::m()`, `new`), `require/include(_once)` (literal e concatenação simples com `__DIR__` = `exata`; variável = dinâmico), herança/`implements`/`use` de trait, **entradas** (Laravel `Route::get|post|…|resource`, Symfony `#[Route]` e `@Route`, WordPress `add_action|add_filter`, comandos Artisan, `public/index.php`, cron do `Kernel::schedule`), **dados** (Eloquent `$table`, `DB::table('t')`, SQL de PDO/mysqli, Doctrine `#[ORM\Table]`/`@ORM\Table`), **dinâmicos** (`$$v`, `call_user_func*`, `eval`, `$o->$m()`, `new $c`, `app()->make`), padrões (`throw`, `catch` vazio, `getenv`).
- Teste/Aceite: gabarito; casos de legado (arquivo com HTML + PHP misturado não derruba o parse; `erros_parse` contado).
- Depende: T-17.06.

### T-17.11 · Extrator C#
- Arquivos: `extratores/csharp.ts`, `tests/fixtures/mapa/csharp/**`, testes.
- `namespace` (inclusive file-scoped), `using` (incl. `static`/alias), classe/interface/struct/record/enum/método, chamadas (`invocation_expression`, `object_creation_expression`), lista de bases (resolvida depois como herda/implementa), **entradas** (`[ApiController]`/`[HttpGet("x")]`/`[Route]`, Minimal API `app.MapGet`, `static void Main`, `IHostedService`, `[FunctionName]`), **DI** (`services.AddScoped<IFoo, Foo>()` → ligação interface → implementação, `exata`), **dados** (EF `DbSet<T>`, `[Table("x")]`, `ToTable`, SQL em `SqlCommand`/Dapper), **dinâmicos** (`Activator.CreateInstance`, reflexão), padrões (`throw`, `catch` vazio, `Environment.GetEnvironmentVariable`).
- Teste/Aceite: gabarito.
- Depende: T-17.06.

### T-17.12 · Extratores Go e Rust
- Arquivos: `extratores/{go,rust}.ts`, `tests/fixtures/mapa/{go,rust}/**`, testes.
- Go: `package`, imports (alias, ponto, `_`), funções/métodos (receptor), `type struct|interface`, chamadas (seletor/identificador), embedding → `herda`, **entradas** (`func main`, `http.HandleFunc|Handle`, gin/echo/chi `r.GET("/x", h)`, cobra `Command{Use}`), **dados** (`db.Query("…")`, gorm `db.Table("x")`), **dinâmicos** (`reflect`, interfaces sem resolução → `heuristica`), padrões (`err != nil`, `panic`, `os.Getenv`).
  Rust: `mod`/`use` (aninhado, `crate::`/`super::`/`self::`), `fn/struct/enum/trait/impl` (`impl Trait for T` → `implementa`), chamadas e métodos, **entradas** (`fn main`, `#[tokio::main]`, actix `#[get("/x")]`, axum `.route("/x", get(h))`, rocket, clap), **dados** (`sqlx::query!("…")`, diesel `table!`), **dinâmicos** (`dyn Trait`, `macro_rules!`), padrões (`Result`/`?`, `unwrap`, `std::env::var`).
- Teste/Aceite: gabarito de cada linguagem.
- Depende: T-17.06.

### T-17.13 · Extrator Ruby
- Arquivos: `extratores/ruby.ts`, `tests/fixtures/mapa/ruby/**`, testes.
- `require`/`require_relative`/`load`/`autoload`, classe/módulo/`def`/`def self.`, `include/extend/prepend` e `Class < Parent` → `herda`, chamadas (receptor, `Foo.new`), **entradas** (Rails `config/routes.rb`: `get '/x', to: 'c#a'`, `resources`, `namespace`; Rack `config.ru`; Sidekiq `perform`; Rake `task`; Thor; ActiveJob), **dados** (ActiveRecord `< ApplicationRecord` + `table_name`, `db/schema.rb` `create_table`, migrações, `find_by_sql`, `where("…")`), **dinâmicos** (`send/public_send`, `method_missing`, `define_method`, `eval`, `const_get`), padrões (`raise`, `rescue` vazio, `ENV[…]`).
- Teste/Aceite: gabarito.
- Depende: T-17.06.

### T-17.14 · Extrator C/C++
- Arquivos: `extratores/cpp.ts`, `tests/fixtures/mapa/{c,cpp}/**`, testes.
- Gramática `cpp` também para `.c/.h` (limitações conhecidas registradas; `erros_parse` tolerado), `#include "x"`/`<x>`, funções/métodos/classes/structs/namespaces/templates, chamadas (identificador, `->`/`.`/`::`), herança (`base_class_clause`), **entradas** (`main`), **dados** (SQL em `sqlite3_exec`/ODBC, `EXEC SQL` do Pro*C), par `.h` ↔ `.c/.cpp` por mesmo nome (`heuristica`), **dinâmicos** (ponteiro de função, `dlopen/dlsym`, macros, despacho virtual), padrões (`errno`, retorno de código, `getenv`).
- Teste/Aceite: gabarito C e C++; macro pesada não derruba o parse.
- Depende: T-17.06.

### T-17.15 · Modo degradado e manifestos
- Arquivos: `extratores/generico.ts`, `src/nucleo/mapa/{manifestos,toml-minimo}.ts`, `tests/fixtures/mapa/{generico,manifestos}/**`, testes.
- Degradado: tabela de comentários para ~30 extensões (LOC próprio), imports por regex padrão por extensão (Kotlin/Swift/Scala/Dart/Perl/Delphi `uses`/VB `Imports`/COBOL `COPY`), `.sql` (`CREATE|ALTER|DROP TABLE` → dados `ddl`); tudo `heuristica`, `degradado = 1`.
  Manifestos (estáticos): `package.json` (deps, `scripts`, `bin`, `main`, `exports`, `workspaces`), `composer.json` (require, PSR-4, scripts), `pom.xml`, `build.gradle(.kts)` (regex de dependências), `*.csproj/*.sln` (`ProjectReference`/`PackageReference`), `go.mod`, `Cargo.toml` (+workspace), `pyproject.toml`/`requirements*.txt`/`setup.cfg`, `Gemfile`, `Makefile` (alvos), `.github/workflows/*.yml` (`run:`, via `yaml` + `LineCounter` para a linha); **locks** (`package-lock.json`, `pnpm-lock.yaml`, `composer.lock`, `Cargo.lock`, `go.sum`, `Gemfile.lock`, `poetry.lock`) para a versão **exata**; saída `Manifesto{deps, comandos[{nome, comando, arquivo, linha}], modulos}`. TOML mínimo próprio (tabelas, strings, arrays, tabelas inline; sem dependência).
- Teste: cada manifesto de fixture parseado com `arquivo:linha`; TOML com casos reais (`[workspace]`, `[tool.poetry.dependencies]`); manifesto malformado → lacuna, nunca exceção.
- Aceite: nenhum manifesto é executado (config JS ignorada com aviso); comandos declarados trazem `arquivo:linha`.
- Depende: T-17.06.

### 10.3 Resolução e grafo

### T-17.16 · Resolvedores JS/TS e Python
- Arquivos: `src/nucleo/mapa/resolucao/{comum,ts,python}.ts` + testes.
- JS/TS: relativos com sondagem de extensão (`.ts,.tsx,.js,.jsx,.mjs,.cjs,/index.*`, troca `.js`→`.ts` de ESM), `tsconfig.json` (`paths`, `baseUrl`, `extends`, `references`; JSONC tolerante), `workspaces` (nome do pacote → pasta), `exports` básico; alias de bundler não avaliado → `heuristica` por sufixo único, senão `externo`/`nao_resolvido` contado; builtin `node:` → `externo`. Python: módulos absolutos por raízes de busca (raiz, `src/`, pastas com `__init__.py`, pacotes do `pyproject`), relativos por nível, pacotes de namespace, `from pkg import nome` (submódulo × símbolo), stdlib embutida → `externo stdlib`, o resto `externo pip`. Resultado: `ArestaBruta{de,para,tipo:"importa",confianca,linha}`.
- Teste: tabela de casos por resolvedor (≥ 25), ambiguidade, ciclo de `extends` do tsconfig, caminho `..` fora da raiz recusado.
- Aceite: fixtures `typescript/` e `python/` com 100% do gabarito de arestas; `nao_resolvido` listado, nunca omitido.
- Depende: T-17.07, T-17.08, T-17.15.

### T-17.17 · Resolvedores Java, C# e PHP
- Arquivos: `resolucao/{java,csharp,php}.ts` + testes.
- Java: FQN → arquivo pelo índice `package`+classe; curinga; **mesmo pacote sem import** (visibilidade implícita); multi-módulo Maven/Gradle pelos manifestos. C#: `using Namespace` → arquivos que declaram o namespace (`heuristica`), afinados por busca do tipo entre os `using` (única → `exata`); `ProjectReference` do `.csproj` limita o alcance; DI de T-17.11. PHP: PSR-4 (`autoload` e `autoload-dev`) → arquivo `exata`; `classmap`/`files` → índice de classes (`heuristica`); `require` literal/`__DIR__ . '/x'` constante dobrada; mesmo namespace implícito.
- Teste/Aceite: tabelas de casos por linguagem (≥ 20 cada) e gabarito das fixtures.
- Depende: T-17.09, T-17.10, T-17.11, T-17.15.

### T-17.18 · Resolvedores Go, Ruby, Rust e C/C++
- Arquivos: `resolucao/{go,ruby,rust,cpp}.ts` + testes.
- Go: `module` do `go.mod` + diretório = pacote (aresta para o módulo-pacote; refinada por nome de símbolo), `internal/`, `vendor/`, stdlib → `externo`; `replace` local respeitado, remoto ignorado. Ruby: `require_relative` `exata`; `require` por load paths (`lib/`, `app/**`) `heuristica`; constantes por convenção **Zeitwerk** (`Foo::BarBaz` → `foo/bar_baz.rb`) `heuristica`; gems do `Gemfile` → `externo`. Rust: `mod x;` → `x.rs`/`x/mod.rs` `exata`; `use crate/super/self` sobre a árvore de módulos; `use dep::…` → `externo cargo`. C/C++: `#include "a/b.h"` (relativo ao arquivo → diretórios de include de `compile_commands.json` quando existir → raiz), `<x>` → `externo sistema` salvo se achado nos includes; `.h` ↔ `.c/.cpp`.
- Teste/Aceite: tabelas de casos (≥ 15 cada) e gabarito das fixtures.
- Depende: T-17.12, T-17.13, T-17.14, T-17.15.

### T-17.19 · Resolução de chamadas e confiança
- Arquivos: `src/nucleo/mapa/chamadas.ts` + testes.
- Ordem: (1) escopo local (definições do arquivo; `this/self/$this` na classe); (2) **binding de import** → símbolo exportado do arquivo-alvo (segue `reexporta` ≤ 5 saltos) = `exata`; (3) `Receptor.método` com receptor classe/namespace importado, ou variável com **tipo local simples** (`const x = new Foo()`, parâmetro tipado) = `exata`; (4) só por nome: único no projeto = `heuristica` (`candidatos=1`); 2–5 = uma aresta por candidato (`heuristica`, `candidatos=n`); > 5 descartado e contado em `chamadas_ambiguas`; (5) **interfaces**: chamada a método de interface liga também às implementações (`heuristica`, `via_interface`); DI do C#/Spring resolve interface → implementação; (6) `instancia`/`herda`/`implementa`; **stoplist** de nomes genéricos por linguagem (`get`, `set`, `run`, `handle`, `toString`, `map`, `push`…) e de APIs conhecidas de biblioteca. Guarda até 5 evidências por aresta.
- Teste: ≥ 30 casos em tabela (inclusive armadilhas: homônimos em arquivos distintos, método genérico, import com alias, re-export em cadeia, recursão); 0 aresta `exata` sem prova em import/escopo.
- Aceite: nas fixtures, 100% do gabarito de arestas `exata` e 0 `exata` espúria; cada `heuristica` traz `candidatos`.
- Depende: T-17.16, T-17.17, T-17.18.

### T-17.20 · Grafo em memória e algoritmos
- Arquivos: `src/nucleo/mapa/grafo/{memoria,ciclos,pagerank,alcance,camadas,metricas-grafo}.ts` + testes.
- Construção CSR (`Int32Array`) a partir do banco; **Tarjan iterativo** (SCC sem recursão), PageRank (amortecimento 0,85, 50 iterações, tolerância 1e-6, personalização opcional), alcance direto/reverso por BFS com limite de profundidade/nós e filtro de confiança, níveis topológicos da condensação, fan-in/out/instabilidade, **caminhos mínimos entrada → alvo e interseção** (candidatos a costura).
- Teste: grafos aleatórios (semente fixa) contra implementações ingênuas; ciclo dentro de ciclo; grafo sem arestas; 5 000/15 000: Tarjan ≤ 30 ms, PageRank ≤ 100 ms (P-246).
- Aceite: nenhuma recursão profunda (grafo em cadeia de 50 000 nós não estoura a pilha).
- Depende: T-17.01.

### T-17.21 · Analisador completo e incremental
- Arquivos: `src/nucleo/mapa/{analisador,incremental,servico}.ts` + testes.
- `analisar({completo?, arquivos?, signal})`: varredura → diff (novos/alterados/removidos) → pool → gravação → resolução → chamadas → análises → `versao_mapa++` → `map.updated`. **Incremental**: re-extrai só o que mudou; recalcula só as arestas afetadas (os imports do arquivo alterado; arquivos que importam/chamam o que mudou; **imports antes não resolvidos** que um arquivo novo passa a satisfazer; dependentes de arquivo removido); renomeação = remoção + criação. `incremental.ts`: observador do VCS (`criarObservadorVcs`) ou do método, debounce 300 ms, ignora `.expxv`/`.git`/ignorados, ativo só com o mapa habilitado e já analisado, pausa sem foco da janela e retoma no foco. Progresso coalescido a 250 ms; cancelamento deixa o banco **consistente** (lote atômico, `estado=parcial`).
- Teste: contadores de extração (mudar 1 arquivo → 1 extração); adicionar arquivo resolve import pendente; remover arquivo remove nós e arestas; cancelar no meio e retomar produz o mesmo resultado que a análise completa (grafo idêntico); duas análises simultâneas serializam.
- Aceite: P-241 (≤ 200 ms por arquivo) e P-250 (≤ 2 s sem mudanças) no repo sintético; nenhuma tarefa > 50 ms no main (P-12).
- Depende: T-17.03, T-17.04, T-17.05, T-17.19, T-17.20.

### T-17.22 · História git: churn, autores e acoplamento
- Arquivos: `src/nucleo/mapa/git-historia.ts` + testes.
- Um único `git log --no-merges --since=<janela> -n <max> --format=%x1e%H%x1f%an%x1f%ct%x1f%s --name-status -z -M` via `ExecutorVcs` (streaming, cancelável, `GIT_OPTIONAL_LOCKS=0`); calcula por arquivo `churn_total`, `churn_janela`, `autores_n`, `criado_git`, `ultima_alt`, `commits_correcao` (mensagens `fix|bug|corrige|hotfix`), **segue renomeações**; **acoplamento temporal** (commits com 2–30 arquivos; pares com ≥ 5 co-alterações e grau ≥ 0,3; teto 5 000 pares). Nomes de autor ficam só no banco local (a UI mostra; pacote e MCP expõem **contagens**). Sem git/SVN → `historia:"indisponivel"` (sinal vira pior caso no raio).
- Teste: repositório sintético do gerador de `src/nucleo/vcs/` (commits, renomeação, merge, autor duplicado por e-mail); janela e teto respeitados; commit gigante (> 50 arquivos) ignorado no acoplamento.
- Aceite: P-249 (≤ 3 s para 20 000 commits; 50 000 ≤ 8 s); nunca bloqueia o main.
- Depende: T-17.04, T-06.02.

### 10.4 Análises

### T-17.23 · Entradas e fluxos
- Arquivos: `src/nucleo/mapa/analises/entradas.ts` + testes.
- Agrega `entradas` dos extratores + convenções de arquivo (Next.js) + manifestos (`bin`, `scripts`) + `web.xml`; normaliza a `chave` (`GET /users/:id`); cria arestas `aciona` entrada → handler; `fluxo(entradaId, {profundidade=6, minConfianca, maxNos=300})` por BFS em `chama/instancia`, para em `externo`, anota tabelas tocadas e ciclos, devolve `truncado`; contagem por categoria para o perfil.
- Teste: um caso por framework das fixtures; fluxo com recursão e com ramo heurístico (tracejado); truncamento em 300 nós.
- Aceite: fluxo de uma rota da fixture TS lista exatamente os símbolos do gabarito, na ordem das camadas.
- Depende: T-17.20 (e os tipos de T-17.01; os extratores fornecem dados reais depois).

### T-17.24 · Acesso a dados
- Arquivos: `src/nucleo/mapa/analises/dados.ts` + testes.
- Normaliza `dados` brutos para nós `tab:<nome>` (minúsculo, sem esquema/aspas/crases); arestas `le_tabela`/`escreve_tabela` (do símbolo, ou do arquivo se o símbolo é desconhecido); modelo ORM → tabela; **definições** em migrações e arquivos de esquema (`.sql` DDL, `schema.prisma`, `schema.rb`, modelos Django) com `e_migracao`; SQL literal estático = `exata`, com interpolação = `heuristica`; consultas `quemToca(tabela)` e `tabelasDe(entrada)`. Tokenizador de SQL tolerante (não é um parser completo; limite declarado).
- Teste: fixtures SQL em 5 linguagens; `JOIN` múltiplo; CTE; nome entre crases/aspas; falso positivo guardado (`from` em texto comum).
- Aceite: marca `e_migracao` em 100% das migrações da fixture; "quem toca X" bate com o gabarito.
- Depende: T-17.20.

### T-17.25 · Camadas e regras de fronteira
- Arquivos: `src/nucleo/mapa/{regras-fronteira,analises/camadas}.ts` + testes.
- Importadores **estáticos**: `deptrac.yaml`/`depfile.yaml` (YAML), `.importlinter`/`setup.cfg`/`pyproject [tool.importlinter]` (contratos `layers`/`forbidden`), `.dependency-cruiser.json` (config `.js/.cjs` → "não lida: executaria código do projeto"), Packwerk `package.yml`; cada regra vira `RegraFronteira{origem, destino, tipo, fonte{arquivo,linha}}`. Avaliação gera violações com `arquivo:linha` das arestas. Sem regras: camadas **inferidas** (níveis da condensação do DAG de módulos; arestas contra a ordem = "violação candidata"); camadas manuais editáveis na UI em `camadas.json` (userData) **espelhadas** em `.expxv/mapa/camadas.json` para as skills lerem (P-275). Saída: tabela por módulo (`camada`, `ca`, `ce`, `instabilidade`) e matriz DSM.
- Teste: um arquivo de cada formato; violação detectada com evidência; camadas inferidas num projeto em três camadas; módulos em ciclo agrupados.
- Aceite: ao menos uma regra de cada ferramenta importada corretamente nas fixtures; violação sempre cita a regra (`arquivo:linha`).
- Depende: T-17.20, T-17.15.

### T-17.26 · Testes por convenção, cobertura importada e "sem teste"
- Arquivos: `src/nucleo/mapa/{cobertura,analises/testes}.ts` + testes.
- Detecção de teste por linguagem (`__tests__`, `*.test.*`/`*.spec.*`, `test_*.py`, `*_test.go`, `*Test.java`+`src/test/java`, `*Tests.cs`, `*_spec.rb`, `*Test.php`, `tests/` e `#[cfg(test)]`); arestas `testa` (import do teste = `exata`; convenção de nome = `heuristica`); estado `existente|parcial|ausente` (existente = teste com `exata` **e** referência a símbolo exportado do arquivo) e **estatísticas para o stackx** (co-localizado × pasta própria, formas de nome, runner por imports). Importadores **somente leitura**: lcov, Cobertura XML, JaCoCo XML, `go cover` (`cover.out`), achados em caminhos conhecidos; `medida` com data e aviso de defasagem.
- Teste: um relatório de cada formato nas fixtures; casamento de caminhos (prefixos absolutos removidos); arquivo sem teste detectado; relatório mais velho que o código gera aviso.
- Aceite: cobertura por pasta bate com o gabarito; estimativa sempre rotulada `estimada`.
- Depende: T-17.20, T-17.15.

### T-17.27 · Hotspots, código morto e duplicação
- Arquivos: `src/nucleo/mapa/analises/{hotspots,morto,duplicacao}.ts` + testes.
- Hotspots: `score = rank_pct(churn_janela) × rank_pct(complexidade_max)`, faixas `quente|morno|frio`, com autores, idade, correções e parceiros de acoplamento. Morto: candidatos com `confianca: alta|media|baixa` (alta = sem in-aresta `exata`, sem dinâmicos no ecossistema, fora da API pública/entradas/testes/decorados, idade > 1 ano); exclusões documentadas; sempre "candidato". Duplicação (opcional): winnowing k = 25/janela 4 sobre tokens normalizados (os `shingles` vêm do extrator quando `mapa.duplicacao`), pares/classes de clones, ignora cabeçalhos e `import`s.
- Teste: hotspot sintético (alto churn × alta complexidade no topo); falsos positivos de código morto (handler decorado, export de pacote, arquivo referenciado por config) **não** aparecem; clone plantado detectado; cabeçalho de licença repetido ignorado.
- Aceite: nenhuma saída usa a palavra "morto" sem "candidato"; teste de varredura de textos da UI/MCP/pacote.
- Depende: T-17.20, T-17.22.

### T-17.28 · Dependências externas e licenças
- Arquivos: `src/nucleo/mapa/analises/externas.ts` + testes.
- A partir de manifestos/locks (T-17.15) e arestas `importa → externo`: declaradas × usadas, versão exata do lock, dev × prod; **licença lida localmente e somente leitura** (`node_modules/<p>/package.json`, `vendor/composer/installed.json`, `*.dist-info/METADATA`; sem pasta → `desconhecida`); normalização SPDX; selo `copyleft_forte` (GPL-*/AGPL-*) e `copyleft_fraco` (LGPL/MPL/EPL) **informativos** (não é parecer jurídico).
- Teste: fixtures com `node_modules` falso e `installed.json`; declarada-não-usada e usada-não-declarada; licença composta (`MIT OR Apache-2.0`).
- Aceite: zero acesso à rede (`net`/`http` espiados); pasta de dependências ausente não gera erro.
- Depende: T-17.20, T-17.15.

### T-17.29 · Dialetos, padrões e zonas de risco candidatas
- Arquivos: `src/nucleo/mapa/analises/{padroes,zonas}.ts` + testes.
- Agrega `padroes` por **eixo** (erro, config — só nomes de variáveis —, DI, acesso a dados [ORM × SQL cru × procedure], data/hora [bibliotecas], **dinheiro** [`float/double/number` × `Decimal/BigDecimal/decimal/centavos` em identificadores `preco|valor|total|saldo|amount|price|balance|juros|desconto…`], idioma dos nomes [proporção de termos PT × EN por pasta], estilo de teste) com contagem por pasta e **data de criação** (recência para desempate de CONFLITO). Zonas candidatas: dicionário PT/EN (financeiro, fiscal/NF/SPED/imposto, folha/ponto, autenticação/permissão, banco/boleto/PIX/gateway, auditoria/histórico imutável, cálculo contratual, LGPD/dado pessoal) sobre caminhos, símbolos e tabelas, agrupado em zonas com pastas e arquivos; **"Quem valida: NÃO DETERMINADO"**.
- Teste: projeto sintético com dois dialetos de erro e `float`+`Decimal` no mesmo módulo → CONFLITO com contagens; zona fiscal candidata com pastas corretas; nenhum valor de variável de ambiente aparece em saída.
- Aceite: `classificarForca` reproduz os rótulos do stackx (UNÂNIME, MAJORITÁRIO n/m, CONFLITO, ÚNICO CASO, AUSENTE) em tabela de casos.
- Depende: T-17.20 e os padrões dos extratores.

### T-17.30 · Raio de impacto provisório
- Arquivos: `src/nucleo/mapa/raio.ts` + testes.
- `calcularRaio({arquivos, simbolos?}, ctx, limiares) → RaioProvisorio` com os 8 sinais do §7.3 (cada um com `valor`, `metodo`, `confianca`), `min`/`max` de chamadores, `alcance_transitivo`, **`faixa`** (limiares do `PERFIL.md` se existir — leitura tolerante e somente leitura —, senão padrão) e **`faixa_pior_caso`** (zonas candidatas e dinâmicos assumidos), `pior_caso[]` com motivo, `candidatos_costura[]`, `nota` de provisório; funções puras `faixaDoRaio(sinais, limiares)`.
- Teste: ≥ 14 cenários em tabela (≤ 3 chamadores + cobertura `existente` → BAIXO; 4–15 → MEDIO; > 15 → ALTO; cobertura `parcial`/`ausente` → MEDIO; consumo por job → MEDIO; migração → ALTO; zona declarada → ALTO; heurísticas elevam o `max`; dinâmico possível → pior caso; sem git → churn pior caso); critérios de BAIXO são conjuntivos, os de MEDIO/ALTO disjuntivos; "na dúvida vale a maior".
- Aceite: para um arquivo da fixture, `chamadores` bate com a contagem manual do gabarito; o JSON cita o método de cada sinal.
- Depende: T-17.20, T-17.23, T-17.24, T-17.26, T-17.29.

### 10.5 Integração e saídas

### T-17.31 · Pacote de contexto, inventário do stackx e perfil provisório
- Arquivos: `src/nucleo/mapa/{pacote-contexto,inventario,perfil-provisorio}.ts` + testes.
- Grava `.expxv/mapa/<carimbo>/` **atomicamente** (pasta temporária + `rename`; garante `.expxv/.gitignore` com `*`; mantém 3 pacotes): `RESUMO.md` (seções por importância/PageRank: panorama, entradas, camadas e violações, ciclos, hotspots top 15, dados, externas, sem teste por pasta, zonas candidatas, **confiança e limites**, "como usar"; corte determinístico por orçamento de tokens, ideia do `--map-tokens` do aider), `inventario-stackx.json` (itens `{topico, fato, evidencia[≤5 "arquivo:linha"], forca, contagens, confianca}`), `perfil-provisorio.json`, `entradas.json`, `arquivos.jsonl`, `raio-<trabalho>.json` (sob demanda), `mudancas-desde-ultimo.json`. **Só caminhos relativos**; nenhuma linha de código-fonte.
- Teste: `RESUMO.md` ≤ 6 000 tokens estimados em projeto grande (P-247), corte estável (mesma entrada → mesma saída); varredura de caminhos absolutos = 0; escrita atômica (queda no meio não deixa pacote pela metade); pacote antigo além de 3 é removido (somente dentro de `.expxv/mapa/`); `inventario` usa os rótulos do stackx.
- Aceite: gerar o pacote ≤ 2 s; **nenhum** arquivo criado fora de `.expxv/mapa/` (snapshot da árvore do repo antes/depois).
- Depende: T-17.23–T-17.30, T-17.04.

### T-17.32 · Tools MCP `map_*`
- Arquivos: `src/nucleo/mcp/tools/mapa.ts`, `src/nucleo/mcp/catalogo.ts` (`NomeTool` + matriz por modo), `src/nucleo/mcp/tools/index.ts`, `src/nucleo/mcp/erros.ts` (subcode `map_not_ready`) + testes.
- `map_status`, `map_query`, `map_impact`, `map_evidence` (§8.2) sobre `deps.mapa: MapaLeitura`; validação campo a campo (caminho relativo, sem `..`, limites), resposta ≤ 32 KB com `truncated`, `unavailable/map_not_ready` sem análise; disponíveis nos três modos quando o workspace tem o mapa habilitado; **sem** tool de disparo.
- Teste: matriz por modo; `..` e caminho absoluto → `invalid_argument`; `limit` > 100 reduzido; tamanho; sem token → `unauthorized`; cliente MCP de teste chama `map_impact` numa fixture.
- Aceite: P-246 (≤ 50 ms p95); `tools/list` só lista `map_*` com mapa habilitado.
- Depende: T-17.20, T-17.30, T-03.01.

### T-17.33 · IPC `mapa:*` e serviço no main
- Arquivos: `src/compartilhado/ipc.ts` (canais e tipos), `src/preload/preload.ts` (API `window.ade.mapa`, travada por teste de formato), `src/main/ipc/mapa.ts`, `src/main/servicos-mapa.ts`, ligação em `src/main/servicos.ts`/`boot` (**onda 2**) + testes.
- Um `ServicoMapa` por workspace (pool, armazém, analisador criados sob demanda, destruídos ao fechar o workspace), config `mapa.*`, eventos `mapa:progresso`/`mapa:mudou` coalescidos, `caminhoWorker` fora do asar; `mapa:apagar` exige `"APAGAR"`.
- Teste: validadores (tabela de payloads inválidos, campo a campo); autorização por remetente; o renderer nunca envia caminho absoluto; ciclo de vida sem handles após `dispose`; **boot onda 1 sem trabalho do mapa** (P-248).
- Aceite: P-248 (0 workers/handles ociosos; registro ≤ 5 ms).
- Depende: T-17.21, T-17.31.

### T-17.34 · Disparo de skills com o caminho do mapa
- Arquivos: `src/nucleo/mapa/disparo.ts`, canal `mapa:disparar` + testes.
- Ações `stackx_detectar`, `stackx_atualizar`, `legadox_perfil`, `legadox_raio` (exige `trabalho_id` e `arquivos`), `legadox_divida`: gera o pacote (T-17.31), monta o argumento (§7.2) com `normalizarArgumento` (uma linha, ≤ 1 500) e `comandoDeSkill`, digita no Pane escolhido; recusa Pane sem Claude Code/OpenCode (mensagem de `comandoDeSkill`); **nunca** dispara ação humana (D-21); a UI passa a "aguardando `<artefato>`" observado pelo método (Fase 4).
- Teste: texto digitado (snapshot) por ação; sem CLI compatível → bloqueado com motivo; argumento sem quebras de linha/controles; **árvore de `docs/` idêntica** antes e depois (teste com repositório temporário).
- Aceite: o comando digitado cita o caminho **relativo** do pacote e o nome das skills reais (`stackx-detectar`, `legadox-perfil`, `legadox-raio`).
- Depende: T-17.31, T-17.33, T-04.06.

### T-17.35 · Provedor de grafo para a Fase 15 (sem duplicar)
- Arquivos: `src/nucleo/mapa/provedor-grafo.ts` + `tests/mapa/contrato-fase15.test.ts`; **edição mínima e coordenada** dos pontos de extensão da Fase 15 `src/nucleo/conhecimento/fontes/codigo.ts` e `grafo/simbolos.ts` (T-15.15; chunker de código por regex em T-15.06) para aceitarem uma `PortaSimbolos` (se a Fase 15 já a expõe, só se liga o adaptador).
- Interface **`ProvedorGrafoCodigo`**: `versao(ws)`, `listarNos(ws, {tipos?, prefixo?, limite, cursor?})`, `vizinhos(ws, noId, {direcao, tipos?, limite})`, `texto(ws, noId) → {titulo, corpo ≤ 600 caracteres (qualificado + assinatura + 1ª linha de doc, já redigidos), hash}`, `aoMudar(cb)` (evento `map.updated`). **Divisão de trabalho:** com o mapa pronto, a fonte `codigo` da Fase 15 **deixa de usar regex** e passa a obter símbolos e arquivos do `ProvedorGrafoCodigo` (sem regex, multi-linguagem, com `arquivo:linha`); sem mapa, o chunker por regex da Fase 15 continua como fallback. A Fase 15 indexa `texto()` como *chunks* com `ref = no_id` e cria seus nós `arquivo`/`simbolo` (`rag_no`) **por referência** ao `no_id` do mapa, consultando as arestas de código **ao vivo** por `vizinhos` — **não copia o grafo de código**; reindexa só `nos_alterados`. A tela Conhecimento mostra o vizinho de código pelo mesmo canvas (T-17.40).
- Teste: paginação por cursor; `texto` ≤ 600 e sem segredo plantado; `aoMudar` entrega só os nós alterados após edição incremental; teste de contrato fixa o formato; com o mapa ligado, a fonte `codigo` da Fase 15 não executa o chunker por regex (espião).
- Aceite: nenhuma tabela da Fase 15 duplica `no`/`aresta` de código; a Fase 15 só importa `ProvedorGrafoCodigo`; as suítes T-15.06/T-15.15 continuam verdes.
- Depende: T-17.21, T-17.04, Fase 15 (T-15.15, T-15.20).

### T-17.36 · Importador SCIP (somente leitura)
- Arquivos: `src/nucleo/mapa/scip.ts` + testes (`tests/fixtures/mapa/scip/` gerada por um **codificador protobuf mínimo só de teste**).
- Decodificador protobuf próprio (varint, delimitado por comprimento, ~150 linhas, sem dependência) para o subconjunto de `scip.proto` lido em 2026-09-30 (`base/H` §3): `Index{metadata=1, documents=2}`, `Document{relative_path=1, occurrences=2, symbols=3, language=4}`, `Occurrence{range=1 (obsoleto, empacotado), symbol=2, symbol_roles=3, single_line_range=8, multi_line_range=9}`, `SymbolInformation{symbol=1, relationships=4}`, papéis `Definition=1, Import=2, WriteAccess=4, ReadAccess=8, Test=32`; aceita **ambas** as codificações de posição. Casa referência ↔ definição, mapeia a ocorrência ao símbolo contenedor (por intervalos de linha do nosso extrator) e grava arestas `fonte='scip'`, `exata`, **substituindo** heurísticas equivalentes. Procura `index.scip` na raiz, `.scip/` e `build/`, ou o arquivo escolhido pelo usuário; **nunca executa** um indexador (D-162). Leitura em streaming, teto de 500 MB.
- Teste: ida e volta com o codificador de teste; arquivo truncado/lixo → erro nominal sem exceção; 50 MB decodificados ≤ 3 s; merge sobe confiança sem criar nós inexistentes.
- Aceite: com SCIP presente, `exata` aumenta e nenhuma aresta `exata` anterior é rebaixada.
- Depende: T-17.19, T-17.04.

### T-17.37 · Adaptadores externos opcionais
- Arquivos: `src/nucleo/mapa/adaptadores/{detectar,ctags,scc,dot}.ts`, `tests/fixtures/mapa/bin/*` (executáveis falsos) + testes.
- Detecção em `PATH`/locais padrão (reaproveita o localizador de executáveis do `DetectorFerramentas`; **nunca** `node_modules/.bin` do projeto), versão por `--version` (timeout 3 s). **ctags** (GPL, só processo à parte): `--output-format=json --fields=+nKS -L -` com a **lista de arquivos pela entrada padrão** (respeita nossa lista/ignores), mapeia `kind` → `SubtipoSimbolo`, só para linguagens `degradado`, confiança `heuristica`, sem chamadas; **scc**/**tokei** (`--format json --by-file`) para cruzar totais e cobrir linguagens sem gramática; **dot** (`-Tsvg`, DOT pela entrada padrão) para "SVG via Graphviz". Argumentos em lista, sem shell, timeout (15 s) e teto de saída (8 MB); a tela mostra o **comando de instalação para copiar** e, conforme D-140 (regra geral 3 de `DECISOES-DAS-PENDENCIAS.md`: instalação pontual, reversível e justificada), um botão **"Instalar via Homebrew"** com **confirmação digitada** (`INSTALAR`), lista fechada de fórmulas (`universal-ctags`, `scc`, `graphviz`), `brew` por `execFile` sem shell, nunca `sudo`, registro em evento; sem `brew`, só o comando para copiar.
- Teste: ausente → recurso desligado sem erro; saída hostil (JSON inválido, 1 GB, travada) → limitada/encerrada; ctags falso mapeia `kind`s; nenhum adaptador chamado sem a ferramenta ter sido detectada.
- Aceite: sem ferramentas instaladas, **toda** a fase funciona; com elas, só enriquece.
- Depende: T-17.15, T-17.21.

### T-17.38 · Exportações
- Arquivos: `src/nucleo/mapa/exportar/{mermaid,dot,svg,json,csv,markdown}.ts`, canal `mapa:exportar` + testes.
- `exportarMermaid(vista, {maxNos=300, direcao})` (`flowchart LR`; ids `n<k>`, rótulos citados e escapados; > `maxNos` agrupa por módulo com nota), `exportarDot` (`digraph`, `rankdir=LR`, `cluster_*` por módulo), SVG estático próprio (cores do tema resolvidas na hora), `mapa-export.json` (`schema_version`), CSV (`nos.csv`, `arestas.csv`), relatório Markdown (panorama, ciclos, camadas, hotspots, entradas, dados, externas, confiança). Destino por diálogo nativo do main; **recusa `<raiz>/docs/**`**; padrão `<userData>/mapas/<ws>/exportacoes/`. Rodam em worker acima de 300 nós.
- Teste: saídas conferidas contra gabarito; sintaxe válida (ids únicos, colchetes balanceados, escape de aspas); SVG é XML bem formado; destino em `docs/` recusado; 500 nós ≤ 300 ms (P-251).
- Aceite: um fluxo de fixture exportado em Mermaid reproduz exatamente o gabarito; DOT abre sem erro em `dot` quando existe (teste condicionado).
- Depende: T-17.23, T-17.25, T-17.37.

### 10.6 Interface

### T-17.39 · Tela Mapa: casca, barra e estados
- Arquivos: `src/renderer/telas/mapa/{index,Barra,Estado,ListaVirtual}.tsx`, `mapa.css`, item de menu **Mapa** (ícone próprio, `04-UI-UX.md`) + testes.
- Lazy (`React.lazy`), 4 últimas telas montadas (regra da casca); máquina de estados: sem workspace · nunca analisado (botão primário "Analisar este projeto" com a estimativa) · analisando (progresso por fase, "Cancelar") · pronto · desatualizado (banner "N arquivos mudaram — atualizar") · erro/parcial; **uma linha de controles ≈ 28 px** (`flex-wrap: nowrap`); lista virtual > 100 itens; `role`/`aria-*`; estados vazios com próximo passo (ex.: "linguagem sem gramática: instale o ctags opcional" com comando para copiar); `mapa:apagar` com diálogo da própria UI (digitar `APAGAR`).
- Teste: RTL de cada estado; teste estrutural da barra (uma linha, altura ≤ 28 px, sem quebra); P-242 com IPC falso (≤ 100 ms ao 1º quadro); nenhuma cor literal.
- Aceite: P-242; foco/teclado completos; zero diálogo nativo.
- Depende: T-17.33.

### T-17.40 · Canvas do grafo, layout em worker e LOD
- Arquivos: `src/renderer/telas/mapa/{VisaoGrafo,lod,agrupamento}.tsx|ts`; **refatoração mínima e coordenada da Fase 15** (T-15.43): mover `GrafoCanvas.tsx` e `GrafoWorker.ts` de `src/renderer/telas/conhecimento/` para `src/renderer/componentes/grafo/` mantendo a API e as suítes da Fase 15 verdes (a tela Conhecimento passa a importar do novo lugar); **nenhuma dependência nova** (sem `d3-force`, sem Sigma/Cytoscape) + testes.
- **Um só canvas** (D-165): a Fase 15 já planeja canvas 2D com nós por *sprites* pré-renderizados, arestas em lote num `Path2D`, culling por viewport, hit-test por grade espacial, layout Barnes-Hut/quadtree num Worker com posições em *buffers* transferíveis e posições persistidas. Esta task **estende** esse componente (não cria outro): props novas `lod`, `agrupamento` (clusters colapsáveis módulo → arquivo → símbolo, expandir sob demanda), `arestasTracejadas` (heurística), `semente` (posições iniciais pela árvore de pastas para estabilidade), `cores` lidas das variáveis CSS, navegação por teclado (setas entre vizinhos, Enter expande) e **LOD** (rótulos só com zoom ≥ 0,8; acima de 3 000 arestas visíveis só as da seleção/vizinhança). A meta da Fase 15 é 2 000 nós/6 000 arestas (P-75); a do Mapa é **5 000/15 000 a 60 fps** (P-243), por isso o LOD e o agrupamento são obrigatórios e entram no componente comum (a tela Conhecimento herda o ganho). Se a Fase 15 **ainda não existir** quando esta task começar, cria-se o componente em `src/renderer/componentes/grafo/` com a mesma API e a Fase 15 o adota. Posições do Mapa em `layout_cache` (banco do mapa).
- Teste: unidade de LOD/agrupamento/hit-test; as suítes de `GrafoCanvas`/`GrafoWorker` da Fase 15 continuam verdes; **P-243** no Electron com grafo sintético de 5 000 nós / 15 000 arestas (p95 do quadro ≤ 16,7 ms em pan/zoom; 1ª imagem ≤ 1 s; layout ≤ 5 s); chunk lazy da tela ≤ 120 KB gz (P-245; o do grafo compartilhado não pode passar de 45 KB gz + extensões ≤ 15 KB gz).
- Aceite: P-243 verde e P-75/P-76 da Fase 15 sem piorar. **Plano B** (D-165): se não alcançar após otimizar, medir Sigma 3 + graphology (≈ 61 KB gz, `base/H` §5.3) ou `d3-force` (≈ 7 KB gz) **só para o layout**, registrar a medição e reabrir D-165 — sem relaxar o orçamento.
- Depende: T-17.39, T-17.20.

### T-17.41 · Visões Camadas (DSM) e Fluxo (fluxograma)
- Arquivos: `src/renderer/telas/mapa/{VisaoCamadas,VisaoFluxo,layout-camadas}.tsx|ts` + testes.
- Camadas: matriz módulo × módulo em canvas com rolagem virtual (≤ 200 módulos; acima, agrega por pasta de 1º nível), células de violação em `--alerta`, ciclo marcado, clique lista as arestas com `arquivo:linha` copiável. Fluxo: seleciona uma entrada (lista/busca) e desenha árvore esquerda → direita em SVG (≤ 300 nós; layout em camadas próprio, adaptando `camadas()` de `src/renderer/telas/metodo/Grafo.tsx`), formas por tipo (entrada em pílula, função, tabela, externo), **tracejado = heurística** (`aria-label` "heurística"), expandir/colapsar, legenda, "Exportar Mermaid/DOT/SVG".
- Teste: RTL e testes de layout (ordem das camadas do gabarito); heurística sempre tracejada; teclado completo.
- Aceite: o fluxo da fixture renderiza os nós esperados em ≤ 100 ms; DSM destaca exatamente as células de violação do gabarito.
- Depende: T-17.39, T-17.23, T-17.25, T-17.38.

### T-17.42 · Visões Hotspots, Entradas e Dados, painel de detalhe e perfil provisório
- Arquivos: `src/renderer/telas/mapa/{VisaoHotspots,VisaoEntradas,VisaoDados,PainelDetalhe,PerfilProvisorio,MenuMetodo}.tsx` + testes.
- Hotspots: dispersão churn × complexidade (canvas) + tabela virtual. Entradas/Dados: listas por categoria/tabela com "quem toca". **Painel de detalhe** (280 px, recolhível): LOC, complexidade, churn, autores (nomes só aqui), teste, chamadores diretos/indiretos, **raio provisório** com faixa e selo "provisório", evidências `arquivo:linha` (copiar). **Perfil provisório** (cartão com "Copiar como Markdown"; aviso "não é o PERFIL.md — quem escreve é o `/expx:legadox-perfil`"). **Método ▾** (stackx/legadox → `mapa:disparar`; `legadox_raio` pede o trabalho e usa os arquivos selecionados). Banners: desatualizado, história indisponível, linguagens degradadas.
- Teste: RTL; copiar usa a área de transferência do renderer; nenhuma ação destrutiva; faixa nunca aparece sem o selo "provisório".
- Aceite: fluxo "selecionar arquivo → ver raio → disparar `legadox-raio`" cabe em 3 cliques; textos sem "morto" fora de "candidato".
- Depende: T-17.39, T-17.30, T-17.34.

### 10.7 Qualidade

### T-17.43 · Teste contra o próprio ExpxDev (projeto real)
- Arquivos: `tests/mapa/expxdev-real.test.ts`.
- Analisa a **raiz do repositório** (somente leitura) e confere: ≥ 500 arquivos TS; nenhum crash; arestas `importa` entre arquivos do projeto **≥ 95% de concordância com o oráculo** (só no teste: `typescript` do `devDependencies` — `ts.preProcessFile` + `ts.resolveModuleName` com o `tsconfig`); ≥ 85% das `importa` com confiança `exata` (P-252); entradas `ipcMain.handle`/canais `*:*` e rotas MCP detectadas; ciclos iguais aos do oráculo; **raio** de `src/nucleo/metodo/comandos.ts`: chamadores por import = os do oráculo; hotspots incluem os arquivos de maior churn calculado independentemente por `git log --name-only`; `docs/**` **idêntico** antes e depois; tempo ≤ 10 s (fator `EXPXV_PERF_FATOR`).
- Aceite: verde sem relaxar limite; divergências viram caso de teste nas fixtures.
- Depende: T-17.21, T-17.30, T-17.22.

### T-17.44 · Passe de desempenho
- Arquivos: `tests/perf/mapa.perf.ts`, `tests/fixtures/mapa/gerar-repo-grande.ts` (gerador determinístico por semente: 5 000 arquivos TS com distribuição realista de imports/chamadas, + variante de 20 000 só para estresse não bloqueante), `scripts/perf.mjs`.
- Mede P-240 a P-252 (análise inicial, incremental, abrir tela, grafo 5 000/15 000, memória, peso, consultas, pacote, boot, história, reanálise, exportação), grava `docs/ade/perf/ultimo.json`; corrige a causa, **nunca** o limite (ajustes prováveis: tamanho do lote, nº de workers, índices SQLite, transações maiores, LOD).
- Aceite: P-240..P-252 verdes; P-01/P-08/P-12 sem piorar.
- Depende: T-17.21, T-17.38, T-17.40, T-17.41.

### T-17.45 · Fechamento: E2E, pacote e auditoria
- Arquivos: `tests/mapa.e2e.test.ts`, `scripts/verificar-pacote.mjs` (carrega as gramáticas e analisa uma fixture **no app empacotado**), `electron-builder.yml` (conferência de `asarUnpack`), `docs/ade/AUDITORIA-MAPA.md`, `tests/mapa/seguranca.test.ts`.
- E2E (Electron real): abrir workspace de fixture → Analisar (progresso) → Grafo (selecionar nó) → Fluxo → Exportar Mermaid → Método ▾ → `stackx-detectar` num Pane de CLI falsa (afirma o texto digitado e o caminho do pacote) → `legadox-raio` com arquivos; **`docs/**` idêntico**; zero diálogos nativos; sem processo órfão (`tests/limpeza.ts`).
  Segurança (`seguranca.test.ts`): repositório **hostil** com `package.json` `scripts`/`postinstall`, `.dependency-cruiser.js`, `webpack.config.js` e `Makefile` que gravam um **arquivo canário** → após a análise o canário **não existe**; `.env` e `*.pem` com conteúdo-isca **nunca abertos**; symlink para `/etc` não seguido; arquivo de 50 MB e arquivo que trava o parser são contidos (limite/timeout); `..` em manifestos não escapa da raiz; nenhuma chamada de rede; adaptadores não executam nada de dentro do projeto.
- Aceite: portão da fase (itens 5–7) cumprido; `AUDITORIA-MAPA.md` sem achado ALTA aberto.
- Depende: T-17.43, T-17.44, T-17.42.

## 11. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Linguagens sem gramática embarcada** (Kotlin, Swift, Scala, Dart, Perl, Delphi, VB, COBOL…) | Modo **degradado** (arquivo + LOC + imports por regex, `heuristica`) + **ctags opcional**; banner e contagem na UI; gramáticas novas só por compilação offline fora desta fase (P-270) |
| **Incompatibilidade runtime × gramática** (medida: `tree-sitter-wasms` 0.1.13 falha no 0.27) | versões **exatas** e juntas; teste que carrega todas as gramáticas (T-17.02) e conferência no `verificar` e no `test:pacote` |
| **Monorepos gigantes** (> 50 000 arquivos) | `git ls-files` (rápido e correto), lotes, incremental, teto de 150 000, aviso a partir de 20 000 e **seleção por subpasta** (`mapa.ignorar`/escopo); agrupamento e LOD na UI; P-240/P-250 medem |
| **Imports dinâmicos, aliases de bundler, `require(expr)`** | config de bundler **não** executada; alias por sufixo único = `heuristica`; `nao_resolvido` contado e visível; `index.scip` importado sobe a confiança (T-17.36) |
| **Falsos positivos de código morto** | só "candidato" com confiança e exclusões (entradas, API pública, decorados, referenciados por config, dinâmicos); jamais "remover" |
| **Peso dos `.wasm` no pacote universal** | ≈ 18 MB em disco / ≈ 1,6 MB gz; `.wasm` independentes de arquitetura (não duplicam); **uma** pasta em `asarUnpack` (limite de 65 536 caracteres do glob do `@electron/universal`); orçamento P-245; Onda configurável por flag de build |
| **Reflexão, DI por convenção, metaprogramação** (Spring, Laravel `app()->make`, Rails, C# DI, `method_missing`) | `dinamicos` marcados por arquivo; DI do C# (`AddScoped<I,T>`) e `@Autowired` resolvem parte (`heuristica`); no raio, aresta dinâmica possível ⇒ **pior caso declarado** |
| **Nomes genéricos geram falsos chamadores** | stoplist, limite de 5 candidatos, `candidatos` na aresta, raio com `min`/`max` |
| **CPU/memória competindo com PTY e UI** (P-04/P-05) | segundo plano usa **1 worker**; "Analisar agora" até 3; encerra workers ociosos em 30 s; sem tarefa > 50 ms no main; P-244 |
| **Privacidade** (nomes, assinaturas e 1ª linha de comentário no banco) | nada sai da máquina (D-23); redação de segredos; nunca `.env`/chaves; sem código-fonte no banco; **"Apagar mapa"**; autores só como contagem para agentes |
| **Repositório hostil** (arquivo gigante, parser lento, symlink, `..`) | limite de 1 MB, timeout de 5 s por arquivo com worker morto e recriado, symlink fora da raiz ignorado, normalização de caminhos; teste canário (T-17.45) |
| **Skills ignoram a dica** | o mapa é **consultivo**; o inventário diz "confirme por amostragem"; stackx/legadox seguem donos e não dependem do mapa para funcionar |
| **Canvas da Fase 15 ausente ou diferente** | T-17.40 **estende** `GrafoCanvas`/`GrafoWorker` (T-15.43) e os move para `componentes/grafo/`; se a Fase 15 não o entregou, a Fase 17 o cria com a mesma API e a 15 o adota; um só componente |
| **`worker_threads` no app empacotado (asar)** | `asarUnpack` + teste do pacote (T-17.45); funciona no Electron 37.10.3 com `ELECTRON_RUN_AS_NODE` (`base/H` §2.3) |
| **Windows** (caminhos, CRLF, aspas do `git ls-files`) | `-z`, normalização para `/`, testes de unidade; sem máquina Windows (risco D-26, P-06) |
| **Estimador de tokens impreciso** (`RESUMO.md`) | caracteres/4 com folga de 15%; teste fixa o teto em bytes também |
| **Definição de "chamador"** diverge do legadox | D-168: arquivos distintos, sem testes, diretos + 1 nível; o JSON declara o método e a skill pode recalcular |

## 12. Ordem de execução e paralelismo (áreas de arquivos disjuntas; ≤ 5 agentes; ninguém edita o mesmo arquivo)

```
Onda 0  T-17.01                                                            (1 agente)
Onda 1  A: T-17.02   B: T-17.03 → T-17.04   C: T-17.20 → T-17.22            (3 em paralelo)
Onda 2  D: T-17.05   E: T-17.06 (cria os stubs de extratores e o registro)  (2)
Onda 3  extratores, 1 agente por linguagem (arquivos próprios + fixtures próprias):
        ag1 T-17.07 → T-17.08 | ag2 T-17.09 → T-17.11 | ag3 T-17.10 → T-17.13 | ag4 T-17.12 → T-17.14 | ag5 T-17.15
        (enquanto isso, análises puras sobre grafos de teste: T-17.23, T-17.24, T-17.25 e T-17.26 só dependem de T-17.20)
Onda 4  T-17.16 / T-17.17 / T-17.18 (resolvedores, 3 agentes) → T-17.19 → T-17.21
        análises restantes: T-17.27, T-17.28, T-17.29 → T-17.30
Onda 5  T-17.31 → T-17.32 · T-17.33 → T-17.34 · T-17.35 · T-17.36 · T-17.37 → T-17.38   (até 5 em paralelo, áreas disjuntas)
Onda 6  UI: T-17.39 → T-17.40 · T-17.41 · T-17.42   (T-17.39 pode começar com IPC falso assim que T-17.33 fixar os tipos)
Onda 7  T-17.43 · T-17.44 → T-17.45                                        (T-17.43 e T-17.44 em paralelo)
Fim da fase: portão da fase, registro no STATUS.md (pelo coordenador), decisões D-160..D-170 conferidas, pendências P-270..P-279.
```

Áreas de arquivos por agente (nunca cruzam): `src/nucleo/mapa/{gramaticas,linguagens}.ts + package.json + electron-builder.yml + scripts/` (T-17.02) · `varredura/gitignore/armazem` (T-17.03/04) ·
`grafo/**`, `git-historia.ts` (T-17.20/22) · `pool/worker-extracao` (T-17.05) · `extratores/<lang>.ts` + `tests/fixtures/mapa/<lang>/` (um por agente) · `resolucao/*` ·
`analises/*` (um arquivo por task) · `mcp/tools/mapa.ts` · `main/ipc/mapa.ts` · `renderer/telas/mapa/*`. Arquivos **compartilhados** (`src/compartilhado/ipc.ts`, `src/main/servicos.ts`,
`src/preload/preload.ts`, `src/nucleo/mcp/catalogo.ts`, `package.json`, `electron-builder.yml`) são tocados por **uma** task cada, na ordem acima; quem precisar de mudança neles fora da sua task
registra pedido em `STATUS.md` → "Bloqueios" em vez de editar. O coordenador integra, roda `npm run verificar` e atualiza `STATUS.md` e `05-CONTRATOS.md`.

Dependências de outras fases: Fase 6 (**6A**: `ExecutorVcs`, observador — T-06.02/T-06.03), Fase 4 (`comandoDeSkill`, `metodo:disparar`, observador de `docs/**`), Fase 3 (MCP), Fase 15 (canvas e RAG — contratos em T-17.35 e T-17.40), Fase 0 (`node:sqlite`, perf).
A Fase 17 não bloqueia nenhuma outra.

## 12b. Backlog imediato pós-portão (opção mais completa, D-140; fora da contagem das 45 tasks, mesma disciplina TDD)

Construídos **inteiros** logo depois do portão da fase, na ordem abaixo, sem bloquear o portão. Cada um tem consentimento/opt-in quando sai do padrão seguro:

- **B1 · Gramáticas extras** (Kotlin, Swift, Scala, Dart, C puro, SQL): `scripts/gerar-gramaticas.mjs` compila os `.wasm` a partir das gramáticas oficiais (MIT) com `tree-sitter-cli` 0.25.x + emscripten/Docker — instalação **pontual e reversível** autorizada pela regra geral 3, registrada em `STATUS.md` (**[depende do dono: confirmar na hora]**, P-270); extratores no mesmo molde da Onda 1; flag de build `EXPXV_MAPA_LINGUAGENS` para controlar o peso (P-271).
- **B2 · Resolvedor TypeScript exato** (opt-in por workspace, consentimento digitado): processo filho com o `typescript` **do projeto** para `resolveModuleName`; só com selo "carrega código do `node_modules` do projeto"; eleva imports para `exata`.
- **B3 · Adaptadores opcionais de análise profunda**: Joern (se estiver no PATH) e Semgrep com **regras próprias** (nunca as do registro, licença restritiva), como fontes extras de arestas/entradas, sempre com confiança e origem rotuladas.
- **B4 · Gerar índice SCIP** (opt-in, consentimento digitado, aviso de que o indexador **compila/typechecka o projeto e pode executar ferramentas de build**; em sandbox quando existir; desligado por padrão) — o importador de leitura (T-17.36) já existe (P-273).
- **B5 · História para SVN** (`svn log --xml -v`, depois de P-11 instalar o `svn`) e acoplamento temporal equivalente.

## 13. Decisões [LAC] resolvidas (registradas como D-160 a D-170 em `01-DECISOES.md`)

- **[LAC-17.1] Onde guardar o mapa?** [DEC] banco em `<userData>/mapas/<workspace_id>/mapa.db` (cache reconstruível, fora do repositório) + pacote **pequeno** em `.expxv/mapa/<carimbo>/` para as skills lerem (contrato §5); nunca `docs/**`. *Descartado:* tudo em `.expxv/` (inflaria o repositório do usuário), tudo em `<userData>` (a CLI pediria permissão para ler fora do cwd).
- **[LAC-17.2] Embutir ou reimplementar?** [DEC] embutir só o **parser** (`web-tree-sitter` + gramáticas), reimplementar o resto (extração, resolução, análises); ferramentas prontas (madge, skott, dependency-cruiser, code-maat, pyan…) descartadas ou só como modelo (D-160).
- **[LAC-17.3] O que fazer com ferramentas que exigem build/instalação do projeto (SCIP, jdeps, LSP)?** [DEC] **nunca executar** (D-162); só ler artefato pronto (`index.scip`, lcov…).
- **[LAC-17.4] Como contar "chamadores" para o raio?** [DEC] arquivos distintos, sem testes e sem o alvo, diretos + 1 nível indireto até a fronteira de entrada; `min` (exatas) e `max` (com heurísticas); faixa pelo `max` (D-168).
- **[LAC-17.5] Quem decide a faixa do raio?** [DEC] o ADE calcula **provisória**; o `avaliador-de-raio` do legadox classifica; ALTO exige aprovação humana (D-21, D-166).
- **[LAC-17.6] Cobertura sem rodar testes?** [DEC] estimativa por convenção (rotulada `estimada`) e importação de relatório existente (`medida`); o ADE **não executa a suíte** (D-162).
- **[LAC-17.7] Onde ler os limiares e as zonas do legadox?** [DEC] leitura tolerante e somente leitura de `docs/legado/PERFIL.md` quando existir; senão padrão do `SKILL.md` e zonas candidatas marcadas "candidata".
- **[LAC-17.8] Canvas e layout do grafo: criar outro?** [DEC] **não**: a Fase 15 (T-15.43) já tem canvas 2D + layout Barnes-Hut em worker; a Fase 17 os estende (LOD, agrupamento, semente, tracejado) e os move para `componentes/grafo/`; quem chegar primeiro cria, a outra adota (D-165, D-169).
- **[LAC-17.9] Quantos workers?** [DEC] 1 em segundo plano, até 3 em "Analisar agora"; ≈ 20 MB por worker extra medido (P-244).
- **[LAC-17.10] Duplicação e histórico dos autores?** [DEC] duplicação desligada por padrão; nomes de autor só na UI local, agentes recebem contagens.
- **[LAC-17.11] Tools MCP de disparo?** [DEC] não existem (agentes não iniciam análise nem disparam skills; D-167); só o humano, pela UI.
- **[LAC-17.12] Exportar para dentro de `docs/`?** [DEC] **recusado** pelo main (D-04); o usuário escolhe outra pasta.
- **[LAC-17.13] SVN?** [DEC] mapa estrutural funciona sem VCS; história indisponível (`historia:"indisponivel"`) e sinais de churn viram pior caso; `svn log` é o B5 do backlog imediato (P-278).
- **[LAC-17.14] Numeração de decisões, pendências e orçamentos?** [DEC] os blocos pedidos (D-90.., P-40.., P-80..) já estavam ocupados por outras fases; usados D-160..D-170, P-270..P-279 e P-240..P-252, sem tocar nos números existentes.
- **[LAC-17.15] Mapa × regra do dono "opção mais completa" (D-140)?** [DEC] padrões seguros mantidos e **toda** capacidade mais ampla construída como opt-in (instalação de ferramentas, indexadores SCIP, resolvedor TS exato, gramáticas extras): ver §12b.
