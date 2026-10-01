import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { criarTmp, limparTmps } from "../../../../tests/fixtures/metodo/util";
import { evento } from "../../../../tests/fixtures/metodo/gerar";
import { criarTailJsonl, lerJsonlDesde, lerRastroDoTrabalho } from "./jsonl";

afterEach(limparTmps);

const linha = (o: Record<string, unknown>): string => evento(o) + "\n";

describe("lerJsonlDesde: teto de leitura (AUD-12)", () => {
  it("arquivo maior que o teto: lê só a cauda (descarta a linha cortada) e não aloca o arquivo inteiro", async () => {
    const d = criarTmp();
    const f = join(d, "gigante.jsonl");
    const linhas = Array.from({ length: 200 }, (_, i) => linha({ trabalho_id: "t", task: `T-${String(i).padStart(3, "0")}` }));
    writeFileSync(f, linhas.join(""));
    const tamanho = Buffer.byteLength(linhas.join(""));
    const teto = Math.floor(tamanho / 4);
    const r = await lerJsonlDesde(f, 0, teto);
    expect(r.eventos.length).toBeGreaterThan(0);
    expect(r.eventos.length).toBeLessThan(200);
    expect(r.eventos.at(-1)?.task).toBe("T-199"); // a cauda é o que importa
    expect(r.invalidas).toBe(0); // a linha cortada no começo NÃO vira "inválida"
    expect(r.offset).toBe(tamanho);
  });
});

describe("lerJsonlDesde", () => {
  it("lê todas as linhas completas e devolve o novo offset em bytes", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    const conteudo = linha({ trabalho_id: "t", task: "T-01.01" }) + linha({ trabalho_id: "t", task: "T-01.02" });
    writeFileSync(f, conteudo);
    const r = await lerJsonlDesde(f, 0);
    expect(r.eventos.map((e) => e.task)).toEqual(["T-01.01", "T-01.02"]);
    expect(r.offset).toBe(Buffer.byteLength(conteudo));
    expect(r.invalidas).toBe(0);
  });

  it("adia a linha incompleta do fim e a entrega quando ela termina", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    const completa = linha({ trabalho_id: "t", task: "T-01.01" });
    const parcial = linha({ trabalho_id: "t", task: "T-01.02" });
    writeFileSync(f, completa + parcial.slice(0, 25));
    const a = await lerJsonlDesde(f, 0);
    expect(a.eventos).toHaveLength(1);
    expect(a.offset).toBe(Buffer.byteLength(completa));
    appendFileSync(f, parcial.slice(25));
    const b = await lerJsonlDesde(f, a.offset);
    expect(b.eventos.map((e) => e.task)).toEqual(["T-01.02"]);
    expect(b.offset).toBe(Buffer.byteLength(completa + parcial));
  });

  it("offset em bytes funciona com UTF-8 multibyte", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    const a = linha({ trabalho_id: "t", detalhe: "ação concluída — não falhou" });
    writeFileSync(f, a);
    const r1 = await lerJsonlDesde(f, 0);
    appendFileSync(f, linha({ trabalho_id: "t", detalhe: "segunda" }));
    const r2 = await lerJsonlDesde(f, r1.offset);
    expect(r2.eventos).toHaveLength(1);
    expect(r2.eventos[0]?.detalhe).toBe("segunda");
  });

  it("linha quebrada no meio é contada e pulada, sem perder as vizinhas", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    writeFileSync(f, linha({ trabalho_id: "t", task: "A" }) + "{quebrada\n" + "\n" + linha({ trabalho_id: "t", task: "B" }));
    const r = await lerJsonlDesde(f, 0);
    expect(r.eventos.map((e) => e.task)).toEqual(["A", "B"]);
    expect(r.invalidas).toBe(1);
  });

  it("linha JSON sem as chaves mínimas é inválida", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    writeFileSync(f, '{"foo":1}\n[1,2]\n"texto"\n');
    const r = await lerJsonlDesde(f, 0);
    expect(r.eventos).toEqual([]);
    expect(r.invalidas).toBe(3);
  });

  it("BOM no início é tolerado", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    writeFileSync(f, "﻿" + linha({ trabalho_id: "t", task: "A" }));
    const r = await lerJsonlDesde(f, 0);
    expect(r.eventos).toHaveLength(1);
  });

  it("arquivo que encolheu (reescrito) recomeça do zero", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    writeFileSync(f, linha({ trabalho_id: "t", task: "A" }) + linha({ trabalho_id: "t", task: "B" }));
    const r1 = await lerJsonlDesde(f, 0);
    writeFileSync(f, linha({ trabalho_id: "t", task: "C" }));
    const r2 = await lerJsonlDesde(f, r1.offset);
    expect(r2.eventos.map((e) => e.task)).toEqual(["C"]);
  });

  it("arquivo inexistente ou ilegível não lança", async () => {
    const r = await lerJsonlDesde("/caminho/que/nao/existe.jsonl", 0);
    expect(r).toEqual({ eventos: [], offset: 0, invalidas: 0 });
  });
});

describe("lerRastroDoTrabalho (rotação)", () => {
  it("junta <id>.N.jsonl e <id>.jsonl ordenando por ts, sem misturar outros trabalhos", async () => {
    const d = criarTmp();
    writeFileSync(join(d, "x.1.jsonl"), linha({ trabalho_id: "x", ts: "2026-09-01T00:00:00Z", task: "velho" }) + "lixo\n");
    writeFileSync(join(d, "x.2.jsonl"), linha({ trabalho_id: "x", ts: "2026-09-02T00:00:00Z", task: "meio" }));
    writeFileSync(join(d, "x.jsonl"), linha({ trabalho_id: "x", ts: "2026-09-03T00:00:00Z", task: "novo" }));
    writeFileSync(join(d, "xy.jsonl"), linha({ trabalho_id: "xy", ts: "2026-09-04T00:00:00Z", task: "outro" }));
    const r = await lerRastroDoTrabalho(d, "x");
    expect(r.eventos.map((e) => e.task)).toEqual(["velho", "meio", "novo"]);
    expect(r.invalidas).toBe(1);
  });

  it("pasta inexistente devolve vazio", async () => {
    expect((await lerRastroDoTrabalho("/nao/existe", "x")).eventos).toEqual([]);
  });
});

describe("criarTailJsonl", () => {
  it("entrega só o que é novo a cada chamada e guarda offset por arquivo", async () => {
    const d = criarTmp();
    const f = join(d, "t.jsonl");
    const tail = criarTailJsonl();
    writeFileSync(f, linha({ trabalho_id: "t", task: "A" }));
    expect((await tail.lerNovos(f)).map((e) => e.task)).toEqual(["A"]);
    expect(await tail.lerNovos(f)).toEqual([]);
    appendFileSync(f, linha({ trabalho_id: "t", task: "B" }) + "{meia");
    expect((await tail.lerNovos(f)).map((e) => e.task)).toEqual(["B"]);
    appendFileSync(f, "\n"); // a linha "{meia" agora está completa, mas inválida
    expect(await tail.lerNovos(f)).toEqual([]);
    expect(tail.offsetDe(f)).toBeGreaterThan(0);
    tail.esquecer(f);
    expect(tail.offsetDe(f)).toBe(0);
  });
});
