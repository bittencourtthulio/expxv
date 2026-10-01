/**
 * Token de Pane do MCP (05-CONTRATOS §3): `base64url(json).base64url(hmac-sha256)`. O segredo HMAC é
 * PERSISTENTE (`<userData>/mcp-segredo`, 0600, 32 bytes aleatórios, nunca em log/evento) para que a sessão
 * recuperada do daemon depois de reiniciar o app continue válida; `exp` de 24 h. Verificado a cada
 * chamada. `revogar(pane_id)` invalida tudo que foi emitido antes para o Pane (respawn emite um token novo
 * para o MESMO pane_id) e a lista de revogados é persistida e podada por `exp`.
 * Toda E/S aqui é assíncrona e só roda na onda 2 do boot (P-01/P-12).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MODOS_MISSAO, PAPEIS, type ModoMissao, type Papel } from "../dominio";
import { ferramentasPermitidas } from "./catalogo";
import { relogioReal, type PortaRelogio } from "./portas";

export interface ClaimsToken {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: Papel;
  mode: ModoMissao;
  tools_allow: string[];
  /** epoch em segundos */
  exp: number;
  /** sequência de emissão (monotônica entre reinícios: base da revogação) */
  n: number;
}

export interface PedidoToken {
  workspace_id: string;
  mission_id: string | null;
  pane_id: string;
  role: Papel;
  mode: ModoMissao;
  /** Restringe ainda mais a lista do modo/papel (interseção); nunca amplia. */
  tools_allow?: readonly string[];
}

export interface EmissorDeTokens {
  emitir(pedido: PedidoToken): string;
  verificar(token: string): ClaimsToken | null;
  /** Invalida o que já foi emitido para o Pane; devolve o limite de `n` revogado. */
  revogar(pane_id: string): number;
}

/** Revogação de um Pane: tokens com `n <= limite` morrem; o registro some quando o último deles expira. */
export interface RevogacaoToken {
  limite: number;
  /** epoch em ms a partir do qual nenhum token anterior à revogação ainda vale (poda) */
  ate: number;
}
export type Revogados = Record<string, RevogacaoToken>;

/**
 * AUD-04: 24 h (era 7 dias). O token vai em HTTP claro no loopback; quanto menor a janela, menor o que um processo local
 * que ocupe a porta com o app fechado consegue colher. Limite: a variável de ambiente de uma CLI já iniciada não muda,
 * então ao expirar o Pane precisa ser recriado (o app avisa ao restaurar).
 */
export const TTL_PADRAO_MS = 24 * 60 * 60 * 1000;

export interface OpcoesEmissor {
  relogio?: PortaRelogio;
  /** validade em ms (padrão 24 h) */
  ttlMs?: number;
  /** segredo HMAC injetado (persistente no app; aleatório do processo se omitido, p.ex. em teste) */
  segredo?: Buffer;
  /** revogações já persistidas (carregadas no início) */
  revogados?: Revogados;
  /** chamado, sem bloquear, com o retrato atual (podado) a cada revogação, para persistir */
  aoRevogar?: (revogados: Revogados) => void;
}

const b64 = (b: Buffer | string): string => Buffer.from(b).toString("base64url");

function claimsValidos(v: unknown): v is ClaimsToken {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c["workspace_id"] === "string" &&
    (c["mission_id"] === null || typeof c["mission_id"] === "string") &&
    typeof c["pane_id"] === "string" &&
    typeof c["role"] === "string" && (PAPEIS as readonly string[]).includes(c["role"]) &&
    typeof c["mode"] === "string" && (MODOS_MISSAO as readonly string[]).includes(c["mode"]) &&
    Array.isArray(c["tools_allow"]) && c["tools_allow"].every((t) => typeof t === "string") &&
    typeof c["exp"] === "number" && Number.isFinite(c["exp"]) &&
    typeof c["n"] === "number"
  );
}

export function criarEmissorDeTokens(opcoes: OpcoesEmissor = {}): EmissorDeTokens {
  const relogio = opcoes.relogio ?? relogioReal;
  const ttlMs = opcoes.ttlMs ?? TTL_PADRAO_MS;
  const segredo = opcoes.segredo ?? randomBytes(32);
  const revogados = new Map<string, RevogacaoToken>(Object.entries(opcoes.revogados ?? {}));
  // o próximo `n` sempre passa dos limites já revogados (mesmo com o relógio parado ou voltando)
  let contador = Math.max(0, ...[...revogados.values()].map((r) => r.limite));
  const poda = (): void => {
    const agora = relogio.agora();
    for (const [id, r] of revogados) if (r.ate <= agora) revogados.delete(id);
  };

  const assinar = (corpo: string): Buffer => createHmac("sha256", segredo).update(corpo).digest();

  return {
    emitir(pedido) {
      const base = ferramentasPermitidas(pedido.mode, pedido.role);
      const permitidas = pedido.tools_allow === undefined ? base : base.filter((t) => pedido.tools_allow?.includes(t));
      const claims: ClaimsToken = {
        workspace_id: pedido.workspace_id,
        mission_id: pedido.mission_id,
        pane_id: pedido.pane_id,
        role: pedido.role,
        mode: pedido.mode,
        tools_allow: [...permitidas],
        exp: Math.floor((relogio.agora() + ttlMs) / 1000),
        n: (contador = Math.max(contador + 1, relogio.agora() * 1000)),
      };
      const corpo = b64(JSON.stringify(claims));
      return `${corpo}.${b64(assinar(corpo))}`;
    },

    verificar(token) {
      if (typeof token !== "string" || token.length > 4096) return null;
      const partes = token.split(".");
      if (partes.length !== 2) return null;
      const [corpo, assinatura] = partes as [string, string];
      const esperada = assinar(corpo);
      let recebida: Buffer;
      try { recebida = Buffer.from(assinatura, "base64url"); } catch { return null; }
      if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
      let claims: unknown;
      try { claims = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")); } catch { return null; }
      if (!claimsValidos(claims)) return null;
      if (claims.exp * 1000 <= relogio.agora()) return null;
      const r = revogados.get(claims.pane_id);
      if (r !== undefined && claims.n <= r.limite) return null;
      return claims;
    },

    revogar(pane_id) {
      // cobre tokens de execuções anteriores (n parte do relógio) e deixa o próximo token do Pane > limite
      contador = Math.max(contador, relogio.agora() * 1000);
      revogados.set(pane_id, { limite: contador, ate: relogio.agora() + ttlMs + 1000 });
      poda();
      opcoes.aoRevogar?.(Object.fromEntries(revogados));
      return contador;
    },
  };
}

// ---------------------------------------------------------------- persistência (assíncrona, 0600, atômica)
const ARQUIVO_SEGREDO = "mcp-segredo";
const ARQUIVO_REVOGADOS = "mcp-revogados.json";

async function gravarAtomico(caminho: string, conteudo: string | Buffer): Promise<void> {
  const tmp = `${caminho}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, conteudo, { mode: 0o600, flag: "wx" });
    await rename(tmp, caminho);
    await chmod(caminho, 0o600).catch(() => undefined);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** Lê `<dir>/mcp-segredo`; cria sob demanda (32 bytes aleatórios, 0600). Arquivo inválido é substituído. */
export async function carregarSegredoPersistente(dir: string): Promise<Buffer> {
  const caminho = join(dir, ARQUIVO_SEGREDO);
  try {
    const atual = await readFile(caminho);
    if (atual.length === 32) {
      await chmod(caminho, 0o600).catch(() => undefined);
      return atual;
    }
  } catch { /* ausente: cria */ }
  await mkdir(dir, { recursive: true });
  const novo = randomBytes(32);
  await gravarAtomico(caminho, novo);
  return novo;
}

/** Lista de revogados do disco, já podada por `ate`. Arquivo ausente ou corrompido = vazia. */
export async function carregarRevogados(dir: string, relogio: PortaRelogio = relogioReal): Promise<Revogados> {
  let bruto: unknown;
  try { bruto = JSON.parse(await readFile(join(dir, ARQUIVO_REVOGADOS), "utf8")); } catch { return {}; }
  const saida: Revogados = {};
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return saida;
  const agora = relogio.agora();
  for (const [id, r] of Object.entries(bruto)) {
    const v = r as Partial<RevogacaoToken> | null;
    if (typeof v?.limite === "number" && typeof v.ate === "number" && Number.isFinite(v.limite) && v.ate > agora) saida[id] = { limite: v.limite, ate: v.ate };
  }
  return saida;
}

export interface GravadorRevogados {
  /** agenda a gravação do retrato (grava sempre o último; nunca bloqueia) */
  gravar(revogados: Revogados): void;
  /** espera as gravações pendentes (encerramento e teste) */
  aguardar(): Promise<void>;
}

export function criarGravadorRevogados(dir: string): GravadorRevogados {
  let ultimo: Revogados | null = null;
  let cadeia: Promise<void> = Promise.resolve();
  return {
    gravar(revogados) {
      const havia = ultimo !== null;
      ultimo = revogados;
      if (havia) return; // já há uma gravação agendada: ela pegará o retrato mais novo
      cadeia = cadeia.then(async () => {
        const retrato = ultimo;
        ultimo = null;
        if (retrato === null) return;
        try {
          await mkdir(dir, { recursive: true });
          await gravarAtomico(join(dir, ARQUIVO_REVOGADOS), JSON.stringify(retrato));
        } catch { /* melhor esforço: a revogação em memória continua valendo */ }
      });
    },
    aguardar: () => cadeia,
  };
}
