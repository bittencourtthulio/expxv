import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Preco } from "../compartilhado/custo";
import type { RespostaLimites } from "../compartilhado/limites";
import { abrirBanco } from "../nucleo/banco/banco";
import { migrar } from "../nucleo/banco/migrar";
import { criarBenchMain, estadoDaConta, precoDaFase10, sandboxDaPlataforma } from "./bench";

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "bench-main-")));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

const snap = (usos: Array<number | null>): RespostaLimites => ({ contas: [{ account_id: "cta_1", windows: usos.map((u) => ({ kind: "5h" as const, used_pct: u, resets_at: null })) } as never], geral: { pior: null, folga_media_pct: null, cobertura: { com_dado: 0, total: 0 }, em_alerta: 0, esgotadas: 0 } });
const preco = (o: Partial<Preco> = {}): Preco => ({ id: "p", padrao: "modelo-x*", familia: "fam", entrada_por_mtok: 3, saida_por_mtok: 15, cache_escrita_por_mtok: null, cache_leitura_por_mtok: 0.3, origem: "usuario", confirmado: true, valido_desde: "2026-01-01T00:00:00.000Z", ...o } as Preco);

describe("sandbox por plataforma", () => {
  it("macOS: sandbox-exec para o Claude e o nativo para o Codex; Windows: nenhum; Linux: indisponível", () => {
    const mac = sandboxDaPlataforma("darwin", join(raiz, "p"));
    expect(mac.porCli("claude").modo).toBe("macos");
    expect(mac.porCli("codex").modo).toBe("nativo_cli");
    expect(mac.checagens.modo).toBe("macos");
    expect(sandboxDaPlataforma("win32", "x").porCli("claude").modo).toBe("nenhum");
    expect(sandboxDaPlataforma("linux", "x").porCli("claude").modo).toBe("indisponivel");
    expect(sandboxDaPlataforma("linux", "x").porCli("codex").modo).toBe("indisponivel");
  });
});

describe("portas", () => {
  it("conta sem limite = qualquer janela ≥ 100%; sem dado = desconhecido (segue)", () => {
    expect(estadoDaConta(snap([50, 100]), "cta_1")).toBe("sem_limite");
    expect(estadoDaConta(snap([50, 99.9]), "cta_1")).toBe("ok");
    expect(estadoDaConta(snap([null]), "cta_1")).toBe("desconhecido");
    expect(estadoDaConta(snap([10]), "cta_outra")).toBe("desconhecido");
    expect(estadoDaConta(null, "cta_1")).toBe("desconhecido");
  });
  it("preço da Fase 10 só vale CONFIRMADO; sem preço = null (custo desconhecido, nunca zero)", () => {
    expect(precoDaFase10([preco()], "modelo-x-4", "2026-06-01T00:00:00.000Z")).toMatchObject({ preco_in_mtok: 3, preco_out_mtok: 15, preco_cache_mtok: 0.3 });
    expect(precoDaFase10([preco({ confirmado: false })], "modelo-x-4", "2026-06-01T00:00:00.000Z")).toBeNull();
    expect(precoDaFase10([preco()], "outro-modelo", "2026-06-01T00:00:00.000Z")).toBeNull();
    expect(precoDaFase10(null, "modelo-x-4", "2026-06-01T00:00:00.000Z")).toBeNull();
    expect(precoDaFase10([preco({ valido_desde: "2030-01-01T00:00:00.000Z" })], "modelo-x-4", "2026-06-01T00:00:00.000Z")).toBeNull();
  });
});

describe("criarBenchMain", () => {
  it("monta o serviço sem tocar nada além do banco e da pasta bench; conta de provedor resolve para a pasta da conta + HOME próprio", async () => {
    const banco = abrirBanco(":memory:");
    migrar(banco);
    const conta = { id: "cta_1", provedor: "claude", rotulo: "bench", config_dir_ref: "contas/cta_1", habilitada: true } as never;
    const svc = criarBenchMain({
      banco, userData: raiz, plataforma: "darwin",
      contas: { obter: (id) => (id === "cta_1" ? conta : undefined), configDirAbsoluto: () => join(raiz, "contas", "cta_1") },
      limites: () => null, precosFase10: () => null, provedoresHabilitados: () => new Set(["claude"]), emitir: () => undefined, salvarComo: async () => null,
    });
    expect(svc.tarefasListar(null, "ativa")).toHaveLength(7);
    svc.alvosSalvar([{ provedor: "anthropic", modelo: "m", esforco: null, cli: "claude", conta_id: "cta_1", rotulo: null }, { provedor: "anthropic", modelo: "m2", esforco: null, cli: "claude", conta_id: "cta_inexistente", rotulo: null }]);
    const l = await svc.alvosListar();
    expect(l.find((a) => a.conta_id === "cta_inexistente")!.motivo).toMatch(/conta dedicada não encontrada/);
    await svc.encerrar();
    banco.fechar();
  });
});
