// T-22.27 (parte de vetores): `tests/vetores/relay-e-pareamento.json` é a fonte ÚNICA dos vetores que um revisor externo reproduz. Aqui cada vetor é reproduzido byte a byte no host
// (`node:crypto`) e no PWA (`pwa/cripto.js`, WebCrypto do Node 22). Regerar (só quando o protocolo muda de propósito): `GERAR_VETORES=1 npx vitest run tests/scripts/vetores.test.ts`.
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canalId, chaveEnvelope } from "../../src/nucleo/remoto-estendido/canal";
import { preencher } from "../../src/nucleo/remoto-estendido/padding";
import { abrir, selar } from "../../src/nucleo/remoto-estendido/quadro";
import { assinarProva, dadosProva, verificarProva } from "../../src/nucleo/relay/protocolo";
import * as host from "../../src/nucleo/remoto/protocolo";
import { carregar, RAIZ, u8, type Cripto, type Padding } from "../pwa/carregar";

const ARQ = resolve(RAIZ, "tests/vetores/relay-e-pareamento.json");
const h = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const f = (s: string): Buffer => Buffer.from(s, "hex");
const seq = (n: number, ini: number): Buffer => Buffer.from(Array.from({ length: n }, (_, i) => (ini + i) & 255));
const grupos = (hex: string): string => (hex.match(/.{1,4}/g) ?? []).join(" ");
const impressao = (spki: Uint8Array): string => grupos(createHash("sha256").update(spki).digest().subarray(0, 16).toString("hex"));
const ZERO = (_max: number) => (n: number): Buffer => Buffer.alloc(n, 0xaa);

function calcular(chaves: { priv: string; spki: string; sig: string } | null) {
  const segredo = seq(32, 1);
  const codigo = "abcd-efgh-jk23";
  const segEf = createHash("sha256").update("xv/relay/pareamento-segredo|").update(host.normalizarCodigo(codigo)).digest();
  const par = { ecdh: seq(32, 10), codigo, epkC: seq(65, 20), spk: seq(65, 30), nonceC: seq(16, 40), nonceS: seq(16, 50) };
  const pc = host.derivarPareamento(par);
  const pubDisp = seq(91, 60);
  const sess = { dev: "dev_vetor01", epkC: seq(65, 70), spk: seq(65, 80), nC: seq(16, 90), nS: seq(16, 100), ts: 1_790_000_000_000 };
  const tr = host.transcricaoSessao(sess.dev, sess.epkC, sess.spk, sess.nC, sess.nS, sess.ts);
  const ks = host.derivarSessao(seq(32, 110), tr);
  const chaveEnv = chaveEnvelope(segredo, "sessao");
  const claroEnv = preencher(Buffer.from('{"id":1,"r":"canal","corpo":{"x":"ç"}}'), ZERO(8000));
  const nonceEnv = seq(12, 120);
  const sid = "ses_vetor";
  const canal = host.criarCanal({ sid, envio: ks.s2c, recebimento: ks.c2s });
  const quadroCanal = canal.selar({ t: "ping" });
  const paramsProva = { desafio: seq(16, 130), nonceCliente: seq(16, 140), canal: canalId(segredo, 20000), papel: "cliente" as const };
  const spkiDisp = chaves === null ? Buffer.alloc(0) : f(chaves.spki);
  return {
    segredo, codigo, segEf, par, pc, pubDisp, sess, tr, ks, chaveEnv, claroEnv, nonceEnv, sid, quadroCanal, paramsProva, spkiDisp,
    saida: {
      versao: 1,
      canal_id: [0, 20000].map((e) => ({ segredo: h(segredo), epoca: e, canal_id: canalId(segredo, e) })),
      chave_envelope: ["sessao", "pareamento"].map((r) => ({ segredo: h(segredo), rotulo: r, chave: h(chaveEnvelope(segredo, r)) })),
      segredo_efemero: { codigo, segredo: h(segEf), canal_id: canalId(segEf, 0), chave_envelope: h(chaveEnvelope(segEf, "pareamento")) },
      pareamento: {
        entrada: { ecdh: h(par.ecdh), codigo, epkC: h(par.epkC), spk: h(par.spk), nonceC: h(par.nonceC), nonceS: h(par.nonceS), chave_publica_dispositivo: h(pubDisp), nome: "iPhone de Teste ç", dispositivo_id: "dev_vetor01", identidade_spki: h(seq(91, 150)) },
        transcricao: h(pc.transcricao), conf: h(pc.conf), sas: pc.sas, conf_s: h(host.confServidor(pc)), conf_c: h(host.confCliente(pc, pubDisp, "iPhone de Teste ç")), mac_pareado: h(host.macPareado(pc, "dev_vetor01", seq(91, 150))),
      },
      sessao: { entrada: { dispositivo_id: sess.dev, epkC: h(sess.epkC), spk: h(sess.spk), nonceC: h(sess.nC), nonceS: h(sess.nS), ts: sess.ts, ecdh: h(seq(32, 110)) }, dados_assinados_cliente: h(host.dadosAssinadosCliente(sess.dev, sess.epkC, sess.nC, sess.ts)), transcricao: h(tr), c2s: h(ks.c2s), s2c: h(ks.s2c) },
      envelope: { chave: h(chaveEnv), aad: "xv-relay-env-v1|c2h", nonce: h(nonceEnv), claro_preenchido: h(claroEnv), quadro: h(selar(chaveEnv, claroEnv, "c2h", () => nonceEnv)) },
      canal_sessao: { sid, envio: h(ks.s2c), recebimento: h(ks.c2s), mensagem: { t: "ping" }, quadro: quadroCanal },
      padding: [0, 5, 253, 254, 1021, 1022, 4093, 4094, 9000].map((n) => ({ comprimento: n, conteudo: h(seq(n, 3)), aleatorio_byte: "aa", quadro: h(preencher(seq(n, 3), ZERO(20000))) })),
      padding_enchimento: { aleatorio_byte: "aa", quadro: h(preencher(null, ZERO(20000))) },
      prova_de_posse: chaves === null ? null : { chave_privada_pkcs8: chaves.priv, chave_publica_spki: chaves.spki, desafio: h(paramsProva.desafio), nonce_cliente: h(paramsProva.nonceCliente), canal: paramsProva.canal, papel: "cliente", dados: h(dadosProva(paramsProva)), assinatura_p1363: chaves.sig },
      impressao_digital: { spki: h(seq(91, 150)), impressao: impressao(seq(91, 150)) },
    },
  };
}
function novasChaves() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const priv = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const p = { desafio: seq(16, 130), nonceCliente: seq(16, 140), canal: canalId(seq(32, 1), 20000), papel: "cliente" as const };
  return { priv: h(priv), spki: h(spki), sig: h(assinarProva(priv, p)) };
}

if (process.env["GERAR_VETORES"] === "1") {
  writeFileSync(ARQ, JSON.stringify(calcular(novasChaves()).saida, null, 2) + "\n");
}
const V = JSON.parse(readFileSync(ARQ, "utf8")) as ReturnType<typeof calcular>["saida"];
const K = V.prova_de_posse as NonNullable<typeof V.prova_de_posse>;

describe("vetores: host (node:crypto) reproduz o arquivo", () => {
  const c = calcular({ priv: K.chave_privada_pkcs8, spki: K.chave_publica_spki, sig: K.assinatura_p1363 });
  it("tudo que é determinístico bate byte a byte com o JSON versionado", () => {
    expect(c.saida).toEqual(V);
  });
  it("prova de posse: a assinatura guardada verifica; dados, chave, canal, papel ou assinatura alterados não", () => {
    const p = c.paramsProva;
    expect(verificarProva(f(K.chave_publica_spki), p, f(K.assinatura_p1363))).toBe(true);
    expect(verificarProva(f(K.chave_publica_spki), { ...p, papel: "host" }, f(K.assinatura_p1363))).toBe(false);
    expect(verificarProva(f(K.chave_publica_spki), { ...p, canal: canalId(c.segredo, 20001) }, f(K.assinatura_p1363))).toBe(false);
    expect(verificarProva(f(K.chave_publica_spki), p, f(K.assinatura_p1363.replace(/^./, (x) => (x === "0" ? "1" : "0"))))).toBe(false);
    expect(createPublicKey({ key: f(K.chave_publica_spki), format: "der", type: "spki" }).asymmetricKeyType).toBe("ec");
  });
  it("invólucro: o quadro do vetor abre com a chave e a AAD certas e não abre com a direção trocada", () => {
    const q = f(V.envelope.quadro);
    expect(abrir(f(V.envelope.chave), q, "c2h")?.equals(f(V.envelope.claro_preenchido))).toBe(true);
    expect(abrir(f(V.envelope.chave), q, "h2c")).toBeNull();
  });
  it("canal de sessão: o quadro n=1 abre do outro lado e o contador não aceita repetição", () => {
    const outro = host.criarCanal({ sid: V.canal_sessao.sid, envio: f(V.canal_sessao.recebimento), recebimento: f(V.canal_sessao.envio) });
    expect(outro.abrir(V.canal_sessao.quadro)).toEqual(V.canal_sessao.mensagem);
    expect(outro.abrir(V.canal_sessao.quadro)).toBeNull();
  });
});

describe("vetores: PWA (WebCrypto) reproduz o arquivo", async () => {
  const w = await carregar<Cripto>("pwa/cripto.js");
  const p = await carregar<Padding>("pwa/padding.js");
  it("canal_id, chave de invólucro e segredo efêmero de pareamento", async () => {
    for (const x of V.canal_id) expect(await w.canalId(u8(f(x.segredo)), x.epoca)).toBe(x.canal_id);
    for (const x of V.chave_envelope) expect(h(await w.chaveEnvelope(u8(f(x.segredo)), x.rotulo))).toBe(x.chave);
    const s = V.segredo_efemero;
    const seg = await w.sha256("xv/relay/pareamento-segredo|" + s.codigo.trim().toUpperCase().replace(/[-\s]/g, ""));
    expect(h(seg)).toBe(s.segredo);
    expect(await w.canalId(seg, 0)).toBe(s.canal_id);
    expect(h(await w.chaveEnvelope(seg, "pareamento"))).toBe(s.chave_envelope);
  });
  it("pareamento: transcrição, conf, SAS, conf_s, conf_c e mac", async () => {
    const e = V.pareamento.entrada;
    const d = await w.derivarPareamento({ ecdh: u8(f(e.ecdh)), codigo: e.codigo, epkC: u8(f(e.epkC)), spk: u8(f(e.spk)), nonceC: u8(f(e.nonceC)), nonceS: u8(f(e.nonceS)) });
    expect(h(d.transcricao)).toBe(V.pareamento.transcricao);
    expect(h(d.conf)).toBe(V.pareamento.conf);
    expect(d.sas).toBe(V.pareamento.sas);
    expect(h(await w.confServidor(d))).toBe(V.pareamento.conf_s);
    expect(h(await w.confCliente(d, u8(f(e.chave_publica_dispositivo)), e.nome))).toBe(V.pareamento.conf_c);
    expect(h(await w.macPareado(d, e.dispositivo_id, u8(f(e.identidade_spki))))).toBe(V.pareamento.mac_pareado);
  });
  it("sessão: dados assinados, transcrição e chaves c2s/s2c; canal AES-GCM produz o MESMO quadro n=1", async () => {
    const e = V.sessao.entrada;
    expect(h(w.dadosAssinadosCliente(e.dispositivo_id, u8(f(e.epkC)), u8(f(e.nonceC)), e.ts))).toBe(V.sessao.dados_assinados_cliente);
    const tr = await w.transcricaoSessao(e.dispositivo_id, u8(f(e.epkC)), u8(f(e.spk)), u8(f(e.nonceC)), u8(f(e.nonceS)), e.ts);
    expect(h(tr)).toBe(V.sessao.transcricao);
    const k = await w.derivarSessao(u8(f(e.ecdh)), tr);
    expect(h(k.c2s)).toBe(V.sessao.c2s);
    expect(h(k.s2c)).toBe(V.sessao.s2c);
    const canal = w.criarCanal({ sid: V.canal_sessao.sid, envio: u8(f(V.canal_sessao.envio)), recebimento: u8(f(V.canal_sessao.recebimento)) });
    expect(await canal.selar(V.canal_sessao.mensagem)).toEqual(V.canal_sessao.quadro);
    const outro = w.criarCanal({ sid: V.canal_sessao.sid, envio: u8(f(V.canal_sessao.recebimento)), recebimento: u8(f(V.canal_sessao.envio)) });
    expect(await outro.abrir(V.canal_sessao.quadro)).toEqual(V.canal_sessao.mensagem);
    expect(await outro.abrir(V.canal_sessao.quadro)).toBeNull();
  });
  it("invólucro: abre o quadro do host; o que o PWA sela, o host abre; direção trocada falha", async () => {
    const aad = V.envelope.aad;
    expect(h((await w.abrirEnvelope(u8(f(V.envelope.chave)), u8(f(V.envelope.quadro)), aad)) as Uint8Array)).toBe(V.envelope.claro_preenchido);
    expect(await w.abrirEnvelope(u8(f(V.envelope.chave)), u8(f(V.envelope.quadro)), "xv-relay-env-v1|h2c")).toBeNull();
    const selado = await w.selarEnvelope(u8(f(V.envelope.chave)), u8(f(V.envelope.claro_preenchido)), aad);
    expect(abrir(f(V.envelope.chave), selado, "c2h")?.toString("hex")).toBe(V.envelope.claro_preenchido);
  });
  it("padding: quadros idênticos aos do host (dados e enchimento)", () => {
    const alea = (n: number): Uint8Array => new Uint8Array(n).fill(0xaa);
    for (const x of V.padding) expect(h(p.preencher(u8(f(x.conteudo)), alea))).toBe(x.quadro);
    expect(h(p.preencher(null, alea))).toBe(V.padding_enchimento.quadro);
    for (const x of V.padding) expect(h(p.remover(u8(f(x.quadro)))?.conteudo ?? new Uint8Array())).toBe(x.conteudo);
  });
  it("prova de posse: o PWA verifica a assinatura feita pelo host (P1363) e recusa a alterada", async () => {
    expect(await w.verificar(u8(f(K.chave_publica_spki)), u8(f(K.dados)), u8(f(K.assinatura_p1363)))).toBe(true);
    const ruim = f(K.dados);
    ruim[ruim.length - 1]! ^= 1;
    expect(await w.verificar(u8(f(K.chave_publica_spki)), u8(ruim), u8(f(K.assinatura_p1363)))).toBe(false);
  });
  it("impressão digital: SHA-256 dos 16 primeiros bytes, em grupos de 4 hex, igual nos dois lados", async () => {
    const d = await w.sha256(u8(f(V.impressao_digital.spki)));
    expect(grupos(h(d.subarray(0, 16)))).toBe(V.impressao_digital.impressao);
    expect(V.impressao_digital.impressao).toMatch(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
  });
});

describe("vetores: especificação escrita (docs/ade/REVISAO-EXTERNA-RELAY.md)", () => {
  const DOC = resolve(RAIZ, "docs/ade/REVISAO-EXTERNA-RELAY.md");
  it("cobre 100% dos tipos de mensagem do relay (parseControle) e os nomes dos vetores", () => {
    const fonte = readFileSync(resolve(RAIZ, "src/nucleo/relay/protocolo.ts"), "utf8");
    const corpo = fonte.slice(fonte.indexOf("export function parseControle"), fonte.indexOf("export const serializar"));
    const tipos = [...corpo.matchAll(/case "([a-z]+)":/g)].map((m) => m[1] as string).filter((t) => t !== "string");
    expect(new Set(tipos)).toEqual(new Set(["hello", "desafio", "prova", "ok", "ping", "pong", "fechar", "desregistrar", "erro"]));
    const doc = readFileSync(DOC, "utf8");
    for (const t of tipos) expect(doc, `tipo ${t}`).toMatch(new RegExp(`\`${t}\``));
    for (const nome of Object.keys(V)) if (nome !== "versao") expect(doc, `vetor ${nome}`).toContain(nome);
  });
});
