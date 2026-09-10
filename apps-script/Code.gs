// ========================================
// Work Order Management System - Backend
// Google Apps Script Web App (Single Sheet)
// ========================================

const SHEET_ORDERS = "ORDERS";
const SHEET_ITEMS = "ORDER_ITEMS"; // legacy, for migration only
const CACHE_TTL = 180;

// ========================================
// HTTP Handlers
// ========================================

function doGet(e) {
  const action = (e && e.parameter) ? e.parameter.action : "getDashboardStats";
  let result;

  try {
    switch (action) {
      case "getOrders":
        result = getOrders(e.parameter);
        break;
      case "getOrderDetail":
        result = getOrderDetail(e.parameter.id);
        break;
      case "getDashboardStats":
        result = getDashboardStats();
        break;
      case "getDepartments":
        result = getDepartments();
        break;
      case "createOrder":
        var data = JSON.parse(e.parameter.data);
        result = createOrder(data);
        break;
      case "updateOrder":
        var data = JSON.parse(e.parameter.data);
        result = updateOrder(data);
        break;
      case "updateOrderStatus":
        result = updateOrderStatus({
          orderId: e.parameter.orderId,
          status: e.parameter.status
        });
        break;
      case "deleteOrder":
        result = deleteOrder(e.parameter.id);
        break;
      case "exportExcel":
        result = exportExcel(e.parameter);
        break;
      case "migrateData":
        result = migrateData();
        break;
      default:
        result = { success: false, message: "Unknown action: " + action };
    }
  } catch (err) {
    result = { success: false, message: err.message };
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
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
      sheet.appendRow([
        "OrderID", "Date", "RequesterName", "Department",
        "Purpose", "Notes", "Status", "CreatedAt", "CompletedAt", "Items"
      ]);
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
    const readCount = lastRow - readStart + 1;
    const ids = sheet.getRange(readStart, 1, readCount, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      const orderId = ids[i][0];
      if (orderId && typeof orderId === "string" && orderId.startsWith(prefix)) {
        const num = parseInt(orderId.split("-")[2], 10);
        if (num > maxNum) maxNum = num;
      }
    }
  }

  return prefix + String(maxNum + 1).padStart(3, "0");
}

// Read all orders from single sheet
function readOrders() {
  const sheet = getSheet(SHEET_ORDERS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const data = sheet.getRange(1, 1, lastRow, 10).getValues();
  const headers = data[0];
  const orders = [];

  for (let i = 1; i < data.length; i++) {
    const obj = {};
    headers.forEach((h, j) => { obj[h] = data[i][j]; });

    // Parse items JSON
    try {
      const parsed = typeof obj.Items === "string" ? JSON.parse(obj.Items) : (obj.Items || []);
      obj.Items = Array.isArray(parsed) ? parsed.map(it => ({
        ItemName: it.itemName || it.ItemName || "",
        Quantity: parseInt(it.quantity || it.Quantity) || 0,
        Unit: it.unit || it.Unit || "pcs",
        Notes: it.notes || it.Notes || ""
      })) : [];
    } catch (e) {
      obj.Items = [];
    }

    obj.ItemCount = obj.Items.length;
    obj.ItemNames = obj.Items.map(it => it.ItemName).join(", ");
    orders.push(obj);
  }

  return orders;
}

// ========================================
// Migration (one-time: old 2-sheet → new single sheet)
// ========================================

function migrateData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ordersSheet = ss.getSheetByName(SHEET_ORDERS);
  const itemsSheet = ss.getSheetByName(SHEET_ITEMS);

  if (!ordersSheet) return { success: false, message: "Sheet ORDERS tidak ditemukan" };

  // 1. Read items first (before we modify anything)
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

  // 2. Read orders
  const oLastRow = ordersSheet.getLastRow();
  const oLastCol = ordersSheet.getLastColumn();
  if (oLastRow < 2) return { success: false, message: "Tidak ada data order" };

  const oData = ordersSheet.getRange(1, 1, oLastRow, oLastCol).getValues();
  const newRows = [];

  for (let i = 1; i < oData.length; i++) {
    const r = oData[i];
    const oid = String(r[0] || "");
    const itemsJson = JSON.stringify(itemData[oid] || []);
    newRows.push([
      oid,                           // OrderID
      r[1] || "",                    // Date
      r[2] || "",                    // RequesterName
      r[3] || "",                    // Department
      r[4] || "",                    // Purpose
      r[5] || "",                    // Notes
      r[6] || "Pending",             // Status
      r[7] || "",                    // CreatedAt
      r[8] || "",                    // CompletedAt
      itemsJson                      // Items (JSON)
    ]);
  }

  // 3. Clear and rewrite
  ordersSheet.clearContents();
  ordersSheet.getRange(1, 1, 1, 10).setValues([[
    "OrderID", "Date", "RequesterName", "Department",
    "Purpose", "Notes", "Status", "CreatedAt", "CompletedAt", "Items"
  ]]);
  if (newRows.length > 0) {
    ordersSheet.getRange(2, 1, newRows.length, 10).setValues(newRows);
  }

  // 4. Delete items sheet
  if (itemsSheet) {
    try { ss.deleteSheet(itemsSheet); } catch(e) {}
  }

  return { success: true, message: "Berhasil migrate " + newRows.length + " orders" };
}

// ========================================
// Core Functions
// ========================================

function getOrders(params) {
  let enriched = readOrders();

  // Search
  if (params.q) {
    const q = params.q.toLowerCase();
    enriched = enriched.filter(o =>
      (o.OrderID && o.OrderID.toLowerCase().includes(q)) ||
      (o.RequesterName && o.RequesterName.toLowerCase().includes(q)) ||
      (o.ItemNames && o.ItemNames.toLowerCase().includes(q))
    );
  }

  // Filter: status
  if (params.status) {
    enriched = enriched.filter(o => o.Status === params.status);
  }

  // Filter: department
  if (params.department) {
    enriched = enriched.filter(o => o.Department === params.department);
  }

  // Filter: month + year
  if (params.month && params.year) {
    const m = parseInt(params.month) - 1;
    const y = parseInt(params.year);
    enriched = enriched.filter(o => {
      const d = new Date(o.Date);
      return d.getMonth() === m && d.getFullYear() === y;
    });
  } else if (params.year) {
    const y = parseInt(params.year);
    enriched = enriched.filter(o => new Date(o.Date).getFullYear() === y);
  }

  // Sort
  const sortField = params.sort || "date";
  const sortDir = params.dir === "asc" ? 1 : -1;
  enriched.sort((a, b) => {
    if (sortField === "date") {
      return sortDir * (new Date(a.Date) - new Date(b.Date));
    } else if (sortField === "orderId") {
      return sortDir * a.OrderID.localeCompare(b.OrderID);
    } else if (sortField === "status") {
      return sortDir * a.Status.localeCompare(b.Status);
    }
    return 0;
  });

  // Pagination
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(params.pageSize) || 25));
  const total = enriched.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize;
  const paged = enriched.slice(start, start + pageSize);

  return {
    success: true,
    data: paged,
    pagination: { page, pageSize, total, totalPages }
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
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const stats = {
    totalOrders: orders.length,
    pendingOrders: orders.filter(o => o.Status === "Pending").length,
    completedOrders: orders.filter(o => o.Status === "Completed").length,
    inProgressOrders: orders.filter(o => o.Status === "In Progress").length,
    cancelledOrders: orders.filter(o => o.Status === "Cancelled").length,
    ordersThisMonth: orders.filter(o => {
      const d = new Date(o.Date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length,
    recentOrders: orders
      .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt))
      .slice(0, 5)
  };

  const result = { success: true, data: stats };
  cache.put("dashboard_stats", JSON.stringify(result), CACHE_TTL);
  return result;
}

function getDepartments() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("departments");
  if (cached) return JSON.parse(cached);

  const result = {
    success: true,
    data: [
      "Engineering", "Project Management", "Procurement",
      "Operations", "Finance", "HR & Admin", "IT",
      "Marketing", "Logistics", "Other"
    ]
  };
  cache.put("departments", JSON.stringify(result), 3600);
  return result;
}

function createOrder(body) {
  const { date, requesterName, department, purpose, notes, items, createdBy } = body;

  if (!requesterName || !department || !items || items.length === 0) {
    return { success: false, message: "Missing required fields" };
  }

  const orderId = generateOrderID();
  const now = new Date().toISOString();
  const orderDate = date || Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd");

  const itemsJson = JSON.stringify(items.map(item => ({
    ItemName: item.itemName || "",
    Quantity: parseInt(item.quantity) || 0,
    Unit: item.unit || "pcs",
    Notes: item.notes || ""
  })));

  const sheet = getSheet(SHEET_ORDERS);
  sheet.appendRow([
    orderId, orderDate, requesterName, department,
    purpose || "", notes || "", "Pending", now, "", itemsJson
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
    if (data[i][0] === orderId) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) return { success: false, message: "Order not found" };

  if (date) sheet.getRange(rowIndex, 2).setValue(date);
  if (requesterName) sheet.getRange(rowIndex, 3).setValue(requesterName);
  if (department) sheet.getRange(rowIndex, 4).setValue(department);
  if (purpose !== undefined) sheet.getRange(rowIndex, 5).setValue(purpose);
  if (notes !== undefined) sheet.getRange(rowIndex, 6).setValue(notes);

  if (items && Array.isArray(items)) {
    const itemsJson = JSON.stringify(items.map(item => ({
      ItemName: item.itemName || "",
      Quantity: parseInt(item.quantity) || 0,
      Unit: item.unit || "pcs",
      Notes: item.notes || ""
    })));
    sheet.getRange(rowIndex, 10).setValue(itemsJson);
  }

  CacheService.getScriptCache().remove("dashboard_stats");
  return { success: true, message: "Order updated successfully" };
}

function updateOrderStatus(body) {
  const { orderId, status } = body;
  if (!orderId || !status) return { success: false, message: "Order ID and status are required" };

  const validStatuses = ["Pending", "In Progress", "Completed", "Cancelled"];
  if (!validStatuses.includes(status)) return { success: false, message: "Invalid status" };

  const sheet = getSheet(SHEET_ORDERS);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === orderId) {
      const row = i + 1;
      sheet.getRange(row, 7).setValue(status);
      sheet.getRange(row, 9).setValue(status === "Completed" ? new Date().toISOString() : "");

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
    orders = orders.filter(o =>
      (o.OrderID && o.OrderID.toLowerCase().includes(q)) ||
      (o.RequesterName && o.RequesterName.toLowerCase().includes(q)) ||
      (o.ItemNames && o.ItemNames.toLowerCase().includes(q))
    );
  }
  if (params.status) orders = orders.filter(o => o.Status === params.status);
  if (params.department) orders = orders.filter(o => o.Department === params.department);
  if (params.month && params.year) {
    const m = parseInt(params.month) - 1;
    const y = parseInt(params.year);
    orders = orders.filter(o => {
      const d = new Date(o.Date);
      return d.getMonth() === m && d.getFullYear() === y;
    });
  }

  orders.sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));

  const rows = orders.map(o => ({
    "Order ID": o.OrderID,
    "Date": o.Date,
    "Requester": o.RequesterName,
    "Department": o.Department,
    "Purpose": o.Purpose || "",
    "Items": o.Items.map(it => it.ItemName + " (" + it.Quantity + " " + it.Unit + ")").join(", "),
    "Status": o.Status,
    "Notes": o.Notes || ""
  }));

  return {
    success: true,
    data: rows,
    total: rows.length,
    filename: "Work_Orders_" + Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyyMMdd_HHmmss")
  };
}
