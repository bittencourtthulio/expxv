from django.db import models
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class Pedido(models.Model):
    total = models.IntegerField()


class Cliente(models.Model):
    class Meta:
        db_table = "clientes_legado"


class Produto(Base):
    __tablename__ = "produtos"


class Rascunho:
    nome = "Pedido"
