// Serviço do catálogo (T-07.12): sem Electron. O main injeta o worker, a lixeira, o gerenciador de arquivos e os eventos. Sob demanda: nada roda no boot onda 1.
// Duas varreduras simultâneas coalescem em uma; o upsert acontece em fatias (≤ 100 itens por transação, `setImmediate` entre elas) para não segurar o event loop.
import { join, dirname } from "node:path";
import type {
  AchadoSaude, CliCatalogo, DetalheCatalogo, EstadoEmbarcada, EventoCatalogo, GatilhoVarredura, ItemCatalogo, PedidoDesinstalarCatalogo, PedidoInstalarCatalogo,
  PedidoListarCatalogo, PedidoPoliticaGravar, PedidoPoliticaPrevia, PedidoRevelarCatalogo, PedidoVarrer, PoliticaResolvida, PoliticaSkills,
  ResultadoInstalar, ResultadoListarCatalogo, ResultadoVerificarMcp, TipoCatalogo,
} from "../../compartilhado/catalogo";
import { CLIS_CATALOGO, TIPOS_CATALOGO } from "../../compartilhado/catalogo";
import type { RepoCatalogo } from "../banco/repos/catalogo";
import { definirOptOut, estadoEmbarcadas, hashesDasEmbarcadas, instalarEmbarcadas, type ContextoEmbarcadas, type Manifesto } from "./embarcadas/manifesto";
import { desinstalar, instalar, RAIZ_GLOBAL_SKILLS, type FsInstalacao } from "./instalacao";
import { lerConfigBruta, verificarServidor, type ListarFerramentas } from "./mcp-verificar";
import { nomeValido, normalizarNome } from "./normalizar";
import { NIVEL_POR_CLI, resolverPolitica, type EntradaPolitica } from "./politica";
import { raizesConhecidas, criarContexto } from "./raizes";
import { avaliarSaude } from "./saude";
import type { ClienteVarredura } from "./worker";

export class ErroCatalogo extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(mensagem);
    this.name = "ErroCatalogo";
  }
}

export interface DepsServicoCatalogo {
  repo: RepoCatalogo;
  /** cria o worker na primeira varredura (nunca antes) */
  cliente: () => ClienteVarredura;
  home: () => string;
  /** workspaces conhecidos (id + raiz) */
  workspaces: () => Array<{ id: string; raiz: string }>;
  manifesto: () => Promise<Manifesto>;
  dirSkills: () => string;
  emitir: (e: EventoCatalogo) => void;
  /** barramento de domínio (`catalog.*`, com ponto) */
  barramento?: (nome: string, payload: unknown) => void;
  lixeira?: (abs: string) => Promise<void>;
  revelar?: (abs: string) => void;
  /** perfil do membro de squad (skills/mcps permitidos), para a prévia de política por agente */
  membroDoAgente?: (agenteId: string) => { skills_permitidas: string[]; mcps_permitidos: string[] } | null;
  /** o workspace tem o método instalado? */
  metodoInstalado?: (workspaceId: string) => Promise<boolean>;
  listarFerramentasMcp?: ListarFerramentas;
  fsInstalacao?: FsInstalacao;
  agora?: () => string;
  plataforma?: NodeJS.Platform;
}

export interface ServicoCatalogo {
  varrer(p: PedidoVarrer, gatilho?: GatilhoVarredura): { varredura_id: string; pronta: Promise<void> };
  /** `true` se não há varredura nem dado recente (uso do gatilho ocioso/da tela). */
  precisaVarrer(idadeMaxMs: number): boolean;
  listar(p: PedidoListarCatalogo): ResultadoListarCatalogo;
  detalhe(itemId: string): DetalheCatalogo | null;
  instalar(p: PedidoInstalarCatalogo): Promise<ResultadoInstalar>;
  desinstalar(p: PedidoDesinstalarCatalogo): Promise<{ ok: boolean; codigo: string | null }>;
  limparAusentes(tipo: TipoCatalogo): { removidos: number };
  removerDoCatalogo(itemId: string): { ok: boolean };
  revelar(p: PedidoRevelarCatalogo): boolean;
  verificarMcp(itemId: string, confirmado: true): Promise<ResultadoVerificarMcp>;
  politicaLer(workspaceId: string): PoliticaSkills[];
  politicaGravar(p: PedidoPoliticaGravar): PoliticaSkills;
  politicaPrevia(p: PedidoPoliticaPrevia): Promise<PoliticaResolvida>;
  saude(workspaceId: string | null): AchadoSaude[];
  embarcadasEstado(): Promise<EstadoEmbarcada[]>;
  embarcadasInstalar(nome: string | null, cli: CliCatalogo): Promise<{ instaladas: string[]; preservadas_editadas: string[] }>;
  embarcadasOptOut(nome: string, cli: CliCatalogo, valor: boolean): Promise<{ ok: true }>;
  encerrar(): Promise<void>;
}

const FATIA = 100;
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

export function criarServicoCatalogo(d: DepsServicoCatalogo): ServicoCatalogo {
  const agora = d.agora ?? ((): string => new Date().toISOString());
  let clienteVivo: ClienteVarredura | null = null;
  let correndo: { id: string; pronta: Promise<void>; cancelar: () => void } | null = null;
  let ultimaConclusaoMs = 0;

  const baseAbs = (base: "home" | "workspace", ws: string | null): string | null => {
    if (base === "home") return d.home();
    const w = d.workspaces().find((x) => x.id === ws);
    return w === undefined ? null : w.raiz;
  };

  const resolverContexto = async (ws: string | null): Promise<ContextoEmbarcadas> => ({ repo: d.repo, home: d.home(), dirSkills: d.dirSkills(), manifesto: await d.manifesto(), agora });

  async function executar(p: PedidoVarrer, gatilho: GatilhoVarredura, id: string, inicio: string): Promise<void> {
    const cliente = (clienteVivo ??= d.cliente());
    const manifesto = await d.manifesto();
    const ws = p.workspace_id === null ? d.workspaces() : d.workspaces().filter((w) => w.id === p.workspace_id);
    let adicionados = 0;
    let atualizados = 0;
    const idsMudados = new Set<string>();
    const tiposMudados = new Set<TipoCatalogo>();
    let total = 0;
    const exec = cliente.varrer(
      { home: d.home(), workspaces: ws, tipos: p.tipos, clis: p.clis, embarcadas: hashesDasEmbarcadas(manifesto) },
      {
        onProgresso: (pr) => d.emitir({ tipo_evento: "progresso", versao: 1, varredura_id: id, cli: pr.cli, tipo: pr.tipo, feitos: pr.feitos, total: pr.total }),
        onLote: async (itens) => {
          for (let i = 0; i < itens.length; i += FATIA) {
            const r = d.repo.upsertLote(itens.slice(i, i + FATIA), inicio);
            adicionados += r.adicionados;
            atualizados += r.atualizados;
            total += itens.length;
            for (const x of r.ids) idsMudados.add(x);
            for (const it of itens.slice(i, i + FATIA)) tiposMudados.add(it.tipo);
            await tick();
          }
        },
      },
    );
    if (correndo !== null) correndo.cancelar = (): void => cliente.cancelar(exec.id);
    const r = await exec.resultado;
    let ausentes = 0;
    if (!r.cancelada) ausentes = d.repo.marcarAusentes(inicio, r.cobertura);
    d.repo.concluirVarredura(id, { duracao_ms: r.duracao_ms, adicionados, atualizados, ausentes, erros_json: JSON.stringify(r.erros.slice(0, 50)) });
    ultimaConclusaoMs = Date.now();
    d.emitir({ tipo_evento: "concluido", versao: 1, varredura_id: id, adicionados, atualizados, ausentes, duracao_ms: r.duracao_ms, erros: r.erros.map((e) => ({ cli: e.cli, tipo: e.tipo, codigo: e.codigo, mensagem: e.mensagem })) });
    if (adicionados + atualizados + ausentes > 0) {
      d.emitir({ tipo_evento: "mudou", versao: 1, tipos: [...(tiposMudados.size === 0 ? new Set<TipoCatalogo>(TIPOS_CATALOGO) : tiposMudados)], item_ids: idsMudados.size > 200 ? [] : [...idsMudados] });
      d.barramento?.("catalog.changed", { adicionados, atualizados, ausentes });
    }
    d.barramento?.("catalog.scanned", { varredura_id: id, gatilho, adicionados, atualizados, ausentes, total });
  }

  const caminhoDaInstalacao = (i: { base: "home" | "workspace"; workspace_id: string | null; caminho_rel: string }): string | null => {
    const b = baseAbs(i.base, i.workspace_id);
    if (b === null || i.caminho_rel.includes("..")) return null;
    return join(b, ...i.caminho_rel.split("/"));
  };

  const pastaDaSkill = (abs: string): string => (abs.endsWith("SKILL.md") ? dirname(abs) : abs);

  return {
    varrer(p, gatilho = "manual") {
      if (correndo !== null) return { varredura_id: correndo.id, pronta: correndo.pronta };
      const inicio = agora();
      const id = d.repo.iniciarVarredura(gatilho, inicio);
      const slot = { id, pronta: Promise.resolve(), cancelar: (): void => undefined };
      correndo = slot;
      slot.pronta = executar(p, gatilho, id, inicio)
        .catch((e: unknown) => {
          d.repo.concluirVarredura(id, { duracao_ms: 0, adicionados: 0, atualizados: 0, ausentes: 0, erros_json: JSON.stringify([{ cli: null, tipo: null, codigo: "varredura_falhou", mensagem: e instanceof Error ? e.name : "erro" }]) });
          d.emitir({ tipo_evento: "concluido", versao: 1, varredura_id: id, adicionados: 0, atualizados: 0, ausentes: 0, duracao_ms: 0, erros: [{ cli: null, tipo: null, codigo: "varredura_falhou", mensagem: "A varredura falhou" }] });
        })
        .finally(() => {
          correndo = null;
        });
      return { varredura_id: id, pronta: slot.pronta };
    },
    precisaVarrer(idadeMaxMs) {
      if (correndo !== null) return false;
      const u = d.repo.ultimaVarredura();
      if (u === null) return true;
      return Date.now() - Date.parse(u.iniciada_em) > idadeMaxMs;
    },

    listar(p) {
      const r = d.repo.listarPorTipo(p.tipo, p.workspace_id);
      return { itens: r.itens, truncado: r.truncado, ultima_varredura_em: d.repo.ultimaVarredura()?.iniciada_em ?? null };
    },
    detalhe(itemId) {
      const it = d.repo.obter(itemId, 600);
      if (it === null) return null;
      return { ...it, ferramentas: it.tipo === "mcp_server" ? d.repo.ferramentasMcp(itemId) : [] };
    },

    async instalar(p) {
      if (p.de_cli === p.para_cli) return { estado: "erro", caminho_rel: null, codigo: "mesma_cli" };
      const raizRel = RAIZ_GLOBAL_SKILLS[p.para_cli];
      if (raizRel === null) return { estado: "erro", caminho_rel: null, codigo: "cli_sem_skills" };
      const it = d.repo.obter(p.item_id, 600);
      if (it === null) return { estado: "erro", caminho_rel: null, codigo: "item_inexistente" };
      if (it.tipo !== "skill") return { estado: "erro", caminho_rel: null, codigo: "tipo_nao_suportado" };
      if (it.origem === "metodo") return { estado: "erro", caminho_rel: null, codigo: "gerenciado_pelo_metodo" };
      const fonte = it.instalacoes.filter((i) => i.cli === p.de_cli && i.estado === "presente").sort((a, b) => (a.escopo === "global" ? -1 : 1) - (b.escopo === "global" ? -1 : 1))[0];
      if (fonte === undefined) return { estado: "erro", caminho_rel: null, codigo: "fonte_ausente" };
      const abs = caminhoDaInstalacao(fonte);
      if (abs === null) return { estado: "erro", caminho_rel: null, codigo: "fonte_ausente" };
      const ctx = criarContexto({ home: d.home(), workspaces: d.workspaces() });
      const raizes = await raizesConhecidas(ctx);
      const raizDestinoAbs = join(d.home(), ...raizRel.split("/"));
      const r = await instalar({ fonteAbs: pastaDaSkill(abs), raizDestinoAbs, modo: p.modo, raizesConhecidas: raizes, ...(d.plataforma === undefined ? {} : { plataforma: d.plataforma }), ...(d.fsInstalacao === undefined ? {} : { fs: d.fsInstalacao }) });
      if (r.estado === "instalado" || r.estado === "ja_instalado") {
        const nome = r.caminho_rel ?? it.nome;
        const t = agora();
        d.repo.gravarInstalacao(it.id, {
          cli: p.para_cli, escopo: "global", workspace_id: "", base: "home", caminho_rel: `${raizRel}/${nome}/SKILL.md`, metodo: r.metodo ?? p.modo, estado: "presente", habilitada: true,
          criado_pelo_app: r.estado === "instalado", hash_conteudo: fonte.hash_conteudo, tamanho: null, mtime_ms: null, detalhe: {},
        }, t);
        if (r.estado === "instalado") {
          d.emitir({ tipo_evento: "mudou", versao: 1, tipos: ["skill"], item_ids: [it.id] });
          d.barramento?.("catalog.installed", { item_id: it.id, cli: p.para_cli });
        }
      }
      return { estado: r.estado, caminho_rel: r.caminho_rel === null ? null : `${raizRel}/${r.caminho_rel}`, codigo: r.codigo };
    },

    async desinstalar(p) {
      const it = d.repo.obter(p.item_id, 160);
      if (it === null) return { ok: false, codigo: "item_inexistente" };
      const inst = d.repo.obterInstalacao(p.item_id, p.cli, p.escopo, p.workspace_id ?? "");
      if (inst === null) return { ok: false, codigo: "instalacao_inexistente" };
      if (it.tipo !== "skill") return { ok: false, codigo: "tipo_nao_suportado" };
      const abs = caminhoDaInstalacao(inst);
      const raizRel = RAIZ_GLOBAL_SKILLS[p.cli];
      if (abs === null || raizRel === null) return { ok: false, codigo: "destino_invalido" };
      const raizDestinoAbs = inst.escopo === "global" ? join(d.home(), ...raizRel.split("/")) : dirname(pastaDaSkill(abs));
      const r = await desinstalar({
        destinoAbs: pastaDaSkill(abs), raizDestinoAbs, modo: p.modo, criado_pelo_app: inst.criado_pelo_app, metodo: inst.metodo, hash_registrado: inst.hash_conteudo,
        origem: it.origem, plugin: it.plugin, ...(d.lixeira === undefined ? {} : { lixeira: d.lixeira }), ...(d.fsInstalacao === undefined ? {} : { fs: d.fsInstalacao }),
      });
      if (r.ok) {
        d.repo.removerInstalacao(p.item_id, p.cli, p.escopo, p.workspace_id ?? "");
        d.emitir({ tipo_evento: "mudou", versao: 1, tipos: ["skill"], item_ids: [p.item_id] });
      }
      return r;
    },

    limparAusentes(tipo) {
      const removidos = d.repo.limparAusentes(tipo);
      if (removidos > 0) d.emitir({ tipo_evento: "mudou", versao: 1, tipos: [tipo], item_ids: [] });
      return { removidos };
    },
    removerDoCatalogo(itemId) {
      const ok = d.repo.removerItem(itemId);
      if (ok) d.emitir({ tipo_evento: "mudou", versao: 1, tipos: [...TIPOS_CATALOGO], item_ids: [] });
      return { ok };
    },
    revelar(p) {
      const inst = d.repo.obterInstalacao(p.item_id, p.cli, p.escopo, p.workspace_id ?? "");
      if (inst === null || d.revelar === undefined) return false;
      const abs = caminhoDaInstalacao(inst);
      if (abs === null) return false;
      d.revelar(abs);
      return true;
    },

    async verificarMcp(itemId, confirmado) {
      if (confirmado !== true) throw new ErroCatalogo("confirmacao_exigida", "A verificação exige confirmação.");
      const it = d.repo.obter(itemId, 160);
      if (it === null || it.tipo !== "mcp_server") return { estado: "indisponivel", ferramentas: 0, erro: "item_inexistente" };
      for (const inst of it.instalacoes.filter((i) => i.estado === "presente")) {
        const abs = caminhoDaInstalacao(inst);
        if (abs === null) continue;
        const cfg = await lerConfigBruta({ cli: inst.cli, nome: it.nome, arquivoAbs: abs });
        if (cfg === null) continue;
        const r = await verificarServidor(cfg, d.listarFerramentasMcp);
        if (r.estado === "ok") d.repo.gravarFerramentasMcp(itemId, r.lista, agora());
        return { estado: r.estado, ferramentas: r.ferramentas, erro: r.erro };
      }
      return { estado: "indisponivel", ferramentas: 0, erro: "configuracao_nao_encontrada" };
    },

    politicaLer: (ws) => d.repo.listarPoliticas(ws),
    politicaGravar(p) {
      for (const s of p.skills) if (!s.startsWith("grupo:") && !nomeValido(normalizarBruto(s))) throw new ErroCatalogo("skill_invalida", "Nome de skill inválido.");
      return d.repo.gravarPolitica({ workspace_id: p.workspace_id, alvo_tipo: p.alvo_tipo, alvo_valor: p.alvo_valor, skills: [...new Set(p.skills)], mcp_do_usuario: p.mcp_do_usuario, servidores_mcp: [...new Set(p.servidores_mcp)] }, agora());
    },
    async politicaPrevia(p) {
      const itens = d.repo.listarPorTipo("skill", p.workspace_id).itens;
      const entrada: EntradaPolitica = {
        modo: p.modo, papel: p.papel, agente_id: p.agente_id, mission_id: p.mission_id, cli: p.cli, pedidas: null,
        politicas: d.repo.listarPoliticas(p.workspace_id),
        skillsDoCatalogo: itens.filter((i) => i.instalacoes.some((x) => x.estado === "presente")).map((i) => ({ nome_normalizado: i.nome_normalizado, nome: i.nome, origem: i.origem, plugin: i.plugin })),
        metodoInstalado: (await d.metodoInstalado?.(p.workspace_id)) ?? false,
        missaoComMetodo: p.mission_id !== null,
        membro: p.agente_id === null ? null : (d.membroDoAgente?.(p.agente_id) ?? null),
      };
      const { recusadas: _r, ...resto } = resolverPolitica(entrada);
      return resto;
    },

    saude(workspaceId) {
      const skills = d.repo.listarPorTipo("skill", workspaceId).itens;
      const mcps = d.repo.listarPorTipo("mcp_server", workspaceId).itens;
      return avaliarSaude({
        politicas: workspaceId === null ? [] : d.repo.listarPoliticas(workspaceId),
        itens: [...skills, ...mcps],
        skillsPresentes: d.repo.nomesPresentes("skill", workspaceId),
        mcpVerificados: new Set(mcps.filter((m) => d.repo.ferramentasMcp(m.id).length > 0).map((m) => m.id)),
        niveis: NIVEL_POR_CLI,
        clisEmUso: [],
      });
    },

    async embarcadasEstado() {
      return estadoEmbarcadas(await resolverContexto(null));
    },
    async embarcadasInstalar(nome, cli) {
      const r = await instalarEmbarcadas(await resolverContexto(null), nome, cli);
      if (r.instaladas.length > 0) d.emitir({ tipo_evento: "mudou", versao: 1, tipos: ["skill"], item_ids: [] });
      return r;
    },
    async embarcadasOptOut(nome, cli, valor) {
      definirOptOut(await resolverContexto(null), nome, cli, valor);
      return { ok: true };
    },

    async encerrar() {
      correndo?.cancelar();
      await clienteVivo?.encerrar().catch(() => undefined);
      clienteVivo = null;
    },
  };
}

function normalizarBruto(s: string): string {
  return normalizarNome(s);
}

export { CLIS_CATALOGO };
export type { ItemCatalogo };
