// Núcleo de escrita (T-08.07): validar → redigir → dedupe → substituir checkpoint → limites → transação.
import { createHash } from "node:crypto";
import type { Banco } from "../banco";
import { TIPOS_MEMORIA } from "../../compartilhado/memoria";
import {
  BRUTO_MAX, CONTEUDO_MAX, DEDUPE_JANELA_H, ENTRADA_RAPIDA_IMPORTANCIA_MIN_COLETOR, ESCRITAS_POR_MINUTO, MAX_ATIVAS_POR_LINHAGEM, MAX_ATIVAS_POR_WORKSPACE,
} from "./constantes";
import { conhecimentoNulo, montarEvento, type PortaConhecimento, type TipoEventoConhecimento } from "./eventos-conhecimento";
import { metricasNulas, type Metricas } from "./metricas";
import { redigirTexto } from "./redacao";
import { criarRepoMemoria, novoIdMemoria } from "./repo";
import { MemoriaErro, type ContextoMemoria, type EscopoMemoria, type FonteMemoria, type Importancia, type LinhaEntrada, type TipoMemoria } from "./tipos";
import type { Scrubber } from "../cofre/scrubber";

export interface Limitador {
  /** true = pode gravar agora. */
  tentar(chave: string): boolean;
}

export function criarLimitador(op: { porMinuto?: number; agora?: () => number } = {}): Limitador {
  const teto = op.porMinuto ?? ESCRITAS_POR_MINUTO;
  const agora = op.agora ?? Date.now;
  const marcas = new Map<string, number[]>();
  return {
    tentar(chave) {
      const t = agora();
      const lista = (marcas.get(chave) ?? []).filter((x) => t - x < 60_000);
      if (lista.length >= teto) {
        marcas.set(chave, lista);
        return false;
      }
      lista.push(t);
      marcas.set(chave, lista);
      if (marcas.size > 5000) for (const [k, v] of marcas) if (v.every((x) => t - x >= 60_000)) marcas.delete(k);
      return true;
    },
  };
}

export type OrigemEscrita = "agente" | "coletor" | "humano" | "ciclo";

export interface PedidoGravacao {
  ctx: ContextoMemoria;
  tipo: TipoMemoria;
  conteudo: string;
  importancia?: number;
  /** padrão: `pane` se há linhagem, senão `missao`. */
  escopo?: "pane" | "missao";
  fonte?: FonteMemoria;
  origem: OrigemEscrita;
  /** só testes e a integração de fechamento de Pane (T-08.09): roda DENTRO da transação, depois do insert. */
  aposInserir?: (banco: Banco) => void;
}

export interface ResultadoGravacao {
  entry_id: string;
  redacted: boolean;
  duplicada: boolean;
}

export interface DepsEscrita {
  banco: Banco;
  agora?: () => Date;
  porta?: PortaConhecimento;
  limitador?: Limitador;
  scrubber?: Pick<Scrubber, "scrub">;
  metricas?: Metricas;
  /** raiz do workspace (só para relativizar caminhos nos eventos ao conhecimento). */
  raizDoWorkspace?: (workspaceId: string) => string | undefined;
}

const CONTROLES_PROIBIDOS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CONTROLES_LIMPAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export const normalizarParaHash = (t: string): string => t.toLowerCase().replace(/\s+/g, " ").trim();
/** 128 bits do sha256 (32 hex): sobra para dedupe e poupa ~3 MB a cada 50 mil entradas (P-41). */
export const hashDoConteudo = (t: string): string => createHash("sha256").update(normalizarParaHash(t), "utf8").digest("hex").slice(0, 32);
const pontos = (t: string): number => Array.from(t).length;
export const cortarPontos = (t: string, max: number): string => {
  const p = Array.from(t);
  return p.length <= max ? t : p.slice(0, max).join("");
};

/** Tipos que um AGENTE pode gravar, conforme papel e modo (matriz D-53; squad com memória própria, P-24). */
export function tiposPermitidosAoAgente(ctx: Pick<ContextoMemoria, "modo" | "papel">): readonly TipoMemoria[] {
  if (ctx.modo === "off") return [];
  if (ctx.modo === "solo" || ctx.papel === "piloto") return ["checkpoint", "decisao", "risco", "fato", "aprendizado", "preferencia"];
  return ["decisao", "risco", "fato"];
}

const EVENTO_POR_TIPO: Partial<Record<TipoMemoria, TipoEventoConhecimento>> = { checkpoint: "memory.checkpoint", decisao: "memory.decision", aprendizado: "memory.learning" };

export function criarEscritor(deps: DepsEscrita) {
  const repo = criarRepoMemoria(deps.banco);
  // contagem de ativas por workspace em cache (o teto é "mole"): evita um `count(*)` de ~2 ms em 11 mil linhas a cada escrita (P-34).
  const ativasWs = new Map<string, { n: number; desde: number }>();
  const porta = deps.porta ?? conhecimentoNulo;
  const metricas = deps.metricas ?? metricasNulas;
  const agora = (): Date => (deps.agora ?? (() => new Date()))();

  function validar(p: PedidoGravacao): { tipo: TipoMemoria; escopo: "pane" | "missao"; importancia: Importancia; texto: string } {
    const ctx = p.ctx;
    if (ctx.modo === "off" && p.origem !== "ciclo" && p.origem !== "humano") throw new MemoriaErro("memory_disabled", "A memória está desligada para este Pane.");
    if (!(TIPOS_MEMORIA as readonly string[]).includes(p.tipo)) throw new MemoriaErro("invalid_argument", "tipo de memória inválido.");
    if (typeof p.conteudo !== "string") throw new MemoriaErro("invalid_argument", "conteudo deve ser texto.");
    if (p.conteudo.length > BRUTO_MAX) throw new MemoriaErro("too_large", `conteudo passa de ${BRUTO_MAX} caracteres.`);
    if (p.origem === "agente") {
      if (pontos(p.conteudo) > CONTEUDO_MAX) throw new MemoriaErro("too_large", `conteudo passa de ${CONTEUDO_MAX} caracteres.`);
      if (CONTROLES_PROIBIDOS.test(p.conteudo)) throw new MemoriaErro("invalid_argument", "conteudo não pode ter caracteres de controle.");
      if (!tiposPermitidosAoAgente(ctx).includes(p.tipo)) throw new MemoriaErro("unauthorized", "este papel não pode gravar esse tipo de memória.");
    }
    const imp = p.importancia ?? 3;
    if (!Number.isInteger(imp) || imp < 1 || imp > 5) throw new MemoriaErro("invalid_argument", "importancia deve estar entre 1 e 5.");
    const escopo = p.escopo ?? (ctx.linhagem_id ? "pane" : "missao");
    if (escopo === "pane" && !ctx.linhagem_id) throw new MemoriaErro("invalid_argument", "escopo pane exige um Pane.");
    if (escopo === "missao" && !ctx.mission_id) throw new MemoriaErro("invalid_argument", "escopo mission exige uma Missão.");
    if (ctx.modo === "solo" && escopo !== "pane" && p.origem === "agente") throw new MemoriaErro("unauthorized", "Pane livre só grava no escopo pane.");
    const limpo = p.conteudo.replace(CONTROLES_LIMPAR, " ").trim();
    if (limpo === "") throw new MemoriaErro("invalid_argument", "conteudo vazio.");
    return { tipo: p.tipo, escopo, importancia: imp as Importancia, texto: limpo };
  }

  function emitir(l: LinhaEntrada): void {
    const tipoEvento = EVENTO_POR_TIPO[l.tipo];
    if (!tipoEvento || !l.workspace_id) return;
    try {
      const raiz = deps.raizDoWorkspace?.(l.workspace_id);
      porta.registrar(
        montarEvento({
          tipo: tipoEvento,
          workspace_id: l.workspace_id,
          chave_natural: tipoEvento === "memory.learning" ? `${l.mission_id ?? ""}:${l.hash_conteudo}` : l.id,
          ocorrido_em: l.criado_em,
          mission_id: l.mission_id,
          pane_id: l.pane_id,
          linhagem_id: l.linhagem_id,
          fonte: l.fonte,
          importancia: l.importancia,
          titulo: l.conteudo.slice(0, 80),
          texto: l.conteudo,
          referencias: [{ tipo: "entrada_memoria", id: l.id }],
          ...(raiz ? { raiz } : {}),
          ...(deps.scrubber ? { scrubber: deps.scrubber } : {}),
        }),
      );
    } catch {
      /* a memória nunca depende do RAG */
    }
  }

  return {
    /** Grava (ou conta a duplicata). Devolve `null` quando o filtro de relevância do coletor descarta a entrada. */
    gravar(p: PedidoGravacao): ResultadoGravacao | null {
      const v = validar(p);
      const ctx = p.ctx;
      if (p.origem === "coletor" && v.importancia < ENTRADA_RAPIDA_IMPORTANCIA_MIN_COLETOR) return null;
      if (p.origem === "agente" && deps.limitador && !deps.limitador.tentar(ctx.pane_id ?? ctx.mission_id ?? ctx.workspace_id))
        throw new MemoriaErro("rate_limited", "limite de gravações por minuto atingido.");
      const red = redigirTexto(v.texto, deps.scrubber ? { scrubber: deps.scrubber } : {});
      const conteudo = cortarPontos(red.texto, CONTEUDO_MAX).trim();
      if (conteudo === "") throw new MemoriaErro("invalid_argument", "conteudo vazio.");
      const hash = hashDoConteudo(conteudo);
      const t = agora();
      const iso = t.toISOString();
      const desde = new Date(t.getTime() - DEDUPE_JANELA_H * 3_600_000).toISOString();
      let nova: LinhaEntrada | undefined;
      let dup: LinhaEntrada | undefined;
      deps.banco.transacao((tx) => {
        const r = criarRepoMemoria(tx);
        dup = r.buscarDuplicada({ escopo: v.escopo, tipo: v.tipo, hash, workspace_id: ctx.workspace_id, linhagem_id: ctx.linhagem_id, mission_id: ctx.mission_id, squad_slug: null, desde });
        if (dup) {
          r.tocarDuplicada(dup.id, iso);
          return;
        }
        // tetos: expira o evento mais fraco; sem evento para expirar, recusa
        if (ctx.linhagem_id) {
          while (r.contarAtivasLinhagem(ctx.linhagem_id) >= MAX_ATIVAS_POR_LINHAGEM)
            if (!r.expirarEventoMaisFraco({ coluna: "linhagem_id", valor: ctx.linhagem_id }, iso)) throw new MemoriaErro("limit_reached", "limite de entradas ativas deste Pane atingido.");
        }
        let c = ativasWs.get(ctx.workspace_id);
        if (!c || c.desde >= 200 || c.n >= MAX_ATIVAS_POR_WORKSPACE) c = { n: r.contarAtivasWorkspace(ctx.workspace_id), desde: 0 };
        while (c.n >= MAX_ATIVAS_POR_WORKSPACE) {
          if (!r.expirarEventoMaisFraco({ coluna: "workspace_id", valor: ctx.workspace_id }, iso)) {
            ativasWs.delete(ctx.workspace_id);
            throw new MemoriaErro("limit_reached", "limite de entradas ativas do projeto atingido.");
          }
          c.n--;
        }
        c.n++;
        c.desde++;
        ativasWs.set(ctx.workspace_id, c);
        const linha: LinhaEntrada = {
          id: novoIdMemoria(), workspace_id: ctx.workspace_id, mission_id: ctx.mission_id, pane_id: ctx.pane_id, linhagem_id: ctx.linhagem_id, squad_slug: null,
          escopo: v.escopo as EscopoMemoria, anel: 1, tipo: v.tipo, conteudo, fonte: p.fonte ?? (p.origem === "agente" ? "agente" : "sistema"),
          autor_pane_id: ctx.pane_id, importancia: v.importancia, substitui_id: null, estado: "ativa", expira_em: null, redigido: red.redigido ? 1 : 0,
          hash_conteudo: hash, contagem: 1, criado_em: iso, atualizado_em: iso,
        };
        r.inserir(linha);
        if (v.tipo === "checkpoint") {
          const anterior = r.ultimoCheckpointAnteriorAtivo({ escopo: v.escopo, linhagem_id: ctx.linhagem_id, mission_id: ctx.mission_id, exceto: linha.id });
          r.substituirCheckpointsAnteriores({ escopo: v.escopo, linhagem_id: ctx.linhagem_id, mission_id: ctx.mission_id, exceto: linha.id, agora: iso });
          if (anterior) {
            r.ligarSubstituicao(linha.id, anterior);
            linha.substitui_id = anterior;
          }
        }
        p.aposInserir?.(tx);
        nova = linha;
      });
      if (dup) {
        metricas.contar("memoria.dedupe");
        return { entry_id: dup.id, redacted: dup.redigido === 1, duplicada: true };
      }
      const linha = nova as LinhaEntrada;
      metricas.contar("memoria.escritas");
      if (red.redigido) metricas.contar("memoria.redigidas");
      emitir(linha);
      return { entry_id: linha.id, redacted: red.redigido, duplicada: false };
    },
  };
}

export type Escritor = ReturnType<typeof criarEscritor>;
