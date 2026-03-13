<?php

namespace App\Entity\Catalog;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class Product
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 255)]
    private ?string $name = null;

    /**
     * @var Collection<int, ProductVariant>
     */
    #[ORM\OneToMany(targetEntity: ProductVariant::class, mappedBy: 'product')]
    private Collection $variants;

    public function __construct()
    {
        $this->variants = new ArrayCollection();
    }

    // refresh-1773326502165

    // refresh-1773326513468

    // refresh-1773326606240
}
