import "./publicar.css";
import { useMemo, useState, type ReactElement } from "react";
import type { ArquivoPublicacao, OpcoesPublicacao, PreparoPublicacao } from "../../compartilhado/vcs-publicar";
import { LIMITES_PUBLICAR } from "../../compartilhado/vcs-publicar";
import { frasePushNoPadrao, validarNomeRamo } from "../../nucleo/vcs/publicar/ramo";
import { textoSuite } from "../../nucleo/vcs/publicar/visibilidade";
import { Dialogo } from "../componentes/Dialogo";
import { usePublicar, type StorePublicar } from "../estado/vcs-publicar";

const SITUACAO: Record<ArquivoPublicacao["situacao"], { letra: string; nome: string }> = {
  modificado: { letra: "M", nome: "modificado" },
  novo: { letra: "N", nome: "novo" },
  removido: { letra: "D", nome: "removido" },
  renomeado: { letra: "R", nome: "renomeado" },
  conflito: { letra: "!", nome: "em conflito" },
};
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function Resumo({ p, destino }: { p: PreparoPublicacao; destino: string }): ReactElement {
  return (
    <section className="pub-resumo" aria-label="Resumo do que será enviado" tabIndex={-1} data-foco-inicial>
      <p className="pub-rota" aria-label={`De ${p.branch ?? "HEAD destacado"} para ${p.remoto}/${destino}`}>
        <code>{p.branch ?? "(HEAD destacado)"}</code>
        <span aria-hidden="true"> → </span>
        <code>{p.remoto}/{destino}</code>
        <small> · {p.repo}</small>
      </p>
      <p className="pub-contagem">
        {p.total_arquivos === 0 && p.novos === 0 ? "Nenhum arquivo alterado" : p.total_arquivos === 0 ? null : `${p.total_arquivos} ${p.total_arquivos === 1 ? "arquivo alterado" : "arquivos alterados"}`}
        {p.novos > 0 ? <>{p.total_arquivos > 0 ? " · " : null}{p.novos} {p.novos === 1 ? "pasta/arquivo novo" : "pastas/arquivos novos"}</> : null}
        {p.total_arquivos > 0 ? <> · <span className="pub-mais-linhas">+{p.adicionadas}</span> <span className="pub-menos-linhas">−{p.removidas}</span></> : null}
        {p.a_frente > 0 ? <> · {p.a_frente} {p.a_frente === 1 ? "commit local ainda não enviado" : "commits locais ainda não enviados"}</> : null}
      </p>
      {p.arquivos.length > 0 ? (
        <ul className="pub-arquivos" aria-label="Primeiros arquivos (só nomes)">
          {p.arquivos.map((a) => (
            <li key={a.caminho}><span className="pub-situacao" title={SITUACAO[a.situacao].nome} aria-label={SITUACAO[a.situacao].nome}>{SITUACAO[a.situacao].letra}</span><code>{a.caminho}</code></li>
          ))}
          {p.mais > 0 ? <li className="pub-e-mais">e mais {p.mais}</li> : null}
        </ul>
      ) : null}
      {p.sensiveis.length > 0 ? (
        <div className="pub-sensiveis" role="alert">
          <strong>Não vou incluir estes arquivos</strong>
          <span> (ambiente, chaves ou credenciais): a instrução ao agente proíbe commitá-los.</span>
          <ul>{p.sensiveis.map((s) => <li key={s}><code>{s}</code></li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}

/** Pastas da suíte ExpxDev não rastreadas (escritas pelo `expxdev init` e pelo app): fora da contagem; o dono escolhe, por clique (D-692). */
function SecaoSuite({ p, incluir, aoIncluir, aoIgnorar, ocupado }: { p: PreparoPublicacao; incluir: boolean; aoIncluir: (v: boolean) => void; aoIgnorar: () => void; ocupado: boolean }): ReactElement | null {
  if (p.suite.itens === 0) return null;
  return (
    <section className="pub-suite" aria-label="Pastas da suíte ExpxDev">
      <p className="pub-suite-titulo"><strong>{textoSuite(p.suite.itens)}</strong><span> · fora da contagem e do commit</span></p>
      <ul className="pub-suite-lista">{p.suite.caminhos.map((c) => <li key={c}><code>{c}</code></li>)}{p.suite.itens > p.suite.caminhos.length ? <li className="pub-e-mais">e mais {p.suite.itens - p.suite.caminhos.length}</li> : null}</ul>
      <p className="pub-nota">Foram escritas pela instalação da suíte ExpxDev e pelo app. <strong>Ignorar neste computador</strong> acrescenta estas linhas em <code>.git/info/exclude</code> do repositório: um arquivo local que nunca vai ao remoto (o <code>.gitignore</code> não é tocado).</p>
      <div className="pub-suite-acoes">
        <button type="button" className="botao" disabled={ocupado} onClick={aoIgnorar}>Ignorar neste computador</button>
        {p.suite.incluiveis > 0 ? <label className="pub-opcao"><input type="checkbox" checked={incluir} onChange={(e) => aoIncluir(e.target.checked)} /> Incluir no commit<small> · padrão desmarcado</small></label> : null}
      </div>
    </section>
  );
}

function TextoOuAgente({ rotulo, modo, texto, aoModo, aoTexto, max, multilinha = false, vazioInvalido }: { rotulo: string; modo: "agente" | "manual"; texto: string; aoModo: (m: "agente" | "manual") => void; aoTexto: (t: string) => void; max: number; multilinha?: boolean; vazioInvalido: boolean }): ReactElement {
  return (
    <fieldset className="pub-grupo">
      <legend>{rotulo}</legend>
      <div className="pub-radios">
        <label className="pub-opcao"><input type="radio" name={rotulo} checked={modo === "agente"} onChange={() => aoModo("agente")} /> Deixar o agente escrever <small>(recomendado)</small></label>
        <label className="pub-opcao"><input type="radio" name={rotulo} checked={modo === "manual"} onChange={() => aoModo("manual")} /> Escrever eu mesmo</label>
      </div>
      {modo === "manual" ? (
        multilinha
          ? <textarea className="pub-campo" aria-label={rotulo} aria-invalid={vazioInvalido || undefined} maxLength={max} rows={4} value={texto} onChange={(e) => aoTexto(e.target.value)} />
          : <input className="pub-campo" aria-label={rotulo} aria-invalid={vazioInvalido || undefined} maxLength={max} value={texto} onChange={(e) => aoTexto(e.target.value)} />
      ) : null}
    </fieldset>
  );
}

/** Diálogo calmo e curto: resumo calculado localmente (só nomes), opções, o agente que executa e UMA ação primária. Nada é executado aqui. */
export default function DialogoPublicar({ store }: { store: StorePublicar }): ReactElement | null {
  const ui = usePublicar(store);
  const d = ui.dialogo;
  const p = d?.preparo ?? null;
  const pr = d?.tipo === "pr";

  const [criarRamo, setCriarRamo] = useState<boolean | null>(null);
  const [nomeRamo, setNomeRamo] = useState<string | null>(null);
  const [naoRastreados, setNaoRastreados] = useState(true);
  const [incluirSuite, setIncluirSuite] = useState(false);
  const [msgModo, setMsgModo] = useState<"agente" | "manual">("agente");
  const [msg, setMsg] = useState("");
  const [tituloModo, setTituloModo] = useState<"agente" | "manual">("agente");
  const [titulo, setTitulo] = useState("");
  const [descModo, setDescModo] = useState<"agente" | "manual">("agente");
  const [desc, setDesc] = useState("");
  const [rascunho, setRascunho] = useState(false);
  const [base, setBase] = useState<string | null>(null);
  const [revisores, setRevisores] = useState("");
  const [cli, setCli] = useState<string | null>(null);
  const [frase, setFrase] = useState("");

  const criar = pr ? false : (criarRamo ?? (p?.no_padrao ?? false));
  const nome = nomeRamo ?? p?.sugestao_ramo ?? "";
  const baseEfetiva = base ?? p?.ramo_padrao ?? "";
  const cliEfetiva = cli ?? p?.cli_foco ?? p?.cli_padrao ?? "";

  const problemas = useMemo(() => {
    const e: Record<string, string> = {};
    if (criar) { const v = validarNomeRamo(nome); if (!v.ok) e["ramo"] = v.motivo; else if (p !== null && (nome === p.ramo_padrao || ["main", "master", "develop"].includes(nome))) e["ramo"] = "Escolha um nome diferente do branch padrão."; }
    if (msgModo === "manual" && msg.trim() === "") e["msg"] = "Escreva a mensagem.";
    if (pr) {
      if (tituloModo === "manual" && titulo.trim() === "") e["titulo"] = "Escreva o título.";
      if (descModo === "manual" && desc.trim() === "") e["desc"] = "Escreva a descrição.";
      if (!validarNomeRamo(baseEfetiva).ok) e["base"] = "Base inválida.";
      const lista = revisores.split(/[,\s]+/).filter((x) => x !== "");
      if (lista.length > LIMITES_PUBLICAR.revisores || lista.some((x) => !LOGIN.test(x))) e["revisores"] = "Use logins do GitHub separados por vírgula (sem @).";
    }
    if (cliEfetiva === "") e["cli"] = "Nenhuma CLI de IA instalada.";
    if (!pr && p !== null && p.total_arquivos + p.novos === 0 && p.a_frente === 0 && !(incluirSuite && p.suite.incluiveis > 0)) e["nada"] = "Nada para commitar: marque “Incluir no commit” ou ignore as pastas da suíte.";
    return e;
  }, [incluirSuite, criar, nome, p, msgModo, msg, pr, tituloModo, titulo, descModo, desc, baseEfetiva, revisores, cliEfetiva]);

  if (d === null) return null;
  const fechar = () => store.fechar();

  if (d.fase === "carregando" || p === null) {
    return (
      <Dialogo titulo={pr ? "Enviar PR" : "Commit e push"} aoFechar={fechar} largura={560}>
        <div className="dialogo-corpo" role="status" aria-busy={d.fase === "carregando"}>
          {d.fase === "erro" ? <p className="pub-erro" role="alert">{d.erro}</p> : <p>Calculando o resumo local…</p>}
        </div>
        <div className="dialogo-acoes"><button type="button" className="botao" data-foco-inicial onClick={fechar}>Fechar</button></div>
      </Dialogo>
    );
  }

  const opcoes = (): OpcoesPublicacao => ({
    criar_ramo: criar,
    nome_ramo: criar ? nome.trim() : null,
    incluir_nao_rastreados: naoRastreados,
    incluir_suite: !pr && incluirSuite && p.suite.incluiveis > 0,
    mensagem: { modo: msgModo, texto: msgModo === "manual" ? msg.trim() : null },
    pr: pr ? { titulo: { modo: tituloModo, texto: tituloModo === "manual" ? titulo.trim() : null }, descricao: { modo: descModo, texto: descModo === "manual" ? desc.trim() : null }, rascunho, base: baseEfetiva === p.ramo_padrao ? null : baseEfetiva, revisores: revisores.split(/[,\s]+/).filter((x) => x !== "") } : null,
    confirmar_padrao: null,
  });

  // ---- confirmação digitada, em diálogo à parte (D-36): nunca commit/push direto no branch padrão sem ela
  if (d.fase === "confirmar_padrao") {
    const exata = frasePushNoPadrao(p.branch ?? p.ramo_padrao);
    return (
      <Dialogo titulo={`Enviar direto para ${p.branch ?? p.ramo_padrao}?`} aoFechar={() => { setFrase(""); store.cancelarConfirmacao(); }} largura={520}>
        <div className="dialogo-corpo">
          <p>Você está no branch padrão. Commit e push direto nele contornam a revisão e afetam todo o time. O recomendado é criar um branch novo.</p>
          <label className="pub-rotulo">Para confirmar, digite <code>{exata}</code>
            <input className="pub-campo" data-foco-inicial value={frase} onChange={(e) => setFrase(e.target.value)} autoComplete="off" spellCheck={false} aria-label={`Digite ${exata} para confirmar`} />
          </label>
        </div>
        <div className="dialogo-acoes">
          <button type="button" className="botao" onClick={() => { setFrase(""); store.cancelarConfirmacao(); }}>Voltar e criar um branch</button>
          <button type="button" className="botao botao-perigo" disabled={frase !== exata} onClick={() => void store.confirmarPadrao(frase)}>Enviar direto</button>
        </div>
      </Dialogo>
    );
  }

  const enviando = d.fase === "enviando";
  const invalido = Object.keys(problemas).length > 0;
  const destino = criar ? nome || "…" : (p.branch ?? "…");

  return (
    <Dialogo titulo={pr ? "Enviar PR" : p.total_arquivos + p.novos === 0 && p.a_frente > 0 ? "Enviar commits" : "Commit e push"} aoFechar={fechar} largura={600}>
      <form className="dialogo-corpo pub-form" aria-busy={enviando} onSubmit={(e) => { e.preventDefault(); if (!invalido && !enviando && (d.fase === "pronto" || d.fase === "erro")) void store.enviar(opcoes(), cliEfetiva); }}>
        <Resumo p={p} destino={pr ? (p.branch ?? "") : destino} />

        {!pr ? <SecaoSuite p={p} incluir={incluirSuite} aoIncluir={setIncluirSuite} aoIgnorar={() => void store.ignorarSuite()} ocupado={enviando} /> : null}

        {!pr ? (
          <fieldset className="pub-grupo">
            <legend>Branch</legend>
            <label className="pub-opcao"><input type="checkbox" checked={criar} onChange={(e) => setCriarRamo(e.target.checked)} /> Criar branch novo{p.no_padrao ? <small> (obrigatório no branch padrão)</small> : null}</label>
            {criar ? <input className="pub-campo" aria-label="Nome do branch novo" aria-invalid={problemas["ramo"] !== undefined || undefined} value={nome} maxLength={100} spellCheck={false} onChange={(e) => setNomeRamo(e.target.value)} /> : null}
            {problemas["ramo"] !== undefined ? <small className="pub-erro-campo" role="alert">{problemas["ramo"]}</small> : null}
            {!criar && p.no_padrao ? <small className="pub-aviso">Você está no branch padrão ({p.branch}): vou pedir uma confirmação digitada à parte.</small> : null}
          </fieldset>
        ) : null}

        {problemas["nada"] !== undefined ? <small className="pub-aviso" role="status">{problemas["nada"]}</small> : null}

        {!pr ? <label className="pub-opcao"><input type="checkbox" checked={naoRastreados} onChange={(e) => setNaoRastreados(e.target.checked)} /> Incluir arquivos novos (não rastreados)<small> · exceto os de segredo</small></label> : null}

        {!pr ? <TextoOuAgente rotulo="Mensagem do commit" modo={msgModo} texto={msg} aoModo={setMsgModo} aoTexto={setMsg} max={LIMITES_PUBLICAR.mensagem} vazioInvalido={problemas["msg"] !== undefined} /> : null}

        {pr ? (
          <>
            <TextoOuAgente rotulo="Título do PR" modo={tituloModo} texto={titulo} aoModo={setTituloModo} aoTexto={setTitulo} max={LIMITES_PUBLICAR.titulo} vazioInvalido={problemas["titulo"] !== undefined} />
            <TextoOuAgente rotulo="Descrição do PR" modo={descModo} texto={desc} aoModo={setDescModo} aoTexto={setDesc} max={LIMITES_PUBLICAR.descricao} multilinha vazioInvalido={problemas["desc"] !== undefined} />
            <div className="pub-linha">
              <label className="pub-rotulo">Base<input className="pub-campo" aria-invalid={problemas["base"] !== undefined || undefined} value={baseEfetiva} maxLength={100} spellCheck={false} onChange={(e) => setBase(e.target.value)} /></label>
              <label className="pub-rotulo"><span>Revisores <small>(opcional)</small></span><input className="pub-campo" placeholder="maria-dev, joao" aria-invalid={problemas["revisores"] !== undefined || undefined} value={revisores} spellCheck={false} onChange={(e) => setRevisores(e.target.value)} /></label>
            </div>
            {problemas["base"] !== undefined || problemas["revisores"] !== undefined ? <small className="pub-erro-campo" role="alert">{problemas["base"] ?? problemas["revisores"]}</small> : null}
            <label className="pub-opcao"><input type="checkbox" checked={rascunho} onChange={(e) => setRascunho(e.target.checked)} /> Abrir como rascunho (draft)</label>
          </>
        ) : null}

        <label className="pub-rotulo">O agente que vai executar
          {p.clis.length === 0 ? <span className="pub-erro-campo" role="alert">Nenhuma CLI de IA instalada neste computador.</span> : (
            <select className="pub-campo" value={cliEfetiva} onChange={(e) => setCli(e.target.value)} aria-label="Agente que vai executar">
              {p.clis.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.id === p.cli_foco ? " — painel em foco" : c.id === p.cli_padrao ? " — padrão do workspace" : ""}</option>)}
            </select>
          )}
        </label>

        <p className="pub-nota">Nada sai do seu computador agora: o agente recebe a instrução e a CLI pede as aprovações normais para <code>git</code>{pr ? <> e <code>gh</code></> : null}. Sem <code>--force</code>, sem push no branch padrão, sem arquivos de segredo.</p>

        {d.fase === "ocupado" ? (
          <div className="pub-ocupado" role="alert">
            <p>O agente está trabalhando. Abrir um painel novo para isto?</p>
            <div className="dialogo-acoes">
              <button type="button" className="botao" data-foco-inicial onClick={() => void store.responderOcupado(false)}>Cancelar</button>
              <button type="button" className="botao botao-primario" onClick={() => void store.responderOcupado(true)}>Abrir painel novo</button>
            </div>
          </div>
        ) : null}
        {d.erro !== null && d.fase === "erro" ? <p className="pub-erro" role="alert">{d.erro}</p> : null}

        {d.fase !== "ocupado" ? (
          <div className="dialogo-acoes">
            <button type="button" className="botao" onClick={fechar}>Cancelar</button>
            <button type="submit" className="botao botao-primario" disabled={invalido || enviando}>{enviando ? "Enviando…" : "Enviar instrução ao agente"}</button>
          </div>
        ) : null}
      </form>
    </Dialogo>
  );
}
