// T-09.07 · Detecção de "limite atingido" na saída do PTY, no fluxo que o serviço de terminais já lê (sem 2º parser).
// FORMA PRESUMIDA (revisar contra as CLIs): frases por CLI abaixo. Só vale LINHA DE SAÍDA da CLI: a frase precisa abrir a
// linha (depois de glifos de status), fora de bloco de código, e não pode ser eco do que o usuário acabou de enviar nem
// linha de prompt (`>`, `❯`, aspas). Custo proporcional ao nº de ocorrências de "limit" (≤ 0,2 ms por chunk de 64 KB).
export interface LimiteDetectado {
  provedor: string;
  /** Hora da frase (ISO) quando a CLI informou; senão `null` (o chamador usa +5 min). */
  reinicia_em: string | null;
  /** A linha (curta) que disparou, só para diagnóstico. */
  linha: string;
}

export interface DetectorLimite {
  /** Processa um pedaço da saída. `agora` = epoch ms. Devolve no máximo 1 detecção por janela de dedupe. */
  processar(chunk: string, agora: number): LimiteDetectado | null;
  /** O usuário enviou texto ao Pane: ecos dele deixam de contar. */
  registrarEnvio(texto: string): void;
  reiniciar(): void;
}

const PADROES: Readonly<Record<string, readonly RegExp[]>> = {
  claude: [
    /^claude (?:ai )?usage limit reached/i,
    /^(?:5[- ]?hour|five[- ]hour|weekly|7[- ]day|opus|sonnet|session)?\s*limit reached/i,
    /^you['’]ve (?:hit|reached) your (?:\w+[- ]?\w* )?limit/i,
    /^you['’]re out of (?:extra )?usage/i,
  ],
  codex: [/^you['’]ve hit your usage limit/i, /^usage limit (?:reached|exceeded)/i, /^you(?:'ve| have) (?:reached|exceeded) your usage limit/i],
};

export const PROVEDORES_COM_DETECTOR: readonly string[] = Object.keys(PADROES);
const PALAVRA = /limit|out of (?:extra )?usage/gi;
const ANSI = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const CONTROLE = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
const GLIFOS_INICIAIS = /^[\s─-╿⎿●○■□▪▫✗✘✖✕!⚠⏺•·∙*]+/u;
const PROMPT = /^(?:[>›❯$%#"'`“‘]|\[|\(|\/\/)/u;
const MAX_CAUDA = 1024;
const MAX_ECO = 20;
export const DEDUPE_PADRAO_MS = 30_000;

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

function limpar(linha: string): string {
  return linha.replace(ANSI, "").replace(CONTROLE, "").replace(GLIFOS_INICIAIS, "").trimEnd();
}

// ---------------------------------------------------------------- hora do reset
const MESES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function deslocamentoMs(ms: number, tz: string): number | null {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(ms));
    const g = (t: string): number => Number(p.find((x) => x.type === t)?.value);
    const comoUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
    return comoUtc - Math.floor(ms / 1000) * 1000;
  } catch {
    return null;
  }
}

/** Relógio de parede (y, m0, d, h, min) num fuso (`tz` null = fuso local da máquina) → epoch ms. */
function paredeParaMs(y: number, m: number, d: number, h: number, min: number, tz: string | null): number | null {
  if (tz === null) return new Date(y, m, d, h, min, 0, 0).getTime();
  const base = Date.UTC(y, m, d, h, min, 0, 0);
  const off1 = deslocamentoMs(base, tz);
  if (off1 === null) return null;
  const off2 = deslocamentoMs(base - off1, tz) ?? off1;
  return base - off2;
}

function partesDoDia(ms: number, tz: string | null): { y: number; m: number; d: number } {
  if (tz === null) {
    const dt = new Date(ms);
    return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() };
  }
  const off = deslocamentoMs(ms, tz) ?? 0;
  const dt = new Date(ms + off);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
}

/** Extrai "resets 3pm (America/Sao_Paulo)", "try again at 3:42 PM", "in 3 hours 12 minutes", `|1760000000`. */
export function extrairReinicio(linha: string, agora: number): string | null {
  const epoch = /\|\s*(\d{10})\b/.exec(linha);
  if (epoch) return new Date(Number(epoch[1]) * 1000).toISOString();

  const rel = /\b(?:in|em)\s+(?:(\d{1,3})\s*(?:days?|d)\b)?\s*(?:(\d{1,3})\s*(?:hours?|hrs?|h)\b)?\s*(?:(\d{1,4})\s*(?:minutes?|mins?|m)\b)?/i.exec(linha);
  if (rel && (rel[1] || rel[2] || rel[3])) {
    const ms = (Number(rel[1] ?? 0) * 24 * 60 + Number(rel[2] ?? 0) * 60 + Number(rel[3] ?? 0)) * 60_000;
    if (ms > 0 && ms < 400 * 24 * 3_600_000) return new Date(agora + ms).toISOString();
  }

  const hora = /\b(?:resets?|try again|reinicia|volte)(?:\s+(?:at|em|às|as))?\s+(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)?(?:\s*\(([A-Za-z_]+\/[A-Za-z_+\-0-9]+|UTC)\))?/i.exec(linha) ?? /\bat\s+(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b/i.exec(linha);
  if (!hora) return null;
  const temData = hora.length === 7;
  const mesTxt = temData ? hora[1] : undefined;
  const diaTxt = temData ? hora[2] : undefined;
  const hh = Number(temData ? hora[3] : hora[1]);
  const mm = Number((temData ? hora[4] : hora[2]) ?? 0);
  const ap = (temData ? hora[5] : hora[3])?.toLowerCase();
  const tz = temData ? (hora[6] ?? null) : null;
  let h24 = hh;
  if (ap === "pm" && hh < 12) h24 = hh + 12;
  else if (ap === "am" && hh === 12) h24 = 0;
  if (!Number.isFinite(h24) || h24 > 23 || mm > 59 || (ap === undefined && !/:/.test(linha))) return null;
  const hoje = partesDoDia(agora, tz);
  let alvo: number | null;
  if (mesTxt !== undefined && diaTxt !== undefined) {
    const m = MESES.indexOf(mesTxt.toLowerCase());
    if (m < 0) return null;
    alvo = paredeParaMs(hoje.y, m, Number(diaTxt), h24, mm, tz);
    if (alvo !== null && alvo <= agora) alvo = paredeParaMs(hoje.y + 1, m, Number(diaTxt), h24, mm, tz);
  } else {
    alvo = paredeParaMs(hoje.y, hoje.m, hoje.d, h24, mm, tz);
    if (alvo !== null && alvo <= agora) alvo = paredeParaMs(hoje.y, hoje.m, hoje.d + 1, h24, mm, tz);
  }
  if (alvo === null || !Number.isFinite(alvo) || alvo - agora > 400 * 24 * 3_600_000) return null;
  return new Date(alvo).toISOString();
}

// ---------------------------------------------------------------- detector
/** Paridade de cercas ``` em `texto[0, fim)` partindo de `inicial` (true = dentro de bloco de código). */
function paridadeAte(texto: string, fim: number, inicial: boolean): boolean {
  let dentro = inicial;
  for (let i = texto.indexOf("```"); i !== -1 && i < fim; i = texto.indexOf("```", i + 3)) dentro = !dentro;
  return dentro;
}

export function criarDetectorLimite(provedor: string, opcoes: { dedupe_ms?: number } = {}): DetectorLimite | null {
  const padroesDoProvedor = PADROES[provedor];
  if (padroesDoProvedor === undefined) return null;
  const padroes: readonly RegExp[] = padroesDoProvedor;
  const dedupe = opcoes.dedupe_ms ?? DEDUPE_PADRAO_MS;
  let cauda = ""; // última linha ainda sem quebra, reprocessada junto do próximo pedaço
  let cercaAntesCauda = false; // estavam dentro de bloco de código no início da cauda?
  let ultima = Number.NEGATIVE_INFINITY;
  let ecos: string[] = [];

  const ehEco = (linha: string): boolean => {
    const n = norm(linha);
    return ecos.some((e) => e.includes(n) || n.includes(e));
  };

  function procurar(texto: string, agora: number): LimiteDetectado | null {
    let dentro = cercaAntesCauda;
    let pos = 0;
    let linhaAnterior = -1;
    PALAVRA.lastIndex = 0;
    for (let m = PALAVRA.exec(texto); m !== null; m = PALAVRA.exec(texto)) {
      const ini = texto.lastIndexOf("\n", m.index) + 1;
      if (ini === linhaAnterior) continue;
      linhaAnterior = ini;
      for (let i = texto.indexOf("```", pos); i !== -1 && i < ini; i = texto.indexOf("```", pos)) {
        dentro = !dentro;
        pos = i + 3;
      }
      if (dentro) continue;
      let fim = texto.indexOf("\n", m.index);
      if (fim === -1) fim = texto.length;
      const linha = limpar(texto.slice(ini, Math.min(fim, ini + 600)));
      if (linha === "" || PROMPT.test(linha)) continue;
      if (!padroes.some((p) => p.test(linha))) continue;
      if (ehEco(linha)) continue;
      if (agora - ultima < dedupe) return null;
      ultima = agora;
      return { provedor, reinicia_em: extrairReinicio(linha, agora), linha: linha.slice(0, 200) };
    }
    return null;
  }

  return {
    registrarEnvio(texto) {
      ecos = texto
        .split(/\r?\n/)
        .map(norm)
        .filter((l) => l.length >= 8)
        .slice(0, MAX_ECO);
      cauda = "";
    },
    reiniciar() {
      cauda = "";
      cercaAntesCauda = false;
      ecos = [];
      ultima = Number.NEGATIVE_INFINITY;
    },
    processar(chunk, agora) {
      const texto = cauda + chunk;
      const nl = texto.lastIndexOf("\n");
      const inicioCauda = nl === -1 ? Math.max(0, texto.length - MAX_CAUDA) : nl + 1;
      PALAVRA.lastIndex = 0;
      const achado = PALAVRA.test(texto) ? procurar(texto, agora) : null; // barato: sem "limit" não há o que olhar
      cercaAntesCauda = paridadeAte(texto, inicioCauda, cercaAntesCauda);
      cauda = texto.slice(inicioCauda, inicioCauda + MAX_CAUDA);
      return achado;
    },
  };
}
