import { describe, expect, it } from "vitest";
import { gerarVolumeRelatorio, itemFalso, portasFalsas, SPRINT_ID, sprintBrutaFalsa, WS } from "../../../tests/fixtures/relatorios/gerar";
import { coletarFatos, hashFatos } from "./fatos/coletar";
import { textoDaFonte } from "./fatos/fontes";
import { portasIndisponiveis } from "./portas";

describe("coletor de fatos", () => {
  it("mesma entrada => mesmo hash; a ordem dos itens e dos commits não muda o hash de conteúdo relevante", async () => {
    const a = await coletarFatos(portasFalsas(), WS, SPRINT_ID);
    const b = await coletarFatos(portasFalsas(), WS, SPRINT_ID);
    expect(a?.hash).toBe(b?.hash);
    expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFatos(a!.fatos)).toBe(a!.hash);
  });

  it("muda um fato => muda o hash", async () => {
    const bruta = sprintBrutaFalsa();
    const a = await coletarFatos(portasFalsas({}, bruta), WS, SPRINT_ID);
    (bruta.itens[0] as { resumo: { pontos: number } }).resumo.pontos = 8;
    const b = await coletarFatos(portasFalsas({}, bruta), WS, SPRINT_ID);
    expect(a?.hash).not.toBe(b?.hash);
  });

  it("sprint inexistente devolve null; sem nenhuma porta só com a gestão ágil funciona (desconhecido = null)", async () => {
    expect(await coletarFatos(portasFalsas(), WS, "spr_inexistente0000")).toBeNull();
    const bruta = sprintBrutaFalsa();
    const r = await coletarFatos({ ...portasIndisponiveis(), agil: portasFalsas({}, bruta).agil }, WS, SPRINT_ID);
    expect(r?.fatos.custo).toEqual({ tokens: null, usd: null, estado: "desconhecido" });
    expect(r?.fatos.mapa).toBeNull();
    expect(r?.fatos.prs).toEqual([]);
    expect(r?.fatos.avisos.join(" ")).toMatch(/Custo desconhecido/);
    expect(r?.fatos.avisos.join(" ")).toMatch(/Sem mapa/);
  });

  it("visibilidade: `auto` só mostra feature e bug; `sim`/`nao` mandam; item oculto fica marcado", async () => {
    const r = await coletarFatos(portasFalsas(), WS, SPRINT_ID);
    const vis = Object.fromEntries(r!.fatos.itens.map((i) => [i.titulo, i.visivel_cliente]));
    expect(vis["Login com conta corporativa"]).toBe(true);
    expect(vis["Refatorar controller interno de auditoria"]).toBe(false);
  });

  it("commits: SHA curto, mensagem limpa; PR: só link http(s) sem credencial", async () => {
    const r = await coletarFatos(portasFalsas({ versionamento: { prs: async () => [{ trabalho_id: "tr-login", url: "https://github.com/x/y/pull/1", estado: "open" }, { trabalho_id: "tr-login", url: "javascript:alert(1)", estado: null }, { trabalho_id: "tr-login", url: "https://u:p@h.com/a", estado: null }] } }), WS, SPRINT_ID);
    expect(r!.fatos.commits.map((c) => c.sha7).sort()).toEqual(["9f8e7d6", "a1b2c3d"]);
    expect(r!.fatos.commits.every((c) => /^[0-9a-f]{7}$/.test(c.sha7))).toBe(true);
    expect(r!.fatos.prs).toEqual([{ trabalho_id: "tr-login", url: "https://github.com/x/y/pull/1", estado: "open" }]);
  });

  it("segredo, valor do cofre e caminho absoluto nunca entram nos fatos", async () => {
    const bruta = sprintBrutaFalsa();
    bruta.itens[0]!.item.titulo = "Login com token=abcdef123456 em /Users/ana/proj/a.ts e MEUSEGREDO_XYZ";
    bruta.itens[0]!.fato!.commits[0]!.mensagem = "fix: usa sk-ABCDEFGHIJKLMNOP1234 em C:\\Users\\ana\\x";
    bruta.sprint.meta = "meta com /home/ana/segredo";
    const r = await coletarFatos(portasFalsas({ scrub: (t) => t.replace(/MEUSEGREDO_XYZ/g, "«cofre:K»") }, bruta), WS, SPRINT_ID);
    const json = JSON.stringify(r!.fatos);
    expect(json).not.toMatch(/abcdef123456|\/Users\/ana|MEUSEGREDO|sk-ABCDEF|C:\\\\Users|\/home\/ana/);
    expect(json).toContain("«cofre:K»");
  });

  it("arquivos absolutos ou com `..` não vão ao mapa", async () => {
    const bruta = sprintBrutaFalsa();
    bruta.itens[0]!.fato!.arquivos = ["/etc/passwd", "../fora.ts", "C:\\x.ts", "src/ok.ts"];
    let recebido: readonly string[] = [];
    await coletarFatos(portasFalsas({ mapa: { alteracoes: async (_w, a) => { recebido = a; return null; } } }, bruta), WS, SPRINT_ID);
    expect(recebido).toContain("src/ok.ts");
    expect(recebido.filter((a) => a !== "src/ok.ts" && !a.startsWith("src/"))).toEqual([]);
    expect(recebido).not.toContain("/etc/passwd");
    expect(recebido).not.toContain("../fora.ts");
  });

  it("porta que lança nunca derruba a coleta", async () => {
    const r = await coletarFatos(portasFalsas({ custo: { sprint: async () => { throw new Error("x"); } }, mapa: { alteracoes: async () => { throw new Error("y"); } }, versionamento: { prs: async () => { throw new Error("z"); } } }), WS, SPRINT_ID);
    expect(r).not.toBeNull();
    expect(r!.fatos.custo.estado).toBe("desconhecido");
  });

  it("métricas congeladas vêm do fechamento e do painel; desconhecido = null", async () => {
    const r = await coletarFatos(portasFalsas(), WS, SPRINT_ID);
    const m = r!.fatos.metricas;
    expect(m.pontos_planejados).toBe(12);
    expect(m.pontos_entregues).toBe(8);
    expect(m.first_time_right).toBe(0.9);
    expect(m.cycle_p50_h).toBe(2);
    expect(m.lead_p85_h).toBe(8);
    expect(m.bloqueio_h).toBeNull();
    expect(m.meta_atingida).toBe(false);
  });

  it("textoDaFonte: fonte inexistente é null; existente tem os fatos", async () => {
    const r = await coletarFatos(portasFalsas(), WS, SPRINT_ID);
    expect(textoDaFonte(r!.fatos, "item:it_inexistente")).toBeNull();
    expect(textoDaFonte(r!.fatos, "sprint:outra")).toBeNull();
    expect(textoDaFonte(r!.fatos, `sprint:${SPRINT_ID}`)).toContain("Sprint 12");
  });

  it("volume: 200 itens em tempo curto (P-290)", async () => {
    const bruta = gerarVolumeRelatorio(200);
    const t0 = performance.now();
    const r = await coletarFatos(portasFalsas({}, bruta), WS, SPRINT_ID);
    expect(performance.now() - t0).toBeLessThan(300);
    expect(r!.fatos.itens).toHaveLength(200);
    expect(itemFalso(1).id).toMatch(/^it_/);
  });
});
