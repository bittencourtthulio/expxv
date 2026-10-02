// Serviço de atualização contra o servidor FALSO e backends falsos (T-21.16, T-21.15). Cobre AU-11, AU-12, AU-13, AU-24 e AU-26.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_ATUALIZACAO_PADRAO, CONSENTIMENTO_ATUALIZACAO_VERSAO, type AtualizacaoEvento, type ConfigAtualizacao, type EstadoAtualizacao } from "../../compartilhado/atualizacao";
import { CHAVES_ACEITAS_DE_TESTE } from "../../../tests/fixtures/atualizacao/chaves-de-teste";
import { subirFeedFalso, type FeedFalso, type OpcoesFeedFalso } from "../../../tests/fixtures/atualizacao/servidor-falso";
import { criarClienteRede, criarRegistroConsentimento } from "../rede";
import { criarBackendDownloadVerificado } from "./backends/download-verificado";
import { criarBackendManual, urlDeDownload } from "./backends/manual";
import { carregarSePermitido, decidirCarregamento } from "./gate";
import { avaliarInstalacao } from "./guarda-instalacao";
import { criarBackendFalso, type BackendAtualizacao } from "./io/backend";
import { criarClienteFeed } from "./io/feed";
import { transporteDoClienteRede } from "./io/transporte";
import { criarServicoAtualizacao, type EstadoPersistido, type ServicoAtualizacao } from "./servico";

const ID_SENTINELA = "5f0c1a2e-aaaa-4bbb-8ccc-SENTINELA00001";
const feeds: FeedFalso[] = [];
let pasta = "";
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), "atualizador-servico-"));
});
afterEach(async () => {
  while (feeds.length) await (feeds.pop() as FeedFalso).fechar();
  rmSync(pasta, { recursive: true, force: true });
});

interface Amb {
  feed: FeedFalso;
  servico: ServicoAtualizacao;
  instalados: string[];
  historico: AtualizacaoEvento[];
  estados: EstadoAtualizacao[];
  persistido: EstadoPersistido;
  config: ConfigAtualizacao;
  relogio: { agora: Date };
  panes: { n: number };
  salvou: { n: number };
}
const LIGADA: ConfigAtualizacao = { ...CONFIG_ATUALIZACAO_PADRAO, ligada: true, consentimento_versao: CONSENTIMENTO_ATUALIZACAO_VERSAO };

async function montar(op: { feed?: OpcoesFeedFalso; config?: Partial<ConfigAtualizacao>; build?: boolean; backend?: (a: { transporte: ReturnType<typeof transporteDoClienteRede>; instalados: string[] }) => BackendAtualizacao; persistido?: Partial<EstadoPersistido>; guardado?: (v: string) => { caminho: string; artefato: any } | null } = {}): Promise<Amb> {
  const feed = await subirFeedFalso(op.feed);
  feeds.push(feed);
  const consentimento = criarRegistroConsentimento();
  consentimento.permitirHost(feed.host);
  const token = consentimento.conceder(feed.host, { permanente: true });
  const cliente = criarClienteRede({ consentimento, permitirLoopbackHttp: true });
  const transporte = transporteDoClienteRede(cliente, { host: feed.host, porta: feed.porta, token });
  const instalados: string[] = [];
  const config: ConfigAtualizacao = { ...LIGADA, ...op.config };
  const persistido: EstadoPersistido = { idInstalacao: ID_SENTINELA, ultimaVerificacaoEm: null, ultimoPublicadoEm: null, etag: null, revogadas: [], versoesInstaladas: [], ...op.persistido };
  const historico: AtualizacaoEvento[] = [];
  const estados: EstadoAtualizacao[] = [];
  const relogio = { agora: new Date("2026-10-01T12:00:00.000Z") };
  const panes = { n: 0 };
  const salvou = { n: 0 };
  let seq = 0;
  const backend = op.backend?.({ transporte, instalados }) ?? criarBackendDownloadVerificado({ transporte, caminhoBase: "/", instalador: async (c) => void instalados.push(c) });
  const servico = criarServicoAtualizacao({
    build: { habilitada: op.build ?? true, chavesAceitas: CHAVES_ACEITAS_DE_TESTE },
    versaoAtual: "1.0.0",
    plataforma: "darwin",
    arquitetura: "arm64",
    feed: criarClienteFeed({ transporte, caminhoBase: "/", timeoutMs: 500 }),
    backend,
    config: { ler: () => config },
    persistido: { ler: () => ({ ...persistido, revogadas: [...persistido.revogadas], versoesInstaladas: [...persistido.versoesInstaladas] }), gravar: (p) => void Object.assign(persistido, p) },
    relogio: () => relogio.agora,
    destinoDir: join(pasta, "updates"),
    panesTrabalhando: () => panes.n,
    protocoloDaemonAtual: 3,
    salvarEstadoDoApp: async () => void (salvou.n += 1),
    historico: (e) => void historico.push(e),
    aoMudar: (e) => void estados.push(e),
    novoId: () => `evt_${String(++seq).padStart(8, "0")}`,
    ...(op.guardado !== undefined ? { instaladorGuardado: op.guardado } : {}),
  });
  return { feed, servico, instalados, historico, estados, persistido, config, relogio, panes, salvou };
}
const manifestoPedidos = (a: Amb): number => a.feed.servidor.requisicoes.filter((r) => r.caminho.endsWith("manifesto.json")).length;

describe("duas chaves e consentimento (au12_desligado_zero_rede)", () => {
  it("chave de build desligada: nenhuma operação abre socket", async () => {
    const a = await montar({ build: false });
    expect(await a.servico.verificar({ manual: true })).toEqual({ ok: false, motivo: "desligado" });
    expect(await a.servico.baixar()).toEqual({ ok: false, motivo: "desligado" });
    expect(await a.servico.instalar({ confirmar_panes: true })).toEqual({ ok: false, motivo: "desligado" });
    expect(a.feed.servidor.conexoes()).toBe(0);
    expect(a.servico.estado().fase).toBe("desligado");
    expect(a.servico.estado().habilitada_no_build).toBe(false);
  });
  it("preferência desligada ou sem consentimento versionado: zero conexões", async () => {
    const a = await montar({ config: { ligada: false } });
    expect((await a.servico.verificar({ manual: true })).ok).toBe(false);
    const b = await montar({ config: { consentimento_versao: 0 } });
    expect(await b.servico.verificar({ manual: true })).toEqual({ ok: false, motivo: "sem_consentimento" });
    const c = await montar({ config: { consentimento_versao: CONSENTIMENTO_ATUALIZACAO_VERSAO + 1 } });
    expect(await c.servico.verificar({ manual: true })).toEqual({ ok: false, motivo: "sem_consentimento" });
    expect(a.feed.servidor.conexoes() + b.feed.servidor.conexoes() + c.feed.servidor.conexoes()).toBe(0);
  });
  it("o `import()` do módulo do atualizador nunca é chamado sem as duas chaves (espião)", async () => {
    let chamadas = 0;
    const importar = async () => {
      chamadas += 1;
      return { ok: true };
    };
    expect(await carregarSePermitido({ habilitadaNoBuild: false, config: LIGADA }, importar)).toEqual({ carregado: false, motivo: "desligado" });
    expect(await carregarSePermitido({ habilitadaNoBuild: true, config: { ligada: false, consentimento_versao: 1 } }, importar)).toEqual({ carregado: false, motivo: "desligado" });
    expect(await carregarSePermitido({ habilitadaNoBuild: true, config: { ligada: true, consentimento_versao: 0 } }, importar)).toEqual({ carregado: false, motivo: "sem_consentimento" });
    expect(chamadas).toBe(0);
    expect(decidirCarregamento({ habilitadaNoBuild: true, config: LIGADA })).toEqual({ carregar: true });
    expect((await carregarSePermitido({ habilitadaNoBuild: true, config: LIGADA }, importar)).carregado).toBe(true);
    expect(chamadas).toBe(1);
  });
});

describe("fluxo completo contra o servidor falso", () => {
  it("verificar → disponível → baixar → pronto → instalar (backend falso registra a chamada)", async () => {
    const a = await montar();
    expect(await a.servico.verificar({ manual: true })).toEqual({ ok: true });
    expect(a.servico.estado().fase).toBe("disponivel");
    expect(a.servico.estado().disponivel?.versao).toBe("1.1.0");
    expect(await a.servico.baixar()).toEqual({ ok: true });
    expect(a.servico.estado().fase).toBe("pronto");
    expect(await a.servico.instalar({ confirmar_panes: false })).toEqual({ ok: true });
    expect(a.instalados).toHaveLength(1);
    expect(a.salvou.n).toBe(1);
    expect(a.persistido.versoesInstaladas).toEqual(["1.0.0"]);
    expect(a.historico.map((e) => e.tipo)).toEqual(["disponivel", "baixada", "instalada"]);
    expect(a.estados.length).toBeGreaterThan(3);
  });

  it("au24_sem_identificador_na_rede: o idInstalacao e qualquer cookie nunca saem (todas as requisições do fluxo)", async () => {
    const a = await montar();
    await a.servico.verificar({ manual: true });
    await a.servico.baixar();
    const tudo = JSON.stringify(a.feed.servidor.requisicoes).toLowerCase();
    expect(tudo).not.toContain("sentinela");
    expect(tudo).not.toContain(ID_SENTINELA.toLowerCase());
    expect(tudo).not.toContain("cookie");
    expect(a.feed.servidor.requisicoes.length).toBeGreaterThanOrEqual(3);
  });

  it("au13_sem_download_automatico: verificar nunca baixa sozinho; só baixa se a pessoa marcou a opção", async () => {
    const a = await montar();
    await a.servico.verificar({ manual: true });
    expect(a.feed.contagem("/stable/1.1.0/app-universal.dmg")).toBe(0);
    expect(a.servico.estado().fase).toBe("disponivel");
    const b = await montar({ config: { baixar_automatico: true } });
    await b.servico.verificar({ manual: true });
    expect(b.feed.contagem("/stable/1.1.0/app-universal.dmg")).toBe(1);
    expect(b.servico.estado().fase).toBe("pronto");
    expect(b.instalados).toHaveLength(0); // baixar automático NUNCA instala
  });

  it("au11_nao_instala_com_pane_trabalhando: sem confirmação recusa e fica `pronto`; com confirmação instala", async () => {
    const a = await montar();
    await a.servico.verificar({ manual: true });
    await a.servico.baixar();
    a.panes.n = 2;
    expect(await a.servico.instalar({ confirmar_panes: false })).toEqual({ ok: false, motivo: "panes_trabalhando" });
    expect(a.instalados).toHaveLength(0);
    expect(a.salvou.n).toBe(0);
    expect(a.servico.estado().fase).toBe("pronto");
    expect(await a.servico.instalar({ confirmar_panes: true })).toEqual({ ok: true });
    expect(a.instalados).toHaveLength(1);
    expect(a.salvou.n).toBe(1);
  });

  it("guarda: protocolo do daemon diferente também exige confirmação; sem nada em trabalho e sem mudança, instala direto", () => {
    const base = { panesTrabalhando: 0, confirmarPanes: false, protocoloDaemonAtual: 3, protocoloDaemonNovo: null };
    expect(avaliarInstalacao(base)).toEqual({ ok: true, avisos: [] });
    expect(avaliarInstalacao({ ...base, protocoloDaemonNovo: 4 })).toEqual({ ok: false, motivo: "protocolo_do_daemon" });
    expect(avaliarInstalacao({ ...base, protocoloDaemonNovo: 4, confirmarPanes: true })).toEqual({ ok: true, avisos: ["protocolo_do_daemon"] });
    expect(avaliarInstalacao({ ...base, panesTrabalhando: 1 })).toEqual({ ok: false, motivo: "panes_trabalhando" });
    expect(avaliarInstalacao({ ...base, panesTrabalhando: 1, protocoloDaemonNovo: 3, confirmarPanes: true }).ok).toBe(true);
  });

  it("au26_arquivo_trocado_depois_do_download: o arquivo é reconferido antes de instalar; adulterado ⇒ recusa e some", async () => {
    const a = await montar();
    await a.servico.verificar({ manual: true });
    await a.servico.baixar();
    const caminho = join(pasta, "updates", "app-universal.dmg");
    const ruim = Buffer.from(readFileSync(caminho));
    ruim[5] = (ruim[5] as number) ^ 1;
    writeFileSync(caminho, ruim);
    expect(await a.servico.instalar({ confirmar_panes: true })).toEqual({ ok: false, motivo: "hash_diferente" });
    expect(a.instalados).toHaveLength(0);
    expect(existsSync(caminho)).toBe(false);
    expect(a.servico.estado().fase).toBe("erro");
  });

  it("≤ 1 verificação automática por 24 h (relógio injetado); a manual sempre vale; falha de pedido não consome a janela se nem chegou a ocorrer", async () => {
    const a = await montar();
    expect(await a.servico.verificar()).toEqual({ ok: true });
    expect(manifestoPedidos(a)).toBe(1);
    expect(await a.servico.verificar()).toEqual({ ok: false, motivo: "ja_atual" });
    a.relogio.agora = new Date(a.relogio.agora.getTime() + 23 * 3_600_000);
    expect(await a.servico.verificar()).toEqual({ ok: false, motivo: "ja_atual" });
    expect(manifestoPedidos(a)).toBe(1);
    expect(await a.servico.verificar({ manual: true })).toEqual({ ok: true });
    expect(manifestoPedidos(a)).toBe(2);
    a.relogio.agora = new Date(a.relogio.agora.getTime() + 25 * 3_600_000);
    expect(await a.servico.verificar()).toEqual({ ok: true });
    expect(manifestoPedidos(a)).toBe(3);
  });

  it("304: com ETag guardada o manifesto não é reprocessado e o estado volta a ocioso", async () => {
    const a = await montar({ feed: { cenario: "304" }, persistido: { etag: '"manifesto-v1"' } });
    expect(await a.servico.verificar({ manual: true })).toEqual({ ok: true });
    expect(a.servico.estado().fase).toBe("ocioso");
    expect(a.feed.contagem("/stable/manifesto.json.sig")).toBe(0);
  });

  it.each([
    ["downgrade", "downgrade"],
    ["assinatura_invalida", "assinatura_invalida"],
    ["canal_cruzado", "canal_cruzado"],
    ["expirado", "expirado"],
    ["redirecionamento", "redirecionamento_recusado"],
    ["laco_3xx", "redirecionamento_recusado"],
    ["infinito", "servidor_hostil"],
    ["lento", "servidor_hostil"],
  ] as const)("cenário hostil %s ⇒ recusa nominal %s, estado `erro`, nada baixado, nunca lança", async (cenario, motivo) => {
    const a = await montar({ feed: { cenario } });
    const r = await a.servico.verificar({ manual: true });
    expect(r).toEqual({ ok: false, motivo });
    expect(a.servico.estado().fase).toBe("erro");
    expect(a.servico.estado().motivo).toBe(motivo);
    expect(a.servico.estado().disponivel).toBeUndefined();
    expect(a.instalados).toHaveLength(0);
    expect(a.historico.at(-1)?.tipo).toMatch(/recusada|verificacao_falhou/);
  });

  it("cenário `atual` (mesma versão): nada a fazer; replay de manifesto mais antigo é recusado (au05)", async () => {
    const a = await montar({ feed: { cenario: "atual" } });
    expect(await a.servico.verificar({ manual: true })).toEqual({ ok: true });
    expect(a.servico.estado().fase).toBe("ocioso");
    const b = await montar({ persistido: { ultimoPublicadoEm: "2026-09-30T13:00:00.000Z" } });
    expect(await b.servico.verificar({ manual: true })).toEqual({ ok: false, motivo: "manifesto_antigo" });
  });

  it("o estado monotônico só avança com manifesto aceito: publicado_em e ETag gravados depois do sucesso", async () => {
    const a = await montar();
    await a.servico.verificar({ manual: true });
    expect(a.persistido.ultimoPublicadoEm).toBe("2026-09-30T12:00:00.000Z");
    expect(a.persistido.etag).toBe('"manifesto-v1"');
    const b = await montar({ feed: { cenario: "assinatura_invalida" } });
    await b.servico.verificar({ manual: true });
    expect(b.persistido.ultimoPublicadoEm).toBeNull();
  });

  it("cancelar durante o download volta a `disponivel` e não deixa parcial", async () => {
    const a = await montar({ feed: { cenario: "lento" } });
    // manifesto do cenário lento nunca termina: usa um feed normal e um backend que trava
    const b = await montar({
      backend: () => ({
        nome: "falso",
        capacidades: { baixa: true, instala: true },
        baixar: (p) => new Promise((_ok, ruim) => p.sinal.addEventListener("abort", () => ruim(Object.assign(new Error("abort"), { name: "AbortError" })))),
        instalar: async () => undefined,
      }),
    });
    expect(a.servico.estado().fase).toBe("desligado");
    await b.servico.verificar({ manual: true });
    const p = b.servico.baixar();
    setTimeout(() => b.servico.cancelar(), 50);
    expect(await p).toEqual({ ok: false, motivo: "cancelado" });
    expect(b.servico.estado().fase).toBe("disponivel");
  });
});

describe("reversão (au02: só versão já instalada antes)", () => {
  it("recusa versão nunca instalada, versão maior que a atual e sem instalador guardado", async () => {
    const a = await montar({ persistido: { versoesInstaladas: ["0.9.0"] }, guardado: () => null });
    expect(await a.servico.reverter({ versao: "0.8.0" })).toEqual({ ok: false, motivo: "versao_nao_instalada_antes" });
    expect(await a.servico.reverter({ versao: "0.9.0" })).toEqual({ ok: false, motivo: "versao_nao_instalada_antes" });
    const b = await montar({ persistido: { versoesInstaladas: ["2.0.0"] }, guardado: () => ({ caminho: "x", artefato: {} }) });
    expect(await b.servico.reverter({ versao: "2.0.0" })).toEqual({ ok: false, motivo: "versao_nao_instalada_antes" });
  });
  it("com versão instalada antes e instalador guardado e verificável, reverte pelo backend", async () => {
    const a = await montar();
    await a.servico.verificar({ manual: true });
    await a.servico.baixar();
    const caminho = join(pasta, "updates", "app-universal.dmg");
    const artefato = a.feed.manifesto.artefatos[0]!;
    const b = await montar({ persistido: { versoesInstaladas: ["0.9.0"] }, guardado: (v) => (v === "0.9.0" ? { caminho, artefato } : null) });
    expect(await b.servico.reverter({ versao: "0.9.0" })).toEqual({ ok: true });
    expect(b.instalados).toEqual([caminho]);
    b.panes.n = 1;
    expect(await b.servico.reverter({ versao: "0.9.0" })).toEqual({ ok: false, motivo: "panes_trabalhando" });
  });
});

describe("backend manual (T-21.15)", () => {
  it("só abre a página de download em https no host do build; nunca baixa nem instala", async () => {
    const abertos: string[] = [];
    const a = await montar({ backend: () => criarBackendManual({ hostDoBuild: "releases.exemplo.com", caminhoBase: "/", abrirExterno: async (u) => void abertos.push(u) }) });
    await a.servico.verificar({ manual: true });
    expect(await a.servico.baixar()).toEqual({ ok: false, motivo: "backend_indisponivel" });
    expect(await a.servico.abrirDownload()).toEqual({ ok: true });
    expect(abertos).toEqual(["https://releases.exemplo.com/stable/1.1.0/app-universal.dmg"]);
    expect(a.feed.contagem("/stable/1.1.0/app-universal.dmg")).toBe(0);
    expect(await a.servico.instalar({ confirmar_panes: true })).toMatchObject({ ok: false });
  });
  it("au25_abre_so_https_do_host_do_build: URL fora do host do build, com credencial, porta, caminho escapando ou host malformado é recusada", () => {
    const art = { url_relativa: "stable/1.1.0/app.dmg" };
    expect(urlDeDownload("releases.exemplo.com", "/", art)).toBe("https://releases.exemplo.com/stable/1.1.0/app.dmg");
    expect(urlDeDownload("u:p@evil.test", "/", art)).toBeNull();
    expect(urlDeDownload("evil.test:8080", "/", art)).toBeNull();
    expect(urlDeDownload("evil.test/x", "/", art)).toBeNull();
    expect(urlDeDownload("ok.test", "/..", art)).toBeNull();
    expect(urlDeDownload("ok.test", "/", { url_relativa: "https://evil.test/a" })).toBeNull();
    expect(urlDeDownload("ok.test", "/", { url_relativa: "../a" })).toBeNull();
  });
  it("sem `abrirDownload` no backend não há como abrir nada", async () => {
    const a = await montar({ backend: () => criarBackendFalso() });
    await a.servico.verificar({ manual: true });
    expect(await a.servico.abrirDownload()).toEqual({ ok: false, motivo: "sem_artefato" });
  });
});
