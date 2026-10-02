// Auditoria do Jarvis e do controle remoto (T-13.02): uma linha por passo, args REDIGIDOS (nunca texto integral de fala, token, chave nem caminho), retenção 30 dias.
// Os valores de texto passam por `redigirParaCanal` e são cortados; objetos aninhados não entram. Só inserções (nada edita o passado).
import { randomBytes } from "node:crypto";
import type { AcaoJarvis, AtorJarvis, ClasseRisco, EntradaAuditoriaJarvis, OrigemJarvis } from "../../compartilhado/jarvis";
import type { Banco } from "../banco/banco";
import { redigirParaCanal, truncarVisivel } from "../alertas/texto";
import type { RelogioJarvis } from "./confirmacao";

export const RETENCAO_DIAS = 30;

export interface CamposAuditoriaJarvis {
  ator: AtorJarvis | "sistema";
  evento: string;
  dispositivo_id?: string | null;
  acao?: AcaoJarvis | null;
  risco?: ClasseRisco | null;
  origem?: OrigemJarvis | null;
  confirmado_por?: "nenhum" | "ui" | "desktop";
  ok: boolean;
  codigo?: string | null;
  args_hash?: string | null;
  /** texto livre: é redigido e cortado em 160 antes de gravar. */
  resumo?: string | null;
  latencia_ms?: number | null;
}

export interface AuditoriaJarvis {
  registrar(c: CamposAuditoriaJarvis): EntradaAuditoriaJarvis;
  listar(ator: "jarvis" | "remoto" | "todos", depois: string | null, limite: number): { itens: EntradaAuditoriaJarvis[]; proximo: string | null };
  limparAntigas(): number;
}

export interface DepsAuditoriaJarvis {
  banco: Banco;
  relogio: RelogioJarvis;
  scrub?: (t: string) => string;
}

interface Linha {
  id: string;
  ts: string;
  ator: "jarvis" | "remoto" | "sistema";
  dispositivo_id: string | null;
  evento: string;
  acao: string | null;
  risco: ClasseRisco | null;
  origem: OrigemJarvis | null;
  confirmado_por: "nenhum" | "ui" | "desktop";
  ok: number;
  codigo: string | null;
  args_hash: string | null;
  resumo: string | null;
  latencia_ms: number | null;
}
const paraEntrada = (l: Linha): EntradaAuditoriaJarvis => ({ ...l, ok: l.ok === 1 });

export function criarAuditoriaJarvis(d: DepsAuditoriaJarvis): AuditoriaJarvis {
  const iso = (): string => new Date(d.relogio.agora()).toISOString();
  const limpa = (t: string | null | undefined, n: number): string | null => (t === null || t === undefined ? null : truncarVisivel(redigirParaCanal(t, { max: n, ...(d.scrub === undefined ? {} : { scrub: d.scrub }) }), n));
  return {
    registrar(c) {
      const e: EntradaAuditoriaJarvis = {
        id: `jau_${randomBytes(9).toString("base64url")}`,
        ts: iso(),
        ator: c.ator,
        dispositivo_id: c.dispositivo_id ?? null,
        evento: truncarVisivel(c.evento, 60),
        acao: c.acao ?? null,
        risco: c.risco ?? null,
        origem: c.origem ?? null,
        confirmado_por: c.confirmado_por ?? "nenhum",
        ok: c.ok,
        codigo: limpa(c.codigo, 60),
        args_hash: c.args_hash ?? null,
        resumo: limpa(c.resumo, 160),
        latencia_ms: c.latencia_ms === undefined || c.latencia_ms === null ? null : Math.max(0, Math.round(c.latencia_ms)),
      };
      d.banco.executar(
        "INSERT INTO jarvis_auditoria (id,ts,ator,dispositivo_id,evento,acao,risco,origem,confirmado_por,ok,codigo,args_hash,resumo,latencia_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [e.id, e.ts, e.ator, e.dispositivo_id, e.evento, e.acao, e.risco, e.origem, e.confirmado_por, e.ok ? 1 : 0, e.codigo, e.args_hash, e.resumo, e.latencia_ms],
      );
      return e;
    },
    listar(ator, depois, limite) {
      const n = Math.min(Math.max(limite, 1), 100);
      const filtro = ator === "todos" ? "" : "AND ator = ?";
      const linhas = d.banco.consultar<Linha>(
        `SELECT * FROM jarvis_auditoria WHERE (? IS NULL OR ts < ?) ${filtro} ORDER BY ts DESC, id DESC LIMIT ?`,
        ator === "todos" ? [depois, depois, n + 1] : [depois, depois, ator, n + 1],
      );
      const pagina = linhas.slice(0, n).map(paraEntrada);
      return { itens: pagina, proximo: linhas.length > n ? (pagina[pagina.length - 1] as EntradaAuditoriaJarvis).ts : null };
    },
    limparAntigas() {
      const corte = new Date(d.relogio.agora() - RETENCAO_DIAS * 86_400_000).toISOString();
      d.banco.executar("DELETE FROM jarvis_idempotencia WHERE criado_em < ?", [new Date(d.relogio.agora() - 86_400_000).toISOString()]);
      return d.banco.executar("DELETE FROM jarvis_auditoria WHERE ts < ?", [corte]).alteracoes;
    },
  };
}

export interface Idempotencia {
  /** devolve o resultado guardado para (ator, dispositivo, id) dentro do TTL de 24 h; `null` se é a primeira vez. */
  obter(ator: AtorJarvis, dispositivo_id: string | null, id: string): unknown | null;
  gravar(ator: AtorJarvis, dispositivo_id: string | null, id: string, resultado: unknown): boolean;
}
export function criarIdempotencia(d: { banco: Banco; relogio: RelogioJarvis }): Idempotencia {
  return {
    obter(ator, dispositivo_id, id) {
      const corte = new Date(d.relogio.agora() - 86_400_000).toISOString();
      const l = d.banco.consultarUm<{ resultado_json: string }>("SELECT resultado_json FROM jarvis_idempotencia WHERE ator = ? AND dispositivo_id = ? AND client_request_id = ? AND criado_em >= ?", [ator, dispositivo_id ?? "", id, corte]);
      if (l === undefined) return null;
      try {
        return JSON.parse(l.resultado_json) as unknown;
      } catch {
        return null;
      }
    },
    gravar(ator, dispositivo_id, id, resultado) {
      const r = d.banco.executar("INSERT OR IGNORE INTO jarvis_idempotencia (ator,dispositivo_id,client_request_id,resultado_json,criado_em) VALUES (?,?,?,?,?)", [ator, dispositivo_id ?? "", id, JSON.stringify(resultado), new Date(d.relogio.agora()).toISOString()]);
      return r.alteracoes === 1;
    },
  };
}
