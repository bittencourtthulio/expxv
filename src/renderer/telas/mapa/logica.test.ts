import { describe, expect, it } from "vitest";
import type { PerfilProvisorioMapa } from "../../../compartilhado/mapa";
import { CONFIG_MAPA_PADRAO } from "../../../compartilhado/mapa";
import { estadoDaTela, estimativaTexto, evidenciaCopiavel, perfilParaMarkdown, percentualProgresso, tempoRelativo, textoDoErro, ehCaminhoRelativoSeguro } from "./logica";
import { resumoFalso } from "./fabrica-teste";

describe("estado da tela", () => {
  const base = { workspaceId: "ws_a", erro: null, carregando: false };
  it("deriva o estado do resumo", () => {
    expect(estadoDaTela({ ...base, workspaceId: null, resumo: null })).toBe("sem_workspace");
    expect(estadoDaTela({ ...base, resumo: null, carregando: true })).toBe("carregando");
    expect(estadoDaTela({ ...base, resumo: null, erro: new Error("x") })).toBe("erro");
    expect(estadoDaTela({ ...base, resumo: resumoFalso({ estado: "vazio" }) })).toBe("nunca");
    expect(estadoDaTela({ ...base, resumo: resumoFalso({ analisando: true }) })).toBe("analisando");
    expect(estadoDaTela({ ...base, resumo: resumoFalso({ estado: "parcial" }) })).toBe("parcial");
    expect(estadoDaTela({ ...base, resumo: resumoFalso({ desatualizado: true, alterados_n: 3 }) })).toBe("desatualizado");
    expect(estadoDaTela({ ...base, resumo: resumoFalso({ desatualizado: true, alterados_n: 0 }) })).toBe("pronto");
    expect(estadoDaTela({ ...base, resumo: resumoFalso() })).toBe("pronto");
  });
});

describe("textos", () => {
  it("erro do IPC: tira o prefixo e esconde caminho e stack", () => {
    expect(textoDoErro(new Error("Error invoking remote method 'mapa:resumo': Error: [mapa] mapa desabilitado"))).toBe("mapa desabilitado");
    expect(textoDoErro(new Error("ENOENT /Users/x/mapa.db"))).toBe("Não foi possível concluir a operação.");
    expect(textoDoErro(null)).toBe("Não foi possível concluir a operação.");
  });
  it("tempo relativo, estimativa e progresso", () => {
    const agora = Date.parse("2026-10-01T12:00:00Z");
    expect(tempoRelativo(null, agora)).toBe("nunca");
    expect(tempoRelativo("2026-10-01T11:57:00Z", agora)).toBe("há 3 min");
    expect(tempoRelativo("2026-10-01T09:00:00Z", agora)).toBe("há 3 h");
    expect(estimativaTexto(null)).toMatch(/segundo plano/);
    expect(estimativaTexto(5000)).toMatch(/5\.000 arquivos/);
    expect(percentualProgresso(5, 0)).toBe(0);
    expect(percentualProgresso(50, 200)).toBe(25);
    expect(evidenciaCopiavel("a/b.ts", 7)).toBe("a/b.ts:7");
    expect(evidenciaCopiavel("a/b.ts", null)).toBe("a/b.ts");
  });
  it("caminho relativo seguro", () => {
    expect(ehCaminhoRelativoSeguro("src/a.ts")).toBe(true);
    for (const ruim of ["/etc/passwd", "../x", "a/../../b", "C:\\x", ""]) expect(ehCaminhoRelativoSeguro(ruim)).toBe(false);
  });
});

describe("perfil em Markdown", () => {
  const p: PerfilProvisorioMapa = {
    nota: "provisório", gerado_em: "2026-10-01", stack: { ecossistemas: ["npm"], manifestos: ["package.json"], linguagens: [{ linguagem: "typescript", arquivos: 10, loc: 1000 }] },
    entradas_por_categoria: { rota: 3 }, camadas: { modulos: 4, violacoes: 1, ciclos: 0 }, comandos: [{ nome: "test", comando: "vitest", fonte: "package.json", linha: 5 }],
    cobertura: { metodo: "estimada por convenção", sem_teste: 2, total: 10 }, dialetos_conflitantes: [{ eixo: "erro", forca: "CONFLITO" }],
    zonas_candidatas: [{ categoria: "fiscal", pastas: ["src/fiscal"], quem_valida: "NÃO DETERMINADO" }], divida: { ciclos: 0, candidatos_mortos: 4, hotspots_quentes: 2 },
  };
  it("traz o aviso de que não é o PERFIL.md e só fala de morto como candidato", () => {
    const md = perfilParaMarkdown(p);
    expect(md).toMatch(/não é o PERFIL\.md/);
    expect(md).toMatch(/NÃO DETERMINADO/);
    for (const l of md.split("\n")) if (/morto/i.test(l)) expect(l).toMatch(/candidato/i);
  });
  it("config padrão do contrato é conservadora", () => {
    expect(CONFIG_MAPA_PADRAO.expor_agentes).toBe(false);
    expect(CONFIG_MAPA_PADRAO.auto_atualizar).toBe(false);
  });
});
