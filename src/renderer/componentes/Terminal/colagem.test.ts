import { describe, expect, it } from "vitest";
import { ABRE_COLAGEM, FECHA_COLAGEM, GerenciadorColagem, TAMANHO_PEDACO_BYTES, envelopar, normalizarColagem, partirColagem, precisaDeConfirmacao } from "./colagem";

const bytes = (t: string): number => new TextEncoder().encode(t).length;
const imediato = (): Promise<void> => Promise.resolve();

describe("precisaDeConfirmacao", () => {
  it("funcional: 20.000 caracteres passam, 20.001 pedem confirmação", () => {
    expect(precisaDeConfirmacao("a".repeat(20_000))).toBe(false);
    expect(precisaDeConfirmacao("a".repeat(20_001))).toBe(true);
  });
  it("funcional: 32 KB em UTF-8 é o outro limite (o que vier primeiro)", () => {
    expect(precisaDeConfirmacao("é".repeat(16_384))).toBe(false); // 32.768 bytes
    expect(precisaDeConfirmacao("é".repeat(16_385))).toBe(true);
  });
});

describe("normalizarColagem", () => {
  it("funcional: quebras de linha viram CR", () => {
    expect(normalizarColagem("a\r\nb\nc")).toBe("a\rb\rc");
  });
  it("seguranca: marcadores de colagem de dentro do texto são removidos", () => {
    expect(normalizarColagem("x\x1b[201~rm -rf\x1b[200~y")).toBe("xrm -rfy");
  });
});

describe("partirColagem", () => {
  it("funcional: nenhum pedaço passa do limite e a junção devolve o texto", () => {
    const texto = "linha de texto com acentuação ção\r".repeat(5_000);
    const partes = partirColagem(texto, TAMANHO_PEDACO_BYTES);
    expect(partes.length).toBeGreaterThan(1);
    expect(partes.every((p) => bytes(p) <= TAMANHO_PEDACO_BYTES)).toBe(true);
    expect(partes.join("")).toBe(texto);
  });
  it("funcional: emoji na fronteira não é partido ao meio", () => {
    const texto = `${"a".repeat(TAMANHO_PEDACO_BYTES - 2)}😀${"b".repeat(10)}`;
    const partes = partirColagem(texto, TAMANHO_PEDACO_BYTES);
    expect(partes.join("")).toBe(texto);
    expect(partes.every((p) => !/[\uD800-\uDBFF]$/.test(p) && !/^[\uDC00-\uDFFF]/.test(p))).toBe(true);
    expect(partes.every((p) => bytes(p) <= TAMANHO_PEDACO_BYTES)).toBe(true);
  });
  it("funcional: texto vazio não gera pedaços", () => { expect(partirColagem("", 10)).toEqual([]); });
});

describe("envelopar", () => {
  it("funcional: com modo 2004 há um marcador de abertura no início e um de fechamento no fim", () => {
    expect(envelopar(["a", "b"], true)).toEqual([ABRE_COLAGEM, "a", "b", FECHA_COLAGEM]);
  });
  it("funcional: sem modo 2004 nenhum marcador é enviado", () => {
    expect(envelopar(["a", "b"], false)).toEqual(["a", "b"]);
  });
});

describe("GerenciadorColagem", () => {
  it("funcional: envia todos os pedaços em ordem, com um envelope, e reporta o progresso", async () => {
    const escritos: string[] = [];
    const progresso: Array<[number, number]> = [];
    const g = new GerenciadorColagem(imediato);
    const texto = "x".repeat(TAMANHO_PEDACO_BYTES * 2 + 5);
    const envio = g.iniciar("s1", { texto, modo2004: true, escrever: (d) => escritos.push(d), aoProgresso: (f, t) => progresso.push([f, t]) });
    expect(envio).not.toBeNull();
    await expect(envio!.concluido).resolves.toBe("concluido");
    expect(escritos[0]).toBe(ABRE_COLAGEM);
    expect(escritos.at(-1)).toBe(FECHA_COLAGEM);
    expect(escritos.filter((e) => e === ABRE_COLAGEM)).toHaveLength(1);
    expect(escritos.filter((e) => e === FECHA_COLAGEM)).toHaveLength(1);
    expect(escritos.slice(1, -1).every((e) => bytes(e) <= TAMANHO_PEDACO_BYTES)).toBe(true);
    expect(escritos.slice(1, -1).join("")).toBe(texto);
    expect(progresso.at(-1)).toEqual([3, 3]);
    expect(g.emCurso("s1")).toBe(false);
  });
  it("funcional: cancelar depois do 2º pedaço fecha o envelope e não envia mais nada", async () => {
    const escritos: string[] = [];
    const g = new GerenciadorColagem(imediato);
    const texto = "x".repeat(TAMANHO_PEDACO_BYTES * 4);
    const envio = g.iniciar("s1", { texto, modo2004: true, escrever: (d) => { escritos.push(d); if (escritos.length === 3) g.cancelar("s1"); } })!;
    await expect(envio.concluido).resolves.toBe("cancelado");
    expect(escritos).toHaveLength(4); // abre, 2 pedaços, fecha
    expect(escritos.at(-1)).toBe(FECHA_COLAGEM);
    expect(g.emCurso("s1")).toBe(false);
  });
  it("funcional: cancelar sem modo 2004 não envia marcador algum", async () => {
    const escritos: string[] = [];
    const g = new GerenciadorColagem(imediato);
    const envio = g.iniciar("s1", { texto: "x".repeat(TAMANHO_PEDACO_BYTES * 3), modo2004: false, escrever: (d) => { escritos.push(d); g.cancelar("s1"); } })!;
    await expect(envio.concluido).resolves.toBe("cancelado");
    expect(escritos).toHaveLength(1);
    expect(escritos.some((e) => e.includes("\x1b["))).toBe(false);
  });
  it("funcional: segundo envio no mesmo painel durante o primeiro é recusado; outro painel não", async () => {
    const g = new GerenciadorColagem(() => new Promise<void>(() => undefined));
    const texto = "x".repeat(TAMANHO_PEDACO_BYTES * 2);
    expect(g.iniciar("s1", { texto, modo2004: false, escrever: () => undefined })).not.toBeNull();
    expect(g.iniciar("s1", { texto, modo2004: false, escrever: () => undefined })).toBeNull();
    expect(g.iniciar("s2", { texto, modo2004: false, escrever: () => undefined })).not.toBeNull();
  });
  it("seguranca: marcadores dentro do texto nunca chegam ao escrever", async () => {
    const escritos: string[] = [];
    const g = new GerenciadorColagem(imediato);
    await g.iniciar("s1", { texto: "a\x1b[201~b", modo2004: true, escrever: (d) => escritos.push(d) })!.concluido;
    expect(escritos).toEqual([ABRE_COLAGEM, "ab", FECHA_COLAGEM]);
  });
});
