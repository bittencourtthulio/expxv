import "../versionamento.css";
import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Diff, LinhaDiff } from "../../../../nucleo/vcs/tipos";
import { VirtualLista } from "../../../componentes/VirtualLista";
import { achatar, paraLadoALado, type LinhaLado, type LinhaPlana } from "./achatar";
import { familiaDe, tokenizarLinha } from "./tokenizar";

export const ALTURA_LINHA_DIFF = 18;

export interface AcoesDiff {
  /** `estagiar` (diff não staged) ou `desestagiar` (diff staged). */
  sentido: "estagiar" | "desestagiar";
  aoHunk: (arq: number, hunk: number) => void;
  /** índices em `Hunk.linhas` */
  aoLinhas: (arq: number, hunk: number, linhas: number[]) => void;
}

interface Props {
  diff: Diff | null;
  carregando?: boolean;
  modo?: "unificado" | "lado";
  ignorarEspaco?: boolean;
  acoes?: AcoesDiff | undefined;
  rotulo?: string;
}

function Realce({ texto, familia }: { texto: string; familia: ReturnType<typeof familiaDe> }): ReactNode {
  const tokens = useMemo(() => tokenizarLinha(texto, familia), [texto, familia]);
  return <>{tokens.map((t, i) => (t.t === "texto" ? t.s : <span key={i} className={`vc-tk-${t.t}`}>{t.s}</span>))}</>;
}

function Conteudo({ l, familia }: { l: LinhaDiff; familia: ReturnType<typeof familiaDe> }): ReactNode {
  if (l.partes !== undefined && l.partes.length > 0) {
    return <>{l.partes.map((p, i) => <span key={i} className={p.tipo === "ctx" ? undefined : `vc-palavra-${p.tipo}`}>{p.texto}</span>)}</>;
  }
  return <Realce texto={l.texto} familia={familia} />;
}

const sinal = (t: LinhaDiff["tipo"]): string => (t === "add" ? "+" : t === "del" ? "-" : t === "mod" ? "~" : " ");

/**
 * Visualizador de diff leve: virtualizado POR LINHA (um diff de MB é só um vetor), unificado ou lado a lado, ações por hunk/linha,
 * realce de sintaxe só do que está visível, teclado (j/k hunks, n/p arquivos, s estagiar, u desestagiar, espaço marca linha).
 */
export const DiffView = memo(function DiffView({ diff, carregando = false, modo = "unificado", ignorarEspaco = false, acoes, rotulo = "Diff" }: Props) {
  const [expandir, setExpandir] = useState(false);
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [foco, setFoco] = useState(0);
  const [rolar, setRolar] = useState<{ indice: number; n: number } | undefined>(undefined);
  const contador = useRef(0);

  const planas = useMemo(() => (diff === null ? [] : achatar(diff, { ignorarEspaco, expandirGrandes: expandir })), [diff, ignorarEspaco, expandir]);
  const linhas: Array<LinhaPlana | LinhaLado> = useMemo(() => (modo === "lado" ? paraLadoALado(planas) : planas), [planas, modo]);
  const familias = useMemo(() => (diff === null ? [] : diff.arquivos.map((f) => familiaDe(f.caminho))), [diff]);
  const marcos = useMemo(() => {
    const hunks: number[] = [];
    const arqs: number[] = [];
    linhas.forEach((l, i) => { if (l.k === "hunk") hunks.push(i); else if (l.k === "arq") arqs.push(i); });
    return { hunks, arqs };
  }, [linhas]);

  const ir = useCallback((i: number) => { contador.current++; setFoco(i); setRolar({ indice: i, n: contador.current }); }, []);
  const proximo = (lista: number[], dir: 1 | -1): void => {
    const alvo = dir === 1 ? lista.find((i) => i > foco) : [...lista].reverse().find((i) => i < foco);
    if (alvo !== undefined) ir(alvo);
  };
  const hunkDoFoco = (): { arq: number; hunk: number } | null => {
    for (let i = Math.min(foco, linhas.length - 1); i >= 0; i--) { const l = linhas[i]; if (l !== undefined && l.k === "hunk") return { arq: l.arq, hunk: l.hunk }; }
    for (let i = foco; i < linhas.length; i++) { const l = linhas[i]; if (l !== undefined && l.k === "hunk") return { arq: l.arq, hunk: l.hunk }; }
    return null;
  };
  const chaveLinha = (arq: number, hunk: number, idx: number): string => `${arq}:${hunk}:${idx}`;
  const alternar = (chave: string): void => setMarcadas((m) => { const n = new Set(m); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });

  const aoTeclar = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "j") { e.preventDefault(); proximo(marcos.hunks, 1); }
    else if (e.key === "k") { e.preventDefault(); proximo(marcos.hunks, -1); }
    else if (e.key === "n") { e.preventDefault(); proximo(marcos.arqs, 1); }
    else if (e.key === "p") { e.preventDefault(); proximo(marcos.arqs, -1); }
    else if ((e.key === "s" || e.key === "u") && acoes !== undefined) {
      const h = hunkDoFoco();
      if (h !== null && ((e.key === "s" && acoes.sentido === "estagiar") || (e.key === "u" && acoes.sentido === "desestagiar"))) { e.preventDefault(); acoes.aoHunk(h.arq, h.hunk); }
    }
  };

  const linhasMarcadasDoHunk = (arq: number, hunk: number): number[] => [...marcadas].filter((c) => c.startsWith(`${arq}:${hunk}:`)).map((c) => Number(c.split(":")[2]));
  const rotuloAcao = acoes?.sentido === "desestagiar" ? "Remover do stage" : "Estagiar";

  const renderLinha = (l: LinhaPlana | LinhaLado, i: number): ReactNode => {
    const emFoco = i === foco;
    switch (l.k) {
      case "arq": {
        const f = l.f;
        return (
          <div className="vc-d-arq" data-foco={emFoco || undefined}>
            <strong>{f.estado === "renomeado" || f.estado === "copiado" ? `${f.caminhoAntigo} → ${f.caminho}` : f.caminho}</strong>
            <span className="vc-d-meta">{f.estado}{f.similaridade !== undefined ? ` ${f.similaridade}%` : ""} · <span className="vc-mais">+{f.insercoes}</span> <span className="vc-menos">-{f.delecoes}</span>{f.mudouModo ? ` · modo ${f.modoAntigo ?? "?"} → ${f.modoNovo ?? "?"}` : ""}{f.eol === "crlf" ? " · CRLF" : ""}</span>
          </div>
        );
      }
      case "aviso":
        return (
          <div className="vc-d-aviso" role="note">
            {l.texto}
            {l.texto.startsWith("Diff grande") ? <button type="button" className="vc-mini" onClick={() => setExpandir(true)}>Mostrar tudo</button> : null}
          </div>
        );
      case "hunk": {
        const sel = linhasMarcadasDoHunk(l.arq, l.hunk);
        return (
          <div className="vc-d-hunk" data-foco={emFoco || undefined}>
            <code>{l.h.cabecalho}</code>
            {acoes !== undefined ? (
              <span className="vc-d-hunk-acoes">
                <button type="button" className="vc-mini" onClick={() => acoes.aoHunk(l.arq, l.hunk)} title={`${rotuloAcao} este hunk`}>{rotuloAcao} hunk</button>
                {sel.length > 0 ? <button type="button" className="vc-mini" onClick={() => { acoes.aoLinhas(l.arq, l.hunk, sel.sort((a, b) => a - b)); setMarcadas(new Set()); }}>{rotuloAcao} {sel.length} {sel.length === 1 ? "linha" : "linhas"}</button> : null}
              </span>
            ) : null}
          </div>
        );
      }
      case "linha": {
        const marcavel = acoes !== undefined && l.l.tipo !== "ctx" && l.idx >= 0;
        const chave = chaveLinha(l.arq, l.hunk, l.idx);
        return (
          <div className="vc-d-linha" data-tipo={l.l.tipo} onClick={() => ir(i)}>
            {marcavel ? <input type="checkbox" className="vc-d-marca" aria-label={`Selecionar linha ${l.l.nova ?? l.l.antiga ?? ""}`} checked={marcadas.has(chave)} onChange={() => alternar(chave)} /> : <span className="vc-d-marca" />}
            <span className="vc-d-num">{l.l.antiga ?? ""}</span>
            <span className="vc-d-num">{l.l.nova ?? ""}</span>
            <span className="vc-d-sinal" aria-hidden="true">{sinal(l.l.tipo)}</span>
            <span className="vc-d-texto"><Conteudo l={l.l} familia={familias[l.arq] ?? "nenhuma"} /></span>
          </div>
        );
      }
      case "par": {
        const lado = (x: { l: LinhaDiff; idx: number } | null, lado: "esq" | "dir"): ReactNode => (
          <div className="vc-d-meio" data-tipo={x === null ? "vazio" : x.l.tipo}>
            <span className="vc-d-num">{x === null ? "" : lado === "esq" ? (x.l.antiga ?? "") : (x.l.nova ?? "")}</span>
            <span className="vc-d-texto">{x === null ? null : <Conteudo l={x.l} familia={familias[l.arq] ?? "nenhuma"} />}</span>
          </div>
        );
        return <div className="vc-d-par">{lado(l.esq, "esq")}{lado(l.dir, "dir")}</div>;
      }
    }
  };

  if (carregando && diff === null) return <div className="vc-d-vazio" aria-busy="true">Carregando diff…</div>;
  if (diff === null || diff.arquivos.length === 0) return <div className="vc-d-vazio">Selecione um arquivo para ver as mudanças.</div>;
  return (
    <div className="vc-diff" tabIndex={0} role="region" aria-label={rotulo} onKeyDown={aoTeclar} data-modo={modo}>
      {diff.grande ? <div className="vc-d-aviso" role="note">Diff grande: parte do conteúdo pode estar omitida.</div> : null}
      <VirtualLista itens={linhas} alturaItem={ALTURA_LINHA_DIFF} rotulo={`${rotulo} (linhas)`} chave={(_, i) => String(i)} renderItem={renderLinha} className="vc-d-lista" extra={20} rolarPara={rolar} />
    </div>
  );
});
