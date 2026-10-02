// `window.ade.memoria` falso e populado (só teste): reaproveitado pelas varreduras e pelos testes das telas da Fase 8.
import type { ApiMemoria, ConfigMemoria, EntradaMemoria, EstadoMemoriaApp, PedidoListarMemoria } from "../../compartilhado/memoria";

export const CONFIG_MEMORIA: ConfigMemoria = { workspace_id: "w1", ativa: true, solo: false, squad: true, orcamento_brief_chars: 6000, retencao_dias: 365, teto_mb: 512, pacote_workers: true, embedding_modelo: null, global_ativa: true };
export const ESTADO_MEMORIA: EstadoMemoriaApp = {
  config: CONFIG_MEMORIA, missoes: {}, contagens: { pane: 2, missao: 1, squad: 0, workspace: 1, usuario: 0 }, tamanho_bytes: 4096, aviso_teto: false, fts5: true,
  memox: { instalado: true, texto: "índice com 12 arquivos" }, metricas: { "entradas.ativas": 4, "memoria.dedupe": 2, "ciclo.fatias": 7, "restore.total": 1 },
};

export const entrada = (id: string, extra: Partial<EntradaMemoria> = {}): EntradaMemoria => ({
  id, escopo: "pane", anel: 1, tipo: "decisao", conteudo: `Decisão ${id}`, fonte: "agente", importancia: 3, redigido: false, estado: "ativa", mission_id: "m1", pane_id: "p1", squad_slug: null, display_id: 3,
  contagem: 1, criado_em: "2026-10-01T10:00:00.000Z", atualizado_em: "2026-10-01T10:00:00.000Z", ...extra,
});
export const ENTRADAS_MEMORIA: EntradaMemoria[] = [
  entrada("mem_1", { tipo: "checkpoint", conteudo: "Rota de login pronta; falta o teste de expiração." }),
  entrada("mem_2", { tipo: "risco", conteudo: "Token em API_KEY=[REDACTED] apareceu no log", redigido: true, importancia: 4 }),
  entrada("mem_3", { tipo: "decisao", conteudo: "Usar sessão por cookie httpOnly", importancia: 5 }),
  entrada("mem_4", { escopo: "workspace", anel: 2, tipo: "aprendizado", fonte: "sistema", conteudo: "<script>alert(1)</script> **negrito** aprendizado", pane_id: null, display_id: null }),
];
export const PREFERENCIAS_FALSAS: EntradaMemoria[] = [entrada("mem_pref1", { escopo: "usuario", anel: 3, tipo: "preferencia", fonte: "usuario", conteudo: "Responder em português do Brasil" })];

export function memoriaFalso(sobrescrever: Partial<ApiMemoria> = {}): ApiMemoria {
  const api: ApiMemoria = {
    estado: async () => ESTADO_MEMORIA,
    gravarConfig: async (p) => ({ ...CONFIG_MEMORIA, ...p } as ConfigMemoria),
    definirMissao: async (id, ativa) => ({ mission_id: id, ativa }),
    listar: async (p: PedidoListarMemoria) => ({ itens: ENTRADAS_MEMORIA.filter((e) => p.escopo === null || e.escopo === p.escopo), proximo: null }),
    atualizar: async (p) => ({ ...(ENTRADAS_MEMORIA.find((e) => e.id === p.entrada_id) ?? entrada(p.entrada_id)), ...(p.conteudo !== undefined ? { conteudo: p.conteudo, fonte: "usuario" as const } : {}), ...(p.importancia !== undefined ? { importancia: p.importancia } : {}) }),
    esquecer: async () => ({ ok: true }),
    esquecerPane: async () => ({ removidas: 2 }),
    purgar: async () => ({ removidas: 4 }),
    exportar: async () => ({ caminho_salvo: null }),
    briefPrevia: async () => ({ markdown: "<memoria_restaurada painel=\"#3\">\n- [decisão · agente · 2026-10-01] Usar cookie\n</memoria_restaurada>", caracteres: 90, truncado: false, modo: "missao" }),
    restaurar: async (paneId) => ({ pane_id: `${paneId}-novo`, sessao_id: "s2", modo: "brief", brief_injetado: true, truncado: false, ja_existia: false }),
    preferenciasListar: async () => PREFERENCIAS_FALSAS,
    preferenciasGravar: async (p) => entrada(p.id ?? "mem_novo", { escopo: "usuario", anel: 3, tipo: "preferencia", fonte: "usuario", conteudo: p.conteudo, importancia: p.importancia }),
    preferenciasRemover: async () => ({ ok: true }),
    assinar: () => () => undefined,
    ...sobrescrever,
  };
  return api;
}
