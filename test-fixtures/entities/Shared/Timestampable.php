<?php

namespace App\Entity\Shared;

use Doctrine\ORM\Mapping as ORM;

#[ORM\MappedSuperclass]
class Timestampable
{
    #[ORM\Column]
    protected ?\DateTimeImmutable $createdAt = null;
}
