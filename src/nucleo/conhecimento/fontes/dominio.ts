// Fonte "domínio": mapeia `EventoConhecimento` (Fase 8) e as entradas internas (turno de sessão, commit, arquivo, nota, chat) para
// `DocumentoEntrada`. Puro. Chave natural estável por origem: reprocessar o mesmo evento não duplica (UNIQUE colecao+tipo+origem).
import type { TipoDocumento } from "../../../compartilhado/conhecimento";
import type { EventoConhecimento } from "../../memoria/eventos-conhecimento";
import { caminhoProibido } from "../seguranca";
import type { DocumentoEntrada, EntradaConhecimento } from "../tipos";

export interface Mapeamento {
  docs: DocumentoEntrada[];
  /** o texto do evento alimenta a extração de aprendizados como decisão ou aprendizado da Fase 8. */
  memoria?: "decision" | "learning";
}

const RE_TASK = /\bT-\d{1,3}\.\d{1,3}\b/;
const ref = (e: EventoConhecimento, tipo: string): string | undefined => e.referencias.find((r) => r.tipo === tipo)?.id;

/** Classifica um arquivo do método pelo caminho (relativo). */
export function classificarDocumento(rel: string): TipoDocumento {
  const nome = rel.split("/").pop() ?? rel;
  if (/causa[-_ ]?raiz/i.test(rel) || /\bOC-/i.test(nome)) return "causa_raiz";
  if (/(?:^|[\/_.-])qa(?:[\/_.-]|$)/i.test(rel)) return "qa";
  if (/decis(?:ao|oes|ão|ões)/i.test(nome)) return "decisao";
  if (/^docs\/(?:relatorios|manutencao|sprintx|prodx|runx|mergex)\//.test(rel) || /^(?:INDICE|ORQUESTRADOR)\.md$/i.test(nome)) return "relatorio";
  return "doc";
}

export function mapearEvento(e: EventoConhecimento): Mapeamento {
  const base = { texto: e.texto, titulo: e.titulo, fonte: e.fonte, ocorrido_em: e.ocorrido_em, mission_id: e.mission_id ?? undefined, pane_id: e.pane_id ?? undefined, importancia: e.importancia, formato: "evento" as const };
  const task = ref(e, "task") ?? RE_TASK.exec(`${e.titulo} ${e.texto}`)?.[0];
  const idCurto = e.id.slice(0, 16);
  const arquivos = e.referencias.filter((r) => r.tipo === "arquivo_rel" && !caminhoProibido(r.id)).map((r) => r.id);
  switch (e.tipo) {
    case "handoff.submitted":
      return { docs: [{ ...base, tipo: "handoff", origem: `handoff:${ref(e, "handoff") ?? idCurto}`, task_ref: task, arquivos }] };
    case "task.updated":
      return { docs: [{ ...base, tipo: "task", origem: `task:${task ?? idCurto}`, task_ref: task, arquivos }] };
    case "mission.closed":
      return { docs: [{ ...base, tipo: "missao", origem: `mission:${e.mission_id ?? idCurto}`, arquivos }] };
    case "pane.closed":
      return { docs: [{ ...base, tipo: "nota", origem: `pane:${e.pane_id ?? idCurto}`, arquivos }] };
    case "memory.checkpoint":
      return { docs: [{ ...base, tipo: "nota", origem: `memoria:${ref(e, "entrada_memoria") ?? idCurto}`, task_ref: task }] };
    case "memory.decision":
      return { docs: [{ ...base, tipo: "decisao", origem: `memoria:${ref(e, "entrada_memoria") ?? idCurto}`, task_ref: task }], memoria: "decision" };
    case "memory.learning":
      // vira rag_aprendizado (e o documento do aprendizado); o texto cru não é indexado duas vezes
      return { docs: [{ ...base, tipo: "nota", origem: `memoria:${ref(e, "entrada_memoria") ?? idCurto}`, task_ref: task, importancia: 2 }], memoria: "learning" };
    case "method.changed": {
      const rel = e.referencias.find((r) => r.tipo === "arquivo_rel" || r.tipo === "relatorio")?.id;
      if (!rel || caminhoProibido(rel) || e.texto.trim() === "") return { docs: [] };
      return { docs: [{ ...base, tipo: classificarDocumento(rel), origem: rel, formato: "markdown", task_ref: task }] };
    }
  }
}

export function mapearEntrada(en: EntradaConhecimento): Mapeamento {
  switch (en.tipo) {
    case "evento":
      return mapearEvento(en.evento);
    case "session.turn_ended":
      return {
        docs: [
          {
            tipo: "transcricao",
            origem: `sessao:${en.sessao_id}#${en.indice}`,
            titulo: en.usuario.trim().split("\n")[0]?.slice(0, 120) || "troca",
            texto: `${en.usuario}\n${en.resposta}`,
            formato: "transcricao",
            fonte: "agente",
            ocorrido_em: en.ocorrido_em,
            mission_id: en.mission_id ?? undefined,
            pane_id: en.pane_id ?? undefined,
            cli: en.cli,
            modelo_autor: en.modelo ?? undefined,
            agente: [en.cli, en.modelo].filter(Boolean).join("·"),
            importancia: 2,
            arquivos: en.arquivos.filter((a) => !caminhoProibido(a)),
            troca: { usuario: en.usuario, resposta: en.resposta, ferramentas: en.ferramentas, arquivos: en.arquivos },
          },
        ],
      };
    case "vcs.commit": {
      const linha = en.mensagem.trim().split("\n")[0] ?? "";
      return {
        docs: [
          {
            tipo: "commit",
            origem: `commit:${en.sha}`,
            titulo: linha.slice(0, 200),
            texto: en.mensagem,
            formato: "commit",
            fonte: "sistema",
            ocorrido_em: en.ocorrido_em,
            mission_id: en.mission_id ?? undefined,
            autor: en.autor ?? undefined,
            arquivos: en.arquivos.map((a) => a.caminho).filter((a) => !caminhoProibido(a)),
            commit: { sha: en.sha, mensagem: en.mensagem, arquivos: en.arquivos },
          },
        ],
      };
    }
    case "file.changed": {
      if (caminhoProibido(en.caminho)) return { docs: [] };
      const md = /\.(?:md|mdx|markdown|txt)$/i.test(en.caminho);
      return { docs: [{ tipo: md ? classificarDocumento(en.caminho) : "codigo", origem: en.caminho, titulo: en.caminho.split("/").pop() ?? en.caminho, texto: en.texto, formato: md ? "markdown" : "codigo", fonte: "sistema", ocorrido_em: en.ocorrido_em, importancia: md ? 3 : 2 }] };
    }
    case "user.note":
      return { docs: [{ tipo: "nota", origem: `nota:${en.id}`, titulo: en.titulo.slice(0, 200), texto: en.texto, formato: "markdown", fonte: "usuario", ocorrido_em: en.ocorrido_em, importancia: 4 }] };
    case "chat.exchange":
      return { docs: [{ tipo: "chat", origem: `chat:${en.conversa_id}#${en.indice}`, titulo: en.pergunta.trim().split("\n")[0]?.slice(0, 120) || "chat", texto: `Pergunta: ${en.pergunta}\n\nResposta: ${en.resposta}`, formato: "markdown", fonte: "usuario", ocorrido_em: en.ocorrido_em, importancia: 2 }] };
  }
}
