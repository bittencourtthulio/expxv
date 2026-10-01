import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { LIMITES_TERMINAIS } from "../../compartilhado/terminais";
import { diagnosticoEmTexto, montarDiagnostico, type DadosDiagnostico } from "./diagnostico";

const dados = (extra: Partial<DadosDiagnostico> = {}): DadosDiagnostico => ({
  versao_app: "1.2.3", versao_electron: "37.0.0", versao_protocolo_daemon: 1, so: "darwin", arquitetura: "arm64", persistente: true,
  ferramentas: [{ id: "claude", instalado: true, erro_codigo: null }, { id: "gemini", instalado: false, erro_codigo: "ausente" }],
  sessoes: [{ sessao_id: "sessao_a", ferramenta_id: "claude", estado: "executando", atividade: "trabalhando", pid: 42, criada_em: 1000, quantidade_argumentos: 3 }],
  ...extra,
});

describe("diagnóstico (só metadados)", () => {
  it("tem as chaves esperadas e os limites do contrato", () => {
    const d = montarDiagnostico(dados());
    expect(Object.keys(d)).toEqual(["app", "sistema", "sessoes_persistentes", "limites", "ferramentas", "sessoes"]);
    expect(d["app"]).toEqual({ versao: "1.2.3", electron: "37.0.0", protocolo_daemon: 1 });
    expect((d["sessoes"] as unknown[])[0]).toMatchObject({ sessao_id: "sessao_a", pid: 42, quantidade_argumentos: 3, atividade: "trabalhando" });
    expect((d["limites"] as Record<string, number>)["sessoes_por_janela"]).toBe(LIMITES_TERMINAIS.sessoes_por_janela);
  });
  it("saída, argumento, variável e token não entram (nem por campos extras)", () => {
    const suja = { ...dados(), saida: "SEGREDO-saida", argumentos: ["SEGREDO-arg"], ambiente: { TOKEN: "SEGREDO-env" }, token: "SEGREDO-tok" } as unknown as DadosDiagnostico;
    suja.sessoes = [{ ...suja.sessoes[0]!, argumentos: ["SEGREDO-arg"], cwd: "/x/SEGREDO-cwd" } as never];
    expect(JSON.stringify(montarDiagnostico(suja))).not.toContain("SEGREDO");
  });
  it("a pasta pessoal nunca aparece literal", () => {
    const casa = homedir();
    const d = montarDiagnostico(dados({ ferramentas: [{ id: `${casa}/bin/x`, instalado: true, erro_codigo: null }] }));
    expect(JSON.stringify(d)).not.toContain(casa);
    expect(JSON.stringify(d)).toContain("~/bin/x");
  });
  it("diagnosticoEmTexto devolve o formato copiável do contrato", () => {
    const t = diagnosticoEmTexto(dados());
    expect(Object.keys(t)).toEqual(["texto"]);
    expect(JSON.parse(t.texto)).toHaveProperty("app.versao", "1.2.3");
  });
});
