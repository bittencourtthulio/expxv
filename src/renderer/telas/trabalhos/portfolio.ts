// Visão de PORTFÓLIO dos trabalhos (tela Trabalhos): funções puras sobre o que o índice do Método já tem. Nenhum estado é inventado:
// o estágio de cada coluna vem de `estagio`/`status`/tasks; o resumo é a contagem do índice.
import type { Trabalho, TipoTrabalho } from "../../../nucleo/metodo/tipos";
import type { GestoMetodo } from "../../../compartilhado/dominio";
import { faseLegivel, ROTULO_FASE_LEGIVEL, tasksDe } from "../metodo/util";

export type EstagioPortfolio = "ideia" | "planejado" | "execucao" | "validando" | "entregue";
export const COLUNAS_PORTFOLIO: readonly EstagioPortfolio[] = ["ideia", "planejado", "execucao", "validando", "entregue"];
export const ROTULO_ESTAGIO_PORTFOLIO: Record<EstagioPortfolio, string> = { ideia: "Ideia", planejado: "Planejado", execucao: "Em execução", validando: "Validando", entregue: "Entregue" };
export const AJUDA_ESTAGIO_PORTFOLIO: Record<EstagioPortfolio, string> = {
  ideia: "Pedido em triagem, antes de virar trabalho",
  planejado: "Base, descoberta, plano e investigação",
  execucao: "Tasks sendo implementadas",
  validando: "Auditoria, QA e relatório",
  entregue: "Concluído",
};

const PLANEJA = new Set(["f1", "f2", "f3", "f4", "f5", "e1", "e2", "b1", "b2", "b3"]);
const EXECUTA = new Set(["f6", "e3", "b4"]);
const VALIDA = new Set(["e4", "e5", "b5", "b6"]);

export function estagioPortfolio(t: Pick<Trabalho, "status" | "estagio" | "tipo" | "ferramenta" | "sprints">): EstagioPortfolio {
  if (t.status === "concluido") return "entregue";
  const e = t.estagio.toLowerCase();
  if (t.tipo === "pedido" || e.startsWith("p")) return "ideia";
  if (VALIDA.has(e)) return "validando";
  if (EXECUTA.has(e)) {
    const tasks = tasksDe(t as Trabalho);
    return e === "f6" && tasks.length > 0 && tasks.every((k) => k.status === "concluida") ? "validando" : "execucao";
  }
  if (PLANEJA.has(e)) return "planejado";
  return "planejado";
}

export type EstadoPortfolio = "andamento" | "aguardando" | "bloqueado" | "entregue" | "nao_iniciado";
export const ROTULO_ESTADO_PORTFOLIO: Record<EstadoPortfolio, string> = { andamento: "Em andamento", aguardando: "Aguardando você", bloqueado: "Bloqueados", entregue: "Entregues", nao_iniciado: "Não iniciados" };

/** Um único estado por trabalho (a soma do resumo fecha com o total). */
export function estadoPortfolio(t: Pick<Trabalho, "status" | "estagio" | "bloqueios" | "decisoes_pendentes" | "prodx" | "raio">): EstadoPortfolio {
  if (t.status === "concluido") return "entregue";
  if (t.status === "bloqueado") return "bloqueado";
  if (faseLegivel(t) === "aguardando") return "aguardando";
  return t.status === "nao_iniciado" ? "nao_iniciado" : "andamento";
}

export interface ResumoPortfolio extends Record<EstadoPortfolio, number> { total: number }
export function resumoPortfolio(trabalhos: readonly Trabalho[]): ResumoPortfolio {
  const r: ResumoPortfolio = { total: trabalhos.length, andamento: 0, aguardando: 0, bloqueado: 0, entregue: 0, nao_iniciado: 0 };
  for (const t of trabalhos) r[estadoPortfolio(t)]++;
  return r;
}

export interface TipoLegivel { id: TipoTrabalho; rotulo: string; gesto: GestoMetodo }
const TIPOS: Record<TipoTrabalho, TipoLegivel> = {
  feature: { id: "feature", rotulo: "Feature", gesto: "nova_feature" },
  ocorrencia: { id: "ocorrencia", rotulo: "Bug", gesto: "nova_ocorrencia" },
  projeto: { id: "projeto", rotulo: "Projeto", gesto: "projeto" },
  pedido: { id: "pedido", rotulo: "Pedido", gesto: "pedido_cru" },
};
export const TIPOS_PORTFOLIO: readonly TipoLegivel[] = Object.values(TIPOS);
export const tipoPortfolio = (t: Pick<Trabalho, "tipo">): TipoLegivel => TIPOS[t.tipo] ?? TIPOS.feature;

export interface FiltroPortfolio { estado: EstadoPortfolio | "todos"; tipo: TipoTrabalho | "todos"; busca: string }
const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrarTrabalhos(trabalhos: readonly Trabalho[], f: FiltroPortfolio): Trabalho[] {
  const q = norm(f.busca.trim());
  return trabalhos.filter((t) =>
    (f.estado === "todos" || estadoPortfolio(t) === f.estado)
    && (f.tipo === "todos" || t.tipo === f.tipo)
    && (q === "" || norm(t.titulo).includes(q) || norm(t.id).includes(q)));
}

export function progressoTasks(t: Trabalho): { feitas: number; total: number; pct: number } {
  const tasks = tasksDe(t);
  const feitas = tasks.filter((k) => k.status === "concluida").length;
  return { feitas, total: tasks.length, pct: tasks.length === 0 ? 0 : Math.round((feitas / tasks.length) * 100) };
}

export function formatarRelativo(iso: string | null, agora: number = Date.now()): string {
  if (iso === null) return "sem atividade";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "sem atividade";
  const s = Math.max(0, Math.round((agora - ms) / 1000));
  if (s < 60) return "agora";
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

/** Mais recente primeiro; sem atividade vai para o fim (desempate estável pelo título). */
export function porAtividade(a: Trabalho, b: Trabalho): number {
  const ta = a.ultima_atividade === null ? 0 : Date.parse(a.ultima_atividade) || 0;
  const tb = b.ultima_atividade === null ? 0 : Date.parse(b.ultima_atividade) || 0;
  return tb - ta || a.titulo.localeCompare(b.titulo, "pt-BR");
}

export interface ChipTrabalho { rotulo: string; fase: "planejando" | "executando" | "aguardando" | "concluido" | "bloqueado" }
/** O estado em palavras de quem acompanha; bloqueado tem rótulo próprio (vem antes de "Aguardando você"). */
export function chipDoTrabalho(t: Pick<Trabalho, "status" | "estagio" | "bloqueios" | "decisoes_pendentes" | "prodx" | "raio">): ChipTrabalho {
  if (t.status === "bloqueado") return { rotulo: "Bloqueado", fase: "bloqueado" };
  const f = faseLegivel(t);
  return { rotulo: ROTULO_FASE_LEGIVEL[f], fase: f };
}

export interface RaioTrabalho { rotulo: string; alerta: boolean }
export function raioDoTrabalho(t: Pick<Trabalho, "raio">): RaioTrabalho | null {
  const faixa = t.raio?.faixa;
  if (!t.raio || !faixa) return null;
  const alto = faixa.toLowerCase() === "alto";
  return { rotulo: `Raio ${faixa.toUpperCase()}${t.raio.aprovado ? " aprovado" : ""}`, alerta: alto && !t.raio.aprovado };
}

export type SegmentoRastro = "concluida" | "em_andamento" | "bloqueada" | "pendente";
export const MAX_SEGMENTOS = 24;
export interface MiniRastro { segmentos: SegmentoRastro[]; contagem: Record<SegmentoRastro, number>; total: number }
/** O mini-rastro do cartão: um segmento por task (agrupados quando passam de 24), na ordem do plano. */
export function miniRastro(t: Trabalho): MiniRastro {
  const tasks = tasksDe(t);
  const contagem: Record<SegmentoRastro, number> = { concluida: 0, em_andamento: 0, bloqueada: 0, pendente: 0 };
  for (const k of tasks) contagem[k.status]++;
  const n = tasks.length;
  const passo = Math.max(1, Math.ceil(n / MAX_SEGMENTOS));
  const segmentos: SegmentoRastro[] = [];
  for (let i = 0; i < n; i += passo) {
    const grupo = tasks.slice(i, i + passo);
    segmentos.push(
      grupo.some((k) => k.status === "bloqueada") ? "bloqueada"
        : grupo.every((k) => k.status === "concluida") ? "concluida"
          : grupo.some((k) => k.status === "em_andamento" || k.status === "concluida") ? "em_andamento" : "pendente",
    );
  }
  return { segmentos, contagem, total: n };
}
