// Canais `mapa:*` (T-17.33): contrato fechado, validadores estritos campo a campo, o renderer NUNCA envia caminho absoluto nem destino,
// tradução de erro e ligação à fachada. Sem Electron, sem banco: a fachada é um espião.
import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { ErroConsulta } from "../../nucleo/mapa/consultas";
import { VALIDADORES_MAPA, registrarIpcMapa, traduzirErroMapa } from "./mapa";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_AAAAAAAAAAAA";
const PANE = "pane_AAAAAAAAAAAA";
const canais = CANAIS_INVOKE.filter((c) => c.startsWith("mapa:"));

function montar(falhaCom?: unknown) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true });
  const chamadas: Array<{ metodo: string; args: unknown[] }> = [];
  const fachada = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      if (falhaCom !== undefined) throw falhaCom;
      return { ok: true };
    },
  });
  const avisos: string[] = [];
  registrarIpcMapa({
    registro,
    servico: {
      fachada: async () => fachada as never,
      resumo: async () => ({ estado: "vazio" }) as never,
      disparar: async (ws, p) => {
        chamadas.push({ metodo: "disparar", args: [ws, p] });
        return { comando: "x", carimbo: "c", pacote: "p" };
      },
    },
    aviso: (m) => avisos.push(m),
  });
  const chamar = (canal: string, payload: unknown): Promise<unknown> => Promise.resolve((handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload));
  return { handlers, chamar, chamadas, avisos };
}

const VALIDOS: Record<string, unknown> = {
  "mapa:resumo": { workspace_id: WS },
  "mapa:analisar": { workspace_id: WS, modo: "incremental", historia: true },
  "mapa:cancelar": { workspace_id: WS },
  "mapa:apagar": { workspace_id: WS, confirmacao: "APAGAR" },
  "mapa:grafo": { workspace_id: WS, nivel: "arquivo", filtro: { linguagens: ["typescript"], pasta: "src/nucleo", so_ciclos: true, min_confianca: "exata", camada: 2 }, limite: 5000 },
  "mapa:vizinhos": { workspace_id: WS, no_id: "arq:src/a.ts", direcao: "ambas", profundidade: 2, limite: 100 },
  "mapa:no": { workspace_id: WS, no_id: "sim:src/a.ts#a" },
  "mapa:fluxo": { workspace_id: WS, entrada_id: "ent:src/rotas.ts#GET /ping", profundidade: 6, min_confianca: "heuristica" },
  "mapa:analise": { workspace_id: WS, tipo: "hotspots", parametros: { limite: 50, pasta: "src" } },
  "mapa:raio": { workspace_id: WS, arquivos: ["src/a.ts"], simbolos: ["src/a.ts#a"] },
  "mapa:perfil": { workspace_id: WS },
  "mapa:buscar": { workspace_id: WS, texto: "lerUsu", tipos: ["simbolo"], limite: 10 },
  "mapa:exportar": { workspace_id: WS, formato: "mermaid", vista: { tipo: "grafo", nivel: "modulo" }, destino: "padrao" },
  "mapa:disparar": { workspace_id: WS, acao: "legadox_raio", pane_id: PANE, trabalho_id: "OC-1", arquivos: ["src/a.ts"] },
  "mapa:config_ler": { workspace_id: WS },
  "mapa:config_gravar": { workspace_id: WS, config: { expor_agentes: true, auto_atualizar: false, workers: 2, ignorar: ["dist/**"] } },
  "mapa:layout_ler": { workspace_id: WS, chave: "arquivo:src" },
  "mapa:layout_gravar": { workspace_id: WS, chave: "arquivo:src", nivel: "arquivo", posicoes: [1, 2, 3.5, 4] },
};

describe("contrato dos canais mapa:*", () => {
  it("todo canal do contrato tem validador e manipulador (e nada além)", () => {
    const { handlers } = montar();
    expect(Object.keys(VALIDADORES_MAPA).sort()).toEqual([...canais].sort());
    expect([...handlers.keys()].filter((c) => c.startsWith("mapa:")).sort()).toEqual([...canais].sort());
    expect(canais).toHaveLength(18);
    expect(Object.keys(VALIDOS).sort()).toEqual([...canais].sort());
  });

  it.each(Object.entries(VALIDOS))("%s aceita o payload válido", (canal, payload) => {
    const v = VALIDADORES_MAPA[canal as keyof typeof VALIDADORES_MAPA];
    expect(v(payload).ok).toBe(true);
  });

  it("rejeita payload sem workspace_id, com campo desconhecido ou com caminho absoluto (todos os canais)", () => {
    for (const [canal, payload] of Object.entries(VALIDOS)) {
      const v = VALIDADORES_MAPA[canal as keyof typeof VALIDADORES_MAPA];
      const { workspace_id: _ws, ...semWs } = payload as Record<string, unknown>;
      expect(v(semWs).ok, `${canal} sem workspace_id`).toBe(false);
      expect(v({ ...(payload as object), extra: 1 }).ok, `${canal} campo extra`).toBe(false);
      expect(v({ ...(payload as object), workspace_id: "../../etc" }).ok, `${canal} ws inválido`).toBe(false);
      expect(v(null).ok).toBe(false);
      expect(v("texto").ok).toBe(false);
      expect(v([]).ok).toBe(false);
    }
  });

  it("caminhos: absoluto, `..`, NUL e arquivos de ambiente/chave são recusados em todo campo de caminho", () => {
    const ruins = ["/etc/passwd", "../fora", "src/../../fora", "C:\\x", "a\0b", ".env", "src/.env.local", "chave.pem", "id_rsa", "src/id_ed25519"];
    for (const c of ruins) {
      expect(VALIDADORES_MAPA["mapa:raio"]({ workspace_id: WS, arquivos: [c] }).ok, `raio ${JSON.stringify(c)}`).toBe(false);
      expect(VALIDADORES_MAPA["mapa:grafo"]({ workspace_id: WS, nivel: "arquivo", filtro: { pasta: c } }).ok, `grafo ${JSON.stringify(c)}`).toBe(false);
      expect(VALIDADORES_MAPA["mapa:disparar"]({ workspace_id: WS, acao: "legadox_raio", pane_id: PANE, trabalho_id: "OC-1", arquivos: [c] }).ok, `disparar ${JSON.stringify(c)}`).toBe(false);
      expect(VALIDADORES_MAPA["mapa:analise"]({ workspace_id: WS, tipo: "mortos", parametros: { pasta: c } }).ok, `analise ${JSON.stringify(c)}`).toBe(false);
      expect(VALIDADORES_MAPA["mapa:no"]({ workspace_id: WS, no_id: `arq:${c}` }).ok, `no arq ${JSON.stringify(c)}`).toBe(false);
      expect(VALIDADORES_MAPA["mapa:no"]({ workspace_id: WS, no_id: `sim:${c}#x` }).ok, `no sim ${JSON.stringify(c)}`).toBe(false);
    }
    expect(VALIDADORES_MAPA["mapa:no"]({ workspace_id: WS, no_id: "tab:usuarios" }).ok).toBe(true);
    expect(VALIDADORES_MAPA["mapa:no"]({ workspace_id: WS, no_id: "ext:npm:express" }).ok).toBe(true);
    expect(VALIDADORES_MAPA["mapa:no"]({ workspace_id: WS, no_id: "xxx:y" }).ok).toBe(false);
  });

  it("limites: limite do grafo, vizinhos, busca, raio e posições; enum e tipos", () => {
    const g = (extra: object): boolean => VALIDADORES_MAPA["mapa:grafo"]({ workspace_id: WS, nivel: "arquivo", ...extra }).ok;
    expect(g({ limite: 20_000 })).toBe(true);
    expect(g({ limite: 20_001 })).toBe(false);
    expect(g({ limite: 0 })).toBe(false);
    expect(g({ limite: 1.5 })).toBe(false);
    expect(VALIDADORES_MAPA["mapa:grafo"]({ workspace_id: WS, nivel: "pacote" }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:vizinhos"]({ workspace_id: WS, no_id: "arq:a.ts", profundidade: 4 }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:vizinhos"]({ workspace_id: WS, no_id: "arq:a.ts", limite: 501 }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:buscar"]({ workspace_id: WS, texto: "x", limite: 51 }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:buscar"]({ workspace_id: WS, texto: "" }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:raio"]({ workspace_id: WS, arquivos: Array.from({ length: 51 }, (_, i) => `a${i}.ts`) }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:layout_gravar"]({ workspace_id: WS, chave: "k", nivel: "arquivo", posicoes: [Number.NaN] }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:layout_gravar"]({ workspace_id: WS, chave: "k", nivel: "x", posicoes: [1] }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:layout_ler"]({ workspace_id: WS, chave: "../k" }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:analise"]({ workspace_id: WS, tipo: "tudo" }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:disparar"]({ workspace_id: WS, acao: "mergex_revisar", pane_id: PANE }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:disparar"]({ workspace_id: WS, acao: "stackx_detectar", pane_id: "p1" }).ok).toBe(false);
  });

  it("o renderer NÃO escolhe o destino da exportação nem envia cwd: campos desconhecidos são recusados", () => {
    const e = (extra: object): boolean => VALIDADORES_MAPA["mapa:exportar"]({ workspace_id: WS, formato: "svg", vista: { tipo: "relatorio" }, ...extra }).ok;
    expect(e({})).toBe(true);
    expect(e({ destino: "/tmp/x" })).toBe(false);
    expect(e({ destino: "escolher" })).toBe(true);
    expect(e({ caminho: "/tmp/x" })).toBe(false);
    expect(e({ cwd: "/" })).toBe(false);
    expect(VALIDADORES_MAPA["mapa:exportar"]({ workspace_id: WS, formato: "svg", vista: { tipo: "grafo", nivel: "arquivo", filtro: { pasta: "/etc" } } }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:exportar"]({ workspace_id: WS, formato: "svg", vista: { tipo: "fluxo", entrada_id: "arq:/etc/passwd" } }).ok).toBe(false);
    expect(VALIDADORES_MAPA["mapa:exportar"]({ workspace_id: WS, formato: "pdf", vista: { tipo: "relatorio" } }).ok).toBe(false);
  });

  it("config: só chaves conhecidas e com faixa; globs de ignorar sem caminho absoluto não passam por aqui como `..` (o núcleo filtra)", () => {
    const c = (config: object): boolean => VALIDADORES_MAPA["mapa:config_gravar"]({ workspace_id: WS, config }).ok;
    expect(c({ habilitado: false })).toBe(true);
    expect(c({ workers: 9 })).toBe(false);
    expect(c({ total_max: 5 })).toBe(false);
    expect(c({ arquivo_max_bytes: 9e9 })).toBe(false);
    expect(c({ senha: "x" })).toBe(false);
    expect(c({ expor_agentes: "sim" })).toBe(false);
  });
});

describe("manipuladores", () => {
  it("encaminham à fachada com os campos validados (nenhum campo extra) e disparam pelo serviço", async () => {
    const { chamar, chamadas } = montar();
    await chamar("mapa:analisar", VALIDOS["mapa:analisar"]);
    await chamar("mapa:grafo", VALIDOS["mapa:grafo"]);
    await chamar("mapa:disparar", VALIDOS["mapa:disparar"]);
    expect(chamadas.map((c) => c.metodo)).toEqual(["analisar", "grafo", "disparar"]);
    expect(chamadas[0]?.args).toEqual(["incremental", true]);
    expect(chamadas[2]?.args).toEqual([WS, { acao: "legadox_raio", pane_id: PANE, trabalho_id: "OC-1", arquivos: ["src/a.ts"] }]);
  });

  it("payload inválido é recusado ANTES do manipulador", async () => {
    const { chamar, chamadas } = montar();
    await expect(chamar("mapa:raio", { workspace_id: WS, arquivos: ["/etc/passwd"] })).rejects.toThrow(/recusado/);
    expect(chamadas).toEqual([]);
  });

  it("erro de regra vira `[codigo] texto`; erro interno vira texto genérico sem stack, caminho nem SQL", async () => {
    const regra = montar(new ErroConsulta("mapa_nao_pronto", "o mapa ainda não foi analisado"));
    await expect(regra.chamar("mapa:grafo", VALIDOS["mapa:grafo"])).rejects.toThrow("[mapa_nao_pronto] o mapa ainda não foi analisado");
    const interno = montar(new Error("SQLITE_ERROR: no such table x em /Users/fulano/.config/app/mapa.db"));
    const e = await interno.chamar("mapa:grafo", VALIDOS["mapa:grafo"]).catch((x: Error) => x);
    expect((e as Error).message).toBe("[erro_interno] não foi possível concluir a operação do mapa");
    expect((e as Error).message).not.toMatch(/Users|SQLITE|mapa\.db/);
    expect(interno.avisos.join("\n")).toMatch(/SQLITE_ERROR/); // a causa vai ao log do main, não ao renderer
    expect(traduzirErroMapa(new ErroConsulta("nao_encontrado", "x")).message).toBe("[nao_encontrado] x");
  });
});
