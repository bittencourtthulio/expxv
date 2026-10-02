import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarClienteRede, criarRegistroConsentimento } from "../../rede";
import type { Catalogo, ModeloCatalogo } from "./catalogo";
import { baixarModelo, descartarParcial, ErroModelo, limparOrfaos, type Escritor, type PortasDownload } from "./download";
import { verificarCompleto, verificarRapido } from "./integridade";

const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const bytesAleatorios = (n: number, semente: number): Buffer => { const b = Buffer.alloc(n); let x = semente; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x & 0xff; } return b; };

const ARQ_A = bytesAleatorios(300_000, 1);
const ARQ_B = bytesAleatorios(40_000, 2);
const CONTEUDO: Record<string, Buffer> = { "a.onnx": ARQ_A, "b-vocab.txt": ARQ_B };

function modeloDe(porta: number, mut: (m: ModeloCatalogo) => void = () => undefined): ModeloCatalogo {
  void porta;
  const m: ModeloCatalogo = {
    id: "modelo-teste", nome: "Teste", descricao: "d", idiomas: ["pt"], familia: "whisper", perfil: "leve", recomendado: false, velocidade: "rapida", qualidade: "boa", ram_estimada_mb: 100, trecho_max_s: 28, amostra: "pt",
    licenca: { id: "MIT", url: "https://x.y/l", atribuicao: "a" }, origem: { host: "127.0.0.1", caminho_base: "/m/" },
    arquivos: Object.entries(CONTEUDO).map(([nome, b]) => ({ nome, papel: "p", bytes: b.length, sha256: sha(b) })), tamanho_bytes: ARQ_A.length + ARQ_B.length,
  };
  mut(m);
  m.tamanho_bytes = m.arquivos.reduce((s, a) => s + a.bytes, 0);
  return m;
}
const catalogoDe = (m: ModeloCatalogo, hostsArquivos: string[] = []): Catalogo => ({ versao: 1, runtime: "r", hosts_origem: ["127.0.0.1"], hosts_arquivos: hostsArquivos, modelos: [m], amostras: {} });

interface Servidor { porta: number; pedidos: Array<{ caminho: string; range: string | undefined }>; conexoes(): number; fechar(): Promise<void> }
type Manip = (req: IncomingMessage, res: ServerResponse, n: number) => void;
async function subir(manip: Manip): Promise<Servidor> {
  const sockets = new Set<Socket>();
  let conexoes = 0;
  const pedidos: Servidor["pedidos"] = [];
  const srv: Server = createServer((req, res) => { pedidos.push({ caminho: req.url ?? "", range: req.headers.range }); manip(req, res, pedidos.length); });
  srv.on("connection", (s) => { conexoes++; sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { porta: (srv.address() as { port: number }).port, pedidos, conexoes: () => conexoes, fechar: () => new Promise<void>((ok) => { for (const s of sockets) s.destroy(); srv.close(() => ok()); }) };
}

/** servidor honesto: Range, Content-Length, 206. */
function honesto(conteudo: Record<string, Buffer> = CONTEUDO, opcoes: { ignorarRange?: boolean; cortarPrimeira?: number } = {}): Manip {
  const cortes = new Map<string, number>();
  return (req, res) => {
    const nome = (req.url ?? "").replace("/m/", "");
    const corpo = conteudo[nome];
    if (corpo === undefined) { res.statusCode = 404; return void res.end(); }
    const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
    const inicio = range !== null && opcoes.ignorarRange !== true ? Number(range[1]) : 0;
    const parte = corpo.subarray(inicio);
    if (inicio > 0) { res.statusCode = 206; res.setHeader("content-range", `bytes ${inicio}-${corpo.length - 1}/${corpo.length}`); }
    res.setHeader("content-length", String(parte.length));
    if (opcoes.cortarPrimeira !== undefined && !cortes.has(nome) && nome === "a.onnx") {
      cortes.set(nome, 1);
      res.write(parte.subarray(0, opcoes.cortarPrimeira));
      setTimeout(() => res.socket?.destroy(), 20);
      return;
    }
    res.end(parte);
  };
}

let tmp: string;
const servidores: Servidor[] = [];
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "voz-dl-")); });
afterEach(async () => { while (servidores.length) await (servidores.pop() as Servidor).fechar(); rmSync(tmp, { recursive: true, force: true }); });
const subirReg = async (m: Manip): Promise<Servidor> => { const s = await subir(m); servidores.push(s); return s; };

function portasDe(porta: number, extra: Partial<PortasDownload> = {}): { portas: PortasDownload; consentimento: ReturnType<typeof criarRegistroConsentimento> } {
  const consentimento = criarRegistroConsentimento();
  consentimento.permitirHost("127.0.0.1");
  const rede = criarClienteRede({ consentimento, permitirLoopbackHttp: true });
  return { consentimento, portas: { rede, token: (h) => consentimento.conceder(h), porta, espacoLivre: async () => 10 * 1024 ** 3, esperar: async () => undefined, ...extra } };
}
const pastaModelos = (): string => join(tmp, "voz", "modelos");
const rodar = (portas: PortasDownload, m: ModeloCatalogo, extra: { sinal?: AbortSignal; progresso?: number[]; catalogo?: Catalogo } = {}) =>
  baixarModelo(portas, { modelo: m, catalogo: extra.catalogo ?? catalogoDe(m), pastaModelos: pastaModelos(), sinal: extra.sinal ?? new AbortController().signal, aoProgresso: (p) => extra.progresso?.push(p.bytes) });
const codigo = async (p: Promise<unknown>): Promise<string> => { try { await p; return "NAO_FALHOU"; } catch (e) { return e instanceof ErroModelo ? e.codigo : `outro:${String(e)}`; } };

describe("download de modelo: caminho feliz", () => {
  it("baixa, confere sha256 em streaming, instala atomicamente com permissões restritas e marca de integridade", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta);
    const { portas } = portasDe(s.porta);
    const progresso: number[] = [];
    const r = await rodar(portas, m, { progresso });
    expect(r.pasta).toBe(join(pastaModelos(), "modelo-teste"));
    expect(readFileSync(join(r.pasta, "a.onnx")).equals(ARQ_A)).toBe(true);
    expect(readFileSync(join(r.pasta, "b-vocab.txt")).equals(ARQ_B)).toBe(true);
    expect(existsSync(join(pastaModelos(), ".parcial", "modelo-teste"))).toBe(false);
    if (process.platform !== "win32") {
      expect(statSync(pastaModelos()).mode & 0o777).toBe(0o700);
      expect(statSync(r.pasta).mode & 0o777).toBe(0o700);
      expect(statSync(join(r.pasta, "a.onnx")).mode & 0o777).toBe(0o600);
    }
    expect(progresso.length).toBeGreaterThan(0);
    expect([...progresso].sort((a, b) => a - b)).toEqual(progresso); // monotônico
    expect(progresso.at(-1)).toBe(m.tamanho_bytes);
    expect((await verificarRapido(pastaModelos(), m)).ok).toBe(true);
    expect((await verificarCompleto(pastaModelos(), m)).ok).toBe(true);
    expect(s.pedidos.every((p) => p.range === undefined)).toBe(true);
  });

  it("reinstalar por cima troca a pasta e não deixa resíduo", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta);
    const { portas } = portasDe(s.porta);
    await rodar(portas, m);
    writeFileSync(join(pastaModelos(), "modelo-teste", "lixo.bin"), "x");
    await rodar(portas, m);
    expect(readdirSync(join(pastaModelos(), "modelo-teste")).sort()).toEqual([".integridade.json", "a.onnx", "b-vocab.txt"]);
    expect(readdirSync(pastaModelos()).filter((n) => n.startsWith(".antigo-"))).toEqual([]);
  });
});

describe("download de modelo: retomada, pausa e cancelamento", () => {
  it("conexão cortada no meio: retoma com Range a partir do que chegou e termina íntegro", async () => {
    const s = await subirReg(honesto(CONTEUDO, { cortarPrimeira: 100_000 }));
    const m = modeloDe(s.porta);
    const { portas } = portasDe(s.porta);
    await rodar(portas, m);
    const ranges = s.pedidos.filter((p) => p.caminho === "/m/a.onnx").map((p) => p.range);
    expect(ranges[0]).toBeUndefined();
    expect(ranges[1]).toMatch(/^bytes=\d+-$/);
    expect(Number(/\d+/.exec(ranges[1] ?? "")?.[0])).toBeGreaterThan(0);
    expect(readFileSync(join(pastaModelos(), "modelo-teste", "a.onnx")).equals(ARQ_A)).toBe(true);
  });

  it("pausar mantém o parcial; retomar (novo token) continua por Range e conclui", async () => {
    let liberado = false;
    const s = await subirReg((req, res) => {
      const nome = (req.url ?? "").replace("/m/", "");
      const corpo = CONTEUDO[nome] as Buffer;
      const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? "");
      const inicio = range !== null ? Number(range[1]) : 0;
      const parte = corpo.subarray(inicio);
      if (inicio > 0) { res.statusCode = 206; res.setHeader("content-range", `bytes ${inicio}-${corpo.length - 1}/${corpo.length}`); }
      res.setHeader("content-length", String(parte.length));
      if (nome === "a.onnx" && !liberado) { res.write(parte.subarray(0, 50_000)); return; } // fica pendurado até a pausa
      res.end(parte);
    });
    const m = modeloDe(s.porta);
    const { portas } = portasDe(s.porta);
    const ac = new AbortController();
    const andamento = rodar(portas, m, { sinal: ac.signal, progresso: [] });
    await new Promise((ok) => setTimeout(ok, 200));
    ac.abort("pausa");
    const falha = await andamento.catch((e: unknown) => e);
    expect(falha).toBeInstanceOf(ErroModelo);
    expect((falha as ErroModelo).codigo).toBe("cancelado");
    expect((falha as ErroModelo).motivo).toBe("pausa");
    const part = join(pastaModelos(), ".parcial", "modelo-teste", "a.onnx.part");
    expect(statSync(part).size).toBeGreaterThan(0);
    liberado = true;
    await rodar(portas, m);
    expect(s.pedidos.some((p) => p.range !== undefined)).toBe(true);
    expect(readFileSync(join(pastaModelos(), "modelo-teste", "a.onnx")).equals(ARQ_A)).toBe(true);
  });

  it("servidor que ignora Range (responde 200 inteiro) recomeça do zero sem corromper", async () => {
    const s = await subirReg(honesto(CONTEUDO, { ignorarRange: true }));
    const m = modeloDe(s.porta);
    const { portas } = portasDe(s.porta);
    const dir = join(pastaModelos(), ".parcial", "modelo-teste");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "a.onnx.part"), ARQ_A.subarray(0, 1_000));
    await rodar(portas, m);
    expect(readFileSync(join(pastaModelos(), "modelo-teste", "a.onnx")).equals(ARQ_A)).toBe(true);
  });

  it("parcial corrompido de uma execução anterior é detectado pelo checksum final (e apagado)", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta);
    const { portas } = portasDe(s.porta);
    const dir = join(pastaModelos(), ".parcial", "modelo-teste");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "a.onnx.part"), Buffer.alloc(1_000, 7)); // prefixo errado
    expect(await codigo(rodar(portas, m))).toBe("checksum_invalido");
    expect(existsSync(join(dir, "a.onnx.part"))).toBe(false);
  });

  it("cancelar apaga os parciais (descartarParcial) e nada é instalado", async () => {
    const s = await subirReg((req, res) => { res.setHeader("content-length", String(ARQ_A.length)); res.write(ARQ_A.subarray(0, 10_000)); void req; });
    const m = modeloDe(s.porta);
    const { portas } = portasDe(s.porta);
    const ac = new AbortController();
    const p = rodar(portas, m, { sinal: ac.signal });
    await new Promise((ok) => setTimeout(ok, 150));
    ac.abort("cancelamento");
    const e = await p.catch((x: unknown) => x as ErroModelo);
    expect((e as ErroModelo).motivo).toBe("cancelamento");
    await descartarParcial(pastaModelos(), "modelo-teste");
    expect(existsSync(join(pastaModelos(), ".parcial", "modelo-teste"))).toBe(false);
    expect(existsSync(join(pastaModelos(), "modelo-teste"))).toBe(false);
  });

  it("sinal já abortado: nenhuma conexão", async () => {
    const s = await subirReg(honesto());
    const ac = new AbortController();
    ac.abort("cancelamento");
    expect(await codigo(rodar(portasDe(s.porta).portas, modeloDe(s.porta), { sinal: ac.signal }))).toBe("cancelado");
    expect(s.conexoes()).toBe(0);
  });
});

describe("download de modelo: ataques e falhas", () => {
  it("checksum adulterado (mesmo tamanho): checksum_invalido, sem retentativa, parcial apagado, nada instalado", async () => {
    const adulterado = Buffer.from(ARQ_A);
    adulterado[1234] = adulterado[1234]! ^ 0xff;
    const s = await subirReg(honesto({ ...CONTEUDO, "a.onnx": adulterado }));
    const m = modeloDe(s.porta);
    expect(await codigo(rodar(portasDe(s.porta).portas, m))).toBe("checksum_invalido");
    expect(s.pedidos.filter((p) => p.caminho === "/m/a.onnx")).toHaveLength(1);
    expect(existsSync(join(pastaModelos(), ".parcial", "modelo-teste", "a.onnx.part"))).toBe(false);
    expect(existsSync(join(pastaModelos(), "modelo-teste"))).toBe(false);
  });

  it("tamanho acima do declarado no catálogo (sem Content-Length) aborta com tamanho_invalido", async () => {
    const s = await subirReg((_q, res) => { res.write(Buffer.alloc(ARQ_A.length + 5_000, 1)); res.end(); });
    expect(await codigo(rodar(portasDe(s.porta).portas, modeloDe(s.porta)))).toBe("tamanho_invalido");
  });

  it("Content-Length diferente do catálogo (a mais ou a menos) é recusado antes de gravar", async () => {
    for (const delta of [+10, -10]) {
      const s = await subirReg((_q, res) => { const b = Buffer.alloc(ARQ_A.length + delta, 1); res.setHeader("content-length", String(b.length)); res.end(b); });
      expect(await codigo(rodar(portasDe(s.porta).portas, modeloDe(s.porta)))).toBe("tamanho_invalido");
      expect(existsSync(join(pastaModelos(), ".parcial", "modelo-teste", "a.onnx.part"))).toBe(false);
    }
  });

  it("Content-Range que não bate com o pedido é recusado", async () => {
    const s = await subirReg((_q, res) => { res.statusCode = 206; res.setHeader("content-range", `bytes 5-${ARQ_A.length - 1}/${ARQ_A.length}`); res.end(ARQ_A.subarray(5)); });
    const dir = join(pastaModelos(), ".parcial", "modelo-teste");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "a.onnx.part"), ARQ_A.subarray(0, 100));
    expect(await codigo(rodar(portasDe(s.porta).portas, modeloDe(s.porta)))).toBe("tamanho_invalido");
  });

  it("redirecionamento para outro host é recusado sem tocar o destino; para o CDN do catálogo é seguido", async () => {
    const cdn = await subirReg(honesto({ "a.onnx": ARQ_A, "b-vocab.txt": ARQ_B }));
    // o destino "de verdade" vive sob /m/ no CDN; a origem só redireciona
    const origem = await subirReg((req, res) => { res.statusCode = 302; res.setHeader("location", `http://127.0.0.1:${cdn.porta}${req.url}`); res.end(); });
    const m = modeloDe(origem.porta);
    const { portas } = portasDe(origem.porta);
    // 1) sem o host no catálogo: recusado
    expect(await codigo(rodar(portas, m, { catalogo: catalogoDe(m, []) }))).toBe("redirect_recusado");
    expect(cdn.conexoes()).toBe(0);
    // 2) host de arquivos listado: ok
    await rodar(portas, m, { catalogo: catalogoDe(m, ["127.0.0.1"]) });
    expect(readFileSync(join(pastaModelos(), "modelo-teste", "a.onnx")).equals(ARQ_A)).toBe(true);
  });

  it("redirecionamento para localhost (outro host) recusado mesmo com o host consentido", async () => {
    const alvo = await subirReg(() => { throw new Error("não deveria ser chamado"); });
    const origem = await subirReg((_q, res) => { res.statusCode = 302; res.setHeader("location", `http://localhost:${alvo.porta}/m/a.onnx`); res.end(); });
    const m = modeloDe(origem.porta);
    const { portas, consentimento } = portasDe(origem.porta);
    consentimento.permitirHost("localhost");
    expect(await codigo(rodar(portas, m, { catalogo: catalogoDe(m, ["127.0.0.1"]) }))).toBe("redirect_recusado");
    expect(alvo.conexoes()).toBe(0);
  });

  it("sem consentimento (token inválido): consentimento_ausente e zero conexões", async () => {
    const s = await subirReg(honesto());
    const { portas } = portasDe(s.porta, { token: () => "ctk_inventado" });
    expect(await codigo(rodar(portas, modeloDe(s.porta)))).toBe("consentimento_ausente");
    expect(s.conexoes()).toBe(0);
  });

  it("entrada sem checksum confirmado é RECUSADA antes de qualquer conexão", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta, (x) => { x.arquivos[0]!.sha256 = null; });
    expect(await codigo(rodar(portasDe(s.porta).portas, m))).toBe("sem_checksum");
    expect(s.conexoes()).toBe(0);
  });

  it("nome de arquivo com traversal (zip-slip) não grava nada fora da pasta", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta, (x) => { x.arquivos[0]!.nome = "../../fora.bin"; });
    expect(await codigo(rodar(portasDe(s.porta).portas, m))).toBe("indisponivel");
    expect(existsSync(join(tmp, "fora.bin"))).toBe(false);
    expect(existsSync(join(tmp, "voz", "fora.bin"))).toBe(false);
    expect(s.conexoes()).toBe(0);
  });

  it("disco cheio: espaço insuficiente antes de começar (zero conexões) e ENOSPC no meio (parcial mantido para retomar)", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta);
    expect(await codigo(rodar(portasDe(s.porta, { espacoLivre: async () => 1_000 }).portas, m))).toBe("disco_cheio");
    expect(s.conexoes()).toBe(0);
    let escritos = 0;
    const abrirEscritor = async (caminho: string, anexar: boolean): Promise<Escritor> => {
      const { open } = await import("node:fs/promises");
      const fh = await open(caminho, anexar ? "a" : "w", 0o600);
      return {
        escrever: async (d) => { if (escritos > 0) throw Object.assign(new Error("cheio"), { code: "ENOSPC" }); escritos += d.length; await fh.write(d); },
        fechar: async () => { await fh.close(); },
      };
    };
    expect(await codigo(rodar(portasDe(s.porta, { abrirEscritor }).portas, m))).toBe("disco_cheio");
    expect(existsSync(join(pastaModelos(), "modelo-teste"))).toBe(false);
    expect(statSync(join(pastaModelos(), ".parcial", "modelo-teste", "a.onnx.part")).size).toBeGreaterThan(0);
  });

  it("404 vira servidor_recusou; 503 repetido vira servidor_recusou depois das tentativas", async () => {
    const s404 = await subirReg((_q, res) => { res.statusCode = 404; res.end(); });
    expect(await codigo(rodar(portasDe(s404.porta).portas, modeloDe(s404.porta)))).toBe("servidor_recusou");
    const s503 = await subirReg((_q, res) => { res.statusCode = 503; res.end(); });
    expect(await codigo(rodar(portasDe(s503.porta).portas, modeloDe(s503.porta)))).toBe("servidor_recusou");
    expect(s503.pedidos).toHaveLength(3);
  });

  it("sem rede (servidor fora do ar): sem_internet depois das tentativas", async () => {
    const s = await subir(honesto());
    const porta = s.porta;
    await s.fechar();
    expect(await codigo(rodar(portasDe(porta).portas, modeloDe(porta)))).toBe("sem_internet");
  });

  it("symlink plantado no lugar do .part não é seguido", async () => {
    if (process.platform === "win32") return;
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta);
    const alvo = join(tmp, "alvo-sensivel.txt");
    writeFileSync(alvo, "SEGREDO");
    const dir = join(pastaModelos(), ".parcial", "modelo-teste");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    symlinkSync(alvo, join(dir, "a.onnx.part"));
    await rodar(portasDe(s.porta).portas, m);
    expect(readFileSync(alvo, "utf8")).toBe("SEGREDO");
    expect(readFileSync(join(pastaModelos(), "modelo-teste", "a.onnx")).equals(ARQ_A)).toBe(true);
  });

  it("limparOrfaos remove `.antigo-*` e parciais soltos, preservando os em andamento", async () => {
    mkdirSync(join(pastaModelos(), ".antigo-abcd"), { recursive: true });
    mkdirSync(join(pastaModelos(), ".parcial", ".solto"), { recursive: true });
    mkdirSync(join(pastaModelos(), ".parcial", "modelo-teste"), { recursive: true });
    mkdirSync(join(pastaModelos(), "instalado-ok"), { recursive: true });
    await limparOrfaos(pastaModelos(), new Set(["modelo-teste"]));
    expect(existsSync(join(pastaModelos(), ".antigo-abcd"))).toBe(false);
    expect(existsSync(join(pastaModelos(), ".parcial", ".solto"))).toBe(false);
    expect(existsSync(join(pastaModelos(), ".parcial", "modelo-teste"))).toBe(true);
    expect(existsSync(join(pastaModelos(), "instalado-ok"))).toBe(true);
  });
});

describe("integridade depois de instalado", () => {
  it("modelo trocado/truncado/symlink/marca adulterada é detectado na verificação rápida (modelo_corrompido)", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta);
    await rodar(portasDe(s.porta).portas, m);
    const pasta = join(pastaModelos(), "modelo-teste");
    expect((await verificarRapido(pastaModelos(), m)).ok).toBe(true);
    // arquivo pequeno trocado por outro do MESMO tamanho: pego pelo sha256 dos pequenos
    const original = readFileSync(join(pasta, "b-vocab.txt"));
    const troca = Buffer.from(original); troca[0] = troca[0]! ^ 1;
    writeFileSync(join(pasta, "b-vocab.txt"), troca);
    expect((await verificarRapido(pastaModelos(), m)).ok).toBe(false);
    expect((await verificarCompleto(pastaModelos(), m)).ok).toBe(false);
    writeFileSync(join(pasta, "b-vocab.txt"), original);
    expect((await verificarCompleto(pastaModelos(), m)).ok).toBe(true); // a verificação completa renova a marca
    // arquivo grande truncado: tamanho muda
    writeFileSync(join(pasta, "a.onnx"), ARQ_A.subarray(0, 10));
    expect((await verificarRapido(pastaModelos(), m)).ok).toBe(false);
    writeFileSync(join(pasta, "a.onnx"), ARQ_A);
    expect((await verificarCompleto(pastaModelos(), m)).ok).toBe(true);
    // marca apagada
    rmSync(join(pasta, ".integridade.json"));
    expect(await verificarRapido(pastaModelos(), m)).toEqual({ ok: false, motivo: "corrompido" });
    // modelo ausente
    rmSync(pasta, { recursive: true });
    expect(await verificarRapido(pastaModelos(), m)).toEqual({ ok: false, motivo: "ausente" });
  });

  it("arquivo grande trocado por outro do mesmo tamanho com mtime diferente é pego na rápida; hash completo confirma", async () => {
    const s = await subirReg(honesto());
    const m = modeloDe(s.porta);
    await rodar(portasDe(s.porta).portas, m);
    const pasta = join(pastaModelos(), "modelo-teste");
    const falso = Buffer.alloc(ARQ_A.length, 3);
    const { utimesSync } = await import("node:fs");
    writeFileSync(join(pasta, "a.onnx"), falso);
    utimesSync(join(pasta, "a.onnx"), new Date(), new Date(Date.now() + 5_000));
    expect((await verificarRapido(pastaModelos(), m)).ok).toBe(false);
    expect((await verificarCompleto(pastaModelos(), m)).ok).toBe(false);
  });
});
