// Montagem compartilhada dos testes da gestão ágil no main (SQLite real em memória, barramento real, portas falsas). Só para testes.
import { HOJE, WS, ocorrencias, todasAsFontes } from "./gerar";
import type { PortasAgil } from "../../../src/nucleo/agil/portas";
import { criarRepositorios } from "../../../src/nucleo/banco/repos";
import { abrirBanco, migrar, type Banco } from "../../../src/nucleo/banco";
import { criarBarramento } from "../../../src/main/barramento";
import { criarServicoAgil, type DepsAgilMain, type ServicoAgil } from "../../../src/main/agil";
import type { PortaMetodoMain } from "../../../src/main/agil-metodo";

export const WS_A = "ws_AAAAAAAAAAAA";
export const WS_B = "ws_BBBBBBBBBBBB";

export interface MontagemAgil {
  banco: Banco;
  servico: ServicoAgil;
  barramento: ReturnType<typeof criarBarramento>;
  rel: { agora: number };
  arquivos: Map<string, string>;
  dominio: { tipo: string; payload: Record<string, unknown> }[];
  agoraRenderer: Record<string, unknown>[];
  metodo: PortaMetodoMain;
  avisos: string[];
  fechar(): void;
}

const TIPOS_DOMINIO = ["sprint.iniciada", "sprint.fechada", "sprint.em_risco", "tarefa.atrasada", "retrabalho.detectado", "wip.excedido", "acao_retro.vencida", "agil.estimativa_pronta"];

/** método falso: devolve as fontes da fixture (40 trabalhos) como se fossem do workspace pedido. */
export function metodoDaFixture(n = 40, bloqueios = 0): PortaMetodoMain & { chamadas: { fontes: number } } {
  const chamadas = { fontes: 0 };
  return {
    chamadas,
    fontes: async () => { chamadas.fontes++; return todasAsFontes().slice(0, n); },
    ocorrencias: async () => ocorrencias(),
    historicoSprintx: async () => null,
    esquecer: () => undefined,
    bloqueiosAbertos: () => bloqueios,
  };
}

export function montarAgil(o: { portas?: Partial<PortasAgil>; metodo?: PortaMetodoMain; workspaces?: string[]; inicio?: string; extra?: Partial<DepsAgilMain> } = {}): MontagemAgil {
  const banco = abrirBanco(":memory:");
  migrar(banco);
  const wss = o.workspaces ?? [WS_A, WS_B, WS];
  for (const w of wss) banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [w, w, `/r/${w}`, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]);
  const repos = criarRepositorios(banco);
  const barramento = criarBarramento();
  const dominio: MontagemAgil["dominio"] = [];
  const agoraRenderer: Record<string, unknown>[] = [];
  for (const t of TIPOS_DOMINIO) barramento.assinar(t, (p) => dominio.push({ tipo: t, payload: p as Record<string, unknown> }));
  barramento.assinar("agil:evento", (p) => agoraRenderer.push(p as Record<string, unknown>));
  const rel = { agora: Date.parse(o.inicio ?? HOJE) };
  const arquivos = new Map<string, string>();
  const avisos: string[] = [];
  const metodo = o.metodo ?? metodoDaFixture();
  const servico = criarServicoAgil({
    banco,
    workspaceExiste: (id) => repos.workspace.obter(id) !== undefined,
    repoConfig: repos.config,
    metodo,
    ...(o.portas ? { portas: o.portas } : {}),
    barramento,
    escreverExportacao: async (nome, conteudo) => { arquivos.set(nome, conteudo); return `agil/exportacoes/${nome}`; },
    relogio: () => rel.agora,
    aviso: (m) => avisos.push(m),
    ...(o.extra ?? {}),
  });
  return { banco, servico, barramento, rel, arquivos, dominio, agoraRenderer, metodo, avisos, fechar: () => { servico.encerrar(); banco.fechar(); } };
}
