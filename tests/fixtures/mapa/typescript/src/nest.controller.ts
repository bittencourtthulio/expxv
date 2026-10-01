// @ts-nocheck
import { Controller, Get, Post, Cron } from "@nestjs/common";

@Controller("clientes")
export class ClientesController {
  @Get(":id")
  buscar(): string {
    return "x";
  }

  @Post()
  criar(): void {}

  @Cron("0 * * * *")
  limpar(): void {}
}
