from odoo import models, fields, api

class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.model_create_multi
    def create(self, vals_list):
        users = super(ResUsers, self).create(vals_list)
        # تحديد الأكشن الافتراضي ليفتح لوحة البيانات فور تسجيل الدخول
        dashboard_action = self.env.ref('smart_inventory.action_smart_inventory_dashboard', raise_if_not_found=False)
        for user in users:
            if user.has_group('smart_inventory.group_inventory_portal_worker') and dashboard_action:
                user.write({'action_id': dashboard_action.id})
        return users