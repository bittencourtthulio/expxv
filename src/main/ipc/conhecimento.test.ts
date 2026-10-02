import { describe, expect, it, vi } from "vitest";
import { CANAIS_INVOKE, CANAIS_SENSIVEIS } from "../../compartilhado/ipc";
import { registrarIpcConhecimento, VALIDADORES_CHAT, VALIDADORES_CONHECIMENTO, VALIDADORES_RAG, type ManipuladoresChat, type ManipuladoresConhecimento, type ManipuladoresRag } from "./conhecimento";
import { CanalRecusadoErro, criarRegistroIpc, type IpcMainLike } from "./registro";

const WS = "ws_01J8ZXAMPLE00000000000A1";
const MIS = "mis_01J8ZXAMPLE00000000000A1";
const CONV = "conv_0abcdefghij123";

function montar() {
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const logs: string[] = [];
  const ipc: IpcMainLike = { handle: (c, l) => void handlers.set(c, l), on: () => undefined, removeHandler: () => undefined, removeAllListeners: () => undefined };
  const registro = criarRegistroIpc({ ipcMain: ipc, autorizar: () => true, log: (l) => logs.push(l), logarPayload: true });
  const fn = () => vi.fn(async () => ({}) as never);
  const todos = <T extends Record<string, unknown>>(canais: string[]): T => Object.fromEntries(canais.map((c) => [c, fn()])) as T;
  const conhecimento = todos<ManipuladoresConhecimento>(Object.keys(VALIDADORES_CONHECIMENTO));
  const chat = todos<ManipuladoresChat>(Object.keys(VALIDADORES_CHAT));
  const rag = todos<ManipuladoresRag>(Object.keys(VALIDADORES_RAG));
  registrarIpcConhecimento({ registro, conhecimento, chat, rag });
  const chamar = (canal: string, payload: unknown) => (handlers.get(canal) as (e: unknown, p: unknown) => unknown)({}, payload);
  return { registro, conhecimento, chat, rag, chamar, logs };
}

describe("contrato conhecimento:* / chat:* / rag:*", () => {
  it("todo canal do contrato tem validador e manipulador; nenhum órfão", () => {
    const m = montar();
    for (const [prefixo, validadores] of [
      ["conhecimento:", VALIDADORES_CONHECIMENTO],
      ["chat:", VALIDADORES_CHAT],
      ["rag:", VALIDADORES_RAG],
    ] as const) {
      const doContrato = CANAIS_INVOKE.filter((c) => c.startsWith(prefixo)).sort();
      expect(Object.keys(validadores).sort()).toEqual(doContrato);
      expect(m.registro.registrados().filter((c) => c.startsWith(prefixo)).sort()).toEqual(doContrato);
    }
  });

  it("os canais que carregam segredo do backend estão na lista sensível (o log nunca imprime o payload)", () => {
    expect(CANAIS_SENSIVEIS).toContain("rag:backend_configurar");
    expect(CANAIS_SENSIVEIS).toContain("rag:backend_testar");
  });
});

describe("validadores estritos", () => {
  const buscar = { workspace_id: WS, consulta: "zanzibar", modo: "hibrido", tipos: null, desde: null, limite: 8, escopo: "projeto" };

  it("repassa o valor reconstruído ao serviço e recusa campo extra, ausente e fora de faixa", async () => {
    const m = montar();
    await m.chamar("conhecimento:buscar", buscar);
    expect(m.conhecimento["conhecimento:buscar"]).toHaveBeenCalledWith(buscar);
    await expect(m.chamar("conhecimento:buscar", { ...buscar, cwd: "/tmp" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("conhecimento:buscar", { ...buscar, limite: 31 })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("conhecimento:buscar", { ...buscar, consulta: "" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("conhecimento:buscar", { ...buscar, modo: "sql" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    const { escopo: _e, ...sem } = buscar;
    await expect(m.chamar("conhecimento:buscar", sem)).rejects.toBeInstanceOf(CanalRecusadoErro);
    expect(m.conhecimento["conhecimento:buscar"]).toHaveBeenCalledTimes(1);
  });

  it("nenhum caminho absoluto, `..` nem unidade atravessa (arquivos do contexto e origem de esquecer)", async () => {
    const m = montar();
    const base = { workspace_id: WS, tarefa: "ajustar", orcamento_chars: 2000 };
    for (const ruim of ["/etc/passwd", "C:\\Users\\x", "c:/x", "../fora", "a/../b", "~/x", "a\\b", "a\u0000b"]) {
      await expect(m.chamar("conhecimento:contexto_previa", { ...base, arquivos: [ruim] })).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.chamar("conhecimento:esquecer", { workspace_id: WS, alvo: { origem: ruim } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    }
    await m.chamar("conhecimento:contexto_previa", { ...base, arquivos: ["src/a.ts"] });
    await m.chamar("conhecimento:esquecer", { workspace_id: WS, alvo: { origem: "commit:abc123" } });
    await m.chamar("conhecimento:esquecer", { workspace_id: WS, alvo: { origem: "docs/x.md" } });
    expect(m.conhecimento["conhecimento:esquecer"]).toHaveBeenCalledTimes(2);
  });

  it("esquecer exige EXATAMENTE um alvo conhecido; purgar e importar exigem confirmação/consentimento", async () => {
    const m = montar();
    await expect(m.chamar("conhecimento:esquecer", { workspace_id: WS, alvo: {} })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("conhecimento:esquecer", { workspace_id: WS, alvo: { mission_id: MIS, tipo: "doc" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("conhecimento:esquecer", { workspace_id: WS, alvo: { tudo: true } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await m.chamar("conhecimento:esquecer", { workspace_id: WS, alvo: { mission_id: MIS } });
    await expect(m.chamar("conhecimento:purgar", { workspace_id: WS, confirmacao: "" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("conhecimento:importar_historico", { workspace_id: WS, cli: "claude", consentimento: false })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await m.chamar("conhecimento:importar_historico", { workspace_id: WS, cli: "claude", consentimento: true });
    expect(m.conhecimento["conhecimento:importar_historico"]).toHaveBeenCalledTimes(1);
  });

  it("chat: texto limitado a 8000, ids locais obrigatórios, ajuste do plano só com campos conhecidos", async () => {
    const m = montar();
    const msg = { conversa_id: CONV, texto: "preciso implementar X", modo: "orquestrar", mission_alvo_id: null };
    await m.chamar("chat:enviar", msg);
    await expect(m.chamar("chat:enviar", { ...msg, texto: "x".repeat(8001) })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("chat:enviar", { ...msg, conversa_id: "../x" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("chat:enviar", { ...msg, cwd: "/" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await m.chamar("chat:plano_decidir", { plano_id: "plano_0abcdefghij12", decisao: "editar", ajuste: { prompt: "novo", cli: "codex" } });
    await expect(m.chamar("chat:plano_decidir", { plano_id: "plano_0abcdefghij12", decisao: "editar", ajuste: { permissao: "total" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("chat:plano_decidir", { plano_id: "plano_0abcdefghij12", decisao: "executar" })).rejects.toBeInstanceOf(CanalRecusadoErro);
    await expect(m.chamar("chat:perfil_gravar", { workspace_id: WS, cli: "codex", modelo: "gpt; rm -rf /", esforco: null, faixa: "medio" })).rejects.toBeInstanceOf(CanalRecusadoErro);
  });

  describe("rag: backend online", () => {
    const configurar = {
      workspace_id: WS,
      provedor: "qdrant",
      url: "https://meu-cluster.example.com:6333",
      colecao_remota: "conhecimento_proj",
      campos_secretos: { api_key: "chave-secreta-1234567890" },
      modo: "espelho",
      tipos: ["aprendizado", "decisao"],
    };

    it("aceita a configuração válida e recusa URL http pública, credencial embutida e provedor desconhecido", async () => {
      const m = montar();
      await m.chamar("rag:backend_configurar", configurar);
      expect(m.rag["rag:backend_configurar"]).toHaveBeenCalledTimes(1);
      for (const url of ["http://publico.example.com", "https://user:senha@x.example.com", "ftp://x.example.com", "https://x.example.com/ a", "javascript:alert(1)"]) {
        await expect(m.chamar("rag:backend_configurar", { ...configurar, url })).rejects.toBeInstanceOf(CanalRecusadoErro);
      }
      await expect(m.chamar("rag:backend_configurar", { ...configurar, provedor: "weaviate" })).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.chamar("rag:backend_configurar", { ...configurar, tipos: [] })).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.chamar("rag:backend_configurar", { ...configurar, campos_secretos: { "Api Key": "x" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.chamar("rag:backend_configurar", { ...configurar, campos_secretos: { api_key: "linha1\nlinha2" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    });

    it("http em loopback é aceito (servidor local); testar aceita `usar_salvo` ou o formulário completo", async () => {
      const m = montar();
      await m.chamar("rag:backend_configurar", { ...configurar, url: "http://127.0.0.1:6333" });
      await m.chamar("rag:backend_testar", { workspace_id: WS, usar_salvo: true });
      await m.chamar("rag:backend_testar", configurar);
      await expect(m.chamar("rag:backend_testar", { workspace_id: WS, usar_salvo: false })).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.chamar("rag:backend_testar", { usar_salvo: true })).rejects.toBeInstanceOf(CanalRecusadoErro);
    });

    it("o segredo NUNCA aparece no log do registro (nem na recusa)", async () => {
      const m = montar();
      await m.chamar("rag:backend_configurar", configurar);
      await Promise.resolve(m.chamar("rag:backend_configurar", { ...configurar, url: "http://publico.example.com" })).catch(() => undefined);
      await m.chamar("rag:backend_testar", configurar);
      const tudo = m.logs.join("\n");
      expect(tudo).not.toContain("chave-secreta-1234567890");
      expect(tudo).toContain("sensivel");
    });

    it("migração só inicia com consentimento completo (provedor, host, coleção, versão da política)", async () => {
      const m = montar();
      const iniciar = { workspace_id: WS, previa_id: "mig_0abcdefghij12", consentimento: { provedor: "qdrant", host: "meu-cluster.example.com", colecao: "conhecimento_proj", versao_politica: 1 } };
      await m.chamar("rag:migracao_iniciar", iniciar);
      const { consentimento: _c, ...sem } = iniciar;
      await expect(m.chamar("rag:migracao_iniciar", sem)).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.chamar("rag:migracao_iniciar", { ...iniciar, consentimento: { ...iniciar.consentimento, host: "https://x.com/y" } })).rejects.toBeInstanceOf(CanalRecusadoErro);
      await expect(m.chamar("rag:migracao_iniciar", { ...iniciar, consentimento: { ...iniciar.consentimento, extra: 1 } })).rejects.toBeInstanceOf(CanalRecusadoErro);
    });
  });
});
