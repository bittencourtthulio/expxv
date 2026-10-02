# Auditoria — documentação e relatórios de entrega (Fase 19, onda 1)

Escopo auditado: `src/nucleo/relatorios/**`, `src/main/relatorios.ts`, `src/main/ipc/relatorios.ts`, `src/nucleo/banco/repos/relatorios.ts`, migration `0014-relatorios`, `src/renderer/telas/relatorios/**`,
canais `relatorios:*` em `src/compartilhado/ipc.ts` e o bloco `relatorios` do preload. Método: leitura do código com a lista de ameaças do pedido + testes adversariais escritos ANTES da correção
(cada achado abaixo tem teste que falha sem a correção). Data: 2026-10-01. **Nenhum achado ALTA aberto.**

## Resultado por ameaça

| Ameaça | Veredito | Evidência |
|---|---|---|
| XSS no HTML exportado (título, meta, resumo do cliente, commit, PR, estado do PR, versão, nome da sprint, texto da IA) | **Fechada** | `formatos.test.ts` "XSS em TODOS os campos": nenhum `<script`, `javascript:`, handler `on*` em tag, `@import`, `url(http`; `http(s)://` só dentro de `href`; CSP `default-src 'none'` em todo HTML; `servico.test.ts` A-02 (texto da IA com `<script>`/Markdown/`javascript:` sai escapado) |
| Prévia na UI | **Fechada** | `<iframe sandbox="" srcdoc>` (sem scripts, formulários nem navegação); `Tela.test.tsx` confere `sandbox=""` com HTML malicioso e que nenhum `<script>` entra no documento da tela; links do relatório abrem com `target="_blank"` (bloqueado pelo sandbox da prévia, nunca navega o quadro) |
| Injeção de fórmula em CSV | **Fechada** | `celulaCsv` neutraliza `=`, `+`, `-`, `@`, tab, CR e a variante de largura total, mesmo após espaços; vale para `tasks`, `tasks-jira`, `tasks-github` e `metricas`; desconhecido = vazio (nunca `0`); RFC 4180 com BOM/CRLF (`seguranca.test.ts`, `formatos.test.ts`) |
| Vazamento de segredo | **Fechada** | todo texto entra por `limparTexto` (scrubber do cofre quando aberto + padrões `sk-…`, `token=…`, JWT, chave privada, URL com `usuário:senha@`); prompt da IA saneado e sem código; `fatos.test.ts`, `redacao.test.ts` (prompt sem segredo/caminho), `divulgacao.test.ts` ("última barreira" no envio), `servico.test.ts` (motivo de falha sem segredo) |
| Vazamento de caminho absoluto | **Fechada** | `semCaminhoAbsoluto` (POSIX, Windows, UNC, `~/`, `file://`); só caminho relativo vai ao mapa; nenhum artefato contém a raiz do workspace (`servico.test.ts`). Único caminho absoluto persistido: `relatorio_exportacao.destino` (a pasta que a PESSOA escolheu, como `workspace.raiz`); a UI só recebe o rótulo (último segmento) |
| Escrita fora de `.expxv` | **Fechada** | referência de pacote travada por regex (`<pasta do produto>/relatorios/<sprint>/r<N>`); pasta-base não pode ser symlink; `rN` imutável; escrita atômica (pasta temporária + rename; arquivo temporário + rename); teste com `fs` espionado prova ZERO escrita em `docs/**` (`servico.test.ts`, `exportar.test.ts`). Exportação só para pasta escolhida no diálogo do SO e nunca em `docs/`, `.git`, `node_modules`, `.expx`, `.claude`, pasta do produto nem diretórios do sistema (symlink resolvido antes de comparar) |
| Envio sem consentimento | **Fechada** | envio exige: relatório aprovado + item aprovado + canal disponível + consentimento do canal NA VERSÃO VIGENTE do texto; consentimento (IA e canais) não entra por `configGravar` nem pelo validador do IPC; fechar a sprint nunca envia (A-04); porta de canais é injetada (Fase 20) — sem ela nada sai; texto re-saneado imediatamente antes de enviar (`divulgacao.test.ts`) |
| IA sem consentimento / com ferramentas | **Fechada** | sem consentimento registrado a CLI não é nem consultada; `tools: []`; entrada = fatos estruturados em envelope `<fatos>` com `<`/`>` escapados; resposta com esquema estrito, fontes do bloco, verificador V1/V2/V5/V7, 1 retentativa, teto de 3 chamadas; texto de pessoa nunca é reescrito (`redacao.test.ts`, `relatorios.test.ts` do main) |
| Item oculto ao cliente | **Fechada** | `V7`: item oculto citado por id ou título reprova; item visível entregue sem citação reprova; `blocosUsuario` nunca cita oculto |
| Isolamento entre workspaces | **Fechada** | todo id é conferido contra o `workspace_id` do pedido (pacote, envio, ajuste); main confere que o workspace existe antes de qualquer método (`servico.test.ts`, `relatorios.test.ts`) |
| IPC | **Fechada** | 19 canais, 1 validador estrito cada, nomes de arquivo `^[A-Za-z0-9._-]` de um segmento (ou `divulgacao/<segmento>`), ids por prefixo, campos extras recusados, nenhum campo de caminho; erro traduzido para `[codigo] texto` sem stack/SQL/caminho (`ipc/relatorios.test.ts`) |

## Achados corrigidos nesta onda (todos com teste)

| # | Sev. | Achado | Correção | Teste |
|---|---|---|---|---|
| A-01 | MÉDIA | Aprovar o texto do cliente reemitia TODOS os arquivos com a config vigente; se a config mudasse entre gerar e aprovar (ex.: CSV sem BOM), o disco, o manifesto e o registro divergiam (prévia `integro=false`, exportação bloqueada) | aprovar só reescreve os arquivos do cliente; os demais mantêm o hash já registrado; o manifesto lista o que está no disco | `servico.test.ts` A-01 |
| A-02 | MÉDIA | Texto de IA ou de pessoa com marcação (`<script>`, `[x](javascript:…)`) | escape obrigatório no construtor de HTML e de Markdown + `limparTexto` neutraliza `javascript:`/`vbscript:` no texto | A-02, `seguranca.test.ts` |
| A-03 | MÉDIA | Um arquivo do pacote trocado por atalho (symlink) para outro arquivo seria lido pela prévia (conteúdo voltava com `integro=false`) | `ler` usa `lstat` em cada trecho e recusa o que não for arquivo comum | A-03 (arquivo e subpasta) |
| A-04 | BAIXA | Garantia explícita de que o gatilho `sprint.fechada` nunca envia | teste de regressão (canal pronto e consentido, fechamento só gera o pacote local) | A-04 |
| A-05 | BAIXA | Lista de diretórios do sistema bloqueava `/var` e `/private/var` inteiros, recusando pastas legítimas do usuário (temporários e volumes no macOS) | só subpastas de sistema (`/var/lib`, `/var/log`, `/var/db`…) | `exportar.test.ts` (serviço) |
| A-06 | BAIXA | O verificador lia a versão `2.4.0` como o número 240 | `x.y.z` é versão (exige presença nas fontes); `12.345.678` continua número | `redacao.test.ts` |
| A-07 | INFO | "Exportar tudo" mistura arquivos internos e do cliente | aviso na UI antes de exportar; cada arquivo mostra o público no seletor | `Tela.test.tsx` |

## Riscos residuais (aceitos nesta onda, por escrito)

1. **BAIXA — coerência semântica do texto da IA.** O verificador garante que cada número/data/SHA está nas fontes citadas, não que a frase faça sentido ("12 de 8 pontos" casaria). Mitigação: tudo nasce rascunho, a revisão humana é obrigatória para aprovar, e o texto padrão é o piso.
2. **BAIXA — URL `http(s)` no texto.** URLs seguras (sem credencial) ficam no texto; leitores de Markdown/GFM podem torná-las clicáveis. Não há como ser executada.
3. **INFO — gravação não transacional entre disco e SQLite.** Queda do app entre `rename` e o `UPDATE` deixa o pacote `gerando` (e a pasta no disco); a próxima geração cria `r(N+1)`. Não há perda nem vazamento. Revisão de "varredura de órfãos" fica para a onda 2.
4. **INFO — custo e mapa de código não ligados no main.** As portas existem e são testadas, mas `PortaCusto` e `PortaMapa` ainda são `Indisponivel` na ligação real: o relatório diz "custo desconhecido" e "sem mapa de código" (nunca zero). Ligação na onda 2, após a estabilização das Fases 10 e 17.

## Decisões desta onda (para o coordenador registrar em `01-DECISOES.md`)

- **D-190** — O pacote vive em `<raiz do workspace>/<pasta do produto>/relatorios/<sprint>/r<N>/` (`PRODUTO.pastaNoProjeto`), nunca em `docs/**` (D-04); `rN` é imutável; exportar é ação explícita para pasta escolhida.
- **D-191** — Migration `0014-relatorios` (0013 já era a de alertas); desvio do plano: `hash_geracao` (idempotência), `relatorio_ajuste.workspace_id`, `relatorio_divulgacao` (fila de envio por canal).
- **D-192** — Aprovação humana do texto do cliente reemite só os arquivos do cliente trocando a faixa de rascunho; aprovar exige zero problema V1/V2/V5/V7 no texto do cliente.
- **D-193** — Envio por canal externo = pacote aprovado + item aprovado + consentimento do canal na versão vigente (`VERSAO_CONSENTIMENTO_ENVIO`); a porta de canais é injetada pela Fase 20.
- **D-194** — Redação por IA reaproveita a porta headless da gestão ágil (opção aditiva `sistema` em `criarPortaHeadless`) com prompt de sistema próprio; perfil por `resolverPerfilDeEtapa("relatorios","redacao")`.

## Fora desta onda (continua no plano da Fase 19)

Editor de templates e marca/logo (T-19.04, T-19.13, T-19.28, T-19.37), PDF por `printToPDF` (T-19.20), comparar sprints (T-19.27), documentação do projeto `docproj_*` (T-19.29..31), tools MCP (T-19.32), RAG/Início (T-19.33), ponte no diálogo de fechamento (T-19.39), leitores dos insumos do método (T-19.06/07) e gráficos SVG ricos (T-19.16: só o gráfico de barras planejado × entregue nesta onda).
