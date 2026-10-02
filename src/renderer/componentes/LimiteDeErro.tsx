import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Nome da tela, só para a mensagem ("A tela Mapa falhou"). */
  nome: string;
  children: ReactNode;
}
interface Estado {
  erro: Error | null;
}

/**
 * Isola uma tela: se ela falhar ao renderizar, só ela mostra o aviso; o menu, o cabeçalho e as outras telas
 * continuam funcionando (sem isto, um erro derruba o app inteiro em branco). A mensagem técnica fica atrás de
 * "Detalhes" e nunca é enviada a lugar nenhum.
 */
export class LimiteDeErro extends Component<Props, Estado> {
  override state: Estado = { erro: null };

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo): void {
    // só registro local de diagnóstico (sem rede, sem telemetria)
    console.error(`[tela:${this.props.nome}]`, erro.message, info.componentStack ?? "");
  }

  private readonly tentarDeNovo = (): void => { this.setState({ erro: null }); };

  override render(): ReactNode {
    const { erro } = this.state;
    if (erro === null) return this.props.children;
    return (
      <div className="tela-erro" role="alert">
        <h2>A tela {this.props.nome} não abriu</h2>
        <p>Algo falhou ao mostrar esta tela. As outras telas continuam funcionando. Tente abrir de novo; se repetir, copie os detalhes abaixo ao pedir ajuda.</p>
        <div className="tela-erro-acoes">
          <button type="button" className="botao botao-primario" onClick={this.tentarDeNovo}>Tentar de novo</button>
        </div>
        <details>
          <summary>Detalhes</summary>
          <pre>{erro.message}</pre>
        </details>
      </div>
    );
  }
}
