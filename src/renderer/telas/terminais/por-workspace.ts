// D-570: terminais por workspace. Lógica PURA (sem React, sem store): a tela Terminais mostra só as sessões do workspace atual; as dos outros seguem vivas no daemon e
// só aparecem quando a pessoa troca para o workspace delas. Sessão sem workspace (`null`, legada ou terminal avulso aberto sem projeto) vai para o grupo "Sem projeto" (D-571).
import type { EstadoGrade } from "./estado";

/** Chave de um conjunto de terminais: o id do workspace, ou `null` = "Sem projeto". */
export type ChaveWs = string | null;

export interface SessaoComWs { sessao_id: string; workspace_id?: string | null | undefined }

/** Chave usada nos mapas (Map não distingue `null` de texto por engano, mas o JSON e o `data-` sim). */
export const CHAVE_TEXTO_SEM_PROJETO = "\u0000sem-projeto";
export const textoDaChave = (c: ChaveWs): string => c ?? CHAVE_TEXTO_SEM_PROJETO;

/**
 * Workspace a que a sessão pertence na tela. `conhecidos` = ids de workspaces que existem (atual + recentes): sessão de um workspace que já não existe cai em "Sem projeto"
 * (D-571: nunca fica invisível). `null`/ausente em `conhecidos` = a lista ainda não chegou: o id vale como está.
 */
export function chaveDaSessao(s: SessaoComWs, conhecidos?: ReadonlySet<string> | null): ChaveWs {
  const id = s.workspace_id ?? null;
  if (id === null) return null;
  return conhecidos != null && !conhecidos.has(id) ? null : id;
}

/** Só as sessões da chave, na ordem recebida (ordem estável: a do store, que é a de abertura). */
export function filtrarPorWorkspace<T extends SessaoComWs>(sessoes: readonly T[], chave: ChaveWs, conhecidos?: ReadonlySet<string> | null): T[] {
  return sessoes.filter((s) => chaveDaSessao(s, conhecidos) === chave);
}

/** Terminais por workspace (chave `null` = "Sem projeto"). Só entram chaves com pelo menos uma sessão. */
export function contarPorWorkspace(sessoes: readonly SessaoComWs[], conhecidos?: ReadonlySet<string> | null): Map<ChaveWs, number> {
  const mapa = new Map<ChaveWs, number>();
  for (const s of sessoes) { const c = chaveDaSessao(s, conhecidos); mapa.set(c, (mapa.get(c) ?? 0) + 1); }
  return mapa;
}

/** O que a tela lembra de cada workspace enquanto o app roda (o resto vai para o layout em disco). */
export interface VisaoDoWorkspace { grade: EstadoGrade; focoUnico: boolean }

export interface MemoriaDeWorkspaces {
  guardar(chave: ChaveWs, visao: VisaoDoWorkspace): void;
  obter(chave: ChaveWs): VisaoDoWorkspace | undefined;
  /** Esquece o estado de workspaces que já não existem ("Sem projeto" fica). Devolve quantos esqueceu. */
  manterApenas(conhecidos: ReadonlySet<string>): number;
  tamanho(): number;
}

export function criarMemoriaDeWorkspaces(): MemoriaDeWorkspaces {
  const mapa = new Map<string, VisaoDoWorkspace>();
  return {
    guardar: (chave, visao) => void mapa.set(textoDaChave(chave), visao),
    obter: (chave) => mapa.get(textoDaChave(chave)),
    manterApenas(conhecidos) {
      let removidos = 0;
      for (const k of [...mapa.keys()]) if (k !== CHAVE_TEXTO_SEM_PROJETO && !conhecidos.has(k)) { mapa.delete(k); removidos += 1; }
      return removidos;
    },
    tamanho: () => mapa.size,
  };
}

/** Ids de workspaces conhecidos a partir do store de workspaces (atual + recentes). */
export function idsConhecidos(atual: { id: string } | null, recentes: readonly { id: string }[]): Set<string> {
  const s = new Set(recentes.map((w) => w.id));
  if (atual !== null) s.add(atual.id);
  return s;
}

const igualRasa = <T,>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

interface EstadoFatiavel<S extends SessaoComWs> { sessoes: readonly S[]; falhas: Readonly<Record<string, string>>; aguardando: number }

/**
 * Seletor com memória para `useSyncExternalStore`: devolve a MESMA referência enquanto nada do workspace mudou. Evento de sessão de outro workspace (atividade, estado) ou
 * saída de terminal oculto não re-renderiza a tela atual. `aguardando` passa a contar só o workspace visível (os outros aparecem no painel de workspaces).
 */
export function criarSeletorDaVisao<S extends SessaoComWs & { estado: string; atividade?: string }, E extends EstadoFatiavel<S>>() {
  let entrada: E | null = null;
  let chaveAnterior: ChaveWs | undefined;
  let conhecidosAnterior: ReadonlySet<string> | null | undefined;
  let saida: E | null = null;
  return (estado: E, chave: ChaveWs, conhecidos: ReadonlySet<string> | null): E => {
    if (saida !== null && entrada === estado && chaveAnterior === chave && conhecidosAnterior === conhecidos) return saida;
    const sessoes = filtrarPorWorkspace(estado.sessoes, chave, conhecidos);
    const falhas: Record<string, string> = {};
    for (const s of sessoes) { const f = estado.falhas[s.sessao_id]; if (f !== undefined) falhas[s.sessao_id] = f; }
    const ids = Object.keys(falhas);
    if (saida !== null) {
      const { sessoes: _s, falhas: _f, aguardando: _a, ...resto } = estado;
      const { sessoes: _s2, falhas: _f2, aguardando: _a2, ...restoAnt } = saida;
      void _s; void _f; void _a; void _s2; void _f2; void _a2;
      const mesmoResto = (Object.keys(resto) as Array<keyof typeof resto>).every((k) => resto[k] === (restoAnt as typeof resto)[k]);
      const mesmasFalhas = ids.length === Object.keys(saida.falhas).length && ids.every((i) => saida!.falhas[i] === falhas[i]);
      if (mesmoResto && mesmasFalhas && igualRasa(sessoes, saida.sessoes)) { entrada = estado; chaveAnterior = chave; conhecidosAnterior = conhecidos; return saida; }
    }
    const aguardando = sessoes.filter((s) => s.estado === "executando" && s.atividade === "aguardando").length;
    entrada = estado; chaveAnterior = chave; conhecidosAnterior = conhecidos;
    saida = { ...estado, sessoes, falhas, aguardando };
    return saida;
  };
}
