// Cliente de referência do controle remoto (Fase 13, só testes): Node + as MESMAS derivações de `src/nucleo/remoto/protocolo.ts`. Faz pareamento (código + SAS), reconexão com
// assinaturas mútuas, canal AES-GCM e também requisições CRUAS (Host/Origin forjados, quadros gravados) para os testes adversariais. Nenhuma rede além do endereço dado.
import { randomBytes } from "node:crypto";
import { request as requisicaoHttp } from "node:http";
import {
  assinar,
  confCliente,
  criarCanal,
  dadosAssinadosCliente,
  derivarPareamento,
  derivarSessao,
  macPareado,
  novoParAssinatura,
  novoParEfemero,
  transcricaoSessao,
  verificarAssinatura,
  confServidor,
  type Canal,
  type ParAssinatura,
} from "../../../src/nucleo/remoto/protocolo";

export interface RespostaCrua {
  status: number;
  corpo: string;
  json: Record<string, unknown> | null;
}

export function requisicaoCrua(o: { ip: string; porta: number; caminho: string; metodo?: string; host?: string; origin?: string; corpo?: string | Buffer; tipo?: string | null }): Promise<RespostaCrua> {
  return new Promise((resolve, reject) => {
    const corpo = o.corpo === undefined ? undefined : Buffer.from(o.corpo);
    const cab: Record<string, string> = { Host: o.host ?? `${o.ip}:${o.porta}` };
    if (o.origin !== undefined) cab["Origin"] = o.origin;
    if (o.tipo !== null) cab["Content-Type"] = o.tipo ?? "application/json";
    if (corpo !== undefined) cab["Content-Length"] = String(corpo.length);
    const r = requisicaoHttp({ host: o.ip, port: o.porta, path: o.caminho, method: o.metodo ?? "POST", headers: cab, agent: false }, (res) => {
      const partes: Buffer[] = [];
      res.on("data", (c: Buffer) => partes.push(c));
      res.on("end", () => {
        const texto = Buffer.concat(partes).toString("utf8");
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(texto) as Record<string, unknown>;
        } catch {
          /* corpo não JSON */
        }
        resolve({ status: res.statusCode ?? 0, corpo: texto, json });
      });
    });
    r.on("error", reject);
    r.setTimeout(5000, () => r.destroy(new Error("timeout")));
    r.end(corpo);
  });
}

export class ClienteRemoto {
  par: ParAssinatura = novoParAssinatura();
  dispositivoId: string | null = null;
  identidadeFixada: Buffer | null = null;
  canal: Canal | null = null;
  sid: string | null = null;

  constructor(readonly ip: string, readonly porta: number, readonly nome = "celular de teste") {}

  post(caminho: string, corpo: unknown, extra: Partial<Parameters<typeof requisicaoCrua>[0]> = {}): Promise<RespostaCrua> {
    return requisicaoCrua({ ip: this.ip, porta: this.porta, caminho, corpo: JSON.stringify(corpo), ...extra });
  }

  /** pareamento completo; `aoSas` recebe o SAS calculado AQUI para o teste comparar com o do desktop e decidir. */
  async iniciarPareamento(codigo: string): Promise<{ ok: true; sas: string; hid: string; chaves: ReturnType<typeof derivarPareamento> } | { ok: false; etapa: string; status: number }> {
    const e = novoParEfemero();
    const nonceC = randomBytes(16);
    const ini = await this.post("/v1/pareamento/inicio", { epk: e.publica.toString("base64"), nonce: nonceC.toString("base64") });
    if (ini.status !== 200 || ini.json === null) return { ok: false, etapa: "inicio", status: ini.status };
    const spk = Buffer.from(String(ini.json["spk"]), "base64");
    const nonceS = Buffer.from(String(ini.json["nonce_s"]), "base64");
    const ecdh = e.segredoCom(spk);
    if (ecdh === null) return { ok: false, etapa: "ecdh", status: 0 };
    const chaves = derivarPareamento({ ecdh, codigo, epkC: e.publica, spk, nonceC, nonceS });
    // o servidor prova que conhece o código: sem isso o cliente aborta
    if (Buffer.compare(confServidor(chaves), Buffer.from(String(ini.json["conf_s"]), "base64")) !== 0) return { ok: false, etapa: "conf_s", status: 0 };
    const conf = confCliente(chaves, this.par.publicaSpki, this.nome);
    const fim = await this.post("/v1/pareamento/fim", { hid: ini.json["hid"], conf: conf.toString("base64"), chave_publica: this.par.publicaSpki.toString("base64"), nome: this.nome });
    if (fim.status !== 200) return { ok: false, etapa: "fim", status: fim.status };
    return { ok: true, sas: chaves.sas, hid: String(ini.json["hid"]), chaves };
  }

  async concluirPareamento(hid: string, chaves: ReturnType<typeof derivarPareamento>): Promise<boolean> {
    const st = await this.post("/v1/pareamento/status", { hid });
    if (st.status !== 200 || st.json === null || st.json["estado"] !== "pareado") return false;
    const id = String(st.json["dispositivo_id"]);
    const ident = Buffer.from(String(st.json["identidade"]), "base64");
    const mac = Buffer.from(String(st.json["mac"]), "base64");
    if (Buffer.compare(macPareado(chaves, id, ident), mac) !== 0) return false; // identidade do servidor NÃO autenticada: não fixa
    this.dispositivoId = id;
    this.identidadeFixada = ident;
    return true;
  }

  /** ts e nonce injetáveis para provar anti-replay. */
  async abrirSessao(o: { ts?: number; nonce?: Buffer; epk?: ReturnType<typeof novoParEfemero> } = {}): Promise<{ ok: boolean; status: number; corpoPedido: Record<string, unknown> }> {
    if (this.dispositivoId === null || this.identidadeFixada === null) throw new Error("sem pareamento");
    const e = o.epk ?? novoParEfemero();
    const nonceC = o.nonce ?? randomBytes(16);
    const ts = o.ts ?? Date.now();
    const sig = assinar(this.par.privadaPkcs8, dadosAssinadosCliente(this.dispositivoId, e.publica, nonceC, ts));
    const pedido = { dispositivo_id: this.dispositivoId, epk: e.publica.toString("base64"), nonce: nonceC.toString("base64"), ts, sig: sig.toString("base64") };
    const r = await this.post("/v1/sessao/inicio", pedido);
    if (r.status !== 200 || r.json === null) return { ok: false, status: r.status, corpoPedido: pedido };
    const spk = Buffer.from(String(r.json["spk"]), "base64");
    const nonceS = Buffer.from(String(r.json["nonce_s"]), "base64");
    const tr = transcricaoSessao(this.dispositivoId, e.publica, spk, nonceC, nonceS, ts);
    if (!verificarAssinatura(this.identidadeFixada, tr, Buffer.from(String(r.json["sig_s"]), "base64"))) return { ok: false, status: 0, corpoPedido: pedido };
    const ecdh = e.segredoCom(spk);
    if (ecdh === null) return { ok: false, status: 0, corpoPedido: pedido };
    const k = derivarSessao(ecdh, tr);
    this.sid = String(r.json["sid"]);
    this.canal = criarCanal({ sid: this.sid, envio: k.c2s, recebimento: k.s2c });
    return { ok: true, status: 200, corpoPedido: pedido };
  }

  /** manda uma mensagem cifrada; devolve a resposta decifrada ou o erro em claro. Guarda o quadro enviado em `ultimoQuadro` (para replay). */
  ultimoQuadro: unknown = null;
  async enviar(msg: unknown): Promise<{ status: number; msg: unknown | null; erro: string | null }> {
    if (this.canal === null || this.sid === null) throw new Error("sem sessão");
    const quadro = this.canal.selar(msg);
    this.ultimoQuadro = quadro;
    return this.enviarQuadro(quadro);
  }
  async enviarQuadro(quadro: unknown, sid = this.sid): Promise<{ status: number; msg: unknown | null; erro: string | null }> {
    const r = await this.post("/v1/canal", { sid, quadro });
    if (r.status !== 200 || r.json === null) return { status: r.status, msg: null, erro: typeof r.json?.["e"] === "string" ? (r.json["e"] as string) : null };
    return { status: 200, msg: this.canal?.abrir(r.json["quadro"]) ?? null, erro: null };
  }
}
