// Ligação da documentação e relatórios de entrega (Fase 19, onda 1) no main: portas sobre a gestão ágil, o método (PR da entrega), o harness/CLI do usuário e o cofre (scrub),
// repositório SQLite, escolha de pasta pelo diálogo do SO e o gancho `sprint.fechada`.
//
// REGRAS DESTA CAMADA
//  - NADA RODA NO BOOT: este módulo só é importado no primeiro uso (canal `relatorios:*` ou evento `sprint.fechada`); nenhum I/O ao criar o serviço.
//  - O ADE NUNCA escreve em `docs/**` (D-04): o pacote vai para `<raiz do workspace>/<pasta do produto>/relatorios/**`; a exportação só vai para a pasta que a PESSOA escolhe no diálogo.
//  - O renderer nunca vê nem envia caminho; aprovar, consentir, exportar e enviar só entram pelos canais `relatorios:*` (ação humana).
//  - A IA só roda com consentimento do workspace e sobre fatos saneados; a CLI roda sem ferramentas (reusa a porta headless da gestão ágil, com prompt de sistema próprio).
//  - Nenhum canal externo é ligado aqui: a porta `canais` é injetada pela Fase 20; sem ela a divulgação só fica como rascunho para copiar.
import type { EventoAgil } from "../compartilhado/agil";
import { ID_CANAL_TELEGRAM } from "../compartilhado/alertas";
import type { CustoSprint } from "../compartilhado/custo";
import type { ApiRelatorios, CanalDivulgacao } from "../compartilhado/relatorios";
import type { Banco } from "../nucleo/banco";
import { criarRepoRelatoriosSqlite } from "../nucleo/banco/repos/relatorios";
import type { Trabalho } from "../nucleo/metodo/tipos";
import { regraViolada, naoEncontrado } from "../nucleo/relatorios/erros";
import type { ItemBruto, PortaAgil, PortaCanais, PortaCusto, PortaHeadless, PortaMapa, PortaPerfil, PortaVersionamento, PortasRelatorios } from "../nucleo/relatorios/portas";
import { criarRelatorios, type Relatorios } from "../nucleo/relatorios/servico";
import type { Barramento } from "./barramento";
import type { ServicoAgil } from "./agil";

const ceder = (): Promise<void> => new Promise((r) => setImmediate(r));
const LOTE_ITENS = 25;

/** sprint fechada da gestão ágil + um `itemLer` por item (em lotes, cedendo o laço de eventos) + painel filtrado pela sprint. */
export function criarPortaAgilMain(agil: () => Promise<ServicoAgil>): PortaAgil {
  return {
    async sprint(ws, sprintId) {
      const a = await agil();
      const sp = a.sprintListar(ws).find((s) => s.id === sprintId);
      if (sp === undefined) return null;
      if (sp.estado !== "fechada") throw regraViolada("a sprint ainda não foi fechada");
      const itens: ItemBruto[] = [];
      let n = 0;
      for (const si of sp.itens.filter((i) => i.removido_em === null)) {
        try {
          const d = await a.itemLer(ws, si.item_id);
          itens.push({ item: d.item, resumo: d.resumo, fato: d.fato, resultado: si.resultado });
        } catch { /* item sumiu no meio: o relatório segue sem ele */ }
        if (++n % LOTE_ITENS === 0) await ceder();
      }
      const { itens: _omitido, ...sprint } = sp;
      void _omitido;
      let painel = null;
      try { painel = a.painel(ws, { sprint_id: sprintId }); } catch { /* sem painel: as métricas ficam desconhecidas */ }
      return { sprint, itens, painel };
    },
    async sprintsFechadas(ws) {
      const a = await agil();
      return a.sprintListar(ws).filter((s) => s.estado === "fechada").sort((x, y) => (y.fechada_em ?? "").localeCompare(x.fechada_em ?? "") || x.id.localeCompare(y.id))
        .map((s) => ({ id: s.id, nome: s.nome, fechada_em: s.fechada_em, versao_lancamento: s.versao_lancamento }));
    },
  };
}

/** PR da entrega vem do `ENTREGA.md` do método (já lido pelo observador): zero rede, zero `gh`. */
export function criarPortaVersionamentoMain(trabalhos: (ws: string) => readonly Trabalho[]): PortaVersionamento {
  return {
    async prs(ws, ids) {
      const set = new Set(ids);
      return trabalhos(ws).filter((t) => set.has(t.id) && t.entrega?.pr_url).map((t) => ({ trabalho_id: t.id, url: t.entrega?.pr_url as string, estado: t.entrega?.pr_estado ?? null }));
    },
  };
}

/**
 * Fase 19 × 10: custo da sprint pelos agregados reais da Fase 10 (lidos, nunca recalculados). `registros = 0` = nada medido (⇒ `null`, o relatório diz "custo desconhecido", nunca 0);
 * `incompleto` ⇒ `minimo` (≥); senão `exato`. Tokens = entrada + saída observados (a mesma conta da gestão ágil). Sem a Fase 10 ligada, `null`.
 */
export function criarPortaCustoMain(custo: () => { custoDeCards(ws: string, cards: ReadonlyArray<{ trabalho_id: string; task_ref: string }>): CustoSprint } | null): PortaCusto {
  return {
    async sprint(ws, tasks) {
      const c = custo();
      if (c === null || tasks.length === 0) return null;
      const r = c.custoDeCards(ws, tasks).custo;
      if (r.registros === 0) return null;
      const tokens = r.tokens.entrada + r.tokens.saida;
      return { tokens: tokens > 0 ? tokens : null, usd: r.usd, estado: r.usd === null ? "desconhecido" : r.incompleto || r.aproximado ? "minimo" : "exato" };
    },
  };
}

/**
 * Fase 19 × 20: divulgação pelo emissor da Fase 20. SÓ canais com saída ligada e consentimento vigente aparecem em `disponiveis`; o envio recusa sem I/O quando o canal não está pronto
 * (o consentimento próprio da divulgação já foi conferido pelo núcleo antes de chamar). Nunca lança.
 */
export function criarPortaCanaisMain(alertas: () => Pick<import("./alertas").LigacaoAlertas, "canalSaidaPronta" | "canalEnviarTexto"> | null): PortaCanais {
  const idDoCanal: Record<CanalDivulgacao, string> = { telegram: ID_CANAL_TELEGRAM };
  return {
    async disponiveis() {
      const a = alertas();
      if (a === null) return [];
      return (Object.keys(idDoCanal) as CanalDivulgacao[]).filter((c) => a.canalSaidaPronta(idDoCanal[c]));
    },
    async enviar(_ws, canal, texto) {
      const a = alertas();
      if (a === null) return { ok: false, erro: "canal indisponível" };
      return a.canalEnviarTexto(idDoCanal[canal], "Divulgação da sprint", texto);
    },
  };
}

export interface PerfilAgilMin { resolver(ws: string, skill: string, etapa: string): Promise<{ cli: string; modelo: string | null; faixa: string } | null> }
export interface HeadlessAgilMin { executar(p: { perfil: { cli: string; modelo: string | null; faixa: string }; entrada: string; tools: []; timeoutMs: number }): Promise<{ texto: string; tokens: number | null }> }

export interface DepsRelatoriosMain {
  banco: Banco;
  /** raiz ABSOLUTA do workspace (só o main/armazenamento a usam) ou `null` se não existe. */
  workspaceRaiz: (id: string) => string | null;
  agil: () => Promise<ServicoAgil>;
  trabalhos: (ws: string) => readonly Trabalho[];
  perfil?: PerfilAgilMin;
  headless?: HeadlessAgilMin;
  /** redige o valor dos segredos do cofre (já aberto) em qualquer texto. */
  scrub: (texto: string) => string;
  barramento: Pick<Barramento, "emitir" | "emitirCoalescido" | "assinar">;
  /** diálogo do SO para a pasta de exportação (ação explícita do usuário). */
  escolherPasta: () => Promise<string | null>;
  /** Fase 20 (Telegram/alertas) pluga aqui; ausente = divulgação só como rascunho. */
  canais?: PortaCanais;
  mapa?: PortaMapa;
  custo?: PortaCusto;
  relogio?: () => number;
  aviso?: (m: string) => void;
}

export type ServicoRelatorios = {
  configLer(ws: string): ReturnType<Relatorios["configLer"]>;
  configGravar(ws: string, parcial: unknown): ReturnType<Relatorios["configGravar"]>;
  consentimentoLlm(ws: string, consentido: boolean): ReturnType<Relatorios["consentimentoLlm"]>;
  sprints: Relatorios["sprints"];
  listar: Relatorios["listar"];
  ler: Relatorios["ler"];
  gerar: Relatorios["gerar"];
  regenerar: Relatorios["regenerar"];
  previa: Relatorios["previa"];
  ajusteGravar: Relatorios["ajusteGravar"];
  aprovar: Relatorios["aprovar"];
  exportar: (ws: string, pacoteId: string, nomes: string[] | "todos", modo: "pasta" | "zip") => ReturnType<Relatorios["exportar"]>;
  divulgacaoEstado: Relatorios["divulgacao"]["estado"];
  divulgacaoConsentimento: Relatorios["divulgacao"]["consentimento"];
  divulgacaoFila: (ws: string, pacoteId: string) => ReturnType<Relatorios["divulgacao"]["fila"]>;
  divulgacaoEnfileirar: Relatorios["divulgacao"]["enfileirar"];
  divulgacaoAprovar: Relatorios["divulgacao"]["aprovar"];
  divulgacaoEnviar: Relatorios["divulgacao"]["enviar"];
  divulgacaoCancelar: Relatorios["divulgacao"]["cancelar"];
  /** gatilho `sprint.fechada` (Fase 18). */
  aoFecharSprint(ev: EventoAgil): Promise<void>;
  /** espera a fila de geração (testes e encerramento). */
  aguardar(): Promise<void>;
  /** o núcleo (testes). */
  nucleo: Relatorios;
};

export function criarServicoRelatorios(d: DepsRelatoriosMain): ServicoRelatorios {
  const perfil: PortaPerfil = d.perfil ? { resolver: (ws) => d.perfil!.resolver(ws, "relatorios", "redacao") } : { resolver: async () => null };
  const headless: PortaHeadless = d.headless ? { executar: (p) => d.headless!.executar(p) } : { executar: async () => { throw new Error("redator indisponível"); } };
  const portas: Partial<PortasRelatorios> = {
    agil: criarPortaAgilMain(d.agil),
    versionamento: criarPortaVersionamentoMain(d.trabalhos),
    workspace: { raiz: (ws) => d.workspaceRaiz(ws) },
    perfil, headless, scrub: d.scrub,
    eventos: { publicar: (tipo, payload) => d.barramento.emitir(tipo, payload) },
    ...(d.canais ? { canais: d.canais } : {}),
    ...(d.mapa ? { mapa: d.mapa } : {}),
    ...(d.custo ? { custo: d.custo } : {}),
  };
  const n = criarRelatorios({
    portas, repo: criarRepoRelatoriosSqlite(d.banco), ...(d.relogio ? { relogio: d.relogio } : {}),
    aoMudar: (e) => { try { d.barramento.emitirCoalescido("relatorios:evento", `${e.tipo}|${e.workspace_id}|${"pacote_id" in e ? e.pacote_id : ""}`, e, 120); } catch { /* a UI nunca derruba o fluxo */ } },
  });
  /** TODO pedido confere que o workspace existe (e tem raiz) antes de tocar em qualquer coisa. */
  const exigir = (ws: string): void => { if (d.workspaceRaiz(ws) === null) throw naoEncontrado("workspace não encontrado"); };
  const c = <A extends unknown[], R>(f: (ws: string, ...a: A) => R) => (ws: string, ...a: A): R => { exigir(ws); return f(ws, ...a); };
  const s = {
    configLer: c(n.configLer), configGravar: c(n.configGravar), consentimentoLlm: c(n.consentimentoLlm), sprints: c(n.sprints), listar: c(n.listar), ler: c(n.ler), gerar: c(n.gerar), regenerar: c(n.regenerar),
    previa: c(n.previa), ajusteGravar: c(n.ajusteGravar), aprovar: c(n.aprovar),
    exportar: (ws: string, pacoteId: string, nomes: string[] | "todos", modo: "pasta" | "zip") => { exigir(ws); return n.exportar(ws, pacoteId, nomes, modo, d.escolherPasta); },
    divulgacaoEstado: c(n.divulgacao.estado), divulgacaoConsentimento: c(n.divulgacao.consentimento), divulgacaoFila: c(n.divulgacao.fila), divulgacaoEnfileirar: c(n.divulgacao.enfileirar),
    divulgacaoAprovar: c(n.divulgacao.aprovar), divulgacaoEnviar: c(n.divulgacao.enviar), divulgacaoCancelar: c(n.divulgacao.cancelar),
    aoFecharSprint: (ev: EventoAgil): Promise<void> => (d.workspaceRaiz(ev.workspace_id) === null ? Promise.resolve() : n.aoFecharSprint(ev).catch((e: unknown) => d.aviso?.(`relatórios: ${e instanceof Error ? e.message : String(e)}`))),
    aguardar: () => n.aguardar(),
    nucleo: n,
  };
  return s as unknown as ServicoRelatorios;
}
