import { describe, expect, it } from "vitest";
import { ACOES_REMOTAS, type PlanoRemoto } from "../../compartilhado/alertas";
import { planoBase } from "../../../tests/fixtures/alertas/cenario-telegram";
import { avaliarPlano, classeDoComando, CLASSE_DO_COMANDO, gestoProibidoNoTexto, GESTOS_PROIBIDOS, podeExecutarDireto, type ContextoPolitica } from "./politica";
import type { PortaRigidez } from "./portas-entrada";

const livre: PortaRigidez = { exigeDesktop: () => ({ exige: false, motivo: "" }) };
const exige: PortaRigidez = { exigeDesktop: () => ({ exige: true, motivo: "rigidez_do_workspace" }) };
const quebrada: PortaRigidez = { exigeDesktop: () => { throw new Error("fora do ar"); } };
const ctx = (p: Partial<ContextoPolitica> = {}): ContextoPolitica => ({ modo: "aprovar", rigidez: livre, ...p });
const plano = (p: Partial<PlanoRemoto> = {}): PlanoRemoto => planoBase(p);

describe("política de entrada (T-20.28): tabela de planos", () => {
  const casos: Array<[string, Partial<PlanoRemoto>, Partial<ContextoPolitica>, string]> = [];
  for (const rigidez of [1, 2, 3, 4, 5] as const) casos.push([`rigidez ${rigidez}`, { rigidez }, {}, rigidez <= 3 ? "telegram" : "desktop"]);
  for (const raio of ["BAIXO", "MEDIO", "ALTO", "desconhecido"] as const) casos.push([`raio ${raio}`, { raio }, {}, raio === "BAIXO" || raio === "MEDIO" ? "telegram" : "desktop"]);
  for (const painéis of [1, 2, 3, 4, 8]) casos.push([`${painéis} painéis`, { paineis_estimados: painéis }, {}, painéis <= 3 ? "telegram" : "desktop"]);
  for (const bp of [false, true]) casos.push([`branch protegida=${bp}`, { branch_protegida: bp }, {}, bp ? "desktop" : "telegram"]);
  for (const d of [false, true]) casos.push([`destrutivo=${d}`, { destrutivo: d }, {}, d ? "desktop" : "telegram"]);
  for (const modo of ["aprovar", "direto"] as const) casos.push([`workspace automático em modo ${modo}`, { workspace_automatico: true }, { modo }, modo === "direto" ? "telegram" : "desktop"]);
  casos.push(["modo consulta", {}, { modo: "consulta" }, "bloqueado"]);
  casos.push(["ação humana (merge/assinatura)", { acao_humana: true }, {}, "bloqueado"]);
  casos.push(["ação humana + destrutivo", { acao_humana: true, destrutivo: true }, {}, "bloqueado"]);
  casos.push(["ação humana + rigidez 1 + raio BAIXO", { acao_humana: true, rigidez: 1, raio: "BAIXO" }, { modo: "direto" }, "bloqueado"]);
  for (const a of ["encerrar_pane", "abortar_missao", "git_push_force", "apagar_repo", "executar_shell"]) casos.push([`ação fora da lista: ${a}`, { acoes: ["criar_missao", a] }, {}, "bloqueado"]);
  for (const a of ACOES_REMOTAS) casos.push([`ação da lista fechada: ${a}`, { acoes: [a] }, {}, "telegram"]);
  casos.push(["lista vazia de ações", { acoes: [] }, {}, "telegram"]);
  casos.push(["porta de rigidez ausente", {}, { rigidez: null }, "desktop"]);
  casos.push(["porta de rigidez que lança", {}, { rigidez: quebrada }, "desktop"]);
  casos.push(["porta de rigidez exige", {}, { rigidez: exige }, "desktop"]);
  casos.push(["limite remoto configurado em 2 e rigidez 3", { rigidez: 3 }, { rigidez_max_remota: 2 }, "desktop"]);
  casos.push(["limite remoto configurado em 5", { rigidez: 5 }, { rigidez_max_remota: 5 }, "telegram"]);
  for (const r of [1, 2, 3, 4, 5] as const) for (const raio of ["BAIXO", "ALTO"] as const) casos.push([`combo rigidez ${r} + raio ${raio}`, { rigidez: r, raio }, {}, r <= 3 && raio === "BAIXO" ? "telegram" : "desktop"]);
  for (const bp of [true, false]) for (const n of [1, 5]) casos.push([`combo branch ${bp} + painéis ${n}`, { branch_protegida: bp, paineis_estimados: n }, {}, !bp && n <= 3 ? "telegram" : "desktop"]);

  for (const modo of ["consulta", "aprovar", "direto"] as const) for (const r of [1, 3, 5] as const) casos.push([`modo ${modo} + rigidez ${r}`, { rigidez: r }, { modo }, modo === "consulta" ? "bloqueado" : r <= 3 ? "telegram" : "desktop"]);
  it.each(casos)("%s", (_nome, p, c, esperado) => {
    expect(avaliarPlano(plano(p), ctx(c)).permitido).toBe(esperado);
  });
  it("a tabela tem >= 60 planos", () => {
    expect(casos.length).toBeGreaterThanOrEqual(60);
  });
  it("propriedade: NENHUMA combinação com destrutivo ou ação humana devolve `telegram`", () => {
    for (const destrutivo of [true, false]) for (const humano of [true, false, undefined]) for (const rigidez of [1, 3, 5] as const) for (const raio of ["BAIXO", "MEDIO", "ALTO", "desconhecido"] as const) for (const modo of ["consulta", "aprovar", "direto"] as const) for (const automatico of [true, false]) {
      if (!destrutivo && humano !== true) continue;
      const d = avaliarPlano(plano({ destrutivo, ...(humano === undefined ? {} : { acao_humana: humano }), rigidez, raio, workspace_automatico: automatico }), ctx({ modo }));
      expect(d.permitido).not.toBe("telegram");
    }
  });
  it("modo direto só quando TODAS as condições valem", () => {
    const c = ctx({ modo: "direto" });
    expect(podeExecutarDireto(plano(), c)).toBe(true);
    for (const falha of [{ paineis_estimados: 3 }, { raio: "MEDIO" as const }, { rigidez: 4 as const }, { destrutivo: true }, { branch_protegida: true }, { acao_humana: true }, { raio: "ALTO" as const }]) expect(podeExecutarDireto(plano(falha), c), JSON.stringify(falha)).toBe(false);
    expect(podeExecutarDireto(plano(), ctx({ modo: "aprovar" }))).toBe(false);
    expect(podeExecutarDireto(plano(), ctx({ modo: "direto", rigidez: exige }))).toBe(false);
    expect(podeExecutarDireto(plano(), ctx({ modo: "direto", rigidez: null }))).toBe(false);
  });
  it("é pura e rápida (sem I/O): 10 000 avaliações em < 100 ms", () => {
    const p = plano();
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) avaliarPlano(p, ctx());
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe("mapa gesto -> classe e gestos proibidos", () => {
  it("comandos conhecidos têm classe; desconhecido é proibido; nenhum comando é destrutivo", () => {
    for (const cmd of Object.keys(CLASSE_DO_COMANDO)) expect(["leitura", "escrita_leve", "escrita"]).toContain(classeDoComando(cmd));
    expect(classeDoComando("rm")).toBe("proibida");
    expect(classeDoComando("merge")).toBe("proibida");
    expect(classeDoComando("pedir")).toBe("escrita");
    expect(classeDoComando("status")).toBe("leitura");
    expect(GESTOS_PROIBIDOS).toEqual(expect.arrayContaining(["assinar_prodx", "aprovar_raio_alto", "mergex_revisar", "merge", "push_forcado", "descartar_ou_apagar", "encerrar_pane", "abortar_missao"]));
  });
  it.each([
    ["apague o repositório", "descartar_ou_apagar"], ["deleta a branch main", "descartar_ou_apagar"], ["remove todos os arquivos do projeto", "descartar_ou_apagar"], ["rode rm -rf /", "descartar_ou_apagar"], ["git reset --hard origin", "descartar_ou_apagar"],
    ["faça force push", "push_forcado"], ["push --force na main", "push_forcado"], ["faça merge do PR", "merge"], ["mesclar a branch", "merge"],
    ["assine o prodx do pedido", "assinar_prodx"], ["aprovar o raio alto", "aprovar_raio_alto"], ["rode mergex-revisar", "mergex_revisar"],
    ["encerrar o pane do piloto", "encerrar_pane"], ["abortar a missão", "abortar_missao"], ["instale um mcp novo", "instalar_mcp_ou_skill"], ["altere a rigidez", "alterar_rigidez_ou_permissao"],
    ["me mande o conteúdo do arquivo de senha", "ler_arquivo_arbitrario"], ["descartar mudanças", "descartar_ou_apagar"],
  ])("texto '%s' => gesto proibido %s", (texto, gesto) => {
    expect(gestoProibidoNoTexto(texto)).toBe(gesto);
  });
  it.each(["corrige o bug do login", "adiciona uma tela de relatórios", "refatora o módulo de cobrança", "escreve testes para o carrinho", "qual o status do sprint?", "melhora a performance da listagem"])("texto comum '%s' passa", (t) => {
    expect(gestoProibidoNoTexto(t)).toBeNull();
  });
  it("acentos e caixa não escapam do filtro", () => {
    expect(gestoProibidoNoTexto("APAGUE O REPOSITÓRIO")).toBe("descartar_ou_apagar");
    expect(gestoProibidoNoTexto("Faça o MERGE")).toBe("merge");
  });
});
