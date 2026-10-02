// Conector real do gateway: cliente MCP do SDK oficial sobre stdio (o SDK faz o spawn com shell:false, ambiente = só o que recebemos + o mínimo do SO) ou
// HTTP de servidor REMOTO da Loja (já consentido na instalação). Este arquivo NÃO escuta porta, NÃO usa fetch/http/net/spawn por conta própria (provado por
// tests/scripts/gateway-fronteira.test.ts). O comando exato (com segredos do cofre) é resolvido pelo MAIN e nunca chega ao Pane.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ClienteServidor, Conectar, ConteudoTexto, FerramentaRemota, ResultadoFerramenta } from "./tipos";

export type LancamentoServidor =
  | { tipo: "stdio"; executavel: string; args: string[]; env: Record<string, string>; cwd: string | null }
  | { tipo: "remoto"; url: string };

export interface OpcoesConector {
  /** resolve o comando exato do servidor para ESTE Pane (segredos já aplicados); lança se não puder */
  resolver(servidorId: string, contexto: { raiz: string | null }): Promise<LancamentoServidor>;
  conexaoTimeoutMs?: number;
  /** teto de ferramentas lidas de um servidor */
  maxFerramentas?: number;
}

const MAX_PAGINAS = 10;

function converter(bruto: unknown): ResultadoFerramenta {
  const r = (typeof bruto === "object" && bruto !== null ? bruto : {}) as { content?: unknown; isError?: unknown };
  const partes: ConteudoTexto[] = [];
  for (const item of Array.isArray(r.content) ? r.content : []) {
    const i = (typeof item === "object" && item !== null ? item : {}) as { type?: unknown; text?: unknown };
    if (i.type === "text" && typeof i.text === "string") partes.push({ type: "text", text: i.text });
    else partes.push({ type: "text", text: `[conteúdo não textual omitido pelo gateway: ${typeof i.type === "string" ? i.type.replace(/[^a-z_]/g, "").slice(0, 20) : "desconhecido"}]` });
  }
  return { content: partes, isError: r.isError === true };
}

export function criarConector(o: OpcoesConector): Conectar {
  const maxFerramentas = o.maxFerramentas ?? 500;
  return async (servidorId, contexto) => {
    const lanc = await o.resolver(servidorId, contexto);
    const cliente = new Client({ name: "gateway", version: "1.0.0" }, { capabilities: {} });
    if (lanc.tipo === "stdio") {
      const transporte = new StdioClientTransport({ command: lanc.executavel, args: lanc.args, env: lanc.env, ...(lanc.cwd === null ? {} : { cwd: lanc.cwd }), stderr: "ignore" });
      await cliente.connect(transporte, { timeout: o.conexaoTimeoutMs ?? 15_000 });
    } else {
      const u = new URL(lanc.url);
      const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
      if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw new Error("servidor remoto precisa de https");
      if (u.username !== "" || u.password !== "") throw new Error("URL com credencial recusada");
      await cliente.connect(new StreamableHTTPClientTransport(u) as unknown as Transport, { timeout: o.conexaoTimeoutMs ?? 15_000 });
    }
    const aberto: ClienteServidor = {
      async listarFerramentas() {
        const saida: FerramentaRemota[] = [];
        let cursor: string | undefined;
        for (let pagina = 0; pagina < MAX_PAGINAS && saida.length < maxFerramentas; pagina++) {
          const r = await cliente.listTools(cursor === undefined ? {} : { cursor }, { timeout: 15_000 });
          for (const t of r.tools) {
            saida.push({
              nome: t.name,
              descricao: typeof t.description === "string" ? t.description : null,
              esquema: (t.inputSchema ?? {}) as Record<string, unknown>,
              somente_leitura: typeof t.annotations?.readOnlyHint === "boolean" ? t.annotations.readOnlyHint : null,
              destrutiva: typeof t.annotations?.destructiveHint === "boolean" ? t.annotations.destructiveHint : null,
            });
            if (saida.length >= maxFerramentas) break;
          }
          cursor = r.nextCursor;
          if (cursor === undefined) break;
        }
        return saida;
      },
      async chamar(nome, args, limiteMs) {
        return converter(await cliente.callTool({ name: nome, arguments: args }, undefined, { timeout: limiteMs }));
      },
      async fechar() {
        await cliente.close();
      },
    };
    return aberto;
  };
}
