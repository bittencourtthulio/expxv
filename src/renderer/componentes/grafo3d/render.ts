// Renderizador WebGL2 mínimo do grafo 3D: um programa de pontos (halo + núcleo no shader, névoa exponencial, mistura aditiva no
// tema escuro e alfa comum no claro) e um de linhas com cor por vértice. Buffers dinâmicos, atualizados por quadro.
import type { RGB } from "./cores";

const VS_PONTOS = `#version 300 es
in vec3 aPos; in vec3 aCor; in float aTam; in float aForca; in float aFase;
uniform mat4 uVP; uniform float uTempo; uniform float uEscala; uniform float uNevoa;
out vec3 vCor; out float vForca; out float vNevoa;
void main(){
  vec4 p = uVP * vec4(aPos, 1.0);
  if (aForca <= 0.001 || p.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float pulso = 1.0 + 0.16 * sin(uTempo * 1.7 + aFase);
  gl_PointSize = clamp(aTam * pulso * (0.55 + 0.75 * aForca) * uEscala / p.w, 2.0, 180.0);
  gl_Position = p; vCor = aCor; vForca = aForca; vNevoa = exp(-uNevoa * uNevoa * p.w * p.w);
}`;
const FS_PONTOS = `#version 300 es
precision mediump float;
in vec3 vCor; in float vForca; in float vNevoa;
uniform vec3 uNucleo; uniform float uGanho;
out vec4 saida;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
  float nucleo = smoothstep(0.22, 0.0, d); float halo = pow(1.0 - d, 3.2);
  vec3 c = mix(vCor, uNucleo, nucleo * 0.75);
  saida = vec4(c, clamp((nucleo + halo * 0.5) * min(vForca, 1.6) * vNevoa * uGanho, 0.0, 1.0));
}`;
const VS_LINHAS = `#version 300 es
in vec3 aPos; in vec4 aCor;
uniform mat4 uVP; uniform float uNevoa;
out vec4 vCor;
void main(){
  vec4 p = uVP * vec4(aPos, 1.0);
  gl_Position = p; vCor = vec4(aCor.rgb, aCor.a * exp(-uNevoa * uNevoa * p.w * p.w));
}`;
const FS_LINHAS = `#version 300 es
precision mediump float;
in vec4 vCor; out vec4 saida;
void main(){ saida = vCor; }`;

export const PASSO_PONTO = 9;  // x y z r g b tam forca fase
export const PASSO_LINHA = 7;  // x y z r g b a

function programa(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram() as WebGLProgram;
  for (const [tipo, fonte] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(tipo) as WebGLShader;
    gl.shaderSource(s, fonte); gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) throw new Error(`shader: ${gl.getShaderInfoLog(s) ?? "erro"}`);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true) throw new Error("programa do grafo não vinculou");
  return p;
}

interface Lote { vao: WebGLVertexArrayObject; buf: WebGLBuffer; dados: Float32Array; n: number; passo: number }

export interface EstadoQuadro { vp: Float32Array; tempo: number; escala: number; nevoa: number }
export interface Renderizador {
  redimensionar(w: number, h: number, dpr: number): void;
  tema(fundo: RGB, nucleo: RGB, claro: boolean): void;
  pontos: Lote; pulsos: Lote; linhas: Lote; poeira: Lote;
  desenhar(q: EstadoQuadro): void;
  foto(q: EstadoQuadro, fundo: RGB): string;
  descartar(): void;
}
export type { Lote };

export function criarRenderizador(canvas: HTMLCanvasElement, nPontos: number, nPulsos: number, nLinhas: number, nPoeira: number, aoPerder: () => void): Renderizador {
  const ctx = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false });
  if (ctx === null) throw new Error("WebGL2 indisponível");
  const gl: WebGL2RenderingContext = ctx;
  const pp = programa(gl, VS_PONTOS, FS_PONTOS), pl = programa(gl, VS_LINHAS, FS_LINHAS);
  const u = (p: WebGLProgram, n: string): WebGLUniformLocation | null => gl.getUniformLocation(p, n);
  const up = { vp: u(pp, "uVP"), tempo: u(pp, "uTempo"), escala: u(pp, "uEscala"), nevoa: u(pp, "uNevoa"), nucleo: u(pp, "uNucleo"), ganho: u(pp, "uGanho") };
  const ul = { vp: u(pl, "uVP"), nevoa: u(pl, "uNevoa") };

  const lote = (prog: WebGLProgram, n: number, passo: number, attrs: Array<[string, number]>): Lote => {
    const vao = gl.createVertexArray() as WebGLVertexArrayObject, buf = gl.createBuffer() as WebGLBuffer;
    const dados = new Float32Array(Math.max(n, 1) * passo);
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, dados.byteLength, gl.DYNAMIC_DRAW);
    let off = 0;
    for (const [nome, tam] of attrs) {
      const loc = gl.getAttribLocation(prog, nome);
      if (loc >= 0) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, tam, gl.FLOAT, false, passo * 4, off * 4); }
      off += tam;
    }
    gl.bindVertexArray(null);
    return { vao, buf, dados, n, passo };
  };
  const attrP: Array<[string, number]> = [["aPos", 3], ["aCor", 3], ["aTam", 1], ["aForca", 1], ["aFase", 1]];
  const pontos = lote(pp, nPontos, PASSO_PONTO, attrP), pulsos = lote(pp, nPulsos, PASSO_PONTO, attrP), poeira = lote(pp, nPoeira, PASSO_PONTO, attrP);
  const linhas = lote(pl, nLinhas * 2, PASSO_LINHA, [["aPos", 3], ["aCor", 4]]);
  let claro = false, nucleo: RGB = [1, 1, 1];
  const perdeu = (e: Event): void => { e.preventDefault(); aoPerder(); };
  canvas.addEventListener("webglcontextlost", perdeu);

  const subir = (l: Lote): void => { gl.bindBuffer(gl.ARRAY_BUFFER, l.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, l.dados, 0, l.n * l.passo); };
  const mistura = (): void => { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, claro ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE); };

  function desenhar(q: EstadoQuadro, fundo: RGB | null): void {
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (fundo === null) gl.clearColor(0, 0, 0, 0); else gl.clearColor(fundo[0], fundo[1], fundo[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); mistura();
    if (linhas.n > 0) {
      gl.useProgram(pl); gl.uniformMatrix4fv(ul.vp, false, q.vp); gl.uniform1f(ul.nevoa, q.nevoa);
      gl.bindVertexArray(linhas.vao); subir(linhas); gl.drawArrays(gl.LINES, 0, linhas.n);
    }
    gl.useProgram(pp); gl.uniformMatrix4fv(up.vp, false, q.vp); gl.uniform1f(up.tempo, q.tempo); gl.uniform1f(up.escala, q.escala); gl.uniform1f(up.nevoa, q.nevoa);
    gl.uniform3f(up.nucleo, nucleo[0], nucleo[1], nucleo[2]); gl.uniform1f(up.ganho, claro ? 1.7 : 1);
    for (const l of [poeira, pontos, pulsos]) { if (l.n === 0) continue; gl.bindVertexArray(l.vao); subir(l); gl.drawArrays(gl.POINTS, 0, l.n); }
    gl.bindVertexArray(null);
  }

  return {
    pontos, pulsos, linhas, poeira,
    redimensionar(w, h, dpr) { const cw = Math.max(1, Math.round(w * dpr)), ch = Math.max(1, Math.round(h * dpr)); if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; } },
    tema(_fundo, n, c) { nucleo = n; claro = c; },
    desenhar: (q) => desenhar(q, null),
    foto(q, fundo) { desenhar(q, fundo); const url = canvas.toDataURL("image/png"); return url; },
    descartar() {
      canvas.removeEventListener("webglcontextlost", perdeu);
      for (const l of [pontos, pulsos, linhas, poeira]) { gl.deleteBuffer(l.buf); gl.deleteVertexArray(l.vao); }
      gl.deleteProgram(pp); gl.deleteProgram(pl);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
