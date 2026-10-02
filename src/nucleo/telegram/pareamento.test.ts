import { describe, expect, it } from "vitest";
import { relogioFalso } from "../../../tests/fixtures/alertas/ajudas";
import { ALFABETO, criarPareamento, gerarCodigo, normalizarCodigo, TAMANHO_CODIGO, TTL_PAREAMENTO_MS, type PedidoPareamento } from "./pareamento";

const montar = (o: { bytes?: (n: number) => Buffer } = {}) => {
  const relogio = relogioFalso();
  const pedidos: PedidoPareamento[] = [];
  const estados: string[] = [];
  const p = criarPareamento({ relogio, aoPedido: (x) => pedidos.push(x), aoEstado: (e) => estados.push(e), ...o });
  return { relogio, p, pedidos, estados };
};
const u = (id: number, nome = "Ana") => ({ user_id: id, chat_id: id, nome });

describe("pareamento (T-20.26) e P-146", () => {
  it("P-146: >= 50 bits, alfabeto sem ambíguos, TTL <= 300 s, códigos únicos", () => {
    expect(ALFABETO.length).toBe(32);
    expect(TAMANHO_CODIGO * Math.log2(ALFABETO.length)).toBeGreaterThanOrEqual(50);
    expect(TTL_PAREAMENTO_MS).toBeLessThanOrEqual(300_000);
    expect(ALFABETO).not.toMatch(/[01OI]/);
    const codigos = new Set(Array.from({ length: 2000 }, () => gerarCodigo()));
    expect(codigos.size).toBe(2000);
    for (const c of codigos) expect(c).toMatch(new RegExp(`^[${ALFABETO}]{10}$`));
    // distribuição uniforme: cada símbolo aparece com frequência próxima de 1/32 (qui-quadrado frouxo)
    const cont: Record<string, number> = {};
    for (const c of codigos) for (const ch of c) cont[ch] = (cont[ch] ?? 0) + 1;
    const total = 2000 * TAMANHO_CODIGO;
    for (const ch of ALFABETO) expect(Math.abs((cont[ch] ?? 0) / total - 1 / 32)).toBeLessThan(0.01);
  });
  it("acerto: vira pedido (e SÓ o desktop decide); o código queima na hora (uso único)", () => {
    const { p, pedidos } = montar();
    const { codigo } = p.iniciar();
    const r = p.tentar(u(5), codigo);
    expect(r.pedido).toMatchObject({ user_id: 5, chat_id: 5, nome: "Ana" });
    expect(p.estado()).toBe("pedido");
    expect(p.tentar(u(6), codigo).pedido).toBeNull(); // duas pessoas, mesmo código: só a primeira
    expect(pedidos).toHaveLength(1);
    expect(p.decidir("par_errado", true)).toBeNull();
    expect(p.decidir((r.pedido as PedidoPareamento).pedido_id, true)).toMatchObject({ user_id: 5 });
    expect(p.estado()).toBe("fechado");
    expect(p.tentar(u(7), codigo).pedido).toBeNull(); // reuso depois de usado
  });
  it("Negar queima o código; decidir de novo não faz nada", () => {
    const { p } = montar();
    const { codigo } = p.iniciar();
    const r = p.tentar(u(5), codigo);
    expect(p.decidir((r.pedido as PedidoPareamento).pedido_id, false)).toBeNull();
    expect(p.tentar(u(5), codigo).pedido).toBeNull();
    expect(p.decidir((r.pedido as PedidoPareamento).pedido_id, true)).toBeNull();
  });
  it("AB-06: 5 erradas na janela (globais, de qualquer usuário) fecham; o código certo depois não vale", () => {
    const { p } = montar();
    const { codigo } = p.iniciar();
    for (let i = 0; i < 4; i++) expect(p.tentar(u(100 + i), "AAAAAAAAAA").pedido).toBeNull();
    expect(p.estado()).toBe("aguardando");
    expect(p.tentar(u(104), "BBBBBBBBBB").pedido).toBeNull();
    expect(p.estado()).toBe("fechado");
    expect(p.tentar(u(5), codigo).pedido).toBeNull();
  });
  it("AB-07: expira em 5 min; reiniciar o pareamento cancela o anterior; só um aberto por vez", () => {
    const { p, relogio } = montar();
    const a = p.iniciar();
    relogio.avancar(TTL_PAREAMENTO_MS - 1);
    expect(p.estado()).toBe("aguardando");
    relogio.avancar(2);
    expect(p.tentar(u(5), a.codigo).pedido).toBeNull();
    expect(p.estado()).toBe("fechado");
    const b = p.iniciar();
    const c = p.iniciar(); // substitui o anterior
    expect(p.tentar(u(5), b.codigo).pedido).toBeNull();
    expect(p.tentar(u(5), c.codigo).pedido).not.toBeNull();
  });
  it("pedido que o desktop nunca decide também expira", () => {
    const { p, relogio } = montar();
    const { codigo } = p.iniciar();
    const r = p.tentar(u(5), codigo);
    relogio.avancar(TTL_PAREAMENTO_MS + 1);
    expect(p.estado()).toBe("fechado");
    expect(p.decidir((r.pedido as PedidoPareamento).pedido_id, true)).toBeNull();
  });
  it("aceita hífen, espaço e minúsculas; normaliza; nome sanitizado (bidi/controle) e <= 40", () => {
    const { p } = montar();
    const { codigo } = p.iniciar();
    expect(normalizarCodigo(" ab-cd ef ")).toBe("ABCDEF");
    const r = p.tentar(u(5, `‮Evil\u0000${"x".repeat(100)}`), codigo.toLowerCase().replace("-", " "));
    expect(r.pedido?.nome.length).toBeLessThanOrEqual(40);
    expect(r.pedido?.nome).not.toMatch(/[‮\u0000]/);
  });
  it("sem janela aberta: sempre silêncio", () => {
    const { p } = montar();
    expect(p.tentar(u(5), "ABCDEFGHJK").pedido).toBeNull();
    expect(p.estado()).toBe("fechado");
  });
  it("sem oráculo de tempo: código errado e expirado custam o mesmo (média de 300 tentativas, diferença < 2 ms)", () => {
    const medir = (prepara: () => ReturnType<typeof montar>): number => {
      const { p } = prepara();
      const t0 = performance.now();
      for (let i = 0; i < 300; i++) p.tentar(u(5), "AAAAAAAAAA");
      return (performance.now() - t0) / 300;
    };
    const errado = medir(() => {
      const m = montar();
      m.p.iniciar();
      return m;
    });
    const expirado = medir(() => {
      const m = montar();
      m.p.iniciar();
      m.relogio.avancar(TTL_PAREAMENTO_MS + 1);
      return m;
    });
    expect(Math.abs(errado - expirado)).toBeLessThan(2);
  });
  it("o código nunca aparece nos eventos de estado", () => {
    const { p, estados } = montar();
    const { codigo } = p.iniciar();
    p.tentar(u(5), codigo);
    expect(JSON.stringify(estados)).not.toContain(codigo.replace("-", ""));
  });
});
