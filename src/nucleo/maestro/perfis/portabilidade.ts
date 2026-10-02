// T-16.11 · Importar/exportar a configuração de pipelines (JSON versionado). Prévia obrigatória na importação (V1..V9 rodam); nada se aplica sem confirmar.
// Arquivo hostil (campo extra, `../`, caminho absoluto, modelo com `--flag`, tamanho absurdo) é recusado. O exportado nunca carrega caminho absoluto.
import { MODOS_EXECUCAO, type EtapaConfig } from "../../../compartilhado/maestro";
import { FAIXAS } from "../../../compartilhado/harness";
import { PRODUTO } from "../../produto";
import { etapaDef } from "../etapas/catalogo";
import { validarConfig, type Achado, type ContextoValidacao } from "./validar";

export const VERSAO_PIPELINES = 1;
/** Chave de versão derivada do id do produto (D-01: o nome nunca é literal fora de `produto.ts`). */
export const CHAVE_DE_VERSAO = `${PRODUTO.id}_pipelines`;
export const CAMINHO_DE_EXPORTACAO = `${PRODUTO.pastaNoProjeto}/pipelines/pipelines.json`;
export const TAMANHO_MAX_IMPORTACAO = 256 * 1024;
const MODELO_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;
const ESFORCO = /^[a-z][a-z0-9_-]{0,19}$/;
const AGENTE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CLI = /^(?:auto|[a-z][a-z0-9-]{0,19})$/;

export function exportarConfig(configs: readonly EtapaConfig[]): string {
  const etapas = configs.map((c) => ({ etapa_id: c.etapa_id, perfil: { ...c.perfil }, skills: [...c.skills], modo_execucao: c.modo_execucao, atualizado_por: c.atualizado_por }));
  return `${JSON.stringify({ [CHAVE_DE_VERSAO]: VERSAO_PIPELINES, etapas }, null, 2)}\n`;
}

export interface ErroDeImportacao {
  campo: string;
  motivo: string;
}
export type ResultadoImportacao = { ok: true; configs: EtapaConfig[]; achados: Achado[] } | { ok: false; erros: ErroDeImportacao[] };

const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const temCaminho = (s: string): boolean => s.includes("..") || s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.includes("\\");
const soChaves = (o: Record<string, unknown>, permitidas: readonly string[], base: string, erros: ErroDeImportacao[]): void => {
  for (const k of Object.keys(o)) if (!permitidas.includes(k)) erros.push({ campo: `${base}${k}`, motivo: "campo desconhecido" });
};

/** Valida o ARQUIVO (estrutura e conteúdo) e roda V1..V9. Não aplica nada. */
export function importarPrevia(texto: string, ctx: ContextoValidacao): ResultadoImportacao {
  if (typeof texto !== "string" || texto.length > TAMANHO_MAX_IMPORTACAO) return { ok: false, erros: [{ campo: "", motivo: "arquivo grande demais" }] };
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto.replace(/^﻿/, ""));
  } catch {
    return { ok: false, erros: [{ campo: "", motivo: "JSON inválido" }] };
  }
  const erros: ErroDeImportacao[] = [];
  if (!ehObj(bruto)) return { ok: false, erros: [{ campo: "", motivo: "esperado objeto" }] };
  soChaves(bruto, [CHAVE_DE_VERSAO, "etapas"], "", erros);
  if (bruto[CHAVE_DE_VERSAO] !== VERSAO_PIPELINES) erros.push({ campo: CHAVE_DE_VERSAO, motivo: `versão não suportada (esperado ${VERSAO_PIPELINES})` });
  if (!Array.isArray(bruto.etapas) || bruto.etapas.length > 100) return { ok: false, erros: [...erros, { campo: "etapas", motivo: "esperado lista de até 100 etapas" }] };
  const configs: EtapaConfig[] = [];
  const vistas = new Set<string>();
  bruto.etapas.forEach((e: unknown, i: number) => {
    const base = `etapas[${i}].`;
    if (!ehObj(e)) {
      erros.push({ campo: `etapas[${i}]`, motivo: "esperado objeto" });
      return;
    }
    soChaves(e, ["etapa_id", "perfil", "skills", "modo_execucao", "atualizado_por"], base, erros);
    const id = e.etapa_id;
    if (typeof id !== "string" || etapaDef(id) === null) erros.push({ campo: `${base}etapa_id`, motivo: "etapa fora do catálogo" });
    else if (vistas.has(id)) erros.push({ campo: `${base}etapa_id`, motivo: "etapa repetida" });
    else vistas.add(id);
    if (typeof e.modo_execucao !== "string" || !(MODOS_EXECUCAO as readonly string[]).includes(e.modo_execucao)) erros.push({ campo: `${base}modo_execucao`, motivo: "modo inválido" });
    const skills = Array.isArray(e.skills) ? e.skills : null;
    if (skills === null || skills.length > 40 || !skills.every((s) => typeof s === "string" && SLUG.test(s))) erros.push({ campo: `${base}skills`, motivo: "esperado lista de skills (a-z, 0-9, hífen)" });
    const p = e.perfil;
    if (!ehObj(p)) {
      erros.push({ campo: `${base}perfil`, motivo: "esperado objeto" });
      return;
    }
    soChaves(p, ["cli", "modelo", "esforco", "faixa", "origem_modelo", "agente_id"], `${base}perfil.`, erros);
    if (typeof p.cli !== "string" || !CLI.test(p.cli)) erros.push({ campo: `${base}perfil.cli`, motivo: "CLI inválida" });
    if (p.modelo !== null && (typeof p.modelo !== "string" || !MODELO_VALIDO.test(p.modelo) || temCaminho(p.modelo))) erros.push({ campo: `${base}perfil.modelo`, motivo: "modelo inválido (sem flag, caminho ou espaço)" });
    if (p.esforco !== null && (typeof p.esforco !== "string" || !ESFORCO.test(p.esforco))) erros.push({ campo: `${base}perfil.esforco`, motivo: "esforço inválido" });
    if (typeof p.faixa !== "string" || !(FAIXAS as readonly string[]).includes(p.faixa)) erros.push({ campo: `${base}perfil.faixa`, motivo: "faixa inválida" });
    if (p.origem_modelo !== "cli" && p.origem_modelo !== "openrouter") erros.push({ campo: `${base}perfil.origem_modelo`, motivo: "origem inválida" });
    if (p.agente_id !== null && (typeof p.agente_id !== "string" || !AGENTE.test(p.agente_id))) erros.push({ campo: `${base}perfil.agente_id`, motivo: "agente inválido" });
    if (erros.length === 0 || !erros.some((x) => x.campo.startsWith(base))) {
      configs.push({
        etapa_id: id as string,
        perfil: { cli: p.cli as string, modelo: (p.modelo as string | null) ?? null, esforco: (p.esforco as string | null) ?? null, faixa: p.faixa as EtapaConfig["perfil"]["faixa"], origem_modelo: p.origem_modelo as "cli" | "openrouter", agente_id: (p.agente_id as string | null) ?? null },
        skills: (skills ?? []) as string[],
        modo_execucao: e.modo_execucao as EtapaConfig["modo_execucao"],
        atualizado_por: "importado",
      });
    }
  });
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, configs, achados: validarConfig(configs, ctx) };
}
