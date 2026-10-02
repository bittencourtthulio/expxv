// Diff lado a lado de UM membro entre a sua cópia e a fábrica nova (T-14.24 / onda 6). O membro `editado` só entra na atualização
// se o usuário ver isto e marcar, de forma explícita, "sobrescrever a minha edição". Texto puro; marcador textual (−/+) além da cor.
import { useEffect, useMemo, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { FabricaDiff } from "../../../compartilhado/squads";
import { diffDeLinhas, type LinhaDiff } from "./diff";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const MARCA: Record<LinhaDiff["tipo"], string> = { igual: " ", removida: "−", adicionada: "+", vazia: " " };

function Coluna({ titulo, linhas }: { titulo: string; linhas: LinhaDiff[] }) {
  return (
    <div className="sq-diff-col">
      <div className="sq-diff-tit">{titulo}</div>
      <pre className="sq-diff-pre" tabIndex={0} aria-label={titulo}>
        {linhas.map((l, i) => (
          <span key={i} className="sq-diff-linha" data-tipo={l.tipo}>{`${MARCA[l.tipo]} ${l.texto}\n`}</span>
        ))}
      </pre>
    </div>
  );
}

export interface PropsDiffFabrica {
  api: ApiAde["squads"] | undefined;
  slug: string;
  membro: string;
  sobrescrever: boolean;
  /** ausente = o membro não está `editado`: não há o que sobrescrever e a caixa não aparece. */
  aoSobrescrever?: (valor: boolean) => void;
}

export function DiffDaFabrica({ api, slug, membro, sobrescrever, aoSobrescrever }: PropsDiffFabrica) {
  const [diff, setDiff] = useState<FabricaDiff | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (api === undefined) return;
    let vivo = true;
    setDiff(null);
    api.fabricaDiff({ slug, membro }).then((d) => { if (vivo) setDiff(d); }).catch((e: unknown) => { if (vivo) setErro(`Não foi possível comparar: ${msg(e)}`); });
    return () => { vivo = false; };
  }, [api, slug, membro]);
  const r = useMemo(() => (diff === null ? null : diffDeLinhas(diff.atual, diff.fabrica)), [diff]);

  return (
    <div className="sq-diff" role="region" aria-label={`Diferenças de ${membro}`}>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      {diff === null && erro === null ? <div aria-busy="true" /> : null}
      {r !== null ? (
        <>
          <div className="sq-diff-cols">
            <Coluna titulo="Sua versão" linhas={r.esquerda} />
            <Coluna titulo="Fábrica (nova)" linhas={r.direita} />
          </div>
          <p className="sq-vazio" role="status">{r.diferentes === 0 ? "Sem diferenças de texto." : `${r.diferentes} linha(s) diferente(s).`}</p>
          {aoSobrescrever !== undefined ? (
            <label className="sq-diff-sobrescrever">
              <input type="checkbox" checked={sobrescrever} onChange={(e) => aoSobrescrever(e.target.checked)} />
              Sobrescrever a minha edição de <code>{membro}</code> com a versão da fábrica
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
