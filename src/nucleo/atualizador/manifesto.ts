// Parse e validação ESTRITA do manifesto de atualização (Fase 21, T-21.13). Campo desconhecido, tipo errado ou valor fora da faixa ⇒ recusado.
// O manifesto só chega aqui DEPOIS da verificação da assinatura Ed25519 sobre os bytes originais (assinatura.ts).
import {
  ARQUITETURAS_ATUALIZACAO,
  CANAIS_ATUALIZACAO,
  LIMITES_ATUALIZACAO,
  PLATAFORMAS_ATUALIZACAO,
  type ArtefatoAtualizacao,
  type ManifestoAtualizacao,
} from "../../compartilhado/atualizacao";
import { versaoCombinaComCanal } from "./canais";
import { compararTextos, lerVersao } from "./versao";

export type ResultadoManifesto = { ok: true; manifesto: ManifestoAtualizacao } | { ok: false; erro: string };

const CAMPOS = new Set(["esquema", "versao", "canal", "publicado_em", "valido_ate", "artefatos", "notas", "staging", "versao_minima", "chaves_revogadas", "nao_assinado"]);
const CAMPOS_ARTEFATO = new Set(["plataforma", "arquitetura", "url_relativa", "sha512", "tamanho"]);
const URL_RELATIVA = /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9][A-Za-z0-9._~-]*)*$/;
const CHAVE_B64 = /^[A-Za-z0-9+/]{43}=$/;
const DIA_MS = 86_400_000;
const falha = (erro: string): ResultadoManifesto => ({ ok: false, erro });

export function dataIso(valor: unknown): number | null {
  if (typeof valor !== "string" || valor.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(valor)) return null;
  const t = Date.parse(valor);
  return Number.isNaN(t) ? null : t;
}

/** Remove caracteres de controle (exceto \n e \t) das notas; notas são TEXTO (AU-15). */
export function limparNotas(t: string): string {
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function lerManifesto(bytes: Uint8Array | string): ResultadoManifesto {
  const tamanho = typeof bytes === "string" ? Buffer.byteLength(bytes, "utf8") : bytes.byteLength;
  if (tamanho === 0 || tamanho > LIMITES_ATUALIZACAO.manifesto_bytes_max) return falha("tamanho do manifesto fora do limite");
  let o: unknown;
  try {
    o = JSON.parse(typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8"));
  } catch {
    return falha("JSON inválido");
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return falha("objeto esperado");
  const r = o as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!CAMPOS.has(k)) return falha(`campo desconhecido: ${k.slice(0, 30)}`);
  if (r.esquema !== 1) return falha("esquema deve ser 1");
  if (typeof r.versao !== "string" || lerVersao(r.versao) === null) return falha("versao inválida");
  if (typeof r.canal !== "string" || !(CANAIS_ATUALIZACAO as readonly string[]).includes(r.canal)) return falha("canal desconhecido");
  const canal = r.canal as ManifestoAtualizacao["canal"];
  if (!versaoCombinaComCanal(r.versao, canal)) return falha("versao não combina com o canal");
  const pub = dataIso(r.publicado_em);
  const val = dataIso(r.valido_ate);
  if (pub === null || val === null) return falha("datas inválidas");
  if (val <= pub || val - pub > 400 * DIA_MS) return falha("janela de validade inválida");
  if (typeof r.notas !== "string" || r.notas.length > LIMITES_ATUALIZACAO.notas_max) return falha("notas inválidas");
  if (!Number.isInteger(r.staging) || (r.staging as number) < 0 || (r.staging as number) > 100) return falha("staging fora de 0..100");
  if (!Array.isArray(r.artefatos) || r.artefatos.length === 0 || r.artefatos.length > LIMITES_ATUALIZACAO.artefatos_max) return falha("artefatos inválidos");
  const artefatos: ArtefatoAtualizacao[] = [];
  const vistos = new Set<string>();
  for (const a of r.artefatos as unknown[]) {
    if (typeof a !== "object" || a === null || Array.isArray(a)) return falha("artefato inválido");
    const ar = a as Record<string, unknown>;
    for (const k of Object.keys(ar)) if (!CAMPOS_ARTEFATO.has(k)) return falha(`artefato: campo desconhecido: ${k.slice(0, 30)}`);
    if (!(PLATAFORMAS_ATUALIZACAO as readonly unknown[]).includes(ar.plataforma)) return falha("artefato: plataforma desconhecida");
    if (!(ARQUITETURAS_ATUALIZACAO as readonly unknown[]).includes(ar.arquitetura)) return falha("artefato: arquitetura desconhecida");
    if (typeof ar.url_relativa !== "string" || ar.url_relativa.length > 200 || !URL_RELATIVA.test(ar.url_relativa) || ar.url_relativa.split("/").some((p) => p === "..")) return falha("artefato: url_relativa inválida");
    if (typeof ar.sha512 !== "string" || !/^[0-9a-f]{128}$/.test(ar.sha512)) return falha("artefato: sha512 inválido");
    if (!Number.isInteger(ar.tamanho) || (ar.tamanho as number) < 1 || (ar.tamanho as number) > LIMITES_ATUALIZACAO.artefato_bytes_max) return falha("artefato: tamanho inválido");
    const chave = `${ar.plataforma as string}/${ar.arquitetura as string}`;
    if (vistos.has(chave)) return falha("artefato repetido para a mesma plataforma e arquitetura");
    vistos.add(chave);
    artefatos.push({ plataforma: ar.plataforma as ArtefatoAtualizacao["plataforma"], arquitetura: ar.arquitetura as ArtefatoAtualizacao["arquitetura"], url_relativa: ar.url_relativa, sha512: ar.sha512, tamanho: ar.tamanho as number });
  }
  const m: ManifestoAtualizacao = {
    esquema: 1,
    versao: r.versao,
    canal,
    publicado_em: r.publicado_em as string,
    valido_ate: r.valido_ate as string,
    artefatos,
    notas: limparNotas(r.notas),
    staging: r.staging as number,
  };
  if (r.versao_minima !== undefined) {
    if (typeof r.versao_minima !== "string" || lerVersao(r.versao_minima) === null) return falha("versao_minima inválida");
    if (compararTextos(r.versao_minima, r.versao) === 1) return falha("versao_minima maior que a versão do manifesto");
    m.versao_minima = r.versao_minima;
  }
  if (r.chaves_revogadas !== undefined) {
    if (!Array.isArray(r.chaves_revogadas) || r.chaves_revogadas.length > 4 || r.chaves_revogadas.some((c) => typeof c !== "string" || !CHAVE_B64.test(c))) return falha("chaves_revogadas inválidas");
    m.chaves_revogadas = [...(r.chaves_revogadas as string[])];
  }
  if (r.nao_assinado !== undefined) {
    if (r.nao_assinado !== true) return falha("nao_assinado só pode ser true");
    m.nao_assinado = true;
  }
  return { ok: true, manifesto: m };
}
