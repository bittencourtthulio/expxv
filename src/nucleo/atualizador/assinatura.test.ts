import { describe, expect, it } from "vitest";
import { chavePublicaDeBase64, lerAssinatura, verificarAssinatura } from "./assinatura";
import { assinarComo, CHAVES_ACEITAS_DE_TESTE, publicaDeTeste } from "../../../tests/fixtures/atualizacao/chaves-de-teste";

const dados = Buffer.from('{"esquema":1,"versao":"1.1.0"}');

describe("assinatura Ed25519 destacada (T-21.13)", () => {
  it("válida com a chave atual e com a próxima (rotação)", () => {
    for (const nome of ["atual", "proxima"] as const) {
      const r = verificarAssinatura(dados, assinarComo(nome, dados), CHAVES_ACEITAS_DE_TESTE);
      expect(r).toEqual({ ok: true, chave: publicaDeTeste(nome) });
    }
  });
  it("recusa assinatura de outra chave, de outros bytes e adulterada (1 bit)", () => {
    expect(verificarAssinatura(dados, assinarComo("intrusa", dados), CHAVES_ACEITAS_DE_TESTE)).toEqual({ ok: false, motivo: "assinatura_invalida" });
    expect(verificarAssinatura(Buffer.from("outro"), assinarComo("atual", dados), CHAVES_ACEITAS_DE_TESTE).ok).toBe(false);
    const raw = Buffer.from(assinarComo("atual", dados), "base64");
    raw[10] = (raw[10] as number) ^ 1;
    expect(verificarAssinatura(dados, raw.toString("base64"), CHAVES_ACEITAS_DE_TESTE).ok).toBe(false);
  });
  it("recusa assinatura ausente, vazia, truncada, longa e não-base64", () => {
    expect(verificarAssinatura(dados, null, CHAVES_ACEITAS_DE_TESTE)).toEqual({ ok: false, motivo: "assinatura_ausente" });
    expect(verificarAssinatura(dados, undefined, CHAVES_ACEITAS_DE_TESTE).ok).toBe(false);
    expect(verificarAssinatura(dados, "  \n", CHAVES_ACEITAS_DE_TESTE)).toEqual({ ok: false, motivo: "assinatura_ausente" });
    const boa = assinarComo("atual", dados);
    expect(verificarAssinatura(dados, boa.slice(0, 40), CHAVES_ACEITAS_DE_TESTE)).toEqual({ ok: false, motivo: "assinatura_invalida" });
    expect(verificarAssinatura(dados, boa + boa, CHAVES_ACEITAS_DE_TESTE).ok).toBe(false);
    expect(verificarAssinatura(dados, "%%%%", CHAVES_ACEITAS_DE_TESTE).ok).toBe(false);
  });
  it("aceita quebra de linha final no arquivo .sig", () => {
    expect(verificarAssinatura(dados, `${assinarComo("atual", dados)}\n`, CHAVES_ACEITAS_DE_TESTE).ok).toBe(true);
  });
  it("sem chaves aceitas ou com chave malformada no build ninguém passa", () => {
    expect(verificarAssinatura(dados, assinarComo("atual", dados), []).ok).toBe(false);
    expect(verificarAssinatura(dados, assinarComo("atual", dados), ["lixo"]).ok).toBe(false);
    expect(chavePublicaDeBase64("lixo")).toBeNull();
    expect(chavePublicaDeBase64(publicaDeTeste("atual"))).not.toBeNull();
  });
  it("chave revogada localmente é recusada mesmo estando no build; a outra segue valendo (AU-07)", () => {
    const rev = [publicaDeTeste("atual")];
    expect(verificarAssinatura(dados, assinarComo("atual", dados), CHAVES_ACEITAS_DE_TESTE, rev)).toEqual({ ok: false, motivo: "chave_revogada" });
    expect(verificarAssinatura(dados, assinarComo("proxima", dados), CHAVES_ACEITAS_DE_TESTE, rev).ok).toBe(true);
  });
  it("lerAssinatura exige exatamente 64 bytes", () => {
    expect(lerAssinatura(Buffer.alloc(64).toString("base64"))).not.toBeNull();
    expect(lerAssinatura(Buffer.alloc(63).toString("base64"))).toBeNull();
  });
});
