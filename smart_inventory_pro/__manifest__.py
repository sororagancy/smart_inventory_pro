{
    'name': 'Smart Inventory & Portal App',
    'version': '18.0.3.0.0',
    'author': 'SoRoR Agancy',
    'website': 'sororagancycom',
    'price': 30.00,
    'currency': 'USD',
    'license': 'OPL-1', # الترخيص القياسي للموديولات المدفوعة في أودو
    'images': ['static/description/banner.png'],
    'summary': 'Advanced Warehouse App with Offline Mobile Portal & OWL Dashboard',
    'depends': ['base', 'stock', 'web', 'portal'],
    'data': [
        'security/security.xml',
        'security/ir.model.access.csv',
        'views/portal_templates.xml',
        'views/backend_views.xml',
        'views/res_config_views.xml',
        'views/menus.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'smart_inventory_pro/static/src/js/backend_dashboard.js',
            'smart_inventory_pro/static/src/xml/backend_dashboard.xml',
        ],
        'smart_inventory.portal_assets': [
            'smart_inventory_pro/static/src/css/portal_glassmorphism.css',
            # تم إزالة الجافاسكريبت من هنا لمنع أودو من تدمير الدوال
        ],
    },
    'installable': True,
    'application': True,
    'license': 'LGPL-3',
}
