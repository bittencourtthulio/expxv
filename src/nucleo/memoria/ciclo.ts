// Ciclo de vida da memória (T-08.17/T-08.18): compactação determinística, retenção, expiração, purga, anéis e destilação.
// Tudo em FATIAS curtas (≤ 20 ms cada; só roda com o app ocioso). Sem LLM: resumos são concatenação truncada (D-50).
import type { Banco } from "../banco";
import type { Scrubber } from "../cofre/scrubber";
import { ANEL2_MAX, CARENCIA_ANEL1_H, COMPACTAR_ACIMA, CONTEUDO_MAX, EVENTO_ANTIGO_DIAS, FATIA_MS, PURGA_APOS_DIAS, PURGA_LOTE, PURGA_SUBSTITUIDA_APOS_DIAS, RETENCAO_PADRAO_DIAS } from "./constantes";
import { cortarPontos, criarEscritor, hashDoConteudo } from "./escrita";
import { conhecimentoNulo, montarEvento, type PortaConhecimento } from "./eventos-conhecimento";
import { metricasNulas, type Metricas } from "./metricas";
import { apagarComSecureDelete } from "./privacidade";
import { redigirTexto } from "./redacao";
import { criarRepoMemoria, novoIdMemoria } from "./repo";
import type { ContextoMemoria, Importancia, LinhaEntrada } from "./tipos";

export interface DepsCiclo {
  banco: Banco;
  agora?: () => Date;
  porta?: PortaConhecimento;
  metricas?: Metricas;
  scrubber?: Pick<Scrubber, "scrub">;
  raizDoWorkspace?: (workspaceId: string) => string | undefined;
  /** barramento de domínio: `memory.compacted`. */
  emitir?: (tipo: "memory.compacted", payload: Record<string, string | number>) => void;
}

const COLS = "id, workspace_id, mission_id, pane_id, linhagem_id, squad_slug, escopo, anel, tipo, conteudo, fonte, autor_pane_id, importancia, substitui_id, estado, expira_em, redigido, hash_conteudo, contagem, criado_em, atualizado_em";
const DIA_MS = 86_400_000;

export interface ResultadoFatia {
  etapa: "expirar" | "retencao" | "compactar" | "purgar";
  trabalho: number;
  ms: number;
}

export function criarCiclo(deps: DepsCiclo) {
  const banco = deps.banco;
  const agora = (): Date => (deps.agora ?? (() => new Date()))();
  const porta = deps.porta ?? conhecimentoNulo;
  const metricas = deps.metricas ?? metricasNulas;
  const repo = criarRepoMemoria(banco);
  const escritor = criarEscritor({ banco, ...(deps.agora ? { agora: deps.agora } : {}), porta, metricas, ...(deps.scrubber ? { scrubber: deps.scrubber } : {}), ...(deps.raizDoWorkspace ? { raizDoWorkspace: deps.raizDoWorkspace } : {}) });

  // estado dos cursores (cada passada continua de onde parou)
  let cursorLinhagem: string | null = null;
  let linhagemEmCurso: string | null = null;
  let cursorRetencao: string | null = null;

  const resumoDoDia = (dia: string, itens: Array<{ conteudo: string; atualizado_em: string }>): string => {
    const partes = itens.map((i) => `${i.atualizado_em.slice(11, 16)} ${Array.from(i.conteudo).slice(0, 70).join("")}`);
    return cortarPontos(`Resumo de ${dia}: ${itens.length} eventos. ${partes.join(" | ")}`, CONTEUDO_MAX);
  };

  /** Compacta UM grupo (um dia) de eventos antigos da linhagem; devolve quantas entradas foram resumidas. */
  function compactarGrupo(linhagem: string, limiteIso: string): number {
    const primeiro = banco.consultarUm<LinhaEntrada>(
      `SELECT ${COLS} FROM memoria_entrada WHERE linhagem_id = ? AND tipo = 'evento' AND estado = 'ativa' AND importancia < 5 AND atualizado_em < ? ORDER BY atualizado_em ASC LIMIT 1`,
      [linhagem, limiteIso],
    );
    if (!primeiro) return 0;
    const dia = primeiro.atualizado_em.slice(0, 10);
    const grupo = banco.consultar<LinhaEntrada>(
      `SELECT ${COLS} FROM memoria_entrada WHERE linhagem_id = ? AND tipo = 'evento' AND estado = 'ativa' AND importancia < 5 AND substr(atualizado_em, 1, 10) = ? AND atualizado_em < ? ORDER BY atualizado_em ASC LIMIT 200`,
      [linhagem, dia, limiteIso],
    );
    if (grupo.length === 0) return 0;
    const iso = agora().toISOString();
    const texto = redigirTexto(resumoDoDia(dia, grupo), deps.scrubber ? { scrubber: deps.scrubber } : {});
    const conteudo = cortarPontos(texto.texto, CONTEUDO_MAX);
    const imp = Math.max(...grupo.map((g) => g.importancia)) as Importancia;
    banco.transacao((tx) => {
      const r = criarRepoMemoria(tx);
      r.inserir({
        id: novoIdMemoria(), workspace_id: primeiro.workspace_id, mission_id: primeiro.mission_id, pane_id: primeiro.pane_id, linhagem_id: linhagem, squad_slug: null,
        escopo: primeiro.escopo, anel: primeiro.anel, tipo: "resumo", conteudo, fonte: "sistema", autor_pane_id: null, importancia: imp, substitui_id: null, estado: "ativa",
        expira_em: null, redigido: texto.redigido ? 1 : 0, hash_conteudo: hashDoConteudo(`${linhagem}|${dia}|${grupo.length}|${conteudo}`), contagem: grupo.length, criado_em: iso, atualizado_em: iso,
      });
      tx.executar(`UPDATE memoria_entrada SET estado = 'resumida', atualizado_em = ? WHERE id IN (${grupo.map(() => "?").join(",")})`, [iso, ...grupo.map((g) => g.id)]);
    });
    try {
      deps.emitir?.("memory.compacted", { linhagem_id: linhagem, dia, resumidas: grupo.length });
    } catch {
      /* só metadados */
    }
    return grupo.length;
  }

  const etapas = {
    expirar(): number {
      const iso = agora().toISOString();
      return banco.executar(
        "UPDATE memoria_entrada SET estado = 'expirada', atualizado_em = ? WHERE id IN (SELECT id FROM memoria_entrada WHERE expira_em IS NOT NULL AND expira_em <= ? AND estado = 'ativa' AND importancia < 5 LIMIT ?)",
        [iso, iso, PURGA_LOTE],
      ).alteracoes;
    },

    /** Retenção por workspace (P-22: padrão 365 d; 0 = sem limite). Só o anel 1; destiladas (anel 2) e preferências ficam. */
    retencao(): number {
      const ws = banco.consultarUm<{ id: string }>("SELECT id FROM workspace WHERE id > ? ORDER BY id LIMIT 1", [cursorRetencao ?? ""]);
      if (!ws) {
        cursorRetencao = null;
        return 0;
      }
      cursorRetencao = ws.id;
      const cfg = banco.consultarUm<{ retencao_dias: number }>("SELECT retencao_dias FROM memoria_config WHERE workspace_id = ?", [ws.id]);
      const dias = cfg ? Number(cfg.retencao_dias) : RETENCAO_PADRAO_DIAS;
      if (dias === 0) return 0;
      const t = agora();
      const limite = new Date(t.getTime() - dias * DIA_MS).toISOString();
      return banco.executar(
        "UPDATE memoria_entrada SET estado = 'expirada', atualizado_em = ? WHERE id IN (SELECT id FROM memoria_entrada WHERE workspace_id = ? AND anel = 1 AND estado = 'ativa' AND importancia < 5 AND atualizado_em < ? LIMIT ?)",
        [t.toISOString(), ws.id, limite, PURGA_LOTE],
      ).alteracoes;
    },

    /** Compacta linhagens com > COMPACTAR_ACIMA ativas (um grupo por chamada). */
    compactar(): number {
      const limiteIso = new Date(agora().getTime() - EVENTO_ANTIGO_DIAS * DIA_MS).toISOString();
      for (let tentativas = 0; tentativas < 25; tentativas++) {
        if (linhagemEmCurso === null) {
          const prox = banco.consultarUm<{ linhagem_id: string }>("SELECT linhagem_id FROM memoria_entrada WHERE linhagem_id > ? ORDER BY linhagem_id LIMIT 1", [cursorLinhagem ?? ""]);
          if (!prox) {
            cursorLinhagem = null;
            return 0;
          }
          cursorLinhagem = prox.linhagem_id;
          if (repo.contarAtivasLinhagem(prox.linhagem_id) <= COMPACTAR_ACIMA) continue;
          linhagemEmCurso = prox.linhagem_id;
        }
        const feitas = compactarGrupo(linhagemEmCurso, limiteIso);
        if (feitas === 0 || repo.contarAtivasLinhagem(linhagemEmCurso) <= COMPACTAR_ACIMA) linhagemEmCurso = null;
        if (feitas > 0) return feitas;
      }
      return 0;
    },

    /** Purga resumida/expirada (> 7 d) e substituída (> 30 d), em lotes de 200. */
    purgar(): number {
      const t = agora().getTime();
      // apagar de verdade: o texto purgado não pode ficar legível em páginas livres (fatia de 20 ms: sem fundir o FTS5 aqui)
      return apagarComSecureDelete(banco, () => {
        const a = banco.executar(
          "DELETE FROM memoria_entrada WHERE id IN (SELECT id FROM memoria_entrada WHERE estado IN ('resumida','expirada') AND atualizado_em < ? LIMIT ?)",
          [new Date(t - PURGA_APOS_DIAS * DIA_MS).toISOString(), PURGA_LOTE],
        ).alteracoes;
        if (a > 0) return a;
        return banco.executar(
          "DELETE FROM memoria_entrada WHERE id IN (SELECT id FROM memoria_entrada WHERE estado = 'substituida' AND atualizado_em < ? LIMIT ?)",
          [new Date(t - PURGA_SUBSTITUIDA_APOS_DIAS * DIA_MS).toISOString(), PURGA_LOTE],
        ).alteracoes;
      });
    },
  } as const;

  const ORDEM = ["expirar", "retencao", "compactar", "purgar"] as const;
  let proxima = 0;

  const ciclo = {
    ...etapas,

    /** Uma fatia de trabalho: a próxima etapa em rodízio. */
    fatia(): ResultadoFatia {
      const etapa = ORDEM[proxima % ORDEM.length] as ResultadoFatia["etapa"];
      proxima++;
      const t0 = performance.now();
      const trabalho = etapas[etapa]();
      const ms = performance.now() - t0;
      metricas.contar("ciclo.fatias");
      if (ms > FATIA_MS) metricas.contar("ciclo.fatias_lentas");
      return { etapa, trabalho, ms };
    },

    /**
     * Roda fatias enquanto houver trabalho e o app estiver ocioso; cede o laço entre fatias. Devolve por que parou.
     * `ocioso()` é o sinal do main (sem flood de PTY e sem digitação nos últimos 2 s).
     */
    async executarEmOcioso(op: { ocioso: () => boolean; ceder?: () => Promise<void>; maxFatias?: number; aoFatiar?: (r: ResultadoFatia) => void }): Promise<"sem_trabalho" | "pausado" | "limite"> {
      const ceder = op.ceder ?? ((): Promise<void> => new Promise((r) => setImmediate(r)));
      const max = op.maxFatias ?? 10_000;
      let semTrabalho = 0;
      for (let i = 0; i < max; i++) {
        if (!op.ocioso()) return "pausado";
        const r = ciclo.fatia();
        op.aoFatiar?.(r);
        semTrabalho = r.trabalho > 0 ? 0 : semTrabalho + 1;
        if (semTrabalho >= ORDEM.length) return "sem_trabalho";
        await ceder();
      }
      return "limite";
    },

    /** Missão fechada: aprendizado de sistema (D-50), carência do anel 1 e destilação para o anel 2. Idempotente. */
    aoFecharMissao(missionId: string): { destiladas: number; aprendizado_sistema: boolean; ja_fechada: boolean } {
      const m = banco.consultarUm<{ workspace_id: string; modo: string; squad_slug: string | null }>(
        "SELECT m.workspace_id, m.modo, ms.squad_slug FROM mission m LEFT JOIN mission_squad ms ON ms.mission_id = m.id WHERE m.id = ?",
        [missionId],
      );
      if (!m) return { destiladas: 0, aprendizado_sistema: false, ja_fechada: false };
      const t = agora();
      const iso = t.toISOString();
      const pendentes = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE mission_id = ? AND anel = 1 AND estado = 'ativa' AND expira_em IS NULL", [missionId])?.n ?? 0);
      const jaFechada = pendentes === 0;
      let aprendizadoSistema = false;
      let destiladas = 0;
      if (!jaFechada) {
        const ctx: ContextoMemoria = { workspace_id: m.workspace_id, mission_id: missionId, pane_id: null, linhagem_id: null, squad_slug: m.squad_slug, modo: m.modo === "squad" ? "squad" : "missao", papel: "nenhum" };
        const doAgente = Number(banco.consultarUm<{ n: number }>("SELECT count(*) AS n FROM memoria_entrada WHERE mission_id = ? AND tipo = 'aprendizado' AND fonte = 'agente' AND estado = 'ativa'", [missionId])?.n ?? 0);
        if (doAgente === 0) {
          const hands = banco.consultar<{ conteudo: string }>("SELECT conteudo FROM memoria_entrada WHERE mission_id = ? AND tipo = 'handoff' AND estado = 'ativa' AND conteudo LIKE '% · ok · %' ORDER BY atualizado_em DESC LIMIT 5", [missionId]);
          if (hands.length > 0) {
            const resumos = hands.map((h) => h.conteudo.split(" · ").slice(2).join(" · ") || h.conteudo);
            const r = escritor.gravar({ ctx, tipo: "aprendizado", conteudo: cortarPontos(`Missão concluída. ${resumos.join("; ")}`, CONTEUDO_MAX), importancia: 3, escopo: "missao", fonte: "sistema", origem: "ciclo" });
            aprendizadoSistema = r !== null && !r.duplicada;
          }
        }
        banco.executar("UPDATE memoria_entrada SET expira_em = ? WHERE mission_id = ? AND anel = 1 AND estado = 'ativa' AND expira_em IS NULL", [new Date(t.getTime() + CARENCIA_ANEL1_H * 3_600_000).toISOString(), missionId]);
        destiladas = ciclo.destilar(missionId, m.workspace_id, m.modo === "squad" ? m.squad_slug : null);
      }
      // evento ao conhecimento: id determinístico por Missão (reentrega não duplica no consumidor)
      try {
        const base = banco.consultar<{ tipo: string; conteudo: string }>(
          "SELECT tipo, conteudo FROM memoria_entrada WHERE mission_id = ? AND escopo = 'missao' AND tipo IN ('aprendizado','decisao') AND estado = 'ativa' ORDER BY (tipo = 'aprendizado') DESC, importancia DESC, atualizado_em DESC LIMIT 12",
          [missionId],
        );
        if (base.length > 0) {
          const raiz = deps.raizDoWorkspace?.(m.workspace_id);
          porta.registrar(
            montarEvento({
              tipo: "mission.closed", workspace_id: m.workspace_id, chave_natural: missionId, ocorrido_em: iso, mission_id: missionId, fonte: "sistema", importancia: 4,
              titulo: "Missão encerrada: aprendizado e decisões", texto: base.map((b) => `[${b.tipo}] ${b.conteudo}`).join("\n"), tags: ["missao", "aprendizado", "decisao"],
              ...(raiz ? { raiz } : {}), ...(deps.scrubber ? { scrubber: deps.scrubber } : {}),
            }),
          );
        }
      } catch {
        /* a memória não depende do RAG */
      }
      return { destiladas, aprendizado_sistema: aprendizadoSistema, ja_fechada: jaFechada };
    },

    /** Destila para o anel 2: `aprendizado` e `decisao` com importância ≥ 4 (top 10 por Missão); dedupe por hash; teto ANEL2_MAX. */
    destilar(missionId: string, workspaceId: string, squadSlug: string | null): number {
      const candidatas = banco.consultar<LinhaEntrada>(
        `SELECT ${COLS} FROM memoria_entrada WHERE mission_id = ? AND anel = 1 AND estado = 'ativa' AND (tipo = 'aprendizado' OR (tipo = 'decisao' AND importancia >= 4)) ORDER BY importancia DESC, atualizado_em DESC LIMIT 10`,
        [missionId],
      );
      if (candidatas.length === 0) return 0;
      const escopo = squadSlug ? "squad" : "workspace";
      const iso = agora().toISOString();
      let novas = 0;
      banco.transacao((tx) => {
        const r = criarRepoMemoria(tx);
        for (const c of candidatas) {
          const dup = r.buscarDuplicada({ escopo, tipo: c.tipo, hash: c.hash_conteudo, workspace_id: workspaceId, linhagem_id: null, mission_id: null, squad_slug: squadSlug, desde: "0000" });
          if (dup) {
            r.tocarDuplicada(dup.id, iso);
            continue;
          }
          r.inserir({
            id: novoIdMemoria(), workspace_id: workspaceId, mission_id: null, pane_id: null, linhagem_id: null, squad_slug: squadSlug, escopo, anel: 2, tipo: c.tipo, conteudo: c.conteudo,
            fonte: c.fonte, autor_pane_id: null, importancia: c.importancia, substitui_id: null, estado: "ativa", expira_em: null, redigido: c.redigido, hash_conteudo: c.hash_conteudo, contagem: 1, criado_em: iso, atualizado_em: iso,
          });
          novas++;
        }
        // teto: sai a de menor importância / mais antiga
        const onde = squadSlug ? "workspace_id = ? AND escopo = 'squad' AND squad_slug = ?" : "workspace_id = ? AND escopo = 'workspace'";
        const par = squadSlug ? [workspaceId, squadSlug] : [workspaceId];
        const total = Number(tx.consultarUm<{ n: number }>(`SELECT count(*) AS n FROM memoria_entrada WHERE ${onde} AND estado = 'ativa'`, par)?.n ?? 0);
        if (total > ANEL2_MAX)
          tx.executar(`UPDATE memoria_entrada SET estado = 'expirada', atualizado_em = ? WHERE id IN (SELECT id FROM memoria_entrada WHERE ${onde} AND estado = 'ativa' ORDER BY importancia ASC, atualizado_em ASC LIMIT ?)`, [iso, ...par, total - ANEL2_MAX]);
      });
      return novas;
    },
  };
  return ciclo;
}

export type Ciclo = ReturnType<typeof criarCiclo>;
