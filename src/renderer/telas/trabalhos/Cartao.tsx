import type { Trabalho } from "../../../nucleo/metodo/tipos";
import { Sinaleira } from "../metodo/Sinaleira";
import { chipDoTrabalho, formatarRelativo, miniRastro, progressoTasks, raioDoTrabalho, tipoPortfolio } from "./portfolio";

const ROTULO_SEG = { concluida: "concluídas", em_andamento: "em andamento", bloqueada: "bloqueadas", pendente: "pendentes" } as const;

/** Uma tira de segmentos, um por task, na ordem do plano: o "pulso" do trabalho num relance. */
export function MiniRastro({ t }: { t: Trabalho }) {
  const m = miniRastro(t);
  if (m.total === 0) return <span className="trab-rastro trab-rastro-vazio" role="img" aria-label="Sem plano de tasks ainda" />;
  const c = m.contagem;
  const texto = (Object.keys(ROTULO_SEG) as (keyof typeof ROTULO_SEG)[]).map((k) => `${c[k]} ${ROTULO_SEG[k]}`).join(", ");
  return (
    <span className="trab-rastro" role="img" aria-label={`Tasks: ${texto}`}>
      {m.segmentos.map((s, i) => <i key={i} data-seg={s} />)}
    </span>
  );
}

export function BarraProgresso({ t }: { t: Trabalho }) {
  const p = progressoTasks(t);
  return (
    <span className="trab-progresso">
      <span className="trab-barra" role="progressbar" aria-label="Tasks concluídas" aria-valuemin={0} aria-valuemax={Math.max(1, p.total)} aria-valuenow={p.feitas}><i style={{ width: `${p.pct}%` }} /></span>
      <span className="trab-progresso-texto">{p.total === 0 ? "sem tasks" : `${p.feitas}/${p.total} tasks`}</span>
    </span>
  );
}

export function EtiquetaRaio({ t, curta = false }: { t: Trabalho; curta?: boolean }) {
  const r = raioDoTrabalho(t);
  return r === null ? null : <span className="met-chip trab-raio" data-modo={r.alerta ? "bloqueio" : undefined} title={r.rotulo}>{curta ? r.rotulo.replace("Raio ", "").replace(" aprovado", " ✓") : r.rotulo}</span>;
}

export function ChipEstado({ t }: { t: Trabalho }) {
  const c = chipDoTrabalho(t);
  return <span className="met-fase-chip" data-fase={c.fase}>{c.rotulo}</span>;
}

interface Props { t: Trabalho; aberto: boolean; aoAbrir: (id: string) => void; agora: number }

/** Cartão da visão em colunas (altura fixa: a coluna é virtualizada). */
export function Cartao({ t, aberto, aoAbrir, agora }: Props) {
  const tipo = tipoPortfolio(t);
  return (
    <button type="button" className="trab-cartao" data-tipo={tipo.id} aria-current={aberto ? "true" : undefined} onClick={() => aoAbrir(t.id)} aria-label={`${t.titulo}, ${tipo.rotulo}, ${chipDoTrabalho(t).rotulo}`}>
      <span className="trab-cartao-topo">
        <span className="met-chip">{tipo.rotulo}</span>
        <ChipEstado t={t} />
      </span>
      <b className="trab-cartao-titulo">{t.titulo}</b>
      <BarraProgresso t={t} />
      <MiniRastro t={t} />
      <span className="trab-cartao-pe">
        <time dateTime={t.ultima_atividade ?? undefined} title={t.ultima_atividade ?? undefined}>{formatarRelativo(t.ultima_atividade, agora)}</time>
        <EtiquetaRaio t={t} curta />
        <Sinaleira sinaleira={t.sinaleira} compacta />
      </span>
    </button>
  );
}
