// Corpus sintético da memória para os orçamentos (P-32..P-42): semente fixa, 1 workspace, N entradas distribuídas por linhagens.
// Por linhagem: `porLinhagem` linhas, das quais só ~20% estão ativas (o resto já compactado/expirado/substituído, como num banco antigo),
// o que mantém o workspace dentro do teto de entradas ativas. A linhagem "L000" é a do brief: TODAS as 1 000 linhas ativas.
import type { Banco } from "../../../src/nucleo/banco/banco";
import { hashDoConteudo } from "../../../src/nucleo/memoria/escrita";
import { criarRepoMemoria } from "../../../src/nucleo/memoria/repo";
import { garantirFts } from "../../../src/nucleo/memoria/fts";

const VOCAB = "cache fila banco token sessão deploy teste migração índice consulta memória escrita leitura worker pane missão squad cofre rede evento handoff checkpoint decisão risco módulo contrato esquema validação retry timeout limite anel brief restore compactação retenção busca vetor grafo".split(" ");
const TIPOS = ["evento", "evento", "evento", "evento", "evento", "evento", "fato", "fato", "decisao", "risco", "handoff", "resumo"] as const;

function lcg(semente: number): () => number {
  let x = semente >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 0x100000000);
}

export interface CorpusMemoria {
  workspaceId: string;
  missionId: string;
  /** panes: P000 (a do brief, com 1 000 ativas), P001… */
  panes: string[];
  total: number;
}

export function gerarCorpus(banco: Banco, op: { total?: number; porLinhagem?: number; semente?: number } = {}): CorpusMemoria {
  const total = op.total ?? 50_000;
  const por = op.porLinhagem ?? 1000;
  const rnd = lcg(op.semente ?? 42);
  const ts = "2026-09-01T00:00:00.000Z";
  banco.executar("INSERT INTO workspace (id,nome,raiz,criado_em,atualizado_em) VALUES ('ws_perf','Perf','/perf',?,?)", [ts, ts]);
  banco.executar("INSERT INTO mission (id,workspace_id,modo,origem,titulo,estado,criado_em,atualizado_em) VALUES ('mis_perf','ws_perf','agentico','livre','t','executando',?,?)", [ts, ts]);
  const nLinhagens = Math.ceil(total / por);
  const panes: string[] = [];
  for (let i = 0; i < nLinhagens; i++) {
    const id = `P${String(i).padStart(3, "0")}`;
    panes.push(id);
    banco.executar("INSERT INTO pane (id,mission_id,workspace_id,display_id,tipo,cli,papel,eh_piloto,estado,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)", [id, i === 0 ? "mis_perf" : null, "ws_perf", i + 1, "cli", "claude", i === 0 ? "piloto" : "nenhum", i === 0 ? 1 : 0, "pronto", ts, ts]);
  }
  const repo = criarRepoMemoria(banco);
  const palavras = (n: number): string => Array.from({ length: n }, () => VOCAB[Math.floor(rnd() * VOCAB.length)] as string).join(" ");
  let n = 0;
  banco.transacao(() => {
    for (let l = 0; l < nLinhagens && n < total; l++) {
      const lin = panes[l] as string;
      for (let i = 0; i < por && n < total; i++, n++) {
        const tipo = i === 0 ? "checkpoint" : (TIPOS[Math.floor(rnd() * TIPOS.length)] as (typeof TIPOS)[number]);
        const ativa = l === 0 || i % 5 === 0 || i === 0;
        const conteudo = `${palavras(12 + Math.floor(rnd() * 25))} #${n}`;
        const dia = String(1 + Math.floor(rnd() * 28)).padStart(2, "0");
        const quando = `2026-09-${dia}T${String(Math.floor(rnd() * 24)).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00.000Z`;
        repo.inserir({
          id: `mem_${String(n).padStart(8, "0")}`, workspace_id: "ws_perf", mission_id: l === 0 ? "mis_perf" : null, pane_id: lin, linhagem_id: lin, squad_slug: null, escopo: "pane", anel: 1,
          tipo: tipo === "checkpoint" && l !== 0 ? "resumo" : tipo, conteudo, fonte: rnd() < 0.5 ? "sistema" : "agente", autor_pane_id: lin, importancia: (1 + Math.floor(rnd() * 5)) as 1,
          substitui_id: null, estado: ativa ? "ativa" : (["resumida", "expirada", "substituida"] as const)[n % 3] as "resumida", expira_em: null, redigido: 0, hash_conteudo: hashDoConteudo(conteudo), contagem: 1, criado_em: quando, atualizado_em: quando,
        });
      }
    }
  });
  garantirFts(banco);
  return { workspaceId: "ws_perf", missionId: "mis_perf", panes, total: n };
}
