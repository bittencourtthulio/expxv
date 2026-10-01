// Memória do método (T-04.09): chama `python3 .claude/skills/memox/assets/memox.py estado|arquivo <caminho>`
// SE existir. Timeout de 2 s (o processo é morto), ambiente mínimo, sem escrita (PYTHONDONTWRITEBYTECODE),
// saída validada. A ausência do memox é estado normal, não erro; toda falha vira aviso discreto.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { IndiceProjeto } from "./tipos";

export const MEMOX_SCRIPT = ".claude/skills/memox/assets/memox.py";
export const TIMEOUT_MEMOX_MS = 2_000;
const SAIDA_MAX_BYTES = 64 * 1024;

export type ConsultaMemox = { tipo: "estado" } | { tipo: "arquivo"; caminho: string };

export type EstadoConsultaMemox = "ok" | "ausente" | "lento" | "saida_invalida" | "erro";

export interface ResultadoMemox {
  estado: EstadoConsultaMemox;
  /** `estado`: texto legível do memox. */
  texto: string | null;
  /** `arquivo`: objeto JSON do memox (com `tipo`). */
  dados: Record<string, unknown> | null;
  /** aviso discreto para a UI; `null` quando tudo certo ou quando o memox simplesmente não existe. */
  aviso: string | null;
}

export interface OpcoesMemox {
  timeoutMs?: number;
  python?: string;
}

const vazio = (estado: EstadoConsultaMemox, aviso: string | null): ResultadoMemox => ({ estado, texto: null, dados: null, aviso });

/** Só o mínimo para o Python rodar: nada de token, chave ou variável de proxy do app. */
function ambienteMinimo(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8", NO_COLOR: "1", LC_ALL: "C.UTF-8" };
  for (const chave of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TMPDIR", "TEMP"]) {
    const v = process.env[chave];
    if (v !== undefined) env[chave] = v;
  }
  return env;
}

function caminhoValido(raiz: string, caminho: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (typeof caminho !== "string" || caminho === "" || caminho.length > 1_000 || /[\u0000-\u001f\u007f]/.test(caminho)) return false;
  if (caminho.startsWith("-") || isAbsolute(caminho)) return false;
  const alvo = resolve(raiz, caminho);
  return alvo === raiz || alvo.startsWith(raiz + sep);
}

export function consultarMemox(raiz: string, consulta: ConsultaMemox, opcoes: OpcoesMemox = {}): Promise<ResultadoMemox> {
  const script = join(raiz, MEMOX_SCRIPT);
  if (!existsSync(script)) return Promise.resolve(vazio("ausente", null));
  if (consulta.tipo === "arquivo" && !caminhoValido(resolve(raiz), consulta.caminho)) return Promise.resolve(vazio("erro", "Caminho inválido para o memox."));

  const args = consulta.tipo === "estado" ? [MEMOX_SCRIPT, "estado"] : [MEMOX_SCRIPT, "arquivo", consulta.caminho, "--formato", "json"];
  const timeout = opcoes.timeoutMs ?? TIMEOUT_MEMOX_MS;
  return new Promise<ResultadoMemox>((resolver) => {
    try {
      const filho = execFile(opcoes.python ?? "python3", args, {
        cwd: raiz, timeout, killSignal: "SIGKILL", maxBuffer: SAIDA_MAX_BYTES, encoding: "utf8", env: ambienteMinimo(), windowsHide: true,
      }, (erro, stdout) => {
        if (erro !== null) {
          const e = erro as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
          if (e.code === "ENOENT") return resolver(vazio("ausente", null)); // sem python3: o memox é opcional
          if (e.killed === true || e.signal === "SIGKILL") return resolver(vazio("lento", "O memox demorou demais e foi ignorado."));
          return resolver(vazio("erro", "O memox não respondeu; segue sem ele."));
        }
        const texto = stdout.trim();
        // eslint-disable-next-line no-control-regex
        if (texto === "" || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(texto)) return resolver(vazio("saida_invalida", "Resposta do memox ilegível."));
        if (consulta.tipo === "estado") return resolver({ estado: "ok", texto, dados: null, aviso: null });
        try {
          const json: unknown = JSON.parse(texto);
          if (typeof json !== "object" || json === null || Array.isArray(json) || typeof (json as { tipo?: unknown }).tipo !== "string") {
            return resolver(vazio("saida_invalida", "Resposta do memox fora do formato esperado."));
          }
          return resolver({ estado: "ok", texto: null, dados: json as Record<string, unknown>, aviso: null });
        } catch {
          return resolver(vazio("saida_invalida", "Resposta do memox ilegível."));
        }
      });
      filho.stdin?.end();
    } catch {
      resolver(vazio("erro", "Não foi possível consultar o memox."));
    }
  });
}

/**
 * Painel de saúde: dos pedidos do prodx que já têm veredito, quantos NÃO viram trabalho (veredito
 * diferente de `fazer`). `proporcao` é `null` sem nenhum pedido julgado.
 */
export function proporcaoPedidosSemTrabalho(indice: Pick<IndiceProjeto, "trabalhos">): { total: number; sem_trabalho: number; proporcao: number | null } {
  const julgados = indice.trabalhos.filter((t) => t.tipo === "pedido" && t.prodx?.veredito != null);
  const sem = julgados.filter((t) => t.prodx?.veredito !== "fazer").length;
  return { total: julgados.length, sem_trabalho: sem, proporcao: julgados.length === 0 ? null : sem / julgados.length };
}
