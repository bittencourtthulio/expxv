import { describe, expect, it } from "vitest";
import { criarGuardas, ECO_MS, ehDireto, ehMarcadorDoMaestro, ehSlashCommand, IDEMPOTENCIA_MS, TAXA_MAX_POR_MIN } from "./guardas";

function mundo(ehPane: (id: string) => boolean = () => false) {
  const t = { ms: 1_000_000 };
  const g = criarGuardas({ agora: () => t.ms, ehPaneDoMaestro: ehPane });
  return { t, g };
}

describe("guardas anti-loop", () => {
  it("(1) Pane do Maestro ⇒ loop_guard, antes de qualquer outra coisa", () => {
    const { g } = mundo((id) => id === "pE");
    expect(g.avaliar({ texto: "corrige o erro", pane_id: "pE", via: "mcp" })).toEqual({ acao: "loop_guard" });
    expect(g.avaliar({ texto: "corrige o erro", pane_id: "pL", via: "mcp" })).toEqual({ acao: "prosseguir" });
    expect(g.avaliar({ texto: "corrige o erro", pane_id: null, via: "paleta" })).toEqual({ acao: "prosseguir" });
  });
  it("(2) idempotência 120 s por (texto, Pane); texto equivalente em caixa/espaços é o mesmo", () => {
    const { t, g } = mundo();
    expect(g.avaliar({ texto: "Corrige   o erro", pane_id: "p1", via: "mcp" }).acao).toBe("prosseguir");
    g.registrarPlano("Corrige   o erro", "p1", "mpl_1");
    t.ms += IDEMPOTENCIA_MS - 1;
    expect(g.avaliar({ texto: "corrige o ERRO", pane_id: "p1", via: "mcp" })).toEqual({ acao: "idempotente", plano_id: "mpl_1" });
    expect(g.avaliar({ texto: "corrige o erro", pane_id: "p2", via: "mcp" }).acao).toBe("prosseguir");
    t.ms += 2;
    expect(g.avaliar({ texto: "corrige o erro", pane_id: "p1", via: "mcp" }).acao).toBe("prosseguir");
  });
  it("(5) taxa: ≤ 6 por minuto por Pane; janela deslizante; outro Pane não é afetado; sem Pane não limita", () => {
    const { t, g } = mundo();
    for (let i = 0; i < TAXA_MAX_POR_MIN; i++) expect(g.avaliar({ texto: `pedido ${i}`, pane_id: "p1", via: "mcp" }).acao).toBe("prosseguir");
    expect(g.avaliar({ texto: "pedido 99", pane_id: "p1", via: "mcp" })).toEqual({ acao: "taxa_excedida" });
    expect(g.avaliar({ texto: "pedido 99", pane_id: "p2", via: "mcp" }).acao).toBe("prosseguir");
    t.ms += 60_001;
    expect(g.avaliar({ texto: "pedido 100", pane_id: "p1", via: "mcp" }).acao).toBe("prosseguir");
    for (let i = 0; i < 50; i++) expect(g.avaliar({ texto: `ui ${i}`, pane_id: null, via: "paleta" }).acao).toBe("prosseguir");
  });
  it("(4) marcador [maestro] nunca é reclassificado (qualquer via)", () => {
    const { g } = mundo();
    for (const via of ["mcp", "hook", "chat"]) expect(g.avaliar({ texto: "  [Maestro] plano pronto", pane_id: "p1", via })).toEqual({ acao: "marcador_maestro" });
    expect(ehMarcadorDoMaestro("[maestro]x")).toBe(true);
    expect(ehMarcadorDoMaestro("x [maestro]")).toBe(false);
  });
  it("(7) no hook: slash command e @direto passam sem tocar; eco do ADE é ignorado por 30 s", () => {
    const { t, g } = mundo();
    expect(g.avaliar({ texto: "/expx:runx-causa x", pane_id: "p1", via: "hook" })).toEqual({ acao: "passa_direto", motivo: "slash" });
    expect(g.avaliar({ texto: "corrige o erro @direto", pane_id: "p1", via: "hook" })).toEqual({ acao: "passa_direto", motivo: "direto" });
    expect(g.avaliar({ texto: "@DIRETO corrige", pane_id: "p1", via: "hook" })).toEqual({ acao: "passa_direto", motivo: "direto" });
    expect(g.avaliar({ texto: "corrige x@diretor", pane_id: "p1", via: "hook" }).acao).toBe("prosseguir");
    g.registrarEco("p1", "/expx:runx-plano OC-1");
    expect(g.avaliar({ texto: "/expx:runx-plano OC-1", pane_id: "p1", via: "hook" }).acao).toBe("passa_direto");
    g.registrarEco("p1", "corrige o erro de eco");
    expect(g.avaliar({ texto: "corrige o erro de eco", pane_id: "p1", via: "hook" })).toEqual({ acao: "eco" });
    expect(g.avaliar({ texto: "corrige o erro de eco", pane_id: "p2", via: "hook" }).acao).toBe("prosseguir");
    t.ms += ECO_MS + 1;
    expect(g.avaliar({ texto: "corrige o erro de eco", pane_id: "p1", via: "hook" }).acao).toBe("prosseguir");
  });
  it("slash e @direto só passam direto no hook; nas outras vias são pedido comum", () => {
    const { g } = mundo();
    expect(g.avaliar({ texto: "/expx:runx-causa x", pane_id: "p1", via: "mcp" }).acao).toBe("prosseguir");
    expect(ehSlashCommand("  /x")).toBe(true);
    expect(ehSlashCommand("x /y")).toBe(false);
    expect(ehDireto("faça @direto")).toBe(true);
  });
  it("memória limitada: milhares de pedidos não crescem sem limite", () => {
    const { t, g } = mundo();
    for (let i = 0; i < 6000; i++) {
      t.ms += 5;
      g.registrarPlano(`pedido ${i}`, `p${i % 50}`, `mpl_${i}`);
      g.registrarEco(`p${i % 50}`, `eco ${i}`);
    }
    expect(g.tamanho().idempotencia).toBeLessThanOrEqual(2000);
    expect(g.tamanho().eco).toBeLessThanOrEqual(2000);
  });
});
