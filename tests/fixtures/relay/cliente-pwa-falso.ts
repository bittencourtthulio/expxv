// Celular falso (Fase 22): o cliente de referência da Fase 13 (`ClienteRemoto`) com o transporte trocado — em vez de POST HTTP, cada requisição vai por um canal do relay dentro do invólucro
// (JSON -> padding -> AES-GCM). Usa as MESMAS derivações do host; serve aos testes com o relay em processo e com o relay real em loopback.
import type { ConexaoWs, OpcoesWs } from "../../../src/nucleo/remoto-estendido/ws-cliente";
import { VERSAO_PROTOCOLO_RELAY } from "../../../src/compartilhado/relay";
import { codificar, decodificar } from "../../../src/nucleo/remoto-estendido/quadro";
import { assinarProva, parseControle } from "../../../src/nucleo/relay/protocolo";
import { randomBytes } from "node:crypto";
import { ClienteRemoto, type RespostaCrua } from "../jarvis/cliente-remoto";

const ROTAS: Record<string, string> = {
  "/v1/pareamento/inicio": "pareamento_inicio",
  "/v1/pareamento/fim": "pareamento_fim",
  "/v1/pareamento/status": "pareamento_status",
  "/v1/sessao/inicio": "sessao_inicio",
  "/v1/canal": "canal",
};

export class ClienteViaRelay extends ClienteRemoto {
  ws: ConexaoWs | null = null;
  registrado = false;
  private ids = 0;
  private espera = new Map<number, (r: { status: number; corpo: unknown } | null) => void>();
  respostasDescartadas = 0;
  /** quadros de dado recebidos (decodificados) — para inspeção. */
  recebidos: unknown[] = [];

  constructor(
    private readonly abrirWs: (o: OpcoesWs) => ConexaoWs,
    private readonly cfg: { url: string; canal: string; chaveEnvelope: Buffer; chavePublicaDispositivo: Buffer; chavePrivadaDispositivo: Buffer; aguardar: () => Promise<void> },
    nome = "celular de teste",
  ) {
    super("0.0.0.0", 0, nome);
  }

  /** conecta ao relay e prova a posse da chave do dispositivo. Devolve `true` se o relay respondeu `ok`. */
  async conectar(): Promise<boolean> {
    const nonce = randomBytes(16);
    let estado = "hello" as "hello" | "prova" | "ok" | "erro";
    await new Promise<void>((resolve) => {
      this.ws = this.abrirWs({
        url: this.cfg.url,
        aoAbrir: () => this.ws?.enviar(JSON.stringify({ t: "hello", v: VERSAO_PROTOCOLO_RELAY, papel: "cliente", canal: this.cfg.canal, ts: Date.now(), nonce: nonce.toString("base64") })),
        aoMensagem: (m) => {
          if (typeof m === "string") {
            const c = parseControle(m);
            if (c?.t === "desafio" && estado === "hello") {
              estado = "prova";
              const sig = assinarProva(this.cfg.chavePrivadaDispositivo, { desafio: Buffer.from(c.n, "base64"), nonceCliente: nonce, canal: this.cfg.canal, papel: "cliente" });
              this.ws?.enviar(JSON.stringify({ t: "prova", pub: this.cfg.chavePublicaDispositivo.toString("base64"), sig: sig.toString("base64") }));
            } else if (c?.t === "ok") {
              estado = "ok";
              this.registrado = true;
              resolve();
            } else if (c?.t === "erro") {
              estado = "erro";
              resolve();
            }
            return;
          }
          const x = decodificar(this.cfg.chaveEnvelope, m, "h2c");
          if (x === null) return void this.respostasDescartadas++;
          if (x.tipo === "enchimento") return;
          this.recebidos.push(x.mensagem);
          const r = x.mensagem as { id?: number; status?: number; corpo?: unknown };
          const f = typeof r.id === "number" ? this.espera.get(r.id) : undefined;
          if (f !== undefined) {
            this.espera.delete(r.id as number);
            f({ status: r.status as number, corpo: r.corpo });
          }
        },
        aoFechar: () => {
          this.registrado = false;
          resolve();
          for (const [, f] of this.espera) f(null);
          this.espera.clear();
        },
      });
    });
    return estado === "ok";
  }
  fechar(): void {
    this.ws?.fechar();
  }

  override async post(caminho: string, corpo: unknown): Promise<RespostaCrua> {
    const rota = ROTAS[caminho];
    if (rota === undefined || this.ws === null) return { status: 0, corpo: "", json: null };
    const id = ++this.ids;
    const quadro = codificar(this.cfg.chaveEnvelope, { r: rota, id, corpo }, "c2h");
    const p = new Promise<{ status: number; corpo: unknown } | null>((resolve) => this.espera.set(id, resolve));
    this.ws.enviar(quadro);
    this.ultimoQuadroExterno = quadro;
    await this.cfg.aguardar();
    const r = await Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), 800))]);
    this.espera.delete(id);
    if (r === null) return { status: 0, corpo: "", json: null };
    return { status: r.status, corpo: JSON.stringify(r.corpo), json: typeof r.corpo === "object" && r.corpo !== null ? (r.corpo as Record<string, unknown>) : null };
  }
  /** último quadro EXTERNO (opaco) enviado ao relay — para os testes de repetição. */
  ultimoQuadroExterno: Buffer | null = null;
}
