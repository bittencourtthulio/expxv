import "../versionamento/versionamento.css";
import { useEffect, useState } from "react";
import type { Mission } from "../../../compartilhado/dominio";
import type { CommitDaMissao, MissaoVcs } from "../../../compartilhado/vcs";
import type { Diff } from "../../../nucleo/vcs/tipos";
import { ade } from "../../ade";
import { Badge } from "../../componentes/Badge";
import { DecoracaoVcs } from "../../componentes/DecoracaoVcs";
import { Dialogo } from "../../componentes/Dialogo";
import { DiffView } from "../versionamento/diff/DiffView";
import type { ApiVcs } from "../../../compartilhado/vcs";

/** T-06.34: emblema da Missão (branch/cópia, sujo, ahead/behind, PR e checks), commits por task do ENTREGA.md e diff contra a base. */
export function SecaoVcsMissao({ missao, api = ade()?.vcs }: { missao: Mission; api?: ApiVcs | undefined }) {
  const [info, setInfo] = useState<MissaoVcs | null>(null);
  const [commits, setCommits] = useState<CommitDaMissao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ titulo: string; d: Diff } | null>(null);
  const temArvore = missao.worktree !== null;

  useEffect(() => {
    if (api === undefined || !temArvore) return undefined;
    let vivo = true;
    api.missao(missao.id, "resumo", {}).then((r) => { if (vivo) setInfo(r); }, (e) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); });
    api.missao(missao.id, "commits", {}).then((r) => { if (vivo) setCommits(r); }, () => { if (vivo) setCommits([]); });
    return () => { vivo = false; };
  }, [api, missao.id, temArvore]);

  if (api === undefined || !temArvore) return null;
  const abrirCommit = async (c: CommitDaMissao): Promise<void> => {
    try { const d = await api.historico({ workspace_id: missao.workspace_id, mission_id: missao.id }, "detalhe", { rev: c.commit }); setDiff({ titulo: `${c.commit.slice(0, 7)} · ${d.assunto}`, d: d.diff }); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };
  const abrirBase = async (): Promise<void> => {
    try { setDiff({ titulo: `Missão contra a base${info?.base != null ? ` (${info.base})` : ""}`, d: await api.missao(missao.id, "diff_base", { caminho: null }) }); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  };
  const pr = info?.pr ?? null;
  return (
    <section className="vc-missao" aria-label="Versionamento da Missão">
      <h3>Versionamento</h3>
      <p className="mis-linha-meta">
        <DecoracaoVcs alvo={{ workspace_id: missao.workspace_id, mission_id: missao.id }} />
        {info !== null && !info.existe ? <Badge tom="alerta">pasta da Missão não existe mais</Badge> : null}
        {info?.base != null ? <span className="vc-pasta">base {info.base}</span> : null}
        {pr !== null ? <Badge tom={pr.checks_falhando > 0 ? "alerta" : "destaque"}>PR #{pr.numero} · {pr.estado}{pr.checks_falhando > 0 ? ` · ${pr.checks_falhando} check(s) falhando` : ""}</Badge> : null}
        {pr !== null ? <a href={pr.url} onClick={(e) => { e.preventDefault(); void ade()?.terminais.abrirLink(pr.url); }}>abrir PR</a> : null}
        <button type="button" className="vc-mini" onClick={() => void abrirBase()}>Diff contra a base</button>
      </p>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      <h4>Commits registrados na entrega</h4>
      {commits === null ? <p aria-busy="true">Carregando…</p> : commits.length === 0 ? <p>Nenhum commit registrado em ENTREGA.md ainda.</p> : (
        <ul className="vc-lista-simples vc-missao-commits" aria-label="Commits da Missão">
          {commits.map((c) => (
            <li key={`${c.task ?? ""}:${c.commit}`}>
              {c.task !== null ? <Badge>{c.task}</Badge> : null}
              <button type="button" className="vc-mini" disabled={!c.existe} title={c.existe ? "Abrir o diff do commit" : "Commit não encontrado neste repositório"} onClick={() => void abrirCommit(c)}><code>{c.commit.slice(0, 7)}</code></button>
              <span>{c.assunto ?? (c.existe ? "" : "(commit ausente)")}</span>
            </li>
          ))}
        </ul>
      )}
      {diff !== null ? (
        <Dialogo titulo={diff.titulo} aoFechar={() => setDiff(null)} largura={960}>
          <div className="vc-dialogo-diff"><DiffView diff={diff.d} rotulo="Diff da Missão" /></div>
          <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={() => setDiff(null)}>Fechar</button></div>
        </Dialogo>
      ) : null}
    </section>
  );
}
