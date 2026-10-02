// Backend online OPCIONAL do RAG no main (Fase 15, D-90..D-92): configuração sem segredo na tabela `config`, credenciais SÓ no cofre do SO,
// consentimento por (provedor, host, coleção, versão da política), migração retomável no worker e a ponte de rede `rede.rag` que o worker
// chama (o main é o único que abre socket e reconfere o consentimento GRAVADO a cada chamada). Nada sai por padrão: modo `local`.
// O renderer envia o segredo UMA vez e nunca o recebe de volta (só a máscara); erros saem sanitizados.
import { execFile } from "node:child_process";
import type { ConsentimentoBackend, EstadoMigracao, TipoDocumento } from "../compartilhado/conhecimento";
import type { CanaisEvento } from "../compartilhado/ipc";
import type { EstadoBackendRag, PedidoConfigurarBackend, PreviaMigracao, ProvedorRag, ResultadoTestarBackend } from "../compartilhado/rag";
import { POLITICA_VERSAO } from "../nucleo/conhecimento/constantes";
import { consentimentoVale, guardarSegredos, projetoIdDoRemote, sanitizarErro, TIPOS_MIGRAVEIS_PADRAO, validarConfig, type PortaCofreRag } from "../nucleo/conhecimento/backend/config";
import { lerSegredosRag } from "../nucleo/conhecimento/backend/cofre-rag";
import { criarArmazenamentoRag, normalizarUrlProvedor, testarConexaoRag } from "../nucleo/conhecimento/backend/fabrica";
import { listarProvedores } from "../nucleo/conhecimento/backend/provedores";
import type { EstadoReplicacao } from "../nucleo/conhecimento/backend/replicacao";
import { criarTransporteRag } from "../nucleo/conhecimento/backend/transporte";
import { validarUrlBackend } from "../nucleo/conhecimento/backend/url";
import type { RepoConfig } from "../nucleo/banco/repos/config";
import type { ClienteRede } from "../nucleo/rede/cliente-http";
import type { RegistroConsentimento } from "../nucleo/rede/consentimento";
import type { LigacaoConhecimento } from "./conhecimento";
import type { ManipuladoresRag } from "./ipc/conhecimento";

const INTERVALO_SYNC_MS = 60_000;
const INTERVALO_PULL_MS = 10 * 60_000;
const INTERVALO_PROGRESSO_MS = 600;
const ESTADOS_TERMINAIS = new Set<EstadoMigracao>(["concluida", "falhou", "cancelada", "pausada", "verificando"]);

/** Configuração gravada (nada secreto: URL, coleção, modo, tipos, máscaras e o consentimento). */
export interface ConfigRagGravada {
  provedor: ProvedorRag;
  url: string;
  colecao_remota: string;
  modo: "local" | "espelho" | "compartilhado";
  tipos: TipoDocumento[];
  equipe_id: string | null;
  autor: string | null;
  projeto_id: string;
  id_segredos: string[];
  mascarado: Record<string, string>;
  consentimento: ConsentimentoBackend | null;
  ultima_sincronizacao: string | null;
  ultimo_pull_ms: number;
  offline: boolean;
}

export interface DepsRagBackend {
  lig: Pick<LigacaoConhecimento, "chamarWs" | "workspace">;
  config: Pick<RepoConfig, "obter" | "definir" | "remover" | "listar">;
  cofre: PortaCofreRag;
  rede: ClienteRede;
  consentimento: RegistroConsentimento;
  enviar: <C extends keyof CanaisEvento>(canal: C, payload: CanaisEvento[C]) => void;
  /** URL do remote `origin` do repositório (identidade do projeto compartilhado, D-92); `null` = sem remote. */
  remoteGit?: (raiz: string) => Promise<string | null>;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => { cancelar(): void };
  aviso?: (mensagem: string) => void;
  /** testes: workspaces com backend configurado (padrão: as chaves `rag_backend.*` da tabela `config`). */
  workspaces?: () => string[];
}

export interface RagBackend {
  manipuladores: ManipuladoresRag;
  metodosDoMain: Readonly<Record<string, (args: unknown[], sinal: AbortSignal) => unknown>>;
  /** o worker abriu o workspace: reaplica o estado de replicação (fila de envio só com consentimento válido). */
  aoAbrir(workspaceId: string): Promise<void>;
  /** ciclo em segundo plano (push periódico no `espelho`/`compartilhado`); só com consentimento válido. */
  iniciar(): void;
  encerrar(): void;
}

const chaveConfig = (ws: string): string => `rag_backend.${ws}`;

function gitRemoteNode(raiz: string): Promise<string | null> {
  return new Promise((resolver) => {
    execFile("git", ["remote", "get-url", "origin"], { cwd: raiz, timeout: 5_000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (erro, stdout) => {
      const t = erro ? "" : String(stdout).trim();
      resolver(t === "" ? null : t);
    });
  });
}

const hostDa = (url: string): string => {
  const v = validarUrlBackend(normalizarUrlProvedor("pinecone", url));
  if (!v.ok || v.host === null) throw new Error("URL do backend inválida");
  return v.host.toLowerCase();
};

export function criarRagBackend(d: DepsRagBackend): RagBackend {
  const agora = d.agora ?? Date.now;
  const agendar = d.agendar ?? ((fn: () => void, ms: number) => {
    const t = setInterval(fn, ms);
    t.unref?.();
    return { cancelar: () => clearInterval(t) };
  });
  const remoteGit = d.remoteGit ?? gitRemoteNode;
  const workspaces = d.workspaces ?? ((): string[] => Object.keys(d.config.listar()).filter((k) => k.startsWith("rag_backend.")).map((k) => k.slice("rag_backend.".length)));
  const migracaoWs = new Map<string, string>();
  const testando = new Set<string>();
  const tokens = new Map<string, string>();
  let encerrado = false;
  const timersProgresso = new Map<string, { cancelar(): void }>();

  const ler = (ws: string): ConfigRagGravada | null => d.config.obter<ConfigRagGravada>(chaveConfig(ws)) ?? null;
  const gravar = (ws: string, c: ConfigRagGravada): void => d.config.definir(chaveConfig(ws), c);
  const exigir = (ws: string): ConfigRagGravada => {
    d.lig.workspace(ws);
    const c = ler(ws);
    if (c === null) throw new Error("Configure o backend online antes.");
    return c;
  };
  const destinoDe = (c: ConfigRagGravada): { provedor: string; host: string; colecao: string } => ({ provedor: c.provedor, host: hostDa(c.url), colecao: c.colecao_remota });
  const estadoRepl = (c: ConfigRagGravada): EstadoReplicacao => ({ modo: c.modo, consentimento: c.consentimento, destino: destinoDe(c) });
  const consentimentoOk = (c: ConfigRagGravada): boolean => consentimentoVale(c.consentimento, destinoDe(c));

  /** Hosts com consentimento GRAVADO válido (+ o que está em teste agora, por clique do usuário). */
  const hostsConsentidos = (): string[] => {
    const lista = new Set<string>(testando);
    for (const ws of workspaces()) {
      const c = ler(ws);
      if (c !== null && consentimentoOk(c)) lista.add(destinoDe(c).host);
    }
    return [...lista];
  };

  async function segredosDe(c: ConfigRagGravada): Promise<Record<string, string>> {
    return lerSegredosRag(d.cofre, c.provedor, c.id_segredos);
  }

  const aplicarReplicacao = async (ws: string, c: ConfigRagGravada | null): Promise<void> => {
    try {
      await d.lig.chamarWs(ws, "ragReplicacao", [c === null || c.modo === "local" || !consentimentoOk(c) ? null : estadoRepl(c)]);
    } catch {
      /* o worker aplica de novo ao abrir o workspace */
    }
  };

  function tokenDoHost(host: string): string {
    let t = tokens.get(host);
    if (t === undefined || !d.consentimento.valido(t, host)) {
      d.consentimento.permitirHost(host);
      t = d.consentimento.conceder(host, { permanente: true });
      tokens.set(host, t);
    }
    return t;
  }
  function revogarHost(host: string): void {
    const t = tokens.get(host);
    if (t !== undefined) d.consentimento.revogar(t);
    tokens.delete(host);
    d.consentimento.revogarHost(host);
  }

  /** A ÚNICA saída do backend online: reconfere o consentimento gravado e só então fala com o provedor. */
  async function redeRag(args: unknown[]): Promise<{ status: number; cabecalhos: Record<string, string>; corpoB64: string }> {
    const p = args[0] as { ws: string; host: string; caminho: string; metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; cabecalhos?: Record<string, string>; corpo?: string; porta?: number; timeout_ms?: number; max_bytes?: number };
    const c = ler(String(p.ws));
    if (c === null) throw new Error("consent_required");
    const host = hostDa(c.url);
    if (String(p.host).toLowerCase() !== host || !consentimentoOk(c)) throw new Error("consent_required");
    const r = await d.rede.requisitar({ host, caminho: p.caminho, metodo: p.metodo, ...(p.cabecalhos === undefined ? {} : { cabecalhos: p.cabecalhos }), ...(p.corpo === undefined ? {} : { corpo: p.corpo }), tokenDeConsentimento: tokenDoHost(host), ...(p.porta === undefined ? {} : { porta: p.porta }), timeout_ms: p.timeout_ms ?? 20_000, max_bytes: p.max_bytes ?? 32 * 1024 * 1024 });
    return { status: r.status, cabecalhos: r.cabecalhos, corpoB64: r.corpo.toString("base64") };
  }

  const sanitizar = (e: unknown, segredos: string[]): string => sanitizarErro(e instanceof Error ? e.message : "falha", segredos);

  // ---------------------------------------------------------------- progresso da migração (poll do worker → evento ao renderer)
  function acompanhar(ws: string, migracaoId: string): void {
    timersProgresso.get(migracaoId)?.cancelar();
    const passo = (): void => {
      void (async () => {
        try {
          const m = await d.lig.chamarWs<{ estado: EstadoMigracao; enviados: number; total: number } | null>(ws, "ragMigracao", [migracaoId], { timeoutMs: 3_000 });
          if (m === null) return;
          d.enviar("rag:migracao_progresso", { migracao_id: migracaoId, estado: m.estado, enviados: m.enviados, total: m.total });
          if (ESTADOS_TERMINAIS.has(m.estado) || encerrado) {
            timersProgresso.get(migracaoId)?.cancelar();
            timersProgresso.delete(migracaoId);
            const c = ler(ws);
            if (c !== null && (m.estado === "verificando" || m.estado === "concluida")) gravar(ws, { ...c, ultima_sincronizacao: new Date(agora()).toISOString(), offline: false });
          }
        } catch {
          /* sem worker: tenta de novo no próximo ciclo */
        }
      })();
    };
    timersProgresso.set(migracaoId, agendar(passo, INTERVALO_PROGRESSO_MS));
    passo(); // o primeiro retrato vai já (a migração pequena pode terminar antes do 1º ciclo)
  }

  // ---------------------------------------------------------------- manipuladores `rag:*`
  async function estadoDe(ws: string): Promise<EstadoBackendRag> {
    d.lig.workspace(ws);
    const c = ler(ws);
    const vazio: EstadoBackendRag = { provedor: null, url: null, host: null, colecao_remota: null, modo: "local", tipos: [...TIPOS_MIGRAVEIS_PADRAO], equipe_id: null, autor: null, projeto_id: null, segredos: {}, consentimento: null, offline: false, ultima_sincronizacao: null, pendentes_envio: 0, migracao_ativa: null };
    if (c === null) return vazio;
    let pendentes = 0;
    let ativa: EstadoBackendRag["migracao_ativa"] = null;
    try {
      pendentes = await d.lig.chamarWs<number>(ws, "ragPendentes", [], { timeoutMs: 3_000 });
      ativa = await d.lig.chamarWs<EstadoBackendRag["migracao_ativa"]>(ws, "ragMigracaoAtiva", [], { timeoutMs: 3_000 });
    } catch {
      /* worker indisponível: estado parcial */
    }
    return { provedor: c.provedor, url: c.url, host: hostDa(c.url), colecao_remota: c.colecao_remota, modo: c.modo, tipos: c.tipos, equipe_id: c.equipe_id, autor: c.autor, projeto_id: c.projeto_id, segredos: { ...c.mascarado }, consentimento: c.consentimento, offline: c.offline, ultima_sincronizacao: c.ultima_sincronizacao, pendentes_envio: pendentes, migracao_ativa: ativa };
  }

  async function configurar(p: PedidoConfigurarBackend): Promise<{ ok: boolean; mascarado: Record<string, string> }> {
    const w = d.lig.workspace(p.workspace_id);
    const anterior = ler(p.workspace_id);
    const url = normalizarUrlProvedor(p.provedor, p.url);
    const remote = await remoteGit(w.raiz).catch(() => null);
    const projeto_id = anterior?.projeto_id ?? projetoIdDoRemote(remote, w.nome);
    const candidata = { provedor: p.provedor, url, colecao_remota: p.colecao_remota, projeto_id, modo: p.modo, tipos: p.tipos };
    const v = validarConfig(candidata);
    if (!v.ok) throw new Error(v.erros.join("; "));
    // troca de provedor: as credenciais do anterior não ficam penduradas
    const trocou = anterior !== null && anterior.provedor !== p.provedor;
    if (trocou) for (const id of anterior.id_segredos) await d.cofre.apagar(id).catch(() => undefined);
    const base = trocou || anterior === null ? { ids: [] as string[], mascarado: {} as Record<string, string> } : { ids: anterior.id_segredos, mascarado: anterior.mascarado };
    const novos = await guardarSegredos(d.cofre, p.provedor, p.campos_secretos);
    const ids = [...new Set([...base.ids, ...novos.ids])];
    const mascarado = { ...base.mascarado, ...novos.mascarado };
    const destinoMudou = anterior === null || anterior.provedor !== p.provedor || hostDa(anterior.url) !== hostDa(url) || anterior.colecao_remota !== p.colecao_remota;
    if (anterior !== null && destinoMudou && anterior.consentimento !== null) revogarHost(hostDa(anterior.url));
    const nova: ConfigRagGravada = {
      provedor: p.provedor,
      url,
      colecao_remota: p.colecao_remota,
      modo: p.modo,
      tipos: p.tipos,
      equipe_id: p.equipe_id ?? null,
      autor: p.autor ?? null,
      projeto_id,
      id_segredos: ids,
      mascarado,
      // mudou o destino → o consentimento anterior não vale (pede de novo)
      consentimento: destinoMudou ? null : anterior.consentimento,
      ultima_sincronizacao: destinoMudou ? null : anterior.ultima_sincronizacao,
      ultimo_pull_ms: destinoMudou ? 0 : anterior.ultimo_pull_ms,
      offline: false,
    };
    gravar(p.workspace_id, nova);
    await aplicarReplicacao(p.workspace_id, nova);
    return { ok: true, mascarado };
  }

  const manipuladores: ManipuladoresRag = {
    "rag:backend_estado": ({ workspace_id }) => estadoDe(workspace_id),
    "rag:backend_provedores": () => listarProvedores(),
    "rag:backend_configurar": (p) => configurar(p),
    "rag:backend_testar": async (p): Promise<ResultadoTestarBackend> => {
      let provedor: string;
      let url: string;
      let colecao: string;
      let projeto: string;
      let segredos: Record<string, string>;
      let equipe: string | undefined;
      if ("usar_salvo" in p) {
        const c = exigir(p.workspace_id);
        provedor = c.provedor;
        url = c.url;
        colecao = c.colecao_remota;
        projeto = c.projeto_id;
        equipe = c.equipe_id ?? undefined;
        segredos = await segredosDe(c);
      } else {
        const w = d.lig.workspace(p.workspace_id);
        const anterior = ler(p.workspace_id);
        provedor = p.provedor;
        url = normalizarUrlProvedor(p.provedor, p.url);
        colecao = p.colecao_remota;
        projeto = anterior?.projeto_id ?? projetoIdDoRemote(await remoteGit(w.raiz).catch(() => null), w.nome);
        equipe = p.equipe_id;
        // o formulário pode omitir o que já está no cofre: completa com o salvo (mesmo provedor)
        const salvos = anterior !== null && anterior.provedor === p.provedor ? await segredosDe(anterior) : {};
        segredos = { ...salvos, ...p.campos_secretos };
      }
      let host: string;
      try {
        host = hostDa(url);
      } catch (e) {
        return { ok: false, motivo: sanitizar(e, Object.values(segredos)) };
      }
      // o clique em "Testar" é a ação do usuário que autoriza ESTA chamada (sem gravar nem criar coleção)
      testando.add(host);
      try {
        const transporte = criarTransporteRag({ rede: d.rede, consentimento: d.consentimento, hostsConsentidos: hostsConsentidos, tentativas: 2 });
        return await testarConexaoRag({ provedor, url, colecao_remota: colecao, segredos, transporte, projeto_id: projeto, ...(equipe === undefined ? {} : { equipe_id: equipe }) });
      } catch (e) {
        return { ok: false, motivo: sanitizar(e, Object.values(segredos)) };
      } finally {
        testando.delete(host);
        if (!hostsConsentidos().includes(host)) revogarHost(host);
      }
    },
    "rag:backend_esquecer_segredo": async ({ provedor }) => {
      let apagou = false;
      for (const ws of workspaces()) {
        const c = ler(ws);
        if (c === null || c.provedor !== provedor) continue;
        for (const id of c.id_segredos) await d.cofre.apagar(id).catch(() => undefined);
        gravar(ws, { ...c, id_segredos: [], mascarado: {}, modo: "local" });
        await aplicarReplicacao(ws, null);
        apagou = true;
      }
      return { ok: apagou || true };
    },
    "rag:migracao_previa": async ({ workspace_id, tipos }): Promise<PreviaMigracao> => {
      const c = exigir(workspace_id);
      const destino = destinoDe(c);
      const r = await d.lig.chamarWs<{ migracao_id: string; por_tipo: Record<string, { itens: number; bytes: number }>; total: number; amostra: Array<{ tipo: string; origem: string; trecho: string }>; avisos: string[]; estimativa_reembutir: number | null }>(
        workspace_id,
        "ragPrevia",
        [{ config: { provedor: c.provedor, url: c.url, colecao_remota: c.colecao_remota, projeto_id: c.projeto_id, equipe_id: c.equipe_id ?? undefined, tipos }, destino }],
        { timeoutMs: 30_000 },
      );
      migracaoWs.set(r.migracao_id, workspace_id);
      return { previa_id: r.migracao_id, por_tipo: r.por_tipo, total: r.total, amostra: r.amostra, avisos: r.avisos, estimativa_reembutir: r.estimativa_reembutir, destino: { ...destino, versao_politica: POLITICA_VERSAO } };
    },
    "rag:migracao_iniciar": async ({ workspace_id, previa_id, consentimento }) => {
      const c = exigir(workspace_id);
      const destino = destinoDe(c);
      const doc: ConsentimentoBackend = { provedor: consentimento.provedor, host: consentimento.host.toLowerCase(), colecao: consentimento.colecao, versao_politica: consentimento.versao_politica, em: new Date(agora()).toISOString() };
      // o consentimento tem de bater com o destino configurado AGORA e com a política vigente
      if (!consentimentoVale(doc, destino)) throw new Error("O consentimento não corresponde ao destino configurado. Revise e consinta de novo.");
      await d.lig.chamarWs(workspace_id, "ragConsentir", [previa_id, doc], { timeoutMs: 5_000 });
      const comConsentimento: ConfigRagGravada = { ...c, consentimento: doc, offline: false };
      gravar(workspace_id, comConsentimento);
      tokenDoHost(destino.host);
      await aplicarReplicacao(workspace_id, comConsentimento);
      const segredos = await segredosDe(comConsentimento);
      await d.lig.chamarWs(workspace_id, "ragMigrar", [previa_id, { config: { provedor: c.provedor, url: c.url, colecao_remota: c.colecao_remota, projeto_id: c.projeto_id, equipe_id: c.equipe_id ?? undefined, tipos: c.tipos }, segredos }], { timeoutMs: 10_000 });
      acompanhar(workspace_id, previa_id);
      return { migracao_id: previa_id };
    },
    "rag:migracao_pausar": async ({ migracao_id }) => {
      const ws = await achar(migracao_id);
      await d.lig.chamarWs(ws, "ragPausar", [migracao_id], { timeoutMs: 5_000 });
      return { ok: true };
    },
    "rag:migracao_retomar": async ({ migracao_id }) => {
      const ws = await achar(migracao_id);
      const c = exigir(ws);
      if (!consentimentoOk(c)) throw new Error("Sem consentimento válido para este destino.");
      const segredos = await segredosDe(c);
      await d.lig.chamarWs(ws, "ragMigrar", [migracao_id, { config: { provedor: c.provedor, url: c.url, colecao_remota: c.colecao_remota, projeto_id: c.projeto_id, equipe_id: c.equipe_id ?? undefined, tipos: c.tipos }, segredos }], { timeoutMs: 10_000 });
      acompanhar(ws, migracao_id);
      return { ok: true };
    },
    "rag:migracao_cancelar": async ({ migracao_id }) => {
      const ws = await achar(migracao_id);
      await d.lig.chamarWs(ws, "ragCancelar", [migracao_id], { timeoutMs: 5_000 });
      return { ok: true };
    },
    "rag:migracao_verificar": async ({ migracao_id }) => {
      const ws = await achar(migracao_id);
      const c = exigir(ws);
      if (!consentimentoOk(c)) throw new Error("Sem consentimento válido para este destino.");
      const segredos = await segredosDe(c);
      return d.lig.chamarWs(ws, "ragVerificar", [migracao_id, { config: { provedor: c.provedor, url: c.url, colecao_remota: c.colecao_remota, projeto_id: c.projeto_id, equipe_id: c.equipe_id ?? undefined, tipos: c.tipos }, segredos }], { timeoutMs: 120_000 });
    },
    "rag:voltar_para_local": async ({ workspace_id, baixar_do_remoto }) => {
      const c = exigir(workspace_id);
      if (baixar_do_remoto && c.modo === "compartilhado" && consentimentoOk(c)) await sincronizar(workspace_id, true).catch(() => undefined);
      // volta a `local`: nada sai; o consentimento é revogado (voltar a usar o online pede de novo); NADA local nem remoto é apagado
      const host = destinoDe(c).host;
      gravar(workspace_id, { ...c, modo: "local", consentimento: null, offline: false });
      await aplicarReplicacao(workspace_id, null);
      await d.lig.chamarWs(workspace_id, "ragLimparFila", [], { timeoutMs: 5_000 }).catch(() => undefined);
      if (!hostsConsentidos().includes(host)) revogarHost(host);
      return { ok: true };
    },
    "rag:sincronizar": ({ workspace_id }) => sincronizar(workspace_id, false),
    "rag:remoto_apagar": async ({ workspace_id, confirmacao }) => {
      const c = exigir(workspace_id);
      if (confirmacao !== c.colecao_remota) throw new Error("A confirmação digitada não confere com o nome da coleção remota.");
      if (!consentimentoOk(c)) throw new Error("Sem consentimento válido para este destino.");
      const segredos = await segredosDe(c);
      return d.lig.chamarWs(workspace_id, "ragApagarRemoto", [{ config: { provedor: c.provedor, url: c.url, colecao_remota: c.colecao_remota, projeto_id: c.projeto_id, equipe_id: c.equipe_id ?? undefined, tipos: c.tipos }, segredos }], { timeoutMs: 120_000 });
    },
  };

  /** Workspace dono de uma migração: o mapa da prévia ou, depois de reiniciar o app, o workspace cujo `conhecimento.db` conhece o id. */
  async function achar(migracaoId: string): Promise<string> {
    const conhecido = migracaoWs.get(migracaoId);
    if (conhecido !== undefined) return conhecido;
    for (const ws of workspaces()) {
      try {
        const m = await d.lig.chamarWs<unknown>(ws, "ragMigracao", [migracaoId], { timeoutMs: 3_000 });
        if (m !== null) {
          migracaoWs.set(migracaoId, ws);
          return ws;
        }
      } catch {
        /* tenta o próximo */
      }
    }
    throw new Error("migração desconhecida");
  }

  async function sincronizar(ws: string, tudo: boolean): Promise<{ enviados: number; recebidos: number }> {
    const c = exigir(ws);
    if (c.modo === "local" || !consentimentoOk(c)) return { enviados: 0, recebidos: 0 };
    const segredos = await segredosDe(c);
    const pedido = { config: { provedor: c.provedor, url: c.url, colecao_remota: c.colecao_remota, projeto_id: c.projeto_id, equipe_id: c.equipe_id ?? undefined, tipos: c.tipos }, segredos };
    const estado = estadoRepl(c);
    let enviados = 0;
    let recebidos = 0;
    try {
      const push = await d.lig.chamarWs<{ enviados: number; offline: boolean }>(ws, "ragEmpurrar", [pedido, estado], { timeoutMs: 120_000 });
      enviados = push.enviados;
      if (push.offline) throw new Error("offline");
      let ultimo = c.ultimo_pull_ms;
      if (c.modo === "compartilhado") {
        const pull = await d.lig.chamarWs<{ recebidos: number; modelo_divergente: boolean; ultimo_ms: number }>(ws, "ragPuxar", [pedido, estado, tudo ? 0 : c.ultimo_pull_ms], { timeoutMs: 120_000 });
        recebidos = pull.recebidos;
        ultimo = Math.max(ultimo, pull.ultimo_ms);
        if (pull.modelo_divergente) d.enviar("rag:aviso", { codigo: "modelo_divergente", mensagem: "A coleção compartilhada usa outro modelo de embedding; registros incompatíveis foram ignorados." });
      }
      gravar(ws, { ...(ler(ws) ?? c), ultima_sincronizacao: new Date(agora()).toISOString(), ultimo_pull_ms: ultimo, offline: false });
    } catch (e) {
      const atual = ler(ws) ?? c;
      if (!atual.offline) d.enviar("rag:aviso", { codigo: "offline", mensagem: `Sem conexão com o backend online: usando a cópia local${atual.ultima_sincronizacao === null ? "" : ` de ${atual.ultima_sincronizacao.slice(0, 10)}`}.` });
      gravar(ws, { ...atual, offline: true });
      d.aviso?.(`rag: sincronização falhou (${sanitizar(e, Object.values(segredos)).slice(0, 80)})`);
    }
    return { enviados, recebidos };
  }

  let timerSync: { cancelar(): void } | null = null;
  let ultimoPullPorWs = new Map<string, number>();
  return {
    manipuladores,
    metodosDoMain: { "rede.rag": (args) => redeRag(args) },
    aoAbrir: async (ws) => {
      const c = ler(ws);
      if (c !== null) await aplicarReplicacao(ws, c);
    },
    iniciar() {
      if (timerSync !== null || encerrado) return;
      timerSync = agendar(() => {
        void (async () => {
          for (const ws of workspaces()) {
            const c = ler(ws);
            if (c === null || c.modo === "local" || !consentimentoOk(c)) continue;
            const ultimo = ultimoPullPorWs.get(ws) ?? 0;
            const horaDoPull = c.modo === "compartilhado" && agora() - ultimo >= INTERVALO_PULL_MS;
            let pendentes = 0;
            try {
              pendentes = await d.lig.chamarWs<number>(ws, "ragPendentes", [], { timeoutMs: 3_000 });
            } catch {
              continue;
            }
            if (pendentes > 0 || horaDoPull) {
              if (horaDoPull) ultimoPullPorWs.set(ws, agora());
              await sincronizar(ws, false).catch(() => undefined);
            }
          }
        })();
      }, INTERVALO_SYNC_MS);
    },
    encerrar() {
      encerrado = true;
      timerSync?.cancelar();
      timerSync = null;
      for (const t of timersProgresso.values()) t.cancelar();
      timersProgresso.clear();
      ultimoPullPorWs = new Map();
    },
  };
}

export { criarArmazenamentoRag };
