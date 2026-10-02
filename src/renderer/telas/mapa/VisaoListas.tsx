import { useEffect, useRef, useState } from "react";
import type { ApiMapa, DadosAnaliseMapa, EntradaMapa, HotspotMapa, TipoAnaliseMapa } from "../../../compartilhado/mapa";
import { VirtualLista } from "../../componentes/VirtualLista";
import { BotaoCopiar, Carregando, FaixaErro } from "./comum";
import { ListaEntradas } from "./VisaoFluxo";
import { evidenciaCopiavel, formatarNumero, rotuloMorto } from "./logica";

/** Carrega uma análise do main (lazy por aba) com estado de erro e "tentar de novo". */
export function useAnalise<T extends TipoAnaliseMapa>(api: ApiMapa, ws: string, tipo: T, versao: number): { dados: DadosAnaliseMapa[T] | null; erro: unknown; tentar: () => void } {
  const [dados, setDados] = useState<DadosAnaliseMapa[T] | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);
    void api.analise(ws, tipo).then((r) => { if (vivo) setDados(r.dados as DadosAnaliseMapa[T]); }, (e: unknown) => { if (vivo) setErro(e); });
    return () => { vivo = false; };
  }, [api, ws, tipo, versao, n]);
  return { dados, erro, tentar: () => setN((x) => x + 1) };
}

interface Base { api: ApiMapa; ws: string; versao: number; selecionado: string | null; aoSelecionarArquivo: (caminho: string) => void }

// ---- Hotspots ----------------------------------------------------------------------------------

function Dispersao({ itens, aoEscolher, selecionado }: { itens: readonly HotspotMapa[]; aoEscolher: (caminho: string) => void; selecionado: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const L = 360, A = 220, M = 28;
  const maxX = Math.max(1, ...itens.map((i) => i.churn_janela));
  const maxY = Math.max(1, ...itens.map((i) => i.complexidade_max));
  const pos = (i: HotspotMapa): [number, number] => [M + (i.churn_janela / maxX) * (L - M - 8), A - M - (i.complexidade_max / maxY) * (A - M - 8)];
  useEffect(() => {
    const c = ref.current;
    if (c === null) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = c.getContext("2d"); } catch { ctx = null; }
    if (ctx === null) return;
    const cs = getComputedStyle(c);
    const v = (n: string, p: string): string => cs.getPropertyValue(n).trim() || p;
    ctx.clearRect(0, 0, L, A);
    ctx.strokeStyle = v("--borda-campo", "gray");
    ctx.beginPath(); ctx.moveTo(M, 8); ctx.lineTo(M, A - M); ctx.lineTo(L - 8, A - M); ctx.stroke();
    ctx.fillStyle = v("--texto-discreto", "gray");
    ctx.font = `10px ${cs.fontFamily || "sans-serif"}`;
    ctx.fillText("alterações (janela) →", M + 4, A - 8);
    ctx.save(); ctx.translate(10, A - M - 4); ctx.rotate(-Math.PI / 2); ctx.fillText("complexidade máx. →", 0, 0); ctx.restore();
    const cor = { quente: v("--alerta", "red"), morno: v("--aviso", "orange"), frio: v("--texto-discreto", "gray") };
    for (const i of itens) {
      const [x, y] = pos(i);
      ctx.beginPath(); ctx.arc(x, y, i.caminho === selecionado ? 6 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = i.caminho === selecionado ? v("--destaque", "blue") : cor[i.faixa];
      ctx.fill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, selecionado]);
  return (
    <canvas ref={ref} width={L} height={A} className="mp-dispersao" role="img" aria-label={`Dispersão de ${itens.length} arquivos: alterações na janela versus complexidade máxima. A tabela ao lado traz os mesmos dados.`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        let melhor: HotspotMapa | null = null; let d0 = 100;
        for (const i of itens) { const [x, y] = pos(i); const d = Math.hypot(x - px, y - py); if (d < d0) { d0 = d; melhor = i; } }
        if (melhor !== null) aoEscolher(melhor.caminho);
      }} />
  );
}

export function VisaoHotspots({ api, ws, versao, selecionado, aoSelecionarArquivo }: Base) {
  const { dados, erro, tentar } = useAnalise(api, ws, "hotspots", versao);
  if (erro !== null) return <FaixaErro erro={erro} aoTentar={tentar} />;
  if (dados === null) return <Carregando texto="Calculando hotspots…" />;
  if (!dados.disponivel) return <p className="mp-vazio">Sem história do git, não há hotspots. Analise com a história ligada ou use um repositório git. O raio trata isso como pior caso.</p>;
  if (dados.itens.length === 0) return <p className="mp-vazio">Nenhum arquivo com alterações na janela analisada.</p>;
  return (
    <div className="mp-hotspots">
      <Dispersao itens={dados.itens} aoEscolher={aoSelecionarArquivo} selecionado={selecionado} />
      <VirtualLista
        itens={dados.itens}
        alturaItem={34}
        rotulo="Hotspots ordenados por pontuação"
        chave={(h) => h.caminho}
        renderItem={(h) => (
          <button type="button" className="mp-item mp-item-dupla" aria-current={`arq:${h.caminho}` === selecionado ? "true" : undefined} onClick={() => aoSelecionarArquivo(h.caminho)}>
            <span><span className="mp-selo" data-tom={h.faixa === "quente" ? "alerta" : h.faixa === "morno" ? "aviso" : undefined}>{h.faixa}</span> {h.caminho}</span>
            <span className="mp-meta">pontuação {h.score.toFixed(2)} · {h.churn_janela} alterações · complexidade {h.complexidade_max}{h.autores_n === null ? "" : ` · ${h.autores_n} autores`}{h.commits_correcao === null ? "" : ` · ${h.commits_correcao} correções`}</span>
          </button>
        )}
      />
    </div>
  );
}

// ---- Entradas e Dados --------------------------------------------------------------------------

export function VisaoEntradas({ api, ws, versao, aoAbrirFluxo }: { api: ApiMapa; ws: string; versao: number; aoAbrirFluxo: (e: EntradaMapa) => void }) {
  const { dados, erro, tentar } = useAnalise(api, ws, "entradas", versao);
  if (erro !== null) return <FaixaErro erro={erro} aoTentar={tentar} />;
  if (dados === null) return <Carregando texto="Listando entradas…" />;
  return (
    <div className="mp-entradas">
      <div className="mp-grafo-info" role="status">{Object.entries(dados.por_categoria).map(([k, v]) => `${k}: ${v}`).join(" · ") || "nenhuma entrada"}</div>
      <ListaEntradas itens={dados.itens} selecionada={null} aoEscolher={(id) => { const e = dados.itens.find((x) => x.id === id); if (e !== undefined) aoAbrirFluxo(e); }} />
    </div>
  );
}

export function VisaoDados({ api, ws, versao }: { api: ApiMapa; ws: string; versao: number }) {
  const { dados, erro, tentar } = useAnalise(api, ws, "dados", versao);
  const [sel, setSel] = useState<string | null>(null);
  if (erro !== null) return <FaixaErro erro={erro} aoTentar={tentar} />;
  if (dados === null) return <Carregando texto="Listando tabelas…" />;
  if (dados.tabelas.length === 0) return <p className="mp-vazio">Nenhum acesso a tabelas encontrado. SQL montado em tempo de execução não aparece no mapa (limite declarado).</p>;
  const t = dados.tabelas.find((x) => x.nome === sel) ?? null;
  return (
    <div className="mp-dados">
      <VirtualLista
        itens={dados.tabelas}
        alturaItem={34}
        rotulo="Tabelas"
        chave={(x) => x.nome}
        renderItem={(x) => (
          <button type="button" className="mp-item mp-item-dupla" aria-current={x.nome === sel ? "true" : undefined} onClick={() => setSel(x.nome)}>
            <span>{x.nome}</span>
            <span className="mp-meta">{x.le_n} leituras · {x.escreve_n} escritas{x.definida_em[0] !== undefined ? ` · definida em ${x.definida_em[0]}` : ""}</span>
          </button>
        )}
      />
      <div className="mp-dados-quem" aria-live="polite">
        {t === null ? <p className="mp-vazio">Escolha uma tabela para ver quem a toca.</p> : (
          <>
            <h3>Quem toca {t.nome}</h3>
            <ul>{t.toques.map((q, i) => <li key={i}><span className="mp-selo">{q.operacao === "le" ? "lê" : "escreve"}</span> {q.de}{q.confianca === "heuristica" ? <span className="mp-meta"> · heurística</span> : null}{q.evidencia !== null && <> <code>{q.evidencia}</code> <BotaoCopiar texto={q.evidencia} rotulo={`Copiar evidência ${q.evidencia}`} /></>}</li>)}</ul>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Dívida candidata: ciclos, código morto (sempre "candidato"), duplicação ------------------

export function VisaoDivida({ api, ws, versao, aoSelecionarArquivo }: Base) {
  const ciclos = useAnalise(api, ws, "ciclos", versao);
  const mortos = useAnalise(api, ws, "mortos", versao);
  const dup = useAnalise(api, ws, "duplicacao", versao);
  const erro = ciclos.erro ?? mortos.erro ?? dup.erro;
  if (erro !== null) return <FaixaErro erro={erro} aoTentar={() => { ciclos.tentar(); mortos.tentar(); dup.tentar(); }} />;
  if (ciclos.dados === null || mortos.dados === null || dup.dados === null) return <Carregando texto="Calculando a dívida candidata…" />;
  const arq = (id: string): string => id.replace(/^arq:/, "");
  return (
    <div className="mp-divida">
      <section aria-labelledby="mp-d-ciclos">
        <h3 id="mp-d-ciclos">Ciclos de dependência ({ciclos.dados.total})</h3>
        {ciclos.dados.ciclos.length === 0 ? <p className="mp-vazio">Nenhum ciclo entre arquivos.</p> : (
          <ul>{ciclos.dados.ciclos.slice(0, 50).map((c) => (
            <li key={c.id}>
              <strong>{c.tamanho} arquivos</strong>: {c.nos.slice(0, 4).map((n) => <button key={n} type="button" className="mp-link" onClick={() => aoSelecionarArquivo(arq(n))}>{arq(n)}</button>)}{c.nos.length > 4 ? ` e mais ${c.nos.length - 4}` : ""}
              {c.quebrar[0] !== undefined && <span className="mp-meta"> · sugestão: quebrar {arq(c.quebrar[0].de)} → {arq(c.quebrar[0].para)}</span>}
            </li>))}</ul>
        )}
      </section>
      <section aria-labelledby="mp-d-mortos">
        <h3 id="mp-d-mortos">Candidatos a código morto ({mortos.dados.itens.length})</h3>
        <p className="mp-meta">{rotuloMorto()}. Evidência de ausência de uso não autoriza remoção.</p>
        {mortos.dados.itens.length === 0 ? <p className="mp-vazio">Nenhum candidato encontrado.</p> : (
          <div className="mp-lista-fixa">
            <VirtualLista
              itens={mortos.dados.itens}
              alturaItem={34}
              rotulo="Candidatos a código morto"
              chave={(m) => m.id}
              renderItem={(m) => (
                <button type="button" className="mp-item mp-item-dupla" onClick={() => aoSelecionarArquivo(m.caminho)}>
                  <span><span className="mp-selo">candidato · confiança {m.confianca}</span> {evidenciaCopiavel(m.caminho, m.linha)}</span>
                  <span className="mp-meta">{m.motivos.join("; ")}</span>
                </button>
              )}
            />
          </div>
        )}
      </section>
      <section aria-labelledby="mp-d-dup">
        <h3 id="mp-d-dup">Duplicação grosseira</h3>
        {!dup.dados.habilitada ? <p className="mp-vazio">Desligada por padrão (custa CPU). Ligue em Mais ▾ nas configurações do mapa e reanalise.</p>
          : dup.dados.clones.length === 0 ? <p className="mp-vazio">Nenhum clone acima de 50 tokens.</p>
          : <ul>{dup.dados.clones.slice(0, 50).map((c, i) => <li key={i}>{formatarNumero(c.tokens)} tokens: {c.trechos.map((t) => `${t.caminho}:${t.linha_ini}-${t.linha_fim}`).join(" ↔ ")}</li>)}</ul>}
      </section>
    </div>
  );
}
