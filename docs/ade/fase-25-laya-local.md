# Fase 25 — Decisor local laya: download consentido, serviço próprio, sugestões com confiança

Pedido do dono: *"o usuário pode ir lá habilitar e baixar o modelo para a máquina dele, igual fazemos com o modelo
de voz para texto, e ao baixar e habilitar teríamos o laya trabalhando localmente para as CLIs terem mais poder de
decisão e atividades como escolher qual CLI usar devido ao consumo ou potência, não usar CLIs que estão perto de
estourar a capacidade se tiver outra com mais limite etc."* — e, na conversa que originou a fase: onde mais o
decisor local ajudaria. **Esta fase só estrutura e planeja** (nenhum código, teste, migration ou `package.json`
foi tocado ao escrever este arquivo); a implementação vem depois, pela ordem de `06-FASES.md` e do
`PILOTO-AUTOMATICO.md`. Pesquisa e decisão técnica: `base/L-laya-local.md`.

## Objetivo e valor

1. **Um motor de decisões tipadas LOCAL no ExpxV** (choice/score/noul com confiança calibrada), baixado por
   consentimento no mesmo molde do modelo de voz (D-540/D-542): catálogo versionado com sha256, clique por
   download, nada sai da máquina (D-23 intacto), desligado por padrão e custo zero desligado.
2. **O laya sugere, a regra decide.** Autoridade continua com as regras determinísticas (extensão direta do
   D-216/D-228): o laya **ordena candidatos, classifica estados e pontua urgência**, sempre com confiança e
   rótulo na UI; abstenção (confiança < limiar), erro, timeout ou processo morto = **fallback determinístico**
   com comportamento exatamente igual ao de hoje.
3. **Consumidores da Fase 25** (em ondas, cada um valendo sozinho): (A) fundação — serviço local + download +
   UI; (B) Maestro (terceira fonte do decisor: `laya_local`, custo zero, zero rede) e roteamento da Fase 9
   (ordenação de contas/modelos por consumo — o `pickAccount` e a tabela de equivalência continuam mandando);
   (C) sinais de terminal (estado do painel), classificação de erro e urgência de alerta (Fase 20);
   (D) tool MCP `laya_decide` para as CLIs, **desligada por padrão**.
4. **Nenhuma decisão de ação nasce do laya** (D-698): aprovações, `pane_spawn`, rigidez, assinatura, merge e
   tudo que é humano (D-21, D-640..D-646) seguem intocados; o laya nunca aparece como justificativa deles.

## Portão da fase

1. **T-25.01 (estudo de ameaças) e T-25.02 (portão de runtime go/no-go) concluídas e aprovadas ANTES de qualquer
   outra task** — inclusive tipos, migration e esqueleto de serviço. Reprovado = fase parada e registrada em
   `STATUS.md` → Bloqueios (a fila segue). Mesma regra das Fases 20, 22 e 24.
2. `npm run verificar` verde (typecheck + unidade + marca + orçamentos estáticos incluindo P-700) e
   `npx vitest run tests/scripts` verde (fronteira de rede sem novidades, empacotamento com as linhas exatas).
3. **Nenhum peso é baixado por agente ou teste em toda a fase** (regra da voz): a suíte roda com um stub ONNX
   falso local; a medição com modelo real é do dono, pelo modo de verificação (`LAYA_MODELO_DIR`).
4. `npm run perf`: **P-700..P-709 verdes**; P-01/P-08/P-12 sem piorar; `docs/ade/perf/ultimo.json` gravado.
5. **Suíte adversarial (T-25.20) verde**: cada caso AP-01..AP-16 tem teste nomeado que **falha se a mitigação for
   removida** (mutação) e `tests/scripts/ameacas-fase25.test.ts` confirma que toda ameaça Alta aponta para uma
   task e um teste existentes.
6. Com o laya **desligado** (padrão): **0 processos, 0 timers, 0 sockets**, módulos `laya/` **não importados**
   (import dinâmico), bundle do renderer sem chunk novo carregado (P-700).
7. **Sem laya, o comportamento dos consumidores é idêntico ao de hoje** — teste de não-regressão executado com o
   serviço desinstalado, abstendo e morto (T-25.08): nenhuma latência nova perceptível (P-708).

## Princípios

1. **Leveza e velocidade (prioridade nº 1).** O laya nunca está no caminho de boot, de tecla ou de render; toda
   decisão é assíncrona com timeout curto (≤ 500 ms), coalescida por chave e **opcional para o consumidor** —
   quem pergunta deve funcionar igual sem resposta.
2. **O texto que entra no laya é dado não confiável** (saída de CLI, erro, evento): teto de tamanho por chamada,
   redação pelo scrubber existente antes de qualquer log/artefato, e **o texto nunca é persistido** — só
   métricas agregadas (latência, confiança, categoria, hash) (D-699).
3. **Processo próprio, vida curta.** O runtime é um processo separado (herança da voz): falha nativa derruba só
   o decisor; ociosidade encerra; uma retentativa e, se cair de novo, fica desligado até a pessoa clicar (D-707);
   prioridade de CPU baixa para nunca disputar com terminais e workers (D-700).
4. **Reuso, não duplicação.** Download/consentimento/progresso (espelho de `voz-modelos`), cliente de rede
   (`rede/cliente-http.ts`), scrubber, medidor de sistema, matrizes de tools do MCP, `ItemLista` (D-694),
   barramento, orçamentos: **os existentes**. Código novo só para o que é do decisor.
5. **Rede num lugar só (D-114).** A única rede nova da fase é o download consentido do catálogo fixo — nenhuma
   chamada por decisão (zero rede em produção, diferente do Jev do OpenRouter).
6. **Fonte honesta.** Latência, RAM e confiança medidas na máquina aparecem; o que não foi medido aparece "sem
   medida"; os números declarados pelo laya (33 ms em GPU, acurácia) aparecem rotulados como declarados; a
   fraqueza zero-shot está no consentimento, em português claro (D-704).

## Estado atual (lido em 2026-10-02 — ponto de partida, não resultado)

| Item | Hoje |
|---|---|
| Decisor do Maestro | `src/nucleo/maestro/decisor/cliente.ts`: `ConfigDecisorMaestro.fonte: "jev_direto" \| "openrouter" \| null`, desligado por padrão, consentimento próprio, `resumirParaDecisor` (≤ 500, redigido), resposta validada, erro/timeout ⇒ `null` e a regra segue (D-216/D-228). **Porta `ask` já fala o protocolo choice/probs/confidence do Jev** — o laya é a fonte `laya_local` |
| Modelo de voz | `src/nucleo/voz/local/**`, `main/voz-modelos*.ts`, `resources/voz/modelos.json`, canais `voz:modelos_*`: o molde inteiro do download consentido (sha256, progresso coalescido, pausar/retomar/cancelar, `a_verificar` = recusar) |
| Roteamento (Fase 9) | `pickAccount` puro + tabela de equivalência por faixa + `LimitsService`; onda 2 (troca automática) em andamento — a fase **não mexe na autoridade**, só acrescenta ordenação sugestiva |
| Estado de terminal | heurística de tela/sinaleira por CLI (`harness-pane`, hooks) — sem confiança calibrada |
| Alertas (Fase 20) | regras fixas de prioridade/canal |
| Erros | `pane.ts`/limites tratam códigos conhecidos; sem classificação genérica com confiança |
| MCP interno | matriz de tools por modo/papel (D-13); sem tool de decisão |
| Migrations | até `0021-bichinho-especies`; **próxima = próximo número livre na execução** |

**Lacunas que a fase fecha:** (1) motor de decisão tipada local; (2) download consentido de pesos de decisão;
(3) terceira fonte do decisor do Maestro sem rede e sem custo; (4) ordenação sugestiva de roteamento;
(5) sinais de terminal/erro/alerta com confiança; (6) tool MCP de decisão para CLIs (desligada).

## Decisões que esta fase toma (resumo; texto completo em `01-DECISOES.md`, D-695..D-708)

- **D-695:** laya local opcional no molde da voz; desligado por padrão; nada sai da máquina além do download consentido.
- **D-696:** runtime em processo próprio com addon N-API pré-compilado (`onnxruntime-node`, versão exata) + pesos
  ONNX do catálogo; **zero Python/toolchain do usuário**; portão T-25.02 bloqueante; no-go = fase para.
- **D-697:** catálogo `resources/laya/modelos.json` (host, revisão por commit, sha256 por arquivo, licença); sem
  checksum = recusar; agentes nunca baixam pesos.
- **D-698:** o laya sugere, nunca decide — extensão do D-216; abstenção/erro = fallback determinístico; nada de
  D-21/D-640..646 se apoia no laya.
- **D-699:** entrada é dado não confiável; teto, redação, e o texto nunca é persistido (só métricas agregadas).
- **D-700:** fila com taxa máxima configurável, timeout ≤ 500 ms, coalescência por chave, processo em prioridade
  baixa de CPU.
- **D-701:** consumidores da fase: Maestro (`laya_local`), ordenação de roteamento, estado de terminal,
  classificação de erro, urgência de alerta — todos com fallback e rótulo na UI.
- **D-702:** tool MCP `laya_decide` entregue **desligada** (matriz por modo, taxa, resposta tipada, sem eco de texto).
- **D-703:** UI "Decisor local" nas Configurações (consentimento por download com licença/tamanho/aviso zero-shot,
  progresso, testar com números medidos, desligar = encerrar processo).
- **D-704:** métricas honestas: medido × declarado × estimado sempre rotulado na UI e nos docs.
- **D-705:** fine-tune/treino local fica fora (fase futura, tudo na máquina).
- **D-706:** Windows só unidade/config (D-26); pacotes do addon por plataforma declarados no portão.
- **D-707:** crash = `laya_falhou` + 1 retentativa; segunda queda = desligado até clique (nunca restart infinito).
- **D-708:** sem laya = custo zero: 0 processos/timers/sockets, módulos não importados, sem chunk novo no renderer.

## Ondas e tasks

Dependências: A (fundação) → B (consumidores de decisão) → C (sinais) → D (tool MCP); T-25.20/T-25.21 fecham.
Dentro de B, B1 (Maestro) e B2 (roteamento) são independentes entre si; dentro de C, idem.

### Onda 0 — Portões (bloqueantes)

#### T-25.01 · Estudo de ameaças — OBRIGATÓRIO E PRIMEIRO

Produto: `docs/ade/seguranca/AMEACAS-FASE-25.md` + `tests/scripts/ameacas-fase25.test.ts`. Herda e **não duplica**
`AUDITORIA-VOZ-LOCAL.md` (download de modelo) e `AMEACAS-TELEGRAM.md` (entrada não confiável): marca o herdado e
escreve só o novo.

Critérios de saída: (1) fronteiras de confiança (F1 rede ↔ download; F2 texto não confiável ↔ laya; F3 laya ↔
consumidores; F4 runtime ↔ app) com controle de cada uma; (2) STRIDE por componente (download, catálogo, runtime,
fila, consumidores, tool MCP) e **≥ 16 casos AP** com severidade, mitigação, task e nome de teste; (3) modelo de
entrada fechado: o que pode entrar (tamanho, codificação, origem), como é redigido, o que NUNCA entra; (4) portões
G1–G5 (abaixo); (5) residuais declarados e enviados a `PENDENCIAS-DO-DONO.md`; (6) consistência mecânica: cada AP
Alta cita task `T-25.NN` existente e nome de teste; o teste falha se perder elos.

**Portões de segurança**

| Portão | Salto que ele impede | Condição |
|---|---|---|
| G1 | de "texto de CLI/erro" para "ação executada" | laya só devolve decisão tipada; ação é sempre da regra determinística (D-698) |
| G2 | de "decisão" para "aprovação/rigidez" | D-21/D-640..646 fora do alcance do laya por construção (sem consumidor desses) |
| G3 | de "peso baixado" para "código executado" | pesos são dados ONNX verificados por sha256; runtime é o addon assinado do pacote; nada do download é executável |
| G4 | de "consulta local" para "rede" | produção: zero rede por decisão; só o download consentido do catálogo fixo (D-114) |
| G5 | de "tool MCP" para "escala de custo" | `laya_decide` desligada por padrão, taxa por Pane, teto de tamanho (D-702) |

**Pré-análise (insumo mínimo)**

| # | Caso | Sev. | Mitigação (task) |
|---|---|---|---|
| AP-01 | Entrada gigante trava o runtime (DoS local de CPU) | Alta | teto de bytes/tokens por chamada, fila com taxa, timeout, descarte contado (T-25.06, T-25.07) |
| AP-02 | Loop de decisões (consumidor pergunta a cada evento) vira mineração disfarçada | Alta | taxa máxima por minuto (padrão baixo), coalescência por chave, processo em `nice` baixo (T-25.06) |
| AP-03 | Peso corrompido/adulterado no disco (MITM pós-download, edição manual) | Alta | sha256 verificado no download e re-verificado a cada carga; falha = recusa + re-download (T-25.05, T-25.06) |
| AP-04 | Entrada com segredo vaza para log/artefato/evento | Alta | redação antes, texto nunca persistido, eventos `laya.*` só com métricas (T-25.07, T-25.09) |
| AP-05 | Decisão influenciada por texto hostil (prompt injection clássico) | Média | encoder classificador (não gerador); entrada é dado sem instrução; a autoridade é a regra (T-25.07, T-25.08) |
| AP-06 | Crash do runtime derruba o app ou vira restart infinito | Alta | processo próprio; 1 retentativa; segunda queda = desligado até clique (T-25.06) |
| AP-07 | Tool `laya_decide` usada em laço por agente (custo/flood) | Alta | desligada por padrão, taxa por Pane, teto, resposta tipada sem texto de volta (T-25.19) |
| AP-08 | Sugestão errada de roteamento manda trabalho para conta errada | Média | ordena apenas; `pickAccount`/equivalência decidem; rótulo e confiança na UI; telemetria de acerto (T-25.13, T-25.14) |
| AP-09 | Abstenção silenciosa degrada para sempre sem ninguém ver | Média | contador de abstenções/erros por consumidor na UI do decisor (T-25.10) |
| AP-10 | Download consome banda/disco sem controle (modelos grandes) | Média | tamanho declarado no consentimento, progresso, pausar/cancelar, contagem no medidor de disco (T-25.05) |
| AP-11 | RAM do laya sufoca a máquina com app + CLIs | Média | RAM medida no "testar", aviso no consentimento, encerrar por ociosidade curto (T-25.06, T-25.10) |
| AP-12 | Estado de terminal classificado errado notifica demais (alarme falso crônico) | Média | sinal apenas, rótulo com confiança, limiar configurável, fallback heurística atual (T-25.15) |
| AP-13 | `laya:modelo_apagar` apaga em uso / caminho fora da pasta do produto | Alta | recusa com processo vivo; caminhos relativos e ancorados (regra 12); apagar = encerrar antes (T-25.05, T-25.06) |
| AP-14 | Modelo "a_verificar" baixado por engano | Alta | entrada sem checksum confirmado = recusa `sem_checksum` (D-697, T-25.04) |
| AP-15 | Rede do laya além do download (telemetira do runtime, update silencioso) | Alta | varredura: `laya/` sem import de `net`/`fetch` direto; rede só em `rede/` com consentimento (T-25.09, T-25.21) |
| AP-16 | Falha do portão de runtime descoberta tarde (fase meio construída) | Alta | T-25.02 bloqueante antes de qualquer código (portão da fase) |

#### T-25.02 · Portão de runtime go/no-go (pesquisa + protótipo mínimo)

Produto: seção §3 de `base/L-laya-local.md` preenchida com **medições** + registro em `01-DECISOES.md`/`STATUS.md`.

Critérios de saída (todos binários; um "não" = no-go e a fase para): (1) exportação ONNX dos checkpoints do laya
existe e carrega no `onnxruntime-node` (versão exata pinada) com um **grafo pequeno de teste** (não o laya);
(2) tokenização/roterizador de script utilizável pelo SDK TypeScript **sem** runtime Python; (3) peso medido por
plataforma do addon (P-706) dentro do teto provisório (≤ 120 MB por arquitetura; estourar = voltar ao dono, não
relaxar); (4) contrato de saída (`choice`/`score`/`noul`) validado contra o `PedidoAsk`/`RespostaAsk` existente;
(5) hosts e formato de checksum do catálogo confirmados (D-697); (6) sem peso real baixado (regra da voz).

### Onda A — Fundação (download, runtime, decisão, fallback, IPC, UI)

#### T-25.03 · Tipos e contrato §29

`src/compartilhado/laya.ts`: `TipoPergunta = "choice" | "score" | "noul"`, `DecisaoLaya` (tipo, escolha/pontuação/
probabilidade, confiança, limiar, latência, modelo_id, `absteve`), `EstadoLaya`, `ConfigLaya` (habilitado,
modelo_id, confianca_minima, taxa_maxima_minuto, ociosidade_s, usar_no_maestro, ordenar_roteamento, sinais…).
Canais `laya:estado`, `laya:consentir`, `laya:modelos_listar`, `laya:modelo_baixar|pausar|retomar|cancelar|apagar`,
`laya:testar`, `laya:config_gravar`; eventos `laya.modelos`, `laya.estado`. `05-CONTRATOS.md` §29 + validadores
estritos campo a campo. Nada de runtime aqui: só contrato.

#### T-25.04 · Catálogo versionado

`resources/laya/modelos.json` (estrutura da voz): host, revisão por commit, arquivos com tamanho+sha256, licença,
idiomas, contexto máx., tipo de pergunta suportado, notas. Script de conferência programática contra a API do host
(sem baixar pesos > 5 MB); entrada `a_verificar` = recusa. Teste: catálogo fechado, sem campo livre.

#### T-25.05 · Núcleo de modelos (espelho do `voz-modelos`)

Estado por modelo (ausente/baixando/pausado/pronto/erro), download só por clique com consentimento versionado,
sha256 por arquivo antes de "pronto", progresso coalescido ≤ 4/s (P-706), pausar/retomar/cancelar, apagar com
processo morto, retomada de parcial, `sem_checksum`/`checksum_divergente` como erros nomeados. Rede só por
`cliente-http` com allowlist do catálogo; bloqueio do main ≤ 50 ms (P-705). Testes com servidor falso em loopback.

#### T-25.06 · Runtime em processo próprio

Spawn sob demanda (nada no boot), protocolo NDJSON versionado (molde do daemon de PTY), carga com re-verificação
do sha256, `nice` baixo, ociosidade encerra (padrão curto), crash = `laya_falhou` + 1 retentativa + desligar
(D-707). Fila com taxa máxima/minuto, coalescência por chave, timeout ≤ 500 ms, descarte contado. Suíte inteira
com **stub ONNX falso** (grafo mínimo artificial): nunca baixa peso. P-702/P-703/P-707/P-709 com stub; os reais,
com o dono.

#### T-25.07 · Decisão canônica e entrada segura

Função pura `decidir(PerguntaLaya) → DecisaoLaya | Abstencao | Erro`: teto de entrada por tokens do checkpoint,
normalização, redação pelo scrubber antes de qualquer log, limiar de abstenção, mapeamento dos três tipos para o
`DecisaoLaya` (e o_adapter `PedidoAsk` ↔ `PerguntaLaya` para o Maestro). O texto lido nunca é gravado: só métricas
agregadas (latência, confiança, categoria, hash) (D-699).

#### T-25.08 · Composição com fallback determinístico

Cada consumidor declara seu fallback puro (o comportamento de hoje). Teste de não-regressão triplo: desinstalado,
abstendo, runtime morto — saída e latência idênticas às de hoje (P-708 ≤ 5 ms de acréscimo). Regra em código:
**nenhum consumidor pode bloquear em `decidir`** (sempre `Promise` com timeout + valor padrão).

#### T-25.09 · Main: IPC, boot preguiçoso, integrações

Registro dos canais `laya:*` com validadores; serviço criado só no primeiro uso; integração ao medidor de
sistema/disco (Fase 25 usa o existente); eventos `laya.*` no barramento com payload só de métricas; varredura de
rede (`laya/` não importa `net`/`fetch` fora de `rede/`) e de marca. Teste: com laya desligado, 0 processos,
0 timers, 0 sockets, módulos não importados (P-707).

#### T-25.10 · Renderer: Configurações → "Decisor local"

Seção nas Configurações no padrão `ItemLista` (D-694): estado do modelo, consentimento por download (licença,
tamanho, idiomas, **aviso de fraqueza zero-shot em português claro**, RAM estimada rotulada), progresso com
pausar/cancelar, "Testar" (latência/RAM medidas, decisão de amostra), desligar (= encerrar), contadores de
abstenção/erro por consumidor (AP-09), taxa/limiar/ocisidade editáveis. Sem chunk novo carregado sem abrir a
seção (P-700).

#### T-25.11 · Perf da fundação

`tests/perf/laya-local.perf.ts` com stub (P-705..P-707, P-709) + modo de verificação do dono com
`LAYA_MODELO_DIR` (P-702 carga, P-703 latência p95, P-704 RAM) que grava os números reais no `testar` da UI.
Sem modelo = «não medido», nunca inventado (D-704).

### Onda B — Consumidores de decisão

#### T-25.12 · Maestro: fonte `laya_local` (estende D-228)

`ConfigDecisorMaestro.fonte` ganha `"laya_local"`; porta `ask` implementada sobre T-25.06/T-25.07 (mesmo
`PedidoAsk`/`RespostaAsk`); custo = 0 e rede = 0 sempre; `resumo_enviado` continua o resumo redigido (consistência
com as outras fontes) com nota "(local)"; tabela de combinação do D-216 **intacta** (a regra vence em conflito);
`usar_no_hook` continua desligado por padrão; UI da config do decisor lista a nova fonte com o selo "local, sem
custo, sem rede". Testes: stub devolvendo decisão/abstenção/erro — os três caminhos caem no comportamento de hoje.

#### T-25.13 · Roteamento (Fase 9): ordenação sugestiva

Função pura `ordenarCandidatos(candidatos, sinais) → candidatos ordenados + confiança + motivo`: pergunta `choice`
ao laya sobre as contas/modelos **habilitados** com sinais de consumo/potência/faixa; o `pickAccount` e a tabela
de equivalência continuam sendo a autoridade (o laya só reordena dentro do que a regra permite — nunca introduz
candidato fora da lista, nunca quebra trava de limite). Desligado por padrão (`ordenar_roteamento`). Telemetria
local: quantas vezes a pessoa aceitou/rejeitou a ordem (aprunda o futuro fine-tune, D-705).

#### T-25.14 · UI: rótulo de sugestão local

Na tela de consumo (Fase 9) e no card de troca: selo "sugestão do decisor local" com confiança e motivo curto;
sem laya, nada renderiza (custa zero). O texto do motivo é gerado por regra, não pelo laya (o laya não gera texto).

### Onda C — Sinais de terminal, erro e alerta

#### T-25.15 · Estado do terminal com confiança

`choice` sobre classes {rodando, aguardando_a_cli, aguardando_voce, terminou, travado} a partir do buffer/screen
do Pane (teto de tokens; snapshot já existente da sinaleira). A heurística atual vira o **fallback e o rótulo de
base**; divergência heurística×laya aparece no painel de saúde do decisor (AP-12). Consome os eventos existentes;
sem polling novo.

#### T-25.16 · Classificação de erro com confiança

`choice` sobre {quota, rede, permissao, bug_modelo, bug_codigo, ambiguo} para saídas de erro que chegam ao
sistema (Pane/limites/missões); alimenta as ações determinísticas **já existentes** (quota → rotação da Fase 9;
permissão → notificar; bug → card). Nenhuma ação nova nasce aqui.

#### T-25.17 · Urgência de alerta (Fase 20)

`score` 0–4 de urgência por evento como **sinal de priorização** (toast × rodapé × silêncio); regras fixas
continuam existindo e vencem em trava (ex.: cota estourada nunca é silenciada por score baixo). Horário de
silêncio e canais intactos.

#### T-25.18 · `noul` "precisa de você agora?"

Probabilidade de "esse Pane precisa de humano agora" combinando T-25.15/T-25.17 — usado **só** para ordenar a
sinaleira/rodapé e o digest; notificação de sistema continua nas regras atuais.

### Onda D — Tool MCP (desligada)

#### T-25.19 · `laya_decide` no MCP interno

Tool `laya_decide(pergunta_tipada)` na matriz por modo/papel (D-13), **desligada por padrão em todos os modos**;
ativação por Pane opt-in; taxa por Pane; entrada com teto; resposta tipada (decisão+confiança), **sem texto
gerado**; auditoria como toda tool. `tools/list` filtrado continua valendo.

### Fechamento

#### T-25.20 · Suíte adversarial + mutação

Um teste nomeado por AP-01..AP-16 que falha ao remover a mitigação; `tests/scripts/ameacas-fase25.test.ts`
consistência (Alta → task + teste existentes); mutação: remover teto de entrada, taxa, sha256, fallback e
verificar o teste correspondente falhar.

#### T-25.21 · Empacotamento e docs

`electron-builder.yml` (`asarUnpack` do addon, linhas exatas na varredura de empacotamento), `npm run test:pacote`
com o addon presente e pesos ausentes (o pacote NUNCA traz pesos), README curto ("Decisor local"), STATUS,
orçamentos reais do dono registrados, PENDENCIAS revisadas. `npm run verificar` + `npx vitest run tests/scripts`
verdes.

## Orçamentos (detalhe em `03-ORCAMENTOS-DESEMPENHO.md`)

P-700 bundle sem mudança de boot · P-701 peso do addon por arquitetura (teto provisório do portão) · P-702 carga
do modelo · P-703 latência p95 de decisão · P-704 RAM do processo · P-705 bloqueio do main no download · P-706
eventos de progresso · P-707 custo zero desligado · P-708 acréscimo do fallback · P-709 taxa/fila de decisões.

## Ordem e dependências

```
T-25.01 ─┬─► T-25.02 ─► A (T-25.03..T-25.11 em cascata, 03 antes de 04/05, 06 antes de 07/08)
         │              └► B (T-25.12 | T-25.13+14) ─► C (T-25.15..18) ─► D (T-25.19) ─► T-25.20 ─► T-25.21
```

A onda A entrega sozinha (decisor instalável + testável); B/C/D são independentes entre si após A e podem ser
interrompidas sem deixar o app pior (cada consumidor tem fallback).
