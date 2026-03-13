<?php

namespace App\Controller\Catalog;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use function Symfony\Component\Translation\t;

class TranslationProbeController extends AbstractController
{
    public function index(): Response
    {
        $dynamicKey = 'catalog.dynamic.key';

        $this->trans('catalog.product.title');
        $this->trans('catalog.product.missing');
        $this->trans($dynamicKey);
        t('title.home');

        return new Response();
    }
}
