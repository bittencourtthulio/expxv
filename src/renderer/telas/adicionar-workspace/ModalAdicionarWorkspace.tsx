import "./adicionar-workspace.css";
import { useState } from "react";
import type { SecaoAdicionar } from "../../../compartilhado/workspaces-adicionar";
import { Dialogo } from "../../componentes/Dialogo";
import { SubNavegacao, type ItemSubNav } from "../../componentes/SubNavegacao";
import { storeAdicionarWorkspace, useAdicionarWorkspace, type StoreAdicionar } from "../../estado/adicionar-workspace";
import { useWorkspaces, storeWorkspaces, type StoreWorkspaces } from "../../estado/workspaces";
import { SecaoClonar } from "./SecaoClonar";
import { SecaoNovo } from "./SecaoNovo";
import { SecaoPasta } from "./SecaoPasta";

const ITENS: readonly ItemSubNav<SecaoAdicionar>[] = [
  { id: "pasta", rotulo: "Abrir pasta", icone: "pasta", dica: "Escolher uma pasta do seu computador" },
  { id: "clonar", rotulo: "Clonar repositório", icone: "baixar", dica: "Baixar um repositório git (GitHub, GitLab…)" },
  { id: "novo", rotulo: "Novo projeto", icone: "mais", dica: "Criar uma pasta de projeto nova" },
];

/**
 * Modal "Adicionar workspace" (lazy): sub-navegação à esquerda com os três caminhos. Esc e fundo só fecham se não houver clone em andamento;
 * com clone, perguntam antes (cancelar o clone apaga a pasta parcial). Foco preso e devolvido pelo `Dialogo`.
 */
export default function ModalAdicionarWorkspace({ store = storeAdicionarWorkspace, workspaces = storeWorkspaces }: { store?: StoreAdicionar; workspaces?: StoreWorkspaces }) {
  const ui = useAdicionarWorkspace(store);
  const { atual, recentes } = useWorkspaces(workspaces);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const clonando = ui.clone.fase === "clonando" || ui.clone.fase === "iniciando";
  const criando = ui.criacao.fase === "criando";

  const pedirFechar = (): void => {
    if (clonando) { setConfirmandoSaida(true); return; }
    if (criando) return; // criar leva instantes: não fecha no meio
    store.fechar();
  };

  if (confirmandoSaida && clonando) {
    return (
      <Dialogo titulo="Cancelar o clone?" aoFechar={() => setConfirmandoSaida(false)}>
        <div className="dialogo-corpo">
          <p>O download está em andamento. Cancelar interrompe o clone e <strong>apaga a pasta parcial</strong> que o app criou.</p>
          <p>Para deixar o clone terminar, continue clonando.</p>
        </div>
        <div className="dialogo-acoes">
          <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => setConfirmandoSaida(false)}>Continuar clonando</button>
          <button type="button" className="botao botao-perigo" onClick={() => { setConfirmandoSaida(false); void store.cancelarClone().then(() => store.fechar()); }}>Cancelar clone e fechar</button>
        </div>
      </Dialogo>
    );
  }

  return (
    <Dialogo titulo="Adicionar workspace" aoFechar={pedirFechar} largura={940}>
      <div className="aw">
        {!ui.disponivel ? (
          <p role="alert" className="erro-caixa">Adicionar workspace só funciona no aplicativo.</p>
        ) : (
          <SubNavegacao itens={ITENS} ativo={ui.secao} onMudar={(s) => store.mudarSecao(s)} rotulo="Como adicionar o workspace" base="aw">
            {ui.secao === "pasta" ? <SecaoPasta store={store} ui={ui} recentes={recentes} atualId={atual?.id ?? null} /> : null}
            {ui.secao === "clonar" ? <SecaoClonar store={store} ui={ui} aoCancelarClone={() => void store.cancelarClone()} aoFechar={() => store.fechar()} /> : null}
            {ui.secao === "novo" ? <SecaoNovo store={store} ui={ui} aoFechar={() => store.fechar()} /> : null}
          </SubNavegacao>
        )}
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" onClick={pedirFechar}>Fechar</button>
      </div>
    </Dialogo>
  );
}
