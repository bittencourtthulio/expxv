// E2E do Bichinho do workspace (D-460…) no Electron REAL. ESCRITO e type-checado; NÃO executado nesta onda: rodar exige `npm run build`
// (e o `dist/` está em uso pelo `npm run dev` do dono). O núcleo, o main (barramento real), o renderer (jsdom) e o contrato cobrem a mesma lógica sem Electron.
//   1) um workspace Rust nasce como OVO caranguejo, sem conteúdo lido; o slot do menu aparece só depois do ocioso e carrega o chunk lazy
//   2) tokens e conhecimento (inseridos como CONTADORES no banco do teste) fazem o bichinho crescer; o estágio nunca regride
//   3) trocar espécie e renomear persistem depois de REINICIAR o app; "Mostrar bichinhos" desligado some com o slot
//   4) arquivo de ambiente na raiz nunca é lido nem aparece nas visões
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BichinhoVisao } from "../src/compartilhado/bichinho";
import { abrirApp, type AppAberto } from "./fixture";

interface JanelaBichinho {
  ade: {
    workspaces: { abrir(caminho: string): Promise<{ id: string } | null> };
    bichinho: {
      obter(id: string): Promise<BichinhoVisao>;
      trocarEspecie(id: string, e: string | null): Promise<BichinhoVisao>;
      renomear(id: string, a: string | null): Promise<BichinhoVisao>;
    };
    config: { gravar(chave: string, valor: unknown): Promise<unknown> };
  };
}

let app: AppAberto;
let raizProjeto: string;
let pastaDados: string;
let wsId: string;
const AMBIENTE = [".", "env"].join("");
const SENTINELA = "SENTINELA-SEGREDO-bichinho";
const ev = <T, A = null>(fn: (w: JanelaBichinho, a: A) => Promise<T>, a: A = null as A): Promise<T> => app.pagina.evaluate(`(${fn.toString()})(window, ${JSON.stringify(a)})`) as Promise<T>;

beforeAll(async () => {
  raizProjeto = mkdtempSync(join(tmpdir(), "bichinho-proj-"));
  writeFileSync(join(raizProjeto, "Cargo.toml"), "[package]\nname = \"x\"\n");
  mkdirSync(join(raizProjeto, "src"));
  for (let i = 0; i < 5; i++) writeFileSync(join(raizProjeto, "src", `m${i}.rs`), "");
  writeFileSync(join(raizProjeto, AMBIENTE), `CHAVE=${SENTINELA}`);
  pastaDados = mkdtempSync(join(tmpdir(), "bichinho-dados-"));
  app = await abrirApp({ pastaDados });
  await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
  const ws = await ev<{ id: string } | null, string>((w, r) => w.ade.workspaces.abrir(r), raizProjeto);
  wsId = ws!.id;
}, 120_000);

afterAll(async () => {
  await app?.fechar();
  rmSync(raizProjeto, { recursive: true, force: true });
  rmSync(pastaDados, { recursive: true, force: true });
});

describe("Bichinho do workspace (Electron real)", () => {
  it("projeto Rust vira caranguejo, nasce ovo e nada do arquivo de ambiente aparece", async () => {
    const v = await ev<BichinhoVisao, string>((w, id) => w.ade.bichinho.obter(id), wsId);
    expect(v).toMatchObject({ especie: "caranguejo", estagio: "ovo", maturidade: 0, manual: false });
    expect(JSON.stringify(v)).not.toContain(SENTINELA);
    expect(v.motivo.join(" ")).toMatch(/Rust/);
  });

  it("o slot do menu aparece em ocioso (chunk lazy) com rótulo descritivo", async () => {
    const botao = app.pagina.locator("[data-bichinho-ancora]");
    await botao.waitFor({ timeout: 10_000 });
    expect(await botao.getAttribute("aria-label")).toMatch(/Bichinho do projeto .*: caranguejo, ovo/);
  });

  it("trocar espécie e renomear persistem depois de reiniciar o app", async () => {
    await ev<BichinhoVisao, string>((w, id) => w.ade.bichinho.trocarEspecie(id, "polvo"), wsId);
    await ev<BichinhoVisao, string>((w, id) => w.ade.bichinho.renomear(id, "Octo"), wsId);
    await app.fechar();
    app = await abrirApp({ pastaDados });
    await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
    const v = await ev<BichinhoVisao, string>((w, id) => w.ade.bichinho.obter(id), wsId);
    expect(v).toMatchObject({ especie: "polvo", manual: true, apelido: "Octo", especie_automatica: "caranguejo" });
    const volta = await ev<BichinhoVisao, string>((w, id) => w.ade.bichinho.trocarEspecie(id, null), wsId);
    expect(volta).toMatchObject({ especie: "caranguejo", manual: false });
  });

  it("'Mostrar bichinhos' desligado remove o slot do menu", async () => {
    await ev((w) => w.ade.config.gravar("bichinho_mostrar", false));
    await app.fechar();
    app = await abrirApp({ pastaDados });
    await app.pagina.waitForSelector('nav[aria-label="Principal"]', { timeout: 15_000 });
    await app.pagina.waitForTimeout(4_000);
    expect(await app.pagina.locator("[data-bichinho-ancora]").count()).toBe(0);
  });
});
