import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { VALIDADORES_OPENROUTER } from "./openrouter";

const C = "conta_01HZZZZZZZZZ";
const CHAVE = "sk-or-v1-abcdef0123456789";
const v = <K extends keyof typeof VALIDADORES_OPENROUTER>(canal: K, x: unknown) => VALIDADORES_OPENROUTER[canal](x);

describe("validadores provedores:openrouter_*", () => {
  it("cobrem exatamente os canais do contrato", () => {
    expect(Object.keys(VALIDADORES_OPENROUTER).sort()).toEqual(CANAIS_INVOKE.filter((c) => c.startsWith("provedores:openrouter_")).sort());
  });

  it("consentir exige true literal e versão do texto", () => {
    expect(v("provedores:openrouter_consentir", { consentimento: true, versao_texto: "v1" }).ok).toBe(true);
    expect(v("provedores:openrouter_consentir", { consentimento: false, versao_texto: "v1" }).ok).toBe(false);
    expect(v("provedores:openrouter_consentir", { consentimento: true }).ok).toBe(false);
  });

  it("chave_gravar: rótulo sem URL/caminho, chave opaca sem espaço, conta_id opcional", () => {
    expect(v("provedores:openrouter_chave_gravar", { rotulo: "or·1", chave: CHAVE }).ok).toBe(true);
    expect(v("provedores:openrouter_chave_gravar", { rotulo: "or·1", chave: CHAVE, conta_id: C }).ok).toBe(true);
    expect(v("provedores:openrouter_chave_gravar", { rotulo: "https://openrouter.ai", chave: CHAVE }).ok).toBe(false);
    expect(v("provedores:openrouter_chave_gravar", { rotulo: "/tmp/x", chave: CHAVE }).ok).toBe(false);
    expect(v("provedores:openrouter_chave_gravar", { rotulo: "x", chave: "curta" }).ok).toBe(false);
    expect(v("provedores:openrouter_chave_gravar", { rotulo: "x", chave: "tem espaco na chave" }).ok).toBe(false);
    expect(v("provedores:openrouter_chave_gravar", { rotulo: "x", chave: CHAVE, extra: 1 }).ok).toBe(false);
  });

  it("testar: conta_id OU chave, nunca os dois", () => {
    expect(v("provedores:openrouter_testar", {}).ok).toBe(true);
    expect(v("provedores:openrouter_testar", { conta_id: C }).ok).toBe(true);
    expect(v("provedores:openrouter_testar", { chave: CHAVE }).ok).toBe(true);
    expect(v("provedores:openrouter_testar", { conta_id: C, chave: CHAVE }).ok).toBe(false);
  });

  it("modelos: id vendor/modelo, faixa conhecida, limite ≤ 100, busca sem URL", () => {
    const m = { id: "anthropic/claude-sonnet-4.5", habilitado: true, faixa: "alto", tipos_permitidos: ["bug-fix"], ordem: 1 };
    expect(v("provedores:openrouter_modelo_gravar", m).ok).toBe(true);
    expect(v("provedores:openrouter_modelo_gravar", { ...m, id: "meta/llama:free", faixa: null }).ok).toBe(true);
    for (const id of ["semvendor", "/etc/passwd", "a/../b", "https://x.com/y", "a/b/c", "../x/y"]) expect(v("provedores:openrouter_modelo_gravar", { ...m, id }).ok, id).toBe(false);
    expect(v("provedores:openrouter_modelo_gravar", { ...m, faixa: "ultra" }).ok).toBe(false);
    expect(v("provedores:openrouter_modelo_gravar", { ...m, ordem: -1 }).ok).toBe(false);
    expect(v("provedores:openrouter_modelos_listar", { limite: 100, busca: "claude", so_habilitados: true, cursor: "a/b" }).ok).toBe(true);
    expect(v("provedores:openrouter_modelos_listar", { limite: 101 }).ok).toBe(false);
    expect(v("provedores:openrouter_modelos_listar", { busca: "https://x.com" }).ok).toBe(false);
    expect(v("provedores:openrouter_modelos_listar", {}).ok).toBe(true);
  });

  it("estado/revogar/atualizar não aceitam campos", () => {
    expect(v("provedores:openrouter_estado", {}).ok).toBe(true);
    expect(v("provedores:openrouter_estado", { x: 1 }).ok).toBe(false);
    expect(v("provedores:openrouter_modelos_atualizar", { conta_id: C }).ok).toBe(true);
    expect(v("provedores:openrouter_saldo_atualizar", { url: "https://x" }).ok).toBe(false);
    expect(v("provedores:openrouter_chave_apagar", { conta_id: "x" }).ok).toBe(false);
  });
});
