import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { apagarSessao, arquivoDaSessao, gravarMeta, lerCauda, LogSessao, RETENCAO_MS, varrerSessoes } from "./historico";
import type { InfoSessaoDaemon } from "./protocolo";

const info = (id: string, estado: InfoSessaoDaemon["estado"]): InfoSessaoDaemon => ({
  sessao_id: id, estado, codigo: 0, sinal: null, ferramenta_id: "terminal", executavel_id: "exe_1", argumentos: [], raiz: "/x", workspace_id: null, colunas: 80, linhas: 24, criada_em: 1,
});

describe("histórico em disco", () => {
  it("compacta o log para só a cauda quando passa de 4x o limite", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    const log = new LogSessao(dir, "sessao_a", 10);
    let cauda = "";
    for (let i = 0; i < 6; i++) { const d = `bloco${i}-----`; cauda = (cauda + d).slice(-10); log.gravar(d, () => cauda); }
    log.fechar();
    const disco = readFileSync(arquivoDaSessao(dir, "sessao_a", "log"), "utf8");
    expect(disco.length).toBeLessThanOrEqual(10 * 4);
    expect(disco.endsWith(cauda)).toBe(true);
  });

  it("lerCauda devolve só o fim e descarta um caractere cortado no começo", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    writeFileSync(arquivoDaSessao(dir, "sessao_a", "log"), "0123456789");
    expect(lerCauda(dir, "sessao_a", 4)).toBe("6789");
    writeFileSync(arquivoDaSessao(dir, "sessao_b", "log"), "�abc");
    expect(lerCauda(dir, "sessao_b", 3)).toBe("abc");
    expect(lerCauda(dir, "sessao_nada", 3)).toBe("");
  });

  it("varrerSessoes aplica a retenção de 7 dias só às encerradas e ignora lixo", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    for (const [id, estado] of [["sessao_velha", "encerrada"], ["sessao_nova", "erro"], ["sessao_viva", "executando"]] as const) {
      gravarMeta(dir, info(id, estado));
      writeFileSync(arquivoDaSessao(dir, id, "log"), `log-${id}`);
    }
    writeFileSync(join(dir, "sessao_lixo.json"), "{quebrado");
    writeFileSync(join(dir, "token"), "x");
    const velho = new Date(Date.now() - RETENCAO_MS - 60_000);
    utimesSync(arquivoDaSessao(dir, "sessao_velha", "json"), velho, velho);
    utimesSync(arquivoDaSessao(dir, "sessao_viva", "json"), velho, velho);
    const achadas = varrerSessoes(dir, 1_000).map((s) => s.info.sessao_id).sort();
    expect(achadas).toEqual(["sessao_nova", "sessao_viva"]);
    expect(existsSync(arquivoDaSessao(dir, "sessao_velha", "json"))).toBe(false);
    expect(varrerSessoes(dir, 1_000).find((s) => s.info.sessao_id === "sessao_nova")?.cauda).toBe("log-sessao_nova");
  });

  it("metadados antigos sem workspace_id voltam com null; apagarSessao remove os dois arquivos", () => {
    const dir = mkdtempSync(join(tmpdir(), "hist-"));
    const { workspace_id: _w, ...antigo } = info("sessao_a", "encerrada");
    writeFileSync(arquivoDaSessao(dir, "sessao_a", "json"), JSON.stringify(antigo));
    expect(varrerSessoes(dir, 100)[0]?.info.workspace_id).toBeNull();
    writeFileSync(arquivoDaSessao(dir, "sessao_a", "log"), "x");
    apagarSessao(dir, "sessao_a");
    expect(existsSync(arquivoDaSessao(dir, "sessao_a", "json"))).toBe(false);
    expect(existsSync(arquivoDaSessao(dir, "sessao_a", "log"))).toBe(false);
  });
});
