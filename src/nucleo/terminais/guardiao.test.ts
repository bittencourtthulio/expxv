import { describe, expect, it } from "vitest";
import { GuardiaoTransicoes, type SessoesGuardadas } from "./guardiao";

function sessaoFake(): SessoesGuardadas & { bloqueada: boolean; encerrada: boolean } {
  return {
    tem_sessoes_ativas: true,
    bloqueada: false,
    encerrada: false,
    bloquearAdmissao() { this.bloqueada = true; },
    liberarAdmissao() { this.bloqueada = false; },
    async encerrarTodasEAguardar() { this.encerrada = true; this.tem_sessoes_ativas = false; },
  };
}

describe("guardião de transições", () => {
  it("serializa duas trocas, bloqueia admissão e respeita cancelamento", async () => {
    const guardiao = new GuardiaoTransicoes();
    const sessoes = sessaoFake();
    const ordem: string[] = [];
    let resolver!: (valor: boolean) => void;
    const primeiraConfirmacao = new Promise<boolean>((r) => { resolver = r; });
    const primeira = guardiao.transicionar({ sessoes: () => sessoes, confirmar: () => primeiraConfirmacao, executar: async () => { ordem.push("primeira"); } });
    const segunda = guardiao.transicionar({ sessoes: () => sessoes, confirmar: async () => true, executar: async () => { ordem.push("segunda"); } });
    await new Promise<void>((r) => setImmediate(r));
    expect(sessoes.bloqueada).toBe(true);
    resolver(false);
    expect(await primeira).toBe(false);
    expect(await segunda).toBe(true);
    expect(ordem).toEqual(["segunda"]);
    expect(sessoes.encerrada).toBe(true);
  });

  it("falha de montagem não publica estado e reabre admissão", async () => {
    const guardiao = new GuardiaoTransicoes();
    const sessoes = sessaoFake();
    const publicadas: string[] = [];
    await expect(guardiao.transicionar({
      sessoes: () => sessoes, confirmar: async () => true,
      executar: async () => { throw new Error("montagem falhou"); }, publicar: () => publicadas.push("nova"),
    })).rejects.toThrow("montagem falhou");
    expect(publicadas).toEqual([]);
    expect(sessoes.bloqueada).toBe(false);
  });

  it("sem sessões ativas não pede confirmação e publica", async () => {
    const guardiao = new GuardiaoTransicoes();
    const publicadas: string[] = [];
    const ok = await guardiao.transicionar({ sessoes: () => null, confirmar: async () => { throw new Error("não devia pedir"); }, executar: async () => undefined, publicar: () => publicadas.push("p") });
    expect(ok).toBe(true);
    expect(publicadas).toEqual(["p"]);
  });

  it("uma transição que falhou não trava a fila", async () => {
    const guardiao = new GuardiaoTransicoes();
    await guardiao.transicionar({ sessoes: () => null, confirmar: async () => true, executar: async () => { throw new Error("x"); } }).catch(() => undefined);
    expect(await guardiao.transicionar({ sessoes: () => null, confirmar: async () => true, executar: async () => undefined })).toBe(true);
  });
});
