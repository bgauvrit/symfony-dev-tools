<?php

namespace App\Controller\Admin\Options;

use EasyCorp\Bundle\EasyAdminBundle\Config\Crud;

class OptionChoiceCrudController
{
    public function configureCrud(Crud $crud): Crud
    {
        return $crud->setFormThemes(['admin/form/option_choice_theme.html.twig']);
    }
}
