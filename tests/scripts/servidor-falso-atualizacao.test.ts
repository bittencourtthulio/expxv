// T-21.19: o servidor de atualização falso só abre porta em 127.0.0.1, encerra no finally e serve cenários; chaves de teste são recusadas pelo build release.
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHAVES_PUBLICAS_DE_TESTE, validarDistribuicao } from "../../scripts/lib/distribuicao.mjs";
import { CENARIOS, subirFeedFalso } from "../fixtures/atualizacao/servidor-falso";
import { CHAVES_ACEITAS_DE_TESTE } from "../fixtures/atualizacao/chaves-de-teste";

const RAIZ = resolve(__dirname, "..", "..");

describe("servidor de atualização falso (T-21.19)", () => {
  it("escuta SÓ em 127.0.0.1 (nunca em curinga) e encerra de verdade: a porta fica livre depois de fechar", async () => {
    const feed = await subirFeedFalso();
    expect(feed.host).toBe("127.0.0.1");
    const porta = feed.porta;
    const r = await fetch(`http://127.0.0.1:${porta}/stable/manifesto.json`);
    expect(r.status).toBe(200);
    await feed.fechar();
    // a porta foi liberada: dá para abrir de novo
    await new Promise<void>((ok, ruim) => {
      const s = createServer();
      s.once("error", ruim);
      s.listen(porta, "127.0.0.1", () => s.close(() => ok()));
    });
    const fonte = readFileSync(join(RAIZ, "tests", "fixtures", "rede", "servidor-falso.ts"), "utf8");
    expect(fonte).toMatch(/listen\(0, "127\.0\.0\.1"/);
    expect(fonte).not.toMatch(/0\.0\.0\.0|"::"/);
  });

  it("todos os cenários sobem e respondem algo coerente, e as rotas de artefato existem", async () => {
    for (const c of CENARIOS) {
      const feed = await subirFeedFalso({ cenario: c });
      try {
        expect(feed.manifesto.artefatos.length).toBeGreaterThan(0);
        if (c !== "infinito" && c !== "lento" && c !== "cabecalho_enorme" && c !== "redirecionamento" && c !== "laco_3xx") {
          const caminho = c === "canal_cruzado" ? "/stable/manifesto.json" : `/${feed.manifesto.canal}/manifesto.json`;
          const r = await fetch(`http://127.0.0.1:${feed.porta}${caminho}`);
          expect([200, 304]).toContain(r.status);
        }
      } finally {
        await feed.fechar();
      }
    }
  });

  it("as chaves de teste são rejeitadas pelo build release (e só pelo release)", () => {
    const o = JSON.parse(readFileSync(join(RAIZ, "build", "distribuicao.json"), "utf8"));
    o.atualizacao.chaves_aceitas = [...CHAVES_ACEITAS_DE_TESTE];
    expect([...CHAVES_PUBLICAS_DE_TESTE]).toEqual(CHAVES_ACEITAS_DE_TESTE);
    expect(validarDistribuicao(o, { perfil: "release" }).ok).toBe(false);
    expect(validarDistribuicao(o, { perfil: "local" }).ok).toBe(true);
  });
});
