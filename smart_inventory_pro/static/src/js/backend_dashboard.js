/** @odoo-module */

import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { Component, onWillStart, useState } from "@odoo/owl";

export class SmartInventoryDashboard extends Component {
    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        
        this.state = useState({
            stats: { receipt: 0, delivery: 0, return: 0, internal: 0 },
            recentOperations: []
        });

        onWillStart(async () => {
            await this.fetchDashboardData();
        });
    }

    async fetchDashboardData() {
        const data = await this.orm.call("stock.picking", "get_smart_dashboard_stats", []);
        this.state.stats = data.stats;
        this.state.recentOperations = data.recent_operations;
    }

    // لفتح قائمة العمليات عند الضغط على إحدى البطاقات
    openPickingList(type_code) {
        this.action.doAction({
            type: 'ir.actions.act_window',
            name: 'Operations',
            res_model: 'stock.picking',
            views: [[false, 'list'], [false, 'form']],
            domain: [['picking_type_code', '=', type_code]],
        });
    }
}

SmartInventoryDashboard.template = "smart_inventory.DashboardTemplate";
// تسجيل الكومبوننت كـ Client Action
registry.category("actions").add("smart_inventory_dashboard_action", SmartInventoryDashboard);