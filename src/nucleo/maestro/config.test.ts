import { describe, expect, it } from "vitest";
import { CONFIG_MAESTRO_PADRAO, normalizarConfigMaestro } from "./config";
import { BRANCHES_PROTEGIDAS_PADRAO } from "./rigidez/travas";

describe("configuração do Maestro", () => {
  it("padrões seguros: o plano sempre aparece, hook encaminha, hooks.json só por ação do usuário", () => {
    expect(CONFIG_MAESTRO_PADRAO).toMatchObject({ confirmar_plano: true, hook_modo: "encaminhar", hook_confianca_min: 0.75, producao: false, escrever_hooks: true, hooks_aplicar_ja: false, max_terminais: 4, fechar_concluidos: true, timeout_sem_progresso_min: 30, proposta_expira_min: 30, permissao: "seguro" });
    expect(CONFIG_MAESTRO_PADRAO.branches_protegidas).toEqual(BRANCHES_PROTEGIDAS_PADRAO);
  });
  it("lixo/ausente volta ao padrão; nunca lança", () => {
    for (const x of [null, undefined, 3, "x", [], { max_terminais: "muitos", hook_modo: "ruidoso", permissao: "root", branches_protegidas: [1] }]) expect(normalizarConfigMaestro(x)).toEqual(CONFIG_MAESTRO_PADRAO);
  });
  it("limita números (terminais 1–8, timeout 5–240 min, confiança 0,5–1)", () => {
    expect(normalizarConfigMaestro({ max_terminais: 99, timeout_sem_progresso_min: 1, hook_confianca_min: 0.1 })).toMatchObject({ max_terminais: 8, timeout_sem_progresso_min: 5, hook_confianca_min: 0.5 });
    expect(normalizarConfigMaestro({ max_terminais: 0 }).max_terminais).toBe(1);
  });
  it("desligar `confirmar_plano` exige `confirmado: true`", () => {
    expect(normalizarConfigMaestro({ confirmar_plano: false }).confirmar_plano).toBe(true);
    expect(normalizarConfigMaestro({ confirmar_plano: false }, { confirmado: true }).confirmar_plano).toBe(false);
    expect(normalizarConfigMaestro({ confirmar_plano: true }).confirmar_plano).toBe(true);
  });
  it("aceita as três permissões e os modos de hook", () => {
    for (const permissao of ["seguro", "equilibrado", "automatico"] as const) expect(normalizarConfigMaestro({ permissao }).permissao).toBe(permissao);
    for (const hook_modo of ["desligado", "notificar", "encaminhar"] as const) expect(normalizarConfigMaestro({ hook_modo }).hook_modo).toBe(hook_modo);
  });
});
