// Copyright (c) 2016, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.provide("erpnext.asset");

frappe.ui.form.on('Asset', {
	onload: function(frm) {
		frm.set_query("item_code", function() {
			return {
				"filters": {
					"disabled": 0
				}
			};
		});
		
		frm.set_query("warehouse", function() {
			return {
				"filters": {
					"company": frm.doc.company
				}
			};
		});
	},
	
	refresh: function(frm) {
		frappe.ui.form.trigger("Asset", "is_existing_asset");
		frm.toggle_display("next_depreciation_date", frm.doc.docstatus < 1);
		
		if (frm.doc.docstatus==1) {
			if (frm.doc.status=='Submitted' && !frm.doc.is_existing_asset && !frm.doc.purchase_invoice) {
				frm.add_custom_button("Make Purchase Invoice", function() {
					erpnext.asset.make_purchase_invoice(frm);
				});
			}
			if (in_list(["Submitted", "Partially Depreciated", "Fully Depreciated"], frm.doc.status)) {
				frm.add_custom_button("Transfer Asset", function() {
					erpnext.asset.transfer_asset(frm);
				});
				
				frm.add_custom_button("Scrap Asset", function() {
					erpnext.asset.scrap_asset(frm);
				});
				
				frm.add_custom_button("Sale Asset", function() {
					erpnext.asset.make_sales_invoice(frm);
				});
				
			} else if (frm.doc.status=='Scrapped') {
				frm.add_custom_button("Restore Asset", function() {
					erpnext.asset.restore_asset(frm);
				});
			}
			
			frm.trigger("show_graph");
		}
	},
	
	show_graph: function(frm) {		
		var x_intervals = ["x", frm.doc.purchase_date];
		var asset_values = ["Asset Value", frm.doc.gross_purchase_amount];
		var last_depreciation_date = frm.doc.purchase_date;
		
		if(frm.doc.opening_accumulated_depreciation) {
			last_depreciation_date = frappe.datetime.add_months(frm.doc.next_depreciation_date, 
				-1*frm.doc.frequency_of_depreciation);
			
			x_intervals.push(last_depreciation_date);
			asset_values.push(flt(frm.doc.gross_purchase_amount) - 
				flt(frm.doc.opening_accumulated_depreciation));
		}
		
		$.each(frm.doc.schedules || [], function(i, v) {
			x_intervals.push(v.schedule_date);
			asset_value = flt(frm.doc.gross_purchase_amount) - flt(v.accumulated_depreciation_amount);
			if(v.journal_entry) {				
				last_depreciation_date = v.schedule_date;
				asset_values.push(asset_value)
			} else {
				if (in_list(["Scrapped", "Sold"], frm.doc.status)) {
	 				asset_values.push(null)
				} else {
					asset_values.push(asset_value)
				}
			}
		})
		
		if(in_list(["Scrapped", "Sold"], frm.doc.status)) {
			x_intervals.push(frm.doc.disposal_date);
			asset_values.push(0);
			last_depreciation_date = frm.doc.disposal_date;
		}
		
		frm.dashboard.setup_chart({
			data: {
				x: 'x',
				columns: [x_intervals, asset_values],
				regions: {
					'Asset Value': [{'start': last_depreciation_date, 'style':'dashed'}]
				}
			},
			legend: {
				show: false
			},
			axis: {
				x: {
					type: 'category'
				},
				y: {
					min: 0,
					padding: {bottom: 10}
				}
			}
		});		
	},
	
	is_existing_asset: function(frm) {
		frm.toggle_enable("supplier", frm.doc.is_existing_asset);
		frm.toggle_reqd("next_depreciation_date", !frm.doc.is_existing_asset);
	}
});

erpnext.asset.make_purchase_invoice = function(frm) {
	frappe.call({
		args: {
			"asset": frm.doc.name,
			"item_code": frm.doc.item_code,
			"gross_purchase_amount": frm.doc.gross_purchase_amount,
			"company": frm.doc.company,
			"posting_date": frm.doc.purchase_date
		},
		method: "erpnext.accounts.doctype.asset.asset.make_purchase_invoice",
		callback: function(r) {
			var doclist = frappe.model.sync(r.message);
			frappe.set_route("Form", doclist[0].doctype, doclist[0].name);
		}
	})
}

erpnext.asset.make_sales_invoice = function(frm) {
	frappe.call({
		args: {
			"asset": frm.doc.name,
			"item_code": frm.doc.item_code,
			"company": frm.doc.company
		},
		method: "erpnext.accounts.doctype.asset.asset.make_sales_invoice",
		callback: function(r) {
			var doclist = frappe.model.sync(r.message);
			frappe.set_route("Form", doclist[0].doctype, doclist[0].name);
		}
	})
}

erpnext.asset.scrap_asset = function(frm) {
	frappe.confirm(__("Do you really want to scrap this asset?"), function () {
		frappe.call({
			args: {
				"asset_name": frm.doc.name
			},
			method: "erpnext.accounts.doctype.asset.depreciation.scrap_asset",
			callback: function(r) {
				cur_frm.reload_doc();
			}
		})
	})
}

erpnext.asset.restore_asset = function(frm) {
	frappe.confirm(__("Do you really want to restore this scrapped asset?"), function () {
		frappe.call({
			args: {
				"asset_name": frm.doc.name
			},
			method: "erpnext.accounts.doctype.asset.depreciation.restore_asset",
			callback: function(r) {
				cur_frm.reload_doc();
			}
		})
	})
}

erpnext.asset.transfer_asset = function(frm) {
	var dialog = new frappe.ui.Dialog({
		title: __("Transfer Asset"),
		fields: [
			{
				"label": __("Target Warehouse"), 
				"fieldname": "target_warehouse",
				"fieldtype": "Link", 
				"options": "Warehouse",
				"get_query": function () {
					return {
						filters: [["Warehouse", "company", "in", ["", cstr(frm.doc.company)]]]
					}
				}, 
				"reqd": 1 
			},
			{
				"label": __("Date"), 
				"fieldname": "transfer_date",
				"fieldtype": "Datetime", 
				"reqd": 1,
				"default": frappe.datetime.now_datetime()
			}
		]
	});

	dialog.set_primary_action(__("Transfer"), function() {
		args = dialog.get_values();
		if(!args) return;
		dialog.hide();
		return frappe.call({
			type: "GET",
			method: "erpnext.accounts.doctype.asset.asset.transfer_asset",
			args: {
				args: {
					"asset": frm.doc.name,
					"transaction_date": args.transfer_date,
					"source_warehouse": frm.doc.warehouse,
					"target_warehouse": args.target_warehouse,
					"company": frm.doc.company
				}
			},
			freeze: true,
			callback: function(r) {
				cur_frm.reload_doc();
			}
		})
	});
	dialog.show();
}