from odoo import models, fields, api

class StockPicking(models.Model):
    _name = 'stock.picking'
    _inherit = ['stock.picking', 'mail.thread', 'mail.activity.mixin']

    is_processed_by_barcode = fields.Boolean(
        string='Processed via Barcode', 
        default=False, 
        readonly=True,
        tracking=True
    )
    
    portal_user_id = fields.Many2one(
        'res.users', 
        string='Processed By (Mobile)', 
        readonly=True,
        tracking=True
    )

    @api.model
    def get_smart_dashboard_stats(self):
        """دالة لجلب بيانات لوحة التحكم مع شمول كافة الحركات غير المنتهية (بما فيها المسودات)"""
        
        # التعديل: جلب كل ما هو ليس منتهياً أو ملغياً
        domain_base = [('state', 'not in', ['done', 'cancel'])]
        
        stats = {
            'receipt': self.search_count(domain_base + [('picking_type_code', '=', 'incoming')]),
            'delivery': self.search_count(domain_base + [('picking_type_code', '=', 'outgoing')]),
            'return': self.search_count(domain_base + [('picking_type_code', '=', 'incoming'), ('origin', 'ilike', 'Return')]), 
            'internal': self.search_count(domain_base + [('picking_type_code', '=', 'internal')]),
        }
        
        recent_operations = self.search_read(
            [('state', '=', 'done')], 
            ['name', 'picking_type_id', 'location_id', 'location_dest_id', 'is_processed_by_barcode', 'portal_user_id', 'date_done'], 
            limit=10,
            order='date_done desc'
        )
        
        return {'stats': stats, 'recent_operations': recent_operations}


class StockMoveLine(models.Model):
    _inherit = 'stock.move.line'

    scanned_qty = fields.Float(string='Scanned Quantity', default=0.0)