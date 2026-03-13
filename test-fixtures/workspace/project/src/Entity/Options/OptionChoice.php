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
