// Verificador "toda afirmação tem fonte" (T-19.11). V1: fonte existe e pertence ao conjunto permitido; V2: números, datas, SHAs e referências do texto aparecem nos
// fatos das fontes CITADAS (compara `1.234,5` e `1,234.5` como o mesmo valor); V5 (usuário): sem jargão nem id interno; V7 (usuário): todo item visível entregue é citado
// e NENHUM item oculto aparece (por id ou por título). Nada aqui chama modelo: o resultado vale igual para texto de template e de IA.
import type { Bloco, FatosSprint, Verificacao, ViolacaoVerificacao } from "../../../compartilhado/relatorios";
import { itemEntregue } from "../fatos/coletar";
import { textoDaFonte, tipoCorrecao } from "../fatos/fontes";
import { lintarJargao, type ConfigJargao } from "./jargao";

/** interpreta um token numérico em pt-BR ou en: o ÚLTIMO separador decide o decimal; um separador só com exatamente 3 dígitos depois é milhar. */
export function valorNumerico(token: string): number | null {
  const t = token.trim();
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const ult = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
  if (ult < 0) return Number(t);
  const sep = t[ult] as string;
  const outro = sep === "." ? "," : ".";
  const depois = t.slice(ult + 1);
  const temOutro = t.includes(outro);
  const repetido = t.split(sep).length > 2;
  let inteiro: string;
  let frac = "";
  if (temOutro || (!repetido && depois.length !== 3) ) { inteiro = t.slice(0, ult).split(/[.,]/).join(""); frac = depois; }
  else { inteiro = t.split(/[.,]/).join(""); }
  const v = Number(frac ? `${inteiro}.${frac}` : inteiro);
  return Number.isFinite(v) ? v : null;
}

const RE_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const RE_BR = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
const RE_SHA = /\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
const RE_REF = /\b(?:T-\d{2}\.\d{2}|D-\d{1,3}|(?:OC|PD)-[\w-]+)\b/g;
const RE_NUM = /\d[\d.,]*\d|\d/g;
/** `2.4.0`: versão (string), a menos que todos os grupos depois do primeiro tenham 3 dígitos (`12.345.678` é número). */
const RE_VERSAO = /\b\d+(?:\.\d+){2,}\b/g;

export interface Tokens { datas: string[]; shas: string[]; refs: string[]; numeros: number[] }
const ehNumeroAgrupado = (t: string): boolean => t.split(".").slice(1).every((g) => g.length === 3);
export function extrairTokens(texto: string): Tokens {
  let t = texto;
  const datas: string[] = [];
  t = t.replace(RE_ISO, (m) => { datas.push(m); return " "; });
  t = t.replace(RE_BR, (_m, d: string, mo: string, a: string) => { datas.push(`${a}-${mo}-${d}`); return " "; });
  const shas: string[] = [];
  t = t.replace(RE_SHA, (m) => { shas.push(m.toLowerCase().slice(0, 7)); return " "; });
  const refs: string[] = [];
  t = t.replace(RE_REF, (m) => { refs.push(m); return " "; });
  t = t.replace(RE_VERSAO, (m) => { if (ehNumeroAgrupado(m)) return m; refs.push(m); return " "; });
  const numeros: number[] = [];
  for (const m of t.match(RE_NUM) ?? []) { const v = valorNumerico(m.replace(/[.,]$/, "")); if (v !== null) numeros.push(v); }
  return { datas, shas, refs, numeros };
}

function numerosDaFonte(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []) {
    const v = Number(m);
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    out.push(a);
    if (a >= 0 && a <= 1) out.push(Math.round(a * 1000) / 10); // fração vira porcentagem (0,8 -> 80)
    out.push(Math.round(a * 10) / 10, Math.round(a));
  }
  return out;
}
const casa = (v: number, universo: readonly number[]): boolean => universo.some((u) => Math.abs(u - v) < 0.051);

export interface OpcoesVerificar { jargao?: ConfigJargao; fontesPermitidas?: ReadonlySet<string>; /** padrão true; falso ao verificar um bloco isolado. */ cobertura?: boolean }

function verificarAfirmacao(fatos: FatosSprint, b: Bloco, a: Bloco["afirmacoes"][number], op: OpcoesVerificar, out: ViolacaoVerificacao[]): void {
  const v = (regra: ViolacaoVerificacao["regra"], detalhe: string): void => void out.push({ regra, bloco: b.id, afirmacao_id: a.id, detalhe });
  // texto escrito por pessoa não precisa de fonte (a pessoa responde por ele), mas o lint de linguagem do cliente continua valendo
  if (b.origem === "humano") { if (b.publico === "usuario") for (const ach of lintarJargao(a.texto, op.jargao)) v("V5", ach); return; }
  if (a.fontes.length === 0) { v("V1", "afirmação sem fonte"); return; }
  const textos: string[] = [];
  for (const f of a.fontes) {
    if (op.fontesPermitidas && !op.fontesPermitidas.has(f)) { v("V1", `fonte fora do conjunto do bloco: ${f.slice(0, 60)}`); continue; }
    const t = textoDaFonte(fatos, f);
    if (t === null) v("V1", `fonte inexistente: ${f.slice(0, 60)}`);
    else textos.push(t);
  }
  if (textos.length === 0) return;
  const universo = textos.join("\n");
  const baixo = universo.toLowerCase();
  const tk = extrairTokens(a.texto);
  for (const d of tk.datas) if (!universo.includes(d)) v("V2", `data fora das fontes: ${d}`);
  for (const s of tk.shas) if (!baixo.includes(s)) v("V2", `SHA fora das fontes: ${s}`);
  for (const r of tk.refs) if (!universo.includes(r)) v("V2", `referência fora das fontes: ${r}`);
  const nums = numerosDaFonte(universo);
  for (const n of tk.numeros) if (!casa(n, nums)) v("V2", `número fora das fontes: ${n}`);
  if (b.publico === "usuario") for (const ach of lintarJargao(a.texto, op.jargao)) v("V5", ach);
}

export function verificarBlocos(fatos: FatosSprint, blocos: readonly Bloco[], op: OpcoesVerificar = {}): Verificacao {
  const violacoes: ViolacaoVerificacao[] = [];
  let total = 0;
  let comFonte = 0;
  for (const b of blocos) for (const a of b.afirmacoes) {
    total++;
    if (a.fontes.length > 0) comFonte++;
    verificarAfirmacao(fatos, b, a, op, violacoes);
  }
  // V7: cobertura e vazamento de itens ocultos no relatório do usuário
  const usuario = blocos.filter((b) => b.publico === "usuario");
  if (usuario.length > 0) {
    const citados = new Set(usuario.flatMap((b) => b.afirmacoes.flatMap((a) => a.fontes)));
    const humano = new Set(usuario.filter((b) => b.origem === "humano").map((b) => b.id));
    for (const i of op.cobertura === false ? [] : fatos.itens) {
      const bloco = tipoCorrecao(i) ? "u_correcoes" : "u_novidades";
      if (i.visivel_cliente && itemEntregue(i) && !humano.has(bloco) && !citados.has(`item:${i.item_id}`)) violacoes.push({ regra: "V7", bloco: "usuario", afirmacao_id: null, detalhe: `item visível sem citação: ${i.titulo.slice(0, 60)}` });
    }
    const ocultos = fatos.itens.filter((i) => !i.visivel_cliente);
    for (const b of usuario) for (const a of b.afirmacoes) {
      const baixo = a.texto.toLowerCase();
      for (const o of ocultos) {
        const t = o.titulo.toLowerCase();
        if (a.fontes.includes(`item:${o.item_id}`) || baixo.includes(o.item_id.toLowerCase()) || (t.length >= 8 && baixo.includes(t))) {
          violacoes.push({ regra: "V7", bloco: b.id, afirmacao_id: a.id, detalhe: "item oculto ao cliente aparece no texto" });
        }
      }
    }
  }
  return { ok: violacoes.length === 0, afirmacoes_total: total, com_fonte: comFonte, violacoes };
}
