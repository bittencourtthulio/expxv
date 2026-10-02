import { useEffect, useMemo, useState } from "react";
import type { ApiRelatorios, PacoteDetalhe, PreviaPacote } from "../../../compartilhado/relatorios";
import { avisar } from "../../estado/avisos";
import { Carregando, FaixaErro } from "./comum";
import { ROTULO_ESTADO, ROTULO_ETAPA, ROTULO_MODO, acoesDoPacote, nomeAmigavel, tamanhoPt, textoDoErro } from "./logica";

export interface PropsPainel { api: ApiRelatorios; ws: string; pacote: PacoteDetalhe; recarregar: () => void; aoSelecionar: (id: string) => void }

/** Aba Pacotes: ações do pacote (regenerar, aprovar, exportar) e a prévia segura do arquivo escolhido (HTML em `iframe sandbox` SEM scripts; o resto como texto). */
export function Detalhe({ api, ws, pacote, recarregar, aoSelecionar }: PropsPainel) {
  const [arquivo, setArquivo] = useState<string>("usuario.html");
  const [escopo, setEscopo] = useState<"todos" | "um">("todos");
  const [previa, setPrevia] = useState<PreviaPacote | null>(null);
  const [erroPrevia, setErroPrevia] = useState<unknown>(null);
  const [ocupado, setOcupado] = useState(false);
  const acoes = useMemo(() => acoesDoPacote(pacote), [pacote]);
  const nomes = pacote.arquivos.map((a) => a.nome);
  const escolhido = nomes.includes(arquivo) ? arquivo : (nomes[0] ?? "");

  useEffect(() => {
    if (pacote.estado !== "pronto" || escolhido === "") { setPrevia(null); return; }
    let vivo = true;
    setPrevia(null);
    setErroPrevia(null);
    void api.previa(ws, pacote.id, escolhido).then((p) => { if (vivo) setPrevia(p); }, (e: unknown) => { if (vivo) setErroPrevia(e); });
    return () => { vivo = false; };
  }, [api, ws, pacote.id, pacote.estado, pacote.aprovado_em, escolhido]);

  const rodar = (fn: () => Promise<void>): void => { setOcupado(true); void fn().catch((e: unknown) => avisar(textoDoErro(e), "erro")).finally(() => setOcupado(false)); };
  const regenerar = (): void => rodar(async () => {
    const r = await api.regenerar(ws, pacote.id);
    avisar(r.reaproveitado ? "Nada mudou desde este pacote." : "Nova versão gerada.", r.reaproveitado ? "info" : "sucesso");
    aoSelecionar(r.pacote_id);
    recarregar();
  });
  const aprovar = (valor: boolean): void => rodar(async () => { await api.aprovar(ws, pacote.id, valor); avisar(valor ? "Texto do cliente aprovado." : "Aprovação desfeita: voltou a rascunho.", "sucesso"); recarregar(); });
  const exportar = (modo: "pasta" | "zip"): void => rodar(async () => {
    const r = await api.exportar(ws, pacote.id, escopo === "todos" ? "todos" : [escolhido], modo);
    if (!r.cancelado) avisar(`Exportado para ${r.destino_rotulo ?? "a pasta escolhida"}.`, "sucesso");
  });

  return (
    <div className="rl-detalhe">
      <header className="rl-cab">
        <h3>{pacote.titulo}</h3>
        <span className="rl-selo" data-estado={pacote.estado}>{pacote.estado === "gerando" ? `${ROTULO_ETAPA[pacote.etapa ?? ""] ?? "Gerando"}…` : ROTULO_ESTADO[pacote.estado]}</span>
        <span className="rl-selo" data-revisao={pacote.revisao_usuario}>{pacote.revisao_usuario === "aprovado" ? "texto aprovado" : "rascunho"}</span>
        <span className="rl-meta">{ROTULO_MODO[pacote.modo_redacao]} · {tamanhoPt(pacote.bytes)}</span>
      </header>
      {pacote.estado === "falhou" && <FaixaErro erro={pacote.motivo_falha ?? "O pacote não pôde ser gerado."} aoTentar={regenerar} />}
      {pacote.estado === "pronto" && pacote.revisao_usuario === "rascunho" && <p className="rl-faixa" data-tom="info" role="note">Rascunho: o texto do cliente só vale depois que você aprovar. Nada é publicado ou enviado sozinho.</p>}
      <div className="rl-acoes" role="group" aria-label="Ações do pacote">
        <button type="button" className="rl-btn" onClick={regenerar} disabled={ocupado || !acoes.podeRegenerar}>Regenerar</button>
        {acoes.podeDesaprovar
          ? <button type="button" className="rl-btn" onClick={() => aprovar(false)} disabled={ocupado}>Desfazer aprovação</button>
          : <button type="button" className="rl-btn" data-primario onClick={() => aprovar(true)} disabled={ocupado || !acoes.podeAprovar} title={acoes.motivoAprovar ?? "Aprovar o texto do cliente"}>Aprovar texto do cliente</button>}
        <label className="rl-campo"><span>Exportar</span>
          <select aria-label="O que exportar" value={escopo} onChange={(e) => setEscopo(e.target.value as "todos" | "um")} disabled={!acoes.podeExportar}>
            <option value="todos">Todos os arquivos</option>
            <option value="um">Só o arquivo aberto</option>
          </select>
        </label>
        <button type="button" className="rl-btn" onClick={() => exportar("pasta")} disabled={ocupado || !acoes.podeExportar}>Exportar para pasta…</button>
        <button type="button" className="rl-btn" onClick={() => exportar("zip")} disabled={ocupado || !acoes.podeExportar}>Exportar ZIP…</button>
      </div>
      {escopo === "todos" && acoes.podeExportar && <p className="rl-meta">Exportar tudo inclui arquivos internos (relatório técnico, tarefas e CSV): confira antes de enviar ao cliente.</p>}
      {!acoes.podeAprovar && !acoes.podeDesaprovar && acoes.motivoAprovar !== null && pacote.estado === "pronto" && <p className="rl-meta">{acoes.motivoAprovar}</p>}
      {pacote.avisos.length > 0 && (
        <details className="rl-avisos">
          <summary>{pacote.avisos.length} aviso(s) e lacuna(s)</summary>
          <ul>{pacote.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      )}
      {pacote.estado === "pronto" && (
        <>
          <label className="rl-campo"><span>Arquivo</span>
            <select aria-label="Arquivo" value={escolhido} onChange={(e) => setArquivo(e.target.value)}>
              {pacote.arquivos.map((a) => <option key={a.nome} value={a.nome}>{nomeAmigavel(a.nome)} — {a.publico === "cliente" ? "para o cliente" : a.publico === "gestao" ? "para a gestão" : a.publico === "maquina" ? "para máquinas" : "interno"}</option>)}
            </select>
          </label>
          {erroPrevia !== null && <FaixaErro erro={erroPrevia} />}
          {erroPrevia === null && previa === null && <Carregando texto="Carregando prévia…" />}
          {previa !== null && !previa.integro && <p className="rl-faixa" role="alert">Este arquivo foi alterado fora do aplicativo e não confere com o registro. Gere o pacote de novo.</p>}
          {previa !== null && (previa.tipo === "html"
            // `sandbox=""` = sem scripts, sem formulários, sem navegação: o HTML do pacote é conteúdo, nunca código
            ? <iframe className="rl-previa" title={`Prévia: ${nomeAmigavel(escolhido)}`} sandbox="" srcDoc={previa.conteudo} />
            : <pre className="rl-previa-texto" tabIndex={0} aria-label={`Prévia: ${nomeAmigavel(escolhido)}`}>{previa.conteudo}</pre>)}
        </>
      )}
    </div>
  );
}
