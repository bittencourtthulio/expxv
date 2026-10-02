// Suíte de contrato de canal (T-20.16): todo adaptador (falso, SO, toast, Telegram, webhook) passa por ela.
import { describe, expect, it } from "vitest";
import type { CanalComunicacao, MensagemSaida } from "../../../src/nucleo/alertas/canal";

export const mensagemExemplo = (p: Partial<MensagemSaida> = {}): MensagemSaida => ({ entrega_id: "e1", alerta_ids: ["a1"], titulo: "Teste", texto: "[Concluída] T-1 feito", severidade: "sucesso", silenciosa: true, ...p });

export function suiteCanal(nome: string, criar: () => Promise<{ canal: CanalComunicacao; limpar?: () => Promise<void> | void }>): void {
  describe(`contrato de canal: ${nome}`, () => {
    it("declara capacidades coerentes", async () => {
      const { canal, limpar } = await criar();
      try {
        expect(canal.capacidades.limite_visivel).toBeGreaterThan(0);
        expect(canal.capacidades.max_por_min).toBeGreaterThan(0);
        expect(canal.capacidades.min_intervalo_ms).toBeGreaterThanOrEqual(0);
        expect(typeof canal.capacidades.precisa_consentimento).toBe("boolean");
        expect(["desligado", "configurando", "ativo", "erro", "conflito", "pausado"]).toContain(canal.estado());
      } finally {
        await limpar?.();
      }
    });
    it("enviar devolve resultado tipado e nunca lança", async () => {
      const { canal, limpar } = await criar();
      try {
        const r = await canal.enviar(mensagemExemplo(), new AbortController().signal);
        expect(typeof r.ok).toBe("boolean");
        if (!r.ok) expect(typeof r.permanente).toBe("boolean");
      } finally {
        await limpar?.();
      }
    });
    it("testar não devolve segredo e iniciar/parar são idempotentes", async () => {
      const { canal, limpar } = await criar();
      try {
        const t = await canal.testar(new AbortController().signal);
        expect(typeof t.detalhe).toBe("string");
        expect(t.detalhe).not.toMatch(/\d{6,12}:[A-Za-z0-9_-]{30,}/);
        await canal.iniciar?.();
        await canal.iniciar?.();
        await canal.parar?.();
        await canal.parar?.();
      } finally {
        await limpar?.();
      }
    });
  });
}
