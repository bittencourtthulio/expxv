from flask import Blueprint, Flask
from fastapi import APIRouter

app = Flask(__name__)
bp = Blueprint("api", __name__, url_prefix="/api")
router = APIRouter(prefix="/v1")


@app.route("/users/<int:uid>", methods=["GET", "POST"])
def usuario(uid):
    return uid


@bp.route("/itens/<nome>")
def itens(nome):
    return nome


@router.get("/produtos/{pid}")
async def produto(pid: int):
    return pid


@router.post("/produtos")
def criar():
    pass


@cache.get("chave")
def nao_e_rota():
    pass


def helper():
    app.run()


if __name__ == "__main__":
    app.run()
