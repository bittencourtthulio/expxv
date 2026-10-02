// T-18.05: resolve agente/sessão/e-mail de commit para um membro (rótulo). Sem alias => "sem dono"; ambíguo => "sem dono" + aviso. Nunca adivinha.
import type { MembroAgil } from "../../../compartilhado/agil";
import { normalizar } from "../util";

export interface IdentidadeRastro { agente?: string | null; sessao?: string | null; email?: string | null; login?: string | null }
export interface ResolucaoMembro { membro_id: string | null; ambiguo: boolean; aviso: string | null }

export interface IndiceMembros { resolver(i: IdentidadeRastro): ResolucaoMembro }

export function indexarMembros(membros: readonly MembroAgil[]): IndiceMembros {
  const mapa = new Map<string, Set<string>>();
  const chave = (tipo: string, valor: string): string => `${tipo}|${normalizar(valor.trim())}`;
  for (const m of membros) {
    if (!m.ativo) continue;
    for (const a of m.aliases) {
      const k = chave(a.tipo, a.valor);
      (mapa.get(k) ?? mapa.set(k, new Set()).get(k))?.add(m.id);
    }
  }
  return {
    resolver(i) {
      const achados = new Set<string>();
      let ambiguoNoAlias = false;
      for (const [tipo, valor] of [["agente", i.agente], ["sessao", i.sessao], ["email", i.email], ["login", i.login]] as const) {
        if (!valor) continue;
        const ids = mapa.get(chave(tipo, valor));
        if (!ids) continue;
        if (ids.size > 1) ambiguoNoAlias = true;
        ids.forEach((id) => achados.add(id));
      }
      if (achados.size === 1 && !ambiguoNoAlias) return { membro_id: [...achados][0] as string, ambiguo: false, aviso: null };
      if (achados.size === 0) return { membro_id: null, ambiguo: false, aviso: null };
      return { membro_id: null, ambiguo: true, aviso: `identidade ambígua (${achados.size} membros): tratada como "sem dono"` };
    },
  };
}
