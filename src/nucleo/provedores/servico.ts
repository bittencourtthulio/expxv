// Provedores (T-02.04): ferramentas detectadas (com versão lida com timeout pelo detector) + contas.
// Presença local NÃO significa autenticação: a CLI cuida do próprio login.
import type { DiagnosticoTerminais, FerramentaDetectada } from "../../compartilhado/terminais";
import type { ProvedorInfo } from "../../compartilhado/dominio";
import { ocultarPastaPessoal } from "../terminais/diagnostico";
import type { Conta } from "../dominio";
import { PROVEDORES_COM_PADRAO, type LoginDaConta, type ServicoContas } from "./contas";

export interface DetectorDeProvedores {
  detectar(): Promise<FerramentaDetectada[]>;
  invalidar(): void;
}

export interface ItemProviderList {
  provider: string;
  cli: string;
  accounts: Array<{ account_id: string; label: string }>;
  enabled: boolean;
}

export interface ServicoProvedores {
  /** `provedores:listar`: a UI vê também as contas desabilitadas (para reabilitar). */
  listar(forcar: boolean): Promise<ProvedorInfo[]>;
  /** Forma da tool MCP `provider_list`: só CLIs instaladas e só contas habilitadas. */
  providerList(): Promise<ItemProviderList[]>;
  diagnostico(): Promise<DiagnosticoTerminais>;
  /** Cria, sob demanda e de forma idempotente, a "Conta padrão" das CLIs instaladas que ainda não têm uma. Devolve as criadas agora. */
  garantirContasPadrao(): Promise<Conta[]>;
}

export function criarServicoProvedores(deps: {
  detector: DetectorDeProvedores;
  contas: ServicoContas;
  /** Chamado quando a autodetecção criou contas (religa limites/harness; a UI recarrega a lista). */
  aoContasCriadas?: (criadas: readonly Conta[]) => void;
  /** Autodetecção da conta padrão (padrão: ligada). */
  autoPadrao?: boolean;
}): ServicoProvedores {
  const { detector, contas } = deps;
  const ferramentas = (): Promise<FerramentaDetectada[]> => detector.detectar();

  async function garantirContasPadrao(): Promise<Conta[]> {
    const criadas: Conta[] = [];
    if (deps.autoPadrao === false) return criadas;
    for (const f of await ferramentas().catch(() => [] as FerramentaDetectada[])) {
      // desabilitada pelo usuário continua existindo: `temPadrao` não olha `habilitada`, então nunca é recriada nem religada
      if (!f.instalado || !PROVEDORES_COM_PADRAO.includes(f.id) || contas.temPadrao(f.id)) continue;
      const c = contas.criarPadrao(f.id);
      if (c !== null) criadas.push(c);
    }
    if (criadas.length > 0) deps.aoContasCriadas?.(criadas);
    return criadas;
  }
  /** Conta padrão sem sinal de login não entra no roteamento (a UI a mostra como "não autenticada"). */
  const semLogin = (c: Conta): boolean => contas.ehPadrao(c) && contas.loginDaConta(c) === "nao_autenticada";

  return {
    async listar(forcar) {
      if (forcar) detector.invalidar();
      const lista = await ferramentas();
      await garantirContasPadrao();
      const todas = contas.listar();
      return lista.map((ferramenta) => {
        const deste = todas.filter((c) => c.provedor === ferramenta.id);
        const estado: Record<string, LoginDaConta> = {};
        for (const c of deste) if (contas.ehPadrao(c)) estado[c.id] = contas.loginDaConta(c);
        return { ferramenta, contas: deste, ...(Object.keys(estado).length > 0 ? { login_contas: estado } : {}) };
      });
    },

    garantirContasPadrao,

    async providerList() {
      const lista = await ferramentas();
      await garantirContasPadrao();
      const todas = contas.listar();
      return lista
        .filter((f) => f.instalado && f.id !== "terminal")
        .map((f) => {
          const deste = todas.filter((c) => c.provedor === f.id && !semLogin(c));
          const ativas = deste.filter((c) => c.habilitada);
          return {
            provider: f.id,
            cli: f.id,
            accounts: ativas.map((c) => ({ account_id: c.id, label: c.rotulo })),
            // com contas cadastradas e todas desabilitadas, o provedor fica fora de uso
            enabled: deste.length === 0 || ativas.length > 0,
          };
        });
    },

    async diagnostico() {
      const lista = await ferramentas().catch(() => [] as FerramentaDetectada[]);
      const porProvedor: Record<string, { total: number; habilitadas: number }> = {};
      for (const c of contas.listar()) {
        const p = (porProvedor[c.provedor] ??= { total: 0, habilitadas: 0 });
        p.total++;
        if (c.habilitada) p.habilitadas++;
      }
      const dados = {
        so: process.platform,
        arquitetura: process.arch,
        ferramentas: lista.map((f) => ({ id: f.id, instalado: f.instalado, versao: f.versao, erro_codigo: f.erro_codigo })),
        contas: { por_provedor: porProvedor },
      };
      return { texto: ocultarPastaPessoal(JSON.stringify(dados, null, 2)) };
    },
  };
}
