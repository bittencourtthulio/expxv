// Adaptador da porta do MCP (`PortaMapaMcp`, T-17.32) sobre o gerenciador do mapa. Só LEITURA: nomes, caminhos relativos e linhas;
// nenhuma linha de código-fonte. Agentes consultam sob demanda (callers/callees, raio, hotspots, camadas, ciclos…) em vez de ler
// arquivos. A porta só existe para workspaces com `mapa.habilitado` E opt-in `expor_agentes` (consentimento: nomes de símbolos
// e caminhos chegam ao modelo da CLI do Pane).
import type { ItemInventario } from "../nucleo/mapa/inventario";
import type { GerenciadorMapa } from "./mapa";
import type { FachadaMapa } from "../nucleo/mapa/fachada";
import { ErroConsulta } from "../nucleo/mapa/consultas";
import { ErroMcp } from "../nucleo/mcp/erros";
import type { FatoMapaMcp, ImpactoMapaMcp, ItemMapaMcp, PortaMapaMcp, StatusMapaMcp, TipoConsultaMapa, TopicoEvidenciaMapa } from "../nucleo/mcp/portas";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TipoArestaIpc } from "../compartilhado/mapa";

const USO: TipoArestaIpc[] = ["importa", "reexporta", "chama", "instancia", "herda", "implementa", "referencia", "aciona"];
const BANDA = { BAIXO: "LOW", MEDIO: "MEDIUM", ALTO: "HIGH" } as const;

function traduzir(e: unknown): never {
  if (e instanceof ErroMcp) throw e;
  if (e instanceof ErroConsulta) {
    if (e.codigo === "argumento_invalido") throw new ErroMcp("invalid_argument", e.message);
    if (e.codigo === "mapa_nao_pronto") throw new ErroMcp("unavailable", "O mapa do código ainda não foi analisado.", "map_not_ready");
    throw new ErroMcp("not_found", e.message);
  }
  throw new ErroMcp("unavailable", "O mapa do código não respondeu.", "map_not_ready");
}

/** `src/a.ts` -> `arq:src/a.ts`; `src/a.ts#f` -> `sim:src/a.ts#f`; ids já prefixados passam. */
function noDe(alvo: string): string {
  if (/^(arq|sim|ent|mod|tab|ext):/.test(alvo)) return alvo;
  return alvo.includes("#") ? `sim:${alvo}` : `arq:${alvo}`;
}

function caminhoDe(id: string): string | null {
  if (id.startsWith("arq:")) return id.slice(4);
  if (id.startsWith("sim:") || id.startsWith("ent:")) {
    const r = id.slice(4);
    const i = r.indexOf("#");
    return i < 0 ? r : r.slice(0, i);
  }
  return null;
}

const confianca = (c: "exata" | "heuristica" | null | undefined): "exact" | "heuristic" | null => (c === "exata" ? "exact" : c === "heuristica" ? "heuristic" : null);
const tipoNo = (t: string): string => ({ arquivo: "file", modulo: "module", simbolo: "symbol", entrada: "entrypoint", tabela: "table", externo: "external" } as Record<string, string>)[t] ?? t;

export interface DepsPortaMapaMcp {
  gerenciador: GerenciadorMapa;
  /** `<userData>/mapas/<ws>/mapa.db` existe? (evita criar banco só porque um agente perguntou). */
  existeBanco: (workspaceId: string) => boolean;
}

export function criarPortaMapaMcp(d: DepsPortaMapaMcp): PortaMapaMcp {
  async function fachada(ws: string): Promise<FachadaMapa> {
    try {
      return await d.gerenciador.fachada(ws);
    } catch (e) {
      return traduzir(e);
    }
  }
  async function habilitada(ws: string): Promise<FachadaMapa | null> {
    if (!d.existeBanco(ws)) return null;
    const f = await fachada(ws);
    const cfg = f.configLer();
    return cfg.habilitado && cfg.expor_agentes ? f : null;
  }
  const exigir = async (ws: string): Promise<FachadaMapa> => {
    const f = await habilitada(ws);
    if (f === null) throw new ErroMcp("unavailable", "O mapa do código está desligado, vazio ou não foi exposto a agentes neste workspace.", "map_not_ready");
    return f;
  };

  return {
    async disponivel(ws) {
      try {
        return (await habilitada(ws)) !== null;
      } catch {
        return false;
      }
    },

    async status(ws): Promise<StatusMapaMcp> {
      const f = await exigir(ws);
      const r = f.resumo();
      return {
        state: r.estado === "vazio" ? "empty" : r.estado === "parcial" ? "partial" : "ready",
        generated_at: r.analisado_em,
        files: r.arquivos,
        languages: r.linguagens.map((l) => ({ language: l.linguagem, files: l.arquivos, loc: l.loc })),
        edges: { exact: r.arestas.exata, heuristic: r.arestas.heuristica },
        stale: r.desatualizado,
        history: r.historia === "ok" ? "ok" : r.historia === "parcial" ? "partial" : "unavailable",
      };
    },

    async query(ws, a) {
      const f = await exigir(ws);
      try {
        return consultar(f, a);
      } catch (e) {
        return traduzir(e);
      }
    },

    async impact(ws, a): Promise<ImpactoMapaMcp> {
      const f = await exigir(ws);
      try {
        const r = f.raio(a.files, a.symbols.length > 0 ? a.symbols : undefined);
        return {
          files: r.arquivos,
          signals: r.sinais.map((s) => ({ id: s.id, name: s.nome, min: s.min, max: s.max, value: s.valor, method: s.metodo, worst_case: s.pior_caso })),
          band: BANDA[r.faixa],
          band_worst_case: BANDA[r.faixa_pior_caso],
          worst_case: r.pior_caso.map((p) => ({ signal: p.sinal, reason: p.motivo })),
          seam_candidates: r.candidatos_costura,
          callers: r.chamadores,
          note: r.nota,
        };
      } catch (e) {
        return traduzir(e);
      }
    },

    async evidence(ws, a) {
      const f = await exigir(ws);
      try {
        return { facts: evidencias(f, a.topic, a.scope, a.limit) };
      } catch (e) {
        return traduzir(e);
      }
    },
  };
}

function consultar(f: FachadaMapa, a: { kind: TipoConsultaMapa; target: string | null; depth: number; limit: number; min_confidence: "exact" | "heuristic" }): { items: ItemMapaMcp[]; truncated?: boolean } {
  const lim = Math.min(Math.max(a.limit, 1), 100);
  const exata = a.min_confidence === "exact";
  const escopo = a.target;
  const dentro = (c: string | null): boolean => escopo === null || c === null || c === escopo || c.startsWith(`${escopo.replace(/\/$/, "")}/`);
  const cortar = (itens: ItemMapaMcp[], total = itens.length): { items: ItemMapaMcp[]; truncated?: boolean } => (total > lim ? { items: itens.slice(0, lim), truncated: true } : { items: itens });
  switch (a.kind) {
    case "search": {
      if (a.target === null) throw new ErroConsulta("argumento_invalido", "search exige `target` (texto a buscar).");
      const r = f.buscar(a.target, undefined, lim);
      return cortar(r.map((n) => ({ id: n.id, kind: tipoNo(n.tipo), label: n.rotulo, path: n.caminho, line: n.linha, confidence: null })));
    }
    case "neighbors":
    case "callers":
    case "callees":
    case "dependents": {
      if (a.target === null) throw new ErroConsulta("argumento_invalido", `${a.kind} exige \`target\` (arquivo ou arquivo#símbolo).`);
      const direcao = a.kind === "callees" ? "saida" : a.kind === "neighbors" ? "ambas" : "entrada";
      const prof = a.kind === "dependents" ? Math.min(a.depth, 5) : a.kind === "neighbors" ? Math.min(a.depth, 3) : 1;
      const g = f.vizinhos(noDe(a.target), direcao, prof, lim + 1);
      const alvoId = noDe(a.target);
      const itens: ItemMapaMcp[] = [];
      const conf = new Map<number, "exata" | "heuristica">();
      for (const [de, para, tipo, ex] of g.arestas) {
        if (!USO.includes(tipo) && a.kind !== "neighbors") continue;
        if (exata && ex === 0) continue;
        const idx = direcao === "entrada" ? de : direcao === "saida" ? para : (g.nos[de]?.id === alvoId ? para : de);
        conf.set(idx, ex === 1 ? "exata" : "heuristica");
      }
      for (const [i, n] of g.nos.entries()) {
        if (n.id === alvoId) continue;
        const c = conf.get(i);
        if (c === undefined && a.kind !== "neighbors") continue;
        const caminho = caminhoDe(n.id);
        itens.push({ id: n.id, kind: tipoNo(n.t), label: n.r, path: caminho, line: null, confidence: confianca(c) });
      }
      return cortar(itens, g.truncado ? lim + 1 : itens.length);
    }
    case "cycles": {
      const r = f.analise("ciclos", { limite: lim });
      return cortar(
        r.dados.ciclos.map((c) => ({ id: `ciclo:${c.id}`, kind: "cycle", label: `${c.tamanho} arquivos: ${c.nos.slice(0, 4).map((n) => n.replace(/^arq:/, "")).join(", ")}`, path: c.nos[0]?.replace(/^arq:/, "") ?? null, line: null, confidence: "exact" as const, metrics: { size: c.tamanho } })),
        r.dados.total,
      );
    }
    case "entrypoints": {
      const r = f.analise("entradas", escopo === null ? {} : { pasta: escopo, limite: 200 });
      return cortar(r.dados.itens.filter((e) => !exata || e.confianca === "exata").map((e) => ({ id: e.id, kind: e.subtipo, label: e.chave, path: e.caminho, line: e.linha, confidence: confianca(e.confianca), metrics: { framework: e.framework } })));
    }
    case "tables": {
      const r = f.analise("dados", { limite: 200 });
      return cortar(r.dados.tabelas.map((t) => ({ id: `tab:${t.nome}`, kind: "table", label: t.nome, path: null, line: null, confidence: null, metrics: { reads: t.le_n, writes: t.escreve_n } })));
    }
    case "hotspots": {
      const r = f.analise("hotspots", escopo === null ? { limite: lim } : { pasta: escopo, limite: lim });
      return cortar(r.dados.itens.map((h) => ({ id: `arq:${h.caminho}`, kind: "file", label: h.caminho, path: h.caminho, line: null, confidence: null, metrics: { score: h.score, churn: h.churn_janela, complexity: h.complexidade_max, band: h.faixa } })));
    }
    case "layers": {
      const r = f.analise("camadas");
      return cortar(r.dados.modulos.filter((m) => dentro(m.modulo)).map((m) => ({ id: `mod:${m.modulo}`, kind: "module", label: m.modulo, path: m.modulo, line: null, confidence: null, metrics: { layer: m.camada, ca: m.ca, ce: m.ce, instability: m.instabilidade, in_cycle: m.ciclo_id !== null } })));
    }
    case "unused": {
      const r = f.analise("mortos", escopo === null ? { limite: lim } : { pasta: escopo, limite: lim });
      return cortar(r.dados.itens.map((m) => ({ id: m.id, kind: "dead_code_candidate", label: `${m.tipo} candidato (${m.confianca})`, path: m.caminho, line: m.linha, confidence: null, metrics: { level: m.confianca } })));
    }
    case "externals": {
      const r = f.analise("externas", { limite: 200 });
      return cortar(r.dados.itens.map((e) => ({ id: e.id, kind: "external", label: e.nome, path: null, line: null, confidence: null, metrics: { ecosystem: e.ecossistema, version: e.versao, used: e.usado, declared: e.declarado, license: e.licenca } })));
    }
  }
}

function evidencias(f: FachadaMapa, topico: TopicoEvidenciaMapa, escopo: string | null, limite: number): FatoMapaMcp[] {
  const lim = Math.min(Math.max(limite, 1), 50);
  const a = f.servico.armazem();
  if (topico === "entrypoints") {
    const r = f.analise("entradas", escopo === null ? {} : { pasta: escopo, limite: 1000 }).dados;
    return Object.entries(r.por_categoria)
      .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
      .slice(0, lim)
      .map(([categoria, n]) => ({
        fact: `${n} entrada(s) do tipo ${categoria}`,
        evidence: r.itens.filter((e) => e.subtipo === categoria).slice(0, 5).map((e) => `${e.caminho}:${e.linha}`),
        strength: n === 1 ? "ÚNICO CASO" : "FATO",
        counts: { [categoria]: n },
      }));
  }
  if (topico === "data_access") {
    const r = f.analise("dados", { limite: lim }).dados;
    return r.tabelas.slice(0, lim).map((t) => ({ fact: `tabela ${t.nome}: ${t.le_n} leitura(s), ${t.escreve_n} escrita(s)`, evidence: t.toques.slice(0, 5).map((x) => x.evidencia).filter((x): x is string => x !== null), strength: "FATO", counts: { le: t.le_n, escreve: t.escreve_n } }));
  }
  const prefixo = { tests: "teste.", layers: "camadas.", errors: "erro.", config: "config.", dialects: "dialeto.", commands: "comandos." }[topico];
  const itens = a.lerAnaliseCache<ItemInventario[]>("saida:inventario") ?? [];
  const sel = itens.filter((i) => i.topico.startsWith(prefixo) || (topico === "dialects" && i.topico.startsWith("dialeto")));
  const dentroEscopo = (e: string): boolean => escopo === null || e.startsWith(`${escopo.replace(/\/$/, "")}/`) || e.startsWith(`${escopo}:`);
  return sel.slice(0, lim).map((i) => ({ fact: i.fato, evidence: i.evidencia.filter(dentroEscopo).slice(0, 5), strength: i.forca, counts: i.contagens }));
}

/** Existência do banco sem abrir (para `existeBanco`). */
export function bancoExiste(pastaDados: string, ws: string): boolean {
  return existsSync(join(pastaDados, "mapas", ws, "mapa.db"));
}
