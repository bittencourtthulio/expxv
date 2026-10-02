# J · Voz local embutida: pesquisa e decisão (Fase 11, D-540 a D-549)

Pedido do dono: "na parte de COMANDO DE VOZ a configuração oferece servidor HTTP compatível ou comando local. O nosso sistema já tem que vir com uma ESTRUTURA LOCAL: ao chegar no comando local
para habilitar, me dar a opção de baixar um modelo de voz pequeno, local, que já baixa, habilita e deixa funcionando. O Orca usa um Parakeet TDT v3."

Data da pesquisa: 2026-10-01. Fontes: páginas oficiais do Hugging Face (API de árvore com o `oid` SHA-256 de cada arquivo LFS), cartões dos modelos, repositório do sherpa-onnx e pacotes do npm.
Tudo que é número **medido** está marcado como tal; o resto é declarado pela fonte ou **estimado** (e diz isso).

## 1. Critérios

PT-BR em primeiro lugar (o dono dita em português) · tamanho em disco · RAM com o modelo carregado · velocidade (fator de tempo real, RTF, em CPU) · licença permitir distribuir/usar em produto ·
runtime SEM exigir toolchain nativo do usuário (nada de compilar no computador dele) · rodar em macOS arm64/x64 e Windows x64 · leveza do app (D-23/D-25 e prioridade nº 1).

## 2. Modelos comparados

| Modelo | PT-BR | Disco (int8) | RAM (carregado) | Velocidade | Licença | Veredito |
|---|---|---|---|---|---|---|
| **NVIDIA Parakeet TDT 0.6B v3** (25 idiomas europeus) | **excelente**: WER 4,76 % (FLEURS pt_br), 3,96 % (CoVoST pt), 7,5 % (MLS), do cartão do modelo; com pontuação e maiúsculas | 670 MB (encoder 652 + decoder 12 + joiner 6 + vocabulário) | ~1,5 GB (**estimada**: arquivo × ~2 do ONNX Runtime; não medida: o modelo não foi baixado no desenvolvimento) | transducer TDT (decodificação por duração, feita para throughput); **não medida** aqui | CC-BY-4.0 (exige atribuição: exibida no consentimento e na lista) | **padrão recomendado** (o mesmo do Orca) |
| Whisper Small (OpenAI, multilíngue) | muito boa (cai em nomes técnicos e sem pontuação garantida) | 375 MB | ~0,9 GB (estimada) | autorregressivo: mais lento em trechos longos; só 30 s por janela (o runtime divide) | MIT no repositório da OpenAI; o cartão do HF marca Apache-2.0; ambas permissivas | alternativa média |
| Whisper Base (multilíngue) | boa em frases curtas, erra termos técnicos | 161 MB | ~0,5 GB (estimada) | rápido | idem | alternativa pequena/rápida |
| Whisper Tiny (multilíngue) | fraca em PT (alucina e troca palavras) | 104 MB | ~0,3 GB | muito rápido | idem | **descartado**: a economia de 57 MB sobre o Base não compensa a queda de qualidade |
| Moonshine Tiny (inglês) | **não suporta PT** | 124 MB | ~0,4 GB (estimada) | muito rápido | MIT | incluído só para quem dita em inglês e quer a menor latência |
| NeMo FastConformer PT Hybrid Large PC (`nvidia/stt_pt_fastconformer_hybrid_large_pc`) | excelente em PT, modelo PEQUENO (131 MB) | 131 MB | **267 a 390 MB (medida)** | **RTF 0,016 medido** | **CC-BY-NC-4.0 (não comercial)** | **rejeitado do catálogo**: licença não comercial. Usado só para MEDIR o runtime (seção 4) |
| Vosk pequeno pt-br (Kaldi) | regular (WER alto em fala espontânea) | ~50 MB | ~0,3 GB | rápido | Apache-2.0 | rejeitado: o binding Node do Vosk depende de `ffi-napi` (compilação nativa no computador do usuário) e a qualidade em PT fica atrás da dos outros |
| Silero (STT/VAD) | o STT em PT é distribuído para PyTorch; o VAD não transcreve | — | — | — | MIT | rejeitado como motor; VAD segue como ideia para trechos (seção 6) |

Observação sobre "ONNX do sherpa-onnx": todos os modelos acima do catálogo são as **exportações ONNX int8 do projeto sherpa-onnx** (`csukuangfj/*` no Hugging Face), os mesmos que o próprio
projeto documenta e testa com o `sherpa-onnx-node`. Os pesos originais são da NVIDIA (Parakeet), OpenAI (Whisper) e Useful Sensors (Moonshine).

## 3. Runtime: `sherpa-onnx-node` vs `whisper.cpp`

| | `sherpa-onnx-node` 1.13.8 | `whisper.cpp` (binário baixado) |
|---|---|---|
| Parakeet TDT v3 | **sim** (transducer NeMo) | não (só Whisper/ggml) |
| Distribuição | addon N-API **pré-compilado** em pacotes npm por plataforma (`sherpa-onnx-darwin-arm64`, `-darwin-x64`, `-win-x64`): sem `node-gyp`, sem Xcode, sem Visual Studio | binário por plataforma que o app teria de baixar (outra superfície de rede), verificar, marcar executável e rodar |
| Segurança | código nativo versionado no pacote assinado junto com o app (hardened runtime/notarização cobrem) | executar binário baixado: exige assinatura/checksum fixados e pasta não gravável por terceiros; mais risco e mais código |
| Tamanho adicional | 33 MB (darwin-arm64) / 37,7 MB (darwin-x64) / 23,5 MB (win-x64), **medido pelo npm**; no `.app` universal as duas arquiteturas viajam (~72 MB) | ~5–15 MB por plataforma, mas outra cadeia de download |
| API | `OfflineRecognizer` em JS | linha de comando (arquivo WAV em disco: áudio em disco, o que D-66 proíbe sem opt-in) |
| Aceleração | CPU (CoreML/GPU não usados) | Metal/CoreML opcionais |

**Decisão: `sherpa-onnx-node` 1.13.8 (versão exata) em PROCESSO PRÓPRIO.** Motivos adicionais, medidos:
1. **`readWave` não funciona no Electron** ("External buffers are not allowed": o V8 do Electron proíbe buffers externos). O worker nunca chama `readWave`: converte o PCM16 para `Float32Array` em JS e passa
   a `acceptWaveform`. Verificado sob `ELECTRON_RUN_AS_NODE` com o binário do Electron 37.10.3 (carga e transcrição idênticas às do Node).
2. **Descarregar de verdade**: o ONNX Runtime não devolve arenas de memória ao sistema; encerrar o processo é a única forma de a RAM do modelo voltar a **0**. Por isso o runtime é um processo (não um `worker_thread`) e
   "descarregar após ociosidade" = encerrar o processo. Bônus: uma falha nativa derruba só o processo de voz, nunca o app.
3. O addon e a lib do ONNX Runtime precisam estar em disco, fora do asar: `asarUnpack` (ver `electron-builder.yml`).
4. **Algumas configurações inválidas fazem a biblioteca nativa chamar `exit()`** (medido: configuração sem modelo imprime "Please provide a model" e o processo termina; arquivo ausente, por outro lado, vira exceção JS). Dentro do main isso fecharia o app inteiro; no processo próprio vira só `motor_falhou` (coberto por teste).

Configuração por família (chaves conferidas contra o addon real com arquivos inexistentes: o erro cita o arquivo, não a chave): `transducer`+`modelType:"nemo_transducer"` (Parakeet), `whisper` com
`language`/`task:"transcribe"` (Whisper), `moonshine` (Moonshine).

## 4. Medições (esta máquina: macOS arm64, Node 22 / Electron 37.10.3 como Node)

Modelo usado SÓ para medir o runtime: NeMo FastConformer PT Hybrid (131 MB, CC-BY-NC, **fora do catálogo**), com a amostra PT embutida e a `pt_br.wav` do próprio repositório do modelo.

| Medida | Valor | Orçamento |
|---|---|---|
| `require("sherpa-onnx-node")` | 7 ms | — |
| Carga do modelo no processo (spawn + `OfflineRecognizer`) pela pilha completa (P-540) | **1,6 s** (só a criação do reconhecedor: 0,6 s, igual no Node e no Electron-como-Node) | ≤ 4 s |
| Fator de tempo real (P-541) | **0,03** (mediana; pior 0,06), isto é, 5 s de fala em ~0,15 s | ≤ 0,25 |
| RAM de pico do processo (P-542) | **299 MB** | ≤ 2,2 GB |
| Transcrição da amostra PT "Olá, este é um teste de voz no terminal" | exata | — |
| Bloqueio do event loop do main no download+sha256 de 96 MB (P-544) | 3 ms | ≤ 50 ms |
| Overhead do app soltar a tecla → texto no PTY, fala de 10 s (P-545) | 0,6 ms (p95 2 ms no pior) | ≤ 150 ms |
| Eventos de progresso do download (P-547) | 3 por segundo | ≤ 4,5/s |
| Peso adicional do pacote por arquitetura (P-546) | 32,6 MB (arm64) | ≤ 40 MB |

**NÃO medido (declarado):** carga, RTF e RAM do **Parakeet TDT v3** e dos Whisper/Moonshine: baixar 670 MB (e os outros) no desenvolvimento é proibido pelo escopo. As linhas "RAM estimada" do catálogo são
estimativas (arquivo × ~2) e a UI diz "cerca de". Quando o dono baixar o Parakeet, `npm run perf` com `VOZ_LOCAL_MODELO_DIR` (para a pasta com `model.int8.onnx`+`vocab.txt` do modelo NeMo CTC)
repete P-540..P-542 com o modelo real escolhido; para medir o Parakeet em si basta adaptar a configuração do teste (transducer).

## 5. Origem e checksums (como foram confirmados)

- Revisões **fixadas por commit** (`/resolve/<sha de 40 hex>/`): o conteúdo de uma URL do catálogo nunca muda por baixo.
- SHA-256 dos arquivos grandes (LFS): campo `lfs.oid` da API oficial `https://huggingface.co/api/models/<repo>/tree/<rev>?recursive=true` (tamanho e hash conferidos programaticamente contra o
  `resources/voz/modelos.json`: 0 divergências em 4 modelos / 15 arquivos). Arquivos pequenos sem LFS (vocabulários `tokens.txt`): baixados (≤ 0,8 MB) e hasheados localmente.
- O modelo NeMo PT usado para medir teve o `oid` conferido (`cc4135ab…`) depois do download (131 279 704 bytes).
- Entrada sem checksum confirmado = valor `a_verificar` no catálogo: o app **recusa baixar** (`sem_checksum`) e a UI mostra o motivo. Hoje nenhuma entrada está nesse estado.
- Hosts: origem `huggingface.co`; os arquivos LFS redirecionam para a CDN `*.hf.co` (verificado: `us.aws.cdn.hf.co`), por isso o cliente de rede ganhou `redirecionar_para` (D-542).

## 6. O que ficou de fora

- **Resultados parciais ao vivo (streaming incremental)**: os modelos offline do catálogo (TDT, Whisper, Moonshine) decodificam o trecho inteiro; não há modelo de streaming em PT no catálogo do sherpa-onnx.
  O ditado transcreve **por trecho ao soltar a tecla** (RTF 0,03 no modelo medido). Ideia futura: VAD (Silero) para transcrever por pausas durante a fala.
- Aceleração por GPU/CoreML; modelos maiores (Whisper large); troca automática de idioma (o idioma segue a configuração: `pt` ou `en`).
- Windows: validado só por teste de configuração e unidade (D-26); o pacote `sherpa-onnx-win-x64` está declarado, mas o addon não foi carregado numa máquina Windows.
- Empacotamento universal real (`dist:mac`) e verificação `test:pacote` com a voz: o coordenador regenera o pacote depois; a configuração e os testes de configuração estão prontos.
