import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LayoutTerminais, NoLayout } from "../../compartilhado/terminais";

/** Só ids e formato: ordem das abas, árvore de divisões de cada uma e sessão ativa. Nada de saída de terminal. */
export const LIMITES_LAYOUT = { profundidade: 16, nos: 64, arquivo_bytes: 64 * 1024 } as const;
const ID = /^[\w.-]{1,80}$/;

export type ResultadoLayout = { ok: true; layout: LayoutTerminais } | { ok: false; erro: string };

function validarNo(no: unknown, profundidade: number, contagem: { nos: number }): NoLayout | string {
  if (profundidade > LIMITES_LAYOUT.profundidade) return "divisões fundas demais";
  if (++contagem.nos > LIMITES_LAYOUT.nos) return "terminais demais no layout";
  if (typeof no !== "object" || no === null) return "nó inválido";
  const n = no as Record<string, unknown>;
  if (n["tipo"] === "terminal") {
    return typeof n["sessao_id"] === "string" && ID.test(n["sessao_id"]) ? { tipo: "terminal", sessao_id: n["sessao_id"] } : "sessão inválida";
  }
  if (n["tipo"] === "divisao" && (n["orientacao"] === "horizontal" || n["orientacao"] === "vertical")) {
    const primeiro = validarNo(n["primeiro"], profundidade + 1, contagem);
    if (typeof primeiro === "string") return primeiro;
    const segundo = validarNo(n["segundo"], profundidade + 1, contagem);
    if (typeof segundo === "string") return segundo;
    const p = n["proporcao"];
    const proporcao = typeof p === "number" && Number.isFinite(p) && p >= 0.05 && p <= 0.95 ? { proporcao: p } : {};
    return { tipo: "divisao", orientacao: n["orientacao"], ...proporcao, primeiro, segundo };
  }
  return "nó desconhecido";
}

function folhas(no: NoLayout): string[] {
  return no.tipo === "terminal" ? [no.sessao_id] : [...folhas(no.primeiro), ...folhas(no.segundo)];
}

/** Reconstrói o layout campo a campo: o que não está no formato é descartado, nunca repassado. Lê v1 e v2; devolve sempre v2. */
export function validarLayout(valor: unknown): ResultadoLayout {
  if (typeof valor !== "object" || valor === null) return { ok: false, erro: "layout inválido" };
  const v = valor as Record<string, unknown>;
  if (v["versao"] !== 1 && v["versao"] !== 2) return { ok: false, erro: "versão de layout desconhecida" };
  if (!Array.isArray(v["abas"])) return { ok: false, erro: "abas inválidas" };
  const ativa = v["ativa"];
  if (ativa !== null && (typeof ativa !== "string" || !ID.test(ativa))) return { ok: false, erro: "sessão ativa inválida" };
  const contagem = { nos: 0 };
  const abas: LayoutTerminais["abas"] = [];
  for (const aba of v["abas"]) {
    const arvore = validarNo((aba as { arvore?: unknown } | null)?.arvore, 0, contagem);
    if (typeof arvore === "string") return { ok: false, erro: arvore };
    abas.push({ arvore });
  }
  const bruto = v["versao"] === 2 ? v["fixadas"] : [];
  if (!Array.isArray(bruto) || bruto.length > LIMITES_LAYOUT.nos || bruto.some((id) => typeof id !== "string" || !ID.test(id))) return { ok: false, erro: "fixadas inválidas" };
  // só vale fixar uma sessão que existe em alguma árvore
  const existentes = new Set(abas.flatMap((a) => folhas(a.arvore)));
  const fixadas = [...new Set(bruto as string[])].filter((id) => existentes.has(id));
  const layout: LayoutTerminais = { versao: 2, ativa: ativa as string | null, abas, fixadas };
  // D-570: modo foco por workspace (opcionais; o que não vale é descartado)
  const exp = v["expandido"];
  if (typeof exp === "string" && ID.test(exp) && existentes.has(exp)) layout.expandido = exp;
  if (v["foco_unico"] === true) layout.foco_unico = true;
  if (Buffer.byteLength(JSON.stringify(layout)) > LIMITES_LAYOUT.arquivo_bytes) return { ok: false, erro: "layout grande demais" };
  return { ok: true, layout };
}

function podar(no: NoLayout, vivas: ReadonlySet<string>): NoLayout | null {
  if (no.tipo === "terminal") return vivas.has(no.sessao_id) ? no : null;
  const primeiro = podar(no.primeiro, vivas);
  const segundo = podar(no.segundo, vivas);
  if (primeiro === null) return segundo;
  if (segundo === null) return primeiro;
  return { tipo: "divisao", orientacao: no.orientacao, ...(no.proporcao === undefined ? {} : { proporcao: no.proporcao }), primeiro, segundo };
}

/**
 * Restaura o layout salvo depois da recuperação de sessões: sessão que não voltou sai da árvore, a divisão
 * colapsa no irmão, aba sem terminal some. A entrada não é alterada.
 */
export function restaurarLayout(layout: LayoutTerminais, sessoesVivas: Iterable<string>): LayoutTerminais {
  const vivas = new Set(sessoesVivas);
  const abas = layout.abas.flatMap((aba) => { const arvore = podar(aba.arvore, vivas); return arvore === null ? [] : [{ arvore }]; });
  const existentes = new Set(abas.flatMap((a) => folhas(a.arvore)));
  const ativa = layout.ativa !== null && existentes.has(layout.ativa) ? layout.ativa : (abas[0] === undefined ? null : folhas(abas[0].arvore)[0] ?? null);
  const saida: LayoutTerminais = { versao: 2, ativa, abas, fixadas: layout.fixadas.filter((id) => existentes.has(id)) };
  if (layout.expandido != null && existentes.has(layout.expandido)) saida.expandido = layout.expandido;
  if (layout.foco_unico === true) saida.foco_unico = true;
  return saida;
}

export interface ArmazemLayout { ler(): LayoutTerminais | null; gravar(layout: LayoutTerminais): void }

/**
 * Um arquivo por workspace em `<pasta de dados>/layout/<sha1(workspace_id ?? 'padrao')[0:16]>.json`.
 * Escrita atômica (temporário + rename); leitura que descarta o que não valida.
 */
export function criarArmazemLayout(pastaDeDados: string, workspaceId: string | null): ArmazemLayout {
  const dir = join(pastaDeDados, "layout");
  const arquivo = join(dir, `${createHash("sha1").update(workspaceId ?? "padrao").digest("hex").slice(0, 16)}.json`);
  return {
    ler() {
      try {
        const texto = readFileSync(arquivo, "utf8");
        if (Buffer.byteLength(texto) > LIMITES_LAYOUT.arquivo_bytes) return null;
        const r = validarLayout(JSON.parse(texto));
        return r.ok ? r.layout : null;
      } catch { return null; }
    },
    gravar(layout) {
      const r = validarLayout(layout);
      if (!r.ok) throw new Error(r.erro);
      mkdirSync(dir, { recursive: true });
      const temporario = `${arquivo}.${process.pid}.tmp`;
      writeFileSync(temporario, JSON.stringify(r.layout), { mode: 0o600 });
      renameSync(temporario, arquivo);
    },
  };
}
