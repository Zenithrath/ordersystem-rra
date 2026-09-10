// ========================================
// Work Order Management System - Backend
// Google Apps Script (Flat Rows - No JSON)
// ========================================

const SHEET_ORDERS = "ORDERS";
const SHEET_ITEMS = "ORDER_ITEMS";
const CACHE_TTL = 180;
const COL_COUNT = 11;

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
// Sheet: OrderID | Date | RequesterName | Department | Purpose | Notes | Status | ItemName | Quantity | Unit | ItemNotes
// Each item = 1 row. Order data repeated.
// ========================================

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_ORDERS) {
      sheet.appendRow(["OrderID", "Date", "RequesterName", "Department", "Purpose", "Notes", "Status", "ItemName", "Quantity", "Unit", "ItemNotes"]);
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
      // Format date properly
      let dateVal = r[1];
      if (dateVal instanceof Date) {
        dateVal = Utilities.formatDate(dateVal, "Asia/Jakarta", "yyyy-MM-dd");
      } else {
        dateVal = String(dateVal || "");
      }

      orderMap[oid] = {
        OrderID: oid,
        Date: dateVal,
        RequesterName: String(r[2] || ""),
        Department: String(r[3] || ""),
        Purpose: String(r[4] || ""),
        Notes: String(r[5] || ""),
        Status: String(r[6] || "Pending"),
        Items: []
      };
      orderKeys.push(oid);
    }

    const itemName = String(r[7] || "").trim();
    if (itemName) {
      orderMap[oid].Items.push({
        ItemName: itemName,
        Quantity: parseInt(r[8]) || 0,
        Unit: String(r[9] || "pcs"),
        Notes: String(r[10] || "")
      });
    }
  }

  return orderKeys.map(oid => {
    const o = orderMap[oid];
    o.ItemCount = o.Items.length;
    o.ItemNames = o.Items.map(it => {
      let s = it.ItemName + " (" + it.Quantity + " " + it.Unit + ")";
      if (it.Notes) s += " - " + it.Notes;
      return s;
    }).join(", ");
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

  // If no ORDERS sheet, create fresh with correct headers
  if (!ordersSheet) {
    ordersSheet = ss.insertSheet(SHEET_ORDERS);
    ordersSheet.appendRow(["OrderID", "Date", "RequesterName", "Department", "Purpose", "Notes", "Status", "ItemName", "Quantity", "Unit", "ItemNotes"]);
    if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
    return { success: true, message: "Sheet ORDERS baru dibuat dengan 11 kolom" };
  }

  const lastRow = ordersSheet.getLastRow();
  if (lastRow < 2) {
    // Empty sheet, just set headers
    ordersSheet.clearContents();
    ordersSheet.appendRow(["OrderID", "Date", "RequesterName", "Department", "Purpose", "Notes", "Status", "ItemName", "Quantity", "Unit", "ItemNotes"]);
    if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
    return { success: true, message: "Sheet ORDERS kosong, header sudah di-set" };
  }

  const numCols = ordersSheet.getLastColumn();
  const headers = ordersSheet.getRange(1, 1, 1, numCols).getValues()[0];

  // Already flat rows?
  if (headers.includes("ItemName") && headers.includes("ItemNotes")) {
    if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
    return { success: true, message: "Sudah di-migrate (flat rows)" };
  }

  // Read all data
  if (lastRow < 2) return { success: false, message: "Tidak ada data" };

  const allData = ordersSheet.getRange(1, 1, lastRow, numCols).getValues();
  const oldHeaders = allData[0];

  // Find column indices
  const colIdx = {};
  oldHeaders.forEach((h, i) => { colIdx[h] = i; });

  // Read items from old ORDER_ITEMS sheet
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

  // Build flat rows
  const newRows = [];
  for (let i = 1; i < allData.length; i++) {
    const r = allData[i];
    const oid = String(r[colIdx["OrderID"] || 0] || "").trim();
    if (!oid) continue;

    const date = r[colIdx["Date"] || 1] || "";
    const requester = String(r[colIdx["RequesterName"] || 2] || "");
    const dept = String(r[colIdx["Department"] || 3] || "");
    const purpose = String(r[colIdx["Purpose"] || 4] || "");
    const notes = String(r[colIdx["Notes"] || 5] || "");
    const status = String(r[colIdx["Status"] || 6] || "Pending");

    // Check if Items column has JSON
    let items = [];
    const itemsCol = colIdx["Items"];
    if (itemsCol !== undefined && r[itemsCol]) {
      try {
        const parsed = JSON.parse(String(r[itemsCol]));
        if (Array.isArray(parsed)) items = parsed;
      } catch(e) {}
    }

    // Fallback to ORDER_ITEMS sheet data
    if (items.length === 0 && itemData[oid]) {
      items = itemData[oid];
    }

    // If still no items, create one empty row
    if (items.length === 0) {
      items = [{ ItemName: "", Quantity: 0, Unit: "pcs", Notes: "" }];
    }

    // Write one row per item
    for (const it of items) {
      newRows.push([
        oid, date, requester, dept, purpose, notes, status,
        it.ItemName || it.itemName || "",
        parseInt(it.Quantity || it.quantity) || 0,
        it.Unit || it.unit || "pcs",
        it.Notes || it.notes || ""
      ]);
    }
  }

  // Rewrite sheet
  ordersSheet.clearContents();
  ordersSheet.getRange(1, 1, 1, COL_COUNT).setValues([["OrderID", "Date", "RequesterName", "Department", "Purpose", "Notes", "Status", "ItemName", "Quantity", "Unit", "ItemNotes"]]);
  if (newRows.length > 0) {
    ordersSheet.getRange(2, 1, newRows.length, COL_COUNT).setValues(newRows);
  }

  // Delete old sheet
  if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Berhasil migrate " + newRows.length + " baris (flat)" };
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
      (o.RequesterName && o.RequesterName.toLowerCase().includes(q)) ||
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
  const { date, requesterName, department, purpose, notes, items } = body;
  if (!requesterName || !department || !items || items.length === 0) {
    return { success: false, message: "Missing required fields" };
  }

  const orderId = generateOrderID();
  const orderDate = date || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");
  const sheet = getSheet(SHEET_ORDERS);

  const rows = items.map(it => [
    orderId, orderDate, requesterName, department,
    purpose || "", notes || "", "Pending",
    it.itemName || "",
    parseInt(it.quantity) || 0,
    it.unit || "pcs",
    it.notes || ""
  ]);

  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, COL_COUNT).setValues(rows);
  }

  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order created successfully", data: { orderId } };
}

function updateOrder(body) {
  const { orderId, date, requesterName, department, purpose, notes, items } = body;
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

  // Insert new rows
  const orderDate = date || data[startRow[0] - 1][1];
  const rows = (items && items.length > 0 ? items : [{ itemName: "", quantity: 0, unit: "pcs", notes: "" }]).map(it => [
    orderId, orderDate, requesterName || "",
    department || "", purpose || "", notes || "",
    data[startRow[0] - 1][6] || "Pending",
    it.itemName || "",
    parseInt(it.quantity) || 0,
    it.unit || "pcs",
    it.notes || ""
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
      sheet.getRange(i + 1, 7).setValue(status);
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
// Excel Export
// ========================================

function exportExcel(params) {
  let orders = readOrders();
  if (params.q) {
    const q = params.q.toLowerCase();
    orders = orders.filter(o => (o.OrderID && o.OrderID.toLowerCase().includes(q)) || (o.RequesterName && o.RequesterName.toLowerCase().includes(q)) || (o.ItemNames && o.ItemNames.toLowerCase().includes(q)));
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
    data: orders.map(o => ({
      "Order ID": o.OrderID, "Date": o.Date, "Requester": o.RequesterName,
      "Department": o.Department, "Purpose": o.Purpose || "",
      "Items": o.ItemNames, "Status": o.Status, "Notes": o.Notes || ""
    })),
    total: orders.length,
    filename: "Work_Orders_" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd_HHmmss")
  };
}

// ========================================
// Sample Data Generator (run once)
// ========================================

function generateSampleData() {
  const sheet = getSheet(SHEET_ORDERS);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) return { success: false, message: "Sheet sudah ada data. Hapus dulu atau migrate dulu." };

  const names = ["Budi Santoso", "Andi Pratama", "Dewi Lestari", "Rizki Ramadhan", "Siti Nurhaliza", "Ahmad Fauzi", "Maya Putri", "Doni Kurniawan", "Rina Wati", "Hendra Wijaya", "Lisa Anggraeni", "Fajar Nugroho", "Anisa Rahmawati", "Tommy Prasetyo", "Sari Dewi", "Bayu Firmansyah", "Nina Agustin", "Rudi Hermawan", "Lia Marlina", "Yoga Saputra"];
  const depts = ["Engineering", "Project Management", "Procurement", "Operations", "Finance", "HR & Admin", "IT", "Marketing", "Logistics", "Other"];
  const statuses = ["Pending", "In Progress", "Completed", "Cancelled"];
  const statusWeights = [20, 15, 50, 15];
  const purposes = ["Project Alpha", "Maintenance Q3", "Office Renovation", "Server Upgrade", "Event Preparation", "Inventory Restock", "Safety Equipment", "Lab Supplies", "Field Work", "Client Delivery"];
  const itemPool = [
    { name: "RAM DDR4 8GB", unit: "pcs", notes: ["Merk Samsung", "Merk Kingston", "Merk Corsair", ""] },
    { name: "Kabel NYM 2x2.5", unit: "meter", notes: ["Standar SNI", "Anti api", ""] },
    { name: "Monitor LG 24 inch", unit: "unit", notes: ["Model 24MK430", "Full HD", ""] },
    { name: "Keyboard Mechanical", unit: "pcs", notes: ["Switch Blue", "RGB", ""] },
    { name: "Mouse Wireless", unit: "pcs", notes: ["Logitech", "Ergonomis", ""] },
    { name: "Printer Tinta Canon", unit: "pack", notes: ["Warna hitam", "Warna color", ""] },
    { name: "Baterai AA", unit: "pack", notes: ["Energizer", "Alkaline", ""] },
    { name: "Tinta Printer Epson", unit: "botol", notes: ["Black", "Color set", ""] },
    { name: "Amplas 120", unit: "pack", notes: ["Ukuran A4", ""] },
    { name: "Baut M8", unit: "pack", notes: ["Panjang 3cm", "Stainless", ""] },
    { name: "Cat Tembok", unit: "kaleng", notes: ["Putih 5kg", "Abu-abu 5kg", "Biru 2.5kg", ""] },
    { name: "Pipa PVC 2 inch", unit: "batang", notes: ["Standar", ""] },
    { name: "Sepatu Safety", unit: "pcs", notes: ["SNI", "Ukuran 42", "Ukuran 40", ""] },
    { name: "Helm Proyek", unit: "pcs", notes: ["Kuning", "Putih", "Biru", ""] },
    { name: "Sarung Tangan", unit: "pcs", notes: ["Karet", "Kain", ""] },
    { name: "Lem Aica Aibon", unit: "pack", notes: ["Ukuran 100g", ""] },
    { name: "Suku Cadang AC", unit: "set", notes: ["Filter", "Compressor", ""] },
    { name: "Software License", unit: "set", notes: ["Windows 11 Pro", "Office 365", "AutoCAD", ""] },
    { name: "USB Drive 32GB", unit: "pcs", notes: ["SanDisk", "Kingston", ""] },
    { name: "Headset Gaming", unit: "pcs", notes: ["Noise cancelling", ""] }
  ];

  const rows = [];
  let orderNum = 0;

  // Generate orders across 6 months (Apr - Sep 2026)
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
      const purpose = purposes[Math.floor(Math.random() * purposes.length)];

      // Weighted status
      let statusRand = Math.random() * 100;
      let status = "Completed";
      if (statusRand < statusWeights[0]) status = "Pending";
      else if (statusRand < statusWeights[0] + statusWeights[1]) status = "In Progress";
      else if (statusRand < statusWeights[0] + statusWeights[1] + statusWeights[2]) status = "Completed";
      else status = "Cancelled";

      const itemCount = 1 + Math.floor(Math.random() * 3);
      const usedItems = new Set();
      for (let k = 0; k < itemCount; k++) {
        let itemIdx;
        do { itemIdx = Math.floor(Math.random() * itemPool.length); } while (usedItems.has(itemIdx) && usedItems.size < itemPool.length);
        usedItems.add(itemIdx);
        const item = itemPool[itemIdx];
        const qty = 1 + Math.floor(Math.random() * 20);
        const note = item.notes[Math.floor(Math.random() * item.notes.length)];

        rows.push([
          orderId, dateStr, name, dept, purpose, "", status,
          item.name, qty, item.unit, note
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
