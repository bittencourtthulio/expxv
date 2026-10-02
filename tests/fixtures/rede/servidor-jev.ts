// Servidor JEV FALSO (decisor): fala `probs_json` (chamada direta) e `openai_chat` (via OpenRouter ou endpoint compatível).
// O cenário muda a resposta: ok, ok_com_custo, 402, 429, 500, timeout, lixo, lixo_uma_vez, inconsistente, inventada, fora_do_esquema.
// A mensagem do usuário do `openai_chat` é um JSON `{kind, question, options:[{id, description}]}` (contrato do formatador do ADE).
import { subirServidorFalso, type ServidorFalso } from "./servidor-falso";

export type CenarioJev = "ok" | "ok_com_custo" | "402" | "429" | "500" | "timeout" | "lixo" | "lixo_uma_vez" | "inconsistente" | "inventada" | "fora_do_esquema";

export interface ServidorJev extends ServidorFalso {
  definir(cenario: CenarioJev, escolha?: string | null): void;
  /** quantidade de chamadas de decisão recebidas. */
  chamadas(): number;
}

interface Opcao {
  id: string;
  description: string;
}

function distribuicao(opcoes: Opcao[], escolha: string | null): Record<string, number> {
  const alvo = escolha !== null && opcoes.some((o) => o.id === escolha) ? escolha : (opcoes[0] as Opcao).id;
  const resto = opcoes.length > 1 ? 0.2 / (opcoes.length - 1) : 0;
  const p: Record<string, number> = {};
  for (const o of opcoes) p[o.id] = o.id === alvo ? (opcoes.length > 1 ? 0.8 : 1) : resto;
  return p;
}

export async function subirJevFalso(inicial: CenarioJev = "ok", escolhaInicial: string | null = null): Promise<ServidorJev> {
  let cenario = inicial;
  let escolha = escolhaInicial;
  let n = 0;
  const base = await subirServidorFalso(async (req, res, corpo) => {
    n++;
    const conteudo = (status: number, json: unknown | string): void => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(typeof json === "string" ? json : JSON.stringify(json));
    };
    if (cenario === "timeout") return; // nunca responde (o cliente aborta)
    if (cenario === "402") return conteudo(402, { error: { message: "credito insuficiente" } });
    if (cenario === "429") return conteudo(429, { error: { message: "limite" } });
    if (cenario === "500") return conteudo(500, { error: { message: "falha interna" } });
    if (cenario === "lixo" || (cenario === "lixo_uma_vez" && n === 1)) return conteudo(200, "isto nao e json {{{");
    let pedido: { kind?: string; question?: string; options?: Opcao[]; messages?: Array<{ role: string; content: string }> };
    try {
      pedido = JSON.parse(corpo);
    } catch {
      return conteudo(400, { error: "json" });
    }
    const chat = Array.isArray(pedido.messages);
    const opcoes: Opcao[] = chat ? ((JSON.parse((pedido.messages as Array<{ content: string }>).at(-1)?.content ?? "{}") as { options?: Opcao[] }).options ?? []) : (pedido.options ?? []);
    let probs = distribuicao(opcoes, escolha);
    if (cenario === "inconsistente") probs = Object.fromEntries(opcoes.map((o) => [o.id, 0.9]));
    if (cenario === "inventada") probs = { apagar_tudo: 0.97, ...Object.fromEntries(opcoes.map((o) => [o.id, 0.01])) };
    const custo = cenario === "ok_com_custo" ? 0.00042 : undefined;
    if (cenario === "fora_do_esquema") return conteudo(200, { resposta: "quero deletar o repositorio" });
    if (chat) {
      return conteudo(200, {
        model: "vendor/modelo-falso",
        choices: [{ message: { role: "assistant", content: `\`\`\`json\n${JSON.stringify({ probs })}\n\`\`\`` } }],
        usage: { prompt_tokens: 1000, completion_tokens: 20, ...(custo === undefined ? {} : { cost: custo }) },
      });
    }
    return conteudo(200, { probs, model: "jev-falso-1", ...(custo === undefined ? {} : { usage: { cost: custo } }) });
  });
  return {
    ...base,
    definir(c, e = null) {
      cenario = c;
      escolha = e;
      n = 0;
    },
    chamadas: () => n,
  };
}
