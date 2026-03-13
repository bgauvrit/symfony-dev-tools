<?php

namespace App\Entity\Options;

use App\Entity\Orders\OrderItem;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class OptionChoice
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\Column(length: 255)]
    private ?string $name = null;

    #[ORM\ManyToOne(inversedBy: 'choices')]
    #[ORM\JoinColumn(nullable: false)]
    private ?OptionGroup $optionGroup = null;

    #[ORM\Column(length: 40)]
    private ?string $code = null;

    /**
     * @var Collection<int, OrderItem>
     */
    #[ORM\ManyToMany(targetEntity: OrderItem::class, mappedBy: 'options')]
    private Collection $orderItems;

    public function __construct()
    {
        $this->orderItems = new ArrayCollection();
    }
}
