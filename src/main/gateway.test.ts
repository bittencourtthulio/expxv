// Gateway no main (Fase 7C) com Loja REAL (SQLite em memória, catálogo/npm falsos, servidor MCP falso por stdio de verdade) e o repositório SQLite real.
// Cobre: ponta a ponta Loja→gateway (segredo resolvido no main), snapshot persistido e reidratado após "restart" (R-3), gate, revogação, tela (ferramentas/filtro/config/auditoria).
import { afterEach, describe, expect, it } from "vitest";
import type { EventoGateway } from "../compartilhado/catalogo";
import { abrirBanco, type Banco } from "../nucleo/banco/banco";
import { migrar } from "../nucleo/banco/migrar";
import { criarRepoCatalogoMcp } from "../nucleo/banco/repos/catalogo-mcp";
import { criarRepoGateway } from "../nucleo/banco/repos/gateway";
import { desserializarPane, serializarPane } from "../nucleo/gateway-mcp/persistencia";
import { limparPastas } from "../../tests/fixtures/mcp-loja/apoio-ciclo";
import { montarLoja } from "../../tests/fixtures/mcp-loja/apoio-main";
import { criarGatewayMain, type GatewayMain } from "./gateway";

const abertos: Banco[] = [];
const gws: GatewayMain[] = [];
afterEach(async () => {
  while (gws.length) await gws.pop()?.encerrar();
  abertos.splice(0).forEach((b) => b.fechar());
  limparPastas();
});

const TS = "2026-10-01T00:00:00.000Z";

function ambiente() {
  const banco = abrirBanco(":memory:");
  abertos.push(banco);
  migrar(banco);
  banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_01J8ZXAMPLE0000000000000A1','n','/raiz','t','t')");
  const ws = "ws_01J8ZXAMPLE0000000000000A1";
  let n = 0;
  /** linha de `pane` (a FK de `gateway_pane` exige o Pane; no app ele já existe quando o lançamento é preparado) */
  const painel = (id: string): void => {
    banco.executar("INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,papel,eh_piloto,estado,criado_em,atualizado_em) VALUES (?,NULL,?,?,'cli','nenhum',0,'pronto',?,?)", [id, ws, ++n, TS, TS]);
  };
  return { banco, ws, painel, repo: criarRepoGateway(banco), repoLoja: criarRepoCatalogoMcp(banco) };
}

async function montar() {
  const a = ambiente();
  const vivos = new Set<string>();
  for (const id of ["pane_1", "pane_9"]) a.painel(id);
  const persistencia = await import("../nucleo/gateway-mcp/persistencia");
  const loja = montarLoja({
    repo: a.repoLoja,
    paneAtivo: (id) => vivos.has(id),
    raizDoWorkspace: (id) => (id === a.ws ? "/raiz" : null),
    extras: {
      persistirSnapshot: (paneId, s) => a.repo.gravarPane(persistencia.serializarPane({ pane_id: paneId, workspace_id: s.workspace_id, mission_id: s.mission_id, papel: s.papel, modo: s.modo, via: "loja", ids: s.ids, agente_id: s.agente_id, raiz: s.raiz }, "/raiz", Date.now())),
      reidratarSnapshot: (paneId) => {
        const reg = a.repo.obterPane(paneId);
        const p = reg === null ? null : persistencia.desserializarPane(reg, "loja", "/raiz", Date.now());
        return p === null || p.raiz === null ? null : { workspace_id: p.workspace_id, mission_id: p.mission_id, modo: p.modo, agente_id: p.agente_id, papel: p.papel, ids: p.ids, raiz: p.raiz };
      },
      esquecerSnapshotPersistido: (paneId) => a.repo.removerPane(paneId),
    },
  });
  await loja.instalar("falso-ok");
  expect(await loja.loja.habilitar("falso-ok", "workspace", loja.ws, true)).toMatchObject({ ok: true });
  const eventos: EventoGateway[] = [];
  const novoGateway = (): GatewayMain => {
    const g = criarGatewayMain({
      repo: a.repo, loja: () => loja.loja, paneAtivo: (id) => vivos.has(id), raizDoWorkspace: (id) => (id === a.ws ? "/raiz" : null),
      emitirRenderer: (e) => eventos.push(e),
      ferramentasConhecidas: (id) => a.repoLoja.ferramentasDe(id).map((f) => ({ nome: f.nome, descricao: f.descricao })),
    });
    gws.push(g);
    return g;
  };
  return { ...a, loja, vivos, eventos, novoGateway };
}

const alvo = (m: Awaited<ReturnType<typeof montar>>, paneId: string, extra: Record<string, unknown> = {}) => ({ ...m.loja.alvo(paneId), papel: "executor", ...extra });

describe("gateway no main: ponta a ponta com a Loja", () => {
  it("desligado por padrão: o Pane não ganha snapshot e a Loja segue direta", async () => {
    const m = await montar();
    m.vivos.add("pane_1");
    const g = m.novoGateway();
    expect(g.ativoPara(m.ws)).toBe(false);
    expect(await g.registrarPane(alvo(m, "pane_1"))).toBeNull();
    expect(m.repo.obterPane("pane_1")).toBeNull();
    expect(g.gate("pane_1", "mcp__ev_gateway__falso_ok__eco").permitido).toBe(false);
  });

  it("ligado: registra o Pane, lista e chama ferramentas do servidor REAL pela Loja (comando resolvido no main) e audita sem argumentos", async () => {
    const m = await montar();
    m.vivos.add("pane_1");
    m.repo.gravarConfig({ workspace_id: m.ws, ativo: true, modo_superficie: "completo", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 }, TS);
    const g = m.novoGateway();
    expect(await g.registrarPane(alvo(m, "pane_1"))).toEqual({ ids: ["falso-ok"] });
    const { tools } = await g.listar("pane_1");
    expect(tools.map((t) => t.name).sort()).toEqual(["falso_ok__eco", "falso_ok__hora_falsa", "falso_ok__soma"]);
    const r = await g.chamar("pane_1", "falso_ok__eco", { texto: "ARGUMENTO-SIGILOSO" });
    expect(r.content[0]!.text).toBe("ARGUMENTO-SIGILOSO");
    const aud = g.auditoria({ workspace_id: m.ws, limite: 10 });
    expect(aud[0]).toMatchObject({ pane_id: "pane_1", servidor_id: "falso-ok", ferramenta: "eco", decisao: "permitida" });
    expect(JSON.stringify(aud)).not.toContain("ARGUMENTO-SIGILOSO");
    expect(g.estado()).toMatchObject({ chamadas: 1, panes_ativos: 1, servidores_conectados: 1 });
    expect(m.eventos.some((e) => e.tipo === "chamada")).toBe(true);
    expect(g.gate("pane_1", "mcp__ev_gateway__falso_ok__eco").permitido).toBe(true);
    expect(g.gate("pane_1", "mcp__ev_outro__x").permitido).toBe(true); // não é do gateway: não decide
    expect(g.gate("pane_zzz", "mcp__ev_gateway__x").permitido).toBe(false);
  });

  it("R-3: depois de um RESTART (memória nova, mesmo banco) o Pane vivo mantém o gateway e o gate; Pane encerrado ou vencido não", async () => {
    const m = await montar();
    m.vivos.add("pane_1");
    m.repo.gravarConfig({ workspace_id: m.ws, ativo: true, modo_superficie: "completo", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 }, TS);
    const antes = m.novoGateway();
    await antes.registrarPane(alvo(m, "pane_1"));
    const reg = m.repo.obterPane("pane_1")!;
    expect(reg.dados_json).not.toMatch(/token|segredo|\/raiz/i); // nada de credencial nem caminho absoluto
    await antes.encerrar();
    const depois = m.novoGateway(); // "app reiniciado"
    expect(depois.estado().panes_ativos).toBe(0);
    expect(depois.gate("pane_1", "mcp__ev_gateway__falso_ok__eco").permitido).toBe(true);
    expect((await depois.listar("pane_1")).tools).toHaveLength(3);
    expect((await depois.chamar("pane_1", "falso_ok__soma", { a: 2, b: 3 })).content[0]!.text).toBe("5");
    // Pane encerrado depois do restart: sem acesso
    const outro = m.novoGateway();
    m.vivos.delete("pane_1");
    expect(outro.gate("pane_1", "mcp__ev_gateway__x").permitido).toBe(false);
    expect(await outro.listar("pane_1")).toEqual({ tools: [] });
    await expect(outro.chamar("pane_1", "falso_ok__eco", {})).rejects.toMatchObject({ code: "unavailable" });
  });

  it("R-3 (snapshot vencido): linha expirada não vira acesso e é podada no ocioso", async () => {
    const m = await montar();
    m.vivos.add("pane_1");
    m.repo.gravarPane(serializarPane({ pane_id: "pane_1", workspace_id: m.ws, mission_id: null, papel: "executor", modo: "livre", via: "gateway", ids: ["falso-ok"], agente_id: null, raiz: "/raiz" }, "/raiz", Date.now() - 48 * 3_600_000));
    m.repo.gravarConfig({ workspace_id: m.ws, ativo: true, modo_superficie: "completo", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 }, TS);
    const g = m.novoGateway();
    expect(g.gate("pane_1", "mcp__ev_gateway__x").permitido).toBe(false);
    g.ocioso();
    expect(m.repo.obterPane("pane_1")).toBeNull();
  });

  it("R-3 (Loja direta): o snapshot da Loja também é persistido e reidratado; gate e segredos voltam após o restart", async () => {
    const m = await montar();
    m.vivos.add("pane_9");
    const inj = await m.loja.loja.resolver(m.loja.alvo("pane_9"));
    expect(inj?.ids).toEqual(["falso-ok"]);
    expect(m.loja.loja.gate("pane_9", "mcp__ev_falso_ok__eco").permitido).toBe(true);
    const reg = m.repo.obterPane("pane_9")!;
    expect(JSON.parse(reg.dados_json).via).toBe("loja");
    // "restart": nova Loja sobre o MESMO banco, sem snapshot em memória
    const persistencia = await import("../nucleo/gateway-mcp/persistencia");
    const nova = montarLoja({
      repo: m.repoLoja, userData: m.loja.userData, paneAtivo: (id) => id === "pane_9", raizDoWorkspace: (id) => (id === m.ws ? "/raiz" : null),
      extras: {
        reidratarSnapshot: (paneId) => {
          const r = m.repo.obterPane(paneId);
          const p = r === null ? null : persistencia.desserializarPane(r, "loja", "/raiz", Date.now());
          return p === null || p.raiz === null ? null : { workspace_id: p.workspace_id, mission_id: p.mission_id, modo: p.modo, agente_id: p.agente_id, papel: p.papel, ids: p.ids, raiz: p.raiz };
        },
        esquecerSnapshotPersistido: (paneId) => m.repo.removerPane(paneId),
      },
    });
    expect(nova.loja.gate("pane_9", "mcp__ev_falso_ok__eco").permitido).toBe(true);
    expect(nova.loja.gate("pane_9", "mcp__ev_outro__x").permitido).toBe(false);
    // sem a reidratação (comportamento antigo) o gate nega: é o R-3
    expect(montarLoja({ repo: m.repoLoja, userData: m.loja.userData, paneAtivo: () => true }).loja.gate("pane_9", "mcp__ev_falso_ok__eco").permitido).toBe(false);
    // Pane encerrado: o snapshot persistido some e não ressuscita
    m.loja.loja.liberar("pane_9");
    m.vivos.delete("pane_9");
    m.loja.loja.liberar("pane_9");
    expect(m.repo.obterPane("pane_9")).toBeNull();
  });

  it("servidor desinstalado/bloqueado depois do lançamento sai do gateway na hora", async () => {
    const m = await montar();
    m.vivos.add("pane_1");
    m.repo.gravarConfig({ workspace_id: m.ws, ativo: true, modo_superficie: "completo", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 }, TS);
    const g = m.novoGateway();
    await g.registrarPane(alvo(m, "pane_1"));
    expect((await g.listar("pane_1")).tools).toHaveLength(3);
    await m.loja.loja.desinstalar("falso-ok", false);
    expect((await g.listar("pane_1")).tools).toEqual([]);
    await expect(g.chamar("pane_1", "falso_ok__eco", { texto: "x" })).rejects.toMatchObject({ code: "rule_violation", subcode: "forbidden_role" });
  });

  it("revogarPane corta o acesso e emite evento; liberar apaga o snapshot persistido de Pane encerrado", async () => {
    const m = await montar();
    m.vivos.add("pane_1");
    m.repo.gravarConfig({ workspace_id: m.ws, ativo: true, modo_superficie: "completo", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300 }, TS);
    const g = m.novoGateway();
    await g.registrarPane(alvo(m, "pane_1"));
    expect(g.revogarPane("pane_1")).toEqual({ ok: true });
    expect(await g.listar("pane_1")).toEqual({ tools: [] });
    expect(m.eventos.some((e) => e.tipo === "pane_revogado")).toBe(true);
    await g.registrarPane(alvo(m, "pane_1"));
    m.vivos.delete("pane_1");
    g.liberar("pane_1");
    expect(m.repo.obterPane("pane_1")).toBeNull();
  });

  it("modo squad: tela mostra o risco; regra explícita por papel liga a escrita só para aquele papel; auditoria e config persistem", async () => {
    const m = await montar();
    const g = m.novoGateway();
    expect(g.configLer(m.ws)).toMatchObject({ ativo: false, modo_superficie: "reduzido", max_ferramentas: 40, limite_por_min: 60, ocioso_s: 300, atualizado_em: null });
    const cfg = g.configGravar({ workspace_id: m.ws, ativo: true, modo_superficie: "busca", max_ferramentas: 10, limite_por_min: 5, ocioso_s: 60 });
    expect(cfg).toMatchObject({ ativo: true, modo_superficie: "busca", limite_por_min: 5 });
    const lista = await g.ferramentas({ workspace_id: m.ws, servidor_id: "falso-ok", papel: "executor" });
    expect(lista.map((f) => f.nome).sort()).toEqual(["eco", "hora_falsa", "soma"]);
    expect(lista.find((f) => f.nome === "eco")).toMatchObject({ risco: "desconhecido", habilitada: false, explicita: false });
    g.filtroDefinir({ workspace_id: m.ws, servidor_id: "falso-ok", ferramenta: "eco", papel: "executor", habilitada: true });
    const depois = await g.ferramentas({ workspace_id: m.ws, servidor_id: "falso-ok", papel: "executor" });
    expect(depois.find((f) => f.nome === "eco")).toMatchObject({ habilitada: true, explicita: true });
    expect((await g.ferramentas({ workspace_id: m.ws, servidor_id: "falso-ok", papel: "revisor" })).find((f) => f.nome === "eco")).toMatchObject({ habilitada: false });
  });

  it("poda: auditoria com mais de 30 dias sai", async () => {
    const m = await montar();
    const g = m.novoGateway();
    const velha = new Date(Date.now() - 40 * 86_400_000).toISOString();
    m.repo.registrarAuditoria({ id: "gwa_velha", em: velha, workspace_id: m.ws, pane_id: "p", papel: "executor", servidor_id: null, ferramenta: null, decisao: "permitida", duracao_ms: 1, bytes_entrada: 1, bytes_saida: 1 });
    m.repo.registrarAuditoria({ id: "gwa_nova", em: new Date().toISOString(), workspace_id: m.ws, pane_id: "p", papel: "executor", servidor_id: null, ferramenta: null, decisao: "permitida", duracao_ms: 1, bytes_entrada: 1, bytes_saida: 1 });
    g.ocioso();
    expect(g.auditoria({ workspace_id: null, limite: 10 }).map((e) => e.id)).toEqual(["gwa_nova"]);
  });
});

describe("persistência: corpo adulterado nunca vira acesso", () => {
  it("linha com id de servidor inválido ou via trocada é ignorada na hidratação", () => {
    const reg = serializarPane({ pane_id: "p", workspace_id: "w", mission_id: null, papel: "executor", modo: "livre", via: "gateway", ids: ["a"], agente_id: null, raiz: null }, null, 1);
    expect(desserializarPane({ ...reg, dados_json: JSON.stringify({ via: "gateway", ids: ["A B"], raiz_rel: null }) }, "gateway", null, 2)).toBeNull();
    expect(desserializarPane(reg, "loja", null, 2)).toBeNull();
  });
});
