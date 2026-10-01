import type { IndiceProjeto } from "../../../nucleo/metodo/tipos";

const VIRA_TRABALHO = new Set(["fazer", "fazer_outra_coisa"]);

export function proporcaoSemTrabalho(indice: IndiceProjeto): { pedidos: number; avaliados: number; semTrabalho: number } {
  const pedidos = indice.trabalhos.filter((t) => t.ferramenta === "prodx");
  const avaliados = pedidos.filter((t) => t.prodx?.veredito);
  return { pedidos: pedidos.length, avaliados: avaliados.length, semTrabalho: avaliados.filter((t) => !VIRA_TRABALHO.has(t.prodx?.veredito ?? "")).length };
}

export function Saude({ indice }: { indice: IndiceProjeto }) {
  const p = proporcaoSemTrabalho(indice);
  const pct = p.avaliados > 0 ? Math.round((p.semTrabalho / p.avaliados) * 100) : null;
  const bloqueios = indice.trabalhos.reduce((n, t) => n + t.bloqueios.filter((b) => b.aberto).length, 0);
  const divergencias = indice.trabalhos.reduce((n, t) => n + t.divergencias.length, 0);
  return (
    <div className="met-saude">
      <section aria-label="Pedidos que não viram trabalho">
        <h3>Pedidos que não viram trabalho</h3>
        {pct === null ? (
          <p className="met-suave">{p.pedidos === 0 ? "Sem pedidos do prodx neste projeto." : `${p.pedidos} pedido(s) ainda sem veredito.`}</p>
        ) : (
          <p><b className="met-numero">{pct}%</b> — {p.semTrabalho} de {p.avaliados} pedidos avaliados terminaram sem virar trabalho (já existe ou não fazer). Uma taxa saudável mostra que a triagem está filtrando.</p>
        )}
      </section>
      <section aria-label="Sinais do projeto">
        <h3>Sinais do projeto</h3>
        <ul>
          <li>{indice.trabalhos.length} trabalho(s) · {indice.violacoes.length} violação(ões) · {bloqueios} bloqueio(s) aberto(s)</li>
          <li>{divergencias} divergência(s) entre rastro e disco</li>
        </ul>
      </section>
      <section aria-label="Sinais do memox">
        <h3>Memória (memox)</h3>
        <p className="met-suave">{indice.camadas.memoria ? "O memox está instalado, mas não há sinais a mostrar agora." : "Sem sinais do memox: ele não está instalado neste projeto, e isso é normal."}</p>
      </section>
    </div>
  );
}
