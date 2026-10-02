// Gaveta de detalhe (T-07.29/T-07.30): painel lateral de 320 px que COBRE a tabela (não empurra). Ações: instalar por symlink/cópia
// (`ja_instalado` é estado, não erro), remover só o que o app criou ou mover para a lixeira (diálogo da UI, nunca `window.confirm`),
// remover do catálogo, revelar, verificar ferramentas de MCP (diálogo de confirmação). Descrição de terceiro = TEXTO (React escapa).
import { useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { CliCatalogo, DetalheCatalogo, InstalacaoCatalogo, ItemCatalogo, ResultadoVerificarMcp } from "../../../compartilhado/catalogo";
import { Dialogo } from "../../componentes/Dialogo";
import { Icone } from "../../componentes/Icone";
import { clisSemItem, fonteDoItem, hashCurto, itemTemPresente, mensagemDoCodigo, mensagemDoErro, motivoInstalar, motivoSomenteLeitura, ROTULO_ORIGEM, rotuloCli } from "./logica";

type Api = ApiAde["catalogo"];

interface Props {
  api: Api;
  item: ItemCatalogo;
  detalhe: DetalheCatalogo | null;
  somenteLeituraTipo: boolean;
  aoFechar: () => void;
  /** depois de uma ação que mudou o disco/catálogo: o main emite `mudou`, mas a tela relê o tipo atual. */
  aoMudar: () => void;
  aoRemovidoDoCatalogo: (id: string) => void;
}

type Confirmar =
  | { tipo: "lixeira"; inst: InstalacaoCatalogo }
  | { tipo: "verificar" }
  | { tipo: "remover_catalogo" };

const rotuloEscopo = (i: InstalacaoCatalogo): string => (i.escopo === "global" ? "global" : "projeto");

export function Gaveta({ api, item, detalhe, somenteLeituraTipo, aoFechar, aoMudar, aoRemovidoDoCatalogo }: Props) {
  const [aviso, setAviso] = useState<{ texto: string; tom: "ok" | "erro" } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<Confirmar | null>(null);
  const [verificacao, setVerificacao] = useState<ResultadoVerificarMcp | null>(null);

  const fonte = fonteDoItem(item);
  const motivo = motivoSomenteLeitura(item);
  const motivoInst = motivoInstalar(item);
  const alvos = clisSemItem(item);
  const desc = detalhe?.descricao ?? item.descricao;
  const ferramentas = detalhe?.ferramentas ?? [];
  const semPresente = !itemTemPresente(item);

  async function correr(f: () => Promise<void>): Promise<void> {
    setOcupado(true); setAviso(null);
    try { await f(); } catch (e) { setAviso({ texto: mensagemDoErro(e), tom: "erro" }); } finally { setOcupado(false); }
  }

  const instalar = (para: CliCatalogo, modo: "symlink" | "copia") => correr(async () => {
    if (fonte === null) { setAviso({ texto: "Nenhuma CLI com este item presente para servir de fonte.", tom: "erro" }); return; }
    const r = await api.instalar({ item_id: item.id, de_cli: fonte, para_cli: para, modo });
    if (r.estado === "instalado") { setAviso({ texto: `Instalado em ${rotuloCli(para)}.`, tom: "ok" }); aoMudar(); }
    else if (r.estado === "ja_instalado") setAviso({ texto: `Já instalado em ${rotuloCli(para)}.`, tom: "ok" });
    else setAviso({ texto: mensagemDoCodigo(r.codigo ?? r.estado), tom: "erro" });
  });

  const desinstalar = (inst: InstalacaoCatalogo, modo: "remover_criado" | "lixeira") => correr(async () => {
    const r = await api.desinstalar({ item_id: item.id, cli: inst.cli, escopo: inst.escopo, workspace_id: inst.workspace_id, modo });
    if (r.ok) { setAviso({ texto: modo === "lixeira" ? "Movido para a lixeira." : "Removido.", tom: "ok" }); aoMudar(); }
    else setAviso({ texto: mensagemDoCodigo(r.codigo), tom: "erro" });
  });

  const revelar = (inst: InstalacaoCatalogo) => correr(async () => {
    const ok = await api.revelar({ item_id: item.id, cli: inst.cli, escopo: inst.escopo, workspace_id: inst.workspace_id });
    if (!ok) setAviso({ texto: "Não foi possível mostrar o arquivo no gerenciador.", tom: "erro" });
  });

  const verificar = () => correr(async () => {
    setConfirmar(null);
    const r = await api.verificarMcp(item.id, true);
    setVerificacao(r);
    aoMudar();
  });

  const removerCatalogo = () => correr(async () => {
    setConfirmar(null);
    const r = await api.removerDoCatalogo(item.id);
    if (r.ok) aoRemovidoDoCatalogo(item.id); else setAviso({ texto: "Só dá para remover do catálogo itens sem instalação presente.", tom: "erro" });
  });

  const mcpRedigido = item.instalacoes[0]?.detalhe;

  return (
    <aside className="cat-gaveta" role="complementary" aria-label={`Detalhes de ${item.nome}`}>
      <header className="cat-gaveta-cab">
        <h2 title={item.nome}>{item.nome}</h2>
        <button type="button" className="cat-icone" aria-label="Fechar detalhes" title="Fechar" onClick={aoFechar}><Icone nome="fechar" /></button>
      </header>
      <div className="cat-gaveta-corpo">
        <p className="cat-selos">
          <span className="cat-selo" data-origem={item.origem}>{ROTULO_ORIGEM[item.origem]}</span>
          {item.plugin !== null ? <span className="cat-selo">plugin {item.plugin}</span> : null}
          {item.autor !== null ? <span className="cat-selo">autor {item.autor}</span> : null}
          {item.variantes > 1 ? <span className="cat-selo" data-tom="aviso">variantes {item.variantes}</span> : null}
        </p>
        {desc !== null && desc !== "" ? <p className="cat-desc" data-testid="descricao">{desc}</p> : <p className="cat-nota">Sem descrição: isso atrapalha a escolha pelo agente.</p>}

        <h3>Instalações</h3>
        {item.instalacoes.length === 0 ? <p className="cat-nota">Nenhuma instalação conhecida.</p> : (
          <ul className="cat-inst">
            {item.instalacoes.map((i) => {
              const k = `${i.cli}:${i.escopo}:${i.workspace_id ?? ""}`;
              const podeRemover = motivo === null && !somenteLeituraTipo && i.estado !== "ausente";
              return (
                <li key={k}>
                  <div><strong>{rotuloCli(i.cli)}</strong> · {rotuloEscopo(i)} · <span data-estado={i.estado}>{i.estado}</span>{!i.habilitada ? " · desabilitada" : ""}</div>
                  <div className="cat-caminho" title={i.caminho_rel}>{i.base === "home" ? "~/" : "./"}{i.caminho_rel} <span className="cat-nota">({i.metodo}{i.criado_pelo_app ? ", criado pelo app" : ""}, {hashCurto(i.hash_conteudo)})</span></div>
                  <div className="cat-inst-acoes">
                    <button type="button" className="botao cat-mini" disabled={ocupado} onClick={() => void revelar(i)}>Revelar</button>
                    {podeRemover && i.criado_pelo_app ? <button type="button" className="botao cat-mini" disabled={ocupado} onClick={() => void desinstalar(i, "remover_criado")}>Remover de {rotuloCli(i.cli)}</button> : null}
                    {podeRemover && !i.criado_pelo_app ? <button type="button" className="botao cat-mini" disabled={ocupado} onClick={() => setConfirmar({ tipo: "lixeira", inst: i })}>Mover para a lixeira</button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {motivo !== null ? <p className="cat-nota" role="note">{motivo}</p> : null}

        {item.tipo === "mcp_server" ? (
          <>
            <h3>Ferramentas</h3>
            {ferramentas.length === 0 ? <p className="cat-nota">Não verificadas. A verificação executa o servidor MCP nesta máquina por até 5 s.</p> : (
              <ul className="cat-ferramentas">{ferramentas.map((f) => <li key={f.nome}><code>{f.nome}</code>{f.descricao !== null ? <span className="cat-nota"> {f.descricao}</span> : null}</li>)}</ul>
            )}
            {verificacao !== null ? <p className="cat-nota" role="status">{verificacao.estado === "ok" ? `Verificado: ${verificacao.ferramentas} ferramentas.` : `Indisponível: ${verificacao.erro ?? "sem resposta"}.`}</p> : null}
            <div className="cat-acoes"><button type="button" className="botao cat-mini" disabled={ocupado} onClick={() => setConfirmar({ tipo: "verificar" })}>Verificar ferramentas</button></div>
          </>
        ) : null}

        {(item.tipo === "skill" || item.tipo === "agent" || item.tipo === "command") ? (
          <>
            <h3>Instalar em outra CLI</h3>
            {motivoInst !== null ? <p className="cat-nota">{motivoInst}</p> : alvos.length === 0 ? <p className="cat-nota">Já presente em todas as CLIs.</p> : (
              <div className="cat-acoes">
                {alvos.map((c) => (
                  <span key={c} className="cat-par">
                    <button type="button" className="botao cat-mini" disabled={ocupado || fonte === null} title="Cria um link simbólico na pasta global da CLI (reversível)" onClick={() => void instalar(c, "symlink")}>Instalar em {rotuloCli(c)}</button>
                    <button type="button" className="botao cat-mini" disabled={ocupado || fonte === null} title="Copia o conteúdo (não acompanha mudanças da fonte)" aria-label={`Copiar para ${rotuloCli(c)}`} onClick={() => void instalar(c, "copia")}>cópia</button>
                  </span>
                ))}
              </div>
            )}
            <p className="cat-nota">Grava só na pasta global da CLI, só por esta ação; nada é gravado no seu repositório.</p>
          </>
        ) : null}

        {semPresente && motivo === null ? (
          <div className="cat-acoes"><button type="button" className="botao cat-mini" disabled={ocupado} onClick={() => setConfirmar({ tipo: "remover_catalogo" })}>Remover do catálogo</button></div>
        ) : null}
        {aviso !== null ? <p role={aviso.tom === "erro" ? "alert" : "status"} className="cat-aviso" data-tom={aviso.tom}>{aviso.texto}</p> : null}
      </div>

      {confirmar?.tipo === "lixeira" ? (
        <Dialogo titulo={`Mover ${item.nome} para a lixeira?`} aoFechar={() => setConfirmar(null)}>
          <p>O item não foi criado pelo app. Ele vai para a lixeira do sistema (dá para restaurar) na pasta da CLI {rotuloCli(confirmar.inst.cli)}.</p>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setConfirmar(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => { const i = confirmar.inst; setConfirmar(null); void desinstalar(i, "lixeira"); }}>Mover para a lixeira</button>
          </div>
        </Dialogo>
      ) : null}
      {confirmar?.tipo === "verificar" ? (
        <Dialogo titulo={`Verificar ferramentas de ${item.nome}?`} aoFechar={() => setConfirmar(null)}>
          <p>Isto <strong>executa o servidor MCP</strong> nesta máquina, por até 5 segundos, só para listar as ferramentas dele. Os segredos dele são lidos na hora e não são guardados.</p>
          {mcpRedigido !== undefined ? (
            <ul className="cat-nota">
              {typeof mcpRedigido["transporte"] === "string" ? <li>Transporte: {mcpRedigido["transporte"]}</li> : null}
              {typeof mcpRedigido["executavel_base"] === "string" ? <li>Executável: {mcpRedigido["executavel_base"]}</li> : null}
              {typeof mcpRedigido["origem_url"] === "string" ? <li>Origem: {mcpRedigido["origem_url"]}</li> : null}
            </ul>
          ) : null}
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setConfirmar(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => void verificar()}>Executar e verificar</button>
          </div>
        </Dialogo>
      ) : null}
      {confirmar?.tipo === "remover_catalogo" ? (
        <Dialogo titulo={`Remover ${item.nome} do catálogo?`} aoFechar={() => setConfirmar(null)}>
          <p>Só some da lista do app; nenhum arquivo é apagado. Ele volta se for encontrado numa próxima varredura.</p>
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={() => setConfirmar(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" data-foco-inicial onClick={() => void removerCatalogo()}>Remover do catálogo</button>
          </div>
        </Dialogo>
      ) : null}
    </aside>
  );
}
