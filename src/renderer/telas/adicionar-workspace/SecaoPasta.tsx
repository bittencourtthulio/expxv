import type { Workspace } from "../../../compartilhado/dominio";
import { Icone } from "../../componentes/Icone";
import type { EstadoAdicionarUI, StoreAdicionar } from "../../estado/adicionar-workspace";

const MAX_RECENTES = 6;

/** Abrir pasta: diálogo nativo (ação primária), recentes e a varredura OPT-IN de projetos da máquina. */
export function SecaoPasta({ store, ui, recentes, atualId }: { store: StoreAdicionar; ui: EstadoAdicionarUI; recentes: readonly Workspace[]; atualId: string | null }) {
  const b = ui.busca;
  const buscando = b.fase === "buscando";
  return (
    <section className="aw-secao" aria-labelledby="aw-pasta-titulo">
      <div className="aw-cabeca">
        <h3 id="aw-pasta-titulo">Abrir pasta</h3>
        <p>Use uma pasta que já está no seu computador.</p>
      </div>

      <div className="aw-acoes">
        <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => void store.escolherPastaNativa()}>
          <Icone nome="pasta" /> Escolher pasta…
        </button>
      </div>
      {ui.erroPasta !== null ? <p role="alert" className="erro-caixa">{ui.erroPasta}</p> : null}

      <div className="aw-bloco">
        <h4 id="aw-recentes-titulo">Recentes</h4>
        {recentes.length === 0 ? (
          <div className="aw-vazio"><p>Nenhum workspace ainda. Escolha uma pasta, clone um repositório ou crie um projeto novo.</p></div>
        ) : (
          <ul className="aw-lista" aria-labelledby="aw-recentes-titulo">
            {recentes.slice(0, MAX_RECENTES).map((w) => (
              <li key={w.id}>
                <button type="button" className="aw-item" aria-current={w.id === atualId ? "true" : undefined} onClick={() => void store.abrirRecente(w.id)}>
                  <span className="aw-item-texto"><span className="aw-item-nome">{w.nome}</span><span className="aw-item-sub" title={w.raiz}>{w.raiz}</span></span>
                  {w.id === atualId ? <span className="badge" data-tom="destaque">Atual</span> : <span className="aw-item-acao">Abrir</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="aw-bloco">
        <h4 id="aw-achar-titulo">Encontrar projetos nesta máquina</h4>
        {b.fase === "ocioso" ? (
          <>
            <p className="aw-nota">Procura repositórios git e pastas de projeto nos lugares comuns (<span className="aw-mono">~/orca/projects</span>, <span className="aw-mono">~/Developer</span>, <span className="aw-mono">~/code</span>…). Só lê nomes de pasta: nada é aberto, executado nem enviado.</p>
            <div className="aw-acoes"><button type="button" className="botao" onClick={() => void store.buscarProjetos()}><Icone nome="busca" /> Procurar projetos</button></div>
          </>
        ) : (
          <>
            <div className="aw-acoes">
              {buscando ? (
                <>
                  <span className="aw-nota" aria-hidden="true">Procurando… {b.visitados} pastas verificadas · {b.itens.length} {b.itens.length === 1 ? "projeto" : "projetos"}</span>
                  <button type="button" className="botao" onClick={() => void store.cancelarBusca()}>Cancelar busca</button>
                </>
              ) : (
                <>
                  <span className="aw-nota">{b.cancelada ? "Busca cancelada. " : ""}{b.itens.length} {b.itens.length === 1 ? "projeto encontrado" : "projetos encontrados"} em {b.visitados} pastas.</span>
                  <button type="button" className="botao" onClick={() => void store.buscarProjetos()}>Procurar de novo</button>
                </>
              )}
            </div>
            <div className="aw-sr" role="status" aria-live="polite">{buscando ? "Procurando projetos…" : `Busca terminada: ${b.itens.length} ${b.itens.length === 1 ? "projeto encontrado" : "projetos encontrados"}.`}</div>
            {b.erro !== null ? <p role="alert" className="erro-caixa">{b.erro}</p> : null}
            {b.limite ? <p className="aw-nota">A busca parou no limite de 2 000 pastas para ficar leve.</p> : null}
            {b.itens.length > 0 ? (
              <ul className="aw-lista" data-rolavel aria-labelledby="aw-achar-titulo">
                {b.itens.map((a) => (
                  <li key={a.id}>
                    <button type="button" className="aw-item" disabled={ui.adicionando !== null} onClick={() => void store.adicionarAchado(a.id)} aria-label={`${a.ja_workspace ? "Abrir" : "Adicionar"} ${a.nome}, ${a.exibicao}${a.branch !== null ? `, branch ${a.branch}` : ""}`}>
                      <span className="aw-item-texto"><span className="aw-item-nome">{a.nome}</span><span className="aw-item-sub" title={a.exibicao}>{a.exibicao}</span></span>
                      {a.branch !== null ? <span className="badge" title="Branch atual"><Icone nome="ramo" /> {a.branch}</span> : a.manifesto !== null ? <span className="badge">{a.manifesto}</span> : null}
                      {a.ja_workspace ? <span className="badge" data-tom="sucesso">Já é workspace</span> : null}
                      <span className="aw-item-acao">{ui.adicionando === a.id ? "Adicionando…" : a.ja_workspace ? "Abrir" : "Adicionar"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : !buscando ? <div className="aw-vazio"><p>Nenhum projeto encontrado nos locais comuns. Use “Escolher pasta…” para apontar a pasta à mão.</p></div> : null}
          </>
        )}
      </div>
    </section>
  );
}
