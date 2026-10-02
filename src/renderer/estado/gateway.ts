// Estado do painel Gateway MCP (Fase 7C) dentro da Loja de MCPs: configuração por workspace (opt-in, padrão desligado), estado, filtro de
// ferramentas por papel e auditoria (só metadados). Nada roda no boot; carrega ao abrir o painel. Nunca recebe argumentos, resultados nem
// segredos de ferramenta (o contrato só tem nomes, decisões e tamanhos).
import { useSyncExternalStore } from "react";
import type { ConfigGateway, EntradaAuditoriaGateway, EstadoGateway, EventoGateway, FerramentaGateway, PapelGateway, PedidoConfigGateway } from "../../compartilhado/catalogo";
import type { ApiAde } from "../../compartilhado/ipc";
import { ade } from "../ade";
import { mensagemDoErro } from "../telas/catalogo/logica";
import { storeWorkspaces } from "./workspaces";

type Api = ApiAde["gateway"];

export interface EstadoGatewayUi {
  disponivel: boolean;
  carregando: boolean;
  erro: string | null;
  estado: EstadoGateway | null;
  config: ConfigGateway | null;
  auditoria: readonly EntradaAuditoriaGateway[];
  papel: PapelGateway;
  servidor: string | null;
  ferramentas: readonly FerramentaGateway[];
  carregandoFerramentas: boolean;
}

interface Deps { api: () => Api | undefined; workspace?: () => string | null; atrasoMs?: number }

export function criarStoreGateway({ api: obter, workspace = () => null, atrasoMs = 200 }: Deps) {
  const ouvintes = new Set<() => void>();
  let estado: EstadoGatewayUi = { disponivel: true, carregando: false, erro: null, estado: null, config: null, auditoria: [], papel: "executor", servidor: null, ferramentas: [], carregandoFerramentas: false };
  let cancelar: (() => void) | null = null;
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  const publicar = (p: Partial<EstadoGatewayUi>): void => { estado = { ...estado, ...p }; ouvintes.forEach((o) => o()); };

  async function carregar(): Promise<void> {
    const a = obter();
    if (a === undefined) { publicar({ disponivel: false }); return; }
    const ws = workspace();
    publicar({ carregando: true, erro: null });
    try {
      const [est, cfg, aud] = await Promise.all([
        a.estado(),
        ws === null ? Promise.resolve(null) : a.configLer(ws),
        a.auditoria({ workspace_id: ws, limite: 100 }),
      ]);
      publicar({ estado: est, config: cfg, auditoria: aud, carregando: false });
    } catch (e) { publicar({ carregando: false, erro: mensagemDoErro(e) }); }
  }

  function aoEvento(_e: EventoGateway): void {
    if (temporizador !== null) return;
    temporizador = setTimeout(() => {
      temporizador = null;
      const a = obter();
      if (a === undefined) return;
      const ws = workspace();
      void Promise.all([a.estado(), a.auditoria({ workspace_id: ws, limite: 100 })]).then(([est, aud]) => publicar({ estado: est, auditoria: aud })).catch(() => undefined);
    }, atrasoMs);
  }

  async function carregarFerramentas(): Promise<void> {
    const a = obter();
    const ws = workspace();
    if (a === undefined || ws === null || estado.servidor === null) { publicar({ ferramentas: [] }); return; }
    publicar({ carregandoFerramentas: true });
    try { publicar({ ferramentas: await a.ferramentas({ workspace_id: ws, servidor_id: estado.servidor, papel: estado.papel }), carregandoFerramentas: false }); }
    catch (e) { publicar({ carregandoFerramentas: false, erro: mensagemDoErro(e) }); }
  }

  return {
    obter: (): EstadoGatewayUi => estado,
    assinar(o: () => void): () => void { ouvintes.add(o); return () => void ouvintes.delete(o); },
    async iniciar(): Promise<void> {
      const a = obter();
      if (a === undefined) { publicar({ disponivel: false }); return; }
      cancelar ??= a.assinar(aoEvento);
      await carregar();
    },
    parar(): void { cancelar?.(); cancelar = null; if (temporizador !== null) { clearTimeout(temporizador); temporizador = null; } },
    carregar,
    async gravarConfig(p: Omit<PedidoConfigGateway, "workspace_id">): Promise<boolean> {
      const a = obter();
      const ws = workspace();
      if (a === undefined || ws === null) return false;
      try { publicar({ config: await a.configGravar({ workspace_id: ws, ...p }), erro: null }); return true; }
      catch (e) { publicar({ erro: mensagemDoErro(e) }); return false; }
    },
    async escolherServidor(id: string | null): Promise<void> { publicar({ servidor: id, ferramentas: [] }); if (id !== null) await carregarFerramentas(); },
    async escolherPapel(papel: PapelGateway): Promise<void> { publicar({ papel }); await carregarFerramentas(); },
    async definirFiltro(ferramenta: string, habilitada: boolean): Promise<boolean> {
      const a = obter();
      const ws = workspace();
      if (a === undefined || ws === null || estado.servidor === null) return false;
      const antes = estado.ferramentas;
      // otimista: reverte se o main recusar
      publicar({ ferramentas: antes.map((f) => (f.nome === ferramenta ? { ...f, habilitada, explicita: true } : f)) });
      try {
        const r = await a.filtroDefinir({ workspace_id: ws, servidor_id: estado.servidor, ferramenta, papel: estado.papel, habilitada });
        if (!r.ok) publicar({ ferramentas: antes, erro: "O gateway recusou a alteração." });
        return r.ok;
      } catch (e) { publicar({ ferramentas: antes, erro: mensagemDoErro(e) }); return false; }
    },
    async revogarPane(paneId: string): Promise<boolean> {
      const a = obter();
      if (a === undefined) return false;
      try { const r = await a.revogarPane(paneId); await carregar(); return r.ok; } catch (e) { publicar({ erro: mensagemDoErro(e) }); return false; }
    },
  };
}

export type StoreGateway = ReturnType<typeof criarStoreGateway>;
export const storeGateway: StoreGateway = criarStoreGateway({ api: () => ade()?.gateway, workspace: () => storeWorkspaces.obter().atual?.id ?? null });
export const useGateway = (store: StoreGateway = storeGateway): EstadoGatewayUi => useSyncExternalStore(store.assinar, store.obter);
