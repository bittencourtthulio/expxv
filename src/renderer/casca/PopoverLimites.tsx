import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AccountUsage, JanelaManual, PrevisaoZerar } from "../../compartilhado/limites";
import { JANELAS_MANUAIS } from "../../compartilhado/limites";
import { ade } from "../ade";
import { ehCredito, formatarIdade, formatarPct, formatarUsd, nomeConta, nomeJanela, seloConfianca, SEM_DADO, textoChipGeral, textoPrevisao } from "../estado/limites-formato";
import { storeLimites, useLimites } from "../estado/limites";
import { pedirTela } from "../estado/navegacao";
import { pedirCusto } from "../estado/custo-acoes";
import { formatarCusto, SEM_VALOR } from "../estado/custo-formato";
import type { CustoResumo } from "../../compartilhado/custo";
import { fecharPopoverLimites, usePopoverLimites } from "../estado/popover-limites";
import { agruparPorProvedor, infoProvedor, ordenarBaldes } from "./provedores-visual";
import { BarraJanela } from "./uso/BarraJanela";
import { BaldeModelo } from "./uso/BaldeModelo";
import { LinhaProvedor } from "./uso/LinhaProvedor";

const FONTES: Record<string, string> = { claude_statusline: "statusline do Claude", codex_rollout: "rollout do Codex", openrouter_api: "API do OpenRouter", manual: "informado por você", estimado: "estimado", nenhuma: "nenhuma" };

export function FormManual({ conta, aoFim }: { conta: AccountUsage; aoFim: () => void }) {
  const [janela, setJanela] = useState<JanelaManual>("five_hour");
  const [pct, setPct] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const idPct = useId();
  const gravar = async () => {
    const n = Number(pct);
    if (pct.trim() === "" || !Number.isFinite(n) || n < 0 || n > 100) { setErro("Informe um percentual entre 0 e 100."); return; }
    if (await storeLimites.definirManual(conta.account_id, janela, n, null)) aoFim(); else setErro("Não foi possível gravar.");
  };
  return (
    <div className="popover-manual" role="group" aria-label="Informar uso manualmente">
      <select aria-label="Janela" value={janela} onChange={(e) => setJanela(e.target.value as JanelaManual)}>
        {JANELAS_MANUAIS.map((j) => <option key={j} value={j}>{nomeJanela(j)}</option>)}
      </select>
      <label htmlFor={idPct}>Uso %</label>
      <input id={idPct} inputMode="numeric" value={pct} aria-invalid={erro !== null} onChange={(e) => { setPct(e.target.value); setErro(null); }} />
      <button type="button" className="botao-mini" onClick={() => void gravar()}>Gravar</button>
      <button type="button" className="botao-mini" onClick={() => void storeLimites.limparManual(conta.account_id, janela).then(aoFim)}>Limpar</button>
      {erro !== null ? <span role="alert" className="popover-erro">{erro}</span> : null}
    </div>
  );
}

type UsoConta = { hoje: CustoResumo | null; semana: CustoResumo | null };
type ModeloCusto = { modelo: string; custo: CustoResumo };

/** Procedência da conta: "medido · statusline do Claude · há 2 min", nunca um dado sem origem. */
function Procedencia({ conta }: { conta: AccountUsage }) {
  const problema = conta.status === "auth_error" ? " · login expirado" : conta.status !== "ok" ? " · indisponível" : "";
  const medida = conta.fonte === "nenhuma" || conta.confianca === "desconhecido";
  return (
    <span className="uso-fonte" data-confianca={conta.confianca} title={medida ? "Nenhuma fonte entregou dado para esta conta" : `Dado observado ${formatarIdade(conta.idade_s)}`}>
      {medida ? SEM_DADO : `${seloConfianca(conta)} · ${FONTES[conta.fonte] ?? conta.fonte} · ${formatarIdade(conta.idade_s)}`}{problema}
    </span>
  );
}

function Modelos({ conta, rotulo, provedor, custos }: { conta: AccountUsage; rotulo: string; provedor: string; custos: ModeloCusto[] | undefined }) {
  const baldes = ordenarBaldes(Object.entries(conta.model_buckets).map(([nome, b]) => ({ nome, b, used_pct: b.used_pct })));
  const credito = ehCredito(conta);
  if (baldes.length === 0 && (custos === undefined || custos.length === 0)) {
    return credito ? null : <p className="uso-modelos-vazio">sem dado por modelo</p>;
  }
  return (
    <div className="uso-modelos" role="group" aria-label={`Por modelo, ${rotulo}`}>
      <span className="uso-rotulo-grupo">Por modelo{baldes.length === 0 ? " · custo em 7 dias" : ""}</span>
      {baldes.length > 0
        ? baldes.map(({ nome, b }) => <BaldeModelo key={nome} nome={nome} balde={b} provedor={provedor} conta={rotulo} />)
        : custos!.map((c) => <BaldeModelo key={c.modelo} nome={c.modelo} valor={formatarCusto(c.custo)} provedor={provedor} conta={rotulo} />)}
    </div>
  );
}

function ContaUso({ conta, rotulo, curto, previsoes, uso, custos }: { conta: AccountUsage; rotulo: string; curto: string; previsoes: PrevisaoZerar[] | undefined; uso: UsoConta | undefined; custos: ModeloCusto[] | undefined }) {
  const [manual, setManual] = useState(false);
  const provedor = infoProvedor(conta.provider).nome;
  const credito = ehCredito(conta);
  const semDado = !credito && conta.windows.every((w) => w.used_pct === null) && Object.keys(conta.model_buckets).length === 0;
  return (
    <li className="uso-conta" aria-label={`${provedor}, conta ${rotulo}`}>
      <div className="uso-conta-cab">
        <strong title={curto}>{rotulo}</strong>
        <Procedencia conta={conta} />
      </div>
      {credito ? (
        <div className="uso-janela"><span className="uso-janela-nome">Crédito</span><span className="uso-pct uso-credito">{typeof conta.credit?.remaining_usd === "number" ? `${formatarUsd(conta.credit.remaining_usd)} restantes` : conta.credit?.limit_usd === null ? "sem limite" : SEM_DADO}</span></div>
      ) : conta.windows.length === 0 ? (
        <p className="uso-sem-dado"><strong>{SEM_DADO}</strong> · use Atualizar ou informe manualmente.</p>
      ) : conta.windows.map((w) => {
        const p = previsoes?.find((x) => x.janela === w.kind);
        return <BarraJanela key={w.kind} janela={w} provedor={provedor} conta={rotulo} vencida={conta.vencidas.includes(w.kind)} estimado={conta.confianca === "estimado"} previsao={p !== undefined ? textoPrevisao(p) : undefined} />;
      })}
      <Modelos conta={conta} rotulo={rotulo} provedor={provedor} custos={custos} />
      <div className="uso-custo"><span>hoje · 7 d</span><span title="Custo equivalente em API, pelo uso observado">{uso?.hoje == null ? SEM_VALOR : formatarCusto(uso.hoje)} · {uso?.semana == null ? SEM_VALOR : formatarCusto(uso.semana)}</span></div>
      <div className="popover-acoes-conta">
        <button type="button" className="botao-mini" aria-label={`Atualizar ${rotulo}`} onClick={() => void storeLimites.atualizar(conta.account_id)}>Atualizar</button>
        {!credito ? <button type="button" className="botao-mini" aria-expanded={manual} onClick={() => setManual((m) => !m)}>Informar manualmente</button> : null}
        {semDado ? <span className="uso-detalhe">sem leitura nesta conta</span> : null}
      </div>
      {manual ? <FormManual conta={conta} aoFim={() => setManual(false)} /> : null}
    </li>
  );
}

/** Popover não modal (≤ 100 ms), só renderiza aberto: resumo geral, depois provedor → conta → janelas e modelos. */
export function PopoverLimites() {
  const aberto = usePopoverLimites();
  const { contas, rotulos, carregando, erro, geral } = useLimites();
  const caixa = useRef<HTMLDivElement>(null);
  const [previsoes, setPrevisoes] = useState<Record<string, PrevisaoZerar[]>>({});
  const [usoContas, setUsoContas] = useState<Record<string, UsoConta>>({});
  const [custosModelo, setCustosModelo] = useState<Record<string, ModeloCusto[]>>({});

  useEffect(() => {
    if (!aberto) return;
    const anterior = document.activeElement as HTMLElement | null;
    caixa.current?.focus();
    const api = ade()?.limites;
    if (typeof api?.previsao === "function") {
      for (const c of storeLimites.obter().contas) {
        void api.previsao(c.account_id).then((p) => setPrevisoes((m) => ({ ...m, [c.account_id]: p }))).catch(() => undefined);
      }
    }
    // custo por conta (hoje e 7 d) e por modelo (7 d, só contas sem balde por modelo), do agregado materializado; sem a API mostra "—"
    const custo = ade()?.custo;
    if (typeof custo?.relatorio === "function") {
      const agora = Date.now();
      const intervalo = (horas: number) => ({ desde: new Date(agora - horas * 3_600_000).toISOString(), ate: new Date(agora).toISOString() });
      const pedir = (horas: number) => custo.relatorio({ agrupar: "conta", ...intervalo(horas), limite: 200 }).catch(() => null);
      void Promise.all([pedir(24), pedir(168)]).then(([h, w]) => {
        const m: Record<string, UsoConta> = {};
        for (const l of h?.linhas ?? []) m[l.chave] = { hoje: l.custo, semana: m[l.chave]?.semana ?? null };
        for (const l of w?.linhas ?? []) m[l.chave] = { hoje: m[l.chave]?.hoje ?? null, semana: l.custo };
        setUsoContas(m);
      });
      for (const c of storeLimites.obter().contas.filter((x) => Object.keys(x.model_buckets).length === 0)) {
        void custo.relatorio({ agrupar: "modelo", ...intervalo(168), filtros: { conta_id: c.account_id }, limite: 5 })
          .then((r) => setCustosModelo((m) => ({ ...m, [c.account_id]: r.linhas.filter((l) => l.chave !== "").map((l) => ({ modelo: l.chave, custo: l.custo })) })))
          .catch(() => undefined);
      }
    }
    return () => { if (anterior?.isConnected) anterior.focus(); };
  }, [aberto]);

  const grupos = useMemo(() => agruparPorProvedor(contas), [contas]);
  if (!aberto) return null;
  const chip = textoChipGeral(geral, rotulos);
  const piorConta = geral?.pior != null ? contas.find((c) => c.account_id === geral.pior!.conta_id) : undefined;
  return (
    <div
      ref={caixa}
      className="popover-limites"
      role="dialog"
      aria-label="Cotas e limites"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); fecharPopoverLimites(); } }}
    >
      <div className="popover-topo">
        <strong>Consumo</strong>
        <span className="popover-fonte">{geral !== null ? `${geral.cobertura.com_dado}/${geral.cobertura.total} com dado` : ""}</span>
        <button type="button" className="botao-mini" aria-label="Fechar" onClick={fecharPopoverLimites}>×</button>
      </div>
      <div className="popover-acoes-topo">
        <button type="button" className="botao-mini" disabled={carregando} onClick={() => void storeLimites.atualizar()}>{carregando ? "Atualizando…" : "Atualizar"}</button>
        <button type="button" className="botao-mini" onClick={() => { fecharPopoverLimites(); pedirTela("consumo"); }}>Abrir Consumo</button>
        <button type="button" className="botao-mini" onClick={() => { fecharPopoverLimites(); pedirCusto("detalhe"); }}>Detalhe por uso</button>
      </div>
      {geral !== null && geral.cobertura.total > 0 ? (
        <p className="uso-resumo" data-tom={chip.estado.tom}>
          {piorConta !== undefined ? <><span className="uso-resumo-rot">Pior caso</span> <strong>{infoProvedor(piorConta.provider).nome} · {nomeConta(piorConta, rotulos[piorConta.account_id])}</strong></> : <strong>Sem dado de cota</strong>}
          <span className="uso-resumo-num">{geral.pior !== null ? `${formatarPct(geral.pior.used_pct)}${chip.estado.sinal === "▲" || chip.estado.sinal === "!" ? ` ${chip.estado.sinal}` : ""} · ` : ""}folga média {formatarPct(geral.folga_media_pct)}</span>
        </p>
      ) : null}
      {erro !== null ? <p role="alert" className="popover-erro">{erro}</p> : null}
      {contas.length === 0 ? <p className="popover-vazio">Nenhuma conta com limites ainda. Instale e entre numa CLI: a Conta padrão aparece sozinha em Provedores. O app usa o login da CLI e nunca lê credenciais.</p> : (
        <div className="uso-provedores" role="group" aria-label="Contas por provedor">
          {grupos.map((g) => (
            <LinhaProvedor key={g.provedor.id} provedor={g.provedor.id} contas={g.itens.length}>
              <ul className="uso-contas" aria-label={`Contas ${g.provedor.nome}`}>
                {g.itens.map((c) => <ContaUso key={c.account_id} conta={c} rotulo={nomeConta(c, rotulos[c.account_id])} curto={rotulos[c.account_id] ?? c.account_id} previsoes={previsoes[c.account_id]} uso={usoContas[c.account_id]} custos={custosModelo[c.account_id]} />)}
              </ul>
            </LinhaProvedor>
          ))}
        </div>
      )}
    </div>
  );
}
