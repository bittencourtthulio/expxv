import { createHash, hkdfSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FRAME_MAX,
  JANELA_TS_MS,
  TAMANHO_CODIGO,
  _limparVistos,
  assinar,
  confCliente,
  confServidor,
  criarCanal,
  criarPareamentoServidor,
  dadosAssinadosCliente,
  derivarPareamento,
  derivarSessao,
  formatarCodigo,
  gerarCodigo,
  iniciarSessaoServidor,
  normalizarCodigo,
  novoParAssinatura,
  novoParEfemero,
  transcricaoSessao,
  verificarAssinatura,
} from "./protocolo";

const relogio = () => {
  let t = 1_700_000_000_000;
  return { agora: () => t, avancar: (ms: number) => void (t += ms) };
};
const ident = novoParAssinatura();
const identidadeSpki = () => ident.publicaSpki;

/** cliente de teste mínimo do pareamento: devolve o corpo de `inicio` e uma função para montar o `fim` com o código dado. */
function clienteDePareamento(codigo: string, nome = "celular") {
  const e = novoParEfemero();
  const nonceC = randomBytes(16);
  const par = novoParAssinatura();
  return {
    par,
    inicio: { epk: e.publica.toString("base64"), nonce: nonceC.toString("base64") },
    fim(resp: { hid: string; spk: string; nonce_s: string; conf_s: string }) {
      const spk = Buffer.from(resp.spk, "base64");
      const ecdh = e.segredoCom(spk) as Buffer;
      const chaves = derivarPareamento({ ecdh, codigo, epkC: e.publica, spk, nonceC, nonceS: Buffer.from(resp.nonce_s, "base64") });
      return { chaves, corpo: { hid: resp.hid, conf: confCliente(chaves, par.publicaSpki, nome).toString("base64"), chave_publica: par.publicaSpki.toString("base64"), nome } };
    },
  };
}

describe("código de pareamento (P-68)", () => {
  it("12 caracteres de alfabeto sem ambíguos = 60 bits; normalização", () => {
    const c = gerarCodigo();
    expect(c).toHaveLength(TAMANHO_CODIGO);
    expect(TAMANHO_CODIGO * 5).toBeGreaterThanOrEqual(60);
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(normalizarCodigo(` ${formatarCodigo(c).toLowerCase()} `)).toBe(c);
    expect(new Set(Array.from({ length: 200 }, () => gerarCodigo())).size).toBe(200);
  });
});

describe("pareamento (servidor)", () => {
  it("caminho feliz: SAS igual nos dois lados, desktop decide, resultado autenticado pelo MAC", () => {
    const r = relogio();
    const p = criarPareamentoServidor({ relogio: r, identidadeSpki });
    const { codigo } = p.abrir();
    const cli = clienteDePareamento(normalizarCodigo(codigo));
    const ini = p.inicio(cli.inicio);
    expect(ini).not.toBeNull();
    const { chaves, corpo } = cli.fim(ini!);
    expect(Buffer.from(ini!.conf_s, "base64").equals(confServidor(chaves))).toBe(true); // o servidor prova que sabe o código
    expect(p.fim(corpo)).toEqual({ ok: true });
    expect(p.sasPendente()).toBe(chaves.sas);
    expect(chaves.sas).toMatch(/^\d{6}$/);
    expect(p.status(ini!.hid)).toEqual({ estado: "aguardando" });
    const pedido = p.decidir(ini!.hid, true);
    expect(pedido?.chave_publica.equals(cli.par.publicaSpki)).toBe(true);
    p.concluir(ini!.hid, "dev_x");
    const st = p.status(ini!.hid) as { estado: string; identidade: string; mac: string };
    expect(st.estado).toBe("pareado");
    expect(Buffer.from(st.identidade, "base64").equals(ident.publicaSpki)).toBe(true);
  });
  it("código errado 5x fecha a janela; depois nem o código certo entra (AC-07)", () => {
    const p = criarPareamentoServidor({ relogio: relogio(), identidadeSpki });
    const { codigo } = p.abrir();
    for (let i = 0; i < 5; i++) {
      const cli = clienteDePareamento("AAAAAAAAAAAA");
      const ini = p.inicio(cli.inicio);
      if (ini === null) break;
      expect(p.fim(cli.fim(ini).corpo)).toBeNull();
    }
    expect(p.estado()).toBe("fechado");
    const certo = clienteDePareamento(normalizarCodigo(codigo));
    expect(p.inicio(certo.inicio)).toBeNull();
  });
  it("uso único: o código queima ao acertar; reuso e expiração = recusa uniforme (AC-07)", () => {
    const r = relogio();
    const p = criarPareamentoServidor({ relogio: r, identidadeSpki });
    const { codigo } = p.abrir();
    const c1 = clienteDePareamento(normalizarCodigo(codigo));
    const i1 = p.inicio(c1.inicio)!;
    expect(p.fim(c1.fim(i1).corpo)).toEqual({ ok: true });
    expect(p.inicio(clienteDePareamento(normalizarCodigo(codigo)).inicio)).toBeNull(); // 2º uso
    const p2 = criarPareamentoServidor({ relogio: r, identidadeSpki });
    const { codigo: c2 } = p2.abrir();
    r.avancar(120_001);
    expect(p2.inicio(clienteDePareamento(normalizarCodigo(c2)).inicio)).toBeNull(); // TTL 120 s
    expect(p2.estado()).toBe("fechado");
  });
  it("atacante sem o código não chega a SAS igual nem a pedido no desktop (AC-08)", () => {
    const p = criarPareamentoServidor({ relogio: relogio(), identidadeSpki });
    p.abrir();
    const mitm = clienteDePareamento("BBBBBBBBBBBB");
    const ini = p.inicio(mitm.inicio)!;
    const { chaves, corpo } = mitm.fim(ini);
    expect(Buffer.from(ini.conf_s, "base64").equals(confServidor(chaves))).toBe(false); // o cliente honesto aborta aqui
    expect(p.fim(corpo)).toBeNull();
    expect(p.sasPendente()).toBeNull();
  });
  it("campos do `fim` adulterados (nome/chave) invalidam o MAC", () => {
    const p = criarPareamentoServidor({ relogio: relogio(), identidadeSpki });
    const { codigo } = p.abrir();
    const cli = clienteDePareamento(normalizarCodigo(codigo));
    const { corpo } = cli.fim(p.inicio(cli.inicio)!);
    expect(p.fim({ ...corpo, nome: "outro" })).toBeNull();
  });
  it("entrada inválida (ponto fora da curva, tamanhos, tipos) é recusada sem lançar", () => {
    const p = criarPareamentoServidor({ relogio: relogio(), identidadeSpki });
    p.abrir();
    for (const c of [null, 1, "x", {}, { epk: "AA==", nonce: "AA==" }, { epk: Buffer.alloc(65, 1).toString("base64"), nonce: randomBytes(16).toString("base64") }]) expect(p.inicio(c)).toBeNull();
    expect(p.fim(null)).toBeNull();
    expect(p.status(42)).toBeNull();
  });
  it("negar no desktop encerra e o cliente recebe 'negado'", () => {
    const p = criarPareamentoServidor({ relogio: relogio(), identidadeSpki });
    const { codigo } = p.abrir();
    const cli = clienteDePareamento(normalizarCodigo(codigo));
    const ini = p.inicio(cli.inicio)!;
    p.fim(cli.fim(ini).corpo);
    expect(p.decidir(ini.hid, false)).toBeNull();
    expect(p.status(ini.hid)).toEqual({ estado: "negado" });
  });
});

describe("sessão (reconexão com assinaturas mútuas) e canal AES-GCM", () => {
  beforeEach(_limparVistos);
  const montar = () => {
    const r = relogio();
    const disp = novoParAssinatura();
    const deps = { relogio: r, identidade: { assinar: (d: Buffer) => assinar(ident.privadaPkcs8, d) }, chaveDoDispositivo: (id: string) => (id === "dev_abcdef12" ? disp.publicaSpki : null) };
    const e = novoParEfemero();
    const nonceC = randomBytes(16);
    const pedido = (ts = r.agora(), id = "dev_abcdef12") => ({ dispositivo_id: id, epk: e.publica.toString("base64"), nonce: nonceC.toString("base64"), ts, sig: assinar(disp.privadaPkcs8, dadosAssinadosCliente(id, e.publica, nonceC, ts)).toString("base64") });
    return { r, disp, deps, e, nonceC, pedido };
  };
  it("negocia, o dispositivo verifica a assinatura do servidor e os dois canais conversam", () => {
    const { r, deps, e, nonceC, pedido } = montar();
    const ts = r.agora();
    const s = iniciarSessaoServidor(deps, pedido(ts))!;
    expect(s).not.toBeNull();
    const spk = Buffer.from(s.resposta.spk, "base64");
    const nonceS = Buffer.from(s.resposta.nonce_s, "base64");
    const tr = transcricaoSessao("dev_abcdef12", e.publica, spk, nonceC, nonceS, ts);
    expect(verificarAssinatura(ident.publicaSpki, tr, Buffer.from(s.resposta.sig_s, "base64"))).toBe(true);
    const k = derivarSessao(e.segredoCom(spk) as Buffer, tr);
    const cliente = criarCanal({ sid: s.sid, envio: k.c2s, recebimento: k.s2c });
    expect(s.canal.abrir(cliente.selar({ t: "ping" }))).toEqual({ t: "ping" });
    expect(cliente.abrir(s.canal.selar({ t: "pong" }))).toEqual({ t: "pong" });
  });
  it("servidor impostor (outra identidade) não passa na verificação do dispositivo", () => {
    const { r, deps, e, nonceC, pedido } = montar();
    const ts = r.agora();
    const falso = novoParAssinatura();
    const s = iniciarSessaoServidor({ ...deps, identidade: { assinar: (d) => assinar(falso.privadaPkcs8, d) } }, pedido(ts))!;
    const tr = transcricaoSessao("dev_abcdef12", e.publica, Buffer.from(s.resposta.spk, "base64"), nonceC, Buffer.from(s.resposta.nonce_s, "base64"), ts);
    expect(verificarAssinatura(ident.publicaSpki, tr, Buffer.from(s.resposta.sig_s, "base64"))).toBe(false);
  });
  it("replay do pedido de sessão (mesmo nonce), ts velho/futuro, assinatura errada, dispositivo desconhecido/revogado: tudo recusado (AC-24)", () => {
    const { r, deps, pedido } = montar();
    const p = pedido();
    expect(iniciarSessaoServidor(deps, p)).not.toBeNull();
    expect(iniciarSessaoServidor(deps, p)).toBeNull(); // replay
    // ts fora da janela, cada um com nonce NOVO (senão o anti-replay mascararia a checagem de tempo)
    for (const ts of [r.agora() - JANELA_TS_MS - 1, r.agora() + JANELA_TS_MS + 1]) {
      const m = montar();
      expect(iniciarSessaoServidor(m.deps, m.pedido(ts))).toBeNull();
      expect(iniciarSessaoServidor(m.deps, m.pedido(m.r.agora()))).not.toBeNull(); // o mesmo pedido, com ts atual, passa
    }
    expect(iniciarSessaoServidor(deps, { ...pedido(), sig: Buffer.alloc(64).toString("base64") })).toBeNull();
    expect(iniciarSessaoServidor(deps, pedido(r.agora(), "dev_desconhecido"))).toBeNull();
    expect(iniciarSessaoServidor({ ...deps, chaveDoDispositivo: () => null }, pedido())).toBeNull(); // revogado: o armazém devolve null
  });
  it("canal: quadro repetido, menor, adulterado, com sid trocado ou grande demais = recusado (AC-11)", () => {
    const k = { c2s: randomBytes(32), s2c: randomBytes(32) };
    const a = criarCanal({ sid: "ses_1", envio: k.c2s, recebimento: k.s2c });
    const b = criarCanal({ sid: "ses_1", envio: k.s2c, recebimento: k.c2s });
    const q1 = a.selar({ n: 1 });
    const q2 = a.selar({ n: 2 });
    expect(b.abrir(q2)).toEqual({ n: 2 });
    expect(b.abrir(q1)).toBeNull(); // fora de ordem (contador menor)
    expect(b.abrir(q2)).toBeNull(); // repetido
    const q3 = a.selar({ n: 3 });
    const adulterado = { ...q3, c: Buffer.from(Buffer.from(q3.c, "base64").map((x, i) => (i === 0 ? x ^ 1 : x))).toString("base64") };
    expect(b.abrir(adulterado)).toBeNull();
    expect(b.abrir(q3)).toEqual({ n: 3 }); // quadro falso não queimou o contador
    const outra = criarCanal({ sid: "ses_2", envio: k.s2c, recebimento: k.c2s });
    expect(outra.abrir(a.selar({ n: 4 }))).toBeNull(); // AAD inclui o sid
    expect(b.abrir({ v: 1, n: 99, c: "A".repeat(FRAME_MAX * 3) })).toBeNull();
    for (const x of [null, 1, "x", {}, { v: 2, n: 5, c: "AAAA" }, { v: 1, n: -1, c: "AAAA" }, { v: 1, n: 1.5, c: "AAAA" }]) expect(b.abrir(x)).toBeNull();
  });
  it("direções independentes: eco do quadro do outro lado não abre", () => {
    const k = { c2s: randomBytes(32), s2c: randomBytes(32) };
    const a = criarCanal({ sid: "s", envio: k.c2s, recebimento: k.s2c });
    expect(a.abrir(a.selar({ x: 1 }))).toBeNull(); // refletir o próprio quadro (reflection attack)
  });
});

describe("vetores e primitivas padrão", () => {
  it("HKDF-SHA256 confere com o vetor 1 da RFC 5869", () => {
    const ikm = Buffer.alloc(22, 0x0b);
    const salt = Buffer.from("000102030405060708090a0b0c", "hex");
    const info = Buffer.from("f0f1f2f3f4f5f6f7f8f9", "hex");
    expect(Buffer.from(hkdfSync("sha256", ikm, salt, info, 42)).toString("hex")).toBe("3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");
  });
  it("derivação do pareamento é determinística e depende do código, das chaves e dos nonces", () => {
    const ecdh = Buffer.alloc(32, 7);
    const base = { ecdh, codigo: "ABCD-EFGH-JKLM", epkC: Buffer.alloc(65, 4), spk: Buffer.alloc(65, 5), nonceC: Buffer.alloc(16, 1), nonceS: Buffer.alloc(16, 2) };
    const a = derivarPareamento(base);
    expect(derivarPareamento(base).sas).toBe(a.sas);
    expect(derivarPareamento({ ...base, codigo: "abcdefghjklm" }).sas).toBe(a.sas); // normalização
    expect(derivarPareamento({ ...base, codigo: "ABCDEFGHJKLN" }).sas).not.toBe(a.sas);
    expect(derivarPareamento({ ...base, nonceS: Buffer.alloc(16, 3) }).conf.equals(a.conf)).toBe(false);
    // vetor gravado: muda se alguém alterar a derivação sem querer
    expect(createHash("sha256").update(a.conf).digest("hex").slice(0, 16)).toBe("26d7a7453e225d74");
  });
  it("só `node:crypto` e `node:` internos: nenhuma biblioteca de criptografia própria ou de terceiros", () => {
    const fonte = readFileSync(join(__dirname, "protocolo.ts"), "utf8");
    const imports = [...fonte.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["node:crypto"]);
    expect(fonte).not.toMatch(/\b(?:xor|rot13|btoa|CryptoJS|forge|tweetnacl)\b/i);
  });
});
