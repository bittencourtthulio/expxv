import { afterEach, describe, expect, it } from "vitest";
import { criarCicloLoja } from "./ciclo";
import { criarKit, hashDoKit, EXTRAS_DO_KIT } from "./kit";
import { criarRepoMemoria } from "./repositorio";
import { criarSegredosMcp } from "./segredos";
import { catalogoFalso, cofreDeTeste, executorNpmFalso, limparPastas, novaPasta } from "../../../tests/fixtures/mcp-loja/apoio-ciclo";

afterEach(limparPastas);
const DIAG = { npm: { ok: true, versao: "10.0.0" }, node: { ok: true, versao: "v22.0.0" }, uv: { ok: true, versao: "0.5.0" }, cofre: { disponivel: true } };

function montar(extras?: readonly string[]) {
  const cat = catalogoFalso();
  const repo = criarRepoMemoria();
  const ex = executorNpmFalso(cat);
  const ciclo = criarCicloLoja({
    repo, catalogo: cat, segredos: criarSegredosMcp(cofreDeTeste(novaPasta("cofre-"))), executor: ex, userData: novaPasta(), diagnostico: async () => DIAG,
    instalacao: { binarios: { npm: "/falso/npm", node: process.execPath, uv: "/falso/uv" } }, node: process.execPath,
  });
  const kit = criarKit({ ciclo, repo, catalogo: cat, ...(extras ? { extras } : {}) });
  return { cat, repo, ex, ciclo, kit };
}

describe("Kit de desenvolvimento", () => {
  it("é o Kit do seed (context7, deepwiki, sequential-thinking) + git/filesystem/fetch (P-136), só instaláveis", () => {
    const { kit } = montar();
    expect(kit.idsDoKit().sort()).toEqual(["context7", "deepwiki", "fetch", "filesystem", "git", "sequential-thinking"]);
    expect(EXTRAS_DO_KIT).toEqual(["git", "filesystem", "fetch"]);
    expect(montar([]).kit.idsDoKit().sort()).toEqual(["context7", "deepwiki", "sequential-thinking"]);
    expect(montar(["nao-existe"]).kit.idsDoKit().sort()).toEqual(["context7", "deepwiki", "sequential-thinking"]);
  });

  it("estado e plano não baixam nada; o plano lista todos os pendentes com UM hash de conjunto", async () => {
    const { kit, ex } = montar(["fetch"]);
    expect(kit.estado()).toMatchObject({ opt_out: false, pendentes: expect.arrayContaining(["context7", "deepwiki", "fetch", "sequential-thinking"]) });
    const p = await kit.plano();
    expect(p.planos.map((x) => x.id).sort()).toEqual(["context7", "deepwiki", "fetch", "sequential-thinking"]);
    expect(p.bloqueios).toEqual([]);
    expect(p.comando_hash).toBe(hashDoKit(p.planos));
    expect(ex.chamadas).toHaveLength(0);
  });

  it("instalar exige o consentimento do CONJUNTO exato; sem ele, zero downloads", async () => {
    const { kit, ex, repo } = montar([]);
    const p = await kit.plano();
    for (const c of [{ aceito: false, comando_hash: p.comando_hash }, { aceito: true, comando_hash: "x" }]) {
      const r = await kit.instalar(c);
      expect(r.every((x) => !x.resultado.ok)).toBe(true);
    }
    expect(ex.chamadas).toHaveLength(0);
    expect(repo.listarInstalados()).toEqual([]);
  });

  it("com o consentimento: remotos só registram (sem executor), os locais instalam; origem 'kit'; depois não há mais pendentes", async () => {
    const { kit, ex, repo } = montar([]);
    const p = await kit.plano();
    const r = await kit.instalar({ aceito: true, comando_hash: p.comando_hash });
    expect(r.map((x) => [x.id, x.resultado.ok]).sort()).toEqual([["context7", true], ["deepwiki", true], ["sequential-thinking", true]]);
    expect(ex.chamadas).toHaveLength(2); // context7 e sequential-thinking; deepwiki é remoto
    expect(repo.consentimentosDe("deepwiki")[0]!.origem).toBe("kit");
    expect(kit.estado().pendentes).toEqual([]);
    expect((await kit.plano()).planos).toEqual([]);
  });

  it("se o catálogo muda entre mostrar e aceitar, o hash antigo é recusado", async () => {
    const { kit } = montar([]);
    const p = await kit.plano();
    const instalado = await kit.instalar({ aceito: true, comando_hash: p.comando_hash });
    expect(instalado.every((x) => x.resultado.ok)).toBe(true);
    const outra = await kit.instalar({ aceito: true, comando_hash: p.comando_hash });
    expect(outra).toEqual([]); // nada pendente: nada a fazer
  });

  it("opt-out remove o Kit da allow-list sugerida; só explorador/executor recebem sugestão", () => {
    const { kit } = montar([]);
    expect(kit.allowListSugerida("explorador").sort()).toEqual(["context7", "deepwiki", "sequential-thinking"]);
    expect(kit.allowListSugerida("executor")).toHaveLength(3);
    expect(kit.allowListSugerida("revisor")).toEqual([]);
    kit.definirOptOut(true);
    expect(kit.estado().opt_out).toBe(true);
    expect(kit.allowListSugerida("explorador")).toEqual([]);
    kit.definirOptOut(false);
    expect(kit.allowListSugerida("explorador")).toHaveLength(3);
  });

  it("falta de pré-requisito (sem npm): o item vai para 'bloqueios' com instrução e não derruba os remotos", async () => {
    const cat = catalogoFalso();
    const repo = criarRepoMemoria();
    const ciclo = criarCicloLoja({ repo, catalogo: cat, segredos: criarSegredosMcp(cofreDeTeste(novaPasta("cofre-"))), executor: executorNpmFalso(), userData: novaPasta(), diagnostico: async () => ({ cofre: { disponivel: true } }) });
    const kit = criarKit({ ciclo, repo, catalogo: cat, extras: [] });
    const p = await kit.plano();
    expect(p.planos.map((x) => x.id)).toEqual(["deepwiki"]);
    expect(p.bloqueios.map((b) => [b.id, b.bloqueio.codigo]).sort()).toEqual([["context7", "prerequisito_ausente"], ["sequential-thinking", "prerequisito_ausente"]]);
    expect(p.bloqueios[0]!.bloqueio.acao).toMatch(/Node/);
  });
});
