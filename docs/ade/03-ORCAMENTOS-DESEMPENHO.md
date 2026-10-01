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

## Como o teste de performance entra no dia a dia

- `npm run verificar` roda os orçamentos **estáticos** (P-08, contagem de dependências).
- `npm run perf` roda os dinâmicos (precisa do Electron; ~1–2 min) e grava
  `docs/ade/perf/ultimo.json`. O portão de cada fase com UI exige esse arquivo verde.
- Estourou um orçamento: a task **não fecha**. Corrige-se a causa (não o limite).
