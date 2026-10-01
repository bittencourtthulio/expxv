import "./workspaces.css";
import { useState } from "react";
import type { Permissao, Workspace } from "../../../compartilhado/dominio";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Pagina } from "../../componentes/Pagina";
import { storeWorkspaces, useWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { Cartao } from "./Cartao";
import { AVISO_AUTOMATICO } from "./textos";

type Pendente = { tipo: "remover"; ws: Workspace } | { tipo: "automatico"; ws: Workspace };

export function TelaWorkspaces({ store = storeWorkspaces }: { store?: StoreWorkspaces }) {
  const { atual, recentes, carregado, erro } = useWorkspaces(store);
  const [pendente, setPendente] = useState<Pendente | null>(null);

  const confirmar = async () => {
    const p = pendente;
    setPendente(null);
    if (p === null) return;
    if (p.tipo === "remover") await store.remover(p.ws.id);
    else await store.definirPermissao(p.ws.id, "automatico");
  };
  const mudarPermissao = (ws: Workspace, permissao: Permissao) => {
    if (permissao === "automatico") setPendente({ tipo: "automatico", ws });
    else void store.definirPermissao(ws.id, permissao);
  };

  return (
    <Pagina titulo="Projetos" subtitulo="Pastas de trabalho, worktrees e permissão das CLIs.">
      <div className="barra-acoes">
        <button type="button" className="botao botao-primario" onClick={() => void store.abrir(null)}>Abrir pasta…</button>
      </div>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      {!carregado ? <div aria-busy="true" /> : recentes.length === 0 ? (
        <EstadoVazio icone="workspaces" titulo="Nenhum workspace aberto" texto="Comece escolhendo a pasta do seu projeto.">
          <ol className="ws-passos">
            <li>Clique em <strong>Abrir pasta…</strong> e escolha a pasta do projeto.</li>
            <li>Confira a permissão das CLIs (o padrão é seguro).</li>
            <li>Abra um terminal ou crie uma missão neste workspace.</li>
          </ol>
          <button type="button" className="botao botao-primario" onClick={() => void store.abrir(null)}>Abrir pasta…</button>
        </EstadoVazio>
      ) : (
        <ul className="ws-lista" aria-label="Workspaces recentes">
          {recentes.map((ws) => (
            <Cartao
              key={ws.id}
              ws={ws}
              atual={ws.id === atual?.id}
              aoUsar={() => void store.definirAtual(ws.id)}
              aoRemover={() => setPendente({ tipo: "remover", ws })}
              aoPermissao={(p) => mudarPermissao(ws, p)}
              carregarWorktrees={() => store.worktrees(ws.id)}
            />
          ))}
        </ul>
      )}
      {pendente?.tipo === "remover" ? (
        <DialogoConfirmacao
          titulo="Remover da lista?"
          rotuloConfirmar="Remover da lista"
          perigoso
          aoCancelar={() => setPendente(null)}
          aoConfirmar={() => void confirmar()}
          texto={<><p>“{pendente.ws.nome}” sai da lista de workspaces do app.</p><p><strong>Nada é apagado do disco:</strong> a pasta {pendente.ws.raiz} continua onde está.</p><p>O histórico de Missões é mantido: ao abrir esta pasta de novo, o workspace e o histórico voltam.</p></>}
        />
      ) : null}
      {pendente?.tipo === "automatico" ? (
        <DialogoConfirmacao
          titulo="Ativar o modo automático?"
          rotuloConfirmar="Ativar automático"
          perigoso
          aoCancelar={() => setPendente(null)}
          aoConfirmar={() => void confirmar()}
          texto={<p>{AVISO_AUTOMATICO}</p>}
        />
      ) : null}
    </Pagina>
  );
}

export default function Tela() {
  return <TelaWorkspaces />;
}
