import { describe, expect, it } from "vitest";
import { criarVarredor, detectarLocal, semAnsi, urlAbrivel } from "./url";

describe("extração de URL/porta da saída (só loopback)", () => {
  it.each([
    ["  ➜  Local:   http://localhost:5173/", 5173, "http://localhost:5173/"],
    ["ready - started server on 0.0.0.0:3000, url: http://localhost:3000", 3000, "http://localhost:3000/"],
    ["Running on http://127.0.0.1:5000 (Press CTRL+C to quit)", 5000, "http://127.0.0.1:5000/"],
    ["Local: http://[::1]:4321/", 4321, "http://[::1]:4321/"],
    ["Listening on http://0.0.0.0:8080/api", 8080, "http://localhost:8080/api"],
    ["Server listening on port 9000", 9000, "http://localhost:9000/"],
    ["Started Application on port 8081 (http) with context path ''", 8081, "http://localhost:8081/"],
    ["serving at localhost:7000", 7000, "http://localhost:7000/"],
    ["\u001b[32mhttp://localhost:\u001b[1m3001\u001b[0m", 3001, "http://localhost:3001/"],
  ])("%s", (texto, porta, url) => {
    const r = detectarLocal(texto);
    if (porta === null) { expect(r).toBeNull(); return; }
    expect(r).toEqual({ porta, url });
  });

  it("ANSI é removido antes de procurar", () => {
    expect(semAnsi("\u001b[32mhttp://localhost:3001\u001b[0m")).toBe("http://localhost:3001");
    expect(detectarLocal("\u001b[32mhttp://localhost:3001/\u001b[0m")).toEqual({ porta: 3001, url: "http://localhost:3001/" });
  });

  it("URL maliciosa na saída nunca vira botão: externa, credenciais, esquema estranho, porta inválida", () => {
    for (const t of [
      "http://evil.example.com:3000", "https://localhost.evil.com:3000", "http://user:pass@localhost:3000/", "javascript:alert(1)", "file:///etc/passwd",
      "http://localhost:99999", "http://localhost:0", "http://169.254.169.254/latest/meta-data", "ftp://localhost:21",
    ]) expect(detectarLocal(t), t).toBeNull();
  });

  it("uma URL externa antes de uma local não atrapalha", () => {
    expect(detectarLocal("docs em https://exemplo.com/ e app em http://localhost:3000/")).toEqual({ porta: 3000, url: "http://localhost:3000/" });
  });

  it("urlAbrivel revalida antes do shell.openExternal", () => {
    expect(urlAbrivel("http://localhost:3000/")).toBe(true);
    expect(urlAbrivel("https://127.0.0.1:8443/x")).toBe(true);
    expect(urlAbrivel("http://exemplo.com")).toBe(false);
    expect(urlAbrivel("http://u:p@localhost")).toBe(false);
    expect(urlAbrivel("file:///x")).toBe(false);
    expect(urlAbrivel("nao é url")).toBe(false);
  });
});

describe("varredor incremental (DoS por saída infinita)", () => {
  it("junta uma URL partida em dois pedaços", () => {
    const v = criarVarredor();
    expect(v.alimentar("Local: http://local")).toBeNull();
    expect(v.alimentar("host:5173/\n")).toEqual({ porta: 5173, url: "http://localhost:5173/" });
  });
  it("para depois de achar e não varre mais", () => {
    const v = criarVarredor();
    expect(v.alimentar("http://localhost:1111/")).not.toBeNull();
    expect(v.encerrado()).toBe(true);
    expect(v.alimentar("http://localhost:2222/")).toBeNull();
  });
  it("saída infinita sem URL para no teto de bytes e fica barata", () => {
    const v = criarVarredor(100_000);
    const lixo = "x".repeat(10_000);
    const t0 = Date.now();
    for (let i = 0; i < 20_000; i += 1) v.alimentar(lixo); // 200 MB simulados
    expect(v.encerrado()).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(v.alimentar("http://localhost:3000/")).toBeNull();
  });
  it("pedaço gigante só tem os primeiros 64 KiB varridos", () => {
    const v = criarVarredor();
    expect(v.alimentar(`${"y".repeat(70_000)}http://localhost:3000/`)).toBeNull();
  });
});
