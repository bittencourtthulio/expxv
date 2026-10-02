// @vitest-environment jsdom
// T-22.15: telas do PWA em jsdom. Tudo vira texto (AX-12), sem botão de aprovar (D-21), travar apaga o estado, autolock, impressão digital comparável (AX-11), foco e rótulos.
import { createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { carregar } from "./carregar";

type Obs = (e: Est) => void;
interface Est { fase: string; etapa: string | null; sas: string | null; erro: string | null; nome: string; dispositivoId: string | null; identidadeHost: string | null; relay: string; permissao: string | null; atualizadoEm: number | null; status: unknown; paineis: unknown; missoes: unknown; temPin: boolean }
interface UI {
  montarApp(o: Record<string, unknown>): { desmontar(): void; trava: { ativa(): boolean } };
  desenharResultado(doc: Document, r: unknown, vazio: string): HTMLElement;
}
interface PC { grupos4(h: string): string; impressaoDigital(b: Uint8Array): Promise<string> }

const base: Est = { fase: "sem_pareamento", etapa: null, sas: null, erro: null, nome: "Meu celular", dispositivoId: "dev_x", identidadeHost: null, relay: "", permissao: null, atualizadoEm: null, status: null, paineis: null, missoes: null, temPin: false };
function falso(inicial: Partial<Est> = {}) {
  let est: Est = { ...base, ...inicial };
  const ouvintes = new Set<Obs>();
  const chamadas: Array<[string, unknown[]]> = [];
  const registra = (n: string, r: unknown = undefined) => (...a: unknown[]) => (chamadas.push([n, a]), r);
  const api = {
    estado: () => est,
    assinar: (cb: Obs) => (ouvintes.add(cb), () => void ouvintes.delete(cb)),
    parear: async (p: unknown) => (chamadas.push(["parear", [p]]), { ok: true }),
    cancelarPareamento: registra("cancelarPareamento"),
    atualizar: async () => (chamadas.push(["atualizar", []]), true),
    enviarComando: async (t: string) => (chamadas.push(["enviarComando", [t]]), api.proximoResultado),
    statusPedido: async (id: string) => (chamadas.push(["statusPedido", [id]]), api.proximoPedido),
    travar() {
      chamadas.push(["travar", []]);
      api.mudar({ fase: "travado", status: null, paineis: null, missoes: null });
    },
    destravar: async (pin?: string) => (chamadas.push(["destravar", [pin]]), { ok: true }),
    definirPin: async (p: string) => (chamadas.push(["definirPin", [p]]), true),
    esquecer: async () => void chamadas.push(["esquecer", []]),
    proximoResultado: null as unknown,
    proximoPedido: null as unknown,
    mudar(p: Partial<Est>) {
      est = { ...est, ...p };
      for (const o of [...ouvintes]) o(est);
    },
    chamadas,
  };
  return api;
}
const resposta = (texto: string, linhas: Array<{ rotulo: string; detalhe?: string }> = [], nao_confiavel = false) => ({ tipo: "resposta", resposta: { texto, linhas, nao_confiavel } });
const conectado = (p: Partial<Est> = {}): Partial<Est> => ({ fase: "conectado", permissao: "mensagem_confirmada", status: resposta("Tudo certo"), paineis: resposta("Painéis", []), missoes: resposta("Missões", []), identidadeHost: "ab".repeat(16), ...p });

const montados: Array<{ desmontar(): void }> = [];
afterEach(() => {
  montados.splice(0).forEach((m) => m.desmontar());
  document.body.textContent = "";
});
async function montar(cliente: ReturnType<typeof falso>, extra: Record<string, unknown> = {}) {
  const ui = await carregar<UI>("pwa/ui.js");
  const raiz = document.createElement("main");
  document.body.append(raiz);
  const agendados: Array<{ fn: () => void; ms: number; vivo: boolean }> = [];
  const agendar = (fn: () => void, ms: number) => {
    const a = { fn, ms, vivo: true };
    agendados.push(a);
    return () => void (a.vivo = false);
  };
  const app = ui.montarApp({ raiz, cliente, doc: document, agendar, ...extra });
  montados.push(app);
  return { raiz, app, agendados, ui };
}
const aba = (raiz: HTMLElement, nome: string): HTMLButtonElement => [...raiz.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((b) => b.textContent === nome) as HTMLButtonElement;
const nenhumVivo = (a: Array<{ vivo: boolean }>) => a.every((x) => !x.vivo);

describe("telas do PWA", () => {
  it("ax12_saida_so_texto: HTML, <script>, <img onerror> e javascript: vindos do desktop viram TEXTO; nenhum nó ativo, link ou handler", async () => {
    const hostil = ['<img src=x onerror="window.pwned=1">', "<script>window.pwned=2</script>", "javascript:alert(1)", '<a href="javascript:alert(3)">clique</a>', "<iframe src=//x></iframe>", "&lt;b&gt;"];
    const c = falso(conectado({ paineis: resposta(hostil[0] as string, hostil.map((h, i) => ({ rotulo: h, detalhe: `${h}#${i}` })), true), missoes: resposta("m", [{ rotulo: hostil[1] as string }]), status: resposta(hostil[2] as string) }));
    const { raiz } = await montar(c);
    for (const nome of ["Status", "Painéis", "Missões"]) {
      aba(raiz, nome).click();
      expect(raiz.querySelectorAll("script, img, a, iframe, object, embed, form[action], [onerror], [onclick], [href], [src]").length, nome).toBe(0);
    }
    aba(raiz, "Painéis").click();
    const texto = raiz.querySelector("[role=tabpanel]")?.textContent ?? "";
    for (const h of hostil) expect(texto).toContain(h); // aparece LITERAL, como texto
    expect((globalThis as { pwned?: number }).pwned).toBeUndefined();
    expect(raiz.querySelector(".selo")?.textContent).toMatch(/não confiável/);
    expect(raiz.querySelectorAll("li").length).toBe(hostil.length);
  });

  it("não existe controle de aprovar/recusar: confirmação pendente mostra «aguardando o desktop» e só consulta o estado", async () => {
    const c = falso(conectado());
    c.proximoResultado = { tipo: "confirmacao", confirmacao: { id: "cnf_abc123456", resumo: "Enviar ao Maestro: «publicar»" } };
    c.proximoPedido = { t: "pedido_status", estado: "pendente" };
    const { raiz, agendados } = await montar(c);
    aba(raiz, "Mensagem").click();
    (raiz.querySelector("textarea") as HTMLTextAreaElement).value = "publicar a versão";
    (raiz.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
    expect(c.chamadas.find(([n]) => n === "enviarComando")?.[1]).toEqual(["publicar a versão"]);
    expect(raiz.textContent).toMatch(/Aguardando o desktop/);
    expect(raiz.textContent).toContain("Enviar ao Maestro: «publicar»");
    const rotulos = [...raiz.querySelectorAll("button")].map((b) => (b.textContent ?? "").toLowerCase());
    expect(rotulos.some((r) => /aprovar|recusar|permitir|confirmar/.test(r) && !/esquecer/.test(r))).toBe(false);
    // o PWA só pergunta o estado (a decisão é no desktop)
    agendados.filter((a) => a.vivo && a.ms === 2000)[0]?.fn();
    await new Promise((r) => setTimeout(r, 20));
    expect(c.chamadas.some(([n]) => n === "statusPedido")).toBe(true);
    expect(c.chamadas.some(([n]) => /aprov|decid/i.test(n))).toBe(false);
    c.proximoPedido = { t: "pedido_status", estado: "aprovado", texto: "feito" };
    agendados.filter((a) => a.vivo && a.ms === 3000)[0]?.fn();
    await new Promise((r) => setTimeout(r, 20));
    expect(raiz.textContent).toMatch(/Aprovado no desktop/);
  });

  it("permissão só de leitura esconde o formulário de mensagem e explica que só o desktop aumenta", async () => {
    const c = falso(conectado({ permissao: "leitura" }));
    const { raiz } = await montar(c);
    aba(raiz, "Mensagem").click();
    expect((raiz.querySelector("form") as HTMLFormElement).hidden).toBe(true);
    expect(raiz.textContent).toMatch(/só tem permissão de leitura/);
  });

  it("travar apaga o estado em memória (dados somem da tela) e destravar volta; autolock de 5 min trava sozinho e atividade rearma", async () => {
    const c = falso(conectado({ temPin: true }));
    const { raiz, agendados } = await montar(c);
    expect(raiz.textContent).toContain("Tudo certo");
    const lock = agendados.filter((a) => a.vivo && a.ms === 300000);
    expect(lock).toHaveLength(1);
    document.dispatchEvent(new Event("pointerdown"));
    expect(lock[0]?.vivo).toBe(false);
    const novo = agendados.filter((a) => a.vivo && a.ms === 300000);
    expect(novo).toHaveLength(1);
    (novo[0] as { vivo: boolean }).vivo = false; // o timer disparou
    novo[0]?.fn(); // 5 min sem atividade
    expect(c.chamadas.some(([n]) => n === "travar")).toBe(true);
    expect(raiz.textContent).not.toContain("Tudo certo");
    expect(raiz.textContent).toMatch(/Travado/);
    expect(raiz.querySelector("input[type=password]")).not.toBeNull();
    expect(nenhumVivo(agendados.filter((a) => a.ms === 300000))).toBe(true); // travado: sem autolock pendente
    (raiz.querySelector("input[type=password]") as HTMLInputElement).value = "1234";
    ([...raiz.querySelectorAll("button")].find((b) => b.textContent === "Destravar") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 10));
    expect(c.chamadas.find(([n]) => n === "destravar")?.[1]).toEqual(["1234"]);
    expect((raiz.querySelector("input[type=password]") as HTMLInputElement).value).toBe(""); // o PIN não fica no campo
  });

  it("parear: formulário rotulado, link do fragmento preenche e é apagado da barra, o código sai do campo ao enviar (uso único) e o SAS aparece grande", async () => {
    const c = falso();
    const hist: unknown[][] = [];
    const loc = { hash: `#r=${encodeURIComponent("wss://relay.exemplo.com")}&c=ABCDEFGHJKMN&h=${"ab".repeat(16)}&p=`, pathname: "/", search: "" };
    const { raiz } = await montar(c, { loc, hist: { replaceState: (...a: unknown[]) => void hist.push(a) } });
    expect(hist).toHaveLength(1);
    const campos = [...raiz.querySelectorAll("input")];
    for (const i of campos) expect(raiz.querySelector(`label[for="${i.id}"]`), i.id).not.toBeNull(); // todo campo tem rótulo
    const val = (id: string) => (raiz.querySelector(`#${id}`) as HTMLInputElement).value;
    expect(val("campo-relay")).toBe("wss://relay.exemplo.com");
    expect(val("campo-codigo")).toBe("ABCDEFGHJKMN");
    expect(val("campo-host")).toBe(`${"abab ".repeat(7)}abab`);
    expect(raiz.querySelector("[role=alert]")).not.toBeNull();
    expect(document.activeElement?.tagName).toBe("H2"); // foco no título da vista (leitor de tela)
    (raiz.querySelector("form") as HTMLFormElement).dispatchEvent(new Event("submit", { cancelable: true }));
    const pedido = c.chamadas.find(([n]) => n === "parear")?.[1][0] as { codigo: string; relay: string };
    expect(pedido.codigo).toBe("ABCDEFGHJKMN");
    expect(val("campo-codigo")).toBe(""); // saiu do formulário
    c.mudar({ fase: "pareando", etapa: "aguardando_desktop", sas: "123456" });
    expect(raiz.querySelector(".sas")?.textContent).toContain("123 456");
    expect(raiz.querySelector(".sas")?.textContent).toMatch(/mesmo do desktop/);
    expect(raiz.textContent).toMatch(/Aguardando você confirmar no desktop/);
    expect((raiz.querySelector("#campo-relay") as HTMLInputElement).disabled).toBe(true);
    c.mudar({ fase: "sem_pareamento", sas: null, etapa: null, erro: "impressao_diferente" });
    expect(raiz.querySelector("[role=alert]")?.textContent).toMatch(/impressão digital/);
    expect(raiz.querySelector(".sas")?.textContent).toBe("");
  });

  it("sem BarcodeDetector não há botão de câmera; com câmera injetada ele aparece", async () => {
    const { raiz } = await montar(falso());
    expect([...raiz.querySelectorAll("button")].some((b) => /câmera/.test(b.textContent ?? ""))).toBe(false);
    document.body.textContent = "";
    const r2 = (await montar(falso(), { camera: { detector: { detect: async () => [] }, fluxo: async () => ({ getTracks: () => [] }) } })).raiz;
    expect([...r2.querySelectorAll("button")].some((b) => /câmera/.test(b.textContent ?? ""))).toBe(true);
  });

  it("ax11_impressao_digital_comparavel (PWA): o hash do manifesto e a impressão do desktop aparecem em grupos de 4, iguais ao cálculo externo", async () => {
    const pc = await carregar<PC>("pwa/protocolo-cliente.js");
    const manifesto = randomBytes(300);
    const esperado = createHash("sha256").update(manifesto).digest("hex").slice(0, 32);
    const manifestoHex = await pc.impressaoDigital(new Uint8Array(manifesto));
    expect(manifestoHex).toBe(esperado);
    const host = createHash("sha256").update("identidade").digest("hex").slice(0, 32);
    const c = falso(conectado({ identidadeHost: host }));
    const { raiz } = await montar(c, { impressaoCliente: async () => ({ manifesto: manifestoHex, sw: "cd".repeat(16) }) });
    aba(raiz, "Configuração").click();
    await new Promise((r) => setTimeout(r, 10));
    const monos = [...raiz.querySelectorAll(".mono")].map((m) => m.textContent ?? "");
    const grupos = (h: string) => (h.match(/.{4}/g) as string[]).join(" ");
    expect(monos[0]).toContain(`manifesto ${grupos(esperado)}`);
    expect(monos[0]).toContain(`sw.js ${grupos("cd".repeat(16))}`);
    expect(monos[1]).toBe(grupos(host));
  });

  it("configuração: travar, PIN, e «esquecer» só depois de uma confirmação explícita", async () => {
    const c = falso(conectado({ nome: "Meu iPhone" }));
    const { raiz } = await montar(c);
    aba(raiz, "Configuração").click();
    expect(raiz.textContent).toContain("Meu iPhone");
    const botoes = () => [...raiz.querySelectorAll("button")];
    const por = (t: string) => botoes().find((b) => b.textContent === t) as HTMLButtonElement;
    (raiz.querySelector("#campo-pin-novo") as HTMLInputElement).value = "2468";
    por("Definir PIN").click();
    await new Promise((r) => setTimeout(r, 10));
    expect(c.chamadas.find(([n]) => n === "definirPin")?.[1]).toEqual(["2468"]);
    por("Esquecer este dispositivo").click();
    expect(c.chamadas.some(([n]) => n === "esquecer")).toBe(false);
    por("Confirmar: esquecer e apagar").click();
    expect(c.chamadas.some(([n]) => n === "esquecer")).toBe(true);
  });

  it("estados em texto: carregando, vazio e sem conexão; teclado navega as abas; aria", async () => {
    const c = falso({ fase: "conectando" });
    const { raiz } = await montar(c);
    expect(raiz.querySelector("[role=status]")?.textContent).toMatch(/Conectando/);
    expect(raiz.textContent).toMatch(/Conectando…/);
    c.mudar({ fase: "indisponivel" });
    expect(raiz.textContent).toMatch(/Sem conexão com o desktop/);
    c.mudar(conectado({ paineis: resposta("", []), missoes: resposta("", []), status: resposta("") }));
    aba(raiz, "Painéis").click();
    expect(raiz.textContent).toMatch(/Nenhum painel aberto/);
    aba(raiz, "Missões").click();
    expect(raiz.textContent).toMatch(/Nenhuma Missão/);
    const tablist = raiz.querySelector("[role=tablist]") as HTMLElement;
    expect(tablist.getAttribute("aria-label")).toBeTruthy();
    expect(aba(raiz, "Missões").getAttribute("aria-selected")).toBe("true");
    expect(aba(raiz, "Painéis").getAttribute("aria-selected")).toBe("false");
    expect(raiz.querySelector("[role=tabpanel]")?.getAttribute("aria-labelledby")).toBe("aba-missoes");
    aba(raiz, "Missões").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(aba(raiz, "Mensagem").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[aria-live]")).not.toBeNull();
    expect(raiz.querySelector(".aviso")?.textContent).toMatch(/Experimental/);
  });
});
