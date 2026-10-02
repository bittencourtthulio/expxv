# Fase 23 — Overdrive experimental: canvas único para 32–64 painéis (só habilita se o benchmark provar ganho)

Pedido do dono (via `DECISOES-DAS-PENDENCIAS.md`, P-05): *"**Overdrive** (canvas único) como **modo experimental opcional**, desligado por padrão, só habilita após benchmark provar ganho em 32/64 painéis; rollback para o modo atual"*.
**Prioridade baixa** (última da fila de fases). A fase é **orientada por medição**: primeiro se mede o renderer atual, depois se prova (ou não) que vale construir, e só então se constrói. **O resultado "não vale a pena" é um sucesso da fase**, desde que
registrado com os números.

## Objetivo e valor

1. **Saber, com número, se o ExpxV aguenta 32–64 terminais** (squads grandes, Missões com muitos workers) sem estourar memória, CPU/GPU e latência — hoje (D-11) cada painel visível tem um xterm próprio, com WebGL só no painel em foco e nos primeiros 6.
2. **Se o benchmark provar ganho real**, oferecer um **modo Overdrive** (um único `<canvas>` desenhando todos os painéis a partir dos buffers que já existem fora do React) que **reduz memória e custo de quadro** em muitos painéis, **sem piorar** o que importa no uso normal
   (4–8 painéis: abrir, digitar, rolar, selecionar, acessibilidade).
3. **Reverter em um clique**, sem perda de sessão, e **sem custo nenhum** para quem não liga (zero bytes carregados, zero código no caminho do modo atual).
4. **Não mexer na segurança do terminal** (AGENTS.md, regra 10): OSC 52/8 removidos no main, links só `http/https` sem credenciais, colar grande com confirmação, anexos que recusam arquivo de ambiente — tudo igual no Overdrive.

## Portão da fase

1. **Dois portões de decisão (go/no-go), ambos por número, ambos registrados:**
   - **G-A (necessidade):** o baseline do renderer atual em 32 e 64 painéis (T-23.03) **já cumpre** os alvos absolutos P-170..P-174 ⇒ **no-go por desnecessidade**: a fase **termina ali** (D-361), sem construir renderer.
   - **G-B (ganho):** o *spike* (T-23.05/T-23.06) bate os critérios go de "Protocolo de medição" contra o baseline, em 3 execuções consistentes ⇒ **go** para as tasks de produto (23C); senão **no-go por falta de ganho** e o código do *spike* é removido (T-23.20).
2. Sem **G-B = go**, **nenhuma task 23C começa** e **nenhuma flag, chave de preferência ou tela do modo Overdrive existe no produto**.
3. `npm run verificar` verde; `npm run perf` verde: **P-170..P-179** com o resultado registrado (go **ou** no-go) em `docs/ade/perf/overdrive-resultado.json`; P-01..P-14 sem piorar com o modo **desligado** (padrão) **e** com o modo ligado nos orçamentos de piso.
4. Se **go**: fidelidade visual (corpus de telas), acessibilidade mínima, seleção/cópia/links/colar idênticos, *soak* de 30 min sem vazamento, perda de contexto GPU com *fallback* automático, **reversão ensaiada** (desligar = comportamento byte a byte do modo atual) e e2e no Electron real verdes.
5. Se **no-go**: harness de carga, baseline e resultados **permanecem** (valem para regressão futura de 32+ painéis); `src/renderer/overdrive/` removido; D-361/D-362 registradas; `tests/scripts/overdrive-removivel.test.ts` prova que removê-lo não quebra a compilação.
6. Registro em `STATUS.md` do que só a pessoa valida (GPU/monitores reais, leitor de tela real, Windows, uso diário com 32 painéis).

## Princípios

1. **Leveza e velocidade (prioridade nº 1) valem inclusive aqui.** Desligado: **0 KB** no JS inicial, **0** código executado, **0** GPU extra. O chunk do Overdrive só é buscado quando a pessoa o liga e só há painéis suficientes para ele importar.
2. **Medir antes de construir.** Nenhuma linha de renderer de produto antes do baseline (T-23.03) e do *spike* comparado (T-23.07). "Parece que será mais rápido" não é critério.
3. **Critérios go/no-go escritos e versionados antes da primeira medição** (`docs/ade/perf/overdrive-criterios.json`, T-23.01). Mudar o critério depois de ver o número exige D-NN com justificativa — nunca para "passar".
4. **Os pisos não negociam.** P-03, P-04, P-05, P-06 (4 painéis), P-08 e P-13 do modo atual **não podem piorar**; o Overdrive só pode **ganhar** acima de certo número de painéis e **nunca** custar no uso comum. Se o ganho é só em 64 painéis e custa em 8, o modo só liga **automaticamente por sugestão** (a pessoa aceita) acima do limiar medido.
5. **O PTY e o buffer não mudam.** O daemon de PTY (D-12), o armazém de saída fora do React e o `@xterm/headless` continuam a **fonte da verdade**; o Overdrive é **só uma visão** (renderer alternativo). Trocar de modo nunca perde saída, scrollback, estado de cursor ou sessão.
6. **Segurança do terminal intocada.** Nenhuma regra do AGENTS.md (regra 10) é movida para o renderer novo: o que o main já removeu (OSC 52/8) continua removido; links, colar e anexos usam as **mesmas funções**. Nenhum canal IPC novo no produto (o modo é uma preferência pelo canal de preferências existente).
7. **Experimental, honesto e reversível.** Selo "Experimental" visível quando ligado, aviso do que muda, **atalho/botão de desligar sempre acessível**, *fallback* automático em erro de render/perda de contexto, e desligar volta ao modo atual **sem reiniciar o app** quando possível (no máximo, reinício do renderer).
8. **Acessibilidade não é opcional.** Um `<canvas>` não é lido por leitor de tela: o Overdrive mantém **espelho DOM do painel em foco** (região viva + texto selecionável) e **não** é oferecido se esse espelho falhar na suíte de a11y.
9. **Uma só GPU/contexto.** O ganho esperado vem de **um contexto**, **um atlas de glifos compartilhado** e **danos por linha** (só repinta o que mudou); qualquer variante que reintroduza N contextos é descartada.
10. **Nada sai da máquina; sem dependência nova sem custo medido (D-NN).** Sem biblioteca de renderização de terceiros no caminho do produto; o que já existe (`@xterm/headless`, fontes locais) é reaproveitado. Dependência de *benchmark* só em `devDependencies`.
11. **UI compacta (D-32)**, estados por forma e texto; **sem migration** (preferência em `preferencias.json`, D-29).

## Estado atual (lido em 2026-10-01 — ponto de partida, não resultado)

| Item | Hoje |
|---|---|
| Renderer de terminal | **um xterm por painel visível** (D-11): WebGL só no painel em foco e nos primeiros 6; os demais usam o renderer DOM/canvas do xterm; painéis fora de vista **desmontados**; scrollback padrão 5 000 linhas |
| Armazém de saída | **fora do React** (regra 5 do `03-ORCAMENTOS`), com `@xterm/headless` (dependência de produção) no main/worker; saída em lotes de ≈ 8–16 ms, *backpressure* acima de 256 KB pendentes |
| Orçamentos existentes | P-03 abrir terminal ≤ 300 ms; P-04 *flood* de 10 MB sem quadro > 50 ms; **P-05 digitação p95 ≤ 40 ms**; P-06 renderer ≤ 250 MB com 4 painéis; P-07 main+daemon ≤ 200 MB com 4; P-13 restaurar 8 painéis ≤ 1,5 s; `tests/perf/terminal.perf.ts` mede P-03..P-07 e P-13 |
| Limites de Chromium relevantes | número máximo de contextos WebGL por página (≈ 16; o mais antigo é perdido) — razão do D-11; memória de GPU por canvas; `OffscreenCanvas` em *worker* disponível |
| Layout | árvore de layout dos painéis (Fase 1), foco por painel, arrastar/redimensionar |
| Medição de 32/64 painéis | **nunca feita**: não há baseline publicado |

## Decisões que esta fase toma e o que ela ajusta (resumo; texto completo em `01-DECISOES.md`, D-360..D-364)

- **D-360:** a fase é **orientada por medição** com dois portões (G-A necessidade, G-B ganho); critérios escritos **antes** da primeira medição; nenhum código de produto antes de G-B = go.
- **D-361:** G-A: se o renderer atual **já cumpre** os alvos em 32/64 painéis, o Overdrive **não é construído** (no-go por desnecessidade) e a fase fecha com o baseline como entregável.
- **D-362:** G-B: critérios go/no-go e **plano de reversão** (flag única, *fallback* automático, remoção do código) — números em "Protocolo de medição".
- **D-363:** o Overdrive é **só uma visão**: PTY, daemon, armazém e `@xterm/headless` inalterados; **nenhum canal IPC novo** no produto; segurança do terminal (regra 10) reaproveitada, não reescrita.
- **D-364:** sem dependência nova de produção para renderizar; qualquer dependência de benchmark só em `devDependencies` com custo registrado.
- **Respeita D-11 (revisado apenas se G-B = go), D-23, D-25, D-140 (opção mais completa construída **e** desligada), D-32.**
- **Numeração:** D-360..D-364, P-170..P-179 (orçamentos), P-350..P-354 (pendências), sem colisão (conferido por `grep`).

## Protocolo de medição (T-23.01 o formaliza; valores aqui são o ponto de partida e podem ser **endurecidos**, nunca afrouxados depois de medir)

**Máquina e ambiente.** Mac Apple Silicon de referência, tela e escala (DPR) registradas, energia na tomada, *Low Power* desligado, Spotlight/Time Machine ociosos, mesma versão de Electron/Chromium; `EXPXV_PERF_FATOR=1`; 1 monitor. Cada cenário: **5 execuções** (descarta a 1ª de aquecimento), mediana e dispersão (CV); **go só com CV ≤ 10 %** em cada métrica; senão repete até 3 rodadas e, se persistir, a métrica é "inconclusiva" (conta como **não** atendida).

**Carga sintética (T-23.02).** N ∈ {4, 8, 16, 32, 64} painéis com CLI falsa determinística; cenários:
- **C1 ocioso**: N painéis restaurados, sem saída (memória base);
- **C2 moderado**: cada painel emite ≈ 10 linhas/s com cores 256/truecolor e Unicode largo (CJK/emoji);
- **C3 flood parcial**: 8 de 32 (e 16 de 64) painéis recebem 10 MB cada em rajada, os demais moderados;
- **C4 digitação sob carga**: eco de tecla no painel focado durante C2;
- **C5 interação**: rolagem, seleção e redimensionar do layout com C2 ativo;
- **C6 troca de modo**: alternar atual ↔ Overdrive a quente;
- **C7 soak**: 30 min de C2 com 64 painéis.

**Métricas por cenário.** memória do renderer, GPU e total (`process.getProcessMemoryInfo`, `app.getAppMetrics()` por processo), CPU (`app.getAppMetrics().cpu`), tempo de quadro (rAF + `PerformanceObserver` `longtask`/`long-animation-frame`), FPS, latência de digitação (P-05), tempo de restaurar/abrir, contagem de contextos WebGL, tarefas do main > 50 ms (P-12), bytes de saída perdidos (deve ser **0**).

### Critérios (arquivo `docs/ade/perf/overdrive-criterios.json`, validado por teste)

**G-A (necessidade) — o Overdrive só é considerado se o baseline atual FALHAR em pelo menos 2 destes alvos absolutos em 32 painéis (C2):** memória do renderer ≤ 600 MB (**P-170**); *flood* parcial C3 sem quadro > 50 ms e FPS ≥ 50 (**P-171**); digitação p95 ≤ 40 ms sob C4 (**P-172**); CPU total ≤ 150 % de um núcleo em C2 (**P-173**); restaurar 32 painéis ≤ 3 s (**P-174**). Se falhar menos de 2, **no-go por desnecessidade**.
**G-B (ganho) — GO somente se TODAS valerem, em 32 e em 64 painéis, contra o baseline, com CV ≤ 10 %:**
1. **ganho principal:** memória do renderer+GPU **≤ 60 %** do baseline **ou** *p95* de tempo de quadro em C3 **≤ 70 %** do baseline **e** pelo menos **mais uma** métrica de P-170..P-174 passando que o baseline reprova;
2. **pisos:** P-03, P-04, P-05, P-06 (4 painéis), P-08, P-13 e P-12 **sem piorar** (tolerância ≤ 5 %, dentro do ruído medido) com o modo **ligado** em 4 e 8 painéis, e **idênticos** com o modo desligado;
3. **correção:** **0** byte de saída perdido em C3/C6/C7; corpus de fidelidade (P-177) dentro da tolerância; seleção/cópia/links/colar idênticos aos do modo atual;
4. **acessibilidade:** espelho DOM do painel em foco passa na suíte de a11y existente;
5. **estabilidade:** C7 sem crescimento de memória > 5 %; perda de contexto GPU simulada ⇒ *fallback* automático ≤ 1 s sem perder sessão;
6. **custo:** chunk do Overdrive ≤ 120 KB gz (P-175) e **+0 KB** no JS inicial.
**No-go:** qualquer uma falhando, ou métrica inconclusiva. Resultado e números gravados em `overdrive-resultado.json` + D-NN; **não se reabre** sem nova rodada de medição e novo D-NN.

## Orçamentos novos (somam-se aos de `03-ORCAMENTOS-DESEMPENHO.md`; numeração P-170..P-179)

Método comum: `tests/perf/overdrive/` (T-23.02) sobre o Electron real; `getProcessMemoryInfo`/`getAppMetrics`; rAF/`PerformanceObserver`; CLI falsa; relógio real (é medição de renderização); referência: Mac Apple Silicon. **Os alvos P-170..P-174 são absolutos (valem para qualquer renderer); P-175..P-178 valem só para o Overdrive; P-179 é a regra de reversão.** Estourou, a task **não fecha**.

| # | O que | Orçamento | Como se mede |
|---|---|---|---|
| P-170 | Memória do renderer (+ GPU) com N painéis em C2 | 32 painéis ≤ 600 MB; 64 painéis ≤ 900 MB; (Overdrive deve ainda cumprir ≤ 60 % do baseline, G-B.1) | `getAppMetrics` renderer + GPU |
| P-171 | *Flood* parcial (C3) | **nenhum** quadro > 50 ms (P-04) e FPS médio ≥ 50 em 32 e 64 painéis; p95 do tempo de quadro ≤ 70 % do baseline (G-B.1) | `longtask` + rAF |
| P-172 | Digitação com N painéis ativos (C4) | p95 ≤ 40 ms (**P-05 inalterado como piso**, não pode piorar > 5 %) | CLI falsa de eco, 60 teclas após aquecimento |
| P-173 | CPU em C2 | ≤ 150 % de um núcleo (soma dos processos do app) com 32 painéis; Overdrive ≤ 70 % do baseline | `getAppMetrics().cpu` |
| P-174 | Restaurar/abrir N painéis | 8 painéis ≤ 1,5 s (P-13); 32 ≤ 3 s; 64 ≤ 6 s até todos visíveis | e2e com daemon |
| P-175 | Custo de existir (Overdrive) | desligado: **+0 KB** no JS inicial, **0** módulos importados, **0** objetos GPU; chunk ≤ 120 KB gz; carregado só ao ligar; atlas de glifos ≤ 16 MB de GPU por DPR | script de tamanho + varredura de imports + `getAppMetrics` GPU |
| P-176 | Troca de modo a quente (C6) | ≤ 500 ms, **0** byte de saída perdido, sessão/scrollback/cursor/seleção preservados | marcas + comparação do buffer headless antes/depois |
| P-177 | Fidelidade visual | corpus de ≥ 40 telas (256/truecolor, Unicode largo e combinante, emoji, *box drawing*, cursor em 3 estilos, inverso, sublinhado, seleção) com diferença de pixels ≤ 1 % contra o renderer atual e **texto copiável idêntico** | diff de imagem do corpus + comparação de `getSelection` |
| P-178 | Estabilidade (C7 soak) | 30 min com 64 painéis: crescimento de memória ≤ 5 %, 0 exceção não tratada, perda de contexto GPU ⇒ *fallback* ≤ 1 s | amostragem a cada 10 s + injeção de `webglcontextlost` |
| P-179 | Reversão | desligar o Overdrive restaura o modo atual ≤ 500 ms; com a flag desligada o renderer atual **não importa** código do Overdrive (varredura) e o comportamento é **idêntico** (suíte do terminal atual inalterada e verde) | teste de imports + suíte existente + C6 |

## Arquitetura e pastas

> **Tudo em 23C é condicional a G-B = go.** Até lá só existem `tests/perf/overdrive/**`, `docs/ade/perf/**` e o *spike* descartável.

```
docs/ade/perf/{PROTOCOLO-OVERDRIVE.md,overdrive-criterios.json,overdrive-baseline.json,overdrive-spike.json,overdrive-resultado.json}   medição e decisão (permanecem mesmo no no-go)
tests/perf/overdrive/{carga,cenarios,coleta,relatorio}.ts       harness de carga sintética e coleta (permanece mesmo no no-go)
tests/fixtures/terminal-corpus/**                               corpus de ≥ 40 telas para fidelidade (sequências + imagem de referência)
src/renderer/overdrive/                                         SÓ SE GO (tudo removível: P-179; nada de fora importa daqui estaticamente)
  modo.ts                    preferência `overdrive` (desligado|sugerido|ligado), limiar por medição, *fallback* automático, selo experimental
  carregar.ts                único ponto que faz `import()` do chunk, só ao ligar
  atlas.ts                   atlas de glifos compartilhado (OffscreenCanvas 2D), por DPR/fonte/estilo; LRU; reconstrução em mudança de fonte/DPR
  layout.ts                  retângulos dos painéis a partir da árvore de layout da Fase 1 (sem recalcular layout próprio)
  fonte-de-dados.ts          lê do MESMO armazém (`@xterm/headless`); damage tracking por linha; sem cópia do scrollback
  renderer-gl.ts             WebGL2 instanciado: fundos + glifos + cursor + seleção em poucas chamadas de desenho; UM contexto
  renderer-2d.ts             *fallback* Canvas 2D (mesma interface) para GPU ausente/lista negra
  pintura.ts                 agenda (rAF), orçamento de quadro, repinta só linhas sujas; painéis fora de vista não pintam
  entrada.ts                 textarea oculta sobre o painel focado (teclado, IME/composição, colar com as MESMAS regras: confirmação > 20 000 caracteres/32 KB)
  selecao.ts · links.ts      seleção/cópia e links `http/https` sem credenciais (reusa as funções do terminal atual)
  a11y.ts                    espelho DOM do painel em foco (região viva, texto selecionável, taxa limitada)
  diagnostico.ts             contagem de contextos, tempo de quadro, GPU; usado pela tela e pelos testes
src/renderer/telas/configuracoes/Experimental.tsx               chave "Overdrive (experimental)", aviso, selo, botão desligar, resultado da última medição local
tests/{overdrive.e2e.test.ts} · tests/scripts/{overdrive-removivel,overdrive-criterios,overdrive-imports}.test.ts
docs/ade/AUDITORIA-OVERDRIVE.md                                 (se go) · docs/ade/perf/overdrive-resultado.json (go ou no-go)
```

**Variantes do *spike* (T-23.05/T-23.06; descartáveis):**
- **A — um WebGL2 na *main thread* do renderer:** atlas compartilhado, instâncias por célula, dano por linha.
- **B — `OffscreenCanvas` em *worker*:** o worker recebe atualizações do armazém e pinta; a *main thread* só repassa entrada e foco (ganha isolamento de longtask, custa cópias e latência de entrada).
- **C (opcional) — Canvas 2D único** (sem WebGL), para medir o piso de compatibilidade e o *fallback*.
Compara-se cada variante com o baseline **e entre si**; a escolhida entra em 23C, as outras são descartadas.

Fluxo (modo ligado):

```
PTY (daemon) ─► main (lotes 8–16 ms, redação OSC) ─► armazém `@xterm/headless` (fonte da verdade, fora do React)
      └─► renderer: `fonte-de-dados` (linhas sujas por painel) ─► `pintura` (rAF, orçamento) ─► `renderer-gl` (1 contexto, 1 atlas) ─► 1 <canvas>
entrada: `entrada.ts` (textarea oculta no painel focado) ─► MESMO caminho de escrita ao PTY (colar com confirmação, anexos, regra 10)
a11y: `a11y.ts` espelha o texto do painel focado no DOM (região viva, throttled) ─► leitor de tela
falha (erro de render | `webglcontextlost` | atlas esgotado) ─► `modo.ts` volta ao renderer atual ≤ 1 s, sem perder sessão, e avisa
```

## Modelo de dados e migration

**Nenhuma migration** e nenhuma tabela. A preferência `overdrive` (`desligado` padrão | `sugerido` | `ligado`), o limiar medido de painéis e o reconhecimento do aviso ficam em `preferencias.json` (D-29), via o **canal de preferências existente** (só se acrescenta a chave ao validador, pelo coordenador). Resultados da medição local opcional da tela
"Experimental" ficam em memória (não persistem). **Nenhum canal IPC novo no produto.** (O harness de medição usa ganchos só de teste, `NODE_ENV=test`/`EXPXV_PERF=1`, fora do caminho do produto.)

## UI (compacta, D-32) — só se go

- **Configurações › Experimental › Overdrive**: chave **desligada** por padrão, texto honesto do que muda ("um único desenho para todos os painéis; mais leve com muitos painéis; recursos de acessibilidade espelham o painel em foco; pode ser desligado a qualquer momento"), modo **"sugerir ao passar de N painéis"** (N = limiar **medido**, nunca fixo por palpite), selo **Experimental** e botão **Desligar agora** também no menu de visualização/paleta.
- Quando ligado: selo discreto no rodapé ("Overdrive · experimental"), atalho de teclado documentado para alternar, aviso não modal se houver *fallback* automático.
- Estados por forma **e** texto; teclado completo; leitor de tela (espelho do painel em foco); sem `backdrop-filter`.

## Tarefas

Formato: `T-23.NN · título` — arquivos · entrega · **aceite binário** · testes · depende. TDD onde houver código de produto (teste antes, falhando pelo motivo certo); `npm run verificar` verde. Só o **coordenador** edita: `src/compartilhado/ipc.ts` (validador da preferência),
`src/preload/preload.ts` (nada previsto), `package.json`, `05-CONTRATOS.md`, `04-UI-UX.md`, `03-ORCAMENTOS-DESEMPENHO.md`, `STATUS.md`.

### 23A — Medição (GATE G-A)

- **T-23.01 · Protocolo e critérios versionados** — `docs/ade/perf/PROTOCOLO-OVERDRIVE.md`, `docs/ade/perf/overdrive-criterios.json`, `tests/scripts/overdrive-criterios.test.ts`. Escreve **antes de medir** os cenários C1..C7, as métricas, os alvos P-170..P-174, os critérios G-A e G-B e o plano de reversão (esta seção, em forma validável).
  **Aceite:** o JSON valida contra um esquema (cenários, métricas, limiares, tolerâncias, CV máximo); teste falha se um limiar for **afrouxado** depois de existir `overdrive-baseline.json` (compara com o *hash* do critério gravado no baseline); todo P-17x citado existe no JSON. Testes: `overdrive-criterios.test.ts`. Depende: nada.
- **T-23.02 · Harness de carga sintética e coleta** — `tests/perf/overdrive/{carga,cenarios,coleta,relatorio}.ts`, `tests/perf/registro.ts` (extensão), `scripts/perf.mjs` (flag `--overdrive`). Cria N painéis (4/8/16/32/64) com CLI falsa determinística (cores 256/truecolor, Unicode largo, *flood* parametrizável), roda C1..C7 e coleta as métricas do protocolo; saída JSON com mediana, dispersão e CV.
  **Aceite:** reprodutível (semente fixa; CV do próprio harness ≤ 3 % em C1); **0** processo vivo ao fim (`ps`); não altera o produto (nenhum arquivo de `src/` tocado); roda no pacote e em `dist/`; N=64 não derruba a máquina (limites de memória do harness). Testes: `coleta.test.ts` (unidade), `carga.perf.ts`. Depende: T-23.01.
- **T-23.03 · Baseline do renderer atual** — `docs/ade/perf/overdrive-baseline.json`. Executa o harness no **renderer atual** em N = 4, 8, 16, 32, 64 (5 execuções cada), grava números, ambiente (máquina, DPR, versões) e o *hash* de `overdrive-criterios.json`.
  **Aceite:** arquivo completo para todos os (N, cenário, métrica); CV ≤ 10 % ou métrica marcada "inconclusiva" com motivo; P-03..P-07 e P-13 do modo atual reproduzem os valores de `ultimo.json` (±5 %). **Entregável permanece mesmo no no-go.** Testes: `baseline.test.ts` (esquema). Depende: T-23.02.
- **T-23.04 · Estudo de viabilidade técnica e decisão G-A** — `docs/ade/perf/PROTOCOLO-OVERDRIVE.md` (seção "Viabilidade"), `01-DECISOES.md` (D-361 **ou** D-362 a registrar na T-23.07). Lista as restrições de Chromium/Electron 37 (contextos WebGL, memória de GPU, `OffscreenCanvas`, textura máxima, DPR variável, IME em `<canvas>`), as dificuldades de fidelidade (Unicode largo/combinante, emoji, ligaduras, *box drawing*, subpixel), a11y e seleção; aplica G-A ao baseline.
  **Aceite:** decisão **G-A** registrada com os números: **desnecessário** (a fase **encerra** aqui: T-23.05..T-23.19 ficam "não executadas por G-A", T-23.20/T-23.21 cuidam do fecho) **ou** **necessário** (segue). Nenhuma variante é escolhida por palpite. Depende: T-23.03.

### 23B — *Spike* e decisão G-B (somente se G-A = necessário)

- **T-23.05 · *Spike* A: um WebGL2 na *main thread*** — `src/renderer/overdrive/spike-a/**` (descartável, atrás de `EXPXV_PERF=1`; **não** chega ao caminho do produto). Atlas compartilhado, instâncias por célula, dano por linha, um contexto, lendo do armazém existente; sem entrada/IME/seleção completos (só o suficiente para medir C2/C3/C4 com o **foco** simulado).
  **Aceite:** renderiza o corpus mínimo corretamente (cor, Unicode largo, cursor); roda C1..C5 em N=32/64; **não** altera o renderer atual; remoção limpa (`overdrive-removivel`). Testes: `spike-a.perf.ts`, teste de pintura (jsdom/imagem de referência mínima). Depende: T-23.04.
- **T-23.06 · *Spike* B (OffscreenCanvas em *worker*) e C (Canvas 2D único, opcional)** — `src/renderer/overdrive/spike-b/**`, `spike-c/**` (descartáveis). B mede o ganho de isolar a pintura e o custo de cópias e latência de entrada; C mede o piso de compatibilidade.
  **Aceite:** mesmos cenários e métricas de A; latência de entrada em B medida separadamente (P-172); remoção limpa. Testes: `spike-b.perf.ts`, `spike-c.perf.ts`. Depende: T-23.04.
- **T-23.07 · Comparação, decisão G-B e plano de reversão** — `docs/ade/perf/overdrive-spike.json`, `docs/ade/perf/overdrive-resultado.json`, `01-DECISOES.md` (**D-362** go **ou** no-go com números), `tests/scripts/overdrive-resultado.test.ts`. Aplica os critérios G-B (1–6) ao melhor dos spikes contra o baseline, em 32 e 64 painéis, 3 rodadas, CV ≤ 10 %; escolhe a variante (A, B ou C) **só pelos números**.
  **Aceite:** `overdrive-resultado.json` com `decisao: "go" | "no-go"`, a variante, os números de cada critério (atendido/não/inconclusivo) e o *hash* dos critérios; o teste falha se `decisao: "go"` com qualquer critério não atendido; **no-go ⇒ T-23.08..T-23.19 não executam** e a fase fecha por T-23.20/T-23.21. Depende: T-23.05, T-23.06.

### 23C — Produto (CONDICIONAL: só se G-B = go)

- **T-23.08 · Núcleo de renderização: atlas, layout, fonte de dados, renderer GL e *fallback* 2D** — `src/renderer/overdrive/{atlas,layout,fonte-de-dados,renderer-gl,renderer-2d,pintura,diagnostico}.ts` (a partir da variante escolhida). Um contexto, um atlas LRU por DPR/fonte/estilo, dano por linha, painéis fora de vista não pintam, orçamento de quadro, interface única de renderer.
  **Aceite:** unidade/imagem de referência no corpus; atlas reconstruído em mudança de fonte/DPR sem *flash*; GPU ≤ 16 MB por DPR (P-175); quadro > 50 ms nunca em C3 (P-171); `renderer-2d` entrega o mesmo corpus (P-177) quando WebGL2 falta. Testes: `atlas.test.ts`, `layout.test.ts`, `pintura.test.ts`, `renderer-gl.imagem.test.ts`, `renderer-2d.imagem.test.ts`. Depende: T-23.07.
- **T-23.09 · Entrada: teclado, IME, colar e foco** — `src/renderer/overdrive/entrada.ts`. Textarea oculta sobre o painel focado; teclas e composição (IME) idênticas ao terminal atual; **colar usa a mesma função** (confirmação > 20 000 caracteres ou > 32 KB); foco por clique/teclado entre painéis; atalhos de saída de teclado (WCAG 2.1.2, `Cmd/Ctrl+Shift+M`) preservados.
  **Aceite:** suíte de entrada do terminal atual passa **sem edição** com o Overdrive ligado (parametrizada por modo); colar grande pede confirmação; composição de IME não perde caracteres (casos CJK/acentos); latência P-172. Testes: `entrada.test.tsx` (jsdom), `entrada.e2e`. Depende: T-23.08.
- **T-23.10 · Seleção, cópia, links e busca** — `src/renderer/overdrive/{selecao,links}.ts`. Seleção por mouse/teclado entre linhas, palavra/linha por duplo/triplo clique, cópia com o texto do buffer (não da imagem), links **só `http/https` sem credenciais** com as funções do terminal atual, busca no scrollback (reaproveita o *addon* de busca sobre o buffer headless quando aplicável).
  **Aceite:** texto copiado **idêntico** ao do modo atual no corpus (P-177); link com credencial/esquema diferente não abre; OSC 8/52 continuam removidos (teste no main inalterado). Testes: `selecao.test.ts`, `links.test.ts`. Depende: T-23.08.
- **T-23.11 · Acessibilidade** — `src/renderer/overdrive/a11y.ts`. Espelho DOM do painel em foco (região viva, taxa limitada, texto selecionável), anúncio de troca de foco, `role`/`aria-label` do canvas, foco visível, `prefers-reduced-motion` (cursor sem piscar).
  **Aceite:** `a11y.e2e` existente passa com o modo ligado; leitor simulado (árvore de acessibilidade do Chromium) lê o texto do painel em foco; **se falhar, o modo não é oferecido** (critério G-B.4). Testes: `a11y.test.tsx`, `a11y.e2e`. Depende: T-23.08.
- **T-23.12 · *Fallback*, perda de contexto e *kill switch*** — `src/renderer/overdrive/modo.ts`. Erro de render, `webglcontextlost`, atlas esgotado ou quadro ruim sustentado ⇒ volta ao renderer atual ≤ 1 s, **sem perder** sessão/scrollback/seleção, avisa uma vez, **não reativa sozinho** na mesma sessão; *kill switch* por preferência.
  **Aceite:** teste injeta `webglcontextlost` e erro de shader ⇒ *fallback* ≤ 1 s com buffer idêntico antes/depois (P-176/P-178); sem laço de reativação. Testes: `fallback.test.ts`, `perda-contexto.e2e`. Depende: T-23.08.
- **T-23.13 · Chave, carregamento lazy e tela Experimental** — `src/renderer/overdrive/{modo,carregar}.ts`, `src/renderer/telas/configuracoes/Experimental.tsx`, chave `overdrive` no validador de preferências (coordenador), via coordenador a entrada em `casca/telas.ts`/paleta. Padrão **desligado**; `sugerido` oferece ligar acima do limiar **medido**; `import()` só ao ligar; selo e **Desligar agora** acessíveis.
  **Aceite:** desligado ⇒ **0 KB**/0 módulos/0 GPU (P-175: varredura de imports, tamanho, `getAppMetrics`); nenhum canal IPC novo; sugerir não liga sozinho; abre ≤ 50 ms (P-02). Testes: `Experimental.test.tsx`, `overdrive-imports.test.ts`, script de tamanho. Depende: T-23.08, T-23.12.
- **T-23.14 · Fidelidade visual (corpus)** — `tests/fixtures/terminal-corpus/**`, `tests/overdrive-fidelidade.e2e.test.ts`. ≥ 40 telas (256/truecolor, Unicode largo/combinante, emoji, *box drawing*, cursor em 3 estilos, inverso, sublinhado/tachado, seleção, linhas muito longas, DPR 1 e 2) renderizadas pelos dois modos e comparadas por diferença de pixels.
  **Aceite:** ≤ 1 % de pixels diferentes por tela (tolerância de *antialias*); texto copiável idêntico; diferenças conhecidas listadas com justificativa ou a task não fecha. Depende: T-23.08, T-23.10.
- **T-23.15 · *Soak* de 30 min e estabilidade** — `tests/perf/overdrive/soak.perf.ts`. 64 painéis em C2 por 30 min, amostragem de memória a cada 10 s, injeção periódica de `webglcontextlost`, troca de modo a cada 5 min.
  **Aceite:** P-178 (≤ 5 % de crescimento, 0 exceção, *fallback* ≤ 1 s); **0 byte de saída perdido**; `ps` limpo. Depende: T-23.12, T-23.13.

### 23D — Fecho (go **ou** no-go)

- **T-23.16 · E2E do Overdrive (somente go)** — `tests/overdrive.e2e.test.ts`. Electron real, CLI falsa, 32 painéis: ligar pela tela, digitar, colar com confirmação, selecionar e copiar, rolar, redimensionar o layout, trocar de modo a quente, desligar, *fallback* por perda de contexto, a11y, reiniciar o app (modo persiste só se o usuário escolheu `ligado`). **Aceite:** `ps` limpo; sem segredo/URL em logs; nenhuma regressão da suíte de terminais. Depende: T-23.09..T-23.13.
- **T-23.17 · Perf final (go: P-170..P-179; no-go: P-170..P-174 do baseline)** — `tests/perf/overdrive/final.perf.ts`, `registro.ts`. Grava `ultimo.json` com todas as chaves e confirma P-01..P-14 **inalterados** com o modo desligado (e os pisos com ele ligado). **Aceite:** reprova ao estourar orçamento simulado; "não medido" nunca vira verde. Depende: T-23.07 (no-go) ou T-23.16 (go).
- **T-23.18 · Auditoria independente (somente go)** — `docs/ade/AUDITORIA-OVERDRIVE.md`. Somente leitura, por agente sem o contexto de quem escreveu: segurança do terminal (regra 10) preservada, ausência de IPC novo, a11y, *fallback*, vazamento de memória/GPU, fidelidade, entrada/IME/colar, reversão. Cada achado corrigido com teste que falha sem a correção. **Aceite:** nenhum achado Alto aberto. Depende: T-23.16.
- **T-23.19 · Reversão ensaiada (somente go)** — `tests/scripts/overdrive-imports.test.ts`, `tests/overdrive-reversao.e2e.test.ts`. Prova P-179: com a preferência `desligado`, o caminho do renderer atual **não importa** nada de `src/renderer/overdrive/**` (varredura estática + dinâmica), a suíte do terminal atual passa **sem edição**, e ligar → desligar devolve o estado idêntico (buffer, foco, layout) em ≤ 500 ms. **Aceite:** o teste falha se alguém importar `overdrive` estaticamente fora do `carregar.ts`. Depende: T-23.13.
- **T-23.20 · Remoção do código descartável e do produto, se no-go** — `tests/scripts/overdrive-removivel.test.ts`. Em **no-go** (G-A ou G-B): remove `src/renderer/overdrive/**` e qualquer menção de produto (chave, tela), mantém `tests/perf/overdrive/**`, `docs/ade/perf/**` e o corpus; o teste compila a árvore **sem** `src/renderer/overdrive/` e confirma que nada o importa. Em **go**: o mesmo teste garante que **só** `carregar.ts` o importa.
  **Aceite:** `npm run typecheck` verde com e sem a pasta; D-361/D-362 e P-350 registrados. Depende: T-23.07.
- **T-23.21 · Contratos e fechamento** — `03-ORCAMENTOS-DESEMPENHO.md` (P-170..P-174 viram orçamentos permanentes de 32/64 painéis; P-175..P-179 só se go), `05-CONTRATOS.md` (chave de preferência, se go), `04-UI-UX.md` (se go), `STATUS.md`, `AGENTS.md` (D-11 revisado **apenas** se go), `01-DECISOES.md`, `PENDENCIAS-DO-DONO.md`. **Aceite:** portão da fase verde; resultado (go/no-go) e números no `STATUS.md`; checklist "Validação real (manual, do dono)" gravado. Depende: todas as aplicáveis.

## Validação real (manual, do dono) — não faz parte dos testes automáticos (D-23)

1. Rodar o harness em **sua** máquina e monitor reais (`node scripts/perf.mjs --overdrive`) e comparar com o `overdrive-resultado.json`. 2. Se go: usar 32 painéis por um dia de trabalho real (squads grandes) e avisar se algo parece pior do que o modo atual.
3. Testar com **leitor de tela real** (VoiceOver) e **IME real** (japonês/chinês/acentos). 4. Testar com **dois monitores com escalas diferentes** (DPR 1 e 2) arrastando a janela. 5. **Windows**: sem máquina aqui (D-26); medir quando houver (P-06). 6. Decidir se o modo `sugerido` deve existir (P-351).

## Casos de teste de aceitação (cada item vira teste nomeado)

| Área | Casos |
|---|---|
| Protocolo | critérios no JSON válidos; limiar afrouxado depois do baseline ⇒ teste falha; cenários C1..C7 reprodutíveis (CV do harness ≤ 3 %) |
| Decisão | G-A: baseline que cumpre ⇒ no-go registrado; G-B: critério não atendido/inconclusivo ⇒ `decisao: "go"` proibida |
| Renderização | corpus ≤ 1 % de pixels; texto copiável idêntico; atlas reconstruído em DPR/fonte novos; um contexto WebGL; *fallback* 2D idêntico |
| Entrada | teclado, IME, colar > 20 000/32 KB com confirmação, foco, saída de teclado; suíte do terminal atual **sem edição** |
| Segurança do terminal | OSC 52/8 removidos (teste do main inalterado); link só `http/https` sem credenciais; anexos recusam ambiente; nenhum IPC novo |
| a11y | espelho do painel em foco legível; se falhar, modo não é oferecido |
| Estabilidade | soak 30 min ≤ 5 %; `webglcontextlost` ⇒ *fallback* ≤ 1 s; 0 byte perdido; sem reativação automática |
| Reversão | desligado ⇒ 0 KB/0 import/0 GPU; ligar → desligar ≤ 500 ms com estado idêntico; remover a pasta compila |
| Pisos | P-03/P-04/P-05/P-06/P-08/P-12/P-13 sem piorar em 4 e 8 painéis, com o modo desligado e ligado |

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| **Construir algo caro que não ganha** | medir antes (G-A), *spike* descartável, G-B por número; no-go é sucesso |
| **Ganho só em 64 painéis, custo no uso comum** | pisos P-03..P-13 em 4/8 painéis; modo `sugerido` com limiar medido; padrão desligado |
| **Fidelidade pior que o xterm** (Unicode largo, emoji, ligaduras) | corpus de 40 telas com diff de pixels; diferenças listadas; `renderer-2d` e *fallback* ao modo atual |
| **IME/seleção/colar quebram** | textarea oculta + as mesmas funções do terminal atual; suíte atual parametrizada por modo |
| **Acessibilidade perdida no `<canvas>`** | espelho DOM do painel em foco; sem a11y verde o modo não é oferecido |
| **Perda de contexto GPU / memória de GPU** | um contexto, atlas LRU limitado, *fallback* automático ≤ 1 s, soak com injeção de `webglcontextlost` |
| **Troca de modo perde saída** | PTY/armazém inalterados; visão apenas; P-176 com comparação de buffer |
| **Regressão de segurança do terminal** | nenhuma regra movida para o renderer novo; mesmas funções; nenhum IPC novo; auditoria dedicada |
| **Ruído de medição** (térmica, outros processos) | 5 execuções, CV ≤ 10 %, inconclusivo = não atendido, ambiente padronizado, `ps` ao fim |
| **Dependência nova** | proibida em produção (D-364); benchmark só em `devDependencies` com custo registrado |
| **Código do spike vazando para o produto** | `EXPXV_PERF=1` + pasta separada + `overdrive-removivel` + varredura de imports |
| **Escopo infinito** (terminal completo em canvas) | fase só adota se G-B = go; funcionalidades fora do corpus de aceitação ficam no modo atual (o modo recusa e avisa) |
| **Vazamento de processos em teste** | `finally`; `tests/limpeza.ts`; `ps` ao fim; harness com limites |

## Ordem de execução e paralelismo

```
T-23.01 ─► T-23.02 ─► T-23.03 ─► T-23.04 (G-A) ─┬─ desnecessário ─► T-23.17 ─► T-23.20 ─► T-23.21        (fim por no-go)
                                                └─ necessário ─► T-23.05 ┐
                                                                 T-23.06 ┴─► T-23.07 (G-B) ─┬─ no-go ─► T-23.17 ─► T-23.20 ─► T-23.21
                                                                                             └─ go ─► T-23.08 ─┬─► T-23.09 ┐
                                                                                                                ├─► T-23.10 ┤
                                                                                                                ├─► T-23.11 ┼─► T-23.13 ─► T-23.14 ─► T-23.15
                                                                                                                └─► T-23.12 ┘            └─► T-23.16 ─► T-23.17 ─► T-23.18 ─► T-23.19 ─► T-23.20 ─► T-23.21
```

**Ondas e agentes (≤ 5 simultâneos; ninguém no mesmo arquivo):**

| Onda | Quem | Tasks | Áreas de arquivo (disjuntas) |
|---|---|---|---|
| W0 (serial) | Coordenador | T-23.01 | `docs/ade/perf/{PROTOCOLO-OVERDRIVE.md,overdrive-criterios.json}`, `tests/scripts/overdrive-criterios.test.ts` |
| W1 | A = harness | T-23.02 → T-23.03 | `tests/perf/overdrive/**`, `tests/perf/registro.ts`, `scripts/perf.mjs`, `docs/ade/perf/overdrive-baseline.json` |
| W1 | B = estudo | T-23.04 (parte escrita) | `docs/ade/perf/PROTOCOLO-OVERDRIVE.md` (seção Viabilidade) |
| **G-A** | Coordenador | decisão | `01-DECISOES.md` (D-361 ou segue) |
| W2 | A = *spike* A | T-23.05 | `src/renderer/overdrive/spike-a/**` |
| W2 | B = *spike* B/C | T-23.06 | `src/renderer/overdrive/spike-b/**`, `spike-c/**` |
| W3 (serial) | Coordenador | T-23.07 (**G-B**) | `docs/ade/perf/overdrive-{spike,resultado}.json`, `01-DECISOES.md`, `tests/scripts/overdrive-resultado.test.ts` |
| W4 (só go) | A = núcleo | T-23.08 | `src/renderer/overdrive/{atlas,layout,fonte-de-dados,renderer-gl,renderer-2d,pintura,diagnostico}.ts` |
| W5 (só go) | A | T-23.09, T-23.10 | `src/renderer/overdrive/{entrada,selecao,links}.ts` |
| W5 (só go) | B | T-23.11, T-23.12 | `src/renderer/overdrive/{a11y,modo}.ts` |
| W5 (só go) | C | T-23.14 | `tests/fixtures/terminal-corpus/**`, `tests/overdrive-fidelidade.e2e.test.ts` |
| W6 (só go) | D = UI | T-23.13 | `src/renderer/overdrive/carregar.ts`, `src/renderer/telas/configuracoes/Experimental.tsx` (entrada em `casca/telas.ts` pelo coordenador) |
| W6 (só go) | A | T-23.15 | `tests/perf/overdrive/soak.perf.ts` |
| W7 (serial) | Coordenador + segurança | T-23.16 → T-23.17 → T-23.18 → T-23.19 → T-23.20 → T-23.21 | `tests/**`, `docs/ade/perf/**`, `AUDITORIA-OVERDRIVE.md`, contratos, `STATUS.md` |

**Antes de começar:** o terminal atual e `tests/perf/terminal.perf.ts` (P-03..P-07, P-13) como referência; a Fase 21 (T-21.26, `perf:pacote`) é **opcional** (permite repetir a medição **dentro do app empacotado**). **Caminho crítico:** T-23.01 → 02 → 03 → 04 → (05/06) → 07 → (go) 08 → 09..12 → 13 → 16 → 17 → 18 → 19 → 21. **Se faltar tempo:** entregam-se **T-23.01–T-23.04** (protocolo, harness, baseline e decisão G-A) — **já têm valor sozinhas** (o dono passa a saber quanto o app aguenta) — e o resto só com G-A = necessário.

## Decisões `[LAC]` resolvidas

| Lacuna | Decisão |
|---|---|
| Vale construir o Overdrive? | [DEC] **só se a medição mandar**: G-A (necessidade) e G-B (ganho) por número, escritos antes (D-360, D-361, D-362) |
| Onde pintar | [DEC] um `<canvas>` WebGL2 com **um contexto** e **um atlas**; Canvas 2D só como *fallback*; variantes A/B/C comparadas no *spike* |
| Fonte da verdade | [DEC] o armazém e o `@xterm/headless` **atuais**; o Overdrive é **visão** (D-363) |
| Entrada/IME/colar | [DEC] textarea oculta no painel focado; **mesmas** funções de colar/links/anexos do terminal atual |
| Acessibilidade | [DEC] espelho DOM do painel em foco; sem ele verde o modo não é oferecido |
| Padrão | [DEC] **desligado**; `sugerido` só com limiar **medido**; nunca liga sozinho |
| IPC | [DEC] **nenhum canal novo**; preferência pelo canal existente (D-363) |
| Dependências | [DEC] nenhuma de produção; benchmark só em `devDependencies` (D-364) |
| Reversão | [DEC] chave única + *fallback* automático + remoção do código (`overdrive-removivel`); desligado ⇒ 0 import (P-179) |
| Windows | [DEC] medir só quando houver máquina (D-26); a fase roda no macOS de referência |
| Onde medir | [DEC] `dist/` e, se a Fase 21 existir, **dentro do pacote** (`perf:pacote`) |
| O que fica se no-go | [DEC] harness, baseline, critérios, corpus e resultado **permanecem** como regressão de 32+ painéis |

## Fronteiras com outras fases

- **Fase 1 (Terminais) e D-11:** o renderer atual não muda; D-11 só é revisado (D-NN) **se** G-B = go. O armazém e o daemon (D-12) são a fonte da verdade.
- **Fase 5 (acabamento/perf):** os orçamentos P-01..P-14 são pisos; P-170..P-174 viram orçamentos permanentes de 32/64 painéis (mesmo no no-go, como regressão).
- **Fase 14/16 (squads/Maestro):** squads grandes (até o limite global de terminais) são o caso de uso; a fase **não** altera o orquestrador nem o limite de terminais.
- **Fase 21 (distribuição):** o perfil `perf` do pacote e o `perf:pacote` permitem repetir a medição no app empacotado; o chunk do Overdrive respeita P-08/P-153.
- **Fase 22 (acesso remoto):** o PWA **não** usa o Overdrive; os painéis remotos são texto.
- **D-04/D-23/D-25/D-32:** o ADE não escreve em `docs/**` (os arquivos de `docs/ade/perf/**` são artefatos **do plano**, gravados por agentes de desenvolvimento, não pelo app); nada sai da máquina; sem telemetria; UI compacta.
