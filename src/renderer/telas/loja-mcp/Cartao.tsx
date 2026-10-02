// Cartão curto da Loja de MCPs (uma linha de 56 px, virtualizada): nome, descrição, selos e um único botão primário por estado.
// D-694: a linha usa o padrão único do app (ItemLista/lst-*); o envoltório `lm-linha` preserva `data-mcp-id` (foco por teclado e e2e).
import { memo } from "react";
import type { CartaoMcp } from "../../../compartilhado/loja-mcp";
import { ItemLista, type SeloLista } from "../../componentes/ItemLista";
import { useAndamentoMcp, type StoreLojaMcp } from "../../estado/loja-mcp";
import { acaoPrimaria, resumoSaude, riscoMaximo, ROTULO_GRATUITO, seloAutenticacao, type TipoAcao } from "./logica";

export interface PropsCartao {
  cartao: CartaoMcp;
  selecionado: boolean;
  habilitado: boolean;
  somenteLeitura: boolean;
  store: StoreLojaMcp;
  aoAbrir: (id: string) => void;
  aoAcao: (id: string, tipo: TipoAcao) => void;
  aoTeclar: (e: React.KeyboardEvent, id: string) => void;
}

export const CartaoLinha = memo(function CartaoLinha({ cartao: c, selecionado, habilitado, somenteLeitura, store, aoAbrir, aoAcao, aoTeclar }: PropsCartao) {
  const andamento = useAndamentoMcp(c.id, store);
  const acao = acaoPrimaria(c, habilitado, andamento !== null, somenteLeitura);
  const risco = riscoMaximo(c.riscos);
  const [rotuloGratis, tomGratis] = ROTULO_GRATUITO[c.selo_gratuito];
  const auth = seloAutenticacao(c);
  const saude = c.instalado !== null && c.instalado.estado === "instalado" ? resumoSaude(c.saude) : null;
  const selos: SeloLista[] = [
    { texto: c.mantenedor, tom: c.mantenedor === "oficial" ? "destaque" : "neutro" },
    { texto: rotuloGratis, tom: tomGratis },
  ];
  if (auth !== null) selos.push({ texto: auth, tom: "aviso" });
  if (risco !== null) selos.push({ texto: risco.rotulo, tom: risco.tom, titulo: "Risco mais grave declarado" });
  if (c.no_kit) selos.push({ texto: "Kit", tom: "destaque" });
  if (c.licenca_restritiva) selos.push({ texto: "licença restritiva", tom: "aviso" });
  if (habilitado) selos.push({ texto: "habilitado", tom: "sucesso" });
  if (saude !== null && c.saude !== null && c.saude.estado !== "nao_testado") selos.push({ texto: c.saude.estado === "ok" ? "saudável" : "com falha", tom: saude.tom });
  if (c.instalado?.atualizacao_disponivel === true) selos.push({ texto: "atualização", tom: "aviso" });
  return (
    <div className="lm-linha" data-mcp-id={c.id}>
      <ItemLista
        id={c.id}
        titulo={c.nome}
        descricao={c.descricao_pt}
        selos={selos}
        selecionado={selecionado}
        aoAbrir={() => aoAbrir(c.id)}
        teclado={(e) => aoTeclar(e, c.id)}
        acao={<>
          {andamento !== null ? <span className="lm-progresso" role="status" aria-label={`${c.nome}: ${andamento.rotulo}`}>{andamento.passo > 0 ? `${andamento.passo}/6 ` : ""}{andamento.rotulo}</span> : null}
          <button
            type="button"
            className={acao.tipo === "nenhuma" || acao.tipo === "instalando" ? "botao lm-botao" : "botao botao-primario lm-botao"}
            disabled={acao.desabilitada}
            title={acao.motivo ?? undefined}
            aria-label={`${acao.rotulo}: ${c.nome}`}
            onClick={() => aoAcao(c.id, acao.tipo)}
          >{acao.rotulo}</button>
        </>}
      />
    </div>
  );
});
