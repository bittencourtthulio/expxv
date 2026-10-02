import { afterEach, describe, expect, it, vi } from "vitest";
import { requisicaoCrua } from "../../tests/fixtures/jarvis/cliente-remoto";
import { TEXTO_CONSENTIMENTO_REMOTO_VERSAO } from "../compartilhado/jarvis";
import { abrirBanco, type Banco } from "../nucleo/banco/banco";
import { migrar } from "../nucleo/banco/migrar";
import { ligarJarvis, lerConfigJarvis, lerConfigRemoto, type DepsLigacaoJarvis } from "./jarvis";

const TS = "2026-10-01T12:00:00.000Z";
const bancos: Banco[] = [];
const fechar: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const f of fechar.splice(0)) await f();
  bancos.splice(0).forEach((b) => b.fechar());
});

function cenario(o: Partial<DepsLigacaoJarvis> = {}) {
  const banco = abrirBanco(":memory:");
  migrar(banco);
  bancos.push(banco);
  banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_1','W1','/r',?,?)", [TS, TS]);
  banco.executar("INSERT INTO pane (id,workspace_id,display_id,tipo,cli,papel,eh_piloto,estado,criado_em,atualizado_em) VALUES ('p1','ws_1',3,'cli','claude','piloto',1,'aguardando',?,?)", [TS, TS]);
  const prefs = new Map<string, unknown>();
  const eventos: Array<{ canal: string; payload: unknown }> = [];
  const segredos = new Map<string, string>();
  const deps: DepsLigacaoJarvis = {
    banco,
    config: { obter: () => null } as never,
    portoes: { estado: () => null, liberar: () => null },
    prefs: { obter: vi.fn((k: string) => prefs.get(k)), definir: vi.fn(async (k: string, v: unknown) => void prefs.set(k, v)) },
    emitirRenderer: (canal, payload) => void eventos.push({ canal, payload }),
    workspaceAtualId: () => "ws_1",
    workspaceIds: () => ["ws_1"],
    nomeWorkspace: () => "W1",
    workspaceAutomatico: () => false,
    maestro: () => null,
    listarPipelines: async () => [],
    cotaGeralPct: () => 12,
    criticosNaoLidos: () => 0,
    segredos: { ler: async (n) => segredos.get(n) ?? null, gravar: async (n, v) => void segredos.set(n, v) },
    interfaces: () => [{ nome: "en0", ip: "192.168.1.20" }],
    ...o,
  };
  const l = ligarJarvis(deps);
  fechar.push(() => l.encerrar());
  return { l, deps, prefs, eventos, banco };
}

describe("ligação do Jarvis no main", () => {
  it("é preguiçosa: criar a ligação não toca prefs, banco, rede nem emite evento", () => {
    const { l, deps, eventos } = cenario();
    expect(deps.prefs.obter).not.toHaveBeenCalled();
    expect(eventos).toEqual([]);
    expect(l.remotoLigado()).toBe(false);
  });
  it("desligado por padrão; ligar pela config habilita; painéis e status vêm do banco (sem cauda de terminal)", async () => {
    const { l, eventos } = cenario();
    expect(await l.jarvis.enviar("status")).toMatchObject({ tipo: "recusado", codigo: "desligado" });
    const e = await l.jarvis.configGravar({ ligado: true });
    expect(e.config.ligado).toBe(true);
    expect(e.acoes).toHaveLength(9);
    const p = await l.jarvis.enviar("listar painéis");
    expect(p).toMatchObject({ tipo: "resposta", resposta: { nao_confiavel: true, linhas: [{ rotulo: expect.stringContaining("#3") }] } });
    expect(JSON.stringify(p)).not.toMatch(/\/Users|\/r\b/);
    expect((await l.jarvis.enviar("status")).tipo).toBe("resposta");
    expect(eventos.some((x) => x.canal === "jarvis:evento")).toBe(true);
  });
  it("abrir painel: existente emite a navegação com o display_id; inexistente é recusado; 'piloto' resolve", async () => {
    const { l, eventos } = cenario();
    await l.jarvis.configGravar({ ligado: true });
    expect((await l.jarvis.enviar("abrir o painel 3")).tipo).toBe("resposta");
    expect((await l.jarvis.enviar("abrir o painel 99")).tipo).toBe("recusado");
    expect((await l.jarvis.enviar("abre o pane piloto")).tipo).toBe("resposta");
    expect(eventos.filter((x) => x.canal === "jarvis:abrir_pane").map((x) => x.payload)).toEqual([{ ref: "3" }, { ref: "3" }]);
  });
  it("sem Maestro, enviar ao Maestro é 'indisponível' e nada é pedido; gesto proibido é barrado", async () => {
    const { l } = cenario();
    await l.jarvis.configGravar({ ligado: true });
    expect(await l.jarvis.enviar("diga ao maestro: ajustar")).toMatchObject({ tipo: "recusado", codigo: "indisponivel" });
    expect(await l.jarvis.enviar("apague o repositório")).toMatchObject({ codigo: "gesto_proibido" });
  });
  it("a LLM só liga com consentimento (desligar o consentimento desliga a LLM)", async () => {
    const { l } = cenario();
    expect((await l.jarvis.configGravar({ llm_ligado: true })).config).toMatchObject({ llm_ligado: false, llm_consentimento: false }); // sem consentimento a LLM não liga
    expect((await l.jarvis.configGravar({ llm_consentimento: true, llm_ligado: true })).config).toMatchObject({ llm_ligado: true });
    expect((await l.jarvis.configGravar({ llm_consentimento: false })).config).toMatchObject({ llm_ligado: false });
  });
  it("coerção de configuração: valores inválidos voltam ao padrão seguro", () => {
    expect(lerConfigJarvis({ ligado: "sim", confirmacao_ttl_s: 9999 })).toMatchObject({ ligado: false, llm_ligado: false, confirmacao_ttl_s: 120 });
    expect(lerConfigRemoto({ interface: "0.0.0.0; ls", porta: 3, hosts_extras: ["ok.ts.net", "a b", 3] })).toMatchObject({ interface: "auto", porta: 1024, hosts_extras: ["ok.ts.net"], permitir_cgnat: false });
    expect(lerConfigRemoto(null)).toMatchObject({ interface: "auto", porta: 0, permitir_cgnat: false });
  });
  it("remoto: nasce desligado; ligar exige consentimento; encerrar fecha o socket e a identidade fica só no cofre", async () => {
    const segredos = new Map<string, string>();
    const { l, banco } = cenario({ segredos: { ler: async (n) => segredos.get(n) ?? null, gravar: async (n, v) => void segredos.set(n, v) } });
    expect((await l.remoto.estado()).transporte).toMatchObject({ ligado: false, porta: null });
    expect(await l.remoto.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: "x" })).toEqual({ erro: "consentimento_ausente" });
    const r = await l.remoto.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO });
    if ("erro" in r) throw new Error(r.erro);
    expect(l.remotoLigado()).toBe(true);
    expect((await requisicaoCrua({ ip: "127.0.0.1", porta: r.transporte.porta as number, caminho: "/v1/canal", corpo: "{}" })).status).toBe(401);
    expect([...segredos.keys()].sort()).toEqual(["REMOTO_IDENTIDADE_PRIVADA", "REMOTO_IDENTIDADE_PUBLICA"]); // identidade só no cofre (porta de segredos)
    await l.encerrar();
    await expect(requisicaoCrua({ ip: "127.0.0.1", porta: r.transporte.porta as number, caminho: "/v1/canal", corpo: "{}" })).rejects.toBeTruthy();
    expect(JSON.stringify(banco.consultar("SELECT * FROM jarvis_auditoria"))).not.toMatch(/PRIVATE|REMOTO_IDENTIDADE/);
  });
  it("desligarRemoto (bandeja) fecha o servidor sem revogar; panicoRemoto revoga; sem núcleo montado nada acontece", async () => {
    const { l } = cenario();
    await l.desligarRemoto();
    await l.panicoRemoto();
    await l.remoto.ligar({ transporte: "loopback", interface: "auto", consentimento_versao: TEXTO_CONSENTIMENTO_REMOTO_VERSAO });
    await l.desligarRemoto();
    expect(l.remotoLigado()).toBe(false);
  });
});
