<?php
namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
#[ORM\Table(name: 'pedidos')]
class Pedido {}

/**
 * @ORM\Entity
 * @ORM\Table(name="itens_pedido")
 */
class Item {}
