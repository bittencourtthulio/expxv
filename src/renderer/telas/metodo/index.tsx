import { useEffect, useId, useState } from "react";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { ListaAbas, idAba, idPainel } from "../../componentes/ListaAbas";
import { Pagina } from "../../componentes/Pagina";
import { storeMetodo, useMetodo, type StoreMetodo } from "../../estado/metodo";
import { AcoesMetodo } from "./AcoesMetodo";
import { Instalacao } from "./Instalacao";
import { Lista } from "./Lista";
import { Saude } from "./Saude";
import { Trabalho } from "./Trabalho";
import { Violacoes } from "./Violacoes";
import "./metodo.css";

type Aba = "trabalhos" | "violacoes" | "instalacao" | "saude";
const ABAS: readonly { id: Aba; rotulo: string }[] = [
  { id: "trabalhos", rotulo: "Trabalhos" }, { id: "violacoes", rotulo: "Violações" }, { id: "instalacao", rotulo: "Instalação" }, { id: "saude", rotulo: "Saúde" },
];

export default function Tela({ store = storeMetodo }: { store?: StoreMetodo }) {
  const { workspaceId, indice, carregado, erro } = useMetodo(store);
  const [aba, setAba] = useState<Aba>("trabalhos");
  const base = useId();
  const [escolhido, setEscolhido] = useState<string | null>(null);
  useEffect(() => store.iniciar(), [store]);

  const subtitulo = "Trabalhos do método Expx no projeto.";
  if (!workspaceId) {
    return (
      <Pagina titulo="Andamento" subtitulo={subtitulo}>
        <EstadoVazio icone="workspaces" titulo="Nenhum projeto aberto" texto="Abra uma pasta em Workspaces para ver os trabalhos do método." />
      </Pagina>
    );
  }
  if (!carregado) {
    return <Pagina titulo="Andamento" subtitulo={subtitulo}><p className="met-suave" role="status">Lendo o projeto…</p></Pagina>;
  }
  if (erro) {
    return <Pagina titulo="Andamento" subtitulo={subtitulo}><EstadoVazio icone="alerta" titulo="Não foi possível ler o método" texto={erro} /></Pagina>;
  }
  if (!indice) {
    return (
      <Pagina titulo="Andamento" subtitulo={subtitulo}>
        <EstadoVazio icone="metodo" titulo="Esta pasta não tem docs do método" texto="Sem a pasta docs/ não há trabalhos para mostrar. Isso é normal em um projeto novo: crie o primeiro trabalho abaixo." />
        <AcoesMetodo workspaceId={workspaceId} trabalho={null} />
      </Pagina>
    );
  }
  const trabalho = indice.trabalhos.find((t) => t.id === escolhido) ?? null;
  return (
    <Pagina titulo="Andamento" subtitulo={subtitulo}>
      <ListaAbas
        base={base} rotulo="Seções do método" className="met-abas" ativa={aba} aoMudar={setAba}
        abas={ABAS.map((a) => ({ id: a.id, rotulo: `${a.rotulo}${a.id === "violacoes" && indice.violacoes.length > 0 ? ` (${indice.violacoes.length})` : ""}` }))}
      />
      <div role="tabpanel" id={idPainel(base)} aria-labelledby={idAba(base, aba)}>
      {aba === "trabalhos" ? (
        indice.trabalhos.length === 0 ? (
          <>
            <EstadoVazio icone="metodo" titulo="Sem trabalhos ainda" texto="A pasta docs/ existe, mas nenhum trabalho foi criado. Descreva o primeiro pedido abaixo." />
            <AcoesMetodo workspaceId={workspaceId} trabalho={null} />
          </>
        ) : (
          <div className="met-grade">
            <div className="met-coluna-lista">
              <AcoesMetodo workspaceId={workspaceId} trabalho={null} />
              <Lista trabalhos={indice.trabalhos} selecionado={escolhido} aoSelecionar={setEscolhido} />
            </div>
            <div className="met-coluna-detalhe">
              {trabalho ? <Trabalho key={trabalho.id} workspaceId={workspaceId} trabalho={trabalho} /> : <p className="met-suave">Escolha um trabalho na lista para ver o plano, o quadro, o grafo e o rastro.</p>}
            </div>
          </div>
        )
      ) : null}
      {aba === "violacoes" ? <div className="met-caixa-lista"><Violacoes violacoes={indice.violacoes} /></div> : null}
      {aba === "instalacao" ? <Instalacao indice={indice} /> : null}
      {aba === "saude" ? <Saude indice={indice} /> : null}
      </div>
    </Pagina>
  );
}
