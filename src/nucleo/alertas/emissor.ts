// Emissor (T-20.05): redige -> dedupe (10 min) -> supressão de flood -> persiste -> `alert.created` (NÃO coalescido, P-140) -> avaliador.
// Falha do repositório nunca derruba o chamador (erro isolado e reportado por `aoErro`, com teto de 1/min).
import { randomBytes } from "node:crypto";
import type { AlertaVisao, DadosAlerta, EntradaAlerta } from "../../compartilhado/alertas";
import { CATALOGO } from "./catalogo";
import type { PortaBarramento, RepoAlertas, Relogio } from "./portas";
import { relogioReal } from "./portas";
import { redigirParaCanal } from "./texto";

export const JANELA_DEDUPE_MS = 10 * 60_000;
export const FLOOD_POR_MIN = 30;
export const TITULO_MAX = 120;
export const DETALHE_MAX = 280;

export interface DepsEmissor {
  repo: RepoAlertas;
  barramento: PortaBarramento;
  relogio?: Relogio;
  scrub?: (t: string) => string;
  novoId?: () => string;
  /** chamado só para alerta NOVO (aciona regras). */
  aoCriar?: (a: AlertaVisao) => void;
  aoErro?: (codigo: string) => void;
  floodPorMin?: number;
  janelaDedupeMs?: number;
}

export interface Emissor {
  emitir(e: EntradaAlerta): AlertaVisao | null;
  /** quantos alertas o flood suprimiu desde o início (nada se perde: contador). */
  suprimidos(): number;
}

const CHAVES_TEXTO_CURTO = new Set(["pergunta", "motivo", "cli", "modelo", "status", "missao", "task_id"]);

/** Redige todos os textos dos dados; `link` só https; números/booleanos/null passam intactos. */
export function redigirDados(d: DadosAlerta, scrub?: (t: string) => string): DadosAlerta {
  const saida: DadosAlerta = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v !== "string") {
      saida[k] = v;
      continue;
    }
    if (k === "link") {
      saida[k] = /^https:\/\/[^\s/@]+(?:[/?#]\S*)?$/i.test(v) ? v : null;
      continue;
    }
    const max = k === "lista_atrasadas" ? 700 : CHAVES_TEXTO_CURTO.has(k) ? 120 : DETALHE_MAX;
    saida[k] = redigirParaCanal(v, { ...(scrub === undefined ? {} : { scrub }), max });
  }
  return saida;
}

export function criarEmissor(deps: DepsEmissor): Emissor {
  const relogio = deps.relogio ?? relogioReal;
  const novoId = deps.novoId ?? ((): string => `alt_${randomBytes(9).toString("base64url")}`);
  const limiteFlood = deps.floodPorMin ?? FLOOD_POR_MIN;
  const janela = deps.janelaDedupeMs ?? JANELA_DEDUPE_MS;
  const recentes = new Map<string, number[]>();
  let totalSuprimidos = 0;
  let ultimoErro = -Infinity;

  const iso = (ms: number): string => new Date(ms).toISOString();
  const erro = (codigo: string): void => {
    const t = relogio.agora();
    if (t - ultimoErro < 60_000) return;
    ultimoErro = t;
    try {
      deps.aoErro?.(codigo);
    } catch {
      /* isolado */
    }
  };

  function publicar(a: AlertaVisao): void {
    try {
      deps.barramento.emitir("alert.created", { alert_id: a.id, tipo: a.tipo, severidade: a.severidade, workspace_id: a.workspace_id });
    } catch {
      erro("barramento");
    }
    try {
      deps.aoCriar?.(a);
    } catch {
      erro("avaliador");
    }
  }

  return {
    suprimidos: () => totalSuprimidos,
    emitir(e) {
      try {
        const agora = relogio.agora();
        const meta = CATALOGO[e.tipo];
        const titulo = redigirParaCanal(e.titulo, { ...(deps.scrub === undefined ? {} : { scrub: deps.scrub }), max: TITULO_MAX });
        const dados = redigirDados(e.dados ?? {}, deps.scrub);
        const chave = [e.tipo, e.workspace_id ?? "", `${e.entidade_tipo ?? ""}:${e.entidade_id ?? ""}`, e.estado ?? ""].join("|");

        const existente = deps.repo.recentePorDedupe(chave, iso(agora - janela));
        if (existente !== null) {
          deps.repo.atualizar(existente.id, { contagem: existente.contagem + 1, atualizado_em: iso(agora), dados, titulo });
          return { ...existente, contagem: existente.contagem + 1, atualizado_em: iso(agora), dados, titulo };
        }

        // supressão de flood por tipo: janela deslizante de 60 s
        const marcas = (recentes.get(e.tipo) ?? []).filter((t) => agora - t < 60_000);
        if (marcas.length >= limiteFlood) {
          recentes.set(e.tipo, marcas);
          totalSuprimidos++;
          const chaveFlood = `flood|${e.tipo}`;
          const resumo = deps.repo.recentePorDedupe(chaveFlood, iso(agora - 60_000));
          if (resumo !== null) {
            const n = resumo.contagem + 1;
            deps.repo.atualizar(resumo.id, { contagem: n, atualizado_em: iso(agora), titulo: `${n} alertas suprimidos (${meta.rotulo})` });
          } else {
            const a: AlertaVisao = {
              id: novoId(),
              tipo: e.tipo,
              severidade: "aviso",
              fonte: meta.fonte,
              workspace_id: null,
              mission_id: null,
              entidade_tipo: null,
              entidade_id: null,
              titulo: `1 alertas suprimidos (${meta.rotulo})`,
              dados: { suprimido: true },
              dedupe_chave: chaveFlood,
              contagem: 1,
              criado_em: iso(agora),
              atualizado_em: iso(agora),
              lido_em: null,
              silenciado_ate: null,
              arquivado_em: null,
            };
            deps.repo.inserir(a);
            publicar(a);
            return a;
          }
          return null;
        }
        marcas.push(agora);
        recentes.set(e.tipo, marcas);

        const a: AlertaVisao = {
          id: novoId(),
          tipo: e.tipo,
          severidade: e.severidade ?? meta.severidade,
          fonte: meta.fonte,
          workspace_id: e.workspace_id ?? null,
          mission_id: e.mission_id ?? null,
          entidade_tipo: e.entidade_tipo ?? null,
          entidade_id: e.entidade_id ?? null,
          titulo,
          dados,
          dedupe_chave: chave,
          contagem: 1,
          criado_em: iso(agora),
          atualizado_em: iso(agora),
          lido_em: null,
          silenciado_ate: null,
          arquivado_em: null,
        };
        deps.repo.inserir(a);
        publicar(a);
        return a;
      } catch {
        erro("persistencia");
        return null;
      }
    },
  };
}
