import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gerarCasa, SEGREDOS, type CasaGerada } from "../../../tests/fixtures/catalogo/gerar";
import type { EventoCatalogo } from "../../compartilhado/catalogo";
import { abrirBanco, type Banco } from "../banco/banco";
import { migrar } from "../banco/migrar";
import { criarRepoCatalogo } from "../banco/repos/catalogo";
import { lerManifesto } from "./embarcadas/manifesto";
import { criarServicoCatalogo, type ServicoCatalogo } from "./servico";
import type { ClienteVarredura } from "./worker";
import { tratarPedido } from "./worker";
import type { ItemAgregado } from "./varredura";

const WS = "ws_T1";
let raiz: string;
let casa: CasaGerada;
let banco: Banco;
let svc: ServicoCatalogo;
let eventos: EventoCatalogo[];
let barramento: Array<[string, unknown]>;
let chamadasWorker: number;
const cache = new Map();
const lixo: string[] = [];

/** Cliente falso: executa o MESMO código do worker, em processo. */
function clienteFalso(): ClienteVarredura {
  return {
    varrer(p, g) {
      chamadasWorker++;
      const itens: ItemAgregado[] = [];
      const ac = new AbortController();
      const resultado = new Promise<never>((ok) => {
        let fila: Promise<void> = Promise.resolve();
        void tratarPedido({ ...p, id: 1, tipo: "varrer" }, cache, ac.signal, (m) => {
          if (m.tipo === "progresso") g.onProgresso?.(m.progresso);
          else if (m.tipo === "lote") { itens.push(...m.itens); fila = fila.then(() => g.onLote?.(m.itens)); }
          else if (m.tipo === "fim") void fila.then(() => (ok as (v: unknown) => void)({ itens, erros: m.erros, duracao_ms: m.duracao_ms, cancelada: m.cancelada, cobertura: m.cobertura }));
        });
      });
      return { id: 1, resultado };
    },
    cancelar: () => undefined,
    encerrar: async () => undefined,
  };
}

beforeEach(async () => {
  raiz = mkdtempSync(join(tmpdir(), "cat-svc-"));
  casa = gerarCasa(raiz, { skills: 10 });
  banco = abrirBanco(":memory:");
  migrar(banco);
  eventos = [];
  barramento = [];
  chamadasWorker = 0;
  cache.clear();
  lixo.length = 0;
  const repo = criarRepoCatalogo(banco);
  svc = criarServicoCatalogo({
    repo, cliente: clienteFalso, home: () => casa.home, workspaces: () => [{ id: WS, raiz: casa.workspace }],
    manifesto: () => lerManifesto(join(__dirname, "..", "..", "..", "resources", "skills")), dirSkills: () => join(__dirname, "..", "..", "..", "resources", "skills"),
    emitir: (e) => eventos.push(e), barramento: (n, p) => barramento.push([n, p]), lixeira: async (a) => void lixo.push(a), revelar: () => undefined,
  });
});
afterEach(() => {
  banco.fechar();
  rmSync(raiz, { recursive: true, force: true });
});

const varrer = async (): Promise<void> => svc.varrer({ workspace_id: null, tipos: null, clis: null }).pronta;
const skill = (nome: string) => svc.listar({ tipo: "skill", workspace_id: WS }).itens.find((i) => i.nome === nome);

describe("serviço do catálogo", () => {
  it("varre, persiste, emite concluido/mudou e registra o histórico", async () => {
    await varrer();
    expect(skill("comum-0")?.instalacoes.map((i) => i.cli).sort()).toEqual(["claude", "codex", "opencode", "portatil"]);
    const l = svc.listar({ tipo: "skill", workspace_id: WS });
    expect(l.ultima_varredura_em).not.toBeNull();
    expect(eventos.map((e) => e.tipo_evento)).toEqual(expect.arrayContaining(["progresso", "concluido", "mudou"]));
    const c = eventos.find((e) => e.tipo_evento === "concluido");
    expect(c && "adicionados" in c && c.adicionados).toBeGreaterThan(30);
    expect(barramento.map(([n]) => n)).toEqual(expect.arrayContaining(["catalog.scanned", "catalog.changed"]));
    expect(svc.precisaVarrer(60_000)).toBe(false);
  });

  it("duas varreduras simultâneas coalescem em uma", async () => {
    const a = svc.varrer({ workspace_id: null, tipos: null, clis: null });
    const b = svc.varrer({ workspace_id: null, tipos: null, clis: null });
    expect(b.varredura_id).toBe(a.varredura_id);
    await a.pronta;
    expect(chamadasWorker).toBe(1);
  });

  it("skill removida do disco vira 'ausente' (nada apagado); limpar ausentes remove só ausentes", async () => {
    await varrer();
    rmSync(join(casa.home, ".codex", "skills", "codex-sk-1"), { recursive: true });
    await varrer();
    expect(skill("codex-sk-1")?.instalacoes[0]?.estado).toBe("ausente");
    expect(svc.removerDoCatalogo(skill("comum-0")!.id).ok).toBe(false);
    expect(svc.limparAusentes("skill").removidos).toBe(1);
    expect(skill("codex-sk-1")).toBeUndefined();
    expect(skill("comum-0")).toBeDefined();
  });

  it("instalar em outra CLI: symlink, 'ja_instalado' na repetição, linha atualizada e a fonte intacta", async () => {
    await varrer();
    const it = skill("do-projeto")!;
    const r = await svc.instalar({ item_id: it.id, de_cli: "claude", para_cli: "codex", modo: "symlink" });
    expect(r).toMatchObject({ estado: "instalado", caminho_rel: ".codex/skills/do-projeto" });
    expect(lstatSync(join(casa.home, ".codex", "skills", "do-projeto")).isSymbolicLink()).toBe(true);
    expect((await svc.instalar({ item_id: it.id, de_cli: "claude", para_cli: "codex", modo: "symlink" })).estado).toBe("ja_instalado");
    const inst = skill("do-projeto")!.instalacoes.find((i) => i.cli === "codex");
    expect(inst).toMatchObject({ escopo: "global", criado_pelo_app: true, metodo: "symlink" });
    // re-varredura reconhece o symlink como instalação nativa-symlink sem perder o selo "criado pelo app"
    await varrer();
    expect(skill("do-projeto")!.instalacoes.find((i) => i.cli === "codex")).toMatchObject({ estado: "presente", criado_pelo_app: true });
    expect((await svc.desinstalar({ item_id: it.id, cli: "codex", escopo: "global", workspace_id: null, modo: "remover_criado" })).ok).toBe(true);
    expect(existsSync(join(casa.home, ".codex", "skills", "do-projeto"))).toBe(false);
    expect(existsSync(join(casa.workspace, ".claude", "skills", "do-projeto", "SKILL.md"))).toBe(true);
  });

  it("recusas: skill do método, tipo não suportado, CLI sem skills, mesma CLI", async () => {
    await varrer();
    const m = skill("sprintx")!;
    expect((await svc.instalar({ item_id: m.id, de_cli: "claude", para_cli: "codex", modo: "symlink" })).codigo).toBe("gerenciado_pelo_metodo");
    expect((await svc.instalar({ item_id: m.id, de_cli: "claude", para_cli: "gemini", modo: "symlink" })).codigo).toBe("cli_sem_skills");
    expect((await svc.instalar({ item_id: m.id, de_cli: "claude", para_cli: "claude", modo: "symlink" })).codigo).toBe("mesma_cli");
    const ag = svc.listar({ tipo: "agent", workspace_id: WS }).itens[0]!;
    expect((await svc.instalar({ item_id: ag.id, de_cli: "claude", para_cli: "codex", modo: "symlink" })).codigo).toBe("tipo_nao_suportado");
    expect((await svc.desinstalar({ item_id: m.id, cli: "claude", escopo: "projeto", workspace_id: WS, modo: "lixeira" })).codigo).toBe("gerenciado_pelo_metodo");
    expect((await svc.instalar({ item_id: "cat_nao_existe", de_cli: "claude", para_cli: "codex", modo: "symlink" })).codigo).toBe("item_inexistente");
  });

  it("segurança: nenhum segredo da fixture em nenhuma tabela, evento ou barramento", async () => {
    await varrer();
    const dump: string[] = [];
    for (const t of banco.consultar<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")) dump.push(JSON.stringify(banco.consultar(`SELECT * FROM ${t.name}`)));
    dump.push(JSON.stringify(eventos), JSON.stringify(barramento));
    for (const m of svc.listar({ tipo: "mcp_server", workspace_id: WS }).itens) dump.push(JSON.stringify(svc.detalhe(m.id)));
    const tudo = dump.join("\n");
    for (const s of SEGREDOS) expect(tudo).not.toContain(s.replace(/^Bearer /, ""));
    expect(tudo).not.toContain(casa.home);
    expect(tudo).not.toContain(casa.workspace);
  });

  it("descrição de skill maliciosa chega saneada e sem instrução executável", async () => {
    await varrer();
    const d = svc.detalhe(skill("malvada")!.id)?.descricao ?? "";
    expect(d).not.toMatch(/[‮\u001b]/);
    expect(d.length).toBeLessThanOrEqual(600);
  });

  it("política: grava, lista e valida nomes; prévia livre sem filtro e squad com mínimo do papel", async () => {
    await varrer();
    const ws = banco.consultarUm<{ n: number }>("SELECT COUNT(*) n FROM workspace");
    expect(ws?.n).toBe(0);
    banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [WS, "w", casa.workspace, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
    const p = svc.politicaGravar({ workspace_id: WS, alvo_tipo: "papel", alvo_valor: "executor", skills: ["comum-0", "do-projeto", "nao-existe-x"], mcp_do_usuario: "nenhum", servidores_mcp: [] });
    expect(p.skills).toHaveLength(3);
    expect(() => svc.politicaGravar({ workspace_id: WS, alvo_tipo: "papel", alvo_valor: "executor", skills: ["../x"], mcp_do_usuario: "nenhum", servidores_mcp: [] })).toThrow();
    expect(svc.politicaLer(WS)).toHaveLength(1);
    const livre = await svc.politicaPrevia({ workspace_id: WS, modo: "livre", papel: "executor", agente_id: null, mission_id: null, cli: "claude" });
    expect(livre.skills).toBeNull();
    const squad = await svc.politicaPrevia({ workspace_id: WS, modo: "squad", papel: "executor", agente_id: null, mission_id: null, cli: "codex" });
    expect(squad.skills).toEqual(expect.arrayContaining(["comum0", "doprojeto", "evbuilder"].filter((x) => x !== "evbuilder")));
    expect(squad.faltando).toEqual(["nao-existe-x"].map((x) => expect.stringContaining("nao")));
    expect(squad.isolamento.codex).toBe("parcial");
    expect(squad.isolamento.claude).toBe("duro");
  });

  it("saúde: política com skill inexistente acusa antes de qualquer Pane; máquina limpa sem política = zero erros", async () => {
    await varrer();
    expect(svc.saude(WS).filter((a) => a.nivel === "erro" && a.codigo !== "symlink_quebrado")).toEqual([]);
    banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES (?,?,?,?,?)", [WS, "w", casa.workspace, "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
    svc.politicaGravar({ workspace_id: WS, alvo_tipo: "papel", alvo_valor: "executor", skills: ["fantasma"], mcp_do_usuario: "nenhum", servidores_mcp: [] });
    expect(svc.saude(WS).some((a) => a.codigo === "skill_inexistente" && a.item === "fantasma")).toBe(true);
  });

  it("verificar_mcp exige confirmação e não vaza configuração", async () => {
    await varrer();
    const m = svc.listar({ tipo: "mcp_server", workspace_id: WS }).itens.find((i) => i.nome === "local")!;
    await expect(svc.verificarMcp(m.id, false as unknown as true)).rejects.toThrow();
    const verificar = vi.fn(async (_c: unknown, _s: AbortSignal) => [{ name: "t1", description: "d" }]);
    const svc2 = criarServicoCatalogo({ repo: criarRepoCatalogo(banco), cliente: clienteFalso, home: () => casa.home, workspaces: () => [{ id: WS, raiz: casa.workspace }], manifesto: async () => ({ manifest_version: 0, skills: [] }), dirSkills: () => "", emitir: () => undefined, listarFerramentasMcp: verificar });
    const r = await svc2.verificarMcp(m.id, true);
    expect(r).toEqual({ estado: "ok", ferramentas: 1, erro: null });
    expect(JSON.stringify(verificar.mock.calls[0]?.[0])).toContain(SEGREDOS[0]); // lido na hora, em memória
    expect(JSON.stringify(banco.consultar("SELECT * FROM catalogo_mcp_tool"))).not.toContain(SEGREDOS[0]);
    expect(svc.detalhe(m.id)?.ferramentas.map((f) => f.nome)).toEqual(["t1"]);
  });

  it("embarcadas: sem ação nada é criado na casa; instalar e opt-out por serviço", async () => {
    await varrer();
    expect(existsSync(join(casa.home, ".agents"))).toBe(false);
    const e = await svc.embarcadasEstado();
    expect(e).toHaveLength(7);
    await svc.embarcadasOptOut("ev-guide", "portatil", true);
    const r = await svc.embarcadasInstalar(null, "portatil");
    expect(r.instaladas).toHaveLength(6);
    expect(readFileSync(join(casa.home, ".agents", "skills", "ev-scout", "SKILL.md"), "utf8")).toContain("Explorador");
    mkdirSync(join(casa.home, "x"), { recursive: true });
  });
});
