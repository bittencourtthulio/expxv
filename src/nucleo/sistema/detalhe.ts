// Detalhe do popover (D-530…): consumo do PRÓPRIO app e dos AGENTES (árvores das sessões de terminal), top 5 por CPU e por memória.
// Só nomes-base e inteiros; nenhum argumento, caminho ou variável existe nestes dados (não são lidos do SO).
import type { DetalheSistema, ProcessoVisto } from "../../compartilhado/sistema";
import { paraMb, pctDe, type SwapSistema } from "./memoria";
import type { Executar } from "./executar";
import { ARGUMENTOS_POWERSHELL, ARGUMENTOS_PS, converterCpuWindows, parsearListaWindows, parsearPs, resumirAgentes, topPor, type ProcessoSO, type SessaoEntrada } from "./processos";
import type { InstantaneoSistema } from "./servico";

export interface MetricaProcessoApp { pid: number; tipo: string; cpu: number; memKb: number }

export interface DependenciasDetalhe {
  listarProcessos: () => Promise<ProcessoSO[]>;
  /** `app.getAppMetrics()` reduzido (main, renderer, GPU, utilitários). */
  metricasApp: () => MetricaProcessoApp[];
  /** sessões de terminal vivas: rótulo legível e pid da raiz (o daemon já conhece). */
  sessoes: () => SessaoEntrada[];
  lerSwap: () => Promise<SwapSistema | null>;
  pidApp: number;
}

const ROTULO_TIPO: Readonly<Record<string, string>> = { Browser: "Principal", Tab: "Interface", GPU: "GPU", Utility: "Utilitário", "Pepper Plugin": "Plugin", Zygote: "Zigoto", "Sandbox helper": "Auxiliar" };
const rotuloDoTipo = (t: string): string => ROTULO_TIPO[t] ?? "Auxiliar";

export function criarMontadorDetalhe(d: DependenciasDetalhe): (i: InstantaneoSistema) => Promise<DetalheSistema> {
  return async ({ cpu, memoria }) => {
    const [lista, swap] = await Promise.all([d.listarProcessos().catch((): ProcessoSO[] => []), d.lerSwap()]);
    const metricas = d.metricasApp();
    const sessoes = d.sessoes();
    const resumo = resumirAgentes(lista, sessoes);

    const processosApp: ProcessoVisto[] = metricas.map((m) => ({ nome: rotuloDoTipo(m.tipo), origem: "app", sessao: null, cpu: Math.round(m.cpu), mem_mb: Math.round(m.memKb / 1024) }));
    // daemon de PTY: pai comum das raízes das sessões, quando não é o próprio app nem o init
    if (resumo.paiComum !== null && resumo.paiComum !== d.pidApp && resumo.paiComum > 1) {
      const daemon = lista.find((p) => p.pid === resumo.paiComum);
      if (daemon !== undefined) processosApp.push({ nome: "Daemon de PTY", origem: "app", sessao: null, cpu: Math.round(daemon.cpu), mem_mb: Math.round(daemon.rssKb / 1024) });
    }
    const total = memoria?.total ?? 0;
    const usada = memoria?.usada ?? 0;
    return {
      cpu_total: cpu?.total ?? 0,
      nucleos: cpu?.nucleos ?? [],
      ram: { pct: pctDe(usada, total), usada_mb: paraMb(usada), total_mb: paraMb(total), disponivel_mb: paraMb(memoria?.disponivel ?? 0) },
      swap: swap === null ? null : { usado_mb: paraMb(swap.usado), total_mb: paraMb(swap.total) },
      app: { cpu: processosApp.reduce((a, p) => a + p.cpu, 0), mem_mb: processosApp.reduce((a, p) => a + p.mem_mb, 0), processos: processosApp },
      agentes: resumo.agentes,
      top_cpu: topPor([...processosApp, ...resumo.processos], "cpu"),
      top_mem: topPor([...processosApp, ...resumo.processos], "mem_mb"),
    };
  };
}

/** Listador de processos por plataforma (argumentos fixos; Windows mantém o tempo anterior para o delta de CPU). */
export function criarListadorProcessos(opcoes: { plataforma: NodeJS.Platform; executar: Executar; agora: () => number; raizWindows?: string }): () => Promise<ProcessoSO[]> {
  if (opcoes.plataforma === "win32") {
    let anterior: ReadonlyMap<number, number> | null = null;
    let quando = 0;
    const bin = `${opcoes.raizWindows ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    return async () => {
      const atual = parsearListaWindows(await opcoes.executar(bin, ARGUMENTOS_POWERSHELL, 5_000));
      const agora = opcoes.agora();
      const r = converterCpuWindows(anterior, atual, agora - quando);
      anterior = new Map(atual.map((p) => [p.pid, p.tempo100ns]));
      quando = agora;
      return r;
    };
  }
  return async () => parsearPs(await opcoes.executar("/bin/ps", ARGUMENTOS_PS, 3_000));
}
