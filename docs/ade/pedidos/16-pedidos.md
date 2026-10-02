# Pedidos da Fase 16 (Maestro, onda 1: núcleo puro) ao coordenador

Entregue em `src/nucleo/maestro/**` (+ `src/compartilhado/maestro.ts`, `tests/fixtures/maestro/**`, `tests/perf/maestro.perf.ts`). Nada de migration, IPC, preload, main, renderer, MCP nem `package.json` foi tocado.

## 1. Migration (serializada pelo coordenador)

Sem tabela nova além das do plano (`fase-16-maestro.md`, "Modelo de dados"): `maestro_pipeline`, `maestro_etapa_exec`, `maestro_etapa_config`, `maestro_rigidez`, `maestro_rigidez_log`, `maestro_recibo`, `openrouter_modelo`. O núcleo fala com elas só pela porta `PortaPersistencia` (`servico.ts`):
`salvar(PipelineEstado)`, `carregar(id)`, `listarAtivos(workspace_id|null)`, `salvarRecibo(ReciboMaestro, dados)`, `lerRecibo(pipeline_id)`, `registrarRigidezLog(...)`.
`PipelineEstado` e `EtapaExec` (em `compartilhado/maestro.ts`) são os formatos serializáveis: `plano_json` = `plano`, `maestro_etapa_exec` = `execs[]`. Campos além do SQL do plano: `override_trava` (pipeline), `pane_fechado`, `confirmada`, `tipo`, `piso`, `reduz`, `reforco`, `agrupa_com_anterior`, `avaliacoes` (exec; podem ir num JSON `extra`). `ReciboMaestro.pipeline_id` é o id da INSTÂNCIA (`mpl_...`); o nome do pipeline só aparece no texto.
O texto do pedido não vai ao banco: o serviço grava `<pasta do produto>/maestro/<id>/pedido.md` (normalizado) na confirmação e o relê depois do reinício (`PortaArquivosDoPipeline`).

## 2. O que o coordenador precisa ligar (main)

- `criarServicoMaestro(PortasServico)` (`servico.ts`) uma vez, sob demanda (nada no boot). Portas: relógio, `novoId`, persistência, `PortaLeituraDoMetodo` (contexto/sondas `stat`, `slugsAbertos`, `acharTrabalho`, `descobrirTrabalho`), leitores de nível (`LeitoresDeNivel`), `config()` (`normalizarConfigMaestro`), `despachante` (`abrirPane` com `ArgsAbrirPane`, `enviarComando`, `estado`, harness via `PortaHarnessDeEtapa` sobre `ResolvedorHarness.resolverPerfilDeEtapa`, `fontes()` de perfil, arquivos, `cwdDoPipeline`, `conhecimento` opcional), `arquivos`, `hooks()` (`criarPortaArquivosHooksNode(raiz)` já existe), `decisor` (`criarDecisorDeIntencao` com `criarAsk` sobre `Decisor.ask` da Fase 9; fábrica LAZY), `piso()` (use `verificarPiso` + `varrerSegredosNoDiff(PortaDiff)`), `estadosDosPanes`, `fecharPane`, `criarMissao`, `consultar`/`aprender` (RAG), `notificar`, `evento`.
- Chamar `servico.avancarPipeline(id)` em `method.changed` e `pane.state_changed` (debounce de 300 ms herdado), `servico.tick()` a cada 30 s (só `sem_progresso`) e `servico.retomarAposReinicio()` quando o app sobe com pipelines ativos. Pane aberto pelo Maestro: `registrarPaneDoMaestro` (já feito pelo serviço) e NÃO oferecer `maestro_request` nem hook a ele (anti-loop).
- Canais IPC `maestro:*`, `pipelines:*`, `rigidez:*` e validadores: tipos prontos em `compartilhado/maestro.ts`; os validadores (campo extra, nível fora de 1..5, `justificativa` < 20, `confirmar_plano=0` sem `confirmado`) usam `normalizarConfigMaestro`, `avaliarMudancaDeNivel`, `importarPrevia`, `validarConfig`.
- Tool MCP `maestro_request`/`maestro_status` (via `servico.pedir`, `via: "mcp"`; `MaestroErro.codigo`: `loop_guard`, `taxa_excedida`, `invalid_argument`, `ignorado`), matriz em `mcp/catalogo.ts` e `portas.ts` (livre/squad/agêntico; ausente de workers e Panes de etapa).
- Hook `UserPromptSubmit`: a decisão fica em `servico.pedir({via:"hook"})`; `guardas.ts` já trata eco, slash, `@direto`, marcador e taxa. O script `.mjs` e `juntarSettingsDoClaude` ficam com o coordenador.
- `rede/` (listar modelos do OpenRouter, cliente JEV tipado): NÃO feito (única pasta com `fetch`). O decisor usa a porta `PortaAsk`; `openrouter/uso.ts` (argv, ambiente não sensível, pré-voo) é puro. Falta adicionar `goose` ao `CATALOGO_TERMINAIS` (`terminais/catalogo.ts`, fora da minha área).
- `permissions.deny` do Claude por Pane: `DENY_GIT` (`rigidez/piso.ts`) é a lista; somar no settings por Pane.

## 3. Decisões tomadas (registrar em `01-DECISOES.md` se concordar)

1. **Léxico em `lexico.ts`**, não `lexico.json` (tipo + sem depender de `resolveJsonModule` no bundle do main). ~330 entradas; corpus de 224 frases (ac. 98,9% top-1; 0 falso "alta"). B3 só soma "dúvida" quando nenhuma outra intenção tem ≥ 4 pontos (pergunta forte sobre histórico/convenções não vira dúvida).
2. **Voltas do laço**: QA — `qa_voltas_max` é o nº máximo de QAs (nível 3: o 2º QA reprovado pausa; nível 2: o 1º); auditoria F5 — `reauditoria` é o nº de reauditorias (nível 3: a 3ª reprovação pausa).
3. **Retomada**: etapas que o disco já mostra concluídas saem do plano; na máquina, etapa PENDENTE já concluída pelo disco vira `concluida` com "avançou na mesma sessão" (nunca despachada em dobro). Retomada só troca o pipeline pelo tipo do trabalho nas intenções de trabalho (bug/feature/refatoração/pedido); entrega/convenções mantêm o próprio.
4. **`legadox.raio` antes de existir trabalho** (runx/rapido): sem id, o argumento é o próprio pedido. Em `sprintx_legadox` nível 2 `legadox.caracterizar` fica ○ como na matriz (só o raio é piso).
5. **`mergex.revisar`** entra como etapa HUMANA (sem comando, sem perfil) no fim do pipeline mergex e sozinha no caso B10; conclui só quando o disco mostra `pr_estado: merged`. `prodx.briefing` é sempre por clique (`confirmar`), em qualquer perfil.
6. Chaves derivadas do produto (D-01): versão do JSON de pipelines `<id>_pipelines`, marca no hooks.json `_<id>`, pasta `PRODUTO.pastaNoProjeto`. `hooks.json` com nível 3 e sem arquivo prévio NÃO cria nada.
7. Avaliadores nascem com CLI `auto` (harness escolhe provedor ≠ do implementador; V1 passa por construção) e modelo `null` em todos os padrões de fábrica (faixa decide).
8. `planejar(intencao, rigidez, config) → PlanoMaestro` é o alias `montarPlano`; `planoDeEtapas` com nível 1 e runx/sprintx/sprintx_legadox devolve as etapas do pipeline `rapido`.

## 4. Pendências conhecidas da onda 1

- UI (tela Pipelines, seletor no topo, painel do pipeline, banner), IPC, MCP, script do hook, `rede/` e `main/maestro.ts`: fora do escopo desta onda.
- T-16.30 parcial: o despachante já chama `PortaConhecimentoPrevio` (≤ 150 ms, falha segue) e o serviço `aprender`; a troca de conta no meio da etapa (`account.switched`) é do main.
- `docs/ade/perf/ultimo.json` recebeu P-210a..d, P-211a/b, P-212a/b, P-217a..c, P-218, P-219a/b, P-221, P-224 (rodados à parte com config própria; `npm run perf` não foi executado).
- Textos de proposta para as skills (P-312: auditoria enxuta no nível 2, forma autônoma da F2) continuam por fazer.

---

# Onda 2 (ligação + interface): o que foi feito e o que fica para o coordenador

Feito: migration `0010-maestro` + `repos/maestro.ts` (a `PortaPersistencia` em SQLite, config por etapa, rigidez por escopo, auditoria, retenção em lotes), 25 canais `maestro:*`/`pipelines:*`/`rigidez:*` (contrato em
`compartilhado/maestro.ts` e `ipc.ts`, validadores em `main/ipc/maestro.ts`, preload com paridade), `main/maestro.ts` (serviço sob demanda; `metodo:mudou`/`method.changed`, `pane.state_changed` e `account.switched` → avançar com debounce de 300 ms;
`tick` de 30 s só com pipeline ativo; `retomarAposReinicio` só com pipeline ativo no banco), tool MCP, hook `UserPromptSubmit`, escrita de `.expx/hooks.json` só por ação do usuário, UI (seletor de rigidez, tela Pipelines, "Pedir ao Maestro",
atalho ⌘⇧E) e `AUDITORIA-MAESTRO.md`.

## Decisões a registrar em `01-DECISOES.md` (se concordar)

1. **Decisor e OpenRouter reaproveitam a Fase 9**: o decisor do Maestro usa `harness.decisorDeIntencao()` (config `harness:decisor_*` com `usar_para.intencao`, consentimento por host, cofre, breaker) e o cadastro/lista de modelos do OpenRouter
   continuam em `provedores:openrouter_*` (tabela `openrouter_modelo` da migration 0005). Nada de `rede/` novo, nem canais `maestro:decisor_*`/`maestro:openrouter_*`. A aba Provedores só aponta para essas telas.
2. **Segredo no pedido é redigido** antes de virar argumento de terminal, `pedido.md` e hash (aviso no plano); `comando` no banco vai redigido e curto.
3. **Erros nominais atravessam o IPC como `<codigo>: <mensagem>`** (`abaixo_do_minimo`, `confirmacao_necessaria`, `loop_guard`, `plano_inexistente`, `perfil_invalido`…).
4. **Link simbólico nunca é seguido nem substituído** em `.expx/` (hooks.json, backup) nem na pasta do produto.
5. **Sem Missão por pipeline nesta onda**: terminais de etapa são painéis livres (`contexto.maestro_etapa = true`, que tira a tool e o hook).
6. **Retenção** (recibo e execução de etapa 90 dias, log de rigidez 365): `purgarLote` em ocioso, 15 s depois da onda 2, em lotes de 500.

## Pendências

- **`goose` no `CATALOGO_TERMINAIS` NÃO foi adicionado**: a CLI não está instalada nesta máquina (`which goose` vazio) e o adaptador (flags de modelo e endpoint compatível) não foi verificado contra a CLI real (regra geral 4 de
  `DECISOES-DAS-PENDENCIAS.md`). Pendência do coordenador: instalar o `goose` de forma pontual e reversível, conferir `--help`, e só então acrescentar o item ao catálogo com o `openrouter/uso.ts` (já cobre o argv).
- Banner "pedido detectado… [Encaminhar] [Ignorar]" (T-16.36) e ligação do seletor à Missão do painel em foco: UI parcial (ver relatório da onda).
- Soma do `DENY_GIT` ao `permissions.deny` do Claude por Pane; portas de RAG (`consultar`/`aprender`/`conhecimento`) quando a Fase 15 expuser a ponte no main; `squadPorCargo`/`membro` nas fontes de perfil (Fase 14).
- `tests/maestro.e2e.test.ts` está escrito e passa no type-check, mas não foi rodado (exige `npm run build`; há `npm run dev` do dono ativo). O e2e da via do hook com CLI falsa não foi escrito.
- Falhas alheias vistas na suíte: `tests/varredura-marca.test.ts` (literal da marca em `src/nucleo/conhecimento/fontes/transcricoes.ts`, Fase 15) e `src/nucleo/mcp/catalogo.test.ts` (tools `backlog_*`/`estimate_*` da Fase 18 fora da matriz do modo agêntico).
