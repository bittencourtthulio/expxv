// CLI do assistente de execução (D-582…): estado das CLIs, escolha do padrão pelo harness e o executor headless SEM FERRAMENTAS. Reaproveita o executor do chat
// (argv separado, prompt por stdin, `--tools ""`/`-s read-only`, pasta neutra FORA do repositório, ambiente seguro, timeout, teto de saída e morte da árvore de
// processos). Para a OpenCode, que não lê stdin, o executor grava o prompt em arquivo 0600 na pasta neutra e o apaga ao fim. Gemini fica de fora (adaptador experimental).
import { execFile } from "node:child_process";
import { join } from "node:path";
import { CLIS_ASSISTENTE, type CliAssistente, type CliAssistenteEstado } from "../compartilhado/executar-assistente";
import { criarExecutorHeadless, type CliResolvida, type Spawner } from "../nucleo/conhecimento/chat/executor";
import type { PortaLlmAssistente } from "../nucleo/executar/assistente/pipeline";
import { ambienteSeguro } from "../nucleo/terminais/ambiente";
import { criarPortaPerfil, type ResolvedorMin } from "./agil-ia";

export interface DepsCliAssistente {
  /** detector de CLIs dos terminais (caminho real e modo de lançamento); `null` = não instalada */
  resolverCli(cli: string): Promise<CliResolvida | null>;
  userData: string;
  /** harness (Fase 9): escolhe CLI/modelo pelo consumo; ausente = a primeira CLI disponível */
  resolvedor?: () => ResolvedorMin | null;
  spawn?: Spawner;
  /** teste: `--help` da CLI */
  ajuda?: (cli: string, caminho: string) => Promise<string | null>;
  timeoutMs?: number;
}

export interface CliAssistenteMain {
  clis(): Promise<CliAssistenteEstado[]>;
  /** CLI e modelo padrão do workspace (harness; `modelo: null` = o padrão da própria CLI) */
  padrao(workspaceId: string): Promise<{ cli: CliAssistente | null; modelo: string | null }>;
  criarLlm(escolha: { cli: CliAssistente; modelo: string | null }): PortaLlmAssistente;
}

function ajudaDaCli(caminho: string, ambiente: Record<string, string>): Promise<string | null> {
  return new Promise((resolver) => {
    execFile(caminho, ["--help"], { env: ambiente, timeout: 6_000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false }, (erro, stdout, stderr) => {
      const saida = `${String(stdout)}\n${String(stderr)}`;
      resolver(erro !== null && saida.trim() === "" ? null : saida);
    });
  });
}

/** Pasta neutra e vazia onde a CLI roda (nunca o repositório do usuário). */
export const pastaNeutraDoAssistente = (userData: string): string => join(userData, "executar", "assistente-cwd");

export function criarCliAssistente(d: DepsCliAssistente): CliAssistenteMain {
  const clis = async (): Promise<CliAssistenteEstado[]> => {
    const saida: CliAssistenteEstado[] = [];
    for (const cli of CLIS_ASSISTENTE) {
      const r = await d.resolverCli(cli).catch(() => null);
      if (r === null) saida.push({ cli, disponivel: false, motivo: "não está instalada nesta máquina" });
      else if (r.modo !== null && r.modo !== "direto") saida.push({ cli, disponivel: false, motivo: "usa wrapper de Windows; o assistente não executa sem shell" });
      else saida.push({ cli, disponivel: true, motivo: null });
    }
    return saida;
  };
  const porta = criarPortaPerfil({ resolvedor: () => d.resolvedor?.() ?? null, faixa: () => "medio" });
  return {
    clis,
    async padrao(ws) {
      const estado = await clis();
      const disponiveis = estado.filter((c) => c.disponivel).map((c) => c.cli);
      try {
        const p = await porta.resolver(ws, "executar", "assistente");
        if (p !== null && (disponiveis as string[]).includes(p.cli)) return { cli: p.cli as CliAssistente, modelo: p.modelo };
      } catch { /* sem harness: cai na primeira disponível */ }
      return { cli: disponiveis[0] ?? null, modelo: null };
    },
    criarLlm({ cli, modelo }) {
      return criarExecutorHeadless({
        perfil: () => ({ cli, modelo, esforco: null, faixa: "medio" }),
        resolverCli: (c) => d.resolverCli(c),
        ajuda: d.ajuda ?? ((_c, caminho) => ajudaDaCli(caminho, ambienteSeguro({ caminho }))),
        ambiente: (caminho) => ambienteSeguro({ caminho }),
        pastaNeutra: pastaNeutraDoAssistente(d.userData),
        ...(d.spawn === undefined ? {} : { spawn: d.spawn }),
        ...(d.timeoutMs === undefined ? {} : { timeoutMs: d.timeoutMs }),
      });
    },
  };
}
