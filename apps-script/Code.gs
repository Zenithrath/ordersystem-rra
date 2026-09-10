// ========================================
// Work Order Management System - Backend
// Google Apps Script (13 Columns - Excel Format)
// ========================================

const SHEET_ORDERS = "ORDERS";
const SHEET_ITEMS = "ORDER_ITEMS";
const CACHE_TTL = 180;
const COL_COUNT = 13;

const HEADERS = [
  "OrderID", "Date", "Department", "Purpose", "Status",
  "User", "ItemName", "Quantity", "Unit", "SaldoQty", "SaldoUom", "NoPR", "Clear"
];

function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : "getDashboardStats";
  let result;
  try {
    switch (action) {
      case "getOrders": result = getOrders(e.parameter); break;
      case "getOrderDetail": result = getOrderDetail(e.parameter.id); break;
      case "getDashboardStats": result = getDashboardStats(); break;
      case "getDepartments": result = getDepartments(); break;
      case "createOrder": result = createOrder(JSON.parse(e.parameter.data)); break;
      case "updateOrder": result = updateOrder(JSON.parse(e.parameter.data)); break;
      case "updateOrderStatus": result = updateOrderStatus({ orderId: e.parameter.orderId, status: e.parameter.status }); break;
      case "deleteOrder": result = deleteOrder(e.parameter.id); break;
      case "exportExcel": result = exportExcel(e.parameter); break;
      case "migrateData": result = migrateData(); break;
      case "generateSampleData": result = generateSampleData(); break;
      default: result = { success: false, message: "Unknown action" };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// Sheet Helpers
// ========================================

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_ORDERS) {
      sheet.appendRow(HEADERS);
    }
  }
  return sheet;
}

function generateOrderID() {
  const sheet = getSheet(SHEET_ORDERS);
  const today = new Date();
  const dateStr = Utilities.formatDate(today, "Asia/Jakarta", "yyyyMMdd");
  const prefix = "WO-" + dateStr + "-";
  const lastRow = sheet.getLastRow();
  let maxNum = 0;
  if (lastRow > 1) {
    const readStart = Math.max(2, lastRow - 199);
    const ids = sheet.getRange(readStart, 1, lastRow - readStart + 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const oid = ids[i][0];
      if (oid && typeof oid === "string" && oid.startsWith(prefix)) {
        const num = parseInt(oid.split("-")[2], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }
  return prefix + String(maxNum + 1).padStart(3, "0");
}

// Read orders: group flat rows by OrderID
function readOrders() {
  const sheet = getSheet(SHEET_ORDERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(1, 1, lastRow, COL_COUNT).getValues();
  const orderMap = {};
  const orderKeys = [];

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const oid = String(r[0] || "").trim();
    if (!oid) continue;

    if (!orderMap[oid]) {
      let dateVal = r[1];
      if (dateVal instanceof Date) {
        dateVal = Utilities.formatDate(dateVal, "Asia/Jakarta", "yyyy-MM-dd");
      } else {
        dateVal = String(dateVal || "");
      }

      orderMap[oid] = {
        OrderID: oid,
        Date: dateVal,
        Department: String(r[2] || ""),
        Purpose: String(r[3] || ""),
        Status: String(r[4] || "Pending"),
        Items: []
      };
      orderKeys.push(oid);
    }

    const itemName = String(r[6] || "").trim();
    const userName = String(r[5] || "").trim();
    if (itemName) {
      orderMap[oid].Items.push({
        User: userName,
        ItemName: itemName,
        Quantity: parseInt(r[7]) || 0,
        Unit: String(r[8] || "pcs"),
        SaldoQty: parseInt(r[9]) || 0,
        SaldoUom: String(r[10] || "pcs"),
        Clear: String(r[12] || "") === "TRUE" || String(r[12] || "") === "1"
      });
    }
  }

  return orderKeys.map(oid => {
    const o = orderMap[oid];
    o.ItemCount = o.Items.length;
    o.ItemNames = o.Items.map(it => it.ItemName + " (" + it.Quantity + " " + it.Unit + ")").join(", ");
    o.Users = [...new Set(o.Items.map(it => it.User).filter(u => u))].join(", ");
    o.NoPR = oid;
    o.Clear = o.Items.every(it => it.Clear);
    return o;
  });
}

// ========================================
// Migration
// ========================================

function migrateData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let ordersSheet = ss.getSheetByName(SHEET_ORDERS);
  const itemsSheet = ss.getSheetByName(SHEET_ITEMS);

  if (!ordersSheet) {
    ordersSheet = ss.insertSheet(SHEET_ORDERS);
    ordersSheet.appendRow(HEADERS);
    if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
    return { success: true, message: "Sheet ORDERS baru dibuat dengan 13 kolom" };
  }

  const lastRow = ordersSheet.getLastRow();
  if (lastRow < 2) {
    ordersSheet.clearContents();
    ordersSheet.appendRow(HEADERS);
    if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
    return { success: true, message: "Sheet ORDERS kosong, header sudah di-set" };
  }

  const numCols = ordersSheet.getLastColumn();
  const headers = ordersSheet.getRange(1, 1, 1, numCols).getValues()[0];

  // Check if already migrated to 13 cols
  if (headers.includes("SaldoQty") && headers.includes("Clear") && headers.includes("NoPR")) {
    if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
    return { success: true, message: "Sudah di-migrate (13 kolom)" };
  }

  // Read items from old sheet
  const itemData = {};
  if (itemsSheet && itemsSheet.getLastRow() > 1) {
    const iRows = itemsSheet.getDataRange().getValues();
    for (let i = 1; i < iRows.length; i++) {
      const oid = String(iRows[i][0]).trim();
      if (!oid) continue;
      if (!itemData[oid]) itemData[oid] = [];
      itemData[oid].push({
        ItemName: String(iRows[i][1] || ""),
        Quantity: Number(iRows[i][2]) || 0,
        Unit: String(iRows[i][3] || "pcs"),
        Notes: String(iRows[i][4] || "")
      });
    }
  }

  // Read old data
  const allData = ordersSheet.getRange(1, 1, lastRow, numCols).getValues();
  const oldHeaders = allData[0];
  const colIdx = {};
  oldHeaders.forEach((h, i) => { colIdx[h] = i; });

  // Build new 13-col rows
  const newRows = [];
  for (let i = 1; i < allData.length; i++) {
    const r = allData[i];
    const oid = String(r[colIdx["OrderID"] || 0] || "").trim();
    if (!oid) continue;

    let dateVal = r[colIdx["Date"] || 1] || "";
    if (dateVal instanceof Date) {
      dateVal = Utilities.formatDate(dateVal, "Asia/Jakarta", "yyyy-MM-dd");
    }

    // Check if items already in JSON
    let items = [];
    const itemsCol = colIdx["Items"];
    if (itemsCol !== undefined && r[itemsCol]) {
      try {
        const parsed = JSON.parse(String(r[itemsCol]));
        if (Array.isArray(parsed)) items = parsed;
      } catch(e) {}
    }
    if (items.length === 0 && itemData[oid]) {
      items = itemData[oid];
    }
    if (items.length === 0) {
      items = [{ ItemName: "", Quantity: 0, Unit: "pcs", SaldoQty: 0, SaldoUom: "pcs", Clear: false }];
    }

    for (const it of items) {
      newRows.push([
        oid,
        dateVal,
        String(r[colIdx["Department"] || 3] || ""),
        String(r[colIdx["Purpose"] || 4] || ""),
        String(r[colIdx["Status"] || 6] || "Pending"),
        it.User || it.user || "",
        it.ItemName || it.itemName || "",
        parseInt(it.Quantity || it.quantity) || 0,
        it.Unit || it.unit || "pcs",
        parseInt(it.SaldoQty || it.saldoQty) || 0,
        it.SaldoUom || it.saldoUom || "pcs",
        oid,
        it.Clear || false
      ]);
    }
  }

  ordersSheet.clearContents();
  ordersSheet.getRange(1, 1, 1, COL_COUNT).setValues([HEADERS]);
  if (newRows.length > 0) {
    ordersSheet.getRange(2, 1, newRows.length, COL_COUNT).setValues(newRows);
  }

  if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Berhasil migrate " + newRows.length + " baris (13 kolom)" };
}

// ========================================
// Core Functions
// ========================================

function getOrders(params) {
  let enriched = readOrders();

  if (params.q) {
    const q = params.q.toLowerCase();
    enriched = enriched.filter(o =>
      (o.OrderID && o.OrderID.toLowerCase().includes(q)) ||
      (o.Users && o.Users.toLowerCase().includes(q)) ||
      (o.ItemNames && o.ItemNames.toLowerCase().includes(q))
    );
  }
  if (params.status) enriched = enriched.filter(o => o.Status === params.status);
  if (params.department) enriched = enriched.filter(o => o.Department === params.department);
  if (params.month && params.year) {
    const m = parseInt(params.month) - 1;
    const y = parseInt(params.year);
    enriched = enriched.filter(o => { const d = new Date(o.Date); return d.getMonth() === m && d.getFullYear() === y; });
  } else if (params.month) {
    const m = parseInt(params.month) - 1;
    const y = new Date().getFullYear();
    enriched = enriched.filter(o => { const d = new Date(o.Date); return d.getMonth() === m && d.getFullYear() === y; });
  } else if (params.year) {
    const y = parseInt(params.year);
    enriched = enriched.filter(o => new Date(o.Date).getFullYear() === y);
  }

  const sortField = params.sort || "date";
  const sortDir = params.dir === "asc" ? 1 : -1;
  enriched.sort((a, b) => {
    if (sortField === "date") return sortDir * (new Date(a.Date) - new Date(b.Date));
    if (sortField === "orderId") return sortDir * a.OrderID.localeCompare(b.OrderID);
    return 0;
  });

  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 25));
  const total = enriched.length;
  const start = (page - 1) * pageSize;

  return {
    success: true,
    data: enriched.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
  };
}

function getOrderDetail(orderId) {
  if (!orderId) return { success: false, message: "Order ID is required" };
  const orders = readOrders();
  const order = orders.find(o => o.OrderID === orderId);
  if (!order) return { success: false, message: "Order not found" };
  return { success: true, data: order };
}

function getDashboardStats() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("dashboard_stats");
  if (cached) return JSON.parse(cached);

  const orders = readOrders();
  const now = new Date();
  const cm = now.getMonth(), cy = now.getFullYear();

  const stats = {
    totalOrders: orders.length,
    pendingOrders: orders.filter(o => o.Status === "Pending").length,
    completedOrders: orders.filter(o => o.Status === "Completed").length,
    inProgressOrders: orders.filter(o => o.Status === "In Progress").length,
    cancelledOrders: orders.filter(o => o.Status === "Cancelled").length,
    ordersThisMonth: orders.filter(o => { const d = new Date(o.Date); return d.getMonth() === cm && d.getFullYear() === cy; }).length,
    recentOrders: orders.sort((a, b) => new Date(b.Date) - new Date(a.Date)).slice(0, 5)
  };

  const result = { success: true, data: stats };
  cache.put("dashboard_stats", JSON.stringify(result), CACHE_TTL);
  return result;
}

function getDepartments() {
  return { success: true, data: ["Engineering", "Project Management", "Procurement", "Operations", "Finance", "HR & Admin", "IT", "Marketing", "Logistics", "Other"] };
}

function createOrder(body) {
  const { date, department, purpose, items } = body;
  if (!department || !items || items.length === 0) {
    return { success: false, message: "Missing required fields" };
  }

  const orderId = generateOrderID();
  const orderDate = date || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
  const sheet = getSheet(SHEET_ORDERS);

  const rows = items.map(it => [
    orderId, orderDate, department,
    purpose || "", "Pending",
    it.user || "",
    it.itemName || "",
    parseInt(it.quantity) || 0,
    it.unit || "pcs",
    parseInt(it.saldoQty) || 0,
    it.saldoUom || "pcs",
    orderId,
    it.clear || false
  ]);

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, COL_COUNT).setValues(rows);
  }

  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order created successfully", data: { orderId } };
}

function updateOrder(body) {
  const { orderId, date, department, purpose, items } = body;
  if (!orderId) return { success: false, message: "Order ID is required" };

  const sheet = getSheet(SHEET_ORDERS);
  const data = sheet.getDataRange().getValues();
  const startRow = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) startRow.push(i + 1);
  }
  if (startRow.length === 0) return { success: false, message: "Order not found" };

  // Delete old rows (bottom to top)
  for (let i = startRow.length - 1; i >= 0; i--) {
    sheet.deleteRow(startRow[i]);
  }

  // Get current status from first deleted row
  const oldStatus = data[startRow[0] - 1][4] || "Pending";

  // Insert new rows
  const orderDate = date || data[startRow[0] - 1][1];
  const rows = (items && items.length > 0 ? items : [{ user: "", itemName: "", quantity: 0, unit: "pcs", saldoQty: 0, saldoUom: "pcs", clear: false }]).map(it => [
    orderId, orderDate,
    department || "", purpose || "", oldStatus,
    it.user || "",
    it.itemName || "",
    parseInt(it.quantity) || 0,
    it.unit || "pcs",
    parseInt(it.saldoQty) || 0,
    it.saldoUom || "pcs",
    orderId,
    it.clear || false
  ]);

  const insertIdx = startRow[0];
  sheet.insertRows(insertIdx, rows.length);
  sheet.getRange(insertIdx, 1, rows.length, COL_COUNT).setValues(rows);

  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order updated successfully" };
}

function updateOrderStatus(body) {
  const { orderId, status } = body;
  if (!orderId || !status) return { success: false, message: "Order ID and status are required" };
  if (!["Pending", "In Progress", "Completed", "Cancelled"].includes(status)) return { success: false, message: "Invalid status" };

  const sheet = getSheet(SHEET_ORDERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      sheet.getRange(i + 1, 5).setValue(status);
    }
  }
  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Status updated to " + status };
}

function deleteOrder(orderId) {
  if (!orderId) return { success: false, message: "Order ID is required" };
  const sheet = getSheet(SHEET_ORDERS);
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) rowsToDelete.push(i + 1);
  }
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order deleted successfully" };
}

// ========================================
// Excel Export (Backend - raw data)
// ========================================

function exportExcel(params) {
  let orders = readOrders();
  if (params.q) {
    const q = params.q.toLowerCase();
    orders = orders.filter(o => (o.OrderID && o.OrderID.toLowerCase().includes(q)) || (o.Users && o.Users.toLowerCase().includes(q)) || (o.ItemNames && o.ItemNames.toLowerCase().includes(q)));
  }
  if (params.status) orders = orders.filter(o => o.Status === params.status);
  if (params.department) orders = orders.filter(o => o.Department === params.department);
  if (params.month && params.year) {
    const m = parseInt(params.month) - 1, y = parseInt(params.year);
    orders = orders.filter(o => { const d = new Date(o.Date); return d.getMonth() === m && d.getFullYear() === y; });
  } else if (params.month) {
    const m = parseInt(params.month) - 1, y = new Date().getFullYear();
    orders = orders.filter(o => { const d = new Date(o.Date); return d.getMonth() === m && d.getFullYear() === y; });
  }
  orders.sort((a, b) => new Date(b.Date) - new Date(a.Date));

  return {
    success: true,
    data: orders,
    total: orders.length,
    filename: "Work_Orders_" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd_HHmmss")
  };
}

// ========================================
// Sample Data Generator
// ========================================

function generateSampleData() {
  const sheet = getSheet(SHEET_ORDERS);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) return { success: false, message: "Sheet sudah ada data. Hapus dulu." };

  const names = ["ROCHIM", "HERY", "GALIH", "EDO", "EDI", "MANSUR", "RAFLI", "BUDI", "ANDI", "DEWI", "RIZKI", "SITI", "AHMAD", "MAYA", "DONI", "RINA", "HENDRA", "LISA", "FAJAR", "ANISA"];
  const depts = ["Engineering", "Project Management", "Procurement", "Operations", "Finance", "HR & Admin", "IT", "Marketing", "Logistics", "Other"];
  const statuses = ["Pending", "In Progress", "Completed", "Cancelled"];
  const descriptions = [
    "U/STOCK BULANAN", "U/REBUILD HONNING", "U/INTALASI MESIN POMPA", "U/TOOL KITS",
    "U/PERLENGKAPAN SAFETY", "U/STOCK", "U/REPLACE KAPASITOR", "U/MAINTENANCE",
    "U/PROJECT BARU", "U/RENOVASI"
  ];
  const itemPool = [
    { name: "ALUMUNIUM FOIL", unit: "PCS" },
    { name: "BATU GERINDA 4\" (CUTTING TEBAL)", unit: "PCS" },
    { name: "BATU GERINDA 4\" (CUTTING TIPIS)", unit: "PCS" },
    { name: "BUFFING BATU PAYUNG KECIL", unit: "PCS" },
    { name: "BUFFING GRIT 240 (50 X 10)", unit: "PCS" },
    { name: "BUFFING GRIT 320 (50 X 20)", unit: "PCS" },
    { name: "CLEANER/REMOVER SKC-S", unit: "PCS" },
    { name: "CONTACT TIP 1,2MM", unit: "PCS" },
    { name: "GAS CUTTING TIP 106HC-3 KOIKE", unit: "PCS" },
    { name: "ISOLASI LISTRIK", unit: "PCS" },
    { name: "KACA LAS 10 HITAM", unit: "PCS" },
    { name: "KUAS 2\"", unit: "PCS" },
    { name: "LAKBAN HITAM 35 MM X 12 M", unit: "PCS" },
    { name: "LEM ALTECO", unit: "PCS" },
    { name: "NUT M16", unit: "PCS" },
    { name: "NUT M20 (HITAM)", unit: "PCS" },
    { name: "SARUNG TANGAN KARET", unit: "PCS" },
    { name: "SEAL TAPE", unit: "PCS" },
    { name: "SIKAT KAWAT", unit: "PCS" },
    { name: "INSERT CNMG120408 IC8250", unit: "PCS" },
    { name: "INSERT GROOVING MGMN400-M", unit: "PCS" },
    { name: "KAWAT LAS CHE 40 6013 2,6 MM", unit: "BOX" },
    { name: "KAWAT LAS CHE 56 7016 3.2 MM", unit: "BOX" },
    { name: "BEARING 6205", unit: "PCS" },
    { name: "BEARING 6203", unit: "PCS" },
    { name: "KABEL 2 X 1,5 MM", unit: "M" },
    { name: "TANG BUAYA 10 INC", unit: "PCS" },
    { name: "KACA MATA SAFETY BENING", unit: "PCS" },
    { name: "AR HP", unit: "TBG" },
    { name: "CO2", unit: "TBG" }
  ];

  const rows = [];
  let orderNum = 0;

  for (let month = 3; month <= 8; month++) {
    const ordersPerMonth = 30 + Math.floor(Math.random() * 15);
    for (let j = 0; j < ordersPerMonth; j++) {
      orderNum++;
      const year = 2026;
      const day = 1 + Math.floor(Math.random() * 28);
      const dateStr = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      const orderId = "WO-" + year + String(month + 1).padStart(2, "0") + String(day).padStart(2, "0") + "-" + String(orderNum).padStart(3, "0");

      const name = names[Math.floor(Math.random() * names.length)];
      const dept = depts[Math.floor(Math.random() * depts.length)];
      const desc = descriptions[Math.floor(Math.random() * descriptions.length)];

      let statusRand = Math.random() * 100;
      let status = "Completed";
      if (statusRand < 20) status = "Pending";
      else if (statusRand < 35) status = "In Progress";
      else if (statusRand < 85) status = "Completed";
      else status = "Cancelled";

      const itemCount = 1 + Math.floor(Math.random() * 4);
      const usedItems = new Set();
      for (let k = 0; k < itemCount; k++) {
        let itemIdx;
        do { itemIdx = Math.floor(Math.random() * itemPool.length); } while (usedItems.has(itemIdx) && usedItems.size < itemPool.length);
        usedItems.add(itemIdx);
        const item = itemPool[itemIdx];
        const qty = 1 + Math.floor(Math.random() * 50);
        const saldoQty = Math.floor(Math.random() * 10);
        const clear = Math.random() > 0.7;
        const userName = names[Math.floor(Math.random() * names.length)];

        rows.push([
          orderId, dateStr, dept, desc, status,
          userName, item.name, qty, item.unit,
          saldoQty, item.unit,
          orderId, clear
        ]);
      }
    }
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, COL_COUNT).setValues(rows);
  }
  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Berhasil generate " + rows.length + " baris (" + orderNum + " orders)" };
}
