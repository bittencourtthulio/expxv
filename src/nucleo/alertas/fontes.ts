// Fontes (T-20.09/T-20.10, parte pura): transformam eventos de domínio (formato MÍNIMO abaixo; o adaptador do main converte
// `task.updated`, `pane.state_changed`, `mission.closed`…) em `emitir()` com os números certos. Sem barramento, sem banco.
// Tipos cuja fase dona ainda não expõe o evento ficam `fonte_indisponivel` no catálogo e NÃO geram alerta aqui.
import type { ConfigAlertas, DadosAlerta } from "../../compartilhado/alertas";
import { CONFIG_ALERTAS_PADRAO } from "../../compartilhado/alertas";
import type { AgendadorVencimentos } from "./agendador";
import { decidirAtraso, proximoVencimento, type AmostraConcluida } from "./atraso";
import type { Emissor } from "./emissor";
import { montarDadosTarefa, type DadosTarefa, type DepsMetricas } from "./metricas";
import type { ReferenciaTask } from "./portas";
import type { AcumuladorTempo } from "./tempo";
import { truncarVisivel } from "./texto";

export type StatusTask = "pendente" | "em_andamento" | "concluida" | "bloqueada" | "outro";
export interface EventoTask extends ReferenciaTask {
  titulo: string;
  status: StatusTask;
  pane_id?: string | null;
  mission_id?: string | null;
  missao?: string | null;
  cli?: string | null;
  modelo?: string | null;
  motivo?: string | null;
  prazo_sprint?: string | null;
}
export interface EventoPane {
  pane_id: string;
  estado: string;
  cli?: string | null;
  mission_id?: string | null;
  missao?: string | null;
  workspace_id?: string | null;
  pergunta?: string | null;
}
export interface EventoMissaoFechada {
  workspace_id: string;
  mission_id: string;
  titulo: string;
  resultado: "concluida" | "falhou";
  tarefas_total: number;
  motivo?: string | null;
}
export interface EventoQa {
  workspace_id: string;
  trabalho_id: string;
  task_id: string;
  veredito: "aprovado" | "reprovado";
  achados: number;
  rodada: number;
  missao?: string | null;
}

export type DadoVencimento = { tipo: "aguardando"; pane_id: string } | { tipo: "atraso"; chave: string };

export interface DepsFontes {
  emissor: Emissor;
  tempo: AcumuladorTempo;
  metricas: Omit<DepsMetricas, "tempo" | "historico" | "agora"> & { historico: (workspace_id: string) => AmostraConcluida[] };
  agendador: AgendadorVencimentos<DadoVencimento>;
  agora: () => number;
  config?: () => ConfigAlertas;
}

const chaveTask = (r: ReferenciaTask): string => `${r.workspace_id}|${r.trabalho_id}|${r.task_id}`;

export interface Fontes {
  aoTask(ev: EventoTask): void;
  aoPane(ev: EventoPane): void;
  aoMissaoFechada(ev: EventoMissaoFechada): void;
  aoQa(ev: EventoQa): void;
  aoErroSistema(componente: string, codigo: string): void;
  /** o agendador chama isto no vencimento (ligar em `aoVencer`). */
  aoVencer(d: DadoVencimento): void;
}

const somaOuNull = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0);
};

export function criarFontes(deps: DepsFontes): Fontes {
  const cfg = (): ConfigAlertas => deps.config?.() ?? CONFIG_ALERTAS_PADRAO;
  const ativas = new Map<string, EventoTask>();
  const feitasDaMissao = new Map<string, DadosTarefa[]>();
  const prazoAlertado = new Set<string>();
  const paneAguardandoDesde = new Map<string, { desde: number; ev: EventoPane }>();
  const ultimoErro = new Map<string, number>();
  const dm: DepsMetricas = { ...deps.metricas, tempo: deps.tempo, agora: deps.agora };

  function entidade(ev: EventoTask): { workspace_id: string; mission_id: string | null; entidade_tipo: string; entidade_id: string } {
    return { workspace_id: ev.workspace_id, mission_id: ev.mission_id ?? null, entidade_tipo: "task", entidade_id: ev.task_id };
  }
  function dadosBase(ev: EventoTask, d: DadosTarefa): DadosAlerta {
    return { ...d, task_id: ev.task_id, missao: ev.missao ?? null, cli: ev.cli ?? null, modelo: ev.modelo ?? null, status: ev.status };
  }

  /** agenda o próximo vencimento de atraso (só quando o Pane está trabalhando, que é quando o tempo avança). */
  function agendarAtraso(ev: EventoTask): void {
    const k = chaveTask(ev);
    const l = deps.tempo.leitura(ev);
    deps.agendador.cancelar(`atraso:${k}`);
    if (l === null) return;
    const trabalhando = l.pane_id !== null && l.estado_atual === "trabalhando";
    const temPrazo = ev.prazo_sprint !== undefined && ev.prazo_sprint !== null;
    if (!trabalhando && !temPrazo) return;
    const v = proximoVencimento(
      { task_id: ev.task_id, workspace_id: ev.workspace_id, story_points: dm.agil?.pontos(ev) ?? null, ativo_ms: l.ativo_ms, estado: "em_andamento", alertou_atraso: l.alertou_atraso, prazo_sprint: ev.prazo_sprint ?? null, alertou_prazo: prazoAlertado.has(k) },
      deps.metricas.historico(ev.workspace_id),
      cfg().atraso,
      deps.agora(),
    );
    if (v !== null) deps.agendador.agendar(`atraso:${k}`, v, { tipo: "atraso", chave: k });
  }

  function avaliarAtraso(ev: EventoTask): void {
    const l = deps.tempo.leitura(ev);
    if (l === null) return;
    const sp = dm.agil?.pontos(ev) ?? null;
    const aguardando = l.estado_atual === "aguardando";
    const d = decidirAtraso(
      { task_id: ev.task_id, workspace_id: ev.workspace_id, story_points: sp, ativo_ms: l.ativo_ms, estado: aguardando ? "aguardando" : "em_andamento", alertou_atraso: l.alertou_atraso, prazo_sprint: ev.prazo_sprint ?? null, alertou_prazo: prazoAlertado.has(chaveTask(ev)) },
      deps.metricas.historico(ev.workspace_id),
      cfg().atraso,
      deps.agora(),
    );
    if (d.emitir !== null) {
      const dados = dadosBase(ev, montarDadosTarefa(dm, ev));
      dados.motivo = d.emitir.motivo;
      deps.emissor.emitir({
        tipo: "tarefa_atrasada",
        severidade: d.emitir.tipo === "muito_atrasada" ? "critico" : "aviso",
        ...entidade(ev),
        titulo: ev.titulo,
        dados,
        estado: `${d.emitir.motivo}:${d.emitir.tipo}`,
      });
      if (d.emitir.novo_nivel !== null) deps.tempo.marcarAlertou(ev, d.emitir.novo_nivel);
      else prazoAlertado.add(chaveTask(ev));
    }
    agendarAtraso(ev);
  }

  return {
    aoTask(ev) {
      const k = chaveTask(ev);
      if (ev.status === "em_andamento") {
        const ja = ativas.has(k);
        ativas.set(k, ev);
        if (!ja) deps.tempo.iniciarTask(ev, ev.pane_id ?? null, ev.pane_id === undefined || ev.pane_id === null ? undefined : "trabalhando");
        deps.emissor.emitir({ tipo: "tarefa_iniciada", ...entidade(ev), titulo: ev.titulo, dados: dadosBase(ev, montarDadosTarefa(dm, ev)), estado: "em_andamento" });
        agendarAtraso(ev);
      } else if (ev.status === "concluida") {
        const dados = montarDadosTarefa(dm, ev, "concluida");
        deps.tempo.fecharTask(ev);
        deps.agendador.cancelar(`atraso:${k}`);
        ativas.delete(k);
        prazoAlertado.delete(k);
        if (ev.mission_id !== undefined && ev.mission_id !== null) feitasDaMissao.set(ev.mission_id, [...(feitasDaMissao.get(ev.mission_id) ?? []), dados]);
        deps.emissor.emitir({ tipo: "tarefa_concluida", ...entidade(ev), titulo: ev.titulo, dados: dadosBase(ev, dados), estado: "concluida" });
      } else if (ev.status === "bloqueada") {
        deps.agendador.cancelar(`atraso:${k}`);
        deps.emissor.emitir({ tipo: "tarefa_bloqueada", ...entidade(ev), titulo: ev.titulo, dados: { ...dadosBase(ev, montarDadosTarefa(dm, ev, "bloqueada")), motivo: ev.motivo ?? null }, estado: "bloqueada" });
      }
    },

    aoPane(ev) {
      deps.tempo.transicaoPane(ev.pane_id, ev.estado);
      const chaveAg = `aguardando:${ev.pane_id}`;
      if (ev.estado === "aguardando") {
        if (paneAguardandoDesde.has(ev.pane_id)) return;
        paneAguardandoDesde.set(ev.pane_id, { desde: deps.agora(), ev });
        const limiar = cfg().pane_aguardando_min * 60_000;
        if (limiar <= 0) this.aoVencer({ tipo: "aguardando", pane_id: ev.pane_id });
        else deps.agendador.agendar(chaveAg, deps.agora() + limiar, { tipo: "aguardando", pane_id: ev.pane_id });
      } else {
        paneAguardandoDesde.delete(ev.pane_id); // voltou a trabalhar antes do limiar: cancelado
        deps.agendador.cancelar(chaveAg);
      }
      const ref = deps.tempo.taskDoPane(ev.pane_id);
      const t = ref === null ? undefined : ativas.get(chaveTask(ref));
      if (t !== undefined) agendarAtraso(t);
    },

    aoMissaoFechada(ev) {
      const feitas = feitasDaMissao.get(ev.mission_id) ?? [];
      feitasDaMissao.delete(ev.mission_id);
      const dados: DadosAlerta = {
        missao: ev.titulo,
        tarefas_feitas: feitas.length,
        tarefas_total: ev.tarefas_total,
        tempo_trabalho_ms: somaOuNull(feitas.map((d) => d.tempo_trabalho_ms)),
        tokens: somaOuNull(feitas.map((d) => d.tokens)),
        story_points: somaOuNull(feitas.map((d) => d.story_points)),
        motivo: ev.motivo ?? null,
      };
      deps.emissor.emitir({ tipo: ev.resultado === "concluida" ? "missao_concluida" : "missao_falhou", workspace_id: ev.workspace_id, mission_id: ev.mission_id, entidade_tipo: "missao", entidade_id: ev.mission_id, titulo: ev.titulo, dados, estado: ev.resultado });
    },

    aoQa(ev) {
      deps.emissor.emitir({
        tipo: ev.veredito === "aprovado" ? "qa_aprovado" : "qa_reprovado",
        workspace_id: ev.workspace_id,
        entidade_tipo: "task",
        entidade_id: ev.task_id,
        titulo: `QA ${ev.veredito} (${ev.task_id})`,
        dados: { task_id: ev.task_id, missao: ev.missao ?? null, achados: ev.achados, rodada: ev.rodada },
        estado: `${ev.veredito}:${ev.rodada}`,
      });
    },

    aoErroSistema(componente, codigo) {
      const k = `${componente}`;
      const agora = deps.agora();
      if (agora - (ultimoErro.get(k) ?? -Infinity) < 3_600_000) return; // teto: 1 por componente/hora
      ultimoErro.set(k, agora);
      deps.emissor.emitir({ tipo: "erro_sistema", entidade_tipo: "componente", entidade_id: k, titulo: `Falha em ${truncarVisivel(componente, 40)}`, dados: { componente: truncarVisivel(componente, 40), codigo: truncarVisivel(codigo, 40) }, estado: codigo });
    },

    aoVencer(d) {
      if (d.tipo === "aguardando") {
        const p = paneAguardandoDesde.get(d.pane_id);
        if (p === undefined) return;
        const ref = deps.tempo.taskDoPane(d.pane_id);
        deps.emissor.emitir({
          tipo: "pane_aguardando",
          workspace_id: p.ev.workspace_id ?? null,
          mission_id: p.ev.mission_id ?? null,
          entidade_tipo: "pane",
          entidade_id: d.pane_id,
          titulo: `Pane aguardando${ref === null ? "" : ` (${ref.task_id})`}`,
          dados: { cli: p.ev.cli ?? null, missao: p.ev.missao ?? null, espera_ms: deps.agora() - p.desde, pergunta: p.ev.pergunta ?? null },
          estado: "aguardando",
        });
      } else {
        const ev = ativas.get(d.chave);
        if (ev !== undefined) avaliarAtraso(ev);
      }
    },
  };
}
