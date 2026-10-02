// Casos fixos achados pelo fuzz da Fase 22 (T-22.24): cada crash vira regressão permanente.
import { describe, expect, it } from "vitest";
import { codificar, decodificar } from "../../src/nucleo/remoto-estendido/quadro";
import { criarTransporteRelay } from "../../src/nucleo/remoto-estendido/transporte-relay";
import { carregar, type Verificar } from "../pwa/carregar";
import { generateKeyPairSync, sign } from "node:crypto";

describe("regressões do fuzz", () => {
  it("R-FUZZ-01: quadro AUTÊNTICO cujo JSON é `null` (ou escalar/lista) não derruba o transporte: responde 400 quadro_invalido (antes: TypeError em `o.id`, rejeição não tratada no cliente do relay)", async () => {
    const chave = Buffer.alloc(32, 3);
    let chamadas = 0;
    const tr = criarTransporteRelay({ tratador: { tratar: async () => (chamadas++, { status: 200, corpo: {} }) }, chave });
    for (const m of [null, 0, 1.5, "x", true, [], [1, 2], {}]) {
      const r = await tr.receber(codificar(chave, m, "c2h"));
      expect(r.k).toBe("resposta");
      if (r.k === "resposta") expect(decodificar(chave, r.quadro, "h2c")).toMatchObject({ tipo: "dado", mensagem: { status: 400, corpo: { e: "quadro_invalido" } } });
    }
    expect(chamadas).toBe(0);
    expect(tr.emVoo()).toBe(0);
  });
  it("R-FUZZ-02 (F-6): assinatura do manifesto em base64 NÃO canônico (bits de preenchimento alterados) é recusada; a canônica passa", async () => {
    const v = await carregar<Verificar>("pwa/verificar.js");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const bruta = (publicKey.export({ type: "spki", format: "der" }) as Buffer).subarray(-32).toString("base64");
    const dados = new TextEncoder().encode('{"versao":1,"arquivos":{}}');
    const sig = sign(null, Buffer.from(dados), privateKey);
    const canonica = sig.toString("base64");
    expect(await v.assinaturaValida(dados, canonica, [bruta])).toBe(true);
    // 64 bytes = 88 chars com `==`: o penúltimo símbolo carrega 4 bits de preenchimento; trocar esses bits mantém os mesmos bytes decodificados
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const penultimo = canonica[canonica.length - 3] as string;
    const outro = alfabeto[(alfabeto.indexOf(penultimo) & ~15) | ((alfabeto.indexOf(penultimo) + 1) & 15)] as string;
    const naoCanonica = `${canonica.slice(0, -3)}${outro}==`;
    expect(Buffer.from(naoCanonica, "base64").equals(sig)).toBe(true); // mesmos bytes...
    expect(naoCanonica).not.toBe(canonica); // ...grafia diferente
    expect(await v.assinaturaValida(dados, naoCanonica, [bruta])).toBe(false);
  });
});
