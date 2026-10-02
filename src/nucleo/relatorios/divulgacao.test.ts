// Fila de divulgação por canais existentes (Telegram/alertas via interface): NADA sai sem pacote aprovado + item aprovado + consentimento do canal.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITES_VARIANTE } from "../../compartilhado/relatorios";
import { portasFalsas, SPRINT_ID, sprintBrutaFalsa, T0, WS } from "../../../tests/fixtures/relatorios/gerar";
import type { PortaCanais } from "./portas";
import { criarRelatorios } from "./servico";

let raiz: string;
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), "rel-div-")); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

function montar(canais?: Partial<PortaCanais>, scrub?: (t: string) => string) {
  const enviar = vi.fn(async (_ws: string, _c: "telegram", _t: string) => ({ ok: true, erro: null as string | null }));
  const portaCanais: PortaCanais = { disponiveis: async () => ["telegram"], enviar, ...canais };
  const bruta = sprintBrutaFalsa();
  bruta.itens[1]!.item.resumo_cliente = "Corrigimos uma falha que atrasava a lista de pedidos.";
  const portas = portasFalsas({ workspace: { raiz: () => raiz }, canais: portaCanais, ...(scrub ? { scrub } : {}) }, bruta);
  return { r: criarRelatorios({ portas, relogio: () => T0 }), enviar };
}
async function pacoteAprovado(r: ReturnType<typeof montar>["r"]) {
  const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
  await r.aprovar(WS, pacote_id, true);
  return pacote_id;
}

describe("divulgação com consentimento", () => {
  it("enfileira como RASCUNHO, cada variante respeitando o limite; nunca envia sozinho", async () => {
    const { r, enviar } = montar();
    const pid = await pacoteAprovado(r);
    for (const v of ["curta", "media", "longa"] as const) {
      const e = await r.divulgacao.enfileirar(WS, pid, "telegram", v);
      expect(e.estado).toBe("rascunho");
      expect(e.texto.length).toBeLessThanOrEqual(LIMITES_VARIANTE[v]);
    }
    expect(r.divulgacao.fila(WS, pid)).toHaveLength(3);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("ordem obrigatória: aprovar o relatório -> aprovar o item -> consentir no canal -> enviar", async () => {
    const { r, enviar } = montar();
    const { pacote_id } = await r.gerar(WS, { tipo: "sprint", sprint_id: SPRINT_ID });
    const e = await r.divulgacao.enfileirar(WS, pacote_id, "telegram", "curta");
    expect(() => r.divulgacao.aprovar(WS, e.id, true)).toThrow(/aprove primeiro o relatório/);
    await expect(r.divulgacao.enviar(WS, e.id)).rejects.toThrow(/aprove o item/);
    await r.aprovar(WS, pacote_id, true);
    r.divulgacao.aprovar(WS, e.id, true);
    await expect(r.divulgacao.enviar(WS, e.id)).rejects.toMatchObject({ code: "consent_required" });
    expect(enviar).not.toHaveBeenCalled();
    await r.divulgacao.consentimento(WS, "telegram", true);
    const enviado = await r.divulgacao.enviar(WS, e.id);
    expect(enviado.estado).toBe("enviado");
    expect(enviado.enviado_em).not.toBeNull();
    expect(enviar).toHaveBeenCalledTimes(1);
    await expect(r.divulgacao.enviar(WS, e.id)).rejects.toThrow(/já foi enviado/);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it("revogar o consentimento volta a bloquear; consentimento de versão antiga de texto não vale", async () => {
    const { r, enviar } = montar();
    const pid = await pacoteAprovado(r);
    const e = await r.divulgacao.enfileirar(WS, pid, "telegram", "media");
    r.divulgacao.aprovar(WS, e.id, true);
    await r.divulgacao.consentimento(WS, "telegram", true);
    await r.divulgacao.consentimento(WS, "telegram", false);
    await expect(r.divulgacao.enviar(WS, e.id)).rejects.toMatchObject({ code: "consent_required" });
    r.repo.configGravar(WS, { ...r.configLer(WS), consentimento_canais: { telegram: { aceito_em: "2020-01-01T00:00:00.000Z", versao_texto: "antiga" } } }, "2026-01-01T00:00:00.000Z");
    await expect(r.divulgacao.enviar(WS, e.id)).rejects.toMatchObject({ code: "consent_required" });
    expect(enviar).not.toHaveBeenCalled();
    expect((await r.divulgacao.estado(WS))[0]).toMatchObject({ canal: "telegram", disponivel: true, consentido: false });
  });

  it("canal indisponível (Fase 20 não ligada) bloqueia o envio e a UI recebe o motivo", async () => {
    const { r, enviar } = montar({ disponiveis: async () => [] });
    const pid = await pacoteAprovado(r);
    const e = await r.divulgacao.enfileirar(WS, pid, "telegram", "curta");
    r.divulgacao.aprovar(WS, e.id, true);
    await r.divulgacao.consentimento(WS, "telegram", true);
    await expect(r.divulgacao.enviar(WS, e.id)).rejects.toThrow(/não está disponível/);
    expect(enviar).not.toHaveBeenCalled();
    expect((await r.divulgacao.estado(WS))[0]?.motivo).toMatch(/não configurado/);
  });

  it("falha do canal vira `falhou` com erro limpo e pode tentar de novo; porta que lança também", async () => {
    let n = 0;
    const { r } = montar({ enviar: async () => { n++; if (n === 1) return { ok: false, erro: "chat_inalcancavel token=abcdef123456" }; if (n === 2) throw new Error("rede"); return { ok: true, erro: null }; } });
    const pid = await pacoteAprovado(r);
    const e = await r.divulgacao.enfileirar(WS, pid, "telegram", "curta");
    r.divulgacao.aprovar(WS, e.id, true);
    await r.divulgacao.consentimento(WS, "telegram", true);
    const f1 = await r.divulgacao.enviar(WS, e.id);
    expect(f1.estado).toBe("falhou");
    expect(f1.erro).not.toMatch(/abcdef123456/);
    expect((await r.divulgacao.enviar(WS, e.id)).estado).toBe("falhou");
    expect((await r.divulgacao.enviar(WS, e.id)).estado).toBe("enviado");
  });

  it("última barreira: segredo do cofre e caminho absoluto escritos no texto do item NUNCA saem", async () => {
    const { r, enviar } = montar(undefined, (t) => t.replace(/COFRE_SEGREDO_123/g, "«cofre:K»"));
    const pid = await pacoteAprovado(r);
    const e = await r.divulgacao.enfileirar(WS, pid, "telegram", "longa");
    r.repo.envioAtualizar(e.id, { estado: "aprovado", texto: `${e.texto}\nCOFRE_SEGREDO_123 /Users/ana/proj/segredo.txt token=abcdef123456` });
    await r.divulgacao.consentimento(WS, "telegram", true);
    await r.divulgacao.enviar(WS, e.id);
    const texto = enviar.mock.calls[0]?.[2] ?? "";
    expect(texto).not.toMatch(/COFRE_SEGREDO_123|\/Users\/ana|abcdef123456/);
  });

  it("cancelar impede o envio; item de outro workspace não é acessível", async () => {
    const { r, enviar } = montar();
    const pid = await pacoteAprovado(r);
    const e = await r.divulgacao.enfileirar(WS, pid, "telegram", "curta");
    expect(() => r.divulgacao.aprovar("ws_outro00000000", e.id, true)).toThrow(/não encontrado/);
    await expect(r.divulgacao.enviar("ws_outro00000000", e.id)).rejects.toThrow(/não encontrado/);
    r.divulgacao.cancelar(WS, e.id);
    await expect(r.divulgacao.enviar(WS, e.id)).rejects.toThrow(/aprove o item/);
    expect(enviar).not.toHaveBeenCalled();
  });

  it("o consentimento da IA e dos canais NÃO entra por configGravar (só pelas ações explícitas)", () => {
    const { r } = montar();
    expect(() => r.configGravar(WS, { consentimento_llm_em: "2026-01-01T00:00:00.000Z" })).toThrow(/campo desconhecido/);
    expect(() => r.configGravar(WS, { consentimento_canais: { telegram: { aceito_em: "x", versao_texto: "y" } } })).toThrow(/campo desconhecido/);
    expect(r.consentimentoLlm(WS, true).consentimento_llm_em).not.toBeNull();
    expect(r.consentimentoLlm(WS, false).consentimento_llm_em).toBeNull();
    expect(() => r.configGravar(WS, { redacao_modo: "nuvem" })).toThrow(/inválido/);
    expect(() => r.configGravar(WS, { hashtags: ["<script>"] })).toThrow(/hashtags/);
  });
});
