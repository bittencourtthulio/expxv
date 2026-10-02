# L · Decisor local laya: pesquisa e decisão (Fase 25, D-695 a D-708)

Pedido do dono: *"o usuário pode ir lá habilitar e baixar o modelo para a máquina dele, igual fazemos com o modelo
de voz para texto, e ao baixar e habilitar teríamos o laya trabalhando localmente para as CLIs terem mais poder de
decisão e atividades como escolher qual CLI usar devido ao consumo ou potência, não usar CLIs que estão perto de
estourar a capacidade se tiver outra com mais limite etc."*

Data da pesquisa: 2026-10-02. Fontes: repositório oficial (`github.com/NandhaKishorM/laya`), release 0.3.23, e o
demo local `../Teste Jev` (aula que compara LLM+JSON Schema vs. Jev na classificação de chamados). Nenhum peso foi
baixado nesta pesquisa (regra: agente nunca baixa modelo real). Tudo que é número **medido** está marcado como tal;
o que vem do repositório do laya é **declarado**; o resto é **estimado** e diz isso.

## 1. O que é o laya (e o que ele não é)

O laya é um motor de **decisões tipadas** ("System 1"): não gera texto. Recebe um estado/texto e perguntas TIPADAS
e devolve decisões com distribuição e confiança calibradas (treinado contra regras de pontuação estritamente
próprias). Três tipos de pergunta, que casam com buracos reais do ExpxV:

| Tipo | Pergunta | Devolve | Exemplo no ExpxV |
|---|---|---|---|
| `choice` | qual opção de N | opção, distribuição de probabilidade, confiança | qual conta/modelo rotear; qual agente da squad; estado do terminal |
| `score` | nota numa escala ordinal | média da escala, distribuição, confiança | urgência de um alerta; risco de estourar cota |
| `noul` | probabilidade de "sim" (inclui "faltam informações") | probabilidade | "esse Pane precisa de mim agora?"; "faltam dados p/ lançar a Missão?" |

Propriedades declaradas pelo repositório (Apache 2.0, ~29,9k stars): encoder **não autorregressivo** (nada para
parsear, nada para alucinar); latência ~33 ms p50 **em GPU T4** (não é CPU: ver §4); checkpoints inglês
(ModernBERT-large, 421 M parâmetros, 512 tokens) e **multilíngue 100+ idiomas** (mmBERT-base, 322 M, contexto de
1 024–8 192 tokens); roteador de script < 1 ms; servidor FastAPI compatível com o protocolo do Jev; **SDK
TypeScript**; suporte a **ONNX Runtime**; honestidade documentada: fraco zero-shot na tarefa de decisões tipadas
(precisa de fine-tune por domínio) e atrás em conjuntos de rótulos de alta cardinalidade.

Por que laya e não o Jev (que o dono já conhece do demo): o Jev só existe como API paga do OpenRouter — D-23
proíbe chamada paga e o texto sairia da máquina. O laya roda **local**, sem custo por chamada, sem dado saindo —
e é compatível com o mesmo protocolo choice/score/noul que a porta `ask` do decisor do Maestro já fala
(`src/nucleo/maestro/decisor/cliente.ts`: `PedidoAsk { kind: "choice" }` → `RespostaAsk { probs, choice,
confidence }`).

## 2. Critérios (herdados da voz local, `base/J-voz-local.md`)

Nada sai da máquina além do download consentido do catálogo fixo · sem custo por chamada · runtime SEM exigir
toolchain do usuário (nada de Python/PyTorch/compilação na máquina dele) · rodar em macOS arm64/x64 e Windows x64
· processo PRÓPRIO (falha nativa não derruba o app; descarregar = encerrar) · desligado por padrão e custo ZERO
desligado · leveza do app (prioridade nº 1; dependência nova só com custo medido, D-regra 5).

## 3. Runtime: como rodar sem Python na máquina do usuário

| | **(a) `onnxruntime-node` + pesos ONNX** (decidido, com portão) | (b) servidor FastAPI do laya (Python) | (c) TS SDK do laya sozinho |
|---|---|---|---|
| O que é | addon N-API **pré-compilado** por plataforma (mesma família de distribuição do `sherpa-onnx-node` da voz) + arquivos `.onnx` do catálogo baixados por consentimento | o dono instala Python 3.10+ e PyTorch (~2 GB) e o app fala HTTP com o servidor | o SDK só formata pedidos; não carrega pesos |
| Toolchain do usuário | nenhuma | **exige** — fere o critério | nenhuma, mas não roda nada |
| Custo no app | peso do addon no pacote (P-706) + pesos em disco do usuário | ~0 no pacote | 0 |
| Veredito | **caminho da Fase 25**, validado pelo portão T-25.02 | rejeitado por padrão; só por decisão futura do dono | inútil sozinho |

Riscos que o portão T-25.02 precisa fechar ANTES de construir (go/no-go): (1) os checkpoints do laya têm exportação
ONNX publicada e carregável pelo `onnxruntime-node` (grafo + head tipado); (2) o tokenizador (mmBERT/roterizador
de script) existe em forma usável pelo SDK TS **sem** runtime Python; (3) versão exata do `onnxruntime-node` e
pacotes por plataforma medidos em tamanho (P-706); (4) inferência de `choice`/`score`/`noul` retorna o contrato
esperado com um grafo pequeno de teste. **No-go = a fase para e registra em `STATUS.md`**; migrar para (b) é
decisão do dono, nunca do agente. Até o portão fechar, nenhum número do laya é tratado como promessa.

### Resultado do portão T-25.02 (2026-10-02) — Veredito: **GO**

Protótipo em pasta temporária (nada no `package.json` do projeto), grafo mínimo gerado **em TypeScript puro**
(serializador protobuf manual, 112 bytes, `Softmax logits[12]→probs` — não é o laya), `onnxruntime-node@1.30.0`
(versão exata pinada). Nenhum peso baixado (só metadados de API e o pacote npm do runtime).

| # | Critério | Resultado |
|---|---|---|
| 1 | Exportação ONNX carregável | **OK.** Caminho oficial documentado: `scripts/export_onnx.py --quantize` grava `encoder.onnx` + `head.onnx` (int8 per-tensor no 0.3.23), copia `tokenizer.json`/`rl_agent_config.json` e confere contra torch (1e-4) — **declarado** pelo repositório. O `onnxruntime-node@1.30.0` carregou e rodou o grafo mínimo sem Python (**medido**: carga 145 ms, o grafo de teste) |
| 2 | Tokenizador TS sem Python | **OK.** `laya-ts/src/tokenizer.ts` é BPE autocontido (byte-level GPT-2 + metaspace, heap p/ CJK) que parseia `tokenizer.json` do HF; Apache 2.0. O pacote **não está no npm** → adaptamos (vendoring com atribuição em `THIRD-PARTY-LICENSES.md`). **Ressalva:** não cobre WordPiece `##` (se o multilíngue mmBERT exigir, o catálogo começa só com os checkpoints BPE: inglês e typed-decisions) |
| 3 | Peso por arquitetura (P-701/P-706) | **OK, dentro do teto ≤ 120 MB** (**medido**): darwin/arm64 85 MB (43 MB desduplicando a `dylib` contada 2×), win32/x64 64 MB, win32/arm64 69 MB, linux/x64 44 MB, linux/arm64 24 MB; pacote npm inteiro 287 MB (todas as plataformas — o app empacota só a do alvo). **Ressalva:** **darwin/x64 não existe** nesta versão → Mac Intel fica sem laya (`runtime_indisponivel`, custo zero, fallback intacto — herdado A15) |
| 4 | Contrato choice/score/noul | **OK** (**medido** com o grafo mínimo): probs normalizadas (Σ=1), `choice`=argmax+probabilidade, `noul`=p(verdadeiro), `score`=esperança da escala ordinal — mapeia 1:1 para `RespostaAsk{probs, choice, confidence}` (`src/nucleo/maestro/decisor/cliente.ts`) e para o `DecisaoLaya` da T-25.03; latência do head mínimo p50 0,09 ms / p95 1,13 ms, RSS do processo vazio 84 MB (o encoder 421 M real é **do dono**, P-702..P-704 provisórios) |
| 5 | Hosts e checksum do catálogo (D-697) | **OK.** Hugging Face `convaiinnovations/laya` (+ `-multilingual`, `-typed-decisions`), revisão por **commit** (`55cf4c4e…`), `sha256`+tamanho por arquivo via `GET /api/models/<repo>?blobs=true` (`lfs.sha256`) — conferível por script sem baixar peso. **Ressalva:** o repo publica **safetensors, não .onnx** → os `.onnx` não têm host+sha256 hoje: download fica recusado (`sem_checksum`) até o dono exportar com o script oficial e publicar (ou o projeto laya publicar); enquanto isso o dono usa a pasta local exportada (`LAYA_MODELO_DIR`) |
| 6 | Sem peso real baixado | **OK** (regra da voz intacta) |

**GO**: nenhum critério deu "não". As três ressalvas (publicação ONNX pendente; darwin/x64 ausente; multilíngue
WordPiece pendente) não invalidam critérios — viram pendências do dono e limites declarados do catálogo, com o
fallback determinístico e o custo zero desligado intactos. Medido × declarado rotulado por linha (D-704).

## 4. Medições e expectativas honestas

- **Nada foi medido ainda** (pesos nunca baixados em desenvolvimento). Os tetos de P-703 (latência ≤ 150 ms) e
  P-704 (RAM ≤ 1,2 GB) são **provisórios**, para validar no modo de verificação do dono (`LAYA_MODELO_DIR`, como
  a voz fez com `VOZ_LOCAL_MODELO_DIR`).
- Os ~33 ms declarados são **GPU**; em CPU da máquina do usuário será mais lento — por isso o teto provisório é
  150 ms p95 e todas as chamadas passam por fila com taxa (D-700), timeout curto e fallback determinístico.
- **Fraqueza zero-shot declarada pelo próprio laya**: sem ajuste, a qualidade das decisões tipadas é limitada. O
  consentimento diz isso em português claro. O valor inicial vem de perguntas genéricas (estado de terminal,
  categoria de erro, urgência); fine-tune local com o histórico do próprio usuário é **fase futura** (D-705) e,
  se um dia rodar, o treino é todo na máquina (casa com D-23).

## 5. Catálogo e origem dos arquivos (mesma disciplina da voz, D-540/D-542)

`resources/laya/modelos.json`: host fixo, revisão fixada por commit do repositório de pesos, tamanho e **sha256
por arquivo** (campo `lfs.oid` da API do Hugging Face ou equivalente do host oficial do laya — a confirmar no
portão T-25.02), licença exibida no consentimento, idiomas e limites de contexto declarados. Entrada sem checksum
confirmado = `a_verificar` e o app **recusa baixar**. Download **só por clique**, consentimento por modelo,
progresso coalescido (≤ 4/s), pausar/retomar/cancelar/apagar; arquivo em `<pasta do produto>/laya/`, contado no
medidor de disco. Rede só por `src/nucleo/rede/cliente-http.ts`, com redirect só para a CDN documentada do host.
Agentes e testes NUNCA baixam pesos: suíte toda com stub ONNX falso local.

## 6. O que o laya faz e o que ele nunca faz (o contrato de uso)

**Faz (Fase 25):** sugerir intenção ao Maestro (terceira fonte do decisor, estende D-228); **ordenar** candidatos
de roteamento da Fase 9 (o `pickAccount` e a tabela de equivalência continuam sendo a autoridade); classificar
estado de terminal, categoria de erro e urgência de alerta como **sinais** com confiança e rótulo na UI; expor
uma tool MCP `laya_decide` **desligada por padrão**.

**Nunca faz:** decidir ação sozinho (a autoridade é sempre a regra determinística, D-216 estendido — D-698);
justificar aprovação, `pane_spawn`, rigidez ou qualquer D-21/D-640..646; sair da máquina; entrar no caminho de
boot; custar qualquer coisa desligado (D-708); persistir o texto que leu (só métricas agregadas: latência,
confiança, categoria, hash — D-699).

## 7. O que ficou de fora desta fase

Fine-tune/treino local (o repositório traz notebooks; fica como fase futura com dados do usuário, tudo na
máquina); aceleração GPU/CoreML; usar o laya como avaliador de código (D-21 mantém humano/LLM em Pane separado);
decisões dentro de hooks de segurança; versão headless do serviço para o Portal da Fase 24 (a fila de triagem
pode consumir o laya no futuro, mas por outra decisão).
