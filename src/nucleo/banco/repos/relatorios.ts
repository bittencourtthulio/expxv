// Repositório SQLite da Fase 19 (migration 0014). Síncrono; JSON só em colunas `*_json`; upsert por `ON CONFLICT` (nunca REPLACE: apagaria filhos por CASCADE).
import type { ArquivoPacote, ConfigRelatorios, EnvioDivulgacao, EstadoPacote } from "../../../compartilhado/relatorios";
import type { RegistroPacote, RepoRelatorios } from "../../relatorios/repos";
import type { Banco, Linha, Valor } from "../banco";

const j = (v: unknown): string => JSON.stringify(v ?? null);
const doLinha = (l: Linha): RegistroPacote => ({
  id: String(l["id"]), workspace_id: String(l["workspace_id"]), sprint_id: String(l["sprint_id"]), titulo: String(l["titulo"]), versao: Number(l["versao"]),
  versao_lancamento: (l["versao_lancamento"] as string | null) ?? null, hash_fatos: String(l["hash_fatos"]), hash_geracao: String(l["hash_geracao"]),
  modo_redacao: l["modo_redacao"] as RegistroPacote["modo_redacao"], modo_bloco: JSON.parse(String(l["modo_bloco_json"])) as Record<string, string>,
  estado: l["estado"] as EstadoPacote, etapa: (l["etapa"] as string | null) ?? null, revisao_usuario: l["revisao_usuario"] as RegistroPacote["revisao_usuario"],
  aprovado_em: (l["aprovado_em"] as string | null) ?? null, pasta_ref: String(l["pasta_ref"]), bytes: Number(l["bytes"]), avisos: JSON.parse(String(l["avisos_json"])) as string[],
  metricas: JSON.parse(String(l["metricas_json"])) as RegistroPacote["metricas"], verificacao: l["verificacao_json"] === null ? null : (JSON.parse(String(l["verificacao_json"])) as RegistroPacote["verificacao"]),
  motivo_falha: (l["motivo_falha"] as string | null) ?? null, gerado_em: String(l["gerado_em"]),
});
const envioDe = (l: Linha): EnvioDivulgacao => ({
  id: String(l["id"]), pacote_id: String(l["pacote_id"]), workspace_id: String(l["workspace_id"]), canal: l["canal"] as EnvioDivulgacao["canal"], variante: l["variante"] as EnvioDivulgacao["variante"],
  texto: String(l["texto"]), estado: l["estado"] as EnvioDivulgacao["estado"], criado_em: String(l["criado_em"]), enviado_em: (l["enviado_em"] as string | null) ?? null, erro: (l["erro"] as string | null) ?? null,
});

const COLS_PACOTE = ["id", "workspace_id", "sprint_id", "titulo", "versao", "versao_lancamento", "hash_fatos", "hash_geracao", "modo_redacao", "modo_bloco_json", "estado", "etapa", "revisao_usuario", "aprovado_em", "pasta_ref", "bytes", "avisos_json", "metricas_json", "verificacao_json", "motivo_falha", "gerado_em"] as const;
const valoresPacote = (p: RegistroPacote): Valor[] => [p.id, p.workspace_id, p.sprint_id, p.titulo, p.versao, p.versao_lancamento, p.hash_fatos, p.hash_geracao, p.modo_redacao, j(p.modo_bloco), p.estado, p.etapa, p.revisao_usuario, p.aprovado_em, p.pasta_ref, p.bytes, j(p.avisos), j(p.metricas), p.verificacao === null ? null : j(p.verificacao), p.motivo_falha, p.gerado_em];

export function criarRepoRelatoriosSqlite(banco: Banco): RepoRelatorios {
  return {
    configObter(ws) {
      const l = banco.consultarUm("SELECT json FROM relatorio_config WHERE workspace_id = ?", [ws]);
      return l ? (JSON.parse(String(l["json"])) as ConfigRelatorios) : undefined;
    },
    configGravar(ws, c, quando) {
      banco.executar("INSERT INTO relatorio_config (workspace_id, json, atualizado_em) VALUES (?,?,?) ON CONFLICT (workspace_id) DO UPDATE SET json = excluded.json, atualizado_em = excluded.atualizado_em", [ws, j(c), quando]);
    },
    pacoteInserir(p) {
      banco.executar(`INSERT INTO relatorio_pacote (${COLS_PACOTE.join(",")}) VALUES (${COLS_PACOTE.map(() => "?").join(",")})`, valoresPacote(p));
    },
    pacoteAtualizar(id, patch) {
      const atual = banco.consultarUm("SELECT * FROM relatorio_pacote WHERE id = ?", [id]);
      if (!atual) return;
      const novo: RegistroPacote = { ...doLinha(atual), ...patch };
      const sets = COLS_PACOTE.filter((c) => c !== "id").map((c) => `${c} = ?`).join(", ");
      banco.executar(`UPDATE relatorio_pacote SET ${sets} WHERE id = ?`, [...valoresPacote(novo).slice(1), id]);
    },
    pacoteObter: (id) => { const l = banco.consultarUm("SELECT * FROM relatorio_pacote WHERE id = ?", [id]); return l ? doLinha(l) : undefined; },
    pacotesListar(ws, f = {}) {
      const w = ["workspace_id = ?"]; const p: Valor[] = [ws];
      if (f.sprint_id) { w.push("sprint_id = ?"); p.push(f.sprint_id); }
      if (f.estado) { w.push("estado = ?"); p.push(f.estado); }
      return banco.consultar(`SELECT * FROM relatorio_pacote WHERE ${w.join(" AND ")} ORDER BY gerado_em DESC, versao DESC, id`, p).map(doLinha);
    },
    ultimaVersao: (ws, s) => Number(banco.consultarUm("SELECT COALESCE(MAX(versao),0) AS v FROM relatorio_pacote WHERE workspace_id = ? AND sprint_id = ?", [ws, s])?.["v"] ?? 0),
    pacotePorGeracao: (ws, s, h) => { const l = banco.consultarUm("SELECT * FROM relatorio_pacote WHERE workspace_id = ? AND sprint_id = ? AND hash_geracao = ? AND estado = 'pronto' ORDER BY versao DESC LIMIT 1", [ws, s, h]); return l ? doLinha(l) : undefined; },
    arquivosSubstituir(id, arquivos) {
      banco.transacao((b) => {
        b.executar("DELETE FROM relatorio_arquivo WHERE pacote_id = ?", [id]);
        for (const a of arquivos) b.executar("INSERT INTO relatorio_arquivo (pacote_id, nome, formato, publico, sha256, bytes, revisao) VALUES (?,?,?,?,?,?,?)", [id, a.nome, a.formato, a.publico, a.sha256, a.bytes, a.revisao]);
      });
    },
    arquivosListar: (id) => banco.consultar("SELECT nome, formato, publico, sha256, bytes, revisao FROM relatorio_arquivo WHERE pacote_id = ? ORDER BY nome", [id]).map((l): ArquivoPacote => ({ nome: String(l["nome"]), formato: l["formato"] as ArquivoPacote["formato"], publico: l["publico"] as ArquivoPacote["publico"], sha256: String(l["sha256"]), bytes: Number(l["bytes"]), revisao: l["revisao"] as ArquivoPacote["revisao"] })),
    ajusteGravar(ws, s, b, t, q) {
      banco.executar("INSERT INTO relatorio_ajuste (workspace_id, sprint_id, bloco_id, texto_md, atualizado_em) VALUES (?,?,?,?,?) ON CONFLICT (workspace_id, sprint_id, bloco_id) DO UPDATE SET texto_md = excluded.texto_md, atualizado_em = excluded.atualizado_em", [ws, s, b, t, q]);
    },
    ajusteApagar: (ws, s, b) => void banco.executar("DELETE FROM relatorio_ajuste WHERE workspace_id = ? AND sprint_id = ? AND bloco_id = ?", [ws, s, b]),
    ajustesListar: (ws, s) => new Map(banco.consultar("SELECT bloco_id, texto_md FROM relatorio_ajuste WHERE workspace_id = ? AND sprint_id = ?", [ws, s]).map((l) => [String(l["bloco_id"]), String(l["texto_md"])])),
    exportacaoInserir: (e) => void banco.executar("INSERT INTO relatorio_exportacao (id, pacote_id, modo, destino, arquivos_json, bytes, em) VALUES (?,?,?,?,?,?,?)", [e.id, e.pacote_id, e.modo, e.destino, j(e.arquivos), e.bytes, e.em]),
    envioInserir: (e) => void banco.executar("INSERT INTO relatorio_divulgacao (id, pacote_id, workspace_id, canal, variante, texto, estado, criado_em, enviado_em, erro) VALUES (?,?,?,?,?,?,?,?,?,?)", [e.id, e.pacote_id, e.workspace_id, e.canal, e.variante, e.texto, e.estado, e.criado_em, e.enviado_em, e.erro]),
    envioAtualizar(id, patch) {
      const l = banco.consultarUm("SELECT * FROM relatorio_divulgacao WHERE id = ?", [id]);
      if (!l) return;
      const n = { ...envioDe(l), ...patch };
      banco.executar("UPDATE relatorio_divulgacao SET texto = ?, estado = ?, enviado_em = ?, erro = ? WHERE id = ?", [n.texto, n.estado, n.enviado_em, n.erro, id]);
    },
    envioObter: (id) => { const l = banco.consultarUm("SELECT * FROM relatorio_divulgacao WHERE id = ?", [id]); return l ? envioDe(l) : undefined; },
    enviosListar: (pid) => banco.consultar("SELECT * FROM relatorio_divulgacao WHERE pacote_id = ? ORDER BY criado_em, id", [pid]).map(envioDe),
    transacao: (fn) => banco.transacao(() => fn()),
  };
}
