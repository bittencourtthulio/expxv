import { describe, expect, it } from "vitest";
import { relogioFalso } from "../../../tests/fixtures/relay/cenarios";
import { chaveDeIp, criarBalde, criarLimites } from "./limites";

describe("limites do relay", () => {
  it("balde: esgota, recarrega com o tempo e nunca passa da capacidade", () => {
    const rel = relogioFalso();
    const b = criarBalde(rel, 3, 1);
    expect([b.tentar(), b.tentar(), b.tentar(), b.tentar()]).toEqual([true, true, true, false]);
    rel.avancar(2000);
    expect(b.tentar(2)).toBe(true);
    expect(b.tentar()).toBe(false);
    rel.avancar(1e9);
    expect(b.fichas()).toBe(3);
  });
  it("conexões por IP e global; liberar devolve; canais novos têm teto", () => {
    const l = criarLimites(relogioFalso(), { maxConexoesPorIp: 2, maxConexoes: 3, maxCanais: 1 });
    expect([l.admitir("a"), l.admitir("a"), l.admitir("a"), l.admitir("b"), l.admitir("c")]).toEqual([true, true, false, true, false]);
    l.liberar("a");
    expect(l.admitir("c")).toBe(true);
    expect(l.totalConexoes()).toBe(3);
    expect(l.canalNovo(0)).toBe(true);
    expect(l.canalNovo(1)).toBe(false);
  });
  it("varrer não deixa crescer a tabela de IPs sem conexão", () => {
    const rel = relogioFalso();
    const l = criarLimites(rel);
    for (let i = 0; i < 100; i++) (l.hello(`ip${i}`), l.mensagem(`ip${i}`));
    expect(l.ipsRastreados()).toBe(200);
    rel.avancar(10 * 60_000);
    l.varrer();
    expect(l.ipsRastreados()).toBe(0);
  });
});

describe("chave de limite por origem (A-05)", () => {
  it("ax18_flood_relay: IPv6 vira o prefixo /64, IPv4 mapeado vira IPv4, zona sai e texto estranho fica como está", () => {
    expect(chaveDeIp("2001:db8:0:0:1::1")).toBe("2001:db8:0:0::/64");
    expect(chaveDeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(chaveDeIp("2001:DB8:0:0:ffff:ffff:ffff:ffff")).toBe("2001:db8:0:0::/64");
    expect(chaveDeIp("2001:db8:0:1::1")).not.toBe(chaveDeIp("2001:db8:0:0::1")); // /64 vizinho é outra origem
    expect(chaveDeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(chaveDeIp("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(chaveDeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(chaveDeIp("desconhecido")).toBe("desconhecido");
    expect(chaveDeIp("::1")).toBe("0:0:0:0::/64");
  });
  it("ax18_flood_relay: 200 endereços do MESMO /64 dividem a cota de uma origem só", () => {
    const l = criarLimites({ agora: () => 0 }, { maxConexoesPorIp: 2 });
    let ok = 0;
    for (let i = 0; i < 200; i++) if (l.admitir(chaveDeIp(`2001:db8:0:0:${i.toString(16)}::1`))) ok++;
    expect(ok).toBe(2);
  });
});
