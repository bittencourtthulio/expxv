// T-22.14: vetores CRUZADOS. O mesmo transcrito produzido por `node:crypto` (host) e por WebCrypto (PWA, aqui rodando no Node 22) dá bytes idênticos.
import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canalId as canalIdHost, chaveEnvelope as chaveEnvelopeHost } from "../../src/nucleo/remoto-estendido/canal";
import { codificar as codificarHost, decodificar as decodificarHost } from "../../src/nucleo/remoto-estendido/quadro";
import { preencher as preencherHost, remover as removerHost } from "../../src/nucleo/remoto-estendido/padding";
import * as host from "../../src/nucleo/remoto/protocolo";
import { carregar, RAIZ, u8, type Cripto, type Padding } from "./carregar";

const eq = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe("cripto do PWA (WebCrypto) x host (node:crypto)", async () => {
  const c = await carregar<Cripto>("pwa/cripto.js");
  const p = await carregar<Padding>("pwa/padding.js");

  it("HKDF e HMAC: bytes idênticos", async () => {
    for (let i = 0; i < 20; i++) {
      const ikm = randomBytes(32);
      const salt = randomBytes(i % 3 === 0 ? 0 : 32);
      const info = `info-${i}`;
      expect(eq(await c.hkdf(u8(ikm), u8(salt), info, 32), u8(Buffer.from(hkdfSync("sha256", ikm, salt, info, 32))))).toBe(true);
      expect(eq(await c.hmac(u8(ikm), u8(salt)), u8(createHmac("sha256", ikm).update(salt).digest()))).toBe(true);
    }
  });
  it("ECDH P-256: o segredo é o mesmo nos dois lados, nos dois sentidos", async () => {
    const h = host.novoParEfemero();
    const w = await c.parEfemero();
    expect(w.publica).toHaveLength(65);
    const sw = await w.segredoCom(u8(h.publica));
    const sh = h.segredoCom(Buffer.from(w.publica));
    expect(sw).not.toBeNull();
    expect(eq(sw as Uint8Array, u8(sh as Buffer))).toBe(true);
    expect(await w.segredoCom(randomBytes(65))).toBeNull(); // ponto fora da curva
  });
  it("pareamento: conf, SAS, conf_s, conf_c e mac do pareamento idênticos (e o SAS tem 6 dígitos)", async () => {
    for (let i = 0; i < 10; i++) {
      const par = { ecdh: randomBytes(32), codigo: host.formatarCodigo(host.gerarCodigo()), epkC: randomBytes(65), spk: randomBytes(65), nonceC: randomBytes(16), nonceS: randomBytes(16) };
      const h = host.derivarPareamento(par);
      const w = await c.derivarPareamento({ ...par, ecdh: u8(par.ecdh), epkC: u8(par.epkC), spk: u8(par.spk), nonceC: u8(par.nonceC), nonceS: u8(par.nonceS) });
      expect(eq(w.conf, u8(h.conf))).toBe(true);
      expect(eq(w.transcricao, u8(h.transcricao))).toBe(true);
      expect(w.sas).toBe(h.sas);
      expect(w.sas).toMatch(/^\d{6}$/);
      expect(eq(await c.confServidor(w), u8(host.confServidor(h)))).toBe(true);
      const pubDisp = randomBytes(91);
      expect(eq(await c.confCliente(w, u8(pubDisp), "iPhone de Teste ç"), u8(host.confCliente(h, pubDisp, "iPhone de Teste ç")))).toBe(true);
      expect(eq(await c.macPareado(w, "dev_abc123", u8(pubDisp)), u8(host.macPareado(h, "dev_abc123", pubDisp)))).toBe(true);
    }
    // código com hífen/minúsculas normaliza igual
    const par = { ecdh: randomBytes(32), codigo: "ab12-cd34-ef56", epkC: randomBytes(65), spk: randomBytes(65), nonceC: randomBytes(16), nonceS: randomBytes(16) };
    const w = await c.derivarPareamento({ ...par, ecdh: u8(par.ecdh), epkC: u8(par.epkC), spk: u8(par.spk), nonceC: u8(par.nonceC), nonceS: u8(par.nonceS) });
    expect(w.sas).toBe(host.derivarPareamento(par).sas);
  });
  it("sessão: transcrição, chaves c2s/s2c e dados assinados idênticos; canais AES-GCM interoperam nos dois sentidos", async () => {
    const ecdh = randomBytes(32);
    const [epkC, spk, nC, nS] = [randomBytes(65), randomBytes(65), randomBytes(16), randomBytes(16)];
    const ts = 1_790_000_000_000;
    const trH = host.transcricaoSessao("dev_abc123", epkC, spk, nC, nS, ts);
    const trW = await c.transcricaoSessao("dev_abc123", u8(epkC), u8(spk), u8(nC), u8(nS), ts);
    expect(eq(trW, u8(trH))).toBe(true);
    const kH = host.derivarSessao(ecdh, trH);
    const kW = await c.derivarSessao(u8(ecdh), trW);
    expect(eq(kW.c2s, u8(kH.c2s)) && eq(kW.s2c, u8(kH.s2c))).toBe(true);
    expect(eq(c.dadosAssinadosCliente("dev_abc123", u8(epkC), u8(nC), ts), u8(host.dadosAssinadosCliente("dev_abc123", epkC, nC, ts)))).toBe(true);
    // host (servidor) <-> PWA (cliente)
    const canalH = host.criarCanal({ sid: "ses_x", envio: kH.s2c, recebimento: kH.c2s });
    const canalW = c.criarCanal({ sid: "ses_x", envio: kW.c2s, recebimento: kW.s2c });
    for (let i = 1; i <= 5; i++) {
      const q = await canalW.selar({ t: "comando", texto: `ação ${i} ç` });
      expect(canalH.abrir(q)).toEqual({ t: "comando", texto: `ação ${i} ç` });
      expect(await canalW.abrir(canalH.selar({ t: "resultado", i }))).toEqual({ t: "resultado", i });
    }
    // quadro repetido, adulterado e com sid errado: nulos
    const q = await canalW.selar({ t: "ping" });
    expect(canalH.abrir(q)).toEqual({ t: "ping" });
    expect(canalH.abrir(q)).toBeNull();
    const adult = { ...(await canalW.selar({ t: "ping" })) };
    adult.c = adult.c.slice(0, -4) + "AAAA";
    expect(canalH.abrir(adult)).toBeNull();
    const outroSid = c.criarCanal({ sid: "ses_y", envio: kW.c2s, recebimento: kW.s2c });
    expect(canalH.abrir(await outroSid.selar({ t: "ping" }))).toBeNull();
  });
  it("contador do canal nunca repete em 100 000 quadros", async () => {
    const k = randomBytes(32);
    const canal = c.criarCanal({ sid: "ses_z", envio: u8(k), recebimento: u8(k) });
    let anterior = 0;
    let ok = true;
    for (let i = 0; i < 100_000; i++) {
      const q = await canal.selar(1);
      if (q.n !== anterior + 1) ok = false;
      anterior = q.n;
    }
    expect(ok).toBe(true);
    expect(anterior).toBe(100_000);
  }, 60_000);
  it("ECDSA: assinatura do PWA verifica no host e a do host verifica no PWA", async () => {
    const k = await c.gerarChaveDispositivo();
    const dados = randomBytes(40);
    const sig = await c.assinar(k.privada, u8(dados));
    expect(sig).toHaveLength(64);
    expect(host.verificarAssinatura(Buffer.from(k.publicaSpki), dados, Buffer.from(sig))).toBe(true);
    const par = host.novoParAssinatura();
    const sigH = host.assinar(par.privadaPkcs8, dados);
    expect(await c.verificar(u8(par.publicaSpki), u8(dados), u8(sigH))).toBe(true);
    expect(await c.verificar(u8(par.publicaSpki), u8(randomBytes(40)), u8(sigH))).toBe(false);
  });
  it("ax13_chave_nao_extraivel: exportKey falha, extractable=false, e o código nunca usa localStorage/IndexedDB/exportKey da privada", async () => {
    const k = await c.gerarChaveDispositivo();
    expect(k.privada.extractable).toBe(false);
    for (const fmt of ["pkcs8", "jwk"] as const) await expect(crypto.subtle.exportKey(fmt, k.privada)).rejects.toThrow();
    expect(k.publicaSpki.length).toBeGreaterThan(60); // a pública é exportável
    const fonte = readFileSync(`${RAIZ}/pwa/cripto.js`, "utf8") + readFileSync(`${RAIZ}/pwa/app.js`, "utf8");
    expect(fonte).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(fonte).not.toMatch(/exportKey\("(pkcs8|jwk)"/);
    expect(fonte).toMatch(/generateKey\(\{ name: "ECDSA", namedCurve: "P-256" \}, false,/); // extractable:false
  });
  it("canal_id e chave de invólucro: iguais ao host; invólucro (AES-GCM) interopera nos dois sentidos", async () => {
    const seg = randomBytes(32);
    for (const e of [0, 20000, 20999, 4_000_000]) expect(await c.canalId(u8(seg), e)).toBe(canalIdHost(seg, e));
    expect(await c.canalId(u8(Buffer.alloc(32, 1)), 20000)).toBe("3bc59c1360d9c9e8304599e676ab1b61");
    const kW = await c.chaveEnvelope(u8(seg), "sessao");
    expect(eq(kW, u8(chaveEnvelopeHost(seg, "sessao")))).toBe(true);
    // PWA sela (c2h) -> host decodifica
    const claro = p.preencher(u8(Buffer.from(JSON.stringify({ r: "canal", id: 1, corpo: { x: "ç" } }))));
    const selado = await c.selarEnvelope(kW, claro, "xv-relay-env-v1|c2h");
    expect(decodificarHost(Buffer.from(kW), selado, "c2h")).toMatchObject({ tipo: "dado", mensagem: { r: "canal", id: 1 } });
    // host codifica (h2c) -> PWA abre e remove padding
    const q = codificarHost(Buffer.from(kW), { id: 1, status: 200, corpo: { ok: true } }, "h2c");
    const aberto = await c.abrirEnvelope(kW, u8(q), "xv-relay-env-v1|h2c");
    const sem = p.remover(aberto as Uint8Array);
    expect(JSON.parse(Buffer.from(sem?.conteudo ?? []).toString())).toEqual({ id: 1, status: 200, corpo: { ok: true } });
    expect(await c.abrirEnvelope(kW, u8(q), "xv-relay-env-v1|c2h")).toBeNull();
  });
  it("padding do PWA e do host se desfazem mutuamente", () => {
    for (const n of [0, 5, 253, 254, 700, 3000, 9000]) {
      const dado = randomBytes(n);
      const pw = p.preencher(u8(dado));
      expect(removerHost(pw)?.conteudo.equals(dado)).toBe(true);
      expect(Buffer.from(p.remover(u8(preencherHost(dado)))?.conteudo ?? []).equals(dado)).toBe(true);
    }
    expect(p.remover(u8(preencherHost(null)))?.tipo).toBe("enchimento");
    expect(p.remover(new Uint8Array(2))).toBeNull();
    expect(p.tamanhoDoBloco(300)).toBe(1024);
  });
});
