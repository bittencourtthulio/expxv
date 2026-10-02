import { memo, useMemo } from "react";
import type { AccountUsage, AmostraLimite, ApiLimitesLike } from "./tipos";
import { useCarga } from "../../estado/carga";
import { ehCredito, formatarDuracao, nomeConta, formatarIdade, formatarPct, formatarUsd, estadoCota, SEM_DADO } from "../../estado/limites-formato";
import { EstadoVazio } from "../../componentes/EstadoVazio";
import { Sparkline } from "./graficos/Sparkline";
import type { AlertaLimite } from "../../../compartilhado/limites";
import { agruparPorProvedor, infoProvedor, ordenarBaldes } from "../../casca/provedores-visual";
import { LogoProvedor } from "../../casca/uso/LogoProvedor";
import { LinhaProvedor } from "../../casca/uso/LinhaProvedor";
import { BaldeModelo } from "../../casca/uso/BaldeModelo";

export type Agrupar = "conta" | "provedor" | "modelo" | "workspace" | "missao" | "pane";
export type Periodo = "24h" | "7d" | "30d";
export const HORAS_PERIODO: Record<Periodo, number> = { "24h": 24, "7d": 168, "30d": 720 };
export const AGRUPAR_POR_USO: readonly Agrupar[] = ["workspace", "missao", "pane"];

const reinicio = (c: AccountUsage): string => {
  const futuros = c.windows.map((w) => (w.resets_at === null ? NaN : Date.parse(w.resets_at))).filter((t) => Number.isFinite(t) && t > Date.now());
  return futuros.length === 0 ? "—" : `reseta em ${formatarDuracao((Math.min(...futuros) - Date.now()) / 1000)}`;
};

function Historico({ api, conta, janela, periodo }: { api: ApiLimitesLike | undefined; conta: AccountUsage; janela: "five_hour" | "weekly"; periodo: Periodo }) {
  const { estado, dados } = useCarga<AmostraLimite[]>(
    api?.historico === undefined ? undefined : () => {
      const ate = new Date();
      return api.historico!({ conta_id: conta.account_id, janela, desde: new Date(ate.getTime() - HORAS_PERIODO[periodo] * 3_600_000).toISOString(), ate: ate.toISOString(), max_pontos: 300 });
    },
    `${conta.account_id}|${janela}|${periodo}|${conta.fetched_at}`,
  );
  const pontos = (dados ?? []).map((a) => ({ x: Date.parse(a.ts), y: a.usado_pct }));
  const rotulo = `${janela === "five_hour" ? "5 horas" : "semanal"} de ${conta.account_id}`;
  if (estado === "indisponivel") return <span className="consumo-nota" title="Histórico indisponível neste build">indisp.</span>;
  return <Sparkline pontos={pontos} rotulo={rotulo} tracejado={janela === "weekly"} />;
}

const selosDe = (c: AccountUsage, alertas: readonly AlertaLimite[]): Array<{ t: string; tom: "aviso" | "alerta" | "info" }> => {
  const out: Array<{ t: string; tom: "aviso" | "alerta" | "info" }> = [];
  for (const a of alertas.filter((x) => x.conta_id === c.account_id)) out.push({ t: a.tipo.replace("_", " "), tom: a.tipo === "vai_estourar" ? "alerta" : a.tipo === "consumo_alto" ? "aviso" : "info" });
  const e = estadoCota(c.windows.map((w) => w.used_pct).filter((n): n is number => n !== null).sort((a, b) => b - a)[0] ?? null);
  if (e.tom === "alerta") out.push({ t: "! limite", tom: "alerta" });
  else if (e.tom === "aviso" && !out.some((o) => o.tom !== "info")) out.push({ t: "▲ consumo alto", tom: "aviso" });
  return out;
};

const Linha = memo(function Linha({ c, rotulo, api, periodo, alertas }: { c: AccountUsage; rotulo: string; api: ApiLimitesLike | undefined; periodo: Periodo; alertas: readonly AlertaLimite[] }) {
  const cred = ehCredito(c);
  const principal = c.windows.find((w) => w.kind === "five_hour") ?? c.windows[0];
  const e = estadoCota(cred ? null : principal?.used_pct ?? null, { confianca: c.confianca, idade_s: c.idade_s });
  return (
    <li className="consumo-linha" data-tom={e.tom} data-velho={e.velho || undefined}>
      <strong title={`${nomeConta(c, rotulo)} · ${infoProvedor(c.provider).nome}`}><LogoProvedor provedor={c.provider} tamanho={16} /> <span className="consumo-nome">{nomeConta(c, rotulo)}</span> <span className="consumo-nota">{infoProvedor(c.provider).nome}</span></strong>
      {cred ? <><span>crédito</span><span /></> : <><Historico api={api} conta={c} janela="five_hour" periodo={periodo} /><Historico api={api} conta={c} janela="weekly" periodo={periodo} /></>}
      <span aria-label={`Uso atual ${formatarPct(principal?.used_pct)}`}>{cred ? formatarUsd(c.credit?.remaining_usd) : `${e.estimado ? "≈" : ""}${formatarPct(principal?.used_pct)}${e.sinal === "▲" || e.sinal === "!" ? ` ${e.sinal}` : ""}`}</span>
      <span>{cred ? (c.credit?.limit_usd === null ? "sem limite" : `limite ${formatarUsd(c.credit?.limit_usd)}`) : reinicio(c)}</span>
      <span>
        {selosDe(c, alertas).map((s) => <span key={s.t} className="consumo-selo" data-tom={s.tom}>{s.t}</span>)}
        <span className="consumo-nota">{c.fonte === "nenhuma" ? SEM_DADO : c.fonte} · {formatarIdade(c.idade_s)}</span>
      </span>
    </li>
  );
});

export function VisaoGeral({ contas, rotulos, api, periodo, agrupar, filtro, alertas }: {
  contas: readonly AccountUsage[]; rotulos: Readonly<Record<string, string>>; api: ApiLimitesLike | undefined; periodo: Periodo; agrupar: Agrupar; filtro: string; alertas: readonly AlertaLimite[];
}) {
  const f = filtro.trim().toLowerCase();
  const visiveis = useMemo(() => contas.filter((c) => f === "" || `${rotulos[c.account_id] ?? ""} ${c.provider} ${c.account_id}`.toLowerCase().includes(f)), [contas, rotulos, f]);
  if (AGRUPAR_POR_USO.includes(agrupar)) {
    return <EstadoVazio icone="consumo" titulo="Disponível depois da ingestão de uso (fase 10)" texto={`O agrupamento por ${agrupar === "missao" ? "Missão" : agrupar === "pane" ? "Pane" : "workspace"} usa o uso observado por sessão, que ainda não é coletado. Use conta, provedor ou modelo.`} />;
  }
  if (contas.length === 0) return <EstadoVazio icone="consumo" titulo="Nenhuma conta com limites" texto="Instale uma CLI (Claude Code, Codex) e entre nela: a Conta padrão aparece sozinha em Provedores. O app só lê a cota que a CLI já informa e nunca toca em credenciais." />;
  if (visiveis.length === 0) return <EstadoVazio icone="busca" titulo="Nada corresponde ao filtro" texto="Limpe o filtro para ver todas as contas." />;
  const cab = (
    <li className="consumo-linha consumo-linha-cab" aria-hidden="true"><span>Conta</span><span>5 h</span><span>Semanal</span><span>Agora</span><span>Zera</span><span>Fonte e alertas</span></li>
  );
  if (agrupar === "modelo") {
    const comBalde = visiveis.filter((c) => Object.keys(c.model_buckets).length > 0);
    return comBalde.length === 0 ? <EstadoVazio icone="consumo" titulo="Sem dado por modelo" texto="Nenhuma conta informa o consumo por modelo no momento." /> : (
      <ul className="consumo-lista consumo-por-modelo" aria-label="Consumo por modelo">
        {agruparPorProvedor(comBalde).map((g) => (
          <LinhaProvedor key={g.provedor.id} tag="li" provedor={g.provedor.id} contas={g.itens.length}>
            {g.itens.map((c) => (
              <div key={c.account_id} className="consumo-modelos-conta">
                <strong className="consumo-nota">{nomeConta(c, rotulos[c.account_id])}</strong>
                {ordenarBaldes(Object.entries(c.model_buckets).map(([nome, b]) => ({ nome, b, used_pct: b.used_pct }))).map(({ nome, b }) => (
                  <BaldeModelo key={nome} nome={nome} balde={b} provedor={g.provedor.nome} conta={nomeConta(c, rotulos[c.account_id])} />
                ))}
              </div>
            ))}
          </LinhaProvedor>
        ))}
      </ul>
    );
  }
  if (agrupar === "provedor") {
    const provedores = agruparPorProvedor(visiveis);
    return (
      <ul className="consumo-lista" aria-label="Consumo por provedor">
        {cab}
        {provedores.map((g) => (
          <li key={g.provedor.id} className="consumo-grupo-item"><div className="consumo-grupo"><LogoProvedor provedor={g.provedor.id} tamanho={16} /> {g.provedor.nome}</div>
            <ul>{g.itens.map((c) => <Linha key={c.account_id} c={c} rotulo={rotulos[c.account_id] ?? c.account_id} api={api} periodo={periodo} alertas={alertas} />)}</ul>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="consumo-lista" aria-label="Consumo por conta">
      {cab}
      {visiveis.map((c) => <Linha key={c.account_id} c={c} rotulo={rotulos[c.account_id] ?? c.account_id} api={api} periodo={periodo} alertas={alertas} />)}
    </ul>
  );
}
