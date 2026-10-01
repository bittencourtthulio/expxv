/**
 * MCP do app: servidor HTTP em loopback com token por Pane (D-13) e as tools do MVP.
 *
 * COMO LIGAR NO MAIN (as portas). O servidor não importa banco, terminais nem missões: o main monta
 * as implementações e as injeta.
 *
 *   const emissor = criarEmissorDeTokens();                              // segredo aleatório do processo
 *   const servicoHandoff = criarServicoHandoff({ ... });                 // orquestracao/handoff.ts (PortaHandoff)
 *   const ganchos = criarGanchosClaude({ ... });                         // orquestracao/hooks/claude.ts (PortaGanchos)
 *   const mcp = await iniciarServidorMcp({
 *     emissor, ganchos,
 *     deps: {
 *       panes,        // PortaPanes: spawn = cria o Pane com montarComandoWorker (orquestracao/piloto.ts) e registra
 *                     //   na UI; listar/obter/fechar sobre o repo de panes; ler = armazém de tela (@xterm/headless);
 *                     //   enviar = escrita na sessão do PTY.
 *       missoes,      // PortaMissoes: sobre o serviço de missões (portões de intake, squad, concluir).
 *       provedores,   // PortaProvedores: sobre o serviço de provedores (habilitados, contas, modelos).
 *       handoff: servicoHandoff,
 *       relogio: relogioReal,
 *       raiz: (ws, missao) => raizOndeOPaneTrabalha(ws, missao),         // worktree da Missão ou raiz do workspace
 *       maxPanesParalelos: MAX_PANES_PARALELOS,
 *       avisar: (m) => barramento.emitir("orquestracao.aviso", { mensagem: m }),
 *     },
 *   });
 *
 * Ao abrir um Pane de CLI: `mcp.emitirToken({workspace_id, mission_id, pane_id, role, mode})`, e passar
 * `mcp.url`/`mcp.urlGanchos` + token para `montarComandoPiloto`/`montarComandoWorker`, que devolvem
 * executável, argv (sem shell), ambiente e os arquivos (0600) a gravar no diretório do app. Ao fechar
 * ou respawnar o Pane: `mcp.revogar(pane_id)` (respawn emite um token novo para o MESMO pane_id).
 * O main também deve chamar `fila.aoMudarEstado(pane_id, estado)` (wake) a cada `pane.state_changed`.
 */
export * from "./erros";
export * from "./portas";
export * from "./tokens";
export { TOOLS_MVP, DEFINICOES, ferramentasPermitidas, matrizPorModo, type NomeTool } from "./catalogo";
export { iniciarServidorMcp, hostEhLoopback, origemEhLoopback, LIMITE_CORPO_BYTES, type ServidorMcp, type OpcoesServidorMcp } from "./servidor";
export type { DepsTools } from "./tools/comum";
