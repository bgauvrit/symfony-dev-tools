<?php

namespace App\Entity\Materials;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class BiothaneSize
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 30)]
    private ?string $label = null;

    /**
     * @var Collection<int, VariantBiothaneSize>
     */
    #[ORM\OneToMany(targetEntity: VariantBiothaneSize::class, mappedBy: 'size')]
    private Collection $variantBiothaneSizes;

    public function __construct()
    {
        $this->variantBiothaneSizes = new ArrayCollection();
    }
}
