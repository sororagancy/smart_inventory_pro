from odoo import models, fields

class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    smart_inventory_strict_barcode = fields.Boolean(
        string="Strict Barcode Validation",
        help="If enabled, workers cannot process quantities manually.",
        config_parameter='smart_inventory.strict_barcode'
    )
    
    smart_inventory_scan_mode = fields.Selection([
        ('timer', 'مؤقت زمني مع خط أصفر'),
        ('button', 'زر انتقال يدوي (بدون مؤقت)')
    ], string="Scan Delay Mode", config_parameter='smart_inventory.scan_mode', default='timer')

    smart_inventory_vibration = fields.Boolean(
        string="تفعيل الاهتزاز عند الجرد",
        help="تشغيل اهتزاز الهاتف عند كل مسحة صحيحة أو خاطئة.",
        config_parameter='smart_inventory.vibration',
        default=True
    )