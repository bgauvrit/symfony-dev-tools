<?php

namespace App\Entity\Orders;

use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class BrokenEntity
{
    #[ORM\Column]
    private ?string $name = null
}
