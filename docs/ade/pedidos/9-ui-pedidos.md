# Pedidos da Fase 9 (onda 7, UI) a quem é dono do arquivo

Escrito pela onda 7 (T-09.29 a T-09.32, T-09.34 a T-09.36). A UI já está pronta e tolera a falta de cada item abaixo: o canal ausente vira o
estado "indisponível" (texto explicativo), nunca erro nem zero. Nada em `src/nucleo`, `src/main`, `src/compartilhado` ou migrations foi alterado.

## 1. Manipuladores no main para canais já declarados em `ipc.ts` (dono: `src/main/ipc/limites.ts`, `src/nucleo/limites/**`)

- `limites:historico` (tabela `limite_amostra`): alimenta as sparklines da Visão geral e a curva da Previsão (`PedidoHistoricoLimites`, ≤ 300 pontos).
- `limites:previsao` e `limites:eficiencia`: aba "Previsão e eficiência" (`textoPrevisao`, barras semanais com meta e selo "cedo"). `insuficiente` é exibido como tal.
- `limites:alertas`: lista de alertas com ação ("abrir Harness" / "ver provedores") e selos na Visão geral.
- Ao registrar, o erro de "canal sem manipulador" é reconhecido pela UI por `ehCanalAusente` (`estado/carga.ts`); outro erro aparece como falha com a mensagem.

## 2. Meta semanal de eficiência (dono: `src/main/ipc/config`)

A UI usa a meta padrão de 90% (`META_PADRAO_PCT`, P-102). Falta uma chave de `config` legível pelo renderer (ex.: `limites.meta_semanal_pct`) para a tela exibir a meta configurada.

## 3. Filtro por Pane nas Decisions (dono: `harness:decisoes_listar`)

O recibo "por que esta conta" do Pane é montado a partir das últimas 200 Decisions (campo `pane_id`). Um filtro `pane_id` em `PedidoListarDecisoes` evitaria ler 200 itens e cobriria Panes antigos.

## 4. Evento de troca com `pane_id` na sugestão (já existe) e sugestões pendentes ao abrir o app

`EventoHarness.troca_sugerida` traz `pane_id`, mas `Troca` (de `harness:trocas_listar`) não: sugestões pendentes que existiam ANTES de a janela abrir não sabem a qual Pane pertencem. Pedido: acrescentar `pane_id: string | null` em `Troca` (ou em `PaginaTrocas`) para a faixa de sugestão reaparecer após recarregar a janela.

## 5. Consumo por modelo, workspace, Missão e Pane (Fase 10)

As visões "agrupar por workspace/Missão/Pane" e a aba "Detalhe por uso" mostram "disponível depois da ingestão de uso (fase 10)" até existir o ponto de extensão `FonteDeUso` (`custo:*`).

## 6. Não feito nesta onda (fora da lista pedida; sem bloqueio de canal)

- T-09.33 Provedores › OpenRouter (UI): depende dos canais `openrouter:*` (T-09.26/28), ainda sem preload.
- T-09.36, parte do wizard "Automático (harness)" em `telas/missoes/Criar.tsx` (rota prevista). O recibo, a faixa de sugestão e o botão "mover" do Pane estão prontos.
- Perf P-103 (Profiler de re-render do medidor/chip) e P-106/P-108 (60 fps em listas de 5 000): as listas usam `VirtualLista`; a medição no Electron real fica para a T-09.37 (precisa de build novo, bloqueado pelo `npm run dev` do dono).
