// Lógica pura da voz no renderer (Fase 11): reamostragem para 16 kHz, PCM16, fatiamento em blocos, atalho e textos de estado. Sem DOM, sem IPC.
import type { CodigoErroVoz } from "../../compartilhado/captura";
import { LIMITES_VOZ } from "../../compartilhado/captura";

export const TAXA_ALVO = LIMITES_VOZ.taxa_hz;
export const BLOCO_MIN_BYTES = 4 * 1024;
export const BLOCO_PADRAO_BYTES = 16 * 1024;

/** Reamostra por média de janela (decimação com filtro de caixa; boa para fala). Mantém a duração (±1 amostra). */
export function reamostrar(entrada: Float32Array, taxaEntrada: number, taxaSaida: number = TAXA_ALVO): Float32Array {
  if (taxaEntrada <= 0 || entrada.length === 0) return new Float32Array(0);
  if (taxaEntrada === taxaSaida) return entrada.slice();
  const razao = taxaEntrada / taxaSaida;
  const n = Math.floor(entrada.length / razao);
  const saida = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ini = i * razao;
    const fim = Math.min(entrada.length, (i + 1) * razao);
    let soma = 0;
    let peso = 0;
    for (let j = Math.floor(ini); j < Math.ceil(fim); j++) {
      const p = Math.min(j + 1, fim) - Math.max(j, ini);
      if (p > 0) { soma += (entrada[j] ?? 0) * p; peso += p; }
    }
    saida[i] = peso > 0 ? soma / peso : 0;
  }
  return saida;
}

/** Float32 [-1,1] -> PCM16 little-endian. */
export function paraPcm16(f: Float32Array): Uint8Array {
  const out = new Uint8Array(f.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < f.length; i++) {
    const x = Math.max(-1, Math.min(1, f[i] ?? 0));
    v.setInt16(i * 2, x < 0 ? Math.round(x * 32768) : Math.round(x * 32767), true);
  }
  return out;
}

export function rms(f: Float32Array): number {
  if (f.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < f.length; i++) { const x = f[i] ?? 0; s += x * x; }
  return Math.sqrt(s / f.length);
}

/** Junta PCM em blocos de `tamanho` bytes (4–64 KiB, par). Nunca emite bloco acima do teto; `descarregar` envia o resto. */
export function criarFatiador(enviar: (sequencia: number, dados: Uint8Array) => void, tamanho: number = BLOCO_PADRAO_BYTES) {
  const alvo = Math.max(BLOCO_MIN_BYTES, Math.min(LIMITES_VOZ.bloco_max_bytes, tamanho)) & ~1;
  let buf = new Uint8Array(0);
  let seq = 0;
  const emitir = (b: Uint8Array): void => { if (b.byteLength > 0) enviar(seq++, b); };
  return {
    adicionar(pcm: Uint8Array): void {
      const junto = new Uint8Array(buf.byteLength + pcm.byteLength);
      junto.set(buf);
      junto.set(pcm, buf.byteLength);
      let o = 0;
      while (junto.byteLength - o >= alvo) { emitir(junto.slice(o, o + alvo)); o += alvo; }
      buf = junto.slice(o);
    },
    descarregar(): void {
      const resto = buf.byteLength & ~1;
      emitir(buf.slice(0, resto));
      buf = new Uint8Array(0);
    },
    get sequencia(): number { return seq; },
  };
}

// ---------------------------------------------------------------- atalho

export interface TeclaLida { key: string; code: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

const MODS: Record<string, keyof Pick<TeclaLida, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">> = {
  command: "metaKey", cmd: "metaKey", super: "metaKey", meta: "metaKey", control: "ctrlKey", ctrl: "ctrlKey", shift: "shiftKey", alt: "altKey", option: "altKey",
};

function codigoDaTecla(t: string): string[] {
  const x = t.toLowerCase();
  if (x === "space") return ["Space"];
  if (x.length === 1 && /[a-z]/.test(x)) return [`Key${x.toUpperCase()}`];
  if (x.length === 1 && /[0-9]/.test(x)) return [`Digit${x}`, `Numpad${x}`];
  const mapa: Record<string, string> = { enter: "Enter", return: "Enter", tab: "Tab", escape: "Escape", esc: "Escape" };
  return [mapa[x] ?? t];
}

/** O evento de teclado é exatamente o atalho (`Command+Shift+Space`, `Control+Shift+K`…)? `CommandOrControl` vale Cmd no mac e Ctrl fora. */
export function ehAtalho(e: TeclaLida, atalho: string, mac: boolean): boolean {
  const partes = atalho.split("+").map((p) => p.trim()).filter(Boolean);
  const tecla = partes[partes.length - 1];
  if (tecla === undefined || partes.length < 2) return false;
  const exigidos = new Set<keyof Pick<TeclaLida, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">>();
  for (const m of partes.slice(0, -1)) {
    const baixo = m.toLowerCase();
    if (baixo === "commandorcontrol" || baixo === "cmdorctrl") exigidos.add(mac ? "metaKey" : "ctrlKey");
    else { const k = MODS[baixo]; if (k === undefined) return false; exigidos.add(k); }
  }
  for (const k of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) if (e[k] !== exigidos.has(k)) return false;
  return codigoDaTecla(tecla).includes(e.code);
}

/** A tecla solta faz parte do atalho (a tecla principal ou um modificador dele)? Encerra a fala no modo segurar. */
export function pertenceAoAtalho(e: Pick<TeclaLida, "code">, atalho: string): boolean {
  const partes = atalho.split("+").map((p) => p.trim()).filter(Boolean);
  const tecla = partes[partes.length - 1];
  if (tecla === undefined) return false;
  if (codigoDaTecla(tecla).includes(e.code)) return true;
  const mods = new Set(partes.slice(0, -1).map((m) => m.toLowerCase()));
  const tem = (...n: string[]): boolean => n.some((x) => mods.has(x));
  if (tem("command", "cmd", "meta", "super", "commandorcontrol", "cmdorctrl") && /^Meta(Left|Right)$|^OS(Left|Right)$/.test(e.code)) return true;
  if (tem("control", "ctrl", "commandorcontrol", "cmdorctrl") && /^Control(Left|Right)$/.test(e.code)) return true;
  if (tem("shift") && /^Shift(Left|Right)$/.test(e.code)) return true;
  if (tem("alt", "option") && /^Alt(Left|Right)$/.test(e.code)) return true;
  return false;
}

/** Legível para a pessoa (`⌘⇧Espaço` no mac, `Ctrl+Shift+Espaço` fora). */
export function rotuloDoAtalho(atalho: string, mac: boolean): string {
  const partes = atalho.split("+").map((p) => p.trim()).filter(Boolean);
  const sim: Record<string, string> = { command: "⌘", cmd: "⌘", commandorcontrol: mac ? "⌘" : "Ctrl+", cmdorctrl: mac ? "⌘" : "Ctrl+", control: mac ? "⌃" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
  const tecla = partes[partes.length - 1] ?? "";
  const corpo = partes.slice(0, -1).map((m) => sim[m.toLowerCase()] ?? `${m}+`).join("");
  return `${corpo}${tecla.toLowerCase() === "space" ? "Espaço" : tecla.length === 1 ? tecla.toUpperCase() : tecla}`;
}

// ---------------------------------------------------------------- textos

export type EstadoBotao = "ocioso" | "gravando" | "processando" | "erro";

export function rotuloDoBotao(estado: EstadoBotao, atalho: string | null): string {
  const dica = atalho === null ? "" : ` (${atalho})`;
  switch (estado) {
    case "gravando": return "Gravando fala. Solte para enviar, Esc cancela";
    case "processando": return "Transcrevendo a fala";
    case "erro": return "Erro no ditado. Clique para configurar";
    default: return `Ditar por voz${dica}`;
  }
}

const MENSAGENS: Record<CodigoErroVoz, string> = {
  sem_rede: "Sem conexão com o serviço de voz.",
  chave_recusada: "O serviço de voz recusou a chave. Confira em Configurações.",
  limite_de_uso: "Limite de uso do serviço de voz atingido.",
  microfone_negado: "Microfone bloqueado. Libere em Ajustes do Sistema.",
  microfone_indisponivel: "Nenhum microfone disponível.",
  motor_ausente: "Sem motor de voz. Configurar.",
  motor_falhou: "O motor de voz falhou.",
  modelo_ausente: "O modelo de voz local não está instalado. Configurar.",
  modelo_corrompido: "O modelo de voz local está corrompido. Apague e baixe de novo em Configurações.",
  runtime_indisponivel: "O motor de voz local não está disponível neste computador.",
  consentimento_ausente: "Falta o consentimento para enviar áudio. Configurar.",
  fala_vazia: "Não ouvi nada.",
  fala_curta: "Fala curta demais.",
  tempo_esgotado: "O motor de voz demorou demais.",
  sem_terminal_em_foco: "Sem terminal em foco para receber o texto.",
  cancelado: "Ditado cancelado.",
  ocupado: "Ainda transcrevendo a fala anterior.",
  indisponivel: "Voz indisponível agora.",
};
export const mensagemDeErro = (c: CodigoErroVoz | null): string => (c === null ? "" : MENSAGENS[c]);
/** erros que levam à configuração em vez de só um aviso. */
export const levaAConfiguracao = (c: CodigoErroVoz): boolean => c === "motor_ausente" || c === "consentimento_ausente" || c === "chave_recusada" || c === "modelo_ausente" || c === "modelo_corrompido" || c === "runtime_indisponivel";

/** Combinação (`Command+Shift+Space`) a partir de um evento de teclado; `null` se for só modificador (o sistema não informa quando ele é solto) ou sem modificador. */
export function combinacaoDeEvento(e: TeclaLida, mac: boolean): string | null {
  const c = e.code;
  if (/^(Meta|OS|Control|Shift|Alt)(Left|Right)$/.test(c) || c === "") return null;
  let tecla: string | null = null;
  if (c === "Space") tecla = "Space";
  else if (/^Key[A-Z]$/.test(c)) tecla = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) tecla = c.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) tecla = c;
  if (tecla === null) return null;
  const mods: string[] = [];
  if (e.metaKey) mods.push(mac ? "Command" : "Super");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (mods.length === 0) return null;
  return [...mods, tecla].join("+");
}
