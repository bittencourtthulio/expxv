import { useEffect, useMemo, useState } from "react";
import { comandoDeContexto } from "../../../nucleo/metodo/comandos";
import { defDoContexto, formatarDataDoContexto, linhasDoContexto, resumoDoContexto, sequenciaDoQueFalta, type ContextoId, type LinhaContexto } from "../../../nucleo/metodo/contexto";
import { PRODUTO } from "../../../nucleo/produto";
import type { IndiceProjeto } from "../../../nucleo/metodo/tipos";
import { Dialogo } from "../../componentes/Dialogo";
import { storeGeracao, useGeracao, type StoreGeracao } from "../../estado/contexto-geracao";
import { storeSuite, useSuite, type StoreSuite } from "../../estado/suite";

const CHAVE_CONFIRMACAO = `${PRODUTO.id}.metodo.gerar_contexto_confirmado`;

/** A primeira geração pede confirmação (abre um agente e gasta tokens); depois de confirmada, não pergunta de novo neste computador. */
export function jaConfirmouGeracao(): boolean {
  try { return globalThis.localStorage?.getItem(CHAVE_CONFIRMACAO) === "1"; } catch { return false; }
}
export function lembrarConfirmacaoDeGeracao(): void {
  try { globalThis.localStorage?.setItem(CHAVE_CONFIRMACAO, "1"); } catch { /* sem armazenamento: pergunta de novo da próxima vez */ }
}

const MARCA: Record<LinhaContexto["situacao"], string> = { gerado: "✓", ausente: "○", desligado: "⊘", indisponivel: "–" };

function Estado({ l }: { l: LinhaContexto }) {
  const data = formatarDataDoContexto(l.data);
  return (
    <span className="ctx-estado" data-situacao={l.situacao}>
      {l.texto}
      {l.situacao === "gerado" && data !== null ? <span className="met-suave"> · atualizado em {data}</span> : null}
    </span>
  );
}

/**
 * Bloco B da tela Instalação: o que o método GERA depois que a suíte está instalada (D-495). Cada linha diz o que é, para que serve, se já foi gerado
 * (com a data do arquivo) e oferece "Gerar agora", que digita o comando num Pane novo com a CLI padrão do projeto. "Gerar o que falta" encadeia os que
 * faltam, um por vez, esperando o arquivo aparecer. Nada é escrito por este app (D-04) e nenhuma aprovação humana é pulada (D-21).
 */
export function ContextoProjeto({ workspaceId, indice, store = storeSuite, geracao = storeGeracao }: { workspaceId: string; indice: IndiceProjeto; store?: StoreSuite; geracao?: StoreGeracao }) {
  const ui = useSuite(store);
  const g = useGeracao(geracao);
  const [confirmar, setConfirmar] = useState<readonly ContextoId[] | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => store.ligar(), [store]);
  useEffect(() => { void store.garantirEstado(workspaceId); void store.garantirModulos(workspaceId); }, [store, workspaceId]);
  const suite = ui.estados[workspaceId] ?? null;
  const mods = ui.modulos[workspaceId] ?? null;
  const linhas = useMemo(
    () => linhasDoContexto({
      camadas: indice.camadas,
      mtime: indice.camadas_mtime,
      modulos: mods === null ? null : Object.fromEntries(mods.modulos.map((m) => [m.id, m.ligado])),
      suiteInstalada: suite === null ? null : suite.estado !== "ausente" && suite.estado !== "indisponivel",
      skillsFaltando: suite?.skills_faltando ?? [],
    }),
    [indice.camadas, indice.camadas_mtime, mods, suite],
  );
  // enquanto o estado da suíte e dos módulos não chegou, nada é oferecido (evita um "Gerar agora" que logo some)
  const lendo = ui.disponivel && (mods === null || suite === null);
  const falta = useMemo(() => sequenciaDoQueFalta(linhas), [linhas]);
  const rodando = g.fase === "rodando" && g.workspaceId === workspaceId;
  const meu = g.workspaceId === workspaceId && g.fase !== "ociosa";

  const pedir = (ids: readonly ContextoId[]): void => {
    if (ids.length === 0 || rodando) return;
    if (jaConfirmouGeracao()) void geracao.iniciar(workspaceId, ids);
    else setConfirmar(ids);
  };
  const confirmado = (): void => {
    const ids = confirmar;
    setConfirmar(null);
    if (ids === null) return;
    lembrarConfirmacaoDeGeracao();
    void geracao.iniciar(workspaceId, ids);
  };
  const copiar = (l: LinhaContexto): void => {
    void navigator.clipboard?.writeText(l.comando);
    setCopiado(l.def.id);
    setTimeout(() => setCopiado((c) => (c === l.def.id ? null : c)), 2_000);
  };

  const atual = g.atual === null ? null : defDoContexto(g.atual);
  const posicao = g.atual === null ? 0 : g.fila.indexOf(g.atual) + 1;
  const feitosOuPulados = g.feitos.length + g.pulados.length;

  return (
    <section className="ctx-secao" aria-labelledby="ctx-titulo">
      <h3 id="ctx-titulo">Contexto do projeto</h3>
      <p className="met-suave">
        Documentos que o método gera a partir do seu código, depois de instalado. Não fazem parte da instalação: cada um nasce quando o comando roda.
      </p>
      <p className="ctx-resumo" data-ctx-resumo>{lendo ? "Contexto do projeto: lendo o estado da suíte…" : resumoDoContexto(linhas)}</p>

      {falta.length >= 2 && !rodando && !lendo ? (
        <div className="ctx-acoes-topo">
          <button type="button" className="botao botao-primario" onClick={() => pedir(falta)}>Gerar o que falta ({falta.length})</button>
          <span className="met-suave">Um por vez, nesta ordem: {falta.map((id) => defDoContexto(id).nome).join(" → ")}.</span>
        </div>
      ) : null}

      <div className="ctx-progresso" role="status" aria-live="polite" aria-atomic="true">
        {meu && rodando && atual !== null ? (
          <>
            <p>
              <b>Gerando {posicao} de {g.fila.length}: {atual.nome}.</b>{" "}
              {g.aguardando
                ? <>Aguardando o arquivo <code>{atual.artefato}</code>. Se o agente perguntar algo, responda no Pane.</>
                : "Abrindo o agente…"}
            </p>
            <progress className="ctx-barra" max={g.fila.length} value={feitosOuPulados} aria-label="Progresso da geração" />
          </>
        ) : null}
        {meu && g.fase === "concluida" ? <p className="met-ok">Pronto: {g.feitos.length} {g.feitos.length === 1 ? "gerado" : "gerados"}{g.pulados.length > 0 ? `, ${g.pulados.length} pulado${g.pulados.length > 1 ? "s" : ""}` : ""}.</p> : null}
        {meu && g.fase === "cancelada" ? <p>Cancelado. O agente que já abriu continua no Pane; nada mais será disparado.</p> : null}
      </div>
      {meu && g.fase === "falhou" ? <p className="met-erro" role="alert">Não foi possível gerar{atual !== null ? ` ${atual.nome}` : ""}: {g.erro}</p> : null}
      {meu && rodando ? (
        <div className="ctx-acoes-topo">
          <button type="button" className="botao" disabled={!g.aguardando} onClick={() => void geracao.pular()} title="Para de esperar este e segue para o próximo; o agente aberto continua no Pane">Pular este</button>
          <button type="button" className="botao" onClick={() => geracao.cancelar()}>Cancelar</button>
        </div>
      ) : null}
      {meu && !rodando ? <div className="ctx-acoes-topo"><button type="button" className="botao" onClick={() => geracao.fechar()}>Fechar</button></div> : null}

      <ul className="ctx-lista" aria-label="Contexto do projeto">
        {linhas.map((l) => {
          const emAndamento = rodando && g.atual === l.def.id;
          const naFila = rodando && !emAndamento && g.fila.includes(l.def.id) && !g.feitos.includes(l.def.id) && !g.pulados.includes(l.def.id) && l.situacao === "ausente";
          return (
            <li key={l.def.id} className="ctx-item" data-situacao={l.situacao} data-contexto={l.def.id}>
              <i className="ctx-marca" aria-hidden="true">{MARCA[l.situacao]}</i>
              <div className="ctx-texto">
                <span className="ctx-nome"><b>{l.def.nome}</b> <span className="met-suave">({l.def.modulo})</span></span>
                <span className="ctx-para met-suave">{l.def.paraQue}</span>
                <Estado l={l} />
                {emAndamento ? <span className="ctx-andamento">{g.aguardando ? "Gerando agora…" : "Abrindo o agente…"}</span> : null}
                {naFila ? <span className="ctx-andamento">Na fila</span> : null}
                {l.situacao === "ausente" && !emAndamento ? (
                  <span className="ctx-comando">
                    Ou rode no seu agente: <code>{l.comando}</code>
                    <button type="button" className="botao ctx-copiar" onClick={() => copiar(l)} aria-label={`Copiar o comando de ${l.def.nome}`}>{copiado === l.def.id ? "Copiado" : "Copiar"}</button>
                  </span>
                ) : null}
              </div>
              <div className="ctx-acao">
                {l.situacao === "ausente" ? (
                  <button type="button" className="botao botao-primario" disabled={rodando || lendo} aria-label={`Gerar ${l.def.nome} agora`} onClick={() => pedir([l.def.id])}>Gerar agora</button>
                ) : null}
                {l.situacao === "desligado" ? (
                  <button type="button" className="botao" aria-label={`Ligar o módulo ${l.def.modulo}`} onClick={() => void store.alternarModulo(l.def.modulo, true)}>Ligar módulo</button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {confirmar !== null ? (
        <Dialogo titulo={confirmar.length > 1 ? "Gerar o que falta?" : "Gerar agora?"} aoFechar={() => setConfirmar(null)} largura={480}>
          <p><b>Isto abre um agente e consome tokens da sua CLI.</b></p>
          <p>{confirmar.length > 1 ? "Os comandos rodam um de cada vez, cada um num Pane novo:" : "O comando roda num Pane novo:"}</p>
          <ul className="ctx-confirmar-lista">
            {confirmar.map((id) => <li key={id}><code>{comandoDeContexto(defDoContexto(id).gesto, "claude").comando}</code></li>)}
          </ul>
          <p className="met-suave">O agente pode fazer perguntas no Pane: responda lá. As permissões do Pane, a rigidez e as aprovações humanas continuam valendo; o app só digita o comando.</p>
          <div className="ctx-confirmar-acoes">
            <button type="button" className="botao" data-foco-inicial onClick={() => setConfirmar(null)}>Cancelar</button>
            <button type="button" className="botao botao-primario" onClick={confirmado}>Abrir agente e gerar</button>
          </div>
        </Dialogo>
      ) : null}
    </section>
  );
}

/** Mantém a sequência andando enquanto a tela Método está aberta, em qualquer aba: o arquivo apareceu no índice, dispara o próximo. */
export function useAvancarGeracao(workspaceId: string | null, indice: IndiceProjeto | null, geracao: StoreGeracao = storeGeracao): void {
  useEffect(() => {
    if (workspaceId === null || indice === null) return;
    void geracao.indiceMudou(workspaceId, indice.camadas);
  }, [geracao, workspaceId, indice]);
}
