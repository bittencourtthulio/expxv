// Painel de workspaces falso (só teste e verificação visual): 6 workspaces com agentes em estados variados, uma Missão com piloto e workers,
// execução do projeto, um cartão com mais de 6 agentes e um sem nenhum. `workspacesFalsoComPainel` completa o `window.ade` falso.
import type { ApiAde } from "../../compartilhado/ipc";
import type { Workspace } from "../../compartilhado/dominio";
import { adicionarFalso, type FatiaAdicionar } from "./ade-falso-adicionar";
import type { AgenteResumo, ItemWorkspaceResumo, ResumoWorkspaces } from "../../compartilhado/workspaces-resumo";

const agora = (): number => Date.now();
const ag = (sessao_id: string, titulo: string, extra: Partial<AgenteResumo> = {}): AgenteResumo => ({
  sessao_id, pane_id: null, mission_id: null, pai_sessao_id: null, profundidade: 0, ferramenta_id: "claude", titulo, papel: null, piloto: false, estado: "ocioso", sessao_estado: "executando",
  atividade: null, desde: agora() - 14 * 60_000, atividade_em: null, linha: null, subagentes: null, ...extra,
});
const contagens = (a: AgenteResumo[], terminais = 0): ItemWorkspaceResumo["contagens"] => ({
  agentes: a.length, trabalhando: a.filter((x) => x.estado === "trabalhando").length, aguardando: a.filter((x) => x.estado === "aguardando").length, erro: a.filter((x) => x.estado === "erro").length,
  subagentes: a.reduce((n, x) => n + (x.subagentes?.ativos ?? 0), 0), terminais,
});
const item = (id: string, nome: string, pasta: string, branch: string | null, sujo: boolean | null, agentes: AgenteResumo[], extra: Partial<ItemWorkspaceResumo> = {}): ItemWorkspaceResumo => ({
  id, nome, pasta_mascarada: pasta, branch, sujo, atual: false, missao: null, missoes_ativas: 0, agentes, execucao: null, contagens: contagens(agentes), ...extra,
});

export function resumoVisual(): ResumoWorkspaces {
  const t = agora();
  const w1 = [
    ag("s1p", "Claude Code · piloto", { piloto: true, papel: "piloto", pane_id: "p1", mission_id: "m1", estado: "trabalhando", atividade: "trabalhando", atividade_em: t - 95_000, linha: "editando src/rotas/login.ts", subagentes: { total: 3, ativos: 2 } }),
    ag("s1a", "Codex · executor #2", { pai_sessao_id: "s1p", profundidade: 1, papel: "executor", ferramenta_id: "codex", pane_id: "p2", mission_id: "m1", estado: "aguardando", atividade: "aguardando", atividade_em: t - 40_000, linha: "aprovar: npm test -- login" }),
    ag("s1b", "Gemini CLI · revisor #3", { pai_sessao_id: "s1p", profundidade: 1, papel: "revisor", ferramenta_id: "gemini", pane_id: "p3", mission_id: "m1", estado: "ocioso" }),
  ];
  const w3 = Array.from({ length: 9 }, (_, i) => ag(`s3${i}`, i === 0 ? "Claude Code" : `Claude Code #${i + 1}`, i % 3 === 0 ? { estado: "trabalhando", atividade: "trabalhando", atividade_em: t - 20_000 * (i + 1), linha: "rodando testes" } : { estado: "pronto", atividade: "pronto", atividade_em: t - 300_000 }));
  const itens: ItemWorkspaceResumo[] = [
    item("w1", "expx-site", "~/Documents/Projetos/expx-site", "feature/login", true, w1, {
      atual: true,
      missao: { id: "m1", titulo: "Login com Google", modo: "squad", estado: "executando", piloto_sessao_id: "s1p" }, missoes_ativas: 1,
      execucao: { fase: "rodando", nome: "dev", porta: 5173, sessao_id: "r1", iniciado_em: t - 8 * 60_000 },
    }),
    item("w2", "api-pagamentos", "~/Documents/Projetos/Producao/api-pagamentos", "main", false, [
      ag("s2a", "Claude Code", { estado: "aguardando", atividade: "aguardando", atividade_em: t - 5 * 60_000, linha: "Posso aplicar a migração 0042?" }),
      ag("s2b", "Codex", { ferramenta_id: "codex", estado: "trabalhando", atividade: "trabalhando", atividade_em: t - 30_000, linha: "lendo src/webhooks/stripe.ts" }),
    ]),
    item("w3", "monorepo-app", "~/projetos/monorepo-app", "dev/principal", true, w3),
    item("w4", "landing-sala-dos-mestres", "~/Documents/Projetos/Testes/ExpxAgents/squads/sala-dos-mestres-landing", "main", false, []),
    item("w5", "dados-etl", "~/dados/etl", "hotfix/csv", null, [ag("s5a", "OpenCode", { ferramenta_id: "opencode", estado: "erro", sessao_estado: "erro", linha: "falha ao iniciar a CLI (código 1)" })]),
    item("w6", "app-mobile", "~/Documents/Projetos/app-mobile", null, null, [], {
      execucao: { fase: "falhou", nome: "build ios", porta: null, sessao_id: "r6", iniciado_em: t - 120_000 },
      contagens: { agentes: 0, trabalhando: 0, aguardando: 0, erro: 0, subagentes: 0, terminais: 2 },
    }),
  ];
  return { versao: 1, gerado_em: t, itens };
}

export const workspacesVisuais = (): Workspace[] => resumoVisual().itens.map((i) => ({ id: i.id, nome: i.nome, raiz: i.pasta_mascarada.replace("~", "/Users/ana"), e_git: i.branch !== null, acesso_externo: "nenhum", permissao: "seguro", ultimo_uso_em: null, criado_em: "x", atualizado_em: "x" }));

/** Completa a fatia `workspaces` do `window.ade` falso com o painel (resumo, ativar, encerrar, revelar, copiar, assinar). */
type FatiaBase = Omit<ApiAde["workspaces"], "resumo" | "ativarResumo" | "encerrarAgente" | "revelar" | "copiarCaminho" | "assinarResumo" | keyof FatiaAdicionar>;
export function workspacesFalsoComPainel(base: FatiaBase, resumo: ResumoWorkspaces = resumoVisual()): ApiAde["workspaces"] {
  return {
    ...adicionarFalso(),
    ...base,
    resumo: async () => resumo,
    ativarResumo: async (ativo) => ativo,
    encerrarAgente: async () => ({ ok: true, motivo: "encerrado" }),
    revelar: async () => true,
    copiarCaminho: async () => true,
    assinarResumo: () => () => undefined,
  };
}
