import { useEffect, useId, useState } from "react";
import type { EntradaMemoria } from "../../../compartilhado/memoria";
import { DialogoConfirmacao } from "../../componentes/Dialogo";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import type { StoreMemoria } from "../../estado/memoria";
import { PREFERENCIAS_LIMITE, PREFERENCIA_MAX, validarPreferencia } from "./logica";

export interface PropsPreferencias {
  store: StoreMemoria;
  preferencias: readonly EntradaMemoria[];
  carregado: boolean;
  erro: string | null;
}

/** Anel 3 (P-23): até 50 preferências, 300 caracteres cada, só por ação humana, valem para todos os projetos neste computador. */
export function Preferencias({ store, preferencias, carregado, erro }: PropsPreferencias) {
  const [novo, setNovo] = useState("");
  const [edicao, setEdicao] = useState<{ id: string; texto: string } | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [remover, setRemover] = useState<EntradaMemoria | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const idNovo = useId();
  useEffect(() => { if (!carregado) void store.carregarPreferencias(); }, [carregado, store]);

  const adicionar = async (): Promise<void> => {
    const v = validarPreferencia(novo, preferencias.length, false);
    if (!v.ok) { setErroForm(v.erro); return; }
    setOcupado(true);
    const r = await store.gravarPreferencia(null, v.valor);
    setOcupado(false);
    if (r !== null) { setNovo(""); setErroForm(null); }
  };
  const salvarEdicao = async (): Promise<void> => {
    if (edicao === null) return;
    const v = validarPreferencia(edicao.texto, preferencias.length, true);
    if (!v.ok) { setErroForm(v.erro); return; }
    setOcupado(true);
    const atual = preferencias.find((p) => p.id === edicao.id);
    const r = await store.gravarPreferencia(edicao.id, v.valor, atual?.importancia ?? 3);
    setOcupado(false);
    if (r !== null) { setEdicao(null); setErroForm(null); }
  };
  const confirmarRemocao = async (): Promise<void> => {
    if (remover === null) return;
    setOcupado(true);
    await store.removerPreferencia(remover.id);
    setOcupado(false);
    setRemover(null);
  };

  return (
    <section className="mem-secao mem-rolavel" aria-label="Preferências">
      <h2>Preferências ({preferencias.length} de {PREFERENCIAS_LIMITE})</h2>
      <p className="mem-nota">Preferências valem para todos os projetos neste computador e entram no pacote do piloto das Missões agênticas; nunca são gravadas por agentes. Segredos são mascarados ao salvar.</p>
      <div className="mem-form">
        <label htmlFor={idNovo}>Nova preferência</label>
        <textarea id={idNovo} value={novo} rows={2} aria-invalid={erroForm !== null && edicao === null} onChange={(e) => { setNovo(e.target.value); setErroForm(null); }} placeholder="Ex.: responder sempre em português do Brasil" />
        <p className="mem-contador">{Array.from(novo).length} de {PREFERENCIA_MAX}</p>
        {erroForm !== null && edicao === null ? <p role="alert" className="mem-erro">{erroForm}</p> : null}
        <button type="button" disabled={ocupado || novo.trim() === ""} onClick={() => void adicionar()}>Adicionar</button>
      </div>
      {erro !== null ? <p role="alert" className="mem-erro">{erro}</p> : null}
      {!carregado ? <p className="mem-vazio" role="status" aria-busy="true">Carregando preferências…</p> : preferencias.length === 0 ? (
        <EstadoVazio icone="memoria" titulo="Nenhuma preferência ainda" texto="Escreva acima o que vale para todo projeto (idioma, estilo, regras). O piloto das Missões agênticas recebe isso no pacote de abertura." />
      ) : (
        <ul aria-label="Lista de preferências" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {preferencias.map((p) => (
            <li key={p.id} className="mem-pref">
              {edicao?.id === p.id ? (
                <>
                  <span className="mem-form" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor={`mem-pref-${p.id}`}>Editar preferência</label>
                    <textarea id={`mem-pref-${p.id}`} value={edicao.texto} rows={2} aria-invalid={erroForm !== null} onChange={(e) => { setEdicao({ id: p.id, texto: e.target.value }); setErroForm(null); }} />
                    {erroForm !== null ? <span role="alert" className="mem-erro">{erroForm}</span> : null}
                    <span className="mem-acoes"><button type="button" disabled={ocupado} onClick={() => void salvarEdicao()}>Salvar</button><button type="button" onClick={() => { setEdicao(null); setErroForm(null); }}>Cancelar</button></span>
                  </span>
                </>
              ) : (
                <>
                  <span>{p.conteudo}{p.redigido ? <span className="mem-escudo" role="img" aria-label="Segredo mascarado nesta preferência" title="Segredo mascarado"> ⛨</span> : null}</span>
                  <span className="mem-contador" title="Importância">imp. {p.importancia}</span>
                  <button type="button" className="mem-icone-btn" onClick={() => { setEdicao({ id: p.id, texto: p.conteudo }); setErroForm(null); }}>Editar</button>
                  <button type="button" className="mem-icone-btn" onClick={() => setRemover(p)}>Remover</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {remover !== null ? (
        <DialogoConfirmacao titulo="Remover a preferência?" rotuloConfirmar="Remover" perigoso ocupado={ocupado} aoCancelar={() => setRemover(null)} aoConfirmar={() => void confirmarRemocao()}
          texto={<p>A preferência deixa de entrar no pacote do piloto das próximas Missões.</p>} />
      ) : null}
    </section>
  );
}
