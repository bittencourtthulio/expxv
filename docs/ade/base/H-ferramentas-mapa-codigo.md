# H · Ferramentas de mapa lógico do código (pesquisa da Fase 17)

Pesquisa **somente leitura** feita em 2026-09-30 para a Fase 17 (`../fase-17-mapa-codigo.md`). Pedido do dono: o ADE roda uma análise do
código do projeto (legado, em especial), monta um mapa lógico (grafo, fluxo, dependências) e esse mapa alimenta o stackx e o legadox.
Foram avaliadas **67 entradas** (cerca de 75 ferramentas e pacotes, contando os grupos). Pergunta: que ferramentas open source já fazem isso, o que dá para **embutir**, o que fica como **binário externo opcional**, o que é
melhor **estudar e reimplementar**.

## 0. Como ler (método, convenções e limites)

- **Consulta**: todas em **2026-09-30**. Fontes: `gh api repos/<dono>/<repo>` (licença SPDX, `archived`, `pushed_at`, release mais recente,
  estrelas), `https://registry.npmjs.org/<pacote>/latest` (versão, licença, `unpackedSize`), páginas `README`/docs lidas por fetch, e **medições
  próprias** (seção 2) feitas com `node` e com o Electron 37.10.3 do próprio repositório (`ELECTRON_RUN_AS_NODE=1`), sem instalar nada.
  Tarballs npm foram **baixados e abertos numa pasta temporária** (nenhum `npm install`, nenhum `brew`, nada pago, nenhum cadastro).
- **Selos**: `[V]` = confirmado na consulta citada; `[M]` = medido por mim nesta máquina (Apple Silicon, Node 22.23, Electron 37.10.3 = Node 22.21.1);
  `[C]` = conhecimento prévio **não reconfirmado hoje** (tratar como "não confirmado" até a task de implementação conferir); "não confirmado" = não consegui verificar.
- **Licença**: SPDX da API do GitHub; quando a API devolveu `NOASSERTION`/`Other` li o texto do `LICENSE` e digo o que vi.
- **Regras do dono aplicadas**: copyleft forte (GPL/AGPL) **nunca** entra no pacote — só binário externo opcional, executado como processo à parte, sem
  vincular, sem copiar código; **LGPL/MPL/EPL** (copyleft fraco) também **não** são embutidos sem necessidade (decisão D-161); estudar código exige
  **atribuição** e, para GPL, apenas **documentação e ideias** (clean-room): não se copia nem se traduz código GPL.
- **Princípio de segurança que filtra tudo (D-162)**: o ADE **nunca executa o código analisado** nem os build tools do projeto (gradle/maven/npm
  scripts/cmake/`composer` com plugins). Ferramenta que exige compilar ou instalar o projeto só entra, por padrão, como **leitura de artefato que o usuário já gerou**; rodá-la é **opt-in com consentimento** (backlog B4 do plano, regra D-140 do dono).
- **Peso**: pacote `.dmg` universal; orçamento do renderer: JS inicial ≤ 350 KB gz (P-08); worker/chunks lazy não contam no P-08, mas contam no tamanho do pacote
  e no startup só quando carregados (D-163: nada da Fase 17 é carregado no boot).

## 1. Resumo das decisões (a leitura rápida)

| Decisão | Ferramentas |
|---|---|
| **EMBUTIR** (dependência/WASM empacotada) | `web-tree-sitter` 0.27.0 (MIT) + gramáticas `@vscode/tree-sitter-wasm` 0.3.1 (MIT) (e **nenhuma biblioteca de grafo**: o canvas e o layout de forças são os da Fase 15, T-15.43) |
| **EXTERNO OPCIONAL** (usuário já tem; nunca embutido; processo à parte, argumentos separados, sem shell) | `universal-ctags` (GPL-2.0, só para linguagens sem gramática), `dot` do Graphviz (SVG a partir de DOT), `scc`/`tokei` (contagem rápida de LOC, cruzamento), índice SCIP **já gerado** (`index.scip`, só leitura) e relatórios de cobertura **já gerados** (lcov/Cobertura/JaCoCo/`go cover`) |
| **ESTUDAR E REIMPLEMENTAR** | aider repo-map (tags + PageRank), code2flow (grafo de chamadas por nome), stack-graphs (ideia de resolução de nomes por escopo; arquivado), dependency-cruiser/deptrac/import-linter/ArchUnit/Packwerk (formato de **regras de fronteira**: importamos os arquivos de regras estáticos), code-maat/CodeScene (hotspots: churn × complexidade, acoplamento temporal), lizard/radon (definição de complexidade), cpp-dependencies, Sourcetrail e Serena (UX/ferramentas de consulta por símbolo), jQAssistant (modelo de grafo) |
| **DESCARTAR** | madge, skott, ts-morph/compilador TS embutido, `node-tree-sitter` (nativo), pydeps/pyan/pycallgraph, jdeps, jQAssistant (como motor), godepgraph, cargo-depgraph/cargo-modules (como motor), phpda, NDepend, CodeQL (licença restrita), Semgrep (nesta fase), Joern (nesta fase), cloc, git-of-theseus, Mermaid como renderizador, `@viz-js/viz`, d2, PlantUML, Cytoscape.js, elkjs, repomix/code2prompt (como motor), Greptile-like (SaaS) |

**Arquitetura recomendada (síntese, seção 6)**: núcleo próprio multi-linguagem sobre `web-tree-sitter` em `worker_threads` (viabilidade **medida**: funciona no
Electron 37.10.3, 2,5 MB de TypeScript em 0,3–0,8 s), extratores por linguagem com **confiança por aresta** (exata/heurística), armazenamento SQLite local,
adaptadores opcionais para o que o usuário já tem instalado.

## 2. Medições próprias (prova de viabilidade; reproduzíveis)

Pasta temporária (descartada depois): `.../scratchpad/t/`. Tarballs baixados de `registry.npmjs.org` e abertos com `tar`. Máquina: `hw.ncpu = 11`.

### 2.1 Compatibilidade runtime × gramáticas (achado crítico) `[M]`

| Combinação | Resultado |
|---|---|
| `web-tree-sitter` **0.27.0** + gramáticas de **`tree-sitter-wasms` 0.1.13** (Unlicense, publicado 2025-10-07) | **FALHA**: `Language.load` lança no `getDylinkMetadata` para typescript, python, java, go, php (formato do `.wasm` incompatível com o runtime novo) |
| `web-tree-sitter` **0.27.0** + gramáticas de **`@vscode/tree-sitter-wasm` 0.3.1** (MIT, 2026-04-07; compiladas com `tree-sitter-cli ^0.25.10`) | **OK** para typescript (ABI 14), tsx (14), javascript (15), python (15), java (14), go (15), php (15), ruby (14), rust (15), c-sharp (15), cpp (14) |
| Runtime próprio do `@vscode/tree-sitter-wasm` (`wasm/tree-sitter.js` + `tree-sitter.wasm`) | OK (mesmas linguagens) |

Conclusão: **fixar as duas versões juntas** e proteger com um teste de carga de TODAS as gramáticas embarcadas (T-17.02). Trocar uma sem a outra quebra silenciosamente.
Gramáticas que o `@vscode/tree-sitter-wasm` **não** traz: C puro (usa-se a gramática `cpp`, que parseia C quase todo), Kotlin, Swift, Scala, Dart, Lua, SQL, Objective-C,
Elixir… (as do `tree-sitter-wasms` antigo cobrem várias, mas falham no runtime novo; recompilar exige emscripten/Docker = tarefa de manutenção offline, fora desta fase).

### 2.2 Tamanho `[M]` (bytes; gz = `gzip -9`)

| Artefato | bruto | gz |
|---|---:|---:|
| `web-tree-sitter.wasm` (runtime) | 209 613 | 82 886 |
| `web-tree-sitter.cjs` (cola JS) | 168 237 | 32 835 |
| gramática typescript / tsx | 1 413 849 / 1 445 638 | 132 982 / 135 884 |
| javascript | 411 770 | 49 425 |
| python | 457 883 | 64 341 |
| java | 414 641 | 50 285 |
| go | 217 182 | 37 528 |
| php | 1 058 041 | 104 861 |
| ruby | 2 106 352 | 161 654 |
| rust | 1 113 644 | 114 306 |
| c-sharp | 5 103 332 | 301 355 |
| cpp (cobre C) | 5 394 393 | 406 474 |
| **Conjunto da Onda 1 (ts, tsx, js, py, java, php, c-sharp, go) + runtime** | **≈ 9,6 MB** | **≈ 0,95 MB** |
| **Conjunto completo (11 gramáticas + runtime)** | **≈ 17,9 MB** | **≈ 1,5 MB** |

No `.dmg` (comprimido) o custo é ~1,5 MB; em disco instalado ~18 MB. Os `.wasm` são **independentes de arquitetura** (um arquivo serve arm64 e x64; não duplicam no
empacotamento universal). Não entram no JS inicial (P-08) nem no boot (carregados no worker, sob demanda **por linguagem**).

### 2.3 Velocidade e memória `[M]`

Corpus: o próprio repositório ExpxDev (`src/**` e `tests/**`, 532–536 arquivos `.ts/.tsx`, 2,45–2,49 MB).

| Teste | Resultado |
|---|---|
| `Parser.init` (runtime) | ≈ 6,5 ms |
| `Language.load` de cada gramática (do disco) | 2–9 ms |
| Parse de `src/main/servicos.ts` (12,7 KB) | ≈ 2,3–2,8 ms |
| Parse + percorrer **todos** os nós (865 mil nós), 1 worker | 0,77–1,32 s |
| Idem, 4 workers (`worker_threads`) | 0,30–0,66 s |
| Idem, 4 workers **dentro do Electron 37.10.3** (`ELECTRON_RUN_AS_NODE`) | 0,49 s (funciona; V8 13.8 / Node 22.21.1) |
| Parse + **consulta Tree-sitter** (imports, defs, chamadas; 39 124 capturas) em 2,49 MB, 1 thread | 0,85 s (≈ 2,9 MB/s); compilar 2 consultas: 47 ms |
| Pico de memória (RSS do processo) | 1 worker 112 MB; 2 workers 132 MB; 4 workers 175 MB (base do Node ≈ 40 MB; **≈ 20 MB por worker extra**) |

Extrapolação (**estimativa**, medir na T-17.38): 5 000 arquivos TS (≈ 25–40 MB) ≈ 9–14 s em 1 thread; com 3 workers ≈ 4–6 s antes de resolução de imports,
persistência e `git log`. O orçamento "≤ 30 s" (P-240) tem folga de ~3×.

### 2.4 Pesos de visualização `[M]` (min.js, bruto / gz)

| Biblioteca | Licença | bruto | gz |
|---|---|---:|---:|
| `d3-force` 3.0.0 | ISC | — | ≈ 3 007 |
| `d3-quadtree` + `d3-dispatch` + `d3-timer` (deps do d3-force) | ISC | 9 127 | ≈ 4 035 |
| `sigma` 3.0.3 (WebGL) | MIT | 187 876 | 47 209 |
| `graphology` 0.26.0 | MIT | 73 629 | 13 893 |
| `@dagrejs/dagre` 3.1.1 | MIT | 48 956 | 17 076 |
| `cytoscape` 3.34.3 | MIT | 435 503 | 136 466 |
| `elkjs` 0.12.0 (bundled) | EPL-2.0 OR GPL-3.0+ | 1 609 707 | 466 718 |
| `@viz-js/viz` 3.31.0 (Graphviz em WASM) | MIT (wrapper) | ≈ 1 189 000 | não medido |
| `mermaid` 12.0.0 | MIT | 124 593 065 B desempacotado (`unpackedSize`) | não medido |

## 3. Parsing multi-linguagem (categoria a)

| Ferramenta | Licença `[V]` | Linguagens | O que extrai | Formato de saída | Como roda | Peso | Manutenção `[V]` | DECISÃO |
|---|---|---|---|---|---|---|---|---|
| **Tree-sitter** (`tree-sitter/tree-sitter`) | MIT | 100+ gramáticas na comunidade | árvore de sintaxe concreta incremental, consultas S-expression | API (nós, `Query`) | biblioteca C; bindings: WASM, Node nativo, Rust… | — | v0.27.0; push 2026-09-30; 27 097★ | **EMBUTIR** (via `web-tree-sitter`) |
| **web-tree-sitter 0.27.0** | MIT | as dos `.wasm` carregados | idem, em WASM | API JS/TS (`Parser`, `Language`, `Query`); CJS + ESM | lib JS pura + 1 `.wasm`; **funciona em `worker_threads` no Electron 37 `[M]`** | 209 KB wasm + 168 KB js (115 KB gz juntos); 0 dependências | publicado 2026-08-30 | **EMBUTIR** (núcleo da Fase 17) |
| **`@vscode/tree-sitter-wasm` 0.3.1** | MIT | bash, c-sharp, cpp, css, go, ini, java, javascript, php, powershell, python, regex, ruby, rust, tsx, typescript | gramáticas pré-compiladas do VS Code | `.wasm` | arquivos | 22 MB desempacotado (usamos ≈ 18 MB) | 2026-04-07 | **EMBUTIR** (somente as gramáticas escolhidas, copiadas por `scripts/copiar-ativos.mjs`) |
| `tree-sitter-wasms` 0.1.13 | Unlicense (metadado npm) | ~36 (inclui kotlin, swift, scala, dart, c, objc, lua, elixir…) | idem | `.wasm` | arquivos | 51,8 MB | 2025-10-07 | **DESCARTAR** (incompatível com o runtime 0.27 `[M]`; só reavaliar se alguém recompilar) |
| gramáticas oficiais `tree-sitter-{typescript,javascript,python,java,go,c-sharp,php,ruby,rust,cpp,c}` | MIT (11/11 `[V]` pela API) | uma cada | — | fonte da gramática | referência para nomes de nós/consultas | — | todas com push em set/2026 | **EMBUTIR indiretamente** (via .wasm); atribuição de licença em `THIRD-PARTY`, T-17.02 |
| `tree-sitter-kotlin` (fwcd), `tree-sitter-sql` (DerekStride) | MIT | Kotlin; SQL | — | gramática | sem `.wasm` pronto compatível | — | 2026-09 | **ESTUDAR / backlog** (compilar `.wasm` offline) |
| `node-tree-sitter` | MIT | idem | idem | API Node | **addon nativo** (rebuild por arquitetura; quebra o build universal e D-08) | — | push 2026-07-29 | **DESCARTAR** |
| `tree-sitter-graph` | Apache-2.0 | gramáticas Tree-sitter | DSL declarativa que **constrói grafos** a partir da árvore | grafo | Rust (CLI/lib) | — | push 2024-12-11 (parado) | **ESTUDAR** (ideia: regra declarativa por linguagem); não usar |
| **ast-grep** `[V]` | MIT | dezenas via Tree-sitter | busca/lint/reescrita estrutural por padrão com metavariáveis; regras YAML | JSON (`--json`), SARIF `[C]` | CLI Rust; `@ast-grep/napi` (nativo) e `@ast-grep/wasm` (1,8 MB desempacotado) | CLI ≈ dezenas de MB `[C]` | v0.45.3, 2026-08-31; 16 087★ | **ESTUDAR** (regras como dado: padrões de entrada/dados); **não embutir** (já temos `Query` do Tree-sitter). Sem task nesta fase |
| **GitHub stack-graphs** | Apache-2.0 **e** MIT (README) | TS/JS, Python, Java e outras `[C]` (README não lista) | **resolução de nomes** (definição ↔ referência) por grafo de escopos | grafo / SQLite | Rust | — | **ARQUIVADO em 2025-09-09 `[V]`**; push 2025-09-09 | **DESCARTAR** (arquivado) e **ESTUDAR a ideia** (escopos + bindings) para o resolvedor de chamadas |
| **Sourcegraph SCIP** (`scip-code/scip`) | Apache-2.0 | formato; indexadores: scip-typescript (TS/JS), scip-java (Java/Scala/Kotlin), scip-python, scip-clang (C/C++), scip-dotnet (C#/VB), scip-ruby, scip-go, scip-dart, scip-php, rust-analyzer | símbolos, ocorrências (definição/referência/import), relações (implementação), documentação | **protobuf** `index.scip` (esquema lido em `scip.proto` `[V]`: `Index{metadata=1, documents=2, external_symbols=3}`, `Document{relative_path=1, occurrences=2, symbols=3, language=4}`, `Occurrence{range=1 (obsoleto), symbol=2, symbol_roles=3, single_line_range=8, multi_line_range=9}`, papéis `Definition=1, Import=2, WriteAccess=4, ReadAccess=8, Test=32`) | cada indexador exige **toolchain da linguagem e compila/typecheca o projeto** (scip-java chama Gradle/Maven) | indexadores: de MB a centenas de MB | scip-typescript 0.4.0 (2026-06-30); scip-java push 2026-09-26; repo `scip-code/scip` push 2026-09-29 | **EXTERNO OPCIONAL, somente leitura**: o ADE **não executa indexadores** (D-162); **importa** um `index.scip` que o usuário/CI já gerou e sobe a confiança das arestas para `exata` (T-17.30). Decodificador protobuf mínimo próprio (~150 linhas, sem dependência) |
| `lsif-node` / LSIF | MIT | JS/TS | idem, formato antigo | JSON LSIF | Node | — | **arquivado** (push 2022-07-20) | **DESCARTAR** (SCIP o substituiu) |
| **universal-ctags** | **GPL-2.0** | 100+ (inclui Kotlin, Swift, Perl, Lua, Pascal, COBOL, VB…) | **definições** (função, classe, método, variável), com linha; sem chamadas | `tags` e JSON-lines (`--output-format=json` depende de a build ter `libjansson` — não confirmado) | binário C (`brew install universal-ctags`) | ≈ 2–5 MB `[C]` | v6.2.1 (2025-10-25); push 2026-09-27; 7 292★ | **EXTERNO OPCIONAL** (GPL: nunca embutido; processo à parte). Usado só para linguagens **sem gramática embarcada**; entrega nós `simbolo` com confiança `heuristica` e nenhuma aresta de chamada (T-17.31) |
| Servidores LSP (typescript-language-server, pyright, jdtls, gopls…) | variadas | uma cada | referências exatas | JSON-RPC | processos longos, muitos compilam/indexam o projeto, memória alta | 100 MB+ `[C]` | — | **DESCARTAR nesta fase** (viola D-162 e o orçamento de memória); anotar como evolução (backlog) |

## 4. Grafos de dependência por ecossistema (categoria b)

| Ferramenta | Licença `[V]` | Linguagens | O que extrai | Saída | Como roda | Peso | Manutenção `[V]` | DECISÃO |
|---|---|---|---|---|---|---|---|---|
| **dependency-cruiser** | MIT | JS, TS, CoffeeScript, ES6/CJS/AMD (+Vue/Svelte `[C]`) | grafo de imports, **regras** `forbidden/allowed`, ciclos, órfãos | JSON, DOT, Mermaid, CSV, HTML, texto | Node; 18 deps; 1,0 MB desempacotado; usa o `typescript`/babel **do projeto**; **config `.dependency-cruiser.js` é JS executável** | médio | **18.5.0, 2026-09-30**; 7 241★ | **ESTUDAR** (modelo de regras de fronteira) + **importar** regras de `.dependency-cruiser.json` estático para a análise de camadas (T-17.28). **Não executar** (config em JS executa código do projeto) nem embutir |
| **madge** | MIT | JS/TS/CSS pré-processados | grafo de imports, ciclos | JSON, DOT, imagem (via Graphviz) | Node; 12 deps | 105 KB | 8.0.0, **2024-08-05** (push 2026-01-21) | **DESCARTAR** (menos mantido; subsumido pelo nosso extrator + dependency-cruiser como modelo) |
| **skott** | MIT | JS/TS | grafo, ciclos, dependências não usadas, app web | JSON/DOT/Mermaid `[C]` | Node; 24 deps | 298 KB | 0.35.12, 2026-09-11 (repo oficial: **não confirmado**, a URL que tentei devolveu 404) | **DESCARTAR** como motor; **ESTUDAR** a ideia de "dependência declarada não usada" (T-17.19) |
| **ts-morph** / API do compilador TypeScript | MIT / Apache-2.0 | TS/JS | tipos, símbolos e referências **exatas**, `resolveModuleName` | objetos | Node; ts-morph 28.0.0 (1,5 MB) **+ o pacote `typescript`** (a versão `latest` hoje, 7.0.2, tem 20 deps e 2,5 MB: pacote de transição, detalhes não confirmados) | dezenas de MB `[C]`; startup de `Program` de segundos em repo grande `[C]` | ts-morph 2026-04-12 | **DESCARTAR embutir**; **opcional no futuro**: resolver de módulos usando o `typescript` do **projeto**, só com consentimento (T-17.36, fora do caminho crítico) |
| **pydeps** | BSD-2-Clause | Python | grafo de imports entre módulos (clusters), JSON `--show-deps` | DOT/SVG (precisa de Graphviz), JSON | Python no PATH; analisa bytecode/`modulefinder` (não confirmado se importa módulos) | leve | push 2026-09-30; 2 117★ | **DESCARTAR** (nosso extrator Python resolve imports estaticamente; exigir Python/Graphviz piora a experiência) |
| **import-linter** | BSD-2-Clause | Python | **contratos** (layers, forbidden, independence) sobre grafo de imports (via `grimp`) | texto | Python; exige o pacote **instalado** no ambiente | leve | push 2026-09-16; 1 199★ | **ESTUDAR** formato; **importar** `.importlinter`/`setup.cfg` (INI, estático) como regras de camada (T-17.28) |
| **pyan** (`davidfraser/pyan` arquivado 2026-03-26; fork `Technologicat/pyan` ativo, push 2026-09-21) | **GPL-2.0** | Python | grafo de **chamadas/uso** estático por `ast` | DOT/SVG/HTML | Python | leve | idem | **DESCARTAR** (GPL; ideias já cobertas por code2flow MIT) — **não ler código** (clean-room) |
| **pycallgraph** (`gak`) | **GPL-2.0** | Python | grafo de chamadas **dinâmico** (executa o programa) | DOT/imagem | Python | — | **ARQUIVADO** (push 2024-04-09); fork `pycallgraph2` não localizado | **DESCARTAR** (executa código; GPL; arquivado) |
| **jdeps** (JDK) | GPL-2.0 + Classpath Exception `[C]` | Java (bytecode) | dependências entre pacotes/JARs/módulos | texto, DOT | `jdeps` do JDK; **exige classes compiladas** | no JDK | acompanha o JDK | **DESCARTAR** (exige build; nosso extrator Java lê o fonte) |
| **ArchUnit** | Apache-2.0 | Java (bytecode, em testes JUnit) | regras de arquitetura (camadas, ciclos, nomes) | resultado de teste | biblioteca no classpath do projeto | — | 2026-09-30; 3 847★ | **ESTUDAR** (vocabulário de regras em camadas/onion) |
| **jQAssistant** | **GPL-3.0** | Java (+Maven, outros por plugins `[C]`) | grafo do projeto em **Neo4j** (tipos, métodos, pacotes, relações `DEPENDS_ON`/`INVOKES`) | Neo4j/Cypher | JVM + Neo4j + Maven | pesado | push 2026-09-30; 296★ | **DESCARTAR** como motor (GPL + peso); **ESTUDAR** o modelo de nós/relações (documentação) |
| `go list -deps -json` | BSD-3-Clause `[C]` (toolchain Go) | Go | pacotes e imports exatos, resolvendo módulos | JSON | toolchain Go; pode **baixar módulos** (rede) e rodar cgo | no Go | com o Go | **EXTERNO OPCIONAL no futuro** (backlog; `GOFLAGS=-mod=mod GOPROXY=off`); nesta fase o extrator Go + `go.mod` bastam (imports Go são explícitos = confiança `exata`) |
| `godepgraph` (`kisielk`) | MIT | Go | grafo de pacotes | DOT | Go | — | push 2025-06-24 | **DESCARTAR** (redundante com o extrator Go) |
| **cargo-depgraph** (`jplatte`) | não confirmado (API não devolveu licença) | Rust | grafo de **crates** a partir de `cargo metadata` | DOT | cargo instalado | — | push 2026-05-13 | **DESCARTAR** (nosso leitor de `Cargo.toml`/`Cargo.lock` + `mod`/`use` por Tree-sitter) |
| **cargo-modules** (`regexident`) | **MPL-2.0** | Rust | árvore de módulos, órfãos, grafo de uso | DOT/texto | cargo + compila metadados | — | push 2026-09-24; 1 269★ | **ESTUDAR** (ideia "módulos órfãos"); não embutir |
| **NDepend** | comercial | .NET | dependências, métricas, regras CQLinq | relatório | Windows/VS | — | — | **DESCARTAR** (comercial). Alternativa nossa: extrator C# + grafo de `ProjectReference` (XML estático) |
| **phpda** (`mamuz/PhpDependencyAnalysis`) | MIT | PHP | grafo de dependências de classes | DOT/imagem (Graphviz) | PHP/composer | — | push **2023-12-03** (parado) | **DESCARTAR** |
| **deptrac** (`deptrac/deptrac`) | MIT | PHP | camadas por *collectors* (diretório, classe, atributo…) e violações | texto, JSON, GraphViz, Mermaid `[C]` | PHP 8 + composer (analisa o código **sem executá-lo**, mas precisa de PHP) | — | push 2026-09-20; 3 025★ | **ESTUDAR**; **importar** `deptrac.yaml` (YAML estático) como regras de camada (T-17.28) |
| **Packwerk** (Shopify) / **Zeitwerk** | MIT / MIT `[C]` | Ruby (Rails) | fronteiras por `package.yml`; convenção de autoload caminho ↔ constante | YAML / convenção | Ruby | — | Packwerk push 2026-08-26 | **ESTUDAR**: usar a **convenção Zeitwerk** (caminho → constante) no resolvedor Ruby (confiança `heuristica`) e importar `package.yml` como regras |
| **include-what-you-use** | licença do LLVM-style, API devolveu `NOASSERTION` (não confirmado o SPDX) | C/C++ | includes desnecessários/faltantes (usa Clang) | texto | Clang + `compile_commands.json` | pesado | push 2026-09-30 | **DESCARTAR** (exige Clang e compilação) |
| **cpp-dependencies** (`tomtom-international`) | Apache-2.0 | C/C++ | varre `#include`, agrupa por **componentes** (diretórios), ciclos | DOT/texto | binário C++ | leve | push 2026-01-13; 781★ | **ESTUDAR** (heurística de componentes por diretório) |
| **GNU cflow** / **cscope** | GPL-3.0 `[C]` / BSD-like `[C]` | C | grafo de chamadas / navegação | texto | binários | leve | não consultadas | **DESCARTAR** (a combinação nosso extrator C/C++ + ctags opcional cobre; licenças não reconfirmadas) |

## 5. Grafos de chamadas e fluxo (c), métricas (d), visualização (e), mapas para LLM (f)

### 5.1 Chamadas, fluxo e análise de segurança (categoria c)

| Ferramenta | Licença `[V]` | Linguagens | O que extrai | Saída | Como roda | Manutenção `[V]` | DECISÃO |
|---|---|---|---|---|---|---|---|
| **code2flow** (`scottrogowski`) | **MIT** | Python, JavaScript, Ruby, PHP | grafo de chamadas **por nome** (grupos, nós, arestas), poda por nó de entrada, ignora o que não resolve | DOT/PNG, JSON | Python; parsers do Ruby/PHP exigem runtimes deles `[C]` | push 2025-07-27; 4 614★; sem release no GitHub | **ESTUDAR E REIMPLEMENTAR** (é exatamente o modelo de resolução "por nome + escopo + marca de incerteza" que adotamos; MIT permite estudo com atribuição no cabeçalho dos arquivos inspirados) |
| **Joern / Code Property Graph** | Apache-2.0 | C/C++, Java, JS/TS, Python, Kotlin, Swift, PHP, Ruby, Go (varia por frontend `[C]`) | CPG: AST + CFG + fluxo de dados; consultas Scala | CPG (binário próprio), export GraphML/GraphSON/DOT `[C]` | **JVM** (JDK), instalação de centenas de MB `[C]`; v4.0.643 (2026-09-30) | push 2026-09-30; 3 540★ | **DESCARTAR nesta fase**; **backlog**: adaptador externo opcional se `joern` estiver no PATH. Estudar a noção de fluxo de dados para a análise de "dado → tabela" |
| **CodeQL** | queries MIT (`github/codeql`); **CLI sob termos restritos** | muitas | banco de código e consultas | SARIF/CSV | CLI proprietário; **uso gratuito só em código aberto/pesquisa; código privado exige GitHub Advanced Security pago `[V]`** (github/codeql-cli-binaries LICENSE.md) | push 2026-09-30 | **DESCARTAR** (o produto atende código de clientes; licença proíbe) |
| **Semgrep** | engine **LGPL-2.1**; regras do registro sob **Semgrep Rules License v1.0** (restritiva; texto da licença não lido: servidor devolveu 503) | 30+ | busca por padrão (metavariáveis), taint em alguns planos | JSON/SARIF | binário Python/OCaml | push 2026-10-01; 16 819★ | **DESCARTAR nesta fase**; **ESTUDAR** a sintaxe de padrões; adaptador opcional no backlog (somente regras próprias) |
| **Sourcetrail** | **GPL-3.0** | C/C++, Java, Python | grafo navegável símbolo ↔ uso em visual de "blocos" | SQLite próprio | app desktop C++ | **ARQUIVADO** (push 2021-12-13); 16 482★ | **ESTUDAR somente a UX pública** (como inspiração: painel de símbolo com "quem usa/quem é usado"); código GPL **não lido** |
| **Serena** (`oraios/serena`) | `NOASSERTION` ("Serena Licensing Overview", não confirmado o alcance) | via LSP | tools MCP de busca por símbolo (`find_symbol`, `find_referencing_symbols`) | MCP | Python + servidores LSP | push 2026-09-30; 29 922★ | **ESTUDAR** o desenho das tools (nossa `map_*` é por grafo local, sem LSP). Não copiar código (licença não confirmada) |

### 5.2 Métricas e hotspots (categoria d)

| Ferramenta | Licença `[V]` | Linguagens | O que extrai | Saída | Como roda | Manutenção `[V]` | DECISÃO |
|---|---|---|---|---|---|---|---|
| **scc** (`boyter`) | MIT | 300+ | LOC (código/comentário/branco), **complexidade estimada** por contagem de palavras-chave, bytes | JSON, CSV, texto | **binário Go** único (`brew install scc`) | v4.1.0 (2026-09-07); 8 790★ | **EXTERNO OPCIONAL** (cruzar totais e cobrir linguagens sem gramática) e **REIMPLEMENTAR** a contagem de LOC (simples; usamos Tree-sitter para comentários onde há gramática) |
| **tokei** | Apache-2.0 / MIT `[C]` (texto lido: Apache 2.0; API `NOASSERTION`) | 200+ | LOC por linguagem | JSON/YAML | binário Rust | push 2026-09-06 | **EXTERNO OPCIONAL** (alternativo ao scc; só se detectado) |
| **cloc** | **GPL-2.0** | 250+ | LOC | CSV/JSON/XML | Perl | push 2026-09-20 | **DESCARTAR** (GPL; scc/tokei bastam) |
| **lizard** | licença "estilo MIT" (API `NOASSERTION`; texto não casou com SPDX → **não confirmado**) | 30+ | complexidade ciclomática (CCN), NLOC, nº de parâmetros por função | CSV/XML/HTML/JSON `[C]` | Python | push 2026-09-28; 2 534★ | **ESTUDAR** (conjunto de tokens de decisão por linguagem) e **REIMPLEMENTAR** com Tree-sitter; opcional no PATH só para validação cruzada nos testes |
| **radon** | MIT | Python | CC, índice de manutenibilidade, Halstead, LOC | texto/JSON | Python | push **2024-10-20** | **ESTUDAR fórmulas** (CC, MI) e reimplementar |
| **code-maat** | **GPL-3.0** | agnóstico (lê `git log`) | **churn**, autores, **acoplamento lógico (co-alteração)**, idade, propriedade de código | CSV | **JVM** (Clojure; JAR) | 1.0.2 (jul/2025 push) ; evoluiu para o produto comercial CodeScene | **DESCARTAR** (GPL + JVM). **REIMPLEMENTAR** as ideias públicas (hotspot = churn × complexidade; acoplamento temporal = co-alterações / média de revisões) com `git log` próprio |
| **git-of-theseus** | Apache-2.0 | agnóstico | sobrevivência de linhas por idade/autor | PNG/JSON | Python | push **2023-11-25** | **DESCARTAR** (fora do pedido; parado) |
| CodeScene / SciTools Understand | comerciais | — | hotspots, acoplamento, grafos | produto | — | — | **DESCARTAR** (comerciais); CodeScene serve só de referência conceitual |
| **emerge** (`glato`) | MIT | multi-linguagem | grafo de dependências + métricas + modularidade em app web | JSON/HTML | Python | push 2026-08-07; 1 158★ | **ESTUDAR** a UX (não verificado em detalhe) |
| `git log` próprio (`git log --name-only --format=… -z`) | — | — | churn por arquivo, autores distintos, datas de criação/última alteração, pares co-alterados | texto delimitado | `git` da máquina via `ExecutorVcs` (Fase 6; `GIT_OPTIONAL_LOCKS=0`) | — | **EMBUTIR (código nosso)** |

### 5.3 Visualização e diagramas (categoria e)

| Ferramenta | Licença `[V]` | O que faz | Peso `[M]` | Manutenção | DECISÃO |
|---|---|---|---|---|---|
| **Mermaid** | MIT | texto → SVG (renderizador no navegador) | 124,6 MB desempacotado (23 deps) | v12.0.0, 2026-09-10; 90 493★ | **Apenas EXPORTAR texto Mermaid** (gerador próprio de `flowchart`/`graph`); **não embutir o renderizador** (peso; o dono cola em docs/Notion/GitHub, que renderizam) |
| **Graphviz** (`dot`) | EPL-1.0 `[C]` (repositório oficial fora do GitHub; o espelho do GitHub devolveu `archived`/sem licença) | layout hierárquico de DOT → SVG/PNG | binário ≈ MBs | — | **EXTERNO OPCIONAL** (exportar SVG "bonito" se `dot` estiver no PATH); **exportar DOT** sempre (texto) |
| `@viz-js/viz` 3.31.0 | MIT (wrapper) sobre Graphviz EPL | Graphviz compilado em WASM | ≈ 1,19 MB JS (wasm embutido) | 2026-09-28 | **DESCARTAR** (peso; layout `dot` é lento acima de ~1 000 nós `[C]`; nosso layout próprio basta) |
| **d2** | MPL-2.0 | texto → diagrama (binário Go) | — | push 2026-09-20; 25 547★ | **DESCARTAR** (formato a mais sem ganho; MPL) |
| **PlantUML** | LGPL-3.0 | diagramas por texto (Java) | JVM | push 2026-10-01 | **DESCARTAR** |
| **Structurizr** (DSL/C4) | não confirmado | modelo C4 (sistema → contêiner → componente) | — | — | **ESTUDAR** o **modelo C4** como hierarquia de agrupamento (sistema → módulo → arquivo); sem dependência |
| **d3-force** (+ quadtree/dispatch/timer) | ISC | simulação de forças (Barnes-Hut) para layout | **≈ 7 KB gz** | 3.0.0 (2022; estável) | **PLANO B só do layout** (D-165): a Fase 15 já tem layout Barnes-Hut próprio no worker (T-15.43, "sem biblioteca de grafo"); só se a extensão desse layout não alcançar o P-243 |
| **Sigma.js 3 + graphology** | MIT | renderização WebGL de grafos grandes | 47 KB + 14 KB gz = **≈ 61 KB gz** | sigma 2026-09-16 | **PLANO B** se o Canvas 2D próprio não alcançar P-243 na medição (T-17.34); não embutir antes |
| **Cytoscape.js** | MIT | grafos interativos completos | **136 KB gz** | 3.34.3, 2026-09-07 | **DESCARTAR** (peso; temos canvas próprio e o da Fase 15) |
| **elkjs** | EPL-2.0 OR GPL-3.0+ | layout em camadas de alta qualidade | 467 KB gz | 2026-07-17 | **DESCARTAR** (peso e licença) |
| **dagre** (`@dagrejs/dagre`) | MIT | layout em camadas | 17 KB gz | 2026-08-08 | **ESTUDAR**; layout em camadas próprio (já existe `camadas()` em `src/renderer/telas/metodo/Grafo.tsx`); dagre é a alternativa se o nosso ficar ruim no Fluxo |

### 5.4 Mapas de repositório para LLM (categoria f)

| Ferramenta | Licença `[V]` | Técnica | Saída | Manutenção | DECISÃO |
|---|---|---|---|---|---|
| **aider repo-map** | Apache-2.0 | Tree-sitter extrai **definições e referências** por arquivo (arquivos `*-tags.scm` por linguagem); monta grafo **arquivo → arquivo** (quem referencia símbolo definido em quem); **PageRank** (com personalização para os arquivos em conversa) ordena; corta num **orçamento de tokens** (`--map-tokens`, padrão 1 000; dinâmico) `[V]` docs.aider.chat/docs/repomap.html | texto compacto "arquivo → assinaturas importantes" | push 2026-05-22; 49 301★ | **ESTUDAR E REIMPLEMENTAR** (D-166): `Ordem de importância` = PageRank sobre nosso grafo de arquivos; o `RESUMO.md` entregue às skills respeita um **orçamento de tokens**; atribuição "inspirado em aider repo-map (Apache-2.0)" no cabeçalho do módulo `pagerank.ts` |
| **repomix** | MIT | empacota o repositório em XML/Markdown; modo `--compress` usa Tree-sitter para manter só assinaturas | arquivo único | v1.18.1, 2026-09-21; 28 621★ | **ESTUDAR** (ideia de compressão por assinaturas); não usar como motor |
| **code2prompt** | MIT | árvore + conteúdo + templates de prompt | texto | push 2026-09-25 | **DESCARTAR** (outro propósito) |
| Greptile e similares (grafo de repositório como SaaS) | proprietários | indexação remota | — | — | **DESCARTAR** (nada sai da máquina, D-23) |

## 6. Arquitetura recomendada

**Núcleo próprio multi-linguagem sobre `web-tree-sitter` (WASM) rodando em `worker_threads`, com extratores por linguagem que declaram a confiança de cada aresta, SQLite
local como armazém e adaptadores opcionais para o que o usuário já tiver.** Viabilidade **medida**: o par `web-tree-sitter 0.27.0` + `@vscode/tree-sitter-wasm 0.3.1`
carrega 11 gramáticas e analisa 2,5 MB de TS em 0,3–0,8 s dentro do Electron 37.10.3 (seção 2).

```
                 .gitignore + limites + hash por arquivo
 raiz do projeto ───────────────────────────────────────►  varredura (main, assíncrona, em lotes)
                                                                 │ lotes de arquivos novos/alterados
                                                                 ▼
                        pool de worker_threads (1–3 workers; gramática por linguagem sob demanda)
                        web-tree-sitter 0.27.0 + .wasm  ─►  extrator por linguagem (consultas .scm)
                                                                 │ Extracao (JSON por arquivo, cache por hash)
                                                                 ▼
        resolvedores por ecossistema (tsconfig paths, PSR-4, go.mod, pacote Java, PYTHONPATH, Zeitwerk, includes)
                                                                 │ arestas com confiança exata | heuristica
                                                                 ▼
 mapa.db (SQLite, schema_version) ─► grafo em memória (CSR) ─► análises (ciclos, camadas, raio, hotspots, morto…)
        ▲                                   │                         │
   adaptadores opcionais:                   ▼                         ▼
   ctags · scc/tokei · index.scip     MCP map_* · tela Mapa     pacote de contexto .expxv/mapa/<carimbo>/
   lcov/Cobertura/JaCoCo · git log        exportações             (stackx-detectar · legadox-perfil · legadox-raio)
```

**Linguagens** (prioridade pelo que mais aparece em legado): **Onda 1** TypeScript/JavaScript (incl. JSX/TSX), PHP, Java, C#, Python; **Onda 2** Go, Ruby, Rust,
C/C++ (via gramática `cpp`). Fora das gramáticas embarcadas (Kotlin, Swift, Scala, Dart, Perl, Delphi/Pascal, VB, COBOL…): modo **degradado** (arquivo + LOC próprio + imports
por expressão regular configurável, confiança `heuristica`), enriquecido por **ctags** se existir.

### 6.1 Resumo: o que é embutido, externo e reimplementado

| Categoria | Itens |
|---|---|
| **Embutido** (dependência de `package.json`) | `web-tree-sitter@0.27.0` (exata), `@vscode/tree-sitter-wasm@0.3.1` (devDependency; os `.wasm` escolhidos são copiados para `dist/nucleo/mapa/gramaticas/` e ficam em `asarUnpack`) (**sem** `d3-force` nem biblioteca de grafo: a Fase 15 já planeja canvas 2D e layout Barnes-Hut próprios, que a Fase 17 estende) |
| **Externo opcional** (detectado no PATH/locais padrão; nunca de `node_modules` do projeto) | `ctags` (GPL, processo à parte), `scc` ou `tokei`, `dot` (Graphviz), `index.scip` já gerado, lcov/Cobertura/JaCoCo/`go cover` já gerados |
| **Estudado e reimplementado** | aider repo-map (tags + PageRank), code2flow (chamadas por nome), stack-graphs (escopos), dependency-cruiser/deptrac/import-linter/ArchUnit/Packwerk (formato de regras; **importamos** os arquivos de regras estáticos), code-maat/CodeScene (hotspots e acoplamento temporal), lizard/radon (complexidade), cpp-dependencies (componentes), Sourcetrail/Serena (UX e tools por símbolo) |

### 6.2 Empacotamento e `worker_threads` no Electron `[M]` + decisões de risco

- Funciona: 4 workers dentro do Electron 37.10.3 com `ELECTRON_RUN_AS_NODE` parsearam o corpus (0,49 s). **Não confirmado**: o mesmo código dentro do app **empacotado** (asar). O
  worker de indexação do método já exige estar **fora do asar** (`worker_threads` não lê de dentro; ver `src/nucleo/metodo/worker.ts` e `electron-builder.yml` `asarUnpack`).
  Decisão: `asarUnpack` de `dist/nucleo/mapa/**` (worker + `.wasm`) e de `node_modules/web-tree-sitter/**`; o teste `npm run test:pacote` (T-17.39) **carrega todas as gramáticas
  a partir do pacote** e falha se algum `.wasm` faltar.
- O universal (`mergeASARs: false` já configurado) não duplica `.wasm` (independentes de arquitetura). O glob de `asarUnpack` do `@electron/universal` tem limite de 65 536
  caracteres: **uma pasta** de gramáticas (`dist/nucleo/mapa/gramaticas/*.wasm`, ≤ 12 arquivos) em vez de centenas de arquivos de `node_modules`.
- `Parser.init({ locateFile })` precisa apontar o `web-tree-sitter.wasm` por caminho absoluto resolvido do lado de fora do asar (aprendido no teste `[M]`).
- Memória: ≈ 20 MB por worker extra `[M]`; pool padrão de 2–3 workers; workers encerrados após 30 s ociosos.

### 6.3 O que **não** foi possível confirmar (explícito)

Licença SPDX de `cargo-depgraph`, `include-what-you-use`, Graphviz (espelho arquivado), Structurizr DSL, `lizard` (texto "estilo MIT"), `tokei` (dual não declarado na API), `serena`;
repositório oficial do `skott`; conteúdo da *Semgrep Rules License*; se o `universal-ctags` instalado pelo usuário tem JSON (`libjansson`); comportamento do pacote `typescript` 7.x
como biblioteca; desempenho do `worker_threads` dentro do app **empacotado**. Todos viram critério de aceite de tasks da Fase 17 (conferir antes de depender).

## 7. Fontes (consultadas em 2026-09-30)

- GitHub API (`gh api repos/<repo>`): tree-sitter/tree-sitter, tree-sitter/node-tree-sitter, tree-sitter/tree-sitter-{typescript,javascript,python,java,go,c-sharp,php,ruby,rust,cpp,c},
  tree-sitter/tree-sitter-graph, ast-grep/ast-grep, github/stack-graphs, scip-code/scip, sourcegraph/scip-{typescript,python,go,clang,dotnet,ruby}, scip-code/scip-java,
  sourcegraph/lsif-node, universal-ctags/ctags, sverweij/dependency-cruiser, pahen/madge, dsherret/ts-morph, thebjorn/pydeps, seddonym/import-linter, davidfraser/pyan,
  Technologicat/pyan, gak/pycallgraph, scottrogowski/code2flow, joernio/joern, github/codeql, semgrep/semgrep, semgrep/semgrep-rules, boyter/scc, AlDanial/cloc,
  XAMPPRocky/tokei, terryyin/lizard, rubik/radon, adamtornhill/code-maat, erikbern/git-of-theseus, TNG/ArchUnit, jQAssistant/jqassistant, deptrac/deptrac,
  mamuz/PhpDependencyAnalysis, Shopify/packwerk, include-what-you-use/include-what-you-use, tomtom-international/cpp-dependencies, regexident/cargo-modules, jplatte/cargo-depgraph,
  kisielk/godepgraph, CoatiSoftware/Sourcetrail, plantuml/plantuml, d2lang/d2, mermaid-js/mermaid, Aider-AI/aider, yamadashy/repomix, mufeedvh/code2prompt, oraios/serena, glato/emerge,
  electron/electron.
- Registro npm (`https://registry.npmjs.org/<pacote>/latest`): web-tree-sitter, tree-sitter-wasms, @vscode/tree-sitter-wasm, @ast-grep/{napi,wasm}, dependency-cruiser, madge, skott,
  ts-morph, typescript, graphology, sigma, cytoscape, d3-force, mermaid, @viz-js/viz, elkjs, @dagrejs/dagre, repomix, @sourcegraph/scip-typescript.
- Páginas: https://aider.chat/docs/repomap.html · https://github.com/github/stack-graphs (aviso de arquivamento de 2025-09-09) · https://github.com/adamtornhill/code-maat (GPL-3.0, JVM) ·
  https://github.com/github/codeql-cli-binaries/blob/main/LICENSE.md (restrição a código aberto) · https://github.com/scip-code/scip (+ `scip.proto`, lido por `gh api`) ·
  https://github.com/ast-grep/ast-grep.
- Falhas de consulta (por isso "não confirmado"): `github.com/semgrep/semgrep-rules` (HTTP 503), `github.com/skott-js/skott` (HTTP 404).
