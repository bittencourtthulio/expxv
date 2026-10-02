// Lógica pura da UI da voz local (Fase 11, D-545): formatação em português, rótulos em linguagem simples e decisões do assistente (qual modelo vem marcado, cabe no disco, qual ação o erro pede).
import type { CodigoErroModelo, FaseModelo, ListaModelosVoz, ModeloVozInfo, ProgressoModelo, QualidadeModelo, VelocidadeModelo } from "../../compartilhado/voz-local";

const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const num = (v: number): string => (v >= 100 ? nf0.format(v) : nf1.format(v));

/** 670 478 772 → "670 MB"; 1 610 612 736 → "1,6 GB"; 61 000 000 → "61 MB" (base decimal, como o Finder; uma casa só abaixo de 100). */
export function formatarBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n >= 1e9) return `${num(n / 1e9)} GB`;
  if (n >= 1e6) return `${num(n / 1e6)} MB`;
  if (n >= 1e3) return `${num(n / 1e3)} KB`;
  return `${Math.round(n)} B`;
}

export const formatarVelocidade = (bps: number): string => (bps > 0 ? `${formatarBytes(bps)}/s` : "calculando…");

export function formatarTempo(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "calculando…";
  if (s < 5) return "poucos segundos";
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

export const percentual = (p: Pick<ProgressoModelo, "bytes" | "total">): number => (p.total > 0 ? Math.max(0, Math.min(100, Math.floor((p.bytes / p.total) * 100))) : 0);

export const ROTULO_VELOCIDADE: Record<VelocidadeModelo, string> = {
  rapida: "Rápido: responde quase na hora",
  media: "Médio: alguns décimos de segundo por frase",
  lenta: "Mais lento: espere um pouco depois de falar",
};
export const ROTULO_QUALIDADE: Record<QualidadeModelo, string> = {
  boa: "Boa: acerta o dia a dia, erra mais nomes técnicos",
  muito_boa: "Muito boa: poucos erros, mesmo com termos técnicos",
  excelente: "Excelente: a mais precisa, com pontuação e maiúsculas",
};

export function descreverIdiomas(m: Pick<ModeloVozInfo, "idiomas" | "pt_br">): string {
  const outros = m.idiomas.filter((i) => i !== "pt").length;
  if (m.pt_br) return outros === 0 ? "Português (Brasil)" : `Português (Brasil) e mais ${outros} ${outros === 1 ? "idioma" : "idiomas"}`;
  return m.idiomas.length === 1 && m.idiomas[0] === "en" ? "Só inglês" : `${m.idiomas.length} idiomas (sem português)`;
}

/** O que vem marcado ao abrir o assistente: o recomendado baixável; senão o primeiro baixável; senão nada. */
export function escolhaPadrao(modelos: readonly ModeloVozInfo[]): string | null {
  const livres = modelos.filter((m) => !m.instalado && m.baixavel);
  return (livres.find((m) => m.recomendado) ?? livres[0])?.id ?? null;
}

/** `null` quando o sistema não informa o espaço livre (não bloqueia). */
export function cabeEmDisco(m: Pick<ModeloVozInfo, "tamanho_bytes">, livre: number | null): boolean | null {
  return livre === null ? null : livre >= m.tamanho_bytes + 64 * 1024 * 1024;
}

export const FASES_EM_ANDAMENTO: readonly FaseModelo[] = ["baixando", "pausado", "verificando", "autoteste", "erro"];
export const emAndamento = (p: ProgressoModelo | null | undefined): p is ProgressoModelo => p !== null && p !== undefined && FASES_EM_ANDAMENTO.includes(p.fase);

export type AcaoDoErro = "retomar" | "baixar_de_novo" | "apagar" | "nenhuma";
/** Qual botão cada erro pede (o texto em si vem pronto do main). */
export function acoesDoErro(codigo: CodigoErroModelo | null): AcaoDoErro[] {
  switch (codigo) {
    case "sem_internet":
    case "disco_cheio":
    case "servidor_recusou": return ["retomar"];
    case "checksum_invalido":
    case "tamanho_invalido":
    case "redirect_recusado":
    case "consentimento_ausente": return ["baixar_de_novo"];
    case "autoteste_falhou":
    case "modelo_corrompido": return ["apagar", "baixar_de_novo"];
    default: return ["nenhuma"];
  }
}

export const ROTULO_FASE: Record<FaseModelo, string> = {
  nao_instalado: "Não instalado",
  baixando: "Baixando",
  pausado: "Download pausado",
  verificando: "Verificando os arquivos",
  autoteste: "Testando o reconhecimento",
  instalado: "Instalado",
  erro: "Erro",
};

/** Anúncio discreto para leitor de tela: só ao mudar de fase ou cruzar 25/50/75% (nunca por tick de progresso). */
export function anuncioDe(anterior: ProgressoModelo | null, atual: ProgressoModelo, nome: string): string | null {
  if (anterior === null || anterior.fase !== atual.fase) {
    if (atual.fase === "baixando") return `Baixando ${nome}.`;
    if (atual.fase === "pausado") return "Download pausado.";
    if (atual.fase === "verificando") return "Verificando os arquivos baixados.";
    if (atual.fase === "autoteste") return "Testando o reconhecimento com uma amostra.";
    if (atual.fase === "instalado") return "Pronto: voz local ativada.";
    if (atual.fase === "erro") return atual.instrucao ?? "O download falhou.";
    return null;
  }
  if (atual.fase !== "baixando") return null;
  const marco = (p: ProgressoModelo): number => Math.floor(percentual(p) / 25);
  return marco(atual) > marco(anterior) && marco(atual) < 4 ? `${marco(atual) * 25}% baixado.` : null;
}

export function resumoOciosidade(s: number): string {
  if (s < 60) return `${s} s`;
  if (s < 3_600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3_600)} h`;
}

export const OPCOES_OCIOSIDADE: readonly number[] = [30, 60, 120, 300, 900, 3_600];

export function aplicarProgresso(lista: ListaModelosVoz, p: ProgressoModelo): ListaModelosVoz {
  return { ...lista, modelos: lista.modelos.map((m) => (m.id === p.modelo_id ? { ...m, download: p.fase === "instalado" || p.fase === "nao_instalado" ? null : p } : m)) };
}
