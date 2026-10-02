import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as esperaReal } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoCapturaIpc } from "../compartilhado/captura";
import { criarArmazem, type Armazem } from "../nucleo/captura/armazem";
import type { DisplayInfo } from "../nucleo/captura/geometria";
import type { Bitmap, Codificador } from "../nucleo/captura/imagem";
import type { TeclaGlobal } from "../nucleo/voz/teclas";
import { criarServicoCaptura, instrucaoTelaNegada, type Capturado, type DependenciasCaptura, type FonteTela, type ServicoCaptura } from "./captura";
import type { Permissoes } from "./permissoes";

const DISPLAY: DisplayInfo = { id: 7, x: 0, y: 0, largura: 200, altura: 100, fator: 2 };

/** bitmap 400x200 com cor = f(x,y): permite conferir o recorte pixel a pixel. */
function gradiente(l: number, a: number): Bitmap {
  const dados = new Uint8Array(l * a * 4);
  for (let y = 0; y < a; y++) for (let x = 0; x < l; x++) dados.set([x % 256, y % 256, (x + y) % 256, 255], (y * l + x) * 4);
  return { largura: l, altura: a, dados };
}

function pngFalso(l: number, a: number): Uint8Array {
  const png = new Uint8Array(40);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(png.buffer).setUint32(16, l);
  new DataView(png.buffer).setUint32(20, a);
  return png;
}

interface Cena {
  svc: ServicoCaptura;
  raiz: string;
  dados: string;
  eventos: EventoCapturaIpc[];
  escritos: [string, string][];
  copiados: string[];
  codificados: Bitmap[];
  fonte: { tela: () => Capturado | null; janela: () => Capturado | null; capturas: number };
  perm: { tela: "concedida" | "negada" | "indeterminada" | "restrita"; plataforma: "mac" | "windows" | "linux" };
  prefs: Map<string, unknown>;
  teclas: TeclaGlobal & { registradas: string[]; ocupado: Set<string> };
  lixo: string[];
}

let cena: Cena;
let tempo: Date;

async function montar(extra: Partial<DependenciasCaptura> = {}): Promise<Cena> {
  const raiz = await mkdtemp(join(tmpdir(), "svc-cap-ws-"));
  const dados = await mkdtemp(join(tmpdir(), "svc-cap-dados-"));
  const lixo: string[] = [];
  const mk = (pasta: string, base: string, pastaProduto?: string): Armazem => criarArmazem({ pasta, raiz: base, ...(pastaProduto === undefined ? {} : { pastaProduto }), lixeira: async (p) => void lixo.push(p), agora: () => tempo });
  const armazens: Record<string, Armazem> = {
    ws: mk(join(raiz, ".produto", "capturas"), raiz, join(raiz, ".produto")),
    app: mk(join(dados, "capturas"), dados),
  };
  const eventos: EventoCapturaIpc[] = [];
  const escritos: [string, string][] = [];
  const copiados: string[] = [];
  const codificados: Bitmap[] = [];
  const prefs = new Map<string, unknown>();
  const perm = { tela: "concedida" as Cena["perm"]["tela"], plataforma: "mac" as Cena["perm"]["plataforma"] };
  const fonteEstado = { tela: (): Capturado | null => ({ bitmap: gradiente(400, 200), display: DISPLAY }), janela: (): Capturado | null => ({ bitmap: gradiente(300, 150), display: { id: -1, x: 0, y: 0, largura: 150, altura: 75, fator: 2 } }), capturas: 0 };
  const fonte: FonteTela = {
    displays: () => [DISPLAY],
    janelaBounds: () => ({ x: 10, y: 10, largura: 100, altura: 50 }),
    capturarDisplay: async () => { fonteEstado.capturas += 1; return fonteEstado.tela(); },
    capturarJanelaApp: async () => { fonteEstado.capturas += 1; return fonteEstado.janela(); },
  };
  const codificador: Codificador = { png: (b) => { codificados.push({ ...b, dados: new Uint8Array(b.dados) }); return pngFalso(b.largura, b.altura); }, jpeg: (b) => pngFalso(b.largura, b.altura) };
  const permissoes: Permissoes = {
    get plataforma() { return perm.plataforma; },
    microfone: () => "indeterminada",
    tela: () => perm.tela,
    pedirMicrofone: async () => "indeterminada",
    abrirAjustes: async () => true,
  };
  const ocupado = new Set<string>();
  const registradas: string[] = [];
  const teclas = {
    registradas, ocupado,
    registrar: (a: string, _fn: () => void) => { if (ocupado.has(a)) return false; registradas.push(a); return true; },
    liberar: (a: string) => void registradas.splice(registradas.indexOf(a), 1),
    liberarTodas: () => void registradas.splice(0),
  };
  const svc = criarServicoCaptura({
    fonte, codificador, previa: (b) => new Uint8Array([0xff, 0xd8, b.largura % 256]), permissoes,
    prefs: { obter: (c) => prefs.get(c) ?? null, definir: async (c, v) => void prefs.set(c, v) },
    armazem: (ws) => (ws === null ? armazens["app"]! : ws === "ws_1" ? armazens["ws"]! : null),
    sessao: (id) => (id === "s1" ? { cwd: raiz, workspace_id: "ws_1" } : undefined),
    escrever: (id, t) => { if (id !== "s1") return false; escritos.push([id, t]); return true; },
    copiarTexto: (t) => void copiados.push(t),
    emitir: (e) => void eventos.push(e),
    teclas, trazerJanela: () => undefined,
    ...extra,
  });
  return { svc, raiz, dados, eventos, escritos, copiados, codificados, fonte: fonteEstado, perm, prefs, teclas, lixo };
}

beforeEach(async () => {
  tempo = new Date(2026, 9, 1, 10, 0, 0);
  cena = await montar();
});
afterEach(async () => {
  await cena.svc.encerrar();
  await rm(cena.raiz, { recursive: true, force: true });
  await rm(cena.dados, { recursive: true, force: true });
});

describe("região: congelar, selecionar e salvar", () => {
  it("devolve a imagem congelada no tamanho lógico e UM token", async () => {
    const r = await cena.svc.regiaoIniciar("tela");
    expect(r).toMatchObject({ ok: true, largura: 200, altura: 100, fator: 2 });
    expect(cena.svc.congeladas()).toBe(1);
  });

  it("confirmar recorta os pixels FÍSICOS certos (fator 2), salva, emite e solta a memória", async () => {
    const r = await cena.svc.regiaoIniciar("tela");
    if (!r.ok) throw new Error("falhou");
    const s = await cena.svc.regiaoConfirmar(r.token, { x: 10, y: 20, largura: 30, altura: 15 }, "ws_1");
    expect(s.ok).toBe(true);
    const bmp = cena.codificados[0]!;
    expect([bmp.largura, bmp.altura]).toEqual([60, 30]);
    expect(Array.from(bmp.dados.subarray(0, 4))).toEqual([20, 40, 60, 255]); // pixel (20,40) da imagem original
    expect(cena.svc.congeladas()).toBe(0);
    if (!s.ok) return;
    expect(cena.eventos).toContainEqual({ tipo: "mudou", captura_id: s.captura_id, acao: "criada" });
    const lista = await cena.svc.listar("ws_1", null);
    expect(lista.itens).toHaveLength(1);
    expect(lista.itens[0]?.caminho).toBe(join(".produto", "capturas", `${s.captura_id}.png`));
  });

  it("seleção menor que 5x5 cancela, não grava nada e solta a memória", async () => {
    const r = await cena.svc.regiaoIniciar("tela");
    if (!r.ok) throw new Error("falhou");
    expect(await cena.svc.regiaoConfirmar(r.token, { x: 1, y: 1, largura: 4, altura: 4 }, "ws_1")).toMatchObject({ ok: false, codigo: "selecao_pequena" });
    expect((await cena.svc.listar("ws_1", null)).itens).toHaveLength(0);
    expect(cena.svc.congeladas()).toBe(0);
  });

  it("token errado ou reutilizado é recusado", async () => {
    const r = await cena.svc.regiaoIniciar("tela");
    if (!r.ok) throw new Error("falhou");
    expect(await cena.svc.regiaoConfirmar("x".repeat(32), { x: 0, y: 0, largura: 50, altura: 50 }, null)).toMatchObject({ ok: false, codigo: "token_invalido" });
    expect(cena.svc.congeladas()).toBe(1); // um token falso não derruba a captura legítima
    await cena.svc.regiaoConfirmar(r.token, { x: 0, y: 0, largura: 50, altura: 50 }, null);
    expect(await cena.svc.regiaoConfirmar(r.token, { x: 0, y: 0, largura: 50, altura: 50 }, null)).toMatchObject({ ok: false, codigo: "token_invalido" });
  });

  it("cancelar solta a memória; uma nova captura substitui a anterior; o TTL expira", async () => {
    vi.useFakeTimers();
    try {
      const c = await montar({ ttl_ms: 1_000 });
      const a = await c.svc.regiaoIniciar("tela");
      if (!a.ok) throw new Error("falhou");
      expect(c.svc.regiaoCancelar(a.token)).toBe(true);
      expect(c.svc.congeladas()).toBe(0);
      await c.svc.regiaoIniciar("tela");
      await c.svc.regiaoIniciar("tela");
      expect(c.svc.congeladas()).toBe(1);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(c.svc.congeladas()).toBe(0);
      await c.svc.encerrar();
      await rm(c.raiz, { recursive: true, force: true });
      await rm(c.dados, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("permissão de tela negada no macOS: instrução clara, sem exceção e sem captura", async () => {
    cena.perm.tela = "negada";
    const r = await cena.svc.regiaoIniciar("tela");
    expect(r).toMatchObject({ ok: false, codigo: "permissao_tela_negada" });
    if (!r.ok) expect(r.instrucao).toContain("reabra o app");
    expect(cena.fonte.capturas).toBe(0);
  });

  it("imagem em branco (sinal de permissão negada) vira permissao_tela_negada e a memória é solta", async () => {
    cena.fonte.tela = () => ({ bitmap: { largura: 40, altura: 20, dados: new Uint8Array(40 * 20 * 4) }, display: DISPLAY });
    expect(await cena.svc.regiaoIniciar("tela")).toMatchObject({ ok: false, codigo: "permissao_tela_negada" });
    expect(cena.svc.congeladas()).toBe(0);
    expect(instrucaoTelaNegada("windows")).not.toContain("Gravação de Tela");
  });

  it("janela do app funciona sem permissão de tela", async () => {
    cena.perm.tela = "negada";
    const r = await cena.svc.janelaInteira("ws_1");
    expect(r.ok).toBe(true);
    expect(await cena.svc.regiaoIniciar("janela_app")).toMatchObject({ ok: true, largura: 150, altura: 75 });
  });

  it("sem janela: erro nominal; workspace desconhecido: erro e nada gravado", async () => {
    cena.fonte.janela = () => null;
    expect(await cena.svc.janelaInteira(null)).toMatchObject({ ok: false, codigo: "sem_janela" });
    cena.fonte.janela = () => ({ bitmap: gradiente(40, 20), display: DISPLAY });
    expect(await cena.svc.janelaInteira("ws_inexistente")).toMatchObject({ ok: false, codigo: "indisponivel" });
  });

  it("pedir tela no macOS tenta uma captura (único jeito de o SO perguntar) e pede para reabrir se não concedida", async () => {
    cena.perm.tela = "indeterminada";
    const r = await cena.svc.pedirTela();
    expect(cena.fonte.capturas).toBe(1);
    expect(r).toEqual({ estado: "indeterminada", reiniciar_app: true });
    cena.perm.tela = "concedida";
    expect((await cena.svc.pedirTela()).reiniciar_app).toBe(false);
    cena.perm.plataforma = "windows";
    cena.fonte.capturas = 0;
    await cena.svc.pedirTela();
    expect(cena.fonte.capturas).toBe(0);
  });
});

describe("anexar ao Pane e copiar caminho", () => {
  async function criar(): Promise<string> {
    const r = await cena.svc.janelaInteira("ws_1");
    if (!r.ok) throw new Error("falhou");
    return r.captura_id;
  }

  it("anexa como caminho RELATIVO, sem Enter, no Pane indicado", async () => {
    const id = await criar();
    const r = await cena.svc.anexarAoPane(id, "ws_1", "s1");
    expect(r.caminhos).toEqual([join(".produto", "capturas", `${id}.png`)]);
    expect(cena.escritos).toEqual([["s1", r.texto]]);
    expect(r.texto).not.toMatch(/[\r\n]/);
    expect(r.texto.startsWith("/")).toBe(false);
  });

  it("captura sem workspace é copiada para a pasta de entradas do workspace do Pane", async () => {
    const r0 = await cena.svc.janelaInteira(null);
    if (!r0.ok) throw new Error("falhou");
    const r = await cena.svc.anexarAoPane(r0.captura_id, null, "s1");
    expect(r.caminhos[0]).toMatch(/entradas/);
    await stat(join(cena.raiz, r.caminhos[0]!));
  });

  it("Pane fechado entre a captura e o anexo: erro nominal e nada escrito", async () => {
    const id = await criar();
    await expect(cena.svc.anexarAoPane(id, "ws_1", "s_fechada")).rejects.toThrow(/\[sem_terminal\]/);
    expect(cena.escritos).toEqual([]);
  });

  it("id malformado ou com ../ nunca vira caminho", async () => {
    for (const id of ["../../etc/passwd", "..", "2026-10-01_10-00-00/../x", "", "q_../x"]) {
      await expect(cena.svc.anexarAoPane(id, "ws_1", "s1")).rejects.toThrow(/\[captura_inexistente\]/);
      await expect(cena.svc.copiarCaminho(id, "ws_1")).rejects.toThrow(/\[captura_inexistente\]/);
      await expect(cena.svc.ler(id, "ws_1")).rejects.toThrow(/\[captura_inexistente\]/);
    }
    expect(cena.copiados).toEqual([]);
  });

  it("copiar caminho coloca o caminho ABSOLUTO no clipboard (ação explícita)", async () => {
    const id = await criar();
    expect(await cena.svc.copiarCaminho(id, "ws_1")).toBe(true);
    expect(cena.copiados[0]).toBe(join(cena.raiz, ".produto", "capturas", `${id}.png`));
  });

  it("editar preserva o original e remover vai para a lixeira", async () => {
    const id = await criar();
    await cena.svc.salvarEdicao(id, "ws_1", pngFalso(9, 9));
    expect(cena.eventos).toContainEqual({ tipo: "mudou", captura_id: id, acao: "editada" });
    expect(await readdir(join(cena.raiz, ".produto", "capturas"))).toContain(`${id}.orig.png`);
    expect(await cena.svc.remover(id, "ws_1")).toBe(true);
    expect(cena.lixo).toHaveLength(2);
  });
});

/** avança o relógio falso em passos de 100 ms, dando tempo REAL ao disco entre os passos (a gravação usa fs de verdade). */
async function passar(ms: number): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100);
    await esperaReal(6);
  }
}

describe("gravação por quadros", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("5 s a 2 fps = ~10 quadros em disco, progresso emitido, prompt de quadros sem Enter", async () => {
    const r0 = await cena.svc.quadrosIniciar("tela", 2, "ws_1");
    expect(r0).toEqual({ ok: true });
    expect(cena.svc.estado().gravando_quadros).toBe(true);
    expect(await cena.svc.quadrosIniciar("tela", 2, "ws_1")).toMatchObject({ ok: false, codigo: "ja_gravando" });
    await passar(5_000);
    const fim = cena.svc.quadrosParar();
    await passar(200);
    const { captura_id } = await fim;
    expect(captura_id).toMatch(/^q_/);
    const dir = join(cena.raiz, ".produto", "capturas", "quadros", captura_id!.slice(2));
    const quadros = (await readdir(dir)).filter((n) => n.endsWith(".png"));
    expect(quadros.length).toBeGreaterThanOrEqual(9);
    expect(quadros.length).toBeLessThanOrEqual(11);
    expect(cena.eventos.some((e) => e.tipo === "quadros_progresso")).toBe(true);
    expect(cena.eventos.find((e) => e.tipo === "quadros_fim")).toMatchObject({ motivo: "parou", captura_id });
    expect(cena.svc.estado().gravando_quadros).toBe(false);
    const p = await cena.svc.anexarQuadrosAoPane(captura_id!, "ws_1", "s1");
    expect(p.texto).toContain(`${join(".produto", "capturas", "quadros", captura_id!.slice(2))} contains ${quadros.length} frames sampled at 2 fps`);
    expect(p.texto).not.toMatch(/[\r\n]/);
  });

  it("sem permissão de tela: falha clara no primeiro quadro e nenhuma pasta órfã", async () => {
    cena.perm.tela = "negada";
    const r = await cena.svc.quadrosIniciar("tela", 2, "ws_1");
    expect(r).toMatchObject({ ok: false, codigo: "permissao_tela_negada" });
    expect(cena.svc.estado().gravando_quadros).toBe(false);
    const quadrosDir = join(cena.raiz, ".produto", "capturas", "quadros");
    expect(await readdir(quadrosDir)).toEqual([]);
    expect(cena.eventos.find((e) => e.tipo === "quadros_fim")).toMatchObject({ motivo: "erro", captura_id: null });
  });

  it("parar sem gravação devolve null; encerrar para a gravação", async () => {
    expect(await cena.svc.quadrosParar()).toEqual({ captura_id: null });
    await cena.svc.quadrosIniciar("janela_app", 1, "ws_1");
    const p = cena.svc.encerrar();
    await passar(300);
    await p;
    expect(cena.svc.estado().gravando_quadros).toBe(false);
  });
});

describe("configuração e atalhos globais (opt-in)", () => {
  it("nada é registrado por padrão; ligar registra os dois e desligar libera", async () => {
    expect(cena.teclas.registradas).toEqual([]);
    expect(cena.svc.estado()).toMatchObject({ atalhos_globais: false, fps_padrao: 2, aviso_visto: false });
    const e = await cena.svc.configGravar({ atalhos_globais: true, fps_padrao: 1, aviso_visto: true });
    expect(e).toMatchObject({ atalhos_globais: true, fps_padrao: 1, aviso_visto: true, atalho_erro: null });
    expect(cena.teclas.registradas).toHaveLength(2);
    await cena.svc.configGravar({ atalhos_globais: false });
    expect(cena.teclas.registradas).toEqual([]);
  });

  it("atalho já ocupado: nada fica registrado, o opt-in volta a desligado e a mensagem explica", async () => {
    cena.teclas.ocupado.add("CommandOrControl+Shift+6");
    const e = await cena.svc.configGravar({ atalhos_globais: true });
    expect(e.atalho_erro).toMatch(/já está em uso/);
    expect(cena.teclas.registradas).toEqual([]);
    expect(cena.prefs.get("captura_atalhos_globais")).toBe(false);
  });

  it("disparar o atalho global avisa o renderer (não captura sozinho)", async () => {
    let acionar: (() => void) | null = null;
    const c = await montar({ teclas: { registrar: (a, fn) => { if (a.endsWith("5")) acionar = fn; return true; }, liberar: () => undefined, liberarTodas: () => undefined } });
    await c.svc.configGravar({ atalhos_globais: true });
    (acionar as (() => void) | null)?.();
    expect(c.eventos).toContainEqual({ tipo: "atalho", acao: "regiao" });
    expect(c.fonte.capturas).toBe(0);
    await c.svc.encerrar();
    await rm(c.raiz, { recursive: true, force: true });
    await rm(c.dados, { recursive: true, force: true });
  });
});

describe("limpeza", () => {
  it("o serviço não deixa temporários: nada além de .gitignore e capturas na pasta do produto", async () => {
    await cena.svc.janelaInteira("ws_1");
    await mkdir(join(cena.raiz, "x"), { recursive: true });
    await writeFile(join(cena.raiz, "x", "y.txt"), "ok");
    const arquivos = await readdir(join(cena.raiz, ".produto", "capturas"));
    expect(arquivos.filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(await readFile(join(cena.raiz, ".produto", ".gitignore"), "utf8")).toBe("*\n");
  });
});
