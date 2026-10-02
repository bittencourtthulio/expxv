// Dados e API falsa dos Relatórios (só teste). Nenhum dado real; a API registra chamadas por `vi.fn` no teste.
import type { ApiRelatorios, ArquivoPacote, ConfigRelatorios, EnvioDivulgacao, EstadoCanalDivulgacao, PacoteDetalhe, SprintCandidata } from "../../../compartilhado/relatorios";

export const WS = "ws_0000000000AAAA";
export const SPRINT = "spr_0000000000AAAA";
export const PACOTE = "rel_0000000000AAAA";

export const CONFIG_PADRAO: ConfigRelatorios = { gerar_ao_fechar: true, redacao_modo: "template", consentimento_llm_em: null, csv_bom: true, consentimento_canais: {}, hashtags: [], cta: null };
const arq = (nome: string, formato: ArquivoPacote["formato"], publico: ArquivoPacote["publico"]): ArquivoPacote => ({ nome, formato, publico, sha256: "a".repeat(64), bytes: 1200, revisao: publico === "cliente" ? "rascunho" : "na" });

export function detalheFalso(extra: Partial<PacoteDetalhe> = {}): PacoteDetalhe {
  return {
    id: PACOTE, workspace_id: WS, sprint_id: SPRINT, titulo: "Sprint 12 — r1", versao: 1, versao_lancamento: "2.4.0", estado: "pronto", etapa: null, modo_redacao: "template", revisao_usuario: "rascunho", aprovado_em: null,
    avisos_qtd: 1, bytes: 43000, gerado_em: "2026-03-14T12:00:00.000Z", pasta_ref: `pasta/relatorios/${SPRINT}/r1`,
    arquivos: [arq("tecnico.html", "html", "interno"), arq("tecnico.md", "md", "interno"), arq("usuario.html", "html", "cliente"), arq("usuario.md", "md", "cliente"), arq("tasks.csv", "csv", "interno"), arq("divulgacao/resumo-redes.txt", "txt", "cliente")],
    avisos: ["Custo desconhecido: o consumo desta sprint não foi medido."], verificacao: { ok: true, afirmacoes_total: 10, com_fonte: 10, violacoes: [] }, metricas: { pontos_entregues: 8 }, motivo_falha: null,
    blocos_usuario: [
      { id: "u_em_resumo", titulo: "Em resumo", texto: "Nesta etapa entregamos 1 novidade.", origem: "template", precisa_revisao: false, ajustado: false },
      { id: "u_correcoes", titulo: "Correções", texto: "Melhoria na plataforma.", origem: "template", precisa_revisao: true, ajustado: false },
    ],
    ...extra,
  };
}

export const SPRINTS: SprintCandidata[] = [{ id: SPRINT, nome: "Sprint 12", fechada_em: "2026-03-13T18:00:00.000Z", versao_lancamento: "2.4.0", pacote_atual: { id: PACOTE, versao: 1, estado: "pronto" } }, { id: "spr_0000000000BBBB", nome: "Sprint 13", fechada_em: null, versao_lancamento: null, pacote_atual: null }];
export const REDES = "== curta (60 caracteres) ==\nNovidades da versão 2.4.0: login com conta da empresa.\n\n== media (70 caracteres) ==\nNovidades da versão 2.4.0:\n• Login com conta da empresa.\n\n== longa (70 caracteres) ==\nNovidades da versão 2.4.0:\n• Login com conta da empresa.\n";
export const CANAL_OFF: EstadoCanalDivulgacao = { canal: "telegram", disponivel: false, consentido: false, motivo: "Canal ainda não configurado neste app." };

export interface OpcoesApi { pacote?: PacoteDetalhe; sprints?: SprintCandidata[]; config?: ConfigRelatorios; canais?: EstadoCanalDivulgacao[]; fila?: EnvioDivulgacao[]; previa?: string; vazio?: boolean }

export function apiFalsa(o: OpcoesApi = {}): ApiRelatorios {
  const pacote = o.pacote ?? detalheFalso();
  let canais = o.canais ?? [CANAL_OFF];
  let config = o.config ?? CONFIG_PADRAO;
  let fila = o.fila ?? [];
  return {
    configLer: async () => config,
    configGravar: async (_ws, c) => (config = { ...config, ...c }),
    consentimentoLlm: async (_ws, v) => (config = { ...config, consentimento_llm_em: v ? "2026-03-14T12:00:00.000Z" : null }),
    sprints: async () => (o.vazio ? [] : (o.sprints ?? SPRINTS)),
    listar: async () => (o.vazio ? [] : [pacote]),
    ler: async () => pacote,
    gerar: async () => ({ pacote_id: PACOTE, reaproveitado: false }),
    regenerar: async () => ({ pacote_id: PACOTE, reaproveitado: false }),
    previa: async (_ws, _id, nome) => (nome === "divulgacao/resumo-redes.txt" ? { conteudo: REDES, tipo: "texto", bytes: REDES.length, integro: true } : nome.endsWith(".html") ? { conteudo: o.previa ?? "<!doctype html><html><body><h1>Relatório</h1></body></html>", tipo: "html", bytes: 100, integro: true } : { conteudo: "a,b\r\n1,2\r\n", tipo: "texto", bytes: 10, integro: true }),
    ajusteGravar: async () => ({ ok: true }),
    aprovar: async (_ws, _id, aprovar) => ({ ...pacote, revisao_usuario: aprovar ? "aprovado" : "rascunho" }),
    exportar: async () => ({ cancelado: false, destino_rotulo: "Entregas/relatorio-x-r1", arquivos: ["tecnico.md"], bytes: 10 }),
    divulgacaoEstado: async () => canais,
    consentimentoCanal: async (_ws, canal, v) => (canais = canais.map((c) => (c.canal === canal ? { ...c, consentido: v } : c))),
    divulgacaoFila: async () => fila,
    divulgacaoEnfileirar: async (_ws, pid, canal, variante) => { const e: EnvioDivulgacao = { id: "env_0000000000AAAA", pacote_id: pid, workspace_id: WS, canal, variante, texto: "texto", estado: "rascunho", criado_em: "t", enviado_em: null, erro: null }; fila = [...fila, e]; return e; },
    divulgacaoAprovar: async (_ws, id, aprovar) => { fila = fila.map((e) => (e.id === id ? { ...e, estado: aprovar ? "aprovado" : "rascunho" } : e)); return fila.find((e) => e.id === id) as EnvioDivulgacao; },
    divulgacaoEnviar: async (_ws, id) => { fila = fila.map((e) => (e.id === id ? { ...e, estado: "enviado" } : e)); return fila.find((e) => e.id === id) as EnvioDivulgacao; },
    divulgacaoCancelar: async (_ws, id) => { fila = fila.map((e) => (e.id === id ? { ...e, estado: "cancelado" } : e)); return fila.find((e) => e.id === id) as EnvioDivulgacao; },
    assinar: () => () => undefined,
  };
}
