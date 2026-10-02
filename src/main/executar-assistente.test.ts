// Serviço do assistente de execução (D-582…) com o serviço de execução REAL (arquivo de configurações da pasta do produto, de verdade) e CLI/LLM falsos: prévia, consentimento
// amarrado ao hash, um assistente por workspace, cancelar, eventos sem conteúdo, salvar só o que foi marcado/revisado e a IA nunca concedendo confiança.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventoAssistente } from "../compartilhado/executar-assistente";
import type { PortaLlmAssistente } from "../nucleo/executar/assistente/pipeline";
import { ARQUIVO_CONFIG_EXECUTAR } from "../nucleo/executar/modelo";
import { criarServicoExecutar } from "./executar";
import { criarServicoAssistente, type DependenciasAssistente, type ServicoAssistente } from "./executar-assistente";
import type { CliAssistenteMain } from "./executar-assistente-cli";

const FIXTURE = resolve(__dirname, "../../tests/fixtures/executar/monorepo-expxmedia");
const WS = "ws_ABCDEFGHIJKL";
const pastas: string[] = [];
afterEach(() => pastas.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })));

const proposta = () => JSON.stringify({
  configuracoes: [
    { nome: "desktop · Rodar (dev)", tipo: "rodar", executavel: "npm", argumentos: ["run", "dev"], cwd: "desktop", justificativa: "Script dev.", confianca: 0.9, padrao: true },
    { nome: "desktop · Testes", tipo: "teste", executavel: "npm", argumentos: ["run", "test"], cwd: "desktop", justificativa: "Script test.", confianca: 0.8 },
    { nome: "motor · pytest", tipo: "teste", executavel: "python3", argumentos: ["-m", "pytest"], cwd: "motor", justificativa: "pytest.", confianca: 0.6 },
  ],
  avisos: ["Rode npm install em desktop/."],
});

function llmDe(resposta: string | (() => AsyncIterable<string>), disponivel: { ok: boolean; motivo?: string } = { ok: true }): { llm: PortaLlmAssistente; chamadas: Array<{ sistema: string; prompt: string; sinal: AbortSignal }> } {
  const chamadas: Array<{ sistema: string; prompt: string; sinal: AbortSignal }> = [];
  return {
    chamadas,
    llm: {
      disponivel: async () => disponivel,
      executar(p) { chamadas.push(p); return typeof resposta === "function" ? resposta() : (async function* () { yield resposta; })(); },
    },
  };
}

function criar(opcoes: { resposta?: string | (() => AsyncIterable<string>); disponivel?: { ok: boolean; motivo?: string }; extra?: Partial<DependenciasAssistente>; plantar?: boolean } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "assistente-")));
  pastas.push(base);
  const raiz = join(base, "proj");
  cpSync(FIXTURE, raiz, { recursive: true });
  if (opcoes.plantar === true) {
    writeFileSync(join(raiz, `.${"env"}`), "SEGREDO_PLANTADO_ASSISTENTE=1");
    writeFileSync(join(raiz, "chave.pem"), "SEGREDO_PEM_PLANTADO");
  }
  const dados = join(base, "dados");
  mkdirSync(dados);
  const eventos: EventoAssistente[] = [];
  const dominio: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
  const { llm, chamadas } = llmDe(opcoes.resposta ?? proposta(), opcoes.disponivel);
  const escolhas: Array<{ cli: string; modelo: string | null }> = [];
  const cli: CliAssistenteMain = {
    clis: async () => [{ cli: "claude", disponivel: true, motivo: null }, { cli: "codex", disponivel: true, motivo: null }, { cli: "opencode", disponivel: false, motivo: "não está instalada nesta máquina" }],
    padrao: async () => ({ cli: "claude", modelo: "sonnet" }),
    criarLlm: (e) => { escolhas.push(e); return llm; },
  };
  const execucao = criarServicoExecutar({
    pastaDados: dados, raizDe: (id) => (id === WS ? raiz : null), sessoes: async () => { throw new Error("não deve abrir sessão"); }, registrarExecutavel: () => null, emitir: () => undefined, programaNoPath: () => true,
  });
  const servico: ServicoAssistente = criarServicoAssistente({
    raizDe: (id) => (id === WS ? raiz : null), executar: async () => execucao, cli, emitir: (e) => eventos.push(e), registrarEvento: (tipo, payload) => dominio.push({ tipo, payload }),
    ...(opcoes.extra ?? {}),
  });
  const terminal = async (): Promise<EventoAssistente> => {
    const fim = Date.now() + 8_000;
    for (;;) {
      const e = eventos.find((x) => x.tipo === "concluido" || x.tipo === "erro" || x.tipo === "cancelado");
      if (e !== undefined) return e;
      if (Date.now() > fim) throw new Error("sem evento terminal");
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return { raiz, servico, execucao, eventos, dominio, chamadas, escolhas, terminal, dados };
}

async function proporEsperar(c: ReturnType<typeof criar>, cli: "claude" | "codex" = "claude") {
  const previa = await c.servico.previa(WS, cli);
  const { assistente_id } = await c.servico.propor(WS, { cli, dossie_hash: previa.dossie_hash, consentimento: true });
  const fim = await c.terminal();
  return { previa, assistente_id, fim };
}

describe("prévia (o que será enviado, antes do consentimento)", () => {
  it("lista arquivos com trecho, tamanho, tokens estimados, CLIs, CLI padrão do harness e pistas; nada de segredo", async () => {
    const c = criar({ plantar: true });
    const p = await c.servico.previa(WS);
    expect(p.arquivos).toEqual(expect.arrayContaining(["desktop/package.json", "central/package.json", "motor/pyproject.toml", "README.md"]));
    expect(p.itens_arvore).toBeGreaterThan(5);
    expect(p.bytes).toBeGreaterThan(500);
    expect(p.tokens_estimados).toBeGreaterThan(900);
    expect(p.omitidos_sensiveis).toBeGreaterThanOrEqual(2);
    expect(p.clis.map((x) => [x.cli, x.disponivel])).toEqual([["claude", true], ["codex", true], ["opencode", false]]);
    expect(p.cli).toBe("claude");
    expect(p.modelo).toBe("sonnet");
    expect(p.pistas).toBeGreaterThan(5);
    expect(p.dossie_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(p)).not.toMatch(/SEGREDO|\.env|\.pem/);
  });
  it("trocar a CLI zera o modelo do harness (ele vale para a CLI que ele escolheu)", async () => {
    const p = await criar().servico.previa(WS, "codex");
    expect(p).toMatchObject({ cli: "codex", modelo: null });
  });
  it("workspace desconhecido é recusado com texto simples", async () => {
    await expect(criar().servico.previa("ws_ZZZZZZZZZZZZ")).rejects.toThrow("Workspace desconhecido");
  });
  it("não envia nada à CLI (só monta o dossiê)", async () => {
    const c = criar();
    await c.servico.previa(WS);
    expect(c.chamadas).toEqual([]);
    expect(c.escolhas).toEqual([]);
  });
});

describe("proposta", () => {
  it("fluxo completo: progresso → concluído com itens, avisos e comparação; o dossiê vai redigido e sem segredo; nada é salvo", async () => {
    const c = criar({ plantar: true });
    const { fim, assistente_id } = await proporEsperar(c);
    expect(fim.tipo).toBe("concluido");
    if (fim.tipo !== "concluido") return;
    expect(fim.resultado).toMatchObject({ assistente_id, workspace_id: WS, fonte: "ia", cli: "claude", tentativas: 1, aviso_fonte: null });
    expect(fim.resultado.itens.map((i) => i.config.nome)).toEqual(["desktop · Rodar (dev)", "desktop · Testes", "motor · pytest"]);
    expect(fim.resultado.itens[0]).toMatchObject({ padrao: true, novo: false, comando: "npm run dev" });
    expect(fim.resultado.itens.every((i) => !("origem" in i.config))).toBe(true);
    expect(fim.resultado.deteccao_total).toBeGreaterThan(5);
    expect(c.eventos[0]).toMatchObject({ tipo: "progresso", fase: "preparando" });
    expect(c.eventos.some((e) => e.tipo === "progresso" && e.fase === "consultando")).toBe(true);
    // o que foi à CLI
    expect(c.escolhas).toEqual([{ cli: "claude", modelo: "sonnet" }]);
    const enviado = `${c.chamadas[0]!.sistema}\n${c.chamadas[0]!.prompt}`;
    expect(enviado).not.toMatch(/SEGREDO/);
    expect(enviado).toContain("desktop/package.json");
    // nada foi gravado no projeto
    expect(existsSync(join(c.raiz, ARQUIVO_CONFIG_EXECUTAR))).toBe(false);
  });

  it("consentimento: sem ele nada é enviado; hash errado (projeto mudou) recusa; CLI desconhecida recusa", async () => {
    const c = criar();
    const p = await c.servico.previa(WS);
    await expect(c.servico.propor(WS, { cli: "claude", dossie_hash: p.dossie_hash, consentimento: false })).rejects.toThrow("consentimento");
    await expect(c.servico.propor(WS, { cli: "claude", dossie_hash: "f".repeat(40), consentimento: true })).rejects.toThrow("mudou");
    await expect(c.servico.propor(WS, { cli: "gemini" as never, dossie_hash: p.dossie_hash, consentimento: true })).rejects.toThrow("CLI desconhecida");
    expect(c.chamadas).toEqual([]);
    // o projeto muda depois da prévia → o consentimento anterior não vale
    writeFileSync(join(c.raiz, "desktop", "package.json"), JSON.stringify({ scripts: { dev: "outra-coisa" } }));
    await expect(c.servico.propor(WS, { cli: "claude", dossie_hash: p.dossie_hash, consentimento: true })).rejects.toThrow("mudou");
    expect(c.chamadas).toEqual([]);
  });

  it("um assistente por workspace por vez; cancelar aborta a CLI e emite 'cancelado'; depois pode de novo", async () => {
    let abortou = false;
    const c = criar({
      resposta: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<string>>(() => undefined),
          return: async () => { abortou = true; return { done: true, value: undefined }; },
        }),
      }),
    });
    const p = await c.servico.previa(WS);
    await c.servico.propor(WS, { cli: "claude", dossie_hash: p.dossie_hash, consentimento: true });
    await expect(c.servico.propor(WS, { cli: "claude", dossie_hash: p.dossie_hash, consentimento: true })).rejects.toThrow("Já há um assistente");
    expect(await c.servico.cancelar(WS)).toBe(true);
    expect((await c.terminal()).tipo).toBe("cancelado");
    expect(c.chamadas[0]!.sinal.aborted).toBe(true);
    expect(abortou).toBe(true);
    expect(await c.servico.cancelar(WS)).toBe(false);
    await expect(c.servico.propor(WS, { cli: "claude", dossie_hash: p.dossie_hash, consentimento: true })).resolves.toBeDefined();
    await c.servico.cancelar(WS);
  });

  it("encerrar() cancela o que estiver em curso", async () => {
    const c = criar({ resposta: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<string>>(() => undefined) }) }) });
    const p = await c.servico.previa(WS);
    await c.servico.propor(WS, { cli: "claude", dossie_hash: p.dossie_hash, consentimento: true });
    c.servico.encerrar();
    expect((await c.terminal()).tipo).toBe("cancelado");
  });

  it("erros acionáveis: CLI ausente / sem login / limite viram evento 'erro' com mensagem simples e sugestão", async () => {
    const ausente = criar({ disponivel: { ok: false, motivo: "a CLI claude não está instalada" } });
    const r1 = await proporEsperar(ausente);
    expect(r1.fim).toMatchObject({ tipo: "erro", erro: { codigo: "cli_ausente", sugestao: expect.stringContaining("Instale") } });
    const login = criar({ resposta: "Not logged in · Please run /login" });
    expect((await proporEsperar(login)).fim).toMatchObject({ tipo: "erro", erro: { codigo: "sem_login" } });
    const limite = criar({ resposta: "Usage limit reached" });
    expect((await proporEsperar(limite)).fim).toMatchObject({ tipo: "erro", erro: { codigo: "limite" } });
  });

  it("erro interno nunca vaza detalhe (texto genérico) e libera o workspace para tentar de novo", async () => {
    const avisos: string[] = [];
    const c = criar({ extra: { aviso: (m) => avisos.push(m), cli: { clis: async () => [], padrao: async () => ({ cli: "claude", modelo: null }), criarLlm: () => { throw new Error("/Users/fulano/segredo/caminho quebrou"); } } } });
    const r = await proporEsperar(c);
    expect(r.fim).toMatchObject({ tipo: "erro", erro: { codigo: "indisponivel" } });
    expect(JSON.stringify(r.fim)).not.toMatch(/fulano|segredo|caminho/);
    expect(avisos.join(" ")).not.toMatch(/fulano|segredo/);
    c.eventos.length = 0;
    const p = await c.servico.previa(WS);
    await expect(c.servico.propor(WS, { cli: "claude", dossie_hash: p.dossie_hash, consentimento: true })).resolves.toBeDefined();
  });

  it("falha da CLI no meio (exceção do executor) vira fallback determinístico, sem vazar o texto do erro", async () => {
    const c = criar({ resposta: () => { throw new Error("/Users/fulano/segredo/caminho quebrou"); } });
    const { fim } = await proporEsperar(c);
    expect(fim.tipo).toBe("concluido");
    expect(JSON.stringify(fim)).not.toMatch(/fulano|caminho quebrou/);
    if (fim.tipo === "concluido") expect(fim.resultado.fonte).toBe("deterministico");
  });

  it("IA inútil: fallback determinístico com aviso honesto no resultado", async () => {
    const c = criar({ resposta: "não sei" });
    const { fim } = await proporEsperar(c);
    expect(fim.tipo).toBe("concluido");
    if (fim.tipo === "concluido") {
      expect(fim.resultado.fonte).toBe("deterministico");
      expect(fim.resultado.aviso_fonte).toMatch(/detecção automática/);
      expect(fim.resultado.itens.find((i) => i.padrao)?.config.cwd).toBe("desktop");
    }
  });

  it("evento_dominio só com contagens: nenhum nome, comando, caminho ou trecho do projeto", async () => {
    const c = criar({ plantar: true });
    await proporEsperar(c);
    expect(c.dominio.map((d) => d.tipo)).toEqual(["run.assistant.requested", "run.assistant.proposed"]);
    const texto = JSON.stringify(c.dominio);
    expect(texto).not.toMatch(/npm|desktop|motor|pytest|SEGREDO|README|package\.json/);
    expect(c.dominio[1]!.payload).toMatchObject({ workspace_id: WS, cli: "claude", fonte: "ia", itens: 3, descartados: 0, tentativas: 1 });
  });
});

describe("salvar (só depois da revisão; a IA nunca concede confiança)", () => {
  const configDe = (nome: string, extra: Record<string, unknown> = {}) => ({
    id: nome, nome, tipo: "rodar" as const, executavel: "npm", argumentos: ["run", "dev"], cwd: "desktop", ambiente: {}, pre_passos: [], porta: null, url: null, abrir_navegador: false, reiniciar_ao_salvar: false, grupo: null, shell: null, ...extra,
  });

  it("grava as marcadas (já editadas) no arquivo de configurações, define a padrão, e a primeira execução AINDA pede confirmação", async () => {
    const c = criar();
    const { assistente_id, fim } = await proporEsperar(c);
    if (fim.tipo !== "concluido") throw new Error("esperava concluído");
    const [a, b] = fim.resultado.itens;
    const editada = { ...b!.config, nome: "desktop · Testes (editado)", argumentos: ["run", "test", "--", "--run"] };
    const lista = await c.servico.salvar(WS, { assistente_id, configs: [a!.config, editada], padrao_id: a!.config.id });
    const arq = JSON.parse(readFileSync(join(c.raiz, ARQUIVO_CONFIG_EXECUTAR), "utf8")) as { padrao: string; configuracoes: Array<{ nome: string; argumentos: string[]; cwd: string }> };
    expect(arq.configuracoes.map((x) => x.nome)).toEqual(["desktop · Rodar (dev)", "desktop · Testes (editado)"]);
    expect(arq.configuracoes[1]!.argumentos).toEqual(["run", "test", "--", "--run"]);
    expect(arq.configuracoes.every((x) => x.cwd === "desktop")).toBe(true);
    expect(arq.padrao).toBe(a!.config.id);
    expect(lista.padrao_id).toBe(a!.config.id);
    // confiança: nunca concedida
    expect(lista.configuracoes.filter((x) => x.origem === "usuario").every((x) => x.confiavel === false)).toBe(true);
    const r = await c.execucao.iniciar(WS, { config_id: a!.config.id });
    expect(r.resultado).toBe("confirmar");
    expect(c.dominio.at(-1)).toMatchObject({ tipo: "run.assistant.saved", payload: { quantidade: 2, com_padrao: true } });
    expect(JSON.stringify(c.dominio.at(-1))).not.toMatch(/npm|desktop/);
  });

  it("só vale para a ÚLTIMA proposta concluída e uma vez só", async () => {
    const c = criar();
    await expect(c.servico.salvar(WS, { assistente_id: "ass_aaaaaaaaaaaaaaaaaaaa", configs: [configDe("x")], padrao_id: null })).rejects.toThrow("expirou");
    const { assistente_id } = await proporEsperar(c);
    await c.servico.salvar(WS, { assistente_id, configs: [configDe("dev-a")], padrao_id: null });
    await expect(c.servico.salvar(WS, { assistente_id, configs: [configDe("dev-b")], padrao_id: null })).rejects.toThrow("já foi salva");
  });

  it("recusa shell, pasta inexistente, lista vazia, padrão fora da seleção e configuração inválida; nada é gravado", async () => {
    const c = criar();
    const { assistente_id } = await proporEsperar(c);
    const salvar = (configs: unknown[], padrao: string | null = null) => c.servico.salvar(WS, { assistente_id, configs: configs as never, padrao_id: padrao });
    await expect(salvar([configDe("a", { shell: "npm run dev && x", executavel: "", argumentos: [] })])).rejects.toThrow("não salva comandos em shell");
    await expect(salvar([configDe("a", { cwd: "nao-existe" })])).rejects.toThrow("não existe");
    await expect(salvar([])).rejects.toThrow("ao menos uma");
    await expect(salvar([configDe("a")], "outra")).rejects.toThrow("padrão");
    await expect(salvar([configDe("a", { executavel: "sh -c x" })])).rejects.toThrow();
    await expect(salvar([configDe("a", { ambiente: { API_KEY: "valor-secreto" } })])).rejects.toThrow("segredo");
    await expect(salvar(Array.from({ length: 13 }, (_, i) => configDe(`c${i}`)))).rejects.toThrow("No máximo");
    expect(existsSync(join(c.raiz, ARQUIVO_CONFIG_EXECUTAR))).toBe(false);
  });

  it("id que colide com configuração existente ou detectada ganha sufixo (nunca sobrescreve em silêncio); repetidos na seleção são recusados", async () => {
    const c = criar();
    const { assistente_id } = await proporEsperar(c);
    await expect(c.servico.salvar(WS, { assistente_id, configs: [configDe("desktop-dev"), configDe("desktop-dev")], padrao_id: null })).rejects.toThrow("repetidas");
    const lista = await c.servico.salvar(WS, { assistente_id, configs: [configDe("desktop-dev"), configDe("dev-b")], padrao_id: "desktop-dev" });
    const ids = lista.configuracoes.filter((x) => x.origem === "usuario").map((x) => x.id).sort();
    expect(ids).toEqual(["desktop-dev-2", "dev-b"].sort());
    expect(lista.padrao_id).toBe("desktop-dev-2");
  });
});
