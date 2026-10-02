// Kit de desenvolvimento (Fase 7B, T-07B.24; D-134 + P-136): conjunto pequeno de servidores gratuitos e sem
// chave obrigatória, sugerido como habilitado nos Panes livres e na allow-list SUGERIDA de Missão. "Habilitado"
// nunca é "instalado": o download acontece só por clique, com UM consentimento que lista todos os comandos.
// Opt-out desliga o Kit (sugestões somem). Nada aqui baixa por conta própria nem roda no boot.

import { createHash } from "node:crypto";
import { kitMinimo, type CatalogoCarregado } from "./catalogo";
import type { CicloLoja, Consentimento, ResultadoAcao } from "./ciclo";
import type { PlanoInstalacao, BloqueioPlano } from "./plano";
import type { RepoLojaMcp } from "./repositorio";

/** P-136: `git` e `filesystem` restritos ao workspace (args do catálogo) + `fetch`, além dos pré-instalados do seed. */
export const EXTRAS_DO_KIT: readonly string[] = ["git", "filesystem", "fetch"];
export const PAPEIS_COM_KIT: readonly string[] = ["explorador", "executor"];

export interface ItemKit { id: string; nome: string; instalado: boolean; remoto: boolean }
export interface EstadoKit { opt_out: boolean; itens: ItemKit[]; pendentes: string[] }

export interface PlanoKit {
  planos: PlanoInstalacao[];
  bloqueios: Array<{ id: string; bloqueio: BloqueioPlano }>;
  /** hash do conjunto: o que a pessoa consente de uma vez. */
  comando_hash: string;
}

export interface Kit {
  idsDoKit(): string[];
  estado(): EstadoKit;
  plano(workspace?: string): Promise<PlanoKit>;
  instalar(consentimento: Consentimento, opcoes?: { workspace?: string; sinal?: AbortSignal }): Promise<Array<{ id: string; resultado: ResultadoAcao }>>;
  definirOptOut(valor: boolean): void;
  /** Allow-list sugerida de Missão (editável): o Kit para `explorador`/`executor`, vazia nos demais papéis ou com opt-out. */
  allowListSugerida(papel: string): string[];
}

export function hashDoKit(planos: readonly PlanoInstalacao[]): string {
  return createHash("sha256").update(JSON.stringify(planos.map((p) => [p.id, p.comando_hash]).sort((a, b) => a[0]!.localeCompare(b[0]!)))).digest("hex");
}

export function criarKit(o: { ciclo: CicloLoja; repo: RepoLojaMcp; catalogo: CatalogoCarregado; extras?: readonly string[]; agora?: () => string }): Kit {
  const agora = o.agora ?? ((): string => new Date().toISOString());
  const idsDoKit = (): string[] => {
    const base = kitMinimo(o.catalogo).map((x) => x.entrada.id);
    const extras = (o.extras ?? EXTRAS_DO_KIT).filter((id) => o.catalogo.porId.get(id)?.instalavel === true);
    return [...new Set([...base, ...extras])];
  };
  return {
    idsDoKit,
    estado() {
      const itens = idsDoKit().map((id): ItemKit => {
        const e = o.catalogo.porId.get(id)!.entrada;
        return { id, nome: e.nome, instalado: o.repo.obterInstalado(id)?.estado === "instalado", remoto: e.instalacao.metodo === "remoto" };
      });
      return { opt_out: o.repo.kitOptOut(), itens, pendentes: itens.filter((i) => !i.instalado).map((i) => i.id) };
    },
    async plano(workspace) {
      const planos: PlanoInstalacao[] = [];
      const bloqueios: PlanoKit["bloqueios"] = [];
      for (const id of idsDoKit()) {
        if (o.repo.obterInstalado(id)?.estado === "instalado") continue;
        const r = await o.ciclo.planoInstalacao(id, workspace);
        if (r.ok) planos.push(r.plano); else bloqueios.push({ id, bloqueio: r.bloqueio });
      }
      return { planos, bloqueios, comando_hash: hashDoKit(planos) };
    },
    async instalar(consentimento, opcoes = {}) {
      const p = await this.plano(opcoes.workspace);
      // Um consentimento para o conjunto exatamente como mostrado; qualquer mudança invalida.
      if (consentimento.aceito !== true || consentimento.comando_hash !== p.comando_hash) return p.planos.map((x) => ({ id: x.id, resultado: { ok: false, codigo: "consentimento_invalido" } as ResultadoAcao }));
      const saida: Array<{ id: string; resultado: ResultadoAcao }> = [];
      for (const plano of p.planos) {
        const resultado = await o.ciclo.instalar(plano.id, { aceito: true, comando_hash: plano.comando_hash }, { origem: "kit", ...(opcoes.workspace ? { workspace: opcoes.workspace } : {}), ...(opcoes.sinal ? { sinal: opcoes.sinal } : {}) });
        saida.push({ id: plano.id, resultado });
        if (opcoes.sinal?.aborted) break;
      }
      return saida;
    },
    definirOptOut(valor) { o.repo.definirKitOptOut(valor, agora()); },
    allowListSugerida(papel) {
      if (o.repo.kitOptOut() || !PAPEIS_COM_KIT.includes(papel)) return [];
      return idsDoKit();
    },
  };
}
