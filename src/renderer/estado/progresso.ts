// Estado do painel de progresso (D-660…): UMA assinatura de `progresso:mudou`, a máquina de ciclo de vida PURA (`nucleo/progresso/ciclo`) e um único timer (o do
// próximo prazo da máquina; nenhum com tudo parado). Preferência `progresso_painel_mostrar` (padrão LIGADO): desligada, nada é lido nem assinado.
// Só o workspace atual aparece (a máquina filtra); os outros seguem acompanhados em segundo plano para o indicador do card.
import { useSyncExternalStore } from "react";
import type { ApiAde } from "../../compartilhado/ipc";
import { CHAVE_PROGRESSO_MOSTRAR, type EstadoProgresso, type Progresso } from "../../compartilhado/progresso";
import { CICLO_INICIAL, indicadorDoWorkspace, itemAtual, proximoPrazo, reduzir, resumoDoProgresso, visiveis, contagem, type EntradaCiclo, type EstadoCiclo, type EventoCiclo } from "../../nucleo/progresso/cliente";
import { ade } from "../ade";
import { avisar as avisarPadrao, type TomAviso } from "./avisos";
import { storeMaestro } from "./maestro";
import { pedirFocoSessao, pedirTela } from "./navegacao";
import { storeWorkspaces } from "./workspaces";

export interface EstadoStoreProgresso {
  disponivel: boolean;
  ciclo: EstadoCiclo;
  /** texto da região viva: só muda quando a etapa em andamento muda (ou o progresso termina/para). */
  anuncio: string;
}

export interface DepsStoreProgresso {
  api?: () => ApiAde["progresso"] | undefined;
  config?: () => ApiAde["config"] | undefined;
  /** workspace atual (padrão: o store global de workspaces). */
  workspaces?: { obter(): { atual: { id: string } | null }; assinar(o: () => void): () => void };
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
  avisar?: (texto: string, tom?: TomAviso, acao?: { rotulo: string; executar: () => void }) => unknown;
  /** navegação: focar uma sessão e abrir a tela de detalhes. */
  focarSessao?: (sessaoId: string) => void;
  abrirPipelines?: (progresso: Progresso) => void;
}

const INICIAL: EstadoStoreProgresso = { disponivel: true, ciclo: CICLO_INICIAL, anuncio: "" };

export function criarStoreProgresso(deps: DepsStoreProgresso = {}) {
  const api = deps.api ?? (() => ade()?.progresso);
  const config = deps.config ?? (() => ade()?.config);
  const ws = deps.workspaces ?? storeWorkspaces;
  const agora = deps.agora ?? Date.now;
  const agendar = deps.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelarTimer = deps.cancelar ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const avisar = deps.avisar ?? avisarPadrao;
  const focarSessao = deps.focarSessao ?? pedirFocoSessao;
  const abrirPipelines = deps.abrirPipelines ?? ((p: Progresso) => { if (p.id.startsWith("pl:")) void storeMaestro.selecionar(p.id.slice(3)); pedirTela("pipelines"); });

  const ouvintes = new Set<() => void>();
  let estado: EstadoStoreProgresso = INICIAL;
  let iniciado: Promise<void> | null = null;
  let cancelarMain: (() => void) | null = null;
  let cancelarWs: (() => void) | null = null;
  let timer: unknown = null;
  let ligadoMain = false;
  let geracao = 0;
  const publicar = (p: Partial<EstadoStoreProgresso>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };

  function reagendar(): void {
    if (timer !== null) { cancelarTimer(timer); timer = null; }
    const prazo = proximoPrazo(estado.ciclo);
    if (prazo === null) return;
    timer = agendar(() => { timer = null; despachar({ tipo: "tick", agora: agora() }); }, Math.max(0, prazo - agora()));
  }

  function anunciar(antes: EstadoCiclo, depois: EstadoCiclo): string | null {
    for (const c of Object.values(depois.itens)) {
      if (c.progresso.workspace_id !== depois.workspace_id || c.dispensado) continue;
      const a = antes.itens[c.progresso.id];
      if (a === undefined) continue;
      const mudouFase = a.progresso.resultado !== c.progresso.resultado;
      const antesAtual = itemAtual(a.progresso)?.id;
      const agoraAtual = itemAtual(c.progresso);
      if (mudouFase && c.progresso.resultado !== "em_andamento") return `${c.progresso.titulo}. ${resumoDoProgresso(c.progresso)}.`;
      if (agoraAtual !== null && antesAtual !== agoraAtual.id && c.progresso.resultado === "em_andamento") {
        const { feitos, total } = contagem(c.progresso);
        return `${c.progresso.titulo}. Etapa ${Math.min(feitos + 1, total)} de ${total}: ${agoraAtual.rotulo}.`;
      }
    }
    return null;
  }

  function despachar(ev: EventoCiclo): void {
    const { estado: novo, efeitos } = reduzir(estado.ciclo, ev);
    const falaNova = ev.tipo === "estado" ? anunciar(estado.ciclo, novo) : null;
    publicar({ ciclo: novo, ...(falaNova === null ? {} : { anuncio: falaNova }) });
    reagendar();
    for (const e of efeitos) avisar(e.texto, "sucesso", { rotulo: "Ver resumo", executar: () => despachar({ tipo: "ver_resumo", id: e.id, agora: agora() }) });
  }

  const aplicar = (e: EstadoProgresso): void => despachar({ tipo: "estado", progressos: e.progressos, agora: agora() });

  function ligarMain(): void {
    const a = api();
    if (a === undefined || typeof a.estado !== "function") { publicar({ disponivel: false }); return; }
    if (ligadoMain) return;
    ligadoMain = true;
    const g = ++geracao;
    cancelarMain = typeof a.assinar === "function" ? a.assinar((e) => { if (ligadoMain) aplicar(e); }) : null;
    void a.estado().then((e) => { if (g === geracao && ligadoMain) aplicar(e); }, () => undefined);
  }
  function desligarMain(): void {
    ligadoMain = false;
    geracao++;
    cancelarMain?.();
    cancelarMain = null;
  }

  const seguirWorkspace = (): void => {
    const id = ws.obter().atual?.id ?? null;
    if (id !== estado.ciclo.workspace_id) despachar({ tipo: "workspace", id });
  };

  return {
    obter: (): EstadoStoreProgresso => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    /** lê a preferência; ligada, assina o main (e o workspace atual). Idempotente. */
    iniciar(): Promise<void> {
      iniciado ??= (async () => {
        if (api() === undefined) { publicar({ disponivel: false }); return; }
        let ligado = true;
        try { const v = await config()?.ler(CHAVE_PROGRESSO_MOSTRAR); if (typeof v === "boolean") ligado = v; } catch { /* padrão ligado */ }
        cancelarWs ??= ws.assinar(seguirWorkspace);
        seguirWorkspace();
        despachar({ tipo: "ligar", ligado });
        if (ligado) ligarMain();
      })();
      return iniciado;
    },
    /** "Mostrar painel de progresso na área de terminais": persiste; desligado, solta a assinatura do main. */
    async definirLigado(ligado: boolean): Promise<void> {
      await this.iniciar();
      if (estado.ciclo.ligado === ligado) return;
      despachar({ tipo: "ligar", ligado });
      void Promise.resolve(config()?.gravar(CHAVE_PROGRESSO_MOSTRAR, ligado)).catch(() => undefined);
      if (ligado) ligarMain(); else desligarMain();
    },
    /** a tela (e o teste) informam o workspace quando o store global não é a fonte. */
    definirWorkspace(id: string | null): void { if (id !== estado.ciclo.workspace_id) despachar({ tipo: "workspace", id }); },
    /** dispensa só aquele progresso (o main também guarda). */
    dispensar(id: string): void {
      despachar({ tipo: "dispensar", id });
      void Promise.resolve(api()?.dispensar(id)).catch(() => undefined);
    },
    fixar(id: string, fixado: boolean): void {
      despachar({ tipo: "fixar", id, fixado, agora: agora() });
      void Promise.resolve(api()?.fixar(id, fixado)).catch(() => undefined);
    },
    recolher(id: string, recolhido: boolean): void { despachar({ tipo: "recolher", id, recolhido }); },
    verResumo(id: string): void { despachar({ tipo: "ver_resumo", id, agora: agora() }); },
    /** clique numa etapa com terminal: foca o painel daquela sessão. */
    focarEtapa(sessaoId: string): void { focarSessao(sessaoId); },
    /** "Ver detalhes na tela Pipelines". */
    abrirDetalhes(p: Progresso): void { abrirPipelines(p); },
    /** entrada direta para testes e para quem já tem o estado agregado. */
    aplicar,
    encerrar(): void {
      desligarMain();
      cancelarWs?.();
      cancelarWs = null;
      if (timer !== null) { cancelarTimer(timer); timer = null; }
    },
  };
}

export type StoreProgresso = ReturnType<typeof criarStoreProgresso>;
export const storeProgresso: StoreProgresso = criarStoreProgresso();

export function useProgresso<T>(seletor: (e: EstadoStoreProgresso) => T, store: StoreProgresso = storeProgresso): T {
  return useSyncExternalStore(store.assinar, () => seletor(store.obter()));
}

/** O que a tela mostra agora (workspace atual, feature ligada). Referência estável entre estados iguais não é garantida: use com `useMemo` no componente. */
export const visiveisDe = (e: EstadoStoreProgresso): EntradaCiclo[] => visiveis(e.ciclo);
export const indicadorDe = (e: EstadoStoreProgresso, workspaceId: string): ReturnType<typeof indicadorDoWorkspace> => indicadorDoWorkspace(e.ciclo, workspaceId);

/** Liga em ocioso (depois da primeira pintura): o app nunca paga o custo no boot. */
export function ligarProgressoEmOcioso(store: StoreProgresso = storeProgresso): () => void {
  const g = globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
  if (typeof g.requestIdleCallback === "function") {
    const id = g.requestIdleCallback(() => void store.iniciar(), { timeout: 3_000 });
    return () => g.cancelIdleCallback?.(id);
  }
  const t = setTimeout(() => void store.iniciar(), 600);
  return () => clearTimeout(t);
}
