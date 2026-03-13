<?php

namespace App\Entity\Materials;

use App\Entity\Catalog\ProductVariant;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class VariantBiothaneSize
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(inversedBy: 'variantBiothaneSizes')]
    #[ORM\JoinColumn(nullable: false)]
    private ?ProductVariant $variant = null;

    #[ORM\ManyToOne(inversedBy: 'variantBiothaneSizes')]
    #[ORM\JoinColumn(nullable: false)]
    private ?BiothaneSize $size = null;
}
