// Leitura tolerante do frontmatter de SKILL.md / agente / comando (T-07.03). Nunca lança.
import { parse } from "yaml";

export const LIMITE_FRONTMATTER = 8 * 1024;
export interface Frontmatter {
  name?: string;
  description?: string;
  author?: string;
}

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** Lê só os primeiros 8 KB. Sem frontmatter, `description` = primeiro parágrafo depois do `#`. */
export function lerFrontmatterSkill(entrada: Buffer | string): Frontmatter {
  try {
    const bruto = typeof entrada === "string" ? entrada : entrada.subarray(0, LIMITE_FRONTMATTER).toString("utf8");
    const t = bruto.slice(0, LIMITE_FRONTMATTER).replace(/^﻿/, "");
    const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(t);
    if (m !== null) {
      let dados: unknown;
      try {
        dados = parse(m[1] ?? "", { maxAliasCount: 10 });
      } catch {
        return {};
      }
      if (typeof dados !== "object" || dados === null || Array.isArray(dados)) return {};
      const d = dados as Record<string, unknown>;
      const meta = typeof d["metadata"] === "object" && d["metadata"] !== null ? (d["metadata"] as Record<string, unknown>) : {};
      const r: Frontmatter = {};
      const nome = texto(d["name"]);
      const desc = texto(d["description"]);
      const autor = texto(d["author"]) ?? texto(meta["author"]);
      if (nome !== undefined) r.name = nome;
      if (desc !== undefined) r.description = desc;
      if (autor !== undefined) r.author = autor;
      return r;
    }
    const corpo = t.split(/\r?\n/);
    let i = corpo.findIndex((l) => /^#\s/.test(l));
    i = i < 0 ? 0 : i + 1;
    const para: string[] = [];
    for (; i < corpo.length; i++) {
      const l = (corpo[i] ?? "").trim();
      if (l === "") {
        if (para.length > 0) break;
        continue;
      }
      if (/^#/.test(l)) break;
      para.push(l);
    }
    return para.length > 0 ? { description: para.join(" ") } : {};
  } catch {
    return {};
  }
}
