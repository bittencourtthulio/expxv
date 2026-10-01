# Licenças de terceiros (análise do código, Fase 17)

Componentes embarcados no pacote para o mapa lógico do código. Todos sob licença MIT; o texto completo acompanha
cada pacote em `node_modules/<pacote>/LICENSE`. Nada GPL/AGPL/LGPL/MPL/EPL entra no pacote (D-161).

| Componente | Versão | Licença | Uso |
|---|---|---|---|
| web-tree-sitter | 0.27.0 | MIT (Max Brunsfeld e contribuidores) | runtime WASM do Tree-sitter (parser incremental), carregado só nos workers de extração |
| @vscode/tree-sitter-wasm | 0.3.1 | MIT (Microsoft Corporation) | gramáticas pré-compiladas em WASM (somente os `.wasm` escolhidos são copiados para o pacote) |
| tree-sitter-typescript (typescript, tsx) | via @vscode/tree-sitter-wasm | MIT | gramática TypeScript/TSX |
| tree-sitter-javascript | via @vscode/tree-sitter-wasm | MIT | gramática JavaScript/JSX |
| tree-sitter-python | via @vscode/tree-sitter-wasm | MIT | gramática Python |
| tree-sitter-java | via @vscode/tree-sitter-wasm | MIT | gramática Java |
| tree-sitter-php | via @vscode/tree-sitter-wasm | MIT | gramática PHP |
| tree-sitter-c-sharp | via @vscode/tree-sitter-wasm | MIT | gramática C# |
| tree-sitter-go | via @vscode/tree-sitter-wasm | MIT | gramática Go |
| tree-sitter-ruby | via @vscode/tree-sitter-wasm | MIT | gramática Ruby |
| tree-sitter-rust | via @vscode/tree-sitter-wasm | MIT | gramática Rust |
| tree-sitter-cpp | via @vscode/tree-sitter-wasm | MIT | gramática C++ (também usada para C) |

Ideias reimplementadas (nenhum código copiado), com atribuição quando houver licença permissiva: o `repo-map` do aider
(Apache-2.0: etiquetas de símbolos e PageRank para ordenar arquivos), a definição de complexidade ciclomática de McCabe
(tabelas de nós de decisão no espírito de lizard e radon), e o vocabulário de regras de fronteira de dependency-cruiser,
import-linter, deptrac e Packwerk (somente o formato dos arquivos estáticos de regras).
