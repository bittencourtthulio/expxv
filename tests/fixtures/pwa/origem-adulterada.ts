// Fixtures do PWA (Fase 22): uma "origem" em memória (legítima ou hostil) e um harness que executa o `sw.js` REAL do build, na mesma realm, com `caches`/`fetch` falsos.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { carregar, type Assinar, type Build } from "../../pwa/carregar";

export type Origem = Map<string, Uint8Array>;
export interface Lancamento {
  dir: string;
  origem: Origem;
  versao: number;
  publicaB64: string;
  privadaPem: string;
  limpar(): void;
}
function listar(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    return statSync(c).isDirectory() ? listar(c, base) : [relative(base, c).split(sep).join("/")];
  });
}
/** Constrói o PWA de verdade num diretório temporário, assinado com um par novo (ou o dado). */
export async function lancar(versao: number, par?: { publicaB64: string; privadaPem: string }, extra: { chaves?: string[] } = {}): Promise<Lancamento> {
  const build = await carregar<Build>("pwa/build.mjs");
  const assinar = await carregar<Assinar>("pwa/assinar.mjs");
  const k = par ?? assinar.gerarParChaves();
  const dir = mkdtempSync(join(tmpdir(), "pwa-"));
  const alvo = join(dir, "dist-pwa");
  build.construir({ destino: alvo, versao, chavesPublicas: extra.chaves ?? [k.publicaB64], privadaPem: k.privadaPem });
  const origem: Origem = new Map(listar(alvo).map((n) => [n, new Uint8Array(readFileSync(join(alvo, n)))]));
  return { dir: alvo, origem, versao, publicaB64: k.publicaB64, privadaPem: k.privadaPem, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}
export const buscarDe = (o: Origem) => async (caminho: string): Promise<Uint8Array | null> => o.get(caminho) ?? null;
export const copiar = (o: Origem): Origem => new Map([...o].map(([k, v]) => [k, new Uint8Array(v)]));
export const texto = (b: Uint8Array | undefined): string => Buffer.from(b ?? []).toString("utf8");

// ------------------------------------------------------------------ harness do Service Worker
type Ouvinte = (e: unknown) => void;
export interface HarnessSw {
  instalar(): Promise<"ok" | "recusado">;
  ativar(): Promise<void>;
  /** `null` = o SW não respondeu (passa direto para a rede). */
  pedir(url: string, o?: { metodo?: string; navegar?: boolean }): Promise<{ status: number; corpo: Uint8Array } | null>;
  caches(): string[];
  trocarOrigem(o: Origem): void;
  trocarCodigo(c: string): void;
}
export function criarHarnessSw(codigo: string, origemInicial: Origem, escopo = "https://pwa.exemplo.com/"): HarnessSw {
  let origem = origemInicial;
  let fonte = codigo;
  const armazem = new Map<string, Map<string, { corpo: Uint8Array; status: number }>>();
  let ouvintes: Record<string, Ouvinte> = {};
  const cachesFalso = {
    async open(nome: string) {
      if (!armazem.has(nome)) armazem.set(nome, new Map());
      const m = armazem.get(nome) as Map<string, { corpo: Uint8Array; status: number }>;
      return {
        async put(chave: string, r: Response) {
          m.set(chave, { corpo: new Uint8Array(await r.arrayBuffer()), status: r.status });
        },
        async match(chave: string) {
          const x = m.get(chave);
          return x === undefined ? undefined : new Response(x.corpo as unknown as BodyInit, { status: x.status });
        },
      };
    },
    async keys() {
      return [...armazem.keys()];
    },
    async delete(nome: string) {
      return armazem.delete(nome);
    },
  };
  const fetchFalso = async (url: string | URL): Promise<Response> => {
    const u = new URL(String(url));
    const caminho = u.pathname.replace(/^\//, "");
    const b = origem.get(caminho);
    return b === undefined ? new Response("", { status: 404 }) : new Response(b as unknown as BodyInit, { status: 200 });
  };
  function carregarSw(): void {
    ouvintes = {};
    const self = {
      registration: { scope: escopo },
      clients: { claim: async () => undefined },
      addEventListener: (t: string, f: Ouvinte) => void (ouvintes[t] = f),
    };
    new Function("self", "caches", "fetch", "location", fonte)(self, cachesFalso, fetchFalso, new URL(escopo));
  }
  const disparar = async (tipo: string): Promise<void> => {
    let p: Promise<unknown> = Promise.resolve();
    ouvintes[tipo]?.({ waitUntil: (x: Promise<unknown>) => void (p = x) });
    await p;
  };
  carregarSw();
  return {
    async instalar() {
      carregarSw();
      try {
        await disparar("install");
        return "ok";
      } catch {
        return "recusado";
      }
    },
    ativar: () => disparar("activate"),
    async pedir(url, o = {}) {
      let resposta: Promise<Response> | null = null;
      const req = { url, method: o.metodo ?? "GET", mode: o.navegar === true ? "navigate" : "cors" };
      ouvintes["fetch"]?.({ request: req, respondWith: (p: Promise<Response>) => void (resposta = p) });
      if (resposta === null) return null;
      const r = await (resposta as Promise<Response>);
      return { status: r.status, corpo: new Uint8Array(await r.arrayBuffer()) };
    },
    caches: () => [...armazem.keys()].sort(),
    trocarOrigem: (o) => void (origem = o),
    trocarCodigo: (c) => void (fonte = c),
  };
}
