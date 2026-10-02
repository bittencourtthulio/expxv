// Agregador do gateway MCP (Fase 7C): um endpoint, N servidores da Loja. Puro em relação a Electron/banco/rede: tudo entra por portas (`DepsAgregador`).
// Garantias: (1) o Pane só enxerga servidores do SEU snapshot e ferramentas que passam no filtro; o filtro é refeito a CADA chamada (lista antiga não vale);
// (2) rate limit por Pane; (3) auditoria sem argumentos nem resultados (só tamanhos); (4) descrição/esquema de terceiro saneados; (5) servidor stdio parado
// por ociosidade e reconectado sob demanda; (6) chamada nunca é repetida automaticamente (pode ter efeito colateral).
import { createHash } from "node:crypto";
import { ErroMcp, argumentoInvalido, naoEncontrado, indisponivel, violacaoDeRegra } from "../mcp/erros";
import type { EventoGateway } from "../../compartilhado/catalogo";
import { decidirFerramenta, indexarRegras } from "./politica";
import { criarLimitador } from "./limite";
import { riscoDaFerramenta } from "./risco";
import { idDeServidorValido, nomeExposto, nomeValidoDeFerramenta, sanearEsquema, sanearTexto } from "./sanear";
import { TOOL_BUSCA, TOOL_CHAMADA, buscarFerramentas, montarSuperficie, type DefinicaoTool } from "./superficie";
import type { ClienteServidor, ConfigGateway, Conectar, EntradaAuditoria, FerramentaExposta, FerramentaRemota, RegraFiltro, ResultadoFerramenta, SnapshotGateway } from "./tipos";

export const MAX_ARGUMENTOS_BYTES = 256 * 1024;
export const MAX_SAIDA_BYTES = 256 * 1024;
export const TTL_FERRAMENTAS_MS = 5 * 60_000;
export const TEMPO_CHAMADA_MS = 30_000;

export interface DepsAgregador {
  /** snapshot VIVO do Pane (o main confere que o Pane existe); `null` = sem acesso */
  snapshot(paneId: string): SnapshotGateway | null;
  config(workspaceId: string): Pick<ConfigGateway, "ativo" | "modo_superficie" | "max_ferramentas" | "limite_por_min" | "ocioso_s">;
  regras(workspaceId: string): readonly RegraFiltro[];
  conectar: Conectar;
  auditar(e: EntradaAuditoria): void;
  evento?(e: EventoGateway): void;
  agora?: () => number;
  ttlFerramentasMs?: number;
  tempoChamadaMs?: number;
  maxSaidaBytes?: number;
}

export interface ContadoresGateway { chamadas: number; bloqueadas: number; limitadas: number }

export interface Agregador {
  listar(paneId: string): Promise<{ tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }>;
  chamar(paneId: string, nome: string, args: Record<string, unknown>): Promise<ResultadoFerramenta>;
  /** ferramentas do servidor para a tela (todas, com o risco), já saneadas */
  ferramentasDoServidor(servidorId: string, raiz: string | null, ocioso_s: number): Promise<FerramentaExposta[]>;
  invalidar(servidorId: string): void;
  revogarPane(paneId: string): void;
  contadores(): ContadoresGateway;
  servidoresConectados(): number;
  encerrar(): Promise<void>;
}

interface Entrada {
  chave: string;
  servidorId: string;
  cliente: Promise<ClienteServidor>;
  expostas: { em: number; lista: FerramentaExposta[] } | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const hash = (s: string): string => createHash("sha256").update(s).digest("hex");

export function criarAgregador(d: DepsAgregador): Agregador {
  const agora = d.agora ?? Date.now;
  const ttl = d.ttlFerramentasMs ?? TTL_FERRAMENTAS_MS;
  const tempoChamada = d.tempoChamadaMs ?? TEMPO_CHAMADA_MS;
  const maxSaida = d.maxSaidaBytes ?? MAX_SAIDA_BYTES;
  const limitador = criarLimitador();
  const pool = new Map<string, Entrada>();
  const c: ContadoresGateway = { chamadas: 0, bloqueadas: 0, limitadas: 0 };

  const chaveDe = (id: string, raiz: string | null): string => `${id}\u0000${raiz ?? ""}`;

  function armar(e: Entrada, ocioso_s: number): void {
    if (e.timer !== null) clearTimeout(e.timer);
    e.timer = setTimeout(() => { void fecharEntrada(e, true); }, ocioso_s * 1000);
    e.timer.unref();
  }
  async function fecharEntrada(e: Entrada, porOcio: boolean): Promise<void> {
    if (pool.get(e.chave) === e) pool.delete(e.chave);
    if (e.timer !== null) { clearTimeout(e.timer); e.timer = null; }
    const cli = await e.cliente.catch(() => null);
    if (cli !== null) await cli.fechar().catch(() => undefined);
    if (porOcio) d.evento?.({ versao: 1, tipo: "servidor_encerrado_ocioso", servidor_id: e.servidorId });
  }

  function obter(servidorId: string, raiz: string | null, ocioso_s: number): Entrada {
    const chave = chaveDe(servidorId, raiz);
    let e = pool.get(chave);
    if (e === undefined) {
      const nova: Entrada = { chave, servidorId, cliente: d.conectar(servidorId, { raiz }), expostas: null, timer: null };
      nova.cliente.catch(() => { if (pool.get(chave) === nova) pool.delete(chave); });
      pool.set(chave, nova);
      e = nova;
    }
    armar(e, ocioso_s);
    return e;
  }

  function expor(servidorId: string, lista: FerramentaRemota[]): FerramentaExposta[] {
    const vistos = new Set<string>();
    const saida: FerramentaExposta[] = [];
    for (const f of lista) {
      const nomeReal = nomeValidoDeFerramenta(f.nome);
      if (nomeReal === null) continue;
      const nome = nomeExposto(servidorId, nomeReal, hash);
      if (vistos.has(nome)) continue;
      vistos.add(nome);
      saida.push({ nome, servidor_id: servidorId, ferramenta: nomeReal, descricao: sanearTexto(f.descricao, 400), esquema: sanearEsquema(f.esquema), risco: riscoDaFerramenta(f) });
    }
    return saida;
  }

  async function ferramentasDoServidor(servidorId: string, raiz: string | null, ocioso_s: number): Promise<FerramentaExposta[]> {
    if (!idDeServidorValido(servidorId)) return [];
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const e = obter(servidorId, raiz, ocioso_s);
      if (e.expostas !== null && agora() - e.expostas.em < ttl) return e.expostas.lista;
      try {
        const cli = await e.cliente;
        const lista = expor(servidorId, await cli.listarFerramentas());
        e.expostas = { em: agora(), lista };
        return lista;
      } catch {
        await fecharEntrada(e, false); // conexão ruim: descarta e tenta de novo uma vez
      }
    }
    return [];
  }

  /** Ferramentas permitidas AGORA para o Pane (snapshot ∩ filtro). */
  async function permitidas(snap: SnapshotGateway, cfg: ReturnType<DepsAgregador["config"]>): Promise<FerramentaExposta[]> {
    const regras = indexarRegras(d.regras(snap.workspace_id));
    const porServidor = await Promise.all(snap.servidores.map((id) => ferramentasDoServidor(id, snap.raiz, cfg.ocioso_s)));
    const saida: FerramentaExposta[] = [];
    for (const lista of porServidor) {
      for (const f of lista) {
        if (decidirFerramenta({ modo: snap.modo, papel: snap.papel, servidor_id: f.servidor_id, ferramenta: f.ferramenta, risco: f.risco, regras }).permitida) saida.push(f);
      }
    }
    return saida;
  }

  function auditar(snap: SnapshotGateway, p: Omit<EntradaAuditoria, "workspace_id" | "pane_id" | "papel">): void {
    try {
      d.auditar({ workspace_id: snap.workspace_id, pane_id: snap.pane_id, papel: snap.papel, ...p });
    } catch { /* auditoria nunca derruba a chamada */ }
    d.evento?.({ versao: 1, tipo: "chamada", pane_id: snap.pane_id, servidor_id: p.servidor_id, ferramenta: p.ferramenta, decisao: p.decisao });
  }

  function limitarSaida(r: ResultadoFerramenta): ResultadoFerramenta {
    let restante = maxSaida;
    const content: ResultadoFerramenta["content"] = [];
    for (const item of r.content) {
      const texto = typeof item.text === "string" ? item.text : "";
      const bytes = Buffer.byteLength(texto);
      if (bytes <= restante) { content.push({ type: "text", text: texto }); restante -= bytes; continue; }
      const corte = Buffer.from(texto).subarray(0, Math.max(0, restante)).toString("utf8").replace(/�$/, "");
      content.push({ type: "text", text: `${corte}\n[saída cortada pelo gateway: limite de ${Math.round(maxSaida / 1024)} KB]` });
      break;
    }
    return { content, isError: r.isError };
  }

  async function chamarFerramenta(snap: SnapshotGateway, cfg: ReturnType<DepsAgregador["config"]>, nome: string, args: Record<string, unknown>): Promise<ResultadoFerramenta> {
    const visiveis = await permitidas(snap, cfg);
    const alvo = visiveis.find((f) => f.nome === nome);
    const bytesEntrada = Buffer.byteLength(JSON.stringify(args));
    if (alvo === undefined) {
      c.bloqueadas++;
      auditar(snap, { servidor_id: null, ferramenta: sanearTexto(nome, 64) || null, decisao: "negada_filtro", duracao_ms: null, bytes_entrada: bytesEntrada, bytes_saida: null });
      throw violacaoDeRegra("forbidden_role", "Esta ferramenta não está disponível para este Pane.");
    }
    const inicio = agora();
    const e = obter(alvo.servidor_id, snap.raiz, cfg.ocioso_s);
    try {
      const cli = await e.cliente;
      const bruto = await Promise.race([
        cli.chamar(alvo.ferramenta, args, tempoChamada),
        new Promise<never>((_, rej) => { const t = setTimeout(() => rej(new Error("tempo")), tempoChamada + 500); t.unref(); }),
      ]);
      const r = limitarSaida(bruto);
      c.chamadas++;
      auditar(snap, { servidor_id: alvo.servidor_id, ferramenta: alvo.ferramenta, decisao: "permitida", duracao_ms: agora() - inicio, bytes_entrada: bytesEntrada, bytes_saida: r.content.reduce((n, i) => n + Buffer.byteLength(i.text), 0) });
      return r;
    } catch {
      await fecharEntrada(e, false); // próxima chamada reconecta; esta NÃO é repetida
      auditar(snap, { servidor_id: alvo.servidor_id, ferramenta: alvo.ferramenta, decisao: "erro", duracao_ms: agora() - inicio, bytes_entrada: bytesEntrada, bytes_saida: null });
      throw indisponivel("O servidor MCP não respondeu. Tente de novo.");
    }
  }

  return {
    async listar(paneId) {
      const snap = d.snapshot(paneId);
      if (snap === null) return { tools: [] };
      const cfg = d.config(snap.workspace_id);
      if (!cfg.ativo) return { tools: [] };
      const lista = await permitidas(snap, cfg);
      return { tools: montarSuperficie(lista, cfg) as DefinicaoTool[] };
    },

    async chamar(paneId, nome, args) {
      const snap = d.snapshot(paneId);
      if (snap === null) throw indisponivel("O gateway não está disponível para este Pane.");
      const cfg = d.config(snap.workspace_id);
      if (!cfg.ativo) throw indisponivel("O gateway está desligado neste workspace.");
      if (typeof nome !== "string" || nome === "" || nome.length > 64) throw argumentoInvalido("Nome de ferramenta inválido.");
      if (Buffer.byteLength(JSON.stringify(args)) > MAX_ARGUMENTOS_BYTES) throw new ErroMcp("too_large", "Argumentos grandes demais.");
      if (!limitador.tentar(paneId, cfg.limite_por_min, agora())) {
        c.limitadas++;
        auditar(snap, { servidor_id: null, ferramenta: null, decisao: "negada_limite", duracao_ms: null, bytes_entrada: null, bytes_saida: null });
        throw violacaoDeRegra("limit_reached", "rate_limited: limite de chamadas por minuto do gateway atingido.");
      }
      if (cfg.modo_superficie === "busca") {
        if (nome === TOOL_BUSCA) {
          const achados = buscarFerramentas(await permitidas(snap, cfg), args["query"], args["limit"]);
          return { content: [{ type: "text", text: JSON.stringify({ tools: achados }) }], isError: false };
        }
        if (nome !== TOOL_CHAMADA) throw naoEncontrado("Use gateway_search e gateway_call.");
        const alvo = args["name"];
        const interno = args["arguments"];
        if (typeof alvo !== "string") throw argumentoInvalido("`name` é obrigatório.");
        if (interno !== undefined && (typeof interno !== "object" || interno === null || Array.isArray(interno))) throw argumentoInvalido("`arguments` deve ser um objeto.");
        return chamarFerramenta(snap, cfg, alvo, (interno ?? {}) as Record<string, unknown>);
      }
      return chamarFerramenta(snap, cfg, nome, args);
    },

    ferramentasDoServidor,

    invalidar(servidorId) {
      for (const e of [...pool.values()]) if (e.servidorId === servidorId) void fecharEntrada(e, false);
    },
    revogarPane(paneId) {
      limitador.esquecer(paneId);
    },
    contadores: () => ({ ...c }),
    servidoresConectados: () => pool.size,
    async encerrar() {
      await Promise.all([...pool.values()].map((e) => fecharEntrada(e, false)));
    },
  };
}
