// Ações TIPADAS do Jarvis (T-13.03/06): lista fechada, validador estrito, matriz ator × permissão × classe de risco e origem × classe. PURO.
// Nada aqui executa: só diz o que é permitido e se exige confirmação. Gesto humano (D-21) não existe nesta lista.
import {
  ACOES_JARVIS,
  ALVO_MAX,
  RISCO_DA_ACAO,
  TEXTO_MAX,
  type AcaoJarvis,
  type AcaoTipada,
  type AtorJarvis,
  type ClasseRisco,
  type CodigoRecusaJarvis,
  type OrigemJarvis,
  type PermissaoRemota,
} from "../../compartilhado/jarvis";
import { redigirParaCanal, sanitizar, truncarVisivel } from "../alertas/texto";

// eslint-disable-next-line no-control-regex
const CONTROLE_LINHA = /[\u0000-\u001f\u007f-\u009f]+/g;

/** texto livre do usuário que vira DADO para o orquestrador: sem controle/bidi/ANSI, redigido (segredo) e cortado em `max`. */
export function textoSeguro(t: string, max = TEXTO_MAX): string {
  return truncarVisivel(redigirParaCanal(sanitizar(t.length > max * 4 ? t.slice(0, max * 4) : t), { max }), max).trim();
}
/** rótulo curto de uma linha (alvo, id). */
export function rotuloSeguro(t: string, max = ALVO_MAX): string {
  return truncarVisivel(sanitizar(t).replace(CONTROLE_LINHA, " ").replace(/\s+/g, " ").trim(), max);
}

const ID = /^[A-Za-z0-9._:#|-]{1,64}$/;
const SQUAD = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type ResultadoValidacao = { ok: true; acao: AcaoTipada } | { ok: false; erro: string };
const nao = (erro: string): ResultadoValidacao => ({ ok: false, erro });

const so = (o: Record<string, unknown>, permitidos: string[]): boolean => Object.keys(o).every((k) => permitidos.includes(k));

/** Validador ESTRITO: campo extra/ausente/tipo errado é erro. Serve ao IPC, ao canal remoto e à saída da LLM classificadora. */
export function validarAcaoTipada(v: unknown): ResultadoValidacao {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return nao("esperado objeto");
  const o = v as Record<string, unknown>;
  const a = o["acao"];
  if (typeof a !== "string" || !(ACOES_JARVIS as readonly string[]).includes(a)) return nao("acao_fora_da_lista");
  switch (a as AcaoJarvis) {
    case "status":
    case "listar_missoes":
    case "listar_paineis":
    case "consultar_consumo":
      return so(o, ["acao"]) ? { ok: true, acao: { acao: a } as AcaoTipada } : nao("campo extra");
    case "abrir_pane": {
      if (!so(o, ["acao", "pane"]) || typeof o["pane"] !== "string") return nao("pane inválido");
      const pane = o["pane"].replace(/^#/, "");
      return ID.test(pane) ? { ok: true, acao: { acao: "abrir_pane", pane } } : nao("pane inválido");
    }
    case "enviar_prompt": {
      if (!so(o, ["acao", "destino", "squad", "texto"])) return nao("campo extra");
      const { destino, squad, texto } = o;
      if (destino !== "maestro" && destino !== "squad") return nao("destino inválido");
      if (typeof texto !== "string" || texto.trim() === "" || texto.length > TEXTO_MAX * 2) return nao("texto inválido");
      if (destino === "squad") {
        if (typeof squad !== "string" || !SQUAD.test(squad)) return nao("squad inválida");
      } else if (squad !== null && squad !== undefined) return nao("squad só com destino squad");
      return { ok: true, acao: { acao: "enviar_prompt", destino, squad: destino === "squad" ? (squad as string) : null, texto: textoSeguro(texto) } };
    }
    case "aprovar_gate": {
      if (!so(o, ["acao", "gate_id", "decisao"])) return nao("campo extra");
      if (typeof o["gate_id"] !== "string" || !ID.test(o["gate_id"])) return nao("gate inválido");
      if (o["decisao"] !== "aprovar" && o["decisao"] !== "recusar") return nao("decisão inválida");
      return { ok: true, acao: { acao: "aprovar_gate", gate_id: o["gate_id"], decisao: o["decisao"] } };
    }
    case "pausar":
    case "parar": {
      if (!so(o, ["acao", "alvo"]) || typeof o["alvo"] !== "string") return nao("alvo inválido");
      const alvo = rotuloSeguro(o["alvo"]);
      return alvo === "" ? nao("alvo inválido") : { ok: true, acao: { acao: a, alvo } as AcaoTipada };
    }
  }
}

export const riscoDe = (a: AcaoTipada | AcaoJarvis): ClasseRisco => RISCO_DA_ACAO[typeof a === "string" ? a : a.acao];

export interface RequisitoDeAcao {
  permitido: boolean;
  /** `desktop`: a pessoa confirma NO app (nunca por fala nem pelo próprio celular). `nenhuma`: executa direto. */
  confirmacao: "desktop" | "nenhuma";
  codigo?: CodigoRecusaJarvis;
}

const LEITURA: readonly AcaoJarvis[] = ["status", "listar_missoes", "listar_paineis", "consultar_consumo"];
const REMOTO_ESCRITA: readonly AcaoJarvis[] = ["enviar_prompt", "pausar", "parar", "aprovar_gate"];

/**
 * Matriz ator × permissão × ação × origem (PURA). Regras:
 *  - origem `conteudo_externo` só lê; nunca autoriza escrita (D-72);
 *  - Jarvis local: tudo da lista; toda `escrita` confirma NO app; `escrita_leve` executa;
 *  - remoto `leitura`: só leitura; `mensagem_confirmada`: + escrita com confirmação no desktop; `mensagem_direta`: `enviar_prompt`/`pausar`/`parar` sem confirmação extra,
 *    mas `aprovar_gate` SEMPRE confirma no desktop; `abrir_pane` nunca pelo remoto.
 */
export function requisitoDaAcao(p: { ator: AtorJarvis; permissao: PermissaoRemota | null; origem: OrigemJarvis; acao: AcaoJarvis }): RequisitoDeAcao {
  const risco = RISCO_DA_ACAO[p.acao];
  if (!(ACOES_JARVIS as readonly string[]).includes(p.acao)) return { permitido: false, confirmacao: "desktop", codigo: "acao_fora_da_lista" };
  if (p.origem === "conteudo_externo" && risco !== "leitura") return { permitido: false, confirmacao: "desktop", codigo: "origem_nao_confiavel" };
  if (p.ator === "jarvis") {
    if (p.origem === "remoto_confirmado" || p.origem === "remoto_direto") return { permitido: false, confirmacao: "desktop", codigo: "origem_nao_confiavel" };
    return { permitido: true, confirmacao: risco === "escrita" ? "desktop" : "nenhuma" };
  }
  // remoto
  if (p.origem !== "remoto_confirmado" && p.origem !== "remoto_direto" && risco !== "leitura") return { permitido: false, confirmacao: "desktop", codigo: "origem_nao_confiavel" };
  if (p.permissao === null) return { permitido: false, confirmacao: "desktop", codigo: "permissao_insuficiente" };
  if ((LEITURA as readonly string[]).includes(p.acao)) return { permitido: true, confirmacao: "nenhuma" };
  if (!(REMOTO_ESCRITA as readonly string[]).includes(p.acao)) return { permitido: false, confirmacao: "desktop", codigo: "permissao_insuficiente" };
  if (p.permissao === "leitura") return { permitido: false, confirmacao: "desktop", codigo: "permissao_insuficiente" };
  if (p.permissao === "mensagem_confirmada" || p.acao === "aprovar_gate") return { permitido: true, confirmacao: "desktop" };
  return { permitido: true, confirmacao: "nenhuma" };
}

/** frase fixa para a confirmação e a auditoria: o que SERÁ feito (alvo + texto), redigido e curto. */
export function resumoDaAcao(a: AcaoTipada, extra?: { gate_titulo?: string; alvo_rotulo?: string; plano?: string }): string {
  switch (a.acao) {
    case "status": return "Mostrar o status";
    case "listar_missoes": return "Listar as Missões";
    case "listar_paineis": return "Listar os painéis";
    case "consultar_consumo": return "Consultar o consumo";
    case "abrir_pane": return `Abrir o painel ${a.pane}`;
    case "enviar_prompt": return `Enviar ao ${a.destino === "maestro" ? "Maestro" : `squad ${a.squad ?? ""}`}${extra?.plano === undefined ? "" : ` (${extra.plano})`}: «${truncarVisivel(a.texto, 200)}»`;
    case "aprovar_gate": return `${a.decisao === "aprovar" ? "Aprovar" : "Recusar"} o portão ${a.gate_id}${extra?.gate_titulo === undefined ? "" : `: «${truncarVisivel(extra.gate_titulo, 80)}»`}`;
    case "pausar": return `Pausar ${extra?.alvo_rotulo ?? a.alvo}`;
    case "parar": return `Parar ${extra?.alvo_rotulo ?? a.alvo}`;
  }
}
