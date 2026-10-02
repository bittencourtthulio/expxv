import "./inicio.css";
import { memo, useEffect } from "react";
import { Badge } from "../../componentes/Badge";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Pagina } from "../../componentes/Pagina";
import type { TelaId } from "../../casca/telas";
import { pedirTela } from "../../estado/navegacao";
import { storeAdicionarWorkspace } from "../../estado/adicionar-workspace";
import { storeMetodo } from "../../estado/metodo";
import { CartaoPrsInicio } from "../versionamento/CartaoPrsInicio";
import { CartaoAlertasInicio } from "../alertas/CartaoAlertasInicio";
import { storeInicio, useInicio, type ItemInicio, type PassoPrimeiroUso, type StoreInicio } from "../../estado/inicio";

const PASSOS: readonly { id: PassoPrimeiroUso; rotulo: string; destino: TelaId; acao: string }[] = [
  { id: "projeto", rotulo: "Abrir um projeto", destino: "workspaces", acao: "Abrir projeto" },
  { id: "metodo", rotulo: "Instalar o método Expx no projeto", destino: "metodo", acao: "Ver instalação" },
  { id: "missao", rotulo: "Criar a primeira Missão", destino: "missoes", acao: "Criar Missão" },
];

const Cartao = memo(function Cartao({ titulo, itens, vazio, aoAbrir }: { titulo: string; itens: ItemInicio[]; vazio: string; aoAbrir: (d: TelaId) => void }) {
  return (
    <section className="ini-cartao" aria-label={titulo}>
      <h2>{titulo}{itens.length > 0 ? <Badge tom="destaque">{itens.length}</Badge> : null}</h2>
      {itens.length === 0 ? <p className="ini-nada">{vazio}</p> : (
        <ul className="ini-lista">
          {itens.map((i) => (
            <li key={i.id}>
              <button type="button" className="ini-item" onClick={() => aoAbrir(i.destino)}>
                <span>{i.titulo}</span>
                <span className="ini-detalhe">{i.detalhe}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

export interface PropsInicio {
  store?: StoreInicio;
  /** liga as assinaturas do método enquanto a tela existe; devolve o desligar. */
  iniciar?: () => () => void;
  aoNavegar?: (id: TelaId) => void;
  /** "Abrir projeto" do primeiro uso: abre o modal "Adicionar workspace" (pasta, clonar, novo). */
  aoAdicionarWorkspace?: () => void;
}

export function TelaInicio({ store = storeInicio, iniciar = () => storeMetodo.iniciar(), aoNavegar = pedirTela, aoAdicionarWorkspace = () => storeAdicionarWorkspace.abrir("pasta") }: PropsInicio) {
  const d = useInicio(store);
  useEffect(() => iniciar(), [iniciar]);

  const subtitulo = "O que está em andamento e o que aguarda você.";
  if (d.proximoPasso !== null) {
    const idx = PASSOS.findIndex((p) => p.id === d.proximoPasso);
    const passo = PASSOS[idx]!;
    return (
      <Pagina modo="leitura" largura="larga" centralizar titulo="Hoje" subtitulo={subtitulo}>
        <EstadoVazio icone="inicio" titulo="Vamos começar" texto="Três passos e você já orquestra seus agentes.">
          <ol className="ini-passos" aria-label="Primeiros passos">
            {PASSOS.map((p, i) => (
              <li key={p.id} className="ini-passo" data-atual={i === idx || undefined} data-feito={i < idx || undefined} aria-current={i === idx ? "step" : undefined}>
                <span className="ini-passo-n" aria-hidden="true">{i < idx ? "✓" : i + 1}</span>
                {p.rotulo}
                {i < idx ? <span className="sr-somente"> (concluído)</span> : i === idx ? <span className="sr-somente"> (passo atual)</span> : null}
              </li>
            ))}
          </ol>
          <button type="button" className="botao botao-primario" onClick={() => (passo.id === "projeto" ? aoAdicionarWorkspace() : aoNavegar(passo.destino))}>{passo.acao}</button>
        </EstadoVazio>
      </Pagina>
    );
  }

  return (
    <Pagina modo="leitura" largura="larga" centralizar titulo="Hoje" subtitulo={subtitulo}>
      <div className="ini-grade" aria-busy={d.carregando || undefined}>
        <Cartao titulo="Aguardam você" itens={d.aguardando} vazio="Nada esperando por você." aoAbrir={aoNavegar} />
        <Cartao titulo="Missões ativas" itens={d.missoes} vazio="Nenhuma missão em andamento." aoAbrir={aoNavegar} />
        <Cartao titulo="Bloqueios abertos" itens={d.bloqueios} vazio={d.carregando ? "Lendo o projeto…" : "Nenhum bloqueio aberto."} aoAbrir={aoNavegar} />
        <Cartao titulo="Últimos eventos do método" itens={d.eventos} vazio={d.carregando ? "Lendo o projeto…" : "Sem atividade recente."} aoAbrir={aoNavegar} />
        <CartaoPrsInicio />
        <CartaoAlertasInicio />
      </div>
    </Pagina>
  );
}

export default function Tela() {
  return <TelaInicio />;
}
