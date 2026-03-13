<?php

namespace App\Entity\Accounts;

use App\Entity\Orders\CustomerOrder;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\Common\Collections\Collection;
use Doctrine\ORM\Mapping as ORM;

#[ORM\Entity]
class User
{
    #[ORM\Id]
    #[ORM\Column]
    private ?int $id = null;

    /**
     * @var Collection<int, CustomerOrder>
     */
    #[ORM\OneToMany(targetEntity: CustomerOrder::class, mappedBy: 'user')]
    private Collection $orders;

    public function __construct()
    {
        $this->orders = new ArrayCollection();
    }
}
