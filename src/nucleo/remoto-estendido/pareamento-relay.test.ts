// T-22.11: derivações do canal efêmero, link do QR, impressões digitais e o relay HOSTIL no meio do pareamento (AX-04).
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { criarCenarioRemoto } from "../../../tests/fixtures/jarvis/cenario-remoto";
import { ClienteViaRelay } from "../../../tests/fixtures/relay/cliente-pwa-falso";
import { agendadorVirtual, criarRedeFalsa } from "../../../tests/fixtures/relay/relay-hostil";
import { CONFIG_RELAY_PADRAO, TEXTO_CONSENTIMENTO_RELAY_VERSAO, type ConfigRelay } from "../../compartilhado/relay";
import { carregarIdentidade } from "../remoto/identidade";
import { novoParAssinatura, normalizarCodigo } from "../remoto/protocolo";
import { canalId, chaveEnvelope } from "./canal";
import { agruparImpressao, impressaoDaIdentidade, impressaoHex, impressoesIguais, normalizarImpressao } from "./impressao-digital";
import { canalEfemero, chaveEfemera, criarMensagemRelay, montarLink, nomeSegredoCanal, normalizarCodigoRelay, segredoEfemero } from "./pareamento-relay";
import { criarRepoRelay } from "./repo";
import { criarServicoRelay } from "./servico";

const limpeza: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of limpeza.splice(0).reverse()) await f();
});

describe("derivações do canal efêmero", () => {
  it("o segredo efêmero vem só do código normalizado; canal e invólucro derivam dele, e canal e chave são diferentes entre si e entre códigos", () => {
    const a = segredoEfemero("ABCD-EFGH-JKLM");
    expect(a).toHaveLength(32);
    expect(segredoEfemero("abcd efgh jklm").equals(a)).toBe(true);
    expect(segredoEfemero("ABCD-EFGH-JKLN").equals(a)).toBe(false);
    expect(canalEfemero("ABCD-EFGH-JKLM")).toBe(canalId(a, 0));
    expect(canalEfemero("ABCD-EFGH-JKLM")).toMatch(/^[0-9a-f]{32}$/);
    expect(chaveEfemera("ABCD-EFGH-JKLM").equals(chaveEnvelope(a, "pareamento"))).toBe(true);
    expect(chaveEfemera("ABCD-EFGH-JKLM").equals(chaveEnvelope(a, "sessao"))).toBe(false);
    expect(normalizarCodigo("abcd-efgh jklm")).toBe("ABCDEFGHJKLM");
    for (const t of ["abcd-efgh jklm", " ABCD EFGH JKLM ", "a-b-c", "\tx y\n", ""]) expect(normalizarCodigoRelay(t)).toBe(normalizarCodigo(t)); // cópia fiel da Fase 13
  });
});

describe("link do QR e impressões digitais", () => {
  const hex = impressaoHex(Buffer.from("identidade"));
  it("tudo no fragmento, nada fora dele; sem pwa_origem o link é vazio", () => {
    const l = montarLink({ pwaOrigem: "https://pwa.exemplo.dev/app", relayUrl: "wss://relay.exemplo.com", codigo: "ABCD-EFGH-JKLM", impressaoHostHex: hex, impressaoPwaHex: null });
    expect(l).toBe(`https://pwa.exemplo.dev/app#r=wss%3A%2F%2Frelay.exemplo.com&c=ABCDEFGHJKLM&h=${hex}&p=`);
    expect(new URL(l).search).toBe("");
    expect(new URL(l).hash).toContain("c=ABCDEFGHJKLM");
    expect(montarLink({ pwaOrigem: "", relayUrl: "wss://r.exemplo.com", codigo: "ABCD-EFGH-JKLM", impressaoHostHex: hex, impressaoPwaHex: null })).toBe("");
    expect(() => montarLink({ pwaOrigem: "https://a.dev", relayUrl: "wss://r.exemplo.com", codigo: "curto", impressaoHostHex: hex, impressaoPwaHex: null })).toThrow();
    expect(() => montarLink({ pwaOrigem: "https://a.dev", relayUrl: "wss://r.exemplo.com", codigo: "ABCD-EFGH-JKLM", impressaoHostHex: "abc", impressaoPwaHex: null })).toThrow();
  });
  it("ax11_impressao_digital_comparavel: 32 hex em grupos de 4; comparação ignora espaços e caixa e recusa diferentes ou curtas", () => {
    const spki = randomBytes(91);
    const g = impressaoDaIdentidade(spki);
    expect(g).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
    expect(agruparImpressao(impressaoHex(spki))).toBe(g);
    expect(impressoesIguais(g, g.toUpperCase().replaceAll(" ", ""))).toBe(true);
    expect(impressoesIguais(g, impressaoDaIdentidade(randomBytes(91)))).toBe(false);
    expect(impressoesIguais("abcd", "abcd")).toBe(false);
    expect(normalizarImpressao(" AB cd\n")).toBe("abcd");
  });
});

describe("mensagens extras da sessão (canal_segredo / esquecer)", () => {
  it("ignora o que não é seu, nunca lança e só entrega o segredo uma vez, ao dispositivo recente", async () => {
    const gravados = new Map<string, string>();
    const canais = new Map<string, { epoca_ultima: number; revogado_em: string | null }>();
    const recentes = new Map<string, number>([["dev_a", 1000]]);
    const revogados: string[] = [];
    const adiados: Array<() => void> = [];
    const f = criarMensagemRelay({
      canais: { obter: (id) => canais.get(id) ?? null, registrar: (id, e) => void canais.set(id, { epoca_ultima: e, revogado_em: null }) },
      segredos: { gravar: async (n, v) => void gravados.set(n, v) },
      relogio: { agora: () => 2000 },
      recentes,
      aoSegredoEntregue: () => undefined,
      revogar: async (id) => (revogados.push(id), true),
      adiar: (fn) => void adiados.push(fn),
    });
    const d = { id: "dev_a", nome: "x", permissao: "leitura" };
    expect(await f(d, { t: "estado" })).toBeUndefined();
    expect(await f(d, null)).toBeUndefined();
    expect(await f(d, [1])).toBeUndefined();
    expect(await f({ ...d, id: "dev_b" }, { t: "canal_segredo" })).toEqual({ t: "erro", e: "nao_permitido" });
    const r = (await f(d, { t: "canal_segredo" })) as { t: string; segredo: string; epoca: number };
    expect(r.t).toBe("canal_segredo");
    expect(gravados.get(nomeSegredoCanal("dev_a"))).toBe(r.segredo);
    expect(await f(d, { t: "canal_segredo" })).toEqual({ t: "erro", e: "ja_emitido" });
    expect(await f(d, { t: "esquecer" })).toEqual({ t: "esquecido" });
    expect(revogados).toEqual([]); // só depois da resposta
    adiados[0]?.();
    expect(revogados).toEqual(["dev_a"]);
  });
  it("ax28_dispositivo_nasce_leitura (A-03): dois `canal_segredo` CONCORRENTES entregam UM segredo só; o segundo cai em `nao_permitido`", async () => {
    const cofre = new Map<string, string>();
    const entregas: string[] = [];
    let linha: { epoca_ultima: number; revogado_em: string | null } | null = null;
    const f = criarMensagemRelay({
      canais: { obter: () => linha, registrar: (_id, e) => void (linha = { epoca_ultima: e, revogado_em: null }) },
      segredos: { gravar: async (n, v) => { await new Promise((r) => setTimeout(r, 20)); cofre.set(n, v); } },
      relogio: { agora: () => 1000 },
      recentes: new Map([["dev_x", 0]]),
      aoSegredoEntregue: (id) => void entregas.push(id),
      revogar: async () => true,
      adiar: () => undefined,
    });
    const d = { id: "dev_x", nome: "n", permissao: "leitura" };
    const [a, b] = (await Promise.all([f(d, { t: "canal_segredo" }), f(d, { t: "canal_segredo" })])) as Array<{ t: string; e?: string }>;
    expect([a?.t, b?.t].sort()).toEqual(["canal_segredo", "erro"]);
    expect([a?.e, b?.e].filter(Boolean)).toEqual(["nao_permitido"]);
    expect(entregas).toEqual(["dev_x"]);
    expect(cofre.size).toBe(1);
  });
  it("erro de gravação no cofre vira `falhou`, sem exceção e sem estado pela metade", async () => {
    const f = criarMensagemRelay({
      canais: { obter: () => null, registrar: () => { throw new Error("nao deveria"); } },
      segredos: { gravar: async () => { throw new Error("cofre"); } },
      relogio: { agora: () => 10 },
      recentes: new Map([["dev_a", 10]]),
      aoSegredoEntregue: () => undefined,
      revogar: async () => true,
      adiar: () => undefined,
    });
    const dd = { id: "dev_a", nome: "x", permissao: "leitura" };
    expect(await f(dd, { t: "canal_segredo" })).toEqual({ t: "erro", e: "falhou" });
    expect(await f(dd, { t: "canal_segredo" })).toEqual({ t: "erro", e: "falhou" }); // a permissão NÃO foi consumida: o celular pode tentar de novo
  });
});

describe("ax04_mitm_relay_no_pareamento: relay hostil no meio do pareamento", () => {
  async function montar() {
    const cen = criarCenarioRemoto();
    limpeza.push(() => cen.fechar());
    const ag = agendadorVirtual();
    const rede = criarRedeFalsa(ag);
    const cfg: ConfigRelay = { ...CONFIG_RELAY_PADRAO, url: "wss://relay.exemplo.com", consentimento_versao: TEXTO_CONSENTIMENTO_RELAY_VERSAO, reconhecimento_experimental: true };
    const porta = { ler: async (n: string) => cen.segredos.get(n) ?? null, gravar: async (n: string, v: string) => void cen.segredos.set(n, v) };
    const svc = criarServicoRelay({ remoto: cen.servico, repo: criarRepoRelay({ banco: cen.j.banco, relogio: cen.relogio }), identidade: () => carregarIdentidade(porta), segredos: porta, relogio: ag, config: () => cfg, gravarConfig: (p) => void Object.assign(cfg, p), agendar: ag.agendar, abrirWs: rede.fabrica("198.51.100.1"), aleatorio: () => 0.5 });
    limpeza.push(() => svc.desligar().then(() => undefined));
    expect(await svc.ligar()).toEqual({ ok: true });
    const r = await svc.parearIniciar();
    if ("erro" in r) throw new Error(r.erro);
    await ag.avancar(50);
    await rede.assentar();
    const par = novoParAssinatura();
    const abrir = rede.fabrica("203.0.113.7");
    const cel = new ClienteViaRelay(abrir, { url: "wss://relay.exemplo.com", canal: canalEfemero(r.codigo), chaveEnvelope: chaveEfemera(r.codigo), chavePublicaDispositivo: par.publicaSpki, chavePrivadaDispositivo: par.privadaPkcs8, aguardar: () => rede.assentar() }, "celular");
    cel.par = par;
    limpeza.push(() => cel.fechar());
    return { cen, ag, rede, svc, r, cel, cfg };
  }
  it("adulterar os quadros entre celular e host (qualquer byte) impede o pareamento: nenhum SAS, nenhum dispositivo", async () => {
    const { rede, svc, r, cel, ag } = await montar();
    expect(await cel.conectar()).toBe(true);
    rede.interpositor = ({ dados }) => {
      const x = new Uint8Array(dados);
      x[Math.floor(x.length / 2)] = (x[Math.floor(x.length / 2)] as number) ^ 0x01;
      return [{ dados: x }];
    };
    const ini = await cel.iniciarPareamento(r.codigo);
    expect(ini.ok).toBe(false);
    await ag.avancar(10);
    expect(svc.parearSas().sas).toBeNull();
    expect(svc.dispositivos()).toHaveLength(0);
  });
  it("relay que responde por conta própria (sem o código) não consegue enganar o celular: bytes aleatórios nunca abrem o invólucro", async () => {
    const { rede, cel, r } = await montar();
    expect(await cel.conectar()).toBe(true);
    rede.interpositor = ({ de, dados }) => [{ dados: de === "host" ? randomBytes(dados.length) : dados }];
    const ini = await cel.iniciarPareamento(r.codigo);
    expect(ini.ok).toBe(false);
    expect(cel.respostasDescartadas).toBeGreaterThan(0);
  });
  it("quem tem o QR vazado mas outra identidade é pego pelo pin: a impressão digital do host no link difere da que o celular recebe", async () => {
    const { r } = await montar();
    const impostor = impressaoDaIdentidade(novoParAssinatura().publicaSpki);
    expect(impressoesIguais(impostor, r.impressao_host)).toBe(false);
    expect(new URL(r.qr || "https://x.dev#").hash).toBeDefined();
  });
});
