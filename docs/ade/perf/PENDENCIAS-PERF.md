# Pendências de desempenho (T-05.04)

Só entra aqui o que foi **medido** e não tem correção mínima segura dentro da T-05.04. Nenhum limite foi
relaxado; nenhuma linha de `ultimo.json` está vermelha por causa destas pendências (elas ficam fora dos
orçamentos P-01..P-15, que medem os cenários do `03-ORCAMENTOS-DESEMPENHO.md`).

## PP-01 — Encerrar o app com um projeto de ~10 000 arquivos em `docs/` segura o processo por dezenas de segundos

- **Cenário:** workspace com 1 000 trabalhos × 10 arquivos (o volume do P-09, `gerarVolume(raiz, 10_000)`), app aberto,
  o usuário fecha a janela (`app.quit()`).
- **Medido:** `app.close()` levou 27 s na melhor das 6 tentativas e passou de 30 s (até 120 s) nas outras 5. Com 500 arquivos fecha em
  1,2 s; com 200 (o cenário do P-10) em ~1 s. O processo fica vivo e ocioso (amostra `sample`: thread principal parada no
  `kevent`, nenhum JS rodando).
- **Causa localizada** (marcas temporárias no `dist`, já revertidas): o `before-quit` chega a `dominio.encerrar()` →
  `gerenciadorMetodo.soltar()` → `soltarRaiz()` → `await obs.fechar()` e **não sai daí**: é o `watcher.close()` do chokidar
  sobre ~10 000 arquivos (a varredura/stat de `awaitWriteFinish` precisa terminar antes). O limite de 4 s do `before-quit`
  (`Promise.race` com `setTimeout(...).unref()`) **não dispara** enquanto isso. Teste: sem o `.unref()` e com um
  `setInterval` de 1 s de prova, nenhum dos dois timers rodou durante o travamento (só uma "batida" no instante em que o
  `close()` terminou, 26,7 s depois): o loop do main não processa timers nesse intervalo, então a rede de segurança dos 4 s
  não protege este caso, com ou sem `unref`.
- **Por que não corrigi aqui:** não estoura nenhum orçamento P-xx (nem tem orçamento: 10 000 arquivos é 50× o cenário de
  200 artefatos), e a correção certa mexe no encerramento do main (`src/main/main.ts`, `src/nucleo/metodo/observador.ts`)
  fora do escopo desta task e dos agentes em paralelo.
- **Correção sugerida (pequena):** (1) no encerramento do app, não esperar o `watcher.close()` (um `Promise.race` com timer não basta: ver acima);
  (2) investigar por que o loop do main não roda timers durante o `watcher.close()` (chamada nativa do fsevents bloqueando o poll); (3) ao soltar o workspace, não esperar a varredura inicial.
- **Teste:** `tests/perf/metodo.perf.ts` (P-09) mata o processo se o fechamento passar de 15 s e registra isso no log.

## PP-02 — Observador não fica "pronto" em projeto muito grande (~10 000 arquivos)

Mesma causa do PP-01: a varredura inicial do chokidar leva dezenas de segundos sob carga alta. Mudanças feitas antes do
`ready` se perdem até a próxima releitura. Não afeta os 200 artefatos do P-11 (watcher pronto em < 1,5 s).

## PP-03 — Consulta de contas por provedor ordena em tabela temporária

`conta.listar({ provedor, apenasHabilitadas })` com 5 000 contas do mesmo provedor leva 2,3 ms de mediana (limite 5 ms) porque
`ix_conta_provedor` não cobre o `ORDER BY id`. Cenário artificial (o app tem poucas contas); fica registrado: um índice
`(provedor, id)` numa migração futura elimina a ordenação (não medido).

## Primeira abertura fria

- **Corrigido:** primeira abertura da paleta (⌘K) levava ~310 ms (ver `RELATORIO-MVP.md`, "Correções").
- **Sem orçamento, só registrado:** a indexação **a frio** de 205 artefatos pode passar de 300 ms sob carga ambiente alta
  (316 ms numa rodada com carga 30); a mediana de 5 (frio + 4 quentes) fica em ~36 ms. O orçamento P-10 vale para a mediana.

## Resolvido na rodada 1 da auditoria (PP-01 e PP-02)

`src/nucleo/metodo/observador.ts` agora usa UM `fs.watch` recursivo por pasta (chokidar só como reserva se o recursivo não for suportado, com aviso). Fechar com ~10 000 arquivos: **1,1 ms** (antes: 165 803 ms numa máquina com carga, 10,6 s na medição do auditor, 27 s a mais de 120 s no PP-01); maior atraso de um timer de 10 ms durante o fechamento: 12 ms. Teste: `observador.test.ts` ("AUD-06"). O `before-quit` ganhou uma rede final (`app.exit` em 7 s) e `encerrar()` do método não espera watcher (teto de 1 s). O observador fica "pronto" sem varredura inicial (PP-02).

