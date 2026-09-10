// ========================================
// Work Order Management System - Backend
// Google Apps Script (Clean Single Sheet)
// ========================================

const SHEET_ORDERS = "ORDERS";
const SHEET_ITEMS = "ORDER_ITEMS";
const CACHE_TTL = 180;

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
      default: result = { success: false, message: "Unknown action" };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// Sheet: OrderID | Date | RequesterName | Department | Purpose | Notes | Status | Items
// Items = JSON string, display = clean text
// ========================================

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_ORDERS) {
      sheet.appendRow(["OrderID", "Date", "RequesterName", "Department", "Purpose", "Notes", "Status", "Items"]);
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
    const readStart = Math.max(2, lastRow - 99);
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

function readOrders() {
  const sheet = getSheet(SHEET_ORDERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const numCols = sheet.getLastColumn();
  const data = sheet.getRange(1, 1, lastRow, numCols).getValues();
  const headers = data[0];
  const orders = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const obj = {};
    headers.forEach((h, j) => { obj[h] = row[j]; });

    // Parse items JSON -> clean text
    let items = [];
    try {
      const raw = obj.Items || "";
      const parsed = typeof raw === "string" && raw.startsWith("[") ? JSON.parse(raw) : [];
      items = Array.isArray(parsed) ? parsed.map(it => ({
        ItemName: it.ItemName || it.itemName || "",
        Quantity: parseInt(it.Quantity || it.quantity) || 0,
        Unit: it.Unit || it.unit || "pcs",
        Notes: it.Notes || it.notes || ""
      })) : [];
    } catch (e) { items = []; }

    orders.push({
      OrderID: obj.OrderID || row[0] || "",
      Date: obj.Date || row[1] || "",
      RequesterName: obj.RequesterName || row[2] || "",
      Department: obj.Department || row[3] || "",
      Purpose: obj.Purpose || row[4] || "",
      Notes: obj.Notes || row[5] || "",
      Status: obj.Status || row[6] || "Pending",
      Items: items,
      ItemCount: items.length,
      ItemNames: items.map(it => it.ItemName + " (" + it.Quantity + " " + it.Unit + ")").join(", ")
    });
  }
  return orders;
}

// ========================================
// Migration
// ========================================

function migrateData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(SHEET_ORDERS);
  const itemsSheet = ss.getSheetByName(SHEET_ITEMS);
  if (!ordersSheet) return { success: false, message: "Sheet ORDERS tidak ditemukan" };

  const headers = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  if (headers.includes("Items") && !headers.includes("CreatedAt")) {
    return { success: true, message: "Sudah di-migrate" };
  }

  // Read items from old sheet
  const itemData = {};
  if (itemsSheet && itemsSheet.getLastRow() > 1) {
    const iRows = itemsSheet.getDataRange().getValues();
    for (let i = 1; i < iRows.length; i++) {
      const oid = String(iRows[i][0]);
      if (!itemData[oid]) itemData[oid] = [];
      itemData[oid].push({
        ItemName: String(iRows[i][1] || ""),
        Quantity: Number(iRows[i][2]) || 0,
        Unit: String(iRows[i][3] || "pcs"),
        Notes: String(iRows[i][4] || "")
      });
    }
  }

  // Read old orders (may have CreatedAt in col 8, CompletedAt in col 9)
  const lastRow = ordersSheet.getLastRow();
  if (lastRow < 2) return { success: false, message: "Tidak ada data" };
  const numCols = ordersSheet.getLastColumn();
  const oData = ordersSheet.getRange(1, 1, lastRow, numCols).getValues();

  // Build clean rows (8 cols only)
  const newRows = [];
  for (let i = 1; i < oData.length; i++) {
    const r = oData[i];
    const oid = String(r[0] || "");
    // If already has Items as JSON in col 8+
    let items = [];
    const itemsColIdx = headers.indexOf("Items");
    if (itemsColIdx >= 0 && r[itemsColIdx]) {
      try {
        const p = JSON.parse(String(r[itemsColIdx]));
        items = Array.isArray(p) ? p : (itemData[oid] || []);
      } catch(e) {
        items = itemData[oid] || [];
      }
    } else {
      items = itemData[oid] || [];
    }

    newRows.push([
      oid,
      r[1] || "",
      r[2] || "",
      r[3] || "",
      r[4] || "",
      r[5] || "",
      r[6] || "Pending",
      JSON.stringify(items)
    ]);
  }

  // Rewrite sheet
  ordersSheet.clearContents();
  ordersSheet.getRange(1, 1, 1, 8).setValues([["OrderID", "Date", "RequesterName", "Department", "Purpose", "Notes", "Status", "Items"]]);
  if (newRows.length > 0) {
    ordersSheet.getRange(2, 1, newRows.length, 8).setValues(newRows);
  }

  if (itemsSheet) { try { ss.deleteSheet(itemsSheet); } catch(e) {} }
  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Berhasil migrate " + newRows.length + " orders" };
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
  const itemsJson = JSON.stringify(items.map(it => ({
    ItemName: it.itemName || "",
    Quantity: parseInt(it.quantity) || 0,
    Unit: it.unit || "pcs",
    Notes: it.notes || ""
  })));

  getSheet(SHEET_ORDERS).appendRow([
    orderId, orderDate, requesterName, department,
    purpose || "", notes || "", "Pending", itemsJson
  ]);

  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order created successfully", data: { orderId } };
}

function updateOrder(body) {
  const { orderId, date, requesterName, department, purpose, notes, items } = body;
  if (!orderId) return { success: false, message: "Order ID is required" };

  const sheet = getSheet(SHEET_ORDERS);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) { rowIndex = i + 1; break; }
  }
  if (rowIndex === -1) return { success: false, message: "Order not found" };

  if (date) sheet.getRange(rowIndex, 2).setValue(date);
  if (requesterName) sheet.getRange(rowIndex, 3).setValue(requesterName);
  if (department) sheet.getRange(rowIndex, 4).setValue(department);
  if (purpose !== undefined) sheet.getRange(rowIndex, 5).setValue(purpose);
  if (notes !== undefined) sheet.getRange(rowIndex, 6).setValue(notes);
  if (items && Array.isArray(items)) {
    sheet.getRange(rowIndex, 8).setValue(JSON.stringify(items.map(it => ({
      ItemName: it.itemName || "",
      Quantity: parseInt(it.quantity) || 0,
      Unit: it.unit || "pcs",
      Notes: it.notes || ""
    }))));
  }

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
      CacheService.getScriptCache().remove("dashboard_stats");
      return { success: true, message: "Status updated to " + status };
    }
  }
  return { success: false, message: "Order not found" };
}

function deleteOrder(orderId) {
  if (!orderId) return { success: false, message: "Order ID is required" };
  const sheet = getSheet(SHEET_ORDERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      sheet.deleteRow(i + 1);
      CacheService.getScriptCache().remove("dashboard_stats");
      return { success: true, message: "Order deleted successfully" };
    }
  }
  return { success: false, message: "Order not found" };
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
