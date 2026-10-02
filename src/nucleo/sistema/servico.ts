// Serviço do medidor (D-530…): UMA amostragem compartilhada de CPU (delta de `os.cpus()`) e memória, só enquanto há assinante E a
// política permite (janela visível e focada, ou desfocada há ≤ 10 s). Sem assinante/pausada = ZERO timers. Timer `unref`.
// Publicação coalescida: no máximo uma por intervalo (2 s), payload de dois inteiros.
import { INTERVALO_AMOSTRA_MS, type AmostraSistema, type DetalheSistema } from "../../compartilhado/sistema";
import { usoCpu, type TemposNucleo, type UsoCpu } from "./cpu";
import type { MemoriaSistema } from "./memoria";
import { pctDe } from "./memoria";
import { criarDetectorCargaAlta, deveAmostrar, type EstadoJanelaSistema } from "./politica";

/** Primeira amostra: leitura-base na hora, primeiro delta depois de 0,7 s (CPU precisa de dois pontos). */
export const PRIMEIRA_AMOSTRA_MS = 700;
/** O detalhe só vale enquanto o renderer o renova (popover aberto): passou disso sem pedido, volta a nulo. */
export const VALIDADE_DETALHE_ABERTO_MS = 6_000;
/** Reaproveita o detalhe calculado há menos que isto (o popover pede a cada 2 s). */
export const REUSO_DETALHE_MS = 1_500;

export interface Cronometro { cancelar(): void }

export interface InstantaneoSistema { cpu: UsoCpu | null; memoria: MemoriaSistema | null }

export interface DependenciasServicoSistema {
  lerTempos: () => TemposNucleo[];
  lerMemoria: () => Promise<MemoriaSistema>;
  /** 1 = memória a cada amostra; 2 = a cada 2 (macOS: custa um `vm_stat`). */
  memoriaACada?: number;
  publicar: (a: AmostraSistema) => void;
  agendar: (fn: () => void, ms: number) => Cronometro;
  agora: () => number;
  /** monta o detalhe do popover (só chamada com o popover aberto). */
  montarDetalhe?: (i: InstantaneoSistema) => Promise<DetalheSistema>;
  /** opcional: carga alta sustentada (evento de domínio `sistema.carga_alta`). */
  aoCargaAlta?: (i: { cpu: number; ram: number; motivo: "cpu" | "ram" }) => void;
  /** consultado a cada amostra: o alerta só dispara com a preferência ligada. */
  alertaLigado?: () => boolean;
}

export interface ServicoSistema {
  definirAssinatura(ativo: boolean): void;
  aoJanela(estado: Partial<Omit<EstadoJanelaSistema, "desfocadaDesde">>): void;
  detalhe(aberto: boolean): Promise<DetalheSistema | null>;
  ultima(): AmostraSistema | null;
  /** há timer agendado? (testes e perf). */
  ativo(): boolean;
  /** uma amostra agora, sem timer (perf/testes). */
  amostrarAgora(): Promise<AmostraSistema | null>;
  encerrar(): void;
}

export function criarServicoSistema(d: DependenciasServicoSistema): ServicoSistema {
  const memoriaACada = Math.max(1, d.memoriaACada ?? 1);
  let assinado = false;
  const janela: EstadoJanelaSistema = { visivel: true, minimizada: false, focada: true, desfocadaDesde: null };
  let timer: Cronometro | null = null;
  let anterior: TemposNucleo[] | null = null;
  let cpu: UsoCpu | null = null;
  let memoria: MemoriaSistema | null = null;
  let tick = 0;
  let ultimaPub = Number.NEGATIVE_INFINITY;
  let ultima: AmostraSistema | null = null;
  let detalheAte = 0;
  let detalheCache: { quando: number; valor: DetalheSistema } | null = null;
  let detalheEmCurso: Promise<DetalheSistema | null> | null = null;
  let encerrado = false;
  const detector = criarDetectorCargaAlta();

  const parar = (): void => { timer?.cancelar(); timer = null; anterior = null; };
  const agendar = (ms: number): void => { timer = d.agendar(() => void executarTick(), ms); };

  function reavaliar(): void {
    if (encerrado) return;
    const deve = deveAmostrar(assinado, janela, d.agora());
    if (deve && timer === null) {
      anterior = d.lerTempos(); // leitura-base
      tick = 0;
      agendar(Math.max(PRIMEIRA_AMOSTRA_MS, INTERVALO_AMOSTRA_MS - (d.agora() - ultimaPub)));
    } else if (!deve && timer !== null) {
      parar();
      detector.reiniciar();
    }
  }

  async function amostrar(): Promise<AmostraSistema | null> {
    const atual = d.lerTempos();
    cpu = usoCpu(anterior, atual) ?? cpu;
    anterior = atual;
    if (tick % memoriaACada === 0 || memoria === null) {
      try { memoria = await d.lerMemoria(); } catch { /* mantém a última leitura */ }
    }
    tick += 1;
    if (cpu === null || memoria === null) return null;
    return { cpu: cpu.total, ram: pctDe(memoria.usada, memoria.total) };
  }

  async function executarTick(): Promise<void> {
    timer = null;
    // a graça de 10 s pode ter vencido desde o último tick: nesse caso é pausa total, sem reagendar
    if (!deveAmostrar(assinado, janela, d.agora())) { parar(); detector.reiniciar(); return; }
    const a = await amostrar();
    if (encerrado) return;
    if (a !== null) {
      ultima = a;
      ultimaPub = d.agora();
      d.publicar(a);
      if (d.aoCargaAlta !== undefined && d.alertaLigado?.() === true) {
        const motivo = detector.avaliar(a.cpu, a.ram, d.agora());
        if (motivo !== null) d.aoCargaAlta({ cpu: a.cpu, ram: a.ram, motivo });
      }
    }
    if (deveAmostrar(assinado, janela, d.agora())) agendar(INTERVALO_AMOSTRA_MS); else parar();
  }

  return {
    definirAssinatura(ativo) {
      assinado = ativo;
      if (!ativo) { detalheAte = 0; detalheCache = null; ultima = null; }
      reavaliar();
    },
    aoJanela(estado) {
      const estavaFocada = janela.focada;
      Object.assign(janela, estado);
      if (estavaFocada && !janela.focada) janela.desfocadaDesde = d.agora();
      if (janela.focada) janela.desfocadaDesde = null;
      reavaliar();
    },
    async detalhe(aberto) {
      if (!aberto) { detalheAte = 0; detalheCache = null; return null; }
      if (d.montarDetalhe === undefined) return null;
      const agora = d.agora();
      detalheAte = agora + VALIDADE_DETALHE_ABERTO_MS;
      if (detalheCache !== null && agora - detalheCache.quando < REUSO_DETALHE_MS) return detalheCache.valor;
      detalheEmCurso ??= d.montarDetalhe({ cpu, memoria })
        .then((valor) => { detalheCache = { quando: d.agora(), valor }; return valor; })
        .catch(() => null)
        .finally(() => { detalheEmCurso = null; });
      const v = await detalheEmCurso;
      return d.agora() <= detalheAte ? v : null;
    },
    ultima: () => ultima,
    ativo: () => timer !== null,
    async amostrarAgora() {
      if (anterior === null) { anterior = d.lerTempos(); return null; }
      return amostrar();
    },
    encerrar() { encerrado = true; parar(); },
  };
}
