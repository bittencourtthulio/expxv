// Serviço do painel de progresso (D-660…). SOB DEMANDA (nada no boot): assina os eventos que o app JÁ produz (`maestro:evento`, `metodo:mudou` e, só enquanto
// há skill solta acompanhada, a atividade da sessão), SEM polling novo: tudo coalescido em ≥ 250 ms e publicado como `progresso:mudou` (payload minúsculo, sem
// conteúdo de conversa). A fonte única é `src/nucleo/progresso` (derivadores puros); aqui só há estado de acompanhamento (o que já foi visto, dispensado, fixado).
// Timers: UM `setTimeout` de coalescência e UM de expiração (retenção do fim e atividade velha), ambos `unref` e só existentes quando há o que esperar.
import { COALESCER_PROGRESSO_MS, JANELA_ATIVIDADE_MS, LIMITE_PROGRESSOS, type EstadoProgresso, type Progresso } from "../compartilhado/progresso";
import { agregarProgressos, derivarDoSprintx, nomeDaSkill, sprintxAtivo, type PipelineParaProgresso, type SkillObservada, type TrabalhoParaProgresso } from "../nucleo/progresso";
import type { Barramento } from "./barramento";

/** O que o serviço lê de um trabalho do método (subconjunto de `Trabalho`). */
export type TrabalhoLido = TrabalhoParaProgresso & { ferramenta: string; estagio: string; eventos_total: number };

/** Sinal mínimo de uma sessão de terminal (o main adapta de `EventoTerminal`; nunca carrega a saída). */
export type SinalSessao =
  | { tipo: "atividade"; sessao_id: string; atividade: "trabalhando" | "aguardando" | "pronto" }
  | { tipo: "encerramento"; sessao_id: string; codigo: number | null; solicitado: boolean };

export interface DependenciasProgresso {
  barramento: Pick<Barramento, "assinar">;
  /** ids dos workspaces conhecidos. */
  workspaces(): readonly string[];
  /** pipelines NÃO terminais do workspace (nunca cria o serviço do Maestro se não há pipeline ativo). */
  pipelinesAtivos(workspaceId: string): Promise<PipelineParaProgresso[]>;
  /** um pipeline pelo id (para ler o estado final de um que acabou de sair da lista de ativos). */
  pipeline(id: string): Promise<PipelineParaProgresso | null>;
  /** trabalhos do método já lidos em memória (nunca dispara releitura do disco); `null` = método não carregado nesse workspace. */
  trabalhos(workspaceId: string): readonly TrabalhoLido[] | null;
  /** sessão de terminal do Pane (o clique numa etapa foca esse painel). */
  sessaoDoPane(paneId: string): string | null;
  /** assina os sinais de sessão; só é chamada com skill solta em acompanhamento. */
  escutarSessoes?(fn: (s: SinalSessao) => void): () => void;
  /** publica o estado agregado ao renderer. */
  publicar(e: EstadoProgresso): void;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
  /** coalescência mínima (padrão 250 ms). */
  atrasoMs?: number;
  /** quanto o fim de um progresso inferido/de pipeline fica publicado (padrão 60 s). */
  retencaoFimMs?: number;
  janelaAtividadeMs?: number;
  /** avisos de diagnóstico (nunca o conteúdo de um pedido). */
  avisar?: (m: string) => void;
}

export interface SkillDetectada {
  workspace_id: string;
  /** Pane livre onde o dono digitou a skill. */
  pane_id: string | null;
  /** nome da skill (com ou sem `/expx:`). */
  skill: string;
}

export interface ServicoProgresso {
  estado(): Promise<EstadoProgresso>;
  dispensar(id: string): void;
  fixar(id: string, fixado: boolean): void;
  /** o hook `UserPromptSubmit` viu `/expx:<skill>` num painel livre. */
  aoSkillDetectada(e: SkillDetectada): void;
  /** há algo acompanhado agora (para o main saber se vale manter assinaturas). */
  ativo(): boolean;
  encerrar(): void;
}

interface SkillEstado extends SkillObservada {
  trabalho_id: string | null;
  vistoTrabalhando: boolean;
  ultimoSinal: number;
  deteccao: "hook" | "rastro";
}
interface Rastreado {
  iniciado_em: number;
  fim_em: number | null;
}

const FERRAMENTAS_RASTRO = new Set(["sprintx", "runx", "prodx", "mergex", "stackx", "legadox", "designx", "buildx"]);

export function criarServicoProgresso(d: DependenciasProgresso): ServicoProgresso {
  const agora = d.agora ?? Date.now;
  const atraso = Math.max(COALESCER_PROGRESSO_MS, d.atrasoMs ?? COALESCER_PROGRESSO_MS);
  const retencao = d.retencaoFimMs ?? 60_000;
  const janela = d.janelaAtividadeMs ?? JANELA_ATIVIDADE_MS;
  const agendar = d.agendar ?? ((fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref(); return t; });
  const cancelar = d.cancelar ?? ((t: unknown) => clearTimeout(t as NodeJS.Timeout));

  const pipelines = new Map<string, PipelineParaProgresso[]>(); // workspace -> ativos + finais retidos
  const finaisPipeline = new Map<string, number>(); // id do pipeline -> quando o fim foi visto
  const trabalhos = new Map<string, readonly TrabalhoLido[]>();
  const sprintx = new Map<string, Rastreado & { workspace_id: string; trabalho_id: string }>(); // `${ws}\0${trabalho}`
  const skills = new Map<string, SkillEstado>(); // chave interna `${ws}\0${chave}`
  const baseEventos = new Map<string, string>(); // `${ws}\0${trabalho}` -> assinatura vista (baseline)
  const dispensados = new Set<string>();
  const fixados = new Set<string>();
  const pendentes = new Set<string>();
  let todos = false;
  let timerCoalesce: unknown = null;
  let timerExpira: unknown = null;
  let desligar: Array<() => void> = [];
  let desligarSessoes: (() => void) | null = null;
  let ligado = false;
  let encerrado = false;
  let ultimo = "";
  let atual: EstadoProgresso = { progressos: [] };
  let calculando: Promise<void> | null = null;

  const chaveTrab = (ws: string, id: string): string => `${ws}\u0000${id}`;

  // ---------------------------------------------------------------- leitura incremental por workspace
  async function lerPipelines(ws: string): Promise<void> {
    let ativos: PipelineParaProgresso[] = [];
    try { ativos = await d.pipelinesAtivos(ws); } catch (e) { d.avisar?.(`progresso: pipelines de ${ws}: ${e instanceof Error ? e.message : String(e)}`); }
    const anteriores = pipelines.get(ws) ?? [];
    const vivos = new Set(ativos.map((p) => p.id));
    const lista: PipelineParaProgresso[] = [...ativos];
    const t = agora();
    for (const p of anteriores) {
      if (vivos.has(p.id)) continue;
      const jaFinal = finaisPipeline.get(p.id);
      if (jaFinal !== undefined) {
        if (t - jaFinal < retencao) lista.push(p);
        else finaisPipeline.delete(p.id);
        continue;
      }
      // saiu da lista de ativos: leio o estado final (concluído, falhou, cancelado) uma vez
      let fim: PipelineParaProgresso | null = null;
      try { fim = await d.pipeline(p.id); } catch { /* fica sem o fim: o painel fecha em silêncio */ }
      if (fim !== null) { finaisPipeline.set(p.id, t); lista.push(fim); }
    }
    pipelines.set(ws, lista);
  }

  function lerTrabalhos(ws: string): void {
    const lido = d.trabalhos(ws);
    if (lido === null) return;
    trabalhos.set(ws, lido);
    const t = agora();
    for (const tr of lido) {
      const chave = chaveTrab(ws, tr.id);
      // sprintx: começa a ser acompanhado quando uma task é reivindicada; termina quando tudo conclui ou a atividade esfria
      const rast = sprintx.get(chave);
      if (rast === undefined) {
        if (sprintxAtivo(tr, t, janela)) sprintx.set(chave, { iniciado_em: t, fim_em: null, workspace_id: ws, trabalho_id: tr.id });
      } else if (rast.fim_em === null) {
        const dv = derivarDoSprintx(tr, ws, { agora: t });
        if (dv === null) sprintx.delete(chave);
        else if (dv.resultado === "concluido") rast.fim_em = t;
        else if (!sprintxAtivo(tr, t, janela)) sprintx.delete(chave); // esfriou: some em silêncio
      } else if (t - rast.fim_em >= retencao) sprintx.delete(chave);
      // skill detectada só pelo rastro (sem hook): atividade nova de uma ferramenta do método num trabalho que ninguém mais acompanha
      const assinatura = `${tr.eventos_total}|${tr.ultima_atividade ?? ""}|${tr.estagio}|${tr.status}`;
      const antes = baseEventos.get(chave);
      baseEventos.set(chave, assinatura);
      const dono = [...skills.values()].find((s) => s.workspace_id === ws && (s.trabalho_id === tr.id || (s.deteccao === "hook" && s.trabalho_id === null && nomeDaSkill(s.skill).split("-")[0] === tr.ferramenta && s.fim_em == null && s.iniciada_em <= t && (Date.parse(tr.ultima_atividade ?? "") || 0) >= s.iniciada_em - 2_000)));
      if (dono !== undefined) {
        dono.trabalho_id = tr.id;
        dono.estagio = tr.estagio;
        dono.ultimoSinal = t;
        if (dono.deteccao === "rastro" && tr.status === "concluido" && dono.fim_em == null) { dono.fim_em = t; dono.resultado = "ok"; }
      } else if (antes !== undefined && antes !== assinatura && FERRAMENTAS_RASTRO.has(tr.ferramenta) && tr.status !== "concluido" && !temPipelineDoTrabalho(ws, tr.id) && !sprintx.has(chave) && derivarDoSprintx(tr, ws)?.resultado !== "concluido") {
        const k = chaveTrab(ws, tr.id);
        skills.set(k, { workspace_id: ws, skill: tr.ferramenta, chave: tr.id, iniciada_em: t, estagio: tr.estagio, atividade: null, fim_em: null, resultado: null, sessao_id: null, trabalho_id: tr.id, vistoTrabalhando: false, ultimoSinal: t, deteccao: "rastro" });
      }
    }
  }

  const temPipelineDoTrabalho = (ws: string, trabalhoId: string): boolean => (pipelines.get(ws) ?? []).some((p) => p.trabalho_id === trabalhoId);

  // ---------------------------------------------------------------- sessões (só com skill solta em acompanhamento)
  function aoSinal(s: SinalSessao): void {
    const t = agora();
    let mudou = false;
    for (const k of skills.values()) {
      if (k.sessao_id !== s.sessao_id || k.fim_em != null) continue;
      if (s.tipo === "atividade") {
        k.atividade = s.atividade;
        k.ultimoSinal = t;
        if (s.atividade === "trabalhando") k.vistoTrabalhando = true;
        else if (s.atividade === "pronto" && k.vistoTrabalhando && k.deteccao === "hook") { k.fim_em = t; k.resultado = "ok"; }
        mudou = true;
      } else {
        k.fim_em = t;
        k.resultado = s.solicitado || s.codigo === 0 || s.codigo === null ? "ok" : "falha";
        mudou = true;
      }
    }
    if (mudou) marcar(null);
  }
  function ajustarSessoes(): void {
    const preciso = [...skills.values()].some((k) => k.sessao_id !== null && k.fim_em == null);
    if (preciso && desligarSessoes === null && d.escutarSessoes !== undefined) desligarSessoes = d.escutarSessoes(aoSinal);
    else if (!preciso && desligarSessoes !== null) { desligarSessoes(); desligarSessoes = null; }
  }

  // ---------------------------------------------------------------- agregação e publicação
  function montar(): Progresso[] {
    const t = agora();
    const todosPipelines = [...pipelines.values()].flat();
    const sprintxEntradas = [...sprintx.values()].flatMap((r) => {
      const tr = (trabalhos.get(r.workspace_id) ?? []).find((x) => x.id === r.trabalho_id);
      return tr === undefined ? [] : [{ trabalho: tr as TrabalhoParaProgresso, workspace_id: r.workspace_id, iniciado_em: r.iniciado_em }];
    });
    const skillsEntradas = [...skills.values()].map((s) => ({ ...s }));
    const lista = agregarProgressos({ pipelines: todosPipelines, sprintx: sprintxEntradas, skills: skillsEntradas, sessaoDoPane: d.sessaoDoPane, agora: t });
    for (const p of lista) {
      if (p.origem === "maestro" && p.fim_em === null && (p.resultado === "concluido" || p.resultado === "falhou" || p.resultado === "cancelado")) {
        const id = p.id.slice(3);
        p.fim_em = finaisPipeline.get(id) ?? t;
      }
      if (p.origem === "sprintx") {
        const r = [...sprintx.values()].find((x) => `sx:${x.trabalho_id}` === p.id);
        if (r?.fim_em !== null && r?.fim_em !== undefined) p.fim_em = r.fim_em;
      }
      if (fixados.has(p.id)) p.fixado = true;
      if (dispensados.has(p.id)) p.dispensado = true;
    }
    // esquece dispensados/fixados de progressos que não existem mais
    const ids = new Set(lista.map((p) => p.id));
    for (const id of [...dispensados]) if (!ids.has(id)) dispensados.delete(id);
    for (const id of [...fixados]) if (!ids.has(id)) fixados.delete(id);
    return lista.slice(-LIMITE_PROGRESSOS);
  }

  function limparSkills(): void {
    const t = agora();
    for (const [k, s] of skills) {
      const fimVelho = s.fim_em != null && t - s.fim_em >= retencao;
      const frio = s.fim_em == null && t - s.ultimoSinal >= janela;
      if (fimVelho || frio) skills.delete(k);
    }
  }

  function agendarExpiracao(): void {
    if (timerExpira !== null) { cancelar(timerExpira); timerExpira = null; }
    if (encerrado) return;
    const t = agora();
    const prazos: number[] = [];
    for (const [id, v] of finaisPipeline) { void id; prazos.push(v + retencao); }
    for (const r of sprintx.values()) {
      if (r.fim_em !== null) prazos.push(r.fim_em + retencao);
      else {
        const tr = (trabalhos.get(r.workspace_id) ?? []).find((x) => x.id === r.trabalho_id);
        const ult = Date.parse(tr?.ultima_atividade ?? "");
        prazos.push(Number.isFinite(ult) ? ult + janela : t + janela);
      }
    }
    for (const s of skills.values()) prazos.push(s.fim_em != null ? s.fim_em + retencao : s.ultimoSinal + janela);
    if (prazos.length === 0) return;
    const espera = Math.max(atraso, Math.min(...prazos) - t + 50);
    timerExpira = agendar(() => { timerExpira = null; marcar(null); }, Math.min(espera, 2 ** 30));
  }

  async function recalcular(): Promise<void> {
    const alvo = todos ? [...new Set([...d.workspaces(), ...pipelines.keys()])] : [...pendentes];
    todos = false;
    pendentes.clear();
    await Promise.all(alvo.map((ws) => lerPipelines(ws)));
    for (const ws of alvo) lerTrabalhos(ws);
    limparSkills();
    ajustarSessoes();
    const lista = montar();
    atual = { progressos: lista };
    agendarExpiracao();
    const chave = JSON.stringify(lista);
    if (chave === ultimo) return;
    ultimo = chave;
    if (ligado && !encerrado) d.publicar(atual);
  }

  function executar(): void {
    timerCoalesce = null;
    if (encerrado) return;
    const anterior = calculando ?? Promise.resolve();
    calculando = anterior.then(recalcular).catch((e: unknown) => d.avisar?.(`progresso: ${e instanceof Error ? e.message : String(e)}`)).finally(() => { calculando = null; });
  }

  /** `ws === null`: recalcula todos os workspaces conhecidos. */
  function marcar(ws: string | null): void {
    if (encerrado) return;
    if (ws === null) todos = true; else pendentes.add(ws);
    if (timerCoalesce === null) timerCoalesce = agendar(executar, atraso);
  }

  function ligar(): void {
    if (ligado) return;
    ligado = true;
    desligar = [
      d.barramento.assinar<{ workspace_id?: string }>("maestro:evento", (e) => { if (typeof e?.workspace_id === "string") marcar(e.workspace_id); }),
      d.barramento.assinar<{ workspace_id?: string }>("metodo:mudou", (e) => { if (typeof e?.workspace_id === "string" && (skills.size > 0 || sprintx.size > 0 || baseEventos.size > 0 || pipelines.size > 0)) marcar(e.workspace_id); }),
    ];
  }

  return {
    async estado(): Promise<EstadoProgresso> {
      ligar();
      todos = true;
      await (calculando ?? Promise.resolve());
      calculando = recalcular().catch((e: unknown) => d.avisar?.(`progresso: ${e instanceof Error ? e.message : String(e)}`)).finally(() => { calculando = null; });
      await calculando;
      return atual;
    },
    dispensar(id: string): void {
      dispensados.add(id);
      marcar(null);
    },
    fixar(id: string, fixado: boolean): void {
      if (fixado) fixados.add(id); else fixados.delete(id);
      marcar(null);
    },
    aoSkillDetectada(e: SkillDetectada): void {
      if (encerrado) return;
      ligar();
      if (!/^\/?(?:expx:)?[a-z][a-z0-9-]{0,40}$/i.test(e.skill.trim())) return;
      const nome = nomeDaSkill(e.skill);
      if (nome === "") return;
      const t = agora();
      const sessao = e.pane_id === null ? null : d.sessaoDoPane(e.pane_id);
      const chave = e.pane_id ?? `${nome}_${t}`;
      skills.set(chaveTrab(e.workspace_id, chave), { workspace_id: e.workspace_id, skill: nome, chave, iniciada_em: t, estagio: null, atividade: null, fim_em: null, resultado: null, sessao_id: sessao, trabalho_id: null, vistoTrabalhando: false, ultimoSinal: t, deteccao: "hook" });
      ajustarSessoes();
      marcar(e.workspace_id);
    },
    ativo: (): boolean => skills.size > 0 || sprintx.size > 0 || [...pipelines.values()].some((l) => l.length > 0),
    encerrar(): void {
      encerrado = true;
      if (timerCoalesce !== null) cancelar(timerCoalesce);
      if (timerExpira !== null) cancelar(timerExpira);
      timerCoalesce = timerExpira = null;
      desligar.forEach((f) => f());
      desligar = [];
      desligarSessoes?.();
      desligarSessoes = null;
    },
  };
}
