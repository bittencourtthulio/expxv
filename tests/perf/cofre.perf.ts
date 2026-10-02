// Orçamentos do cofre e do decisor (docs/ade/fase-09-harness-limites.md): P-105 e P-112. Node puro, sem Electron, sem rede real
// (cifrador FALSO, pasta temporária, servidor JEV falso em loopback).
//  - P-105: abrir e decifrar 1 entrada ≤ 20 ms (p95 de 50, instância nova a cada vez: lê o arquivo, parseia, decifra);
//           listar 200 entradas (só metadados, instância nova) ≤ 5 ms (mediana de 30); desbloqueio com scrypt padrão ≤ 500 ms (referência).
//  - P-112: classificarIntencao por regras p95 ≤ 5 ms (2 000 amostras); com decisor (servidor que não responde, timeout 2 000 ms) ≤ 2 100 ms;
//           resumo para o decisor com 100 KB ≤ 5 ms (mediana).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ConfigDecisor } from "../../src/compartilhado/harness";
import { criarCofre, criarMotorSafeStorage, criarMotorSenhaMestra, SCRYPT_PADRAO, type PortaSafeStorage } from "../../src/nucleo/cofre";
import { criarDecisor } from "../../src/nucleo/harness/decisor/cliente";
import { resumirParaDecisor } from "../../src/nucleo/harness/decisor/resumo";
import { classificarIntencao, classificarPorRegras } from "../../src/nucleo/harness/intencao";
import { criarClienteRede, criarRegistroConsentimento } from "../../src/nucleo/rede";
import { subirJevFalso } from "../fixtures/rede/servidor-jev";
import { gravarMedicoes, percentil, registrar } from "./registro";

const pastas: string[] = [];
afterAll(() => {
  gravarMedicoes();
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});
const nova = (): string => {
  const p = mkdtempSync(join(tmpdir(), "cofre-perf-"));
  pastas.push(p);
  return p;
};
const mediana = (xs: number[]): number => percentil(xs, 50);

const portaFalsa: PortaSafeStorage = {
  disponivel: () => true,
  backend: () => null,
  cifrar: (t) => Buffer.from(Buffer.from(t).reverse().toString("base64")),
  decifrar: (b) => Buffer.from(Buffer.from(b).toString(), "base64").reverse().toString(),
};
const pedido = (nome: string, valor: string) => ({ id: null, nome, escopo: "global" as const, workspace_id: null, sensivel: true, valor });

describe("P-105: cofre", () => {
  it("abrir e decifrar 1 entrada ≤ 20 ms (p95); listar 200 entradas ≤ 5 ms (mediana)", async () => {
    const dir = nova();
    const arquivo = join(dir, "cofre.json");
    const semente = criarCofre({ arquivo, motor: criarMotorSafeStorage(portaFalsa) });
    for (let i = 0; i < 200; i++) await semente.guardar(pedido(`CHAVE_${i}`, `valor-secreto-numero-${i}-${"x".repeat(40)}`));
    const abrir: number[] = [];
    for (let i = 0; i < 50; i++) {
      const c = criarCofre({ arquivo, motor: criarMotorSafeStorage(portaFalsa) });
      const t0 = performance.now();
      const v = await c.obter(`CHAVE_${i}`);
      abrir.push(performance.now() - t0);
      expect(v).toContain(`numero-${i}-`);
    }
    const listar: number[] = [];
    for (let i = 0; i < 30; i++) {
      const c = criarCofre({ arquivo, motor: criarMotorSafeStorage(portaFalsa) });
      const t0 = performance.now();
      const l = await c.listar();
      listar.push(performance.now() - t0);
      expect(l).toHaveLength(200);
    }
    const a = registrar({ id: "P-105", descricao: "cofre: abrir (ler arquivo de 200 entradas) e decifrar 1 entrada, p95 de 50", valor: percentil(abrir, 95), limite: 20, unidade: "ms", pior: Math.max(...abrir) });
    const l = registrar({ id: "P-105l", descricao: "cofre: listar 200 entradas (só metadados, instância nova), mediana de 30", valor: mediana(listar), limite: 5, unidade: "ms", pior: Math.max(...listar) });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(l.ok, JSON.stringify(l)).toBe(true);
  });

  it("senha-mestra: ler entrada com o cofre desbloqueado ≤ 20 ms (p95); desbloqueio com scrypt padrão ≤ 500 ms (referência)", async () => {
    const dir = nova();
    const arquivo = join(dir, "cofre.json");
    const c = criarCofre({ arquivo, motor: criarMotorSenhaMestra({ scrypt: SCRYPT_PADRAO }) });
    await c.definirSenhaMestra("senha-mestra-de-perf-123");
    for (let i = 0; i < 50; i++) await c.guardar(pedido(`CHAVE_${i}`, `valor-secreto-${i}-${"y".repeat(40)}`));
    await c.bloquear();
    const reaberto = criarCofre({ arquivo, motor: criarMotorSenhaMestra({ scrypt: SCRYPT_PADRAO }) });
    await reaberto.estado();
    const t0 = performance.now();
    await reaberto.desbloquear("senha-mestra-de-perf-123");
    const desbloqueio = performance.now() - t0;
    const leituras: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      await reaberto.obter(`CHAVE_${i}`);
      leituras.push(performance.now() - t);
    }
    await reaberto.encerrar();
    const r = registrar({ id: "P-105m", descricao: "cofre com senha-mestra: obter 1 entrada desbloqueado, p95 de 50", valor: percentil(leituras, 95), limite: 20, unidade: "ms" });
    const u = registrar({ id: "P-105u", descricao: "cofre com senha-mestra: desbloqueio (scrypt N=32768, fora do event loop)", valor: desbloqueio, limite: 500, unidade: "ms" });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(u.ok, JSON.stringify(u)).toBe(true);
  });
});

describe("P-112: classificarIntencao e resumo", () => {
  it("por regras: p95 ≤ 5 ms em 2 000 classificações", () => {
    const textos = ["conserte esse bug no login", "quero uma feature de exportar CSV", "refatorar o módulo de pagamentos", "abrir o pull request e passar para o QA", "como funciona o roteamento?", "o que mudou na semana passada", "monta um sistema completo do zero", "seria bom ter um relatório novo, o cliente pediu"];
    classificarPorRegras("aquecimento", { workspace_id: "ws" });
    const amostras: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const t0 = performance.now();
      classificarPorRegras(`${textos[i % textos.length]} ${i}`, { workspace_id: "ws" });
      amostras.push(performance.now() - t0);
    }
    const m = registrar({ id: "P-112", descricao: "classificarIntencao por regras (PT/EN), p95 de 2 000", valor: percentil(amostras, 95), limite: 5, unidade: "ms", pior: Math.max(...amostras) });
    expect(m.ok, JSON.stringify(m)).toBe(true);
  });

  it("com decisor ligado e servidor que não responde: ≤ 2 100 ms (timeout 2 000 ms) e cai nas regras", async () => {
    const jev = await subirJevFalso("timeout");
    try {
      const consentimento = criarRegistroConsentimento();
      consentimento.permitirHost("127.0.0.1");
      const config: ConfigDecisor = {
        habilitado: true, modo: "jev_direto", formato: "probs_json", endpoint: `https://127.0.0.1:${jev.porta}/decidir`, cabecalho_chave: "x-api-key", prefixo_chave: null,
        modelo: null, conta_openrouter_id: null, chave_ref: "JEV_KEY", usar_para: { task_type: false, modelo_esforco: false, intencao: true }, confianca_minima: 0.5,
        timeout_ms: 2000, custo_por_decisao_usd: null, alerta_diario: 1000, consentimento: { host: "127.0.0.1", modo: "jev_direto", em: "x" },
      };
      const decisor = criarDecisor({
        config: () => config,
        rede: criarClienteRede({ consentimento, permitirLoopbackHttp: true }),
        obterChave: async () => "chave-de-teste-perf",
        tokenDeConsentimento: (h) => consentimento.conceder(h, { permanente: true }),
      });
      const t0 = performance.now();
      const r = await classificarIntencao("conserte esse bug", { workspace_id: "ws" }, { decisor });
      const ms = performance.now() - t0;
      expect(r).toMatchObject({ intencao: "bug", fonte: "fallback" });
      const m = registrar({ id: "P-112d", descricao: "classificarIntencao com decisor que não responde (timeout 2 000 ms)", valor: ms, limite: 2100, unidade: "ms" });
      expect(m.ok, JSON.stringify(m)).toBe(true);
    } finally {
      await jev.fechar();
    }
  }, 15_000);

  it("resumo para o decisor com 100 KB ≤ 5 ms (mediana de 15) e ≤ 500 chars", () => {
    const grande = "saída de terminal com /var/log/app/erro.log e texto qualquer ".repeat(2000);
    const amostras: number[] = [];
    let saida = "";
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      saida = resumirParaDecisor(grande);
      amostras.push(performance.now() - t0);
    }
    expect(saida.length).toBeLessThanOrEqual(500);
    const m = registrar({ id: "P-112r", descricao: "resumirParaDecisor com 100 KB de entrada, mediana de 15", valor: mediana(amostras), limite: 5, unidade: "ms" });
    expect(m.ok, JSON.stringify(m)).toBe(true);
  });
});
