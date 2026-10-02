import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSAO_CONSENTIMENTO_MODELO, type ProgressoModelo } from "../compartilhado/voz-local";
import { criarClienteRede, criarRegistroConsentimento } from "../nucleo/rede";
import type { Catalogo, ModeloCatalogo } from "../nucleo/voz/local/catalogo";
import type { RuntimeVoz } from "../nucleo/voz/local/runtime";
import { ErroMotor } from "../nucleo/voz/motores/motor";
import { criarServicoVozModelos, ErroVozModelosIpc, normalizarPalavras, type ServicoVozModelos } from "./voz-modelos";

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const aleatorio = (n: number, x0: number): Buffer => { const b = Buffer.alloc(n); let x = x0; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x & 0xff; } return b; };
const A = aleatorio(200_000, 11);
const D = aleatorio(30_000, 13);
const V = aleatorio(5_000, 12);
const CONTEUDO: Record<string, Buffer> = { "encoder.onnx": A, "decoder.onnx": D, "vocab.txt": V };
const WAV_PT = join(__dirname, "../../resources/voz/amostra-pt.wav");

function modeloTeste(id = "modelo-teste", mut: (m: ModeloCatalogo) => void = () => undefined): ModeloCatalogo {
  const m: ModeloCatalogo = {
    id, nome: "Modelo de teste", descricao: "d", idiomas: ["pt", "en"], familia: "whisper", perfil: "recomendado", recomendado: true, velocidade: "media", qualidade: "boa", ram_estimada_mb: 100, trecho_max_s: 28, amostra: "pt",
    licenca: { id: "MIT", url: "https://x.y/l", atribuicao: "a" }, origem: { host: "127.0.0.1", caminho_base: "/m/" },
    arquivos: [
      { nome: "encoder.onnx", papel: "encoder", bytes: A.length, sha256: sha(A) },
      { nome: "decoder.onnx", papel: "decoder", bytes: D.length, sha256: sha(D) },
      { nome: "vocab.txt", papel: "vocabulario", bytes: V.length, sha256: sha(V) },
    ],
    tamanho_bytes: A.length + D.length + V.length,
  };
  mut(m);
  m.tamanho_bytes = m.arquivos.reduce((s, a) => s + a.bytes, 0);
  return m;
}

interface Srv { porta: number; pedidos: Array<{ caminho: string; range: string | undefined }>; conexoes(): number; fechar(): Promise<void> }
async function subir(manip: (req: IncomingMessage, res: ServerResponse) => void): Promise<Srv> {
  const sockets = new Set<Socket>();
  let conexoes = 0;
  const pedidos: Srv["pedidos"] = [];
  const srv: Server = createServer((req, res) => { pedidos.push({ caminho: req.url ?? "", range: req.headers.range }); manip(req, res); });
  srv.on("connection", (s) => { conexoes++; sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { porta: (srv.address() as { port: number }).port, pedidos, conexoes: () => conexoes, fechar: () => new Promise<void>((ok) => { for (const s of sockets) s.destroy(); srv.close(() => ok()); }) };
}
const honesto = (conteudo: Record<string, Buffer> = CONTEUDO) => (req: IncomingMessage, res: ServerResponse): void => {
  const corpo = conteudo[(req.url ?? "").replace("/m/", "")];
  if (corpo === undefined) { res.statusCode = 404; return void res.end(); }
  const r = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
  const inicio = r === null ? 0 : Number(r[1]);
  if (inicio > 0) { res.statusCode = 206; res.setHeader("content-range", `bytes ${inicio}-${corpo.length - 1}/${corpo.length}`); }
  res.setHeader("content-length", String(corpo.length - inicio));
  res.end(corpo.subarray(inicio));
};

interface Cena {
  svc: ServicoVozModelos;
  eventos: ProgressoModelo[];
  prefs: Map<string, unknown>;
  ativos: Array<string | null>;
  transcricoes: Array<{ chave: string; bytes: number }>;
  runtimeCtl: { texto: string; falhar: ErroMotor | null; descarregados: number; ram: number };
  registroRede: ReturnType<typeof criarRegistroConsentimento>;
  tmp: string;
  pastaModelos: string;
  disp: { ok: boolean; motivo: string | null };
  modelo: ModeloCatalogo;
  motor: { motor: string; modelo_local: string | null };
}

let srvs: Srv[] = [];
let tmp = "";
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "voz-svc-")); });
afterEach(async () => { for (const s of srvs) await s.fechar(); srvs = []; rmSync(tmp, { recursive: true, force: true }); });

async function montar(opts: { handler?: (req: IncomingMessage, res: ServerResponse) => void; modelo?: ModeloCatalogo; extra?: Partial<Parameters<typeof criarServicoVozModelos>[0]> } = {}): Promise<Cena & { srv: Srv }> {
  const srv = await subir(opts.handler ?? honesto());
  srvs.push(srv);
  const modelo = opts.modelo ?? modeloTeste();
  const catalogo: Catalogo = { versao: 1, runtime: "r", hosts_origem: ["127.0.0.1"], hosts_arquivos: ["127.0.0.1"], modelos: [modelo], amostras: { pt: { arquivo: "amostra-pt.wav", palavras_esperadas: ["teste", "voz", "terminal"], minimo: 2, descricao: "d" } } };
  const amostras = join(tmp, "amostras");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(amostras, { recursive: true });
  copyFileSync(WAV_PT, join(amostras, "amostra-pt.wav"));
  const eventos: ProgressoModelo[] = [];
  const prefs = new Map<string, unknown>();
  const ativos: Array<string | null> = [];
  const transcricoes: Cena["transcricoes"] = [];
  const runtimeCtl: Cena["runtimeCtl"] = { texto: "Olá, este é um teste de voz no terminal", falhar: null, descarregados: 0, ram: 640 };
  const registroRede = criarRegistroConsentimento();
  const rede = criarClienteRede({ consentimento: registroRede, permitirLoopbackHttp: true });
  const disp = { ok: true, motivo: null as string | null };
  const motor = { motor: "nenhum", modelo_local: null as string | null };
  const runtime: RuntimeVoz = {
    transcrever: async (config, pcm) => { if (runtimeCtl.falhar !== null) throw runtimeCtl.falhar; transcricoes.push({ chave: config.chave, bytes: pcm.byteLength }); return { texto: runtimeCtl.texto, ms: 40, duracao_ms: Math.round(pcm.byteLength / 32), ram_mb: runtimeCtl.ram, carregamento_ms: 300 }; },
    preaquecer: async () => ({ carregamento_ms: 1, ram_mb: 1 }),
    descarregar: () => { runtimeCtl.descarregados++; },
    estado: () => ({ carregado: transcricoes.length > 0, chave: null, ram_mb: transcricoes.length > 0 ? runtimeCtl.ram : null, ocupado: false }),
    encerrar: () => undefined,
  };
  const svc = criarServicoVozModelos({
    catalogo: () => ({ ok: true, catalogo }),
    pastaModelos: join(tmp, "voz", "modelos"),
    pastaAmostras: amostras,
    prefs: { obter: (c) => prefs.get(c) ?? null, definir: async (c, v) => void prefs.set(c, v) },
    rede, registroRede, runtime,
    runtimeDisponivel: () => disp,
    ativarMotor: async (id) => { ativos.push(id); motor.motor = id === null ? "nenhum" : "local_embutido"; motor.modelo_local = id; },
    motorAtual: () => motor,
    ociosidade_s: () => 120,
    emitir: (e) => void eventos.push(e),
    porta: srv.porta,
    espacoLivre: async () => 50 * 1024 ** 3,
    esperar: async () => undefined,
    ...opts.extra,
  });
  return { svc, eventos, prefs, ativos, transcricoes, runtimeCtl, registroRede, tmp, pastaModelos: join(tmp, "voz", "modelos"), disp, modelo, motor, srv };
}

const pedido = (id = "modelo-teste", extra: Partial<{ aceite_versao: string; ativar: boolean }> = {}) => ({ modelo_id: id, aceite_versao: VERSAO_CONSENTIMENTO_MODELO, ativar: true, ...extra });
async function ate(cond: () => boolean, ms = 4_000): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) { if (Date.now() > fim) throw new Error("tempo esgotado esperando condição"); await new Promise((ok) => setTimeout(ok, 5)); }
}
const fases = (e: ProgressoModelo[]): string[] => e.map((x) => x.fase).filter((f, i, a) => a.indexOf(f) === i || a[i - 1] !== f).reduce<string[]>((acc, f) => (acc.at(-1) === f ? acc : [...acc, f]), []);
const codigoDe = async (p: Promise<unknown>): Promise<string> => { try { await p; return "NAO_FALHOU"; } catch (e) { return e instanceof ErroVozModelosIpc ? e.codigo : `outro:${String(e)}`; } };

describe("listar", () => {
  it("sem nada instalado: modelo recomendado listado, não instalado, com host, licença, versão do consentimento e runtime", async () => {
    const c = await montar();
    const l = await c.svc.listar();
    expect(l.modelos).toHaveLength(1);
    const m = l.modelos[0]!;
    expect(m).toMatchObject({ id: "modelo-teste", instalado: false, ativo: false, integridade: null, baixavel: true, recomendado: true, pt_br: true, host_origem: "127.0.0.1", download: null });
    expect(l.runtime_disponivel).toBe(true);
    expect(l.versao_consentimento).toBe(VERSAO_CONSENTIMENTO_MODELO);
    expect(l.espaco_livre_bytes).toBe(50 * 1024 ** 3);
    expect(l.ociosidade_s).toBe(120);
    expect(l.carregado).toBe(false);
    expect(JSON.stringify(l)).not.toContain(c.tmp); // nenhum caminho absoluto vai à UI
  });

  it("entrada sem checksum aparece como não baixável e baixar é recusado SEM abrir conexão", async () => {
    const c = await montar({ modelo: modeloTeste("modelo-teste", (m) => { m.arquivos[0]!.sha256 = null; }) });
    const l = await c.svc.listar();
    expect(l.modelos[0]).toMatchObject({ baixavel: false });
    expect(l.modelos[0]?.motivo_nao_baixavel).toMatch(/Checksum/);
    expect(await codigoDe(c.svc.baixar(pedido()))).toBe("sem_checksum");
    expect(c.srv.conexoes()).toBe(0);
  });
});

describe("baixar e ativar", () => {
  it("fluxo completo: baixando → verificando → autoteste → instalado, motor local ativado, consentimento gravado, host liberado só durante o download", async () => {
    const c = await montar();
    expect(await c.svc.baixar(pedido())).toEqual({ modelo_id: "modelo-teste" });
    await ate(() => c.eventos.some((e) => e.fase === "instalado"));
    expect(fases(c.eventos)).toEqual(["baixando", "verificando", "autoteste", "instalado"]);
    expect(c.ativos).toEqual(["modelo-teste"]);
    expect(c.motor).toEqual({ motor: "local_embutido", modelo_local: "modelo-teste" });
    const seqs = c.eventos.map((e) => e.sequencia);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
    const ultimo = c.eventos.at(-1)!;
    expect(ultimo.bytes).toBe(ultimo.total);
    // aceite gravado (host de origem e dos arquivos) com a versão vigente e sem segredo
    const aceites = c.prefs.get("voz_modelo_consentimentos") as Array<{ servico: string; host: string; versao_texto: string; revogado_em: string | null }>;
    expect(aceites.every((a) => a.servico === "voz_modelo:modelo-teste" && a.versao_texto === VERSAO_CONSENTIMENTO_MODELO && a.revogado_em === null)).toBe(true);
    expect(aceites.map((a) => a.host)).toContain("127.0.0.1");
    expect(c.registroRede.hostPermitido("127.0.0.1")).toBe(false); // liberado só enquanto baixava
    const l = await c.svc.listar();
    expect(l.modelos[0]).toMatchObject({ instalado: true, ativo: true, integridade: "ok", download: null });
    expect(l.modelos[0]?.bytes_em_disco).toBe(A.length + D.length + V.length);
    expect(l.modelo_ativo).toBe("modelo-teste");
    // áudio e texto nunca em evento: só fases, contagens e códigos
    expect(JSON.stringify(c.eventos)).not.toMatch(/terminal|teste de voz/);
    expect(JSON.stringify(c.eventos)).not.toContain(c.tmp);
  });

  it("sem ativar: baixa e verifica, mas não roda autoteste nem muda o motor", async () => {
    const c = await montar();
    await c.svc.baixar(pedido("modelo-teste", { ativar: false }));
    await ate(() => c.eventos.some((e) => e.fase === "instalado"));
    expect(fases(c.eventos)).toEqual(["baixando", "verificando", "instalado"]);
    expect(c.ativos).toEqual([]);
    expect(c.transcricoes).toHaveLength(0);
  });

  it("aceite com versão de texto diferente, id fora do catálogo, runtime indisponível: recusados antes de qualquer conexão", async () => {
    const c = await montar();
    expect(await codigoDe(c.svc.baixar(pedido("modelo-teste", { aceite_versao: "1999-01-01.0" })))).toBe("consentimento_ausente");
    expect(await codigoDe(c.svc.baixar(pedido("../../etc/passwd")))).toBe("modelo_desconhecido");
    expect(await codigoDe(c.svc.baixar(pedido("outro-modelo")))).toBe("modelo_desconhecido");
    c.disp.ok = false;
    c.disp.motivo = "sem addon";
    expect(await codigoDe(c.svc.baixar(pedido()))).toBe("runtime_indisponivel");
    expect(c.srv.conexoes()).toBe(0);
    expect(c.prefs.get("voz_modelo_consentimentos") ?? null).toBeNull(); // nada gravado sem download iniciado
    expect((await c.svc.listar()).runtime_disponivel).toBe(false);
  });

  it("progresso é coalescido (≥ 250 ms) mesmo com muitos pedaços, e termina com o total exato", async () => {
    const grande = aleatorio(600_000, 5);
    const modelo = modeloTeste("modelo-teste", (m) => { m.arquivos[0] = { nome: "encoder.onnx", papel: "encoder", bytes: grande.length, sha256: sha(grande) }; });
    const c = await montar({
      modelo,
      handler: (req, res) => {
        const corpo = (req.url ?? "").endsWith("vocab.txt") ? V : (req.url ?? "").endsWith("decoder.onnx") ? D : grande;
        res.setHeader("content-length", String(corpo.length));
        for (let i = 0; i < corpo.length; i += 1_000) res.write(corpo.subarray(i, i + 1_000)); // 600 pedaços
        res.end();
      },
    });
    await c.svc.baixar(pedido("modelo-teste", { ativar: false }));
    await ate(() => c.eventos.some((e) => e.fase === "instalado"));
    const baixando = c.eventos.filter((e) => e.fase === "baixando");
    expect(baixando.length).toBeLessThan(8);
    expect(c.eventos.at(-1)?.bytes).toBe(modelo.tamanho_bytes);
  });

  it("um download por vez: o segundo recebe ja_baixando", async () => {
    const c = await montar({ handler: (_req, res) => { res.setHeader("content-length", String(A.length)); res.write(A.subarray(0, 100)); } }); // fica pendurado
    await c.svc.baixar(pedido());
    expect(c.svc.baixando()).toBe(true);
    expect(await codigoDe(c.svc.baixar(pedido()))).toBe("ja_baixando");
    await c.svc.cancelar("modelo-teste");
    await ate(() => !c.svc.baixando());
  });
});

describe("pausar, retomar, cancelar", () => {
  it("pausar mantém o parcial (listado como pausado); retomar continua por Range e conclui", async () => {
    let liberado = false;
    const c = await montar({
      handler: (req, res) => {
        const corpo = CONTEUDO[(req.url ?? "").replace("/m/", "")] as Buffer;
        const r = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
        const inicio = r === null ? 0 : Number(r[1]);
        if (inicio > 0) { res.statusCode = 206; res.setHeader("content-range", `bytes ${inicio}-${corpo.length - 1}/${corpo.length}`); }
        res.setHeader("content-length", String(corpo.length - inicio));
        if (!liberado) { res.write(corpo.subarray(inicio, inicio + 60_000)); return; }
        res.end(corpo.subarray(inicio));
      },
    });
    await c.svc.baixar(pedido());
    await ate(() => c.eventos.some((e) => e.fase === "baixando" && e.bytes > 0));
    await new Promise((ok) => setTimeout(ok, 300)); // deixa o trailing sair
    expect(await c.svc.pausar("modelo-teste")).toEqual({ ok: true });
    await ate(() => c.eventos.at(-1)?.fase === "pausado");
    const parcial = (await c.svc.listar()).modelos[0]!;
    expect(parcial.instalado).toBe(false);
    expect(parcial.download).toMatchObject({ fase: "pausado" });
    expect(parcial.download!.bytes).toBeGreaterThan(0);
    liberado = true;
    expect(await c.svc.retomar("modelo-teste")).toEqual({ ok: true });
    await ate(() => c.eventos.some((e) => e.fase === "instalado"));
    expect(c.srv.pedidos.some((p) => p.range !== undefined)).toBe(true);
    expect(c.ativos).toEqual(["modelo-teste"]);
  });

  it("retomar sem aceite gravado vigente é recusado (o aceite é por download)", async () => {
    const c = await montar();
    expect(await codigoDe(c.svc.retomar("modelo-teste"))).toBe("consentimento_ausente");
    expect(c.srv.conexoes()).toBe(0);
  });

  it("cancelar apaga os parciais e volta a 'não instalado'", async () => {
    const c = await montar({ handler: (_req, res) => { res.setHeader("content-length", String(A.length)); res.write(A.subarray(0, 50_000)); } });
    await c.svc.baixar(pedido());
    await ate(() => c.eventos.some((e) => e.bytes > 0));
    await c.svc.cancelar("modelo-teste");
    await ate(() => c.eventos.at(-1)?.fase === "nao_instalado");
    expect(existsSync(join(c.pastaModelos, ".parcial", "modelo-teste"))).toBe(false);
    expect((await c.svc.listar()).modelos[0]?.download).toBeNull();
  });
});

describe("erros acionáveis", () => {
  it("checksum adulterado: erro com instrução, parcial apagado, nada instalado nem ativado", async () => {
    const ruim = Buffer.from(A); ruim[10] = ruim[10]! ^ 0xff;
    const c = await montar({ handler: honesto({ ...CONTEUDO, "encoder.onnx": ruim }) });
    await c.svc.baixar(pedido());
    await ate(() => c.eventos.at(-1)?.fase === "erro");
    const e = c.eventos.at(-1)!;
    expect(e.codigo).toBe("checksum_invalido");
    expect(e.instrucao).toMatch(/Baixar de novo/);
    expect(existsSync(join(c.pastaModelos, ".parcial", "modelo-teste", "encoder.onnx.part"))).toBe(false);
    expect(c.ativos).toEqual([]);
    expect((await c.svc.listar()).modelos[0]?.instalado).toBe(false);
  });

  it("sem internet: erro sem_internet com instrução de retomar; disco cheio idem; servidor recusando (404) idem", async () => {
    const c = await montar();
    await c.srv.fechar();
    await c.svc.baixar(pedido());
    await ate(() => c.eventos.at(-1)?.fase === "erro");
    expect(c.eventos.at(-1)).toMatchObject({ codigo: "sem_internet" });
    expect(c.eventos.at(-1)?.instrucao).toMatch(/Retomar/);
    const d = await montar({ extra: { espacoLivre: async () => 1_000 } });
    await d.svc.baixar(pedido());
    await ate(() => d.eventos.at(-1)?.fase === "erro");
    expect(d.eventos.at(-1)).toMatchObject({ codigo: "disco_cheio" });
    expect(d.srv.conexoes()).toBe(0);
    const n = await montar({ handler: (_q, res) => { res.statusCode = 404; res.end(); } });
    await n.svc.baixar(pedido());
    await ate(() => n.eventos.at(-1)?.fase === "erro");
    expect(n.eventos.at(-1)).toMatchObject({ codigo: "servidor_recusou" });
  });

  it("autoteste que não reconhece a amostra: erro autoteste_falhou, modelo fica instalado mas NÃO é ativado", async () => {
    const c = await montar();
    c.runtimeCtl.texto = "bom dia a todos";
    await c.svc.baixar(pedido());
    await ate(() => c.eventos.at(-1)?.fase === "erro");
    expect(c.eventos.at(-1)).toMatchObject({ codigo: "autoteste_falhou" });
    expect(c.ativos).toEqual([]);
    const l = (await c.svc.listar()).modelos[0]!;
    expect(l).toMatchObject({ instalado: true, ativo: false });
  });

  it("runtime que falha no autoteste (modelo corrompido/runtime indisponível) vira o código nominal", async () => {
    const c = await montar();
    c.runtimeCtl.falhar = new ErroMotor("runtime_indisponivel", "x");
    await c.svc.baixar(pedido());
    await ate(() => c.eventos.at(-1)?.fase === "erro");
    expect(c.eventos.at(-1)).toMatchObject({ codigo: "runtime_indisponivel" });
  });
});

describe("autoteste, ativar e apagar", () => {
  async function instalado(): Promise<Cena & { srv: Srv }> {
    const c = await montar();
    await c.svc.baixar(pedido());
    await ate(() => c.eventos.some((e) => e.fase === "instalado"));
    return c;
  }

  it("autoteste reporta acertos, tempos e RTF; compara sem acento e sem pontuação", async () => {
    const c = await instalado();
    const r = await c.svc.autoteste("modelo-teste");
    expect(r).toMatchObject({ ok: true, acertos: 3, esperadas: 3, codigo: null });
    expect(r.rtf).toBeGreaterThan(0);
    expect(r.carregamento_ms).toBe(300);
    expect(normalizarPalavras("Olá, TESTE! de VOZ… no terminal?")).toEqual(["ola", "teste", "de", "voz", "no", "terminal"]);
    expect(c.transcricoes.at(-1)?.chave).toBe("modelo-teste|pt"); // chave estável por modelo (+ idioma nos Whisper)
  });

  it("modelo trocado depois de verificado (arquivo pequeno alterado): ativar, autoteste e o motor recusam com modelo_corrompido", async () => {
    const c = await instalado();
    const caminho = join(c.pastaModelos, "modelo-teste", "vocab.txt");
    const original = readFileSync(caminho);
    const troca = Buffer.from(original); troca[0] = troca[0]! ^ 1;
    writeFileSync(caminho, troca);
    expect(await c.svc.ativar("modelo-teste")).toMatchObject({ ok: false, codigo: "modelo_corrompido" });
    expect(await c.svc.autoteste("modelo-teste")).toMatchObject({ ok: false, codigo: "modelo_corrompido" });
    expect((await c.svc.listar()).modelos[0]).toMatchObject({ instalado: false, integridade: "corrompido" });
    expect(await c.svc.local.pronto("modelo-teste")).toBe(false);
    const wav = new Uint8Array(readFileSync(WAV_PT));
    await expect(c.svc.local.motor("modelo-teste").transcrever(wav, { idioma: "pt", modelo: null, prompt: "" })).rejects.toMatchObject({ codigo: "modelo_corrompido" });
  });

  it("motor local transcreve o WAV pelo runtime com a configuração do catálogo (sem tocar disco)", async () => {
    const c = await instalado();
    c.runtimeCtl.texto = "texto reconhecido";
    const wav = new Uint8Array(readFileSync(WAV_PT));
    const texto = await c.svc.local.motor("modelo-teste").transcrever(wav, { idioma: "pt", modelo: null, prompt: "" });
    expect(texto).toBe("texto reconhecido");
    expect(c.transcricoes.at(-1)?.bytes).toBeGreaterThan(50_000);
    expect(await c.svc.local.pronto("modelo-teste")).toBe(true);
    expect(await c.svc.local.pronto(null)).toBe(false);
    expect(c.svc.local.existeNoCatalogo("modelo-teste")).toBe(true);
    expect(c.svc.local.existeNoCatalogo("../x")).toBe(false);
  });

  it("apagar remove a pasta e o parcial, descarrega o runtime e desativa o motor se era o ativo", async () => {
    const c = await instalado();
    expect(await c.svc.apagar("modelo-teste")).toEqual({ ok: true });
    expect(existsSync(join(c.pastaModelos, "modelo-teste"))).toBe(false);
    expect(c.runtimeCtl.descarregados).toBeGreaterThan(0);
    expect(c.ativos.at(-1)).toBeNull();
    expect(c.motor.motor).toBe("nenhum");
    expect((await c.svc.listar()).modelos[0]).toMatchObject({ instalado: false, ativo: false });
    expect(await c.svc.ativar("modelo-teste")).toMatchObject({ ok: false, codigo: "nao_instalado" });
  });

  it("ativar um modelo instalado e íntegro troca o ativo", async () => {
    const c = await instalado();
    c.ativos.length = 0;
    expect(await c.svc.ativar("modelo-teste")).toEqual({ ok: true, codigo: null, instrucao: null });
    expect(c.ativos).toEqual(["modelo-teste"]);
    expect(await codigoDe(c.svc.ativar("nao-existe"))).toBe("modelo_desconhecido");
  });
});
