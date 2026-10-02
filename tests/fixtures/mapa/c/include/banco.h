#ifndef BANCO_H
#define BANCO_H
#include <stdio.h>

/* Abre o banco. */
int banco_abrir(const char *caminho);
typedef struct Conexao { int fd; } Conexao;
typedef int Codigo;
#endif
