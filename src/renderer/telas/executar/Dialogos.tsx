import "./executar.css";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { ConfigExecucaoIpc, ItemConfigExecucao, PedidoConfirmacaoExecutar, TipoExecucao } from "../../../compartilhado/executar";
import { ARQUIVO_CONFIG_EXECUTAR } from "../../../nucleo/executar/modelo";
import { Dialogo } from "../../componentes/Dialogo";
import { useExecutar, type StoreExecutar } from "../../estado/executar";
import { storeAssistenteExecutar, type StoreAssistente } from "../../estado/executar-assistente";
import { dividirLinha, escreverAmbiente, juntarLinha, lerAmbiente, MODELOS, slugDe } from "./linha";

// ---------------------------------------------------------------- confiança
/** Rodar script do repositório é executar código: mostra o comando EXATO e só então "Confiar neste projeto e executar". */
export function DialogoConfianca({ pedido, ocupado, aoConfirmar, aoCancelar }: { pedido: PedidoConfirmacaoExecutar; ocupado: boolean; aoConfirmar: () => void; aoCancelar: () => void }): ReactElement {
  return (
    <Dialogo titulo={pedido.motivo === "comando_mudou" ? "O comando mudou: confirmar de novo" : "Executar código deste projeto?"} aoFechar={aoCancelar} largura={640}>
      <div className="dialogo-corpo exec-confianca">
        <p>
          {pedido.motivo === "comando_mudou"
            ? <>O comando de <strong>{pedido.nome}</strong> mudou desde a última vez em que você confiou nele. Confira abaixo antes de rodar.</>
            : <><strong>{pedido.nome}</strong> vai executar código do projeto na sua máquina, com as suas permissões. Confira o comando exato:</>}
        </p>
        <pre className="exec-comando" aria-label="Comando exato">{pedido.linhas.map((l, i) => `${i === 0 ? "$ " : "$ "}${l}`).join("\n")}</pre>
        <p className="exec-meta">Pasta: <code>{pedido.cwd}</code> (relativa à raiz do projeto)</p>
        {pedido.shell ? <p className="exec-aviso" role="note">Este comando roda <strong>em um shell</strong> (pipes, &amp;&amp;, expansão de variáveis). Leia a linha inteira acima.</p> : null}
        {pedido.ambiente.length > 0 ? <p className="exec-meta">Variáveis de ambiente definidas: <code>{pedido.ambiente.join(", ")}</code> (valores não são mostrados)</p> : null}
        {pedido.corpo !== null ? (
          <>
            <p className="exec-meta">O comando dispara este conteúdo do projeto:</p>
            <pre className="exec-comando exec-corpo" aria-label="Conteúdo do script">{pedido.corpo}</pre>
          </>
        ) : null}
        <p className="exec-meta">Você pode revogar a confiança depois em Editar configurações. Nada sai da sua máquina.</p>
      </div>
      <div className="dialogo-acoes">
        <button type="button" className="botao" data-foco-inicial onClick={aoCancelar}>Cancelar</button>
        <button type="button" className="botao botao-primario" disabled={ocupado} onClick={aoConfirmar}>Confiar neste projeto e executar</button>
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------- editor
interface Rascunho {
  id: string;
  novo: boolean;
  nome: string;
  tipo: TipoExecucao;
  executavel: string;
  argumentos: string;
  cwd: string;
  ambiente: string;
  prePassos: string;
  porta: string;
  url: string;
  abrirNavegador: boolean;
  reiniciarAoSalvar: boolean;
  grupo: string;
  usarShell: boolean;
  shell: string;
  confirmouShell: boolean;
}

const VAZIO: Rascunho = { id: "", novo: true, nome: "", tipo: "rodar", executavel: "", argumentos: "", cwd: ".", ambiente: "", prePassos: "", porta: "", url: "", abrirNavegador: false, reiniciarAoSalvar: false, grupo: "", usarShell: false, shell: "", confirmouShell: false };

const doItem = (c: ItemConfigExecucao): Rascunho => ({
  id: c.id, novo: false, nome: c.nome, tipo: c.tipo, executavel: c.executavel, argumentos: juntarLinha(c.argumentos), cwd: c.cwd, ambiente: escreverAmbiente(c.ambiente),
  prePassos: c.pre_passos.map((p) => juntarLinha([p.executavel, ...p.argumentos])).join("\n"), porta: c.porta === null ? "" : String(c.porta), url: c.url ?? "",
  abrirNavegador: c.abrir_navegador, reiniciarAoSalvar: c.reiniciar_ao_salvar, grupo: c.grupo ?? "", usarShell: c.shell !== null, shell: c.shell ?? "", confirmouShell: false,
});

/** Rascunho → configuração do contrato, ou o texto do erro (a validação estrita final é do main). */
export function paraConfig(r: Rascunho, idsUsados: ReadonlySet<string>): { ok: true; config: ConfigExecucaoIpc } | { ok: false; erro: string } {
  const args = dividirLinha(r.argumentos);
  if (!args.ok) return { ok: false, erro: `Argumentos: ${args.erro}` };
  const amb = lerAmbiente(r.ambiente);
  if (!amb.ok) return { ok: false, erro: amb.erro };
  const passos: Array<{ executavel: string; argumentos: string[] }> = [];
  for (const [i, linha] of r.prePassos.split(/\r?\n/).entries()) {
    if (linha.trim() === "") continue;
    const d = dividirLinha(linha);
    if (!d.ok || d.argumentos.length === 0) return { ok: false, erro: `Pré-passo ${i + 1}: ${d.ok ? "linha vazia" : d.erro}` };
    passos.push({ executavel: d.argumentos[0]!, argumentos: d.argumentos.slice(1) });
  }
  const porta = r.porta.trim() === "" ? null : Number(r.porta);
  if (porta !== null && (!Number.isInteger(porta) || porta < 1 || porta > 65_535)) return { ok: false, erro: "Porta: use um número de 1 a 65535" };
  let id = r.id;
  if (r.novo) {
    const base = slugDe(r.nome);
    id = base;
    for (let n = 2; idsUsados.has(id); n += 1) id = `${base.slice(0, 33)}-${n}`;
  }
  if (r.usarShell && r.shell.trim() === "") return { ok: false, erro: "Informe a linha de comando do shell" };
  if (!r.usarShell && r.executavel.trim() === "") return { ok: false, erro: "Informe o programa a executar" };
  return {
    ok: true,
    config: {
      id, nome: r.nome.trim(), tipo: r.tipo, executavel: r.usarShell ? "" : r.executavel.trim(), argumentos: r.usarShell ? [] : args.argumentos, cwd: r.cwd.trim() === "" ? "." : r.cwd.trim(),
      ambiente: amb.ambiente, pre_passos: passos, porta, url: r.url.trim() === "" ? null : r.url.trim(), abrir_navegador: r.abrirNavegador, reiniciar_ao_salvar: r.reiniciarAoSalvar,
      grupo: r.grupo.trim() === "" ? null : r.grupo.trim(), shell: r.usarShell ? r.shell.trim() : null,
    },
  };
}

function Editor({ store, assistente }: { store: StoreExecutar; assistente: StoreAssistente }): ReactElement {
  const ui = useExecutar(store);
  const itens = ui.lista?.configuracoes ?? [];
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [r, setR] = useState<Rascunho>({ ...VAZIO, nome: "Meu app", executavel: "npm", argumentos: "run dev" });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const novoModo = ui.editor === "novo";

  // ao carregar a lista: seleciona a padrão; sem nada (assistente), parte de um rascunho novo
  useEffect(() => {
    if (ui.lista === null || selecionado !== null) return;
    const alvo = ui.lista.configuracoes.find((c) => c.padrao) ?? ui.lista.configuracoes[0];
    if (alvo !== undefined && !novoModo) { setSelecionado(alvo.id); setR(doItem(alvo)); }
  }, [ui.lista, selecionado, novoModo]);

  const idsUsados = useMemo(() => new Set(itens.map((c) => c.id)), [itens]);
  const atual = itens.find((c) => c.id === selecionado) ?? null;
  const campo = <K extends keyof Rascunho>(k: K, v: Rascunho[K]): void => { setR((x) => ({ ...x, [k]: v })); setErro(null); };

  const nova = (): void => { setSelecionado(null); setR({ ...VAZIO, nome: "Nova configuração", executavel: "npm", argumentos: "run dev" }); setErro(null); };
  const aplicarModelo = (rotulo: string): void => {
    const m = MODELOS.find((x) => x.rotulo === rotulo);
    if (m === undefined) return;
    setR((x) => ({ ...x, nome: m.rotulo.split(": ")[1] ?? m.rotulo, tipo: m.tipo, executavel: m.executavel, argumentos: juntarLinha(m.argumentos), porta: m.porta === null ? "" : String(m.porta), abrirNavegador: m.porta !== null, usarShell: false }));
  };

  const salvar = async (): Promise<void> => {
    const c = paraConfig(r, idsUsados);
    if (!c.ok) { setErro(c.erro); return; }
    if (c.config.nome === "") { setErro("Dê um nome à configuração"); return; }
    if (c.config.shell !== null && !r.confirmouShell) { setErro("Marque a confirmação do comando em shell"); return; }
    setSalvando(true);
    const e = await store.gravar(c.config, r.confirmouShell);
    setSalvando(false);
    if (e !== null) { setErro(e); return; }
    setSelecionado(c.config.id);
    setR((x) => ({ ...x, id: c.config.id, novo: false }));
  };

  const preview = (() => { const c = paraConfig(r, idsUsados); return c.ok ? [...c.config.pre_passos.map((p) => juntarLinha([p.executavel, ...p.argumentos])), c.config.shell !== null ? `[shell] ${c.config.shell}` : juntarLinha([c.config.executavel, ...c.config.argumentos])].join("\n") : ""; })();

  return (
    <Dialogo titulo={novoModo && itens.length === 0 ? "Configurar execução do projeto" : "Configurações de execução"} aoFechar={() => store.fecharEditor()} largura={860}>
      <div className="exec-editor">
        <nav className="exec-lista" aria-label="Configurações do projeto">
          {itens.length === 0 ? <p className="exec-meta">Nenhuma configuração ainda. Peça à IA, escolha um modelo ou preencha os campos.</p> : null}
          <ul>
            {itens.map((c) => (
              <li key={c.id}>
                <button type="button" className="exec-lista-item" aria-current={c.id === selecionado ? "true" : undefined} onClick={() => { setSelecionado(c.id); setR(doItem(c)); setErro(null); }}>
                  <span>{c.nome}</span>
                  <small>{c.padrao ? "padrão · " : ""}{c.origem === "detectada" ? "detectada" : "sua"}{c.confiavel ? " · confiável" : ""}</small>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="botao" onClick={nova}>Nova configuração</button>
          <button type="button" className="botao" data-assistente title="A IA da sua CLI lê um resumo do projeto e propõe as configurações; você revisa antes de salvar" onClick={() => { store.fecharEditor(); void assistente.abrir(); }}>Configurar com IA…</button>
          {ui.lista?.armazenamento === "app" ? <p className="exec-meta">A pasta do projeto não é gravável: as configurações ficam nos dados do app.</p> : null}
          {ui.lista?.armazenamento === "arquivo" ? <p className="exec-meta">Salvas em <code>{ARQUIVO_CONFIG_EXECUTAR}</code> (versionável).</p> : null}
        </nav>

        <form className="exec-form" onSubmit={(e) => { e.preventDefault(); void salvar(); }} aria-label="Configuração de execução">
          {r.novo ? (
            <label className="campo">Começar de um modelo
              <select value="" onChange={(e) => aplicarModelo(e.target.value)}>
                <option value="">Escolher…</option>
                {MODELOS.map((m) => <option key={m.rotulo} value={m.rotulo}>{m.rotulo}</option>)}
              </select>
            </label>
          ) : null}
          <div className="exec-linha-dupla">
            <label className="campo">Nome<input value={r.nome} maxLength={60} onChange={(e) => campo("nome", e.target.value)} /></label>
            <label className="campo">Tipo
              <select value={r.tipo} onChange={(e) => campo("tipo", e.target.value as TipoExecucao)}>
                <option value="rodar">Rodar (fica em execução)</option>
                <option value="build">Build</option>
                <option value="teste">Testes</option>
                <option value="outro">Outro</option>
              </select>
            </label>
          </div>
          <label className="exec-marca"><input type="checkbox" checked={r.usarShell} onChange={(e) => campo("usarShell", e.target.checked)} /> Usar shell (pipes, &amp;&amp;) — avançado</label>
          {r.usarShell ? (
            <>
              <label className="campo">Linha de comando (roda em <code>sh -c</code> / <code>cmd /c</code>)
                <textarea value={r.shell} rows={3} spellCheck={false} onChange={(e) => campo("shell", e.target.value)} />
              </label>
              <label className="exec-marca exec-aviso">
                <input type="checkbox" checked={r.confirmouShell} onChange={(e) => campo("confirmouShell", e.target.checked)} />
                Entendo que esta linha roda em um shell e confirmo o comando exato acima.
              </label>
            </>
          ) : (
            <div className="exec-linha-dupla">
              <label className="campo">Programa<input value={r.executavel} spellCheck={false} placeholder="npm" onChange={(e) => campo("executavel", e.target.value)} /></label>
              <label className="campo">Argumentos<input value={r.argumentos} spellCheck={false} placeholder="run dev" onChange={(e) => campo("argumentos", e.target.value)} /></label>
            </div>
          )}
          <label className="campo">Pré-passos (um comando por linha; rodam antes, em sequência)
            <textarea value={r.prePassos} rows={2} spellCheck={false} placeholder="npm run build" onChange={(e) => campo("prePassos", e.target.value)} />
          </label>
          <div className="exec-linha-dupla">
            <label className="campo">Pasta de execução (relativa)<input value={r.cwd} spellCheck={false} onChange={(e) => campo("cwd", e.target.value)} /></label>
            <label className="campo">Porta esperada<input value={r.porta} inputMode="numeric" placeholder="detectada na saída" onChange={(e) => campo("porta", e.target.value)} /></label>
          </div>
          <label className="campo">Variáveis de ambiente (NOME=valor; segredo só como <code>{"{{vault:NOME}}"}</code>)
            <textarea value={r.ambiente} rows={2} spellCheck={false} onChange={(e) => campo("ambiente", e.target.value)} />
          </label>
          <div className="exec-linha-dupla">
            <label className="campo">URL esperada (opcional, só local)<input value={r.url} spellCheck={false} placeholder="http://localhost:3000/" onChange={(e) => campo("url", e.target.value)} /></label>
            <label className="campo">Grupo (rodam juntas se forem diferentes)<input value={r.grupo} spellCheck={false} placeholder="vazio = exclusiva" onChange={(e) => campo("grupo", e.target.value)} /></label>
          </div>
          <label className="exec-marca"><input type="checkbox" checked={r.abrirNavegador} onChange={(e) => campo("abrirNavegador", e.target.checked)} /> Abrir no navegador quando estiver pronto</label>
          <label className="exec-marca"><input type="checkbox" checked={r.reiniciarAoSalvar} onChange={(e) => campo("reiniciarAoSalvar", e.target.checked)} /> Reiniciar ao salvar arquivo do projeto</label>
          {(atual?.avisos ?? []).length > 0 ? (
            <div className="exec-prechecagens" role="group" aria-label="Avisos antes de executar">
              {(atual?.avisos ?? []).map((a) => {
                const linha = a.pre_passo === null ? null : juntarLinha([a.pre_passo.executavel, ...a.pre_passo.argumentos]);
                const jaTem = linha !== null && r.prePassos.split(/\r?\n/).some((x) => x.trim() === linha);
                return (
                  <p key={a.codigo} className="exec-aviso exec-prechecagem" role="note">
                    <span>{a.mensagem}</span>
                    {linha !== null && !jaTem ? <button type="button" className="botao" onClick={() => campo("prePassos", r.prePassos.trim() === "" ? linha : `${r.prePassos.trim()}\n${linha}`)}>Adicionar pré-passo: <code>{linha}</code></button> : null}
                  </p>
                );
              })}
            </div>
          ) : null}
          {preview !== "" ? <pre className="exec-comando" aria-label="Comando que será executado">{preview}</pre> : null}
          {erro !== null ? <p className="campo-erro" role="alert">{erro}</p> : null}
          <div className="dialogo-acoes exec-acoes">
            {atual !== null && atual.origem === "usuario" ? <button type="button" className="botao botao-perigo" onClick={() => { void store.remover(atual.id); setSelecionado(null); }}>Excluir</button> : null}
            {atual !== null && atual.confiavel ? <button type="button" className="botao" onClick={() => void store.revogar(atual.id)}>Revogar confiança</button> : null}
            {atual !== null && !atual.padrao ? <button type="button" className="botao" onClick={() => void store.definirPadrao(atual.id)}>Definir como padrão</button> : null}
            <span className="exec-espaco" />
            <button type="button" className="botao" onClick={() => store.fecharEditor()}>Fechar</button>
            <button type="submit" className="botao botao-primario" disabled={salvando}>Salvar</button>
          </div>
        </form>
      </div>
    </Dialogo>
  );
}

/** Ponto único do chunk lazy: confiança e editor. */
export default function Dialogos({ store, assistente = storeAssistenteExecutar }: { store: StoreExecutar; assistente?: StoreAssistente }): ReactElement | null {
  const ui = useExecutar(store);
  return (
    <>
      {ui.confirmacao !== null ? <DialogoConfianca pedido={ui.confirmacao} ocupado={ui.ocupado} aoConfirmar={() => void store.confirmar()} aoCancelar={() => store.cancelarConfirmacao()} /> : null}
      {ui.editor !== false ? <Editor store={store} assistente={assistente} /> : null}
    </>
  );
}
