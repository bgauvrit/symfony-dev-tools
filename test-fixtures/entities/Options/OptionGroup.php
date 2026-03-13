<?php

namespace App\Entity\Options;

use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class OptionGroup
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 120)]
    private ?string $name = null;

    /**
     * @var Collection<int, OptionChoice>
     */
    #[ORM\OneToMany(targetEntity: OptionChoice::class, mappedBy: 'optionGroup')]
    private Collection $choices;

    public function __construct()
    {
        $this->choices = new ArrayCollection();
    }
}
