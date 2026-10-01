import { pathToFileURL } from "node:url";
import type { AdaptadorAtividade, AtividadeTerminal, LinhaSubagente, SinalSubagente } from "../contrato";

const ID_AGENTE = /^[A-Za-z0-9_-]{1,80}$/;

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

function cortar(valor: string, limite: number): string {
  const limpo = valor.replace(/\s+$/g, "");
  return limpo.length > limite ? `${limpo.slice(0, limite)}…` : limpo;
}

function resumoDaEntrada(entrada: unknown): string | null {
  const dados = typeof entrada === "object" && entrada !== null ? entrada as Record<string, unknown> : {};
  for (const chave of ["description", "command", "filePath", "path", "pattern", "url", "query", "prompt"]) {
    const valor = texto(dados[chave]);
    if (valor !== null) return valor.replace(/\s+/g, " ");
  }
  return null;
}

/**
 * Plugin do OpenCode carregado só na sessão do app (arquivo temporário; nada vai para a configuração da pessoa).
 * - Sessão raiz: avisa a atividade (`trabalhando` em busy/retry, `aguardando` em pedido de permissão, `pronto` em idle), só quando muda.
 * - Sessão-filha (`parentID`) é subagente: repassa início, ferramentas, textos e fim.
 * O formato enviado é o que `interpretar` e `interpretarAtividade` leem.
 */
export function codigoDoPlugin(url: string): string {
  return `const URL_AVISO = ${JSON.stringify(url)};
export const PluginAtividade = async () => {
  const filhos = new Map();
  const vistos = new Set();
  let ultima = null;
  const enviar = async (corpo) => {
    try { await fetch(URL_AVISO, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(3000) }); } catch {}
  };
  const atividade = async (estado) => {
    if (ultima === estado) return;
    ultima = estado;
    await enviar({ evento: "atividade", estado });
  };
  const raiz = (id) => typeof id === "string" && !filhos.has(id);
  const anunciar = async (info) => {
    if (!info || !info.parentID || filhos.has(info.id)) return;
    filhos.set(info.id, { ultimoTexto: null, ativo: true, tipo: info.agent ?? null, titulo: info.title ?? null });
    await enviar({ evento: "iniciado", agent_id: info.id, agent_type: info.agent ?? null, titulo: info.title ?? null });
  };
  // o OpenCode ainda emite session.updated depois do fim; só atividade nova de verdade reabre o subagente
  const reabrir = async (id) => {
    const filho = filhos.get(id);
    if (filho.ativo) return;
    filho.ativo = true;
    await enviar({ evento: "iniciado", agent_id: id, agent_type: filho.tipo, titulo: filho.titulo });
  };
  return {
    event: async ({ event }) => {
      const p = event.properties ?? {};
      if (event.type === "session.created" || event.type === "session.updated") { await anunciar(p.info); return; }
      if (event.type === "session.status") {
        if (!raiz(p.sessionID)) return;
        const tipo = p.status && p.status.type;
        if (tipo === "busy" || tipo === "retry") await atividade("trabalhando");
        else if (tipo === "idle") await atividade("pronto");
        return;
      }
      if (event.type === "permission.updated" || event.type === "permission.asked") { if (raiz(p.sessionID)) await atividade("aguardando"); return; }
      if (event.type === "permission.replied") { if (raiz(p.sessionID)) await atividade("trabalhando"); return; }
      if (event.type === "session.idle") {
        if (raiz(p.sessionID)) { await atividade("pronto"); return; }
        const filho = filhos.get(p.sessionID);
        if (!filho || !filho.ativo) return;
        filho.ativo = false;
        await enviar({ evento: "concluido", agent_id: p.sessionID, resumo: filho.ultimoTexto });
        return;
      }
      if (event.type !== "message.part.updated" || !p.part || !filhos.has(p.part.sessionID)) return;
      const parte = p.part;
      const id = parte.sessionID;
      if ((parte.type === "tool" && parte.state) || (parte.type === "text" && parte.time && parte.time.end)) await reabrir(id);
      if (parte.type === "tool" && parte.state) {
        const estado = parte.state.status;
        if (estado === "running" || estado === "completed" || estado === "error") {
          if (!vistos.has(parte.id + ":r")) { vistos.add(parte.id + ":r"); await enviar({ evento: "ferramenta", agent_id: id, tool: parte.tool, input: parte.state.input ?? null, output: null }); }
        }
        if ((estado === "completed" || estado === "error") && !vistos.has(parte.id + ":f")) {
          vistos.add(parte.id + ":f");
          await enviar({ evento: "ferramenta", agent_id: id, tool: parte.tool, input: null, output: String(estado === "error" ? "erro: " + (parte.state.error ?? "") : (parte.state.output ?? "")).slice(0, 2000) });
        }
      } else if (parte.type === "text" && parte.time && parte.time.end && !vistos.has(parte.id)) {
        vistos.add(parte.id);
        filhos.get(id).ultimoTexto = String(parte.text ?? "").slice(0, 2000);
        await enviar({ evento: "texto", agent_id: id, texto: String(parte.text ?? "").slice(0, 2000) });
      }
    },
  };
};
`;
}

const ESTADOS: Record<string, AtividadeTerminal> = { trabalhando: "trabalhando", aguardando: "aguardando", pronto: "pronto" };

export const adaptadorOpenCode: AdaptadorAtividade = {
  ferramenta_id: "opencode",

  argumentosDeObservacao: () => [],

  /** O OpenCode se configura por ambiente: `OPENCODE_CONFIG_CONTENT` é somado à configuração da pessoa (o `plugin` é concatenado). */
  ambienteDeObservacao(alvo) {
    const arquivo = alvo.gravarArquivo("opencode/plugin-atividade.mjs", codigoDoPlugin(alvo.url));
    return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [pathToFileURL(arquivo).href] }) };
  },

  interpretarAtividade(corpo): AtividadeTerminal | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    if (c["evento"] !== "atividade" || typeof c["estado"] !== "string") return null;
    return Object.hasOwn(ESTADOS, c["estado"]) ? ESTADOS[c["estado"]]! : null;
  },

  interpretar(corpo): SinalSubagente | null {
    if (typeof corpo !== "object" || corpo === null) return null;
    const c = corpo as Record<string, unknown>;
    const id = texto(c["agent_id"]);
    if (id === null || !ID_AGENTE.test(id)) return null;
    const rotulo = cortar(texto(c["agent_type"]) ?? `subagente ${id.slice(-4)}`, 60);
    switch (c["evento"]) {
      case "iniciado": {
        const titulo = texto(c["titulo"]);
        return { tipo: "iniciado", subagente_id: id, rotulo, descricao: titulo === null ? null : cortar(titulo.replace(/\s*\(@[^)]*subagent\)\s*$/, ""), 200), arquivo: null };
      }
      case "concluido": return { tipo: "concluido", subagente_id: id, arquivo: null, resumo: texto(c["resumo"]) === null ? null : cortar(c["resumo"] as string, 1200) };
      case "ferramenta": {
        const saida = texto(c["output"]);
        const linhas: LinhaSubagente[] = saida !== null
          ? [{ papel: "resultado", texto: cortar(saida.trim(), 300) }]
          : [{ papel: "ferramenta", texto: cortar([texto(c["tool"]) ?? "ferramenta", resumoDaEntrada(c["input"])].filter((x) => x !== null).join(": "), 300) }];
        return { tipo: "atividade", subagente_id: id, rotulo, linhas };
      }
      case "texto": {
        const t = texto(c["texto"]);
        return { tipo: "atividade", subagente_id: id, rotulo, linhas: t === null ? [] : [{ papel: "texto", texto: cortar(t, 600) }] };
      }
      default: return null;
    }
  },

  analisarLinha: () => [],
};
