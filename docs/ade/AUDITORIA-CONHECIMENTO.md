# Auditoria do conhecimento / RAG local e do chat (Fase 15, T-15.48) — onda 2 (ligação)

Auditoria própria, feita com os testes na mão. Escopo pedido: **segredo indexado**, **prompt injection por conteúdo indexado/recuperado**,
**vazamento entre workspaces**, **backend online sem consentimento** e **caminhos**. Cada achado tem o teste que o prende; as correções de
núcleo são aditivas e ficaram em `src/nucleo/conhecimento/**`. Testes: `src/nucleo/conhecimento/worker/auditoria.test.ts` (15 testes),
`src/main/conhecimento-auditoria.test.ts` (4), `src/main/rag-backend.test.ts` (7), `src/main/ipc/conhecimento.test.ts` (10, validadores) e
`src/nucleo/conhecimento/backend/adaptadores/seguranca.test.ts` (adaptadores).

## Achados e correções

| # | Gravidade | Achado | Correção | Teste |
|---|---|---|---|---|
| C-01 | **ALTA** | **Vazamento entre workspaces pela fila:** `rag_fila` era uma tabela só e `processarFila` drenava a fila inteira para a coleção do serviço que chamou: o evento do workspace B podia ser gravado (chunks, FTS, grafo, aprendizado) na coleção do workspace A, que então o devolvia em busca/contexto. | Migration `0002-fila-por-colecao` (`rag_fila.colecao_id`, índice); `enfileirar/proximos/pendentes` por coleção; o serviço grava o dono ao enfileirar. Segunda trava: `registrar`/`registrarLote` descartam entrada cujo `workspace_id` não é o do serviço. | `auditoria.test.ts` (3, 3b) |
| C-02 | **ALTA** | **IDs de outro workspace não eram inertes:** `detalheDocumento`, `detalheNo`, `atualizarAprendizado` (ativar/rejeitar/editar), `feedback` e `gravarPosicoes` operavam por id sem checar a coleção — um id de B visto de A lia ou alterava o dado de B. | Todos checam a coleção do serviço (`alvoDaColecao`, `colecao_id` no UPDATE das posições, detalhe devolve `null`). | `auditoria.test.ts` (3: "ids de OUTRO workspace são inertes") |
| C-03 | média | **Segredo bruto na fila persistente:** `user.note`, `chat.exchange`, `vcs.commit` entravam em `rag_fila` SEM redação e ficavam no arquivo (e em páginas livres depois da drenagem) até serem sobrescritos. | `redigirParaFila` redige só os campos de texto (título, texto, pergunta, resposta, usuário, mensagem) ANTES de enfileirar; ids/SHAs/caminhos ficam como estão. | `auditoria.test.ts` (1c) |
| C-04 | média | **"Esquecer" não apagava de verdade:** o `DELETE` comum deixava o texto legível em páginas livres, no WAL e em segmentos do FTS5 (mesmo achado A-03 da memória). | `PRAGMA secure_delete = ON` ao abrir o `conhecimento.db`; `esquecer`/`purgar` rodam `fts optimize` + `wal_checkpoint(TRUNCATE)`; a purga total também apaga `rag_consulta` e a fila da coleção. | `auditoria.test.ts` (1b: nenhum byte do marcador no arquivo nem no WAL) |
| C-05 | baixa | `consultouRecentemente` (consulta obrigatória) não filtrava a coleção: consulta de A contava para B se as chaves coincidissem. | Filtro por coleção em `consultouDesde`/`consultouMissao` e na cobertura de 7 dias. | `auditoria.test.ts` (3c) |

## Checklist (sem achado aberto)

| Item | Resultado | Onde está provado |
|---|---|---|
| (1) segredo em banco, FTS, grafo, fila, eventos, exportação e logs | **ok** nas vias de gravação: docs, nota, commit, chat, `rag_learn`, código, histórico das CLIs; `.env*`, chaves e `credentials*` nunca são lidos; symlink para fora de `docs/` não é seguido; saída de ferramenta e raciocínio das transcrições nunca entram | `auditoria.test.ts` (1, 1b, 1c, 5), `fontes.test.ts`, `chunking.test.ts` |
| (2) conteúdo recuperado é DADO | **ok**: o contexto prévio mantém UM envelope `tipo="dados"` (sem tag de fechamento, heading, cerca, ANSI nem bidi injetados); o trecho da busca é saneado e ≤ 400; o prompt do chat entrega as fontes em `<fontes tipo="dados">`; texto livre do LLM só é exibido, **o plano vem de código** (Missão, terminal e UMA skill do método) e o comando digitado é uma linha; assinar prodx, raio ALTO, `mergex-revisar`, merge e push são recusados por código | `auditoria.test.ts` (2), `conhecimento-auditoria.test.ts`, `seguranca.test.ts`, `chat.test.ts` |
| (3) escopo entre workspaces | **ok** depois de C-01/C-02/C-05: busca (4 escopos), contexto, listagem, grafo, hits do chat, aprendizados, feedback, esquecer e purgar | `auditoria.test.ts` (3, 3b) |
| (4) backend online sem consentimento | **ok**: `local` por padrão; nada é enfileirado nem enviado sem consentimento VÁLIDO para (provedor, host, coleção, versão da política); mudou o destino, o consentimento cai; a ponte `rede.rag` do main reconfere o consentimento GRAVADO a cada chamada (host diferente, workspace desconhecido ou consentimento ausente → `consent_required` sem abrir socket); credenciais só no cofre do SO (a config e o estado só têm a máscara; o log de IPC não imprime o payload dos canais sensíveis); URL com credencial ou `http` público recusados; "voltar para local" revoga o consentimento e esvazia a fila; apagar remoto exige o nome da coleção digitado | `rag-backend.test.ts`, `ipc/conhecimento.test.ts`, `backend/rag-ponta-a-ponta.test.ts` |
| (5) caminhos | **ok**: os validadores recusam caminho absoluto, unidade, `..`, `~` e barra invertida (arquivos do contexto, origem de esquecer); o RPC troca qualquer caminho absoluto de mensagem de erro por `<caminho>`; eventos ao renderer só têm ids, contagens e estados; a exportação grava só metadados (sem o texto dos chunks), 0600, no destino escolhido pelo usuário; o histórico das CLIs só lê `~/.claude/projects/<slug do projeto>` e o `sessions` do Codex cujo `cwd` é o projeto | `ipc/conhecimento.test.ts`, `worker.test.ts`, `conhecimento.test.ts`, `auditoria.test.ts` (5) |

## Riscos aceitos / pendências

- **P-58 (chamada real mínima por CLI) não foi executada nesta onda** (a instrução da onda é "sem rede"): os formatos headless estão cobertos por CLI falsa
  (`tests/fixtures/cli-headless/claude-falso.mjs`), parsers tolerantes e `verificarFlags(--help)`; a validação real fica para o dono (continua P-58).
- **Wrapper de Windows (`.cmd`/PowerShell) não roda no chat headless** (exigiria shell): a CLI aparece como `indisponivel` com o motivo e o chat cai em modo busca.
- **Dialetos dos provedores online** (Qdrant, Upstash, Pinecone) vêm da pesquisa G e são provados só contra o stub local (P-54: teste real com free tier depende de contas).
- **memox:** o script atual só tem `estado` e `arquivo`; `rag_search` com `sources:["memox"]` apenas avisa para usar `/expx:memox-arquivo`.
- **Segredos do formulário** (`campos_secretos`) cruzam a thread do worker em memória só enquanto a operação roda; erros saem sanitizados. Um dump de memória do processo continua fora do modelo de ameaça.
