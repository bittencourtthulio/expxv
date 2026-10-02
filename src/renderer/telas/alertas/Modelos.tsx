import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiAlertas, MetaTipoVisao, ModeloVisao, PrevisaoModelo } from "../../../compartilhado/alertas";
import { chaveModelo, NIVEIS, ordenarModelos, rotuloTamanho, situacaoTamanho } from "./logica";

const ROTULO_CANAL: Record<string, string> = { so: "Sistema", telegram: "Telegram", toast: "Aviso no app", webhook: "Webhook" };

export function Modelos({ api, catalogo }: { api: ApiAlertas; catalogo: readonly MetaTipoVisao[] }) {
  const [modelos, setModelos] = useState<ModeloVisao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [chave, setChave] = useState<string | null>(null);
  const [corpo, setCorpo] = useState("");
  const [previa, setPrevia] = useState<PrevisaoModelo | null>(null);
  const [errosSalvar, setErrosSalvar] = useState<string[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);
  const geracao = useRef(0);

  const carregar = useCallback(async (): Promise<void> => {
    try { setModelos(ordenarModelos(await api.modelosListar(), catalogo)); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não foi possível ler os modelos."); }
  }, [api, catalogo]);
  useEffect(() => { void carregar(); }, [carregar]);

  const atual = useMemo(() => modelos?.find((m) => chaveModelo(m) === chave) ?? null, [modelos, chave]);
  const rotuloTipo = (t: string): string => catalogo.find((c) => c.tipo === t)?.rotulo ?? t;

  const escolher = (m: ModeloVisao): void => { setChave(chaveModelo(m)); setCorpo(m.corpo); setErrosSalvar([]); setAviso(null); };
  // prévia ao vivo com debounce; respostas atrasadas são descartadas
  useEffect(() => {
    if (atual === null) { setPrevia(null); return; }
    const g = ++geracao.current;
    const t = setTimeout(() => {
      void api.modeloPrever({ tipo: atual.tipo, canal_tipo: atual.canal_tipo, nivel: atual.nivel, corpo }).then((p) => { if (g === geracao.current) setPrevia(p); }, () => { if (g === geracao.current) setPrevia({ texto: "", tamanho_visivel: 0, erros: ["Não foi possível gerar a prévia."] }); });
    }, 200);
    return () => clearTimeout(t);
  }, [api, atual, corpo]);

  const salvar = async (): Promise<void> => {
    if (atual === null) return;
    try {
      const r = await api.modeloGravar({ tipo: atual.tipo, canal_tipo: atual.canal_tipo, nivel: atual.nivel, corpo });
      if ("erros" in r) { setErrosSalvar(r.erros); return; }
      setErrosSalvar([]); setAviso("Modelo salvo."); await carregar();
    } catch { setErrosSalvar(["Não foi possível salvar o modelo."]); }
  };
  const restaurar = async (): Promise<void> => {
    if (atual === null) return;
    try { const m = await api.modeloRestaurar({ tipo: atual.tipo, canal_tipo: atual.canal_tipo, nivel: atual.nivel }); setCorpo(m.corpo); setAviso("Padrão restaurado."); setErrosSalvar([]); await carregar(); }
    catch { setErrosSalvar(["Não foi possível restaurar o padrão."]); }
  };

  const tamanho = previa?.tamanho_visivel ?? 0;
  const situ = situacaoTamanho(tamanho);
  return (
    <div className="alertas-modelos">
      {erro !== null ? <div role="alert" className="alertas-erro">{erro} <button type="button" className="botao alertas-mini" onClick={() => void carregar()}>Tentar de novo</button></div> : null}
      <nav className="alertas-modelos-lista" aria-label="Modelos de mensagem">
        {modelos === null ? <p className="alertas-nota" role="status" aria-busy="true">Lendo modelos…</p> : modelos.length === 0 ? <p className="alertas-nota">Nenhum modelo disponível.</p> : (
          <ul>
            {modelos.map((m) => (
              <li key={chaveModelo(m)}>
                <button type="button" aria-current={chaveModelo(m) === chave ? "true" : undefined} onClick={() => escolher(m)}>
                  {rotuloTipo(m.tipo)} · {ROTULO_CANAL[m.canal_tipo] ?? m.canal_tipo} · {NIVEIS.find((n) => n.id === m.nivel)?.rotulo}{m.editado ? " (editado)" : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <section className="alertas-modelo-editor" aria-label="Editor do modelo">
        {atual === null ? <p className="alertas-nota">Escolha um modelo à esquerda para editar. As chaves {"{{campo}}"} e os formatadores são validados ao salvar.</p> : (
          <>
            <label className="campo"><span>Corpo do modelo ({rotuloTipo(atual.tipo)})</span>
              <textarea aria-label="Corpo do modelo" value={corpo} maxLength={2000} spellCheck={false} onChange={(e) => setCorpo(e.target.value)} />
            </label>
            <p className="alertas-contador" data-situacao={situ} role="status">{rotuloTamanho(tamanho)}</p>
            <h3>Prévia com dados de exemplo</h3>
            {previa !== null && previa.erros.length > 0 ? <ul role="alert" className="campo-erro">{previa.erros.map((e) => <li key={e}>{e}</li>)}</ul> : <pre className="alertas-previa" aria-label="Prévia">{previa?.texto ?? ""}</pre>}
            {errosSalvar.length > 0 ? <ul role="alert" className="campo-erro">{errosSalvar.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            {aviso !== null ? <p role="status" className="alertas-aviso">{aviso}</p> : null}
            <div className="alertas-linha-botoes">
              <button type="button" className="botao botao-primario alertas-mini" disabled={previa === null || previa.erros.length > 0} onClick={() => void salvar()}>Salvar modelo</button>
              <button type="button" className="botao alertas-mini" onClick={() => void restaurar()}>Restaurar padrão</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
