# Fase 19 — Documentação e relatórios de entrega

**Pedido do dono (literal):** *"criação de DOCUMENTAÇÃO: estrutura boa e robusta. O Sprintx e o Runx já geram documentação técnica e de uso; quando o usuário FECHAR a SPRINT, o sistema gera o RELATÓRIO
de tudo que foi feito — técnico e para o USUÁRIO — em HTML, em MD, talvez CSV para importar em outro lugar; toda essa estrutura pronta para fazer a DIVULGAÇÃO das features do sistema."* Prioridade ALTA;
planejada junto com a Fase 18 (que mede; esta fase **conta** o que foi entregue).

**Valor para uma software house.** (1) Fechou a sprint, o **pacote de entrega** já está pronto: relatório **técnico** (para o time e para auditoria), relatório **do cliente** (linguagem simples, sem jargão), **resumo executivo**,
**notas de versão** (Keep a Changelog) e **CSV** para levar a outra ferramenta. (2) Tudo **rastreável**: cada afirmação do texto aponta para a task, o commit ou o relatório de origem — e é verificada automaticamente.
(3) **Divulgação pronta**: página de novidades (HTML/MD), resumo curto para redes e e-mail — o ADE **nunca publica sozinho**. (4) **Histórico navegável**, comparação entre sprints, templates e marca por cliente.
(5) **Documentação do sistema** (arquitetura, módulos, como usar, API) gerada como **rascunho com proveniência** para revisão humana. (6) Reaproveita, e não duplica, o que `sprintx`, `runx` e `mergex` já escrevem.

**Base lida:** `00-LEIA-ME.md`, `PILOTO-AUTOMATICO.md`, `06-FASES.md`, `01-DECISOES.md` (D-04, D-21, D-88, D-89, D-140), `03-ORCAMENTOS-DESEMPENHO.md`, `05-CONTRATOS.md` (§5 `.expxv/`), `04-UI-UX.md`, `base/F-metodo-expxdev.md`,
`fase-03`, `fase-06` (commits/PR/Forge), `fase-10` (custo por card; `custo desconhecido ≠ 0`), `fase-15` (RAG, `cli-headless`, `sanearFonte`), `fase-18` (itens, métricas, retrabalho, `sprint.fechada`, gráficos SVG), e as skills reais:
`runx` (E5: `docs/relatorios/<data>-<OC>-<slug>/{tecnico,uso}.md`, `INDICE.md`; hook `sem-jargao-no-uso`), `sprintx` (`FECHAMENTO.md`, `00-ESTIMATIVA.md`, `estimativas/HISTORICO.md`), `mergex` (`ENTREGA.md`, `PR.md`, `QA-PACOTE.md`).
Planos 14, 16, 17 e 20 ainda não existem: integração **por portas** com implementação nula (como na Fase 18).

**Portão da fase** (todos obrigatórios):
- `npm run verificar` verde (tipos, testes, regra de marca, P-08, varredura de cor literal, **varredura de rede e de `<script>`** nos HTML gerados, varredura de privacidade T-19.42).
- **Golden files** da fixture (`tests/fixtures/relatorios/`): pacote completo (técnico, usuário, executivo, notas, CSV ×3 perfis, JSON, divulgação) idêntico byte a byte entre duas execuções (relógio e ids injetados).
- **Verificação "toda afirmação tem fonte"** com corpus adversarial: LLM falso inventa fonte, número, PR, data futura e jargão → o bloco cai no **template determinístico** e o pacote registra `modo_bloco`.
- E2E no Electron real (T-19.41): fechar sprint na UI (Fase 18) → pacote gerado em segundo plano → abrir prévia (iframe sandbox) → editar `resumo_cliente`, **regenerar** (r2) → aprovar usuário/divulgação → **Exportar para…** (diálogo do SO simulado) em pasta e ZIP → PDF real (`%PDF-`) → comparar duas sprints → rascunho de documentação do projeto com proveniência.
- `npm run perf`: P-290 a P-302 verdes e P-01..P-22/P-100..P-117/P-180..P-190 sem piora.
- Auditoria (T-19.42): **zero escrita em `docs/**`** (teste com `fs` espionado), nenhuma chamada de rede, HTML sem `<script>`/URL externa, CSV sem injeção, ZIP íntegro, nenhum caminho absoluto de usuário nos artefatos, LLM sem ferramentas e sem código.
- Registro em `STATUS.md`, `05-CONTRATOS.md`, `04-UI-UX.md`, `AGENTS.md` pelo coordenador.

## Princípios

1. **Leveza e velocidade.** O pacote em modo determinístico fica pronto em ≤ 2 s (sprint de 200 tasks) em **worker**; a narrativa por LLM é **depois e fora do caminho crítico**; PDF em janela oculta; a UI nunca espera.
2. **Fatos, depois texto.** Tudo nasce de um `FatosSprint` **imutável e com hash**, montado de artefatos em disco, do banco do ADE e das métricas da Fase 18. Texto narrativo é **redigido sobre fatos**, com **citações**; nada de inventar.
3. **A IA SUGERE o texto; o humano aprova o que sai.** Relatório do cliente e divulgação nascem `rascunho` e só viram `aprovado` por ação humana; qualquer ajuste humano **persiste** entre regenerações.
4. **Consumir, não duplicar.** `tecnico.md`/`uso.md` do runx, `FECHAMENTO.md` do sprintx e `ENTREGA.md` do mergex são **insumos**. Faltou relatório de ocorrência → **oferece/dispara** `/expx:runx-relatar <OC>`; o ADE **não escreve em `docs/**`** (D-04).
5. **Custo/duração desconhecidos nunca viram zero.** "≥ US$ x", "custo desconhecido", "—"; **duração observada ≠ esforço** (rótulo fixo); métricas ausentes aparecem como ausentes, com o porquê.
6. **Nada sai da máquina.** O ADE gera arquivos locais e **não publica** (sem e-mail, sem HTML hospedado, sem rede). A única saída de dados é a CLI do usuário no passo de redação (D-88), com fatos estruturados e redigidos (sem código), e só com o consentimento registrado.
7. **Saída fora de `docs/**`.** Padrão `<userData>/relatorios/…`; opcional `.expxv/relatorios/` (contrato §5); "Exportar para…" é **ação explícita** com diálogo do SO.
8. **Autocontido e seguro.** HTML em **um arquivo**, sem JavaScript, sem rede, com CSP, SVG inline, CSS de impressão; texto sempre **escapado**; templates sem `eval`; logo sanitizado.
9. **Cliente não lê jargão.** O relatório do usuário respeita o mesmo contrato do hook `sem-jargao-no-uso` do runx (sem arquivo, função, tabela, sigla técnica, id interno, SHA) e é **verificado** antes de existir.
10. **Compacto (D-32).** Uma linha de controles, lista densa, prévia ao lado; destaque azul.

## [DEC] Decisões desta fase (registrar em `01-DECISOES.md` como D-190..D-199; orçamentos P-290..P-302 e pendências P-64..P-67; a numeração e as colisões evitadas estão explicadas na Fase 18)

| D | Decisão | Alternativa descartada · motivo |
|---|---|---|
| D-190 | **Saída fora de `docs/**`:** `<userData>/relatorios/<workspace_slug>/<sprint_slug>/r<N>/` (`rN` imutável); espelho opcional em `<workspace>/.expxv/relatorios/…`; **"Exportar para…"** = ação humana com diálogo do SO (pasta ou ZIP), **nunca sobrescreve** (sufixo `-2`). Destino dentro de `<workspace>/docs/**` é **recusado**; exceção documentada à D-04 só com `exportar_docs_liberado=true` (desligado), em subpastas **fora** da lista fechada do método (`sprintx, manutencao, relatorios, entregas, eventos, produto, stack, legado, projeto, design-system`) e com confirmação digitada. | Gravar em `docs/relatorios/` · é área da skill runx (D-04). |
| D-191 | **Pacote** = conjunto fixo de artefatos + `manifesto.json` (sha256, bytes, versão do gerador/template, `hash_fatos`, `modo_redacao`, perfil, avisos). Geração em worker, **idempotente** (`hash_fatos`+template+modo+ajustes), escrita **atômica** (pasta temporária + rename), cancelável. | Gerar na thread principal · trava a UI. |
| D-192 | **Redação por LLM só sobre fatos, com citações.** Bloco → `{id, afirmacoes:[{texto, fontes[]}]}`; **verificador** (V1..V7) rejeita fonte inexistente, número/data/URL/ID/SHA fora dos fatos citados, promessa de data, jargão (usuário), item oculto vazando, item visível esquecido; reprova → **template determinístico do bloco**; falha ainda → bloco `precisa_revisao` (lista o que falta; **não inventa**). `redacao_modo` = `auto` (LLM se houver CLI; senão template; padrão, D-140) · `llm` · `template`. | Texto livre sem checagem · alucinação. |
| D-193 | **Pendências do método são ofertas:** ocorrência concluída sem `docs/relatorios/*<OC>*` → botão que digita `/expx:runx-relatar <OC>` num Pane (humano clica); `disparar_runx_relatar='automatico'` opcional (1 por vez, só com QA `aprovado`, respeitando rigidez). `uso.md` existente entra como insumo **depois do lint**. Nada disso escreve em `docs/**` pelo ADE. | Reimplementar o E5 do runx · duplica e diverge. |
| D-194 | **Relatório do usuário e divulgação sem jargão:** lista de termos/estruturas **portada do hook** `sem-jargao-no-uso.py` (+ extras de `.expx/jargao.json`, só leitura); sem id interno (`T-NN.MM`, `OC-…`, `D-NN`), sem SHA, sem caminho. Citações vivem em `pacote.json` e em `data-fontes` (invisível), nunca no texto do cliente. `visibilidade_cliente` (Fase 18) decide quem aparece; `resumo_cliente` humano **vence** qualquer texto gerado. | Mesmo texto para dev e cliente · jargão vaza. |
| D-195 | **HTML:** um arquivo, **zero JS**, `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`, SVG inline com `<title>/<desc>` e tabela equivalente, CSS de impressão (`@page`, quebras, URL após link no técnico). **PDF** por `webContents.printToPDF` em `BrowserWindow` oculta (sandbox, `javascript:false`, sem preload, destruída ao fim). **ZIP** com empacotador próprio (método *store*, CRC32) — **sem dependência nova**. | Puppeteer/wkhtmltopdf/JSZip · peso, nativo, rede. |
| D-196 | **Templates:** motor mínimo próprio (`{{x}}` escapado, `{{{x}}}` só fragmento já saneado, `{{#each}}`, `{{#if}}…{{else}}`, `{{> parcial}}`, filtros fechados); **sem código, sem helpers, sem acesso a protótipo**; limites (100 000 iterações, saída 20 MB, profundidade 8); versões **append-only** por tipo/formato, ativa por escopo (global/workspace). | Handlebars/EJS · execução de código no template. |
| D-197 | **CSV:** UTF-8 **com BOM** (Excel PT-BR), CRLF, RFC 4180, ponto decimal, datas ISO, **proteção contra injeção de fórmula** (`= + - @ TAB CR` → prefixo `'`); perfis `generico` (completo), `jira` e `github` (mapeamento de colunas); mais `metricas.csv` e `retrabalho.csv`. | Só um CSV genérico · não importa em ferramenta nenhuma. |
| D-198 | **Documentação do projeto = rascunho com proveniência**, nunca "oficial": banner `RASCUNHO GERADO`, `commit_ref`, snapshot do mapa (Fase 17), ids do RAG (Fase 15), `arquivo:linha` por seção; seção sem fonte **não é gerada** (vira lacuna); regenerar cria **versão nova** (nada se perde), com diff por seção e marca de **desatualizada** quando um arquivo-fonte muda; revisão humana (`revisada`, anotações); sem editor in-app do texto (editar após exportar). | Sobrescrever docs existentes · apagaria revisão humana. |
| D-199 | **Notas de versão em Keep a Changelog 1.1.0** (`Added/Changed/Deprecated/Removed/Fixed/Security`), a partir de `categoria` + `changelog_tipo` (Fase 18) dos itens visíveis; cabeçalho `## [versão] - AAAA-MM-DD` (`versao_lancamento` informada ao fechar; senão `Unreleased`); **CHANGELOG cumulativo** regenerado em `<userData>/relatorios/<workspace>/CHANGELOG.md`. | Changelog por mensagens de commit · ruído e jargão. |

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`; P-180..P-190 são da Fase 18; P-200..P-209 são da Fase 14)

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-290 | Coleta de fatos (`FatosSprint`) de sprint com 200 tasks | ≤ 300 ms em worker; main nunca > 50 ms | `tests/perf/relatorios.perf.test.ts` + `gerarVolumeRelatorio` + monitor de event loop (P-12) |
| P-291 | **Pacote completo em modo template** (técnico, usuário, executivo, notas, divulgação, CSV ×3, JSON, MD) de sprint com **200 tasks** | **≤ 2 s** ponta a ponta; main nunca > 50 ms; latência de digitação p95 ≤ 40 ms durante a geração | worker + `longtask` + e2e de eco (P-05) |
| P-292 | Narrativa por LLM | **fora do caminho crítico**: pacote `template` pronto primeiro; blocos por job (≤ 2 em paralelo), timeout 120 s por bloco; UI e geração nunca esperam | CLI headless falsa lenta (5 s) + UI ≤ 50 ms |
| P-293 | Tamanho e abertura do HTML (200 tasks) | ≤ 1,5 MB sem logo (≤ 2,0 MB com logo ≤ 256 KB); CSV ≤ 100 KB; primeiro quadro ≤ 400 ms em janela oculta | unidade (bytes) + e2e com `PerformanceObserver` |
| P-294 | PDF de relatório de 200 tasks (~40 páginas) | ≤ 6 s; pico ≤ +200 MB; janela destruída; main sem bloqueio > 50 ms | e2e Electron real + `process.getProcessMemoryInfo` |
| P-295 | Motor de templates: laço de 10 000 linhas; saída máxima | ≤ 150 ms; recusa acima de 20 MB | unidade |
| P-296 | Verificador "toda afirmação tem fonte" (500 afirmações, 2 000 fatos) | ≤ 200 ms | unidade |
| P-297 | Tela Relatórios: 1ª abertura; voltar; lista de 500 pacotes; prévia (iframe `sandbox`, 1,5 MB) | ≤ 200 ms; p95 ≤ 50 ms (P-02); 60 fps, DOM ≤ 200 nós; 1º quadro ≤ 300 ms | Playwright + contagem de nós |
| P-298 | Chunks | tela Relatórios ≤ 50 KB gz; editor de templates/marca ≤ +40 KB lazy; JS inicial intacto (P-08) | script de tamanho no build |
| P-299 | Histórico: consultar 500 pacotes; comparar 4 sprints (de snapshots) | ≤ 10 ms; ≤ 50 ms | unidade com banco real (padrão P-14) |
| P-300 | ZIP *store* de pacote de 5 MB | ≤ 150 ms (worker) | unidade |
| P-301 | Documentação do projeto (determinística) sobre mapa de 2 000 arquivos | ≤ 1,5 s em worker; LLM por seção em job | unidade + `PortaMapa` falsa |
| P-302 | Memória: caches de relatórios no main; geração acima da base | ≤ 20 MB; ≤ 60 MB | `process.getProcessMemoryInfo` |

## Arquitetura e pastas

```
src/compartilhado/relatorios.ts          tipos de contrato (PacoteResumo, FatosSprint, Afirmacao, Bloco, Verificacao, Marca, ConfigRelatorios, TemplateInfo, DocProjeto…)
src/compartilhado/svg/**                 (Fase 18) NoSvg + emissor STRING usado aqui, sem React
src/nucleo/relatorios/
  portas.ts                              PortaAgil (itens, métricas, retrabalho, retro, review), PortaMetodo, PortaCusto, PortaVcs/PortaForge, PortaRag, PortaMapa,
                                         PortaPerfil, PortaHeadless, PortaMetodoDisparo, PortaAlertas + Indisponivel* (a fase funciona só com o método)
  relatorios.ts                          fábrica criarRelatorios(portas, banco, relogio)
  config/{padroes,marca,validar,logo}.ts
  fatos/{tipos,coletar,fontes,hash,pendencias}.ts   + fatos/insumos/{fechamento,decisoes,entrega,qa,ocorrencias,indice}.ts
  redacao/{blocos,deterministico,prompt,llm,esquema,verificar,jargao,numeros,consentimento}.ts
  motor/{lexer,parser,renderizar,filtros,limites,variaveis}.ts
  formatos/{markdown,html,css,csv,json,changelog,divulgacao,zip}.ts
  pacote/{pipeline,worker,gravar,manifesto,versoes,gatilho}.ts
  exportar/{destino,escrever,auditoria}.ts
  historico/{indice,busca,comparar}.ts
  templates/{repo,padrao,validar,previa}.ts
  docproj/{coletar,arquitetura,modulos,como-usar,api,proveniencia,versoes,diff,desatualizada}.ts
  eventos.ts
src/nucleo/banco/migracoes/NNNN-relatorios.ts   +  repos/relatorio-*.ts   (próximo número livre; serializada pelo coordenador)
src/nucleo/mcp/tools/relatorios.ts              report_list, report_get, report_generate, docs_draft_list
src/main/relatorios.ts  src/main/relatorios-pdf.ts  src/main/ipc/relatorios.ts   serviço (onda 2), janela oculta de PDF, IPC com validadores
resources/relatorios/templates/{tecnico,usuario,executivo,notas,novidades,email}.{html,md,txt}.tpl + parciais/   padrão embarcado (somente leitura)
src/renderer/telas/relatorios/{index,Lista,Detalhe,Previa,Revisao,Exportar,Comparar,Templates,Marca,Divulgacao,DocProjeto,Config,relatorios.css}.tsx
tests/fixtures/relatorios/{gerar.ts,golden/**}   tests/perf/relatorios.perf.test.ts
```

## Fluxo: fechar sprint → pacote

```
sprint.fechada (Fase 18)  ──►  gatilho (gerar_ao_fechar=true; fila serial por workspace, prioridade baixa)
 1 coletar     FatosSprint v1 (imutável, hash) = itens/métricas/retrabalho/retro/review (PortaAgil) + insumos do método (FECHAMENTO, 00-DECISOES, ENTREGA, QA, bloqueios,
               tecnico.md/uso.md das ocorrências) + custo (PortaCusto) + commits/PRs (PortaVcs/Forge) ; avisos de lacuna ; pendências do método → ofertas
 2 redigir     por bloco: template determinístico (sempre) → se redacao_modo≠template e há perfil: LLM em job (depois), com verificador
 3 verificar   V1..V7 (usuário/divulgação: + jargão e visibilidade) ; reprovado → template do bloco ; ainda reprovado → "precisa_revisao"
 4 renderizar  Markdown, HTML, CSV (3 perfis + metricas + retrabalho), JSON, notas de versão, divulgação (via motor de templates; gráficos SVG por string)
 5 gravar      <userData>/relatorios/<ws>/<sprint>/r<N>/ (temp + rename) ; manifesto ; CHANGELOG cumulativo ; INDICE.md próprio ; (opcional) espelho .expxv/
 6 anunciar    relatorio.pronto (Fase 20) ; registrar no RAG (Fase 15, tipo `relatorio`) ; UI mostra "Pacote pronto — revisar texto do cliente"
```
Escopos de geração: `{tipo:"sprint", sprint_id}` (padrão) · `{tipo:"trabalho", trabalho_id}` (sprintx/runx sem sprint ágil) · `{tipo:"periodo", de, ate}`. Sem a Fase 18, o escopo `trabalho` funciona só com o método.

### Conteúdo do pacote (`r<N>/`, nomes em PT sem acento)

| Arquivo | Público | Conteúdo |
|---|---|---|
| `tecnico.html`, `tecnico.md` | interno | Relatório técnico (seções abaixo) |
| `usuario.html`, `usuario.md` | cliente | Relatório do usuário/cliente, linguagem simples (rascunho até aprovar) |
| `executivo.html`, `executivo.md` | gestão | Resumo executivo de **1 página** |
| `notas-de-versao.md`, `notas-de-versao.html` | cliente | Keep a Changelog da sprint |
| `tasks.csv` (perfil `generico`), `tasks-jira.csv`, `tasks-github.csv`, `metricas.csv`, `retrabalho.csv` | interno | tabelas para importar |
| `pacote.json` | máquina | `relatorio_pacote_v1`: fatos, blocos, afirmações+fontes, métricas, verificação |
| `divulgacao/novidades.html`, `novidades.md`, `release-github.md`, `resumo-redes.txt`, `email.txt`, `email.html` | cliente | pronto para publicar (rascunho até aprovar) |
| `manifesto.json` | máquina | arquivos, sha256, bytes, `hash_fatos`, versões do gerador/template, `modo_redacao`, `modo_bloco{}`, perfil, avisos |
| `*.pdf` (sob demanda) | — | `printToPDF` do HTML escolhido |

### Seções do relatório TÉCNICO (`id` estável; cada uma com blocos e citações)
`identificacao` (workspace, sprint, período, meta, versão, gerado em/por) · `resumo` (números e frase de abertura) · `meta` (atingida? com fatos) · `mudancas` (por trabalho → por task: título, categoria, pontos, risco, criticidade, status, duração observada,
commits, arquivos, PR) · `decisoes` (`D-NN` de `00-DECISOES.md` e seção 6 do `tecnico.md` do runx) · `riscos` (risco residual de `FECHAMENTO.md`, achados QA média/baixa, itens de risco alto/crítico, bloqueios abertos) · `testes_qa` (suíte final, testes adicionados,
vereditos de auditoria/QA, reprovações) · `qualidade` (índice de retrabalho com faixa `ir`–`ir_max`, first-time-right, tasks em observação, XP: TDD/commits pequenos) · `divida` (itens `divida`, "sugestões de novas ocorrências" do runx, dívida do legadox quando existir) ·
`entrega` (branch, commits `[{task, commit}]`, `pr_url`, `pr_estado`, faixas de atenção do mergex) · `metricas` (burndown, burnup, velocidade, CFD, cycle/lead com P50/P85/P95 — SVG inline) · `custo` (tokens e US$ por task/modelo; "≥"/"custo desconhecido") ·
`bloqueios` · `retro` (itens e ações) · `proximos` (carregados, ações abertas, backlog `pronto`) · `apendice` (tabela de **fontes** com `FonteId`, ocorrências runx incluídas, pendências do método, manifesto).

### Seções do relatório do USUÁRIO
`em_resumo` (≤ 3 frases) · `novidades` (por funcionalidade: nome amigável + 1–2 frases "o que você pode fazer agora") · `correcoes` (o que estava errado e agora funciona; reaproveita `uso.md` após lint) · `valor` (o que melhora na rotina) ·
`acao_necessaria` (o que a pessoa precisa fazer; senão "Não é preciso fazer nada diferente.") · `proximos` (em planejamento, **sem datas**) · `ajuda` (contato/rodapé da marca). Só itens com `visibilidade_cliente` (`sim`, ou `auto` ⇒ categorias `feature|bug`).

### Resumo executivo (1 página)
Cartões: **Entregue × Planejado** (pontos e itens), **Velocidade** vs. média móvel, **First-time-right** (e IR), **Lead time P85**, **Defeitos escapados**, **Custo** (≥/desconhecido); **meta atingida?**; 3–5 destaques; riscos; próximos passos; mini-gráficos burnup e velocidade.

### Colunas do `tasks.csv` (perfil `generico`; cabeçalho em PT sem acento, `snake_case`)
`sprint, versao_lancamento, trabalho_id, task_ref, item_id, titulo, epico, categoria, risco, criticidade, pontos, escala, estimativa_origem, estimativa_confianca, estado_fluxo, iniciada_em, concluida_em, duracao_observada_h, lead_time_h, bloqueada_h, situacao_retrabalho, eventos_retrabalho, fontes_retrabalho, qa_veredito, suite_final, commits_qtd, commit_primeiro, pr_url, pr_estado, tokens_total, custo_usd, custo_estado, responsavel, visivel_cliente, changelog_tipo, resumo_cliente`
(`custo_estado` ∈ `exato|minimo|aproximado|desconhecido`; vazio quando desconhecido, nunca `0`). **`tasks-jira.csv`:** `Summary, Issue Type, Status, Priority, Story point estimate, Labels, Description, Epic Name` (feature→Story, bug→Bug, demais→Task; criticidade critica/alta/media/baixa → Highest/High/Medium/Low).
**`tasks-github.csv`:** `Title, Body, Labels, State, Assignees`. **`metricas.csv`:** `sprint, metrica, valor, unidade, n, observacao`. **`retrabalho.csv`:** `sprint, trabalho_id, task_ref, fonte, forca, natureza, ocorrido_em, evidencia_resumo, confirmado_por`.

## Fontes de verdade e redação com citações

- **`FonteId`** (string estável): `task:<trabalho_id>/<task_ref>` · `item:<id>` · `commit:<sha7>` · `pr:<trabalho_id>#<n|url-hash>` · `qa:<trabalho_id>` · `fechamento:<trabalho_id>` · `decisao:<trabalho_id>/D-NN` · `bloqueio:<trabalho_id>/B-NN` ·
  `relatorio:<pasta>#<secao>` · `metrica:<sprint_id>/<nome>` · `retro:<cerimonia_id>/<item>` · `custo:<sprint_id>` · `mapa:<snapshot>#<modulo>` · `rag:<doc_id>`. Cada fonte tem rótulo, tipo e referência **relativa** (nunca absoluta).
- **`Afirmacao {id, texto, fontes: FonteId[]}`** é a unidade verificável (parágrafos e itens narrativos; tabelas determinísticas não são "afirmação" — vêm direto dos fatos).
- **Redator LLM** (`redacao/llm.ts`): perfil por `PortaPerfil.resolver("relatorios","redacao")` (faixa `rapido`/`medio`); `PortaHeadless.executar({perfil, entrada, tools:[], timeoutMs:120000})`; entrada = **JSON dos fatos do bloco** em envelope delimitado (`<fatos>`; texto de task/commit é **dado não confiável**) após `sanearFonte` e redação de segredos;
  **nunca** código, `.env`, caminho absoluto. Saída: `{bloco_id, afirmacoes:[{texto, fontes[]}]}` por esquema estrito; 1 retentativa com a lista de violações; depois, template do bloco.
- **Verificador** (`redacao/verificar.ts`), regras: **V1** toda afirmação tem ≥ 1 fonte e todas ∈ conjunto do bloco; **V2** ancoragem — cada número, percentual, data ISO, SHA, URL, `T-NN.MM`, `D-NN` do texto aparece nos fatos das fontes citadas (comparação normalizada pt-BR/en); **V3** nomes entre crases/arquivos existem nos fatos;
  **V4** sem promessa de data/prazo futuro (aviso para exagero de marketing); **V5** (usuário/divulgação) sem jargão nem id interno (lista portada do hook do runx + `.expx/jargao.json`); **V6** limites de tamanho e idioma PT-BR (aviso); **V7** cobertura — todo item visível ao cliente aparece em ≥ 1 afirmação do relatório do usuário e **nenhum** item oculto aparece.
  Resultado `Verificacao {ok, afirmacoes_total, com_fonte, violacoes:[{regra, bloco, afirmacao_id, detalhe}]}` gravado em `pacote.json`.
- **Sem LLM** (sem CLI, sem consentimento, `template`): `redacao/deterministico.ts` monta as frases por *template com variáveis* (pluralização e listas em PT-BR) e **cita** a fonte de cada frase; item sem `resumo_cliente` e sem texto limpo vira "Melhoria em <módulo amigável>" marcada `precisa_revisao` (lista editável na UI).
- **Ajustes humanos:** `relatorio_ajuste(sprint_id, bloco_id, texto_md)` sobrescreve o bloco em **todas** as regenerações seguintes (lint de jargão ainda avisa no usuário); `resumo_cliente`/`visibilidade_cliente` ficam na Fase 18 (item).

## Modelo de dados e migration

Migration `NNNN-relatorios` (transação; nunca em paralelo). Ids ULID com prefixo (`rel_`, `tpl_`, `doc_`). Momentos UTC ISO com ms.

```sql
CREATE TABLE relatorio_config (workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE, json TEXT NOT NULL, atualizado_em TEXT NOT NULL);
  -- gerar_ao_fechar(1), redacao_modo('auto'|'llm'|'template'), perfil_redacao, espelho_expxv(0), csv_bom(1), formatos[], disparar_runx_relatar('ofertar'|'automatico'|'nunca'),
  -- exportar_docs_liberado(0), emojis(0), hashtags[], cta_url, idioma('pt-BR'), consentimento_llm_em
CREATE TABLE relatorio_marca (workspace_id TEXT PRIMARY KEY, json TEXT NOT NULL, atualizado_em TEXT NOT NULL);  -- workspace_id = '*' para a marca global
  -- {nome, logo_data_uri|null, cor_primaria, cor_secundaria, rodape, contato, tema:'auto'|'claro'|'escuro', fonte:'sistema'|'serif', mostrar_gerado_por(0), formato_data, fuso}
CREATE TABLE relatorio_pacote (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, sprint_id TEXT, trabalho_id TEXT,
  escopo_json TEXT NOT NULL, titulo TEXT NOT NULL, versao INTEGER NOT NULL, versao_lancamento TEXT, hash_fatos TEXT NOT NULL,
  modo_redacao TEXT NOT NULL CHECK (modo_redacao IN ('template','llm','misto')), modo_bloco_json TEXT NOT NULL DEFAULT '{}', perfil_json TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('gerando','pronto','falhou','cancelado','obsoleto')), etapa TEXT, progresso REAL,
  revisao_usuario TEXT NOT NULL DEFAULT 'rascunho' CHECK (revisao_usuario IN ('rascunho','aprovado')), aprovado_em TEXT,
  pasta_ref TEXT NOT NULL,                              -- relativo a <userData>/relatorios
  bytes INTEGER, avisos_json TEXT NOT NULL DEFAULT '[]', metricas_json TEXT NOT NULL DEFAULT '{}',   -- métricas CONGELADAS no momento da geração (comparar sprints)
  indice_texto TEXT NOT NULL DEFAULT '', gerado_em TEXT NOT NULL, UNIQUE (workspace_id, sprint_id, trabalho_id, versao));
CREATE TABLE relatorio_arquivo (pacote_id TEXT NOT NULL REFERENCES relatorio_pacote(id) ON DELETE CASCADE, nome TEXT NOT NULL, formato TEXT NOT NULL, publico TEXT NOT NULL CHECK (publico IN ('interno','cliente','gestao','maquina')),
  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, revisao TEXT NOT NULL DEFAULT 'rascunho' CHECK (revisao IN ('rascunho','aprovado','na')), PRIMARY KEY (pacote_id, nome));
CREATE TABLE relatorio_ajuste (sprint_id TEXT NOT NULL, bloco_id TEXT NOT NULL, texto_md TEXT NOT NULL, atualizado_em TEXT NOT NULL, PRIMARY KEY (sprint_id, bloco_id));
CREATE TABLE relatorio_exportacao (id TEXT PRIMARY KEY, pacote_id TEXT NOT NULL REFERENCES relatorio_pacote(id) ON DELETE CASCADE, modo TEXT NOT NULL CHECK (modo IN ('pasta','zip','arquivo')),
  destino TEXT NOT NULL, arquivos_json TEXT NOT NULL, bytes INTEGER NOT NULL, em TEXT NOT NULL);       -- destino absoluto escolhido pelo usuário (é dele, como workspace.raiz)
CREATE TABLE relatorio_template (id TEXT PRIMARY KEY, escopo TEXT NOT NULL CHECK (escopo IN ('global','workspace')), workspace_id TEXT, tipo TEXT NOT NULL, formato TEXT NOT NULL CHECK (formato IN ('html','md','txt')),
  versao INTEGER NOT NULL, conteudo TEXT NOT NULL CHECK (length(conteudo) <= 524288), ativa INTEGER NOT NULL DEFAULT 0, nota TEXT, criado_em TEXT NOT NULL, UNIQUE (escopo, workspace_id, tipo, formato, versao));
CREATE TABLE docproj_versao (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE, tipo TEXT NOT NULL CHECK (tipo IN ('arquitetura','modulos','como_usar','api')), versao INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('gerando','rascunho','em_revisao','revisado','descartado')), commit_ref TEXT, mapa_snapshot_id TEXT, hash_fontes TEXT, modo TEXT NOT NULL CHECK (modo IN ('deterministico','llm','misto')),
  pasta_ref TEXT NOT NULL, proveniencia_json TEXT NOT NULL, lacunas_json TEXT NOT NULL DEFAULT '[]', gerado_em TEXT NOT NULL, revisado_em TEXT, UNIQUE (workspace_id, tipo, versao));
CREATE TABLE docproj_secao (versao_id TEXT NOT NULL REFERENCES docproj_versao(id) ON DELETE CASCADE, secao_id TEXT NOT NULL, titulo TEXT NOT NULL, hash_texto TEXT NOT NULL, fontes_json TEXT NOT NULL,
  desatualizada INTEGER NOT NULL DEFAULT 0, revisada INTEGER NOT NULL DEFAULT 0, anotacao TEXT, PRIMARY KEY (versao_id, secao_id));
```
O `FatosSprint` **não** é tabela: é `pacote.json` (e `hash_fatos` no banco). As métricas congeladas em `metricas_json` (pontos planejados/entregues, itens, velocidade, média móvel, `ir`, `ir_max`, FTR, cycle/lead P50/P85/P95, defeitos escapados, custo e estado, tokens, bloqueios, % ações da retro feitas, `tdd_primeiro`) alimentam **comparar sprints** sem recalcular.

## Motor de templates (variáveis e regras)

Sintaxe: `{{caminho}}` (HTML-escapado; em `.md`/`.txt` escapa o que quebra o formato), `{{{fragmento}}}` (só variáveis marcadas `seguro`), `{{#each lista}}…{{/each}}`, `{{#if x}}…{{else}}…{{/if}}`, `{{> parcial}}`, filtros fechados `{{x | data | pontos | pct | h | usd | moeda | truncar:80 | maiusculas}}`. Erro de template aponta **linha e coluna**; variável inexistente é **erro de validação** (não string vazia).
**Variáveis** (catálogo em `motor/variaveis.ts`, com exemplo e tipo, usado pela pré-visualização e pela ajuda do editor): `marca.*`, `sprint.{nome,meta,inicio,fim,versao}`, `periodo`, `gerado_em`, `metricas.*` (todas **com `estado`** `exato|minimo|desconhecido`), `itens[]`
(`titulo, categoria, risco, criticidade, pontos, estado, duracao_h, retrabalho, pr_url, resumo_cliente, changelog_tipo`), `novidades[]`, `correcoes[]`, `trabalhos[]`, `decisoes[]`, `riscos[]`, `commits[]`, `prs[]`, `retro.{itens,acoes}`, `custo.*`, `blocos.<id>` (texto **já verificado**),
`graficos.<id>` (SVG string, seguro), `fontes[]`, `versao_pacote`. Limites: 100 000 iterações, saída 20 MB, profundidade 8, tempo 1 s por renderização (worker). Template do usuário vive em `relatorio_template` (**versões append-only**; "restaurar padrão" = ativar o embarcado).

## HTML autocontido (regras)

Builder com *tagged template* que **escapa tudo** por padrão; CSS único `formatos/css.ts` com variáveis de marca (`--marca`, `--marca-texto` calculado para contraste AA ≥ 4,5 e **avisando** se a cor do usuário for ajustada), tema `auto` por `prefers-color-scheme` (impressão sempre clara), fonte do sistema (sem webfont),
`<meta name="viewport">`, `lang="pt-BR"`, sumário por âncoras, tabelas com `<caption>` e cabeçalho repetido na impressão (`thead{display:table-header-group}`), `break-inside: avoid` em cartões, `@page{size:A4;margin:18mm 16mm}`, rodapé de marca, `a[href^="http"]::after{content:" (" attr(href) ")"}` na impressão do técnico, logo como `data:` (PNG/JPEG/SVG ≤ 256 KB;
**SVG sanitizado por allowlist**: sem `script`, `foreignObject`, `style @import`, `on*`, `href` externo). Gráficos: SVG inline com `<title>/<desc>` e tabela equivalente em `<details>`; paleta por variáveis + padrão de traço/marcador. **Teste de varredura:** nenhum `<script`, `javascript:`, `http(s)://` fora de `<a href>` declarados (PR/commit), nenhum `@import`/`url(http`.

## Documentação do projeto (rascunho com proveniência)

Tipos: `arquitetura`, `modulos`, `como_usar`, `api` (+ `INDEX.md`). Saída `<userData>/relatorios/<ws>/docs-projeto/<tipo>/v<N>/{<tipo>.md, <tipo>.html, proveniencia.json}`.
- **Entradas (somente leitura):** `PortaMapa` (Fase 17: módulos, grafo, entradas, fluxos, acesso a dados, ciclos, pontos quentes, raio; `diagrama('mermaid'|'svg')`), `PortaRag` (decisões, relatórios, fechamentos), artefatos do método (FECHAMENTO, `uso.md`, `CONVENCOES.md` do stackx), `README.md`, `AGENTS.md`, `package.json` (scripts, descrição) — todos pelo filtro `caminhoProibido` da Fase 15 (sem `.env`, chaves, credenciais).
- **`arquitetura`:** visão geral · camadas e módulos · diagrama de dependências (Mermaid + SVG) · fluxos principais · dados · decisões · pontos de atenção (ciclos, quentes, zonas de risco, dívida) · convenções · como rodar e testar.
- **`modulos`:** por módulo — responsabilidade, entradas públicas (exports), depende de / é usado por (raio), testes, contratos.
- **`como_usar`:** por funcionalidade entregue (itens visíveis de sprints fechadas + `uso.md`): o que faz e como usar, **só com passos que existam em fonte**; sem passo → **lacuna** explícita ("falta descrever como usar X").
- **`api`:** tabela de interfaces públicas (canais IPC, tools MCP, rotas/CLI, tipos públicos) com entrada, saída e `arquivo:linha`.
- **Proveniência:** cabeçalho `> RASCUNHO GERADO por <produto> em <data> a partir do commit <sha7> e do mapa <snapshot> — revisar antes de publicar.` e, por seção, **fontes** (`arquivo:linhas`, módulo do mapa, doc do RAG, artefato do método) e **lacunas**. Prosa pelo mesmo redator LLM (verificador com fontes de código; seção sem fonte **não existe**).
- **Ciclo:** `rascunho → em_revisao → revisado | descartado`; **desatualizada** quando algum arquivo-fonte muda depois do `commit_ref`; regenerar = versão nova com **diff por seção**; anotações de revisão por seção; exportar com o mesmo caminho de **Exportar para…** (nunca para `docs/**` por padrão).

## Divulgação (tudo rascunho até aprovar; nada é publicado)

`divulgacao/novidades.html` (página pronta para hospedar: título, resumo, cartões por novidade, melhorias/correções, "em planejamento" sem datas, marca; `<meta>` de título/descrição; sem JS) · `novidades.md` · `release-github.md` (Keep a Changelog resumido; link de comparação só se `PortaVcs` conhecer remoto e tags) ·
`resumo-redes.txt` com **3 variantes** (`curta` ≤ 280, `media` ≤ 600, `longa` ≤ 1 200 caracteres, contagem validada; sem emoji por padrão; hashtags e CTA da config) · `email.txt` (assunto ≤ 60, preheader ≤ 90, corpo) e `email.html` (tabelas inline, sem CSS/JS externos). Botões **Copiar**; **Aprovar** marca `revisao='aprovado'`; editar o texto volta a `rascunho`. Publicação em canais fica para extensão via Fase 20 (adaptadores), desligada.

## Contratos novos

**Canais IPC** (`relatorios:*`; validadores estritos; o renderer **nunca** envia caminho; erros `{code, subcode?, message}`):

| Canal | Tipo | Entrada → saída |
|---|---|---|
| `relatorios:config_ler` / `config_gravar` | invoke | `{workspace_id}` ↔ `ConfigRelatorios` |
| `relatorios:marca_ler` / `marca_gravar` | invoke | `{workspace_id\|"*"}` ↔ `Marca` (valida cor/contraste/logo; devolve avisos) |
| `relatorios:listar` | invoke | `{workspace_id, filtros?:{sprint_id, estado, texto}, cursor?, limite≤200}` → `{pacotes: PacoteResumo[], proximo, total}` |
| `relatorios:ler` | invoke | `{pacote_id}` → `PacoteDetalhe` (arquivos, avisos, verificação, métricas, modos por bloco, ofertas pendentes) |
| `relatorios:gerar` | invoke | `{escopo, opcoes?:{redacao_modo?, versao_lancamento?, formatos?}}` → `{pacote_id}`; evento de progresso |
| `relatorios:cancelar` / `regenerar` | invoke | `{pacote_id}` → `{ok}` / `{pacote_id}` (nova versão `rN+1`) |
| `relatorios:previa` | invoke | `{pacote_id, nome}` → `{conteudo, tipo, bytes}` (≤ 5 MB; texto para `iframe sandbox srcdoc`) |
| `relatorios:abrir_arquivo` | invoke | `{pacote_id, nome}` → `{ok}` (main resolve o caminho; `shell.openPath` só dentro de `<userData>/relatorios`) |
| `relatorios:ajuste_gravar` | invoke | `{sprint_id, bloco_id, texto_md\|null}` → `{ok}` |
| `relatorios:aprovar` | invoke | `{pacote_id, nomes[]\|"cliente", aprovar: boolean}` (humano) |
| `relatorios:exportar` | invoke | `{pacote_id, nomes\|"todos", modo:"pasta"\|"zip", confirmar_docs?}` → o **main abre o diálogo do SO**; → `{destino_rotulo, arquivos[], bytes}` |
| `relatorios:pdf` | invoke | `{pacote_id, nome}` → `{nome_pdf}` (gravado no pacote; abre/exporta depois) |
| `relatorios:comparar` | invoke | `{pacote_ids: 2..4}` → `Comparacao {metricas[], deltas[]}` |
| `relatorios:pendencias_metodo` | invoke | `{pacote_id\|sprint_id}` → `[{oc_id, titulo, motivo:"sem_relatorio"\|"sem_uso"\|"sem_fechamento", comando}]` |
| `relatorios:disparar_comando` | invoke | `{comando_id}` → `{pane_id}` (usa `metodo:disparar`; ação humana) |
| `relatorios:template_listar` / `template_ler` / `template_gravar` / `template_ativar` / `template_restaurar` / `template_validar` / `template_previa` | invoke | versões append-only; `validar` devolve `{ok, erros:[{linha, coluna, mensagem}], variaveis_usadas}` |
| `relatorios:docproj_listar` / `docproj_gerar` / `docproj_ler` / `docproj_revisar` / `docproj_anotar` / `docproj_diff` / `docproj_exportar` | invoke | ciclo da documentação do projeto |
| `relatorios:diagnostico` | invoke | `{}` → `{texto}` copiável (sem conteúdo de código) |
| `relatorios:evento` | evento | `{tipo:"progresso"\|"pronto"\|"falhou"\|"narrativa_pronta"\|"docproj_pronto", pacote_id?, etapa?, pct?}` coalescido |

**Eventos de domínio** (barramento; Fase 20 e RAG consomem): `relatorio.gerando`, `relatorio.pronto`, `relatorio.falhou`, `relatorio.aprovado`, `relatorio.exportado`, `docproj.rascunho_pronto`. Payload `{workspace_id, sprint_id?, pacote_id, versao, pontos_entregues|null, itens, avisos_qtd}`. Consome `sprint.fechada` (Fase 18).

**Tools MCP** (inglês `snake_case`; leitura para todos; geração só piloto em `squad|agentico`, modo `template`, idempotente, no máximo 1 por sprint a cada 10 min):

| Tool | Entrada | Saída |
|---|---|---|
| `report_list` | `{sprint_id?, limit≤50}` | `[{package_id, version, state, review_state, generated_at, files:[{name, format, audience}]}]` |
| `report_get` | `{package_id, file?}` | metadados e **resumo** (≤ 4 KB); conteúdo integral só dos `.md` ≤ 64 KB |
| `report_generate` | `{sprint_id}` | `{package_id, state}` (modo `template`) |
| `docs_draft_list` | `{type?}` | `[{id, type, version, state, stale, commit_ref}]` |

**Arquivos gravados:** só em `<userData>/relatorios/**` (e `.expxv/relatorios/**` se espelho ligado). `docs/**`: nunca, exceto a exceção D-190 por exportação humana.

## UI (compacta, D-32)

Menu lateral **Relatórios** (lazy). Uma linha de controles: abas **Pacotes · Comparar · Documentação · Templates · Marca · Config**, chips (sprint, estado), busca, **Gerar**. **Pacotes:** lista densa virtualizada (sprint, versão `rN`, estado, **modo** IA/template, revisão, avisos, tamanho); ao lado, **prévia** em `iframe sandbox` (sem scripts);
barra de ações: Abrir · Copiar · PDF · **Exportar para…** · Regenerar · Aprovar. **Revisão do texto do cliente:** lista de itens com `resumo_cliente` editável (grava na Fase 18), itens `precisa_revisao` em destaque, jargão sublinhado com a sugestão. **Ofertas do método:** "Gerar relatório de OC-…" (um clique). **Documentação:** versões, estado, desatualizada, diff por seção, anotações.
Estados vazios explicam o próximo passo ("feche uma sprint na aba Ágil ou gere por trabalho"). Atalhos: ⌘⇧R abre Relatórios; ⌘⌥G gera. Acessibilidade: `role="tablist"`, prévia com título, foco visível, `prefers-reduced-motion`, confirmações pela UI (zero diálogo nativo exceto o seletor de pasta, simulado no e2e).

## Tarefas

Formato: `T-19.NN · título` — arquivos · o que entrega · **aceite binário** · testes · depende. Todas em TDD e `npm run verificar` verde; as de UI herdam os orçamentos e D-32. **Depende da Fase 18** onde indicado (`sprint.fechada` T-18.29, painel/métricas T-18.34, SVG T-18.32, itens T-18.09, retrabalho T-18.22).
Arquivos compartilhados que **só o coordenador** edita: `src/compartilhado/ipc.ts`, `src/preload/preload.ts`, `src/nucleo/mcp/{catalogo,portas}.ts`, migrations, `src/nucleo/metodo/parser/kinds.ts`, `src/renderer/tokens.css`, `05-CONTRATOS.md`, `STATUS.md`.

### A — Fundação
- **T-19.01 · Contratos compartilhados (coordenador)** — `src/compartilhado/relatorios.ts`, canais/eventos em `ipc.ts`, validadores estritos em `src/main/ipc/relatorios.ts` (esqueleto que recusa), `window.ade.relatorios` no preload (`CHAVES_API_ADE`). **Aceite:** typecheck verde; todo canal tem validador; nenhum aceita caminho. **Testes:** `ipc-relatorios.test.ts`, `preload.test.ts`. **Depende:** T-18.01.
- **T-19.02 · Migration `relatorios` e repositórios (coordenador)** — `migracoes/NNNN-relatorios.ts`, `repos/relatorio-*.ts`. **Aceite:** aplica sobre o banco das Fases 10/18; CASCADE por workspace; `UNIQUE` de versão; template ≤ 512 KB (CHECK); consulta quente ≤ 5 ms. **Testes:** `migrar-relatorios.test.ts`, `relatorio-repos.test.ts`. **Depende:** T-19.01.
- **T-19.03 · Portas e fábrica** — `relatorios/{portas,relatorios}.ts`. **Aceite:** `criarRelatorios` roda só com `Indisponivel*` (gera pacote só do método); relógio e ids injetados; porta ausente nunca lança. **Testes:** `portas.test.ts`, `fabrica.test.ts`. **Depende:** T-19.01.
- **T-19.04 · Configuração, marca e logo** — `config/{padroes,marca,validar,logo}.ts`. Contraste AA da cor primária (ajusta e avisa), logo PNG/JPEG/SVG ≤ 256 KB, **sanitização de SVG por allowlist**. **Aceite:** SVG com `<script>`, `onload`, `foreignObject`, `href` externo é limpo/recusado; cor sem contraste vira a mais próxima que passa AA + aviso; marca global herdada pelo workspace. **Testes:** `marca.test.ts`, `logo.test.ts` (adversarial). **Depende:** T-19.02.

### B — Fatos
- **T-19.05 · `FatosSprint`, `FonteId`, hash e coletor** — `fatos/{tipos,coletar,fontes,hash}.ts`. Escopos `sprint|trabalho|periodo`; JSON canônico (chaves ordenadas, sem `gerado_em`) + sha256; fonte com rótulo e referência **relativa**. **Aceite:** mesma entrada → mesmo `hash_fatos`; P-290 (200 tasks ≤ 300 ms); desconhecido = `null`; item oculto marcado `oculto_cliente`. **Testes:** `coletar.test.ts`, `hash.test.ts` (propriedade: ordem de entrada não muda o hash). **Depende:** T-19.03, T-18.09, T-18.34.
- **T-19.06 · Leitores dos insumos do método** — `fatos/insumos/{fechamento,decisoes,entrega,qa,ocorrencias,indice}.ts` (sobre `src/nucleo/metodo/parser`; `kind` novos pelo coordenador). `FECHAMENTO.md`, `00-DECISOES.md`, `ENTREGA.md` (+`PR.md`), `QA.md`/`00-AUDITORIA.md`, `00-BLOQUEIOS.md`, `docs/relatorios/<data>-<OC>-<slug>/{tecnico,uso}.md`, `docs/relatorios/INDICE.md`. **Aceite:** YAML truncado/arquivo ausente não lança e vira aviso; `uso.md` só entra se passar no lint (T-19.12); somente leitura (`fs` espionado). **Testes:** `insumos.test.ts` sobre a fixture. **Depende:** T-19.05.
- **T-19.07 · Pendências do método e disparo de `/expx:runx-relatar`** — `fatos/pendencias.ts`, canais `pendencias_metodo`/`disparar_comando`. Ocorrência concluída (QA `aprovado`) sem relatório → oferta com comando `/expx:runx-relatar <OC>`; trabalho do sprintx concluído sem `FECHAMENTO.md` → oferta de retomar (`/expx:sprintx <slug>`); modo `automatico` opcional (1 por vez, rigidez respeitada). **Aceite:** nunca dispara sozinho por padrão; depois que a skill grava o relatório, o watcher marca o pacote `obsoleto` e oferece **Regenerar**; o ADE não escreve em `docs/**`. **Testes:** `pendencias.test.ts`. **Depende:** T-19.06.
- **T-19.08 · Fixtures** — `tests/fixtures/relatorios/{gerar.ts,golden/**}` (usa `tests/fixtures/metodo/gerar.ts` e `tests/fixtures/agil/gerar.ts`, sem editá-los): sprint fechada com 3 trabalhos (feature, ocorrência com `uso.md` **com jargão proposital**, trabalho sem `FECHAMENTO`), itens visíveis/ocultos, `resumo_cliente` presente/ausente, PR/commits, custo parcial; `gerarVolumeRelatorio(raiz,{tasks:200})`. **Aceite:** determinístico; golden vazio e a regeneração por `UPDATE_GOLDEN=1` documentada. **Testes:** `gerar.test.ts`. **Depende:** T-19.03, T-18.08.

### C — Redação
- **T-19.09 · Blocos e redação determinística** — `redacao/{blocos,deterministico}.ts`. Catálogo de blocos (`t_*`, `u_*`, `e_*`, `d_*`), frases por template com PT-BR (plural, listas, "e"), citação por frase. **Aceite:** todo bloco gera texto **sem LLM** com ≥ 1 fonte por afirmação; item sem texto limpo → `precisa_revisao` (nunca inventa). **Testes:** `deterministico.test.ts` (golden). **Depende:** T-19.05.
- **T-19.10 · Redator LLM** — `redacao/{prompt,llm,esquema,consentimento}.ts`. Perfil por `PortaPerfil`, `PortaHeadless` sem ferramentas, envelope saneado, esquema estrito, 1 retentativa, jobs por bloco, consentimento registrado, teto de chamadas. **Aceite:** P-292 (UI ≤ 50 ms com CLI lenta); JSON inválido/fonte alheia → descartado e template; prompt **sem código/caminho absoluto/segredo** (varredura); sem CLI → `modo='template'` sem erro. **Testes:** `llm.test.ts`, `esquema.test.ts` (adversarial), `prompt.test.ts`. **Depende:** T-19.09.
- **T-19.11 · Verificador "toda afirmação tem fonte"** — `redacao/{verificar,numeros}.ts` (V1..V4, V6). **Aceite:** P-296; corpus adversarial (fonte inexistente, número fora, data futura, PR inventado, SHA falso) reprova **cada** caso com a regra certa; número `1.234,5` e `1,234.5` casam o mesmo fato; texto correto passa. **Testes:** `verificar.test.ts` (tabela + propriedade: texto montado só com fatos sempre passa). **Depende:** T-19.09.
- **T-19.12 · Lint de linguagem, cobertura e visibilidade** — `redacao/jargao.ts` (V5, V7). Termos e estruturas **portados** de `sem-jargao-no-uso.py` (+ `.expx/jargao.json`, só leitura; `ignorar`); id interno, SHA, caminho; cobertura de itens visíveis; item oculto não vaza. **Aceite:** o `uso.md` da fixture com jargão é barrado e sua versão limpa passa; "tabela de preços", "campo do formulário", "banco" financeiro **não** geram falso positivo (como no hook); item oculto citado → violação V7. **Testes:** `jargao.test.ts` (espelha os casos do hook). **Depende:** T-19.09.

### D — Renderização
- **T-19.13 · Motor de templates** — `motor/*`. **Aceite:** P-295; `{{constructor.constructor}}`, `__proto__`, laço infinito, saída > 20 MB, profundidade > 8 → erro nominal, sem execução; variável inexistente = erro com linha/coluna; `{{{}}}` só em variável `seguro`; `<script>` em título sai escapado. **Testes:** `motor.test.ts` (adversarial), `filtros.test.ts`. **Depende:** T-19.03.
- **T-19.14 · Markdown** — `formatos/markdown.ts` + templates `.md.tpl` (técnico, usuário, executivo, notas). Tabelas, notas de rodapé de citação (`[^n]`) no técnico, sem citação visível no usuário. **Aceite:** golden da fixture; Markdown válido (cabeçalhos em ordem, tabelas alinhadas); caracteres especiais escapados. **Testes:** `markdown.test.ts` (golden). **Depende:** T-19.13, T-19.12.
- **T-19.15 · HTML autocontido** — `formatos/{html,css}.ts` + templates `.html.tpl`. Regras da seção HTML; CSP; sumário; impressão; tema/branding. **Aceite:** P-293; varredura (sem `<script`, `javascript:`, `http(s)://` fora de `<a href>`, `@import`, `url(http`); contraste AA; um único arquivo; abre idêntico offline. **Testes:** `html.test.ts` (golden + varredura + XSS em todos os campos). **Depende:** T-19.13, T-19.04.
- **T-19.16 · Gráficos SVG para relatório** — `formatos/graficos.ts` (sobre `src/compartilhado/svg/emitir-string.ts`). Burndown, burnup, velocidade, CFD, cycle/lead (dispersão + percentis), distribuição, planejado×entregue; `<title>/<desc>` + tabela equivalente. **Aceite:** emite string idêntica à do emissor React para os mesmos dados; ≤ 600 elementos por série; sem cor literal (variáveis da marca). **Testes:** `graficos.test.ts` (snapshot). **Depende:** T-18.32, T-19.15.
- **T-19.17 · CSV e JSON** — `formatos/{csv,json}.ts`. `tasks.csv` (colunas acima), perfis `jira` e `github`, `metricas.csv`, `retrabalho.csv`, `pacote.json` (`relatorio_pacote_v1` com esquema validado). **Aceite:** RFC 4180 (aspas, vírgula, quebra, acentos); BOM e CRLF; **injeção de fórmula** neutralizada; desconhecido = vazio (nunca `0`); round-trip com um parser de teste; `pacote.json` valida pelo esquema. **Testes:** `csv.test.ts`, `json.test.ts`. **Depende:** T-19.05.
- **T-19.18 · Notas de versão e CHANGELOG** — `formatos/changelog.ts`. Keep a Changelog 1.1.0; `categoria` + `changelog_tipo` → seção; `versao_lancamento` ou `Unreleased`; **CHANGELOG cumulativo** regenerado dos pacotes `pronto` mais recentes por sprint. **Aceite:** só itens visíveis; ordem das seções padrão; sem id interno; sprint reaberta/regerada substitui a entrada anterior, não duplica. **Testes:** `changelog.test.ts` (golden). **Depende:** T-19.14.
- **T-19.19 · Textos de divulgação** — `formatos/divulgacao.ts`. `novidades.html/md`, `release-github.md`, `resumo-redes.txt` (3 variantes com contagem validada), `email.txt/html`; emoji/hashtags/CTA pela config. **Aceite:** limites de caracteres rigorosos (curta ≤ 280, média ≤ 600, longa ≤ 1 200, assunto ≤ 60, preheader ≤ 90); sem jargão (V5); sem links inventados; todos `rascunho`. **Testes:** `divulgacao.test.ts`. **Depende:** T-19.14, T-19.15, T-19.12.
- **T-19.20 · PDF por `printToPDF`** — `src/main/relatorios-pdf.ts`, `exportar/` (ligação). `BrowserWindow` oculta (`sandbox`, `contextIsolation`, sem preload, `javascript:false`, sem rede), `printToPDF` A4 com rodapé de marca e número de página, destruída em `finally`. **Aceite:** P-294; arquivo começa com `%PDF-` e tem N páginas > 0; nenhuma janela sobra (`BrowserWindow.getAllWindows`); cancelar mata a janela. **Testes:** `pdf.test.ts` (stub) + e2e real. **Depende:** T-19.15.
- **T-19.21 · ZIP e "Exportar para…"** — `formatos/zip.ts`, `exportar/{destino,escrever,auditoria}.ts`. ZIP *store* próprio (CRC32); diálogo do SO só no **main**; recusa destino em `<ws>/docs/**` (exceto D-190), `.git`, `node_modules`, `.expx`, `.claude`, diretórios do sistema; **nunca sobrescreve** (sufixo `-2`); escrita atômica; auditoria `relatorio_exportacao` + evento. **Aceite:** P-300; ZIP lido por leitor de teste (CRC e tamanhos corretos, nomes sem `..`); destino em `docs/` recusado com mensagem; confirmação digitada na exceção; sem rede. **Testes:** `zip.test.ts`, `destino.test.ts` (tabela de caminhos hostis), `escrever.test.ts`. **Depende:** T-19.03.

### E — Pipeline e relatórios
- **T-19.22 · Pipeline, worker, gravação e manifesto** — `pacote/{pipeline,worker,gravar,manifesto,versoes}.ts`. Etapas com progresso; cancelável; idempotente por (`hash_fatos`, template, modo, ajustes); pasta temporária + rename; `rN` imutável; espelho `.expxv/` opcional; falha parcial → pacote `falhou` com o que foi gerado. **Aceite:** P-291 (≤ 2 s, main ≤ 50 ms); mesmo hash → reaproveita; cancelar no meio não deixa pasta pela metade; manifesto com sha256 de todos os arquivos; **zero** escrita em `docs/**` (fs espionado). **Testes:** `pipeline.test.ts`, `manifesto.test.ts`, `relatorios.perf.test.ts` (parcial). **Depende:** T-19.14, T-19.15, T-19.17, T-19.18, T-19.19, T-19.11.
- **T-19.23 · Gatilho de fechamento, regeneração e eventos** — `pacote/gatilho.ts`, `eventos.ts`. Assina `sprint.fechada`; fila serial por workspace; `relatorio.gerando|pronto|falhou`; **narrativa LLM depois** (`narrativa_pronta` troca blocos e gera nova versão só com consentimento/`auto`). **Aceite:** fechar sprint (Fase 18) → pacote `template` pronto em ≤ 2 s e `relatorio.pronto` publicado; duas fechadas seguidas enfileiram; `gerar_ao_fechar=false` não gera; reabrir/regerar = `rN+1`. **Testes:** `gatilho.test.ts`. **Depende:** T-19.22, T-18.29.
- **T-19.24 · Relatório técnico e resumo executivo** — `pacote/montar-tecnico.ts`, templates. Todas as seções do técnico; executivo de 1 página; tabela de fontes. **Aceite:** cada seção presente ou "sem dados" com o porquê; custo "≥/desconhecido"; retrabalho com faixa `ir`–`ir_max`; links de PR/commit; executivo cabe em 1 página A4 (teste de altura por regra de CSS/contagem de linhas). **Testes:** `tecnico.test.ts` (golden). **Depende:** T-19.22, T-19.16.
- **T-19.25 · Relatório do usuário, revisão e aprovação** — `pacote/montar-usuario.ts`, canais `ajuste_gravar|aprovar`. Só itens visíveis; `resumo_cliente` humano vence; `precisa_revisao` listados; aprovar por arquivo; editar volta a `rascunho`. **Aceite:** nenhum item oculto aparece; jargão/ID/SHA = 0 no resultado; ajuste humano sobrevive à regeneração; sem aprovação, a UI marca **rascunho**. **Testes:** `usuario.test.ts`, `aprovar.test.ts`. **Depende:** T-19.22, T-19.12.

### F — Gestão do histórico
- **T-19.26 · Histórico, índice e busca** — `historico/{indice,busca}.ts`, `INDICE.md` próprio em `<userData>/relatorios/<ws>/`. **Aceite:** P-299; busca por sprint/título/feature (FTS5 quando houver, `LIKE` caso contrário); `INDICE.md` mais recente no topo, regenerado de forma atômica; nada em `docs/**`. **Testes:** `historico.test.ts`. **Depende:** T-19.22.
- **T-19.27 · Comparar sprints** — `historico/comparar.ts`. **Aceite:** 2–4 pacotes; Δ vs. primeira e vs. anterior; métrica ausente → "—" (nunca 0); usa `metricas_json` congelado (comparação estável mesmo após mudanças); P-299; export CSV/MD. **Testes:** `comparar.test.ts`. **Depende:** T-19.26.
- **T-19.28 · Templates: repositório, validação e prévia** — `templates/{repo,padrao,validar,previa}.ts`. Versões append-only; ativar/restaurar; validação com linha/coluna; prévia com dados da fixture ou de um pacote real. **Aceite:** template inválido nunca fica ativo; restaurar padrão reativa o embarcado; override por workspace; prévia ≤ 300 ms. **Testes:** `templates.test.ts`. **Depende:** T-19.13.

### G — Documentação do projeto
- **T-19.29 · Coleta e proveniência** — `docproj/{coletar,proveniencia,versoes,desatualizada}.ts`. Insumos pelas portas, `caminhoProibido`, `commit_ref`, hash das fontes, marca de desatualizada. **Aceite:** com `PortaMapa` nula gera só o que o método/README permitem e lista **lacunas**; arquivo-fonte alterado após o `commit_ref` marca a seção `desatualizada`; versões nunca se sobrescrevem. **Testes:** `coletar.test.ts`, `desatualizada.test.ts`. **Depende:** T-19.03, T-19.08.
- **T-19.30 · `arquitetura` e `modulos`** — `docproj/{arquitetura,modulos}.ts`. Determinístico (mapa) + prosa LLM verificada com fontes de código; Mermaid e SVG. **Aceite:** P-301; toda seção tem `fontes` ou vira lacuna; banner `RASCUNHO GERADO` com commit e snapshot; ciclos e pontos quentes do mapa aparecem em "pontos de atenção". **Testes:** `arquitetura.test.ts`, `modulos.test.ts` (mapa falso). **Depende:** T-19.29, T-19.10, T-19.11.
- **T-19.31 · `como_usar`, `api`, diff e exportação** — `docproj/{como-usar,api,diff}.ts`, canais `docproj_*`. **Aceite:** "como usar" só com passos presentes em fonte, o resto vira lacuna; `api` lista canais IPC/tools MCP com `arquivo:linha`; diff por seção entre versões; `revisado`/anotações persistem; exporta pelo caminho de T-19.21. **Testes:** `como-usar.test.ts`, `api.test.ts`, `diff.test.ts`. **Depende:** T-19.30, T-19.21.

### H — Integração
- **T-19.32 · Tools MCP** — `mcp/tools/relatorios.ts`, catálogo (coordenador). **Aceite:** matriz respeitada; `report_generate` só piloto em `squad|agentico`, modo `template`, limite de 1 por 10 min por sprint; `report_get` nunca devolve `.html` bruto > 64 KB nem `pacote.json` completo. **Testes:** `mcp-relatorios.test.ts`. **Depende:** T-19.22, T-19.31.
- **T-19.33 · RAG, Alertas e Início** — registro do pacote no RAG (Fase 15, tipo `relatorio`, só `tecnico.md` e `usuario.md` aprovado, sem conteúdo bruto de código), eventos `relatorio.*` à Fase 20, cartão "Último relatório" no Início. **Aceite:** sem RAG/Alertas nada quebra; o RAG recebe o documento com `origem` e hash; evento carrega `pontos_entregues` e `avisos_qtd`. **Testes:** `integracoes.test.ts`. **Depende:** T-19.23, T-19.26.

### I — Interface
- **T-19.34 · Casca, lista e detalhe** — `telas/relatorios/{index,Lista,Detalhe,relatorios.css}.tsx`, menu, paleta, atalhos. **Aceite:** P-297 e P-298 (chunk ≤ 50 KB gz); uma linha de controles; estados (`gerando` com progresso, `falhou` com motivo e "tentar de novo"); vazio explica o próximo passo. **Testes:** `Tela.test.tsx`, e2e de navegação. **Depende:** T-19.01, T-19.26.
- **T-19.35 · Prévia e revisão do texto do cliente** — `Previa.tsx`, `Revisao.tsx`. `iframe sandbox` com `srcdoc`; lista de itens com `resumo_cliente` editável (grava via Fase 18), destaque de `precisa_revisao` e de jargão com sugestão; aprovar/regenerar. **Aceite:** prévia sem scripts mesmo com HTML malicioso; 1º quadro ≤ 300 ms; editar → regenerar gera `rN+1` mantendo o ajuste; tudo por teclado. **Testes:** `Previa.test.tsx`, `Revisao.test.tsx`. **Depende:** T-19.34, T-19.25.
- **T-19.36 · Exportar, PDF, Config e Marca** — `Exportar.tsx`, `Config.tsx`, `Marca.tsx`. **Aceite:** "Exportar para…" abre o diálogo **no main** (simulado no e2e) e informa o destino; tentativa em `docs/` mostra a recusa; marca com prévia de contraste e logo validado; config de redação com estado de cada CLI e aviso de consentimento. **Testes:** `Exportar.test.tsx`, `Marca.test.tsx`. **Depende:** T-19.34, T-19.21, T-19.20, T-19.04.
- **T-19.37 · Editor de templates** — `Templates.tsx` (lazy). Lista de variáveis com exemplo, validação em tempo real (linha/coluna), prévia lado a lado, versões e restaurar. **Aceite:** +≤ 40 KB gz; template inválido não ativa; prévia reflete a edição em ≤ 300 ms; sem dependência de editor externo (textarea acessível com numeração de linha própria). **Testes:** `Templates.test.tsx`. **Depende:** T-19.34, T-19.28.
- **T-19.38 · Comparar, Documentação e Divulgação na UI** — `Comparar.tsx`, `DocProjeto.tsx`, `Divulgacao.tsx`. **Aceite:** comparar 2–4 sprints com Δ e mini-gráficos; documentação mostra estado, "desatualizada", diff, anotações e exportar; divulgação com **Copiar** por variante, contador de caracteres e **Aprovar**; nada publica. **Testes:** `Comparar.test.tsx`, `DocProjeto.test.tsx`, `Divulgacao.test.tsx`. **Depende:** T-19.34, T-19.27, T-19.31, T-19.19.
- **T-19.39 · Ponte com "Fechar sprint" (Fase 18) e paleta** — painel no diálogo de fechamento (Fase 18 `Planejamento.tsx`, edição cedida a esta task pelo coordenador): "Gerar pacote ao fechar" (padrão ligado), `versao_lancamento`, revisão do texto do cliente depois; comandos na paleta. **Aceite:** fechar a sprint mostra o estado do pacote em tempo real e leva à revisão; nenhuma regressão no fluxo da Fase 18. **Testes:** `Fechar.test.tsx`. **Depende:** T-19.35, T-18.42.

### J — Fechamento da fase
- **T-19.40 · Desempenho** — `tests/perf/relatorios.perf.test.ts`. Medir P-290..P-302 com `gerarVolumeRelatorio`; corrigir a causa, nunca o limite. **Aceite:** `docs/ade/perf/ultimo.json` com P-290..P-302 verdes. **Depende:** T-19.22, T-19.20, T-19.34, T-19.30.
- **T-19.41 · E2E Electron real** — `tests/relatorios.e2e.test.ts`. Fluxo do portão (fechar → pacote → prévia → editar → regenerar → aprovar → exportar pasta e ZIP → PDF → comparar → docproj); CLI headless falsa (inclusive adversarial); diálogo do SO simulado; **zero** diálogos nativos de confirmação. **Aceite:** verde; limpeza de processos (`tests/limpeza.ts`). **Depende:** T-19.39, T-19.38.
- **T-19.42 · Auditoria e registro** — `docs/ade/AUDITORIA-RELATORIOS.md`. Checklist: zero escrita em `docs/**`, zero rede, HTML sem `<script>`/URL externa, CSV sem injeção, ZIP íntegro, nenhum caminho absoluto de usuário em artefatos, LLM sem ferramentas e sem código, citações verificadas, jargão = 0 no cliente; revisão independente de `exportar/` e `redacao/`; coordenador atualiza `STATUS.md`/`05-CONTRATOS.md`/`04-UI-UX.md`/`AGENTS.md`. **Aceite:** sem achado ALTA aberto. **Depende:** todas.

## Ordem de execução e paralelismo (áreas de arquivo disjuntas; ≤ 5 agentes)

```
Coordenador (sequencial): T-19.01 → T-19.02 → T-19.03 (+ kinds do parser, tokens, catálogo MCP quando pedidos)
Faixa 1 fatos + fixtures   (nucleo/relatorios/fatos, tests/fixtures/relatorios)       T-19.05 → 19.06 → 19.07 ; T-19.08
Faixa 2 motor + formatos   (nucleo/relatorios/{motor,formatos,config})                T-19.04 ; T-19.13 → 19.14, 19.15 → 19.16 ; 19.17, 19.18, 19.19
Faixa 3 redação            (nucleo/relatorios/redacao)                                T-19.09 → 19.10, 19.11, 19.12      │ após 19.05
Faixa 4 saída              (nucleo/relatorios/exportar, main/relatorios-pdf)          T-19.20 (após 19.15) ; T-19.21
Faixa 5 documentação       (nucleo/relatorios/docproj)                                T-19.29 → 19.30 → 19.31            │ após 19.10, 19.11
Depois: pipeline e relatórios (19.22 → 19.23, 19.24, 19.25), histórico/templates (19.26 → 19.27 ; 19.28), integração (19.32, 19.33),
        UI (19.34 → 19.35–19.38 em paralelo por arquivo de tela → 19.39), fechamento (19.40 → 19.41 → 19.42).
```
Caminho crítico: 19.01 → 19.02 → 19.03 → 19.05 → 19.09 → 19.14/19.15 → 19.22 → 19.23 → 19.34 → 19.35 → 19.39 → 19.41 → 19.42. Dependências de outras fases: a Fase 18 (itens, métricas, retrabalho, `sprint.fechada`, SVG) é **pré-requisito do fluxo completo**; sem ela o escopo `trabalho` já funciona só com o método (portas nulas).

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| LLM inventa fato/PR/número | Fatos estruturados, citação obrigatória, verificador V1..V7, fallback por bloco, bloco `precisa_revisao` em vez de texto livre |
| Jargão no texto do cliente | Lint portado do hook do runx, `resumo_cliente` humano que vence, aprovação humana antes de divulgar |
| Duplicar o E5 do runx / FECHAMENTO do sprintx | Insumos lidos, ofertas de `/expx:runx-relatar`, nada escrito em `docs/**` |
| HTML malicioso (XSS por título de task, logo SVG) | Escape por padrão, zero JS, CSP, sanitização de SVG, iframe `sandbox`, testes adversariais |
| Injeção de fórmula em CSV | Prefixo `'`, teste dedicado, BOM/CRLF corretos |
| PDF pesado/janela vazada | Janela oculta destruída em `finally`, orçamento P-294, teste de janelas restantes |
| Exportar para o lugar errado / sobrescrever | Diálogo só no main, recusa de `docs/**` e pastas sensíveis, nunca sobrescreve, auditoria |
| Dados da sprint mudam depois do relatório | `rN` imutável, `hash_fatos`, métricas congeladas, comparação estável, **Regenerar** explícito |
| Fase 18/14/16/17/20 ausentes | Portas com `Indisponivel*`; pacote do método sozinho; mapa nulo → documentação com lacunas |
| Documentação do projeto soa "oficial" mas está velha | Banner de rascunho, proveniência, marca `desatualizada` por fonte, diff entre versões |

## Pendências do dono desta fase (registrar em `PENDENCIAS-DO-DONO.md` como P-64..P-67; padrão já adotado pela regra D-140)

| # | Pergunta | Padrão adotado | Onde mexer |
|---|---|---|---|
| P-64 | **Redação por IA** envia **fatos estruturados** (títulos, resumos, contagens; nunca código) ao provedor da CLI escolhida e gasta cota (≈ 1 chamada por bloco, até 12 por pacote). Manter `auto` (usa IA quando houver CLI)? | `auto`, com consentimento registrado na 1ª vez, botão para desligar e modo `template` sempre disponível (D-192) | `relatorio_config.redacao_modo`, `consentimento_llm_em` |
| P-65 | **Exportar para dentro de `docs/` do projeto** (exceção à D-04): permitido só por opção, em subpastas fora das áreas do método e com confirmação digitada. Liberar a opção? | opção existe e vem **desligada** (D-190) | `relatorio_config.exportar_docs_liberado` |
| P-66 | **Marca padrão** dos relatórios (nome, logo, cores, rodapé, contato) e idioma: você fornece o logo e os textos? | sem marca (nome do workspace, cor de destaque azul, rodapé vazio), `pt-BR`; "gerado com o produto" desligado (D-195) | `relatorio_marca` (`*`) |
| P-67 | **Publicação automática** (GitHub Release, e-mail, webhook, redes): o ADE só gera e copia. Quer adaptadores de publicação como extensão da Fase 20, sempre com aprovação por botão? | só gerar/copiar/exportar; adaptadores ficam como extensão futura, desligados (princípio 6) | Fase 20 (canais) |
