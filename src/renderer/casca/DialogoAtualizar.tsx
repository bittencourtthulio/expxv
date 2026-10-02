import "./publicar.css";
import { useState, type ReactElement } from "react";
import { Dialogo } from "../componentes/Dialogo";
import { usePublicar, type StorePublicar } from "../estado/vcs-publicar";

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/**
 * "Atualizar" (pull, D-693): resumo local (commits e arquivos tocados, só NOMES), e UMA ação: `git pull --ff-only` pelo executor do VCS. Nunca merge nem rebase
 * automático; se o branch divergiu, o dono pode pedir ao agente que faça o merge (mesma entrega do Commit e push).
 */
export default function DialogoAtualizar({ store }: { store: StorePublicar }): ReactElement | null {
  const ui = usePublicar(store);
  const d = ui.atualizar;
  const p = d?.preparo ?? null;
  const [cli, setCli] = useState<string | null>(null);
  if (d === null) return null;
  const fechar = () => store.fecharAtualizar();
  const executando = d.fase === "executando";

  if (p === null) {
    return (
      <Dialogo titulo="Atualizar" aoFechar={fechar} largura={520}>
        <div className="dialogo-corpo" role="status" aria-busy={d.fase === "carregando"}>
          {d.fase === "erro" ? <p className="pub-erro" role="alert">{d.erro}</p> : <p>Buscando o que há de novo no GitHub…</p>}
        </div>
        <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={fechar}>Fechar</button></div>
      </Dialogo>
    );
  }

  const upstream = p.upstream ?? `${p.remoto}/${p.branch ?? ""}`;
  const cliEfetiva = cli ?? p.cli_foco ?? p.cli_padrao ?? "";
  const divergiu = d.fase === "divergiu" || d.fase === "ocupado" || p.divergiu;
  const recusado = d.fase === "recusado";
  const jaAtualizado = p.commits === 0;
  const bloqueado = p.operacao_em_curso || jaAtualizado || p.conflita.length > 0 || divergiu;

  return (
    <Dialogo titulo="Atualizar" aoFechar={fechar} largura={560}>
      <div className="dialogo-corpo pub-form" aria-busy={executando}>
        <section className="pub-resumo" aria-label="O que vai entrar" tabIndex={-1} data-foco-inicial>
          <p className="pub-rota">
            {jaAtualizado ? <>Já está atualizado: <code>{p.branch}</code> não está atrás de <code>{upstream}</code>.</> : <>Trazer {plural(p.commits, "commit", "commits")} de <code>{upstream}</code> para <code>{p.branch}</code><small> · {p.repo}</small></>}
          </p>
          {p.arquivos_tocados > 0 ? <p className="pub-contagem">{plural(p.arquivos_tocados, "arquivo tocado", "arquivos tocados")} (só nomes; nenhum conteúdo é lido)</p> : null}
          {p.assuntos.length > 0 ? (
            <ul className="pub-arquivos" aria-label="Commits que entram">
              {p.assuntos.map((a, i) => <li key={`${i}-${a}`}><span className="pub-situacao" aria-hidden="true">↓</span><span>{a}</span></li>)}
            </ul>
          ) : null}
          {p.arquivos.length > 0 ? (
            <ul className="pub-arquivos" aria-label="Primeiros arquivos tocados">
              {p.arquivos.map((a) => <li key={a}><code>{a}</code></li>)}
              {p.mais > 0 ? <li className="pub-e-mais">e mais {p.mais}</li> : null}
            </ul>
          ) : null}
        </section>

        {p.operacao_em_curso ? <p className="pub-erro" role="alert">Há um merge/rebase em andamento: conclua ou aborte antes de atualizar.</p> : null}
        {p.conflita.length > 0 && !divergiu ? (
          <div className="pub-sensiveis" role="alert">
            <strong>Alterações locais no caminho</strong>
            <span> — você mudou estes arquivos e o remoto também. Faça o commit (ou guarde com stash) e volte aqui:</span>
            <ul>{p.conflita.map((c) => <li key={c}><code>{c}</code></li>)}</ul>
          </div>
        ) : null}

        {divergiu ? (
          <div className="pub-ocupado" role="alert">
            <p><strong>O branch divergiu do remoto.</strong> Há {plural(p.a_frente, "commit local", "commits locais")} que o remoto não tem e {plural(p.commits, "commit", "commits")} do remoto que faltam aqui. O app nunca faz merge, rebase nem force sozinho: peça ao agente para fazer o merge.</p>
            {d.fase === "ocupado" ? (
              <>
                <p>O agente está trabalhando. Abrir um painel novo para isto?</p>
                <div className="dialogo-acoes">
                  <button type="button" className="botao" data-foco-inicial onClick={() => void store.responderOcupadoMerge(false)}>Cancelar</button>
                  <button type="button" className="botao botao-primario" onClick={() => void store.responderOcupadoMerge(true)}>Abrir painel novo</button>
                </div>
              </>
            ) : p.clis.length === 0 ? <p className="pub-erro-campo" role="alert">Nenhuma CLI de IA instalada neste computador.</p> : (
              <label className="pub-rotulo">O agente que vai fazer o merge
                <select className="pub-campo" value={cliEfetiva} onChange={(e) => setCli(e.target.value)} aria-label="Agente que vai fazer o merge">
                  {p.clis.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.id === p.cli_foco ? " — painel em foco" : c.id === p.cli_padrao ? " — padrão do workspace" : ""}</option>)}
                </select>
              </label>
            )}
          </div>
        ) : null}

        {d.erro !== null && (d.fase === "erro" || recusado || d.fase === "divergiu") ? <p className="pub-erro" role="alert">{d.erro}{d.sugerirCommitar ? " Dica: use “Commit e push” ou guarde as alterações com stash." : ""}</p> : null}

        <p className="pub-nota">Roda só <code>git pull --ff-only</code> aqui no app, sem agente: avança o branch quando dá para andar em linha reta. Nada de merge, rebase nem <code>--force</code>; com alterações locais no caminho, ele recusa e explica.</p>

        {d.fase !== "ocupado" ? (
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={fechar} disabled={executando}>Fechar</button>
            {divergiu ? (
              <button type="button" className="botao botao-primario" disabled={executando || p.clis.length === 0 || cliEfetiva === ""} onClick={() => void store.pedirMerge(cliEfetiva)}>{executando ? "Enviando…" : "Pedir ao agente para fazer o merge"}</button>
            ) : (
              <button type="button" className="botao botao-primario" disabled={executando || bloqueado} onClick={() => void store.confirmarAtualizar()}>{executando ? "Atualizando…" : `Trazer ${plural(p.commits, "commit", "commits")}`}</button>
            )}
          </div>
        ) : null}
      </div>
    </Dialogo>
  );
}
