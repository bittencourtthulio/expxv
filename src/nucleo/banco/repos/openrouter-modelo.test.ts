import { afterEach, describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { abrirBanco, migrar, type Banco } from "../index";
import { criarRepositorios } from "./index";
import { NaoEncontradoErro, ValorInvalidoErro } from "../../dominio";

const abertos: Banco[] = [];
function novo() {
  const b = abrirBanco(":memory:");
  abertos.push(b);
  migrar(b);
  const r = criarRepositorios(b);
  const ws = r.workspace.criar({ nome: "w", raiz: "/w" });
  const conta = r.conta.criar({ provedor: "claude", rotulo: "c1" });
  return { b, r, ws, conta };
}
afterEach(() => abertos.splice(0).forEach((b) => b.fechar()));
const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

import type { ModeloDaApi } from "./openrouter-modelo";

const m = (id: string, extra: Partial<ModeloDaApi> = {}): ModeloDaApi => ({ id, nome: id.toUpperCase(), contexto: 128000, suporta_tools: true, modalidades: ["text"], preco_entrada_por_mtok: 3, preco_saida_por_mtok: 15, ...extra });
const T0 = "2026-01-01T00:00:00.000Z";

describe("repo openrouter-modelo", () => {
  it("sincroniza: conta novos, atualiza só os campos da API, preserva a classificação do dono e remove os sumidos", () => {
    const { r } = novo();
    expect(r.openrouterModelo.sincronizar([m("anthropic/a"), m("meta/b"), m("meta/b"), m("x/c")], T0)).toEqual({ total: 3, novos: 3, removidos: 0 });
    r.openrouterModelo.gravarClassificacao({ id: "anthropic/a", habilitado: true, faixa: "topo", tipos_permitidos: ["auditar"], ordem: 1 });
    const s = r.openrouterModelo.sincronizar([m("anthropic/a", { preco_entrada_por_mtok: 4 }), m("novo/d")], "2026-01-02T00:00:00.000Z");
    expect(s).toEqual({ total: 2, novos: 1, removidos: 2 });
    expect(r.openrouterModelo.obter("anthropic/a")).toMatchObject({ habilitado: true, faixa: "topo", ordem: 1, tipos_permitidos: ["auditar"], preco_entrada_por_mtok: 4 });
    expect(r.openrouterModelo.obter("meta/b")).toBeUndefined();
    expect(r.openrouterModelo.contagem()).toEqual({ total: 2, habilitados: 1, atualizados_em: "2026-01-02T00:00:00.000Z" });
  });

  it("preço ausente/inválido fica null (nunca 0); contexto inválido vira null", () => {
    const { r } = novo();
    r.openrouterModelo.sincronizar([m("a/sem", { preco_entrada_por_mtok: null, preco_saida_por_mtok: Number.NaN, contexto: -5, suporta_tools: null, modalidades: null }), m("a/gratis", { preco_entrada_por_mtok: 0, preco_saida_por_mtok: 0 })], T0);
    expect(r.openrouterModelo.obter("a/sem")).toMatchObject({ preco_entrada_por_mtok: null, preco_saida_por_mtok: null, contexto: null, suporta_tools: null });
    expect(r.openrouterModelo.obter("a/gratis")).toMatchObject({ preco_entrada_por_mtok: 0, preco_saida_por_mtok: 0 }); // 0 só quando a API diz 0
  });

  it("classificação: faixa conhecida, ordem inteira, modelo existente; habilitados ordenados por faixa/ordem", () => {
    const { r } = novo();
    r.openrouterModelo.sincronizar([m("a/x"), m("a/y"), m("a/z")], T0);
    expect(() => r.openrouterModelo.gravarClassificacao({ id: "a/x", habilitado: true, faixa: "ultra" as never, tipos_permitidos: [], ordem: 1 })).toThrow(ValorInvalidoErro);
    expect(() => r.openrouterModelo.gravarClassificacao({ id: "a/x", habilitado: true, faixa: null, tipos_permitidos: [], ordem: 1.5 })).toThrow(ValorInvalidoErro);
    expect(() => r.openrouterModelo.gravarClassificacao({ id: "nao/existe", habilitado: true, faixa: null, tipos_permitidos: [], ordem: 1 })).toThrow(NaoEncontradoErro);
    r.openrouterModelo.gravarClassificacao({ id: "a/x", habilitado: true, faixa: "medio", tipos_permitidos: [], ordem: 5 });
    r.openrouterModelo.gravarClassificacao({ id: "a/y", habilitado: true, faixa: "alto", tipos_permitidos: [], ordem: 9 });
    r.openrouterModelo.gravarClassificacao({ id: "a/z", habilitado: true, faixa: "alto", tipos_permitidos: [], ordem: 2 });
    expect(r.openrouterModelo.habilitados().map((x) => x.id)).toEqual(["a/z", "a/y", "a/x"]); // alto(2), alto(9), medio
  });

  it("listar: busca sem caixa em id/nome, só habilitados, cursor e total; 400 modelos abrem rápido (P-111)", () => {
    const { r } = novo();
    r.openrouterModelo.sincronizar(Array.from({ length: 400 }, (_, i) => m(`vendor${i % 8}/modelo-${String(i).padStart(3, "0")}`, { nome: i % 2 ? "Claude X" : "Outro" })), T0);
    r.openrouterModelo.gravarClassificacao({ id: "vendor0/modelo-000", habilitado: true, faixa: "topo", tipos_permitidos: [], ordem: 1 });
    const p1 = r.openrouterModelo.listar({ limite: 100 });
    expect(p1.itens).toHaveLength(100);
    expect(p1.total).toBe(400);
    expect(r.openrouterModelo.listar({ limite: 100, cursor: p1.proximo! }).itens[0]!.id > p1.itens[99]!.id).toBe(true);
    expect(r.openrouterModelo.listar({ busca: "CLAUDE" }).total).toBe(200);
    expect(r.openrouterModelo.listar({ busca: "vendor3/" }).total).toBe(50);
    expect(r.openrouterModelo.listar({ so_habilitados: true }).itens.map((x) => x.id)).toEqual(["vendor0/modelo-000"]);
    expect(r.openrouterModelo.listar({ busca: "nada-disso" })).toEqual({ itens: [], proximo: null, total: 0 });
    const tempos: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      r.openrouterModelo.listar({ busca: "claude", limite: 100 });
      tempos.push(performance.now() - t0);
    }
    expect(mediana(tempos)).toBeLessThanOrEqual(5);
  });
});
