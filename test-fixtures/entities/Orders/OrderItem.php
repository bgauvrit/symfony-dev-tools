<?php

namespace App\Entity\Orders;

use App\Entity\Catalog\ProductVariant;
use App\Entity\Options\OptionChoice;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class OrderItem
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;

    #[ORM\ManyToOne(inversedBy: 'items')]
    #[ORM\JoinColumn(nullable: false)]
    private ?CustomerOrder $customerOrder = null;

    #[ORM\ManyToOne(inversedBy: 'orderItems')]
    #[ORM\JoinColumn(nullable: false)]
    private ?ProductVariant $variant = null;

    /**
     * @var Collection<int, OptionChoice>
     */
    #[ORM\ManyToMany(targetEntity: OptionChoice::class, inversedBy: 'orderItems')]
    private Collection $options;

    public function __construct()
    {
        $this->options = new ArrayCollection();
    }
}
