<?php

namespace App\Controller\Accounts;

use App\Form\Accounts\RegisterUserType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

class RegisterController extends AbstractController
{
    #[Route([
        'fr' => '/inscription',
        'en' => '/register',
    ], name: 'app_register')]
    public function index(): Response
    {
        $form = $this->createForm(RegisterUserType::class);

        return $this->render('account/auth/register.html.twig', [
            'registerForm' => $form,
        ]);
    }

    public function redirect(): Response
    {
        $this->generateUrl('app_product_show_locale');

        return $this->redirectToRoute('app_register');
    }
}
