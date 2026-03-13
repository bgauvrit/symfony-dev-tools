<?php

namespace App\Controller\Catalog;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class ProductController extends AbstractController
{
    #[Route([
        'fr' => '/{_locale}/produits/{slug}/{page}',
        'en' => '/{_locale}/products/{slug}/{page}',
    ], name: 'app_product_show_locale', defaults: ['page' => 1])]
    public function show(): Response
    {
        return $this->render('catalog/product/show.html.twig');
    }
}
