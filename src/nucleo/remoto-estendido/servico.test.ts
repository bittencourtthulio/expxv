// Serviço do relay no host (T-22.11/T-22.12/T-22.21), com relay REAL em loopback e celular de referência (`ClienteViaRelay`): pareamento ponta a ponta pelo canal efêmero (SAS nos dois
// lados, «Permitir» no desktop, nasce `leitura`, uso único), entrega do segredo de canal DENTRO da sessão cifrada, canal definitivo, revogação em dois níveis e pânico.
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { criarCenarioRemoto, type CenarioRemoto } from "../../../tests/fixtures/jarvis/cenario-remoto";
import { ClienteViaRelay } from "../../../tests/fixtures/relay/cliente-pwa-falso";
import { CONFIG_RELAY_PADRAO, TEXTO_CONSENTIMENTO_RELAY_VERSAO, type ConfigRelay, type EstadoRelay } from "../../compartilhado/relay";
import { criarLog } from "../relay/log";
import { iniciarRelay, type ServidorRelay } from "../relay/servidor";
import { carregarIdentidade } from "../remoto/identidade";
import { novoParAssinatura } from "../remoto/protocolo";
import { canalId, chaveEnvelope, epocaDe } from "./canal";
import { impressaoDaIdentidade } from "./impressao-digital";
import { canalEfemero, chaveEfemera, nomeSegredoCanal } from "./pareamento-relay";
import { criarRepoRelay } from "./repo";
import { criarServicoRelay, lerConfigRelay, type ServicoRelay } from "./servico";
import { abrirWs } from "./ws-cliente";

const limpeza: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of limpeza.splice(0).reverse()) await f();
});
const timerReal = (fn: () => void, ms: number): (() => void) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};
const espera = async (cond: () => boolean, ms = 4000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 10));
  if (!cond()) throw new Error("tempo esgotado");
};

interface Montagem {
  cen: CenarioRemoto;
  relay: ServidorRelay;
  svc: ServicoRelay;
  cfg: ConfigRelay;
  estados: EstadoRelay[];
  eventos: string[];
  url: string;
  ids: { apagados: string[] };
}
async function montar(o: { semConsentimento?: boolean; lerAtrasoMs?: number } = {}): Promise<Montagem> {
  const cen = criarCenarioRemoto();
  limpeza.push(() => cen.fechar());
  const relay = await iniciarRelay({ bind: "127.0.0.1", porta: 0, log: criarLog({ agora: Date.now, saida: () => undefined }) });
  limpeza.push(() => relay.fechar());
  const url = `ws://127.0.0.1:${relay.porta}/v1/canal/x`;
  const cfg: ConfigRelay = { ...CONFIG_RELAY_PADRAO, url, consentimento_versao: o.semConsentimento === true ? "" : TEXTO_CONSENTIMENTO_RELAY_VERSAO, reconhecimento_experimental: true, pwa_origem: "https://pwa.exemplo.dev/app" };
  const estados: EstadoRelay[] = [];
  const eventos: string[] = [];
  const ids = { apagados: [] as string[] };
  const porta = {
    ler: async (n: string) => {
      if (o.lerAtrasoMs !== undefined && n.startsWith("RELAY_CANAL_")) await new Promise((r) => setTimeout(r, o.lerAtrasoMs));
      return cen.segredos.get(n) ?? null;
    },
    gravar: async (n: string, v: string) => void cen.segredos.set(n, v),
  };
  const svc = criarServicoRelay({
    remoto: cen.servico,
    repo: criarRepoRelay({ banco: cen.j.banco, relogio: cen.relogio }),
    identidade: () => carregarIdentidade(porta),
    segredos: porta,
    relogio: cen.relogio,
    config: () => cfg,
    gravarConfig: (p) => void Object.assign(cfg, p),
    agendar: timerReal,
    aoMudar: (e) => estados.push(e),
    aoEvento: (t) => eventos.push(t),
  });
  limpeza.push(() => svc.desligar().then(() => undefined));
  return { cen, relay, svc, cfg, estados, eventos, url, ids };
}

/** celular de referência pareando pelo canal efêmero (a mesma sequência que o PWA faz). */
async function parearCelular(m: Montagem, o: { decidir?: boolean; esperarSegredo?: boolean } = {}) {
  const r = await m.svc.parearIniciar();
  if ("erro" in r) throw new Error(`parearIniciar: ${r.erro}`);
  await espera(() => m.svc.estado().conectado);
  const par = novoParAssinatura();
  const cel = new ClienteViaRelay(abrirWs, { url: m.url, canal: canalEfemero(r.codigo), chaveEnvelope: chaveEfemera(r.codigo), chavePublicaDispositivo: par.publicaSpki, chavePrivadaDispositivo: par.privadaPkcs8, aguardar: async () => undefined }, "celular do teste");
  cel.par = par;
  limpeza.push(() => cel.fechar());
  expect(await cel.conectar()).toBe(true);
  const ini = await cel.iniciarPareamento(r.codigo);
  if (!ini.ok) throw new Error(`pareamento: ${ini.etapa}`);
  await espera(() => m.svc.parearSas().situacao === "aguardando_decisao");
  const sas = m.svc.parearSas();
  expect(sas.sas).toBe(ini.sas); // SAS igual nos DOIS lados
  const permitir = o.decidir !== false;
  const dec = await m.svc.parearDecidir(permitir);
  return { r, cel, ini, par, dec, sas };
}

describe("ligar: consentimento versionado, reconhecimento «experimental» e URL wss (AX-17/AX-34)", () => {
  it("ax17_relay_nao_liga_sozinho: nasce desligado; sem consentimento, sem reconhecimento ou com URL inválida nada liga e há 0 sockets/timers", async () => {
    const m = await montar({ semConsentimento: true });
    expect(m.svc.estado()).toMatchObject({ ligado: false, situacao: "desligado", experimental: true, conectado: false });
    expect(m.svc._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
    expect(await m.svc.ligar()).toEqual({ ok: false, motivo: "consentimento_ausente" });
    m.cfg.consentimento_versao = TEXTO_CONSENTIMENTO_RELAY_VERSAO;
    m.cfg.reconhecimento_experimental = false;
    expect(await m.svc.ligar()).toEqual({ ok: false, motivo: "reconhecimento_ausente" });
    m.cfg.reconhecimento_experimental = true;
    m.cfg.url = "ws://relay.exemplo.com";
    expect(await m.svc.ligar()).toEqual({ ok: false, motivo: "url_invalida" });
    m.cfg.url = "wss://10.0.0.5";
    expect(await m.svc.ligar()).toEqual({ ok: false, motivo: "url_invalida" });
    expect(m.svc.estado().ligado).toBe(false);
    expect(m.svc._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
    expect(m.relay.metricas().conexoes).toBe(0);
    expect(await m.svc.parearIniciar()).toEqual({ erro: "relay_desligado" });
  });
  it("ligar consome o reconhecimento (vale por UMA ligação), nunca persiste `habilitado:true` e o estado fica «ocioso» sem dispositivos (0 sockets)", async () => {
    const m = await montar();
    expect(await m.svc.ligar()).toEqual({ ok: true });
    expect(m.cfg.habilitado).toBe(false);
    expect(m.cfg.reconhecimento_experimental).toBe(false);
    expect(m.svc.estado()).toMatchObject({ ligado: true, situacao: "ocioso", conectado: false, experimental: true });
    expect(m.relay.metricas().conexoes).toBe(0);
    expect(await m.svc.ligar()).toEqual({ ok: false, motivo: "ja_ligado" });
    await m.svc.desligar();
    expect(m.svc.estado().ligado).toBe(false);
    expect(await m.svc.ligar()).toEqual({ ok: false, motivo: "reconhecimento_ausente" });
  });
  it("ax34_nao_habilita_por_padrao: lerConfigRelay força habilitado=false e experimental=true, mesmo com lixo gravado", () => {
    expect(CONFIG_RELAY_PADRAO.habilitado).toBe(false);
    expect(lerConfigRelay({ habilitado: true, experimental: false, url: "wss://relay.exemplo.com", reconhecimento_experimental: true })).toMatchObject({ habilitado: false, experimental: true, url: "wss://relay.exemplo.com" });
    expect(lerConfigRelay(null)).toEqual({ ...CONFIG_RELAY_PADRAO });
    expect(lerConfigRelay({ url: "http://x" }).url).toBe("");
  });
  it("configDefinir: `habilitado` nunca é gravado (vira ligar/desligar), `experimental` não é editável e a URL não troca ligado", async () => {
    const m = await montar();
    m.cfg.reconhecimento_experimental = false;
    expect(await m.svc.configDefinir({ experimental: false })).toEqual({ erro: "campo_desconhecido:experimental" });
    expect(await m.svc.configDefinir({ habilitado: true, reconhecimento_experimental: true })).toMatchObject({ habilitado: false });
    expect(m.svc.estado().ligado).toBe(true);
    expect(await m.svc.configDefinir({ url: "wss://outro.exemplo.com" })).toEqual({ erro: "desligue_antes_de_trocar_a_url" });
    expect(await m.svc.configDefinir({ habilitado: false })).toMatchObject({ habilitado: false });
    expect(m.svc.estado().ligado).toBe(false);
  });
});

describe("pareamento via relay ponta a ponta (T-22.11)", () => {
  it("ax28_dispositivo_nasce_leitura + ax26/27: SAS igual, «Permitir» no desktop, segredo de canal entregue por dentro da sessão, canal efêmero some e o definitivo conecta", async () => {
    const m = await montar();
    await m.svc.ligar();
    const { r, cel, ini, par, dec } = await parearCelular(m);
    expect(r.codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r.qr.startsWith("https://pwa.exemplo.dev/app#r=")).toBe(true);
    expect(r.qr).toContain(`c=${r.codigo.replaceAll("-", "")}`);
    expect(r.qr).toContain(`h=${r.impressao_host.replaceAll(" ", "")}`);
    expect(r.impressao_cliente_esperada).toBeNull();
    expect(dec).toEqual({ ok: true });
    expect(await cel.concluirPareamento(ini.hid, ini.chaves)).toBe(true);
    const disp = m.svc.dispositivos();
    expect(disp).toHaveLength(1);
    expect(disp[0]).toMatchObject({ permissao: "leitura", transporte: "lan", revogado_em: null });
    // identidade do host fixada no celular == impressão digital mostrada no desktop (AX-04)
    expect(impressaoDaIdentidade(cel.identidadeFixada as Buffer)).toBe(r.impressao_host);
    expect((await cel.abrirSessao()).ok).toBe(true);
    const seg = await cel.enviar({ t: "canal_segredo" });
    expect(seg.status).toBe(200);
    const msg = seg.msg as { t: string; segredo: string; epoca: number };
    expect(msg.t).toBe("canal_segredo");
    const segredo = Buffer.from(msg.segredo, "base64");
    expect(segredo).toHaveLength(32);
    expect(msg.epoca).toBe(epocaDe(Date.now()));
    // o segredo está no cofre, nunca no banco
    expect(m.cen.segredos.get(nomeSegredoCanal(cel.dispositivoId as string))).toBe(msg.segredo);
    const bruto = JSON.stringify(m.cen.j.banco.consultar("SELECT * FROM relay_canal")) + JSON.stringify(m.cen.j.banco.consultar("SELECT * FROM relay_evento"));
    expect(bruto).not.toContain(msg.segredo);
    expect(bruto).not.toContain(r.codigo.replaceAll("-", ""));
    // pelo segundo pedido o host recusa
    expect((await cel.enviar({ t: "canal_segredo" })).msg).toEqual({ t: "erro", e: "ja_emitido" });
    // o efêmero encerra e o definitivo registra
    await espera(() => !m.svc._recursos().efemero && m.svc._recursos().clientes === 1);
    await espera(() => m.svc.estado().conectado);
    expect(m.svc.dispositivos()[0]?.transporte).toBe("relay");
    expect(m.svc.parearSas().situacao).toBe("concluido");
    expect(m.eventos).toEqual(expect.arrayContaining(["ligado", "pareamento_aberto", "pareamento_concluido", "conectado"]));
    cel.fechar();
    // código/QR reutilizado: o canal efêmero já foi destruído (uso único)
    const par2 = novoParAssinatura();
    const reuso = new ClienteViaRelay(abrirWs, { url: m.url, canal: canalEfemero(r.codigo), chaveEnvelope: chaveEfemera(r.codigo), chavePublicaDispositivo: par2.publicaSpki, chavePrivadaDispositivo: par2.privadaPkcs8, aguardar: async () => undefined });
    limpeza.push(() => reuso.fechar());
    expect(await reuso.conectar()).toBe(false);
    // celular com o segredo: canal definitivo + sessão + estado (leitura)
    const def = new ClienteViaRelay(abrirWs, { url: m.url, canal: canalId(segredo, epocaDe(Date.now())), chaveEnvelope: chaveEnvelope(segredo, "sessao"), chavePublicaDispositivo: par.publicaSpki, chavePrivadaDispositivo: par.privadaPkcs8, aguardar: async () => undefined });
    def.par = par;
    def.dispositivoId = cel.dispositivoId;
    def.identidadeFixada = cel.identidadeFixada;
    limpeza.push(() => def.fechar());
    expect(await def.conectar()).toBe(true);
    expect((await def.abrirSessao()).ok).toBe(true);
    expect((await def.enviar({ t: "estado" })).status).toBe(200);
    // só `leitura`: comando de escrita é recusado pelo caminho da Fase 13 (AX-28/AX-29)
    const cmd = await def.enviar({ t: "comando", acao: { acao: "enviar_prompt", destino: "maestro", squad: null, texto: "fazer algo" } });
    expect(JSON.stringify(cmd.msg)).toMatch(/permiss|recus|leitura/i);
  }, 20_000);

  it("ax28: só o dispositivo pareado AGORA pode pedir o segredo; outro dispositivo e pedido fora da janela recebem `nao_permitido`", async () => {
    const m = await montar();
    await m.svc.ligar();
    const { cel, ini } = await parearCelular(m);
    expect(await cel.concluirPareamento(ini.hid, ini.chaves)).toBe(true);
    expect((await cel.abrirSessao()).ok).toBe(true);
    m.cen.relogio.avancar(200_000); // além da janela de entrega
    const r = await cel.enviar({ t: "canal_segredo" });
    expect(r.msg).toEqual({ t: "erro", e: "nao_permitido" });
    expect(m.cen.segredos.has(nomeSegredoCanal(cel.dispositivoId as string))).toBe(false);
  }, 20_000);

  it("ax27_pareamento_via_relay_uso_unico: «Recusar» no desktop fecha o pareamento, derruba o efêmero e não cria dispositivo", async () => {
    const m = await montar();
    await m.svc.ligar();
    const { dec } = await parearCelular(m, { decidir: false });
    expect(dec).toEqual({ ok: false });
    expect(m.svc.dispositivos()).toHaveLength(0);
    expect(m.svc.parearSas()).toMatchObject({ situacao: "negado", sas: null });
    await espera(() => m.relay.metricas().conexoes === 0);
    expect(m.svc._recursos().efemero).toBe(false);
    expect(m.eventos).toContain("pareamento_falhou");
  }, 20_000);

  it("a janela expira sozinha: o efêmero some e a situação vira `expirado` (relógio injetado)", async () => {
    const m = await montar();
    let disparar: (() => void) | null = null;
    const svc = criarServicoRelay({
      remoto: m.cen.servico,
      repo: criarRepoRelay({ banco: m.cen.j.banco, relogio: m.cen.relogio }),
      identidade: () => carregarIdentidade({ ler: async (n) => m.cen.segredos.get(n) ?? null, gravar: async (n, v) => void m.cen.segredos.set(n, v) }),
      segredos: { ler: async (n) => m.cen.segredos.get(n) ?? null, gravar: async (n, v) => void m.cen.segredos.set(n, v) },
      relogio: m.cen.relogio,
      config: () => m.cfg,
      gravarConfig: (p) => void Object.assign(m.cfg, p),
      agendar: (fn, ms) => {
        if (ms > 100_000) disparar = fn; // o timer do pareamento
        return () => undefined;
      },
    });
    limpeza.push(() => svc.desligar().then(() => undefined));
    expect(await svc.ligar()).toEqual({ ok: true });
    const r = await svc.parearIniciar();
    expect("erro" in r).toBe(false);
    expect(svc._recursos()).toMatchObject({ efemero: true, timers: 1 });
    (disparar as unknown as () => void)();
    expect(svc.parearSas().situacao).toBe("expirado");
    expect(svc._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
    await svc.desligar();
  });

  it("reabrir o pareamento cancela o anterior (um por vez) e `desligar` deixa 0 sockets e 0 timers", async () => {
    const m = await montar();
    await m.svc.ligar();
    const a = await m.svc.parearIniciar();
    expect("erro" in a).toBe(false);
    await espera(() => m.svc.estado().conectado);
    const b = await m.svc.parearIniciar();
    expect("erro" in b).toBe(false);
    expect((a as { codigo: string }).codigo).not.toBe((b as { codigo: string }).codigo);
    await espera(() => m.svc.estado().conectado);
    await m.svc.desligar();
    await espera(() => m.relay.metricas().conexoes === 0);
    expect(m.svc._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
  }, 20_000);
});

async function pareadoComCanal(m: Montagem) {
  const antes = m.svc._recursos().clientes;
  const p = await parearCelular(m);
  expect(await p.cel.concluirPareamento(p.ini.hid, p.ini.chaves)).toBe(true);
  expect((await p.cel.abrirSessao()).ok).toBe(true);
  const seg = ((await p.cel.enviar({ t: "canal_segredo" })).msg as { segredo: string }).segredo;
  const segredo = Buffer.from(seg, "base64");
  await espera(() => m.svc._recursos().clientes === antes + 1 && !m.svc._recursos().efemero && m.svc.estado().conectado);
  p.cel.fechar();
  const def = new ClienteViaRelay(abrirWs, { url: m.url, canal: canalId(segredo, epocaDe(Date.now())), chaveEnvelope: chaveEnvelope(segredo, "sessao"), chavePublicaDispositivo: p.par.publicaSpki, chavePrivadaDispositivo: p.par.privadaPkcs8, aguardar: async () => undefined });
  def.par = p.par;
  def.dispositivoId = p.cel.dispositivoId;
  def.identidadeFixada = p.cel.identidadeFixada;
  limpeza.push(() => def.fechar());
  expect(await def.conectar()).toBe(true);
  expect((await def.abrirSessao()).ok).toBe(true);
  return { def, id: p.cel.dispositivoId as string, segredo, par: p.par };
}

describe("revogação em dois níveis e pânico (T-22.12)", () => {
  it("ax15_revogacao_autoritativa_no_host: relay que descarta o aviso NÃO impede o host de recusar; quadro gravado antes da revogação não autentica depois", async () => {
    const m = await montar();
    // o serviço NÃO fica sabendo da revogação (simula o aviso perdido): o host continua recusando por conta própria
    const semAviso = { ...m.cen.servico, aoRevogarDispositivo: () => undefined } as typeof m.cen.servico;
    const svc2 = criarServicoRelay({
      remoto: Object.assign(Object.create(m.cen.servico) as object, { aoRevogarDispositivo: semAviso.aoRevogarDispositivo }) as never,
      repo: criarRepoRelay({ banco: m.cen.j.banco, relogio: m.cen.relogio }),
      identidade: () => carregarIdentidade({ ler: async (n) => m.cen.segredos.get(n) ?? null, gravar: async (n, v) => void m.cen.segredos.set(n, v) }),
      segredos: { ler: async (n) => m.cen.segredos.get(n) ?? null, gravar: async (n, v) => void m.cen.segredos.set(n, v) },
      relogio: m.cen.relogio,
      config: () => m.cfg,
      gravarConfig: (p) => void Object.assign(m.cfg, p),
      agendar: timerReal,
    });
    limpeza.push(() => svc2.desligar().then(() => undefined));
    const m2 = { ...m, svc: svc2 } as Montagem;
    expect(await svc2.ligar()).toEqual({ ok: true });
    const { def, id } = await pareadoComCanal(m2);
    expect((await def.enviar({ t: "estado" })).status).toBe(200);
    const gravado = def.ultimoQuadro;
    expect(await m.cen.servico.revogar(id)).toBe(true); // só o host revoga; o relay não foi avisado
    expect(svc2._recursos().clientes).toBe(1); // o serviço nem sabe
    const r = await def.enviar({ t: "estado" });
    expect(r.status).toBe(401); // a sessão cai com a revogação; nenhuma resposta autêntica
    const r2 = await def.enviarQuadro(gravado);
    expect(r2.status).toBe(401); // o quadro gravado de antes também não autentica
    expect((await def.abrirSessao()).ok).toBe(false); // nem sessão nova
  }, 30_000);

  it("revogar um não afeta os outros; o canal do revogado cai ≤ 1 s, o relay o desregistra, o segredo some do cofre e o evento `revogado` é registrado", async () => {
    const m = await montar();
    await m.svc.ligar();
    const a = await pareadoComCanal(m);
    const b = await pareadoComCanal(m);
    expect(m.svc._recursos().clientes).toBe(2);
    const t0 = Date.now();
    expect(await m.svc.revogar(a.id)).toEqual({ ok: true });
    await espera(() => m.svc._recursos().clientes === 1, 1000);
    await espera(() => m.relay.metricas().canais === 1, 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(m.cen.segredos.get(nomeSegredoCanal(a.id))).toBe("");
    expect(m.cen.segredos.get(nomeSegredoCanal(b.id))).not.toBe("");
    expect(m.eventos).toContain("revogado");
    expect((await b.def.enviar({ t: "estado" })).status).toBe(200); // o outro segue
    const lista = m.svc.dispositivos();
    expect(lista.find((x) => x.id === a.id)?.revogado_em).not.toBeNull();
    expect(lista.find((x) => x.id === b.id)?.revogado_em).toBeNull();
  }, 40_000);

  it("ax14_celular_roubado_limitado: com o celular desbloqueado só se vê o que `leitura` permite (escrita recusada) e a revogação o corta em ≤ 1 s", async () => {
    const m = await montar();
    await m.svc.ligar();
    const a = await pareadoComCanal(m);
    expect((await a.def.enviar({ t: "estado" })).status).toBe(200); // o que leitura permite
    const escrita = await a.def.enviar({ t: "comando", acao: { acao: "enviar_prompt", destino: "maestro", squad: null, texto: "apagar tudo" } });
    expect(JSON.stringify(escrita.msg)).toMatch(/permiss|recus|leitura/i);
    const aprovar = await a.def.enviar({ t: "comando", acao: { acao: "aprovar_gate", gate_id: "g1", decisao: "aprovar" } });
    expect(JSON.stringify(aprovar.msg)).toMatch(/permiss|recus|leitura|humana/i); // portão humano nunca pelo celular
    const t0 = Date.now();
    expect(await m.svc.revogar(a.id)).toEqual({ ok: true });
    const depois = await a.def.enviar({ t: "estado" });
    expect(depois.status === 0 || depois.status === 401).toBe(true);
    await espera(() => m.svc._recursos().clientes === 0, 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
  }, 30_000);

  it("ax16_panico_zero_sockets (A-08): pânico no meio da subida do canal definitivo (cofre lento) não deixa cliente nenhum para trás", async () => {
    const m = await montar({ lerAtrasoMs: 150 });
    await m.svc.ligar();
    const r = await parearCelular(m);
    expect(await r.cel.concluirPareamento(r.ini.hid, r.ini.chaves)).toBe(true);
    expect((await r.cel.abrirSessao()).ok).toBe(true);
    expect((await r.cel.enviar({ t: "canal_segredo" })).status).toBe(200); // o host já sobe o canal definitivo, mas o cofre demora 150 ms
    await m.svc.panico();
    await new Promise((res) => setTimeout(res, 400));
    expect(m.svc._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
    await espera(() => m.relay.metricas().conexoes === 0, 1000);
  }, 30_000);

  it("ax16_panico_zero_sockets (A-08): `desligar` no meio da subida do canal definitivo (cofre lento; o segredo ainda existe) não deixa cliente nenhum para trás", async () => {
    const m = await montar({ lerAtrasoMs: 150 });
    await m.svc.ligar();
    const r = await parearCelular(m);
    expect(await r.cel.concluirPareamento(r.ini.hid, r.ini.chaves)).toBe(true);
    expect((await r.cel.abrirSessao()).ok).toBe(true);
    expect((await r.cel.enviar({ t: "canal_segredo" })).status).toBe(200);
    await m.svc.desligar();
    await new Promise((res) => setTimeout(res, 400));
    expect(m.svc._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
    await espera(() => m.relay.metricas().conexoes === 0, 1000);
  }, 30_000);

  it("A-08: revogar com o relay DESLIGADO apaga o segredo de canal do cofre e marca o canal revogado na hora (não só no próximo ligar)", async () => {
    const m = await montar();
    await m.svc.ligar();
    const a = await pareadoComCanal(m);
    await m.svc.desligar();
    expect(m.cen.segredos.get(nomeSegredoCanal(a.id))).not.toBe("");
    expect(await m.cen.servico.revogar(a.id)).toBe(true);
    await espera(() => m.cen.segredos.get(nomeSegredoCanal(a.id)) === "");
    expect(criarRepoRelay({ banco: m.cen.j.banco, relogio: m.cen.relogio }).obter(a.id)?.revogado_em).not.toBeNull();
  }, 30_000);

  it("«esquecer este dispositivo» pedido pelo celular revoga no host", async () => {
    const m = await montar();
    await m.svc.ligar();
    const a = await pareadoComCanal(m);
    const r = await a.def.enviar({ t: "esquecer" });
    expect(r.msg).toEqual({ t: "esquecido" });
    await espera(() => m.svc.dispositivos().find((x) => x.id === a.id)?.revogado_em !== null);
    expect(m.cen.servico.chaveDoDispositivo(a.id)).toBeNull();
  }, 30_000);

  it("ax16_panico_zero_sockets: ≤ 1 s para 0 sockets no relay, todos revogados, segredos apagados, pareamento cancelado e o relay fica desligado", async () => {
    const m = await montar();
    await m.svc.ligar();
    const a = await pareadoComCanal(m);
    const b = await pareadoComCanal(m);
    const aberto = await m.svc.parearIniciar(); // pareamento em curso também cai
    expect("erro" in aberto).toBe(false);
    await espera(() => m.relay.metricas().conexoes >= 3);
    const gravado = a.def.ultimoQuadro;
    const t0 = Date.now();
    expect(await m.svc.panico()).toEqual({ ok: true });
    await espera(() => m.relay.metricas().conexoes === 0, 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(m.svc.estado()).toMatchObject({ ligado: false, situacao: "desligado" });
    expect(m.svc._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
    expect(m.svc.dispositivos().every((x) => x.revogado_em !== null)).toBe(true);
    expect(m.cen.segredos.get(nomeSegredoCanal(a.id))).toBe("");
    expect(m.cen.segredos.get(nomeSegredoCanal(b.id))).toBe("");
    expect(m.cfg.habilitado).toBe(false);
    expect(m.eventos).toContain("panico");
    // nada que o celular tinha autentica depois do pânico
    expect(a.def.registrado).toBe(false);
    const r = await m.cen.servico.tratador().tratar({ rota: "canal", corpo: { sid: a.def.sid, quadro: (gravado as object) }, origem: "relay" });
    expect(r.status).toBe(401);
    expect(await m.svc.ligar()).toEqual({ ok: false, motivo: "reconhecimento_ausente" }); // religar exige tudo de novo
  }, 40_000);

  it("reiniciar o app deixa o relay desligado: um serviço novo sobre o mesmo banco/cofre não abre nenhum socket sozinho (AX-17)", async () => {
    const m = await montar();
    await m.svc.ligar();
    const a = await pareadoComCanal(m);
    expect(a.id).toBeTruthy();
    await m.svc.desligar();
    await espera(() => m.relay.metricas().conexoes === 0);
    const outro = criarServicoRelay({
      remoto: m.cen.servico,
      repo: criarRepoRelay({ banco: m.cen.j.banco, relogio: m.cen.relogio }),
      identidade: () => carregarIdentidade({ ler: async (n) => m.cen.segredos.get(n) ?? null, gravar: async (n, v) => void m.cen.segredos.set(n, v) }),
      segredos: { ler: async (n) => m.cen.segredos.get(n) ?? null, gravar: async (n, v) => void m.cen.segredos.set(n, v) },
      relogio: m.cen.relogio,
      config: () => lerConfigRelay({ ...m.cfg, habilitado: true }),
      gravarConfig: () => undefined,
      agendar: timerReal,
    });
    expect(outro.estado()).toMatchObject({ ligado: false, situacao: "desligado" });
    expect(outro._recursos()).toEqual({ clientes: 0, efemero: false, timers: 0 });
    expect(m.relay.metricas().conexoes).toBe(0);
    // ligado de novo (com consentimento): os canais dos dispositivos sobem sozinhos
    m.cfg.reconhecimento_experimental = true;
    expect(await m.svc.ligar()).toEqual({ ok: true });
    await espera(() => m.svc.estado().conectado);
    expect(m.svc._recursos().clientes).toBe(1);
  }, 40_000);
});

describe("eventos e retenção", () => {
  it("relay_evento: só nomes (sem IP, canal_id, segredo ou texto) e retenção de 30 dias", async () => {
    const m = await montar();
    await m.svc.ligar();
    const repo = criarRepoRelay({ banco: m.cen.j.banco, relogio: m.cen.relogio });
    const antes = repo.eventos().length;
    expect(antes).toBeGreaterThanOrEqual(1);
    const txt = JSON.stringify(repo.eventos());
    expect(txt).not.toMatch(/127\.0\.0\.1|[0-9a-f]{32}|SENTINELA/);
    m.cen.relogio.avancar(31 * 86_400_000);
    expect(repo.purgar()).toBe(antes);
    expect(repo.eventos()).toHaveLength(0);
  });
  it("urlAceita só vale ws://127.0.0.1 com NODE_ENV=test", async () => {
    const { urlAceita } = await import("./servico");
    expect(urlAceita("ws://127.0.0.1:9", "test")).toBe(true);
    expect(urlAceita("ws://127.0.0.1:9", "production")).toBe(false);
    expect(urlAceita("wss://relay.exemplo.com", "production")).toBe(true);
    expect(urlAceita("ws://relay.exemplo.com", "test")).toBe(false);
  });
});

void randomBytes;

describe("config: URL de loopback só em teste", () => {
  it("lerConfigRelay aceita ws://127.0.0.1:<porta> apenas com NODE_ENV=test; em produção a URL é descartada", () => {
    const url = "ws://127.0.0.1:8123/v1/canal/x";
    expect(lerConfigRelay({ url }, "test").url).toBe(url);
    expect(lerConfigRelay({ url }, "production").url).toBe("");
    expect(lerConfigRelay({ url }, "").url).toBe("");
    expect(lerConfigRelay({ url: "ws://u:p@127.0.0.1:8123/x" }, "test").url).toBe("");
    expect(lerConfigRelay({ url: "ws://127.0.0.1:8123/?a=1" }, "test").url).toBe("");
    expect(lerConfigRelay({ url: "ws://relay.exemplo.com" }, "test").url).toBe("");
    expect(lerConfigRelay({ url, habilitado: true }, "test")).toMatchObject({ habilitado: false, url });
  });
});
