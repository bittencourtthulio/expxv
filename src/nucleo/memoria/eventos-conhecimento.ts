// Contrato memória → conhecimento (RAG, Fase 15) — T-08.34 / D-54. Mão única, at-least-once, id determinístico.
// A memória emite o evento DEPOIS de gravar a entrada; o evento nunca carrega segredo nem caminho absoluto; sem a Fase 15 a
// porta é nula. A Fase 15 só injeta uma porta real (não altera a Fase 8).
import { createHash } from "node:crypto";
import { redigirTexto, type OpcoesRedacao } from "./redacao";

export const TIPOS_EVENTO_CONHECIMENTO = ["pane.closed", "handoff.submitted", "task.updated", "mission.closed", "memory.checkpoint", "memory.decision", "memory.learning", "method.changed"] as const;
export type TipoEventoConhecimento = (typeof TIPOS_EVENTO_CONHECIMENTO)[number];

export interface ReferenciaConhecimento {
  tipo: "task" | "handoff" | "relatorio" | "trabalho" | "entrada_memoria" | "arquivo_rel";
  /** caminhos SEMPRE relativos à raiz do workspace. */
  id: string;
}

export interface EventoConhecimento {
  versao: 1;
  /** determinístico: sha256(tipo + workspace_id + chave natural); o consumidor deduplica por ele. */
  id: string;
  tipo: TipoEventoConhecimento;
  ocorrido_em: string;
  workspace_id: string;
  mission_id: string | null;
  pane_id: string | null;
  linhagem_id: string | null;
  fonte: "sistema" | "agente" | "usuario";
  importancia: 1 | 2 | 3 | 4 | 5;
  titulo: string;
  texto: string;
  referencias: ReferenciaConhecimento[];
  tags: string[];
}

export interface PortaConhecimento {
  /** Síncrono para quem chama: só enfileira. NUNCA lança, NUNCA bloqueia, NUNCA espera o consumidor. */
  registrar(evento: EventoConhecimento): void;
}

export const conhecimentoNulo: PortaConhecimento = { registrar: () => undefined };

/** Tipo de evento → chave natural → tags. Constante exportada para a Fase 15 importar. */
export const TABELA_EVENTOS: Readonly<Record<TipoEventoConhecimento, { chave_natural: string; tags: readonly string[] }>> = {
  "handoff.submitted": { chave_natural: "handoff_id", tags: ["handoff", "entrega"] },
  "pane.closed": { chave_natural: "pane_id + motivo", tags: ["pane", "sessao"] },
  "task.updated": { chave_natural: "task_id + estado", tags: ["task"] },
  "mission.closed": { chave_natural: "mission_id", tags: ["missao", "aprendizado"] },
  "memory.checkpoint": { chave_natural: "entry_id", tags: ["checkpoint"] },
  "memory.decision": { chave_natural: "entry_id", tags: ["decisao"] },
  "memory.learning": { chave_natural: "mission_id + hash_conteudo", tags: ["aprendizado"] },
  "method.changed": { chave_natural: "trabalho_id + task + tipo", tags: ["metodo"] },
};

export class EventoInvalidoErro extends Error {
  override name = "EventoInvalidoErro";
}

export function idDeEvento(tipo: TipoEventoConhecimento, workspace_id: string, chaveNatural: string): string {
  return createHash("sha256").update(`${tipo}\n${workspace_id}\n${chaveNatural}`, "utf8").digest("hex");
}

const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const ABSOLUTO_POSIX = /(^|[\s"'(=:])\/(?:Users|home|var|private|tmp|opt|etc|mnt|Volumes|root|srv)\/[^\s"')]+/g;
const ABSOLUTO_WIN = /(^|[\s"'(=:])[A-Za-z]:[\\/][^\s"')]+/g;

const ehAbsoluto = (c: string): boolean => c.startsWith("/") || /^[A-Za-z]:[\\/]/.test(c) || c.startsWith("\\\\") || c.startsWith("~");
const ultimoSegmento = (c: string): string => c.split(/[\\/]/).filter(Boolean).pop() ?? "";

export function relativizarTexto(texto: string, raiz?: string): string {
  let t = texto;
  if (raiz && raiz.length > 1) {
    const base = raiz.replace(/[\\/]+$/, "");
    t = t.split(`${base}/`).join("").split(`${base}\\`).join("").split(base).join(".");
  }
  return t.replace(ABSOLUTO_POSIX, (_m, pre: string) => `${pre}…`).replace(ABSOLUTO_WIN, (_m, pre: string) => `${pre}…`);
}

export interface PedidoEvento extends OpcoesRedacao {
  tipo: TipoEventoConhecimento;
  workspace_id: string;
  chave_natural: string;
  ocorrido_em: string;
  mission_id?: string | null;
  pane_id?: string | null;
  linhagem_id?: string | null;
  fonte: EventoConhecimento["fonte"];
  importancia: number;
  titulo: string;
  texto: string;
  referencias?: ReferenciaConhecimento[];
  tags?: string[];
  /** raiz absoluta do workspace: usada só para relativizar; nunca sai no evento. */
  raiz?: string;
}

const clamp = (n: number): 1 | 2 | 3 | 4 | 5 => Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 3))) as 1 | 2 | 3 | 4 | 5;
const cortar = (t: string, max: number): string => {
  const p = Array.from(t);
  return p.length <= max ? t : `${p.slice(0, max - 1).join("")}…`;
};

/** Monta o evento: redige, limita, relativiza caminhos e RECUSA referência absoluta. */
export function montarEvento(p: PedidoEvento): EventoConhecimento {
  const referencias = (p.referencias ?? []).slice(0, 20).map((r): ReferenciaConhecimento => {
    let id = r.id;
    if (p.raiz && id.startsWith(p.raiz.replace(/[\\/]+$/, "") + "/")) id = id.slice(p.raiz.replace(/[\\/]+$/, "").length + 1);
    if ((r.tipo === "arquivo_rel" || r.tipo === "relatorio") && (ehAbsoluto(id) || id.split(/[\\/]/).includes(".."))) {
      throw new EventoInvalidoErro(`referência com caminho absoluto ou fora da raiz recusada (${r.tipo}: ${ultimoSegmento(id)}).`);
    }
    return { tipo: r.tipo, id: redigirTexto(id, p.scrubber ? { scrubber: p.scrubber } : {}).texto.slice(0, 300) };
  });
  const limpar = (t: string, max: number): string =>
    cortar(redigirTexto(relativizarTexto(t, p.raiz).replace(CONTROLES, ""), p.scrubber ? { scrubber: p.scrubber } : {}).texto.trim(), max);
  const tags = [...new Set((p.tags ?? TABELA_EVENTOS[p.tipo].tags).map((t) => t.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30)).filter(Boolean))].slice(0, 8);
  return {
    versao: 1,
    id: idDeEvento(p.tipo, p.workspace_id, p.chave_natural),
    tipo: p.tipo,
    ocorrido_em: p.ocorrido_em,
    workspace_id: p.workspace_id,
    mission_id: p.mission_id ?? null,
    pane_id: p.pane_id ?? null,
    linhagem_id: p.linhagem_id ?? null,
    fonte: p.fonte,
    importancia: clamp(p.importancia),
    titulo: limpar(p.titulo.replace(/\s+/g, " "), 120),
    texto: limpar(p.texto, 4000),
    referencias,
    tags,
  };
}

export interface PortaEnfileirada extends PortaConhecimento {
  pendentes(): number;
  descartados(): number;
  /** espera a fila esvaziar (testes/encerramento). */
  drenar(): Promise<void>;
}

/** Porta com fila LIMITADA: descarta o mais antigo quando cheia; o consumidor lento/que lança nunca afeta o chamador. */
export function criarPortaEnfileirada(
  consumidor: (e: EventoConhecimento) => void | Promise<void>,
  op: { limite?: number; agendar?: (fn: () => void) => void } = {},
): PortaEnfileirada {
  const limite = Math.max(1, op.limite ?? 1000);
  const agendar = op.agendar ?? ((fn: () => void) => void setImmediate(fn));
  const fila: EventoConhecimento[] = [];
  let descartados = 0;
  let rodando: Promise<void> | null = null;
  const drenar = async (): Promise<void> => {
    for (;;) {
      const e = fila.shift();
      if (!e) return;
      try {
        await consumidor(e);
      } catch {
        /* consumidor com defeito não afeta a memória */
      }
    }
  };
  const disparar = (): void => {
    if (rodando) return;
    rodando = new Promise<void>((resolver) =>
      agendar(() => {
        void drenar().finally(() => {
          rodando = null;
          resolver();
          if (fila.length > 0) disparar();
        });
      }),
    );
  };
  return {
    registrar(evento) {
      try {
        fila.push(evento);
        if (fila.length > limite) {
          fila.shift();
          descartados++;
        }
        disparar();
      } catch {
        /* nunca lança */
      }
    },
    pendentes: () => fila.length,
    descartados: () => descartados,
    async drenar() {
      while (rodando || fila.length > 0) {
        if (rodando) await rodando;
        else disparar();
      }
    },
  };
}
