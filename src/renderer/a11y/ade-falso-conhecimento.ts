// `window.ade.conhecimento`, `.chat` e `.rag` falsos e populados (só teste): usados pelas varreduras e pelos testes das telas da Fase 15.
import type { Aprendizado, EstadoConhecimento, FonteResultado, NoGrafo } from "../../compartilhado/conhecimento";
import type { ApiConhecimento, ConfigConhecimentoDto, EstadoModelosEmbedding } from "../../compartilhado/conhecimento-api";
import type { ApiChat, ConversaChatDto, EventoChat, MensagemChatDto, PerfilChatEstado, PlanoChatDto } from "../../compartilhado/chat";
import type { ApiRag, EstadoBackendRag, EventoRag, PreviaMigracao, ProvedorRagDto } from "../../compartilhado/rag";

export const ESTADO_CONHECIMENTO: EstadoConhecimento = {
  ativo: true, chunks: 340, documentos: 42, aprendizados: { candidato: 2, ativo: 5, arquivado: 1, rejeitado: 0 }, modelo: "hash-256", dimensao: 256,
  vetor_backend: "exato", fts5: true, tamanho_bytes: 2_621_440, indexando: { pendentes: 0, fase: null, pct: null }, reembutindo_pct: null, cobertura_consulta_7d_pct: 82, backend: "local",
};
export const ESTADO_VAZIO: EstadoConhecimento = { ...ESTADO_CONHECIMENTO, chunks: 0, documentos: 0, aprendizados: { candidato: 0, ativo: 0, arquivado: 0, rejeitado: 0 } };
export const CONFIG_CONHECIMENTO: ConfigConhecimentoDto = {
  workspace_id: "w1", ativo: true, consulta_obrigatoria: "aviso", contexto_chars: 6000, hook_prompt: true, indexar_codigo: true, indexar_transcricoes: true,
  aprendizado_modo: "deterministico", retencao_transcricao_dias: 90, chat_execucao: "reversiveis",
};

export const no = (id: string, tipo: string, extra: Partial<NoGrafo> = {}): NoGrafo => ({ id, tipo, rotulo: `${tipo} ${id}`, peso: 2, x: null, y: null, ultimo_em: "2026-10-01T10:00:00Z", mission_id: null, ...extra });
export const NOS: NoGrafo[] = [
  no("n1", "arquivo", { rotulo: "src/login.ts", peso: 8 }), no("n2", "task", { rotulo: "T-01.02 Criar rota", mission_id: "m1" }), no("n3", "commit", { rotulo: "commit abc123" }),
  no("n4", "decisao", { rotulo: "Usar cookie httpOnly", peso: 5 }), no("n5", "missao", { rotulo: "Login", mission_id: "m1", peso: 6 }), no("n6", "aprendizado", { rotulo: "Sessão expira em 8h" }),
];
export const ARESTAS = [
  { origem: "n2", destino: "n1", tipo: "toca", peso: 1 }, { origem: "n3", destino: "n1", tipo: "toca", peso: 1 }, { origem: "n4", destino: "n2", tipo: "citou", peso: 1 },
  { origem: "n5", destino: "n2", tipo: "pertence", peso: 1 }, { origem: "n6", destino: "n4", tipo: "produziu", peso: 1 },
];
export const fonte = (id: string, extra: Partial<FonteResultado> = {}): FonteResultado => ({ documento_id: id, tipo: "doc", titulo: `Documento ${id}`, origem: `docs/${id}.md`, mission_id: null, task_ref: null, pane_id: null, ocorrido_em: "2026-10-01T10:00:00Z", ...extra });
export const FONTES: FonteResultado[] = [fonte("d1"), fonte("d2", { tipo: "commit", origem: "commit:abc123" }), fonte("d3", { tipo: "decisao", mission_id: "m1", task_ref: "T-01.02" })];
export const aprendizado = (id: string, extra: Partial<Aprendizado> = {}): Aprendizado => ({ id, tipo: "decisao", titulo: `Aprendizado ${id}`, texto: `Texto ${id}`, fonte: "sistema", estado: "candidato", confianca: 0.7, vezes_visto: 2, util: 1, inutil: 0, errado: 0, criado_em: "2026-10-01T10:00:00Z", ...extra });
export const APRENDIZADOS: Aprendizado[] = [aprendizado("a1"), aprendizado("a2", { estado: "ativo", tipo: "armadilha" }), aprendizado("a3", { estado: "arquivado", tipo: "fato" })];
export const MODELOS: EstadoModelosEmbedding = {
  ativo: "hash-256", ollama_url: "http://127.0.0.1:11434",
  modelos: [
    { id: "hash-256", rotulo: "Hash local (piso)", dimensao: 256, origem: "hash", disponivel: true, motivo: null },
    { id: "ollama:nomic-embed-text", rotulo: "Ollama · nomic-embed-text", dimensao: 768, origem: "ollama", disponivel: true, motivo: null },
    { id: "onnx:minilm", rotulo: "ONNX · MiniLM", dimensao: 384, origem: "onnx", disponivel: false, motivo: "modelo não baixado" },
  ],
};

export function conhecimentoFalso(sobre: Partial<ApiConhecimento> = {}): ApiConhecimento {
  const ouvintes = new Set<(e: never) => void>();
  const api: ApiConhecimento = {
    estado: async () => ESTADO_CONHECIMENTO,
    lerConfig: async () => CONFIG_CONHECIMENTO,
    gravarConfig: async (p) => ({ ...CONFIG_CONHECIMENTO, ...p }),
    buscar: async (p) => ({ resultados: [{ chunk_id: "c1", escore: 0.91, trecho: `Trecho sobre ${p.consulta}: <b>não é HTML</b>`, fonte: FONTES[0] as FonteResultado, aprendizado_id: null, braco: "ambos" }], estado: "ok", consulta_id: "q1", latencia_ms: 12, modelo: "hash-256", aviso: null }),
    contextoPrevia: async () => ({ markdown: "<conhecimento_previo tipo=\"dados\">\n- [doc] <script>alert(1)</script> trecho\n</conhecimento_previo>", sinais: { ja_existe: true, houve_correcao: false, decisoes_relacionadas: 1, fontes: FONTES }, estado: "ok", consulta_id: "q2", latencia_ms: 9 }),
    listarDocumentos: async () => ({ itens: FONTES, proximo: null }),
    detalheDocumento: async () => null,
    reindexar: async () => ({ enfileirado: true }),
    esquecer: async () => ({ removidos: 3 }),
    purgar: async () => ({ removidos: 340 }),
    importarHistorico: async () => ({ enfileirado: true, sessoes: 4 }),
    exportar: async () => ({ caminho_salvo: null }),
    subgrafo: async () => ({ nos: NOS, arestas: ARESTAS, truncado: false }),
    detalheNo: async (_w, id) => {
      const n = NOS.find((x) => x.id === id);
      return n === undefined ? null : { no: n, vizinhos: NOS.filter((x) => x.id !== id).slice(0, 2), fontes: [FONTES[0] as FonteResultado], aprendizados: [{ id: "a1", titulo: "Aprendizado a1", tipo: "decisao", estado: "ativo" }] };
    },
    gravarPosicoes: async () => ({ ok: true }),
    listarAprendizados: async (p) => ({ itens: APRENDIZADOS.filter((a) => (p.estado === null || a.estado === p.estado) && (p.tipo === null || a.tipo === p.tipo)), proximo: null }),
    atualizarAprendizado: async (p) => ({ ...(APRENDIZADOS.find((a) => a.id === p.id) ?? aprendizado(p.id)), estado: p.acao === "ativar" ? "ativo" : p.acao === "arquivar" ? "arquivado" : p.acao === "rejeitar" ? "rejeitado" : "ativo", ...(p.texto !== undefined ? { texto: p.texto } : {}) }),
    feedback: async () => ({ ok: true }),
    destilarMissao: async () => ({ aprendizados: 2 }),
    modelos: async () => MODELOS,
    definirModelo: async (_w, id) => ({ ...MODELOS, ativo: id }),
    assinar: (cb) => { ouvintes.add(cb as never); return () => void ouvintes.delete(cb as never); },
    ...sobre,
  };
  return api;
}

// ---- chat ---------------------------------------------------------------------------------------------------------------

export const CONVERSA: ConversaChatDto = { id: "cv1", workspace_id: "w1", titulo: "Login", modo: "perguntar", perfil: null, mission_alvo_id: null, indexar: false, criado_em: "2026-10-01T10:00:00Z", atualizado_em: "2026-10-01T10:05:00Z" };
export const PERFIL_CHAT: PerfilChatEstado = {
  perfil: { cli: "claude", modelo: null, esforco: null, faixa: "medio" },
  clis: [{ cli: "claude", disponivel: true, motivo: null }, { cli: "codex", disponivel: false, motivo: "não instalada" }, { cli: "opencode", disponivel: true, motivo: null }, { cli: "gemini", disponivel: false, motivo: "sem login" }],
};
export const PLANO: PlanoChatDto = {
  id: "pl1", conversa_id: "cv1", intencao: "feature", resumo: "Implementar X com TDD", passos: [{ tipo: "criar_missao", titulo: "Implementar X" }, { tipo: "abrir_pane", titulo: "Executor", perfil: { cli: "claude", modelo: null, esforco: null, faixa: "medio" } }, { tipo: "disparar_metodo", comando: "/expx:sprintx", argumento: "X" }],
  prompt: "Implemente X seguindo o contrato existente.", criterios_aceite: ["Testes passam"], arquivos_provaveis: ["src/x.ts"], acoes_humanas: ["Aprovar o merge"], avisos: [],
  mission_alvo_id: null, mission_id: null, pane_ids: [], estado: "proposto", exige_aprovacao: true,
};
export const mensagem = (id: string, extra: Partial<MensagemChatDto> = {}): MensagemChatDto => ({ id, conversa_id: "cv1", papel: "assistente", texto: "", citacoes: [], plano_id: null, estado: "completa", criado_em: `2026-10-01T10:00:${String(Number(id.replace(/\D/g, "") || 0) % 60).padStart(2, "0")}Z`, ...extra });
export const MENSAGENS: MensagemChatDto[] = [
  mensagem("m1", { papel: "usuario", texto: "O login já existe?" }),
  mensagem("m2", { texto: "Sim, a rota foi criada [1]. Veja também [2].", citacoes: [
    { n: 1, documento_id: "d1", titulo: "Relatório T-01.02", origem: "docs/relatorio.md", tipo: "relatorio", ocorrido_em: "2026-09-30T10:00:00Z" },
    { n: 2, documento_id: "d2", titulo: "commit abc123", origem: "commit:abc123", tipo: "commit", ocorrido_em: "2026-09-30T11:00:00Z" },
  ] }),
];

export type ChatFalso = ApiChat & { emitir(e: EventoChat): void };
export function chatFalso(sobre: Partial<ApiChat> = {}): ChatFalso {
  const ouvintes = new Set<(e: EventoChat) => void>();
  const emitir = (e: EventoChat): void => ouvintes.forEach((o) => o(e));
  const api: ChatFalso = {
    listarConversas: async () => [CONVERSA],
    criarConversa: async (p) => ({ ...CONVERSA, id: "cv-novo", modo: p.modo, titulo: p.titulo ?? "Nova conversa" }),
    lerConversa: async (id) => (id === CONVERSA.id ? { conversa: CONVERSA, mensagens: MENSAGENS, planos: [] } : { conversa: { ...CONVERSA, id }, mensagens: [], planos: [] }),
    apagarConversa: async () => ({ ok: true }),
    lerPerfil: async () => PERFIL_CHAT,
    gravarPerfil: async (p) => ({ ...PERFIL_CHAT, perfil: { cli: p.cli, modelo: p.modelo, esforco: p.esforco, faixa: p.faixa } }),
    enviar: async (p) => {
      const id = "m-resp";
      queueMicrotask(() => {
        if (p.modo === "orquestrar") {
          emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem(id, { conversa_id: p.conversa_id, texto: "Montei um plano para isso.", plano_id: PLANO.id }) } });
          emitir({ canal: "chat:plano", payload: { plano: { ...PLANO, conversa_id: p.conversa_id } } });
        } else {
          emitir({ canal: "chat:mensagem", payload: { mensagem: mensagem(id, { conversa_id: p.conversa_id, texto: "Resposta [1]", citacoes: [{ n: 1, documento_id: "d1", titulo: "Doc", origem: "docs/d.md", tipo: "doc", ocorrido_em: "2026-10-01T10:00:00Z" }] }) } });
        }
      });
      return { mensagem_id: id };
    },
    parar: async () => ({ ok: true }),
    decidirPlano: async (p) => ({ ...PLANO, estado: p.decisao === "cancelar" ? "cancelado" : "aprovado" }),
    pararPlano: async () => ({ ok: true }),
    assinar: (cb) => { ouvintes.add(cb); return () => void ouvintes.delete(cb); },
    emitir,
    ...sobre,
  };
  return api;
}

// ---- backend online -----------------------------------------------------------------------------------------------------

export const SCRIPT_SUPABASE = "create extension if not exists vector;\ncreate table conhecimento_chunks (id uuid primary key, embedding vector(256));";
export const PROVEDORES: ProvedorRagDto[] = [
  { id: "qdrant", nome: "Qdrant", campos: [{ chave: "api_key", rotulo: "Chave da API", secreto: true, obrigatorio: false, dica: "opcional em instâncias locais" }], capacidades: { hibrido: true, filtroNativo: true, dimensaoMaxima: null, loteMaximo: 256, consistenciaEventual: false }, script_preparacao: null },
  { id: "supabase", nome: "Supabase (pgvector)", campos: [{ chave: "service_key", rotulo: "Chave de serviço", secreto: true, obrigatorio: true, dica: "role service_role" }, { chave: "schema", rotulo: "Schema", secreto: false, obrigatorio: false, dica: null }], capacidades: { hibrido: true, filtroNativo: true, dimensaoMaxima: 2000, loteMaximo: 100, consistenciaEventual: false }, script_preparacao: SCRIPT_SUPABASE },
];
export const BACKEND_LOCAL: EstadoBackendRag = { provedor: null, url: null, host: null, colecao_remota: null, modo: "local", tipos: [], equipe_id: null, autor: null, projeto_id: null, segredos: {}, consentimento: null, offline: false, ultima_sincronizacao: null, pendentes_envio: 0, migracao_ativa: null };
export const PREVIA: PreviaMigracao = {
  previa_id: "pv1", por_tipo: { doc: { itens: 30, bytes: 40_000 }, decisao: { itens: 8, bytes: 3_000 }, codigo: { itens: 120, bytes: 900_000 } }, total: 158,
  amostra: [{ tipo: "doc", origem: "docs/a.md", trecho: "Chave: [REDACTED] usada no login" }], avisos: ["Código-fonte sai da máquina se o tipo for marcado."], estimativa_reembutir: 158,
  destino: { provedor: "qdrant", host: "qdrant.exemplo.com", colecao: "conhecimento_projeto", versao_politica: 1 },
};

export type RagFalso = ApiRag & { emitir(e: EventoRag): void };
export function ragFalso(sobre: Partial<ApiRag> = {}): RagFalso {
  const ouvintes = new Set<(e: EventoRag) => void>();
  const api: RagFalso = {
    estado: async () => BACKEND_LOCAL,
    provedores: async () => PROVEDORES,
    configurar: async (p) => ({ ok: true, mascarado: Object.fromEntries(Object.keys(p.campos_secretos).map((k) => [k, "••••1234"])) }),
    testar: async () => ({ ok: true, versao: "1.9", dimensao_remota: 256 }),
    esquecerSegredo: async () => ({ ok: true }),
    previaMigracao: async () => PREVIA,
    iniciarMigracao: async () => ({ migracao_id: "mg1" }),
    pausarMigracao: async () => ({ ok: true }),
    retomarMigracao: async () => ({ ok: true }),
    cancelarMigracao: async () => ({ ok: true }),
    verificarMigracao: async () => ({ ok: true, local: 158, remoto: 158, amostrados: 20, divergentes: 0 }),
    voltarParaLocal: async () => ({ ok: true }),
    sincronizar: async () => ({ enviados: 1, recebidos: 2 }),
    apagarRemoto: async () => ({ apagados: 158 }),
    assinar: (cb) => { ouvintes.add(cb); return () => void ouvintes.delete(cb); },
    emitir: (e) => ouvintes.forEach((o) => o(e)),
    ...sobre,
  };
  return api;
}
