// Histórico e metadados das sessões do daemon em disco: um `<id>.json` (metadados) e um `<id>.log`
// (saída) por sessão. O log é melhor esforço (a memória continua valendo) e é reescrito só com a
// cauda quando passa de 4x o limite. Sessão encerrada some depois de 7 dias.

import { closeSync, ftruncateSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { InfoSessaoDaemon } from "./protocolo";

export const ID_SESSAO_DAEMON = /^sessao_[a-z0-9-]{1,64}$/i;
/** Sessão encerrada some do disco depois disto, se ninguém a descartou antes. */
export const RETENCAO_MS = 7 * 24 * 60 * 60 * 1_000;
/** O log em disco é reescrito só com a cauda quando passa de tantas vezes o limite do histórico. */
export const FATOR_COMPACTACAO = 4;

export const arquivoDaSessao = (dir: string, id: string, extensao: "json" | "log"): string => join(dir, `${id}.${extensao}`);

export function gravarMeta(dir: string, info: InfoSessaoDaemon): void {
  try { writeFileSync(arquivoDaSessao(dir, info.sessao_id, "json"), JSON.stringify(info), { mode: 0o600 }); } catch { /* disco cheio ou pasta removida: a sessão segue viva em memória */ }
}

export function apagarSessao(dir: string, id: string): void {
  rmSync(arquivoDaSessao(dir, id, "json"), { force: true });
  rmSync(arquivoDaSessao(dir, id, "log"), { force: true });
}

export function lerCauda(dir: string, id: string, limite: number): string {
  try {
    const bruto = readFileSync(arquivoDaSessao(dir, id, "log"), "utf8");
    const texto = bruto.length > limite ? bruto.slice(-limite) : bruto;
    return texto.startsWith("�") ? texto.slice(1) : texto;
  } catch { return ""; }
}

/** Log de uma sessão viva: anexa, e compacta (só a cauda) quando passa de 4x o limite. */
export class LogSessao {
  #fd: number | null;
  #bytes = 0;
  constructor(private readonly dir: string, private readonly id: string, private readonly limite: number) {
    try { this.#fd = openSync(arquivoDaSessao(dir, id, "log"), "a", 0o600); } catch { this.#fd = null; }
  }

  get bytes(): number { return this.#bytes; }

  /** `cauda()` só é chamada na compactação (devolve o que a memória guarda, já aparado). */
  gravar(dados: string, cauda: () => string): void {
    if (this.#fd === null) return;
    try {
      this.#bytes += writeSync(this.#fd, dados);
      if (this.#bytes > this.limite * FATOR_COMPACTACAO) {
        const resto = cauda();
        ftruncateSync(this.#fd, 0);
        this.#bytes = writeSync(this.#fd, resto);
      }
    } catch { /* histórico em disco é melhor esforço */ }
  }

  fechar(): void {
    if (this.#fd === null) return;
    try { closeSync(this.#fd); } catch { /* já fechado */ }
    this.#fd = null;
  }
}

export interface SessaoEmDisco {
  info: InfoSessaoDaemon;
  cauda: string;
}

/**
 * Lê as sessões que um daemon anterior deixou. Encerradas com mais de 7 dias são apagadas; arquivo
 * estranho ou corrompido é ignorado.
 */
export function varrerSessoes(dir: string, limite: number, agora: number = Date.now(), retencaoMs: number = RETENCAO_MS): SessaoEmDisco[] {
  const saida: SessaoEmDisco[] = [];
  for (const nome of readdirSync(dir)) {
    const id = nome.endsWith(".json") ? nome.slice(0, -5) : null;
    if (id === null || !ID_SESSAO_DAEMON.test(id)) continue;
    try {
      const info = JSON.parse(readFileSync(arquivoDaSessao(dir, id, "json"), "utf8")) as InfoSessaoDaemon;
      if (info.estado !== "executando" && agora - statSync(arquivoDaSessao(dir, id, "json")).mtimeMs > retencaoMs) {
        apagarSessao(dir, id);
        continue;
      }
      saida.push({ info: { ...info, sessao_id: id, workspace_id: info.workspace_id ?? null }, cauda: lerCauda(dir, id, limite) });
    } catch { /* ignorado */ }
  }
  return saida;
}
