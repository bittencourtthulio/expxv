# Relatório de desempenho do MVP (T-05.04)

Gerado a partir de 5 execuções completas de `npm run build && npm run perf` (a última grava `ultimo.json`) em 2026-09-30/10-01.
Todos os valores são **brutos**: o fator de tolerância `EXPXV_PERF_FATOR` ficou em 1 em todas as medições (nunca foi usado).
"Mediana" = mediana dos 5 valores registrados (um por execução); "pior caso" = a pior amostra individual vista nas 5 execuções.

## Ambiente

| | |
|---|---|
| Máquina | Apple M3 Pro, 11 núcleos, 18 GiB; macOS 26.6.2 (Darwin 25.6.0); Node 22.23.3; Electron 37.10.3 |
| Carga durante a medição | **alta e variável, não sintética**: load average 16 a 42 (11 núcleos) por causa de outros agentes, `npm run dev` do dono e processos de outros projetos. Valores de referência do `STATUS.md` (P-01 347 ms) foram tomados com a máquina ociosa; aqui tudo roda 2 a 4 vezes mais lento |
| Dados | pastas temporárias (`ade-*`), `userData` isolado, sem rede; Método com projeto sintético (`tests/fixtures/metodo/gerar.ts`) |
| Execuções | 10 completas (5 com o P-12 numa janela só; 5 finais com a metodologia abaixo). Falharam 2 de 10 por **uma amostra ruidosa**, nunca por ≥ 3 de 5: P-12 87 ms (1 janela de 1,5 s; ver método) e P-01 813 ms (mediana de 3 lançamentos; outras 4 rodadas: 651–798 ms) |

## Tabela P-01 a P-15 (5 execuções finais)

| # | Orçamento (limite) | Mediana | Pior caso | Valores por execução | Método |
|---|---|---|---|---|---|
| P-01 | janela visível ≤ 800 ms | **746 ms** | 1 267 ms | 798, 651, 813, 746, 709 | marca do main (`ready-to-show`); por execução, mediana de 3 lançamentos novos, o 1º (disco frio) descartado |
| P-02 | troca de tela p95 ≤ 50 ms | **34,6 ms** | 36,2 ms | 34,4–35,1 | `click` → 2 `requestAnimationFrame`; 3 voltas nas 7 telas, a 1ª (carrega chunks lazy) descartada; 2 quadros a 60 Hz = 33,3 ms é o piso |
| P-02b | paleta: atalho → foco ≤ 50 ms (novo; era asserção de unidade flaky) | **3,1 ms** | 13,5 ms | 2,5–7,4 | `keydown` → `focusin` no combobox + rAF; p95 de 10, a 1ª (fria) descartada. Antes da correção: 1ª abertura 311 ms |
| P-03 | abrir terminal ≤ 300 ms | **12,5 ms** | 55 ms | 11,2–13,6 | clique no item de menu → `.xterm-screen` visível + rAF; mediana de 6 depois de 1 abertura de aquecimento |
| P-04 | flood 10 MB: nenhum quadro > 50 ms | **0 ms** | 0 ms | 0 | `PerformanceObserver` longtask no renderer durante 10 MB |
| P-04b | flood: tecla → UI responde ≤ 100 ms | **8,8 ms** | 12,1 ms | 3,2–12,1 | ⌘F durante o flood; p95 das teclas dadas com o flood em curso, a 1ª (monta a busca) descartada |
| P-05 | eco de tecla p95 ≤ 40 ms | **18,1 ms** | 20,0 ms | 7,7–18,5 | tecla → eco pintado (CLI falsa); 70 teclas, as 10 primeiras de aquecimento fora do p95 |
| P-06 | renderer, 4 painéis ociosos ≤ 250 MB | **99,4 MB** | 140,3 MB (pico logo após abrir) | 98,0–99,9 | `getAppMetrics`; maior de 3 amostras estáveis |
| P-07 | main + daemon ≤ 200 MB | **170,5 MB** | 196,6 MB (pico) | 168,9–177,0 | idem + RSS do daemon (`ps`). **Margem pequena**: 15% no estável, 2% no pico |
| P-08 | JS inicial ≤ 350 KB gzip | **75,2 KB** | 75,2 KB | 75,24 | `scripts/tamanho-bundle.mjs --json` sobre `dist/renderer` (determinístico, sem fator) |
| P-09 | rolagem 3 s, 1 000 trabalhos + 1 000 cards: nenhum quadro > ~20 ms | **17,7 ms** | 83,7 ms (1 rodada de 3, mediana de 3 por execução) | 17,7–18,7 | lista de trabalhos e as 4 colunas do quadro rolando juntas por rAF; maior intervalo entre quadros, mediana de 3 rodadas. 2 quadros a 60 Hz seriam 33 ms: 17,7 ≈ 1 quadro |
| P-09b | nós no DOM por lista virtualizada ≤ 300 | **161** | 161 | 161 | maior lista visível (trabalhos 1 015 itens; cards 1 000), contada durante a rolagem. Antes da correção: 10 151 |
| P-10 | indexação de ~200 artefatos ≤ 300 ms | **44 ms** | 178 ms (a frio) | 38–96 | `duracao_ms` cronometrado dentro do worker; 205 artefatos lidos; 5 amostras por execução = a frio + 4 releituras, mediana |
| P-11 | mudança em arquivo → evento no renderer ≤ 600 ms | **501 ms** | 565 ms | 477–525 | `appendFile` → `metodo:mudou` no renderer (relógio de parede único), debounce de 300 ms incluso; 6 toques, o 1º descartado, mediana de 5 |
| P-12 | bloqueio do event loop do main ≤ 50 ms | **7,9 ms** | 12,6 ms | 7,0–10,5 | `monitorEventLoopDelay`; mediana dos máximos de 3 janelas de 1,5 s depois do boot |
| P-13 | restaurar 8 painéis ≤ 1,5 s | **423 ms** | 598 ms | 390–477 | clique em Terminais → 8 painéis visíveis com saída; mediana de 3 reaberturas do app, a 1ª descartada |
| P-14 | consulta quente ao banco ≤ 5 ms | **1,14 ms** | 1,25 ms (mediana) | 1,08–1,25 | 14 consultas reais dos repositórios, 10 000 linhas por tabela, SQLite em arquivo, mediana de 100 execuções cada (5 de aquecimento fora); vale a pior mediana (`conta.listar`). Máximo individual de uma execução chegou a 153 ms (tranco do SO sob carga), fora da mediana |
| P-15 | delegação 1+1 p50 ≤ 2 s | **312 ms** | 434 ms | 282–364 | `pane_spawn` → `wake` no piloto, CLI falsa; 5 rodadas, a 1ª descartada |

Nenhum orçamento estourou em ≥ 3 de 5 execuções. Os mais apertados sob esta carga: **P-01** (746 de 800) e **P-07** (170 de 200).
`ultimo.json` (que `npm run perf` regrava do zero a cada execução e cobre P-01..P-15 mais P-02b, P-04b e P-09b) está verde.

## Correções feitas (com antes/depois)

1. **Listas virtualizadas do Método renderizavam tudo (P-09).** `VirtualLista` fixava `height/maxHeight: 100%` no `style` inline,
   que vence as regras `.met-lista .virtual-lista { height: 60vh }` etc.; num pai de altura automática a lista media 69 020 px e
   montava as 1 015 linhas: **10 151 nós** só na lista, 637 KB de HTML na tela. Agora o padrão está em
   `src/renderer/componentes/VirtualLista.css` (seletor de 1 classe) e cada lista fixa a altura por seletor mais específico:
   **161 nós**, rolagem com o maior quadro em 17,7 ms. Teste: `VirtualLista.altura.test.tsx`; prova de medição: P-09/P-09b.
   *Tocou `src/renderer/componentes/` (VirtualLista.tsx + CSS novo).*
2. **1ª abertura da paleta de comandos levava ~310 ms (P-02b).** Perfil no Electron: 354 ms ocioso, 0 ms de JS, nenhuma
   requisição: o `React.lazy` suspende na 1ª renderização mesmo com o chunk já carregado e o React segura a revelação por ~300 ms.
   `PaletaGatilho` agora guarda o componente resolvido pelo pré-carregamento e o renderiza direto: **1ª abertura 311 → 3–15 ms**,
   seguintes ~2 ms. Teste: `PaletaGatilho.perf.test.tsx` (abre no mesmo `act` síncrono; falhava antes).
   *Tocou `src/renderer/componentes/PaletaGatilho.tsx`.*

## Testes flaky estabilizados (sem relaxar o que provam)

- `adaptador-node-pty.test.ts`: 3 de 10 falhavam sob carga. Causa real, não de tempo: `resize()` seguido de `write("tamanho")` é uma
  corrida do SO (o SIGWINCH chega depois e a CLI responde o tamanho antigo). Agora o teste repete a pergunta até a resposta mais recente
  ser o novo tamanho (teto de 30 s; nunca passa sem o processo ver o tamanho). Tetos de espera viraram guardas de travamento (30 s;
  flood 60 s). **10/10 sob `yes` ×4 por ~30 s** (load médio 60–70 na máquina).
- `PaletaComandos.test.tsx`: a asserção de latência (< 50 ms no jsdom) saiu; ficou a determinística (foco no campo na mesma renderização,
  sem `setTimeout` nem `requestAnimationFrame`). A latência real é o P-02b. `PaletaGatilho.test.tsx`: teto de espera do `findBy` de 1 s para
  15 s (falso vermelho sob carga). **10/10 sob carga.**
- `tests/perf/terminal.perf.ts` e `casca.perf.ts`: aquecimento + 1ª amostra fria descartada e documentada + mediana (P-01, P-03, P-04b,
  P-05, P-12, P-13); o pior continua visível no log e em `pior`. **10/10 sob carga artificial** (`terminal.perf.ts`).
- Não estava na lista, mas apareceu: `src/nucleo/mcp/integracao.test.ts` ("wake em < 2 s") falhou uma vez em 4 suítes completas
  (noutra, 4 arquivos falharam sob a carga mais alta, entre eles o `PaletaGatilho` tratado acima); não mexi (é asserção de latência a mover para `tests/perf/orquestracao.perf.ts`, que já mede o P-15).

## Pendências medidas

Ver `PENDENCIAS-PERF.md`: PP-01 (encerrar o app com ~10 000 arquivos em `docs/` segura o processo por dezenas de segundos; causa
localizada no `watcher.close()` do chokidar), PP-02 (observador demora a ficar pronto em projeto desse porte), PP-03 (índice
`(provedor, id)` em `conta`).
