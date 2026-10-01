// Provedores (T-02.04): ferramentas detectadas (com versão lida com timeout pelo detector) + contas.
// Presença local NÃO significa autenticação: a CLI cuida do próprio login.
import type { DiagnosticoTerminais, FerramentaDetectada } from "../../compartilhado/terminais";
import type { ProvedorInfo } from "../../compartilhado/dominio";
import { ocultarPastaPessoal } from "../terminais/diagnostico";
import type { ServicoContas } from "./contas";

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
}

export function criarServicoProvedores(deps: { detector: DetectorDeProvedores; contas: ServicoContas }): ServicoProvedores {
  const { detector, contas } = deps;
  const ferramentas = (): Promise<FerramentaDetectada[]> => detector.detectar();

  return {
    async listar(forcar) {
      if (forcar) detector.invalidar();
      const [lista, todas] = [await ferramentas(), contas.listar()];
      return lista.map((ferramenta) => ({ ferramenta, contas: todas.filter((c) => c.provedor === ferramenta.id) }));
    },

    async providerList() {
      const todas = contas.listar();
      return (await ferramentas())
        .filter((f) => f.instalado && f.id !== "terminal")
        .map((f) => {
          const deste = todas.filter((c) => c.provedor === f.id);
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
