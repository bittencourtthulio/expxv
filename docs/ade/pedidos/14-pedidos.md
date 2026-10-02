# Pedidos da Fase 14 (squads) a quem é dono do arquivo

Escrito pela onda 3 (T-14.09..T-14.16). Cada pedido diz o que precisa, onde e por quê; o núcleo já está pronto e testado.

## 1. Tools MCP `agent_list` e `agent_invoke` (dono: `src/nucleo/mcp/{catalogo,portas,tools}`)

A lógica inteira está em `src/nucleo/squads/invocacao.ts` e roda NO MAIN (o worker do MCP só a chama por RPC): `ligarSquads(...).portaSquads`.

- `portas.ts`: nova porta `PortaSquads` (RPC, só dados clonáveis):
  `listar(mission_id): { agents: Array<{ agent_id, role, label, description, tier, max_instances, in_flight }> }` e
  `invocar(claims: { workspace_id, mission_id, pane_id, role, mode }, args: { agent_id, briefing_path?, prompt? }): { pane_id, invocation_id }`.
  A identidade (`claims`) vem SEMPRE do token. Erros são `ErroMcp` (`forbidden_role`, `gate_pending`, `limit_reached`, `provider_disabled`, `not_in_mission`, `not_found`, `invalid_argument`); o RPC precisa preservar `code`/`subcode`.
- `tools/agente.ts` (novo) + `DEFINICOES` + `catalogo.ts`: `agent_list` `{}` e `agent_invoke` `{agent_id, task_id?, briefing_path?, prompt? (≤ 4000)}`; `task_id` é aceito e ignorado (cada invocação cria o seu card). Matriz: modo `squad` e `agentico` COM squad, só o piloto; workers não ganham nada; modo livre nada.
- `agent_list` nunca devolve texto de prompt e cabe em 4 KB (testado); o orquestrador não aparece (não é invocável).
- Enquanto isso, `pane_spawn` com `agent_id` JÁ aplica o perfil do membro (a porta de agentes ajusta provedor/modelo/limites dentro de `panesPorta.spawn`), então a squad funciona sem as tools novas; elas só dão o caminho "oficial" do plano.

## 2. Contrato `PreviaImportacao` (dono: `src/compartilhado/squads.ts`)

A UI da T-14.24 precisa mostrar os PROMPTS COMPLETOS na prévia antes de confirmar. Hoje `PreviaImportacao` não os carrega. Proposta: acrescentar `prompts: Record<string, string>` (membro → texto, ≤ 16 KiB cada, já validados). Até lá `portabilidade.promptsDaPrevia(previa_id)` existe no núcleo (sem canal IPC).

## 3. Permissão por agente (D-232) × flags automáticas (dono: `src/nucleo/terminais/sessoes.ts` / `main/ipc/terminais.ts`)

As flags automáticas entram na camada de sessões por WORKSPACE (`argumentosAutomaticos(id, workspace_id)`). O preparo do agente NÃO as repete (evita duplicar) e registra a permissão efetiva do membro em `invocacao_agente.recibo`. Consequência: membro MAIS PERMISSIVO que o workspace fica no teto do workspace (correto), mas membro MAIS RESTRITO (ex.: `seguro` num workspace `automatico`) ainda recebe a flag do workspace. Para fechar a T-14.12 por inteiro, `argumentosAutomaticos` precisaria receber a permissão efetiva do Pane (ex.: `PedidoAbrirSessao.permissao`).

## 4. Pendências conhecidas (sem dono definido)

- `agentes:abrir_pane` (modo livre, T-14.17): sem manipulador (continua na lista `CANAIS_SQUADS_SEM_MANIPULADOR_AINDA`).
- Modo `squad` do wizard sem `squad_id` (T-14.11/25): segue como no MVP (sem vínculo, sem agente) para não quebrar o wizard atual; só a caixa de prompt vincula squad.
- Missão da caixa de prompt nasce SEM worktree (origem `livre`); com worktree por `escopo: desenvolvimento` fica para quando o wizard (T-14.25) decidir o `ExtraCriarMissao`.
- `PedidoCriarMissao.squad_id` não foi necessário: o vínculo nasce no preparo do piloto (intenção registrada pela caixa de prompt) e grava `mission_squad` + `mission.squad_id` + `orquestracao.definirSquad`.
- Orçamentos soft de tempo/tokens por membro (aviso `agent.budget_exceeded`): campos validados e gravados; o monitor com relógio fica para a Fase 10 (`cost.updated`).

## Atualização da onda 6 (fechamento)

- Item 2 (`PreviaImportacao.prompts`): feito (contrato e UI).
- Item 4: `PedidoCriarMissao.squad_id`/`squad_cli` agora existem (ver `05-CONTRATOS.md` §9.3); modo `squad` sem `squad_id` segue como no MVP. `agentes:abrir_pane` tem manipulador desde a onda 3.
- Residual para o dono de `src/nucleo/mcp/tools/pane.ts`: `pane_spawn` com `agent_id` e SEM `provider` ainda aciona o roteador do harness (gasta uma decisão e devolve um `receipt` de um perfil que o `agent_id` sobrepõe). A rota gravada já fica correta (o agente vence em `pane_rota`), mas o ideal é pular o roteamento quando há `agent_id` (ver `AUDITORIA-SQUADS.md`, RA-2).
