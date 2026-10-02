// Formatação HTML da Bot API (T-20.21): só `<b> <i> <code>`, escape de 3 caracteres (& < >), limite de 4096 contado DEPOIS do parse
// (texto visível), divisão em linhas inteiras sem quebrar tag/entidade, teclado e `callback_data` opaco (nonce), nunca dado do plano.
import { randomBytes } from "node:crypto";
import { escaparHtml } from "../alertas/templates";
import type { TgBotao, TgTeclado } from "./tipos";

export { escaparHtml };
export const LIMITE_API = 4096;
export const LIMITE_DIVISAO = 3500;

const TAG = /^<\/?(?:b|i|code)>$/;
const ENTIDADE = /^&(?:amp|lt|gt|quot);$/;

type Token = { tipo: "tag"; v: string; abre: boolean; nome: string } | { tipo: "ent"; v: string } | { tipo: "car"; v: string };
function tokenizar(html: string): Token[] {
  const saida: Token[] = [];
  for (let i = 0; i < html.length; ) {
    const c = html[i] as string;
    if (c === "<") {
      const f = html.indexOf(">", i);
      const t = f < 0 ? "" : html.slice(i, f + 1);
      if (t !== "" && TAG.test(t)) {
        saida.push({ tipo: "tag", v: t, abre: t[1] !== "/", nome: t.replace(/[</>]/g, "") });
        i = f + 1;
        continue;
      }
    } else if (c === "&") {
      const f = html.indexOf(";", i);
      const t = f < 0 || f - i > 7 ? "" : html.slice(i, f + 1);
      if (t !== "" && ENTIDADE.test(t)) {
        saida.push({ tipo: "ent", v: t });
        i = f + 1;
        continue;
      }
    }
    const cp = html.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    saida.push({ tipo: "car", v: ch });
    i += ch.length;
  }
  return saida;
}

/** nº de caracteres VISÍVEIS (depois do parse: tags somem, entidade vale 1). */
export function contarVisiveis(html: string): number {
  let n = 0;
  for (const t of tokenizar(html)) if (t.tipo !== "tag") n++;
  return n;
}

export function htmlParaTexto(html: string): string {
  return tokenizar(html)
    .map((t) => (t.tipo === "tag" ? "" : t.tipo === "ent" ? ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"' } as Record<string, string>)[t.v] : t.v))
    .join("");
}

export type ParteHtml = { t: "b" | "i" | "code" | "texto"; v: string };
export function montarHtml(partes: ParteHtml[]): string {
  return partes.map((p) => (p.t === "texto" ? escaparHtml(p.v) : `<${p.t}>${escaparHtml(p.v)}</${p.t}>`)).join("");
}

/**
 * Divide `html` em pedaços de até `limite` caracteres visíveis, preferindo quebrar em fim de linha; fecha as tags abertas no fim de cada
 * pedaço e as reabre no começo do seguinte (nunca deixa tag desbalanceada nem entidade partida).
 */
export function dividir(html: string, limite = LIMITE_DIVISAO): string[] {
  if (contarVisiveis(html) <= limite) return [html];
  const tokens = tokenizar(html);
  const partes: string[] = [];
  let atual: Token[] = [];
  let aberta: string[] = [];
  let visiveis = 0;
  let ultimaQuebra = -1;
  let abertasNaQuebra: string[] = [];
  const fechar = (toks: Token[], abertas: string[]): string => toks.map((t) => t.v).join("") + [...abertas].reverse().map((n) => `</${n}>`).join("");
  const reabrir = (abertas: string[]): Token[] => abertas.map((n) => ({ tipo: "tag", v: `<${n}>`, abre: true, nome: n }) as Token);
  const recontar = (toks: Token[]): number => toks.filter((t) => t.tipo !== "tag").length;

  for (const t of tokens) {
    if (t.tipo !== "tag") {
      if (visiveis + 1 > limite) {
        let corte = atual;
        let resto: Token[] = [];
        let abertasCorte = aberta;
        if (ultimaQuebra > 0 && ultimaQuebra >= atual.length / 2) {
          corte = atual.slice(0, ultimaQuebra);
          resto = atual.slice(ultimaQuebra);
          abertasCorte = abertasNaQuebra;
        }
        partes.push(fechar(corte, abertasCorte).replace(/\n+$/, ""));
        atual = [...reabrir(abertasCorte), ...resto];
        visiveis = recontar(atual);
        ultimaQuebra = -1;
      }
      atual.push(t);
      visiveis++;
      if (t.v === "\n") {
        ultimaQuebra = atual.length;
        abertasNaQuebra = [...aberta];
      }
    } else {
      atual.push(t);
      if (t.abre) aberta.push(t.nome);
      else aberta = aberta.filter((_, i, a) => i !== a.lastIndexOf(t.nome));
    }
  }
  if (atual.length > 0) partes.push(fechar(atual, aberta));
  return partes.filter((p) => htmlParaTexto(p).trim() !== "");
}

// ---- teclado e nonce ----
export const RE_CALLBACK = /^[aecpwgry]:[A-Za-z0-9_-]{22}$/;
// a=aprovar plano, e=editar, c=cancelar, p=parar execução, w=escolher workspace, g/r=aprovar/recusar gate (pede confirmação), y=confirmar
export type AcaoBotao = "a" | "e" | "c" | "p" | "w" | "g" | "r" | "y";
export const novoNonce = (): string => randomBytes(16).toString("base64url");
export const montarCallback = (acao: AcaoBotao, nonce: string): string => `${acao}:${nonce}`;
export function lerCallback(dado: unknown): { acao: AcaoBotao; nonce: string } | null {
  if (typeof dado !== "string" || Buffer.byteLength(dado, "utf8") > 64 || !RE_CALLBACK.test(dado)) return null;
  return { acao: dado[0] as AcaoBotao, nonce: dado.slice(2) };
}

/** valida cada `callback_data` (formato e <= 64 bytes) ANTES do envio. */
export function teclado(botoes: Array<Array<{ rotulo: string; dado: string }>>): TgTeclado {
  return botoes.map((linha) =>
    linha.map((b): TgBotao => {
      if (lerCallback(b.dado) === null) throw new Error("callback_data fora do formato");
      return { text: b.rotulo.slice(0, 40), callback_data: b.dado };
    }),
  );
}

/** parse_mode HTML exige escape; `disable_notification` por severidade. */
export const silenciosa = (sev: string): boolean => sev === "info" || sev === "sucesso";
