
## Pedido (extratores Python/Java, T-17.08/09)

- `Extracao` não tem campo `pacote`/`namespace`. Java precisa do `package` do arquivo para o resolvedor ("mesmo pacote sem import", índice package+classe); C#/PHP têm a mesma necessidade. Contorno atual: o resolvedor deriva o pacote do caminho (`src/main/java/<pacote>/`). Pedido: acrescentar `pacote: string | null` a `Extracao` (e a `validacao.ts`).
- Repositórios Spring Data emitem `dados` com `fonte: "jpa-repository"` e `tabela` = nome da ENTIDADE em minúsculas (operacao `desconhecida`, heuristica); a análise de dados (T-17.24) deve trocar pela tabela do `@Table` da entidade.

## Pedido (manifestos, resolvedores e chamadas, T-17.15..19 — fork manifestos-resolucao)

- **Registro do modo degradado.** `extratores/registro.ts` exige gramática (`obterParser`) e lança `sem_gramatica` para `linguagem === "outra"`. O extrator degradado está pronto como função pura `extrairGenerico(texto, caminho): Extracao` em `extratores/generico.ts` (sem parser). Pedido: em `extrairArquivo`, se `linguagem === "outra"`, devolver `extrairGenerico(texto, caminho)` (e a coluna `arquivo.degradado = 1`).
- **`Extracao.pacote`/`namespace`** (já pedido acima): o resolvedor Java deriva o pacote do caminho (`src/main/java/…`); C#/PHP derivam o namespace do FQN do primeiro símbolo de topo. Com o campo, os três ficam exatos para arquivos fora da convenção de pastas.
- **Tipo do receptor.** A resolução de chamadas (passo 3 do plano: `const x = new Foo()`, parâmetro tipado) precisa que `ChamadaBruta` traga `tipo_receptor?: string | null` (nome do tipo quando o receptor é variável local com tipo simples). Hoje essas chamadas caem em "só por nome" (heurística, `candidatos`).
- **`ContextoResolucao.raiz`** (opcional, raiz absoluta do workspace) serve para ler `compile_commands.json` (caminhos absolutos); o serviço (T-17.21) deve preenchê-la e injetar `lerTexto`/`existe` restritos à raiz (sem `..`, sem arquivos de ambiente/chaves).
- **Integração (T-17.21).** `resolverTodos([resolvedorTs, resolvedorPython, resolvedorJava, resolvedorCsharp, resolvedorPhp, resolvedorGo, resolvedorRuby, resolvedorRust, resolvedorCpp], ctx)` -> `{arestas, ligacoes, nao_resolvidos}`; depois `resolverChamadas({arquivos, ligacoes})` -> arestas símbolo->símbolo. `LigacaoImport.alvos` (vários arquivos) é usado por Go, curinga Java, `using` C#.

## Fork grafo-analises (T-17.20, 17.22–17.30): pedidos ao coordenador

Tudo em `src/nucleo/mapa/{grafo,analises}/**`, `git-historia.ts`, `cobertura.ts`, `regras-fronteira.ts`, `raio.ts`. Nada novo em contrato compartilhado; o que segue é decisão a registrar ou ligação a fazer.

1. **Exportar no `index.ts` do mapa** (arquivo do coordenador): `grafo/*`, `analises/*`, `git-historia`, `cobertura`, `regras-fronteira`, `raio`. Hoje só são importáveis pelo caminho direto.
2. **`churn_janela` x `churn_total` (T-17.22)**: `git log --since=<janela_dias, padrão 730>` limita a coleta; `churn_total` = commits na janela coletada; `churn_janela` = commits dos últimos `recenteDias` (padrão 365). O plano usa "janela" para as duas ideias; registrar em `01-DECISOES.md` (sugestão: D-NN "churn_janela = últimos 365 dias").
3. **Autores por e-mail (T-17.22)**: o formato do log traz `%ae` além de `%an`, só para deduplicar autor (mesmo e-mail, nomes diferentes). Nenhum nome ou e-mail sai do módulo: só `autores_n`. O plano cita só `%an`.
4. **Acoplamento temporal**: grau = co-alterações / média das alterações dos dois arquivos (estilo code-maat); só entram arquivos com ≥ 5 alterações.
5. **`Extracao.shingles`** (tipo `[number, number]`) não é consumido: `analises/duplicacao.ts` tokeniza e faz o winnowing por conta própria (`prepararDuplicacao(caminho, texto, linguagem)`), pois precisa da posição em tokens para estimar o tamanho do clone. Se o extrator for preencher `shingles`, o formato precisa carregar `[hash, posição_em_token, linha]`.
6. **Entradas de teste do serviço (T-17.21)**: as análises são puras; o analisador deve montar `ArquivoMapa[]` (`caminho` + `Extracao`), arestas por id (`arq:`/`sim:`/`ent:`/`tab:`/`ext:`) e, para licenças, um `LeitorProjeto {ler, listar}` somente leitura confinado à raiz. Os manifestos (T-17.15) alimentam `DependenciaDeclarada[]` e `locks`.
7. **Ordem de uso**: `agregarEntradas` → arestas `aciona`; `analisarDados` → `le_tabela`/`escreve_tabela` + `migracoes`; `analisarTestes` → `testa`; `grafoDoArmazem` (usa `armazem.banco`, leitura) → `componentesFortes`/`pageRank`/`niveisTopologicos`; `calcularRaio` consome as arestas de todos esses.

## Onda 3 (serviço, canais, MCP, UI, auditoria): o que foi feito e o que fica como pedido

**Feito (ver D-330..D-338, `05-CONTRATOS.md` §19 e `AUDITORIA-MAPA.md`):** serviço completo (pool + fase derivada em `worker_threads`, scan incremental por hash/mtime e por lista, `versao_mapa`, cancelamento consistente), canais `mapa:*`, `src/main/{mapa,mapa-mcp}.ts`, tools `map_*`, tela Mapa (jsdom), pacote de contexto, exportações, disparo, portas das Fases 18/19, contrato com a Fase 15, `index.ts` do mapa exportando tudo (pedido 1 do fork grafo-analises e o do registro degradado, que já estava no `registro.ts`), `churn_janela` = 365 dias (D-337), integração do `resolverTodos`/`resolverChamadas` com `lerTexto`/`existe`/`raiz` injetados e CONFINADOS (`confinado.ts`; o "canal" do pedido é o contrato interno da fase derivada, não um canal do renderer).

**Continua pedido (arquivos de outros agentes/fases):**
1. **Extratores**: `Extracao.pacote`/`namespace` e `ChamadaBruta.tipo_receptor` (pedidos acima) seguem sem campo; os resolvedores continuam derivando pelo caminho e caindo em "só por nome".
2. **Fase 15 × mapa**: ligar `sincronizarMapa` ao worker do conhecimento (outra thread, outro banco; precisa abrir o `mapa.db` somente leitura) e, se desejado, o `ProvedorGrafoCodigo` do plano (D-334).
3. **Pacote/CI**: acrescentar ao `scripts/verificar-pacote.mjs` a prova de que o app empacotado carrega as gramáticas e analisa uma fixture (T-17.45); depende de `npm run dist:dir` (não rodado: há `npm run dev` ativo). `empacotamento.test.ts` já confere o fecho dos dois workers contra `asarUnpack`.
4. **E2E e P-243** (60 fps com 5 000 nós/15 000 arestas) no Electron real: `tests/mapa.e2e.test.ts` está escrito e não foi executado.
5. **T-17.36 (SCIP) e T-17.37 (execução de ctags/scc/dot e instalação via Homebrew)**: não implementados (só detecção de presença).
6. **Fase 19**: a linha de `05-CONTRATOS.md` §16 que diz "mapa indisponível até a Fase 17 ter serviço no main" fica superada pelo §19 (a porta `alteracoes` agora é real).
