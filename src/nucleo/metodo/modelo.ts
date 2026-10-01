import type { Descoberta, TrabalhoDescoberto } from "./descoberta";
import { montarGrafo, type NoGrafo } from "./grafo";
import { verificarViolacoes } from "./regras";
import { calcularSinaleira } from "./sinaleira";
import type {
  Artefato, Bloqueio, Entrega, EventoRastro, Fase, FeatureProjeto, Ferramenta, GrafoPlano, Sprint, StatusTask,
  StatusTrabalho, SuiteTask, Task, Trabalho, VereditoTexto,
} from "./tipos";

export interface EntradaModelo {
  descoberta: Descoberta;
  /** artefatos já lidos, por caminho relativo. */
  artefatos: Map<string, Artefato>;
  /** rastro por trabalho_id. */
  eventos: Map<string, EventoRastro[]>;
  /** relógio injetado (epoch ms). */
  agora: number;
  diasBloqueio?: number;
}

type Dados = Record<string, unknown>;

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const dicionario = (v: unknown): Dados | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Dados) : null);
const data = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : txt(v));
const STATUS_TASK: readonly string[] = ["pendente", "em_andamento", "concluida", "bloqueada"];
const STATUS_TRAB: readonly string[] = ["nao_iniciado", "em_andamento", "bloqueado", "concluido"];
const SUITES: readonly string[] = ["verde", "vermelha", "parcial", "nao_executada"];

const SEM_GRAFO: GrafoPlano = { nos: [], arestas: [], ciclos: [], dependencias_inexistentes: [], caminho_critico: [], prontas: [] };

function statusDeTasks(tasks: Task[], declarado: StatusTrabalho): StatusTrabalho {
  if (tasks.length === 0) return declarado;
  if (tasks.every((t) => t.status === "concluida")) return "concluido";
  if (tasks.some((t) => t.status === "em_andamento")) return "em_andamento";
  if (tasks.some((t) => t.status === "bloqueada")) return "bloqueado";
  if (tasks.some((t) => t.status === "concluida")) return "em_andamento";
  return "nao_iniciado";
}

function normalizarTask(o: Dados, arquivo: string): Task | null {
  const id = txt(o.id);
  if (!id) return null;
  const status = typeof o.status === "string" && STATUS_TASK.includes(o.status) ? (o.status as StatusTask) : "pendente";
  const suite = typeof o.suite === "string" && SUITES.includes(o.suite) ? (o.suite as SuiteTask) : "nao_executada";
  return {
    id,
    titulo: txt(o.titulo) ?? id,
    fase: txt(o.fase),
    status,
    depende_de: lista(o.depende_de),
    paralelizavel: o.paralelizavel === true,
    suite,
    concluida_em: data(o.concluida_em),
    objetivo: txt(o.objetivo),
    criterio_aceite: txt(o.criterio_aceite),
    teste_integracao: typeof o.teste_integracao === "string" ? o.teste_integracao : null,
    teste_funcional: typeof o.teste_funcional === "string" ? o.teste_funcional : null,
    teste_regressao: typeof o.teste_regressao === "string" ? o.teste_regressao : null,
    arquivo,
    duracao_observada_ms: null,
  };
}

function objetos(v: unknown): Dados[] {
  return Array.isArray(v) ? v.map(dicionario).filter((x): x is Dados => x !== null) : [];
}

function montarSprints(td: TrabalhoDescoberto, art: (c: string) => Artefato | undefined): Sprint[] {
  const padrao = new RegExp(`^${td.pasta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(sprint-[^/]+)/(sprint|fases|tasks)\\.md$`);
  const porSprint = new Map<string, Partial<Record<"sprint" | "fases" | "tasks", Artefato>>>();
  for (const c of td.arquivos) {
    const m = padrao.exec(c);
    const a = art(c);
    if (!m?.[1] || !m[2] || !a) continue;
    const g = porSprint.get(m[1]) ?? {};
    g[m[2] as "sprint" | "fases" | "tasks"] = a;
    porSprint.set(m[1], g);
  }
  const nomes = [...porSprint.keys()].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return nomes.map((dir) => {
    const g = porSprint.get(dir) ?? {};
    const sd = g.sprint?.dados ?? dicionario(g.tasks?.dados?.sprint) ?? {};
    const arqTasks = g.tasks?.caminho ?? g.fases?.caminho ?? g.sprint?.caminho ?? `${td.pasta}/${dir}/tasks.md`;
    const arqFases = g.fases?.caminho ?? arqTasks;
    const tasks = objetos(g.tasks?.dados?.tasks)
      .map((o) => normalizarTask(o, arqTasks))
      .filter((t): t is Task => t !== null);
    const declaradas = objetos(g.fases?.dados?.fases ?? g.tasks?.dados?.fases).filter((f) => txt(f.id));

    const fases: Fase[] = declaradas.map((f) => ({
      id: txt(f.id) as string,
      titulo: txt(f.titulo) ?? (txt(f.id) as string),
      status: STATUS_TRAB.includes(String(f.status)) ? (f.status as StatusTrabalho) : "nao_iniciado",
      criterio_saida: txt(f.criterio_saida),
      paralelizavel: f.paralelizavel === true,
      paralela_com: lista(f.paralela_com),
      tasks: [],
      arquivo: arqFases,
      declarada: true,
    }));
    const listadas = new Map(declaradas.map((f) => [txt(f.id) as string, lista(f.tasks)]));
    for (const t of tasks) {
      let alvo = t.fase ? fases.find((f) => f.id === t.fase) : undefined;
      if (!alvo) alvo = fases.find((f) => (listadas.get(f.id) ?? []).includes(t.id));
      if (!alvo) {
        const id = t.fase ?? "(sem-fase)";
        alvo = fases.find((f) => f.id === id);
        if (!alvo) {
          alvo = { id, titulo: id, status: "nao_iniciado", criterio_saida: null, paralelizavel: false, paralela_com: [], tasks: [], arquivo: arqTasks, declarada: false };
          fases.push(alvo);
        }
      }
      alvo.tasks.push(t);
    }
    for (const f of fases) f.status = statusDeTasks(f.tasks, f.status);

    const id = txt(sd.sprint_id) ?? txt(g.tasks?.dados?.sprint_id) ?? dir;
    const declarado = STATUS_TRAB.includes(String(sd.status)) ? (sd.status as StatusTrabalho) : "nao_iniciado";
    return {
      id,
      titulo: txt(sd.titulo) ?? id,
      status: statusDeTasks(tasks, declarado),
      criterio_saida: txt(sd.criterio_saida),
      fases,
      arquivo: g.sprint?.caminho ?? arqTasks,
    };
  });
}

function montarBloqueios(a: Artefato | undefined): Bloqueio[] {
  if (!a?.dados) return [];
  return objetos(a.dados.bloqueios).map((b) => {
    const resolvido = data(b.resolvido_em);
    return {
      id: txt(b.id) ?? "B-??",
      task: txt(b.task),
      aberto_em: data(b.aberto_em),
      resolvido_em: resolvido,
      aberto: resolvido === null,
      descricao: txt(b.descricao) ?? "",
      arquivo: a.caminho,
    };
  });
}

function montarEntrega(a: Artefato | undefined): Entrega | null {
  if (!a?.dados) return null;
  const d = a.dados;
  return {
    estado: txt(d.estado),
    branch: txt(d.branch),
    portao: txt(d.portao),
    pr_url: txt(d.pr_url),
    pr_estado: txt(d.pr_estado),
    commits: Array.isArray(d.commits) ? d.commits.length : 0,
    arquivo: a.caminho,
  };
}

const EVENTO_PARA_STATUS: Record<string, StatusTask> = { task_iniciada: "em_andamento", task_concluida: "concluida", task_bloqueada: "bloqueada" };

function aplicarRastro(tasks: Task[], eventos: EventoRastro[]): { task: string; disco: string; rastro: string }[] {
  const ordenados = [...eventos].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const ultimo = new Map<string, StatusTask>();
  const inicio = new Map<string, number>();
  const duracao = new Map<string, number>();
  for (const e of ordenados) {
    if (!e.task) continue;
    const st = EVENTO_PARA_STATUS[e.evento];
    if (!st) continue;
    ultimo.set(e.task, st);
    const ms = Date.parse(e.ts);
    if (e.evento === "task_iniciada" && !Number.isNaN(ms)) inicio.set(e.task, ms);
    if (e.evento === "task_concluida" && !Number.isNaN(ms)) {
      const i = inicio.get(e.task);
      if (i !== undefined && ms >= i) duracao.set(e.task, ms - i);
    }
  }
  const divergencias: { task: string; disco: string; rastro: string }[] = [];
  for (const t of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    const d = duracao.get(t.id);
    if (d !== undefined) t.duracao_observada_ms = d;
    const r = ultimo.get(t.id);
    // o disco vence: o status da task não muda, a divergência só é registrada
    if (r !== undefined && r !== t.status) divergencias.push({ task: t.id, disco: t.status, rastro: r });
  }
  return divergencias;
}

function grafoDeTasks(tasks: Task[]): GrafoPlano {
  const nos: NoGrafo[] = tasks.map((t) => ({ id: t.id, depende_de: t.depende_de, fase: t.fase, status: t.status }));
  return nos.length === 0 ? { ...SEM_GRAFO } : montarGrafo(nos);
}

function ultimaAtividade(eventos: EventoRastro[], fallback: string | null): string | null {
  let melhor: EventoRastro | null = null;
  for (const e of eventos) if (Number.isNaN(Date.parse(e.ts)) === false && (melhor === null || Date.parse(e.ts) >= Date.parse(melhor.ts))) melhor = e;
  return melhor ? melhor.ts : fallback;
}

function finalizar(t: Trabalho, eventos: EventoRastro[], agora: number, diasBloqueio: number | undefined): Trabalho {
  t.violacoes = verificarViolacoes(t, diasBloqueio === undefined ? { agora } : { agora, diasBloqueio });
  t.sinaleira = calcularSinaleira(t, eventos, agora);
  return t;
}

// ---------------------------------------------------------------- sprintx e runx

function estagioSprintx(td: TrabalhoDescoberto, tem: (nome: string) => boolean, auditoria: VereditoTexto | null): string {
  const temBase = td.diretorios.includes("base");
  const temSprint = td.diretorios.some((d) => /^sprint-\d+$/.test(d));
  if (!temBase) return "f1";
  if (!tem("00-DECISOES.md")) return "f2";
  if (!temSprint) return "f3";
  if (!tem("ORQUESTRADOR.md")) return "f4";
  if (auditoria === "sim" || tem("FECHAMENTO.md")) return "f6";
  return "f5";
}

function estagioRunx(td: TrabalhoDescoberto, tem: (nome: string) => boolean, qa: VereditoTexto | null, tasks: Task[]): string {
  const temSprint = td.diretorios.some((d) => /^sprint-\d+$/.test(d));
  if (!tem("01-CAUSA-RAIZ.md")) return "e1";
  if (!temSprint || !tem("ORQUESTRADOR.md")) return "e2";
  if (qa === "aprovado") return "e5";
  if (qa === "reprovado") return "e3";
  if (tasks.length > 0 && tasks.every((t) => t.status === "concluida")) return "e4";
  return "e3";
}

function montarTrabalhoDePasta(td: TrabalhoDescoberto, e: EntradaModelo): Trabalho {
  const art = (c: string): Artefato | undefined => e.artefatos.get(c);
  const doTrabalho = (nome: string): Artefato | undefined => art(`${td.pasta}/${nome}`);
  const tem = (nome: string): boolean => td.arquivos.includes(`${td.pasta}/${nome}`);

  const orq = doTrabalho("ORQUESTRADOR.md");
  const oco = doTrabalho("00-OCORRENCIA.md");
  const od = orq?.dados ?? {};
  const cd = oco?.dados ?? {};
  const declarada = txt(od.expx_tool) ?? txt(cd.expx_tool);
  const ferramenta: Ferramenta = td.layout === "manutencao" || declarada === "runx" || oco !== undefined ? "runx" : "sprintx";
  const id = txt(od.trabalho_id) ?? txt(cd.trabalho_id) ?? td.id;

  const sprints = montarSprints(td, art);
  const tasks = sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks));
  const bloqueios = montarBloqueios(doTrabalho("00-BLOQUEIOS.md") ?? doTrabalho("BLOQUEIOS.md"));
  const auditoria = doTrabalho("00-AUDITORIA.md")?.veredito ?? null;
  const qa = doTrabalho("QA.md")?.veredito ?? null;
  const eventos = e.eventos.get(id) ?? [];

  const estagio = ferramenta === "runx" ? estagioRunx(td, tem, qa, tasks) : estagioSprintx(td, tem, auditoria);
  const concluidoPorDisco = tasks.length > 0 && tasks.every((t) => t.status === "concluida");
  const declaradoStatus = STATUS_TRAB.includes(String(od.status)) ? (od.status as StatusTrabalho) : null;
  const algumaIniciada = tasks.some((t) => t.status !== "pendente");

  let status: StatusTrabalho;
  const fechado = ferramenta === "runx" ? estagio === "e5" && qa === "aprovado" : estagio === "f6" && concluidoPorDisco && (declaradoStatus === "concluido" || tem("FECHAMENTO.md"));
  if (fechado && (ferramenta === "sprintx" || declaradoStatus === "concluido" || concluidoPorDisco)) status = "concluido";
  else if (bloqueios.some((b) => b.aberto)) status = "bloqueado";
  else if (declaradoStatus === "nao_iniciado" && !algumaIniciada) status = "nao_iniciado";
  else if (orq === undefined && !td.diretorios.includes("base") && oco === undefined && td.arquivos.length === 0) status = "nao_iniciado";
  else status = "em_andamento";

  const decisoes = doTrabalho("00-DECISOES.md")?.dados;
  const decisoesPendentes = decisoes ? objetos(decisoes.decisoes).filter((d) => d.status === "pendente").length : 0;

  const divergencias = aplicarRastro(tasks, eventos);
  const raioArt = art(`docs/legado/raio/${id}.md`);
  const raio = raioArt
    ? { faixa: raioArt.faixa, aprovado: raioArt.faixa !== "alto" || /Aprovado por:[ \t]*(?!PENDENTE\b)\S/i.test(raioArt.corpo) }
    : null;
  const entregaArt = e.descoberta.entregas.find((x) => x.id === id)?.arquivos[0];

  const trabalho: Trabalho = {
    id,
    tipo: ferramenta === "runx" ? "ocorrencia" : "feature",
    ferramenta,
    layout: td.layout,
    origem_buildx: txt(od.origem_buildx),
    feature_id: txt(od.feature_id),
    titulo: txt(od.titulo) ?? txt(cd.titulo) ?? id,
    tipo_ocorrencia: txt(od.tipo_ocorrencia) ?? txt(cd.tipo_ocorrencia),
    estagio,
    estagio_declarado: txt(od.estagio)?.toLowerCase() ?? null,
    status,
    pasta: td.pasta,
    worktree: txt(od.worktree) ?? txt(cd.worktree),
    sprints,
    bloqueios,
    veredito_auditoria: auditoria,
    veredito_qa: qa,
    entrega: montarEntrega(entregaArt ? art(entregaArt) : undefined),
    caminho_critico_declarado: lista(od.caminho_critico),
    grafo: grafoDeTasks(tasks),
    features: [],
    prodx: null,
    raio,
    decisoes_pendentes: decisoesPendentes,
    divergencias,
    ultima_atividade: ultimaAtividade(eventos, data(od.atualizado_em)),
    eventos_total: eventos.length,
    sinaleira: { cor: "cinza", motivo: "", motivos: [] },
    violacoes: [],
  };
  return finalizar(trabalho, eventos, e.agora, e.diasBloqueio);
}

// ---------------------------------------------------------------- prodx

function montarPedido(td: TrabalhoDescoberto, e: EntradaModelo): Trabalho {
  const art = (nome: string): Artefato | undefined => e.artefatos.get(`${td.pasta}/${nome}`);
  const pedido = art("01-pedido.md");
  const exist = art("02-existencia.md");
  const aval = art("03-avaliacao.md");
  const ver = art("VEREDITO.md");
  const brief = art("BRIEFING.md");
  const id = txt(ver?.dados?.pd_id) ?? txt(pedido?.dados?.pd_id) ?? txt(exist?.dados?.pd_id) ?? td.id;
  const existe = exist?.dados?.desfecho === "existe";

  let estagio = "p2";
  if (pedido) estagio = "p3";
  if (pedido && exist) estagio = existe ? "p5" : "p4";
  if (aval || ver) estagio = "p5";

  const veredito = txt(ver?.dados?.veredito);
  const assinante = txt(ver?.dados?.aprovado_por);
  const assinado = ver !== undefined && assinante !== null && assinante.toUpperCase() !== "PENDENTE";
  const temBriefing = brief !== undefined;
  const exigeBriefing = veredito === "fazer" || veredito === "fazer_outra_coisa";
  const concluido = ver !== undefined && assinado && (!exigeBriefing || temBriefing);

  const eventos = e.eventos.get(id) ?? [];
  const trabalho: Trabalho = {
    id,
    tipo: "pedido",
    ferramenta: "prodx",
    layout: "pedido",
    origem_buildx: null,
    feature_id: null,
    titulo: txt(ver?.dados?.titulo) ?? txt(pedido?.dados?.titulo) ?? id,
    tipo_ocorrencia: null,
    estagio,
    estagio_declarado: null,
    status: concluido ? "concluido" : "em_andamento",
    pasta: td.pasta,
    worktree: null,
    sprints: [],
    bloqueios: [],
    veredito_auditoria: null,
    veredito_qa: null,
    entrega: null,
    caminho_critico_declarado: [],
    grafo: { ...SEM_GRAFO },
    features: [],
    prodx: { veredito, assinado, briefing: temBriefing },
    raio: null,
    decisoes_pendentes: 0,
    divergencias: [],
    ultima_atividade: ultimaAtividade(eventos, data(ver?.dados?.data) ?? data(pedido?.dados?.data)),
    eventos_total: eventos.length,
    sinaleira: { cor: "cinza", motivo: "", motivos: [] },
    violacoes: [],
  };
  // pedido sem veredito ainda: nada aguarda humano, mas há trabalho em curso (P2..P4)
  return finalizar(trabalho, eventos, e.agora, e.diasBloqueio);
}

// ---------------------------------------------------------------- buildx

export function lerFeaturesDoMapa(corpo: string): FeatureProjeto[] {
  const blocos = corpo.split(/^###[ \t]+/m).slice(1);
  const saida: FeatureProjeto[] = [];
  for (const b of blocos) {
    const cab = /^(FT-\d+)[ \t]*[—–-][ \t]*(.+)$/m.exec(b);
    if (!cab?.[1]) continue;
    const slug = /\*\*Slug:\*\*[ \t]*`?([a-z0-9][a-z0-9-]*)`?/i.exec(b)?.[1] ?? null;
    const dep = /\*\*Depende de:\*\*[ \t]*\[([^\]]*)\]/i.exec(b)?.[1] ?? "";
    const par = /\*\*Paraleliz[áa]vel:\*\*[ \t]*(true|false)/i.exec(b)?.[1];
    const st = /\*\*Status:\*\*[ \t]*(pendente|em_andamento|entregue|bloqueada)\b/i.exec(b)?.[1];
    saida.push({
      id: cab[1],
      titulo: (cab[2] ?? "").trim(),
      slug,
      status: st ? st.toLowerCase() : "pendente",
      depende_de: dep.split(",").map((x) => x.trim()).filter((x) => /^FT-\d+$/.test(x)),
      paralelizavel: par?.toLowerCase() === "true",
    });
  }
  return saida;
}

function montarProjeto(e: EntradaModelo): Trabalho | null {
  if (e.descoberta.projeto.length === 0) return null;
  const art = (nome: string): Artefato | undefined => e.artefatos.get(`docs/projeto/${nome}`);
  const proj = art("PROJETO.md");
  const mapa = art("MAPA.md");
  const validacao = art("VALIDACAO.md");
  const id = txt(proj?.dados?.projeto_id) ?? txt(mapa?.dados?.projeto_id) ?? "projeto";
  const features = mapa ? lerFeaturesDoMapa(mapa.corpo) : [];
  const temConvencoes = e.descoberta.camadas.includes("docs/stack/CONVENCOES.md");

  let estagio = "b1";
  if (proj) estagio = "b2";
  if (proj && temConvencoes) estagio = "b3";
  if (proj && temConvencoes && mapa) {
    const aberta = features.some((f) => f.status !== "entregue" && f.status !== "bloqueada");
    estagio = aberta || features.length === 0 ? "b4" : art("RECURSAO.md") ? "b6" : "b5";
    if (validacao) estagio = "b6";
  }
  const v = txt(validacao?.dados?.veredito);
  const vq: VereditoTexto | null = v === "reprovado" ? "reprovado" : v === "aprovado" || v === "aprovado_com_pendencia" ? "aprovado" : null;
  const eventos = e.eventos.get(id) ?? [];
  const trabalho: Trabalho = {
    id,
    tipo: "projeto",
    ferramenta: "buildx",
    layout: "projeto",
    origem_buildx: null,
    feature_id: null,
    titulo: txt(proj?.dados?.titulo) ?? id,
    tipo_ocorrencia: null,
    estagio,
    estagio_declarado: txt(proj?.dados?.etapa)?.toLowerCase() ?? null,
    status: validacao ? "concluido" : "em_andamento",
    pasta: "docs/projeto",
    worktree: null,
    sprints: [],
    bloqueios: [],
    veredito_auditoria: null,
    veredito_qa: vq,
    entrega: null,
    caminho_critico_declarado: [],
    grafo: features.length > 0 ? montarGrafo(features.map((f) => ({ id: f.id, depende_de: f.depende_de, fase: null, status: f.status === "entregue" ? "concluida" : f.status === "em_andamento" ? "em_andamento" : f.status === "bloqueada" ? "bloqueada" : "pendente" }))) : { ...SEM_GRAFO },
    features,
    prodx: null,
    raio: null,
    decisoes_pendentes: 0,
    divergencias: [],
    ultima_atividade: ultimaAtividade(eventos, data(proj?.dados?.atualizado_em)),
    eventos_total: eventos.length,
    sinaleira: { cor: "cinza", motivo: "", motivos: [] },
    violacoes: [],
  };
  return finalizar(trabalho, eventos, e.agora, e.diasBloqueio);
}

/** Monta o modelo inteiro do projeto (releitura total: as regras cruzam arquivos). Nunca lança. */
export function montarTrabalhos(e: EntradaModelo): Trabalho[] {
  const saida: Trabalho[] = [];
  for (const td of e.descoberta.trabalhos) {
    try {
      saida.push(td.layout === "pedido" ? montarPedido(td, e) : montarTrabalhoDePasta(td, e));
    } catch {
      // um trabalho ilegível não derruba os demais
    }
  }
  try {
    const p = montarProjeto(e);
    if (p) saida.push(p);
  } catch {
    // idem
  }
  return saida.sort((a, b) => (a.pasta < b.pasta ? -1 : a.pasta > b.pasta ? 1 : 0));
}
