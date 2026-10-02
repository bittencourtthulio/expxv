// OpenRouter no main (Fase 9, T-09.26/28): junta o serviço puro de `nucleo/openrouter` ao banco, ao cofre (sob demanda), à rede e ao serviço de
// limites. Nada aqui roda no boot: cofre e rede só nascem no primeiro clique/uso; `iniciar()` apenas re-libera o host se o consentimento já
// estava gravado (sem tocar a rede). O `ErroMcp` nominal de cada recusa de `pane_spawn` nasce aqui (a thread do MCP só o repassa).
import type { Banco } from "../nucleo/banco";
import type { Repositorios } from "../nucleo/banco/repos";
import type { Cofre } from "../nucleo/cofre";
import type { AdaptadorLimite } from "../nucleo/limites/adaptadores/adaptador";
import { criarAdaptadorOpenRouterSaldo } from "../nucleo/limites/adaptadores/openrouter-saldo";
import { ErroMcp, indisponivel } from "../nucleo/mcp/erros";
import type { ModeloInfo, ProvedorInfo } from "../nucleo/mcp/portas";
import { criarServicoOpenRouter, OpenRouterErro, type DestinoOpenRouter, type ServicoOpenRouter } from "../nucleo/openrouter";
import { criarClienteRede, criarRegistroConsentimento, type ClienteRede, type RegistroConsentimento } from "../nucleo/rede";
import type { ServicoProvedores } from "../nucleo/provedores/servico";
import type { Faixa } from "../compartilhado/harness";
import type { Barramento } from "./barramento";

export interface PedidoLancamentoOpenRouter {
  workspace_id: string;
  cli: string | null;
  modelo: string | null;
  conta_id: string | null;
}
export interface LancamentoParaPane {
  cli: string;
  modelo: string;
  faixa: Faixa;
  argumentos: string[];
  ambiente: Record<string, string>;
  avisos: string[];
}

/** O que a orquestração (thread principal) usa do OpenRouter: provedor virtual, modelos habilitados e lançamento com adaptador. */
export interface PortaOpenRouterMain {
  provedor(): Promise<ProvedorInfo>;
  modelos(): Promise<ModeloInfo[]>;
  /** valida modelo habilitado e CLI compatível e monta argv/ambiente. Lança `ErroMcp` nominal. */
  lancar(p: PedidoLancamentoOpenRouter): Promise<LancamentoParaPane>;
}

export interface OpenRouterMain {
  servico: ServicoOpenRouter;
  /** fonte de limite `openrouter` (janela `credit`) para o `LimitsService`. */
  adaptadorLimite: AdaptadorLimite;
  porta: PortaOpenRouterMain;
  /** só re-libera o host consentido; nenhuma chamada de rede. */
  iniciar(): void;
  /** o Pane OpenRouter vivo existe? (decide se o saldo é consultado sozinho). */
  paneVivo(): boolean;
}

export interface DependenciasOpenRouterMain {
  repos: Pick<Repositorios, "config" | "conta" | "contaOpenrouter" | "openrouterModelo" | "harnessWorkspace">;
  banco: Pick<Banco, "consultarUm">;
  cofre: () => Promise<Cofre>;
  provedores: Pick<ServicoProvedores, "listar">;
  barramento: Pick<Barramento, "emitir">;
  /** a lista de contas mudou / o saldo mudou: o main reidrata/recarrega o `LimitsService` (ligado depois; leitura preguiçosa). */
  aoContasMudarem?: () => void;
  aoSaldoAtualizado?: (contaId: string) => void;
  /** injeções de teste */
  rede?: ClienteRede;
  consentimento?: RegistroConsentimento;
  destino?: DestinoOpenRouter;
  agora?: () => number;
  /** remove valores do cofre de logs/erros nativos da rede (padrão: sem scrub até o cofre abrir). */
  scrub?: (texto: string) => string;
}

const SQL_PANE_OPENROUTER_VIVO = `SELECT 1 AS x FROM pane_rota r JOIN pane p ON p.id = r.pane_id
  WHERE p.estado <> 'encerrado' AND json_extract(r.perfil_json, '$.provider') = 'openrouter' LIMIT 1`;

/** `OpenRouterErro` → erro nominal do contrato do MCP (§3). */
export function erroMcpDoOpenRouter(e: unknown): ErroMcp {
  if (e instanceof ErroMcp) return e;
  if (e instanceof OpenRouterErro) {
    if (e.codigo === "sem_consentimento") return new ErroMcp("rule_violation", "O OpenRouter ainda não foi consentido.", "openrouter_not_consented");
    if (e.codigo === "modelo_nao_habilitado") return new ErroMcp("rule_violation", "O modelo do OpenRouter não está habilitado.", "model_not_enabled");
    if (e.codigo === "sem_cli_compativel") return new ErroMcp("unavailable", "Nenhuma CLI compatível com o OpenRouter está instalada.", "no_compatible_cli");
  }
  return indisponivel("Não foi possível preparar o Pane OpenRouter.");
}

export function criarOpenRouterMain(d: DependenciasOpenRouterMain): OpenRouterMain {
  const consentimento = d.consentimento ?? criarRegistroConsentimento();
  let rede: ClienteRede | null = d.rede ?? null;
  const redeAgora = (): ClienteRede => (rede ??= criarClienteRede({ consentimento, scrub: d.scrub ?? ((t) => t) }));
  const paneVivo = (): boolean => {
    try {
      return d.banco.consultarUm(SQL_PANE_OPENROUTER_VIVO) !== undefined;
    } catch {
      return false;
    }
  };
  const servico = criarServicoOpenRouter({
    repos: d.repos,
    cofre: d.cofre,
    rede: redeAgora,
    consentimento,
    ...(d.destino === undefined ? {} : { destino: d.destino }),
    ...(d.agora === undefined ? {} : { agora: d.agora }),
    instaladas: async () => {
      const lista = await d.provedores.listar(false);
      return lista.filter((p) => p.ferramenta.instalado).map((p) => p.ferramenta.id);
    },
    emitir: (tipo, payload) => {
      try {
        d.barramento.emitir(tipo, payload);
      } catch {
        /* evento nunca derruba a ação */
      }
    },
    aoSaldoAtualizado: (id) => d.aoSaldoAtualizado?.(id),
    aoContasMudarem: () => d.aoContasMudarem?.(),
  });

  const adaptadorLimite = criarAdaptadorOpenRouterSaldo({
    saldoDe: (id) => d.repos.contaOpenrouter.obter(id),
    consentido: () => servico.consentido(),
    paneVivo,
    consultar: (id) => servico.consultarSaldoPeriodico(id),
  });

  const porta: PortaOpenRouterMain = {
    async provedor() {
      const r = await servico.resumo();
      const habilitado = r.motivo_indisponivel === null;
      return {
        provedor: "openrouter",
        cli: r.clis[0] ?? "openrouter",
        contas: r.contas,
        habilitado,
        clis: r.clis,
        ...(r.motivo_indisponivel === null ? {} : { motivo_desabilitado: r.motivo_indisponivel }),
      };
    },
    async modelos() {
      return servico.modelosHabilitados().map((m): ModeloInfo => ({ modelo: m.id, niveis_esforco: [], ...(m.faixa === null ? {} : { faixa: m.faixa }) }));
    },
    async lancar(p) {
      try {
        const injetar = d.repos.harnessWorkspace.obter(p.workspace_id).injetar_cofre_no_env;
        const l = await servico.preparar({ cli: p.cli, modelo: p.modelo, conta_id: p.conta_id, injetar_chave: injetar });
        const m = servico.modelosHabilitados().find((x) => x.id === l.modelo);
        return { cli: l.cli, modelo: l.modelo, faixa: m?.faixa ?? "medio", argumentos: l.argumentos, ambiente: l.ambiente, avisos: l.avisos };
      } catch (e) {
        throw erroMcpDoOpenRouter(e);
      }
    },
  };

  return { servico, adaptadorLimite, porta, iniciar: () => servico.iniciar(), paneVivo };
}
