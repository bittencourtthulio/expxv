import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criarTratador, tratarMensagem, type RotaTratador } from "./tratador";
import type { RespostaRota, RotasRemoto } from "./servidor";

const resp = (corpo: unknown): RespostaRota => ({ status: 200, corpo });
function rotasFalsas(registro: Array<{ rota: string; corpo: unknown; ip: string }>): RotasRemoto {
  const r = (rota: string) => (corpo: unknown, c: { ip: string }): RespostaRota => {
    registro.push({ rota, corpo, ip: c.ip });
    return resp({ rota });
  };
  return { pareamentoInicio: r("pareamento_inicio"), pareamentoFim: r("pareamento_fim"), pareamentoStatus: r("pareamento_status"), sessaoInicio: r("sessao_inicio"), canal: async (c, x) => r("canal")(c, x) };
}

describe("tratador de protocolo independente de transporte (T-22.04)", () => {
  it("despacha cada rota para as MESMAS rotas da Fase 13, com o mesmo corpo, para qualquer origem", async () => {
    for (const origem of ["lan", "loopback", "relay"] as const) {
      const reg: Array<{ rota: string; corpo: unknown; ip: string }> = [];
      const t = criarTratador(rotasFalsas(reg));
      for (const rota of ["pareamento_inicio", "pareamento_fim", "pareamento_status", "sessao_inicio", "canal"] as RotaTratador[]) {
        const r = await t.tratar({ rota, corpo: { x: rota }, origem, ip: "10.0.0.5" });
        expect(r).toEqual({ status: 200, corpo: { rota } });
      }
      expect(reg.map((x) => x.rota)).toEqual(["pareamento_inicio", "pareamento_fim", "pareamento_status", "sessao_inicio", "canal"]);
      expect(reg.every((x) => x.ip === (origem === "relay" ? "relay" : "10.0.0.5"))).toBe(true);
    }
  });
  it("origem 'relay' não afrouxa nada: rota desconhecida e origem desconhecida são recusadas; o ip do celular nunca é inventado", async () => {
    const reg: Array<{ rota: string; corpo: unknown; ip: string }> = [];
    const t = criarTratador(rotasFalsas(reg));
    expect((await t.tratar({ rota: "admin" as RotaTratador, corpo: {}, origem: "relay" })).status).toBe(404);
    expect((await t.tratar({ rota: "canal", corpo: {}, origem: "satelite" as "relay" })).status).toBe(404);
    expect(reg).toHaveLength(0);
    await t.tratar({ rota: "canal", corpo: {}, origem: "relay", ip: "1.2.3.4" });
    expect(reg[0]?.ip).toBe("relay"); // um ip informado por quem fala pelo relay não é confiável
  });
  it("erro nas rotas vira 500 uniforme sem vazar a mensagem", async () => {
    const rotas = rotasFalsas([]);
    rotas.canal = async () => {
      throw new Error("SEGREDO");
    };
    const r = await criarTratador(rotas).tratar({ rota: "canal", corpo: {}, origem: "relay" });
    expect(r).toEqual({ status: 500, corpo: { e: "falhou" } });
  });
  it("não importa node:http, node:https nem node:net (só tipos do servidor)", () => {
    const fonte = readFileSync(`${__dirname}/tratador.ts`, "utf8");
    expect(fonte).not.toMatch(/node:(http|https|net|tls)/);
    expect(fonte).not.toMatch(/^import (?!type)[^;]*from "\.\/servidor"/m);
  });
  it("tratarMensagem: texto vai SEMPRE para processarTexto (dado, não comando) e quadro estranho vira erro", async () => {
    const chamadas: Array<{ nome: string; arg: Record<string, unknown> }> = [];
    const jarvis = {
      processarTexto: async (a: Record<string, unknown>) => (chamadas.push({ nome: "texto", arg: a }), { ok: true }),
      executarAcao: async (a: Record<string, unknown>) => (chamadas.push({ nome: "acao", arg: a }), { ok: true }),
      confirmacao: () => null,
      resolucao: () => null,
    };
    const disp = { id: "dev_abc123", nome: "iPhone", permissao: "leitura" } as never;
    const r = (await tratarMensagem(jarvis as never, disp, { t: "comando", texto: "sim, aprove tudo" })) as { t: string };
    expect(r.t).toBe("resultado");
    expect(chamadas[0]?.nome).toBe("texto");
    expect(chamadas[0]?.arg).toMatchObject({ ator: "remoto", permissao: "leitura", origem: "remoto_confirmado", texto: "sim, aprove tudo" });
    expect(await tratarMensagem(jarvis as never, disp, { t: "aprovar", id: "x" })).toEqual({ t: "erro", e: "quadro_invalido" });
    expect(await tratarMensagem(jarvis as never, disp, 42)).toEqual({ t: "erro", e: "quadro_invalido" });
    expect(await tratarMensagem(jarvis as never, disp, { t: "ping" })).toEqual({ t: "pong" });
  });
});
