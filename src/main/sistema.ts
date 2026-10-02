// Medidor de CPU e memória da máquina (D-530…) no main: liga o serviço puro (src/nucleo/sistema) ao Electron. Tudo SOB DEMANDA:
// nada é importado nem agendado no boot; o serviço nasce na primeira chamada de `sistema:*`, e sem assinante há zero timers.
import { cpus, platform } from "node:os";
import type { AmostraSistema } from "../compartilhado/sistema";
import { criarMontadorDetalhe, criarListadorProcessos, type MetricaProcessoApp } from "../nucleo/sistema/detalhe";
import { executarReal, type Executar } from "../nucleo/sistema/executar";
import { fontesReais, lerMemoriaSistema, lerSwap, type FontesMemoria } from "../nucleo/sistema/leitores";
import { temposDe } from "../nucleo/sistema/cpu";
import type { SessaoEntrada } from "../nucleo/sistema/processos";
import { criarServicoSistema, type ServicoSistema } from "../nucleo/sistema/servico";

export interface DependenciasSistemaMain {
  /** envia o evento coalescido ao renderer. */
  enviar: (canal: "sistema:amostra", payload: AmostraSistema) => void;
  /** `app.getAppMetrics()` reduzido. */
  metricasApp: () => MetricaProcessoApp[];
  /** sessões de terminal vivas: rótulo e pid da raiz. */
  sessoes: () => SessaoEntrada[];
  /** evento de domínio `sistema.carga_alta` (só com a preferência de alerta ligada). */
  cargaAlta?: (p: { cpu: number; ram: number; motivo: "cpu" | "ram" }) => void;
  alertaLigado?: () => boolean;
  pidApp?: number;
  agora?: () => number;
  /** testes: substituem o SO. */
  executar?: Executar;
  fontes?: FontesMemoria;
  plataforma?: NodeJS.Platform;
}

export interface SistemaMain {
  servico: ServicoSistema;
  encerrar(): void;
}

export function criarSistemaMain(d: DependenciasSistemaMain): SistemaMain {
  const executar = d.executar ?? executarReal;
  const fontes = d.fontes ?? fontesReais(executar);
  const plataforma = d.plataforma ?? platform();
  const agora = d.agora ?? Date.now;
  const servico = criarServicoSistema({
    lerTempos: () => temposDe(cpus()),
    lerMemoria: () => lerMemoriaSistema(fontes),
    memoriaACada: plataforma === "darwin" ? 2 : 1, // macOS: um `vm_stat` (~1,6 ms no main) a cada 4 s; o resto é leitura de contador
    publicar: (a) => d.enviar("sistema:amostra", a),
    agendar: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return { cancelar: () => clearTimeout(t) }; },
    agora,
    ...(d.cargaAlta === undefined ? {} : { aoCargaAlta: d.cargaAlta }),
    ...(d.alertaLigado === undefined ? {} : { alertaLigado: d.alertaLigado }),
    montarDetalhe: criarMontadorDetalhe({
      listarProcessos: criarListadorProcessos({ plataforma, executar, agora, ...(process.env["SystemRoot"] === undefined ? {} : { raizWindows: process.env["SystemRoot"] }) }),
      metricasApp: d.metricasApp,
      sessoes: d.sessoes,
      lerSwap: () => lerSwap(fontes),
      pidApp: d.pidApp ?? process.pid,
    }),
  });
  return { servico, encerrar: () => servico.encerrar() };
}
