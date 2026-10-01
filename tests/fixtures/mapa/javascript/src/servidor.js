const express = require("express");
const Koa = require("koa");
const KoaRouter = require("koa-router");

const app = express();
const rotas = new KoaRouter();

app.get("/saude", (req, res) => res.send("ok"));
app.use("/api", rotas);
rotas.get("/pedidos/:id", obterPedido);
function obterPedido(ctx) {
  ctx.body = lerPedido(ctx.params.id);
}
const dados = new Map();
dados.get("/saude");
