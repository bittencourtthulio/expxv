// Adaptadores PUROS do modelo existente do método (src/nucleo/metodo) para a `FonteTrabalho`. Somente leitura: nenhum caminho aqui
// escreve em docs/** (D-04). O que depende de leitura de disco (QA.md, ENTREGA.md) chega já parseado como `Artefato`.
import type { Artefato, EventoRastro, Trabalho } from "../../metodo/tipos";
import type { AchadoQa, CommitEntrega, FonteTrabalho, QaFonte } from "../portas";
import { hash } from "../util";

const SEV = new Set(["alta", "media", "baixa"]);
const txt = (x: unknown, max = 400): string => (typeof x === "string" ? x.slice(0, max) : "");

/** QA.md (frontmatter `achados: [{id, severidade, task, arquivos, descricao, categoria}]`), tolerante a campos faltando. */
export function qaDeArtefato(a: Artefato | null, trabalho: Pick<Trabalho, "veredito_qa">, emitidoEm: string | null): QaFonte | null {
  if (!a && trabalho.veredito_qa === null) return null;
  const bruto = a?.dados?.["achados"];
  const achados: AchadoQa[] = [];
  if (Array.isArray(bruto)) {
    bruto.forEach((x, i) => {
      if (typeof x !== "object" || x === null) return;
      const o = x as Record<string, unknown>;
      const sev = txt(o["severidade"]).toLowerCase().replace("é", "e");
      if (!SEV.has(sev)) return;
      achados.push({
        id: txt(o["id"], 60) || `a${i + 1}`,
        severidade: sev as AchadoQa["severidade"],
        categoria: txt(o["categoria"], 40) || null,
        task: txt(o["task"], 40) || null,
        arquivos: Array.isArray(o["arquivos"]) ? (o["arquivos"] as unknown[]).filter((f): f is string => typeof f === "string").slice(0, 50) : [],
        descricao: txt(o["descricao"]),
      });
    });
  }
  return { veredito: trabalho.veredito_qa, emitido_em: emitidoEm, achados };
}

/** commits do ENTREGA.md (`commits: [{sha, mensagem, ts, task, linhas, labels}]`), tolerante. */
export function commitsDeEntrega(a: Artefato | null): CommitEntrega[] {
  const bruto = a?.dados?.["commits"];
  if (!Array.isArray(bruto)) return [];
  const out: CommitEntrega[] = [];
  for (const x of bruto) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    const mensagem = txt(o["mensagem"] ?? o["message"], 300);
    if (!mensagem) continue;
    out.push({
      sha: txt(o["sha"], 64) || null, mensagem, ts: txt(o["ts"], 40) || null,
      linhas: typeof o["linhas"] === "number" ? (o["linhas"] as number) : null,
      labels: Array.isArray(o["labels"]) ? (o["labels"] as unknown[]).filter((l): l is string => typeof l === "string").slice(0, 10) : [],
      task_ref: txt(o["task"], 40) || null,
    });
  }
  return out;
}

/** Hash do que muda o resultado: status/conclusão das tasks, vereditos, contagem de eventos e o último evento. */
export function versaoOrigem(t: Trabalho, rastro: readonly EventoRastro[], qa: QaFonte | null): string {
  const tasks = t.sprints.flatMap((s) => s.fases.flatMap((f) => f.tasks.map((k) => `${k.id}:${k.status}:${k.concluida_em ?? ""}:${k.suite}`)));
  const ultimo = rastro[rastro.length - 1];
  return hash([t.id, t.status, t.veredito_qa ?? "", t.veredito_auditoria ?? "", rastro.length, ultimo?.ts ?? "", qa?.achados.length ?? 0, t.entrega?.commits ?? 0, ...tasks].join("|"));
}

export function montarFonte(workspaceId: string, trabalho: Trabalho, rastro: EventoRastro[], extras: { qa?: Artefato | null; qaEmitidoEm?: string | null; entrega?: Artefato | null } = {}): FonteTrabalho {
  const qa = qaDeArtefato(extras.qa ?? null, trabalho, extras.qaEmitidoEm ?? rastro.filter((e) => e.evento === "veredito_emitido").map((e) => e.ts).sort().pop() ?? null);
  return { workspace_id: workspaceId, trabalho, rastro, commits: commitsDeEntrega(extras.entrega ?? null), qa, versao_origem: versaoOrigem(trabalho, rastro, qa) };
}
