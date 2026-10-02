import { useEffect, useState } from "react";
import type { ConfigAgil, CriterioConfig, MembroAgil, ModoEstimativa } from "../../../compartilhado/agil";
import { avisar } from "../../estado/avisos";
import { Campo, Carregando, FaixaErro } from "./comum";
import type { CtxAgil } from "./contexto";
import { textoDoErro } from "./logica";

const MODOS: Array<[ModoEstimativa, string]> = [["ia_sugere", "IA sugere (heurística na hora, IA em segundo plano)"], ["so_heuristica", "Só heurística (nada sai da máquina)"], ["manual", "Manual (sem sugestões)"]];

function ListaCriterios({ titulo, itens, aoMudar }: { titulo: string; itens: CriterioConfig[]; aoMudar: (v: CriterioConfig[]) => void }) {
  return (
    <fieldset className="ag-fieldset"><legend>{titulo}</legend>
      {itens.map((c, i) => (
        <div key={i} className="ag-acoes-linha">
          <input type="text" aria-label={`${titulo}: descrição ${i + 1}`} value={c.descricao} onChange={(e) => aoMudar(itens.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))} />
          <span className="ag-meta">{c.auto ? "automático" : "manual"}</span>
          <button type="button" className="ag-btn" aria-label={`Remover ${titulo} ${i + 1}`} onClick={() => aoMudar(itens.filter((_, j) => j !== i))}>Remover</button>
        </div>
      ))}
      <button type="button" className="ag-btn" onClick={() => aoMudar([...itens, { codigo: `custom_${itens.length + 1}`, descricao: "", auto: false }])}>Adicionar critério</button>
    </fieldset>
  );
}

/** Config: escalas, categorias, pesos de risco, DoD/DoR, perfil do estimador, janela de retrabalho, consentimento da IA e membros. Padrões restauráveis. */
export function Config({ ctx }: { ctx: CtxAgil }) {
  const [cfg, setCfg] = useState<ConfigAgil | null>(null);
  const [orig, setOrig] = useState<string>("");
  const [erro, setErro] = useState<unknown>(null);
  const [novoMembro, setNovoMembro] = useState({ rotulo: "", tipo: "humano" as MembroAgil["tipo"], alias: "" });
  const carregar = (): void => { void ctx.api.configLer(ctx.ws).then((c) => { setCfg(c); setOrig(JSON.stringify(c)); setErro(null); }, (e: unknown) => setErro(e)); };
  useEffect(carregar, [ctx.api, ctx.ws]); // eslint-disable-line react-hooks/exhaustive-deps
  const falha = (e: unknown): void => { avisar(textoDoErro(e), "erro"); };
  if (erro !== null && cfg === null) return <FaixaErro erro={erro} aoTentar={carregar} />;
  if (cfg === null) return <Carregando />;
  const sujo = JSON.stringify(cfg) !== orig;
  const set = <K extends keyof ConfigAgil>(k: K, v: ConfigAgil[K]): void => setCfg({ ...cfg, [k]: v });
  const salvar = (): void => { void ctx.api.configGravar(ctx.ws, cfg).then((c) => { setCfg(c); setOrig(JSON.stringify(c)); avisar("Configuração salva.", "sucesso"); ctx.recarregar(); }, falha); };
  const restaurar = async (): Promise<void> => {
    const { configPadrao } = await import("../../../nucleo/agil/config/padroes");
    setCfg(configPadrao());
    avisar("Padrões carregados: confira e clique em Salvar.", "info");
  };
  const consentimento = ctx.estado?.ia.consentimento === true;
  const ia = ctx.estado?.ia ?? null;

  return (
    <div className="ag-config">
      <div className="ag-sub-barra">
        <button type="button" className="ag-btn" data-primario disabled={!sujo} onClick={salvar}>Salvar</button>
        <button type="button" className="ag-btn" onClick={() => void restaurar()}>Restaurar padrões</button>
        <button type="button" className="ag-btn" disabled={!sujo} onClick={() => setCfg(JSON.parse(orig) as ConfigAgil)}>Desfazer alterações</button>
      </div>

      <section className="ag-secao" aria-label="Estimativa por IA">
        <h4>Estimativa e IA</h4>
        <Campo rotulo="Modo de estimativa"><select value={cfg.estimativa_modo} onChange={(e) => set("estimativa_modo", e.target.value as ModoEstimativa)}>{MODOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}</select></Campo>
        <Campo rotulo="Perfil do estimador (faixa)"><input type="text" value={cfg.perfil_estimador} onChange={(e) => set("perfil_estimador", e.target.value)} /></Campo>
        <Campo rotulo="Teto de chamadas de IA por dia"><input type="number" min={0} max={500} value={cfg.estimativa_max_chamadas_dia} onChange={(e) => set("estimativa_max_chamadas_dia", Number(e.target.value))} /></Campo>
        <Campo rotulo="Confiança mínima para aceitar em lote (0 a 1)"><input type="number" min={0} max={1} step={0.05} value={cfg.confianca_aceite_lote} onChange={(e) => set("confianca_aceite_lote", Number(e.target.value))} /></Campo>
        <label className="ag-check">
          <input type="checkbox" checked={consentimento} onChange={(e) => void ctx.api.consentimentoIa(ctx.ws, e.target.checked).then(ctx.recarregar, falha)} />
          Permitir enviar o texto das tasks ao provedor da minha CLI para estimar story points
        </label>
        <p className="ag-meta">Sem esta permissão a IA nunca é chamada: só a heurística local roda. Código-fonte, caminhos e segredos nunca vão no texto.{ia !== null ? ` Hoje: ${ia.chamadas_hoje} de ${ia.teto_dia} chamadas${ia.perfil !== null ? ` · perfil ${ia.perfil}` : " · nenhuma CLI resolvida para o perfil"}${ia.disponivel ? "" : " · IA indisponível"}.` : ""}</p>
      </section>

      <section className="ag-secao" aria-label="Escalas e categorias">
        <h4>Escala, categorias e retrabalho</h4>
        <Campo rotulo="Escala de pontos"><select value={cfg.escala_id} onChange={(e) => set("escala_id", e.target.value)}>{cfg.escalas.map((s) => <option key={s.id} value={s.id}>{s.nome}: {s.valores.map((v) => v.rotulo).join(", ")}</option>)}</select></Campo>
        <Campo rotulo="Categorias (separadas por vírgula)"><input type="text" value={cfg.categorias.join(", ")} onChange={(e) => set("categorias", e.target.value.split(",").map((x) => x.trim()).filter((x) => x !== ""))} /></Campo>
        <Campo rotulo="Janela de retrabalho (dias)"><input type="number" min={1} max={90} value={cfg.janela_retrabalho_dias} onChange={(e) => set("janela_retrabalho_dias", Number(e.target.value))} /></Campo>
        <Campo rotulo="Folga do planejamento (0 a 1)"><input type="number" min={0} max={0.9} step={0.05} value={cfg.buffer_planejamento} onChange={(e) => set("buffer_planejamento", Number(e.target.value))} /></Campo>
        <Campo rotulo="Horas por dia (padrão)"><input type="number" min={1} max={24} value={cfg.horas_dia_padrao} onChange={(e) => set("horas_dia_padrao", Number(e.target.value))} /></Campo>
      </section>

      <section className="ag-secao" aria-label="Pesos de risco">
        <h4>Pesos de risco</h4>
        <div className="ag-grade-campos">
          {Object.entries(cfg.risco_pesos).map(([k, v]) => <Campo key={k} rotulo={k}><input type="number" min={0} max={10} value={v} onChange={(e) => set("risco_pesos", { ...cfg.risco_pesos, [k]: Number(e.target.value) })} /></Campo>)}
        </div>
        <div className="ag-grade-campos">
          {(["medio", "alto", "critico"] as const).map((f) => <Campo key={f} rotulo={`Faixa: ${f}`}><input type="number" min={0} max={50} value={cfg.risco_faixas[f]} onChange={(e) => set("risco_faixas", { ...cfg.risco_faixas, [f]: Number(e.target.value) })} /></Campo>)}
        </div>
      </section>

      <section className="ag-secao" aria-label="Definições de pronto e de preparado">
        <ListaCriterios titulo="Definição de pronto (DoD)" itens={cfg.dod} aoMudar={(v) => set("dod", v)} />
        <ListaCriterios titulo="Definição de preparado (DoR)" itens={cfg.dor} aoMudar={(v) => set("dor", v)} />
      </section>

      <section className="ag-secao" aria-label="Membros">
        <h4>Membros (humanos e agentes)</h4>
        <ul className="ag-fatores">
          {ctx.membros.map((m) => (
            <li key={m.id}>{m.rotulo} <span className="ag-meta">({m.tipo}{m.aliases.length > 0 ? ` · aliases: ${m.aliases.map((a) => a.valor).join(", ")}` : ""}{m.ativo ? "" : " · inativo"})</span></li>
          ))}
          {ctx.membros.length === 0 && <li className="ag-meta">Nenhum membro. Cadastre quem trabalha na sprint: sem membros a capacidade fica sem base.</li>}
        </ul>
        <div className="ag-acoes-linha" role="group" aria-label="Novo membro">
          <Campo rotulo="Nome"><input type="text" value={novoMembro.rotulo} onChange={(e) => setNovoMembro({ ...novoMembro, rotulo: e.target.value })} /></Campo>
          <Campo rotulo="Tipo"><select value={novoMembro.tipo} onChange={(e) => setNovoMembro({ ...novoMembro, tipo: e.target.value as MembroAgil["tipo"] })}><option value="humano">Humano</option><option value="agente">Agente</option></select></Campo>
          <Campo rotulo="Alias no rastro (nome do agente)"><input type="text" value={novoMembro.alias} onChange={(e) => setNovoMembro({ ...novoMembro, alias: e.target.value })} /></Campo>
          <button type="button" className="ag-btn" disabled={novoMembro.rotulo.trim() === ""} onClick={() => void ctx.api.membroGravar(ctx.ws, { tipo: novoMembro.tipo, rotulo: novoMembro.rotulo.trim(), horas_dia: novoMembro.tipo === "humano" ? cfg.horas_dia_padrao : null, aliases: novoMembro.alias.trim() === "" ? [] : [{ tipo: "agente", valor: novoMembro.alias.trim() }] }).then(() => { setNovoMembro({ rotulo: "", tipo: "humano", alias: "" }); ctx.recarregar(); }, falha)}>Adicionar membro</button>
        </div>
      </section>
    </div>
  );
}
