// T-25.03: contrato do decisor local laya (§29). Tipos puros e constantes: nada de runtime aqui.
// Falha se os limites do plano (D-700, P-709), o padrão DESLIGADO (D-695/D-708) ou a lista fechada de canais divergirem.
import { describe, expect, it } from "vitest";
import {
  CANAIS_EVENTO_LAYA,
  CANAIS_INVOKE_LAYA,
  CONFIG_LAYA_PADRAO,
  ESTADOS_LAYA,
  LIMITES_LAYA,
  TIPOS_PERGUNTA,
  VERSAO_CONSENTIMENTO_MODELO_LAYA,
} from "./laya";
import { CANAIS_EVENTO, CANAIS_INVOKE, CANAIS_SENSIVEIS, type NomeEvento, type NomeInvoke } from "./ipc";

describe("contrato do decisor local laya (T-25.03)", () => {
  it("limites do plano: timeout ≤ 500 ms, taxa padrão 60/min, teto de entrada 8 KB, progresso coalescido 250 ms (D-700/P-709)", () => {
    expect(LIMITES_LAYA.timeout_ms).toBeLessThanOrEqual(500);
    expect(LIMITES_LAYA.taxa_padrao_minuto).toBe(60);
    expect(LIMITES_LAYA.teto_entrada_bytes).toBe(8192);
    expect(LIMITES_LAYA.progresso_min_ms).toBe(250);
    expect(LIMITES_LAYA.retentativas_crash).toBe(1); // D-707: uma retentativa, depois desliga
  });

  it("padrão DESLIGADO e sem consumidor ativo (D-695/D-701/D-708)", () => {
    expect(CONFIG_LAYA_PADRAO.habilitado).toBe(false);
    expect(CONFIG_LAYA_PADRAO.usar_no_maestro).toBe(false);
    expect(CONFIG_LAYA_PADRAO.ordenar_roteamento).toBe(false);
    expect(CONFIG_LAYA_PADRAO.sinais_terminal).toBe(false);
    expect(CONFIG_LAYA_PADRAO.classificar_erros).toBe(false);
    expect(CONFIG_LAYA_PADRAO.urgencia_alertas).toBe(false);
    expect(CONFIG_LAYA_PADRAO.modelo_id).toBeNull();
    expect(CONFIG_LAYA_PADRAO.confianca_minima).toBeGreaterThan(0);
    expect(CONFIG_LAYA_PADRAO.confianca_minima).toBeLessThanOrEqual(1);
  });

  it("tipos de pergunta e estados fechados", () => {
    expect(TIPOS_PERGUNTA).toEqual(["choice", "score", "noul"]);
    expect(ESTADOS_LAYA).toContain("ativo");
    expect(ESTADOS_LAYA).toContain("falhou");
  });

  it("lista fechada de canais invoke e eventos; nenhum canal laya é sensível (payloads são métricas, D-699)", () => {
    expect(CANAIS_INVOKE_LAYA).toEqual([
      "laya:estado",
      "laya:consentir",
      "laya:modelos_listar",
      "laya:modelo_baixar",
      "laya:modelo_pausar",
      "laya:modelo_retomar",
      "laya:modelo_cancelar",
      "laya:modelo_apagar",
      "laya:modelo_ativar",
      "laya:testar",
      "laya:config_gravar",
    ]);
    expect(CANAIS_EVENTO_LAYA).toEqual(["laya:modelo_progresso", "laya:estado_mudou"]);
    for (const c of CANAIS_INVOKE_LAYA) {
      expect(CANAIS_INVOKE, `invoke ${c} fora do contrato`).toContain(c);
      expect(CANAIS_SENSIVEIS, `invoke ${c} não deveria ser sensível`).not.toContain(c);
    }
    for (const c of CANAIS_EVENTO_LAYA) expect(CANAIS_EVENTO, `evento ${c} fora do contrato`).toContain(c);
    const invoke = CANAIS_INVOKE.filter((c) => c.startsWith("laya:")) as NomeInvoke[];
    const evento = CANAIS_EVENTO.filter((c) => c.startsWith("laya:")) as NomeEvento[];
    expect([...invoke].sort()).toEqual([...CANAIS_INVOKE_LAYA].sort());
    expect([...evento].sort()).toEqual([...CANAIS_EVENTO_LAYA].sort());
  });

  it("versão do consentimento tem formato de data (invalida aceites ao mudar)", () => {
    expect(VERSAO_CONSENTIMENTO_MODELO_LAYA).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
