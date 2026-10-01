import { describe, expect, it } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { VALIDADORES_COFRE } from "./cofre";

const WS = "ws_01HZZZZZZZZZ";
const v = <K extends keyof typeof VALIDADORES_COFRE>(canal: K, x: unknown) => VALIDADORES_COFRE[canal](x);
const base = { id: null, nome: "MINHA_CHAVE", escopo: "global", workspace_id: null, sensivel: true, valor: "valor-secreto-123" };

describe("validadores cofre:*", () => {
  it("cobrem exatamente os canais cofre: do contrato", () => {
    expect(Object.keys(VALIDADORES_COFRE).sort()).toEqual(CANAIS_INVOKE.filter((c) => c.startsWith("cofre:")).sort());
  });

  it("gravar: nome UPPER_SNAKE, escopo coerente com workspace_id, valor obrigatório, campo extra recusado", () => {
    expect(v("cofre:gravar", base).ok).toBe(true);
    expect(v("cofre:gravar", { ...base, escopo: "workspace", workspace_id: WS }).ok).toBe(true);
    for (const nome of ["minha_chave", "1CHAVE", "CHAVE-X", "CHAVE X", "", "A".repeat(65), "../X"]) expect(v("cofre:gravar", { ...base, nome }).ok, nome).toBe(false);
    expect(v("cofre:gravar", { ...base, escopo: "workspace" }).ok).toBe(false);
    expect(v("cofre:gravar", { ...base, workspace_id: WS }).ok).toBe(false);
    expect(v("cofre:gravar", { ...base, valor: "" }).ok).toBe(false);
    expect(v("cofre:gravar", { ...base, valor: "a\0b" }).ok).toBe(false);
    expect(v("cofre:gravar", { ...base, valor: "x".repeat(16 * 1024 + 1) }).ok).toBe(false);
    expect(v("cofre:gravar", { ...base, extra: 1 }).ok).toBe(false);
    expect(v("cofre:gravar", { ...base, sensivel: "sim" }).ok).toBe(false);
    expect(v("cofre:gravar", { ...base, escopo: "todos" }).ok).toBe(false);
  });

  it("apagar/senha-mestra: id com prefixo cof_, senha ≥ 8", () => {
    expect(v("cofre:apagar", { id: "cof_01HZZZZZZZZZ" }).ok).toBe(true);
    expect(v("cofre:apagar", { id: "../cofre.json" }).ok).toBe(false);
    expect(v("cofre:senha_mestra_definir", { senha: "curta" }).ok).toBe(false);
    expect(v("cofre:senha_mestra_definir", { senha: "uma senha longa" }).ok).toBe(true);
    expect(v("cofre:desbloquear", { senha: "uma senha longa", x: 1 }).ok).toBe(false);
    expect(v("cofre:disponivel", {}).ok).toBe(true);
    expect(v("cofre:listar", { x: 1 }).ok).toBe(false);
    expect(v("cofre:bloquear", {}).ok).toBe(true);
  });
});
