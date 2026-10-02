// Fábrica de dados e API falsa para os testes da tela Mapa. Só para teste.
import { CONFIG_MAPA_PADRAO, type ApiMapa, type DadosAnaliseMapa, type EventoMapaIpc, type FluxoMapaIpc, type GrafoMapaIpc, type NoDetalheMapa, type PerfilProvisorioMapa, type RaioMapaIpc, type ResumoMapaIpc, type TipoAnaliseMapa } from "../../../compartilhado/mapa";

export const WS = "ws_abcdefghij";

export function resumoFalso(p: Partial<ResumoMapaIpc> = {}): ResumoMapaIpc {
  return {
    estado: "pronto", versao_mapa: 3, analisado_em: "2026-10-01T11:00:00Z", arquivos: 4812, nos: 20000, linguagens: [{ linguagem: "typescript", arquivos: 4000, loc: 300000 }, { linguagem: "python", arquivos: 812, loc: 40000 }],
    arestas: { exata: 9000, heuristica: 1000 }, historia: "ok", ferramentas: { ctags: false, scc: false, dot: false }, desatualizado: false, alterados_n: 0, degradadas: 0, analisando: false, progresso: null,
    configuracao: { ...CONFIG_MAPA_PADRAO }, aviso: null, pacote: { carimbo: null, caminho: null }, estimativa_arquivos: 4812, ...p,
  };
}

export function grafoFalso(p: Partial<GrafoMapaIpc> = {}): GrafoMapaIpc {
  return {
    nivel: "arquivo", versao_mapa: 3, truncado: false, total_nos: 4, total_arestas: 3,
    nos: [
      { id: "arq:src/a.ts", r: "a.ts", t: "arquivo", g: "src", w: 120, l: "typescript", p: 0.9 },
      { id: "arq:src/b.ts", r: "b.ts", t: "arquivo", g: "src", w: 80, l: "typescript", c: 1 },
      { id: "arq:src/c.ts", r: "c.ts", t: "arquivo", g: "src", w: 60, l: "typescript", c: 1 },
      { id: "arq:lib/d.py", r: "d.py", t: "arquivo", g: "lib", w: 30, l: "python" },
    ],
    arestas: [[0, 1, "importa", 1, 1], [1, 2, "importa", 1, 1], [2, 1, "importa", 0, 1]], ...p,
  };
}

export function detalheFalso(p: Partial<NoDetalheMapa> = {}): NoDetalheMapa {
  return {
    id: "arq:src/a.ts", tipo: "arquivo", subtipo: "typescript", rotulo: "a.ts", caminho: "src/a.ts", linha_ini: 1, linha_fim: 120, exportado: null, atributos: null,
    arquivo: { linguagem: "typescript", loc: 120, loc_codigo: 100, complexidade_max: 14, complexidade_total: 40, e_teste: false, e_gerado: false, degradado: false, modulo: "src", camada: 1, ciclo_id: null, pagerank: 0.9, churn_total: 30, churn_janela: 12, autores_n: 3, criado_git: "2024-01-01", ultima_alt: "2026-09-01", commits_correcao: 4, cobertura_estado: "ausente" },
    chamadores: [{ id: "arq:src/b.ts", rotulo: "b.ts", tipo: "arquivo", aresta: "importa", confianca: "exata", peso: 1, evidencia: "src/b.ts:3" }], chamados: [], chamadores_total: 1, chamados_total: 0, ...p,
  };
}

export function raioFalso(p: Partial<RaioMapaIpc> = {}): RaioMapaIpc {
  return {
    arquivos: ["src/a.ts"], faixa: "MEDIO", faixa_pior_caso: "ALTO", pior_caso: [{ sinal: 8, motivo: "dado histórico não coletável" }], candidatos_costura: [], chamadores: ["src/b.ts"], alcance_transitivo: 2,
    nota: "provisório — quem classifica é o avaliador-de-raio do legadox; aprovação ALTO é humana",
    sinais: [{ id: 1, nome: "Chamadores", min: 1, max: 2, valor: "1 a 2 arquivos", metodo: "grafo de chamadas Tree-sitter v1", pior_caso: false }], ...p,
  };
}

export function fluxoFalso(): FluxoMapaIpc {
  const n = (id: string, nivel: number, tipo: "entrada" | "simbolo" | "tabela", extra: Record<string, unknown> = {}) => ({ id, rotulo: id.split("#").pop() ?? id, tipo, nivel, tracejado: false, externo: false, em_ciclo: false, tabelas: [], caminho: "src/a.ts", linha: 1, ...extra });
  return {
    raiz: "ent:src/a.ts#GET /users", tabelas: ["usuarios"], externos: [], truncado: false,
    nos: [n("ent:src/a.ts#GET /users", 0, "entrada"), n("sim:src/a.ts#listar", 1, "simbolo"), n("sim:src/b.ts#ler", 2, "simbolo", { tracejado: true }), n("tab:usuarios", 2, "tabela")],
    arestas: [["ent:src/a.ts#GET /users", "sim:src/a.ts#listar", "aciona", 1, 0], ["sim:src/a.ts#listar", "sim:src/b.ts#ler", "chama", 0, 0], ["sim:src/a.ts#listar", "tab:usuarios", "le_tabela", 1, 0]],
  };
}

export function perfilFalso(): PerfilProvisorioMapa {
  return {
    nota: "provisório: não é o PERFIL.md", gerado_em: "2026-10-01T11:00:00Z", stack: { ecossistemas: ["npm"], manifestos: ["package.json"], linguagens: [{ linguagem: "typescript", arquivos: 10, loc: 1000 }] },
    entradas_por_categoria: { rota: 3 }, camadas: { modulos: 4, violacoes: 1, ciclos: 1 }, comandos: [{ nome: "test", comando: "vitest run", fonte: "package.json", linha: 5 }],
    cobertura: { metodo: "estimada por convenção de nome", sem_teste: 2, total: 10 }, dialetos_conflitantes: [{ eixo: "erro", forca: "CONFLITO" }],
    zonas_candidatas: [{ categoria: "fiscal", pastas: ["src/fiscal"], quem_valida: "NÃO DETERMINADO" }], divida: { ciclos: 1, candidatos_mortos: 4, hotspots_quentes: 2 },
  };
}

export function analiseFalsa<T extends TipoAnaliseMapa>(tipo: T): DadosAnaliseMapa[T] {
  const d: DadosAnaliseMapa = {
    ciclos: { total: 1, ciclos: [{ id: 1, tamanho: 2, nos: ["arq:src/b.ts", "arq:src/c.ts"], quebrar: [{ de: "arq:src/c.ts", para: "arq:src/b.ts", peso: 1 }] }] },
    camadas: {
      modulos: [{ modulo: "src", camada: 1, camada_manual: null, ca: 1, ce: 1, instabilidade: 0.5, ciclo_id: null, arquivos: 3 }, { modulo: "lib", camada: 0, camada_manual: null, ca: 1, ce: 0, instabilidade: 0, ciclo_id: null, arquivos: 1 }],
      ciclos: [], violacoes: [{ origem: "regra", de_modulo: "lib", para_modulo: "src", evidencias: ["lib/d.py:3"], motivo: "lib não pode depender de src" }],
      dsm: { modulos: ["src", "lib"], celulas: [[0, 2], [1, 0]], truncado: false }, regras_importadas: 1,
    },
    hotspots: { disponivel: true, itens: [{ caminho: "src/a.ts", score: 0.8, faixa: "quente", churn_janela: 12, complexidade_max: 14, autores_n: 3, idade_dias: 400, commits_correcao: 4, parceiros: [] }] },
    mortos: { itens: [{ id: "sim:src/c.ts#velha", tipo: "simbolo", caminho: "src/c.ts", linha: 9, confianca: "media", motivos: ["sem chamadores exatos"] }], rotulo: "candidato a código morto (verificar antes de qualquer remoção)" },
    sem_teste: { itens: [{ caminho: "src/a.ts", estado: "ausente", fonte: "estimada" }], por_pasta: [{ pasta: "src", total: 3, sem_teste: 2 }] },
    externas: { itens: [{ id: "ext:npm:react", ecossistema: "npm", nome: "react", versao: "19.0.0", declarado: true, usado: true, dev: false, licenca: "MIT", selo: null }], aviso: "informativo" },
    duplicacao: { habilitada: false, clones: [] },
    dialetos: { eixos: [{ eixo: "erro", forca: "CONFLITO", destino: "conflito", variantes: [{ nome: "throw", n: 10, recente: false }, { nome: "Result", n: 6, recente: true }] }] },
    zonas: { zonas: [{ categoria: "fiscal", pastas: ["src/fiscal"], arquivos: [], tabelas: [], quem_valida: "NÃO DETERMINADO" }] },
    entradas: { itens: [{ id: "ent:src/a.ts#GET /users", subtipo: "rota", chave: "GET /users", framework: "express", caminho: "src/a.ts", linha: 4, confianca: "exata" }, { id: "ent:src/j.ts#cron:* * * * *", subtipo: "job", chave: "cron:* * * * *", framework: "node-cron", caminho: "src/j.ts", linha: 2, confianca: "heuristica" }], por_categoria: { rota: 1, job: 1 } },
    dados: { tabelas: [{ nome: "usuarios", definida_em: ["db/001.sql"], le_n: 2, escreve_n: 1, toques: [{ de: "sim:src/b.ts#ler", operacao: "le", confianca: "exata", evidencia: "src/b.ts:7" }] }] },
  };
  return d[tipo];
}

export interface OpcoesApi { resumo?: ResumoMapaIpc; grafo?: GrafoMapaIpc }
export type ApiMapaFalsa = ApiMapa & { emitir: (e: EventoMapaIpc) => void };

export function apiFalsa(o: OpcoesApi = {}): ApiMapaFalsa {
  let ouvinte: (e: EventoMapaIpc) => void = () => undefined;
  const api = {
    resumo: async () => o.resumo ?? resumoFalso(),
    analisar: async () => ({ execucao_id: 1 }),
    cancelar: async () => ({ ok: true as const }),
    apagar: async () => ({ ok: true as const }),
    grafo: async () => o.grafo ?? grafoFalso(),
    vizinhos: async (_w: string, id: string) => ({ origem: id, nos: [], arestas: [], truncado: false }),
    no: async () => detalheFalso(),
    fluxo: async () => fluxoFalso(),
    analise: async (_w: string, tipo: TipoAnaliseMapa) => ({ tipo, versao_mapa: 3, truncado: false, dados: analiseFalsa(tipo) }),
    raio: async () => raioFalso(),
    perfil: async () => perfilFalso(),
    buscar: async () => [{ id: "sim:src/a.ts#listar", rotulo: "listar", tipo: "simbolo" as const, subtipo: "funcao", caminho: "src/a.ts", linha: 10 }],
    exportar: async (_w: string, formato: string) => ({ caminho: "/tmp/x", formato: formato as never, bytes: 10 }),
    disparar: async () => ({ comando: "/expx:stackx-detectar mapa em .pasta-do-produto/mapa/20261001T120000Z/", carimbo: "20261001T120000Z", pacote: ".pasta-do-produto/mapa/20261001T120000Z" }),
    configLer: async () => ({ ...CONFIG_MAPA_PADRAO }),
    configGravar: async (_w: string, parcial: object) => ({ ...CONFIG_MAPA_PADRAO, ...parcial }),
    layoutLer: async () => null,
    layoutGravar: async () => ({ ok: true as const }),
    assinar: (cb: (e: EventoMapaIpc) => void) => { ouvinte = cb; return () => undefined; },
    emitir: (e: EventoMapaIpc) => ouvinte(e),
  };
  return api as unknown as ApiMapaFalsa;
}

export const PANE = { id: "pane_abcdefghij", rotulo: "Pane 1 · claude-code" };
