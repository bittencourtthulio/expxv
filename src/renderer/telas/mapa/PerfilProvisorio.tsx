import { useEffect, useState } from "react";
import type { ApiMapa, PerfilProvisorioMapa } from "../../../compartilhado/mapa";
import { Dialogo } from "../../componentes/Dialogo";
import { BotaoCopiar, Carregando, FaixaErro } from "./comum";
import { formatarNumero, perfilParaMarkdown } from "./logica";

export function PerfilProvisorio({ api, ws, aoFechar }: { api: ApiMapa; ws: string; aoFechar: () => void }) {
  const [p, setP] = useState<PerfilProvisorioMapa | null>(null);
  const [erro, setErro] = useState<unknown>(null);
  useEffect(() => {
    let vivo = true;
    void api.perfil(ws).then((r) => { if (vivo) setP(r); }, (e: unknown) => { if (vivo) setErro(e); });
    return () => { vivo = false; };
  }, [api, ws]);
  return (
    <Dialogo titulo="Perfil provisório" aoFechar={aoFechar} largura={640}>
      <div className="mp-perfil">
        <p className="mp-faixa" data-tom="info" role="note">Não é o PERFIL.md: quem escreve o perfil do legado é o <code>/expx:legadox-perfil</code>. Isto é só para você revisar; o que está marcado como estimado ou candidato continua exigindo verificação.</p>
        {erro !== null ? <FaixaErro erro={erro} /> : p === null ? <Carregando /> : (
          <>
            <dl className="mp-dl">
              <dt>Stack</dt><dd>{p.stack.ecossistemas.join(", ") || "nenhum ecossistema detectado"}; {p.stack.linguagens.map((l) => `${l.linguagem} (${formatarNumero(l.arquivos)})`).join(", ")}</dd>
              <dt>Entradas</dt><dd>{Object.entries(p.entradas_por_categoria).map(([k, v]) => `${k}: ${v}`).join(", ") || "nenhuma"}</dd>
              <dt>Camadas</dt><dd>{p.camadas.modulos} módulos · {p.camadas.violacoes} violações candidatas · {p.camadas.ciclos} ciclos</dd>
              <dt>Cobertura</dt><dd>{p.cobertura.sem_teste} de {p.cobertura.total} sem teste ({p.cobertura.metodo})</dd>
              <dt>Dialetos em conflito</dt><dd>{p.dialetos_conflitantes.map((d) => `${d.eixo} (${d.forca})`).join(", ") || "nenhum"}</dd>
              <dt>Zonas candidatas</dt><dd>{p.zonas_candidatas.map((z) => `${z.categoria}: ${z.pastas.join(", ")} (quem valida: ${z.quem_valida})`).join("; ") || "nenhuma"}</dd>
              <dt>Dívida candidata</dt><dd>{p.divida.ciclos} ciclos · {p.divida.candidatos_mortos} candidatos a código morto (verificar antes de qualquer remoção) · {p.divida.hotspots_quentes} hotspots quentes</dd>
            </dl>
            <div className="mp-acoes">
              <BotaoCopiar texto={perfilParaMarkdown(p)} rotulo="Copiar como Markdown" visivel="Copiar como Markdown" />
              <button type="button" className="mp-btn" onClick={aoFechar}>Fechar</button>
            </div>
          </>
        )}
      </div>
    </Dialogo>
  );
}
