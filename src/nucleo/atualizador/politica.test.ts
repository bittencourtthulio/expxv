import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { avaliarManifesto, type EntradaAvaliacao } from "./politica";
import { assinado, AGORA, manifestoBase } from "../../../tests/fixtures/atualizacao/manifestos";
import { assinarComo, CHAVES_ACEITAS_DE_TESTE, publicaDeTeste } from "../../../tests/fixtures/atualizacao/chaves-de-teste";
import type { ManifestoAtualizacao } from "../../compartilhado/atualizacao";

const ID = "5f0c1a2e-0000-4000-8000-000000000001";
function entrada(m: ManifestoAtualizacao | Record<string, unknown>, sobre: Partial<EntradaAvaliacao> = {}, chave: "atual" | "proxima" | "intrusa" = "atual"): EntradaAvaliacao {
  const a = assinado(m, chave);
  return {
    bytes: a.bytes,
    assinatura: a.assinatura,
    chavesAceitas: CHAVES_ACEITAS_DE_TESTE,
    versaoAtual: "1.0.0",
    canal: "stable",
    betaConsentido: false,
    idInstalacao: ID,
    agora: AGORA,
    ultimoPublicadoEm: null,
    plataforma: "darwin",
    arquitetura: "arm64",
    ...sobre,
  };
}
const motivo = (e: EntradaAvaliacao): string => {
  const r = avaliarManifesto(e);
  return r.ok ? `ok:${r.tipo}` : r.motivo;
};

describe("política de atualização (T-21.13)", () => {
  it("manifesto assinado, mais novo, do canal certo e dentro do rollout vira `disponivel` com o artefato universal do macOS", () => {
    const r = avaliarManifesto(entrada(manifestoBase()));
    expect(r.ok && r.tipo === "disponivel" && r.artefato.arquitetura === "universal").toBe(true);
    const w = avaliarManifesto(entrada(manifestoBase(), { plataforma: "win32", arquitetura: "x64" }));
    expect(w.ok && w.tipo === "disponivel" && w.artefato.plataforma === "win32").toBe(true);
  });

  it("au01_manifesto_adulterado: qualquer byte alterado, assinatura ausente/de outra chave ⇒ nunca disponível", () => {
    const a = assinado(manifestoBase());
    const ok = entrada(manifestoBase());
    const alterado = Buffer.from(a.bytes);
    alterado[alterado.indexOf("1.1.0")] = "9".charCodeAt(0);
    expect(motivo({ ...ok, bytes: alterado })).toBe("assinatura_invalida");
    expect(motivo({ ...ok, assinatura: null })).toBe("assinatura_ausente");
    expect(motivo({ ...ok, assinatura: "" })).toBe("assinatura_ausente");
    expect(motivo(entrada(manifestoBase(), {}, "intrusa"))).toBe("assinatura_invalida");
    expect(motivo({ ...ok, chavesAceitas: [] })).toBe("assinatura_invalida");
  });

  it("propriedade: nenhuma mutação dos bytes ou da assinatura chega a `disponivel` (300 mutações determinísticas)", () => {
    const base = entrada(manifestoBase());
    let estado = 12345;
    const rnd = (n: number) => {
      estado = (Math.imul(estado, 1103515245) + 12345) & 0x7fffffff;
      return estado % n;
    };
    for (let i = 0; i < 300; i++) {
      const bytes = Buffer.from(base.bytes);
      let assinatura = String(base.assinatura);
      if (i % 3 === 0) bytes[rnd(bytes.length)] = (bytes[rnd(bytes.length)] as number) ^ (1 << rnd(8));
      else if (i % 3 === 1) {
        const raw = Buffer.from(assinatura, "base64");
        raw[rnd(raw.length)] = (raw[rnd(raw.length)] as number) ^ (1 << rnd(8));
        assinatura = raw.toString("base64");
      } else assinatura = assinatura.slice(0, rnd(assinatura.length));
      // cortar só o preenchimento "=" do base64 não muda os 64 bytes da assinatura: não é mutação
      const mudou = Buffer.compare(bytes, base.bytes) !== 0 || Buffer.compare(Buffer.from(assinatura, "base64"), Buffer.from(String(base.assinatura), "base64")) !== 0;
      if (!mudou) continue;
      const r = avaliarManifesto({ ...base, bytes, assinatura });
      expect(r.ok, `mutação ${i}`).toBe(false);
    }
  });

  it("au02_downgrade_recusado: versão menor que a atual; igual vira `atual`; manifesto antigo (replay) é recusado", () => {
    expect(motivo(entrada(manifestoBase({ versao: "0.9.0" })))).toBe("downgrade");
    expect(motivo(entrada(manifestoBase({ versao: "1.0.0" })))).toBe("ok:atual");
    expect(motivo(entrada(manifestoBase({ versao: "1.2.0-beta.1", canal: "beta" }), { canal: "beta", betaConsentido: true, versaoAtual: "1.2.0" }))).toBe("downgrade");
    expect(motivo(entrada(manifestoBase(), { ultimoPublicadoEm: "2026-09-30T13:00:00.000Z" }))).toBe("manifesto_antigo");
    expect(motivo(entrada(manifestoBase(), { ultimoPublicadoEm: "2026-09-30T12:00:00.000Z" }))).toBe("ok:disponivel");
  });

  it("au05_manifesto_expirado: valido_ate no passado recusa; publicado no futuro além da tolerância também", () => {
    expect(motivo(entrada(manifestoBase(), { agora: new Date("2026-11-15T00:00:00Z") }))).toBe("expirado");
    expect(motivo(entrada(manifestoBase(), { agora: new Date("2026-10-30T12:00:00.000Z") }))).toBe("ok:disponivel");
    expect(motivo(entrada(manifestoBase(), { agora: new Date("2026-09-01T00:00:00Z") }))).toBe("manifesto_invalido");
  });

  it("au06_canal_cruzado: canal do manifesto diferente do escolhido; beta sem consentimento", () => {
    expect(motivo(entrada(manifestoBase({ versao: "1.1.0-beta.1", canal: "beta" })))).toBe("canal_cruzado");
    expect(motivo(entrada(manifestoBase(), { canal: "beta", betaConsentido: true }))).toBe("canal_cruzado");
    expect(motivo(entrada(manifestoBase({ versao: "1.1.0-beta.1", canal: "beta" }), { canal: "beta", betaConsentido: false }))).toBe("canal_nao_permitido");
    expect(motivo(entrada(manifestoBase({ versao: "1.1.0-beta.1", canal: "beta" }), { canal: "beta", betaConsentido: true }))).toBe("ok:disponivel");
  });

  it("au07_rotacao_de_chave: assinada pela chave próxima passa; revogada localmente ou pelo próprio manifesto não", () => {
    expect(motivo(entrada(manifestoBase(), {}, "proxima"))).toBe("ok:disponivel");
    expect(motivo(entrada(manifestoBase(), { revogadasLocais: [publicaDeTeste("atual")] }))).toBe("chave_revogada");
    const revogaASiMesma = manifestoBase({ chaves_revogadas: [publicaDeTeste("atual")] });
    expect(motivo(entrada(revogaASiMesma))).toBe("chave_revogada");
    const r = avaliarManifesto(entrada(manifestoBase({ chaves_revogadas: [publicaDeTeste("atual")] }), {}, "proxima"));
    expect(r.ok && r.novasRevogadas).toEqual([publicaDeTeste("atual")]);
  });

  it("au16_rollout_estavel: staging 0 nunca, 100 sempre; versão_minima obriga mesmo fora do grupo", () => {
    expect(motivo(entrada(manifestoBase({ staging: 0 })))).toBe("ok:atual");
    const r = avaliarManifesto(entrada(manifestoBase({ staging: 0 })));
    expect(r.ok && r.tipo === "atual" && r.motivo).toBe("fora_do_rollout");
    expect(motivo(entrada(manifestoBase({ staging: 100 })))).toBe("ok:disponivel");
    const obrig = avaliarManifesto(entrada(manifestoBase({ staging: 0, versao_minima: "1.1.0" })));
    expect(obrig.ok && obrig.tipo === "disponivel" && obrig.obrigatoria).toBe(true);
    expect(motivo(entrada(manifestoBase({ staging: 0, versao_minima: "1.0.0" })))).toBe("ok:atual");
  });

  it("sem artefato da plataforma, ou universal fora do macOS: recusado", () => {
    expect(motivo(entrada(manifestoBase(), { plataforma: "win32", arquitetura: "arm64" }))).toBe("sem_artefato");
    const soUniversal = manifestoBase();
    soUniversal.artefatos = [soUniversal.artefatos[0]!];
    expect(motivo(entrada(soUniversal, { plataforma: "win32", arquitetura: "x64" }))).toBe("sem_artefato");
  });

  it("manifesto marcado `nao_assinado`, mesmo com assinatura válida, é recusado; JSON malformado assinado também", () => {
    expect(motivo(entrada(manifestoBase({ nao_assinado: true })))).toBe("assinatura_ausente");
    const lixo = Buffer.from("isto nao e json");
    expect(motivo({ ...entrada(manifestoBase()), bytes: lixo, assinatura: assinarComo("atual", lixo) })).toBe("manifesto_invalido");
    expect(motivo(entrada({ ...manifestoBase(), extra: 1 }))).toBe("manifesto_invalido");
  });

  it("decidir leva ≤ 1 ms (média de 200 avaliações, incluindo a verificação Ed25519)", () => {
    const e = entrada(manifestoBase());
    avaliarManifesto(e);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) avaliarManifesto(e);
    expect((performance.now() - t0) / 200).toBeLessThan(1);
  });

  it("o núcleo puro não importa electron, fs, net, http, https nem child_process", () => {
    const pasta = __dirname;
    const arquivos = readdirSync(pasta).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts") && !n.endsWith(".d.ts"));
    expect(arquivos.length).toBeGreaterThanOrEqual(8);
    for (const n of arquivos) {
      const t = readFileSync(join(pasta, n), "utf8");
      expect(t, n).not.toMatch(/from "(electron|node:fs|fs|node:net|net|node:https?|https?|node:child_process|node:tls)"|require\("(electron|fs)"\)|\bfetch\s*\(/);
    }
  });
});
