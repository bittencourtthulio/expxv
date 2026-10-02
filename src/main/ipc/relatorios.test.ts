// Canais `relatorios:*`: contrato fechado (todo canal tem validador e manipulador), payload estrito (NENHUM canal aceita caminho), tradução de erro e ligação ao serviço.
import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE } from "../../compartilhado/ipc";
import { ErroRelatorio } from "../../nucleo/relatorios/erros";
import type { ServicoRelatorios } from "../relatorios";
import { VALIDADORES_RELATORIOS, paraErroIpc, registrarIpcRelatorios } from "./relatorios";
import { criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_AAAAAAAAAAAA";
const PC = "rel_0abcdefghi00000";
const EN = "env_0abcdefghi00000";
const SP = "spr_0abcdefghi00000";
const canais = CANAIS_INVOKE.filter((c) => c.startsWith("relatorios:"));

function montar(servico: Partial<Record<keyof ServicoRelatorios, unknown>> = {}) {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipcMain: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain, autorizar: () => true });
  const chamadas: { metodo: string; args: unknown[] }[] = [];
  const falso = new Proxy({}, {
    get: (_t, nome: string) => nome === "then" ? undefined : (...args: unknown[]) => {
      chamadas.push({ metodo: nome, args });
      const f = servico[nome as keyof ServicoRelatorios];
      return typeof f === "function" ? (f as (...a: unknown[]) => unknown)(...args) : { ok: true };
    },
  }) as unknown as ServicoRelatorios;
  const avisos: string[] = [];
  registrarIpcRelatorios({ registro, servico: () => falso, aviso: (m) => avisos.push(m) });
  const chamar = (canal: string, payload: unknown): unknown => (handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload);
  return { handlers, chamar, chamadas, avisos };
}

const VALIDOS: Record<string, unknown> = {
  "relatorios:config_ler": { workspace_id: WS },
  "relatorios:config_gravar": { workspace_id: WS, config: { gerar_ao_fechar: false, redacao_modo: "template", hashtags: ["novidades"], cta: null } },
  "relatorios:consentimento_llm": { workspace_id: WS, consentido: true },
  "relatorios:sprints": { workspace_id: WS },
  "relatorios:listar": { workspace_id: WS, filtros: { sprint_id: SP, estado: "pronto" } },
  "relatorios:ler": { workspace_id: WS, pacote_id: PC },
  "relatorios:gerar": { workspace_id: WS, escopo: { tipo: "sprint", sprint_id: SP }, opcoes: { redacao_modo: "template", versao_lancamento: "1.2.0" } },
  "relatorios:regenerar": { workspace_id: WS, pacote_id: PC },
  "relatorios:previa": { workspace_id: WS, pacote_id: PC, nome: "divulgacao/email.txt" },
  "relatorios:ajuste_gravar": { workspace_id: WS, sprint_id: SP, bloco_id: "u_em_resumo", texto_md: "texto" },
  "relatorios:aprovar": { workspace_id: WS, pacote_id: PC, aprovar: true },
  "relatorios:exportar": { workspace_id: WS, pacote_id: PC, nomes: ["tecnico.md"], modo: "zip" },
  "relatorios:divulgacao_estado": { workspace_id: WS },
  "relatorios:divulgacao_consentimento": { workspace_id: WS, canal: "telegram", consentido: true },
  "relatorios:divulgacao_fila": { workspace_id: WS, pacote_id: PC },
  "relatorios:divulgacao_enfileirar": { workspace_id: WS, pacote_id: PC, canal: "telegram", variante: "curta" },
  "relatorios:divulgacao_aprovar": { workspace_id: WS, envio_id: EN, aprovar: true },
  "relatorios:divulgacao_enviar": { workspace_id: WS, envio_id: EN },
  "relatorios:divulgacao_cancelar": { workspace_id: WS, envio_id: EN },
};

describe("contrato dos canais relatorios:*", () => {
  it("todo canal do contrato tem validador e manipulador (e nada além)", () => {
    const { handlers } = montar();
    expect([...Object.keys(VALIDADORES_RELATORIOS)].sort()).toEqual([...canais].sort());
    expect([...handlers.keys()].filter((c) => c.startsWith("relatorios:")).sort()).toEqual([...canais].sort());
    expect(canais.length).toBe(19);
  });
  it("cada canal aceita o payload válido e chama o serviço", async () => {
    const m = montar();
    for (const c of canais) { await m.chamar(c, VALIDOS[c]); }
    expect(m.chamadas).toHaveLength(canais.length);
  });
  it("payload extra, sem workspace ou com tipo errado é recusado antes do serviço", async () => {
    const m = montar();
    for (const c of canais) {
      await expect(Promise.resolve().then(() => m.chamar(c, { ...(VALIDOS[c] as object), extra: 1 }))).rejects.toThrow();
      await expect(Promise.resolve().then(() => m.chamar(c, {}))).rejects.toThrow();
      await expect(Promise.resolve().then(() => m.chamar(c, { ...(VALIDOS[c] as object), workspace_id: 12 }))).rejects.toThrow();
    }
    expect(m.chamadas).toHaveLength(0);
  });
  it("NENHUM canal aceita caminho: nome com .., barra, absoluto, unidade; id de pacote malformado", async () => {
    const m = montar();
    for (const nome of ["../x.md", "/etc/passwd", "a/b/c.md", "C:\\x.md", "..", "divulgacao/../x", "x\0.md", ".ssh"]) {
      await expect(Promise.resolve().then(() => m.chamar("relatorios:previa", { workspace_id: WS, pacote_id: PC, nome }))).rejects.toThrow();
      await expect(Promise.resolve().then(() => m.chamar("relatorios:exportar", { workspace_id: WS, pacote_id: PC, nomes: [nome], modo: "pasta" }))).rejects.toThrow();
    }
    for (const id of ["../../etc", "rel_x", "/abs", "rel_../x", "env_0abcdefghi00000"]) await expect(Promise.resolve().then(() => m.chamar("relatorios:ler", { workspace_id: WS, pacote_id: id }))).rejects.toThrow();
    for (const extra of [{ destino: "/tmp" }, { caminho: "/tmp" }, { pasta: "/tmp" }]) await expect(Promise.resolve().then(() => m.chamar("relatorios:exportar", { workspace_id: WS, pacote_id: PC, nomes: "todos", modo: "pasta", ...extra }))).rejects.toThrow();
    expect(m.chamadas).toHaveLength(0);
  });
  it("o consentimento (IA e canais) nunca entra pela config", async () => {
    const m = montar();
    for (const config of [{ consentimento_llm_em: "2026-01-01T00:00:00.000Z" }, { consentimento_canais: { telegram: {} } }]) await expect(Promise.resolve().then(() => m.chamar("relatorios:config_gravar", { workspace_id: WS, config }))).rejects.toThrow();
    expect(m.chamadas).toHaveLength(0);
  });
  it("bloco e canal fora do conjunto, texto de ajuste enorme, hashtag com tag e variante inválida são recusados", async () => {
    const m = montar();
    await expect(Promise.resolve().then(() => m.chamar("relatorios:ajuste_gravar", { workspace_id: WS, sprint_id: SP, bloco_id: "outro", texto_md: "x" }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => m.chamar("relatorios:ajuste_gravar", { workspace_id: WS, sprint_id: SP, bloco_id: "u_em_resumo", texto_md: "x".repeat(4001) }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => m.chamar("relatorios:divulgacao_consentimento", { workspace_id: WS, canal: "email", consentido: true }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => m.chamar("relatorios:config_gravar", { workspace_id: WS, config: { hashtags: ["<script>"] } }))).rejects.toThrow();
    await expect(Promise.resolve().then(() => m.chamar("relatorios:divulgacao_enfileirar", { workspace_id: WS, pacote_id: PC, canal: "telegram", variante: "gigante" }))).rejects.toThrow();
    expect(m.chamadas).toHaveLength(0);
  });
});

describe("tradução de erro e ligação", () => {
  it("erro de regra do núcleo vira `[codigo] texto`; qualquer outro vira texto genérico (sem stack, SQL ou caminho) e é avisado", async () => {
    const m = montar({ configLer: () => { throw new ErroRelatorio("not_found", "pacote não encontrado"); }, sprints: async () => { throw new Error("SELECT * FROM x em /Users/ana/proj"); } });
    await expect(Promise.resolve().then(() => m.chamar("relatorios:config_ler", { workspace_id: WS }))).rejects.toThrow("[not_found] pacote não encontrado");
    const e = await Promise.resolve().then(() => m.chamar("relatorios:sprints", { workspace_id: WS })).catch((x: Error) => x) as Error;
    expect(e.message).toBe("[unavailable] Falha interna nos relatórios.");
    expect(e.message).not.toMatch(/SELECT|Users/);
    expect(m.avisos[0]).toMatch(/relatórios:/);
    expect(paraErroIpc(new ErroRelatorio("consent_required", "x")).message).toBe("[consent_required] x");
  });
  it("repassa os argumentos certos ao serviço (workspace primeiro; o ator humano está implícito no canal)", async () => {
    const m = montar();
    await m.chamar("relatorios:aprovar", VALIDOS["relatorios:aprovar"]);
    await m.chamar("relatorios:exportar", VALIDOS["relatorios:exportar"]);
    await m.chamar("relatorios:divulgacao_enviar", VALIDOS["relatorios:divulgacao_enviar"]);
    expect(m.chamadas.map((c) => [c.metodo, ...c.args])).toEqual([["aprovar", WS, PC, true], ["exportar", WS, PC, ["tecnico.md"], "zip"], ["divulgacaoEnviar", WS, EN]]);
  });
  it("o serviço é lido de forma preguiçosa (nada no registro)", () => {
    const fn = vi.fn();
    const ipcMain: IpcMainLike = { handle: () => undefined, on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
    registrarIpcRelatorios({ registro: criarRegistroIpc({ ipcMain, autorizar: () => true }), servico: fn as never });
    expect(fn).not.toHaveBeenCalled();
  });
});
