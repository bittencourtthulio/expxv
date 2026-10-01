// @ts-nocheck
import express from "express";
import { listar, criar } from "./controladores";

const app = express();
const router = express.Router();
const cache = new Map<string, string>();

app.get("/users/:id", listar);
app.post("/users", authMiddleware, criar);
router.delete("/users/:id", (req, res) => res.sendStatus(204));
app.get("port");
cache.get("/users/42");
const chave = cache.get("/users/:id");
registro.get("/nao/e/rota", 1);
const msg = "GET /isto-e-so-uma-string";
console.log(msg);
this.app.put("/itens/:n", atualizar);
