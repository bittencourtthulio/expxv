// Seção "Skills do produto" (T-07.31): as skills embarcadas chegam a cada Pane sem copiar nada para a casa do usuário; instalar na CLI
// é opcional, grava só no escopo global da CLI e pede confirmação. Atualizar preserva o que a pessoa editou. "Não instalar" é persistente.
import { useEffect, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { CliCatalogo, EstadoEmbarcada } from "../../../compartilhado/catalogo";
import { Dialogo } from "../../componentes/Dialogo";
import { mensagemDoErro, rotuloCli } from "./logica";

type Api = ApiAde["catalogo"];

export const TEXTO_EMBARCADAS = "Em Missões, o app entrega essas skills a cada Pane sem copiar nada para a sua casa; instalar aqui é opcional.";

export function DialogoEmbarcadas({ api, aoFechar, aoMudar }: { api: Api; aoFechar: () => void; aoMudar: () => void }) {
  const [lista, setLista] = useState<readonly EstadoEmbarcada[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pendente, setPendente] = useState<{ nome: string | null; cli: CliCatalogo } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = async () => { try { setLista(await api.embarcadasEstado()); setErro(null); } catch (e) { setErro(mensagemDoErro(e)); } };
  useEffect(() => { void carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const executar = async (f: () => Promise<void>) => {
    setOcupado(true); setMsg(null);
    try { await f(); await carregar(); aoMudar(); } catch (e) { setErro(mensagemDoErro(e)); } finally { setOcupado(false); }
  };
  const instalar = (nome: string | null, cli: CliCatalogo) => executar(async () => {
    const r = await api.embarcadasInstalar(nome, cli);
    setMsg(`${r.instaladas.length} instalada(s) em ${rotuloCli(cli)}.${r.preservadas_editadas.length > 0 ? ` Preservadas por terem sido editadas: ${r.preservadas_editadas.join(", ")}.` : ""}`);
  });
  const optOut = (nome: string, cli: CliCatalogo, valor: boolean) => executar(async () => { await api.embarcadasOptOut(nome, cli, valor); });

  return (
    <Dialogo titulo="Skills do produto" aoFechar={aoFechar} largura={680}>
      <p className="cat-nota">{TEXTO_EMBARCADAS}</p>
      {erro !== null ? <p role="alert" className="cat-aviso" data-tom="erro">{erro}</p> : null}
      {lista === null && erro === null ? <p role="status" aria-busy="true">Carregando…</p> : null}
      {lista !== null && lista.length === 0 ? <p className="cat-nota">Nenhuma skill do produto neste pacote.</p> : null}
      <ul className="cat-emb">
        {(lista ?? []).map((s) => (
          <li key={s.nome}>
            <div><strong>{s.nome}</strong> <span className="cat-nota">v{s.versao_pacote}</span></div>
            <div className="cat-nota">{s.descricao}</div>
            <div className="cat-emb-clis">
              {s.clis.map((c) => (
                <span key={c.cli} className="cat-emb-cli">
                  <span>{rotuloCli(c.cli)}: {c.opt_out ? "não instalar" : c.instalada ? `instalada${c.versao !== null ? ` v${c.versao}` : ""}${c.editada ? " (editada)" : ""}` : "não instalada"}</span>
                  <button type="button" className="botao cat-mini" disabled={ocupado || c.opt_out} title={c.opt_out ? `Desligada para ${rotuloCli(c.cli)}: permita de novo para instalar` : ocupado ? "Aguardando outra ação terminar…" : c.instalada ? `Atualizar em ${rotuloCli(c.cli)} preservando o que você editou` : `Instalar em ${rotuloCli(c.cli)} (escopo global da CLI)`} onClick={() => (c.instalada ? void instalar(s.nome, c.cli) : setPendente({ nome: s.nome, cli: c.cli }))}>{c.instalada ? "Atualizar" : `Instalar em ${rotuloCli(c.cli)}`}</button>
                  <button type="button" className="botao cat-mini" aria-pressed={c.opt_out} disabled={ocupado} title={ocupado ? "Aguardando outra ação terminar…" : c.opt_out ? `Permitir de novo a instalação em ${rotuloCli(c.cli)}` : `Não instalar em ${rotuloCli(c.cli)} (as Missões continuam recebendo sem instalar)`} onClick={() => void optOut(s.nome, c.cli, !c.opt_out)}>{c.opt_out ? "Permitir de novo" : "Não instalar"}</button>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {msg !== null ? <p role="status" className="cat-aviso" data-tom="ok">{msg}</p> : null}
      {pendente !== null ? (
        <div className="cat-confirma" role="alertdialog" aria-label="Confirmar instalação" >
          <p>Isto grava na pasta <strong>global</strong> da CLI {rotuloCli(pendente.cli)} (escopo do usuário), {pendente.nome === null ? "todas as skills do produto" : `a skill ${pendente.nome}`}. Nada vai para o seu repositório. Confirmar?</p>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setPendente(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => { const p = pendente; setPendente(null); void instalar(p.nome, p.cli); }}>Confirmar e instalar</button>
          </div>
        </div>
      ) : null}
      <div className="dialogo-acoes"><button type="button" className="botao" onClick={aoFechar}>Fechar</button></div>
    </Dialogo>
  );
}
