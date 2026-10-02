import { useEffect, useState } from "react";
import type { ComandoSugerido, GestoMetodo, ResultadoDisparo } from "../../../compartilhado/dominio";
import type { Trabalho } from "../../../nucleo/metodo/tipos";
import { moduloDoGesto } from "../../../nucleo/suite/modulos";
import { ade } from "../../ade";
import { entregue, storeExecucaoMetodo, type StoreExecucaoMetodo } from "../../estado/execucao-metodo";
import { useModulosDesligados } from "../../estado/suite";

interface Gesto { gesto: GestoMetodo; rotulo: string }

const DO_TRABALHO: readonly Gesto[] = [
  { gesto: "retomar", rotulo: "Avançar" },
  { gesto: "auditar", rotulo: "Auditar" },
  { gesto: "qa", rotulo: "QA" },
  { gesto: "entrega_check", rotulo: "Conferir entrega" },
  { gesto: "entrega_atencao", rotulo: "Atenção do diff" },
  { gesto: "entrega_qa", rotulo: "Pacote de QA" },
  { gesto: "entrega_pr", rotulo: "Abrir PR" },
];

interface AcaoHumana { rotulo: string; motivo: string; caminho: string }

/** Ações que são sempre humanas: nunca disparam, só levam ao arquivo (caminho relativo). */
export function acoesHumanas(t: Trabalho): AcaoHumana[] {
  const r: AcaoHumana[] = [];
  if (t.prodx && t.prodx.veredito && !t.prodx.assinado) {
    r.push({ rotulo: "Assinatura do prodx", motivo: "A assinatura do veredito é sempre humana; a skill nunca preenche.", caminho: `${t.pasta}/VEREDITO.md` });
  }
  if (t.raio && t.raio.faixa?.toLowerCase() === "alto" && !t.raio.aprovado) {
    r.push({ rotulo: "Aprovação de raio ALTO", motivo: "Mudança de raio ALTO só avança com aprovação humana no arquivo.", caminho: `${t.pasta}/RAIO.md` });
  }
  if (t.entrega) {
    r.push({ rotulo: "Revisar entrega (mergex-revisar)", motivo: "A revisão do diff é sempre humana.", caminho: t.entrega.arquivo });
  }
  return r;
}

interface Painel {
  rotulo: string;
  gesto: GestoMetodo | null;
  sugestao: ComandoSugerido | null;
  caminho?: string | undefined;
  motivo?: string | undefined;
  resultado: ResultadoDisparo | null;
  erro: string | null;
}

const MENSAGEM_AGUARDANDO = "O Pane está aguardando você: o comando não é reenviado. Responda no Pane e tente de novo.";

export function AcoesMetodo({ workspaceId, trabalho, execucao = storeExecucaoMetodo }: { workspaceId: string; trabalho: Trabalho; execucao?: StoreExecucaoMetodo }) {
  useEffect(() => { void execucao.carregarPreferencia(); }, [execucao]);
  const [painel, setPainel] = useState<Painel | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // módulo desligado no projeto (D-480): o gesto que o usa some daqui (o main também recusa o comando)
  const desligados = useModulosDesligados(workspaceId);
  const gestos = DO_TRABALHO.filter((g) => {
    const m = moduloDoGesto(g.gesto, trabalho.tipo);
    return m === null || !desligados.has(m);
  });

  const sugerir = async (g: Gesto) => {
    const api = ade();
    if (!api) return;
    setOcupado(true);
    try {
      const sugestao = await api.metodo.comandoSugerido(workspaceId, trabalho.id, g.gesto, null);
      setPainel({ rotulo: g.rotulo, gesto: g.gesto, sugestao, resultado: null, erro: null, caminho: trabalho.entrega?.arquivo ?? trabalho.pasta, motivo: sugestao.motivo_bloqueio ?? undefined });
    } catch (e) {
      setPainel({ rotulo: g.rotulo, gesto: g.gesto, sugestao: null, resultado: null, erro: e instanceof Error ? e.message : "Falha ao montar o comando." });
    }
    setOcupado(false);
  };

  const disparar = async () => {
    const api = ade();
    if (!api || !painel?.gesto || !painel.sugestao || painel.sugestao.somente_humano) return;
    setOcupado(true);
    try {
      const resultado = await api.metodo.disparar({ workspace_id: workspaceId, trabalho_id: trabalho.id, gesto: painel.gesto, argumento: null, pane_id: null });
      setPainel({ ...painel, resultado, erro: null });
      // D-610: comando enviado → leva à tela Terminais e foca o painel (preferência "Ir para o terminal ao disparar"); falha nunca navega
      if (entregue(resultado)) execucao.registrar(resultado, { workspaceId, rotulo: painel.rotulo, pedido: trabalho.titulo });
    } catch (e) {
      setPainel({ ...painel, erro: e instanceof Error ? e.message : "Falha ao disparar." });
    }
    setOcupado(false);
  };

  const humanas = acoesHumanas(trabalho);
  const s = painel?.sugestao ?? null;
  const falhou = painel?.resultado && !entregue(painel.resultado);

  return (
    <section className="met-acoes" aria-label="Ações do método">
      <div className="met-acoes-botoes">
        {gestos.map((g) => <button key={g.gesto} type="button" className="met-botao" disabled={ocupado} onClick={() => void sugerir(g)}>{g.rotulo}</button>)}
        {humanas.map((h) => (
          <button key={h.rotulo} type="button" className="met-botao met-botao-humano" onClick={() => setPainel({ rotulo: h.rotulo, gesto: null, sugestao: { comando: "", pane_separado: false, somente_humano: true, motivo_bloqueio: h.motivo }, caminho: h.caminho, motivo: h.motivo, resultado: null, erro: null })}>
            {h.rotulo}
          </button>
        ))}
      </div>
      {painel ? (
        <div className="met-acao-painel" role="region" aria-label={`Ação: ${painel.rotulo}`} aria-live="polite">
          <b>{painel.rotulo}</b>
          {painel.erro ? <p className="met-erro" role="alert">{painel.erro}</p> : null}
          {s && s.somente_humano ? (
            <>
              <p className="met-aviso">Ação somente humana: não é disparada pelo app. {s.motivo_bloqueio ?? painel.motivo ?? ""}</p>
              {painel.caminho ? <p>Abra o arquivo: <code>{painel.caminho}</code> <button type="button" className="met-botao" onClick={() => void navigator.clipboard?.writeText(painel.caminho as string)}>Copiar caminho</button></p> : null}
            </>
          ) : null}
          {s && !s.somente_humano ? (
            <>
              <p>Comando exato: <code className="met-comando">{s.comando}</code></p>
              {s.pane_separado ? <p className="met-aviso">Abre em Pane separado do implementador.</p> : null}
              {s.motivo_bloqueio ? <p className="met-erro">{s.motivo_bloqueio}</p> : null}
              {!(painel.resultado && entregue(painel.resultado)) ? <button type="button" className="met-botao met-botao-primario" disabled={ocupado || !!s.motivo_bloqueio} onClick={() => void disparar()}>Disparar no Pane</button> : null}
            </>
          ) : null}
          {painel.resultado && entregue(painel.resultado) ? <p role="status" className="met-ok">Enviado ao Pane{painel.resultado.pane_id ? ` ${painel.resultado.pane_id}` : ""}: <code>{painel.resultado.comando}</code></p> : null}
          {falhou ? <p role="alert" className="met-erro">{/aguard/i.test(painel.resultado?.motivo ?? "") ? MENSAGEM_AGUARDANDO : painel.resultado?.motivo ?? "O comando não foi enviado."}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
