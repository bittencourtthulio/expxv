# Orçamentos de leveza e velocidade

Requisito de primeira classe. Cada linha tem **medição automatizada** (`npm run perf`, Playwright
sobre o Electron real) e falha quando estoura. Referência: Mac Apple Silicon. Em CI lento, o fator
`EXPXV_PERF_FATOR` (padrão 1) multiplica os limites; nunca se remove um orçamento para passar.

## Orçamentos

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-01 | Processo iniciado → janela visível e casca interativa | ≤ 800 ms | `performance.now()` no renderer + marca no main |
| P-02 | Troca de aba/tela (menu lateral) | p95 ≤ 50 ms até o primeiro quadro pintado | `PerformanceObserver` + `requestAnimationFrame` |
| P-03 | Abrir terminal (clique → xterm visível com cursor) | ≤ 300 ms, sem contar a CLI | marca no clique e no primeiro `write` |
| P-04 | Flood de saída (10 MB de texto em um PTY) | nenhum quadro > 50 ms; a UI continua respondendo a teclas | `longtask` + latência de eco |
| P-05 | Latência de digitação (tecla → eco visível) | p95 ≤ 40 ms | CLI falsa de eco |
| P-06 | Memória do renderer com 4 painéis ociosos | ≤ 250 MB | `process.getProcessMemoryInfo` |
| P-07 | Memória do main + daemon com 4 painéis ociosos | ≤ 200 MB (sem contar as CLIs) | idem |
| P-08 | JavaScript inicial do renderer | ≤ 350 KB gzip; xterm, grafo, editor e telas pesadas em chunks lazy | script de tamanho no build |
| P-09 | Lista grande (1 000 cartões / 5 000 linhas) | rolagem a 60 fps; só nós visíveis no DOM | contagem de nós + quadros |
| P-10 | Indexação do projeto (200 artefatos `docs/`) | ≤ 300 ms, fora da thread principal | worker + marca |
| P-11 | Mudança em arquivo observado → UI atualizada | ≤ 600 ms (debounce 300 ms incluso) | toque no arquivo + espera |
| P-12 | Bloqueio do event loop do main | nenhuma tarefa > 50 ms após o boot | monitor de event loop |
| P-13 | Restaurar 8 painéis ao abrir o app | ≤ 1,5 s até todos visíveis | e2e com daemon |
| P-14 | Consulta ao banco (caminho quente) | ≤ 5 ms por consulta | teste de unidade com banco real |

## Regras de arquitetura que sustentam os números

1. **Boot em duas ondas.** Onda 1: janela + casca + tela inicial (nada de disco além do mínimo).
   Onda 2 (`setImmediate`/ocioso): banco, daemon, detecção de CLIs, watchers, indexação. Cada
   serviço com erro isolado (padrão `logica/boot.ts` do ExpxMedia).
2. **Nada síncrono no main depois do boot**: `fs` assíncrono, `git` e detecção em processos
   filhos com timeout, varreduras em `worker_threads`.
3. **IPC em lotes**: saída de PTY agrupada por quadro (≈ 8–16 ms) e em pedaços de 64 KB;
   backpressure (pausa acima de 256 KB pendentes, retoma abaixo de 128 KB; confirmação só depois
   que o xterm processou). Eventos de domínio coalescidos.
4. **Renderer enxuto**: telas em `React.lazy`; `React.memo` com callbacks estáveis; stores
   mínimos; nada de re-render global por evento; listas virtualizadas acima de 100 itens.
5. **Terminais**: armazém de saída **fora do React**; painéis fora de vista desmontados;
   WebGL limitado (D-11); scrollback configurável com teto (padrão 5 000 linhas).
6. **CSS**: sem `backdrop-filter` em barras fixas; transições só de `transform`/`opacity`;
   `prefers-reduced-motion` respeitado; fontes locais com `font-display: swap`; sem fonte remota.
7. **Sem dependência pesada** sem medir: cada nova dependência registra tamanho e custo de
   startup em `01-DECISOES.md`.
8. **Pré-carregamento**: o chunk do terminal é carregado em ocioso logo depois da primeira pintura.
9. **Observadores com debounce** (300 ms) e `awaitWriteFinish`; releitura só do que mudou quando
   o modelo permite, total quando as regras cruzam arquivos (em worker).

## Medidor de CPU e memória da máquina (D-530 a D-535)

Medidos por `tests/perf/sistema.perf.ts` (Node puro, `process.cpuUsage()` user + system, que já inclui o spawn do `vm_stat` no macOS), gravados em `docs/ade/perf/ultimo.json` pelo `registrar` do runner existente (`npm run perf` roda o arquivo junto com os demais).

| ID | Orçamento | Limite | Como se mede |
|---|---|---|---|
| P-431 | Custo médio por amostra do medidor no main (CPU do sistema + memória; no macOS a memória é lida a cada 2ª amostra) | ≤ 1 ms | 40 amostras consecutivas do serviço de produção, delta de `process.cpuUsage()` |
| P-432 | CPU do próprio medidor com 1 amostra a cada 2 s | ≤ 0,3% de um núcleo | custo por amostra ÷ 2000 ms |
| P-433 | Medidor oculto pela preferência (sem assinante), 60 s simulados | 0 timers e 0 leituras | contagem em teste |

Regras: sem assinante ou com a janela oculta/minimizada/desfocada há mais de 10 s = **zero timers**; o popover só pede a lista de processos enquanto está aberto (no máximo a cada 2 s). Referência desta máquina (macOS, 11 núcleos): P-431 ≈ 0,29 ms; P-432 ≈ 0,01%.

## Passeio dos bichinhos (D-650 a D-654)

| ID | Orçamento | Limite | Como se mede |
|---|---|---|---|
| P-650 | CPU ociosa com todos os bichinhos no posto | exatamente 1 timer (o detector de ociosidade), 0 rAF, 0 `setInterval`, camada desmontada (0 nós) | `src/renderer/bichinho/passeio/controle.test.tsx` (jsdom, `vi.getTimerCount()`, espiões de `requestAnimationFrame`) |
| P-651 | Passeio com 8 bichinhos soltos (5 min simulados) | ≤ 12 publicações (renders do overlay) por passeante por minuto; ≤ 1 timer por passeante + 1 do detector + 1 de reavaliação; 0 rAF; 0 `setInterval` | idem (contagem de `assinar` do controlador) |
| P-652 | Restaurar elementos movidos pelas travessuras após a primeira atividade | ≤ 150 ms, 0 animações e 0 listeners residuais, retângulos idênticos aos originais | `travessuras.test.ts` (dublê de WAAPI) e captura em Chromium real (`getBoundingClientRect` de todos os elementos antes/depois) |

Referência (Chromium headless, 1280×800, 3 cartões + slot): durante o passeio o movimento é só `transform`/`translate`/`rotate` (compositor, sem layout por quadro); a medição de GPU/CPU do app real não é feita sem GPU (somente contagem de timers, rAF e publicações).

## Terminais por workspace (D-570 a D-573)

| ID | Orçamento | Limite | Como se mede |
|---|---|---|---|
| P-570 | Troca de workspace na tela Terminais com 6 terminais no workspace de destino (desmonta os 6 de saída, remonta os 6 com replay do armazém) | ≤ 100 ms | `src/renderer/telas/terminais/troca-workspace.test.tsx` (jsdom, terminal falso que assina o armazém real; 6 trocas alternadas, vale o pior tempo) e `tests/terminais-por-workspace.e2e.test.ts` (app real, registra no log) |
| P-571 | Saída de terminal de workspace oculto | 0 re-renders da tela atual; acumula no armazém com o limite de 2 MiB | `armazem.test.ts` + `terminais.test.ts` (saída não notifica ouvintes) |

Referência desta máquina (jsdom, terminal falso): troca A→B com 6 painéis, mediana ≈ 8 ms, pior ≈ 10 ms. O custo real do xterm ao remontar (criar o terminal e reproduzir o buffer) vem do xterm e é medido no e2e.

## Como o teste de performance entra no dia a dia

- `npm run verificar` roda os orçamentos **estáticos** (P-08, contagem de dependências).
- `npm run perf` roda os dinâmicos (precisa do Electron; ~1–2 min) e grava
  `docs/ade/perf/ultimo.json`. O portão de cada fase com UI exige esse arquivo verde.
- Estourou um orçamento: a task **não fecha**. Corrige-se a causa (não o limite).


## Voz local embutida (D-546; `tests/perf/voz-local.perf.ts`)

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-540 | Carga do modelo de voz (processo + modelo) ao iniciar o ditado | ≤ 4 s | runtime e worker REAIS com um modelo (`VOZ_LOCAL_MODELO_DIR`); sem modelo = «não medido» |
| P-541 | Fator de tempo real da transcrição (decodificação ÷ duração do áudio) | ≤ 0,25 | idem, mediana de 5 |
| P-542 | RAM de pico do processo de reconhecimento com o modelo carregado | ≤ 2,2 GB | idem (RSS do processo) |
| P-543 | CPU ociosa com o modelo descarregado | 0 processos e 0 temporizadores | runtime com processo falso: antes do primeiro uso e depois da ociosidade |
| P-544 | Maior bloqueio do event loop do main durante download + sha256 | ≤ 50 ms | 96 MB em loopback, `setInterval` de 5 ms |
| P-545 | Soltar a tecla → texto no PTY com o motor local (runtime instantâneo, fala de 10 s) | p95 ≤ 150 ms | serviço de voz de produção |
| P-546 | Peso adicional do pacote por arquitetura (`sherpa-onnx-node` + pacote nativo) | ≤ 40 MB (catálogo + amostras ≤ 300 KB; nenhum modelo) | tamanho dos diretórios instalados |
| P-547 | Eventos de progresso do download | ≤ 4 por segundo (coalescido em 250 ms) | contagem no mesmo download de P-544 |

Referência desta máquina (macOS arm64) com o modelo NeMo PT de 131 MB usado SÓ para medir o runtime (fora do catálogo por licença): P-540 ≈ 1,6 s, P-541 ≈ 0,03, P-542 ≈ 299 MB, P-543 = 0, P-544 ≈ 3 ms, P-545 ≈ 0,6 ms, P-546 ≈ 32,6 MB, P-547 ≈ 3/s.
**Parakeet TDT v3 (670 MB) NÃO foi medido** (o escopo proíbe baixá-lo no desenvolvimento): a RAM de ~1,5 GB do catálogo é estimativa; meça com o modelo real depois do primeiro download.

## 100 espécies e ovo do bichinho (D-670 a D-674)

| ID | Orçamento | Limite | Como se mede |
|---|---|---|---|
| P-670 | Chunks lazy do bichinho (todos os que carregam código dele: slot, passeio, sprites, catálogo) + CSS | ≤ 25 KB gz (meta do dono). **MEDIDO: 30,1 KB gz (passeio 23,3 + slot 2,9 + CSS 3,9), acima do alvo** | vite build em pasta temporária, soma dos chunks gz; o sistema de partes sozinho (receitas, arquétipos, partes) = 10 KB gz e é limitado a 11 KB gz (CSS das paletas a 5,5 KB) em `sprites/orcamento.test.ts` |
| P-671 | CPU ociosa com ovo, 100 espécies ou seletor fechado | inalterada: nenhum timer, nenhuma animação infinita nova; o seletor só existe aberto (lazy) | revisão do CSS (`bichinho.test.tsx`) e `seletor.test.tsx` |
| P-672 | Atribuir a espécie de 100 workspaces seguidos | ≤ 150 ms no total (referência: ~24 ms) | `src/nucleo/bichinho/atribuicao.test.ts` |
| P-673 | Recálculo do ovo | coalescido em 5 s por evento (`task.updated`, `mission.closed`, `cost.updated`); 0 polling; só COUNT de ids no banco | `servico-especies.test.ts`, `main/bichinho.test.ts` |

Pendência P-670: para chegar a 25 KB falta cortar ~5 KB gz; o maior bloco é o texto de `catalogo.ts` (`representa` e `personalidade`, ~5,4 KB gz), que pode virar chunk carregado só ao abrir o popover/seletor.

## Decisor local laya (D-695 a D-708; `tests/perf/laya-local.perf.ts`; pesquisa em `base/L-laya-local.md`)

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-700 | Chunks lazy do renderer da fase (tudo que carrega código do decisor: seção de config, selos, sinais) + CSS | ≤ 25 KB gz; **nada** carregado sem abrir a seção/ativação (D-708) | vite build em pasta temporária, soma dos chunks gz |
| P-701 | Peso adicional do pacote por arquitetura (addon `onnxruntime-node` + dependência; **nenhum peso**) | teto provisório ≤ 120 MB por arquitetura (definido no portão T-25.02; estourar = voltar ao dono) | tamanho dos diretórios instalados, no portão |
| P-702 | Carga do modelo no processo (spawn + grafo) | ≤ 6 s (provisório até a medição do dono) | runtime real com `LAYA_MODELO_DIR`; sem modelo = «não medido» |
| P-703 | Latência p95 de decisão (fila vazia, `choice`/`score`/`noul`) | ≤ 150 ms em CPU (provisório; os 33 ms do repo são GPU) | idem, mediana de 20 |
| P-704 | RAM do processo com modelo carregado | ≤ 1,2 GB (provisório; estimativa arquivo × ~2–3) | idem (RSS do processo) |
| P-705 | Maior bloqueio do event loop do main durante download + sha256 | ≤ 50 ms | download falso de 96 MB em loopback, `setInterval` de 5 ms |
| P-706 | Eventos de progresso do download | ≤ 4 por segundo (coalescido em 250 ms) | contagem no mesmo download de P-705 |
| P-707 | App com a fase entregue e o laya DESLIGADO | 0 processos, 0 timers, 0 sockets; módulos `laya/` não importados | runtime com stub: antes do primeiro uso e depois da ociosidade |
| P-708 | Acréscimo de latência dos consumidores no caminho de fallback (sem laya/abstém/morto) | ≤ 5 ms sobre o custo de hoje | teste de não-regressão triplo por consumidor |
| P-709 | Taxa de decisões | ≤ taxa máxima configurável/min (padrão 60), coalescência por chave, descarte contado; processo em prioridade baixa | fila com stub; excedente descartado nunca enfileira |

**Nada do laya foi medido ainda** (regra: agente nunca baixa pesos; `base/L-laya-local.md` §4). P-702/P-703/P-704 têm tetos provisórios: a medição real é do dono, pelo modo de verificação (`LAYA_MODELO_DIR`, como `VOZ_LOCAL_MODELO_DIR` da voz), e os números medidos aparecem no "Testar" da UI (D-704).
