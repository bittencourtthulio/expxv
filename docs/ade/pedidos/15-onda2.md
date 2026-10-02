## Pedidos da Onda 2 da Fase 15 (ligação + UI) ao coordenador

Tudo abaixo ficou fora da área do agente (arquivos de outras fases) ou depende de uma decisão do dono. O núcleo, o worker, os canais, o chat, a UI e
o backend online estão ligados e testados.

### 1. O que ficou ligado (para conferir no `STATUS.md`)
- `src/main/conhecimento.ts` (host do worker por RPC, porta da Fase 8, canais `conhecimento:*`, tick ocioso, porta das tools MCP e do Maestro),
  `src/main/chat.ts` (conversas, executor headless, plano por código), `src/main/rag-backend.ts` (`rag:*`, consentimento, migração), `src/main/conhecimento-boot.ts`
  (montagem preguiçosa) e `src/main/conhecimento-worker.ts` (thread). `main.ts`: `prepararConhecimento`/`iniciarConhecimento`, porta na memória, `rag` na orquestração e no Maestro.
- Canais `conhecimento:*` (21), `chat:*` (10) e `rag:*` (14) em `compartilhado/ipc.ts`, validadores estritos em `main/ipc/conhecimento-validadores.ts`, preload com paridade.
  Acréscimos ao contrato do plano: `workspace_id` nos canais que dependem do workspace, `conhecimento:modelos`/`modelo_definir` (detectar Ollama / trocar o modelo de embedding).
- Migrations: nenhuma no `expxv.db` (a `0009` já existia); o `conhecimento.db` ganhou a `0002-fila-por-colecao` (auditoria C-01).
- Empacotamento: `asarUnpack` do worker e do fecho (`electron-builder.yml`) e entrada no teste de fecho (`tests/scripts/empacotamento.test.ts`).

### 2. Falta ligar (donos de outras áreas)
- **Regra de consulta obrigatória em `task aberta→reivindicada`** (`nucleo/board/delegar.ts`): chamar `verificarConsultaRag` e `contextoPrevioDoBriefing` (exportados por `orquestracao/regras.ts`/`briefing.ts`).
- **Injeção em `metodo:disparar`** (`nucleo/metodo` + `main/ipc/metodo.ts`): anexar `portaMcp.contextoParaInjecao({ origem: "injecao", ... })` ao argumento do comando (≤ 150 ms; falha/lento/vazio não bloqueiam).
- **Maestro**: `consultar`/`aprender` já usam o RAG (`DepsMaestro.rag`). A porta `PortaConhecimentoPrevio.contextoPrevio(texto, arquivos)` não recebe o workspace; para ligá-la, acrescentar o `workspace_id` como 3º argumento no despachante e usar `lig.paraMaestro(ws).conhecimento.contextoPrevio`.
- **Perfil do chat por consumo (Fase 9):** `DepsMontagemConhecimento.roteamento` aceita `PortaRoteamento` (`resolverPerfil`); hoje o perfil escolhido vale como está.
- **Destilar com IA (P-56):** ligado (`conhecimento:destilar_missao`: resumo redigido ≤ 6 KB de decisões, riscos, handoffs e QA da Missão → uma chamada à CLI do chat → esquema validado → candidatos `sistema`). Falta só o gatilho automático ao fechar a Missão quando `aprendizado_modo = "assistido"` (hoje é o botão).
- **Retenção:** `conhecimento_config.retencao_transcricao_dias` (padrão 90) e o teto de 1 GB ainda são os do plano; P-59 (365 dias, 5 GB) é só ajustar as constantes/`CONFIG_PADRAO`.
- **Documentos do coordenador (T-15.50):** `05-CONTRATOS.md`, `04-UI-UX.md`, `AGENTS.md` e `STATUS.md`.

### 3. Pendências do dono
- **P-58** chamada real mínima por CLI (Claude, Codex, OpenCode) para validar o formato de saída; **P-54** teste real com free tier dos provedores online; **P-57** spike do `sqlite-vec` (depende de P-03); **P-50** baixar o modelo ONNX (runtime não instalado; ver D-97).
- Nada disto bloqueia o uso: sem elas o RAG roda com `hash-256-v1` + FTS5 + grafo, o chat cai em modo busca sem CLI utilizável e o backend online fica desligado.
