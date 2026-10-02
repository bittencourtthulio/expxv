// Plano e resultado da execução (Fase 14, onda 6): `plano.md` e `resultado.md` que o orquestrador grava na pasta da Missão. A UI só LÊ,
// pelo canal `squads:execucao_arquivo` (o main resolve o caminho); o texto aparece como texto puro (nunca HTML) e o aviso de truncamento
// é explícito. Carrega ao expandir e quando a chave de atualização muda (a Missão mudou), nunca em laço.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiAde } from "../../../compartilhado/ipc";
import type { ArquivoExecucao, ResultadoArquivoExecucao } from "../../../compartilhado/squads";

const ROTULO: Record<ArquivoExecucao, string> = { plano: "Plano", resultado: "Resultado" };
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface PropsArquivos {
  api: ApiAde["squads"] | undefined;
  execucaoId: string;
  /** muda quando a Missão muda (estado/portões): recarrega o que está aberto. */
  chave: string;
}

export function ArquivosDaExecucao({ api, execucaoId, chave }: PropsArquivos) {
  const [aberto, setAberto] = useState<ArquivoExecucao | null>(null);
  const [dados, setDados] = useState<Partial<Record<ArquivoExecucao, ResultadoArquivoExecucao>>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const geracao = useRef(0);

  const ler = useCallback(async (arquivo: ArquivoExecucao): Promise<void> => {
    if (api === undefined) return;
    const minha = ++geracao.current;
    setCarregando(true);
    try {
      const r = await api.lerArquivoDaExecucao({ execucao_id: execucaoId, arquivo });
      if (minha === geracao.current) { setDados((d) => ({ ...d, [arquivo]: r })); setErro(null); }
    } catch (e) { if (minha === geracao.current) setErro(`Não foi possível ler o ${ROTULO[arquivo].toLowerCase()}: ${msg(e)}`); }
    finally { if (minha === geracao.current) setCarregando(false); }
  }, [api, execucaoId]);

  useEffect(() => { if (aberto !== null) void ler(aberto); }, [aberto, chave, ler]);
  useEffect(() => { setAberto(null); setDados({}); setErro(null); }, [execucaoId]);

  const atual = aberto === null ? undefined : dados[aberto];
  return (
    <div className="sq-arquivos" role="group" aria-label="Plano e resultado da execução">
      <div className="sq-linha-botoes">
        {(Object.keys(ROTULO) as ArquivoExecucao[]).map((a) => (
          <button key={a} type="button" className="botao sq-btn" aria-pressed={aberto === a} onClick={() => setAberto(aberto === a ? null : a)}>{ROTULO[a]}</button>
        ))}
        {aberto !== null ? <button type="button" className="botao sq-btn" disabled={carregando} onClick={() => void ler(aberto)}>Atualizar</button> : null}
      </div>
      {erro !== null ? <p role="alert" className="erro-caixa">{erro}</p> : null}
      {aberto !== null && atual !== undefined ? (
        atual.existe ? (
          <>
            <pre className="sq-arquivo" tabIndex={0} aria-label={`Conteúdo do ${ROTULO[aberto].toLowerCase()}`}>{atual.texto}</pre>
            {atual.truncado ? <p className="sq-vazio" role="note">Arquivo grande: mostrando só o começo (256 KiB).</p> : null}
          </>
        ) : (
          <p className="sq-vazio" role="status">O orquestrador ainda não gravou o {ROTULO[aberto].toLowerCase()}.</p>
        )
      ) : null}
      {aberto !== null && atual === undefined && erro === null ? <div aria-busy="true" /> : null}
    </div>
  );
}
