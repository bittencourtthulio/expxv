import { useMemo, useState } from "react";
import type { ConfigHarness, ContaRoteamento, ContaRoteamentoEntrada, FaixaMinimaTroca, Papel } from "../../../compartilhado/harness";
import { FAIXAS_MINIMAS_TROCA } from "../../../compartilhado/harness";
import { PAPEIS } from "../../../nucleo/dominio/enums";
import { FormManual } from "../../casca/PopoverLimites";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { useCarga } from "../../estado/carga";
import { storeLimites, useLimites } from "../../estado/limites";
import { contasParecemIguais, ehCredito, formatarIdade, formatarPct, formatarUsd, nomeJanela, SEM_DADO } from "../../estado/limites-formato";
import { pedirTela } from "../../estado/navegacao";
import { useProvedores } from "../../estado/provedores";
import type { PropsAba } from "./tipos";
import { PRODUTO } from "../../../nucleo/produto";

export const AVISO_TERMOS = `O ${PRODUTO.nome} usa o login de cada CLI e nunca lê credenciais. Distribuir trabalho entre contas é decisão sua; confira os termos de cada provedor.`;
const TEXTO_FAIXA: Record<FaixaMinimaTroca, string> = { mesma: "mesma faixa", descer_1: "pode descer 1 faixa (com aviso)", qualquer: "qualquer faixa" };
const lista = (t: string): string[] => t.split(",").map((x) => x.trim()).filter((x) => x !== "");
const numeroOuNulo = (t: string): number | null | "erro" => { if (t.trim() === "") return null; const n = Number(t); return Number.isInteger(n) && n > 0 ? n : "erro"; };

function ConfigTroca({ cfg, aoGravar }: { cfg: ConfigHarness | null; aoGravar: (m: Partial<ConfigHarness>) => Promise<void> }) {
  if (cfg === null) return <p className="h-nota">Abra um projeto para configurar a troca por workspace.</p>;
  return (
    <fieldset className="h-secao" aria-label="Troca por consumo neste workspace">
      <h2>Troca por consumo (este workspace)</h2>
      <div className="h-linha-simples">
        <label><input type="checkbox" checked={cfg.troca_entre_provedores} onChange={(e) => void aoGravar({ troca_entre_provedores: e.target.checked })} /> permitir trocar de provedor</label>
        <label>Faixa mínima{" "}
          <select aria-label="Faixa mínima na troca" value={cfg.faixa_minima_troca} onChange={(e) => void aoGravar({ faixa_minima_troca: e.target.value as FaixaMinimaTroca })}>
            {FAIXAS_MINIMAS_TROCA.map((f) => <option key={f} value={f}>{TEXTO_FAIXA[f]}</option>)}
          </select>
        </label>
        <label>Saltos no máximo{" "}
          <select aria-label="Máximo de saltos" value={cfg.max_saltos} onChange={(e) => void aoGravar({ max_saltos: Number(e.target.value) })}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label><input type="checkbox" checked={cfg.piloto_edita_politica} onChange={(e) => void aoGravar({ piloto_edita_politica: e.target.checked })} /> piloto pode editar a política</label>
      </div>
    </fieldset>
  );
}

function Conta({ id, rotulo, provedor, habilitada, config, aoSalvo, gravar }: { gravar: ((c: ContaRoteamentoEntrada) => Promise<unknown>) | undefined; id: string; rotulo: string; provedor: string; habilitada: boolean; config: ContaRoteamento | undefined; aoSalvo: () => void }) {
  const { contas } = useLimites();
  const uso = contas.find((c) => c.account_id === id);
  const [modelos, setModelos] = useState(config?.reservada_modelos.join(", ") ?? "");
  const [papeis, setPapeis] = useState(config?.reservada_papeis.join(", ") ?? "");
  const [t5, setT5] = useState(config?.teto_tokens_5h?.toString() ?? "");
  const [ts, setTs] = useState(config?.teto_tokens_semana?.toString() ?? "");
  const [manual, setManual] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = async () => {
    const papeisLista = lista(papeis);
    const invalido = papeisLista.find((p) => !(PAPEIS as readonly string[]).includes(p));
    if (invalido !== undefined) { setErro(`Papel desconhecido "${invalido}". Use: ${PAPEIS.join(", ")}.`); return; }
    const a = numeroOuNulo(t5), b = numeroOuNulo(ts);
    if (a === "erro" || b === "erro") { setErro("Os tetos de tokens são inteiros positivos (ou vazio)."); return; }
    try {
      await gravar?.({ conta_id: id, reservada_modelos: lista(modelos), reservada_papeis: papeisLista as Papel[], workspaces_fixados: config?.workspaces_fixados ?? [], teto_tokens_5h: a, teto_tokens_semana: b });
      setErro(null); aoSalvo();
    } catch (e) { setErro(`Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`); }
  };
  return (
    <li className="h-conta" aria-label={`Conta ${rotulo}`}>
      <div className="h-conta-cab">
        <strong>{rotulo}</strong> <span className="h-nota">{provedor}</span>
        {!habilitada ? <span className="h-selo" data-tom="aviso">desabilitada</span> : null}
        <span className="h-selo" data-tom={config?.auth === "expirada" ? "aviso" : undefined}>login {config?.auth === "expirada" ? "expirado" : config?.auth === "ok" ? "ok" : "desconhecido"}</span>
        {uso !== undefined ? <span className="h-nota">{uso.fonte === "nenhuma" ? SEM_DADO : uso.fonte} · {formatarIdade(uso.idade_s)}</span> : <span className="h-nota">{SEM_DADO}</span>}
      </div>
      {uso === undefined ? <p className="h-nota">Sem dado de limite para esta conta (nunca é tratado como 0%).</p>
        : ehCredito(uso) ? <p className="h-nota">{typeof uso.credit?.remaining_usd === "number" ? `${formatarUsd(uso.credit.remaining_usd)} restantes` : "sem limite"} · <button type="button" className="botao-mini" onClick={() => pedirTela("provedores")}>Abrir Provedores</button></p>
        : <div className="h-linha-simples">{uso.windows.length === 0 ? <span className="h-nota">{SEM_DADO}</span> : uso.windows.map((w) => <span key={w.kind} className="h-selo">{nomeJanela(w.kind)} {formatarPct(w.used_pct)}</span>)}</div>}
      <div className="h-conta-campos">
        <label>Reservar modelos <input aria-label={`Modelos reservados de ${rotulo}`} value={modelos} onChange={(e) => setModelos(e.target.value)} placeholder="ex.: opus" /></label>
        <label>Reservar papéis <input aria-label={`Papéis reservados de ${rotulo}`} value={papeis} onChange={(e) => setPapeis(e.target.value)} placeholder="piloto, revisor" /></label>
        <label>Teto tokens 5 h <input className="h-num" inputMode="numeric" aria-label={`Teto de tokens 5 horas de ${rotulo}`} value={t5} onChange={(e) => setT5(e.target.value)} /></label>
        <label>Teto tokens semana <input className="h-num" inputMode="numeric" aria-label={`Teto de tokens semanal de ${rotulo}`} value={ts} onChange={(e) => setTs(e.target.value)} /></label>
        <button type="button" className="botao-mini" onClick={() => void salvar()}>Salvar</button>
        <button type="button" className="botao-mini" onClick={() => void storeLimites.atualizar(id)}>Atualizar</button>
        {uso !== undefined && !ehCredito(uso) ? <button type="button" className="botao-mini" aria-expanded={manual} onClick={() => setManual((m) => !m)}>Informar manualmente</button> : null}
      </div>
      {manual && uso !== undefined ? <FormManual conta={uso} aoFim={() => setManual(false)} /> : null}
      {erro !== null ? <p role="alert" className="h-erro">{erro}</p> : null}
    </li>
  );
}

/** Contas com limites, reservas, tetos, fonte/idade e a configuração de troca do workspace. */
export function ContasLimites({ api, cfg, aoGravarConfig, versao }: PropsAba & { cfg: ConfigHarness | null; aoGravarConfig: (m: Partial<ConfigHarness>) => Promise<void> }) {
  const prov = useProvedores();
  const { contas } = useLimites();
  const rot = useCarga<ContaRoteamento[]>(api?.listarContasConfig === undefined ? undefined : () => api.listarContasConfig!(), `contas|${versao}`);
  const todas = useMemo(() => (prov.lista ?? []).flatMap((p) => p.contas.map((c) => ({ id: c.id, rotulo: c.rotulo, provedor: p.ferramenta.nome, habilitada: c.habilitada }))), [prov.lista]);
  const iguais = useMemo(() => contasParecemIguais(contas), [contas]);
  const nomeDe = (id: string) => todas.find((c) => c.id === id)?.rotulo ?? id;
  return (
    <div className="h-secao">
      <p className="h-aviso" role="note">{AVISO_TERMOS}</p>
      {iguais.length > 0 ? <p className="h-aviso" role="alert">{iguais.map(([a, b]) => `As contas ${nomeDe(a)} e ${nomeDe(b)} parecem iguais (janelas idênticas ao mesmo tempo): trocar entre elas pode não dar folga.`).join(" ")}</p> : null}
      <ConfigTroca cfg={cfg} aoGravar={aoGravarConfig} />
      {todas.length === 0 ? <EstadoVazio icone="provedores" titulo="Nenhuma conta" texto="Crie contas na tela Provedores; depois reserve modelos e papéis, e acompanhe a cota aqui." /> : (
        <ul className="h-lista-contas" aria-label="Contas e limites" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {todas.map((c) => <Conta key={`${c.id}|${rot.dados?.length ?? 0}`} id={c.id} rotulo={c.rotulo} provedor={c.provedor} habilitada={c.habilitada} config={rot.dados?.find((r) => r.conta_id === c.id)} aoSalvo={rot.recarregar} gravar={api?.gravarContaConfig} />)}
        </ul>
      )}
    </div>
  );
}
