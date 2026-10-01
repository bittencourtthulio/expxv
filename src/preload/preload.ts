import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ApiAde, CanaisEvento } from "../compartilhado/ipc";

// Preload com sandbox: só pode usar `electron` (nenhum require relativo em runtime). Por isso os
// nomes de canal ficam INLINE aqui; `preload.test.ts` confere que batem com os de compartilhado/ipc.ts.
// API ENUMERADA — `ipcRenderer` cru nunca é exposto. Sem chamadas síncronas de IPC (bloqueariam a abertura).

type Ouvinte<T> = (e: T) => void;

function assinar<T>(canal: string, cb: Ouvinte<T>): () => void {
  const listener = (_evento: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(canal, listener);
  return () => ipcRenderer.removeListener(canal, listener);
}

const api: ApiAde = {
  versao: () => ipcRenderer.invoke("app:versao") as Promise<string>,
  tema: {
    ler: () => ipcRenderer.invoke("app:tema_ler") as ReturnType<ApiAde["tema"]["ler"]>,
    definir: (preferencia) => ipcRenderer.invoke("app:tema_definir", { preferencia }) as ReturnType<ApiAde["tema"]["definir"]>,
    assinar: (cb) => assinar<CanaisEvento["app:tema_mudou"]>("app:tema_mudou", cb),
  },
  menu: {
    assinar: (cb) => assinar<CanaisEvento["app:menu"]>("app:menu", cb),
  },
  config: {
    ler: (chave) => ipcRenderer.invoke("app:config_ler", { chave }) as Promise<unknown>,
    gravar: (chave, valor) => ipcRenderer.invoke("app:config_gravar", { chave, valor }) as Promise<{ ok: true }>,
  },
  perf: {
    ler: () => ipcRenderer.invoke("app:perf") as ReturnType<ApiAde["perf"]["ler"]>,
    marcar: (nome) => {
      ipcRenderer.send("app:marca_perf", { nome });
    },
  },
  terminais: {
    listarFerramentas: (forcar = false) => ipcRenderer.invoke("terminais:listar_ferramentas", { forcar }) as ReturnType<ApiAde["terminais"]["listarFerramentas"]>,
    selecionarExecutavel: (ferramentaId) => ipcRenderer.invoke("terminais:selecionar_executavel", { ferramenta_id: ferramentaId }) as ReturnType<ApiAde["terminais"]["selecionarExecutavel"]>,
    abrir: (pedido) => ipcRenderer.invoke("terminais:abrir", pedido) as ReturnType<ApiAde["terminais"]["abrir"]>,
    listarSessoes: () => ipcRenderer.invoke("terminais:listar_sessoes") as ReturnType<ApiAde["terminais"]["listarSessoes"]>,
    recuperar: () => ipcRenderer.invoke("terminais:recuperar") as ReturnType<ApiAde["terminais"]["recuperar"]>,
    encerrar: (sessaoId) => ipcRenderer.invoke("terminais:encerrar", { sessao_id: sessaoId }) as Promise<boolean>,
    descartar: (sessaoId) => ipcRenderer.invoke("terminais:descartar", { sessao_id: sessaoId }) as Promise<boolean>,
    // teclado, redimensionar e interromper não esperam resposta; falhas voltam por assinarFalhas
    escrever: (sessaoId, dados) => {
      ipcRenderer.send("terminais:escrever", { sessao_id: sessaoId, dados });
    },
    redimensionar: (sessaoId, colunas, linhas) => {
      ipcRenderer.send("terminais:redimensionar", { sessao_id: sessaoId, colunas, linhas });
    },
    interromper: (sessaoId) => {
      ipcRenderer.send("terminais:interromper", { sessao_id: sessaoId });
    },
    confirmarConsumo: (sessaoId, bytes) => ipcRenderer.invoke("terminais:confirmar_consumo", { sessao_id: sessaoId, bytes }) as Promise<boolean>,
    anexar: (sessaoId, itens) => ipcRenderer.invoke("terminais:anexar", { sessao_id: sessaoId, itens }) as ReturnType<ApiAde["terminais"]["anexar"]>,
    caminhoDoArquivo: (arquivo) => {
      try {
        return webUtils.getPathForFile(arquivo);
      } catch {
        return "";
      }
    },
    abrirLink: (url) => ipcRenderer.invoke("terminais:abrir_link", { url }) as Promise<boolean>,
    lerLayout: (workspaceId) => ipcRenderer.invoke("terminais:layout_ler", { workspace_id: workspaceId }) as ReturnType<ApiAde["terminais"]["lerLayout"]>,
    gravarLayout: (workspaceId, layout) => ipcRenderer.invoke("terminais:layout_gravar", { workspace_id: workspaceId, layout }) as Promise<boolean>,
    diagnostico: () => ipcRenderer.invoke("terminais:diagnostico") as ReturnType<ApiAde["terminais"]["diagnostico"]>,
    conversas: () => ipcRenderer.invoke("terminais:conversas") as Promise<Record<string, string>>,
    assinarEventos: (cb) => assinar<CanaisEvento["terminais:evento"]>("terminais:evento", cb),
    assinarFalhas: (cb) => assinar<CanaisEvento["terminais:falha"]>("terminais:falha", cb),
  },
  workspaces: {
    estado: () => ipcRenderer.invoke("workspaces:estado") as ReturnType<ApiAde["workspaces"]["estado"]>,
    abrir: (caminho) => ipcRenderer.invoke("workspaces:abrir", { caminho }) as ReturnType<ApiAde["workspaces"]["abrir"]>,
    definirAtual: (workspaceId) => ipcRenderer.invoke("workspaces:definir_atual", { workspace_id: workspaceId }) as ReturnType<ApiAde["workspaces"]["definirAtual"]>,
    remover: (workspaceId) => ipcRenderer.invoke("workspaces:remover", { workspace_id: workspaceId }) as Promise<boolean>,
    definirPermissao: (workspaceId, permissao) => ipcRenderer.invoke("workspaces:definir_permissao", { workspace_id: workspaceId, permissao }) as ReturnType<ApiAde["workspaces"]["definirPermissao"]>,
    worktrees: (workspaceId) => ipcRenderer.invoke("workspaces:worktrees", { workspace_id: workspaceId }) as ReturnType<ApiAde["workspaces"]["worktrees"]>,
    assinar: (cb) => assinar<CanaisEvento["workspaces:mudou"]>("workspaces:mudou", cb),
  },
  provedores: {
    listar: (forcar = false) => ipcRenderer.invoke("provedores:listar", { forcar }) as ReturnType<ApiAde["provedores"]["listar"]>,
    criarConta: (provedor, rotulo) => ipcRenderer.invoke("provedores:contas_criar", { provedor, rotulo }) as ReturnType<ApiAde["provedores"]["criarConta"]>,
    habilitarConta: (contaId, habilitada) => ipcRenderer.invoke("provedores:contas_habilitar", { conta_id: contaId, habilitada }) as ReturnType<ApiAde["provedores"]["habilitarConta"]>,
    diagnostico: () => ipcRenderer.invoke("provedores:diagnostico") as ReturnType<ApiAde["provedores"]["diagnostico"]>,
  },
  missoes: {
    listar: (workspaceId, estado = null, depois = null) => ipcRenderer.invoke("missoes:listar", { workspace_id: workspaceId, estado, depois }) as ReturnType<ApiAde["missoes"]["listar"]>,
    criar: (pedido) => ipcRenderer.invoke("missoes:criar", pedido) as ReturnType<ApiAde["missoes"]["criar"]>,
    detalhe: (missionId) => ipcRenderer.invoke("missoes:detalhe", { mission_id: missionId }) as ReturnType<ApiAde["missoes"]["detalhe"]>,
    encerrar: (missionId) => ipcRenderer.invoke("missoes:encerrar", { mission_id: missionId }) as ReturnType<ApiAde["missoes"]["encerrar"]>,
    abortar: (missionId) => ipcRenderer.invoke("missoes:abortar", { mission_id: missionId }) as ReturnType<ApiAde["missoes"]["abortar"]>,
    portoes: (missionId) => ipcRenderer.invoke("missoes:portoes", { mission_id: missionId }) as ReturnType<ApiAde["missoes"]["portoes"]>,
    liberarPortao: (missionId, portao) => ipcRenderer.invoke("missoes:liberar_portao", { mission_id: missionId, portao }) as ReturnType<ApiAde["missoes"]["liberarPortao"]>,
    assinar: (cb) => assinar<CanaisEvento["missoes:mudou"]>("missoes:mudou", cb),
  },
  metodo: {
    estado: (workspaceId) => ipcRenderer.invoke("metodo:estado", { workspace_id: workspaceId }) as ReturnType<ApiAde["metodo"]["estado"]>,
    rastro: (workspaceId, trabalhoId, depois = 0) => ipcRenderer.invoke("metodo:rastro", { workspace_id: workspaceId, trabalho_id: trabalhoId, depois }) as ReturnType<ApiAde["metodo"]["rastro"]>,
    comandoSugerido: (workspaceId, trabalhoId, gesto, argumento = null) => ipcRenderer.invoke("metodo:comando_sugerido", { workspace_id: workspaceId, trabalho_id: trabalhoId, gesto, argumento }) as ReturnType<ApiAde["metodo"]["comandoSugerido"]>,
    disparar: (pedido) => ipcRenderer.invoke("metodo:disparar", pedido) as ReturnType<ApiAde["metodo"]["disparar"]>,
    assinar: (cb) => assinar<CanaisEvento["metodo:mudou"]>("metodo:mudou", cb),
  },
  limites: {
    snapshot: (contaIds) => ipcRenderer.invoke("limites:snapshot", { conta_ids: contaIds }) as ReturnType<ApiAde["limites"]["snapshot"]>,
    atualizar: (contaId) => ipcRenderer.invoke("limites:atualizar", { conta_id: contaId }) as ReturnType<ApiAde["limites"]["atualizar"]>,
    definirManual: (contaId, janela, usadoPct, reiniciaEm) => ipcRenderer.invoke("limites:manual_definir", { conta_id: contaId, janela, usado_pct: usadoPct, reinicia_em: reiniciaEm }) as ReturnType<ApiAde["limites"]["definirManual"]>,
    limparManual: (contaId, janela) => ipcRenderer.invoke("limites:manual_limpar", { conta_id: contaId, janela }) as ReturnType<ApiAde["limites"]["limparManual"]>,
    historico: (pedido) => ipcRenderer.invoke("limites:historico", pedido) as ReturnType<ApiAde["limites"]["historico"]>,
    previsao: (contaId) => ipcRenderer.invoke("limites:previsao", { conta_id: contaId }) as ReturnType<ApiAde["limites"]["previsao"]>,
    eficiencia: (semanas, contaId) => ipcRenderer.invoke("limites:eficiencia", { conta_id: contaId, semanas }) as ReturnType<ApiAde["limites"]["eficiencia"]>,
    alertas: () => ipcRenderer.invoke("limites:alertas", {}) as ReturnType<ApiAde["limites"]["alertas"]>,
    assinar: (cb) => assinar<CanaisEvento["limites:evento"]>("limites:evento", cb),
  },
  harness: {
    lerConfig: (workspaceId) => ipcRenderer.invoke("harness:config_ler", { workspace_id: workspaceId }) as ReturnType<ApiAde["harness"]["lerConfig"]>,
    gravarConfig: (config) => ipcRenderer.invoke("harness:config_gravar", config) as ReturnType<ApiAde["harness"]["gravarConfig"]>,
    listarTaskTypes: () => ipcRenderer.invoke("harness:task_types_listar", {}) as ReturnType<ApiAde["harness"]["listarTaskTypes"]>,
    gravarTaskType: (tipo) => ipcRenderer.invoke("harness:task_types_gravar", tipo) as ReturnType<ApiAde["harness"]["gravarTaskType"]>,
    apagarTaskType: (slug) => ipcRenderer.invoke("harness:task_types_apagar", { slug }) as Promise<boolean>,
    listarPoliticas: (workspaceId) => ipcRenderer.invoke("harness:politica_listar", { workspace_id: workspaceId }) as ReturnType<ApiAde["harness"]["listarPoliticas"]>,
    gravarPolitica: (politica) => ipcRenderer.invoke("harness:politica_gravar", politica) as ReturnType<ApiAde["harness"]["gravarPolitica"]>,
    restaurarSemente: (workspaceId, taskType) => ipcRenderer.invoke("harness:politica_restaurar_semente", { workspace_id: workspaceId, task_type: taskType }) as ReturnType<ApiAde["harness"]["restaurarSemente"]>,
    lerEquivalencia: () => ipcRenderer.invoke("harness:equivalencia_ler", {}) as ReturnType<ApiAde["harness"]["lerEquivalencia"]>,
    gravarEquivalencia: (provedores) => ipcRenderer.invoke("harness:equivalencia_gravar", { provedores }) as ReturnType<ApiAde["harness"]["gravarEquivalencia"]>,
    restaurarEquivalencia: () => ipcRenderer.invoke("harness:equivalencia_restaurar", {}) as ReturnType<ApiAde["harness"]["restaurarEquivalencia"]>,
    recomendar: (workspaceId, descricao) => ipcRenderer.invoke("harness:recomendar", { workspace_id: workspaceId, descricao }) as ReturnType<ApiAde["harness"]["recomendar"]>,
    listarDecisoes: (pedido = {}) => ipcRenderer.invoke("harness:decisoes_listar", pedido) as ReturnType<ApiAde["harness"]["listarDecisoes"]>,
    listarContasConfig: () => ipcRenderer.invoke("harness:contas_config_listar", {}) as ReturnType<ApiAde["harness"]["listarContasConfig"]>,
    gravarContaConfig: (config) => ipcRenderer.invoke("harness:contas_config_gravar", config) as ReturnType<ApiAde["harness"]["gravarContaConfig"]>,
    listarTrocas: (pedido = {}) => ipcRenderer.invoke("harness:trocas_listar", pedido) as ReturnType<ApiAde["harness"]["listarTrocas"]>,
    decidirTroca: (trocaId, acao) => ipcRenderer.invoke("harness:troca_decidir", { troca_id: trocaId, acao }) as ReturnType<ApiAde["harness"]["decidirTroca"]>,
    moverPane: (paneId, contaAlvoId) => ipcRenderer.invoke("harness:mover_pane", { pane_id: paneId, conta_alvo_id: contaAlvoId }) as ReturnType<ApiAde["harness"]["moverPane"]>,
    lerDecisor: () => ipcRenderer.invoke("harness:decisor_ler", {}) as ReturnType<ApiAde["harness"]["lerDecisor"]>,
    gravarDecisor: (config) => ipcRenderer.invoke("harness:decisor_gravar", config) as ReturnType<ApiAde["harness"]["gravarDecisor"]>,
    testarDecisor: (chave) => ipcRenderer.invoke("harness:decisor_testar", { chave }) as ReturnType<ApiAde["harness"]["testarDecisor"]>,
    classificarIntencao: (texto, contexto) => ipcRenderer.invoke("harness:classificar_intencao", { texto, contexto }) as ReturnType<ApiAde["harness"]["classificarIntencao"]>,
    resolverPerfil: (pedido) => ipcRenderer.invoke("harness:resolver_perfil", pedido) as ReturnType<ApiAde["harness"]["resolverPerfil"]>,
    assinar: (cb) => assinar<CanaisEvento["harness:evento"]>("harness:evento", cb),
  },
  openrouter: {
    estado: () => ipcRenderer.invoke("provedores:openrouter_estado", {}) as ReturnType<ApiAde["openrouter"]["estado"]>,
    consentir: (versaoTexto) => ipcRenderer.invoke("provedores:openrouter_consentir", { consentimento: true, versao_texto: versaoTexto }) as ReturnType<ApiAde["openrouter"]["consentir"]>,
    revogar: () => ipcRenderer.invoke("provedores:openrouter_revogar", {}) as ReturnType<ApiAde["openrouter"]["revogar"]>,
    gravarChave: (rotulo, chave, contaId) => ipcRenderer.invoke("provedores:openrouter_chave_gravar", { conta_id: contaId, rotulo, chave }) as ReturnType<ApiAde["openrouter"]["gravarChave"]>,
    apagarChave: (contaId) => ipcRenderer.invoke("provedores:openrouter_chave_apagar", { conta_id: contaId }) as Promise<boolean>,
    testar: (pedido) => ipcRenderer.invoke("provedores:openrouter_testar", pedido) as ReturnType<ApiAde["openrouter"]["testar"]>,
    atualizarModelos: (contaId) => ipcRenderer.invoke("provedores:openrouter_modelos_atualizar", { conta_id: contaId }) as ReturnType<ApiAde["openrouter"]["atualizarModelos"]>,
    listarModelos: (pedido = {}) => ipcRenderer.invoke("provedores:openrouter_modelos_listar", pedido) as ReturnType<ApiAde["openrouter"]["listarModelos"]>,
    gravarModelo: (pedido) => ipcRenderer.invoke("provedores:openrouter_modelo_gravar", pedido) as ReturnType<ApiAde["openrouter"]["gravarModelo"]>,
    atualizarSaldo: (contaId) => ipcRenderer.invoke("provedores:openrouter_saldo_atualizar", { conta_id: contaId }) as ReturnType<ApiAde["openrouter"]["atualizarSaldo"]>,
  },
  cofre: {
    disponivel: () => ipcRenderer.invoke("cofre:disponivel", {}) as ReturnType<ApiAde["cofre"]["disponivel"]>,
    listar: () => ipcRenderer.invoke("cofre:listar", {}) as ReturnType<ApiAde["cofre"]["listar"]>,
    gravar: (pedido) => ipcRenderer.invoke("cofre:gravar", pedido) as ReturnType<ApiAde["cofre"]["gravar"]>,
    apagar: (id) => ipcRenderer.invoke("cofre:apagar", { id }) as Promise<boolean>,
    definirSenhaMestra: (senha) => ipcRenderer.invoke("cofre:senha_mestra_definir", { senha }) as ReturnType<ApiAde["cofre"]["definirSenhaMestra"]>,
    desbloquear: (senha) => ipcRenderer.invoke("cofre:desbloquear", { senha }) as ReturnType<ApiAde["cofre"]["desbloquear"]>,
    bloquear: () => ipcRenderer.invoke("cofre:bloquear", {}) as ReturnType<ApiAde["cofre"]["bloquear"]>,
  },
  squads: {
    listar: (pedido = {}) => ipcRenderer.invoke("squads:listar", pedido) as ReturnType<ApiAde["squads"]["listar"]>,
    obter: (slug) => ipcRenderer.invoke("squads:obter", { slug }) as ReturnType<ApiAde["squads"]["obter"]>,
    gravar: (pedido) => ipcRenderer.invoke("squads:gravar", pedido) as ReturnType<ApiAde["squads"]["gravar"]>,
    validar: (squad, workspaceId = null) => ipcRenderer.invoke("squads:validar", { squad, workspace_id: workspaceId }) as ReturnType<ApiAde["squads"]["validar"]>,
    duplicar: (pedido) => ipcRenderer.invoke("squads:duplicar", pedido) as ReturnType<ApiAde["squads"]["duplicar"]>,
    apagar: (slug, confirmarSlug) => ipcRenderer.invoke("squads:apagar", { slug, confirmar_slug: confirmarSlug }) as ReturnType<ApiAde["squads"]["apagar"]>,
    fabricaAtualizacao: (slug) => ipcRenderer.invoke("squads:fabrica_atualizacao", { slug }) as ReturnType<ApiAde["squads"]["fabricaAtualizacao"]>,
    fabricaAplicar: (slug, membros) => ipcRenderer.invoke("squads:fabrica_aplicar", { slug, membros }) as ReturnType<ApiAde["squads"]["fabricaAplicar"]>,
    preflight: (slug, workspaceId) => ipcRenderer.invoke("squads:preflight", { slug, workspace_id: workspaceId }) as ReturnType<ApiAde["squads"]["preflight"]>,
    enviarPrompt: (pedido) => ipcRenderer.invoke("squads:enviar_prompt", pedido) as ReturnType<ApiAde["squads"]["enviarPrompt"]>,
    listarExecucoes: (pedido) => ipcRenderer.invoke("squads:execucoes_listar", pedido) as ReturnType<ApiAde["squads"]["listarExecucoes"]>,
    exportar: (pedido) => ipcRenderer.invoke("squads:exportar", pedido) as ReturnType<ApiAde["squads"]["exportar"]>,
    importarPrevia: (pedido) => ipcRenderer.invoke("squads:importar_previa", pedido) as ReturnType<ApiAde["squads"]["importarPrevia"]>,
    importarConfirmar: (previaId, slug) => ipcRenderer.invoke("squads:importar_confirmar", slug === undefined ? { previa_id: previaId } : { previa_id: previaId, slug }) as ReturnType<ApiAde["squads"]["importarConfirmar"]>,
    assinar: (cb) => assinar<CanaisEvento["squads:evento"]>("squads:evento", cb),
  },
  agentes: {
    listar: (squad) => ipcRenderer.invoke("agentes:listar", squad === undefined ? {} : { squad }) as ReturnType<ApiAde["agentes"]["listar"]>,
    lerPrompt: (agentId) => ipcRenderer.invoke("agentes:prompt_ler", { agent_id: agentId }) as ReturnType<ApiAde["agentes"]["lerPrompt"]>,
    gravarPrompt: (pedido) => ipcRenderer.invoke("agentes:prompt_gravar", pedido) as ReturnType<ApiAde["agentes"]["gravarPrompt"]>,
    previaPrompt: (pedido) => ipcRenderer.invoke("agentes:prompt_previa", pedido) as ReturnType<ApiAde["agentes"]["previaPrompt"]>,
    restaurarPrompt: (agentId) => ipcRenderer.invoke("agentes:prompt_restaurar", { agent_id: agentId }) as ReturnType<ApiAde["agentes"]["restaurarPrompt"]>,
    opcoesDePerfil: (cli) => ipcRenderer.invoke("agentes:perfil_opcoes", { cli }) as ReturnType<ApiAde["agentes"]["opcoesDePerfil"]>,
    abrirPane: (pedido) => ipcRenderer.invoke("agentes:abrir_pane", pedido) as ReturnType<ApiAde["agentes"]["abrirPane"]>,
  },
};

contextBridge.exposeInMainWorld("ade", api);
