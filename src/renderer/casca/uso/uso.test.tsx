// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GERAL_FALSO, uso } from "../../a11y/ade-falso-harness";
import { storeLimites } from "../../estado/limites";
import { fecharPopoverLimites } from "../../estado/popover-limites";
import { CotaGeralTopo } from "../CotaGeralTopo";
import { GLIFOS } from "./glifos";
import { LogoProvedor } from "./LogoProvedor";
import { BarraJanela } from "./BarraJanela";
import type { LogoId } from "../provedores-visual";
import type { RespostaLimites } from "../../../compartilhado/limites";

afterEach(() => { cleanup(); fecharPopoverLimites(); delete (globalThis as { ade?: unknown }).ade; });

const FUTURO = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const RESP: RespostaLimites = {
  contas: [
    uso("a", "claude", { account_label: "Pessoal", windows: [{ kind: "five_hour", used_pct: 62, resets_at: FUTURO(1.4) }, { kind: "weekly", used_pct: 90, resets_at: FUTURO(70) }], model_buckets: { sonnet: { used_pct: 30, resets_at: FUTURO(70), kind: "weekly" }, "claude-opus-4-1-20250805": { used_pct: 100, resets_at: FUTURO(70), kind: "weekly" }, haiku: { used_pct: null, resets_at: null, kind: "weekly" } } }),
    uso("b", "codex", { account_label: "Trabalho", fonte: "codex_rollout", windows: [{ kind: "five_hour", used_pct: 20, resets_at: FUTURO(3) }], model_buckets: {} }),
    uso("c", "grok", { account_label: "Grok sem leitura", fonte: "nenhuma", confianca: "desconhecido", status: "unavailable", windows: [], model_buckets: {}, bottleneck: null, slack_pct: null }),
    uso("d", "openrouter", { account_label: "OR", fonte: "openrouter_api", windows: [], model_buckets: {}, credit: { limit_usd: 20, used_usd: 12.9, remaining_usd: 7.1 }, bottleneck: null }),
  ],
  geral: { ...GERAL_FALSO, pior: { conta_id: "a", rotulo: "Pessoal", kind: "weekly", used_pct: 90 }, cobertura: { com_dado: 3, total: 4 } },
};

async function abrir(extra: Record<string, unknown> = {}) {
  const limites = { snapshot: vi.fn().mockResolvedValue(RESP), atualizar: vi.fn().mockResolvedValue(RESP), definirManual: vi.fn(), limparManual: vi.fn(), previsao: vi.fn().mockResolvedValue([]), assinar: vi.fn().mockReturnValue(() => undefined) };
  (globalThis as unknown as { ade: unknown }).ade = { limites, ...extra };
  await act(async () => { await storeLimites.iniciar(); await storeLimites.atualizar(); });
  await act(async () => { render(<CotaGeralTopo />); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Cota geral/ })); });
  return { limites, dlg: screen.getByRole("dialog", { name: "Cotas e limites" }) };
}

describe("popover: provedor → conta → modelo", () => {
  it("ordena os provedores, mostra logo e nome, janelas com reinício e separação por modelo em ordem de uso", async () => {
    const { dlg } = await abrir();
    const regioes = within(dlg).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regioes).toEqual(["Claude", "Codex", "Grok", "OpenRouter"]);
    const claude = within(dlg).getByRole("region", { name: "Claude" });
    expect(claude.querySelector("svg.logo-provedor[data-provedor='claude']")).not.toBeNull();
    expect(within(claude).getByText("Pessoal")).toBeTruthy();
    expect(within(claude).getByText(/medido · statusline do Claude/)).toBeTruthy();
    expect(within(claude).getByRole("meter", { name: /Claude, conta Pessoal, janela de 5 horas, 62 por cento, reinicia em 1 h/ })).toBeTruthy();
    expect(within(claude).getByText(/reinicia em 1 h \d+ min · \d{2}:\d{2}/)).toBeTruthy();
    const modelos = within(claude).getAllByRole("meter", { name: /modelo/ }).map((m) => m.getAttribute("aria-label"));
    expect(modelos[0]).toMatch(/modelo Opus 4\.1, 100 por cento/);
    expect(modelos[1]).toMatch(/modelo Sonnet, 30 por cento/);
    expect(modelos[2]).toMatch(/modelo Haiku, sem dado/);
    expect(claude.textContent).toMatch(/Opus 4\.1.*100%.*esgotado/);
  });
  it("destaque ≥ 85% com sinal ▲ e esgotado com !, além da cor", async () => {
    const { dlg } = await abrir();
    const semanal = within(dlg).getByRole("meter", { name: /Pessoal, janela semanal, 90 por cento/ });
    expect(semanal.getAttribute("data-tom")).toBe("aviso");
    expect(semanal.closest(".uso-janela")?.textContent).toContain("▲");
    const esgotado = within(dlg).getByRole("meter", { name: /modelo Opus 4\.1/ });
    expect(esgotado.getAttribute("data-tom")).toBe("alerta");
    expect(esgotado.closest(".uso-modelo")?.textContent).toContain("!");
  });
  it("conta sem dado diz 'sem dado' (nunca 0) com Atualizar e Informar manualmente; Codex sem balde diz 'sem dado por modelo'", async () => {
    const { dlg } = await abrir();
    const grok = within(dlg).getByRole("region", { name: "Grok" });
    expect(grok.textContent).toContain("sem dado");
    expect(grok.textContent).not.toMatch(/\b0%/);
    expect(within(grok).getByRole("button", { name: "Atualizar Grok sem leitura" })).toBeTruthy();
    expect(within(grok).getByRole("button", { name: "Informar manualmente" })).toBeTruthy();
    expect(within(within(dlg).getByRole("region", { name: "Codex" })).getByText("sem dado por modelo")).toBeTruthy();
  });
  it("crédito mostra saldo; resumo geral no topo com pior caso e folga; Abrir Consumo e Atualizar presentes", async () => {
    const { dlg } = await abrir();
    expect(within(within(dlg).getByRole("region", { name: "OpenRouter" })).getByText(/7,10.*restantes/)).toBeTruthy();
    expect(dlg.querySelector(".uso-resumo")?.textContent).toMatch(/Pior caso.*Claude · Pessoal.*90%.*folga média 45%/);
    expect(within(dlg).getByRole("button", { name: "Abrir Consumo" })).toBeTruthy();
    expect(within(dlg).getAllByRole("button", { name: "Atualizar" }).length).toBeGreaterThan(0);
  });
  it("modelos com custo (sem balde) vêm do relatório por modelo da conta, sem barra inventada", async () => {
    const relatorio = vi.fn(async (p: { agrupar: string; filtros?: { conta_id?: string } }) => p.agrupar === "modelo"
      ? { linhas: p.filtros?.conta_id === "d" ? [{ chave: "anthropic/claude-sonnet-4.5", rotulo: "x", custo: { usd: 1.5, incompleto: false, aproximado: false, tokens: { entrada: 0, cache_escrita: 0, cache_leitura: 0, saida: 0 }, registros: 1, modelos: [], fontes_ausentes: [], atualizado_em: null } }] : [], total: null, proximo: null }
      : { linhas: [], total: null, proximo: null });
    await abrir({ custo: { relatorio } });
    const dlg = screen.getByRole("dialog", { name: "Cotas e limites" });
    const or = await within(dlg).findByText("Sonnet 4.5");
    expect(or.closest(".uso-modelo")?.querySelector("[role=meter]")).toBeNull();
    expect(or.closest(".uso-modelo")?.textContent).toMatch(/1,50/);
    expect(relatorio).toHaveBeenCalledWith(expect.objectContaining({ agrupar: "modelo", filtros: { conta_id: "d" } }));
  });
  it("Esc fecha e o popover só existe no DOM quando aberto", async () => {
    const { dlg } = await abrir();
    await act(async () => { fireEvent.keyDown(dlg, { key: "Escape" }); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".uso-provedor")).toBeNull();
  });
});

describe("BarraJanela", () => {
  it("meter com rótulo falado; vencida e estimada marcadas", () => {
    render(<BarraJanela janela={{ kind: "five_hour", used_pct: 45, resets_at: null }} provedor="Claude" conta="X" estimado />);
    expect(screen.getByRole("meter").getAttribute("aria-label")).toBe("Claude, conta X, janela de 5 horas, 45 por cento");
    expect(document.body.textContent).toContain("≈45%");
    expect(document.body.textContent).toContain("reinício não informado");
  });
});

describe("logos", () => {
  it("todos os glifos existem, são monocromáticos (sem cor literal) e pesam pouco", () => {
    const ids = Object.keys(GLIFOS) as LogoId[];
    expect(ids.sort()).toEqual(["aider", "claude", "gemini", "kilo", "openai", "opencode", "openrouter", "qwen", "xai"]);
    const fonte = readFileSync(join(__dirname, "glifos.ts"), "utf8");
    expect(fonte).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl)a?\(|fill="/);
    expect(gzipSync(fonte).length).toBeLessThan(30 * 1024);
    const { container } = render(<LogoProvedor provedor="claude" />);
    expect(container.querySelector("svg")?.getAttribute("fill")).toBe("currentColor");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
  it("não há arquivo de logo com cor literal em src/renderer/assets/provedores (se existir)", () => {
    const dir = join(__dirname, "../../assets/provedores");
    let arquivos: string[] = [];
    try { arquivos = readdirSync(dir); } catch { /* sem diretório: logos inline */ }
    for (const a of arquivos) expect(readFileSync(join(dir, a), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
