import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispararNoPane, montarArgumentoDisparo, SKILL_DA_ACAO } from "./disparo";
import { gravarPacote } from "./pacote-contexto";

const PACOTE = ".expxv/mapa/20261001T100000Z/";
const pastas: string[] = [];
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe("disparo de skills (T-17.34)", () => {
  it("texto digitado por ação (Claude Code e OpenCode)", async () => {
    const digitados: string[] = [];
    const base = { pane_id: "pane_AAAAAAAAAA", pacoteRel: PACOTE, carimbo: "20261001T100000Z", obterCliDoPane: () => "claude", digitar: (_p: string, t: string) => { digitados.push(t); } };
    for (const acao of ["stackx_detectar", "stackx_atualizar", "legadox_perfil", "legadox_divida"] as const) {
      expect((await dispararNoPane({ ...base, acao })).ok).toBe(true);
    }
    const r = await dispararNoPane({ ...base, acao: "legadox_raio", trabalho_id: "OC-2026-0142", arquivos: ["src/a.ts", "src/b.ts"] });
    expect(r).toMatchObject({ ok: true, carimbo: "20261001T100000Z", pacote: PACOTE });
    expect(digitados).toEqual([
      "/expx:stackx-detectar mapa em .expxv/mapa/20261001T100000Z/ — leia RESUMO.md e inventario-stackx.json antes; as contagens e evidências arquivo:linha já são determinísticas: confirme por amostragem em vez de varrer tudo; use a tool MCP map_evidence para o resto",
      "/expx:stackx-atualizar mapa em .expxv/mapa/20261001T100000Z/ — leia mudancas-desde-ultimo.json e inventario-stackx.json; as contagens já são determinísticas: confirme por amostragem o que mudou; use a tool MCP map_evidence para o resto",
      "/expx:legadox-perfil mapa em .expxv/mapa/20261001T100000Z/ — use perfil-provisorio.json como ponto de partida; o que o mapa marca como estimado ou candidato continua exigindo sua verificação",
      "/expx:legadox-divida mapa em .expxv/mapa/20261001T100000Z/ — candidatos de código morto, hotspots e ciclos estão em RESUMO.md e arquivos.jsonl; todo candidato continua exigindo prova de vida antes de qualquer remoção",
      "/expx:legadox-raio OC-2026-0142 mapa em .expxv/mapa/20261001T100000Z/ — arquivos alvo: src/a.ts, src/b.ts — raio-OC-2026-0142.json traz os 8 sinais com método declarado e a faixa provisória; a classificação final e a aprovação ALTO são suas e humanas",
    ]);
    const oc = await dispararNoPane({ ...base, acao: "legadox_perfil", obterCliDoPane: () => "opencode" });
    expect(oc.ok && oc.comando.startsWith("/legadox-perfil ")).toBe(true);
  });

  it("bloqueia Pane sem CLI compatível ou inexistente, sem digitar nada", async () => {
    let n = 0;
    for (const cli of ["codex", "gemini", null]) {
      const r = await dispararNoPane({ acao: "stackx_detectar", pane_id: "pane_AAAAAAAAAA", pacoteRel: PACOTE, carimbo: "c", obterCliDoPane: () => cli, digitar: () => { n++; } });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.motivo).toContain("Claude Code e OpenCode");
    }
    expect(n).toBe(0);
  });

  it("legadox_raio exige trabalho e arquivos válidos; argumento em uma linha e até 1 500 caracteres", () => {
    expect(montarArgumentoDisparo({ acao: "legadox_raio", pacoteRel: PACOTE }).ok).toBe(false);
    expect(montarArgumentoDisparo({ acao: "legadox_raio", pacoteRel: PACOTE, trabalho_id: "T1", arquivos: [] }).ok).toBe(false);
    const ambiente = [".", "env"].join("");
    for (const ruim of ["/etc/passwd", "../x", "a\nb.ts", ambiente, "C:\\x", "a\\b"]) {
      expect(montarArgumentoDisparo({ acao: "legadox_raio", pacoteRel: PACOTE, trabalho_id: "T1", arquivos: [ruim] }).ok, ruim).toBe(false);
    }
    expect(montarArgumentoDisparo({ acao: "legadox_raio", pacoteRel: PACOTE, trabalho_id: "T1\nrm -rf", arquivos: ["a.ts"] }).ok).toBe(false);
    const muitos = Array.from({ length: 50 }, (_, i) => `src/${"p".repeat(60)}/arquivo${i}.ts`);
    const r = montarArgumentoDisparo({ acao: "legadox_raio", pacoteRel: PACOTE, trabalho_id: "T1", arquivos: muitos });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.argumento.length).toBeLessThanOrEqual(1500);
      expect(r.argumento).not.toMatch(/[\r\n\t]/);
      expect(r.argumento).toMatch(/\(\+\d+\)/);
    }
    expect(montarArgumentoDisparo({ acao: "stackx_detectar", pacoteRel: "../x/" }).ok).toBe(false);
  });

  it("só existem as skills reais e nenhuma é ação humana", () => {
    expect(Object.values(SKILL_DA_ACAO).sort()).toEqual(["legadox-divida", "legadox-perfil", "legadox-raio", "stackx-atualizar", "stackx-detectar"]);
    expect(montarArgumentoDisparo({ acao: "mergex_revisar" as never, pacoteRel: PACOTE }).ok).toBe(false);
  });

  it("não cria nada em docs/ nem fora de .expxv/mapa/ ao gravar o pacote e disparar", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "mapa-disp-"));
    pastas.push(raiz);
    mkdirSync(join(raiz, "docs"));
    writeFileSync(join(raiz, "docs", "A.md"), "a");
    const listar = (d: string, rel = ""): string[] =>
      readdirSync(join(d, rel)).sort().flatMap((n) => {
        const p = rel === "" ? n : `${rel}/${n}`;
        return lstatSync(join(d, p)).isDirectory() ? [p, ...listar(d, p)] : [p];
      });
    const antes = listar(raiz);
    gravarPacote({ raiz, carimbo: "20261001T100000Z", conteudo: { resumo_md: "r", inventario: [], perfil: {}, entradas: {}, arquivos_jsonl: "", mudancas: { primeira_analise: true, novos: [], removidos: [], alterados: [] } } });
    await dispararNoPane({ acao: "stackx_detectar", pane_id: "pane_AAAAAAAAAA", pacoteRel: PACOTE, carimbo: "20261001T100000Z", obterCliDoPane: () => "claude", digitar: () => undefined });
    const depois = listar(raiz);
    expect(depois.filter((x) => !antes.includes(x)).every((x) => x.startsWith(".expxv"))).toBe(true);
    expect(depois.filter((x) => x.startsWith("docs"))).toEqual(antes.filter((x) => x.startsWith("docs")));
    expect(readFileSync(join(raiz, "docs", "A.md"), "utf8")).toBe("a");
  });
});
