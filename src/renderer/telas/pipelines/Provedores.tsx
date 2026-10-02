// Aba Provedores (T-16.35): o decisor externo (JEV/OpenRouter) e os modelos do OpenRouter já têm tela própria; aqui só apontamos (sem duplicar).
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { pedirHarness } from "../../estado/harness-acoes";
import { pedirOpenRouter } from "../../estado/openrouter-acoes";

export function Provedores() {
  return (
    <EstadoVazio icone="provedores" titulo="Decisor e modelos ficam nas telas de Harness e Provedores" texto="O decisor externo da intenção vem desligado por padrão e só funciona com chave no cofre e consentimento. Os modelos do OpenRouter só são buscados quando você clica em atualizar.">
      <div className="pl-acoes">
        <button type="button" className="botao" onClick={() => pedirHarness("decisoes")}>Decisor externo</button>
        <button type="button" className="botao" onClick={() => pedirOpenRouter("modelos")}>Modelos do OpenRouter</button>
      </div>
    </EstadoVazio>
  );
}
