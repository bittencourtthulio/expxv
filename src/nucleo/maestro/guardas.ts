// T-16.26 · Guardas anti-loop do Maestro (puro; relógio injetado). Idempotência (hash(texto)+Pane, 120 s), taxa (≤ 6/min por Pane),
// origem Maestro (Panes abertos pelo Maestro nunca pedem ao Maestro), eco do ADE (o que o ADE mesmo digita, TTL 30 s), marcador `[maestro]`,
// `@direto` e slash commands passam sem tocar. Memória limitada (limpeza por TTL e teto de entradas).
import { createHash } from "node:crypto";

export const IDEMPOTENCIA_MS = 120_000;
export const ECO_MS = 30_000;
export const TAXA_MAX_POR_MIN = 6;
const TETO = 2000;

const hash = (s: string): string => createHash("sha256").update(s.replace(/\s+/g, " ").trim().toLowerCase(), "utf8").digest("hex").slice(0, 32);

export type DecisaoDaGuarda =
  | { acao: "prosseguir" }
  | { acao: "idempotente"; plano_id: string }
  | { acao: "loop_guard" }
  | { acao: "taxa_excedida" }
  | { acao: "marcador_maestro" }
  | { acao: "passa_direto"; motivo: "slash" | "direto" }
  | { acao: "eco" };

export interface DepsGuardas {
  agora(): number;
  /** o Pane foi aberto pelo Maestro (etapa de pipeline)? */
  ehPaneDoMaestro?(pane_id: string): boolean;
}
export interface Guardas {
  /** Decide o que fazer com um pedido que chegou (`via: hook` também confere eco/slash/@direto). */
  avaliar(p: { texto: string; pane_id: string | null; via: string }): DecisaoDaGuarda;
  /** Registra o plano criado para o pedido (idempotência). */
  registrarPlano(texto: string, pane_id: string | null, plano_id: string): void;
  /** O ADE vai digitar `texto` no Pane: o hook deve ignorar o eco. */
  registrarEco(pane_id: string, texto: string): void;
  tamanho(): { idempotencia: number; taxa: number; eco: number };
}

export const ehMarcadorDoMaestro = (texto: string): boolean => /^\s*\[maestro\]/i.test(texto);
export const ehSlashCommand = (texto: string): boolean => /^\s*\//.test(texto);
export const ehDireto = (texto: string): boolean => /(?:^|\s)@direto(?:\s|$)/i.test(texto);

export function criarGuardas(deps: DepsGuardas): Guardas {
  const idem = new Map<string, { plano_id: string; ate: number }>();
  const taxa = new Map<string, number[]>();
  const eco = new Map<string, number>();
  const podar = (agora: number): void => {
    if (idem.size >= TETO) for (const [k, v] of idem) if (v.ate < agora) idem.delete(k);
    if (eco.size >= TETO) for (const [k, ate] of eco) if (ate < agora) eco.delete(k);
    if (taxa.size > TETO) for (const [k, l] of taxa) if (l.every((t) => t < agora - 60_000)) taxa.delete(k);
    while (idem.size >= TETO) idem.delete(idem.keys().next().value as string);
    while (eco.size >= TETO) eco.delete(eco.keys().next().value as string);
  };
  return {
    avaliar({ texto, pane_id, via }) {
      const agora = deps.agora();
      podar(agora);
      if (pane_id !== null && deps.ehPaneDoMaestro?.(pane_id) === true) return { acao: "loop_guard" };
      if (ehMarcadorDoMaestro(texto)) return { acao: "marcador_maestro" };
      if (via === "hook") {
        if (ehSlashCommand(texto)) return { acao: "passa_direto", motivo: "slash" };
        if (ehDireto(texto)) return { acao: "passa_direto", motivo: "direto" };
        if (pane_id !== null) {
          const ate = eco.get(`${pane_id}\u0000${hash(texto)}`);
          if (ate !== undefined && ate > agora) return { acao: "eco" };
        }
      }
      const chave = `${pane_id ?? "-"}\u0000${hash(texto)}`;
      const ja = idem.get(chave);
      if (ja !== undefined && ja.ate > agora) return { acao: "idempotente", plano_id: ja.plano_id };
      if (pane_id !== null) {
        const lista = (taxa.get(pane_id) ?? []).filter((t) => t > agora - 60_000);
        if (lista.length >= TAXA_MAX_POR_MIN) {
          taxa.set(pane_id, lista);
          return { acao: "taxa_excedida" };
        }
        lista.push(agora);
        taxa.set(pane_id, lista);
      }
      return { acao: "prosseguir" };
    },
    registrarPlano(texto, pane_id, plano_id) {
      podar(deps.agora());
      idem.set(`${pane_id ?? "-"}\u0000${hash(texto)}`, { plano_id, ate: deps.agora() + IDEMPOTENCIA_MS });
    },
    registrarEco(pane_id, texto) {
      podar(deps.agora());
      eco.set(`${pane_id}\u0000${hash(texto)}`, deps.agora() + ECO_MS);
    },
    tamanho: () => ({ idempotencia: idem.size, taxa: taxa.size, eco: eco.size }),
  };
}
