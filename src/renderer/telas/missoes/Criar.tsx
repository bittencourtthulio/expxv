import { useEffect, useState } from "react";
import type { Mission, ModoMissao, OrigemMissao, Papel } from "../../../compartilhado/dominio";
import { Dialogo } from "../../componentes/Dialogo";
import { storeProvedores, useProvedores, type StoreProvedores } from "../../estado/provedores";
import { DESCRICAO_MODO, ORIGENS_WIZARD, ROTULO_MODO, ROTULO_ORIGEM, ROTULO_PAPEL } from "./rotulos";
import { aplicarCli, montarPedido, papeisDoModo, papelObrigatorio, validar, type ErrosMissao, type FormMissao } from "./validar";

export interface PropsCriar {
  workspaceId: string;
  criar: (pedido: ReturnType<typeof montarPedido>) => Promise<Mission>;
  aoFechar: () => void;
  aoCriada: (m: Mission) => void;
  provedores?: StoreProvedores;
}

const MODOS: readonly ModoMissao[] = ["livre", "squad", "agentico"];

export function CriarMissao({ workspaceId, criar, aoFechar, aoCriada, provedores = storeProvedores }: PropsCriar) {
  const { lista } = useProvedores(provedores);
  const [form, setForm] = useState<FormMissao>({ modo: "livre", origem: "livre", titulo: "", pedido: "", clis: {}, cadeado: false });
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => { if (provedores.obter().lista === null) void provedores.carregar(false); }, [provedores]);

  // só CLIs reais e instaladas (o "terminal" puro não é papel de missão)
  const clis = (lista ?? []).map((p) => p.ferramenta).filter((f) => f.instalado && f.id !== "terminal");
  const erros: ErrosMissao = validar(form, clis.map((c) => c.id));
  const mostrar = (campo: keyof ErrosMissao) => (tentou ? erros[campo] : undefined);

  const trocarModo = (modo: ModoMissao) => setForm((f) => ({ ...f, modo, clis: {} }));
  const alternarCadeado = () => setForm((f) => {
    if (f.cadeado) return { ...f, cadeado: false };
    const base = f.clis[papeisDoModo(f.modo)[0] as Papel] ?? "";
    return aplicarCli({ ...f, cadeado: true }, papeisDoModo(f.modo)[0] as Papel, base);
  });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTentou(true);
    if (Object.keys(erros).length > 0) return;
    setEnviando(true);
    setFalha(null);
    try { aoCriada(await criar(montarPedido(form, workspaceId))); }
    catch (err) { setFalha(err instanceof Error ? err.message : String(err)); setEnviando(false); }
  };

  return (
    <Dialogo titulo="Nova missão" aoFechar={aoFechar} largura={600}>
      <form onSubmit={(e) => void enviar(e)} noValidate>
        <fieldset className="mis-grupo">
          <legend>Modo</legend>
          {MODOS.map((m) => (
            <label key={m} className="mis-opcao">
              <input type="radio" name="modo" checked={form.modo === m} onChange={() => trocarModo(m)} />
              <span><strong>{ROTULO_MODO[m]}</strong><small>{DESCRICAO_MODO[m]}</small></span>
            </label>
          ))}
        </fieldset>
        <label className="campo">Origem
          <select value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value as OrigemMissao })}>
            {ORIGENS_WIZARD.map((o) => <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>)}
          </select>
        </label>
        <label className="campo">Título
          <input value={form.titulo} aria-invalid={mostrar("titulo") !== undefined} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          {mostrar("titulo") !== undefined ? <span role="alert" className="campo-erro">{erros.titulo}</span> : null}
        </label>
        <label className="campo">Pedido
          <textarea value={form.pedido} aria-invalid={mostrar("pedido") !== undefined} onChange={(e) => setForm({ ...form, pedido: e.target.value })} />
          {mostrar("pedido") !== undefined ? <span role="alert" className="campo-erro">{erros.pedido}</span> : null}
        </label>

        <div className="mis-papeis-cab">
          <strong>{form.modo === "livre" ? "CLI" : "CLI por papel"}</strong>
          {form.modo !== "livre" ? (
            <button type="button" className="botao" aria-pressed={form.cadeado} title="Aplica a mesma CLI a todos os papéis" onClick={alternarCadeado}>
              {form.cadeado ? "Cadeado ligado: mesma CLI em todos" : "Cadeado: mesma CLI em todos"}
            </button>
          ) : null}
        </div>
        {lista !== null && clis.length === 0 ? (
          <p className="aviso-caixa" role="note">Nenhuma CLI instalada. Abra Provedores, instale uma CLI e atualize.</p>
        ) : null}
        {papeisDoModo(form.modo).map((p) => {
          const obrig = papelObrigatorio(form.modo, p);
          const rotulo = `${ROTULO_PAPEL[p]}${obrig ? " (obrigatório)" : ""}`;
          return (
            <label key={p} className="campo">{rotulo}
              <select value={form.clis[p] ?? ""} aria-invalid={mostrar(p) !== undefined} onChange={(e) => setForm((f) => aplicarCli(f, p, e.target.value))}>
                <option value="">{obrig ? "Escolha…" : "Não usar"}</option>
                {clis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              {mostrar(p) !== undefined ? <span role="alert" className="campo-erro">{erros[p]}</span> : null}
            </label>
          );
        })}
        {falha !== null ? <p role="alert" className="erro-caixa">Não foi possível criar: {falha}</p> : null}
        <div className="dialogo-acoes">
          <button type="button" className="botao" onClick={aoFechar}>Cancelar</button>
          <button type="submit" className="botao botao-primario" disabled={enviando}>{enviando ? "Criando…" : "Criar missão"}</button>
        </div>
      </form>
    </Dialogo>
  );
}
