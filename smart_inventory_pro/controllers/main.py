from odoo import http
from odoo.http import request
import json

class SmartInventoryPortal(http.Controller):

    @http.route(['/mobile/warehouse'], type='http', auth="user", website=False)
    def mobile_warehouse_app(self, **kwargs):
        scan_mode = request.env['ir.config_parameter'].sudo().get_param('smart_inventory.scan_mode', 'timer')
        vibration = request.env['ir.config_parameter'].sudo().get_param('smart_inventory.vibration', 'True')
        values = {
            'user': request.env.user,
            'current_company': request.env.company,
            'scan_mode': scan_mode,
            'vibrate_enabled': vibration,
        }
        return request.render("smart_inventory.mobile_app_template", values)

    @http.route(['/mobile/warehouse/get_counts'], type='json', auth="user")
    def get_operation_counts(self):
        domain = [('state', 'not in', ['done', 'cancel'])]
        Picking = request.env['stock.picking'].sudo()
        try:
            return {
                'status': 'success',
                'data': {
                    'receipt': Picking.search_count(domain + [('picking_type_code', '=', 'incoming')]),
                    'delivery': Picking.search_count(domain + [('picking_type_code', '=', 'outgoing')]),
                    'return': Picking.search_count(domain + [('picking_type_code', '=', 'incoming'), ('origin', 'ilike', 'Return')]),
                    'internal': Picking.search_count(domain + [('picking_type_code', '=', 'internal')])
                }
            }
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    @http.route(['/mobile/warehouse/sync'], type='json', auth="user", methods=['POST'])
    def sync_offline_data(self, payload):
        try:
            moves = payload.get('moves', [])
            Picking = request.env['stock.picking'].sudo()
            Move = request.env['stock.move'].sudo()
            for move_data in moves:
                picking_id = Picking.browse(int(move_data['picking_id']))
                if picking_id:
                    for line in move_data['lines']:
                        st_move = Move.browse(int(line['move_id']))
                        if st_move:
                            st_move.write({'quantity': line['scanned_qty']})
                    picking_id.write({'is_processed_by_barcode': True, 'portal_user_id': request.env.user.id})
                    picking_id.with_context(skip_backorder=True, picking_ids_not_to_backorder=picking_id.ids).button_validate()
            return {'status': 'success'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    @http.route(['/mobile/warehouse/get_operations'], type='json', auth="user")
    def get_operations(self, op_type):
        domain = [('state', 'not in', ['done', 'cancel'])]
        if op_type == 'receipt': domain.append(('picking_type_code', '=', 'incoming'))
        elif op_type == 'delivery': domain.append(('picking_type_code', '=', 'outgoing'))
        elif op_type == 'return':
            domain.append(('picking_type_code', '=', 'incoming'))
            domain.append(('origin', 'ilike', 'Return'))
        elif op_type == 'internal': domain.append(('picking_type_code', '=', 'internal'))

        pickings = request.env['stock.picking'].search_read(domain, ['name', 'location_id', 'location_dest_id', 'state'], limit=15)
        return {'status': 'success', 'data': pickings}

    @http.route(['/mobile/warehouse/get_picking_lines'], type='json', auth="user")
    def get_picking_lines(self, picking_id):
        try:
            moves = request.env['stock.move'].search([('picking_id', '=', int(picking_id))])
            lines_data = [{'move_id': m.id, 'product_name': m.product_id.display_name, 'barcode': m.product_id.barcode or '', 'demand_qty': m.product_uom_qty, 'scanned_qty': m.quantity or 0.0} for m in moves]
            return {'status': 'success', 'data': lines_data}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    # --- دعم العمليات الجديدة (المرتجعات والجرد) ---
    
    @http.route(['/mobile/warehouse/get_setup_data'], type='json', auth="user")
    def get_setup_data(self):
        """جلب جهات الاتصال والمخازن لإنشاء المرتجعات والجرد"""
        partners = request.env['res.partner'].search_read([], ['id', 'display_name'], limit=50)
        locations = request.env['stock.location'].search_read([('usage', '=', 'internal')], ['id', 'display_name'])
        return {'status': 'success', 'partners': partners, 'locations': locations}

    @http.route(['/mobile/warehouse/create_return'], type='json', auth="user")
    def create_return(self, return_type, partner_id, location_id):
        try:
            type_code = 'incoming' if return_type == 'sales' else 'outgoing'
            picking_type = request.env['stock.picking.type'].search([('code', '=', type_code), ('company_id', '=', request.env.company.id)], limit=1)
            
            loc_src = request.env.ref('stock.stock_location_customers').id if return_type == 'sales' else location_id
            loc_dest = location_id if return_type == 'sales' else request.env.ref('stock.stock_location_suppliers').id
            
            picking = request.env['stock.picking'].create({
                'partner_id': int(partner_id), 'location_id': int(loc_src), 'location_dest_id': int(loc_dest),
                'picking_type_id': picking_type.id, 'origin': 'Return Mobile App'
            })
            return {'status': 'success', 'picking_id': picking.id, 'picking_name': picking.name}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}

    @http.route(['/mobile/warehouse/scan_inventory_barcode'], type='json', auth="user")
    def scan_inventory_barcode(self, barcode):
        """للبحث عن منتج بالباركود أثناء الجرد المستمر"""
        product = request.env['product.product'].search([('barcode', '=', barcode)], limit=1)
        if product:
            return {'status': 'success', 'product_id': product.id, 'product_name': product.display_name}
        return {'status': 'error'}

    @http.route(['/mobile/warehouse/save_inventory'], type='json', auth="user")
    def save_inventory(self, location_id, lines, apply=False):
        try:
            Quant = request.env['stock.quant'].sudo().with_context(inventory_mode=True)
            for line in lines:
                quant = Quant.search([('product_id', '=', int(line['product_id'])), ('location_id', '=', int(location_id))], limit=1)
                if not quant:
                    quant = Quant.create({'product_id': int(line['product_id']), 'location_id': int(location_id)})
                quant.inventory_quantity = line['scanned_qty']
                if apply:
                    quant.action_apply_inventory()
            return {'status': 'success'}
        except Exception as e:
            return {'status': 'error', 'message': str(e)}