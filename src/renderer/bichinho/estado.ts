// Store do Bichinho no renderer (D-466): só espelha o que o main já calculou. Sem polling: uma carga por workspace + o evento coalescido `bichinho:mudou`.
// Vive no chunk lazy do bichinho (nada no boot). Preferências globais (`bichinho_mostrar`, `bichinho_silenciar`) pelo canal genérico `app:config_*`.
import { useSyncExternalStore } from "react";
import { ESPECIES, type BichinhoVisao, type EspecieId, type EventoBichinhoMudou, type UsoEspecie } from "../../compartilhado/bichinho";
import type { ApiAde } from "../../compartilhado/ipc";
import { CATALOGO } from "../../nucleo/bichinho/catalogo";
import { limitarMetaOvo } from "../../nucleo/bichinho/crescimento";
import { ade } from "../ade";
import { avisar as avisarPadrao } from "../estado/avisos";
import { storeWorkspaces } from "../estado/workspaces";
import { limitarMinutos } from "./passeio/ocioso";

export const CHAVE_MOSTRAR = "bichinho_mostrar";
export const CHAVE_SILENCIAR = "bichinho_silenciar";
/** Passeio (D-650…): "Bichinhos passeiam quando ociosos" (padrão ligado), tempo de ociosidade em minutos (1–30, padrão 3) e travessuras (padrão ligado). */
export const CHAVE_PASSEAR = "bichinho_passear";
export const CHAVE_OCIOSIDADE_MIN = "bichinho_ociosidade_min";
export const CHAVE_TRAVESSURAS = "bichinho_travessuras";
/** Espécies (D-672): "Sem repetir espécie" (padrão ligado) e meta de tarefas do ovo (D-671: 2 a 6, padrão 4). */
export const CHAVE_SEM_REPETIR = "bichinho_sem_repetir";
export const CHAVE_META_OVO = "bichinho_meta_ovo";
/** Quanto tempo a marca "acabou de crescer" fica ligada (a comemoração única do sprite). */
export const COMEMORACAO_MS = 4_000;
/** A casca abre e cai uma vez; depois some. */
export const NASCIMENTO_MS = 3_000;

export interface EstadoBichinhos {
  visoes: ReadonlyMap<string, BichinhoVisao>;
  /** workspace → epoch ms em que o estágio subiu (some depois de `COMEMORACAO_MS`). */
  subiu: ReadonlyMap<string, number>;
  /** workspace → epoch ms em que o ovo chocou (animação de nascimento única; some depois de `NASCIMENTO_MS`). */
  nasceu: ReadonlyMap<string, number>;
  /** quem usa cada espécie (carregado quando o seletor abre). */
  usos: readonly UsoEspecie[];
  semRepetir: boolean;
  metaOvo: number;
  mostrar: boolean;
  silenciar: boolean;
  passear: boolean;
  travessuras: boolean;
  /** minutos sem o usuário antes do passeio (1–30). */
  ociosidadeMin: number;
  /** há API do main (falso em navegador/teste sem ponte). */
  disponivel: boolean;
}

interface Deps {
  api: () => ApiAde["bichinho"] | undefined;
  config: () => ApiAde["config"] | undefined;
  /** nome do workspace para a frase do aviso. */
  nomeDe?: (workspaceId: string) => string | null;
  avisar?: (texto: string) => void;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => void;
}

export function criarStoreBichinho({ api, config, nomeDe = () => null, avisar = (t) => void avisarPadrao(t, "sucesso"), agora = Date.now, agendar = (fn, ms) => void setTimeout(fn, ms) }: Deps) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoBichinhos = { visoes: new Map(), subiu: new Map(), nasceu: new Map(), usos: [], semRepetir: true, metaOvo: 4, mostrar: true, silenciar: false, passear: true, travessuras: true, ociosidadeMin: 3, disponivel: true };
  let cancelar: (() => void) | null = null;
  let prefs: Promise<void> | null = null;
  const lote = new Set<string>();
  let loteAtual: Promise<void> | null = null;

  const publicar = (p: Partial<EstadoBichinhos>): void => {
    estado = { ...estado, ...p };
    ouvintes.forEach((o) => o());
  };
  /** Aviso discreto e ÚNICO de quem foi reatribuído por repetição (D-673): o main só manda `reatribuido` na primeira visão depois da correção. */
  const avisarReatribuicao = (v: BichinhoVisao): void => {
    if (v.reatribuido === null || v.reatribuido === undefined) return;
    const onde = nomeDe(v.workspace_id);
    avisar(`Seu bichinho${onde === null ? "" : ` de ${onde}`} agora é ${CATALOGO[v.especie].rotulo.toLowerCase()}, para não repetir ${CATALOGO[v.reatribuido.de].rotulo.toLowerCase()}.`);
  };
  const gravarVisao = (v: BichinhoVisao): void => {
    const visoes = new Map(estado.visoes);
    visoes.set(v.workspace_id, v);
    publicar({ visoes });
    avisarReatribuicao(v);
  };
  const marcar = (campo: "subiu" | "nasceu", ws: string, ms: number): void => {
    const t = agora();
    const mapa = new Map(estado[campo]);
    mapa.set(ws, t);
    publicar({ [campo]: mapa } as Partial<EstadoBichinhos>);
    agendar(() => {
      if (estado[campo].get(ws) !== t) return;
      const resto = new Map(estado[campo]);
      resto.delete(ws);
      publicar({ [campo]: resto } as Partial<EstadoBichinhos>);
    }, ms);
  };

  const aoMudar = (e: EventoBichinhoMudou): void => {
    gravarVisao(e.visao);
    if (!e.estagio_novo) return;
    const quem = e.visao.apelido ?? CATALOGO[e.visao.especie].rotulo;
    const onde = nomeDe(e.workspace_id);
    if (e.nasceu === true) {
      // o ovo chocou (D-671): nascimento único, com aviso discreto
      avisar(`Seu bichinho nasceu: ${CATALOGO[e.visao.especie].rotulo.toLowerCase()}!${onde === null ? "" : ` (${onde})`}`);
      marcar("nasceu", e.workspace_id, NASCIMENTO_MS);
      return;
    }
    marcar("subiu", e.workspace_id, COMEMORACAO_MS);
    avisar(`${quem}${onde === null ? "" : ` de ${onde}`} cresceu: agora é ${e.visao.estagio === "lendario" ? "lendário" : e.visao.estagio}.`);
  };

  function ligar(): void {
    if (cancelar !== null) return;
    const a = api();
    if (a === undefined) { publicar({ disponivel: false }); return; }
    cancelar = a.assinar(aoMudar);
  }

  async function lerPrefs(): Promise<void> {
    const c = config();
    if (c === undefined) return;
    try {
      const [mostrar, silenciar, passear, travessuras, minutos, semRepetir, metaOvo] = await Promise.all([c.ler(CHAVE_MOSTRAR), c.ler(CHAVE_SILENCIAR), c.ler(CHAVE_PASSEAR), c.ler(CHAVE_TRAVESSURAS), c.ler(CHAVE_OCIOSIDADE_MIN), c.ler(CHAVE_SEM_REPETIR), c.ler(CHAVE_META_OVO)]);
      publicar({
        semRepetir: typeof semRepetir === "boolean" ? semRepetir : true,
        metaOvo: limitarMetaOvo(metaOvo),
        mostrar: typeof mostrar === "boolean" ? mostrar : true,
        silenciar: typeof silenciar === "boolean" ? silenciar : false,
        passear: typeof passear === "boolean" ? passear : true,
        travessuras: typeof travessuras === "boolean" ? travessuras : true,
        ociosidadeMin: limitarMinutos(minutos),
      });
    } catch { /* fica no padrão */ }
  }

  async function carregarUsos(): Promise<void> {
    try { const usos = await api()?.usos(); if (usos !== undefined) publicar({ usos }); } catch { /* o seletor funciona sem a marca de uso */ }
  }

  return {
    obter: (): EstadoBichinhos => estado,
    assinar(o: () => void): () => void {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    /** carrega as preferências e os bichinhos que faltam e passa a ouvir o evento. Idempotente por id; pedidos da mesma rodada viram UMA chamada ao main. */
    garantir(ids: readonly string[]): Promise<void> {
      ligar();
      prefs ??= lerPrefs();
      const a = api();
      const faltam = ids.filter((id) => !estado.visoes.has(id));
      if (a === undefined || faltam.length === 0) return prefs;
      for (const id of faltam) lote.add(id);
      loteAtual ??= Promise.resolve().then(async () => {
        const pedir = [...lote].filter((id) => !estado.visoes.has(id));
        lote.clear();
        loteAtual = null;
        if (pedir.length === 0) return;
        try {
          const lista = await a.listar(pedir);
          const visoes = new Map(estado.visoes);
          for (const v of lista) if (!visoes.has(v.workspace_id)) visoes.set(v.workspace_id, v);
          publicar({ visoes });
          for (const v of lista) avisarReatribuicao(v);
        } catch { /* sem bichinho nesta rodada: a próxima chamada tenta de novo */ }
      });
      return Promise.all([prefs, loteAtual]).then(() => undefined);
    },
    /** o dono olhou o bichinho: o main o acorda e ele fica curioso um instante. */
    async atencao(id: string): Promise<void> {
      try { const v = await api()?.atencao(id); if (v !== undefined) gravarVisao(v); } catch { /* nunca quebra a UI */ }
    },
    async trocarEspecie(id: string, especie: EspecieId | null): Promise<string | null> {
      if (especie !== null && !(ESPECIES as readonly string[]).includes(especie)) return "Espécie desconhecida.";
      try { const v = await api()?.trocarEspecie(id, especie); if (v !== undefined) { gravarVisao(v); void carregarUsos(); } return null; } catch (e) { return e instanceof Error ? e.message : "Não foi possível trocar o bichinho."; }
    },
    async renomear(id: string, apelido: string | null): Promise<string | null> {
      try { const v = await api()?.renomear(id, apelido); if (v !== undefined) gravarVisao(v); return null; } catch (e) { return e instanceof Error ? e.message : "Não foi possível renomear o bichinho."; }
    },
    /** quem usa cada espécie agora; o seletor chama ao abrir (sob demanda, nada no boot). */
    carregarUsos,
    async definirSemRepetir(valor: boolean): Promise<void> {
      publicar({ semRepetir: valor });
      try { await config()?.gravar(CHAVE_SEM_REPETIR, valor); } catch { /* idem */ }
    },
    async definirMetaOvo(meta: number): Promise<void> {
      const m = limitarMetaOvo(meta);
      publicar({ metaOvo: m });
      try { await config()?.gravar(CHAVE_META_OVO, m); } catch { /* idem */ }
    },
    async definirMostrar(valor: boolean): Promise<void> {
      publicar({ mostrar: valor });
      try { await config()?.gravar(CHAVE_MOSTRAR, valor); } catch { /* a escolha vale nesta sessão mesmo sem gravar */ }
    },
    async definirSilenciar(valor: boolean): Promise<void> {
      publicar({ silenciar: valor });
      try { await config()?.gravar(CHAVE_SILENCIAR, valor); } catch { /* idem */ }
    },
    async definirPassear(valor: boolean): Promise<void> {
      publicar({ passear: valor });
      try { await config()?.gravar(CHAVE_PASSEAR, valor); } catch { /* idem */ }
    },
    async definirTravessuras(valor: boolean): Promise<void> {
      publicar({ travessuras: valor });
      try { await config()?.gravar(CHAVE_TRAVESSURAS, valor); } catch { /* idem */ }
    },
    async definirOciosidadeMin(minutos: number): Promise<void> {
      const m = limitarMinutos(minutos);
      publicar({ ociosidadeMin: m });
      try { await config()?.gravar(CHAVE_OCIOSIDADE_MIN, m); } catch { /* idem */ }
    },
    encerrar(): void { cancelar?.(); cancelar = null; },
  };
}

export type StoreBichinho = ReturnType<typeof criarStoreBichinho>;
export const storeBichinho: StoreBichinho = criarStoreBichinho({ api: () => ade()?.bichinho, config: () => ade()?.config, nomeDe: (id) => storeWorkspaces.obter().recentes.find((w) => w.id === id)?.nome ?? null });

export function useBichinhos(store: StoreBichinho = storeBichinho): EstadoBichinhos {
  return useSyncExternalStore(store.assinar, store.obter);
}
