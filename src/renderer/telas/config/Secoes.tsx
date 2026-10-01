import { memo, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import type { TemaPreferencia } from "../../../compartilhado/ipc";
import { LIMITES_CONFIG, corValida, useConfig, type StoreConfig, type ValoresConfig } from "../../estado/config";
import { storeTema, useTema } from "../../estado/tema";
import { ade } from "../../ade";
import { storeWorkspaces } from "../../estado/workspaces";
import { ATALHOS } from "./atalhos";

interface P { store: StoreConfig }

const TEMAS: readonly { id: TemaPreferencia; rotulo: string }[] = [
  { id: "sistema", rotulo: "Sistema" }, { id: "claro", rotulo: "Claro" }, { id: "escuro", rotulo: "Escuro" },
];

export const SecaoTema = memo(function SecaoTema() {
  const { preferencia } = useTema();
  return (
    <section className="cfg-secao" aria-label="Tema">
      <h2>Tema</h2>
      <p className="cfg-ajuda">Claro, escuro ou o mesmo do sistema. Vale na hora, sem recarregar.</p>
      <div className="cfg-linha" role="group" aria-label="Tema">
        {TEMAS.map((t) => (
          <button key={t.id} type="button" className="botao" aria-pressed={preferencia === t.id} onClick={() => void storeTema.definir(t.id)}>{t.rotulo}</button>
        ))}
      </div>
    </section>
  );
});

const ZERO = `#${"0".repeat(6)}`;
function corAtualDoTema(): string {
  const v = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement).getPropertyValue("--destaque").trim() : "";
  return corValida(v) ? v : ZERO;
}

export const SecaoCor = memo(function SecaoCor({ store }: P) {
  const cor = useConfig((e) => e.cor, store);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const texto = rascunho ?? cor ?? "";

  const aplicar = async (e: FormEvent) => {
    e.preventDefault();
    const r = await store.definir("cor", texto);
    if (r.ok) { setRascunho(null); setErro(null); } else setErro(r.erro);
  };
  const restaurar = async () => {
    const r = await store.restaurarCor();
    setRascunho(null);
    setErro(r.ok ? null : r.erro);
  };

  return (
    <section className="cfg-secao" aria-label="Cor de destaque">
      <h2>Cor de destaque</h2>
      <p className="cfg-ajuda">Padrão: azul. Use o formato hexadecimal (#rrggbb).</p>
      <form className="cfg-linha" onSubmit={(e) => void aplicar(e)}>
        <input type="color" aria-label="Seletor de cor" value={corValida(texto) ? texto : corAtualDoTema()} onChange={(e) => { setRascunho(e.target.value); setErro(null); }} />
        <input type="text" aria-label="Cor de destaque (hex)" value={texto} placeholder="#rrggbb" maxLength={7} spellCheck={false} onChange={(e) => { setRascunho(e.target.value); setErro(null); }} />
        <button type="submit" className="botao botao-primario">Aplicar</button>
        <button type="button" className="botao" onClick={() => void restaurar()}>Restaurar padrão</button>
        <span className="cfg-amostra" aria-hidden="true" />
      </form>
      {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
    </section>
  );
});

function SecaoNumero({ store, chave, titulo, ajuda, faixa }: P & { chave: "scrollback" | "limitePaineis"; titulo: string; ajuda: string; faixa: { min: number; max: number } }) {
  const atual = useConfig((e) => e[chave], store);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number((rascunho ?? String(atual)).trim());
    const r = await store.definir(chave, (Number.isFinite(n) ? n : Number.NaN) as ValoresConfig[typeof chave]);
    if (r.ok) { setRascunho(null); setErro(null); setSalvo(true); } else { setErro(r.erro); setSalvo(false); }
  };

  return (
    <section className="cfg-secao" aria-label={titulo}>
      <h2>{titulo}</h2>
      <p className="cfg-ajuda">{ajuda}</p>
      <form className="cfg-linha" onSubmit={(e) => void salvar(e)}>
        <input type="number" aria-label={`${titulo}, valor`} min={faixa.min} max={faixa.max} step={1} value={rascunho ?? String(atual)} onChange={(e) => { setRascunho(e.target.value); setErro(null); setSalvo(false); }} />
        <button type="submit" className="botao">Salvar</button>
        {salvo ? <span role="status" className="cfg-ajuda">Salvo</span> : null}
      </form>
      {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
    </section>
  );
}

export const SecaoScrollback = memo(function SecaoScrollback({ store }: P) {
  const { min, max } = LIMITES_CONFIG.scrollback;
  return <SecaoNumero store={store} chave="scrollback" titulo="Scrollback do terminal" faixa={LIMITES_CONFIG.scrollback}
    ajuda={`Linhas guardadas por terminal, de ${min.toLocaleString("pt-BR")} a ${max.toLocaleString("pt-BR")}. Mais linhas usam mais memória; vale para terminais novos.`} />;
});

export const SecaoLimitePaineis = memo(function SecaoLimitePaineis({ store }: P) {
  const { min, max } = LIMITES_CONFIG.limitePaineis;
  return <SecaoNumero store={store} chave="limitePaineis" titulo="Limite de painéis" faixa={LIMITES_CONFIG.limitePaineis}
    ajuda={`Painéis de terminal simultâneos por janela, de ${min} a ${max}.`} />;
});

export const SecaoPermissao = memo(function SecaoPermissao({ store }: P) {
  const atual = useConfig((e) => e.permissaoPadrao, store);
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const escolher = async (p: "seguro" | "automatico") => {
    setErro(null);
    if (p === "automatico") { setPendente(true); return; }
    setPendente(false);
    const r = await store.definir("permissaoPadrao", p);
    if (!r.ok) setErro(r.erro);
  };
  const confirmar = async () => {
    const r = await store.definir("permissaoPadrao", "automatico");
    if (r.ok) setPendente(false); else setErro(r.erro);
  };

  return (
    <section className="cfg-secao" aria-label="Permissão padrão">
      <h2>Permissão padrão de novos workspaces</h2>
      <p className="cfg-ajuda">Não muda os workspaces que já existem.</p>
      <div className="cfg-linha" role="group" aria-label="Permissão padrão">
        <button type="button" className="botao" aria-pressed={atual === "seguro" && !pendente} onClick={() => void escolher("seguro")}>Seguro</button>
        <button type="button" className="botao" aria-pressed={atual === "automatico" || pendente} onClick={() => void escolher("automatico")}>Automático</button>
      </div>
      {pendente ? (
        <div role="alert" className="cfg-aviso">
          <p>No modo automático as CLIs executam comandos e editam arquivos sem pedir sua confirmação. Use só em projetos em que você confia e que estão versionados.</p>
          <div className="cfg-linha">
            <button type="button" className="botao botao-perigo" onClick={() => void confirmar()}>Entendi, ativar automático</button>
            <button type="button" className="botao" onClick={() => setPendente(false)}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {atual === "automatico" && !pendente ? <p className="cfg-aviso">Modo automático ativo: novos workspaces não pedirão confirmação às CLIs.</p> : null}
      {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
    </section>
  );
});

export const SecaoNotificacoes = memo(function SecaoNotificacoes({ store }: P) {
  const ligado = useConfig((e) => e.notificacoes, store);
  return (
    <section className="cfg-secao" aria-label="Notificações">
      <h2>Notificações do sistema</h2>
      <p className="cfg-ajuda">Avisa quando um painel passa a aguardar você e o app está em segundo plano.</p>
      <button type="button" role="switch" aria-checked={ligado} className="botao" onClick={() => void store.definir("notificacoes", !ligado)}>{ligado ? "Ligadas" : "Desligadas"}</button>
    </section>
  );
});

export const SecaoDiagnostico = memo(function SecaoDiagnostico() {
  const [texto, setTexto] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gerar = async () => {
    setCopiado(false);
    try { setTexto((await ade()?.terminais.diagnostico())?.texto ?? "Diagnóstico indisponível fora do aplicativo."); setErro(null); }
    catch (e) { setErro(`Não foi possível gerar o diagnóstico: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto ?? ""); setCopiado(true); } catch { setCopiado(false); }
  };

  return (
    <section className="cfg-secao" aria-label="Diagnóstico">
      <h2>Diagnóstico</h2>
      <p className="cfg-ajuda">Texto sem segredos para anexar a um relato de problema.</p>
      <div className="cfg-linha">
        <button type="button" className="botao" onClick={() => void gerar()}>Gerar diagnóstico</button>
        {texto !== null ? <button type="button" className="botao" onClick={() => void copiar()}>{copiado ? "Copiado" : "Copiar"}</button> : null}
      </div>
      {texto !== null ? <textarea readOnly className="cfg-diag" aria-label="Texto do diagnóstico" rows={8} value={texto} /> : null}
      {erro !== null ? <p role="alert" className="cfg-erro">{erro}</p> : null}
    </section>
  );
});

export const SecaoSobre = memo(function SecaoSobre() {
  const [versao, setVersao] = useState("");
  const raiz = useSyncExternalStore(storeWorkspaces.assinar, () => storeWorkspaces.obter().atual?.raiz ?? null);
  useEffect(() => { ade()?.versao().then(setVersao).catch(() => undefined); }, []);
  return (
    <section className="cfg-secao" aria-label="Sobre">
      <h2>Sobre</h2>
      <dl className="cfg-sobre">
        <dt>Versão</dt><dd>{versao || "—"}</dd>
        <dt>Dados do app</dt><dd>Pasta de dados do usuário do sistema (Application Support no macOS, AppData no Windows)</dd>
        <dt>Dados do método</dt><dd>docs/ na raiz do workspace (caminhos relativos)</dd>
        <dt>Workspace atual</dt><dd>{raiz ?? "nenhum aberto"}</dd>
      </dl>
    </section>
  );
});

export const SecaoAtalhos = memo(function SecaoAtalhos() {
  return (
    <section className="cfg-secao" aria-label="Atalhos">
      <h2>Atalhos</h2>
      <p className="cfg-ajuda">Somente leitura. No Windows e no Linux os atalhos usam Ctrl+Shift, porque Ctrl+letra pertence ao processo no terminal.</p>
      <table className="cfg-tabela">
        <thead><tr><th scope="col">Ação</th><th scope="col">macOS</th><th scope="col">Windows / Linux</th></tr></thead>
        <tbody>{ATALHOS.map((a) => <tr key={a.acao}><td>{a.acao}</td><td><kbd>{a.mac}</kbd></td><td><kbd>{a.outros}</kbd></td></tr>)}</tbody>
      </table>
    </section>
  );
});
