// Máquina de estados da instalação (D-472): etapas na ordem, barra determinística por etapa, terminais `concluida|falhou|cancelada`. Pura.
import { ETAPAS_SUITE, type EtapaSuite, type EtapaSuiteId, type FalhaSuite, type FaseInstalacao, type ResumoSuite } from "./modelo";

export interface EstadoInstalacao {
  fase: FaseInstalacao;
  etapas: EtapaSuite[];
  /** fração 0–1 já feita DENTRO da etapa ativa */
  sub: number;
  falha: FalhaSuite | null;
  resumo: ResumoSuite | null;
}

export type EventoInstalacao =
  | { t: "etapa"; id: EtapaSuiteId }
  | { t: "sub"; fracao: number }
  | { t: "falhou"; falha: FalhaSuite }
  | { t: "cancelada" }
  | { t: "concluida"; resumo: ResumoSuite };

export const estadoInicial = (): EstadoInstalacao => ({
  fase: "rodando",
  etapas: ETAPAS_SUITE.map((e) => ({ id: e.id, rotulo: e.rotulo, situacao: "pendente" })),
  sub: 0,
  falha: null,
  resumo: null,
});

const indice = (id: EtapaSuiteId): number => ETAPAS_SUITE.findIndex((e) => e.id === id);
export const terminal = (e: EstadoInstalacao): boolean => e.fase !== "rodando";

/** Percentual 0–100: soma do peso das etapas `ok` + a fração da ativa. Monotônico dentro de uma instalação. */
export function percentualDe(e: EstadoInstalacao): number {
  if (e.fase === "concluida") return 100;
  let p = 0;
  for (const [i, et] of e.etapas.entries()) {
    const peso = ETAPAS_SUITE[i]?.peso ?? 0;
    if (et.situacao === "ok" || et.situacao === "pulada") p += peso;
    else if (et.situacao === "ativa" || et.situacao === "falhou") p += peso * Math.min(1, Math.max(0, e.sub));
  }
  return Math.min(99, Math.round(p));
}

export function reduzir(e: EstadoInstalacao, ev: EventoInstalacao): EstadoInstalacao {
  if (terminal(e)) return e;
  switch (ev.t) {
    case "etapa": {
      const alvo = indice(ev.id);
      if (alvo < 0) return e;
      const ativa = e.etapas.findIndex((x) => x.situacao === "ativa");
      if (ativa >= alvo) return e; // nunca volta
      const etapas = e.etapas.map((x, i): EtapaSuite => (i < alvo ? { ...x, situacao: x.situacao === "pendente" || x.situacao === "ativa" ? "ok" : x.situacao } : i === alvo ? { ...x, situacao: "ativa" } : x));
      return { ...e, etapas, sub: 0 };
    }
    case "sub": {
      const f = Number.isFinite(ev.fracao) ? Math.min(1, Math.max(0, ev.fracao)) : 0;
      return f <= e.sub ? e : { ...e, sub: f };
    }
    case "falhou": {
      const ativa = e.etapas.findIndex((x) => x.situacao === "ativa");
      const marcar = ativa >= 0 ? ativa : Math.max(0, indice(ev.falha.etapa));
      const etapas = e.etapas.map((x, i): EtapaSuite => (i === marcar ? { ...x, situacao: "falhou" } : x));
      return { ...e, fase: "falhou", etapas, falha: ev.falha };
    }
    case "cancelada": {
      const etapas = e.etapas.map((x): EtapaSuite => (x.situacao === "ativa" ? { ...x, situacao: "falhou" } : x));
      return { ...e, fase: "cancelada", etapas };
    }
    case "concluida": {
      const etapas = e.etapas.map((x): EtapaSuite => ({ ...x, situacao: "ok" }));
      return { ...e, fase: "concluida", etapas, sub: 1, resumo: ev.resumo };
    }
  }
}
