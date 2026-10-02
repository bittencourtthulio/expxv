// Teste de saúde de um servidor DA LOJA (Fase 7B, T-07B.16/.18): junta o comando real (`montarComando`), o
// ambiente por allowlist (+ valores do cofre) e o handshake MCP (`testarServidor`). Só roda por ação explícita
// (clique em "Testar", fim da instalação). O servidor remoto usa HTTP streamable com `fetch` injetado e só sai
// da máquina se a pessoa clicou. Segredos só existem aqui dentro; o resultado nunca os contém.

import { dirname } from "node:path";
import { montarAmbienteServidor } from "./ambiente";
import { montarComando, type ContextoComando } from "./comando";
import type { EntradaMcp } from "./esquema";
import { redigir, testarServidor, TIMEOUT_SAUDE_PADRAO_MS, LIMIAR_LENTO_PADRAO_MS, type CodigoErroSaude, type ResultadoSaude, type FerramentaVista } from "./verificacao";
import type { ValoresDoServidor } from "./segredos";
import { variaveisFaltando } from "./segredos";

export interface OpcoesSaudeServidor {
  entrada: EntradaMcp;
  userData: string;
  workspace?: string | undefined;
  plataforma?: NodeJS.Platform;
  node?: string;
  nodeEhElectron?: boolean;
  valores: ValoresDoServidor;
  timeoutMs?: number;
  /** Só `remoto`. Padrão: `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Origem das variáveis básicas do sistema (padrão: o ambiente do processo). */
  origem?: NodeJS.ProcessEnv;
}

const vazio = (estado: ResultadoSaude["estado"], erro: CodigoErroSaude | null, faltando: string[] = []): ResultadoSaude => ({
  estado, latencia_ms: 0, n_ferramentas: 0, ferramentas: [], erro_codigo: erro, variaveis_faltando: faltando, stderr_redigido: "", servidor: null, pid: null,
});

export async function testarServidorDaLoja(o: OpcoesSaudeServidor): Promise<ResultadoSaude> {
  const e = o.entrada;
  const definidas = new Set([...Object.keys(o.valores.secretos), ...Object.keys(o.valores.publicos)]);
  const faltando = variaveisFaltando(e, definidas);
  if (faltando.length > 0) return vazio("exige_variavel", null, faltando);
  const segredosLista = Object.values(o.valores.secretos);
  const ctx: ContextoComando = {
    userData: o.userData, workspace: o.workspace, variaveis: o.valores.publicos, segredos: o.valores.secretos, modo: "execucao",
    ...(o.plataforma ? { plataforma: o.plataforma } : {}), ...(o.node ? { node: o.node } : {}), ...(o.nodeEhElectron !== undefined ? { nodeEhElectron: o.nodeEhElectron } : {}),
  };
  let comando;
  try { comando = montarComando(e, ctx); } catch { return vazio("quebrado", "executavel_ausente"); }
  if (comando.tipo === "remoto") return testarRemoto(comando.url!, o.timeoutMs ?? TIMEOUT_SAUDE_PADRAO_MS, o.fetch ?? fetch, segredosLista);

  const exe = comando.executavel!;
  const amb = montarAmbienteServidor({
    declaradas: e.variaveis, valores: { ...o.valores.publicos, ...o.valores.secretos },
    pathExtra: [dirname(o.node ?? process.execPath)], ...(o.origem ? { origem: o.origem } : {}), ...(o.plataforma ? { plataforma: o.plataforma } : {}),
  });
  const r = await testarServidor(
    { executavel: exe, args: comando.args, env: { ...amb.variaveis, ...comando.env_fixas }, ...(comando.pasta ? { cwd: comando.pasta } : {}) },
    { timeoutMs: o.timeoutMs ?? TIMEOUT_SAUDE_PADRAO_MS, variaveisObrigatorias: e.variaveis.filter((v) => v.obrigatoria).map((v) => v.nome), segredos: segredosLista },
  );
  return { ...r, stderr_redigido: redigir(r.stderr_redigido, segredosLista) };
}

// --- HTTP streamable (remoto) ------------------------------------------------------------------------------

async function lerResposta(r: Response): Promise<unknown> {
  const texto = await r.text();
  if ((r.headers.get("content-type") ?? "").includes("text/event-stream")) {
    for (const linha of texto.split("\n")) if (linha.startsWith("data:")) { try { return JSON.parse(linha.slice(5).trim()); } catch { /* próxima */ } }
    throw new Error("saida_invalida");
  }
  return JSON.parse(texto);
}

export async function testarRemoto(url: string, timeoutMs: number, f: typeof fetch, segredos: readonly string[] = []): Promise<ResultadoSaude> {
  const inicio = Date.now();
  const ctl = new AbortController();
  const relogio = setTimeout(() => ctl.abort(), timeoutMs);
  const falhou = (codigo: CodigoErroSaude): ResultadoSaude => ({ ...vazio("quebrado", codigo), latencia_ms: Date.now() - inicio });
  try {
    if (!/^https?:\/\//.test(url)) return falhou("saida_invalida");
    const cab: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    const chamar = (corpo: unknown): Promise<Response> => f(url, { method: "POST", headers: cab, body: JSON.stringify(corpo), signal: ctl.signal, redirect: "error" });
    const init = await chamar({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "loja-mcp", version: "1" } } });
    if (init.status === 401 || init.status === 403) return falhou("nao_autorizado");
    if (!init.ok) return falhou("erro_servidor");
    const sessao = init.headers.get("mcp-session-id");
    if (sessao) cab["mcp-session-id"] = sessao;
    const j = (await lerResposta(init)) as { result?: { serverInfo?: { name?: string; version?: string } } };
    if (!j || typeof j !== "object" || !j.result) return falhou("saida_invalida");
    await chamar({ jsonrpc: "2.0", method: "notifications/initialized" }).then((x) => x.text()).catch(() => undefined);
    const lista = await chamar({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    if (lista.status === 401 || lista.status === 403) return falhou("nao_autorizado");
    if (!lista.ok) return falhou("erro_servidor");
    const t = (await lerResposta(lista)) as { result?: { tools?: Array<{ name?: unknown; description?: unknown }> } };
    const ferramentas: FerramentaVista[] = (t.result?.tools ?? []).slice(0, 200)
      .filter((x) => typeof x.name === "string")
      // eslint-disable-next-line no-control-regex
      .map((x) => ({ nome: String(x.name).slice(0, 100), descricao: redigir(String(x.description ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim().slice(0, 300), segredos) }));
    const latencia = Date.now() - inicio;
    return {
      estado: ferramentas.length === 0 ? "sem_ferramentas" : latencia > LIMIAR_LENTO_PADRAO_MS ? "lento" : "ok",
      latencia_ms: latencia, n_ferramentas: ferramentas.length, ferramentas, erro_codigo: null, variaveis_faltando: [], stderr_redigido: "",
      servidor: { nome: String(j.result.serverInfo?.name ?? "remoto"), versao: String(j.result.serverInfo?.version ?? "") }, pid: null,
    };
  } catch (x) {
    return falhou(ctl.signal.aborted ? "timeout" : x instanceof SyntaxError ? "saida_invalida" : "processo_encerrou");
  } finally { clearTimeout(relogio); }
}
